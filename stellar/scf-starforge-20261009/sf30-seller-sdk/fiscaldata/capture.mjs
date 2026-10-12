// MIT. Original public Treasury source protocol; no projected/aggregated capture.
import { identity, digest, fault, object } from '../postgres/publisher/files.mjs';

export const API_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
export const CATALOG_URL = 'https://api.fiscaldata.treasury.gov/services/dtg/metadata/';
export const FIELD = /^[a-z][a-z0-9_]{0,127}$/;
const TYPE_KEYS = ['labels', 'dataTypes', 'dataFormats'];
const metadataKeys = value => Object.keys(value).sort().join('\n');
export const textValue = (value, maximum = 8192) => typeof value === 'string' &&
  value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

export function endpointPath(value) {
  if (typeof value !== 'string') throw fault('ENDPOINT_REQUIRED', 'Choose an original Treasury endpoint.');
  value = value.replace(/^\/services\/api\/fiscal_service/, '');
  if (!/^\/v[12](?:\/[a-z0-9_]+){2,8}$/.test(value))
    throw fault('ENDPOINT_INVALID', 'Use an original /v1/ or /v2/ Treasury dataset endpoint.');
  return value;
}
export function sourceQuery(source, page = 1, pageSize = source.pageSize) {
  const url = new URL(API_BASE + endpointPath(source.endpoint));
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000)
    throw fault('SOURCE_PAGE_INVALID', 'Choose a page size from 1 to 10000.');
  if (!textValue(source.filter ?? '') || !textValue(source.sort ?? '', 2048))
    throw fault('SOURCE_QUERY_INVALID', 'Use a supported Treasury filter and sort expression.');
  if (source.sort && !/^-?[a-z][a-z0-9_]*(?:,-?[a-z][a-z0-9_]*)*$/.test(source.sort))
    throw fault('SOURCE_SORT_INVALID', 'Sort by original field names separated by commas; prefix descending fields with a minus.');
  if (source.filter) url.searchParams.set('filter', source.filter);
  if (source.sort) url.searchParams.set('sort', source.sort);
  url.searchParams.set('format', 'json');
  url.searchParams.set('page[number]', String(page));
  url.searchParams.set('page[size]', String(pageSize));
  return url.href;
}
export async function fetchFiscal(url, { signal, maxBytes = 8 * 1024 ** 2, timeoutMs = 30000 } = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.fiscaldata.treasury.gov' ||
      parsed.username || parsed.password || parsed.hash ||
      parsed.href !== CATALOG_URL && !parsed.pathname.startsWith('/services/api/fiscal_service/'))
    throw fault('SOURCE_ORIGIN_INVALID', 'Use the original public Treasury API.');
  const startedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(parsed, { redirect: 'error', signal: signal ?
      AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'TokenJunkieLabs-FiscalData-Workspace/1.0' } });
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw fault('SOURCE_RESPONSE_LIMIT', 'This native response exceeds the configured page byte limit. Keep the original job and use a smaller page size for a fresh capture.', 413);
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const headers = Object.fromEntries(['date', 'content-type', 'content-length', 'etag', 'last-modified', 'retry-after', 'cache-control', 'link']
      .filter(key => response.headers.has(key)).map(key => [key, response.headers.get(key)]));
    return { body, receipt: { url: parsed.href, status: response.status, startedAt,
      observedAt: new Date().toISOString(), size, sha256: digest(body), headers } };
  } catch (error) {
    if (error.status || signal?.aborted) throw error;
    throw Object.assign(fault('SOURCE_NETWORK', 'The original Treasury request did not complete. Resume this saved capture when the service is available.', 502),
      { sourceReceipt: { url: parsed.href, startedAt, observedAt: new Date().toISOString(), error: error.code ?? error.name ?? 'FETCH_FAILED' } });
  }
}
export function jsonResponse(response) {
  if (response.receipt.status !== 200) {
    const status = response.receipt.status;
    throw Object.assign(fault(status === 429 ? 'SOURCE_RATE_LIMIT' : 'SOURCE_HTTP_STATUS',
      'Treasury returned HTTP ' + status + '. The original response is retained; resume the same job after reviewing it.', status === 429 ? 429 : 502),
      { retryAfter: response.receipt.headers['retry-after'] ?? null });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.receipt.headers['content-type'] ?? ''))
    throw fault('SOURCE_CONTENT_TYPE', 'The original Treasury response is not JSON.', 502);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); }
  catch { throw fault('SOURCE_JSON_INVALID', 'The original Treasury JSON could not be decoded.', 502); }
}
function sourceInteger(value, name) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) throw fault('SOURCE_COUNTS_INVALID', 'Treasury returned an invalid ' + name + '.', 502);
  return value;
}
function linkPage(link, name, expected, source, pageSize) {
  if (expected === null) {
    if (link !== null) throw fault('SOURCE_PAGINATION_CHANGED', 'The original ' + name + ' pagination link does not end at the reported boundary.', 409);
    return;
  }
  if (typeof link !== 'string' || link.length > 16384)
    throw fault('SOURCE_PAGINATION_INVALID', 'The original pagination link is missing or invalid.', 502);
  let parameters;
  if (link.startsWith('&') || link.startsWith('?')) parameters = new URLSearchParams(link.slice(1));
  else {
    const url = new URL(link, API_BASE + source.endpoint);
    if (url.origin !== new URL(API_BASE).origin || url.pathname !== new URL(API_BASE + source.endpoint).pathname)
      throw fault('SOURCE_PAGINATION_ORIGIN', 'Treasury pagination changed its endpoint.', 409);
    parameters = url.searchParams;
  }
  const expectedQuery = new URL(sourceQuery(source, expected, pageSize)).searchParams;
  const seen = new Set();
  for (const [key, value] of parameters) {
    if (seen.has(key) || !expectedQuery.has(key) || expectedQuery.get(key) !== value)
      throw fault('SOURCE_PAGINATION_CHANGED', 'The original pagination link changed the pinned capture query.', 409);
    seen.add(key);
  }
  if (parameters.get('page[number]') !== String(expected) || parameters.get('page[size]') !== String(pageSize))
    throw fault('SOURCE_PAGINATION_CHANGED', 'The original pagination link changed its page number or size.', 409);
}
export function inspectPage(response, source, page, previous = null, pageSize = source.pageSize) {
  const value = jsonResponse(response);
  if (!object(value) || !Array.isArray(value.data) || !object(value.meta) || !object(value.links))
    throw fault('SOURCE_SHAPE_INVALID', 'The original Treasury response needs data, meta and links objects.', 502);
  const meta = value.meta, rows = value.data, count = sourceInteger(meta.count, 'page row count');
  const totalRows = sourceInteger(meta['total-count'], 'total row count'), totalPages = sourceInteger(meta['total-pages'], 'total page count');
  if (count !== rows.length || count > pageSize || totalPages !== Math.ceil(totalRows / pageSize) ||
      page > Math.max(1, totalPages) || count !== Math.min(pageSize, Math.max(0, totalRows - (page - 1) * pageSize)))
    throw fault('SOURCE_COUNTS_CHANGED', 'Treasury page counts do not describe the complete pinned query.', 409);
  for (const key of TYPE_KEYS) if (!object(meta[key])) throw fault('SOURCE_FIELDS_MISSING', 'Treasury omitted its original field metadata.', 502);
  const fields = Object.keys(meta.labels);
  if (!fields.length || fields.length > 512 || fields.some(name => !FIELD.test(name)) ||
      TYPE_KEYS.some(key => metadataKeys(meta[key]) !== metadataKeys(meta.labels) ||
        Object.values(meta[key]).some(value => typeof value !== 'string')))
    throw fault('SOURCE_FIELD_METADATA', 'The original Treasury field metadata is inconsistent.', 502);
  for (const row of rows) {
    if (!object(row) || metadataKeys(row) !== metadataKeys(meta.labels) ||
        Object.values(row).some(value => value !== null && typeof value !== 'string'))
      throw fault('SOURCE_ROW_FIELDS', 'A Treasury row differs from the original full-field string/null contract.', 502);
  }
  const metadata = Object.fromEntries(TYPE_KEYS.map(key => [key, structuredClone(meta[key])]));
  const metadataSha256 = identity(metadata);
  if (previous && (previous.totalRows !== totalRows || previous.totalPages !== totalPages || previous.metadataSha256 !== metadataSha256))
    throw fault('SOURCE_CHANGED_DURING_CAPTURE', 'Treasury totals or field metadata changed during this capture. Its original pages are retained; create a new dated capture.', 409);
  for (const [name, expected] of [['self', page], ['first', 1], ['prev', page > 1 ? page - 1 : null],
    ['next', page < totalPages ? page + 1 : null], ['last', Math.max(1, totalPages)]])
    linkPage(value.links[name], name, expected, source, pageSize);
  return { value, rows, fields, metadata, metadataSha256, count, totalRows, totalPages,
    semanticSha256: identity(value), dataSha256: identity(rows), nextPage: page < totalPages ? page + 1 : null };
}
export function normalizeCatalog(value) {
  if (!Array.isArray(value) || value.length > 2000)
    throw fault('CATALOG_SHAPE_INVALID', 'The original Treasury catalogue must contain its dataset array.', 502);
  const rows = [], seen = new Set();
  for (const dataset of value) {
    if (!object(dataset) || !Array.isArray(dataset.apis)) throw fault('CATALOG_SHAPE_INVALID', 'An original catalogue dataset has no API list.', 502);
    for (const api of dataset.apis) {
      if (!api.endpoint_txt) continue;
      const endpoint = endpointPath(api.endpoint_txt), id = String(api.api_id);
      if (seen.has(endpoint)) throw fault('CATALOG_DUPLICATE_ENDPOINT', 'The original catalogue repeats an endpoint.', 502);
      seen.add(endpoint);
      rows.push({ id, datasetId: String(dataset.dataset_id), datasetName: String(dataset.title),
        tableName: String(api.table_name ?? dataset.title), description: String(api.table_description ?? ''),
        endpoint, sourceUrl: 'https://fiscaldata.treasury.gov/datasets/' + encodeURIComponent(dataset.dataset_path) + '/',
        fields: (api.fields ?? []).map(field => ({ source: field.column_name, label: field.pretty_name ?? field.column_name,
          type: field.data_type ?? '', format: field.data_format ?? '', definition: field.definition ?? '', raw: field })),
        publisher: dataset.publisher ?? '', updateFrequency: api.update_frequency ?? dataset.update_frequency,
        latestDate: api.latest_date, earliestDate: api.earliest_date, rowCount: api.row_count,
        rowDefinition: api.row_definition, notes: dataset.notes_and_known_limitations ?? '',
        apiNotes: api.api_notes_and_limitations ?? '', raw: { dataset: { ...dataset, apis: undefined }, api } });
    }
  }
  return rows.sort((a, b) => a.datasetName.localeCompare(b.datasetName) || a.tableName.localeCompare(b.tableName));
}
