// MIT. One native catalog lifecycle/performance journey, not a competition simulator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BazaarCatalog, createDiscoveryServer } from '../src/catalog.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--rows', '--baseline', '--catalog'].includes(key) || !value || args.has(key))
    throw new Error('Usage: node query-workload.mjs [--rows 12000 | --catalog private-resources.json] [--baseline path/to/original/catalog.mjs]');
  args.set(key, value);
}
if (args.has('--rows') && args.has('--catalog')) throw new Error('Choose --rows or --catalog');
const count = Number(args.get('--rows') ?? 12000);
if (!Number.isSafeInteger(count) || count < 20 || count > 1000000) throw new Error('rows must be 20..1000000');
const params = values => new URLSearchParams(values);
const fixture = i => ({
  resource: { url: `https://merchant-${i % 37}.example/api/item-${i}`,
    serviceName: ['Weather Atlas', 'Stellar Analytics', 'Inventory API'][i % 3],
    description: `Catalog workload weather analytics inventory ledger record ${i}`,
    tags: ['dataset', `sector-${i % 7}`] },
  accepts: [
    { scheme: i % 2 ? 'exact' : 'upto', network: 'stellar:testnet',
      asset: `asset-${i % 11}`, payTo: `seller-${i % 37}`, amount: String(1000 + i) },
    { scheme: 'exact', network: 'stellar:pubnet', asset: 'USDC',
      payTo: `other-${i % 29}`, amount: '100' },
  ],
  extensions: { bazaar: {
    info: { input: i % 5 ? { type: 'http', method: ['GET', 'POST', 'PATCH'][i % 3] }
      : { type: 'mcp', toolName: `inventory_${i}`, inputSchema: { type: 'object' } } },
    schema: { type: 'object' }, pricing: { model: 'per-call', typical: '300' },
  }, ...(i % 7 ? {} : { workload: {} }) },
});
const source = args.has('--catalog') ? JSON.parse(await readFile(args.get('--catalog'), 'utf8')) : null;
const entries = source === null ? Array.from({ length: count }, (_, i) => fixture(count - i - 1))
  : Array.isArray(source) ? source : source.resources;
if (!Array.isArray(entries) || entries.length < 2) throw new Error('catalog needs at least two validated original resource records');
const baselineFile = args.has('--baseline') ? resolve(args.get('--baseline')) : null;
const baselineModule = baselineFile ? await import(pathToFileURL(baselineFile).href) : null;
const baselineBytes = baselineFile ? await readFile(baselineFile) : null;
const old = baselineModule ? new baselineModule.BazaarCatalog() : null;
const current = new BazaarCatalog();
const load = catalog => { for (const entry of entries) catalog.insertValidated(entry); };
const timed = action => { const start = performance.now(); const value = action(); return { value, ms: performance.now() - start }; };
const loadCurrent = timed(() => load(current));
const loadOriginal = old ? timed(() => load(old)) : null;
let comparisons = 0;
function equal(actual, expected) { assert.deepStrictEqual(actual, expected); comparisons++; }
function compare(method, query, left = current, right = old) {
  const result = left[method](params(query));
  if (right) equal(result, right[method](params(query)));
  return result;
}

// One workload traverses actual list, ranking, pricing and mutation contracts.
const filters = [{}, { type: 'http' }, { type: 'mcp' }, { extensions: 'workload' },
  { network: 'stellar:testnet' }, { network: 'stellar:testnet', asset: 'asset-3', scheme: 'exact' },
  { payTo: 'seller-7' }, { asset: 'USDC', network: 'stellar:pubnet', payTo: 'other-5' },
  { asset: 'USDC', network: 'stellar:testnet' }, // Different accepts MUST NOT combine.
  { type: 'mcp', extensions: 'bazaar', scheme: 'exact', asset: 'asset-0' },
  { network: 'missing' }];
for (const f of filters) {
  for (const offset of [0, 7, 99]) compare('list', { ...f, offset: String(offset), limit: '17' });
  let cursor;
  for (let page = 0; page < 3; page++) {
    const result = compare('search', { ...f, query: 'weather analytics', limit: '13', ...(cursor ? { cursor } : {}) });
    cursor = result.pagination.cursor;
    if (!cursor) break;
  }
}
compare('pricing', { network: 'stellar:testnet', asset: 'asset-3', budgetAtomic: '700' });
for (const q of ['weathre atlas', 'inventory', 'please show the', '!!!', '']) {
  const invoke = catalog => { try { return catalog.search(params({ query: q, limit: '11' })); }
    catch (error) { return { name: error.name, message: error.message }; } };
  if (old) equal(invoke(current), invoke(old)); else invoke(current);
}
const retained = compare('search', { query: 'weather', limit: '1' }).pagination.cursor;
const modified = structuredClone(entries[0]);
modified.resource.description = 'replacement output'; modified.accepts[0].payTo = 'changed-recipient';
current.insertValidated(modified); old?.insertValidated(modified);
compare('list', { payTo: 'changed-recipient' });
compare('list', { payTo: entries[0].accepts[0].payTo });
if (retained) assert.throws(() => current.search(params({ query: 'weather', cursor: retained })), /Stale/);
const clone = current.clone(), oldClone = old?.clone();
const id = clone.insertValidated(fixture(count + 100)); oldClone?.insertValidated(fixture(count + 100));
compare('list', {}, clone, oldClone);
equal(current.size + 1, clone.size);
clone.removeValidated(id); oldClone?.removeValidated(id);
compare('search', { query: 'weather' }, clone, oldClone);
const deleteId = current.insertValidated(fixture(count + 101)); old?.insertValidated(fixture(count + 101));
current.list(); current.search(params({ query: 'inventory' })); // Warm state before retirement.
current.removeValidated(deleteId); old?.removeValidated(deleteId);
current.insertValidated(fixture(count + 101)); old?.insertValidated(fixture(count + 101));
compare('list', {}); compare('search', { query: 'inventory' });
const leaked = current.list(); leaked.resources[0].resource.description = 'caller mutation';
compare('list', {});
for (let i = 0; i < 80; i++) current.list(params({ payTo: `absent-${i}` }));
assert.ok(current.queryStats.cachedResults <= current.queryStats.maxCachedResults);
assert.ok(current.queryStats.cachedReferences <= current.queryStats.maxCachedReferences);
compare('list', {});

// Measure equivalent work on identical cloned states. Warmup avoids charging one
// implementation's module/JIT startup to the other. Timings are not CI thresholds.
const benchCurrent = current.clone(), benchOriginal = old?.clone();
for (const catalog of [benchOriginal, benchCurrent].filter(Boolean)) {
  catalog.list(params({ limit: '1' })); catalog.search(params({ query: 'inventory', limit: '1' }));
}
function journey(catalog, kind) {
  const before = catalog.queryStats ?? null;
  const start = performance.now(); let cursor; const pages = [];
  for (let i = 0; i < (kind === 'list' ? 120 : 12); i++) {
    const result = kind === 'list'
      ? catalog.list(params({ offset: String(i * 17), limit: '17' }))
      : catalog.search(params({ query: 'weather analytics', limit: '17', ...(cursor ? { cursor } : {}) }));
    pages.push(result);
    if (kind === 'search') { cursor = result.pagination.cursor; if (!cursor) break; }
  }
  const elapsed = performance.now() - start;
  return { pages, ms: elapsed, before, after: catalog.queryStats ?? null };
}
const timings = {};
for (const kind of ['list', 'search']) {
  const original = benchOriginal ? journey(benchOriginal, kind) : null;
  const improved = journey(benchCurrent, kind);
  if (original) equal(improved.pages, original.pages);
  timings[kind] = { pages: improved.pages.length, originalMs: original?.ms ?? null,
    indexedMs: improved.ms, speedup: original ? original.ms / improved.ms : null,
    before: improved.before, after: improved.after };
}
// Real native HTTP handler, including pagination envelopes and invalid requests.
const server = createServer(createDiscoveryServer(current));
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
let httpChecks = 0;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/discovery/resources?limit=7', '/discovery/search?query=weather&limit=7',
    '/discovery/pricing?network=stellar:testnet&asset=asset-3&budgetAtomic=700',
    '/discovery/search?query=', '/discovery/resources?limit=0']) {
    const response = await fetch(origin + path); const body = await response.json();
    const url = new URL(path, origin);
    const method = url.pathname.endsWith('resources') ? 'list' : url.pathname.endsWith('search') ? 'search' : 'pricing';
    try { const direct = current[method](url.searchParams); equal(response.status, 200); equal(body, direct); }
    catch (error) { if (!(error instanceof RangeError)) throw error; equal(response.status, 400); equal(body.reason, error.message); }
    httpChecks++;
  }
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
console.log(JSON.stringify({ status: 'PASS', node: process.version,
  corpus: source === null ? 'GENERATED_STRUCTURALLY_VALID_NATIVE_CATALOG_WORKLOAD' : 'OPERATOR_SUPPLIED_NATIVE_CATALOG',
  inputEntries: entries.length, sourceSha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  baselineBlob: baselineBytes ? createHash('sha1').update(`blob ${baselineBytes.length}\0`).update(baselineBytes).digest('hex') : null,
  comparisons, httpChecks, loadMs: { original: loadOriginal?.ms ?? null, indexed: loadCurrent.ms },
  timings, stats: current.queryStats }, null, 2));
