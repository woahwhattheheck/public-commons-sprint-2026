// MIT. Original WQX 3.0 CSV acquisition, retained request/status records and portable captures.
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';

export const WQX_ORIGIN = 'https://waterqualitydata.us';
export const WQX_API = WQX_ORIGIN + '/wqx3';
export const CAPTURE_SCHEMA = 'starforge.wqx-water-quality-capture.v1';
export const PROFILES = Object.freeze(['Station', 'Activity', 'Result', 'ResultDetectionQuantitationLimit']);
export const DEFAULT_PROFILES = Object.freeze(['Station', 'Activity', 'Result']);
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const META_BYTES = 32 * 1024 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const ordered = value => Array.isArray(value) ? value.map(ordered) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const canonicalJson = value => JSON.stringify(ordered(value));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
function fail(code, message, status = 400, detail) { throw Object.assign(new Error(message), { code, status, ...(detail === undefined ? {} : { detail }) }); }
function stableId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) fail('WQX_OPERATION_ID', 'Use a stable operation ID with letters, digits, underscores or hyphens.');
  return value;
}
function selectedText(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) fail('WQX_SELECTION', 'Invalid ' + label + '. Preserve native identifier and code strings.');
  return value;
}
function calendar(value) {
  if (typeof value !== 'string') fail('WQX_DATE', 'Use an actual calendar date in MM-DD-YYYY or YYYY-MM-DD form.');
  let match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value), year, month, day;
  if (match) [, month, day, year] = match;
  else { match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (match) [, year, month, day] = match; }
  if (!match) fail('WQX_DATE', 'Use an actual calendar date in MM-DD-YYYY or YYYY-MM-DD form.');
  year = Number(year); month = Number(month); day = Number(day);
  const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year, month - 1, day);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail('WQX_DATE', 'The selected date does not exist.');
  return date;
}
const mmddyyyy = date => String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0') + '-' + String(date.getUTCFullYear()).padStart(4, '0');
const SINGLE_FILTERS = new Set(['startDateLo', 'startDateHi', 'lat', 'long', 'within', 'bBox', 'minresults', 'minactivities']);
const MULTI_FILTERS = new Set(['countrycode', 'statecode', 'countycode', 'siteType', 'organization', 'siteid', 'huc', 'sampleMedia', 'characteristicType', 'characteristicName', 'pCode', 'providers', 'activityId', 'project', 'assemblage', 'subjectTaxonomicName']);

/** WQX3 multi-valued query fields repeat their parameter; values are never semicolon-joined. */
export function normalizeSelection(input) {
  if (!plain(input) || !plain(input.filters)) fail('WQX_SELECTION', 'Provide a filters object using original WQX3 query parameter names.');
  for (const name of Object.keys(input)) if (!['filters', 'profiles', 'partition'].includes(name)) fail('WQX_SELECTION', 'Unknown selection field: ' + name);
  const filters = {};
  for (const name of Object.keys(input.filters).sort()) {
    const raw = input.filters[name];
    if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
    if (SINGLE_FILTERS.has(name)) {
      const value = selectedText(typeof raw === 'number' && ['lat', 'long', 'within', 'minresults', 'minactivities'].includes(name) ? String(raw) : raw, name);
      filters[name] = name.startsWith('startDate') ? mmddyyyy(calendar(value)) : value;
    } else if (MULTI_FILTERS.has(name)) {
      const values = Array.isArray(raw) ? raw : [raw];
      filters[name] = [...new Set(values.map(value => selectedText(value, name)))].sort();
      if (name === 'pCode' && filters[name].some(value => !/^\d{5}$/.test(value))) fail('WQX_PARAMETER_CODE', 'USGS parameter codes contain exactly five digits.');
      if (name === 'providers' && filters[name].some(value => !['NWIS', 'STORET'].includes(value))) fail('WQX_PROVIDER', 'Select native NWIS and/or STORET provider codes.');
    } else fail('WQX_FILTER', 'This native WQX3 query field is not supported: ' + name);
  }
  if (!Object.keys(filters).some(name => name !== 'providers')) fail('WQX_SELECTION', 'Choose at least one native location, sample, characteristic or date filter.');
  for (const name of ['lat', 'long', 'within']) if (own(filters, name) && (!Number.isFinite(Number(filters[name])) || !filters[name].trim())) fail('WQX_GEOGRAPHY', 'Use finite decimal coordinates and distance.');
  if (['lat', 'long', 'within'].some(name => own(filters, name)) && !['lat', 'long', 'within'].every(name => own(filters, name))) fail('WQX_GEOGRAPHY', 'Radial selection requires lat, long and within together.');
  if (own(filters, 'lat') && (Math.abs(Number(filters.lat)) > 90 || Math.abs(Number(filters.long)) > 180 || Number(filters.within) <= 0)) fail('WQX_GEOGRAPHY', 'Use valid latitude, longitude and a positive radial distance in miles.');
  if (own(filters, 'bBox')) {
    const values = filters.bBox.split(',').map(Number);
    if (values.length !== 4 || values.some(value => !Number.isFinite(value)) || Math.abs(values[0]) > 180 || Math.abs(values[2]) > 180 || Math.abs(values[1]) > 90 || Math.abs(values[3]) > 90 || values[0] > values[2] || values[1] > values[3]) fail('WQX_GEOGRAPHY', 'bBox is west,south,east,north in decimal degrees.');
  }
  for (const name of ['minresults', 'minactivities']) if (own(filters, name) && !/^\d+$/.test(filters[name])) fail('WQX_SELECTION', name + ' must be a whole-number string.');
  if (filters.startDateLo && filters.startDateHi && calendar(filters.startDateLo) > calendar(filters.startDateHi)) fail('WQX_DATE', 'The ending activity date precedes the starting date.');
  const selected = input.profiles ?? DEFAULT_PROFILES;
  if (!Array.isArray(selected) || !selected.length || selected.some(profile => !PROFILES.includes(profile))) fail('WQX_PROFILE', 'Choose original Station, Activity, Result or ResultDetectionQuantitationLimit profiles.');
  const profiles = PROFILES.filter(profile => selected.includes(profile)), partition = input.partition ?? 'none';
  if (!['none', 'month', 'year'].includes(partition)) fail('WQX_PARTITION', 'Choose none, month or year for date partitions.');
  if (partition !== 'none' && (!filters.startDateLo || !filters.startDateHi)) fail('WQX_PARTITION', 'Date partitions require both starting and ending activity dates.');
  return { filters, profiles, partition };
}
function windows(selection) {
  const filters = selection.filters;
  if (selection.partition === 'none') return [null];
  const end = calendar(filters.startDateHi), result = [];
  let start = calendar(filters.startDateLo);
  while (start <= end) {
    const next = new Date(start);
    if (selection.partition === 'month') { next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1); }
    else { next.setUTCMonth(0, 1); next.setUTCFullYear(next.getUTCFullYear() + 1); }
    const last = new Date(Math.min(end.getTime(), next.getTime() - 86400000));
    result.push({ startDateLo: mmddyyyy(start), startDateHi: mmddyyyy(last) });
    start = next;
  }
  return result;
}
export function buildQueries(input) {
  const selection = normalizeSelection(input), queries = [];
  for (const window of windows(selection)) for (const profile of selection.profiles) {
    const url = new URL(WQX_API + '/' + profile + '/search'), filters = { ...selection.filters, ...(window ?? {}) };
    for (const name of Object.keys(filters).sort()) for (const value of Array.isArray(filters[name]) ? filters[name] : [filters[name]]) url.searchParams.append(name, value);
    url.searchParams.set('mimeType', 'csv');
    if (profile === 'Result') url.searchParams.set('dataProfile', 'fullPhysChem');
    queries.push({ id: profile.toLowerCase() + '-' + sha256(url.href).slice(0, 20), profile, url: url.href, window, dataProfile: profile === 'Result' ? 'fullPhysChem' : null });
  }
  return queries;
}
function approvedUrl(value) {
  let url; try { url = new URL(value); } catch { fail('WQX_SOURCE_URL', 'Invalid original WQX3 URL.'); }
  const profile = /^\/wqx3\/([^/]+)\/search$/.exec(url.pathname);
  const status = /^\/wqx3\/status\/[0-9a-f-]{16,64}$/i.test(url.pathname);
  if (url.origin !== WQX_ORIGIN || url.username || url.password || url.hash || !(profile && PROFILES.includes(profile[1]) || status)) fail('WQX_SOURCE_URL', 'Source requests must remain on the selected original WQX3 service.');
  return url;
}
function responseHeaders(input = {}) {
  const entries = typeof input.entries === 'function' ? [...input.entries()] : Object.entries(input);
  return Object.fromEntries(entries.filter(([name]) => !['set-cookie', 'authorization', 'proxy-authorization'].includes(name.toLowerCase())).map(([name, value]) => [name.toLowerCase(), String(value)]));
}

/** The existing SF31 transport supplies public DNS admission and explicit host-proxy support. */
export function createWqxTransport({ environment = process.env, proxyEnvironment = environment, proxyEnv = 'HTTPS_PROXY', timeoutMs = 120000, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) fail('WQX_TRANSPORT', 'Use a positive timeout up to 300000ms and response limit up to 64 MiB.');
  if (proxyEnv !== null && (typeof proxyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(proxyEnv))) fail('WQX_PROXY_ENV', 'Select an environment-variable name for the host proxy.');
  const proxyUrl = proxyEnv === null ? undefined : proxyEnvironment?.[proxyEnv];
  const fetchSource = createPublicHttpsFetch({ timeoutMs, trustedProxy: proxyUrl ? { mode: 'explicit-connect', origin: WQX_ORIGIN, proxyUrl } : null });
  let closed = false;
  const controllers = new Set(), pending = new Set();
  function request(url, { signal } = {}) {
    if (closed) return Promise.reject(Object.assign(new Error('The source transport is closed.'), { code: 'WQX_TRANSPORT_CLOSED' }));
    const work = (async () => {
      approvedUrl(url);
      const controller = new AbortController(), stop = () => controller.abort(signal.reason);
      if (signal?.aborted) controller.abort(signal.reason); else signal?.addEventListener('abort', stop, { once: true });
      controllers.add(controller);
      let reader;
      try {
        const response = await fetchSource(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'text/csv, application/json, text/plain', 'user-agent': 'Starforge-WQX-Water-Quality/1' } });
        let size = 0; const chunks = [];
        if (response.body) {
          reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > maxResponseBytes) fail('WQX_RESPONSE_BYTES', 'The original response exceeded the selected byte limit; use native date partitions for the acquisition.', 502);
            chunks.push(Buffer.from(value));
          }
        }
        return { status: response.status, headers: responseHeaders(response.headers), body: Buffer.concat(chunks), url: response.url || url, receivedAt: now() };
      } catch (error) { controller.abort(error); await reader?.cancel().catch(() => {}); throw error; }
      finally { reader?.releaseLock(); signal?.removeEventListener('abort', stop); controllers.delete(controller); }
    })();
    pending.add(work); work.finally(() => pending.delete(work)).catch(() => {}); return work;
  }
  return { request, async close() { closed = true; for (const controller of controllers) controller.abort(new Error('Source transport closed.')); await Promise.allSettled([...pending]); } };
}

/** RFC 4180 records with original field strings, physical lines and embedded line endings. */
export function decodeProfile(bytes, { profile, status = 200, maxRows = 1000000 } = {}) {
  if (!PROFILES.includes(profile)) fail('WQX_PROFILE', 'An original WQX3 profile is required.');
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length > MAX_RESPONSE_BYTES) fail('WQX_RESPONSE_BYTES', 'The retained CSV exceeds 64 MiB.', 502);
  if (status === 204 && body.length === 0) return { profile, columns: [], records: [], rowCount: 0, sha256: sha256(body), bytes: 0 };
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { fail('WQX_CSV_UTF8', 'The original CSV is not valid UTF-8.', 502); }
  const rows = [];
  let cells = [], state = 'start', segmentStart = 0, quotedEnd = 0, chunks = null, committedLength = 0, line = 1, lineStart = 1, touched = false;
  function resetField(start) { state = 'start'; segmentStart = start; quotedEnd = start; chunks = null; committedLength = 0; }
  function finishField(end) {
    const tail = text.slice(segmentStart, state === 'closed' ? quotedEnd : end);
    if (committedLength + tail.length > 4 * 1024 * 1024) fail('WQX_CSV_FIELD', 'The CSV field exceeds supported source dimensions.', 502);
    if (chunks) { chunks.push(tail); cells.push(chunks.join('')); } else cells.push(tail);
    if (cells.length > 512) fail('WQX_CSV_FIELD', 'The CSV column count exceeds supported source dimensions.', 502);
  }
  function emit(end, nextStart) {
    finishField(end);
    if (!(cells.length === 1 && cells[0] === '' && !touched)) rows.push({ cells, lineStart, lineEnd: line });
    if (rows.length > maxRows + 1) fail('WQX_CSV_ROWS', 'The response exceeds the selected CSV record limit.', 502);
    cells = []; touched = false; resetField(nextStart);
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i], newline = char === '\r' || char === '\n';
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') {
          chunks ??= []; chunks.push(text.slice(segmentStart, i), '"');
          committedLength += i - segmentStart + 1; i++; segmentStart = i + 1;
        } else { quotedEnd = i; state = 'closed'; }
      } else if (newline) { if (char === '\r' && text[i + 1] === '\n') i++; line++; }
    } else if (newline) {
      const end = i; if (char === '\r' && text[i + 1] === '\n') i++;
      emit(end, i + 1); line++; lineStart = line;
    } else if (char === ',') { finishField(i); resetField(i + 1); touched = true; }
    else if (state === 'closed') fail('WQX_CSV_QUOTE', 'A quoted CSV field has unexpected trailing content.', 502, { line });
    else if (char === '"') { if (state !== 'start') fail('WQX_CSV_QUOTE', 'A CSV quote appears inside an unquoted field.', 502, { line }); state = 'quoted'; segmentStart = i + 1; touched = true; }
    else { state = 'unquoted'; touched = true; }
    const end = state === 'closed' ? quotedEnd : i + 1;
    if (committedLength + Math.max(0, end - segmentStart) > 4 * 1024 * 1024) fail('WQX_CSV_FIELD', 'The CSV field exceeds supported source dimensions.', 502);
  }
  if (state === 'quoted') fail('WQX_CSV_TRUNCATED', 'The retained CSV ends inside a quoted record.', 502, { line });
  if (touched || cells.length || state === 'closed') emit(text.length, text.length);
  if (!rows.length) fail('WQX_CSV_HEADER', 'The response contains no WQX3 CSV header.', 502);
  const columns = rows.shift().cells;
  if (columns.some(name => !name || name.includes('\0')) || new Set(columns).size !== columns.length) fail('WQX_CSV_HEADER', 'The original CSV has empty or repeated column names.', 502);
  const required = ['Org_Identifier', ...(profile === 'Station' ? ['Location_Identifier'] : ['Activity_ActivityIdentifier']), ...(['Result', 'ResultDetectionQuantitationLimit'].includes(profile) ? ['Result_MeasureIdentifier'] : [])];
  if (profile === 'Result') required.push('Result_Characteristic', 'Result_Measure');
  if (profile === 'ResultDetectionQuantitationLimit') required.push('DetectionLimit_Type', 'DetectionLimit_Measure', 'DetectionLimit_MeasureUnit');
  if (required.some(name => !columns.includes(name))) fail('WQX_CSV_PROFILE', 'The original response does not have the selected WQX3 profile header.', 502, { profile, missing: required.filter(name => !columns.includes(name)) });
  const records = rows.map((row, index) => {
    if (row.cells.length !== columns.length) fail('WQX_CSV_COLUMNS', 'A retained CSV record has a different column count than its header.', 502, { index, lineStart: row.lineStart, expected: columns.length, actual: row.cells.length });
    return { record: Object.fromEntries(columns.map((name, i) => [name, row.cells[i]])), index, lineStart: row.lineStart, lineEnd: row.lineEnd };
  });
  return { profile, columns, records, rowCount: records.length, sha256: sha256(body), bytes: body.length };
}
export const valueState = value => value === null || value === undefined ? 'absent' : value === '' ? 'empty' : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value) ? 'decimal' : 'text';
function relativePath(root, member) {
  if (typeof member !== 'string' || isAbsolute(member) || member.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) fail('WQX_MEMBER_PATH', 'The retained source member path is invalid.', 409);
  const target = resolve(root, member);
  if (!target.startsWith(root + '/')) fail('WQX_MEMBER_PATH', 'The source member left its capture.', 409);
  return target;
}
async function readBytes(path, maximum = MAX_RESPONSE_BYTES) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > maximum) fail('WQX_RETAINED_MEMBER', 'A retained source member is not a private regular file of the expected size.', 409);
    const bytes = await handle.readFile();
    if (bytes.length > maximum) fail('WQX_RETAINED_MEMBER', 'A retained source member exceeds its limit.', 409);
    return bytes;
  } finally { await handle.close(); }
}
function manifestHash(state) { const { captureSha256, directory, ...value } = state; return sha256(canonicalJson(value)); }
function attached(state, directory) { return { ...state, directory }; }
async function putMember(state, directory, path, bytes, role, contentType, details = {}) {
  const target = relativePath(directory, path);
  await privateDirectory(resolve(target, '..'));
  const descriptor = { path, sha256: sha256(bytes), bytes: bytes.length, role, contentType, ...details };
  try { await writeBytes(target, bytes, { exclusive: true }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await readBytes(target, Math.max(MAX_RESPONSE_BYTES, META_BYTES)); if (existing.length !== bytes.length || sha256(existing) !== descriptor.sha256) fail('WQX_MEMBER_CHANGED', 'An immutable source member already has different bytes.', 409); }
  const previous = state.files.find(file => file.path === path);
  if (previous && canonicalJson(previous) !== canonicalJson(descriptor)) fail('WQX_MEMBER_CHANGED', 'An immutable source member descriptor changed.', 409);
  if (!previous) state.files.push(descriptor);
  return descriptor;
}
async function persist(state, directory) {
  state.updatedAt = now();
  state.summary = {
    selectedResources: state.resources.length,
    completeResources: state.resources.filter(row => row.status === 'COMPLETE').length,
    availableResources: state.resources.filter(row => row.dataAvailable).length,
    failedResources: state.resources.filter(row => row.status === 'ERROR').length,
    rowsByProfile: Object.fromEntries(PROFILES.map(profile => [profile, state.resources.filter(row => row.profile === profile && row.dataAvailable).reduce((sum, row) => sum + row.rowCount, 0)])),
    responseBytes: state.files.filter(row => row.role === 'source').reduce((sum, row) => sum + row.bytes, 0),
    metadataBytes: state.files.filter(row => row.role !== 'source').reduce((sum, row) => sum + row.bytes, 0),
    independentRequests: true
  };
  state.captureSha256 = manifestHash(state); await atomicJson(directory, 'capture.json', state);
}
function errorInfo(error) {
  return { code: typeof error?.code === 'string' ? error.code : 'WQX_REQUEST_FAILED', message: String(error?.message ?? error).slice(0, 1600), status: Number.isInteger(error?.status) ? error.status : null };
}
function retryAt(headers, receivedAt) {
  const value = headers['retry-after']; if (value === undefined) return null;
  const time = /^\d+$/.test(value) ? Date.parse(receivedAt) + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
async function retainedRequest({ state, directory, requestSource, url, profile, resourceId, ordinal, role, signal }) {
  const prefix = 'requests/' + resourceId + '-' + String(ordinal).padStart(4, '0') + (role === 'status' ? '-status' : '');
  const request = { schema: 'starforge.wqx-source-request.v1', method: 'GET', url, profile, resourceId, ordinal, requestedAt: now() };
  const requestFile = await putMember(state, directory, prefix + '.request.json', jsonBytes(request), 'request', 'application/json', { resourceId, profile });
  const receipt = { requestFile: requestFile.path, requestedAt: request.requestedAt, url, profile, role, status: 'REQUESTING' };
  state.attempts.push(receipt); await persist(state, directory);
  let received;
  try {
    received = await requestSource(url, { signal });
    if (!received || !Number.isInteger(received.status)) fail('WQX_TRANSPORT_RESULT', 'The source transport returned no original HTTP status.', 502);
    if (received.url && received.url !== url) fail('WQX_REDIRECT', 'The original source transport changed the selected URL.', 502);
    if (!Buffer.isBuffer(received.body) && !(received.body instanceof Uint8Array)) fail('WQX_TRANSPORT_BYTES', 'The source transport must return original response bytes.', 502);
    const body = Buffer.from(received.body);
    if (body.length > MAX_RESPONSE_BYTES) fail('WQX_RESPONSE_BYTES', 'The original response exceeds 64 MiB.', 502);
    const headers = responseHeaders(received.headers), receivedAt = typeof received.receivedAt === 'string' && Number.isFinite(Date.parse(received.receivedAt)) ? received.receivedAt : now();
    const digest = sha256(body), bodyFile = 'responses/' + resourceId + '-' + String(ordinal).padStart(4, '0') + (role === 'status' ? '-status' : '') + '-' + digest + (role === 'status' ? '.json' : '.csv');
    Object.assign(receipt, { httpStatus: received.status, receivedAt, headers, sha256: digest, bytes: body.length, expectedBodyFile: bodyFile, retryAt: retryAt(headers, receivedAt) });
    await putMember(state, directory, bodyFile, body, role, headers['content-type'] ?? (role === 'status' ? 'application/json' : 'text/csv'), { resourceId, profile });
    receipt.bodyFile = bodyFile;
    const record = { schema: 'starforge.wqx-source-response.v1', requestFile: requestFile.path, url, profile, resourceId, ordinal, status: received.status, headers, receivedAt, sha256: digest, bytes: body.length, bodyFile };
    const metadata = await putMember(state, directory, prefix + '.response.json', jsonBytes(record), 'response', 'application/json', { resourceId, profile });
    receipt.recordFile = metadata.path; receipt.status = 'RETAINED'; await persist(state, directory);
    return { receipt, body, record };
  } catch (error) { receipt.status = received ? 'RETENTION_OR_RESPONSE_ERROR' : 'REQUEST_ERROR'; receipt.error = errorInfo(error); await persist(state, directory); throw error; }
}
function statusSummary(body) {
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { return { parsed: false, issue: 'STATUS_NOT_JSON' }; }
  return { parsed: true, value };
}


/** Interpret the original WQX3 completion response without rewriting its values. */
export function assessProviderStatus(resource) {
  const receipt = resource?.providerReceipt, issues = [];
  const issue = (code, detail) => issues.push({ code, ...(detail === undefined ? {} : { detail }) });
  if (!receipt) return { status: 'UNAVAILABLE', reportedRows: null, issues: [{ code: 'PROVIDER_STATUS_NOT_RETAINED' }] };
  if (receipt.error || receipt.status !== 200 || !receipt.parsed || !plain(receipt.value)) {
    return { status: 'UNAVAILABLE', reportedRows: null, issues: [{ code: 'PROVIDER_STATUS_UNAVAILABLE', detail: receipt.error ?? { status: receipt.status, parsed: receipt.parsed ?? false } }] };
  }
  const value = receipt.value, providers = Array.isArray(value.dataProviders) ? value.dataProviders : null;
  const counter = value => Number.isSafeInteger(value) && value >= 0;
  if (typeof value.requestId === 'string' && value.requestId !== resource.requestId) issue('PROVIDER_STATUS_REQUEST_MISMATCH', { expected: resource.requestId, actual: value.requestId });
  for (const field of ['failed', 'canceled', 'clientDisconnect']) if (value[field] === true) issue('PROVIDER_STATUS_' + field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase());
  if (value.completedOk === false) issue('PROVIDER_STATUS_NOT_COMPLETE');
  for (const provider of [value.headerProvider, ...(providers ?? [])].filter(plain)) {
    if (provider.failed === true || provider.canceled === true || provider.completedOk === false) issue('PROVIDER_PART_NOT_COMPLETE', { name: provider.name ?? null, completedOk: provider.completedOk ?? null, failed: provider.failed ?? null, canceled: provider.canceled ?? null });
  }
  const reportedRows = providers && providers.every(provider => plain(provider) && counter(provider.outputRowCount)) ? providers.reduce((sum, provider) => sum + provider.outputRowCount, 0) : null;
  if (value.completedOk === true && reportedRows !== null && counter(reportedRows) && reportedRows !== resource.rowCount) issue('PROVIDER_ROW_COUNT_MISMATCH', { parsedRows: resource.rowCount, reportedRows });
  const headerRows = plain(value.headerProvider) && counter(value.headerProvider.outputRowCount) ? value.headerProvider.outputRowCount : null;
  if (value.completedOk === true && reportedRows !== null && headerRows !== null && counter(value.totalRowsSent) && value.totalRowsSent !== reportedRows + headerRows) issue('PROVIDER_SENT_COUNT_MISMATCH', { totalRowsSent: value.totalRowsSent, reportedRows, headerRows });
  return { status: issues.length ? 'PARTIAL' : value.completedOk === true ? 'COMPLETE' : 'UNRECOGNIZED', reportedRows, headerRows, issues };
}

/** A completed profile is reused on resume. A fresh operation ID is a fresh source edition. */
export async function captureSelection({ directory, operationId, selection: input, transport, environment, env, proxyEnvironment, proxyEnv, signal, onProgress, readStatus = true } = {}) {
  operationId = stableId(operationId);
  await privateDirectory(directory);
  const root = join(directory, operationId); await privateDirectory(root);
  const selection = normalizeSelection(input), selectionSha256 = sha256(canonicalJson(selection));
  let ownedTransport;
  return withPrivateLock(root, 'capture.lock', async () => {
    let state;
    try {
      const existing = await readCapture(root); const { directory: ignored, ...retained } = existing; state = retained;
      if (state.operationId !== operationId || state.selectionSha256 !== selectionSha256) fail('WQX_OPERATION_CHANGED', 'The operation ID already belongs to a different native selection.', 409);
      if (state.status === 'COMPLETE') return existing;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schema: CAPTURE_SCHEMA, source: { name: 'Water Quality Portal', version: 'WQX 3.0', origin: WQX_ORIGIN, guide: WQX_ORIGIN + '/beta/webservices_documentation/' }, operationId, selection, selectionSha256, startedAt: now(), updatedAt: now(), completedAt: null, status: 'IN_PROGRESS', resources: buildQueries(selection).map(query => ({ ...query, status: 'PENDING', dataAvailable: false, attempt: 0, bodyFile: null, recordFile: null, rowCount: 0, columns: [], issues: [] })), attempts: [], files: [], summary: {} };
    }
    state.status = 'IN_PROGRESS'; state.completedAt = null; await persist(state, root);
    const source = transport ?? (ownedTransport = createWqxTransport({ environment: environment ?? env, proxyEnvironment: proxyEnvironment ?? environment ?? env, proxyEnv }));
    const requestSource = typeof source === 'function' ? source : source?.request?.bind(source);
    if (!requestSource) fail('WQX_TRANSPORT', 'Provide a request function or a source transport with request().');
    try {
      for (const resource of state.resources) {
        if (resource.status === 'COMPLETE') continue;
        if (signal?.aborted) { state.status = 'PARTIAL'; state.error = errorInfo(signal.reason ?? new Error('Acquisition stopped.')); break; }
        if (resource.retryAt && Date.parse(resource.retryAt) > Date.now()) { resource.status = 'ERROR'; resource.error = { code: 'WQX_PROVIDER_RETRY_AFTER', message: 'The original provider retry time has not arrived.', status: 429 }; continue; }
        resource.attempt++; resource.status = 'REQUESTING'; resource.error = null; resource.issues = []; resource.dataAvailable = false; resource.providerReceipt = null; resource.providerValidation = null; await persist(state, root);
        try {
          const { receipt, body, record } = await retainedRequest({ state, directory: root, requestSource, url: resource.url, profile: resource.profile, resourceId: resource.id, ordinal: resource.attempt, role: 'source', signal });
          Object.assign(resource, { bodyFile: receipt.bodyFile, recordFile: receipt.recordFile, responseStatus: record.status, receivedAt: record.receivedAt, sha256: record.sha256, bytes: record.bytes, headers: record.headers, retryAt: receipt.retryAt, requestId: record.headers['wqp-request-id'] ?? null });
          if (![200, 204].includes(record.status)) fail('WQX_HTTP_STATUS', 'The original ' + resource.profile + ' request returned HTTP ' + record.status + '.', 502, { upstreamStatus: record.status });
          const decoded = decodeProfile(body, { profile: resource.profile, status: record.status });
          resource.columns = decoded.columns; resource.rowCount = decoded.rowCount; resource.dataAvailable = true; resource.status = 'COMPLETE';
          if (record.headers.warning) resource.issues.push({ code: 'PROVIDER_WARNING', value: record.headers.warning });
          if (readStatus && /^[0-9a-f-]{16,64}$/i.test(resource.requestId ?? '')) {
            try {
              const statusUrl = WQX_API + '/status/' + resource.requestId;
              const status = await retainedRequest({ state, directory: root, requestSource, url: statusUrl, profile: resource.profile, resourceId: resource.id, ordinal: resource.attempt, role: 'status', signal });
              resource.providerReceipt = { url: statusUrl, status: status.record.status, bodyFile: status.receipt.bodyFile, recordFile: status.receipt.recordFile, sha256: status.record.sha256, bytes: status.record.bytes, ...statusSummary(status.body) };
            } catch (error) { resource.providerReceipt = { error: errorInfo(error) }; }
            resource.providerValidation = assessProviderStatus(resource);
            resource.issues.push(...resource.providerValidation.issues);
            if (resource.providerValidation.status === 'PARTIAL') fail('WQX_PROVIDER_INCOMPLETE', 'The original provider completion response reports incomplete or inconsistent output.', 502, resource.providerValidation);
          }
        } catch (error) { resource.status = 'ERROR'; resource.error = errorInfo(error); }
        await persist(state, root);
        if (onProgress) await onProgress(attached(state, root));
      }
      state.status = state.resources.every(resource => resource.status === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL'; state.completedAt = now(); await persist(state, root);
      return attached(state, root);
    } finally { await ownedTransport?.close(); }
  });
}
function validateManifest(state) {
  if (!plain(state) || state.schema !== CAPTURE_SCHEMA || !Array.isArray(state.resources) || !Array.isArray(state.attempts) || !Array.isArray(state.files) || !state.files.every(file => plain(file) && typeof file.path === 'string' && /^[0-9a-f]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_RESPONSE_BYTES)) fail('WQX_CAPTURE', 'The retained record is not a WQX3 capture.', 409);
  stableId(state.operationId);
  const selection = normalizeSelection(state.selection), queries = buildQueries(selection);
  if (canonicalJson(selection) !== canonicalJson(state.selection) || sha256(canonicalJson(selection)) !== state.selectionSha256 || state.captureSha256 !== manifestHash(state) || queries.length !== state.resources.length) fail('WQX_CAPTURE_CHANGED', 'The retained source identity or selection changed.', 409);
  for (let i = 0; i < queries.length; i++) for (const key of ['id', 'profile', 'url', 'window', 'dataProfile']) if (canonicalJson(queries[i][key]) !== canonicalJson(state.resources[i][key])) fail('WQX_CAPTURE_CHANGED', 'The retained original request changed.', 409);
  if (!['IN_PROGRESS', 'PARTIAL', 'COMPLETE'].includes(state.status) || state.status === 'COMPLETE' && state.resources.some(resource => resource.status !== 'COMPLETE' || !resource.dataAvailable)) fail('WQX_CAPTURE_STATE', 'The retained completion state is inconsistent.', 409);
  if (new Set(state.files.map(file => file.path)).size !== state.files.length) fail('WQX_CAPTURE_CHANGED', 'The retained member paths repeat.', 409);
  return state;
}
export async function readCapture(directory, operationId) {
  const root = operationId === undefined ? directory : join(directory, stableId(operationId));
  await privateDirectory(root);
  const state = validateManifest(await readPrivateJson(join(root, 'capture.json'), META_BYTES));
  const members = new Map();
  for (const file of state.files) {
    const bytes = await readBytes(relativePath(root, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail('WQX_CAPTURE_BYTES_CHANGED', 'A retained original source member changed.', 409, { path: file.path });
    members.set(file.path, file);
  }
  for (const resource of state.resources) if (resource.dataAvailable) {
    const body = members.get(resource.bodyFile), metadata = members.get(resource.recordFile);
    if (!body || !metadata || body.sha256 !== resource.sha256 || body.bytes !== resource.bytes) fail('WQX_CAPTURE_MEMBER_MISSING', 'A source profile lacks its original retained body or response record.', 409);
    const record = await readPrivateJson(relativePath(root, resource.recordFile), META_BYTES);
    if (record.url !== resource.url || record.profile !== resource.profile || record.sha256 !== resource.sha256 || record.bodyFile !== resource.bodyFile || record.bytes !== resource.bytes || record.status !== resource.responseStatus) fail('WQX_CAPTURE_RESPONSE_CHANGED', 'The source profile no longer matches its original HTTP record.', 409);
  }
  return attached(state, root);
}
const exactField = (record, name) => own(record, name) ? record[name] : null;
export function recordIdentity(profile, record) {
  const base = [exactField(record, 'ProviderName'), exactField(record, 'Org_Identifier')];
  const values = profile === 'Station' ? [...base, exactField(record, 'Location_Identifier')] : profile === 'Activity' ? [...base, exactField(record, 'Activity_ActivityIdentifier')] : [...base, exactField(record, 'Activity_ActivityIdentifier'), exactField(record, 'Result_MeasureIdentifier'), ...(profile === 'ResultDetectionQuantitationLimit' ? [exactField(record, 'DetectionLimit_Type')] : [])];
  return values.some(value => value === null || value === '') ? null : canonicalJson(values);
}
function markDuplicates(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (row.key === null) continue;
    const group = grouped.get(row.key) ?? { versions: new Set(), rows: [] };
    row.duplicate = group.versions.has(row.recordSha256); group.versions.add(row.recordSha256); group.rows.push(row); grouped.set(row.key, group);
  }
  for (const group of grouped.values()) if (group.versions.size > 1) for (const row of group.rows) row.conflictingDuplicate = true;
}
export async function readProfiles(capture) {
  const retained = await readCapture(typeof capture === 'string' ? capture : capture.directory), result = Object.fromEntries(PROFILES.map(profile => [profile, []]));
  for (const resource of retained.resources) if (resource.dataAvailable) {
    const decoded = decodeProfile(await readBytes(relativePath(retained.directory, resource.bodyFile)), { profile: resource.profile, status: resource.responseStatus });
    if (decoded.rowCount !== resource.rowCount || canonicalJson(decoded.columns) !== canonicalJson(resource.columns)) fail('WQX_CAPTURE_ROWS_CHANGED', 'The retained CSV no longer matches its declared rows or header.', 409);
    for (const value of decoded.records) {
      const recordSha256 = sha256(canonicalJson(value.record)), key = recordIdentity(resource.profile, value.record);
      result[resource.profile].push({ profile: resource.profile, id: 'wqx-record-' + sha256(canonicalJson([resource.profile, key, recordSha256])), key, record: value.record, recordSha256, duplicate: false, conflictingDuplicate: false, source: { profile: resource.profile, resourceId: resource.id, url: resource.url, sha256: resource.sha256, bodyFile: resource.bodyFile, index: value.index, lineStart: value.lineStart, lineEnd: value.lineEnd, receivedAt: resource.receivedAt } });
    }
  }
  for (const rows of Object.values(result)) markDuplicates(rows);
  return { capture: retained, profiles: result };
}
export async function readProfile(capture, profile) {
  if (!PROFILES.includes(profile)) fail('WQX_PROFILE', 'Choose an original WQX3 profile.');
  return (await readProfiles(capture)).profiles[profile];
}
export async function retainedFiles(capture) {
  const state = await readCapture(typeof capture === 'string' ? capture : capture.directory);
  const manifest = await readBytes(join(state.directory, 'capture.json'), META_BYTES);
  return [{ path: 'capture.json', sha256: sha256(manifest), bytes: manifest.length, role: 'manifest', contentType: 'application/json' }, ...state.files.map(file => ({ ...file }))];
}
export const normalizeWaterQualitySelection = normalizeSelection;
export const captureWaterQuality = captureSelection;
export const readWaterQualityCapture = readCapture;
export const retainedWaterQualityFiles = retainedFiles;
