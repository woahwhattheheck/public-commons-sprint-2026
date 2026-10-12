#!/usr/bin/env node
// MIT. One native end-to-end cache policy journey through the original SF61 HTTP host.
// Usage: node workspace/cache-policy-journey.mjs EXISTING_PRIVATE_OUTPUT_PARENT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { startWorkspace } from './server.mjs';
import { readPackage } from './model.mjs';

const OPERATION = 'ASTRA-D76C-SCF-CACHE-POLICY-20261012';
const retained = ['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes'];
const retention = value => Object.fromEntries(retained.map(key => [key, value[key]]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const withoutRetention = plan => {
  const copy = clone(plan);
  for (const operation of copy.operations) if (operation.cache)
    for (const key of retained) delete operation.cache[key];
  return copy;
};

export async function runCachePolicyJourney({ parent = tmpdir() } = {}) {
  const root = await mkdtemp(join(resolve(parent), 'sf61-cache-policy-journey-'));
  const projects = join(root, 'projects'), receiving = join(root, 'receiving');
  await mkdir(projects, { mode: 0o700 });
  await mkdir(receiving, { mode: 0o700 });
  const report = { schema: 'stellar-forge.cache-policy-native-journey.v1', operation: OPERATION,
    startedAt: new Date().toISOString(), node: process.version, root, steps: [], source: {} };
  for (const name of ['model.mjs', 'revisions.mjs', 'cache-policy-revisions.mjs', 'server.mjs'])
    report.source[name] = digest(await readFile(new URL(name, import.meta.url)));
  const step = (name, details = {}) => {
    report.steps.push({ name, completedAt: new Date().toISOString(), ...details });
  };
  let app;
  const close = async () => { if (app) { const current = app; app = null; await current.close(); } };
  const start = async parent => { app = await startWorkspace({ parent, port: 0, noSignals: true }); };
  const headers = body => ({ 'x-workspace-token': app.token, Origin: app.origin,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) });
  const api = async (path, body, status = 200) => {
    const response = await fetch(app.origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: headers(body), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45000) });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { throw new Error(path + ' returned non-JSON: ' + text.slice(0,400)); }
    assert.equal(response.status, status, path + ': ' + text.slice(0,2000));
    return value;
  };
  const baseName = 'weather-original', nextName = 'weather-retained', foreignName = 'weather-separate';
  const endpoint = (operation, name = baseName, query = {}) => '/api/cache-operations/' + operation + '?' +
    new URLSearchParams({ name, ...query });
  const cache = (operation, body, { name = baseName, query = {}, status = 200 } = {}) =>
    api(endpoint(operation, name, query), body, status);
  const specText = await readFile(new URL('../openapi.example.json', import.meta.url), 'utf8');
  const selections = JSON.parse(await readFile(new URL('../service-selections.example.json', import.meta.url), 'utf8'));
  const { scheme, amount, ...payment } = selections[0].accepts[0];
  assert.equal(scheme, 'exact');
  const originalPolicy = { shareAcrossBuyers: true, ttlMs: 30000, maxEntries: 64,
    maxBytes: 1048576, maxEntryBytes: 65536, maxSourceInFlight: 2, maxWaiters: 32, sourceTimeoutMs: 5000 };
  const afterPolicy = { ttlMs: 75000, maxEntries: 96, maxBytes: 2097152, maxEntryBytes: 131072 };
  const plan = { schema: 'stellar-forge.api-merchant-plan.v1', sellerServer: 'https://merchant.example/api',
    serviceName: selections[0].serviceName, payment: { ...payment, paymentFlow: 'authorization' },
    operations: [
      { id: 'forecast', method: 'GET', path: '/forecast/{city}', amountAtomic: amount,
        timeoutMs: 4500, maxResponseBytes: 1048576, maxInFlight: 3, requestHeaders: ['accept-language'],
        responseMode: 'json', responseValidation: 'none', publicDescription: 'Forecast for one city',
        cache: originalPolicy },
      { id: 'coordinates', method: 'POST', path: '/forecast', amountAtomic: '27000',
        timeoutMs: 7000, maxResponseBytes: 262144, maxRequestBytes: 8192, maxInFlight: 4,
        responseMode: 'json', responseValidation: 'none', publicDescription: 'Forecast from coordinates' }
    ], allowLoopbackUpstream: false };
  try {
    await start(projects);
    const asset = await fetch(app.origin + '/cache-operations?name=' + baseName);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /retained-policy-form/);
    const script = await fetch(app.origin + '/cache-operations/app.mjs');
    assert.equal(script.status, 200);
    assert.match(await script.text(), /policy-review/);
    await api('/api/save', { specText, plan, name: baseName }, 201);
    const base = await readPackage(projects, baseName);
    assert.equal(base.specText, specText);
    assert.deepEqual(base.plan, plan);
    const running = await api('/api/start', { name: baseName });
    assert.equal(running.state, 'RUNNING');
    const initial = await cache('workspace');
    const before = await cache('capture', { sourceId: 'merchant', expectedRevision: initial.revision,
      label: 'Original compiled retention' });
    assert.equal(before.record.inspection.package.id, base.manifest.id);
    assert.equal(before.record.inspection.package.sourceSha256, base.manifest.files[base.manifest.sourceFile]);
    assert.deepEqual(retention(before.record.inspection.routes.forecast.limits), retention(originalPolicy));
    step('original-compile-save-start-and-capture', { packageId: base.manifest.id, runtimeId: running.runtimeId,
      snapshotId: before.record.id, policy: retention(before.record.inspection.routes.forecast.limits) });

    const prepared = await cache('prepare', { sourceId: 'merchant', inspectionId: before.record.id,
      expectedRevision: before.workspace.revision, route: 'forecast', action: 'configure',
      policy: afterPolicy, note: 'Retain reviewed operating limits in the next immutable package.' });
    const applied = await cache('apply', { id: prepared.change.id, expectedRevision: prepared.workspace.revision });
    assert.equal(applied.change.status, 'APPLIED');
    const after = await cache('capture', { sourceId: 'merchant', expectedRevision: applied.workspace.revision,
      label: 'Retained operating policy' });
    assert.deepEqual(retention(after.record.inspection.routes.forecast.limits), afterPolicy);
    assert.equal(after.record.inspection.package.id, base.manifest.id);
    const comparison = await cache('compare', undefined, { query: { before: before.record.id, after: after.record.id } });
    assert.equal(comparison.comparison.sameInstance, true);
    step('native-configure-apply-and-capture', { changeId: applied.change.id, snapshotId: after.record.id,
      instanceId: after.record.inspection.instanceId, policy: afterPolicy });

    const archive = await cache('export');
    await api('/api/save', { specText, plan, name: foreignName }, 201);
    const foreign = await readPackage(projects, foreignName);
    assert.notEqual(foreign.manifest.id, base.manifest.id);
    await cache('restore', { archive }, { name: foreignName });
    const rejected = await cache('policy-review', { inspectionId: after.record.id, routeIds: ['forecast'],
      name: 'foreign-policy', note: 'Separate package must retain its own operating snapshot.' },
      { name: foreignName, status: 409 });
    assert.match(rejected.error, /exact API package/);
    await assert.rejects(lstat(join(projects, 'foreign-policy')), { code: 'ENOENT' });
    step('foreign-package-snapshot-rejected', { sourcePackage: base.manifest.id,
      attemptedPackage: foreign.manifest.id, httpStatus: 409 });

    const review = await cache('policy-review', { inspectionId: after.record.id, routeIds: ['forecast'],
      name: nextName, note: 'Reviewed retention from the original managed cache.' }, { status: 201 });
    assert.equal(review.state, 'PREPARED');
    assert.equal(review.review.ready, true);
    assert.deepEqual(review.record.changes.map(row => row.routeId), ['forecast']);
    const reviews = await cache('policy-list');
    assert(reviews.reviews.some(row => row.id === review.record.id));
    await close();
    await start(projects);
    const reopened = await cache('policy-show', undefined, { query: { id: review.record.id } });
    assert.equal(reopened.state, 'PREPARED');
    assert.deepEqual(reopened.record, review.record);
    assert.equal((await api('/api/status')).state, 'STOPPED');
    step('retained-review-survives-complete-host-close', { reviewId: review.record.id,
      reviewSha256: review.record.reviewSha256, sourceWorkspaceId: review.record.workspaceId });

    const request = { id: review.record.id, expectedReviewSha256: review.record.reviewSha256 };
    // Consume and discard the successful response, then restart before asking
    // again. Recovery must be derived from the saved package, not client state.
    const lost = await fetch(app.origin + endpoint('policy-save'), { method: 'POST',
      headers: headers(request), body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
    const discarded = await lost.arrayBuffer();
    assert.equal(lost.status, 200, 'First policy save failed: ' + Buffer.from(discarded).toString('utf8').slice(0,2000));
    const candidate = await readPackage(projects, nextName);
    assert.equal(candidate.sourceRevision.operatingDecision.id, review.record.id);
    assert.equal(candidate.specText, base.specText);
    assert.deepEqual(candidate.plan.payment, base.plan.payment);
    assert.deepEqual(withoutRetention(candidate.plan), withoutRetention(base.plan));
    assert.deepEqual(candidate.plan.operations[1], base.plan.operations[1]);
    assert.deepEqual(retention(candidate.plan.operations[0].cache), afterPolicy);
    assert.equal(candidate.plan.operations[0].cache.shareAcrossBuyers, true);
    for (const key of ['maxSourceInFlight', 'maxWaiters', 'sourceTimeoutMs'])
      assert.equal(candidate.plan.operations[0].cache[key], originalPolicy[key]);
    assert.deepEqual(candidate.sourceRevision.base, review.record.base);
    assert.equal(candidate.sourceRevision.operatingDecision.snapshot.id, after.record.id);
    assert.equal(candidate.manifest.files[base.manifest.sourceFile], base.manifest.files[base.manifest.sourceFile]);
    step('policy-saved-through-original-revision-and-compiler', { packageId: candidate.manifest.id,
      name: candidate.name, sourceSha256: candidate.manifest.files[candidate.manifest.sourceFile],
      planSha256: candidate.manifest.files['merchant-plan.json'], untouchedRoute: 'coordinates',
      paymentPreserved: true, nonRetentionSettingsPreserved: true });
    await close();
    await start(projects);
    const recovered = await cache('policy-save', request);
    assert.equal(recovered.state, 'SAVED');
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.saved.manifest.id, candidate.manifest.id);
    assert.deepEqual(recovered.saved.sourceRevision, candidate.sourceRevision);
    const completed = await cache('policy-show', undefined, { query: { id: review.record.id } });
    assert.equal(completed.state, 'SAVED');
    assert.equal(completed.saved.manifest.id, candidate.manifest.id);
    step('lost-response-recovered-after-host-restart', { packageId: recovered.saved.manifest.id,
      reviewId: recovered.record.id, recovered: recovered.recovered });

    const newRuntime = await api('/api/start', { name: nextName });
    assert.equal(newRuntime.state, 'RUNNING');
    const savedLive = await cache('inspect', { sourceId: 'merchant' }, { name: nextName });
    assert.equal(savedLive.package.id, candidate.manifest.id);
    assert.deepEqual(retention(savedLive.routes.forecast.limits), afterPolicy);
    const loaded = await api('/api/load?' + new URLSearchParams({ name: nextName }));
    assert.deepEqual(loaded.sourceRevision, candidate.sourceRevision);
    assert.equal(loaded.specText, specText);
    step('saved-policy-starts-in-original-host', { packageId: savedLive.package.id,
      instanceId: savedLive.instanceId, policy: retention(savedLive.routes.forecast.limits) });
    await close();

    await cp(candidate.folder, join(receiving, nextName), { recursive: true, force: false, errorOnExist: true });
    const received = await readPackage(receiving, nextName);
    assert.deepEqual(received.manifest, candidate.manifest);
    assert.deepEqual(received.sourceRevision, candidate.sourceRevision);
    await start(receiving);
    assert.equal((await api('/api/start', { name: nextName })).state, 'RUNNING');
    const receivedLive = await cache('inspect', { sourceId: 'merchant' }, { name: nextName });
    assert.equal(receivedLive.package.id, candidate.manifest.id);
    assert.notEqual(receivedLive.instanceId, savedLive.instanceId);
    assert.deepEqual(retention(receivedLive.routes.forecast.limits), afterPolicy);
    const receiverState = await cache('workspace', undefined, { name: nextName });
    const receiverCapture = await cache('capture', { sourceId: 'merchant',
      expectedRevision: receiverState.revision, label: 'Receiving host retained policy' }, { name: nextName });
    assert.equal(receiverCapture.record.inspection.package.id, candidate.manifest.id);
    step('receiving-copy-reopens-and-starts-same-policy', { folder: received.folder,
      packageId: received.manifest.id, instanceId: receivedLive.instanceId,
      snapshotId: receiverCapture.record.id, policy: retention(receivedLive.routes.forecast.limits) });
    await close();
    report.state = 'PASSED';
    report.completedAt = new Date().toISOString();
  } catch (error) {
    report.state = 'FAILED';
    report.failure = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    try { await close(); } finally {
      await writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
  }
  console.log(JSON.stringify({ state: report.state, operation: OPERATION, result: join(root, 'result.json'),
    steps: report.steps.length, node: report.node, source: report.source }));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCachePolicyJourney({ parent: process.argv[2] ?? tmpdir() }).catch(error => {
    console.error(error.stack ?? error.message); process.exitCode = 1;
  });
