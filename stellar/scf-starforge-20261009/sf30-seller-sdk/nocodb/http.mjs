// MIT. Sequential, fixed-origin read-only NocoDB v3 access.
import { setTimeout as delay } from 'node:timers/promises';
import { object, identity, fault, stamp } from '../postgres/publisher/files.mjs';
import { binding, restOptions, SCALAR_TYPES, identifier } from './declaration.mjs';

export const SAFE_HEADERS = Object.freeze(['content-type', 'date', 'etag', 'last-modified',
  'x-request-id', 'x-nocodb-version', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining']);
export function tableUrl(selected) {
  return new URL(selected.server + '/api/v3/meta/bases/' + selected.baseId + '/tables/' + selected.tableId);
}
export function countUrl(selection) {
  const url = new URL(selection.server + '/api/v3/data/' + selection.baseId + '/' + selection.tableId + '/count');
  if (selection.viewId !== null) url.searchParams.set('viewId', selection.viewId);
  if (selection.where !== null) url.searchParams.set('where', selection.where);
  return url;
}
export function recordsUrl(selection, pageSize) {
  const url = new URL(selection.server + '/api/v3/data/' + selection.baseId + '/' + selection.tableId + '/records');
  url.searchParams.set('fields', selection.fields.map(item => item.id).join(','));
  url.searchParams.set('fieldIdOnResult', 'true');
  url.searchParams.set('sort', JSON.stringify(selection.sourceOrder));
  if (selection.viewId !== null) url.searchParams.set('viewId', selection.viewId);
  if (selection.where !== null) url.searchParams.set('where', selection.where);
  url.searchParams.set('page', '1'); url.searchParams.set('pageSize', String(pageSize));
  return url;
}
function fieldsFromQuery(values) {
  const items = values.flatMap(value => {
    if (value.startsWith('[')) {
      try { const parsed = JSON.parse(value); if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed; }
      catch {}
      throw fault('NOCODB_NEXT_FIELDS_CHANGED');
    }
    return value.split(',');
  });
  if (new Set(items).size !== items.length) throw fault('NOCODB_NEXT_FIELDS_CHANGED');
  return items.sort();
}
export function validateRecordUrl(value, selection, { expectedPage, maximumPageSize, appliedPageSize = null } = {}) {
  let url;
  try { url = new URL(value, selection.server + '/'); } catch { throw fault('NOCODB_NEXT_URL_INVALID'); }
  const initial = recordsUrl(selection, maximumPageSize);
  if (url.origin !== initial.origin || url.pathname !== initial.pathname || url.username || url.password || url.hash)
    throw fault('NOCODB_NEXT_SOURCE_CHANGED', 'The provider continuation left the reviewed server or table.');
  const keys = ['fields', 'fieldIdOnResult', 'sort', 'viewId', 'where', 'page', 'pageSize'];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) ||
      keys.filter(key => key !== 'fields').some(key => url.searchParams.getAll(key).length > 1))
    throw fault('NOCODB_NEXT_QUERY_CHANGED');
  const page = Number(url.searchParams.get('page')), pageSize = Number(url.searchParams.get('pageSize'));
  if (!Number.isSafeInteger(page) || page !== expectedPage ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximumPageSize ||
      appliedPageSize !== null && pageSize !== appliedPageSize)
    throw fault('NOCODB_NEXT_PAGE_CHANGED', 'Use the provider continuation with its resolved page size and consecutive page number.');
  // The current original paginator carries these selections. No omitted or changed
  // filter/view/field selection is silently widened into a different dataset.
  if (identity(fieldsFromQuery(url.searchParams.getAll('fields'))) !== identity(selection.fields.map(item => item.id).sort()) ||
      url.searchParams.get('fieldIdOnResult') !== 'true' ||
      url.searchParams.get('viewId') !== selection.viewId || url.searchParams.get('where') !== selection.where)
    throw fault('NOCODB_NEXT_SELECTION_CHANGED');
  let sort;
  try { sort = JSON.parse(url.searchParams.get('sort')); } catch { throw fault('NOCODB_NEXT_SORT_CHANGED'); }
  if (!Array.isArray(sort) && object(sort)) sort = [sort];
  if (identity(sort) !== identity(selection.sourceOrder)) throw fault('NOCODB_NEXT_SORT_CHANGED');
  return { url, page, pageSize };
}
export function checkedHeaders(value = {}) {
  if (!object(value) || Object.keys(value).some(key => !SAFE_HEADERS.includes(key))) throw fault('NOCODB_CAPTURE_HEADERS_INVALID');
  for (const text of Object.values(value)) if (typeof text !== 'string' || text.length > 1024 || /[\r\n\0]/.test(text))
    throw fault('NOCODB_CAPTURE_HEADERS_INVALID');
  return value;
}
export function inspectTableBytes(content, selected, fields = null) {
  let table;
  try { table = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw fault('NOCODB_TABLE_JSON_INVALID'); }
  if (!object(table) || table.id !== selected.tableId || table.base_id !== selected.baseId || !Array.isArray(table.fields) ||
      !table.fields.length || table.fields.length > 10000)
    throw fault('NOCODB_TABLE_BINDING_CHANGED');
  const inventory = new Map();
  for (const field of table.fields) {
    if (!object(field) || typeof field.type !== 'string' || typeof field.title !== 'string') throw fault('NOCODB_FIELD_METADATA_INVALID');
    identifier(field.id, 'FIELD_ID');
    if (inventory.has(field.id)) throw fault('NOCODB_FIELD_ID_DUPLICATE');
    inventory.set(field.id, field);
  }
  if (fields !== null) for (const order of selected.sourceOrder) {
    const field = inventory.get(order.field);
    if (!field || !(SCALAR_TYPES.has(field.type) || field.type === 'ID')) throw fault('NOCODB_ORDER_FIELD_CHANGED');
  }
  if (fields !== null) for (const field of table.fields) {
    if (field.type === 'ID' && !selected.sourceOrder.some(order => order.field === field.id))
      throw fault('NOCODB_IDENTITY_ORDER_REQUIRED', 'Include the generated native identity field in the source order.');
  }
  if (fields) for (const field of fields) {
    if (!inventory.has(field.id)) throw fault('NOCODB_SELECTED_FIELD_NOT_FOUND');
    if (inventory.get(field.id).type !== field.type) throw fault('NOCODB_PROVIDER_FIELD_TYPE_CHANGED', 'Review the current native field type before creating a new capture.');
  }
  let view = null;
  if (selected.viewId !== null) {
    if (Array.isArray(table.views)) {
      view = table.views.find(item => item.id === selected.viewId);
      if (!view) throw fault('NOCODB_VIEW_NOT_IN_TABLE');
    } else view = { id: selected.viewId, selection: 'explicit-provider-query' };
  }
  const relevant = new Set(fields === null ? table.fields.map(field => field.id) : [...fields.map(item => item.id), ...selected.sourceOrder.map(item => item.field)]);
  const schema = { tableId: table.id, baseId: table.base_id, workspaceId: table.workspace_id ?? null,
    sourceId: table.source_id ?? null, view: view === null ? null : { id: view.id, type: view.view_type ?? null },
    fields: [...relevant].sort().map(id => { const field = inventory.get(id);
      return { id, type: field.type, options: field.options ?? null }; }) };
  return { table, schema, schemaSha256: identity(schema) };
}
export function createNocoDBReader(config, { env = process.env, signal } = {}) {
  const selected = binding(config), options = restOptions(config), token = env[options.tokenEnv];
  if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
    throw fault('NOCODB_TOKEN_MISSING', 'Supply the existing read token through the configured environment reference.');
  const timeout = AbortSignal.timeout(options.timeoutMs), abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let lastStarted = 0;
  const failure = (code, status = null, headers = {}) => {
    const issue = fault(code);
    if (status !== null) issue.providerStatus = status;
    if (headers['retry-after']) issue.retryAfter = headers['retry-after'];
    if (headers['x-request-id']) issue.requestId = headers['x-request-id'];
    return issue;
  };
  return { options, selected, signal: abort, async get(url) {
    if (url.origin !== new URL(selected.server).origin || url.username || url.password || url.hash)
      throw fault('NOCODB_REQUEST_ORIGIN_CHANGED');
    const wait = options.requestIntervalMs - (Date.now() - lastStarted);
    try { if (wait > 0) await delay(wait, undefined, { signal: abort }); }
    catch { throw failure(timeout.aborted ? 'NOCODB_CAPTURE_TIMEOUT' : 'NOCODB_CAPTURE_CANCELLED'); }
    lastStarted = Date.now();
    let response;
    try { response = await fetch(url, { method: 'GET', redirect: 'error', signal: abort,
      headers: { accept: 'application/json', 'xc-token': token } }); }
    catch { throw failure(signal?.aborted ? 'NOCODB_CAPTURE_CANCELLED' : timeout.aborted ? 'NOCODB_CAPTURE_TIMEOUT' : 'NOCODB_PROVIDER_UNREACHABLE'); }
    const headers = checkedHeaders(Object.fromEntries(SAFE_HEADERS.filter(name => response.headers.has(name)).map(name => [name, response.headers.get(name)])));
    if (response.status !== 200) {
      await response.body?.cancel();
      const codes = { 400: 'NOCODB_REQUEST_INVALID', 401: 'NOCODB_TOKEN_OR_PROJECT_INVALID', 402: 'NOCODB_PROVIDER_PLAN_REQUIRED',
        403: 'NOCODB_READ_SCOPE_REQUIRED', 404: 'NOCODB_SOURCE_NOT_FOUND', 422: 'NOCODB_FIELD_VIEW_OR_PAGE_INVALID',
        429: 'NOCODB_RATE_LIMITED' };
      throw failure(codes[response.status] ?? 'NOCODB_PROVIDER_FAILED', response.status, headers);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) {
      await response.body?.cancel(); throw failure('NOCODB_JSON_RESPONSE_REQUIRED');
    }
    if (Number(response.headers.get('content-length') ?? 0) > options.maxPageBytes) {
      await response.body?.cancel(); throw failure('NOCODB_PAGE_TOO_LARGE');
    }
    const chunks = []; let size = 0;
    try {
      if (!response.body) throw failure('NOCODB_RESPONSE_MISSING');
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > options.maxPageBytes) throw failure('NOCODB_PAGE_TOO_LARGE');
        chunks.push(chunk);
      }
    } catch (issue) {
      if (issue.code?.startsWith('NOCODB_')) throw issue;
      throw failure(signal?.aborted ? 'NOCODB_CAPTURE_CANCELLED' : timeout.aborted ? 'NOCODB_CAPTURE_TIMEOUT' : 'NOCODB_RESPONSE_INTERRUPTED');
    }
    return { content: Buffer.concat(chunks), receivedAt: stamp(), requestUrl: url.href, headers };
  } };
}
export async function discoverNocoDBTable(config, options = {}) {
  const reader = createNocoDBReader(config, options), observation = await reader.get(tableUrl(reader.selected));
  const { table, schemaSha256 } = inspectTableBytes(observation.content, reader.selected);
  return { schema: 'stellar-forge.nocodb-discovery.v1', source: reader.selected, receivedAt: observation.receivedAt,
    requestUrl: observation.requestUrl, schemaSha256, title: table.title, workspaceId: table.workspace_id ?? null,
    sourceId: table.source_id ?? null, fields: table.fields.map(field => ({ id: field.id, title: field.title, type: field.type,
      scalarProjectionSupported: SCALAR_TYPES.has(field.type), generatedRecordIdentity: field.type === 'ID' })),
    views: (table.views ?? []).map(view => ({ id: view.id, title: view.title, type: view.view_type })),
    scope: 'Table metadata only. Source values, nullability and exact public projection still require a reviewed full capture.' };
}
