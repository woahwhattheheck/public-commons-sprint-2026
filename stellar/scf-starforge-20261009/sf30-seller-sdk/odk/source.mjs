// MIT. Native ODK Central project, form, version and OData transport.
import { createHash } from 'node:crypto';
import { parseMetadata, getEntitySet } from '../odata/schema.mjs';
import { parsePage } from '../odata/source.mjs';
import { fault, stable } from '../odata/state.mjs';

export const CENTRAL_SOURCE = Object.freeze({
  release: 'v2026.3.1', repository: 'https://github.com/getodk/central-backend',
  commit: 'de0d2a07fd7c9ff698cbc312e550dd40ff058340',
  api: 'https://docs.getodk.org/central-api/',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const retained = ['content-type','content-length','etag','last-modified','date','retry-after','odata-version','request-id'];
export function normalizeCentralUrl(input, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(input); } catch { throw fault('CENTRAL_URL', 'Enter the Central server URL.'); }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || allowLoopback && local && url.protocol === 'http:'))
    throw fault('CENTRAL_URL', 'Use an HTTPS server URL; local HTTP requires allowLoopback.');
  url.pathname = url.pathname.replace(/\/v1\/?$/, '/').replace(/\/?$/, '/');
  return url.href;
}
export function segment(value, label = 'resource identifier') {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !value || value.length > 4096 ||
      value === '.' || value === '..' || /[\u0000-\u001f\u007f]/u.test(value))
    throw fault('CENTRAL_IDENTIFIER', 'Use the original ' + label + '.');
  return encodeURIComponent(value);
}
export function versionToken(value) {
  if (typeof value !== 'string') throw fault('CENTRAL_FORM_VERSION', 'A form version must be its original string, including an explicit empty string.');
  return value === '' ? '___' : segment(value, 'form version');
}
export const formPath = (projectId, formId) => 'projects/' + segment(projectId, 'project ID') + '/forms/' + segment(formId, 'XML form ID');
export const formVersionPath = (projectId, formId, version) => formPath(projectId, formId) + '/versions/' + versionToken(version);
export const submissionPath = (projectId, formId, initialId) => formPath(projectId, formId) + '/submissions/' + segment(initialId, 'initial instance ID');
export function originalSpreadsheet(metadata) {
  return metadata?.excelContentType === 'application/vnd.ms-excel' ? '.xls' :
    metadata?.excelContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ? '.xlsx' : null;
}
function authorization(authEnv) {
  if (typeof authEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(authEnv))
    throw fault('CENTRAL_AUTH_REFERENCE', 'Choose the environment variable containing the complete Central Authorization header.');
  const value = process.env[authEnv];
  if (!value || /[\r\n]/.test(value)) throw fault('CENTRAL_AUTH_MISSING', 'Set the selected Central Authorization environment variable on this host.');
  return value;
}
function boundary(input, base, apiRoot) {
  let url;
  try { url = new URL(input, base); } catch { throw fault('CENTRAL_RESOURCE_URL', 'Central returned an invalid resource URL.', 502); }
  const api = new URL(apiRoot);
  if (url.origin !== api.origin || !url.pathname.startsWith(api.pathname) || url.username || url.password || url.hash)
    throw fault('CENTRAL_RESOURCE_BOUNDARY', 'Central returned a resource outside this connection.', 502);
  return url.href;
}
export function createCentralSource({ url, authEnv, allowLoopback = false, fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const baseUrl = normalizeCentralUrl(url, { allowLoopback }), apiRoot = new URL('v1/', baseUrl).href;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) throw fault('CENTRAL_TIMEOUT', 'Choose a request timeout from one second to one hour.');
  async function request(path, { signal, accept = 'application/json', consume, maxBytes = 64 * 1024 * 1024, optional = false } = {}) {
    const requestedUrl = boundary(path, apiRoot, apiRoot);
    const timed = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timed]) : timed;
    const headers = { Accept: accept, Authorization: authorization(authEnv), 'X-Extended-Metadata': 'true' };
    let target = requestedUrl;
    for (let redirects = 0; redirects <= 5; redirects++) {
      combined.throwIfAborted();
      const response = await fetchImpl(target, { method: 'GET', headers, redirect: 'manual', signal: combined });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 5) throw fault('CENTRAL_REDIRECT', 'Central returned an incomplete or excessive redirect chain.', 502);
        target = boundary(location, target, apiRoot); continue;
      }
      const receipt = { requestedUrl, url: target, status: response.status,
        headers: Object.fromEntries(retained.flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)]] : [])),
        receivedAt: new Date().toISOString() };
      if (!response.ok && !(optional && [404,410].includes(response.status))) {
        await response.body?.cancel();
        throw Object.assign(fault(response.status === 429 ? 'CENTRAL_RATE_LIMIT' : [401,403].includes(response.status) ?
          'CENTRAL_ACCESS' : 'CENTRAL_PROVIDER', 'Central returned HTTP ' + response.status + '.', response.status === 429 ? 429 : 502),
          { providerStatus: response.status, receipt, retryAfter: receipt.headers['retry-after'] ?? null });
      }
      if (consume) return { ...receipt, ...(await consume(response.body)), outcome: response.ok ? 'retained' : 'missing' };
      const chunks = []; let size = 0;
      try {
        for await (const chunk of response.body ?? []) {
          combined.throwIfAborted(); size += chunk.byteLength;
          if (size > maxBytes) throw fault('CENTRAL_RESOURCE_SIZE', 'This structured response exceeds its byte limit; reduce the page size or raise maxBytes.', 413);
          chunks.push(Buffer.from(chunk));
        }
      } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
      const raw = Buffer.concat(chunks, size);
      return { ...receipt, raw, sha256: hash(raw), bytes: raw.length, outcome: response.ok ? 'retained' : 'missing' };
    }
    throw fault('CENTRAL_REDIRECT', 'Central returned too many redirects.', 502);
  }
  async function json(path, options) {
    const result = await request(path, options);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.raw)); }
    catch { throw fault('CENTRAL_JSON', 'Central returned invalid UTF-8 JSON.', 502); }
    return { ...result, value };
  }
  async function catalog(projectId, formId, options) {
    const root = new URL(formPath(projectId, formId) + '.svc', apiRoot).href;
    const service = await json(root, options), metadata = await request(root + '/$metadata', { ...options, accept: 'application/xml' });
    const model = parseMetadata(metadata.raw, { contentType: metadata.headers['content-type'] ?? '', identifierDialect: 'odk-central' });
    if (!service.value || !Array.isArray(service.value.value)) throw fault('CENTRAL_SERVICE', 'The form did not return a native OData service document.', 502);
    const names = new Set();
    const entitySets = service.value.value.filter(value => (value.kind ?? 'EntitySet') === 'EntitySet').map(item => {
      if (typeof item.name !== 'string' || typeof item.url !== 'string' || names.has(item.name))
        throw fault('CENTRAL_SERVICE', 'The Central service document repeats or omits a table identifier.', 502);
      names.add(item.name);
      const selected = getEntitySet(model, item.name), target = boundary(item.url, root + '/', apiRoot);
      if (!new URL(target).pathname.startsWith(new URL(root + '/').pathname))
        throw fault('CENTRAL_TABLE_BOUNDARY', 'The advertised table leaves this form.', 502);
      if (selected.keyFields.length !== 1 || selected.keyFields[0] !== '__id')
        throw fault('CENTRAL_TABLE_KEY', 'This Central table does not expose its native __id key.', 502);
      return { ...selected, url: target };
    });
    if (!names.has('Submissions')) throw fault('CENTRAL_ROOT_TABLE', 'The Central service has no Submissions table.', 502);
    const strip = ({ raw, value, ...receipt }) => receipt;
    return { schema: 'stellar-forge.odata-catalog.v1', ...model, entitySets, identifierDialect: 'odk-central',
      serviceUrl: root + '/', metadataUrl: metadata.url, observedAt: metadata.receivedAt,
      receipts: { service: strip(service), metadata: strip(metadata) }, source: CENTRAL_SOURCE,
      original: { service: service.raw, metadata: metadata.raw } };
  }
  async function page(catalog, query, url = query.url, options = {}) {
    const result = await request(url, { ...options, accept: 'application/json;IEEE754Compatible=true' });
    return parsePage({ catalog, query, raw: result.raw, url: result.url, headers: result.headers, status: result.status, receivedAt: result.receivedAt });
  }
  return { baseUrl, apiRoot, request, json, catalog, page };
}
function date(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw fault('CENTRAL_COHORT_DATE', label + ' requires an ISO UTC timestamp.');
  if (new Date(value).toISOString().slice(0,19) !== value.slice(0,19))
    throw fault('CENTRAL_COHORT_DATE', label + ' is not a calendar timestamp.');
  return new Date(value).toISOString();
}
export function normalizeScope(input = {}) {
  const submittedFrom = date(input.submittedFrom, 'Start'), submittedBefore = date(input.submittedBefore, 'End'),
    updatedSince = date(input.updatedSince, 'Updated since'), pageSize = input.pageSize ?? 1000;
  if (submittedFrom && submittedBefore && submittedFrom >= submittedBefore) throw fault('CENTRAL_COHORT_RANGE', 'The cohort end must follow its start.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000) throw fault('CENTRAL_PAGE_SIZE', 'Choose a page size from 1 to 10,000; the capture follows every continuation page.');
  return { submittedFrom, submittedBefore, updatedSince, pageSize };
}
export function compileCentralQuery(catalog, tableName, input) {
  const scope = normalizeScope(input), set = getEntitySet(catalog, tableName);
  const root = set.name === 'Submissions' ? '' : '$root/Submissions/', filters = [];
  if (scope.submittedFrom) filters.push(root + '__system/submissionDate ge ' + scope.submittedFrom);
  if (scope.submittedBefore) filters.push(root + '__system/submissionDate lt ' + scope.submittedBefore);
  if (scope.updatedSince) filters.push(root + '__system/updatedAt ge ' + scope.updatedSince);
  const url = new URL(set.url); url.searchParams.set('$top', String(scope.pageSize)); url.searchParams.set('$count', 'true');
  if (filters.length) url.searchParams.set('$filter', filters.join(' and '));
  const plan = { entitySet: set.container + '/' + set.name, ...scope, completeFields: true, pagination: 'native-skiptoken' };
  return { url: url.href, entitySet: set.name, entityType: set.entityType, fields: set.fields, keyFields: set.keyFields, plan, fingerprint: hash(stable(plan)) };
}
export function repeatRelations(catalog) {
  return catalog.entitySets.filter(set => set.name !== 'Submissions').map(set => {
    const parents = catalog.entitySets.filter(candidate => set.name.startsWith(candidate.name + '.'))
      .sort((a,b) => b.name.length - a.name.length);
    const parent = parents.find(candidate => set.fields.some(field => field.path === '__' + candidate.name.replaceAll('.', '-') + '-id'));
    if (!parent) throw fault('CENTRAL_REPEAT_RELATION', 'Central repeat ' + set.name + ' has no retained native parent field.', 502);
    return { table: set.name, parentTable: parent.name, parentField: '__' + parent.name.replaceAll('.', '-') + '-id' };
  });
}
