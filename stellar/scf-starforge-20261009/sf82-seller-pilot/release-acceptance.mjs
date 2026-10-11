#!/usr/bin/env node
// MIT. One original-compiler → real seller → operator-console lifecycle exercise.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initReleaseStore, stageRelease, compareReleases, activateRelease, inspectRelease,
  readReleaseState, releaseStatus, runActiveRelease } from './releases.mjs';
import { startReleaseConsole } from './release-console.mjs';

const example = name => fileURLToPath(new URL('../sf61-openapi-seller-import/' + name, import.meta.url));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
async function challenge(listener, expectedAmount) {
  const response = await fetch(listener + '/api/v2/forecast', { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: 38.25, longitude: -85.76 }) });
  assert.equal(response.status, 402);
  const original = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64'));
  assert.equal(original.accepts[0].amount, expectedAmount);
  assert.equal(original.accepts[0].network, 'stellar:testnet');
  await response.arrayBuffer();
  return { status: response.status, amountAtomic: original.accepts[0].amount };
}
export async function exercise({ keep = false, onConsole } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'sf82-releases-'));
  const root = join(workspace, 'store'), config = join(workspace, 'selections.json');
  const bindingsPath = join(workspace, 'bindings.json'), data = join(workspace, 'weather.json');
  let first, second, operator;
  const receipts = [];
  try {
    await initReleaseStore(root);
    const selections = JSON.parse(await readFile(example('service-selections.example.json')));
    const bindings = JSON.parse(await readFile(example('service-bindings.example.json')));
    delete bindings[0].response; bindings[0].responseFile = './weather.json';
    await save(bindingsPath, bindings); await save(config, selections); await save(data, { version: 'first', temperature: 18 });
    const inputs = { spec: example('openapi.example.json'), config, bindings: bindingsPath, runtime: { port: 0 } };
    await stageRelease(root, { ...inputs, id: 'first', label: 'Weather API · initial' });
    selections[0].accepts[0].amount = '30000';
    await save(config, selections); await save(data, { version: 'second', temperature: 19 });
    await stageRelease(root, { ...inputs, id: 'second', label: 'Weather API · updated offer' });
    await save(data, { version: 'later-input-only', temperature: 99 });
    const stored = JSON.parse(await readFile(join(root, 'releases/second/responses/forecast.json')));
    assert.equal(stored.version, 'second');
    const diff = await compareReleases(root, 'first', 'second');
    assert.equal(diff.summary.changed, 1); assert.equal(diff.summary.paymentChanged, 1);
    assert.ok(diff.changes[0].fields.some(field => field.field === 'application'));
    assert.equal(diff.after.routes[0].payment[0].amount, '30000');
    receipts.push('original compiler snapshots and exact payment/application comparison');

    await activateRelease(root, 'first', { expectedGeneration: 0, reason: 'Initial release' });
    first = await runActiveRelease(root, { expectedGeneration: 1 });
    const initial = await challenge(first.url, '20000');
    assert.equal((await releaseStatus(root)).runtime.state, 'RUNNING');
    await assert.rejects(activateRelease(root, 'second', { expectedGeneration: 0 }), { code: 'RELEASE_CONFLICT' });
    await activateRelease(root, 'second', { expectedGeneration: 1, reason: 'Updated price and response snapshot' });
    assert.equal((await releaseStatus(root)).runtime.state, 'RESTART_REQUIRED');
    await assert.rejects(runActiveRelease(root, { expectedGeneration: 2 }), { code: 'RELEASE_BUSY' });
    await challenge(first.url, '20000');
    await first.close(); first = null;
    await assert.rejects(runActiveRelease(root, { expectedGeneration: 1 }), { code: 'RELEASE_CONFLICT' });
    second = await runActiveRelease(root, { expectedGeneration: 2 });
    const upgraded = await challenge(second.url, '30000');
    receipts.push('original live seller selection, concurrent-write rejection, single process and upgrade');

    operator = await startReleaseConsole(root, { port: 0 });
    const call = async (path, payload, extra = {}) => {
      const headers = { 'x-release-token': operator.token, ...extra };
      const options = { headers, redirect: 'error' };
      if (payload !== undefined) {
        options.method = 'POST'; headers.origin ??= operator.url; headers['content-type'] = 'application/json'; options.body = JSON.stringify(payload);
      }
      const response = await fetch(operator.url + path, options), value = await response.json();
      return { response, value };
    };
    assert.equal((await fetch(operator.url + '/api/status')).status, 401);
    assert.equal((await call('/api/run', { expectedGeneration: 2 }, { origin: 'https://different.example' })).response.status, 403);
    assert.equal((await call('/api/stop', { instanceId: second.observation.instanceId })).response.status, 409);
    await challenge(second.url, '30000');
    await second.close(); second = null;
    const started = await call('/api/run', { expectedGeneration: 2 });
    assert.equal(started.response.status, 200); assert.equal(started.value.runtime.observed.releaseId, 'second');
    const changed = await call('/api/rollback', { expectedGeneration: 2, reason: 'Return to original configuration' });
    assert.equal(changed.response.status, 200); assert.equal(changed.value.runtime.state, 'RESTART_REQUIRED');
    assert.equal(changed.value.state.active, 'first');
    const restarted = await call('/api/restart', { expectedGeneration: 3, instanceId: changed.value.console.instanceId });
    assert.equal(restarted.response.status, 200); assert.equal(restarted.value.runtime.observed.releaseId, 'first');
    const rolledBack = await challenge(restarted.value.runtime.observed.listener, '20000');
    const stopped = await call('/api/stop', { instanceId: restarted.value.console.instanceId });
    assert.equal(stopped.response.status, 200); assert.equal(stopped.value.runtime.state, 'STOPPED');
    const state = await readReleaseState(root); assert.equal(state.history.length, 3); assert.equal(state.generation, 3);
    receipts.push('authenticated local console start, rollback, restart, stop and preserved history');

    const responsePath = join(root, 'releases/second/responses/forecast.json');
    const snapshot = await readFile(responsePath);
    await writeFile(responsePath, '{"tampered":true}\n');
    await assert.rejects(inspectRelease(root, 'second'), /Response snapshot changed/);
    await writeFile(responsePath, snapshot);
    receipts.push('staged response-file drift rejected');
    if (onConsole) await onConsole({ operator, root, workspace });
    const result = { passed: true, originalHttpChallenges: { initial, upgraded, rolledBack },
      exercises: receipts, paymentRequests: 0, hostedActions: 0, ...(keep ? { workspace, root } : {}) };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally {
    await first?.close(); await second?.close(); await operator?.close();
    if (!keep) await rm(workspace, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  exercise({ keep: process.argv.includes('--keep') }).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
