// MIT. Operator-local composition of the ORIGINAL SF60 durable catalog and SF61 Bazaar Atlas.
// No independent catalog, registry, crawler, facilitator, signer, or payment lifecycle.
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDiscovery } from '../sf60-durable-catalog-transaction/service.mjs';
import { startExplorer } from '../sf61-bazaar-explorer/server.mjs';

const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_LIMIT = 100;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function parsePort(value) {
  if (!/^(0|[1-9]\d*)$/.test(value ?? '')) throw new Error('Ports must be integers 0..65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) throw new Error('Ports must be integers 0..65535');
  return port;
}

function parseArguments(args) {
  const usage = 'Usage: node desk.mjs --directory EXISTING_JOURNAL [--create-empty] [--ui-port 0] [--backend-port 0] [--network stellar:testnet|stellar:pubnet] [--limit 100] [--snapshot OUTPUT.json] [--once]';
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' && args.length === 1) return { help: usage };
    if (!['--directory', '--create-empty', '--ui-port', '--backend-port', '--network', '--limit', '--snapshot', '--once'].includes(key) || values.has(key)) {
      throw new Error(usage);
    }
    if (['--create-empty', '--once'].includes(key)) { values.set(key, true); continue; }
    const next = args[++i];
    if (!next || next.startsWith('--')) throw new Error(usage);
    values.set(key, next);
  }
  if (!values.has('--directory')) throw new Error(usage);
  const limit = values.has('--limit') ? Number(values.get('--limit')) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Page limit must be 1..100');
  const network = values.get('--network') ?? null;
  if (network !== null && !['stellar:testnet', 'stellar:pubnet'].includes(network)) throw new Error('Unsupported Stellar network');
  return {
    directory: resolve(values.get('--directory')),
    createEmpty: values.has('--create-empty'),
    backendPort: parsePort(values.get('--backend-port') ?? '0'),
    uiPort: parsePort(values.get('--ui-port') ?? '0'),
    network, limit, snapshot: values.get('--snapshot') ? resolve(values.get('--snapshot')) : null,
    once: values.has('--once'),
  };
}

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

export async function runOperatorDesk(config) {
  let backend = null;
  let explorer = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (explorer) await explorer.close(); }
    finally { if (backend) await backend.close(); }
  };
  try {
    backend = await openDiscovery({ directory: config.directory, port: config.backendPort, createEmpty: config.createEmpty });
    explorer = await startExplorer({ localUpstream: backend.origin, port: config.uiPort });
    const starting = await observe({ backend, explorer, config });
    let capture = null;
    if (config.snapshot) {
      capture = await snapshot({ backend, explorer, config, starting });
      const bytes = Buffer.from(JSON.stringify(capture, null, 2) + '\n');
      await writeExclusiveAtomic(config.snapshot, bytes);
    }
    return {
      backendOrigin: backend.origin, explorerUrl: explorer.url,
      journalDirectory: config.directory,
      nativeHealth: starting.health.data,
      snapshotPath: config.snapshot,
      snapshotRows: capture?.count ?? null,
      snapshotSha256: capture ? hash(Buffer.from(JSON.stringify(capture, null, 2) + '\n')) : null,
      close,
    };
  } catch (error) {
    await close().catch(closeError => { error.message += '; close: ' + closeError.message; });
    throw error;
  }
}

async function main() {
  const config = parseArguments(process.argv.slice(2));
  if (config.help) { console.log(config.help); return; }
  const desk = await runOperatorDesk(config);
  console.log(JSON.stringify({ status: 'READY', originalSource: 'SF60+SF61', ui: desk.explorerUrl,
    journal: desk.journalDirectory, health: desk.nativeHealth,
    snapshot: desk.snapshotPath, rows: desk.snapshotRows, snapshotSha256: desk.snapshotSha256,
    readOnly: true, paymentsEnabled: false }));
  if (config.once) { await desk.close(); return; }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await desk.close(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('SF66_OPERATOR_DESK_FAILED: ' + error.message); process.exitCode = 1; });
}
