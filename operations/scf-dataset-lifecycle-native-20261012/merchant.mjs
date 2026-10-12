// MIT. One complete original source release, merchant and edition continuity run.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { init, append, finalize } from '../../stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs';
import { resolve, join } from 'node:path';
import { initializeMerchant } from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import { openMerchantOperator } from '../../stellar-forge/mcp-merchant-operator/operator.mjs';
import { inspectDatasetRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-dataset.mjs';

const [firstPackage, nextPackage, operatorDirectory] = process.argv.slice(2).map(value => resolve(value));
if (!firstPackage || !nextPackage || !operatorDirectory) throw new Error('Supply FIRST_PACKAGE NEXT_PACKAGE NEW_OPERATOR_DIRECTORY');
const initialized = await initializeMerchant({ directory: operatorDirectory, name: 'NDJSON edition merchant',
  datasetPackage: firstPackage, runtime: { port: 0 } });
const configuration = JSON.parse(await readFile(initialized.configuration, 'utf8'));
configuration.sources.next = { label: 'Next reviewed NDJSON edition', datasetPackage: nextPackage, runtime: { port: 0 } };
await writeFile(initialized.configuration, JSON.stringify(configuration, null, 2) + '\n', { mode: 0o600 });
let operator = await openMerchantOperator(initialized.configuration);
const query = 'limit=1';
const result = { schema: 'stellar-forge.dataset-lifecycle-native.v1' };
try {
  const source = await operator.call('merchant_sources', { source: 'initial' });
  assert.equal(source.sourceType, 'DATASET_RELEASE_PACKAGE');
  assert.equal(source.application.controllerConfigured, true);
  assert.equal(source.application.datasetDirectory, undefined);
  const firstStaged = await operator.call('merchant_stage', { source: 'initial', id: 'ndjson-first', label: 'First NDJSON edition' });
  const first = firstStaged.release;
  assert.ok(first.dataset);
  const ready = await operator.call('merchant_dataset_initialize', { releaseId: first.id, expectedDigest: first.digest });
  assert.equal(ready.versions.current, first.dataset.baselineSnapshot);
  const compared = await operator.call('merchant_compare', { to: first.id });
  await operator.call('merchant_activate', { id: first.id, expectedDigest: first.digest,
    expectedGeneration: compared.generation, reason: 'Start the reviewed source dataset' });
  let status = await operator.call('merchant_status');
  await operator.call('merchant_start', { expectedGeneration: status.state.generation, expectedDigest: first.digest });
  status = await operator.call('merchant_status');
  const instance = status.operator.instanceId;
  assert.ok(instance);
  const repeated = await operator.call('merchant_dataset_initialize', { releaseId: first.id, expectedDigest: first.digest });
  assert.equal(repeated.state, 'RUNNING');
  assert.equal((await operator.call('merchant_status')).operator.instanceId, instance);
  const resourcePath = source.routes[0].path;
  const challenge = await fetch(new URL(resourcePath, status.runtime.observed.listener));
  assert.equal(challenge.status, 402);
  await challenge.arrayBuffer();
  const pageOne = (await operator.call('merchant_dataset_preview', { releaseId: first.id, query })).response;
  assert.equal(pageOne.schema, 'stellar-forge.dataset-page.v1');
  assert.equal(pageOne.dataset.snapshot, first.dataset.baselineSnapshot);
  const cursor = pageOne.page.nextCursor;
  assert.ok(cursor);
  const cursorQuery = new URLSearchParams({ limit: '1', cursor }).toString();
  const pageTwo = (await operator.call('merchant_dataset_preview', { releaseId: first.id, query: cursorQuery })).response;
  assert.equal(pageTwo.schema, 'stellar-forge.dataset-page.v1');
  const nextStaged = await operator.call('merchant_stage', { source: 'next', id: 'ndjson-next', label: 'Next NDJSON edition' });
  const next = nextStaged.release;
  assert.notEqual(first.dataset.baselineSnapshot, next.dataset.baselineSnapshot);
  const change = await operator.call('merchant_compare', { to: next.id });
  assert.ok(change.runtimeChanges.some(entry => entry.field === 'dataset'));
  const before = await operator.call('merchant_dataset_status', { releaseId: first.id });
  const published = await operator.call('merchant_dataset_publish', { releaseId: next.id, expectedDigest: next.digest,
    expectedSnapshot: before.versions.current, expectedRevision: before.versions.revision });
  assert.equal(published.versions.current, next.dataset.baselineSnapshot);
  assert.equal(published.versions.versions.length, 2);
  const continued = (await operator.call('merchant_dataset_preview', { releaseId: next.id, query: cursorQuery })).response;
  assert.deepEqual(continued, pageTwo);
  const current = (await operator.call('merchant_dataset_preview', { releaseId: next.id, query })).response;
  assert.equal(current.dataset.snapshot, next.dataset.baselineSnapshot);
  const deliveries = {};
  await mkdir(join(operatorDirectory, 'deliveries'), { mode: 0o700 });
  for (const [edition, release] of [['first', first], ['next', next]]) {
    const directory = join(operatorDirectory, 'deliveries', edition);
    await init(directory);
    let selectedCursor, pageIndex = 0;
    do {
      const requestQuery = new URLSearchParams({ limit: '3', snapshot: release.dataset.baselineSnapshot,
        ...(selectedCursor ? { cursor: selectedCursor } : {}) }).toString();
      const page = (await operator.call('merchant_dataset_preview', { releaseId: release.id, query: requestQuery })).response;
      assert.equal(page.schema, 'stellar-forge.dataset-page.v1');
      const pageBytes = JSON.stringify(page) + '\n';
      const pagePath = join(operatorDirectory, edition + '-page-' + pageIndex + '.json');
      const evidencePath = join(operatorDirectory, edition + '-context-' + pageIndex + '.json');
      await writeFile(pagePath, pageBytes, { mode: 0o600 });
      await writeFile(evidencePath, JSON.stringify({ kind: 'ORIGINAL_PRIVATE_DATASET_PREVIEW',
        snapshot: release.dataset.baselineSnapshot, requestQuery,
        sha256: createHash('sha256').update(pageBytes).digest('hex') }) + '\n', { mode: 0o600 });
      await append(directory, { page: pagePath, intent: randomUUID(), evidence: evidencePath,
        ...(selectedCursor ? { cursor: selectedCursor } : {}) });
      selectedCursor = page.page.nextCursor;
      pageIndex++;
    } while (selectedCursor);
    await finalize(directory);
    deliveries[edition] = { directory, manifestSha256: createHash('sha256').update(await readFile(join(directory, 'manifest.json'))).digest('hex') };
  }
  result.deliveries = deliveries;
  await assert.rejects(() => operator.call('merchant_dataset_publish', { releaseId: next.id, expectedDigest: next.digest,
    expectedSnapshot: before.versions.current, expectedRevision: before.versions.revision }), { code: 'DATASET_CURRENT_CHANGED' });
  const rollback = await operator.call('merchant_dataset_activate', { releaseId: next.id, expectedDigest: next.digest,
    snapshot: first.dataset.baselineSnapshot, expectedSnapshot: published.versions.current, expectedRevision: published.versions.revision });
  assert.equal(rollback.versions.current, first.dataset.baselineSnapshot);
  const restored = await operator.call('merchant_dataset_activate', { releaseId: next.id, expectedDigest: next.digest,
    snapshot: next.dataset.baselineSnapshot, expectedSnapshot: rollback.versions.current, expectedRevision: rollback.versions.revision });
  status = await operator.call('merchant_status');
  await operator.call('merchant_restart', { instanceId: status.operator.instanceId,
    expectedGeneration: status.state.generation, expectedDigest: first.digest });
  const restarted = await operator.call('merchant_dataset_status', { releaseId: next.id });
  assert.equal(restarted.versions.current, next.dataset.baselineSnapshot);
  assert.equal(restarted.versions.revision, restored.versions.revision);
  const closure = await inspectDatasetRelease(join(configuration.releaseStore.startsWith('/') ? configuration.releaseStore
    : resolve(operatorDirectory, configuration.releaseStore), 'releases', next.id));
  assert.ok(closure.dataset.sourceClosure);
  result.first = { releaseId: first.id, releaseDigest: first.digest, snapshot: first.dataset.baselineSnapshot };
  result.next = { releaseId: next.id, releaseDigest: next.digest, snapshot: next.dataset.baselineSnapshot,
    revision: restarted.versions.revision };
  result.native = { challengeStatus: challenge.status, originalControllerReused: true,
    cursorContinuedAcrossPublication: true, staleRevisionRejected: true, retainedDataRollback: true,
    sellerRestartPreservedCurrentEdition: true, sourceClosure: closure.dataset.sourceClosure };
  await operator.close();
  operator = await openMerchantOperator(initialized.configuration);
  const stoppedReady = await operator.call('merchant_dataset_initialize', { releaseId: first.id, expectedDigest: first.digest });
  assert.equal(stoppedReady.state, 'READY');
  assert.equal(stoppedReady.versions.current, next.dataset.baselineSnapshot);
  assert.equal(stoppedReady.versions.revision, restored.versions.revision);
  result.native.stoppedInitializationPreservedCurrentEdition = true;
  status = await operator.call('merchant_status');
  await operator.call('merchant_start', { expectedGeneration: status.state.generation, expectedDigest: first.digest });
  const reopened = (await operator.call('merchant_dataset_preview', { releaseId: next.id, query })).response;
  assert.equal(reopened.dataset.snapshot, next.dataset.baselineSnapshot);
  const resumed = (await operator.call('merchant_dataset_preview', { releaseId: next.id, query: cursorQuery })).response;
  assert.deepEqual(resumed, pageTwo);
  result.native.mcpReopenPreservedCurrentAndCursor = true;
  result.state = 'COMPLETE';
  await writeFile(join(operatorDirectory, 'native-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(result) + '\n');
} finally { await operator.close(); }
