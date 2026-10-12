// MIT. Public Socrata transport and exact source-value handling.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const fail = (code, message, status = 400, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const stable = value => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
export const integer = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw fail('SOCRATA_INPUT', label + ' must be an integer from ' + min + ' to ' + max);
  return value;
};
export function publicDomain(value) {
  if (typeof value !== 'string' || value.length > 253) throw fail('SOCRATA_DOMAIN', 'Enter the public Socrata domain.');
  let url;
  try { url = new URL(value.includes('://') ? value : 'https://' + value); }
  catch { throw fail('SOCRATA_DOMAIN', 'Enter the public Socrata domain.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== '/' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
      !host.includes('.') || host.includes('..') || isIP(host) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host))
    throw fail('SOCRATA_DOMAIN', 'Use a public HTTPS domain without credentials, a port, or a path.');
  return host;
}
export function normalizeSource(raw, { retainOrder = false } = {}) {
  if (!plain(raw)) throw fail('SOCRATA_SOURCE', 'Source settings are required.');
  const domain = publicDomain(raw.domain);
  if (typeof raw.datasetId !== 'string' || !/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(raw.datasetId))
    throw fail('SOCRATA_DATASET_ID', 'Dataset ID must be four lowercase letters or digits, a dash, and four more.');
  const protocol = raw.protocol ?? 'soda2.1';
  if (!['soda2.1', 'soda3'].includes(protocol)) throw fail('SOCRATA_PROTOCOL', 'Choose SODA 2.1 or SODA 3 explicitly.');
  const where = raw.where ?? '', requestedOrder = raw.order?.trim() || ':id';
  for (const [label, value, max] of [['where', where, 16000], ['order', requestedOrder, 2000]]) {
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f;]/.test(value))
      throw fail('SOCRATA_QUERY', label + ' must be one printable SoQL expression without a semicolon.');
  }
  const order = retainOrder || /(^|,)\s*:id(?:\s+(?:ASC|DESC))?\s*(,|$)/i.test(requestedOrder) ?
    requestedOrder : requestedOrder + ',:id';
  return { domain, datasetId: raw.datasetId, protocol, where, order,
    pageSize: integer(raw.pageSize ?? 1000, 'pageSize', 1, 50000),
    maxRows: integer(raw.maxRows ?? 1000000, 'maxRows', 1, 1000000),
    maxBytes: integer(raw.maxBytes ?? 256 * 1024 * 1024, 'maxBytes', 1024, 256 * 1024 * 1024),
    timeoutMs: integer(raw.timeoutMs ?? 30000, 'timeoutMs', 1000, 120000) };
}

// JSON numeric literals retain their original text, including values outside JS's
// safe integer range. Native dataset coercion happens only after an explicit map.
class SourceNumber {
  constructor(text) { this.text = text; }
  toJSON() { return this.text; }
}
export const isSourceNumber = value => value instanceof SourceNumber;
export function sourceJSON(value) {
  if (isSourceNumber(value)) return value.text;
  if (Array.isArray(value)) return '[' + value.map(sourceJSON).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + sourceJSON(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
export function parseRows(bytes) {
  let rows;
  try {
    rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (!context?.source) throw fail('SOCRATA_NODE_VERSION', 'Node.js 24 or later is required to retain numeric source text.');
      return new SourceNumber(context.source);
    });
  } catch (error) {
    if (error.code) throw error;
    throw fail('SOCRATA_RESPONSE', 'The provider page must be a UTF-8 JSON array of records.', 502);
  }
  if (!Array.isArray(rows) || rows.some(row => !plain(row) || isSourceNumber(row)))
    throw fail('SOCRATA_RESPONSE', 'The provider page must be a JSON array of records.', 502);
  return rows;
}
const selectedHeaders = headers => Object.fromEntries(
  ['content-type', 'etag', 'last-modified', 'x-soda2-legacy-types', 'x-soda2-fields', 'x-soda2-types', 'retry-after']
    .flatMap(key => headers.has(key) ? [[key, headers.get(key)]] : []));
const retryAt = value => {
  if (value && /^\d+$/.test(value)) return new Date(Date.now() + Number(value) * 1000).toISOString();
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export async function requestJSON(url, { fetcher = globalThis.fetch, appToken, method = 'GET', body,
  maxBytes = 64 * 1024 * 1024, timeoutMs = 30000 } = {}) {
  const headers = { accept: 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetcher(url, { method, headers, redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw fail('SOCRATA_TRANSPORT', error.name === 'TimeoutError' ? 'The Socrata request timed out; the same capture can resume.' :
      'The public Socrata endpoint could not be reached; the same capture can resume.', 502);
  }
  const capturedHeaders = selectedHeaders(response.headers);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const code = response.status === 429 ? 'SOCRATA_RATE_LIMIT' :
      response.status === 401 || response.status === 403 ? 'SOCRATA_AUTH' :
      response.status === 404 ? 'SOCRATA_NOT_FOUND' : 'SOCRATA_PROVIDER';
    throw fail(code, response.status === 429 ? 'Socrata rate limit reached. Resume after the provider retry time.' :
      'Socrata returned HTTP ' + response.status + '. Check the selected source, protocol, and application token.',
      response.status === 429 ? 429 : 502,
      { providerStatus: response.status, retryAt: retryAt(response.headers.get('retry-after')) });
  }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw fail('SOCRATA_PAGE_BYTES', 'The source response exceeds the capture byte limit. Reduce page size or selection.', 413);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code) throw error;
    throw fail('SOCRATA_TRANSPORT', 'The Socrata response was interrupted; the same page can resume.', 502);
  }
  const bytes = Buffer.concat(chunks);
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('SOCRATA_RESPONSE', 'Socrata returned an invalid UTF-8 JSON response.', 502); }
  return { data, bytes, sha256: sha256(bytes), headers: capturedHeaders, url,
    request: { method, ...(body === undefined ? {} : { body }) }, receivedAt: new Date().toISOString() };
}
export function metadataSummary(data, receipt = {}) {
  if (!plain(data) || !Array.isArray(data.columns)) throw fail('SOCRATA_METADATA', 'The selected view did not return a column schema.', 502);
  const columns = data.columns.filter(column => column.fieldName && !column.fieldName.startsWith(':')).map(column => ({
    fieldName: column.fieldName, name: column.name ?? column.fieldName,
    dataTypeName: column.dataTypeName ?? 'unknown', description: column.description ?? ''
  }));
  if (!columns.length) throw fail('SOCRATA_METADATA', 'The selected view has no exposed source columns.', 502);
  const revision = {
    rowsUpdatedAt: data.rowsUpdatedAt ?? null, viewLastModified: data.viewLastModified ?? null,
    publicationDate: data.publicationDate ?? null,
    schemaSha256: sha256(stable(columns.map(({ fieldName, dataTypeName }) => ({ fieldName, dataTypeName }))))
  };
  return { id: data.id, name: data.name ?? data.id, description: data.description ?? '', columns, revision,
    attribution: data.attribution ?? '', attributionLink: data.attributionLink ?? null,
    licenseId: data.licenseId ?? null, metadataURL: receipt.url ?? null };
}
export const sameRevision = (a, b) => stable(a) === stable(b);
export function queryRequest(source, { offset = 0, count = false } = {}) {
  const suffix = source.where ? ' WHERE ' + source.where : '';
  if (source.protocol === 'soda3') {
    return { url: 'https://' + source.domain + '/api/v3/views/' + source.datasetId + '/query.json',
      method: 'POST', body: { query: count ? 'SELECT count(*) AS count' + suffix :
        'SELECT *' + suffix + ' ORDER BY ' + source.order,
        page: { pageNumber: count ? 1 : Math.floor(offset / source.pageSize) + 1, pageSize: count ? 1 : source.pageSize },
        includeSynthetic: false, includeSystem: false, orderingSpecifier: 'total' } };
  }
  const url = new URL('https://' + source.domain + '/resource/' + source.datasetId + '.json');
  if (source.where) url.searchParams.set('$where', source.where);
  if (count) url.searchParams.set('$select', 'count(*) AS count');
  else { url.searchParams.set('$order', source.order); url.searchParams.set('$limit', String(source.pageSize)); url.searchParams.set('$offset', String(offset)); }
  return { url: url.href, method: 'GET' };
}
export function createSocrataClient({ appToken = process.env.SOCRATA_APP_TOKEN, fetcher = globalThis.fetch } = {}) {
  if (appToken !== undefined && (typeof appToken !== 'string' || !appToken || /[\r\n]/.test(appToken)))
    throw fail('SOCRATA_TOKEN', 'The startup application token must be nonempty text.');
  const request = (source, spec, limit) => {
    if (source.protocol === 'soda3' && !appToken)
      throw fail('SOCRATA_TOKEN_REQUIRED', 'SODA 3 requires an application token. Set SOCRATA_APP_TOKEN or choose the documented SODA 2.1 endpoint.');
    return requestJSON(spec.url, { ...spec, fetcher, appToken, maxBytes: limit ?? source.maxBytes, timeoutMs: source.timeoutMs });
  };
  return {
    async metadata(source) {
      const receipt = await request(source, { url: 'https://' + source.domain + '/api/views/' + source.datasetId + '.json' }, 16 * 1024 * 1024);
      const summary = metadataSummary(receipt.data, receipt);
      if (summary.id !== source.datasetId) throw fail('SOCRATA_DATASET_ID', 'The metadata belongs to another dataset.', 502);
      return { ...receipt, summary };
    },
    async count(source) {
      const receipt = await request(source, queryRequest(source, { count: true }), 1024 * 1024);
      const value = receipt.data?.[0]?.count;
      if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
        throw fail('SOCRATA_COUNT', 'The selected source count was not an exact nonnegative integer.', 502);
      return { ...receipt, count: Number(value) };
    },
    async page(source, offset) {
      integer(offset, 'offset', 0, source.maxRows);
      const receipt = await request(source, queryRequest(source, { offset }));
      if (receipt.headers['x-soda2-legacy-types'] === 'true')
        throw fail('SOCRATA_LEGACY_ENDPOINT', 'This endpoint reports SODA 2.0. Select a documented 2.1 or 3 endpoint before capturing.', 502);
      const rows = parseRows(receipt.bytes);
      if (rows.length > source.pageSize) throw fail('SOCRATA_PAGING', 'The provider returned more rows than the requested page size.', 502);
      return { ...receipt, rows };
    },
    async search({ domain, query = '', offset = 0, limit = 20 } = {}) {
      domain = publicDomain(domain);
      if (typeof query !== 'string' || query.length > 1000) throw fail('SOCRATA_CATALOG', 'Catalog search must be at most 1,000 characters.');
      integer(offset, 'offset', 0, 1000000); integer(limit, 'limit', 1, 100);
      const url = new URL('https://api.us.socrata.com/api/catalog/v1');
      url.searchParams.set('domains', domain); url.searchParams.set('search_context', domain);
      url.searchParams.set('only', 'datasets'); url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit)); url.searchParams.set('offset', String(offset));
      // Domain-scoped discovery needs no private dataset token.
      const receipt = await requestJSON(url.href, { fetcher, maxBytes: 8 * 1024 * 1024 });
      if (!Array.isArray(receipt.data?.results)) throw fail('SOCRATA_CATALOG', 'The public catalog response has no results list.', 502);
      return { query, domain, offset, limit, count: receipt.data.resultSetSize ?? null,
        nextOffset: receipt.data.results.length === limit ? offset + limit : null,
        results: receipt.data.results.map(entry => ({ id: entry.resource?.id, name: entry.resource?.name,
          description: entry.resource?.description ?? '', domain: entry.metadata?.domain, url: entry.permalink,
          updatedAt: entry.resource?.updatedAt ?? null })).filter(entry => entry.id && entry.domain === domain),
        sourceURL: receipt.url, receivedAt: receipt.receivedAt };
    }
  };
}
