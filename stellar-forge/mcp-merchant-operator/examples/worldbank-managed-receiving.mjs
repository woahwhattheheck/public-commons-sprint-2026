#!/usr/bin/env node
// MIT. Complete original installed World Bank Applications and customer receiving.
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, open, lstat, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeWorldBankWorkspaceMerchant, readMerchantConfig } from '../config.mjs';
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
  try { assert.deepEqual(await readFile(path), bytes); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.creating-' + randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.deepEqual(await readFile(path), bytes);
    }
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
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
    assert.equal(report.schema, 'stellar-forge.worldbank-managed-receiving.v1');
    assert.equal(report.operationId, 'SCF-WORLDBANK-MANAGED-APPLICATIONS-FE85-20261012');
    assert.equal(report.sourceSha256, sourceReference.sha256);
    assert.equal(report.sourceCommit, selected.sourceCommit);
    assert.equal(report.sourceManifestSha256, selected.sourceManifestSha256);
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
    const handle = await open(reportFile + '.next', 'w', 0o600);
    try { await handle.writeFile(json(report)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(reportFile + '.next', reportFile);
    const directoryHandle = await open(root, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    if (name) process.stderr.write('World Bank Applications: ' + name + '\n');
  }
  report.sourceStarts ??= [];
  report.recoveryStarts ??= [];
  if (report.status === 'COMPLETE') {
    assert.equal(report.steps.customer?.sameOriginalRows, true);
    assert.equal(sha(await readFile(join(root, 'customer-download', 'handover.zip'))), report.steps.download.handoverSha256);
    const retainedRows = JSON.parse(await readFile(join(root, 'original-observations.json'), 'utf8'));
    assert.equal(retainedRows.length, 42);
    return { ...report, reopened: true };
  }
  if (report.error) {
    report.failures ??= [];
    report.failures.push({ ...report.error, ...(report.cleanupErrors ? { cleanupErrors: report.cleanupErrors } : {}),
      resumedAt: new Date().toISOString() });
    delete report.error;
    delete report.cleanupErrors;
    delete report.completedAt;
  }
  report.status = 'RUNNING'; await checkpoint();
  const source = join(root, 'economic-data'), inputFile = join(root, 'original-handover.zip');
  const applicationsDirectory = join(root, 'applications');
  const sourceHost = join(root, 'source-host'), sourceConfig = join(sourceHost, 'merchant-mcp.json');
  const connectionFile = join(root, 'worldbank-connections.json'), environmentFile = join(root, 'agent-environment.json');
  let model = null, receiverHost = null, environment, payment, primaryError = null;
  let firstRows, sourceCaptureSha;
  const captureId = 'worldbank-managed-source', selectionId = 'worldbank-managed-selection';
  const reviewId = 'worldbank-managed-review', exportId = 'worldbank-managed-edition';
  async function initializeHost(directory, connection) {
    const configuration = join(directory, 'merchant-mcp.json');
    if (await exists(configuration)) {
      assert.equal(JSON.parse(await readFile(configuration, 'utf8')).worldbankWorkspaceConnection, connection);
      await readMerchantConfig(configuration);
      return;
    }
    // The original initializer is create-only. Publish its complete private
    // result as a directory so a process interruption cannot strand its caller
    // between mkdir and the original merchant configuration write.
    report.initializers ??= {};
    let intent = report.initializers[directory];
    if (intent) assert.equal(intent.connection, connection);
    const pendingConfiguration = intent && join(intent.staging, 'merchant-mcp.json');
    if (!pendingConfiguration || !await exists(pendingConfiguration)) {
      const previous = intent;
      intent = { connection, staging: directory + '.initializing-' + randomUUID(),
        retained: previous ? [...(previous.retained ?? []), previous.staging] : [] };
      report.initializers[directory] = intent;
      await checkpoint();
      await initializeWorldBankWorkspaceMerchant({ directory: intent.staging, connection });
    }
    const pending = join(intent.staging, 'merchant-mcp.json');
    assert.equal(JSON.parse(await readFile(pending, 'utf8')).worldbankWorkspaceConnection, connection);
    await readMerchantConfig(pending);
    try {
      const existing = await lstat(directory);
      assert.ok(existing.isDirectory() && !existing.isSymbolicLink(), 'Retain the original private host directory.');
      const preserved = directory + '.interrupted-' + randomUUID();
      intent.retained.push(preserved);
      await checkpoint();
      await rename(directory, preserved);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(intent.staging, directory);
    const parent = await open(root, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    await readMerchantConfig(configuration);
  }
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
  const unfinished = run => Boolean(run && (run.active ||
    ['QUEUED', 'PENDING', 'RUNNING', 'INTERRUPTED'].includes(run.phase)));
  const recoveryRequest = id => id === report.recoveredStartId ||
    report.recoveryStarts.some(item => item.requestId === id);
  async function waitForRunning(id, label) {
    return until(value => {
      assert.equal(value.current?.id, id, 'Resume the selected original application run.');
      if (!unfinished(value.current) || value.current.stop)
        throw new Error(label + ': original run ' + id + ' ended or was stopped before its listener became available.');
      return Boolean(value.current.privateUrl);
    }, label);
  }
  async function recoverCurrent(value, label) {
    const current = value.current;
    if (!unfinished(current)) return value;
    if (current.stop) { await stopCurrent(); return application(); }
    if (!current.active) {
      const recovered = await model.applicationsRecover({ applicationId: report.applicationId, operationId: current.id });
      value = await application();
      if (recovered.commandActive && !value.current.active) {
        // Original recovery recognizes a surviving child but cannot rebuild its
        // lost supervisor. Stop that recorded child and reconcile its own run.
        await stopCurrent();
        return application();
      }
    }
    value = await application();
    if (unfinished(value.current)) return waitForRunning(value.current.id, label);
    return value;
  }
  async function planStart(scope, preferred) {
    const current = await application();
    assert.equal(unfinished(current.current), false, 'Finish or recover the original retained run before another start.');
    const reviewed = await model.applicationsStartReview({ applicationId: report.applicationId });
    const attempts = report[scope], previous = attempts.at(-1);
    const original = previous && current.runs.find(run => run.id === previous.requestId);
    let planned = previous && !original && previous.reviewId === reviewed.id ? previous : null;
    if (!planned) {
      const preferredUsed = current.runs.some(run => run.id === preferred) ||
        attempts.some(item => item.requestId === preferred) ||
        report.steps.source?.operationId === preferred;
      planned = { requestId: preferredUsed ? randomUUID() : preferred, reviewId: reviewed.id,
        createdAt: new Date().toISOString() };
      attempts.push(planned);
      await checkpoint();
    }
    return planned;
  }
  async function sourceApplication() {
    let current = await recoverCurrent(await application(), 'Original source application recovery');
    if (current.current?.active) return waitForRunning(current.current.id, 'Original source application startup');
    const planned = await planStart('sourceStarts', report.startId);
    const started = await model.applicationsStart({ applicationId: report.applicationId,
      requestId: planned.requestId, reviewId: planned.reviewId });
    assert.equal(started.operationId, planned.requestId);
    return waitForRunning(planned.requestId, 'Original source application startup');
  }
  async function stopCurrent({ preservePending = false } = {}) {
    let selected = await application(), current = selected.current;
    if (!unfinished(current) || preservePending && current.phase === 'PENDING') return current;
    const id = current.id;
    await model.applicationsStop({ applicationId: report.applicationId, operationId: id });
    const deadline = Date.now() + 90000;
    for (;;) {
      selected = await application();
      current = selected.runs.find(run => run.id === id) ?? null;
      if (!unfinished(current)) return current;
      // A dead command cannot consume its stop marker; its original recovery
      // records the observed end instead of dispatching the stopped run again.
      if (current.phase === 'INTERRUPTED' && !current.active) {
        try { await model.applicationsRecover({ applicationId: report.applicationId, operationId: id }); }
        catch (error) { if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING') throw error; }
      }
      if (Date.now() >= deadline) throw new Error('Original application shutdown remains at ' + current.phase);
      await delay(250);
    }
  }
  async function receiveOriginalPackage(call, status, input, importedReviewId) {
    let capture, review, offset = 0;
    for (;;) {
      capture ??= status.native.captures.find(item => item.id === input.id);
      review ??= status.native.reviews.find(item => item.id === importedReviewId);
      const next = ['captures', 'reviews'].filter(key => key === 'captures' ? !capture : !review)
        .map(key => status.native.pages?.[key]?.nextOffset).filter(value => Number.isInteger(value) && value > offset);
      if (capture && review || !next.length) break;
      offset = Math.min(...next);
      status = await call('status', { offset, limit: 100 });
    }
    if (capture && input.selectionId) assert.equal(capture.selectionId, input.selectionId);
    if (review) {
      assert.equal(review.captureId, input.id, 'Keep the original received review on its own capture.');
      assert.equal(review.captureSha256, capture?.captureSha256);
    }
    if (capture?.status === 'COMPLETE' && review) return { capture, review };
    const received = (await call('import', input)).result;
    assert.equal(received.originalPackageSha256, input.expectedSha256);
    assert.equal(received.capture.id, input.id);
    assert.equal(received.capture.status, 'COMPLETE');
    assert.equal(received.review.id, importedReviewId);
    assert.equal(received.review.captureId, input.id);
    assert.equal(received.review.captureSha256, received.capture.captureSha256);
    return received;
  }
  async function retainedBuyer(call, intent) {
    let offset = 0;
    for (;;) {
      const status = await call('status', { offset, limit: 100 });
      const drafts = status.native.publisher?.drafts;
      const buyer = drafts?.buyers.find(item => item.intentId === intent.intentId &&
        item.snapshot === intent.snapshot && item.query === intent.query && item.offerSha256 === intent.offerSha256);
      if (buyer) return buyer;
      const next = drafts?.pages?.buyers?.nextOffset;
      if (next === null || next === undefined) return null;
      assert.ok(Number.isInteger(next) && next > offset, 'Advance the original retained buyer page.');
      offset = next;
    }
  }
  async function downloadClient(opened, manifestSha256) {
    const file = join(root, 'customer-download', 'download-state', 'checkpoint.json');
    const retained = await exists(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
    if (retained) {
      assert.equal(retained.exportId, exportId);
      assert.equal(retained.manifestSha256, manifestSha256);
    }
    const endpoint = report.downloadReceiver?.endpoint ?? retained?.endpoint ??
      'stellar-forge-application:' + report.applicationId + ':worldbank:research';
    const binding = { endpoint, applicationId: report.applicationId, workspace: 'research', exportId,
      configurationSha256: sha(await readFile(connectionFile)), manifestSha256 };
    if (report.downloadReceiver) assert.deepEqual(report.downloadReceiver, binding);
    report.downloadReceiver = binding;
    report.downloadTransports ??= [];
    if (!report.downloadTransports.some(item => item.instanceId === opened.original.instanceId))
      report.downloadTransports.push({ url: opened.original.mcpUrl, instanceId: opened.original.instanceId,
        observedAt: new Date().toISOString() });
    await checkpoint();
    // The original receiver supports a stable native client identity. Every
    // call still reaches the authenticated current application, whose browser,
    // workspace and immutable export were checked before this connection.
    return { endpoint, call: (name, args, options) => opened.client.call(name,
      { workspace: 'research', ...args }, options) };
  }
  try {
    await mkdir(source, { recursive: true, mode: 0o700 });
    await immutable(inputFile, originalHandover);
    if (!await exists(environmentFile)) await immutable(environmentFile,
      json({ MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') }));
    environment = { ...process.env, ...JSON.parse(await readFile(environmentFile, 'utf8')) };
    const service = JSON.parse(await readFile(new URL('../../../stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json', import.meta.url), 'utf8'));
    payment = service.routes[0].definition.payment;
    assert.equal(payment.network, 'stellar:testnet');
    assert.equal(payment.asset, 'UNVERIFIED_DEMO_ASSET');
    assert.equal(payment.payTo, 'UNVERIFIED_DEMO_RECIPIENT');
    await immutable(connectionFile, json({
      schema: 'stellar-forge.worldbank-workspace-connection.v1',
      workspaces: { research: { directory: source, ...(python.startsWith('/') ? { python } : {}),
        imports: { original: { kind: 'package', file: inputFile, sha256: sourceReference.sha256 } },
        merchants: { demo: { origin: 'https://worldbank.example', path: '/worldbank', payment } }, runtime: { port: 0 } } },
    }));
    await initializeHost(sourceHost, connectionFile);
    if (!await exists(join(applicationsDirectory, 'workspace.json')))
      await createRuntimeWorkspace({ directory: applicationsDirectory });
    model = await openRuntimeWorkspace({ directory: applicationsDirectory });
    const attached = await model.attach({ directory: runtimeDirectory, label: 'World Bank installed runtime' });
    report.runtimeId = attached.runtimeId;
    if (!report.applicationId) {
      const retained = (await model.applicationsState()).applications.find(item => item.saveRequestId === report.saveId);
      if (retained) {
        assert.equal(retained.runtimeId, attached.runtimeId);
        assert.equal(retained.kind, 'worldbank-agent');
        assert.equal(retained.settings.configurationFile, sourceConfig);
        report.applicationId = retained.id;
        report.saveReviewId = retained.reviewId;
        await checkpoint('saved', { applicationId: retained.id, revision: retained.revision,
          reviewId: retained.reviewId, runtimeId: attached.runtimeId, adoptionId: retained.adoption?.id ?? null });
      } else {
        if (!report.saveReviewId) {
          const reviewed = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'worldbank-agent',
            settings: { configurationFile: sourceConfig, workspaceAlias: 'research', port: 0, mcpPort: 0, environmentFile },
            label: 'North America economic data' });
          report.saveReviewId = reviewed.id;
          await checkpoint();
        }
        const saved = await model.applicationsSave({ requestId: report.saveId, reviewId: report.saveReviewId });
        assert.equal(saved.saved, true);
        report.applicationId = saved.applicationId;
        await checkpoint('saved', { applicationId: saved.applicationId, revision: saved.revision,
          reviewId: report.saveReviewId, runtimeId: attached.runtimeId, adoptionId: saved.connection?.operationId ?? null });
      }
    }
    await model.applicationsConnect({ applicationId: report.applicationId });
    const connected = await until(value => Boolean(value.release), 'Original runtime adoption');
    assert.equal(connected.release.sourceCommit, selected.sourceCommit);
    await checkpoint('adopted', { releaseId: connected.release.id, releaseDigest: connected.release.digest,
      homeId: connected.home.id, sourceCommit: connected.release.sourceCommit });
    let active = await application();
    if (!report.steps.source || !report.steps.merchant || !report.steps.download)
      active = await sourceApplication();
    if (!report.steps.source) {
      const sourceOperationId = active.current.id;
      active = await waitForRunning(sourceOperationId, 'Original application startup');
      let opened = await liveClient(active);
      const reopenedConsole = await openRuntimeWorkspace({ directory: applicationsDirectory });
      const same = (await reopenedConsole.applicationsState()).applications.find(item => item.id === report.applicationId);
      assert.equal(same.current.id, sourceOperationId);
      assert.equal(same.current.url.original.instanceId, opened.original.instanceId);
      const recovered = await reopenedConsole.applicationsRecover({ applicationId: report.applicationId, operationId: sourceOperationId });
      assert.equal(recovered.reopened, true);
      assert.ok(recovered.running === true || recovered.commandActive === true);
      await model.close(); model = reopenedConsole;
      const call = opened.call;
      const status = await call('status');
      assert.equal(status.instanceId, opened.original.instanceId);
      await receiveOriginalPackage(call, status, { sourceImport: 'original', expectedSha256: sourceReference.sha256,
        id: captureId, selectionId, reviewId }, reviewId);
      const observed = (await call('observations', { captureId, limit: 100 })).result;
      firstRows = observed.rows; assert.equal(observed.total, 42); assert.equal(firstRows.length, 42);
      assert.equal(firstRows.find(row => row.country_iso3 === 'CAN' && row.indicator_id === 'NY.GDP.MKTP.CD' && row.period === '2024').value,
        '2270076189683.46');
      const review = (await call('review_read', { id: reviewId })).result;
      sourceCaptureSha = review.captureSha256;
      const exported = (await call('export', { id: exportId, reviewId, expectedRevision: review.revision })).result;
      await immutable(join(root, 'original-observations.json'), json(firstRows));
      await checkpoint('source', { operationId: sourceOperationId, modelInstanceId: opened.original.instanceId,
        browserInstanceId: opened.original.browserInstanceId, consoleReopenedSameOperation: true,
        captureId, captureSha256: sourceCaptureSha, observations: 42, reviewId, reviewRevision: review.revision,
        exportId, exportManifestSha256: exported.manifestSha256 });
    }
    if (!firstRows) firstRows = JSON.parse(await readFile(join(root, 'original-observations.json'), 'utf8'));
    sourceCaptureSha ??= report.steps.source.captureSha256;
    if (!report.steps.merchant || !report.steps.download) {
      active = await until(value => Boolean(value.current?.privateUrl), 'Original source operation');
      const opened = await liveClient(active), { call, original } = opened;
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
        if (!report.merchantBuyer) {
          const offer = (await publisher('publisher.buyer.review', { snapshot, query })).result;
          report.merchantBuyer = { intentId: report.buyerIntentId, snapshot, query,
            offerSha256: offer.offerSha256, review: offer };
          await checkpoint();
        }
        const intent = report.merchantBuyer;
        assert.equal(intent.intentId, report.buyerIntentId);
        assert.equal(intent.snapshot, snapshot);
        assert.equal(intent.query, query);
        assert.equal(intent.review.offerSha256, intent.offerSha256);
        let buyer = await retainedBuyer(call, intent);
        if (!buyer) {
          const preparedBuyer = (await publisher('publisher.buyer.prepare', {
            review: intent.review, intentId: intent.intentId, acceptIndex: 0, offerSha256: intent.offerSha256,
          })).result;
          buyer = preparedBuyer.buyer.record ?? preparedBuyer.buyer;
        }
        const buyerId = buyer.id;
        const configuration = await call('file', { kind: 'buyer-config', id: buyerId, limit: 196608 });
        assert.equal(configuration.nextOffset, null);
        assert.equal(sha(Buffer.from(configuration.data, 'base64')), configuration.file.sha256);
        assert.equal(configuration.file.sha256, buyer.configSha256);
        await publisher('publisher.release.stop');
        await checkpoint('merchant', { draftId, snapshot, releaseId, releaseDigest: staged.digest,
          mode: 'CHALLENGE_ONLY', network: payment.network, challengeStatus: 402, queryStatus: 200,
          buyerId, buyerIntentId: report.buyerIntentId, offerSha256: intent.offerSha256,
          buyerConfigSha256: configuration.file.sha256 });
      }
      const inspected = await inspectWorldBankDownload({ url: original.mcpUrl, workspace: 'research', exportId, environment });
      assert.equal(inspected.manifest.captureSha256, sourceCaptureSha);
      const client = await downloadClient(opened, inspected.manifestSha256);
      const download = await downloadWorldBankWorkspace({ client, workspace: 'research', exportId,
        directory: join(root, 'customer-download'), expectedManifestSha256: inspected.manifestSha256 });
      assert.equal(download.state, 'COMPLETE'); assert.equal(download.files, 6);
      const handover = await readFile(join(root, 'customer-download', 'handover.zip'));
      const expected = inspected.manifest.files.find(file => file.name === 'handover.zip');
      assert.equal(sha(handover), expected.sha256);
      await checkpoint('download', { files: 6, bytes: download.bytes, manifestSha256: inspected.manifestSha256,
        handoverBytes: handover.length, handoverSha256: expected.sha256 });
    }
    active = await application();
    const retainedRecovery = !report.steps.recoveredStart && recoveryRequest(active.current?.id) && unfinished(active.current);
    if (!retainedRecovery) {
      const stopped = await stopCurrent();
      await checkpoint('stopped', { operationId: stopped?.id ?? active.current?.id ?? null,
        phase: (await application()).phase });
    }
    if (!report.steps.recoveredStart) {
      active = await application();
      let plannedId;
      if (recoveryRequest(active.current?.id) && unfinished(active.current)) {
        plannedId = active.current.id;
      } else {
        const intent = await planStart('recoveryStarts', report.recoveredStartId);
        // Save the original start before dispatch; reopen that exact request.
        const planned = await prepareApplicationStart(applicationsDirectory, { applicationId: report.applicationId,
          requestId: intent.requestId, reviewId: intent.reviewId });
        assert.equal(planned.id, intent.requestId);
        plannedId = planned.id;
      }
      await model.close(); model = await openRuntimeWorkspace({ directory: applicationsDirectory });
      const recovered = await model.applicationsRecover({ applicationId: report.applicationId, operationId: plannedId });
      assert.equal(recovered.operationId, plannedId);
      let recoveredView = await application();
      if (recoveredView.current?.stop || recovered.commandActive && !recoveredView.current?.active) {
        await stopCurrent();
        recoveredView = await application();
      }
      if (!unfinished(recoveredView.current)) {
        // An interrupted process may be reconciled to a terminal result by the
        // original manager. Retain that request and prepare its next run.
        const intent = await planStart('recoveryStarts', report.recoveredStartId);
        await prepareApplicationStart(applicationsDirectory, { applicationId: report.applicationId,
          requestId: intent.requestId, reviewId: intent.reviewId });
        plannedId = intent.requestId;
        await model.close(); model = await openRuntimeWorkspace({ directory: applicationsDirectory });
        const continued = await model.applicationsRecover({ applicationId: report.applicationId, operationId: plannedId });
        assert.equal(continued.operationId, plannedId);
      }
      const activeAgain = await waitForRunning(plannedId, 'Saved start recovery');
      const resumed = await liveClient(activeAgain);
      assert.notEqual(resumed.original.instanceId, report.steps.source.modelInstanceId);
      assert.notEqual(resumed.original.browserInstanceId, report.steps.source.browserInstanceId);
      const observed = (await resumed.call('observations', { captureId, limit: 100 })).result;
      assert.deepEqual(observed.rows, firstRows);
      const review = (await resumed.call('review_read', { id: reviewId })).result;
      assert.equal(review.captureSha256, sourceCaptureSha);
      const exported = (await resumed.call('export_read', { id: exportId })).result;
      assert.equal(exported.manifestSha256, report.steps.source.exportManifestSha256);
      await checkpoint('recoveredStart', { operationId: plannedId, originalRequestId: report.recoveredStartId,
        sameSavedRequest: true, applicationId: report.applicationId, sourceCommit: activeAgain.release.sourceCommit,
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
    await initializeHost(customerHost, customerConnection);
    receiverHost = await startMerchantMcp({ configPath: customerConfig, port: 0, environment });
    const customer = await openMerchantFileClient({ url: receiverHost.url, environment });
    const receive = (name, args = {}) => customer.call('merchant_worldbank_' + name, { workspace: 'customer', ...args });
    const current = await receive('open');
    await receiveOriginalPackage(receive, current, { sourceImport: 'edition',
      expectedSha256: report.steps.download.handoverSha256, id: 'worldbank-managed-received' },
      'worldbank-managed-received-review');
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
    primaryError = error;
    report.status = 'FAILED'; report.error = { code: error.code ?? error.name, message: error.message };
    try { await checkpoint(); } catch (savedError) { error.checkpointError = savedError.message; }
    throw error;
  } finally {
    const cleanup = [];
    if (receiverHost) try { await receiverHost.close(); }
      catch (error) { cleanup.push({ part: 'customer host', code: error.code ?? error.name, message: error.message }); }
    if (model && report.applicationId) try { await stopCurrent({ preservePending: Boolean(primaryError) }); }
      catch (error) { cleanup.push({ part: 'application', code: error.code ?? error.name, message: error.message }); }
    if (model) try { await model.close(); }
      catch (error) { cleanup.push({ part: 'workspace', code: error.code ?? error.name, message: error.message }); }
    if (cleanup.length) {
      report.cleanupErrors = cleanup;
      if (!primaryError) {
        report.status = 'FAILED';
        report.error = { code: 'MANAGED_RECEIVING_CLEANUP', message: cleanup.map(item => item.part + ': ' + item.message).join('; ') };
      }
      try { await checkpoint(); } catch (error) { if (primaryError) primaryError.checkpointError = error.message; else throw error; }
      if (!primaryError) throw Object.assign(new Error(report.error.message), { code: report.error.code });
    }
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
