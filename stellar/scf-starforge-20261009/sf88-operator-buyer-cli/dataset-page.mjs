// MIT. Consumer of the original SF30 dataset-page.v1 response contract.
import { createHash } from 'node:crypto';
import { InputError, need } from './config.mjs';
import { checkPage } from '../sf100-buyer-dataset-delivery/deliver.mjs';
import { readAttemptWireCheckpoint } from './attempt-wire.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a, b) => canonical(a) === canonical(b);
const fieldName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
const RANGE_OPS = ['gt','gte','lt','lte'];
function filterValue(text, column) {
  if (text === '' && column.nullable) return null;
  if (column.type === 'string') return text;
  if (column.type === 'boolean' && ['true','false'].includes(text)) return text === 'true';
  if (column.type === 'integer' && /^-?(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  if (column.type === 'number' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text) && Number.isFinite(Number(text))) return Number(text);
  throw new InputError('DATASET_FILTER_TYPE_MISMATCH');
}
export function decodeDatasetCursor(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value), 'DATASET_CURSOR_INVALID');
  let bytes, cursor;
  try {
    bytes = Buffer.from(value, 'base64url');
    cursor = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } catch { throw new InputError('DATASET_CURSOR_INVALID'); }
  need(bytes.toString('base64url') === value && object(cursor) &&
    Object.keys(cursor).sort().join(',') === 'n,q,s,v' && cursor.v === 1 &&
    integer(cursor.n, 0, 1000000) && hex(cursor.q) && hex(cursor.s), 'DATASET_CURSOR_INVALID');
  return cursor;
}

/** Request syntax is checked offline; the original seller admits enabled capabilities. */
export function validateDatasetQuery(url, {initial = false} = {}) {
  let params;
  try { params = new URL(url).searchParams; }
  catch { throw new InputError('DATASET_QUERY_INVALID'); }
  const names = [...params.keys()], rangeColumns = new Set(), bounds = new Set();
  need(new Set(names).size === names.length, 'DATASET_QUERY_DUPLICATED');
  need(!initial || !params.has('cursor'), 'DATASET_INITIAL_QUERY_INVALID');
  need(names.length <= 32, 'DATASET_QUERY_PARAMETER_LIMIT');
  let filters = 0;
  for (const name of names) {
    if (['fields','limit','cursor','sort','snapshot','semantics'].includes(name)) continue;
    const match = /^(where|gt|gte|lt|lte)_(.+)$/.exec(name);
    need(match && fieldName(match[2]), 'DATASET_UNSUPPORTED_QUERY_CAPABILITY');
    const [, op, column] = match;
    if (op === 'where') filters++;
    else {
      rangeColumns.add(column);
      const bound = column + ':' + (op.startsWith('g') ? 'lower' : 'upper');
      need(!bounds.has(bound), 'DATASET_RANGE_BOUND_CONFLICT');
      bounds.add(bound);
    }
  }
  need(filters <= 8 && rangeColumns.size <= 8, 'DATASET_FILTER_LIMIT_EXCEEDED');
  if (params.has('fields')) {
    const fields = params.get('fields').split(',');
    need(fields.length >= 1 && fields.length <= 64 && fields.every(fieldName) &&
      new Set(fields).size === fields.length, 'DATASET_FIELDS_INVALID');
  }
  if (params.has('limit')) need(/^[1-9][0-9]{0,6}$/.test(params.get('limit')) &&
    Number(params.get('limit')) <= 1000, 'DATASET_PAGE_LIMIT_INVALID');
  if (params.has('sort')) {
    const sort = params.get('sort');
    need(fieldName(sort.startsWith('-') ? sort.slice(1) : sort), 'DATASET_SORT_INVALID');
  }
  if (params.has('snapshot')) need(hex(params.get('snapshot')), 'DATASET_EXPECTED_SNAPSHOT_INVALID');
  if (params.has('semantics')) need(hex(params.get('semantics')), 'DATASET_EXPECTED_SEMANTICS_INVALID');
  if (params.has('cursor')) {
    const cursor = decodeDatasetCursor(params.get('cursor'));
    need(!params.has('snapshot') || cursor.s === params.get('snapshot'), 'DATASET_CURSOR_BINDING_MISMATCH');
  }
  return params;
}

/** Use the original exporter's query, row typing, capability limits and signature. */
export function nativeDatasetContract(value) {
  try { return checkPage(value); }
  catch { throw new InputError('DATASET_PAGE_NATIVE_CONTRACT_INVALID'); }
}

/** Read selected response metadata from the original SF88 wire checkpoint.
 * Full request/payment headers remain inside that existing private checkpoint. */
export async function readDatasetResponseMetadata(cfg, {status, nativeBuyerStatus} = {}) {
  const checkpoint = await readAttemptWireCheckpoint({cfg, body:undefined, includeWire:true});
  if (!checkpoint) return null; // Older non-semantic acquisitions remain readable.
  need(!checkpoint.writerActive && !checkpoint.snapshot?.writerActive &&
    object(checkpoint.events), 'DATASET_RESPONSE_CHECKPOINT_ACTIVE');
  const phase = nativeBuyerStatus === 'NO_PAYMENT_REQUIRED' ? 'unsigned-response' : 'signed-response';
  const event = checkpoint.events[phase], record = checkpoint.snapshot.records?.[phase];
  need(event && event.status >= 200 && event.status < 300 &&
    (status === undefined || event.status === status) &&
    (!event.url || event.url === cfg.operation.url) && Array.isArray(event.headers) &&
    record && hex(record.sha256) && integer(record.bytes, 1, 262144), 'DATASET_RESPONSE_CHECKPOINT_MISMATCH');
  // A Response constructed by an original host transport may have an empty URL;
  // its recorded request is still bound to the exact cfg URL by the native reader.
  return {headers:event.headers, record:{phase,sha256:record.sha256,bytes:record.bytes}};
}
function semanticHeaders(headers, semantics, snapshot) {
  if (headers === undefined) return null; // Offline body-only inspection.
  need(headers !== null, 'DATASET_SEMANTIC_RESPONSE_HEADERS_MISSING');
  let values;
  try { values = new Headers(headers); }
  catch { throw new InputError('DATASET_RESPONSE_HEADERS_INVALID'); }
  const header = semantics.schema === 'stellar-forge.ckan-semantics.v1' ? 'x-ckan-semantics-sha256' :
    ['stellar-forge.odata-semantics.v1', 'stellar-forge.superset-semantics.v1',
      'stellar-forge.directus-semantics.v1'].includes(semantics.schema) ? 'x-dataset-semantics-sha256' : null;
  need(header !== null && values.get(header) === semantics.sha256 &&
    values.get('x-dataset-snapshot') === snapshot &&
    ['x-ckan-semantics-sha256','x-dataset-semantics-sha256'].every(name =>
      !values.has(name) || values.get(name) === semantics.sha256),
    'DATASET_SEMANTIC_RESPONSE_HEADERS_CHANGED');
  return {[header]:semantics.sha256,'x-dataset-snapshot':snapshot};
}

/** Bind a validated semantic page to actual retained native response headers. */
export async function bindDatasetResponseMetadata(page, cfg, options = {}) {
  if (!page.semantics) return page;
  const response = await readDatasetResponseMetadata(cfg, options);
  const headers = semanticHeaders(response?.headers ?? null, page.semantics, page.snapshot);
  return {...page, semanticResponseHeaders:headers, semanticResponseRecord:response.record};
}

/** Validate actual saved native pages before another independent buyer call. */
export function inspectDatasetPage(bytes, {url, previous = null, expectedSnapshot = null, maxRows = 1000000,
  responseHeaders, responseRecord} = {}) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new InputError('DATASET_PAGE_JSON_INVALID'); }
  const contract = nativeDatasetContract(value);
  const d = value.dataset, p = value.page;
  need(d.name.length <= 128 && !/[\x00-\x1f\x7f]/.test(d.name) &&
    integer(d.defaultLimit, 1, 1000) && integer(d.maxLimit, d.defaultLimit, 1000), 'DATASET_DESCRIPTION_INVALID');
  const columns = new Map(d.columns.map(c => [c.name, c]));
  need(p.limit <= d.maxLimit, 'DATASET_PAGE_COUNTS_INVALID');
  need(p.total <= maxRows, 'DATASET_ROW_CEILING_REACHED');
  const params = validateDatasetQuery(url);
  const names = [...params.keys()];
  const allowed = new Set(['fields','limit','cursor','snapshot',
    ...(contract.semantics ? ['semantics'] : []),
    ...d.columns.filter(c => c.filterable).map(c => 'where_' + c.name),
    ...d.columns.filter(c => c.rangeFilterable).flatMap(c => RANGE_OPS.map(op => op + '_' + c.name)),
    ...(d.columns.some(c => c.sortable) ? ['sort'] : [])]);
  need(names.every(key => allowed.has(key)), 'DATASET_QUERY_CONTRACT_MISMATCH');
  // The original version store consumes this selector before the CSV parser.
  // It binds the returned generation, but is not part of the native query hash.
  if (params.has('snapshot')) need(params.get('snapshot') === d.snapshot, 'DATASET_SNAPSHOT_MISMATCH');
  if (params.has('semantics')) need(params.get('semantics') === contract.semantics?.sha256, 'DATASET_SEMANTICS_MISMATCH');
  const headers = contract.semantics ? semanticHeaders(responseHeaders, contract.semantics, d.snapshot) : null;
  if (responseRecord !== undefined) need(object(responseRecord) && hex(responseRecord.sha256) &&
    ['unsigned-response','signed-response'].includes(responseRecord.phase) &&
    integer(responseRecord.bytes, 1, 262144), 'DATASET_RESPONSE_RECORD_INVALID');
  const requestedFields = params.has('fields') ? params.get('fields').split(',') : [...columns.keys()];
  const requestedLimit = params.has('limit') ? params.get('limit') : String(d.defaultLimit);
  need(/^[1-9][0-9]{0,6}$/.test(requestedLimit) && Number(requestedLimit) === p.limit && equal(requestedFields, value.fields), 'DATASET_QUERY_CONTRACT_MISMATCH');
  const selectedFilters = d.columns.filter(c => c.filterable && params.has('where_' + c.name)).map(c => c.name).sort()
    .map(name => [name, filterValue(params.get('where_' + name), columns.get(name))]);
  need(equal(value.filters, Object.fromEntries(selectedFilters)), 'DATASET_FILTER_MISMATCH');
  const ranges = d.columns.filter(c => c.rangeFilterable).map(c => c.name).sort().flatMap(name =>
    RANGE_OPS.filter(op => params.has(op + '_' + name)).map(op => {
      const selected = filterValue(params.get(op + '_' + name), columns.get(name));
      need(selected !== null, 'DATASET_RANGE_NULL_BOUND');
      return [name, op, selected];
    }));
  let sort = null;
  if (params.has('sort')) {
    const selected = params.get('sort'), descending = selected.startsWith('-');
    const column = descending ? selected.slice(1) : selected;
    need(columns.get(column)?.sortable === true, 'DATASET_SORT_NOT_ENABLED');
    sort = {column, direction:descending ? 'desc' : 'asc', nulls:'last', ties:'csv-record-order'};
  }
  // Native equality hashes retain their original bytes; advanced queries add native tuples.
  const query = {fields:value.fields, filters:selectedFilters,
    ...(ranges.length || sort ? {ranges, sort} : {})};
  need(equal(contract.query, query), 'DATASET_QUERY_CONTRACT_MISMATCH');
  const querySha256 = contract.queryHash;
  const incoming = params.has('cursor') ? decodeDatasetCursor(params.get('cursor')) : null;
  const offset = incoming?.n ?? 0;
  if (incoming) need(incoming.s === d.snapshot && incoming.q === querySha256, 'DATASET_CURSOR_BINDING_MISMATCH');
  need(offset <= p.total && p.returned === Math.min(p.limit, p.total - offset), 'DATASET_PAGE_RANGE_MISMATCH');
  const nextOffset = offset + p.returned;
  if (nextOffset === p.total) need(p.nextCursor === null, 'DATASET_TERMINAL_CURSOR_INVALID');
  else {
    const next = decodeDatasetCursor(p.nextCursor);
    need(next.n === nextOffset && next.n > offset && next.s === d.snapshot && next.q === querySha256, 'DATASET_CURSOR_NOT_CONTIGUOUS');
  }
  const datasetSha256 = digest(canonical(d));
  if (expectedSnapshot !== null) need(d.snapshot === expectedSnapshot, 'DATASET_SNAPSHOT_MISMATCH');
  if (previous) need(previous.snapshot === d.snapshot && previous.datasetSha256 === datasetSha256 &&
    previous.querySha256 === querySha256 && equal(previous.semantics ?? null, contract.semantics ?? null) &&
    previous.total === p.total && previous.nextOffset === offset &&
    previous.nextCursor === params.get('cursor'), 'DATASET_PAGE_CONTINUITY_MISMATCH');
  else need(offset === 0, 'DATASET_FIRST_PAGE_NOT_ZERO');
  return {snapshot:d.snapshot, datasetName:d.name, datasetSha256, querySha256, fields:value.fields,
    filters:value.filters, ...(ranges.length || sort ? {ranges:contract.ranges, order:sort} : {}),
    total:p.total, returned:p.returned, offset, nextOffset,
    nextCursor:p.nextCursor, sha256:digest(bytes), bytes:bytes.length,
    ...(contract.semantics ? {semantics:contract.semantics} : {}),
    ...(headers ? {semanticResponseHeaders:headers,
      ...(responseRecord ? {semanticResponseRecord:responseRecord} : {})} : {})};
}
