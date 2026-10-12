// MIT. Bind the original Baserow view/table and explicitly reviewed public fields.
import { dirname, resolve } from 'node:path';
import { object, readPrivate, digest, identity, fault } from '../postgres/publisher/files.mjs';

export const HASH = /^[a-f0-9]{64}$/;
export const MAX_CAPTURE_BYTES = 268435456;
export const MAX_PAGE_BYTES = 16777216;
export const MAX_FILE_BYTES = 33554432;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const FIELD = /^field_([1-9][0-9]{0,14})$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
export function only(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
}
export function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
}
export function fieldId(value) {
  const match = typeof value === 'string' && FIELD.exec(value);
  if (!match) throw fault('BASEROW_FIELD_ID_INVALID', 'Select the original field_<id> key, rather than a display name.');
  return integer(Number(match[1]), 1, Number.MAX_SAFE_INTEGER, 'BASEROW_FIELD_ID_INVALID');
}
export function serverUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fault('BASEROW_SERVER_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /%2f|%5c|%2e/i.test(url.pathname) || url.pathname.includes('//'))
    throw fault('BASEROW_SERVER_INVALID', 'Use the original API server and optional fixed proxy path without credentials or query parameters.');
  return url.origin + url.pathname.replace(/\/$/, '');
}
function filters(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 8) throw fault('BASEROW_FILTER_DEPTH_INVALID');
  only(value, ['filter_type', 'filters', 'groups'], 'BASEROW_FILTER_INVALID');
  if (!['AND', 'OR'].includes(value.filter_type) || !Array.isArray(value.filters ?? []) ||
      !Array.isArray(value.groups ?? []) || (value.filters?.length ?? 0) > 100 || (value.groups?.length ?? 0) > 100)
    throw fault('BASEROW_FILTER_INVALID');
  return { filter_type: value.filter_type, filters: (value.filters ?? []).map(item => {
    only(item, ['field', 'type', 'value'], 'BASEROW_FILTER_INVALID');
    integer(item.field, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_FILTER_FIELD_INVALID');
    if (typeof item.type !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(item.type) ||
        typeof item.value !== 'string' || item.value.length > 8192 || item.value.includes('\0'))
      throw fault('BASEROW_FILTER_INVALID');
    return { field: item.field, type: item.type, value: item.value };
  }), groups: (value.groups ?? []).map(item => filters(item, depth + 1)) };
}
export function binding(value) {
  const server = serverUrl(value.server);
  if (!['public-grid', 'table'].includes(value.kind)) throw fault('BASEROW_SOURCE_KIND_REQUIRED');
  let slug = null, tableId = null, viewId = null;
  if (value.kind === 'public-grid') {
    if (typeof value.slug !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.slug) ||
        value.tableId != null || value.viewId != null) throw fault('BASEROW_PUBLIC_GRID_INVALID');
    slug = value.slug;
  } else {
    tableId = integer(value.tableId, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_TABLE_ID_INVALID');
    if (value.slug != null) throw fault('BASEROW_PRIVATE_TABLE_INVALID');
    if (value.viewId != null) viewId = integer(value.viewId, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_VIEW_ID_INVALID');
  }
  if (!Array.isArray(value.orderBy ?? []) || (value.orderBy?.length ?? 0) > 8) throw fault('BASEROW_ORDER_INVALID');
  const seen = new Set(), orderBy = (value.orderBy ?? []).map(item => {
    only(item, ['field', 'direction'], 'BASEROW_ORDER_INVALID');
    integer(item.field, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_ORDER_FIELD_INVALID');
    if (seen.has(item.field) || !['asc', 'desc'].includes(item.direction)) throw fault('BASEROW_ORDER_INVALID');
    seen.add(item.field); return { field: item.field, direction: item.direction };
  });
  const search = value.search ?? null;
  if (search !== null && (typeof search !== 'string' || !search.length || search.length > 8192 || search.includes('\0')))
    throw fault('BASEROW_SEARCH_INVALID');
  const grouped = filters(value.filters);
  if (JSON.stringify(grouped).length > 32768) throw fault('BASEROW_FILTER_TOO_LARGE');
  return { server, kind: value.kind, slug, tableId, viewId, filters: grouped, search, orderBy };
}
export function compileQueries(value, allowEmpty = false) {
  if (!object(value) || (!allowEmpty && !Object.keys(value).length) || Object.keys(value).length > 32)
    throw fault('BASEROW_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(value).map(([name, query]) => {
    if (!NAME.test(name) || RESERVED.has(name)) throw fault('BASEROW_QUERY_NAME_INVALID');
    only(query, ['columns'], 'BASEROW_QUERY_INVALID');
    if (!object(query.columns) || !Object.keys(query.columns).length || Object.keys(query.columns).length > 64)
      throw fault('BASEROW_PUBLIC_COLUMNS_REQUIRED');
    const projection = Object.fromEntries(Object.entries(query.columns).map(([alias, spec]) => {
      if (!NAME.test(alias) || RESERVED.has(alias)) throw fault('BASEROW_COLUMN_NAME_INVALID');
      only(spec, ['source', 'providerType', 'type', 'encoding', 'nullable', 'empty'], 'BASEROW_COLUMN_INVALID');
      const nativeIdentity = ['$recordId', '$order'].includes(spec.source);
      if (!nativeIdentity) fieldId(spec.source);
      if (!['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
          spec.nullable !== undefined && typeof spec.nullable !== 'boolean' ||
          spec.empty !== undefined && !['preserve', 'null'].includes(spec.empty))
        throw fault('BASEROW_COLUMN_INVALID');
      if (nativeIdentity ? spec.providerType !== undefined :
          typeof spec.providerType !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(spec.providerType))
        throw fault('BASEROW_PROVIDER_FIELD_TYPE_REQUIRED');
      const encoding = spec.encoding ?? (nativeIdentity && spec.type === 'string' ? 'identity-text' : 'native');
      if (!['native', 'identity-text', 'number-text', 'decimal-number', 'json-text', 'select-value', 'attachments'].includes(encoding) ||
          ['identity-text', 'number-text', 'json-text', 'select-value', 'attachments'].includes(encoding) && spec.type !== 'string' ||
          encoding === 'identity-text' && !nativeIdentity ||
          encoding === 'decimal-number' && !['number', 'integer'].includes(spec.type) ||
          encoding === 'select-value' && spec.providerType !== 'single_select' ||
          encoding === 'attachments' && spec.providerType !== 'file')
        throw fault('BASEROW_VALUE_ENCODING_INVALID');
      const nullable = spec.nullable ?? false, empty = spec.empty ?? 'preserve';
      if (nativeIdentity && nullable || empty === 'null' && !nullable) throw fault('BASEROW_NULL_POLICY_INVALID');
      return [alias, { source: spec.source, ...(nativeIdentity ? {} : { providerType: spec.providerType }),
        type: spec.type, encoding, nullable, empty }];
    }));
    return [name, { columns: Object.keys(projection), projection, parameters: {}, parameterOrder: [],
      sql: 'Baserow: complete observed pages from the fixed public grid or authorized table/view; original field IDs and exact values; source reads only.' }];
  }));
}
export function selectedFields(queries) {
  const result = new Map();
  for (const query of Object.values(queries)) for (const spec of Object.values(query.projection)) {
    if (['$recordId', '$order'].includes(spec.source)) continue;
    const id = fieldId(spec.source);
    if (result.has(id) && result.get(id) !== spec.providerType) throw fault('BASEROW_FIELD_TYPE_DECLARATION_CONFLICT');
    result.set(id, spec.providerType);
  }
  if (!result.size) throw fault('BASEROW_PUBLIC_SOURCE_FIELD_REQUIRED');
  return [...result].sort(([a], [b]) => a - b).map(([id, type]) => ({ id, type }));
}
export function attachmentOptions(config, queries = compileQueries(config.queries)) {
  const value = config.attachments ?? { mode: 'metadata' };
  only(value, ['mode', 'allowedOrigins', 'maxFileBytes', 'maxFiles'], 'BASEROW_ATTACHMENT_OPTIONS_INVALID');
  if (!['metadata', 'retain'].includes(value.mode)) throw fault('BASEROW_ATTACHMENT_MODE_REQUIRED');
  const origins = value.allowedOrigins ?? [];
  if (!Array.isArray(origins) || origins.length > 32 || origins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password; }
    catch { return true; }
  }) || new Set(origins).size !== origins.length) throw fault('BASEROW_ATTACHMENT_ORIGINS_INVALID');
  if (value.mode === 'retain' && !origins.length) throw fault('BASEROW_ATTACHMENT_ORIGINS_REQUIRED');
  if (value.mode !== 'retain' && (origins.length || value.maxFileBytes !== undefined || value.maxFiles !== undefined))
    throw fault('BASEROW_ATTACHMENT_OPTIONS_INVALID');
  if (value.mode !== 'retain' && Object.values(queries).some(query =>
      Object.values(query.projection).some(spec => spec.encoding === 'attachments')))
    throw fault('BASEROW_RETAINED_ATTACHMENTS_REQUIRED');
  return { mode: value.mode, allowedOrigins: [...origins].sort(),
    maxFileBytes: integer(value.maxFileBytes ?? MAX_FILE_BYTES, 1, MAX_FILE_BYTES, 'BASEROW_ATTACHMENT_SIZE_INVALID'),
    maxFiles: integer(value.maxFiles ?? 10000, 1, 10000, 'BASEROW_ATTACHMENT_LIMIT_INVALID') };
}
export function restOptions(config) {
  const value = config.connection;
  only(value, ['kind', 'tokenEnv', 'publicTokenEnv', 'allowHttp', 'pageSize', 'maxPageBytes', 'maxCaptureBytes',
    'maxPages', 'maxRows', 'timeoutMs', 'requestIntervalMs'], 'BASEROW_REST_CONNECTION_INVALID');
  const selected = binding(config);
  const environmentName = name => typeof name === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(name);
  if (value.kind !== 'rest' || selected.kind === 'table' && !environmentName(value.tokenEnv) ||
      selected.kind === 'public-grid' && value.tokenEnv !== undefined ||
      selected.kind === 'table' && value.publicTokenEnv !== undefined ||
      value.publicTokenEnv !== undefined && !environmentName(value.publicTokenEnv))
    throw fault('BASEROW_TOKEN_REFERENCE_INVALID', 'Reference a database read token for private rows, or the existing public-view authorization token for a protected shared view.');
  if (value.allowHttp !== undefined && typeof value.allowHttp !== 'boolean') throw fault('BASEROW_HTTP_OPTION_INVALID');
  const url = new URL(selected.server);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && value.allowHttp !== true)
    throw fault('BASEROW_HTTPS_REQUIRED');
  return { tokenEnv: value.tokenEnv ?? null, publicTokenEnv: value.publicTokenEnv ?? null,
    pageSize: integer(value.pageSize ?? 100, 1, 200, 'BASEROW_PAGE_SIZE_INVALID'),
    maxPageBytes: integer(value.maxPageBytes ?? MAX_PAGE_BYTES, 1024, MAX_PAGE_BYTES, 'BASEROW_PAGE_BYTES_INVALID'),
    maxCaptureBytes: integer(value.maxCaptureBytes ?? 67108864, 1024, MAX_CAPTURE_BYTES, 'BASEROW_CAPTURE_BYTES_INVALID'),
    maxPages: integer(value.maxPages ?? 10000, 1, 10000, 'BASEROW_PAGE_LIMIT_INVALID'),
    maxRows: integer(value.maxRows ?? 1000000, 1, 1000000, 'BASEROW_ROW_LIMIT_INVALID'),
    timeoutMs: integer(value.timeoutMs ?? 600000, 100, 3600000, 'BASEROW_TIMEOUT_INVALID'),
    requestIntervalMs: integer(value.requestIntervalMs ?? 250, 100, 30000, 'BASEROW_REQUEST_INTERVAL_INVALID') };
}
export function sourceSelection(config, queries = compileQueries(config.queries)) {
  return { ...binding(config), fields: selectedFields(queries), attachments: attachmentOptions(config, queries) };
}
export async function readBaserowSourceFile(filename, { allowUnprojected = false } = {}) {
  const original = await readPrivate(filename);
  let config;
  try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('BASEROW_SOURCE_JSON_INVALID'); }
  only(config, ['schema', 'server', 'kind', 'slug', 'tableId', 'viewId', 'filters', 'search', 'orderBy',
    'connection', 'attachments', 'queries'], 'BASEROW_SOURCE_CONFIG_INVALID');
  if (config.schema !== 'stellar-forge.baserow-source.v1') throw fault('BASEROW_SOURCE_CONFIG_INVALID');
  const selected = binding(config), queries = compileQueries(config.queries, allowUnprojected);
  attachmentOptions(config, queries);
  if (config.connection?.kind === 'capture') {
    only(config.connection, ['kind', 'file', 'sha256'], 'BASEROW_CAPTURE_CONNECTION_INVALID');
    if (typeof config.connection.file !== 'string' || !config.connection.file || config.connection.file.includes('\0') ||
        !HASH.test(config.connection.sha256 ?? '')) throw fault('BASEROW_CAPTURE_CONNECTION_INVALID');
  } else restOptions(config);
  return { config, binding: selected, queries, original, hash: digest(original),
    selectionHash: Object.keys(queries).length ? identity(sourceSelection(config, queries)) : null,
    captureFile: config.connection.kind === 'capture' ? resolve(dirname(filename), config.connection.file) : null };
}
