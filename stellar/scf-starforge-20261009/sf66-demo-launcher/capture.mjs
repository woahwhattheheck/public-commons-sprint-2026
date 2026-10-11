// MIT. Source-native full-page evidence capture for the existing canonical SF66 launcher.
// Only consumes actual locally running original SF60/SF61 read-only GET endpoints.
// No independent service, checkout process, catalog, wallet, or paid provider access.
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function jsonGet(url) {
  const response = await fetch(url, {
    method: 'GET', redirect: 'error', headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Original source GET returned ${response.status} at ${new URL(url).pathname}`);
  }
  if (!/json/i.test(response.headers.get('content-type') ?? '')) throw new Error('Original endpoint response was not JSON');
  if (!response.body) throw new Error('Original endpoint gave no response body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) throw new Error('Original response exceeds 16 MiB page limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const raw = Buffer.concat(chunks);
  let data;
  try { data = JSON.parse(raw.toString('utf8')); }
  catch { throw new Error('Original source response contained invalid JSON'); }
  return { raw, data, sha256: hash(raw) };
}

function paramsFor({ network, limit }, offset) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (network) params.set('network', network);
  return params;
}

async function observe({ backend, explorer, config }) {
  const [health, source] = await Promise.all([
    jsonGet(backend.origin + '/healthz'),
    jsonGet(explorer.url + '/api/source'),
  ]);
  if (source.data.mode !== 'ORIGINAL_SF60_DURABLE_CATALOG' ||
      source.data.paidRequestsEnabled !== false || source.data.autoPaymentEnabled !== false ||
      source.data.origin !== backend.origin) throw new Error('SF61 explorer did not bind to the original SF60 backend');
  if (health.data === null || typeof health.data !== 'object') throw new Error('Original SF60 health payload is invalid');
  return { health, source };
}

async function snapshot({ backend, explorer, config, starting }) {
  const pages = [];
  let offset = 0;
  let total = null;
  // The original SF61 proxy explicitly bounds list offsets to seven digits.
  // Never silently stop a survey that the original interface cannot express.
  while (true) {
    if (offset > 9999999) throw new Error('Original SF61 list-offset limit exceeded');
    const qs = paramsFor(config, offset);
    const [native, viewer] = await Promise.all([
      jsonGet(backend.origin + '/discovery/resources?' + qs),
      jsonGet(explorer.url + '/api/discovery?view=list&' + qs),
    ]);
    const rows = native.data?.resources;
    const displayed = viewer.data?.resources;
    const declaredTotal = native.data?.pagination?.total;
    if (!Array.isArray(rows) || !Array.isArray(displayed) ||
        !Number.isSafeInteger(declaredTotal) || declaredTotal < 0) {
      throw new Error('Original native list response lacks resources or integer pagination.total');
    }
    if (viewer.data?.mode !== 'ORIGINAL_SF60_DURABLE_CATALOG' ||
        viewer.data?.paidRequestsEnabled !== false ||
        JSON.stringify(rows) !== JSON.stringify(displayed)) {
      throw new Error(`Native backend vs Atlas proxy mismatch at offset ${offset}`);
    }
    // Matching rows alone cannot certify Atlas pagination or filtered coverage.
    // Compare every original page, not just the unfiltered first page sampled
    // by launch.mjs; an altered total/cursor/limit must never export COMPLETE.
    if (JSON.stringify(native.data.pagination) !==
        JSON.stringify(viewer.data?.pagination)) {
      throw new Error(`Native backend vs Atlas pagination mismatch at offset ${offset}`);
    }
    if (total !== null && total !== declaredTotal) throw new Error('Catalog changed while capturing; retry from a stable original journal');
    if (total === null) total = declaredTotal;
    if (offset + rows.length > total || rows.length > config.limit || (offset < total && rows.length === 0)) {
      throw new Error(`Non-progressing or inconsistent native pagination at offset ${offset}`);
    }
    pages.push({
      offset, count: rows.length, total, nativeSha256: native.sha256,
      viewerSha256: viewer.sha256, originalNativeJson: native.raw.toString('utf8'),
      originalViewerJson: viewer.raw.toString('utf8'),
    });
    offset += rows.length;
    if (offset === total) break;
    if (rows.length === 0) throw new Error('Original catalog pagination stopped before its declared total');
  }
  const ending = await observe({ backend, explorer, config });
  if (starting.health.sha256 !== ending.health.sha256) {
    throw new Error('SF60 native health changed during capture; no complete-stable manifest was written');
  }
  return {
    schema: 'stellar-forge.sf66.original-operator-capture/v1',
    capturedAt: new Date().toISOString(),
    provenance: 'Original owner-local SF60 HTTP and unmodified SF61 Atlas proxy, same process',
    sourceType: 'operator-owned-existing-durable-journal',
    directory: config.directory, network: config.network,
    filter: 'native listing, no search, no paid endpoint access',
    readOnly: true, signedRequests: 0, paidRequests: 0, onchainTransactions: 0,
    completeness: 'COMPLETE_FOR_STABLE_NATIVE_SF60_FILTERED_LIST_AT_OBSERVATION',
    count: offset, pages, initialNativeHealthSha256: starting.health.sha256,
    finalNativeHealthSha256: ending.health.sha256,
    nativeSourceInfo: starting.source.data,
  };
}

async function writeExclusiveAtomic(destination, bytes) {
  // Hard link to destination is atomic/no-clobber on the Linux cloud runtime.
  // Do not replace an operator's earlier original capture.
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + '.tmp-' + randomUUID();
  await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
  try { await link(temp, destination); }
  finally { await unlink(temp).catch(() => {}); }
}

/** Capture every original SF60 list page and its unmodified SF61 Atlas proxy response.
 * Called ONLY by the original `sf66-demo-launcher/launch.mjs` after opening both
 * canonical listeners. Does not create or own a second journal/server.
 */
export async function captureFullCatalog({ backendOrigin, atlasUrl, directory, destination,
  network = null, limit = 100 } = {}) {
  for (const address of [backendOrigin, atlasUrl]) {
    if (typeof address !== 'string') throw new TypeError('Actual loopback origin required');
    const url = new URL(address);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('Actual SF60/SF61 loopback origins required');
    }
  }
  if (typeof directory !== 'string' || !directory.trim() ||
      typeof destination !== 'string' || !destination.trim())
    throw new TypeError('Explicit existing journal and output path required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Original native page limit must be 1..100');
  if (network !== null && !['stellar:testnet', 'stellar:pubnet'].includes(network))
    throw new RangeError('Only source-native Stellar network filters are supported');
  const backend = { origin: backendOrigin };
  const explorer = { url: atlasUrl };
  const config = { directory: resolve(directory), network, limit };
  const starting = await observe({ backend, explorer, config });
  const result = await snapshot({ backend, explorer, config, starting });
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  const path = resolve(destination);
  await writeExclusiveAtomic(path, bytes);
  return { path, count: result.count, pages: result.pages.length,
    sha256: hash(bytes), filter: network, nativeJournalHead: starting.health.data.journalHead };
}
