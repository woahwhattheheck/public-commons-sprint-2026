#!/usr/bin/env node
// MIT. One native operating journey: existing cache + control + workspace + receiver.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createCachedUpstream } from '../upstream.mjs';
import { createResponseCache } from '../cache.mjs';
import { createCacheControlBinding } from '../bind.mjs';
import { createCacheManagement, startCacheControl, callCacheControlFile } from '../control.mjs';
import { openCacheWorkspace } from './model.mjs';
import { startCacheWorkspace } from './server.mjs';

const root = await mkdtemp(join(process.env.CACHE_OPERATIONS_ACCEPTANCE_PARENT ?? tmpdir(), 'cache-operations-'));
let control, workspace, browser, releaseSlow, dropped = false, admissions = 0, reads = 0;
let credential = 1, backendReads = 0;
const backend = createServer((req, res) => {
  backendReads++;
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
  res.end(JSON.stringify({ credentialEdition: credential, authorized: req.headers.authorization === 'Bearer local-' + credential }));
});
await new Promise(done => backend.listen(0, '127.0.0.1', done));
const upstream = createCachedUpstream({ baseUrl: 'http://127.0.0.1:' + backend.address().port, path: '/native',
  allowLocal: true, maxResponseBytes: 8192, maxInFlight: 2, headers: () => ({ authorization: 'Bearer local-' + credential }) },
  { shareAcrossBuyers: true, ttlMs: 60000, maxEntries: 32, maxBytes: 32768, maxEntryBytes: 1024, maxSourceInFlight: 2 });
let markSlow;
const enteredSlow = new Promise(done => { markSlow = done; });
const cache = createResponseCache({
  shareAcrossBuyers: true, ttlMs: 60000, maxEntries: 32, maxBytes: 32768, maxEntryBytes: 1024,
  maxResponseBytes: 8192, maxSourceInFlight: 2,
  admit: () => { admissions++; return true; },
  handler: async context => {
    const number = ++reads;
    if (context.url.pathname === '/slow') await new Promise(done => { releaseSlow = done; markSlow(); });
    else await new Promise(done => setImmediate(done));
    return { body: { number, path: context.url.pathname } };
  },
});
const binding = createCacheControlBinding(new Map([['dataset', cache], ['api', upstream]]));
const management = createCacheManagement(binding);
const context = path => ({ method: 'GET', url: new URL(path, 'http://127.0.0.1:19090'), headers: {}, body: null });
const read = async path => { const request = context(path); assert.equal(await cache.admit(request), true); return cache.handler(request); };
const sourceId = 'merchant', directory = join(root, 'history'), controlFile = join(root, 'control', 'cache.json');
const sources = [{ id: sourceId, label: 'Merchant <internal>', controlFile }];
let token;
async function api(operation, body, query = {}) {
  const url = new URL('/api/cache-operations/' + operation, browser.origin);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-workspace-token': token, ...(body === undefined ? {} :
      { origin: browser.origin, 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function openBrowser() { browser = await startCacheWorkspace({ workspace }); token = new URL(browser.url).hash.slice(1); }
async function capture(label) {
  const state = await api('workspace');
  return (await api('capture', { sourceId, label, expectedRevision: state.revision })).record;
}
async function prepare(review, values = {}) {
  const state = await api('workspace');
  return (await api('prepare', { sourceId, inspectionId: review.id, expectedRevision: state.revision,
    route: 'dataset', action: 'configure', policy: { ttlMs: 30000 }, ...values })).change;
}
async function apply(change) {
  const state = await api('workspace');
  return api('apply', { id: change.id, expectedRevision: state.revision });
}
try {
  await mkdir(join(root, 'control'), { mode: 0o700 });
  control = await startCacheControl({ controlFile, binding, management });
  const initialReads = await Promise.all([read('/dataset'), read('/dataset')]);
  assert.deepEqual(initialReads[0].body, initialReads[1].body);
  assert.equal(reads, 1); assert.equal(admissions, 2); assert.equal(cache.stats().coalesced, 1);
  await Promise.all([upstream.handler(context('/native')), upstream.handler(context('/native'))]);
  assert.equal(backendReads, 1);
  workspace = await openCacheWorkspace({ directory, sources, request: async (_source, command) => {
    const result = await callCacheControlFile(controlFile, command);
    if (dropped && command.op === 'change') { dropped = false; throw Object.assign(new Error('Interrupted after original apply'), { code: 'ECONNRESET' }); }
    return result;
  } });
  await openBrowser();
  assert.equal((await fetch(browser.origin + '/api/cache-operations/workspace')).status, 401);
  const page = await fetch(browser.origin + '/cache-operations');
  assert.equal(page.status, 200); assert.match(await page.text(), /policy-form/);
  assert.equal((await fetch(browser.origin + '/cache-operations/app.mjs')).status, 200);
  const before = await capture('Before policy change');
  const change = await prepare(before);
  const slow = read('/slow'); await enteredSlow;
  const applied = await apply(change);
  assert.equal(applied.change.status, 'APPLIED');
  assert.equal(cache.stats().limits.ttlMs, 30000); assert.equal(cache.stats().sourceInFlight, 1);
  releaseSlow(); await slow;
  assert.equal(cache.stats().entries, 0, 'Old in-flight result must not populate the new cache generation');
  const invalidations = cache.stats().invalidations;
  assert.equal((await apply(change)).change.status, 'APPLIED');
  assert.equal(cache.stats().invalidations, invalidations);
  const stale = await prepare(before, { policy: { ttlMs: 40000 } });
  assert.equal((await apply(stale)).change.error, 'CACHE_CONTROL_REVIEW_STALE');
  await read('/dataset');
  const current = await capture('Current policy');
  const comparison = await api('compare', undefined, { before: before.id, after: current.id });
  assert.equal(comparison.comparison.routes.find(row => row.id === 'dataset').sameGeneration, false);
  assert.deepEqual(comparison.comparison.routes.find(row => row.id === 'dataset').deltas, {});
  await read('/dataset');
  const later = await capture('After repeated read');
  const window = await api('compare', undefined, { before: current.id, after: later.id });
  assert.equal(window.comparison.routes.find(row => row.id === 'dataset').deltas.hits, 1);
  const interrupted = await prepare(later, { policy: { ttlMs: 42000 }, note: 'Recover after connection interruption' });
  dropped = true;
  const pending = await apply(interrupted);
  assert.equal(pending.change.status, 'PENDING'); assert.equal(cache.stats().limits.ttlMs, 42000);
  const appliedCount = cache.stats().invalidations;
  await browser.close(); browser = null; await workspace.close(); workspace = null;
  workspace = await openCacheWorkspace({ directory, sources }); await openBrowser();
  let state = await api('workspace');
  const recovered = await api('recover', { id: interrupted.id, expectedRevision: state.revision });
  assert.equal(recovered.change.status, 'APPLIED');
  assert.equal(cache.stats().invalidations, appliedCount, 'Recovery must reuse the original receipt');
  const restartReview = await capture('Review after reopening history');
  const restorePolicy = await prepare(restartReview, { restoreInspectionId: before.id, policy: undefined });
  assert.equal((await apply(restorePolicy)).change.status, 'APPLIED');
  assert.equal(cache.stats().limits.ttlMs, 60000);
  state = await api('workspace');
  await api('note', { id: restorePolicy.id, expectedRevision: state.revision, note: 'Restored the saved original retention settings.' });
  const credentialReview = await capture('Before native credential rotation');
  credential = 2;
  const rotated = await upstream.handler(context('/native'));
  assert.equal(rotated.status, 200); assert.equal(JSON.parse(rotated.body).credentialEdition, 2);
  const obsoleteCredential = await prepare(credentialReview, { route: 'api', policy: { ttlMs: 15000 } });
  assert.equal((await apply(obsoleteCredential)).change.error, 'CACHE_CONTROL_REVIEW_STALE');
  const currentCredential = await capture('Current native source credentials');
  const upstreamPolicy = await prepare(currentCredential, { route: 'api', policy: { ttlMs: 15000 } });
  assert.equal((await apply(upstreamPolicy)).change.status, 'APPLIED');
  await upstream.handler(context('/native'));
  assert.equal(upstream.inspect().limits.ttlMs, 15000);
  assert.equal(upstream.inspect().limits.maxResponseBytes, 8192);
  assert.equal(upstream.inspect().limits.maxSourceInFlight, 2);
  const archive = await api('export');
  assert.equal(archive.changes.filter(row => row.status === 'APPLIED').length, 4);
  assert.equal(archive.changes.filter(row => row.status === 'REJECTED').length, 2);
  assert.equal(JSON.stringify(archive).includes(controlFile), false);
  const report = await fetch(browser.origin + '/api/cache-operations/report', { headers: { 'x-workspace-token': token } });
  assert.equal(report.status, 200); assert.match(await report.text(), /Merchant &lt;internal&gt;/);
  const archivePath = join(root, 'history.json'), sourcesPath = join(root, 'receiving-sources.json');
  await writeFile(archivePath, JSON.stringify(archive), { mode: 0o600 });
  await writeFile(sourcesPath, JSON.stringify(sources), { mode: 0o600 });
  await browser.close(); browser = null; await workspace.close(); workspace = null;
  const receivedDirectory = join(root, 'received');
  const received = spawnSync(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'restore',
    '--state', receivedDirectory, '--archive', archivePath, '--sources', sourcesPath],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(received.status, 0, received.stderr);
  assert.equal(JSON.parse(received.stdout).id, archive.workspace.id);
  workspace = await openCacheWorkspace({ directory: receivedDirectory, sources });
  assert.deepEqual(workspace.exportWorkspace().changes, archive.changes);
  assert.deepEqual(workspace.exportWorkspace().inspections, archive.inspections);
  console.log(JSON.stringify({ journey: 'merchant-cache-operating-workspace', result: 'PASS',
    sourceReads: reads, admissions, originalInvalidations: cache.stats().invalidations,
    applied: 4, staleReviewsRejected: 2, recoveredWithoutRepeat: true, backendReads, credentialRotationObserved: true,
    snapshots: archive.inspections.length, changes: archive.changes.length,
    receivedWorkspaceId: workspace.snapshot().id, node: process.version }));
} finally {
  releaseSlow?.();
  if (browser) await browser.close();
  if (workspace) await workspace.close();
  if (control) await control.close();
  await cache.close(); await upstream.close();
  await new Promise(done => backend.close(done));
  await rm(root, { recursive: true, force: true });
}
