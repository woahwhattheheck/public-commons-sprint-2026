import { createHash } from 'node:crypto';
import { createPublicHttpsFetch, normalizeBuyerTransport } from '../../sf31-buyer-client/public-transport.mjs';

export const ORIGIN = 'https://api.blockworks.com';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  requireValue(object(value), 'Acquisition inputs must be JSON values.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');

function resolve(document, schema) {
  if (!schema?.$ref) return schema || {};
  requireValue(schema.$ref.startsWith('#/'), 'Only the retained local OpenAPI references are supported.');
  return resolve(document, schema.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], document));
}
function validateValue(document, value, definition, label) {
  const schema = resolve(document, definition);
  if (schema.type === 'array') {
    requireValue(Array.isArray(value), `${label} must be an array; native array parameters use comma-separated values on the wire.`);
    requireValue(value.length > 0, `${label} cannot be an empty array.`);
    for (const item of value) {
      validateValue(document, item, schema.items, label);
      requireValue(!String(item).includes(','), `${label} contains a comma inside one value, which the native CSV parameter cannot distinguish.`);
    }
  } else if (schema.type === 'boolean') requireValue(typeof value === 'boolean', `${label} must be a boolean.`);
  else if (schema.type === 'integer') requireValue(Number.isSafeInteger(value), `${label} must be a safe integer.`);
  else if (schema.type === 'number') requireValue(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number.`);
  else requireValue(typeof value === 'string', `${label} must be a string as declared by the selected native operation.`);
  if (schema.enum) requireValue(schema.enum.includes(value), `${label} is not one of the values in the retained source.`);
  if (typeof value === 'number' && schema.minimum !== undefined) requireValue(value >= schema.minimum, `${label} is below its native minimum.`);
  if (typeof value === 'number' && schema.maximum !== undefined) requireValue(value <= schema.maximum, `${label} exceeds its native maximum.`);
}
const seconds = value => /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Date.parse(value) / 1000;

/** A request is compiled from the captured operation, not from a guessed endpoint. */
export function prepareRequest(document, input) {
  requireValue(object(input) && typeof input.path === 'string', 'Choose a documented native request path.');
  requireValue(input.method === undefined || input.method === 'GET', 'The acquisition subsystem only performs GET requests.');
  requireValue(/^\/query\/(tabular|timeseries)\//.test(input.path) && !/[?#\\]/.test(input.path), 'Choose a canonical Blockworks data or catalog path.');
  const segments = input.path.split('/').filter(Boolean);
  for (const segment of segments) {
    const decoded = decodeURIComponent(segment);
    requireValue(decoded !== '.' && decoded !== '..' && !/[\/\\?#\u0000-\u001f]/.test(decoded), 'A native path segment contains a route separator or traversal.');
  }
  const candidates = Object.entries(document.paths || {}).filter(([, item]) => item.get).sort(([a], [b]) => a.split('{').length - b.split('{').length);
  let selected;
  for (const [path, item] of candidates) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    const values = {};
    if (parts.every((part, index) => {
      if (/^\{[^}]+\}$/.test(part)) { values[part.slice(1, -1)] = decodeURIComponent(segments[index]); return true; }
      return part === segments[index];
    })) { selected = { path, item, values }; break; }
  }
  requireValue(selected, 'The request path is absent from the retained OpenAPI source.');
  const parameters = [...(selected.item.parameters || []), ...(selected.item.get.parameters || [])].map(value => resolve(document, value));
  const query = input.query === undefined ? {} : input.query;
  requireValue(object(query), 'Native query parameters must be an object.');
  for (const key of Object.keys(query)) {
    const parameter = parameters.find(value => value.in === 'query' && value.name === key);
    requireValue(parameter, `Unknown native query parameter: ${key}.`);
    validateValue(document, query[key], parameter.schema, key);
  }
  for (const parameter of parameters) {
    if (parameter.in === 'path') validateValue(document, selected.values[parameter.name], parameter.schema, parameter.name);
    if (parameter.in === 'query' && parameter.required) requireValue(own(query, parameter.name), `Native parameter ${parameter.name} is required.`);
  }
  requireValue(query.acceptFormat === undefined || query.acceptFormat === 'json', 'This complete acquisition reads the native JSON envelope; select acceptFormat=json. CSV and JSONL cannot supply this JSON page ledger.');
  const catalog = segments[2] === 'catalog';
  const kind = catalog ? 'catalog' : segments[1];
  const paged = !catalog && kind === 'tabular' && parameters.some(value => value.in === 'query' && value.name === 'page');
  if (paged) {
    requireValue(query.page === undefined || query.page === 1, 'A complete tabular acquisition starts at native page 1. Resume advances the retained page cursor.');
    requireValue(query.pageSize === undefined || (query.pageSize >= 1 && query.pageSize <= 1000), 'Native pageSize must be between 1 and 1000.');
  }
  if (kind === 'timeseries') {
    requireValue(!(own(query, 'timeframe') && (own(query, 'start') || own(query, 'end'))), 'Native timeframe and start/end are mutually exclusive.');
    if (own(query, 'timeframe')) {
      const value = query.timeframe;
      requireValue(/^(?:[1-9]\d*[mhdw]|ytd|qtd|mtd|dtd|htd|\d{4}(?:-\d{2}(?:-\d{2})?)?)$/.test(value) || (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))), 'Use the documented relative, to-date, calendar or RFC3339 timeframe. Month granularity and relative minutes are distinct.');
    }
    for (const key of ['start', 'end']) if (own(query, key)) requireValue(Number.isFinite(seconds(query[key])), `Native ${key} must be a date, RFC3339 value or unix seconds.`);
    if (own(query, 'start') && own(query, 'end')) {
      const duration = seconds(query.end) - seconds(query.start);
      requireValue(duration > 0, 'The selected exclusive end must be after the inclusive start.');
      const step = { '5m': 300, '1h': 3600, '1d': 86400, '1w': 604800 }[selected.values.granularity];
      requireValue(query.bounds === true || !step || Math.ceil(duration / step) <= 9000, 'This selected native window exceeds 9000 points. Review the window or select the documented bounds request; it will not be split or widened automatically.');
    }
    const seriesParameter = parameters.find(value => value.name === 'series' && value.in === 'query');
    if (seriesParameter && /Required:/i.test(seriesParameter.description || '')) requireValue(typeof query.series === 'string' && query.series.length > 0, 'This native model requires its canonical series identifiers.');
    if (typeof query.series === 'string') {
      const keys = query.series.split(',');
      requireValue(keys.every(Boolean) && new Set(keys).size === keys.length, 'Select distinct nonempty canonical series identifiers.');
      const maximum = /up to (\d+)/i.exec(seriesParameter?.description || '');
      if (maximum) requireValue(keys.length <= Number(maximum[1]), 'The selected series exceed the limit in the retained model operation.');
    }
  }
  const keyField = { assets: 'assetID', blockchains: 'networkID', 'stablecoin-products': 'id' }[segments[2]] || null;
  if (kind === 'tabular' && keyField && query.selections) requireValue(query.selections.includes(keyField), `Include native ${keyField} in the reviewed selections so the returned entities retain their actual identity.`);
  return { method: 'GET', path: input.path, query: JSON.parse(canonical(query)), operationPath: selected.path,
    kind, model: segments[2], paged, pageSize: query.pageSize ?? 100, pathParameters: selected.values,
    keyField, window: kind === 'timeseries' ? Object.fromEntries(['timeframe', 'start', 'end', 'bounds'].filter(key => own(query, key)).map(key => [key, query[key]])) : null };
}

export function requestURL(request, page = 1) {
  const url = new URL(request.path, ORIGIN);
  const query = { ...request.query };
  if (request.paged && (page !== 1 || own(query, 'page'))) query.page = page;
  for (const key of Object.keys(query).sort()) url.searchParams.set(key, Array.isArray(query[key]) ? query[key].join(',') : String(query[key]));
  return url.href;
}
export function comparableURL(value) {
  const url = new URL(value);
  requireValue(url.origin === ORIGIN && !url.username && !url.password && !url.hash, 'A captured response must belong to the canonical Blockworks origin.');
  const keys = [...url.searchParams.keys()];
  requireValue(new Set(keys).size === keys.length, 'Repeated native query parameters are not an equivalent reviewed request.');
  url.searchParams.sort();
  return url.href;
}
export function responseHeaders(value = {}) {
  const entries = value && typeof value.entries === 'function' ? [...value.entries()] : Object.entries(value);
  return Object.fromEntries(entries.map(([key, entry]) => [key.toLowerCase(), String(entry)]).filter(([key]) => /^(?:date|etag|last-modified|content-type|content-length|retry-after|x-request-id|request-id|x-ratelimit-.*|ratelimit-.*)$/.test(key)));
}
export function retryTime(headers, now = Date.now()) {
  const value = headers['retry-after'];
  if (!value) return null;
  const date = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(date) ? new Date(Math.max(now, date)).toISOString() : null;
}
function issue(code, message, extra = {}) { return { code, message, ...extra }; }

/** Preserve the response's own point_schema and series keys; do not infer an ID from a slug. */
export function interpret(request, document) {
  requireValue(object(document) && own(document, 'data'), 'The native response has no data envelope.');
  const data = document.data;
  if (request.kind === 'catalog') {
    requireValue(object(data) && Array.isArray(data.models) && data.models.every(object), 'The native catalog has no models array.');
    return { kind: 'catalog', rows: data.models, series: [], pointSchema: null, metadata: { ...(document.metadata || {}), catalog: data }, rowCount: data.models.length };
  }
  if (request.kind === 'tabular') {
    const rows = request.paged ? data : (object(data) ? [data] : []);
    requireValue(Array.isArray(rows) && rows.every(object), 'The native tabular response has an unexpected row shape.');
    if (!request.paged) requireValue(object(data), 'The selected native lookup did not return an entity.');
    if (request.keyField) requireValue(rows.every(row => typeof row[request.keyField] === 'string' && row[request.keyField].length > 0), `The native result does not retain its ${request.keyField} identity.`);
    return { kind: 'tabular', rows, series: [], pointSchema: null, metadata: document.metadata || {}, rowCount: rows.length };
  }
  requireValue(object(data) && Array.isArray(data.point_schema), 'The native timeseries response has no point_schema.');
  const pointSchema = data.point_schema;
  requireValue(pointSchema.length > 0 && pointSchema.every(field => object(field) && typeof field.field === 'string'), 'The native point_schema does not identify each point column.');
  requireValue(pointSchema[0].time !== false, 'The native point_schema marks its first value as a non-time column.');
  requireValue(new Set(pointSchema.map(field => field.field)).size === pointSchema.length, 'The native point_schema repeats a field identity.');
  const series = Array.isArray(data.series) ? data.series : [data];
  const selected = request.query.series?.split(',') || Object.entries(request.pathParameters).filter(([key]) => key !== 'granularity').map(([, value]) => value);
  requireValue(new Set(series.map(value => value.key)).size === series.length, 'The native response repeats a series key.');
  for (const value of series) {
    requireValue(object(value) && typeof value.key === 'string' && Array.isArray(value.points), 'The native series is missing its key or points.');
    requireValue(!selected.length || selected.includes(value.key), 'The native series key differs from the selected canonical identifier.');
    requireValue(value.points.length <= (request.query.bounds === true ? 2 : 9000), 'The native response exceeded the selected point limit.');
    for (const point of value.points) {
      requireValue(Array.isArray(point) && point.length === pointSchema.length && typeof point[0] === 'number' && Number.isFinite(point[0]), 'A native point does not match its returned schema.');
      requireValue(point.slice(1).every(entry => entry === null || (typeof entry === 'number' && Number.isFinite(entry))), 'A native point has a nonnumeric metric outside its declared schema.');
    }
  }
  const unresolved = selected.filter(key => !series.some(value => value.key === key && (value.points.length > 0 || object(value.entity))));
  return { kind: 'timeseries', rows: [], series, pointSchema, metadata: { ...(document.metadata || {}), window: request.window, unresolvedIdentifiers: unresolved }, rowCount: series.reduce((sum, value) => sum + value.points.length, 0) };
}

export function assess(request, response, page, previous = null) {
  const receivedAt = Number.isFinite(Date.parse(response.capturedAt)) ? Date.parse(response.capturedAt) : Date.now();
  let document;
  try { document = JSON.parse(response.body.toString('utf8').replace(/^\uFEFF/, '')); }
  catch {
    if (response.status < 200 || response.status >= 300) return { accepted: false,
      problem: issue([401, 403].includes(response.status) ? 'access_required' : 'provider_error', `Native HTTP ${response.status}; its complete non-JSON body is retained.`, { status: response.status }), retryAt: retryTime(response.headers, receivedAt) };
    return { accepted: false, reviewRequired: true, problem: issue('invalid_json', 'The retained response is not a native JSON document.'), retryAt: retryTime(response.headers, receivedAt) };
  }
  const nativeError = document?.error;
  if (response.status < 200 || response.status >= 300 || (nativeError !== null && nativeError !== undefined && nativeError !== '')) {
    return { accepted: false, problem: issue([401, 403].includes(response.status) ? 'access_required' : 'provider_error', typeof nativeError === 'string' ? nativeError.slice(0, 1500) : `Native HTTP ${response.status}.`, { status: response.status, nativeError: nativeError ?? null }), retryAt: retryTime(response.headers, receivedAt) };
  }
  try {
    const value = interpret(request, document);
    if (value.metadata.unresolvedIdentifiers?.length) return { accepted: false, reviewRequired: true, problem: issue('identity_unresolved', 'The selected native identifiers have no entity and no points; this is distinct from an identified empty series.', { identifiers: value.metadata.unresolvedIdentifiers }) };
    const result = { accepted: true, kind: value.kind, rowCount: value.rowCount, metadata: request.kind === 'catalog' ? {} : value.metadata,
      pointSchema: value.pointSchema, seriesKeys: value.series.map(entry => entry.key), complete: !request.paged };
    if (request.paged) {
      const { totalRows, totalPages } = document.metadata || {};
      requireValue(Number.isSafeInteger(totalRows) && totalRows >= 0 && Number.isSafeInteger(totalPages) && totalPages >= 0, 'Native tabular pagination totals are missing or invalid.');
      requireValue(totalPages === Math.ceil(totalRows / request.pageSize) || (totalRows === 0 && totalPages === 1), 'Native totalRows/totalPages no longer match the selected pageSize.');
      requireValue(value.rowCount <= request.pageSize && page <= Math.max(1, totalPages), 'The returned native page is outside its declared coverage.');
      if (previous) requireValue(previous.totalRows === totalRows && previous.totalPages === totalPages, 'Native pagination totals changed during this acquisition; keep the captured pages and review a new source run.');
      result.totalRows = totalRows; result.totalPages = totalPages; result.complete = page >= Math.max(1, totalPages);
    }
    return result;
  } catch (error) { return { accepted: false, reviewRequired: true, problem: issue('native_shape_changed', error.message) }; }
}

/** The existing SF31 transport owns DNS, TLS and an explicitly selected CONNECT proxy. */
export function createNativeTransport({ buyerTransport = null, maxResponseBytes = 128 * 1024 * 1024 } = {}) {
  const profile = buyerTransport === null ? null : normalizeBuyerTransport(buyerTransport);
  requireValue(profile === null || profile.origin === ORIGIN, 'The selected transport must name the canonical Blockworks origin.');
  return async function nativeTransport({ url, headers, signal }) {
    requireValue(comparableURL(url).startsWith(ORIGIN + '/query/'), 'Only native read queries are permitted.');
    // Resolve the named proxy environment for this actual dispatch, not at module import.
    const fetchNative = createPublicHttpsFetch({ trustedProxy: profile });
    const response = await fetchNative(url, { method: 'GET', headers, redirect: 'manual', signal });
    const chunks = []; let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maxResponseBytes) throw Object.assign(new Error('The native response exceeds this configured retention limit.'), { code: 'ACQUISITION_RESPONSE_LIMIT_EXCEEDED' });
          chunks.push(Buffer.from(part.value));
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    }
    return { url: response.url || url, status: response.status, headers: responseHeaders(response.headers), body: Buffer.concat(chunks), capturedAt: new Date().toISOString() };
  };
}
export const nativeTransport = createNativeTransport();
