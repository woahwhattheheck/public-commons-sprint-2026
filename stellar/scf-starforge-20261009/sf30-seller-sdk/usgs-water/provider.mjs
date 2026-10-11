// MIT. Original USGS Water Data v1 acquisition and portable retained pages.
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';

export const USGS_ORIGIN = 'https://api.waterdata.usgs.gov';
export const USGS_API = USGS_ORIGIN + '/ogcapi/v1';
export const CAPTURE_SCHEMA = 'starforge.usgs-water-capture.v1';
export const COLLECTIONS = Object.freeze(['daily', 'continuous', 'monitoring-locations', 'time-series-metadata']);
const OBSERVATIONS = new Set(['daily', 'continuous']);
const MAX_PAGE_BYTES = 64 * 1024 * 1024;
const META_BYTES = 32 * 1024 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const now = () => new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const canonicalJson = value => JSON.stringify(ordered(value));
const selectionHash = value => hash(JSON.stringify(value, null, 2) + '\n');
function fail(code, message, status = 400, detail = undefined) {
  throw Object.assign(new Error(message), { code, status, ...(detail === undefined ? {} : { detail }) });
}
function operationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) fail('USGS_OPERATION_ID', 'Choose a stable operation ID using letters, digits, underscores or hyphens.');
  return value;
}
function text(value, label, { empty = false, max = 2048 } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.length) || /[\u0000-\u001f\u007f]/.test(value)) fail('USGS_SELECTION', 'Invalid ' + label + '.');
  return value;
}
function list(value, label, pattern) {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? value.split(/[,\s]+/).filter(Boolean) : value;
  if (!Array.isArray(values) || values.some(item => typeof item !== 'string' || !pattern.test(item))) fail('USGS_SELECTION', 'Invalid ' + label + '. Preserve the original code strings.');
  return [...new Set(values)].sort();
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dateTime(value) {
  return typeof value === 'string' && dateOnly(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
const FILTERS = Object.freeze({
  daily: new Set(['approval_status', 'qualifier', 'last_modified']),
  continuous: new Set(['approval_status', 'qualifier', 'last_modified', 'method_category']),
  'time-series-metadata': new Set(['primary', 'computation_period_identifier', 'computation_identifier', 'begin', 'end', 'last_modified', 'sublocation_identifier']),
  'monitoring-locations': new Set(['agency_code', 'state_code', 'county_code', 'country_code', 'site_type_code', 'hydrologic_unit_code', 'monitoring_location_name', 'national_aquifer_code', 'aquifer_code'])
});

/** Arrays are expanded into original GET streams, not invented comma-list filters. */
export function normalizeSelection(input) {
  if (!plain(input) || !COLLECTIONS.includes(input.collection)) fail('USGS_COLLECTION', 'Select daily, continuous, monitoring-locations or time-series-metadata.');
  const allowed = new Set(['collection', 'locationIds', 'locationId', 'parameterCodes', 'parameterCode', 'statisticIds', 'statisticId', 'timeSeriesIds', 'timeSeriesId', 'time', 'limit', 'filters', 'bbox']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('USGS_SELECTION', 'Unknown selection field: ' + key);
  const selection = {
    collection: input.collection,
    locationIds: list(input.locationIds ?? input.locationId, 'monitoring location IDs', /^[A-Za-z0-9]{1,16}-[A-Za-z0-9._]{1,32}$/),
    parameterCodes: list(input.parameterCodes ?? input.parameterCode, 'parameter codes', /^\d{5}$/),
    statisticIds: list(input.statisticIds ?? input.statisticId, 'statistic codes', /^\d{5}$/),
    timeSeriesIds: list(input.timeSeriesIds ?? input.timeSeriesId, 'time-series IDs', /^[A-Za-z0-9_.:-]{1,160}$/),
    time: null,
    limit: input.limit ?? 1000,
    filters: {},
    bbox: null
  };
  if (!Number.isSafeInteger(selection.limit) || selection.limit < 1) fail('USGS_PAGE_LIMIT', 'Page size must be a positive integer; the source enforces its current maximum.');
  if (input.filters !== undefined && !plain(input.filters)) fail('USGS_SELECTION', 'Filters must be an object of selected original query fields.');
  for (const key of Object.keys(input.filters ?? {}).sort()) {
    if (!FILTERS[selection.collection].has(key)) fail('USGS_FILTER', 'This collection does not expose the selected filter: ' + key);
    selection.filters[key] = text(input.filters[key], key);
  }
  if (input.bbox !== undefined && input.bbox !== null) {
    if (!Array.isArray(input.bbox) || input.bbox.length !== 4 || input.bbox.some(value => !Number.isFinite(value)) ||
        Math.abs(input.bbox[0]) > 180 || Math.abs(input.bbox[2]) > 180 || Math.abs(input.bbox[1]) > 90 || Math.abs(input.bbox[3]) > 90 ||
        input.bbox[0] > input.bbox[2] || input.bbox[1] > input.bbox[3]) fail('USGS_BBOX', 'Use a west, south, east, north bounding box in longitude/latitude degrees.');
    selection.bbox = [...input.bbox];
  }
  if (OBSERVATIONS.has(selection.collection)) {
    let range = input.time;
    if (typeof range === 'string') { const values = range.split('/'); range = { start: values[0], end: values[1] }; if (values.length !== 2) range = null; }
    const valid = selection.collection === 'daily' ? dateOnly : dateTime;
    if (!plain(range) || Object.keys(range).some(key => !['start', 'end'].includes(key)) || !valid(range.start) || !valid(range.end)) {
      fail('USGS_TIME_RANGE', selection.collection === 'daily' ? 'Choose explicit local start and end dates, YYYY-MM-DD.' : 'Choose explicit start and end timestamps including their UTC offset.');
    }
    if ((selection.collection === 'daily' ? range.start > range.end : Date.parse(range.start) > Date.parse(range.end))) fail('USGS_TIME_RANGE', 'The end must not precede the start.');
    selection.time = { start: range.start, end: range.end };
    if (!selection.locationIds.length && !selection.timeSeriesIds.length && !selection.bbox) fail('USGS_SITE_SELECTION', 'Select monitoring locations, exact time series, or a geographic extent for observations.');
  } else if (input.time !== undefined && input.time !== null) fail('USGS_TIME_RANGE', 'Metadata uses its original begin/end filters; observation time applies to daily or continuous data.');
  if (selection.collection === 'monitoring-locations' && (selection.parameterCodes.length || selection.statisticIds.length || selection.timeSeriesIds.length)) fail('USGS_LOCATION_FILTER', 'Use time-series-metadata to discover a location by measured parameter or time-series identity.');
  return selection;
}

export function buildQueries(input) {
  const selection = normalizeSelection(input);
  const dimensions = [
    [selection.collection === 'monitoring-locations' ? 'id' : 'monitoring_location_id', selection.locationIds],
    ['parameter_code', selection.parameterCodes],
    ['statistic_id', selection.statisticIds],
    [selection.collection === 'time-series-metadata' ? 'id' : 'time_series_id', selection.timeSeriesIds]
  ];
  let terms = [{}];
  for (const [key, values] of dimensions) if (values.length) {
    const next = [];
    for (const term of terms) for (const value of values) next.push({ ...term, [key]: value });
    terms = next;
  }
  return terms.map(term => {
    const url = new URL(USGS_API + '/collections/' + selection.collection + '/items');
    url.searchParams.set('f', 'json');
    url.searchParams.set('limit', String(selection.limit));
    for (const [key, value] of Object.entries(term)) url.searchParams.set(key, value);
    if (selection.time) url.searchParams.set('time', selection.time.start + '/' + selection.time.end);
    if (selection.bbox) url.searchParams.set('bbox', selection.bbox.join(','));
    for (const [key, value] of Object.entries(selection.filters)) url.searchParams.set(key, value);
    return { id: hash(url.href).slice(0, 24), url: url.href, filters: term };
  });
}
export function buildQuery(input) {
  const queries = buildQueries(input);
  if (queries.length !== 1) fail('USGS_MULTIPLE_STREAMS', 'This selection has several original requests; use buildQueries or captureSelection.');
  return queries[0].url;
}
function approvedUrl(value, collection) {
  let url;
  try { url = new URL(value); } catch { fail('USGS_SOURCE_URL', 'The provider URL is invalid.'); }
  if (url.origin !== USGS_ORIGIN || url.pathname !== '/ogcapi/v1/collections/' + collection + '/items' || url.username || url.password || url.hash || url.searchParams.has('api_key')) {
    fail('USGS_SOURCE_URL', 'The request must stay on the selected USGS v1 collection.');
  }
  return url;
}
function nextLink(value, requestUrl, queryUrl, collection) {
  if (value === null) return null;
  const url = approvedUrl(new URL(value, requestUrl).href, collection), query = approvedUrl(queryUrl, collection);
  for (const [key, value] of query.searchParams) {
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value) fail('USGS_PAGE_SELECTION_CHANGED', 'The provider next page changed the original selection.', 502, { field: key });
  }
  for (const key of url.searchParams.keys()) if (!query.searchParams.has(key) && !['cursor', 'offset'].includes(key)) fail('USGS_PAGE_SELECTION_CHANGED', 'The provider next page introduced a different selection.', 502, { field: key });
  return url.href;
}

/** GeoJSON is kept whole; convenience fields never replace its properties. */
export function decodePage(bytes, { collection, url } = {}) {
  if (!COLLECTIONS.includes(collection)) fail('USGS_COLLECTION', 'The response collection is required.');
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let page;
  try { page = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { fail('USGS_INVALID_JSON', 'The original response is not valid UTF-8 JSON.', 502); }
  if (!plain(page) || page.type !== 'FeatureCollection' || !Array.isArray(page.features)) fail('USGS_RESPONSE_SHAPE', 'The original response is not a GeoJSON FeatureCollection.', 502);
  const issues = [];
  for (let index = 0; index < page.features.length; index++) {
    const feature = page.features[index];
    if (!plain(feature) || feature.type !== 'Feature' || !plain(feature.properties)) fail('USGS_FEATURE_SHAPE', 'An original feature has no properties object.', 502, { index });
    if (feature.id === undefined || feature.id === null) issues.push({ code: 'MISSING_FEATURE_ID', index });
    if (OBSERVATIONS.has(collection)) {
      const properties = feature.properties;
      if (own(properties, 'value') && properties.value !== null && typeof properties.value !== 'string') issues.push({ code: 'VALUE_TYPE_CHANGED', index });
      for (const field of ['time_series_id', 'monitoring_location_id', 'parameter_code', 'time', 'unit_of_measure']) {
        if (typeof properties[field] !== 'string' || !properties[field]) issues.push({ code: 'MISSING_OBSERVATION_FIELD', field, index });
      }
    }
  }
  if (own(page, 'numberReturned') && page.numberReturned !== page.features.length) issues.push({ code: 'NUMBER_RETURNED_MISMATCH', declared: page.numberReturned, received: page.features.length });
  const next = (page.links ?? []).filter(value => plain(value) && value.rel === 'next' && typeof value.href === 'string');
  if (next.length > 1) fail('USGS_MULTIPLE_NEXT_LINKS', 'The provider returned more than one next page.', 502);
  return {
    collection, url, sha256: hash(body), bytes: body.length, features: page.features, source: page,
    numberReturned: page.features.length,
    numberMatched: Number.isSafeInteger(page.numberMatched) && page.numberMatched >= 0 ? page.numberMatched : null,
    declaredNumberMatched: own(page, 'numberMatched') ? page.numberMatched : null,
    nextUrl: next[0]?.href ?? null, timeStamp: page.timeStamp ?? null, issues
  };
}

const RESPONSE_HEADERS = new Set(['content-type', 'content-length', 'content-encoding', 'content-language', 'content-crs', 'date', 'etag', 'last-modified', 'cache-control', 'age', 'retry-after', 'api-version', 'x-build-version', 'x-api-umbrella-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']);
function responseHeaders(headers = {}) {
  const entries = typeof headers.entries === 'function' ? [...headers.entries()] : Object.entries(headers);
  return Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)]).filter(([key]) => RESPONSE_HEADERS.has(key)));
}
function retryTime(headers, receivedAt) {
  const value = headers['retry-after'];
  if (value === undefined) return null;
  const result = /^\d+$/.test(value) ? Date.parse(receivedAt) + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(result) && result >= 0 && result <= 8640000000000000 ? new Date(result).toISOString() : null;
}

/** Original SF31 HTTPS transport supports Node 22 and the selected host proxy. */
export function createUsgsTransport({ apiKeyEnv, environment = process.env, proxyEnvironment = process.env, proxyEnv = 'HTTPS_PROXY', timeoutMs = 60000, maxPageBytes = MAX_PAGE_BYTES } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(maxPageBytes) || maxPageBytes < 1 || maxPageBytes > MAX_PAGE_BYTES) fail('USGS_TRANSPORT', 'Use a positive timeout up to 300000ms and a response byte limit up to 64 MiB.');
  if (apiKeyEnv !== undefined && (typeof apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))) fail('USGS_API_KEY_ENV', 'Choose an environment-variable name for the optional provider key.');
  const key = apiKeyEnv ? environment[apiKeyEnv] : undefined;
  if (apiKeyEnv && !key) fail('USGS_API_KEY_MISSING', 'The selected provider key environment variable is empty.');
  if (key && (typeof key !== 'string' || /[\u0000-\u0020\u007f]/.test(key))) fail('USGS_API_KEY_ENV', 'The selected provider credential is invalid.');
  if (proxyEnv !== null && (typeof proxyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(proxyEnv))) fail('USGS_PROXY_ENV', 'Choose an environment-variable name for the host proxy.');
  const proxyUrl = proxyEnv === null ? undefined : proxyEnvironment?.[proxyEnv];
  const fetchSource = createPublicHttpsFetch({
    timeoutMs,
    trustedProxy: proxyUrl ? { mode: 'explicit-connect', origin: USGS_ORIGIN, proxyUrl } : null
  });
  let closed = false;
  const pending = new Set(), controllers = new Set();
  function request(url, { signal } = {}) {
    if (closed) return Promise.reject(Object.assign(new Error('The source transport is closed.'), { code: 'USGS_TRANSPORT_CLOSED' }));
    const work = (async () => {
      const selected = new URL(url), collection = selected.pathname.split('/')[4];
      approvedUrl(url, collection);
      const controller = new AbortController();
      const stop = () => controller.abort(signal.reason);
      if (signal?.aborted) controller.abort(signal.reason);
      else signal?.addEventListener('abort', stop, { once: true });
      controllers.add(controller);
      let reader;
      try {
        const response = await fetchSource(selected.href, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { accept: 'application/geo+json, application/json', 'user-agent': 'Starforge-USGS-Water/1', ...(key ? { 'X-Api-Key': key } : {}) }
        });
        const chunks = []; let size = 0;
        if (response.body) {
          reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxPageBytes) fail('USGS_PAGE_BYTES', 'The original response exceeds the configured page byte limit.', 502);
            chunks.push(Buffer.from(value));
          }
        }
        return { status: response.status, headers: responseHeaders(response.headers), body: Buffer.concat(chunks), url: response.url, receivedAt: now() };
      } catch (error) {
        controller.abort(error);
        await reader?.cancel().catch(() => {});
        throw error;
      } finally {
        reader?.releaseLock(); signal?.removeEventListener('abort', stop); controllers.delete(controller);
      }
    })();
    pending.add(work); work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return {
    request,
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort(Object.assign(new Error('The source transport closed.'), { code: 'USGS_TRANSPORT_CLOSED' }));
      await Promise.allSettled([...pending]);
    }
  };
}
async function rawFile(path, maxBytes = MAX_PAGE_BYTES) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > maxBytes) fail('USGS_RETAINED_FILE', 'A retained source member is not a private regular file.', 409);
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) fail('USGS_RETAINED_FILE', 'A retained source member exceeds its declared size.', 409);
    return bytes;
  } finally { await file.close(); }
}
function memberPath(root, relative) {
  if (typeof relative !== 'string' || isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) fail('USGS_MEMBER_PATH', 'The retained source member path is invalid.', 409);
  const path = resolve(root, relative);
  if (!path.startsWith(root + '/')) fail('USGS_MEMBER_PATH', 'The retained member left its capture.', 409);
  return path;
}
async function immutableBytes(root, relative, bytes) {
  const target = memberPath(root, relative), directory = resolve(target, '..');
  const temporary = join(directory, '.body-' + randomUUID());
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await rawFile(target, bytes.length);
      if (!existing.equals(bytes)) fail('USGS_SOURCE_CHANGED', 'A retained original member contains different bytes.', 409);
    }
    await unlink(temporary);
    const folder = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
const manifestHash = state => { const { captureSha256, directory, ...body } = state; return hash(canonicalJson(body)); };
async function saveState(root, state) {
  state.updatedAt = now(); state.captureSha256 = manifestHash(state);
  await atomicJson(root, 'capture.json', state);
}
function attachDirectory(root, state) { return { ...state, directory: root }; }
function validateState(state) {
  if (!plain(state) || state.schema !== CAPTURE_SCHEMA || operationId(state.operationId) !== state.operationId || !Array.isArray(state.streams) || !Array.isArray(state.pages) || !Array.isArray(state.attempts) || !Array.isArray(state.failures) ||
      selectionHash(normalizeSelection(state.selection)) !== state.selectionSha256 || manifestHash(state) !== state.captureSha256) fail('USGS_CAPTURE_CHANGED', 'The retained capture manifest is inconsistent.', 409);
  const queries = buildQueries(state.selection);
  if (queries.length !== state.streams.length || queries.some((query, index) => query.id !== state.streams[index].id || query.url !== state.streams[index].queryUrl)) fail('USGS_CAPTURE_CHANGED', 'The retained request streams changed.', 409);
  return state;
}
async function existingState(root) {
  try { return validateState(await readPrivateJson(join(root, 'capture.json'), META_BYTES)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function safeFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_]+$/.test(error.code) ? error.code : 'USGS_SOURCE_ERROR';
  const message = code === 'ABORT_ERR' ? 'The source acquisition was cancelled.' :
    code.startsWith('USGS_') ? String(error?.message ?? 'The original source request failed.').slice(0, 400) :
    'The original source request failed (' + code + ').';
  return { code, message };
}
async function notifyProgress(observer, state, root) {
  if (typeof observer === 'function') {
    try { await observer(attachDirectory(root, structuredClone(state))); } catch {}
  }
}
async function verifyPage(root, page, selection) {
  const bytes = await rawFile(memberPath(root, page.bodyFile));
  if (bytes.length !== page.bytes || hash(bytes) !== page.sha256) fail('USGS_PAGE_CHANGED', 'The retained source bytes do not match their original digest.', 409);
  const recordBytes = await rawFile(memberPath(root, page.recordFile), META_BYTES);
  if (page.recordSha256 && hash(recordBytes) !== page.recordSha256) fail('USGS_RECORD_CHANGED', 'The retained response record changed.', 409);
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(recordBytes));
  if (record.bodyFile !== page.bodyFile || record.sha256 !== page.sha256 || record.bytes !== page.bytes || record.url !== page.url || record.status !== page.status) fail('USGS_RECORD_CHANGED', 'The retained page and response record disagree.', 409);
  return decodePage(bytes, { collection: selection.collection, url: page.url });
}

export async function readCapture(directory, selectedOperationId) {
  const root = selectedOperationId === undefined ? resolve(directory) : join(resolve(directory), operationId(selectedOperationId));
  const state = await existingState(root);
  if (!state) fail('USGS_CAPTURE_NOT_FOUND', 'The selected source capture does not exist.', 404);
  for (const page of state.pages) await verifyPage(root, page, state.selection);
  return attachDirectory(root, state);
}
function valueState(properties) {
  if (!own(properties, 'value')) return 'absent';
  if (properties.value === null) return 'null';
  if (properties.value === '') return 'empty';
  if (typeof properties.value !== 'string') return 'type-changed';
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(properties.value) ? 'decimal' : 'text';
}
const ROW_FIELDS = ['monitoring_location_id', 'time_series_id', 'parameter_code', 'statistic_id', 'time', 'value', 'unit_of_measure', 'approval_status', 'qualifier', 'last_modified', 'method_category', 'monitoring_location_name', 'state_code', 'county_code', 'site_type', 'parameter_name', 'parameter_description', 'begin', 'end', 'computation_period_identifier', 'computation_identifier', 'primary', 'data_gap_interval', 'parent_time_series_id'];
export async function captureRows(capture, { exactUnique = false } = {}) {
  if (!capture || typeof capture.directory !== 'string') fail('USGS_CAPTURE', 'Open a retained capture before reading its rows.');
  const state = validateState(capture), rows = [], seen = new Map();
  for (const page of state.pages) {
    const decoded = await verifyPage(state.directory, page, state.selection);
    for (let index = 0; index < decoded.features.length; index++) {
      const feature = decoded.features[index], properties = feature.properties, identity = canonicalJson(feature.id ?? feature), digest = hash(canonicalJson(feature));
      const previous = seen.get(identity), duplicate = previous !== undefined, conflicting = duplicate && previous.first !== digest;
      const sameVersion = previous?.versions.has(digest) ?? false;
      if (!duplicate) seen.set(identity, { first: digest, versions: new Set([digest]) });
      else previous.versions.add(digest);
      if (exactUnique && sameVersion) continue;
      const row = Object.fromEntries(ROW_FIELDS.map(field => [field, own(properties, field) ? properties[field] : null]));
      if (state.selection.collection === 'monitoring-locations') row.monitoring_location_id = properties.id ?? feature.id ?? null;
      if (state.selection.collection === 'time-series-metadata') row.time_series_id = properties.id ?? feature.id ?? null;
      rows.push({
        ...row, feature_id: feature.id ?? null, collection: state.selection.collection,
        value_state: valueState(properties), properties, geometry: feature.geometry ?? null,
        source_url: page.url, source_sha256: page.sha256, source_stream: page.streamId, source_page: page.index, source_index: index,
        duplicate, conflicting_duplicate: conflicting
      });
    }
  }
  return rows;
}
async function summarize(root, state) {
  const rows = await captureRows(attachDirectory(root, { ...state, captureSha256: manifestHash(state) }));
  const values = rows.filter(row => OBSERVATIONS.has(row.collection));
  const counts = field => Object.fromEntries([...new Set(values.map(row => row[field] === null ? '(missing)' : String(row[field])))].sort().map(key => [key, values.filter(row => (row[field] === null ? '(missing)' : String(row[field])) === key).length]));
  return {
    pageCount: state.pages.length, featureCount: rows.length, uniqueFeatureCount: rows.filter(row => !row.duplicate).length,
    duplicateFeatureCount: rows.filter(row => row.duplicate).length, conflictingFeatureCount: rows.filter(row => row.conflicting_duplicate).length,
    retainedBytes: state.pages.reduce((total, page) => total + page.bytes, 0),
    approvalCounts: counts('approval_status'), valueStates: counts('value_state'),
    units: [...new Set(values.map(row => row.unit_of_measure))],
    timeSeriesIds: [...new Set(rows.map(row => row.time_series_id).filter(value => value !== null))],
    advertisedCounts: state.streams.map(stream => ({ streamId: stream.id, numberMatched: stream.numberMatched ?? null })),
    collection: state.selection.collection
  };
}
async function responseRecord(root, request, response) {
  const bytes = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? '');
  const receivedAt = response.receivedAt ?? now(), digest = hash(bytes), bodyFile = 'bodies/' + digest + '.json';
  const record = {
    schema: 'starforge.usgs-water-response.v1', requestId: request.requestId, streamId: request.streamId, index: request.index,
    url: request.url, status: response.status ?? null, receivedAt, headers: responseHeaders(response.headers),
    bytes: bytes.length, sha256: digest, bodyFile, error: response.error ?? null
  };
  // Record the observed HTTP outcome and expected byte identity before copying
  // its body. Recovery can distinguish a missing body from a network failure.
  await atomicJson(join(root, 'responses'), request.requestId + '.json', record, { exclusive: true });
  await immutableBytes(root, bodyFile, bytes);
  return record;
}
async function adoptResponse(root, state, request, response) {
  const stream = state.streams.find(value => value.id === request.streamId);
  if (!stream || request.index !== stream.pageCount || request.url !== stream.nextUrl) fail('USGS_CAPTURE_CHANGED', 'The retained response belongs to a different original page.', 409);
  const recordFile = 'responses/' + request.requestId + '.json';
  const recordBytes = await rawFile(memberPath(root, recordFile), META_BYTES);
  const attempt = { requestId: request.requestId, requestFile: request.requestFile, recordFile, recordSha256: hash(recordBytes), streamId: stream.id, index: request.index, url: request.url, status: response.status, receivedAt: response.receivedAt, bodyFile: response.bodyFile, sha256: response.sha256, bytes: response.bytes };
  let body;
  try {
    body = await rawFile(memberPath(root, response.bodyFile));
    if (body.length !== response.bytes || hash(body) !== response.sha256) fail('USGS_PAGE_CHANGED', 'The retained original response body changed.', 409);
    attempt.bodyRetained = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    attempt.expectedBodyFile = attempt.bodyFile; attempt.bodyFile = null; attempt.bodyRetained = false;
    const failure = { requestId: request.requestId, streamId: stream.id, index: request.index, url: request.url, status: response.status, receivedAt: response.receivedAt, retryAt: null,
      code: 'USGS_RESPONSE_BYTES_UNAVAILABLE', message: 'The observed source response was interrupted before its original body was retained.', expectedSha256: response.sha256, expectedBytes: response.bytes };
    state.attempts.push(attempt); state.inflight = null; state.failures.push(failure); stream.status = 'PARTIAL'; stream.lastFailure = failure;
    await saveState(root, state); return false;
  }
  if (!state.attempts.some(value => value.requestId === request.requestId)) state.attempts.push(attempt);
  state.inflight = null;
  if (response.status !== 200 || response.error) {
    const retryAt = retryTime(response.headers, response.receivedAt) ?? (response.status === 429 ? new Date(Date.parse(response.receivedAt) + 60000).toISOString() : null);
    const failure = { requestId: request.requestId, streamId: stream.id, index: request.index, url: request.url, status: response.status, receivedAt: response.receivedAt, retryAt,
      ...(response.error ?? { code: 'USGS_HTTP_' + response.status, message: 'The source returned HTTP ' + response.status + '.' }) };
    state.failures.push(failure); stream.status = 'PARTIAL'; stream.retryAt = retryAt; stream.lastFailure = failure;
    await saveState(root, state); return false;
  }
  let decoded, following;
  try {
    decoded = decodePage(body, { collection: state.selection.collection, url: request.url });
    following = nextLink(decoded.nextUrl, request.url, stream.queryUrl, state.selection.collection);
    if (following && state.pages.some(page => page.streamId === stream.id && page.url === following)) fail('USGS_PAGE_LOOP', 'The provider next link repeats a retained page.', 502);
  } catch (error) {
    const failure = { requestId: request.requestId, streamId: stream.id, index: request.index, url: request.url, status: response.status, receivedAt: response.receivedAt, retryAt: null, ...safeFailure(error) };
    state.failures.push(failure); stream.status = 'PARTIAL'; stream.lastFailure = failure;
    await saveState(root, state); return false;
  }
  state.pages.push({ ...attempt, numberReturned: decoded.numberReturned, numberMatched: decoded.numberMatched, declaredNumberMatched: decoded.declaredNumberMatched,
    nextUrl: following, timeStamp: decoded.timeStamp, issues: decoded.issues, headers: response.headers });
  stream.pageCount++; stream.nextUrl = following; stream.status = following ? 'PENDING' : 'COMPLETE'; stream.retryAt = null; stream.lastFailure = null;
  if (decoded.numberMatched !== null) {
    if (stream.numberMatched !== null && stream.numberMatched !== undefined && stream.numberMatched !== decoded.numberMatched) state.issues.push({ code: 'SOURCE_MATCHED_COUNT_CHANGED', streamId: stream.id, before: stream.numberMatched, after: decoded.numberMatched });
    stream.numberMatched = decoded.numberMatched;
  }
  if (decoded.issues.length) state.issues.push(...decoded.issues.map(issue => ({ ...issue, streamId: stream.id, index: request.index })));
  await saveState(root, state);
  return true;
}

/** Explicitly repeating a partial operation resumes its original next page. A
 * complete operation is reopened without dispatch, even after moving the tree. */
export async function captureSelection({ directory, operationId: selectedId, selection: input, transport, signal, onProgress, apiKeyEnv, environment, env, proxyEnvironment, proxyEnv } = {}) {
  const id = operationId(selectedId), selection = normalizeSelection(input), selectionSha256 = selectionHash(selection);
  const parent = await privateDirectory(resolve(directory)), root = await privateDirectory(join(parent, id));
  for (const name of ['bodies', 'requests', 'responses']) await privateDirectory(join(root, name));
  return await withPrivateLock(root, 'capture.lock', async () => {
    let state = await existingState(root);
    if (state && (state.operationId !== id || state.selectionSha256 !== selectionSha256)) fail('USGS_OPERATION_CONFLICT', 'This operation already belongs to a different source selection.', 409);
    if (state?.status === 'COMPLETE') return readCapture(root);
    if (!state) {
      state = { schema: CAPTURE_SCHEMA, operationId: id, selection, selectionSha256, status: 'PARTIAL', startedAt: now(), updatedAt: null, completedAt: null,
        streams: buildQueries(selection).map(query => ({ id: query.id, queryUrl: query.url, nextUrl: query.url, pageCount: 0, numberMatched: null, status: 'PENDING', retryAt: null, lastFailure: null })),
        pages: [], attempts: [], failures: [], issues: [], inflight: null, summary: null, captureSha256: null };
      await saveState(root, state);
    }
    for (const page of state.pages) await verifyPage(root, page, selection);
    if (state.inflight) {
      const prior = state.inflight;
      let response;
      try { response = await readPrivateJson(memberPath(root, prior.recordFile), META_BYTES); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        response = await responseRecord(root, prior, { status: null, body: Buffer.alloc(0), headers: {}, error: { code: 'USGS_INTERRUPTED_REQUEST', message: 'The prior request ended without a retained response.' } });
      }
      await adoptResponse(root, state, prior, response);
    }
    let ownedTransport;
    const source = transport ?? (ownedTransport = createUsgsTransport({ apiKeyEnv, environment: environment ?? env, proxyEnvironment: proxyEnvironment ?? environment ?? env, proxyEnv }));
    const requestSource = typeof source === 'function' ? source : source?.request?.bind(source);
    if (!requestSource) fail('USGS_TRANSPORT', 'Provide a source request function or transport with request().');
    try {
      let stopped = false;
      for (const stream of state.streams) {
        if (stream.status === 'COMPLETE') continue;
        if (stream.retryAt && Date.parse(stream.retryAt) > Date.now()) { stopped = true; break; }
        while (stream.nextUrl) {
          if (signal?.aborted) { stopped = true; break; }
          const requestId = 'request-' + randomUUID();
          const request = { schema: 'starforge.usgs-water-request.v1', requestId, streamId: stream.id, index: stream.pageCount, url: stream.nextUrl,
            startedAt: now(), method: 'GET', selectionSha256, requestFile: 'requests/' + requestId + '.json', recordFile: 'responses/' + requestId + '.json' };
          await atomicJson(join(root, 'requests'), requestId + '.json', request, { exclusive: true });
          state.inflight = request; stream.status = 'ACTIVE'; await saveState(root, state);
          let received;
          try {
            received = await requestSource(request.url, { signal, collection: selection.collection });
            if (!received || !Number.isInteger(received.status)) fail('USGS_TRANSPORT_RESULT', 'The source transport returned no original HTTP status.', 502);
            if (received.url && received.url !== request.url) fail('USGS_REDIRECT', 'The source transport changed the request URL.', 502);
          } catch (error) {
            received = { status: null, body: Buffer.alloc(0), headers: {}, error: safeFailure(error) };
          }
          // Filesystem failure leaves the original inflight request intact. In
          // particular, it cannot replace received HTTP200 bytes with an empty
          // network-error result. A retained response is adopted on reopening.
          const response = await responseRecord(root, request, received);
          if (!await adoptResponse(root, state, request, response)) { stopped = true; break; }
          await notifyProgress(onProgress, state, root);
        }
        if (stopped) break;
      }
      state.summary = await summarize(root, state);
      if (state.streams.every(stream => stream.status === 'COMPLETE') && state.issues.length === 0 && state.summary.conflictingFeatureCount === 0) {
        state.status = 'COMPLETE'; state.completedAt = state.completedAt ?? now();
      } else state.status = 'PARTIAL';
      if (signal?.aborted) state.lastInterruption = { code: 'USGS_CANCELLED', at: now() };
      await saveState(root, state);
      await notifyProgress(onProgress, state, root);
      return attachDirectory(root, state);
    } finally { await ownedTransport?.close(); }
  });
}

/** Complete portable source closure, including failed/interrupted request history. */
export async function retainedFiles(capture) {
  const state = validateState(capture), names = new Set(['capture.json']);
  for (const attempt of state.attempts) for (const key of ['requestFile', 'recordFile', 'bodyFile']) if (attempt[key]) names.add(attempt[key]);
  for (const page of state.pages) for (const key of ['requestFile', 'recordFile', 'bodyFile']) if (page[key]) names.add(page[key]);
  if (state.inflight) names.add(state.inflight.requestFile);
  const files = [];
  for (const path of [...names].sort()) {
    const bytes = await rawFile(memberPath(state.directory, path), path === 'capture.json' ? META_BYTES : MAX_PAGE_BYTES);
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  return files;
}
