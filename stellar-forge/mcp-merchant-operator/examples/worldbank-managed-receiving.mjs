#!/usr/bin/env node
// MIT. Complete original installed World Bank Applications and customer receiving.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeWorldBankWorkspaceMerchant } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { inspectWorldBankDownload, downloadWorldBankWorkspace } from '../worldbank-workspace-download.mjs';
import { inspectMerchantRuntime } from '../../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { createRuntimeWorkspace, openRuntimeWorkspace } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import { prepareApplicationStart } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/applications.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
async function exists(path) {
  try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function immutable(path, value) {
  const bytes = Buffer.from(value);
  try { assert.deepEqual(await readFile(path), bytes); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
}
export async function receiveWorldBankManagedApplication({ runtime, workdir, reference, python = process.env.PYTHON || 'python3' } = {}) {
  const root = resolve(workdir), runtimeDirectory = resolve(runtime);
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const referenceFile = reference ? resolve(reference) : fileURLToPath(new URL('./worldbank-reference-capture.json', import.meta.url));
  const sourceReference = JSON.parse(await readFile(referenceFile, 'utf8'));
  const originalHandover = Buffer.from(sourceReference.handoverBase64, 'base64');
  assert.equal(originalHandover.length, sourceReference.bytes);
  assert.equal(sha(originalHandover), sourceReference.sha256);
  assert.equal(sourceReference.observations, 42);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const reportFile = join(root, 'managed-journey.json');
  let report = await exists(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')) : null;
  if (report) {
    assert.equal(report.sourceSha256, sourceReference.sha256);
    assert.equal(report.installationId, selected.installationId);
    assert.equal(report.runtimeDirectory, runtimeDirectory);
  }
  report ??= {
    schema: 'stellar-forge.worldbank-managed-receiving.v1',
    operationId: 'SCF-WORLDBANK-MANAGED-APPLICATIONS-FE85-20261012',
    runtimeDirectory, installationId: selected.installationId, sourceCommit: selected.sourceCommit,
    sourceSha256: sourceReference.sha256, sourceManifestSha256: selected.sourceManifestSha256,
    startedAt: new Date().toISOString(), saveId: randomUUID(), startId: randomUUID(),
    recoveredStartId: randomUUID(), buyerIntentId: randomUUID(), steps: {},
  };
  async function checkpoint(name, value) {
    if (name) report.steps[name] = value;
    await writeFile(reportFile + '.next', json(report), { mode: 0o600 });
    await rename(reportFile + '.next', reportFile);
    if (name) process.stderr.write('World Bank Applications: ' + name + '\n');
  }
  report.status = 'RUNNING'; await checkpoint();
  const source = join(root, 'economic-data'), inputFile = join(root, 'original-handover.zip');
  const applicationsDirectory = join(root, 'applications');
  const sourceHost = join(root, 'source-host'), sourceConfig = join(sourceHost, 'merchant-mcp.json');
  const connectionFile = join(root, 'worldbank-connections.json'), environmentFile = join(root, 'agent-environment.json');
  await mkdir(source, { recursive: true, mode: 0o700 });
  await immutable(inputFile, originalHandover);
  if (!await exists(environmentFile)) await writeFile(environmentFile,
    json({ MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') }), { flag: 'wx', mode: 0o600 });
  const environment = { ...process.env, ...JSON.parse(await readFile(environmentFile, 'utf8')) };
  const service = JSON.parse(await readFile(new URL('../../../stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json', import.meta.url), 'utf8'));
  const payment = service.routes[0].definition.payment;
  assert.equal(payment.network, 'stellar:testnet');
  assert.equal(payment.asset, 'UNVERIFIED_DEMO_ASSET');
  assert.equal(payment.payTo, 'UNVERIFIED_DEMO_RECIPIENT');
  await immutable(connectionFile, json({
    schema: 'stellar-forge.worldbank-workspace-connection.v1',
    workspaces: { research: { directory: source, ...(python.startsWith('/') ? { python } : {}),
      imports: { original: { kind: 'package', file: inputFile, sha256: sourceReference.sha256 } },
      merchants: { demo: { origin: 'https://worldbank.example', path: '/worldbank', payment } }, runtime: { port: 0 } } },
  }));
  if (!await exists(sourceConfig)) await initializeWorldBankWorkspaceMerchant({ directory: sourceHost, connection: connectionFile });
  if (!await exists(join(applicationsDirectory, 'workspace.json')))
    await createRuntimeWorkspace({ directory: applicationsDirectory });
  let model = await openRuntimeWorkspace({ directory: applicationsDirectory }), receiverHost;
  let firstRows, sourceCaptureSha;
  const captureId = 'worldbank-managed-source', selectionId = 'worldbank-managed-selection';
  const reviewId = 'worldbank-managed-review', exportId = 'worldbank-managed-edition';
  async function application() {
    const current = (await model.applicationsState()).applications.find(item => item.id === report.applicationId);
    assert.ok(current, 'The original saved application must remain visible.');
    return current;
  }
  async function until(predicate, label, milliseconds = 90000) {
    const deadline = Date.now() + milliseconds;
    for (;;) {
      const value = await application();
      if (predicate(value)) return value;
      if (['FAILED', 'UNAVAILABLE'].includes(value.phase) ||
        value.adoption && ['FAILED', 'CANCELLED'].includes(value.adoption.phase))
        throw new Error(label + ': ' + JSON.stringify(value.error ?? value.adoption?.state ?? value.current?.result ?? value));
      if (Date.now() >= deadline) throw new Error(label + ' is retained at phase ' + value.phase);
      await delay(250);
    }
  }
  async function liveClient(app) {
    assert.ok(app.current?.privateUrl);
    const url = new URL(app.current.privateUrl);
    const original = app.current.url.original;
    const live = await fetch(new URL('/api/launch', url),
      { headers: { authorization: 'Bearer ' + url.hash.slice(1) }, signal: AbortSignal.timeout(10000) });
    assert.equal(live.status, 200);
    const identity = await live.json();
    assert.equal(identity.directory, source);
    assert.equal(identity.instanceId, original.instanceId);
    assert.equal(identity.browserInstanceId, original.browserInstanceId);
    const client = await openMerchantFileClient({ url: original.mcpUrl, environment });
    return { url, original, identity, client,
      call: (name, args = {}) => client.call('merchant_worldbank_' + name, { workspace: 'research', ...args }) };
  }
  async function stopCurrent() {
    const current = await application();
    if (current.current && (current.current.active || ['QUEUED', 'PENDING', 'INTERRUPTED'].includes(current.current.phase))) {
      await model.applicationsStop({ applicationId: report.applicationId, operationId: current.current.id });
      await until(value => !value.current?.active && !['QUEUED', 'PENDING', 'RUNNING', 'INTERRUPTED'].includes(value.current?.phase),
        'Original application shutdown');
    }
  }
  try {
    const attached = await model.attach({ directory: runtimeDirectory, label: 'World Bank installed runtime' });
    report.runtimeId = attached.runtimeId;
    if (!report.applicationId) {
      const reviewed = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'worldbank-agent',
        settings: { configurationFile: sourceConfig, workspaceAlias: 'research', port: 0, mcpPort: 0, environmentFile },
        label: 'North America economic data' });
      const saved = await model.applicationsSave({ requestId: report.saveId, reviewId: reviewed.id });
      assert.equal(saved.saved, true); assert.equal(saved.connectionError, null);
      report.applicationId = saved.applicationId;
      await checkpoint('saved', { applicationId: saved.applicationId, revision: saved.revision,
        reviewId: reviewed.id, runtimeId: attached.runtimeId, adoptionId: saved.connection?.operationId ?? null });
    }
    const connected = await until(value => Boolean(value.release), 'Original runtime adoption');
    assert.equal(connected.release.sourceCommit, selected.sourceCommit);
    await checkpoint('adopted', { releaseId: connected.release.id, releaseDigest: connected.release.digest,
      homeId: connected.home.id, sourceCommit: connected.release.sourceCommit });
    let active = await application();
    if (!active.current?.active && !report.steps.source) {
      const reviewed = await model.applicationsStartReview({ applicationId: report.applicationId });
      const started = await model.applicationsStart({ applicationId: report.applicationId,
        requestId: report.startId, reviewId: reviewed.id });
      assert.equal(started.operationId, report.startId);
    }
    if (!report.steps.source) {
      active = await until(value => value.current?.id === report.startId && Boolean(value.current.privateUrl), 'Original application startup');
      let opened = await liveClient(active);
      const reopenedConsole = await openRuntimeWorkspace({ directory: applicationsDirectory });
      const same = (await reopenedConsole.applicationsState()).applications.find(item => item.id === report.applicationId);
      assert.equal(same.current.id, report.startId);
      assert.equal(same.current.url.original.instanceId, opened.original.instanceId);
      const recovered = await reopenedConsole.applicationsRecover({ applicationId: report.applicationId, operationId: report.startId });
      assert.equal(recovered.reopened, true); assert.equal(recovered.running, true);
      await model.close(); model = reopenedConsole;
      const call = opened.call;
      const status = await call('status');
      assert.equal(status.instanceId, opened.original.instanceId);
      if (!status.native.captures.some(item => item.id === captureId))
        await call('import', { sourceImport: 'original', expectedSha256: sourceReference.sha256,
          id: captureId, selectionId, reviewId });
      const observed = (await call('observations', { captureId, limit: 100 })).result;
      firstRows = observed.rows; assert.equal(observed.total, 42); assert.equal(firstRows.length, 42);
      assert.equal(firstRows.find(row => row.country_iso3 === 'CAN' && row.indicator_id === 'NY.GDP.MKTP.CD' && row.period === '2024').value,
        '2270076189683.46');
      const review = (await call('review_read', { id: reviewId })).result;
      sourceCaptureSha = review.captureSha256;
      const exported = (await call('export', { id: exportId, reviewId, expectedRevision: review.revision })).result;
      await immutable(join(root, 'original-observations.json'), json(firstRows));
      await checkpoint('source', { operationId: report.startId, modelInstanceId: opened.original.instanceId,
        browserInstanceId: opened.original.browserInstanceId, consoleReopenedSameOperation: true,
        captureId, captureSha256: sourceCaptureSha, observations: 42, reviewId, reviewRevision: review.revision,
        exportId, exportManifestSha256: exported.manifestSha256 });
    }
    if (!firstRows) firstRows = JSON.parse(await readFile(join(root, 'original-observations.json'), 'utf8'));
    sourceCaptureSha ??= report.steps.source.captureSha256;
    if (!report.steps.merchant || !report.steps.download) {
      active = await until(value => Boolean(value.current?.privateUrl), 'Original source operation');
      const { call, original } = await liveClient(active);
      if (!report.steps.merchant) {
        const prepared = (await call('merchant', { exportId, profile: 'demo' })).result;
        const repeated = (await call('merchant', { exportId, profile: 'demo' })).result;
        assert.equal(prepared.draft.id, repeated.draft.id);
        const draftId = prepared.draft.id, snapshot = prepared.draft.dataset.snapshot, releaseId = 'worldbank-managed-release';
        const publisher = (action, payload = {}) => call('publisher', { action, payload });
        const staged = (await publisher('publisher.release.stage', { draftId, id: releaseId })).result;
        let state = await call('status');
        if (state.native.publisher.releases.state.active !== releaseId)
          await publisher('publisher.release.activate', { id: releaseId, expectedGeneration: state.native.publisher.releases.state.generation });
        state = await call('status');
        const started = (await publisher('publisher.release.start', { expectedGeneration: state.native.publisher.releases.state.generation })).result;
        const response = await fetch(new URL('/worldbank', started.status.runtime.observed.listener));
        assert.equal(response.status, 402); await response.body.cancel();
        const query = 'where_country_iso3=CAN&where_indicator_id=NY.GDP.MKTP.CD&sort=-period&limit=10';
        const preview = (await publisher('publisher.preview', { target: snapshot, query })).result;
        assert.equal(preview.status, 200); assert.ok(JSON.stringify(preview.body).includes('"2270076189683.46"'));
        const offer = (await publisher('publisher.buyer.review', { snapshot, query })).result;
        const buyer = (await publisher('publisher.buyer.prepare', {
          review: offer, intentId: report.buyerIntentId, acceptIndex: 0, offerSha256: offer.offerSha256,
        })).result;
        const buyerId = buyer.buyer.id ?? buyer.buyer.record?.id;
        const configuration = await call('file', { kind: 'buyer-config', id: buyerId, limit: 196608 });
        assert.equal(configuration.nextOffset, null);
        assert.equal(sha(Buffer.from(configuration.data, 'base64')), configuration.file.sha256);
        await publisher('publisher.release.stop');
        await checkpoint('merchant', { draftId, snapshot, releaseId, releaseDigest: staged.digest,
          mode: 'CHALLENGE_ONLY', network: payment.network, challengeStatus: 402, queryStatus: 200,
          buyerId, buyerConfigSha256: configuration.file.sha256 });
      }
      const inspected = await inspectWorldBankDownload({ url: original.mcpUrl, workspace: 'research', exportId, environment });
      const download = await downloadWorldBankWorkspace({ url: original.mcpUrl, workspace: 'research', exportId,
        directory: join(root, 'customer-download'), environment, expectedManifestSha256: inspected.manifestSha256 });
      assert.equal(download.state, 'COMPLETE'); assert.equal(download.files, 6);
      const handover = await readFile(join(root, 'customer-download', 'handover.zip'));
      const expected = inspected.manifest.files.find(file => file.name === 'handover.zip');
      assert.equal(sha(handover), expected.sha256);
      await checkpoint('download', { files: 6, bytes: download.bytes, manifestSha256: inspected.manifestSha256,
        handoverBytes: handover.length, handoverSha256: expected.sha256 });
    }
    await stopCurrent();
    await checkpoint('stopped', { operationId: report.startId, phase: (await application()).phase });
    if (!report.steps.recoveredStart) {
      const reviewed = await model.applicationsStartReview({ applicationId: report.applicationId });
      // The original start is saved before dispatch; receiving continues from its same request.
      const planned = await prepareApplicationStart(applicationsDirectory, { applicationId: report.applicationId,
        requestId: report.recoveredStartId, reviewId: reviewed.id });
      assert.equal(planned.id, report.recoveredStartId);
      await model.close(); model = await openRuntimeWorkspace({ directory: applicationsDirectory });
      const recovered = await model.applicationsRecover({ applicationId: report.applicationId, operationId: planned.id });
      assert.equal(recovered.operationId, planned.id);
      const activeAgain = await until(value => value.current?.id === planned.id && Boolean(value.current.privateUrl), 'Saved start recovery');
      const resumed = await liveClient(activeAgain);
      assert.notEqual(resumed.original.instanceId, report.steps.source.modelInstanceId);
      assert.notEqual(resumed.original.browserInstanceId, report.steps.source.browserInstanceId);
      const observed = (await resumed.call('observations', { captureId, limit: 100 })).result;
      assert.deepEqual(observed.rows, firstRows);
      const review = (await resumed.call('review_read', { id: reviewId })).result;
      assert.equal(review.captureSha256, sourceCaptureSha);
      const exported = (await resumed.call('export_read', { id: exportId })).result;
      assert.equal(exported.manifestSha256, report.steps.source.exportManifestSha256);
      await checkpoint('recoveredStart', { operationId: planned.id, sameSavedRequest: true,
        applicationId: report.applicationId, sourceCommit: activeAgain.release.sourceCommit,
        instanceId: resumed.original.instanceId, browserInstanceId: resumed.original.browserInstanceId,
        observations: observed.total, sameCapture: true, sameExport: true });
      await stopCurrent();
    }
    const customerDirectory = join(root, 'customer-data'), customerHost = join(root, 'customer-host');
    await mkdir(customerDirectory, { recursive: true, mode: 0o700 });
    const customerConnection = join(root, 'customer-connections.json');
    await immutable(customerConnection, json({ schema: 'stellar-forge.worldbank-workspace-connection.v1',
      workspaces: { customer: { directory: customerDirectory, ...(python.startsWith('/') ? { python } : {}),
        imports: { edition: { kind: 'package', file: join(root, 'customer-download', 'handover.zip'),
          sha256: report.steps.download.handoverSha256 } } } } }));
    const customerConfig = join(customerHost, 'merchant-mcp.json');
    if (!await exists(customerConfig))
      await initializeWorldBankWorkspaceMerchant({ directory: customerHost, connection: customerConnection });
    receiverHost = await startMerchantMcp({ configPath: customerConfig, port: 0, environment });
    const customer = await openMerchantFileClient({ url: receiverHost.url, environment });
    const receive = (name, args = {}) => customer.call('merchant_worldbank_' + name, { workspace: 'customer', ...args });
    const current = await receive('open');
    if (!current.native.captures.some(item => item.id === 'worldbank-managed-received'))
      await receive('import', { sourceImport: 'edition', expectedSha256: report.steps.download.handoverSha256,
        id: 'worldbank-managed-received' });
    const rows = (await receive('observations', { captureId: 'worldbank-managed-received', limit: 100 })).result.rows;
    assert.deepEqual(rows, firstRows);
    await receive('close', { instanceId: current.instanceId });
    const reopened = await receive('open');
    assert.notEqual(reopened.instanceId, current.instanceId);
    assert.deepEqual((await receive('observations', { captureId: 'worldbank-managed-received', limit: 100 })).result.rows, firstRows);
    await receive('close', { instanceId: reopened.instanceId });
    await receiverHost.close(); receiverHost = null;
    await checkpoint('customer', { observations: rows.length, sameOriginalRows: true, reopened: true,
      handoverSha256: report.steps.download.handoverSha256 });
    report.status = 'COMPLETE'; report.completedAt = new Date().toISOString(); await checkpoint();
    return report;
  } catch (error) {
    report.status = 'FAILED'; report.error = { code: error.code ?? error.name, message: error.message };
    await checkpoint(); throw error;
  } finally {
    if (receiverHost) await receiverHost.close();
    if (model && report.applicationId) await stopCurrent();
    await model?.close();
  }
}
export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--runtime', '--workdir', '--reference', '--python'].includes(key) || !value || Object.hasOwn(options, key))
      throw new Error('Use --runtime READY_DIRECTORY --workdir PRIVATE_DIRECTORY [--reference CAPTURE_JSON] [--python EXECUTABLE].');
    options[key] = value;
  }
  if (!options['--runtime'] || !options['--workdir']) throw new Error('Supply the completed runtime and private receiving directory.');
  const report = await receiveWorldBankManagedApplication({
    runtime: options['--runtime'], workdir: options['--workdir'], reference: options['--reference'], python: options['--python'],
  });
  process.stdout.write(json(report)); return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(json({ error: error.code ?? error.name, message: error.message })); process.exitCode = 1; });
