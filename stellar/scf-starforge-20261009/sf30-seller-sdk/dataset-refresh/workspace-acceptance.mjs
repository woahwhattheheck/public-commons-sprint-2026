// MIT. One complete local merchant workflow through the actual original services.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from './versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from './service.mjs';
import { startDatasetPublishingWorkspace } from './workspace.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { initializeWorkspace } from '../../sf88-operator-buyer-cli/workspace.mjs';
import { createDatasetSession, runDatasetSession, deliverDatasetSession } from '../../sf88-operator-buyer-cli/dataset-session.mjs';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';
import { prepareBuyerResponseFile } from '../../sf31-buyer-client/response-file.mjs';
import { executeWithEvidence } from '../../sf82-checkout-evidence/evidence.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'sf30-publisher-'));
const directory = join(temporary, 'state');
const csv = {
  initial: 'sku,units,category\nA,2,tools\nB,7,tools\nC,4,parts\n',
  candidate: 'sku,units,category\nA,6,tools\nB,9,tools\nC,2,parts\nD,11,tools\n',
  intervening: 'sku,units,category\nA,1,tools\nE,5,parts\n',
};
let versions, seller, workspace, freeServer, clock = 1000000, requests = 0;
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
      scheme: 'exact', network: 'stellar:testnet', asset: 'C' + 'A'.repeat(55),
      payTo: 'G' + 'A'.repeat(55), amount: '100', maxTimeoutSeconds: 60 } });
  config.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
  seller = await startVersionedDatasetSeller({ versions, config, port: 0, controlTransport: 'loopback' });
  workspace = await startDatasetPublishingWorkspace({ directory, port: 0,
    seller: seller.url, resource: 'https://dataset.example/data' });
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
  await api('buyer-offer', { target, query: '' }, { code: 400 });
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
  query.delete('cursor');
  const selected = { target: published.status.current, query: query.toString() };
  const offer = await api('buyer-offer', selected);
  assert.equal(offer.selection.matchingRows, 3);
  assert.equal(new URL(offer.url).searchParams.get('snapshot'), selected.target);
  assert.deepEqual(offer.accepts, termsBefore.body.accepts);
  await api('buyer-prepare', { ...selected, intentId: 'merchant-to-buyer', acceptIndex: 0,
    offerSha256: '0'.repeat(64) }, { code: 409 });
  const prepared = await api('buyer-prepare', { ...selected, intentId: 'merchant-to-buyer', acceptIndex: 0,
    offerSha256: offer.offerSha256 });
  assert.deepEqual(JSON.parse(prepared.configText), prepared.config);
  assert.deepEqual(prepared.config.preparedFrom.originalListing, offer.offer);
  const reviewPath = join(temporary, 'buyer-review.json'), buyerDirectory = join(temporary, 'buyer');
  await writeFile(reviewPath, prepared.configText, { mode: 0o600 });
  const buyerWorkspace = await initializeWorkspace(['--config', reviewPath, '--dir', buyerDirectory,
    '--actor', 'merchant-workflow', '--service', 'dataset', '--payer', 'G' + 'B'.repeat(55),
    '--python', '/usr/bin/python3', '--total-atomic', '400'], { environment: {} });
  assert.equal(buyerWorkspace.mode, 'PRIVATE_OPERATOR_WORKSPACE_CREATED');
  const session = join(temporary, 'acquisition');
  const created = await createDatasetSession({ directory: session, workspaceDirectory: buyerDirectory,
    maxPages: 4, maxTotalAtomic: '400' });
  assert.equal(created.expectedSnapshot, selected.target);
  assert.equal(created.workspaceDirectory, buyerDirectory);
  assert.equal(new URL(created.nextPage.url).searchParams.get('snapshot'), selected.target);
  await assert.rejects(createDatasetSession({ directory: join(temporary, 'conflicting-snapshot'),
    workspaceDirectory: buyerDirectory, maxPages: 4, maxTotalAtomic: '400', expectedSnapshot: '0'.repeat(64) }),
    { code: 'DATASET_SNAPSHOT_SELECTION_CONFLICT' });

  // Native SF30 402 terms above are real. This separate free HTTP path exercises
  // original version admission, SF31 response capture and SF82/SF100 without spending.
  freeServer = createServer(versions.wrapRequest(async (request, response) => {
    requests++;
    const url = new URL(request.url, 'http://127.0.0.1');
    const context = { url, query: url.searchParams };
    const admitted = await versions.admit(context);
    const result = admitted === true ? await versions.handle(context) : admitted;
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
  }));
  freeServer.listen(0, '127.0.0.1'); await once(freeServer, 'listening');
  const local = 'http://127.0.0.1:' + freeServer.address().port;
  const native = new X402BuyerClient({ fetchImpl: (url, options) => {
    const actual = new URL(url); return fetch(local + actual.pathname + actual.search, options);
  } });
  async function executeFreePage(cfg, { signal } = {}) {
    const writer = await prepareBuyerResponseFile(cfg.responseFile); let saved, evidence;
    const buyer = { async call(options) {
      const result = await native.call({ ...options,
        approve: async () => { throw Error('Unexpected payment request in free exercise'); },
        sign: async () => { throw Error('No wallet in this free exercise'); } });
      saved = await writer.save(result, { signal }); return result;
    } };
    try { evidence = await executeWithEvidence({ buyer, call: { ...cfg.operation, signal },
      outputDir: cfg.evidenceDir, captureBody: false }); }
    finally { await writer.abort(); }
    assert.equal(evidence.error, null);
    return { mode: 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT', intentId: cfg.operation.intentId,
      status: evidence.result.status, httpStatus: evidence.result.httpStatus,
      sellerReportedSettlement: evidence.result.settlement, evidencePath: evidence.evidencePath,
      originalOutcomeReport: evidence.report, operatorReservation: null,
      responseFile: { status: 'SAVED', ...saved }, interrupted: false, retry: 'NO_AUTOMATIC_RETRY' };
  }
  const savedWorkspace = await readFile(buyerWorkspace.config);
  const changedWorkspace = JSON.parse(savedWorkspace); changedWorkspace.operation.intentId = 'different-purchase';
  await writeFile(buyerWorkspace.config, JSON.stringify(changedWorkspace));
  await assert.rejects(runDatasetSession(session, { executePage: executeFreePage }),
    { code: 'DATASET_WORKSPACE_CHANGED_REVIEW_REQUIRED' });
  assert.equal(requests, 0); assert.deepEqual(await readdir(join(session, 'pages')), []);
  await writeFile(buyerWorkspace.config, savedWorkspace);
  const old = await api('preview', { target: initial.current, query: '' });
  assert.deepEqual(old.result.rows[0], { sku: 'A', units: 2, category: 'tools' });
  const rollback = await api('activate', { snapshot: initial.current,
    expectedSnapshot: published.status.current, expectedRevision: published.status.revision });
  assert.equal(rollback.status.current, initial.current);
  assert(rollback.status.revision > published.status.revision);
  const controller = new AbortController();
  const paused = await runDatasetSession(session, { executePage: executeFreePage, signal: controller.signal,
    onPage: () => controller.abort() });
  assert.equal(paused.completedPages, 1); assert.equal(paused.snapshot, selected.target);
  const firstAcquired = await readFile(paused.pages[0].responsePath);
  const finished = await runDatasetSession(session, { executePage: executeFreePage });
  assert.equal(finished.status, 'COMPLETE'); assert.equal(finished.completedPages, 3);
  assert.equal(finished.snapshot, selected.target); assert.equal(finished.acquiredRows, 3);
  assert.equal(requests, 3); assert.deepEqual(await readFile(finished.pages[0].responsePath), firstAcquired);
  const delivery = await deliverDatasetSession(session, join(temporary, 'delivery'));
  assert.equal(delivery.nativeStatus.finalized, true);
  const rows = (await readFile(delivery.outputs['dataset.jsonl'].path, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, [{ sku: 'D', units: 11 }, { sku: 'B', units: 9 }, { sku: 'A', units: 6 }]);
  assert.equal(await readFile(delivery.outputs['dataset.csv'].path, 'utf8'), '"sku","units"\r\n"D","11"\r\n"B","9"\r\n"A","6"\r\n');
  await runDatasetSession(session, { executePage: executeFreePage }); assert.equal(requests, 3);
  await api('activate', { snapshot: draft.dataset.snapshot, expectedSnapshot: initial.current,
    expectedRevision: initial.revision }, { code: 409 });
  clock += 1001;
  await api('buyer-offer', selected, { code: 410 });
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
  console.log('PASS: original seller/publisher upload, review, publication and rollback; actual live offer -> original prepareReview config -> private buyer workspace/ledger -> pinned acquisition after publication changes -> interrupted/resumed native pages -> original SF100 CSV/JSONL data room. Stale offers, changed workspace, conflicting snapshot and expired selection refused; complete acquisition is not requested again.');
  console.log('Disposable CSVs/public example terms; actual original services, served UI assets and native free HTTP acquisition. No browser interaction, wallet, paid transfer, package install or hosted CI.');
} finally {
  await workspace?.close();
  if (freeServer) await new Promise(resolve => freeServer.close(resolve));
  if (seller) await seller.close(); else await versions?.close();
  await rm(temporary, { recursive: true, force: true });
}
