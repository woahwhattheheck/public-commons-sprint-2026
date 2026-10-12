// MIT. Native read-only OData 4 discovery, reviewed queries and page transport.
import { createHash } from 'node:crypto';
import { parseMetadata, parseLossless, normalizeEntity, getEntitySet, underlyingType,
  numberText, plain, fail, SourceNumber } from './schema.mjs';
export { parseMetadata, getEntitySet, fail };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const maximum = (value, label, fallback, max) => {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail('ODATA_LIMIT', label + ' must be an integer from 1 to ' + max + '.');
  return value;
};
export function normalizeSourceUrl(input, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(input); } catch { throw fail('ODATA_SOURCE_URL', 'Enter the OData service root URL.'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || url.hash || url.search ||
      !(url.protocol === 'https:' || allowLoopback && loopback && url.protocol === 'http:'))
    throw fail('ODATA_SOURCE_URL', 'Use an HTTPS service root without URL credentials, query options or a fragment. Local HTTP requires allowLoopback.');
  if (url.pathname.endsWith('/$metadata')) url.pathname = url.pathname.slice(0, -'$metadata'.length);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
function selectedUrl(input, base, serviceUrl) {
  let url;
  try { url = new URL(input, base); } catch { throw fail('ODATA_PROVIDER_URL', 'The service returned an invalid resource URL.', 502); }
  const root = new URL(serviceUrl);
  if (url.username || url.password || url.hash || url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    throw fail('ODATA_SOURCE_BOUNDARY', 'The resource URL leaves the selected OData service. Configure that service separately.', 502);
  return url.href;
}
const retainedHeaders = response => Object.fromEntries([
  'content-type','etag','last-modified','odata-version','odata-entityid','preference-applied',
  'retry-after','request-id','x-ms-request-id','date','content-length'
].flatMap(key => response.headers.has(key) ? [[key, response.headers.get(key)]] : []));
const authHeader = authEnv => {
  if (authEnv === undefined || authEnv === null || authEnv === '') return null;
  if (typeof authEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(authEnv))
    throw fail('ODATA_AUTH_REFERENCE', 'authEnv names the environment variable containing the complete Authorization header.');
  const value = process.env[authEnv];
  if (!value || /[\r\n]/.test(value)) throw fail('ODATA_AUTH_MISSING', 'Set the selected Authorization environment variable before connecting.');
  return value;
};
/** The only network operation: GET, same service redirects, bounded bytes and time. */
async function requestSource(url, { serviceUrl, fetchImpl = globalThis.fetch, signal, authEnv,
  maxBytes = 16 * 1024 * 1024, timeoutMs = 30000, accept, prefer } = {}) {
  maxBytes = maximum(maxBytes, 'maxBytes', 16 * 1024 * 1024, 256 * 1024 * 1024);
  timeoutMs = maximum(timeoutMs, 'timeoutMs', 30000, 600000);
  const authorization = authHeader(authEnv), deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const requestedUrl = selectedUrl(url, serviceUrl, serviceUrl);
  let target = requestedUrl;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      combined.throwIfAborted();
      const headers = { Accept: accept ?? 'application/json;IEEE754Compatible=true',
        'OData-MaxVersion': '4.01' };
      if (authorization) headers.Authorization = authorization;
      if (prefer) headers.Prefer = prefer;
      const response = await fetchImpl(target, { method: 'GET', headers, redirect: 'manual', signal: combined });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw fail('ODATA_REDIRECT', 'The service returned a redirect without a destination.', 502);
        target = selectedUrl(location, target, serviceUrl);
        if (redirects === 5) throw fail('ODATA_REDIRECT_LIMIT', 'The service returned too many redirects.', 502);
        continue;
      }
      const selected = retainedHeaders(response);
      if (!response.ok) {
        await response.body?.cancel();
        throw fail(response.status === 429 ? 'ODATA_RATE_LIMIT' : response.status === 401 || response.status === 403 ?
          'ODATA_AUTH' : 'ODATA_PROVIDER', 'The OData service returned HTTP ' + response.status + '.',
          response.status === 429 ? 429 : 502, { providerStatus: response.status, sourceUrl: target,
            headers: selected, retryAfter: selected['retry-after'] ?? null });
      }
      const version = (response.headers.get('odata-version') ?? '').split(';')[0].trim();
      if (version && !['4.0', '4.01'].includes(version)) {
        await response.body?.cancel(); throw fail('ODATA_VERSION', 'The source responded with unsupported OData version ' + version + '.', 502);
      }
      const declaredBytes = response.headers.get('content-length');
      if (declaredBytes && /^\d+$/.test(declaredBytes) && BigInt(declaredBytes) > BigInt(maxBytes)) {
        await response.body?.cancel(); throw fail('ODATA_PAGE_BYTES', 'The source page exceeds maxBytes. Increase the reviewed byte limit or narrow the selection.', 413);
      }
      const chunks = []; let length = 0;
      if (!response.body) throw fail('ODATA_EMPTY_RESPONSE', 'The service returned an empty response body.', 502);
      for await (const chunk of response.body) {
        combined.throwIfAborted(); length += chunk.length;
        if (length > maxBytes) throw fail('ODATA_PAGE_BYTES', 'The source page exceeds maxBytes. The prior retained pages can resume.', 413);
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      return { raw, requestedUrl, url: target, status: response.status, headers: selected,
        sha256: sha256(raw), receivedAt: new Date().toISOString() };
    }
  } catch (error) {
    if (signal?.aborted) throw fail('ODATA_CANCELLED', 'The capture was cancelled. Its committed pages remain resumable.', 409);
    if (deadline.aborted) throw fail('ODATA_TIMEOUT', 'The OData page timed out. Resume the same retained page.', 504);
    if (error.code) throw error;
    throw fail('ODATA_TRANSPORT', 'The OData request was interrupted. Resume the same retained page.', 502);
  }
}
const requireJson = receipt => {
  const contentType = (receipt.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType.endsWith('+json'))
    throw fail('ODATA_JSON_REQUIRED', 'The service must return an OData JSON representation.', 502);
};
const jsonDocument = receipt => { requireJson(receipt); return parseLossless(receipt.raw); };
const persistedReceipt = ({ raw, ...receipt }) => ({ ...receipt, rawBase64: raw.toString('base64') });
/** Discover the real root service document and CSDL; never infer schema from sample rows. */
export async function discoverService({ url, fetchImpl, signal, authEnv, allowLoopback = false,
  maxBytes, timeoutMs, metadataUrl } = {}) {
  const serviceUrl = normalizeSourceUrl(url, { allowLoopback });
  const options = { serviceUrl, fetchImpl, signal, authEnv, maxBytes, timeoutMs };
  const service = await requestSource(serviceUrl, options), document = jsonDocument(service);
  if (!plain(document) || !Array.isArray(document.value) || document.value.some(item => !plain(item) || typeof item.name !== 'string' || typeof item.url !== 'string'))
    throw fail('ODATA_SERVICE_DOCUMENT', 'The service root did not return an OData service document.', 502);
  const requestedMetadata = selectedUrl(metadataUrl ?? '$metadata', serviceUrl, serviceUrl);
  const metadata = await requestSource(requestedMetadata, { ...options, accept: 'application/xml, application/json;q=0.9' });
  const model = parseMetadata(metadata.raw, { contentType: metadata.headers['content-type'] ?? '' });
  const advertised = document.value.filter(item => (item.kind ?? 'EntitySet') === 'EntitySet');
  const advertisedNames = new Set();
  const entitySets = advertised.map(item => {
    if (advertisedNames.has(item.name)) throw fail('ODATA_SERVICE_DOCUMENT', 'The service document repeats an entity set.', 502);
    advertisedNames.add(item.name);
    const candidates = model.entitySets.filter(set => set.name === item.name || set.container + '/' + set.name === item.name);
    if (candidates.length !== 1) throw fail('ODATA_SERVICE_SCHEMA', 'Advertised entity set ' + item.name + ' has no unique CSDL definition.', 502);
    return { ...candidates[0], title: typeof item.title === 'string' ? item.title : item.name,
      url: selectedUrl(item.url, service.url, serviceUrl) };
  });
  if (!entitySets.length) throw fail('ODATA_NO_ENTITY_SETS', 'This service document advertises no entity sets.', 502);
  return { schema: 'stellar-forge.odata-catalog.v1', ...model, entitySets, serviceUrl,
    metadataUrl: metadata.url, observedAt: new Date().toISOString(),
    receipts: { service: persistedReceipt(service), metadata: persistedReceipt(metadata) } };
}
const nonnegative = (value, label, max) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw fail('ODATA_PLAN', label + ' must be a nonnegative integer no larger than ' + max + '.');
  return value;
};
const numericTypes = new Set(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32','Edm.Int64','Edm.Decimal','Edm.Single','Edm.Double']);
const comparableTypes = new Set([...numericTypes, 'Edm.String','Edm.Boolean','Edm.Guid','Edm.Date','Edm.DateTimeOffset','Edm.TimeOfDay','Edm.Duration']);
const ranges = {
  'Edm.Byte': [0n,255n], 'Edm.SByte': [-128n,127n], 'Edm.Int16': [-32768n,32767n],
  'Edm.Int32': [-2147483648n,2147483647n], 'Edm.Int64': [-9223372036854775808n,9223372036854775807n]
};
function literal(catalog, field, value) {
  if (value === null) return 'null';
  const type = underlyingType(catalog, field.type);
  if (type === 'Edm.String') {
    if (typeof value !== 'string' || value.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
      throw fail('ODATA_FILTER_VALUE', field.path + ' requires a text value of at most 16384 characters.');
    return "'" + value.replace(/'/g, "''") + "'";
  }
  if (type === 'Edm.Boolean') {
    if (value !== true && value !== false) throw fail('ODATA_FILTER_VALUE', field.path + ' requires true or false.');
    return String(value);
  }
  if (numericTypes.has(type)) {
    if (typeof value !== 'number' && typeof value !== 'string') throw fail('ODATA_FILTER_VALUE', field.path + ' requires an exact numeric value.');
    if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw fail('ODATA_FILTER_PRECISION', 'Enter large integers or exact decimals as JSON strings.');
    const text = String(value);
    if (text.length > 256 || !(ranges[type] ? /^-?(?:0|[1-9]\d*)$/.test(text) : /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)))
      throw fail('ODATA_FILTER_VALUE', field.path + ' requires a valid ' + type + ' literal.');
    if (ranges[type]) {
      const integer = BigInt(text), [min, max] = ranges[type];
      if (integer < min || integer > max) throw fail('ODATA_FILTER_RANGE', field.path + ' is outside ' + type + ' range.');
    }
    return text;
  }
  const formats = {
    'Edm.Guid': /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Edm.Date': /^\d{4}-\d{2}-\d{2}$/,
    'Edm.DateTimeOffset': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,12})?(?:Z|[+-]\d{2}:\d{2})$/,
    'Edm.TimeOfDay': /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,12})?$/,
    'Edm.Duration': /^-?P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/
  };
  if (formats[type]) {
    if (typeof value !== 'string' || !formats[type].test(value)) throw fail('ODATA_FILTER_VALUE', field.path + ' requires a valid ' + type + ' string.');
    if (['Edm.Date', 'Edm.DateTimeOffset'].includes(type)) {
      const [year, month, day] = value.slice(0, 10).split('-').map(Number);
      const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
      if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
          !Number.isFinite(Date.parse(type === 'Edm.Date' ? value + 'T00:00:00Z' : value)))
        throw fail('ODATA_FILTER_VALUE', field.path + ' requires a valid calendar value.');
    }
    return type === 'Edm.Duration' ? "duration'" + value + "'" : value;
  }
  const enumeration = catalog.enumTypes[type];
  if (enumeration) {
    const members = typeof value === 'string' ? value.split(',').map(member => member.trim()) : [];
    if (!members.length || new Set(members).size !== members.length || members.some(member => !Object.hasOwn(enumeration.members, member)) ||
        !enumeration.isFlags && members.length !== 1)
      throw fail('ODATA_FILTER_VALUE', field.path + ' requires declared members of ' + type + '.');
    return type + "'" + members.join(',') + "'";
  }
  throw fail('ODATA_FILTER_TYPE', 'This query builder does not compare ' + type + '.');
}
/** Compile only schema-resolved, typed options. The reviewed plan is reusable after restart. */
export function compileQuery(catalog, input) {
  if (!plain(catalog) || catalog.schema !== 'stellar-forge.odata-catalog.v1' || !plain(input))
    throw fail('ODATA_PLAN', 'Discover a service and provide an OData query plan.');
  const allowed = new Set(['entitySet','select','filters','filterMode','orderBy','top','count','pageSize']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw fail('ODATA_PLAN', 'The query plan contains unsupported options.');
  const set = getEntitySet(catalog, input.entitySet), fieldMap = new Map(set.fields.map(field => [field.path, field]));
  const select = input.select ?? set.fields.filter(field => !field.path.includes('/')).map(field => field.path);
  if (!Array.isArray(select) || !select.length || select.length > 2048 || select.some(path => typeof path !== 'string' || !fieldMap.has(path)))
    throw fail('ODATA_SELECT', 'Select one or more declared structural properties.');
  const selection = [...new Set([...select, ...set.keyFields])];
  const fields = selection.map(path => ({ ...fieldMap.get(path), key: set.keyFields.includes(path) }));
  const filters = input.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 100) throw fail('ODATA_FILTER', 'Use at most 100 structured filter conditions.');
  const expressions = filters.map(condition => {
    if (!plain(condition) || Object.keys(condition).some(key => !['field','op','value'].includes(key)) ||
        !Object.hasOwn(condition, 'value')) throw fail('ODATA_FILTER', 'Each filter needs field, op and value.');
    const field = fieldMap.get(condition.field), op = condition.op;
    if (!field || field.collection) throw fail('ODATA_FILTER_FIELD', 'Filter fields must be declared scalar properties.');
    const type = underlyingType(catalog, field.type);
    if (['contains','startswith','endswith'].includes(op)) {
      if (type !== 'Edm.String' || typeof condition.value !== 'string') throw fail('ODATA_FILTER_TYPE', op + ' requires a text field and text value.');
      return op + '(' + field.path + ',' + literal(catalog, field, condition.value) + ')';
    }
    if (!['eq','ne','gt','ge','lt','le'].includes(op) || !comparableTypes.has(type) && !catalog.enumTypes[type])
      throw fail('ODATA_FILTER_TYPE', 'Choose a supported comparison for the declared field type.');
    if (condition.value === null && !['eq','ne'].includes(op)) throw fail('ODATA_FILTER_NULL', 'Null supports eq and ne comparisons.');
    if (['Edm.Boolean'].includes(type) || catalog.enumTypes[type]) {
      if (!['eq','ne'].includes(op)) throw fail('ODATA_FILTER_TYPE', 'Boolean and enum properties support eq and ne here.');
    }
    return field.path + ' ' + op + ' ' + literal(catalog, field, condition.value);
  });
  const mode = input.filterMode ?? 'and';
  if (!['and','or'].includes(mode)) throw fail('ODATA_FILTER', 'filterMode must be and or or.');
  const requestedOrder = input.orderBy ?? [];
  if (!Array.isArray(requestedOrder) || requestedOrder.length > 100) throw fail('ODATA_ORDER', 'orderBy must be an array of declared scalar fields.');
  const orderBy = requestedOrder.map(order => {
    if (!plain(order) || Object.keys(order).some(key => !['field','direction'].includes(key)))
      throw fail('ODATA_ORDER', 'Each sort needs field and direction.');
    const field = fieldMap.get(order.field), direction = typeof order.direction === 'string' ? order.direction.toLowerCase() :
      order.direction === undefined ? 'asc' : '';
    if (!field || field.collection || !comparableTypes.has(underlyingType(catalog, field.type)) || !['asc','desc'].includes(direction))
      throw fail('ODATA_ORDER', 'Choose a comparable declared field and asc or desc.');
    return { field: field.path, direction };
  });
  if (new Set(orderBy.map(order => order.field)).size !== orderBy.length) throw fail('ODATA_ORDER', 'A sort field may occur only once.');
  for (const key of set.keyFields) if (!orderBy.some(order => order.field === key)) orderBy.push({ field: key, direction: 'asc' });
  const pageSize = maximum(input.pageSize, 'pageSize', 1000, 100000);
  if (input.count !== undefined && typeof input.count !== 'boolean') throw fail('ODATA_PLAN', 'count must be true or false.');
  const plan = { entitySet: set.container + '/' + set.name, select: selection, filters: structuredClone(filters),
    filterMode: mode, orderBy, count: input.count ?? true, pageSize };
  if (input.top !== undefined && input.top !== null) plan.top = nonnegative(input.top, 'top', 1000000000);
  const url = new URL(selectedUrl(set.url, catalog.serviceUrl, catalog.serviceUrl));
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('$')) url.searchParams.delete(key);
  url.searchParams.set('$select', selection.join(','));
  if (expressions.length) url.searchParams.set('$filter', expressions.map(expression => '(' + expression + ')').join(' ' + mode + ' '));
  if (orderBy.length) url.searchParams.set('$orderby', orderBy.map(order => order.field + ' ' + order.direction).join(','));
  if (plan.count) url.searchParams.set('$count', 'true');
  if (plan.top !== undefined) url.searchParams.set('$top', String(plan.top));
  return { url: url.href, entitySet: set.name, entityType: set.entityType, fields, keyFields: [...set.keyFields],
    plan, prefer: 'odata.maxpagesize=' + pageSize, fingerprint: sha256(canonical({ metadata: catalog.receipts.metadata.sha256, serviceUrl: catalog.serviceUrl, plan })) };
}
const valueAt = (row, path) => path.split('/').reduce((value, part) => plain(value) && Object.hasOwn(value, part) ? value[part] : undefined, row);
/** Parse retained bytes through the same schema without another provider request. */
export function parsePage({ catalog, query, raw, url = query.url, headers = {}, status = 200, receivedAt } = {}) {
  const doc = parseLossless(raw);
  if (!plain(doc) || !Array.isArray(doc.value) || doc.value.some(value => !plain(value)) || doc.error)
    throw fail('ODATA_COLLECTION', 'The provider must return an OData entity collection with a value array.', 502);
  const set = getEntitySet(catalog, query.plan.entitySet);
  const rows = doc.value.map(row => normalizeEntity(catalog, set.entityType, row));
  for (const row of rows) for (const key of set.keyFields) {
    if (valueAt(row, key) === undefined || valueAt(row, key) === null)
      throw fail('ODATA_KEY_MISSING', 'The provider omitted key property ' + key + ' from the selected collection.', 502);
  }
  const rawCount = doc['@odata.count'] ?? doc['@count'];
  let count = null;
  if (rawCount !== undefined) {
    const text = numberText(rawCount);
    if (!(rawCount instanceof SourceNumber || typeof rawCount === 'string') || !/^(?:0|[1-9]\d*)$/.test(text))
      throw fail('ODATA_COUNT', 'The provider count is not an exact nonnegative integer.', 502);
    count = text;
  }
  const next = doc['@odata.nextLink'] ?? doc['@nextLink'];
  if (next !== undefined && (typeof next !== 'string' || !next)) throw fail('ODATA_NEXT_LINK', 'The provider returned an invalid nextLink.', 502);
  const nextLink = next === undefined ? null : selectedUrl(next, url, catalog.serviceUrl);
  const delta = doc['@odata.deltaLink'] ?? doc['@deltaLink'];
  return { rows, nextLink, count, raw: Buffer.from(raw), status, headers,
    source: { url, sha256: sha256(raw), receivedAt: receivedAt ?? new Date().toISOString(), etag: headers.etag ?? null,
      context: doc['@odata.context'] ?? doc['@context'] ?? null, originalNextLink: next ?? null,
      deltaLink: typeof delta === 'string' ? selectedUrl(delta, url, catalog.serviceUrl) : null } };
}
/** Fetch exactly one initial or retained continuation URL; the workspace commits it before advancing. */
export async function fetchPage({ catalog, query, url = query?.url, fetchImpl, signal, authEnv,
  maxBytes, timeoutMs } = {}) {
  if (!catalog?.serviceUrl || !query?.plan) throw fail('ODATA_QUERY_REQUIRED', 'Compile the reviewed query before capturing.');
  const receipt = await requestSource(url, { serviceUrl: catalog.serviceUrl, fetchImpl, signal, authEnv,
    maxBytes, timeoutMs, prefer: query.prefer });
  requireJson(receipt);
  const page = parsePage({ catalog, query, raw: receipt.raw, url: receipt.url, headers: receipt.headers,
    status: receipt.status, receivedAt: receipt.receivedAt });
  page.source.requestedUrl = receipt.requestedUrl;
  return page;
}
