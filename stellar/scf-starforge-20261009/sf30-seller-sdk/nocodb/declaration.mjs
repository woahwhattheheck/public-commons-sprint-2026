// MIT. An operator-selected NocoDB v3 table/view and explicit public columns.
import { dirname, resolve } from 'node:path';
import { object, readPrivate, digest, identity, fault } from '../postgres/publisher/files.mjs';

export const HASH = /^[a-f0-9]{64}$/;
export const MAX_CAPTURE_BYTES = 268435456;
export const MAX_PAGE_BYTES = 16777216;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
export const SCALAR_TYPES = new Set(['SingleLineText', 'LongText', 'PhoneNumber', 'URL', 'Email',
  'Number', 'Decimal', 'Currency', 'Percent', 'Duration', 'Date', 'DateTime', 'Time', 'SingleSelect',
  'Rating', 'Checkbox', 'Year', 'CreatedTime', 'LastModifiedTime', 'AutoNumber',
  'Formula', 'Lookup', 'Rollup', 'Barcode', 'QrCode']);
export function only(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
}
export function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
}
export function identifier(value, label = 'ID') {
  if (typeof value !== 'string' || !ID.test(value) || RESERVED.has(value)) throw fault('NOCODB_' + label + '_INVALID');
  return value;
}
export function binding(value) {
  if (value.apiVersion !== 'v3') throw fault('NOCODB_API_V3_REQUIRED');
  let url;
  try { url = new URL(value.server); } catch { throw fault('NOCODB_SERVER_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /%2f|%5c|%2e/i.test(url.pathname) || url.pathname.includes('//'))
    throw fault('NOCODB_SERVER_INVALID', 'Use the existing server origin and optional fixed reverse-proxy path, without credentials or query parameters.');
  const server = url.origin + url.pathname.replace(/\/$/, '');
  const viewId = value.viewId ?? null, where = value.where ?? null;
  if (viewId !== null) identifier(viewId, 'VIEW_ID');
  if (where !== null && (typeof where !== 'string' || !where.length || where.length > 8192 || /[\u0000-\u001f\u007f]/.test(where)))
    throw fault('NOCODB_FILTER_INVALID');
  if (!Array.isArray(value.sourceOrder) || !value.sourceOrder.length || value.sourceOrder.length > 8)
    throw fault('NOCODB_SOURCE_ORDER_REQUIRED', 'Choose an explicit stable source order, including the native unique identity fields.');
  const seen = new Set();
  const sourceOrder = value.sourceOrder.map(item => {
    only(item, ['field', 'direction'], 'NOCODB_SOURCE_ORDER_INVALID');
    const field = identifier(item.field, 'SORT_FIELD');
    if (seen.has(field) || !['asc', 'desc'].includes(item.direction)) throw fault('NOCODB_SOURCE_ORDER_INVALID');
    seen.add(field); return { field, direction: item.direction };
  });
  return { server, apiVersion: 'v3', baseId: identifier(value.baseId, 'BASE_ID'),
    tableId: identifier(value.tableId, 'TABLE_ID'), viewId, where, sourceOrder };
}
export function compileQueries(value, allowEmpty = false) {
  if (!object(value) || (!allowEmpty && !Object.keys(value).length) || Object.keys(value).length > 32)
    throw fault('NOCODB_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(value).map(([name, query]) => {
    if (!NAME.test(name) || RESERVED.has(name)) throw fault('NOCODB_QUERY_NAME_INVALID');
    only(query, ['columns'], 'NOCODB_QUERY_INVALID');
    if (!object(query.columns) || !Object.keys(query.columns).length || Object.keys(query.columns).length > 64)
      throw fault('NOCODB_PUBLIC_COLUMNS_REQUIRED');
    const selected = new Set();
    const projection = Object.fromEntries(Object.entries(query.columns).map(([alias, spec]) => {
      if (!NAME.test(alias) || RESERVED.has(alias)) throw fault('NOCODB_COLUMN_NAME_INVALID');
      only(spec, ['source', 'providerType', 'type', 'encoding', 'nullable', 'empty'], 'NOCODB_COLUMN_INVALID');
      const recordId = spec.source === '$recordId';
      if (!recordId) identifier(spec.source, 'FIELD_ID');
      if (selected.has(spec.source) || !['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
          spec.nullable !== undefined && typeof spec.nullable !== 'boolean' ||
          spec.empty !== undefined && !['preserve', 'null'].includes(spec.empty))
        throw fault('NOCODB_COLUMN_INVALID');
      selected.add(spec.source);
      if (recordId ? spec.providerType !== undefined : !SCALAR_TYPES.has(spec.providerType))
        throw fault('NOCODB_SCALAR_FIELD_TYPE_REQUIRED', 'Select a scalar field by its actual field ID and provider type; structured and linked fields are not complete scalar values.');
      const encoding = spec.encoding ?? (recordId && spec.type === 'string' ? 'identity-text' : 'native');
      if (!['native', 'number-text', 'identity-text'].includes(encoding) ||
          encoding === 'identity-text' && (!recordId || spec.type !== 'string') ||
          encoding === 'number-text' && spec.type !== 'string')
        throw fault('NOCODB_VALUE_ENCODING_INVALID');
      const nullable = spec.nullable ?? false, empty = spec.empty ?? 'preserve';
      if (recordId && nullable || empty === 'null' && !nullable) throw fault('NOCODB_NULL_POLICY_INVALID');
      return [alias, { source: spec.source, ...(recordId ? {} : { providerType: spec.providerType }),
        type: spec.type, encoding, nullable, empty }];
    }));
    return [name, { columns: Object.keys(projection), projection, parameters: {}, parameterOrder: [],
      sql: 'NocoDB v3: complete observed pages from the fixed table/view/filter; explicit field-ID projection and native scalar types; no source writes.' }];
  }));
}
export function selectedFields(queries) {
  const result = new Map();
  for (const query of Object.values(queries)) for (const spec of Object.values(query.projection)) {
    if (spec.source === '$recordId') continue;
    if (result.has(spec.source) && result.get(spec.source) !== spec.providerType)
      throw fault('NOCODB_FIELD_TYPE_DECLARATION_CONFLICT');
    result.set(spec.source, spec.providerType);
  }
  if (!result.size) throw fault('NOCODB_PUBLIC_SOURCE_FIELD_REQUIRED', 'Declare at least one actual public field in addition to any record identity.');
  return [...result].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, type]) => ({ id, type }));
}
export function restOptions(config) {
  const connection = config.connection;
  only(connection, ['kind', 'tokenEnv', 'allowHttp', 'pageSize', 'maxPageBytes', 'maxCaptureBytes',
    'maxPages', 'maxRows', 'timeoutMs', 'requestIntervalMs'], 'NOCODB_REST_CONNECTION_INVALID');
  if (connection.kind !== 'rest' || typeof connection.tokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.tokenEnv))
    throw fault('NOCODB_TOKEN_REFERENCE_REQUIRED', 'Reference an existing NocoDB read token through its environment variable.');
  if (connection.allowHttp !== undefined && typeof connection.allowHttp !== 'boolean') throw fault('NOCODB_HTTP_OPTION_INVALID');
  const selected = binding(config), url = new URL(selected.server);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && connection.allowHttp !== true)
    throw fault('NOCODB_HTTPS_REQUIRED', 'Use HTTPS, or explicitly approve this existing private HTTP host in the source file.');
  return { tokenEnv: connection.tokenEnv,
    pageSize: integer(connection.pageSize ?? 100, 1, 1000, 'NOCODB_PAGE_SIZE_INVALID'),
    maxPageBytes: integer(connection.maxPageBytes ?? MAX_PAGE_BYTES, 1024, MAX_PAGE_BYTES, 'NOCODB_PAGE_BYTES_INVALID'),
    maxCaptureBytes: integer(connection.maxCaptureBytes ?? 67108864, 1024, MAX_CAPTURE_BYTES, 'NOCODB_CAPTURE_BYTES_INVALID'),
    maxPages: integer(connection.maxPages ?? 10000, 1, 10000, 'NOCODB_PAGE_LIMIT_INVALID'),
    maxRows: integer(connection.maxRows ?? 1000000, 1, 1000000, 'NOCODB_ROW_LIMIT_INVALID'),
    timeoutMs: integer(connection.timeoutMs ?? 300000, 100, 3600000, 'NOCODB_TIMEOUT_INVALID'),
    requestIntervalMs: integer(connection.requestIntervalMs ?? 250, 200, 30000, 'NOCODB_REQUEST_INTERVAL_INVALID') };
}
export function sourceSelection(config, queries = compileQueries(config.queries)) {
  return { ...binding(config), fields: selectedFields(queries) };
}
export async function readNocoDBSourceFile(filename, { allowUnprojected = false } = {}) {
  const original = await readPrivate(filename);
  let config;
  try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('NOCODB_SOURCE_JSON_INVALID'); }
  only(config, ['schema', 'server', 'apiVersion', 'baseId', 'tableId', 'viewId', 'where', 'sourceOrder', 'connection', 'queries'],
    'NOCODB_SOURCE_CONFIG_INVALID');
  if (config.schema !== 'stellar-forge.nocodb-source.v1') throw fault('NOCODB_SOURCE_CONFIG_INVALID');
  const selected = binding(config), queries = compileQueries(config.queries, allowUnprojected);
  if (config.connection?.kind === 'capture') {
    only(config.connection, ['kind', 'file', 'sha256'], 'NOCODB_CAPTURE_CONNECTION_INVALID');
    if (typeof config.connection.file !== 'string' || !config.connection.file || config.connection.file.includes('\0') ||
        !HASH.test(config.connection.sha256 ?? '')) throw fault('NOCODB_CAPTURE_CONNECTION_INVALID');
  } else restOptions(config);
  return { config, binding: selected, queries, original, hash: digest(original),
    selectionHash: Object.keys(queries).length ? identity(sourceSelection(config, queries)) : null,
    captureFile: config.connection.kind === 'capture' ? resolve(dirname(filename), config.connection.file) : null };
}
