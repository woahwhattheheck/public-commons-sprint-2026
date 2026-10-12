// MIT. Sequential original Baserow reads; credentials stay on their API route.
import { setTimeout as delay } from 'node:timers/promises';
import { object, identity, fault, stamp } from '../postgres/publisher/files.mjs';
import { binding, restOptions, integer } from './declaration.mjs';

export const SAFE_HEADERS = Object.freeze(['content-type', 'content-length', 'date', 'etag', 'last-modified',
  'content-disposition', 'x-request-id', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining']);
export function metadataUrl(selected) {
  const url = selected.kind === 'public-grid' ?
    new URL(selected.server + '/api/database/views/' + selected.slug + '/public/info/') :
    new URL(selected.server + '/api/database/fields/table/' + selected.tableId + '/');
  if (selected.kind === 'table' && selected.viewId !== null) url.searchParams.set('view', String(selected.viewId));
  return url;
}
export function recordsUrl(selection, pageSize) {
  const url = selection.kind === 'public-grid' ?
    new URL(selection.server + '/api/database/views/grid/' + selection.slug + '/public/rows/') :
    new URL(selection.server + '/api/database/rows/table/' + selection.tableId + '/');
  url.searchParams.set(selection.kind === 'public-grid' ? 'include_fields' : 'include', selection.fields.map(item => 'field_' + item.id).join(','));
  if (selection.kind === 'table' && selection.viewId !== null) url.searchParams.set('view_id', String(selection.viewId));
  if (selection.filters !== null) url.searchParams.set('filters', JSON.stringify(selection.filters));
  if (selection.search !== null) url.searchParams.set('search', selection.search);
  if (selection.orderBy.length) url.searchParams.set('order_by', selection.orderBy.map(item =>
    (item.direction === 'desc' ? '-' : '') + 'field_' + item.field).join(','));
  // Both original APIs support page/size. Omitting limit_linked_items retains all
  // native related-row id/value/order entries instead of a truncated display list.
  url.searchParams.set('page', '1'); url.searchParams.set('size', String(pageSize));
  return url;
}
export function validateRecordUrl(value, selection, { expectedPage, requestedPageSize, appliedQuerySize = null } = {}) {
  let url;
  try { url = new URL(value, selection.server + '/'); } catch { throw fault('BASEROW_NEXT_URL_INVALID'); }
  const initial = recordsUrl(selection, requestedPageSize);
  if (url.origin !== initial.origin || url.pathname !== initial.pathname || url.username || url.password || url.hash)
    throw fault('BASEROW_NEXT_SOURCE_CHANGED', 'The continuation left the original API server or view/table.');
  const keys = [...initial.searchParams.keys()];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) ||
      keys.some(key => url.searchParams.getAll(key).length !== 1)) throw fault('BASEROW_NEXT_QUERY_CHANGED');
  const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('size'));
  if (!Number.isSafeInteger(page) || page !== expectedPage || !Number.isSafeInteger(size) ||
      size < 1 || size > requestedPageSize || appliedQuerySize !== null && size !== appliedQuerySize)
    throw fault('BASEROW_NEXT_PAGE_CHANGED');
  for (const key of keys.filter(key => !['page', 'size', 'include', 'include_fields', 'filters'].includes(key)))
    if (url.searchParams.get(key) !== initial.searchParams.get(key)) throw fault('BASEROW_NEXT_SELECTION_CHANGED');
  const include = url.searchParams.get(selection.kind === 'public-grid' ? 'include_fields' : 'include').split(',');
  if (new Set(include).size !== include.length ||
      identity([...include].sort()) !== identity(selection.fields.map(item => 'field_' + item.id).sort()))
    throw fault('BASEROW_NEXT_FIELDS_CHANGED');
  if (selection.filters !== null) {
    let current;
    try { current = JSON.parse(url.searchParams.get('filters')); } catch { throw fault('BASEROW_NEXT_FILTER_CHANGED'); }
    if (identity(current) !== identity(selection.filters)) throw fault('BASEROW_NEXT_FILTER_CHANGED');
  }
  return { url, page, size };
}
export function checkedHeaders(value = {}) {
  if (!object(value) || Object.keys(value).some(key => !SAFE_HEADERS.includes(key))) throw fault('BASEROW_CAPTURE_HEADERS_INVALID');
  for (const text of Object.values(value)) if (typeof text !== 'string' || text.length > 2048 || /[\r\n\0]/.test(text))
    throw fault('BASEROW_CAPTURE_HEADERS_INVALID');
  return value;
}
export function inspectMetadataBytes(content, selected, fields = null) {
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
  catch { throw fault('BASEROW_METADATA_JSON_INVALID'); }
  const publicView = selected.kind === 'public-grid';
  const inventory = publicView ? raw?.fields : raw, view = publicView ? raw?.view : null;
  if (!Array.isArray(inventory) || !inventory.length || inventory.length > 10000 ||
      publicView && (!object(view) || view.id !== selected.slug || view.slug !== selected.slug || view.type !== 'grid' || view.public !== true))
    throw fault('BASEROW_METADATA_BINDING_CHANGED');
  const byId = new Map();
  for (const field of inventory) {
    if (!object(field) || typeof field.name !== 'string' || typeof field.type !== 'string' ||
        !/^[a-z][a-z0-9_]{0,95}$/.test(field.type)) throw fault('BASEROW_FIELD_METADATA_INVALID');
    integer(field.id, 1, Number.MAX_SAFE_INTEGER, 'BASEROW_FIELD_METADATA_INVALID');
    if (byId.has(field.id) || !publicView && field.table_id !== selected.tableId) throw fault('BASEROW_FIELD_BINDING_CHANGED');
    byId.set(field.id, field);
  }
  if (fields !== null) for (const selectedField of fields) {
    const current = byId.get(selectedField.id);
    if (!current || current.type !== selectedField.type) throw fault('BASEROW_SELECTED_FIELD_CHANGED', 'Review the original field visibility and native type before another capture.');
  }
  for (const item of selected.orderBy)
    if (!byId.has(item.field)) throw fault('BASEROW_ORDER_FIELD_CHANGED');
  const retained = fields === null ? inventory : fields.map(item => byId.get(item.id));
  // Public table/database/workspace IDs are deliberate zero placeholders. The
  // shared slug is the real public identity; never turn those placeholders into
  // private table IDs or a credentialed URL.
  const schema = { kind: selected.kind, tableId: selected.tableId, slug: selected.slug, viewId: selected.viewId,
    fields: retained, publicView: view };
  return { raw, fields: inventory, view, schema, schemaSha256: identity(schema) };
}
export function checkedAttachmentUrl(value, origins, allowHttp = false) {
  let url;
  try { url = new URL(value); } catch { throw fault('BASEROW_ATTACHMENT_URL_INVALID'); }
  if (!origins.includes(url.origin) || url.username || url.password || url.hash ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !allowHttp)
    throw fault('BASEROW_ATTACHMENT_ORIGIN_NOT_REVIEWED', 'Add the original storage origin to the reviewed attachment source options.');
  return url;
}
export function createBaserowReader(config, { env = process.env, signal } = {}) {
  const selected = binding(config), options = restOptions(config);
  const credentials = {};
  const token = reference => {
    const value = env[reference];
    if (typeof value !== 'string' || !value.length || value.length > 16384 || /[^\x21-\x7e]/.test(value))
      throw fault('BASEROW_TOKEN_MISSING', 'Supply the existing read token through its configured environment reference.');
    return value;
  };
  if (options.tokenEnv) credentials.authorization = 'Token ' + token(options.tokenEnv);
  if (options.publicTokenEnv) credentials['Baserow-View-Authorization'] = 'JWT ' + token(options.publicTokenEnv);
  const timeout = AbortSignal.timeout(options.timeoutMs), abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let lastStarted = 0;
  const failure = (code, status = null, headers = {}) => {
    const issue = fault(code);
    if (status !== null) issue.providerStatus = status;
    if (headers['retry-after']) issue.retryAfter = headers['retry-after'];
    if (headers['x-request-id']) issue.requestId = headers['x-request-id'];
    return issue;
  };
  async function request(url, { maximum = options.maxPageBytes, attachment = null } = {}) {
    const initial = url.href, redirects = [];
    if (attachment) checkedAttachmentUrl(initial, attachment.allowedOrigins, config.connection.allowHttp === true);
    else if (url.origin !== new URL(selected.server).origin || url.username || url.password || url.hash ||
        !url.href.startsWith(selected.server + '/api/database/')) throw fault('BASEROW_REQUEST_ORIGIN_CHANGED');
    while (true) {
      const wait = options.requestIntervalMs - (Date.now() - lastStarted);
      try { if (wait > 0) await delay(wait, undefined, { signal: abort }); }
      catch { throw failure(timeout.aborted ? 'BASEROW_CAPTURE_TIMEOUT' : 'BASEROW_CAPTURE_CANCELLED'); }
      lastStarted = Date.now();
      let response;
      try { response = await fetch(url, { method: 'GET', redirect: 'manual', signal: abort,
        headers: attachment ? { accept: '*/*' } : { accept: 'application/json', ...credentials } }); }
      catch { throw failure(signal?.aborted ? 'BASEROW_CAPTURE_CANCELLED' : timeout.aborted ? 'BASEROW_CAPTURE_TIMEOUT' : 'BASEROW_PROVIDER_UNREACHABLE'); }
      const headers = checkedHeaders(Object.fromEntries(SAFE_HEADERS.filter(name => response.headers.has(name)).map(name => [name, response.headers.get(name)])));
      if (attachment && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects.length >= 3) throw failure('BASEROW_ATTACHMENT_REDIRECT_INVALID', response.status);
        const next = checkedAttachmentUrl(new URL(location, url).href, attachment.allowedOrigins, config.connection.allowHttp === true);
        if (next.href === initial || redirects.some(item => item.to === next.href)) throw failure('BASEROW_ATTACHMENT_REDIRECT_LOOP');
        redirects.push({ from: url.href, to: next.href, status: response.status, receivedAt: stamp(), headers }); url = next;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        const codes = { 400: 'BASEROW_REQUEST_INVALID', 401: 'BASEROW_AUTHORIZATION_REQUIRED', 403: 'BASEROW_READ_SCOPE_REQUIRED',
          404: 'BASEROW_SOURCE_NOT_FOUND', 429: 'BASEROW_RATE_LIMITED' };
        throw failure(codes[response.status] ?? 'BASEROW_PROVIDER_FAILED', response.status, headers);
      }
      if (!attachment && !/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) {
        await response.body?.cancel(); throw failure('BASEROW_JSON_RESPONSE_REQUIRED');
      }
      if (Number(headers['content-length'] ?? 0) > maximum) {
        await response.body?.cancel(); throw failure(attachment ? 'BASEROW_ATTACHMENT_TOO_LARGE' : 'BASEROW_PAGE_TOO_LARGE');
      }
      const chunks = []; let size = 0;
      try {
        if (!response.body) throw failure('BASEROW_RESPONSE_MISSING');
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > maximum) throw failure(attachment ? 'BASEROW_ATTACHMENT_TOO_LARGE' : 'BASEROW_PAGE_TOO_LARGE');
          chunks.push(chunk);
        }
      } catch (issue) {
        if (issue.code?.startsWith('BASEROW_')) throw issue;
        throw failure(signal?.aborted ? 'BASEROW_CAPTURE_CANCELLED' : timeout.aborted ? 'BASEROW_CAPTURE_TIMEOUT' : 'BASEROW_RESPONSE_INTERRUPTED');
      }
      return { content: Buffer.concat(chunks), status: 200, receivedAt: stamp(), requestUrl: initial, finalUrl: url.href, redirects, headers };
    }
  }
  return { options, selected, signal: abort,
    get: url => request(url),
    getAttachment: (url, attachment) => request(url, { maximum: attachment.maxFileBytes, attachment }) };
}
export async function discoverBaserowTable(config, options = {}) {
  const reader = createBaserowReader(config, options), observed = await reader.get(metadataUrl(reader.selected));
  const result = inspectMetadataBytes(observed.content, reader.selected);
  return { schema: 'stellar-forge.baserow-discovery.v1', source: reader.selected, receivedAt: observed.receivedAt,
    requestUrl: observed.requestUrl, schemaSha256: result.schemaSha256,
    title: result.view?.name ?? 'Baserow table ' + reader.selected.tableId,
    publicView: result.view, fields: result.fields.map(field => ({
      id: field.id, key: 'field_' + field.id, name: field.name, type: field.type, metadata: field,
      suggestedEncoding: ['single_select', 'multiple_select', 'link_row', 'file', 'lookup', 'multiple_collaborators'].includes(field.type) ? 'json-text' : 'native' })),
    originalOrder: { requested: reader.selected.orderBy, publicViewSortings: result.view?.sortings ?? null,
      tieBreak: ['order', 'id'], savedPublicSortApplied: reader.selected.kind === 'public-grid' ? false : null } };
}
