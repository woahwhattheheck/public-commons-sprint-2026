// MIT. Retain original CKAN Action API responses and complete DataStore pages.
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { lstat } from 'node:fs/promises';
import { object, bytes, digest, identity, readPrivate, createFile,
  atomicJson, privateDirectory, acquireWorkspace, fault, stamp } from '../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['package_search', 'package_show', 'resource_show', 'datastore_search']);
export const CAPTURE_SCHEMA = 'stellar-forge.ckan-capture.v1';
export function catalogOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw fault('CKAN_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      !url.hostname.includes('.') || /(^|\.)localhost$|\.(local|internal|home\.arpa)$/i.test(url.hostname) ||
      value.replace(/\/$/, '') !== url.origin)
    throw fault('CKAN_ORIGIN_INVALID', 'Use the canonical HTTPS origin of the CKAN catalogue.');
  return url.origin;
}
const integer = (value, min, max, code) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault(code);
  return value;
};
const identifier = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f]/.test(value))
    throw fault('CKAN_IDENTIFIER_INVALID');
  return value;
};
// Keep ordinary typed numbers, but retain tokens that JavaScript would change.
// These values serialize as JSON numbers, including within structured fields.
export class ExactCkanNumber {
  constructor(source) { this.source = source; Object.freeze(this); }
  toString() { return this.source; }
  toJSON() {
    if (typeof JSON.rawJSON !== 'function') throw fault('CKAN_EXACT_NUMBER_RUNTIME_REQUIRED');
    return JSON.rawJSON(this.source);
  }
}
function decimalIdentity(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) throw fault('CKAN_RESPONSE_JSON_INVALID');
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = /0*$/.exec(digits)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return match[1] + digits + 'e' + (BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing));
}
export function parseCkanJson(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw fault('CKAN_RESPONSE_ENCODING'); }
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value === 'number') {
        if (typeof context?.source !== 'string') throw fault('CKAN_EXACT_NUMBER_RUNTIME_REQUIRED');
        if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) ||
            Object.is(value, -0) || decimalIdentity(context.source) !== decimalIdentity(String(value)))
          return new ExactCkanNumber(context.source);
      }
      return value;
    });
  } catch (error) {
    if (error.code) throw error;
    throw fault('CKAN_RESPONSE_JSON_INVALID');
  }
}
function result(buffer) {
  const envelope = parseCkanJson(buffer);
  if (!object(envelope) || envelope.success !== true || !object(envelope.result))
    throw fault('CKAN_ACTION_FAILED', 'The provider did not return a successful CKAN Action API result.');
  return envelope.result;
}
function requestOptions(value = {}) {
  if (value.authTokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.authTokenEnv))
    throw fault('CKAN_TOKEN_REFERENCE_INVALID');
  return { authTokenEnv: value.authTokenEnv,
    timeoutMs: integer(value.timeoutMs ?? 30000, 100, 300000, 'CKAN_TIMEOUT_INVALID'),
    maxResponseBytes: integer(value.maxResponseBytes ?? 16777216, 1024, 67108864, 'CKAN_RESPONSE_LIMIT_INVALID') };
}
export async function requestCkan(origin, action, parameters = {}, options = {}) {
  const base = catalogOrigin(origin), config = requestOptions(options);
  if (!ACTIONS.has(action) || !object(parameters)) throw fault('CKAN_READ_ACTION_REQUIRED');
  const url = new URL('/api/3/action/' + action, base);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null)
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const headers = { accept: 'application/json' };
  if (config.authTokenEnv) {
    const token = (options.env ?? process.env)[config.authTokenEnv];
    if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
      throw fault('CKAN_TOKEN_UNAVAILABLE', 'Provide the configured private CKAN API token environment reference.');
    headers.authorization = token;
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response;
  try { response = await (options.fetch ?? globalThis.fetch)(url, { method: 'GET', headers, signal, redirect: 'error' }); }
  catch { throw fault(signal.aborted ? 'CKAN_REQUEST_CANCELLED' : 'CKAN_PROVIDER_UNREACHABLE'); }
  const receipt = { url: url.href, method: 'GET', receivedAt: stamp(), status: response.status,
    headers: Object.fromEntries(['content-type', 'etag', 'last-modified', 'date', 'retry-after']
      .map(key => [key, response.headers.get(key)]).filter(([,value]) => value !== null)) };
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(fault(response.status === 429 ? 'CKAN_RATE_LIMITED' : 'CKAN_PROVIDER_HTTP_' + response.status,
      'The CKAN provider returned HTTP ' + response.status + '.', 502), { receipt });
  }
  if (Number(response.headers.get('content-length') ?? 0) > config.maxResponseBytes) {
    await response.body?.cancel(); throw fault('CKAN_RESPONSE_TOO_LARGE');
  }
  const chunks = []; let size = 0;
  if (!response.body) throw fault('CKAN_RESPONSE_EMPTY');
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > config.maxResponseBytes) throw fault('CKAN_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code) throw error;
    throw fault(signal.aborted ? 'CKAN_REQUEST_CANCELLED' : 'CKAN_RESPONSE_INTERRUPTED');
  }
  const raw = Buffer.concat(chunks), value = result(raw);
  return { raw, value, receipt: { ...receipt, bytes: raw.length, sha256: digest(raw) } };
}
export function captureSelection(value) {
  if (!object(value)) throw fault('CKAN_SELECTION_REQUIRED');
  const origin = catalogOrigin(value.catalogOrigin), packageId = identifier(value.packageId), resourceId = identifier(value.resourceId);
  const filters = value.filters ?? {};
  if (!object(filters) || Buffer.byteLength(JSON.stringify(filters)) > 16384 ||
      Object.keys(filters).some(key => ['__proto__', 'constructor', 'prototype'].includes(key)))
    throw fault('CKAN_FILTERS_INVALID');
  if (value.q !== undefined && (typeof value.q !== 'string' || value.q.length > 2048)) throw fault('CKAN_QUERY_INVALID');
  if (!['offset', 'keyset'].includes(value.pagination ?? 'offset')) throw fault('CKAN_PAGINATION_INVALID');
  if (value.pagination === 'keyset' && Object.hasOwn(filters, '_id'))
    throw fault('CKAN_KEYSET_ID_FILTER_UNSUPPORTED', 'Use offset pagination to preserve the selected _id filter.');
  return { catalogOrigin: origin, packageId, resourceId, filters, q: value.q ?? '',
    pagination: value.pagination ?? 'offset', pageSize: integer(value.pageSize ?? 1000, 1, 32000, 'CKAN_PAGE_SIZE_INVALID'),
    ...requestOptions(value) };
}
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const fileInfo = (file, raw) => ({ file, bytes: raw.length, sha256: digest(raw) });
const pageName = index => 'pages/' + String(index).padStart(8, '0') + '.json';
function checkedPage(value, resourceId) {
  if (!Array.isArray(value.records) || !Array.isArray(value.fields) || value.records.some(row => !object(row)))
    throw fault('CKAN_DATASTORE_RESPONSE_INVALID');
  if (value.resource_id !== undefined && value.resource_id !== resourceId) throw fault('CKAN_RESOURCE_CHANGED');
  const limit = integer(value.limit, 1, 32000, 'CKAN_PROVIDER_LIMIT_INVALID');
  if (value.records.length > limit) throw fault('CKAN_PROVIDER_PAGE_OVERFLOW');
  const names = value.fields.map(field => field?.id);
  if (names.some(name => typeof name !== 'string' || !name.length) || new Set(names).size !== names.length)
    throw fault('CKAN_FIELDS_INVALID');
  return { ...value, limit };
}
const version = resource => ({ id: resource.id, package_id: resource.package_id ?? null,
  last_modified: resource.last_modified ?? null, hash: resource.hash ?? null, datastore_active: resource.datastore_active ?? null });

/** Resume the same captured selection; accepted pages are read from retained files. */
export async function captureCkanResource(selection, directory, options = {}) {
  const config = captureSelection(selection), selectionHash = identity(config);
  const limits = {
    maxRows: integer(options.maxRows ?? 250000, 1, 5000000, 'CKAN_ROW_LIMIT_INVALID'),
    maxBytes: integer(options.maxBytes ?? 268435456, 1024, 2147483647, 'CKAN_CAPTURE_LIMIT_INVALID'),
  };
  await privateDirectory(dirname(directory));
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  const statePath = join(directory, 'progress.json');
  let state;
  try {
    if (await exists(join(directory, 'capture.json'))) {
      const completed = await readCkanCapture(join(directory, 'capture.json'));
      if (completed.manifest.selectionHash !== selectionHash)
        throw fault('CKAN_CAPTURE_SELECTION_CHANGED', 'Use the original selection or choose a new capture directory.');
      return completed;
    }
    if (await exists(statePath)) {
      state = parseCkanJson(await readPrivate(statePath, 16777216));
      if (state.schema !== 'stellar-forge.ckan-capture-progress.v1' || state.selectionHash !== selectionHash)
        throw fault('CKAN_CAPTURE_SELECTION_CHANGED', 'Resume with the original catalogue, resource and query selection.');
    } else {
      state = { schema: 'stellar-forge.ckan-capture-progress.v1', selection: config, selectionHash,
        startedAt: stamp(), state: 'CAPTURING', files: [], pages: [], receipts: [], rowCount: 0,
        sourceBytes: 0, offset: 0, nextFilters: config.filters, fields: null, exactTotal: null };
      await privateDirectory(join(directory, 'pages'), true);
      await atomicJson(directory, 'progress.json', state);
    }
    const transport = { ...config, ...options };
    async function retain(file, action, parameters) {
      const found = state.files.find(item => item.file === file);
      if (found) {
        const raw = await readPrivate(join(directory, file), config.maxResponseBytes);
        if (raw.length !== found.bytes || digest(raw) !== found.sha256) throw fault('CKAN_RETAINED_PAGE_CHANGED');
        return { raw, value: result(raw), receipt: state.receipts.find(item => item.file === file) ?? null };
      }
      let received;
      if (await exists(join(directory, file))) {
        const raw = await readPrivate(join(directory, file), config.maxResponseBytes);
        received = { raw, value: result(raw), receipt: { recoveredAfterInterruption: true, receivedAt: null } };
      } else {
        received = await requestCkan(config.catalogOrigin, action, parameters, transport);
        if (state.sourceBytes + received.raw.length > limits.maxBytes) throw fault('CKAN_CAPTURE_BYTE_LIMIT');
        await createFile(join(directory, file), received.raw);
      }
      state.files.push(fileInfo(file, received.raw)); state.sourceBytes += received.raw.length;
      state.receipts.push({ file, action, parameters, ...received.receipt });
      return received;
    }
    const pkg = await retain('package.json', 'package_show', { id: config.packageId });
    if (pkg.value.id !== config.packageId && pkg.value.name !== config.packageId) throw fault('CKAN_PACKAGE_CHANGED');
    const selected = Array.isArray(pkg.value.resources) && pkg.value.resources.find(item => item.id === config.resourceId);
    if (!selected) throw fault('CKAN_RESOURCE_NOT_IN_PACKAGE');
    const before = await retain('resource.json', 'resource_show', { id: config.resourceId });
    if (before.value.id !== config.resourceId || before.value.package_id && before.value.package_id !== pkg.value.id)
      throw fault('CKAN_RESOURCE_NOT_IN_PACKAGE');
    if (before.value.datastore_active === false) throw fault('CKAN_RESOURCE_HAS_NO_DATASTORE', 'Select a resource whose DataStore API is active.');
    state.packageId = pkg.value.id; state.resourceId = before.value.id;
    await atomicJson(directory, 'progress.json', state);
    const seen = new Set();
    for (const saved of state.pages) {
      const raw = await readPrivate(join(directory, saved.file), config.maxResponseBytes);
      if (digest(raw) !== saved.sha256) throw fault('CKAN_RETAINED_PAGE_CHANGED');
      for (const row of checkedPage(result(raw), config.resourceId).records) {
        if (Object.hasOwn(row, '_id')) {
          const id = String(row._id);
          if (seen.has(id)) throw fault('CKAN_DUPLICATE_RECORD_ID');
          seen.add(id);
        }
      }
    }
    while (state.state !== 'ROWS_COMPLETE') {
      options.signal?.throwIfAborted();
      const parameters = { resource_id: config.resourceId, limit: config.pageSize, sort: '_id asc',
        records_format: 'objects', include_total: true, filters: state.nextFilters, ...(config.q ? { q: config.q } : {}),
        ...(config.pagination === 'keyset' ? { include_next_page: true } : { offset: state.offset }) };
      const file = pageName(state.pages.length), received = await retain(file, 'datastore_search', parameters);
      const page = checkedPage(received.value, config.resourceId);
      if (state.fields && identity(state.fields) !== identity(page.fields)) throw fault('CKAN_FIELDS_CHANGED_DURING_CAPTURE');
      if (!state.fields) state.fields = page.fields;
      if (config.pagination === 'offset' && page.offset !== undefined && page.offset !== state.offset)
        throw fault('CKAN_OFFSET_CHANGED');
      if (state.rowCount + page.records.length > limits.maxRows) throw fault('CKAN_CAPTURE_ROW_LIMIT');
      for (const row of page.records) {
        if (Object.hasOwn(row, '_id')) {
          const id = String(row._id);
          if (seen.has(id)) throw fault('CKAN_DUPLICATE_RECORD_ID', 'The resource changed or repeated a page during this capture. Start a new edition.');
          seen.add(id);
        }
      }
      if (page.total_was_estimated !== true && Number.isSafeInteger(page.total)) {
        if (state.exactTotal !== null && state.exactTotal !== page.total) throw fault('CKAN_TOTAL_CHANGED_DURING_CAPTURE');
        state.exactTotal = page.total;
      }
      const nextRowCount = state.rowCount + page.records.length;
      const terminal = page.records.length === 0 || page.records.length < page.limit;
      let nextFilters = state.nextFilters;
      if (terminal) {
        if (config.pagination === 'offset' && state.exactTotal !== null && nextRowCount !== state.exactTotal)
          throw fault('CKAN_CAPTURE_INCOMPLETE', 'The returned rows do not match the provider total.');
      } else if (config.pagination === 'keyset') {
        if (!object(page.next_page) || Object.keys(page.next_page).length !== 1 || !Object.hasOwn(page.next_page, '_id'))
          throw fault('CKAN_KEYSET_CURSOR_MISSING', 'This portal did not supply the requested next-page filter. Use offset pagination for a new capture.');
        nextFilters = { ...config.filters, ...page.next_page };
        if (identity(nextFilters) === identity(state.nextFilters))
          throw fault('CKAN_KEYSET_CURSOR_MISSING', 'The portal repeated its next-page filter. Resume with a fresh edition.');
      }
      state.pages.push({ ...fileInfo(file, received.raw), offset: state.offset, returned: page.records.length,
        limit: page.limit, total: page.total ?? null, totalWasEstimated: page.total_was_estimated === true });
      state.rowCount = nextRowCount; state.offset += page.records.length;
      if (terminal) state.state = 'ROWS_COMPLETE';
      else if (config.pagination === 'keyset') { state.nextFilters = nextFilters; state.exactTotal = null; }
      state.updatedAt = stamp(); state.error = null;
      await atomicJson(directory, 'progress.json', state);
      await options.onProgress?.({ rows: state.rowCount, pages: state.pages.length, bytes: state.sourceBytes, state: state.state });
    }
    const after = await retain('resource-after.json', 'resource_show', { id: config.resourceId });
    if (after.value.id !== config.resourceId) throw fault('CKAN_RESOURCE_CHANGED');
    const manifest = { schema: CAPTURE_SCHEMA, provider: 'ckan', readOnly: true, state: 'COMPLETE',
      catalogOrigin: config.catalogOrigin, packageId: state.packageId, resourceId: config.resourceId,
      selection: config, selectionHash, startedAt: state.startedAt, completedAt: stamp(),
      packageFile: 'package.json', resourceFile: 'resource.json', resourceAfterFile: 'resource-after.json',
      packageTitle: pkg.value.title ?? pkg.value.name, resourceTitle: before.value.name ?? config.resourceId,
      license: { id: pkg.value.license_id ?? null, title: pkg.value.license_title ?? null, url: pkg.value.license_url ?? null },
      fields: state.fields ?? [], rowCount: state.rowCount, sourceBytes: state.sourceBytes,
      consistency: identity(version(before.value)) === identity(version(after.value)) ? 'metadata-unchanged' : 'metadata-changed',
      observationKind: 'sequential-datastore-pages', pages: state.pages, files: state.files, receipts: state.receipts };
    await createFile(join(directory, 'capture.json'), bytes(manifest));
    state.state = 'COMPLETE'; await atomicJson(directory, 'progress.json', state);
    return await readCkanCapture(join(directory, 'capture.json'));
  } catch (error) {
    if (state) {
      state.error = { code: error.code ?? 'CKAN_CAPTURE_INTERRUPTED', ...(error.receipt ? { receipt: error.receipt } : {}) };
      state.updatedAt = stamp(); await atomicJson(directory, 'progress.json', state).catch(() => {});
    }
    throw error;
  } finally { await release(); }
}
export async function readCkanCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, 16777216), manifestSha256 = digest(manifestBytes);
  if (expectedHash !== undefined && manifestSha256 !== expectedHash) throw fault('CKAN_CAPTURE_MANIFEST_CHANGED');
  const manifest = parseCkanJson(manifestBytes);
  if (manifest?.schema !== CAPTURE_SCHEMA || manifest.provider !== 'ckan' || manifest.readOnly !== true ||
      manifest.state !== 'COMPLETE' || !Array.isArray(manifest.files) || !Array.isArray(manifest.pages) ||
      !Array.isArray(manifest.fields) || !Number.isSafeInteger(manifest.rowCount))
    throw fault('CKAN_CAPTURE_MANIFEST_INVALID');
  catalogOrigin(manifest.catalogOrigin);
  const rawFiles = new Map(), rows = [], ids = new Set();
  for (const item of manifest.files) {
    if (!/^(package|resource|resource-after)\.json$|^pages\/\d{8}\.json$/.test(item.file ?? '') ||
        !HASH.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 67108864 ||
        rawFiles.has(item.file)) throw fault('CKAN_CAPTURE_FILE_INVALID');
    const raw = await readPrivate(join(dirname(filename), item.file), 67108864);
    if (raw.length !== item.bytes || digest(raw) !== item.sha256) throw fault('CKAN_RETAINED_PAGE_CHANGED');
    rawFiles.set(item.file, raw);
  }
  if (!rawFiles.has('package.json') || !rawFiles.has('resource.json') || !rawFiles.has('resource-after.json'))
    throw fault('CKAN_METADATA_MISSING');
  const pkg = result(rawFiles.get('package.json')), resource = result(rawFiles.get('resource.json'));
  if (pkg.id !== manifest.packageId || resource.id !== manifest.resourceId ||
      !pkg.resources?.some(item => item.id === manifest.resourceId)) throw fault('CKAN_CAPTURE_IDENTITY_CHANGED');
  for (let index = 0; index < manifest.pages.length; index++) {
    const saved = manifest.pages[index], raw = rawFiles.get(saved.file);
    if (saved.file !== pageName(index) || !raw || digest(raw) !== saved.sha256) throw fault('CKAN_CAPTURE_PAGE_MISSING');
    const page = checkedPage(result(raw), manifest.resourceId);
    if (identity(page.fields) !== identity(manifest.fields) || page.records.length !== saved.returned)
      throw fault('CKAN_CAPTURE_PAGE_CHANGED');
    for (const row of page.records) {
      if (Object.hasOwn(row, '_id')) {
        const id = String(row._id);
        if (ids.has(id)) throw fault('CKAN_DUPLICATE_RECORD_ID');
        ids.add(id);
      }
      rows.push(row);
    }
  }
  if (rows.length !== manifest.rowCount || manifest.pages.length === 0) throw fault('CKAN_CAPTURE_COUNT_CHANGED');
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256, fields: manifest.fields,
    rows, rawFiles, package: pkg, resource };
}
export async function searchCkan(origin, { q = '', rows = 20, start = 0, ...options } = {}) {
  if (typeof q !== 'string' || q.length > 2048) throw fault('CKAN_QUERY_INVALID');
  integer(rows, 1, 100, 'CKAN_SEARCH_PAGE_INVALID'); integer(start, 0, 10000000, 'CKAN_SEARCH_OFFSET_INVALID');
  const received = await requestCkan(origin, 'package_search', { q, rows, start }, options);
  if (!Array.isArray(received.value.results) || !Number.isSafeInteger(received.value.count)) throw fault('CKAN_SEARCH_RESPONSE_INVALID');
  return { ...received, page: { start, rows, returned: received.value.results.length, total: received.value.count,
    next: start + received.value.results.length < received.value.count ? start + received.value.results.length : null } };
}

