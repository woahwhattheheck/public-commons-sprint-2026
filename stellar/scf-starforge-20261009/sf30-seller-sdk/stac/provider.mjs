// MIT. Source-faithful STAC acquisition over the maintained SF31 transport.
import { createHash } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicHttpsFetch, normalizeBuyerTransport } from '../../sf31-buyer-client/public-transport.mjs';
import { privateDirectory, writeJson, writeBytes, jsonBytes, need } from '../../sf88-operator-buyer-cli/node/store.mjs';

export const DEFAULT_ENDPOINT = 'https://earth-search.aws.element84.com/v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    need(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'STAC_JSON_VALUE_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
export const stacItemKey = item => {
  need(item && typeof item.collection === 'string' && item.collection.length > 0 &&
    typeof item.id === 'string' && item.id.length > 0, 'STAC_ITEM_IDENTITY_REQUIRED');
  return encodeURIComponent(item.collection) + '/' + encodeURIComponent(item.id);
};
export function publicURL(input, base) {
  const url = new URL(input, base);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    (!url.port || url.port === '443'), 'STAC_PUBLIC_HTTPS_REQUIRED');
  return url.href;
}
export const normalizeEndpoint = input => publicURL(input ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
export function normalizeQuery(input, { endpoint = DEFAULT_ENDPOINT, collections = [] } = {}) {
  need(input && typeof input === 'object' && Array.isArray(input.collections) &&
    input.collections.length > 0 && input.collections.every(id => typeof id === 'string' && id.length), 'STAC_COLLECTIONS_REQUIRED');
  const selected = [...new Set(input.collections)];
  if (collections.length) need(selected.every(id => collections.some(c => c.id === id)), 'STAC_COLLECTION_NOT_DISCOVERED');
  need(Boolean(input.bbox) !== Boolean(input.intersects), 'STAC_ONE_SPATIAL_FILTER_REQUIRED');
  const query = { endpoint: normalizeEndpoint(endpoint), collections: selected };
  if (input.bbox) {
    need(Array.isArray(input.bbox) && [4, 6].includes(input.bbox.length) &&
      input.bbox.every(Number.isFinite), 'STAC_BBOX_INVALID');
    const a = input.bbox, d = a.length / 2;
    need(a[0] >= -180 && a[0] <= 180 && a[d] >= -180 && a[d] <= 180 &&
      a[1] >= -90 && a[1] <= 90 && a[d+1] >= -90 && a[d+1] <= 90 && a[1] <= a[d+1] &&
      (d === 2 || a[2] <= a[5]), 'STAC_BBOX_INVALID');
    query.bbox = [...a]; // West > east is a valid antimeridian-spanning STAC bbox.
  } else {
    const geometry = structuredClone(input.intersects);
    let count = 0;
    function position(p) {
      need(Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) &&
        p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90, 'STAC_GEOMETRY_INVALID');
      need(++count <= 100000, 'STAC_GEOMETRY_TOO_LARGE');
    }
    function list(p, minimum, child) {
      need(Array.isArray(p) && p.length >= minimum, 'STAC_GEOMETRY_INVALID'); p.forEach(child);
    }
    function ring(p) { list(p, 4, position); need(canonicalJson(p[0]) === canonicalJson(p.at(-1)), 'STAC_RING_NOT_CLOSED'); }
    function check(g) {
      need(g && typeof g === 'object', 'STAC_GEOMETRY_INVALID');
      switch (g.type) {
        case 'Point': position(g.coordinates); break;
        case 'MultiPoint': list(g.coordinates, 1, position); break;
        case 'LineString': list(g.coordinates, 2, position); break;
        case 'MultiLineString': list(g.coordinates, 1, p => list(p, 2, position)); break;
        case 'Polygon': list(g.coordinates, 1, ring); break;
        case 'MultiPolygon': list(g.coordinates, 1, p => list(p, 1, ring)); break;
        case 'GeometryCollection': list(g.geometries, 1, check); break;
        default: need(false, 'STAC_GEOMETRY_INVALID');
      }
    }
    check(geometry); query.intersects = geometry;
  }
  need(typeof input.datetime === 'string' && input.datetime.length <= 160, 'STAC_DATETIME_REQUIRED');
  const times = input.datetime.split('/');
  need(times.length <= 2 && times.every(v => v === '..' ||
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))) &&
    times.some(v => v !== '..') && (times.length > 1 || times[0] !== '..'), 'STAC_DATETIME_INVALID');
  if (times.length === 2 && times.every(v => v !== '..')) need(Date.parse(times[0]) <= Date.parse(times[1]), 'STAC_DATETIME_REVERSED');
  query.datetime = input.datetime;
  if (input.cloudCoverMax !== undefined && input.cloudCoverMax !== null && input.cloudCoverMax !== '') {
    need(Number.isFinite(input.cloudCoverMax) && input.cloudCoverMax >= 0 && input.cloudCoverMax <= 100, 'STAC_CLOUD_COVER_INVALID');
    query.cloudCoverMax = input.cloudCoverMax;
  }
  query.pageSize = input.pageSize ?? 100; query.maxPages = input.maxPages ?? 1000;
  need(Number.isSafeInteger(query.pageSize) && query.pageSize >= 1 && query.pageSize <= 1000, 'STAC_PAGE_SIZE_INVALID');
  need(Number.isSafeInteger(query.maxPages) && query.maxPages >= 1 && query.maxPages <= 100000, 'STAC_PAGE_BUDGET_INVALID');
  return query;
}
export function searchRequest(catalog, query) {
  if (query.cloudCoverMax !== undefined) need((catalog.conformsTo ?? []).some(v => /item-search#query$/.test(v)), 'STAC_QUERY_EXTENSION_NOT_DECLARED');
  const links = (catalog.links ?? []).filter(v => v.rel === 'search');
  const link = links.find(v => v.method?.toUpperCase() === 'POST');
  const getLink = links.find(v => !v.method || v.method.toUpperCase() === 'GET');
  need(link || getLink, 'STAC_SEARCH_LINK_REQUIRED');
  const body = { collections: query.collections, datetime: query.datetime, limit: query.pageSize,
    ...(query.bbox ? { bbox: query.bbox } : { intersects: query.intersects }),
    ...(query.cloudCoverMax !== undefined ? { query: { 'eo:cloud_cover': { lte: query.cloudCoverMax } } } : {}) };
  const url = publicURL((link ?? getLink).href, query.endpoint);
  need(new URL(url).origin === new URL(query.endpoint).origin, 'STAC_SEARCH_ORIGIN_CHANGED');
  if (link) return { url, method: 'POST', headers: { accept: 'application/geo+json, application/json', 'content-type': 'application/json' }, body };
  const target = new URL(url);
  for (const [key, value] of Object.entries(body)) target.searchParams.set(key,
    ['collections', 'bbox'].includes(key) ? value.join(',') : typeof value === 'object' ? JSON.stringify(value) : String(value));
  return { url: target.href, method: 'GET', headers: { accept: 'application/geo+json, application/json' } };
}
export function nextRequest(document, previous, original, endpoint) {
  const links = (document.links ?? []).filter(link => link.rel === 'next');
  need(links.length <= 1, 'STAC_MULTIPLE_NEXT_LINKS');
  if (!links.length) return null;
  const link = links[0], url = publicURL(link.href, previous.url);
  need(new URL(url).origin === new URL(endpoint).origin, 'STAC_PAGINATION_ORIGIN_CHANGED');
  const method = String(link.method ?? 'GET').toUpperCase();
  need(['GET', 'POST'].includes(method), 'STAC_PAGINATION_METHOD_INVALID');
  need(link.headers === undefined || link.headers && typeof link.headers === 'object' && !Array.isArray(link.headers), 'STAC_PAGINATION_HEADERS_INVALID');
  const headers = { accept: 'application/geo+json, application/json',
    ...(link.merge ? original.headers : {}), ...(link.headers ?? {}) };
  for (const [name, value] of Object.entries(headers)) need(typeof value === 'string' &&
    !/^(authorization|cookie|host|proxy-|connection|content-length|transfer-encoding|accept-encoding)/i.test(name),
    'STAC_PAGINATION_HEADER_UNSUPPORTED');
  const request = { url, method, headers };
  if (method === 'POST') {
    need(link.body === undefined || link.body && typeof link.body === 'object' && !Array.isArray(link.body), 'STAC_PAGINATION_BODY_INVALID');
    request.body = { ...(link.merge ? original.body : {}), ...(link.body ?? {}) };
    request.headers['content-type'] = 'application/json';
  } else {
    need(link.body === undefined, 'STAC_GET_PAGINATION_BODY_UNSUPPORTED');
    delete request.headers['content-type'];
  }
  return request;
}
export function assetDescriptor(item, key, collection) {
  const source = item.assets?.[key]; need(source && typeof source.href === 'string', 'STAC_ASSET_NOT_FOUND');
  const refs = source['storage:refs'] ?? item.properties?.['storage:refs'] ?? [];
  const schemes = { ...(collection?.['storage:schemes'] ?? {}), ...(item['storage:schemes'] ?? {}),
    ...(item.properties?.['storage:schemes'] ?? {}) };
  const requesterPays = source['storage:requester_pays'] ?? item.properties?.['storage:requester_pays'] ??
    refs.some(ref => schemes[ref]?.requester_pays === true);
  const missingSchemes = refs.filter(ref => !schemes[ref]);
  let https = false; try { publicURL(source.href); https = true; } catch {}
  return { itemId: stacItemKey(item), collection: item.collection, nativeItemId: item.id, assetKey: key,
    href: source.href, type: source.type ?? 'application/octet-stream', roles: source.roles ?? [],
    license: item.properties?.license ?? collection?.license ?? null,
    licenseLinks: [...(collection?.links ?? []), ...(item.links ?? [])].filter(v => v.rel === 'license'),
    providers: item.properties?.providers ?? collection?.providers ?? [], requesterPays: Boolean(requesterPays),
    storage: { refs, schemes, missingSchemes }, eligible: https && !requesterPays && !missingSchemes.length,
    eligibilityReason: requesterPays ? 'REQUESTER_PAYS_CONNECTION_REQUIRED' : !https ? 'PUBLIC_HTTPS_HREF_REQUIRED' :
      missingSchemes.length ? 'STORAGE_SCHEME_UNRESOLVED' : 'PUBLIC_HTTPS',
    source: structuredClone(source) };
}
export function createStacProvider({ endpoint = DEFAULT_ENDPOINT, transport, sourceAuth, timeoutMs = 120000,
  maxMetadataBytes = 64 * 1024 * 1024 } = {}) {
  endpoint = normalizeEndpoint(endpoint);
  need(sourceAuth === undefined || sourceAuth === null || typeof sourceAuth.requestHeaders === 'function' &&
    typeof sourceAuth.authorizationForOrigin === 'function', 'STAC_SOURCE_AUTH_RUNTIME_INVALID');
  const profiles = (transport ? Array.isArray(transport) ? transport : [transport] : []).map(normalizeBuyerTransport);
  const fetches = new Map(), pending = new Set(), lifetime = new AbortController();
  let closing = null;
  function owned(operation) {
    return (...args) => {
      if (lifetime.signal.aborted) return Promise.reject(Object.assign(new Error('STAC_PROVIDER_CLOSED'), { code: 'STAC_PROVIDER_CLOSED' }));
      const result = Promise.resolve().then(() => operation(...args));
      pending.add(result); result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    };
  }
  function fetchFor(url) {
    const origin = new URL(publicURL(url)).origin;
    if (!fetches.has(origin)) {
      const profile = profiles.find(p => p.origin === origin);
      need(!profiles.length || profile, 'STAC_SOURCE_TRANSPORT_ORIGIN_NOT_CONFIGURED');
      fetches.set(origin, createPublicHttpsFetch({ timeoutMs, ...(profile ? { trustedProxy: profile } : {}),
        sourceAuthorization: sourceAuth?.authorizationForOrigin(origin) ?? null }));
    }
    return fetches.get(origin);
  }
  async function request(request, signal) {
    // The original request.json already exists. Resolve the private bearer only
    // for this dispatch; retained request identity never contains this header.
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    need(!signal.aborted, 'STAC_PROVIDER_CLOSED');
    const method = request.method ?? 'GET';
    const headers = new Headers(request.headers ?? { accept: 'application/json' });
    need(!headers.has('authorization') && !headers.has('cookie') && !headers.has('proxy-authorization'),
      'STAC_RETAINED_REQUEST_CREDENTIAL_FORBIDDEN');
    const dispatch = fetchFor(request.url);
    const privateHeaders = new Headers(await sourceAuth?.requestHeaders({ url: request.url, method, signal }) ?? {});
    for (const [name, value] of privateHeaders) {
      need(name === 'authorization', 'STAC_SOURCE_AUTH_HEADER_UNSUPPORTED');
      headers.set(name, value);
    }
    const response = await dispatch(request.url, { method, redirect: 'manual', headers, signal,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) });
    try {
      await sourceAuth?.observeResponse?.({ url: request.url, status: response.status,
        authorization: privateHeaders.get('authorization') });
    } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    return response;
  }
  async function captureJson(selected, { directory, signal } = {}) {
    await privateDirectory(directory);
    const startedAt = new Date().toISOString(), requestHash = sha256(canonicalJson(selected));
    await writeJson(join(directory, 'request.json'), { request: selected, requestHash, startedAt }, { exclusive: true });
    let response, raw;
    try {
      response = await request(selected, signal);
      const chunks = []; let count = 0;
      for await (const chunk of response.body ?? []) { count += chunk.length; need(count <= maxMetadataBytes, 'STAC_METADATA_SIZE_LIMIT'); chunks.push(Buffer.from(chunk)); }
      raw = Buffer.concat(chunks, count);
      await writeBytes(join(directory, 'response.bin'), raw, { exclusive: true });
      const record = { request: selected, requestHash, startedAt, completedAt: new Date().toISOString(),
        status: response.status, headers: Object.fromEntries(response.headers), bytes: raw.length, sha256: sha256(raw) };
      await writeJson(join(directory, 'response.json'), record, { exclusive: true });
      need(response.status === 200, 'STAC_PROVIDER_HTTP_' + response.status);
      let document; try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { need(false, 'STAC_PROVIDER_JSON_INVALID'); }
      need(document && typeof document === 'object' && !Array.isArray(document), 'STAC_PROVIDER_DOCUMENT_INVALID');
      return { document, record, raw };
    } catch (error) {
      await writeJson(join(directory, 'error.json'), { code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'STAC_PROVIDER_REQUEST_FAILED',
        status: response?.status ?? null, message: String(error.message).slice(0, 500), completedAt: new Date().toISOString() });
      throw error;
    }
  }
  async function downloadAsset(descriptor, { directory, maxBytes, signal } = {}) {
    need(descriptor.eligible && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 2 * 1024 ** 3, 'STAC_ASSET_REVIEW_REQUIRED');
    await privateDirectory(directory);
    const selected = { url: descriptor.href, method: 'GET', headers: { accept: descriptor.type ?? 'application/octet-stream' } };
    await writeJson(join(directory, 'request.json'), { request: selected, maxBytes, startedAt: new Date().toISOString() }, { exclusive: true });
    let file, count = 0, response;
    try {
      response = await request(selected, signal);
      need(response.status === 200, 'STAC_ASSET_HTTP_' + response.status);
      const declared = response.headers.get('content-length');
      if (declared !== null) need(/^\d+$/.test(declared) && Number(declared) <= maxBytes, 'STAC_ASSET_SIZE_LIMIT');
      file = await open(join(directory, 'asset.part'), 'wx', 0o600);
      const hash = createHash('sha256');
      for await (const chunk of response.body ?? []) {
        count += chunk.length; need(count <= maxBytes, 'STAC_ASSET_SIZE_LIMIT');
        const bytes = Buffer.from(chunk); hash.update(bytes);
        let offset = 0; while (offset < bytes.length) { const written = await file.write(bytes, offset, bytes.length - offset); need(written.bytesWritten > 0, 'STAC_ASSET_WRITE_FAILED'); offset += written.bytesWritten; }
      }
      need(declared === null || Number(declared) === count, 'STAC_ASSET_LENGTH_MISMATCH');
      await file.sync(); await file.close(); file = undefined;
      await rename(join(directory, 'asset.part'), join(directory, 'asset.bin'));
      const record = { status: response.status, headers: Object.fromEntries(response.headers), bytes: count, sha256: hash.digest('hex'),
        mime: (response.headers.get('content-type') ?? descriptor.type ?? 'application/octet-stream').split(';')[0].trim().toLowerCase(),
        completedAt: new Date().toISOString() };
      await writeJson(join(directory, 'response.json'), record, { exclusive: true });
      return record;
    } catch (error) {
      if (file) await file.close();
      await unlink(join(directory, 'asset.part')).catch(() => {});
      await response?.body?.cancel().catch(() => {});
      await writeJson(join(directory, 'error.json'), { code: error.code ?? 'STAC_ASSET_DOWNLOAD_FAILED',
        message: String(error.message).slice(0, 500), receivedBytes: count, completedAt: new Date().toISOString() });
      throw error;
    }
  }
  return Object.freeze({ endpoint, captureJson: owned(captureJson), downloadAsset: owned(downloadAsset),
    close() {
      if (!closing) { lifetime.abort(); closing = (async () => { await Promise.allSettled([...pending]); })(); }
      return closing;
    } });
}
export const SCENE_COLUMNS = ['item_key','collection','item_id','datetime','start_datetime','end_datetime','cloud_cover',
  'platform','constellation','geometry_json','properties_json','assets_json','links_json','decision_status','decision_note'];
export function sceneRows(items, decisions = []) {
  const byItem = new Map(decisions.map(value => [value.itemId, value]));
  return items.map(item => { const p = item.properties, d = byItem.get(stacItemKey(item));
    return { item_key: stacItemKey(item), collection: item.collection, item_id: item.id, datetime: p.datetime ?? null,
      start_datetime: p.start_datetime ?? null, end_datetime: p.end_datetime ?? null, cloud_cover: p['eo:cloud_cover'] ?? null,
      platform: p.platform ?? null, constellation: p.constellation ?? null, geometry_json: JSON.stringify(item.geometry),
      properties_json: JSON.stringify(p), assets_json: JSON.stringify(item.assets), links_json: JSON.stringify(item.links ?? []),
      decision_status: d?.status ?? 'REVIEW', decision_note: d?.note ?? '' };
  });
}
export function scenesCsv(items, decisions) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return SCENE_COLUMNS.map(cell).join(',') + '\r\n' + sceneRows(items, decisions).map(row =>
    SCENE_COLUMNS.map(key => cell(row[key])).join(',')).join('\r\n') + (items.length ? '\r\n' : '');
}
