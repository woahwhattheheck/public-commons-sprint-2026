// MIT. Consumer of the original SF30 dataset-page.v1 response contract.
import { createHash } from 'node:crypto';
import { InputError, need } from './config.mjs';

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
function typed(value, column) {
  if (value === null) return column.nullable;
  if (column.type === 'string') return typeof value === 'string';
  if (column.type === 'integer') return Number.isSafeInteger(value);
  if (column.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}
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

/** Validate actual saved native pages before another independent buyer call. */
export function inspectDatasetPage(bytes, {url, previous = null, expectedSnapshot = null, maxRows = 1000000} = {}) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new InputError('DATASET_PAGE_JSON_INVALID'); }
  need(object(value) && value.schema === 'stellar-forge.dataset-page.v1' && object(value.dataset) &&
    Array.isArray(value.fields) && object(value.filters) && Array.isArray(value.rows) && object(value.page), 'DATASET_PAGE_SCHEMA_INVALID');
  const d = value.dataset, p = value.page;
  need(typeof d.name === 'string' && d.name.length >= 1 && d.name.length <= 128 &&
    !/[\x00-\x1f\x7f]/.test(d.name) && hex(d.snapshot) && integer(d.rowCount, 0, 1000000) &&
    Array.isArray(d.columns) && d.columns.length >= 1 && d.columns.length <= 64 &&
    integer(d.defaultLimit, 1, 1000) && integer(d.maxLimit, d.defaultLimit, 1000) && d.order === 'csv-record-order', 'DATASET_DESCRIPTION_INVALID');
  const columns = new Map();
  for (const c of d.columns) {
    need(object(c) && fieldName(c.name) && !columns.has(c.name) && ['string','integer','number','boolean'].includes(c.type) &&
      typeof c.nullable === 'boolean' && typeof c.filterable === 'boolean', 'DATASET_COLUMNS_INVALID');
    columns.set(c.name, c);
  }
  need(value.fields.length >= 1 && value.fields.length <= 64 && new Set(value.fields).size === value.fields.length &&
    value.fields.every(key => columns.has(key)), 'DATASET_FIELDS_INVALID');
  need(integer(p.limit, 1, d.maxLimit) && integer(p.total, 0, d.rowCount) && integer(p.returned, 0, p.limit) &&
    p.returned === value.rows.length, 'DATASET_PAGE_COUNTS_INVALID');
  need(p.total <= maxRows, 'DATASET_ROW_CEILING_REACHED');
  for (const row of value.rows) {
    need(object(row) && equal(Object.keys(row).sort(), [...value.fields].sort()) &&
      value.fields.every(key => typed(row[key], columns.get(key))), 'DATASET_ROW_SCHEMA_MISMATCH');
  }
  const params = new URL(url).searchParams;
  const names = [...params.keys()];
  need(new Set(names).size === names.length, 'DATASET_QUERY_DUPLICATED');
  const allowed = new Set(['fields','limit','cursor', ...d.columns.filter(c => c.filterable).map(c => 'where_' + c.name)]);
  need(names.every(key => allowed.has(key)), 'DATASET_QUERY_CONTRACT_MISMATCH');
  const requestedFields = params.has('fields') ? params.get('fields').split(',') : [...columns.keys()];
  const requestedLimit = params.has('limit') ? params.get('limit') : String(d.defaultLimit);
  need(/^[1-9][0-9]{0,6}$/.test(requestedLimit) && Number(requestedLimit) === p.limit && equal(requestedFields, value.fields), 'DATASET_QUERY_CONTRACT_MISMATCH');
  const selectedFilters = d.columns.filter(c => c.filterable && params.has('where_' + c.name)).map(c => c.name).sort()
    .map(name => [name, filterValue(params.get('where_' + name), columns.get(name))]);
  need(equal(value.filters, Object.fromEntries(selectedFilters)), 'DATASET_FILTER_MISMATCH');
  // SF30's cursor hashes JSON field order and the sorted native filter tuples.
  const querySha256 = digest(JSON.stringify({fields:value.fields, filters:selectedFilters}));
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
    previous.querySha256 === querySha256 && previous.total === p.total && previous.nextOffset === offset &&
    previous.nextCursor === params.get('cursor'), 'DATASET_PAGE_CONTINUITY_MISMATCH');
  else need(offset === 0, 'DATASET_FIRST_PAGE_NOT_ZERO');
  return {snapshot:d.snapshot, datasetName:d.name, datasetSha256, querySha256, fields:value.fields,
    filters:value.filters, total:p.total, returned:p.returned, offset, nextOffset,
    nextCursor:p.nextCursor, sha256:digest(bytes), bytes:bytes.length};
}
