// MIT. OGC API Features source capture. Shared SF30 kernel lease and private files.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, lstat, stat, rename, unlink, readdir } from 'node:fs/promises';
import { privateDirectory, acquireWorkspace, readJson, readPrivate, createFile,
  atomicJson, digest, identity, stamp, object, fault } from '../postgres/publisher/files.mjs';
export { digest, identity, fault };
const DECODER = new TextDecoder('utf-8', { fatal: true });
const MIME = ['application/geo+json', 'application/json'];
export class JsonNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
  toJSON() { return JSON.rawJSON(this.text); }
}
/** Preserve numeric lexemes, including identifiers larger than Number.MAX_SAFE_INTEGER. */
export function parseSource(bytes) {
  return JSON.parse(DECODER.decode(bytes), (key, value, context) =>
    typeof value === 'number' ? new JsonNumber(context.source) : value);
}
export const sourceText = value => value instanceof JsonNumber ? value.text : JSON.stringify(value);
function count(value) {
  if (!(value instanceof JsonNumber)) return null;
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.text);
  if (!m) return null;
  let digits = (m[1] + (m[2] ?? '')).replace(/^0+/, '') || '0';
  if (digits === '0') return '0';
  const shift = Number(m[3] ?? 0) - (m[2]?.length ?? 0);
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 10000) return null;
  if (shift < 0) {
    if (-shift >= digits.length || !/^0*$/.test(digits.slice(shift))) return null;
    digits = digits.slice(0, shift);
  } else digits += '0'.repeat(shift);
  return digits;
}
export function validateSourceConfig(input) {
  if (!object(input) || input.schema !== 'stellar-forge.ogc-source.v1' ||
      Object.keys(input).some(k => !['schema','itemsUrl','name','authorizationEnv','allowLoopback',
        'pageBytes','totalBytes','maxPages','requestTimeoutMs','collection','license','kind','coordinateDescription'].includes(k)))
    throw fault('OGC_CONFIG_INVALID', 'Use an ogc-source.v1 with a selected itemsUrl.');
  const url = new URL(input.itemsUrl);
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' ||
      (input.allowLoopback === true && url.protocol === 'http:' && url.hostname === '127.0.0.1')))
    throw fault('OGC_URL_INVALID', 'Use HTTPS without URL credentials/fragment; explicit local development accepts 127.0.0.1 HTTP.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 128 || /[\x00-\x1f]/.test(input.name))
    throw fault('OGC_NAME_INVALID');
  if (input.authorizationEnv !== undefined && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(input.authorizationEnv))
    throw fault('OGC_AUTH_REFERENCE_INVALID', 'authorizationEnv names an environment variable containing the complete Authorization header.');
  const limits = { pageBytes: 16*1024*1024, totalBytes: 256*1024*1024, maxPages: 100000, requestTimeoutMs: 60000 };
  const maxima = { pageBytes: 64*1024*1024, totalBytes: 2*1024*1024*1024, maxPages: 1000000, requestTimeoutMs: 600000 };
  for (const k of Object.keys(limits)) {
    limits[k] = input[k] ?? limits[k];
    if (!Number.isSafeInteger(limits[k]) || limits[k] < 1 || limits[k] > maxima[k]) throw fault('OGC_LIMIT_INVALID', k);
  }
  if (input.allowLoopback !== undefined && typeof input.allowLoopback !== 'boolean') throw fault('OGC_CONFIG_INVALID');
  const kind = input.kind ?? 'ogc-api-features';
  if (!['ogc-api-features', 'geojson'].includes(kind) ||
      (input.coordinateDescription !== undefined && (typeof input.coordinateDescription !== 'string' || input.coordinateDescription.length > 4096))) throw fault('OGC_CONFIG_INVALID');
  return { ...input, ...limits, kind, itemsUrl: url.href };
}
function authorizedUrl(href, base, config) {
  const url = new URL(href, base), selected = new URL(config.itemsUrl);
  if (url.origin !== selected.origin || url.username || url.password || url.hash)
    throw fault('OGC_ORIGIN_CHANGED', 'The provider link leaves the explicitly selected source origin. Select that source separately.');
  return url.href;
}
export function linkedUrl(doc, relation, base, config) {
  const links = (doc.links ?? []).filter(l => object(l) && l.rel === relation &&
    (!l.type || MIME.includes(l.type.split(';')[0].trim())));
  const candidates = [...new Set(links.map(l => authorizedUrl(l.href, base, config)))];
  if (candidates.length > 1) throw fault('OGC_LINK_AMBIGUOUS', 'Choose one JSON ' + relation + ' link explicitly.');
  return candidates[0] ?? null;
}
/** GET exact native URLs; redirects stay at the operator-selected origin. */
export async function getSource(url, config, { signal, fetchImpl = fetch } = {}) {
  let target = authorizedUrl(url, config.itemsUrl, config);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    for (let n = 0; n < 6; n++) {
      combined.throwIfAborted();
      const headers = { Accept: 'application/geo+json, application/json;q=0.9' };
      if (config.authorizationEnv) {
        const secret = process.env[config.authorizationEnv];
        if (!secret || /[\r\n]/.test(secret)) throw fault('OGC_AUTH_MISSING', 'Set the selected Authorization environment variable.');
        headers.Authorization = secret;
      }
      const response = await fetchImpl(target, { headers, redirect: 'manual', signal: combined });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw fault('OGC_REDIRECT_INVALID');
        target = authorizedUrl(location, target, config); continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(fault('OGC_HTTP_' + response.status, 'Source returned HTTP ' + response.status + '; repeat the same capture command after resolution.'),
          { retryAfter: response.headers.get('retry-after') });
      }
      const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!MIME.includes(mime)) { await response.body?.cancel(); throw fault('OGC_JSON_REQUIRED', 'Source must return JSON or GeoJSON.'); }
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        combined.throwIfAborted(); length += chunk.length;
        if (length > config.pageBytes) throw fault('OGC_PAGE_TOO_LARGE', 'Reduce the requested page limit or explicitly increase pageBytes.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), document = parseSource(bytes);
      return { bytes, document, requestedUrl: url, url: target, status: response.status, fetchedAt: stamp(),
        contentType: response.headers.get('content-type'), etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'), contentCrs: response.headers.get('content-crs') };
    }
    throw fault('OGC_REDIRECT_LIMIT');
  } finally { clearTimeout(timer); }
}
function pageDetails(record, config) {
  const doc = record.document;
  if (!object(doc) || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features) ||
      doc.features.some(f => !object(f) || f.type !== 'Feature' || !(f.properties === null || object(f.properties)) ||
        !Object.hasOwn(f, 'geometry') || !(f.geometry === null || object(f.geometry))))
    throw fault('OGC_FEATURE_COLLECTION_REQUIRED');
  // A declared count must describe the actual page. No short-page termination guess.
  const returned = count(doc.numberReturned), matched = count(doc.numberMatched);
  if (doc.numberReturned !== undefined && (returned === null || BigInt(returned) !== BigInt(doc.features.length)))
    throw fault('OGC_RETURNED_COUNT_MISMATCH');
  if (doc.numberMatched !== undefined && matched === null) throw fault('OGC_MATCHED_COUNT_INVALID');
  const contentCrs = record.contentCrs?.replace(/^<|>$/g, '');
  if ((contentCrs && !['http://www.opengis.net/def/crs/OGC/1.3/CRS84','http://www.opengis.net/def/crs/OGC/0/CRS84h'].includes(contentCrs)) || doc.crs)
    throw fault('OGC_CRS_UNSUPPORTED', 'Choose the native default GeoJSON CRS84/CRS84h representation. No coordinates are reprojected.');
  return { returned: doc.features.length, matched, next: linkedUrl(doc, 'next', record.url, config) };
}
const LIMIT_KEYS = new Set(['pageBytes','totalBytes','maxPages','requestTimeoutMs']);
const selection = config => Object.fromEntries(Object.entries(config).filter(([key]) => !LIMIT_KEYS.has(key)));
const indexName = i => 'p' + String(i).padStart(8, '0') + '.json';
function sourceIdentity(manifest) {
  return identity({ selection: selection(manifest.config), head: manifest.head, pageCount: manifest.pageCount,
    rows: manifest.rows, totalBytes: manifest.totalBytes, next: manifest.next, complete: manifest.complete });
}
async function saveHeader(directory, manifest) {
  const { pages, ...header } = manifest;
  await atomicJson(directory, 'capture.json', header);
}
async function readPage(directory, page, config) {
  if (!page || !/^[a-f0-9]{64}\.geojson$/.test(page.file) || page.file !== page.sha256 + '.geojson' ||
      !Number.isSafeInteger(page.bytes) || page.bytes < 0 || !Number.isSafeInteger(page.returned) || page.returned < 0)
    throw fault('OGC_CAPTURE_CHAIN_INVALID');
  authorizedUrl(page.url, page.requestedUrl, config);
  const bytes = await readPrivate(join(directory, 'pages', page.file), config.pageBytes);
  if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw fault('OGC_PAGE_CHANGED');
  const document = parseSource(bytes), details = pageDetails({ ...page, document }, config);
  if (details.returned !== page.returned || details.matched !== page.matched || details.next !== page.next)
    throw fault('OGC_CAPTURE_CHAIN_INVALID');
  return { ...page, bytes, document };
}
export async function readCapture(directory, { verify = true } = {}) {
  await privateDirectory(directory);
  const manifest = await readJson(join(directory, 'capture.json'), 2*1024*1024);
  if (manifest.schema !== 'stellar-forge.ogc-capture.v1' || manifest.pages !== undefined ||
      !Number.isSafeInteger(manifest.pageCount) || manifest.pageCount < 0 || manifest.pageCount > 1000000 ||
      manifest.sourceId !== sourceIdentity(manifest)) throw fault('OGC_CAPTURE_INVALID');
  validateSourceConfig(manifest.config);
  let next = manifest.config.itemsUrl, total = 0, rows = 0, head = identity(selection(manifest.config));
  const seen = new Set(); manifest.pages = [];
  for (let i = 0; i < manifest.pageCount; i++) {
    const record = await readJson(join(directory, 'pages', indexName(i)), 262144), page = record.page;
    if (!page || page.requestedUrl !== next || seen.has(next) || record.previous !== head ||
        record.head !== identity({ previous: head, page })) throw fault('OGC_CAPTURE_CHAIN_INVALID');
    if (verify) await readPage(directory, page, manifest.config);
    seen.add(next); total += page.bytes; rows += page.returned; next = page.next; head = record.head;
    manifest.pages.push(page);
  }
  if (manifest.head !== head || manifest.next !== next || manifest.totalBytes !== total || manifest.rows !== rows || manifest.complete !== (next === null))
    throw fault('OGC_CAPTURE_CHAIN_INVALID');
  return manifest;
}
/** One source capture; repeats continue its exact last committed next URL. */
export async function capture(directory, input, { signal, fetchImpl, onPage, recordSource } = {}) {
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    let manifest;
    try { manifest = await readCapture(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A missing retained page is corruption, not permission to reset an existing manifest.
      try { await lstat(join(directory, 'capture.json')); throw fault('OGC_RETAINED_PAGE_MISSING'); }
      catch (check) { if (check.code !== 'ENOENT') throw check; }
      if (!input) throw fault('OGC_CONFIG_REQUIRED');
      const config = validateSourceConfig(input);
      manifest = { schema: 'stellar-forge.ogc-capture.v1', config, pages: [], pageCount: 0, head: identity(selection(config)), next: config.itemsUrl,
        rows: 0, totalBytes: 0, complete: false, createdAt: stamp() };
      manifest.sourceId = sourceIdentity(manifest);
      await privateDirectory(join(directory, 'pages'), true);
      await saveHeader(directory, manifest);
    }
    if (input) {
      const config = validateSourceConfig(input);
      if (identity(selection(config)) !== identity(selection(manifest.config))) throw fault('OGC_SOURCE_SELECTION_CHANGED');
      // Operational ceilings may increase without re-fetching an accepted prefix.
      if (!manifest.complete && identity(config) !== identity(manifest.config)) {
        if (config.totalBytes < manifest.totalBytes || config.maxPages < manifest.pageCount || manifest.pages.some(p => p.bytes > config.pageBytes)) throw fault('OGC_LIMIT_BELOW_CAPTURE');
        manifest.config = config; await saveHeader(directory, manifest);
      }
    }
    for (const name of await readdir(join(directory, 'pages')))
      if (/^\.ogc-put-[a-f0-9-]{36}$/.test(name)) await unlink(join(directory, 'pages', name));
    const seen = new Set(manifest.pages.map(p => p.requestedUrl));
    while (manifest.next) {
      signal?.throwIfAborted();
      if (seen.has(manifest.next)) throw fault('OGC_PAGING_CYCLE');
      if (manifest.pages.length >= manifest.config.maxPages) throw fault('OGC_PAGE_LIMIT', 'Retained pages are complete through the displayed next URL.');
      let pending = null;
      try { pending = await readJson(join(directory, 'pages', indexName(manifest.pageCount)), 262144); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (pending && (pending.previous !== manifest.head || pending.page?.requestedUrl !== manifest.next ||
          pending.head !== identity({ previous: manifest.head, page: pending.page }))) throw fault('OGC_PENDING_PAGE_INVALID');
      // A crash after the immutable page record but before the compact header is
      // reconciled from that exact retained response, without a network replay.
      const record = pending ? await readPage(directory, pending.page, manifest.config) : recordSource ?
        await recordSource(manifest.next) : await getSource(manifest.next, manifest.config, { signal, fetchImpl });
      if (record.requestedUrl !== manifest.next) throw fault('OGC_RECORD_URL_MISMATCH');
      authorizedUrl(record.url, record.requestedUrl, manifest.config);
      if (!Buffer.isBuffer(record.bytes) || record.bytes.length > manifest.config.pageBytes) throw fault('OGC_PAGE_TOO_LARGE');
      if (record.status !== 200 || !MIME.includes((record.contentType ?? '').split(';')[0].trim().toLowerCase())) throw fault('OGC_RECORD_RESPONSE_INVALID');
      record.document = parseSource(record.bytes);
      const details = pageDetails(record, manifest.config);
      if (manifest.totalBytes + record.bytes.length > manifest.config.totalBytes) throw fault('OGC_TOTAL_BYTES_LIMIT');
      if (details.next === manifest.next || seen.has(details.next)) throw fault('OGC_PAGING_CYCLE');
      const sha256 = digest(record.bytes), file = sha256 + '.geojson';
      const target = join(directory, 'pages', file);
      try {
        if (digest(await readPrivate(target, manifest.config.pageBytes)) !== sha256) throw fault('OGC_PAGE_CHANGED');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const temporary = join(directory, 'pages', '.ogc-put-' + randomUUID());
        try { await createFile(temporary, record.bytes); await rename(temporary, target); }
        finally { await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; }); }
      }
      const page = pending?.page ?? { requestedUrl: record.requestedUrl, url: record.url, fetchedAt: record.fetchedAt ?? stamp(),
        status: record.status ?? 200, contentType: record.contentType ?? 'application/geo+json',
        etag: record.etag ?? null, lastModified: record.lastModified ?? null, contentCrs: record.contentCrs ?? null,
        file, sha256, bytes: record.bytes.length, ...details };
      const nextHead = identity({ previous: manifest.head, page });
      if (!pending) await atomicJson(join(directory, 'pages'), indexName(manifest.pageCount),
        { previous: manifest.head, head: nextHead, page });
      const { syncDirectory } = await import('../postgres/publisher/files.mjs');
      await syncDirectory(join(directory, 'pages'));
      seen.add(manifest.next); manifest.pages.push(page); manifest.pageCount++;
      manifest.head = nextHead; manifest.next = details.next;
      manifest.rows += details.returned; manifest.totalBytes += page.bytes; manifest.complete = details.next === null;
      manifest.updatedAt = stamp(); manifest.sourceId = sourceIdentity(manifest);
      // Only the constant-size header is replaced; earlier page records are immutable.
      await saveHeader(directory, manifest);
      await onPage?.({ pages: manifest.pages.length, rows: manifest.rows, next: manifest.next });
    }
    return manifest;
  } finally { await release(); }
}
/** Import already-captured response bytes by exact request URL; never invent a continuation. */
export async function recordedSource(indexFile) {
  const { dirname, resolve } = await import('node:path');
  const index = JSON.parse(await readFile(indexFile, 'utf8'));
  if (index.schema !== 'stellar-forge.ogc-recordings.v1' || !Array.isArray(index.responses)) throw fault('OGC_RECORDINGS_INVALID');
  const root = dirname(resolve(indexFile)), records = new Map();
  for (const r of index.responses) {
    if (!r || typeof r.file !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(r.file) || records.has(r.requestedUrl) || r.status !== 200)
      throw fault('OGC_RECORDINGS_INVALID');
    records.set(r.requestedUrl, r);
  }
  return async url => {
    const r = records.get(url); if (!r) throw fault('OGC_RECORDING_MISSING', 'Missing exact recorded response: ' + url);
    const path = join(root, r.file);
    const info = await stat(path); if (!info.isFile() || info.size > 64*1024*1024) throw fault('OGC_RECORDING_TOO_LARGE');
    const bytes = await readFile(path);
    if (r.sha256 !== digest(bytes)) throw fault('OGC_RECORDING_CHANGED');
    return { ...r, bytes };
  };
}
export async function discover(baseUrl, options = {}) {
  const config = validateSourceConfig({ schema: 'stellar-forge.ogc-source.v1', itemsUrl: baseUrl,
    name: 'OGC collection discovery', ...options });
  const landing = await getSource(config.itemsUrl, config);
  const collectionsUrl = linkedUrl(landing.document, 'data', landing.url, config);
  const conformanceUrl = linkedUrl(landing.document, 'conformance', landing.url, config);
  if (!collectionsUrl) throw fault('OGC_COLLECTIONS_LINK_MISSING');
  const collections = await getSource(collectionsUrl, config);
  const conformance = conformanceUrl ? await getSource(conformanceUrl, config) : null;
  if (!Array.isArray(collections.document.collections)) throw fault('OGC_COLLECTIONS_INVALID');
  return { schema: 'stellar-forge.ogc-discovery.v1', landing: landing.url,
    conformsTo: conformance?.document.conformsTo ?? [],
    collections: collections.document.collections.map(c => ({ id: c.id, title: c.title ?? c.id,
      description: c.description ?? '', extent: c.extent ?? null,
      itemsUrl: linkedUrl(c, 'items', collections.url, config), links: c.links ?? [] })),
    source: [landing, collections, ...(conformance ? [conformance] : [])].map(r => ({ url: r.url,
      fetchedAt: r.fetchedAt, sha256: digest(r.bytes), content: DECODER.decode(r.bytes) })) };
}

/** Author a source from the provider's advertised collection link, never a guessed path. */
export function selectCollection(discovery, { collection, name, bbox, datetime, limit, authorizationEnv } = {}) {
  if (!discovery || discovery.schema !== 'stellar-forge.ogc-discovery.v1' || !Array.isArray(discovery.collections)) throw fault('OGC_DISCOVERY_INVALID');
  const matches = discovery.collections.filter(c => c.id === collection);
  if (matches.length !== 1 || !matches[0].itemsUrl) throw fault('OGC_COLLECTION_SELECTION_INVALID');
  const selected = matches[0], url = new URL(selected.itemsUrl);
  if (bbox !== undefined) {
    const parts = String(bbox).split(',');
    if (![4,6].includes(parts.length) || parts.some(p => !p.trim() || !Number.isFinite(Number(p)))) throw fault('OGC_BBOX_INVALID', 'Use four or six finite coordinates in the source CRS axis order.');
    const dimensions = parts.length / 2;
    if (Number(parts[1]) > Number(parts[dimensions+1]) || (dimensions === 3 && Number(parts[2]) > Number(parts[5]))) throw fault('OGC_BBOX_INVALID');
    url.searchParams.set('bbox', String(bbox));
  }
  if (datetime !== undefined) {
    if (typeof datetime !== 'string' || !datetime || datetime.length > 256 || /[\x00-\x20]/.test(datetime)) throw fault('OGC_DATETIME_INVALID');
    url.searchParams.set('datetime', datetime);
  }
  if (limit !== undefined) {
    if (!/^[1-9]\d*$/.test(String(limit)) || !Number.isSafeInteger(Number(limit))) throw fault('OGC_LIMIT_INVALID');
    url.searchParams.set('limit', String(limit));
  }
  return validateSourceConfig({ schema: 'stellar-forge.ogc-source.v1', itemsUrl: url.href,
    name: name ?? String(selected.title || selected.id).slice(0,128),
    ...(authorizationEnv ? {authorizationEnv} : {}),
    collection: { id: selected.id, title: selected.title, landing: discovery.landing,
      discoveryId: identity(discovery), links: selected.links ?? [] } });
}
