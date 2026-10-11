// MIT. One focused actual SF30 HTTP / private control / disk restart exercise.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatasetVersions } from './versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from './service.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'sf30-refresh-'));
const directory = join(temporary, 'state');
const controlTransport = process.argv.includes('--loopback-control') ? 'loopback' : 'unix';
let service, versions, clock = 1000000, verified = 0, waitForVerification, releaseVerification;
const originals = [];
async function dataset(label, columns = { id: 'integer', value: 'string' }) {
  const file = join(temporary, label + '.csv'), config = join(temporary, label + '.json');
  await writeFile(file, `id,value\n1,${label}-first\n2,${label}-second\n3,${label}-third\n`);
  await writeFile(config, JSON.stringify({ schema: 'stellar-forge.csv-dataset.v1',
    name: 'Refresh acceptance', file, columns, filters: ['id'], ranges: ['id'], sorts: ['id'],
    defaultLimit: 1, maxLimit: 3 }));
  return config;
}
const nativeFactory = async compiled => ({
  async processHTTPRequest(context) {
    verified++;
    if (context.adapter.getHeader('payment-signature') !== 'local-refresh-exercise') {
      return { type: 'payment-error', response: { status: 402, headers: {}, body: { error: 'Payment required' } } };
    }
    if (context.adapter.getHeader('x-refresh-exercise-delay') === 'yes') {
      waitForVerification?.();
      await new Promise(done => { releaseVerification = done; });
    }
    return { type: 'payment-verified', paymentPayload: {},
      paymentRequirements: compiled.routes[0].offer.accepts[0], declaredExtensions: {},
      cancellationDispatcher: { cancel: async () => ({}) } };
  },
  async processSettlement(_payload, requirements) {
    originals.push(requirements);
    return { success: true, headers: {} };
  },
  createFailurePathSettlementHeaders() { return {}; },
});
async function request(query = {}, delayed = false) {
  const response = await fetch(service.url + '/data?' + new URLSearchParams({ gte_id: '1', sort: 'id', ...query }), {
    headers: { 'payment-signature': 'local-refresh-exercise',
      ...(delayed ? { 'x-refresh-exercise-delay': 'yes' } : {}) }, signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
async function delayed(query = {}) {
  const entered = new Promise(done => { waitForVerification = done; });
  const response = request(query, true);
  await entered;
  return { response, release: () => releaseVerification() };
}
try {
  const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map(label => dataset(label)));
  versions = await openDatasetVersions({ directory, initialConfig: a, retentionMs: 1000,
    maxVersions: 3, now: () => clock });
  const originalPayment = { scheme: 'exact', network: 'stellar:testnet', asset: 'LOCAL_EXERCISE_ASSET',
    payTo: 'LOCAL_EXERCISE_RECIPIENT', amount: '100', maxTimeoutSeconds: 60 };
  const config = await buildDatasetSellerConfig(versions, { payment: originalPayment,
    origin: 'https://dataset.example', path: '/data' });
  service = await startVersionedDatasetSeller({ versions, config, port: 0, nativeFactory, controlTransport });
  if (controlTransport === 'loopback') {
    const descriptor = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    const unauthenticated = await fetch(`http://127.0.0.1:${descriptor.port}/status`);
    assert.equal(unauthenticated.status, 403); await unauthenticated.text();
  }
  const first = await request();
  const snapshotA = first.body.dataset.snapshot, cursorA = first.body.page.nextCursor;
  assert.equal(first.body.rows[0].value, 'A-first');
  const admittedA = await delayed();
  const refreshed = await datasetControl(directory, 'refresh', { configPath: b, expectedSnapshot: snapshotA });
  assert.equal(refreshed.changed, true);
  assert.equal((await request()).body.rows[0].value, 'B-first');
  admittedA.release();
  assert.equal((await admittedA.response).body.rows[0].value, 'A-first');
  assert.equal((await request({ cursor: cursorA })).body.rows[0].value, 'A-second');
  const beforeRejection = verified;
  assert.equal((await request({ cursor: cursorA, fields: 'id' })).status, 400);
  assert.equal(verified, beforeRejection);
  const snapshotB = versions.status().current;
  await assert.rejects(datasetControl(directory, 'refresh', { configPath: c, expectedSnapshot: snapshotA }),
    error => error.code === 'DATASET_CURRENT_CHANGED');
  const badContract = await dataset('contract', { id: 'string', value: 'string' });
  await assert.rejects(versions.refresh({ configPath: badContract, expectedSnapshot: snapshotB }),
    error => error.code === 'DATASET_CONTRACT_CHANGED');
  await versions.refresh({ configPath: c, expectedSnapshot: snapshotB });
  const snapshotC = versions.status().current, current = await request();
  await assert.rejects(versions.refresh({ configPath: d, expectedSnapshot: snapshotC }),
    error => error.code === 'DATASET_RETENTION_CAPACITY');
  const retainedA = await delayed({ cursor: cursorA });
  clock += 1001;
  const collected = await datasetControl(directory, 'collect');
  assert.deepEqual(collected.removed, [snapshotB]);
  assert.equal(collected.versions.find(v => v.snapshot === snapshotA).readers, 1);
  retainedA.release();
  assert.equal((await retainedA.response).body.rows[0].value, 'A-second');
  await versions.collect();
  const beforeExpired = verified;
  assert.equal((await request({ cursor: cursorA })).status, 410);
  assert.equal(verified, beforeExpired);
  await service.close(); service = null;
  versions = await openDatasetVersions({ directory, now: () => clock });
  service = await startVersionedDatasetSeller({ versions, config, port: 0, nativeFactory, controlTransport });
  const resumed = await request({ cursor: current.body.page.nextCursor });
  assert.equal(resumed.body.dataset.snapshot, snapshotC);
  assert.equal(resumed.body.rows[0].value, 'C-second');
  assert(originals.length > 0);
  for (const value of originals) assert.deepEqual(value, originalPayment);
  console.log('PASS: original SF30 range/sort HTTP query, private atomic refresh, copied-admission request pin, retained cursor, filter identity, stale operator update, contract rejection, retention capacity, active-reader collection, pre-verification expiry, disk restart, unchanged payment tuple.');
  console.log('Native interface outcomes were controlled locally; no wallet, network settlement, package install or hosted CI.');
} finally {
  if (service) await service.close(); else await versions?.close();
  await rm(temporary, { recursive: true, force: true });
}
