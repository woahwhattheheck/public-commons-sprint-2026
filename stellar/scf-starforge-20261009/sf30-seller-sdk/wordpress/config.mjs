// MIT. WordPress REST source declarations and retained-byte identities.
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { SourceNumber } from '../sftp/formats.mjs';
export const SOURCE_SCHEMA = 'stellar-forge.wordpress-source.v1';
export const WORKSPACE_SCHEMA = 'stellar-forge.wordpress-workspace.v1';
export const JOB_SCHEMA = 'stellar-forge.wordpress-capture.v1';
export const EDITION_SCHEMA = 'stellar-forge.wordpress-edition.v1';
export const PACKET_SCHEMA = 'stellar-forge.wordpress-source-packet.v1';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const clone = value => structuredClone(value);
export const now = () => new Date().toISOString();
export const newId = () => randomUUID();
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export const identity = value => sha256(JSON.stringify(canonical(value)));
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function fail(code, message, status = 400, details) {
  throw Object.assign(new Error(message), { code, status, ...(details === undefined ? {} : { details }) });
}
export function only(value, keys, label = 'request') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    fail('WORDPRESS_FIELDS', 'The ' + label + ' contains unsupported fields.');
  return value;
}
export function text(value, maximum, label, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || value.includes('\0'))
    fail('WORDPRESS_TEXT', 'Supply ' + label + ' within ' + maximum + ' characters.');
  return value;
}
export function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('WORDPRESS_NUMBER', 'Supply ' + label + ' between ' + minimum + ' and ' + maximum + '.');
  return value;
}
export function id(value) { if (!UUID.test(value ?? '')) fail('WORDPRESS_ID', 'Select the original saved UUID.'); return value; }
export function hash(value) { if (!HASH.test(value ?? '')) fail('WORDPRESS_HASH', 'Supply the displayed original SHA-256.'); return value; }
export function directory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/')
    fail('WORDPRESS_DIRECTORY', 'Use a normalized absolute private directory.');
  return value;
}
export function routePath(value) {
  text(value, 1200, 'the native REST route');
  if (!value.startsWith('/') || value.includes('//') || /[?#\\\u0000-\u0020]/.test(value) ||
      value.split('/').some(part => ['.','..'].includes(part) || /%(?:2f|5c|2e)/i.test(part)))
    fail('WORDPRESS_ROUTE', 'Use the discovered native REST route.');
  return value.replace(/\/$/, '') || '/';
}
export function validateSource(value) {
  only(value, ['schema','label','apiRoot','context','authentication','perPage','timeoutMs','maxResponseBytes','allowLoopback'], 'source');
  if (value.schema !== SOURCE_SCHEMA) fail('WORDPRESS_SOURCE_SCHEMA', 'Use ' + SOURCE_SCHEMA + '.');
  const label = text(value.label, 160, 'the source label'), raw = text(value.apiRoot, 4096, 'the exact WordPress REST root');
  let url; try { url = new URL(raw); } catch { fail('WORDPRESS_ROOT', 'Supply the site’s actual REST root URL.'); }
  const local = ['127.0.0.1','[::1]','localhost'].includes(url.hostname);
  if (url.username || url.password || url.hash || !['http:','https:'].includes(url.protocol) ||
      (url.protocol !== 'https:' && !(local && value.allowLoopback === true)))
    fail('WORDPRESS_ROOT', 'Use HTTPS, or an explicitly selected loopback WordPress server.');
  const query = [...url.searchParams.keys()];
  if (query.length && (query.length !== 1 || query[0] !== 'rest_route' || url.searchParams.get('rest_route') !== '/'))
    fail('WORDPRESS_ROOT_QUERY', 'The REST root may use only the original rest_route=/ query.');
  if (!query.length && !url.pathname.endsWith('/')) url.pathname += '/';
  if (!['view','embed','edit'].includes(value.context ?? 'view'))
    fail('WORDPRESS_CONTEXT', 'Choose the native view, embed or edit context.');
  const authentication = value.authentication ?? { mode: 'none' };
  only(authentication, ['mode','usernameEnv','passwordEnv'], 'authentication');
  if (!['none','application-password'].includes(authentication.mode))
    fail('WORDPRESS_AUTH', 'Select public access or WordPress application-password access.');
  if (authentication.mode === 'none' && (authentication.usernameEnv || authentication.passwordEnv))
    fail('WORDPRESS_AUTH', 'Public source access has no credential references.');
  if (authentication.mode === 'application-password' &&
      (!ENV.test(authentication.usernameEnv ?? '') || !ENV.test(authentication.passwordEnv ?? '') ||
       authentication.usernameEnv === authentication.passwordEnv))
    fail('WORDPRESS_AUTH_REFERENCE', 'Select separate username and application-password environment references.');
  if (value.context === 'edit' && authentication.mode === 'none')
    fail('WORDPRESS_EDIT_AUTH', 'Select the original WordPress account before using edit context.');
  return {
    schema: SOURCE_SCHEMA, label, apiRoot: url.href, context: value.context ?? 'view',
    authentication: clone(authentication),
    perPage: integer(value.perPage ?? 100, 1, 100, 'the native page size'),
    timeoutMs: integer(value.timeoutMs ?? 30000, 1000, 120000, 'the request timeout'),
    maxResponseBytes: integer(value.maxResponseBytes ?? 16777216, 1024, 67108864, 'the response-byte ceiling'),
    allowLoopback: value.allowLoopback === true,
  };
}
export function credentialReferences(source) {
  return source.authentication.mode === 'none' ? [] : [source.authentication.usernameEnv, source.authentication.passwordEnv];
}
export function requestHeaders(source, environment) {
  const headers = { accept: 'application/json' };
  if (source.authentication.mode === 'application-password') {
    const username = environment[source.authentication.usernameEnv], password = environment[source.authentication.passwordEnv];
    if (typeof username !== 'string' || !username || username.includes(':') ||
        typeof password !== 'string' || !password || /[\r\n]/.test(username + password))
      fail('WORDPRESS_CREDENTIAL_REQUIRED', 'Configure the selected WordPress environment references.', 409);
    headers.authorization = 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
  }
  return headers;
}
export function requestUrl(source, route, query = {}) {
  route = routePath(route);
  const root = new URL(source.apiRoot), url = new URL(root);
  if (root.searchParams.has('rest_route')) url.searchParams.set('rest_route', route);
  else url.pathname = root.pathname.replace(/\/$/, '') + (route === '/' ? '/' : route);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object' && !Array.isArray(value)) fail('WORDPRESS_QUERY', 'Use scalar or array native query values.');
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.href;
}
export function collectionIndex(index, types, taxonomies) {
  if (!object(index) || !Array.isArray(index.namespaces) || !index.namespaces.includes('wp/v2') || !object(index.routes))
    fail('WORDPRESS_DISCOVERY', 'The original REST index must expose wp/v2 and its native routes.', 409);
  if (!object(types) || !object(taxonomies)) fail('WORDPRESS_DISCOVERY', 'Retain the native types and taxonomies responses.', 409);
  const rows = [];
  const add = (key, kind, native) => {
    if (!object(native) || typeof native.rest_base !== 'string') return;
    const route = routePath('/' + (native.rest_namespace || 'wp/v2') + '/' + native.rest_base);
    const registered = index.routes[route];
    if (!object(registered)) return;
    const endpoints = Array.isArray(registered.endpoints) ? registered.endpoints : [];
    const get = endpoints.find(item => (Array.isArray(item.methods) ? item.methods : [item.methods]).includes('GET'));
    if (!get) return;
    rows.push({ key, kind, slug: native.slug || key.split(':').at(-1), name: native.name || native.slug || key,
      route, namespace: native.rest_namespace || 'wp/v2', restBase: native.rest_base,
      hierarchical: native.hierarchical === true, taxonomies: Array.isArray(native.taxonomies) ? native.taxonomies : [],
      types: Array.isArray(native.types) ? native.types : [], arguments: object(get.args) ? clone(get.args) : {},
      native: clone(native) });
  };
  for (const [key, value] of Object.entries(types)) add('type:' + key, key === 'attachment' ? 'media' : 'content', value);
  for (const [key, value] of Object.entries(taxonomies)) add('taxonomy:' + key, 'term', value);
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}
export function validateSelection(value, discovery) {
  only(value, ['collections','maxPages','maxRecords','maxBytes'], 'capture selection');
  if (!Array.isArray(value.collections) || !value.collections.length || value.collections.length > 100)
    fail('WORDPRESS_COLLECTIONS', 'Select between one and 100 discovered native collections.');
  const seen = new Set();
  const collections = value.collections.map(item => {
    only(item, ['key','query'], 'collection selection');
    const selected = discovery.collections.find(row => row.key === item.key);
    if (!selected || seen.has(item.key)) fail('WORDPRESS_COLLECTION', 'Select each retained discovered collection once.');
    seen.add(item.key);
    const query = item.query ?? {};
    if (!object(query) || Object.keys(query).length > 40) fail('WORDPRESS_QUERY', 'Use a native query object.');
    for (const [key, field] of Object.entries(query)) {
      if (!Object.hasOwn(selected.arguments, key) || ['context','page','per_page','offset','_fields','_embed','_envelope','password'].includes(key))
        fail('WORDPRESS_QUERY_ARGUMENT', 'Select a supported original filter; capture owns context and pagination.', 400, { key });
      const values = Array.isArray(field) ? field : [field];
      if (values.length > 1000 || values.some(v => !['string','number','boolean'].includes(typeof v) ||
          (typeof v === 'number' && !Number.isFinite(v)) || String(v).length > 2000))
        fail('WORDPRESS_QUERY_VALUE', 'Use native scalar filter values.');
    }
    return { key: item.key, query: clone(query) };
  });
  return { collections, maxPages: integer(value.maxPages ?? 10000, 1, 100000, 'the capture page ceiling'),
    maxRecords: integer(value.maxRecords ?? 1000000, 1, 10000000, 'the capture record ceiling'),
    maxBytes: integer(value.maxBytes ?? 536870912, 1024, 4294967296, 'the retained capture-byte ceiling') };
}
export function nativeQuery(source, collection, selection, page) {
  const args = collection.arguments ?? {}, query = { ...selection.query };
  if (Object.hasOwn(args, 'context')) query.context = source.context;
  if (Object.hasOwn(args, 'per_page')) query.per_page = source.perPage;
  if (Object.hasOwn(args, 'page')) query.page = page;
  else if (page !== 1) fail('WORDPRESS_PAGINATION', 'This native route has no page argument; select its complete original API.');
  if (Object.hasOwn(args, 'orderby') && query.orderby === undefined &&
      (!Array.isArray(args.orderby.enum) || args.orderby.enum.includes('id'))) query.orderby = 'id';
  if (Object.hasOwn(args, 'order') && query.order === undefined) query.order = 'asc';
  return query;
}
export function nativeIdentity(record, collection) {
  const original = record?.id instanceof SourceNumber ? record.id.text : Number.isSafeInteger(record?.id) ? String(record.id) : '';
  if (!/^[1-9][0-9]*$/.test(original) || !Number.isSafeInteger(Number(original)))
    fail('WORDPRESS_NATIVE_ID', 'A native collection record has no exact positive integer ID.', 409);
  return collection.key + ':' + original;
}
export function pointer(value, path) {
  if (path === '') return value;
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 1000 || /~(?![01])/u.test(path))
    fail('WORDPRESS_POINTER', 'Use an RFC 6901 JSON pointer into the retained native record.');
  for (const part of path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
export function errorRecord(error) {
  return { code: typeof error.code === 'string' ? error.code : 'WORDPRESS_OPERATION_FAILED',
    message: String(error.message || 'The source operation did not complete.').slice(0,2000),
    ...(error.details === undefined ? {} : { details: error.details }) };
}
