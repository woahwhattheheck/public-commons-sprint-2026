// MIT. One complete local merchant workflow through the actual original services.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatasetVersions } from './versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from './service.mjs';
import { startDatasetPublishingWorkspace } from './workspace.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'sf30-publisher-'));
const directory = join(temporary, 'state');
const csv = {
  initial: 'sku,units,category\nA,2,tools\nB,7,tools\nC,4,parts\n',
  candidate: 'sku,units,category\nA,6,tools\nB,9,tools\nC,2,parts\nD,11,tools\n',
  intervening: 'sku,units,category\nA,1,tools\nE,5,parts\n',
};
let versions, seller, workspace, clock = 1000000;
async function source(name) {
  const file = join(temporary, name + '.csv'), configPath = join(temporary, name + '.json');
  await writeFile(file, csv[name]);
  await writeFile(configPath, JSON.stringify({ schema: 'stellar-forge.csv-dataset.v1',
    name: 'Merchant publication exercise', file,
    columns: { sku: 'string', units: 'integer', category: 'string' },
    filters: ['category'], ranges: ['units'], sorts: ['units'], defaultLimit: 2, maxLimit: 4 }));
  return configPath;
}
async function api(action, body, { method = 'POST', code = 200, headers = {} } = {}) {
  const response = await fetch(workspace.origin + '/api/' + action, {
    method, headers: { authorization: 'Bearer ' + workspace.token,
      ...(body === undefined ? {} : { 'content-type': typeof body === 'string' ? 'text/csv' : 'application/json' }),
      ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  assert.equal(response.status, code, action + ': ' + JSON.stringify(result));
  return result;
}
async function challenge() {
  const response = await fetch(seller.url + '/data?limit=1', { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 402);
  return { body: await response.json(), paymentRequired: response.headers.get('payment-required') };
}
try {
  const initialConfig = await source('initial'), intervening = await source('intervening');
  versions = await openDatasetVersions({ directory, initialConfig, retentionMs: 1000,
    maxVersions: 6, now: () => clock });
  const config = await buildDatasetSellerConfig(versions, {
    origin: 'https://dataset.example', path: '/data', payment: {
      scheme: 'exact', network: 'stellar:testnet', asset: 'LOCAL_EXERCISE_ASSET',
      payTo: 'LOCAL_EXERCISE_RECIPIENT', amount: '100', maxTimeoutSeconds: 60 } });
  seller = await startVersionedDatasetSeller({ versions, config, port: 0, controlTransport: 'loopback' });
  workspace = await startDatasetPublishingWorkspace({ directory, port: 0 });
  const termsBefore = await challenge();
  const document = await fetch(workspace.origin);
  assert.equal(document.status, 200);
  assert.match(document.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await document.text(), /Publish draft/);
  for (const asset of ['/workspace.js', '/workspace.css']) {
    const response = await fetch(workspace.origin + asset);
    assert.equal(response.status, 200); assert((await response.text()).length > 100);
  }
  await api('status', undefined, { method: 'GET', code: 401, headers: { authorization: 'Bearer unavailable' } });
  await api('status', undefined, { method: 'GET', code: 403, headers: { origin: 'https://unrelated.example' } });
  const initial = (await api('status', undefined, { method: 'GET' })).status;
  const uploaded = await api('draft', csv.candidate, { method: 'PUT', headers: { 'x-upload-name': 'inventory.csv' } });
  const draft = uploaded.draft, target = 'draft:' + draft.id;
  assert.equal(draft.dataset.rowCount, 4); assert.equal(uploaded.status.current, initial.current);
  assert.equal(draft.expectedRevision, initial.revision);
  await api('draft', 'sku,units,category\nA,not-an-integer,tools\n', { method: 'PUT', code: 422 });
  assert.equal((await api('status', undefined, { method: 'GET' })).draft.id, draft.id);
  const query = new URLSearchParams({ fields: 'sku,units', where_category: 'tools', gte_units: '6', sort: '-units', limit: '1' });
  const first = await api('preview', { target, query: query.toString() });
  assert.deepEqual(first.result.rows, [{ sku: 'D', units: 11 }]);
  assert.equal(first.result.page.total, 3);
  query.set('cursor', first.result.page.nextCursor);
  const next = await api('preview', { target, query: query.toString() });
  assert.deepEqual(next.result.rows, [{ sku: 'B', units: 9 }]);
  const secondOperator = await datasetControl(directory, 'refresh', { configPath: intervening,
    expectedSnapshot: initial.current, expectedRevision: initial.revision });
  assert.notEqual(secondOperator.current, initial.current);
  await api('publish', { id: draft.id, expectedSnapshot: draft.expectedSnapshot,
    expectedRevision: draft.expectedRevision }, { code: 409 });
  const retained = await api('status', undefined, { method: 'GET' });
  assert.equal(retained.draft.id, draft.id); assert.equal(retained.status.current, secondOperator.current);
  const reviewed = await api('draft/review-current', { id: draft.id });
  assert.equal(reviewed.draft.dataset.snapshot, draft.dataset.snapshot);
  assert.equal(reviewed.draft.expectedRevision, reviewed.status.revision);
  await api('preview', { target, query: '' });
  const published = await api('publish', { id: draft.id, expectedSnapshot: reviewed.draft.expectedSnapshot,
    expectedRevision: reviewed.draft.expectedRevision });
  assert.equal(published.draft, null); assert.equal(published.status.current, draft.dataset.snapshot);
  const current = await api('preview', { target: published.status.current, query: '' });
  assert.equal(current.result.dataset.snapshot, draft.dataset.snapshot);
  const old = await api('preview', { target: initial.current, query: '' });
  assert.deepEqual(old.result.rows[0], { sku: 'A', units: 2, category: 'tools' });
  const rollback = await api('activate', { snapshot: initial.current,
    expectedSnapshot: published.status.current, expectedRevision: published.status.revision });
  assert.equal(rollback.status.current, initial.current);
  assert(rollback.status.revision > published.status.revision);
  await api('activate', { snapshot: draft.dataset.snapshot, expectedSnapshot: initial.current,
    expectedRevision: initial.revision }, { code: 409 });
  clock += 1001;
  const collection = await api('collect', {});
  assert.equal(collection.status.versions.length, 1);
  assert.equal(collection.status.current, initial.current);
  assert.deepEqual(await challenge(), termsBefore);
  await api('draft', csv.candidate, { method: 'PUT' });
  assert((await readdir(directory)).some(name => name.startsWith('.publisher-')));
  await workspace.close(); workspace = null;
  assert(!(await readdir(directory)).some(name => name.startsWith('.publisher-')));
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'))).current, initial.current);
  assert.deepEqual(await challenge(), termsBefore);
  console.log('PASS: original seller + private publisher HTTP workflow: upload, failed-upload draft retention, typed range/sort pagination, concurrent publication refusal, explicit re-review, publish, retained preview/rollback, stale revision refusal, original collection, clean draft shutdown and unchanged live 402/payment metadata.');
  console.log('Disposable example CSVs; actual original services and served UI assets. No browser interaction, wallet, chain settlement, package install or hosted CI.');
} finally {
  await workspace?.close();
  if (seller) await seller.close(); else await versions?.close();
  await rm(temporary, { recursive: true, force: true });
}
