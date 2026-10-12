#!/usr/bin/env node
// MIT. Complete receiving through the original managed WQX projects and merchant MCP host.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { atomicJson } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/routescan/quota.mjs';
import { reviewWaterQualityManaged, startManagedWaterQuality } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/managed.mjs';
import { openWatersHash, openWatersCanonical } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/openwaters.mjs';
import { normalizeReviewSheetDocument } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/model.mjs';
import { initializeMerchantProvider } from './providers.mjs';
import { startMerchantMcp } from './serve.mjs';
import { wqxPrivateDirectory, wqxReadPrivate, wqxJson } from './wqx-workspace-connection.mjs';
import { openWqxWorkspaceClient, uploadWqxInput, downloadWqxFile, reopenWqxDownload } from './wqx-workspace-client.mjs';

export const WQX_OPERATOR_RECEIVING_SCHEMA = 'stellar-forge.wqx-operator-receiving.v1';
export const WQX_OPERATOR_RECEIVING_FORMATS = Object.freeze([
  'json', 'csv', 'tsv', 'report', 'native-locations', 'native-results',
  'native-crosswalk', 'native-report', 'native-references', 'native-bundle', 'bundle',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/, SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (left, right, message) => assert.equal(openWatersCanonical(left), openWatersCanonical(right), message);
const collect = () => globalThis.gc?.();
function configuration(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Select the original complete receiving configuration.');
  const allowed = ['schema', 'operationId', 'directory', 'sourceBundle', 'expectedSourceBundleSha256',
    'documentFile', 'expectedDocumentFileSha256', 'expectedDocumentSha256', 'sourcePlanId',
    'expectedSourcePlanSha256', 'expectedReviewSha256', 'expectedCaptureSha256', 'expectedManagedSourceSha256',
    'newPlanId', 'reviewId', 'expectedNewPlanSha256', 'expectedPreviewSha256', 'expectedResults',
    'expectedReadyResults', 'expectedReviewResults', 'expectedLimits', 'expectedCensoredResults'];
  for (const key of Object.keys(input)) assert(allowed.includes(key), 'Unknown receiving option: ' + key);
  assert(input.schema === WQX_OPERATOR_RECEIVING_SCHEMA, 'Select the current whole-operation schema.');
  for (const key of ['operationId', 'sourcePlanId', 'newPlanId', 'reviewId'])
    assert(ID.test(input[key] ?? ''), 'Use one stable original ' + key + '.');
  assert.notEqual(input.sourcePlanId, input.newPlanId, 'Choose a new immutable native receiving plan.');
  for (const key of ['directory', 'sourceBundle', 'documentFile'])
    assert(typeof input[key] === 'string' && isAbsolute(input[key]) && resolve(input[key]) === input[key] &&
      input[key] !== '/' && !input[key].includes('\0'), 'Select an absolute canonical ' + key + '.');
  for (const key of ['expectedSourceBundleSha256', 'expectedDocumentFileSha256', 'expectedDocumentSha256',
    'expectedSourcePlanSha256', 'expectedReviewSha256', 'expectedCaptureSha256', 'expectedManagedSourceSha256',
    'expectedNewPlanSha256', 'expectedPreviewSha256'])
    assert(SHA.test(input[key] ?? ''), 'Pin the complete original ' + key + '.');
  for (const key of ['expectedResults', 'expectedReadyResults', 'expectedReviewResults', 'expectedLimits', 'expectedCensoredResults'])
    assert(Number.isSafeInteger(input[key]) && input[key] >= 0, 'Specify the exact original ' + key + '.');
  assert(input.expectedResults > 1000, 'This complete receiving operation must cross the native 1,000-row page boundary.');
  assert.equal(input.expectedReadyResults + input.expectedReviewResults, input.expectedResults);
  return structuredClone(input);
}
async function folder(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return wqxPrivateDirectory(path);
}
async function maybeJson(path) {
  try { return JSON.parse((await wqxReadPrivate(path)).toString('utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function exactPrivate(path, bytes) {
  try {
    const original = await wqxReadPrivate(path);
    assert(original.equals(bytes), 'The selected private file already retains different original bytes: ' + basename(path));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  return path;
}
async function retainPinned(input, destination, expectedSha256) {
  assert.equal(await realpath(dirname(input)), dirname(input), 'Use the canonical original input parent.');
  const handle = await open(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let bytes;
  try {
    const before = await handle.stat({ bigint: true });
    assert(before.isFile() && before.size <= 128n * 1024n * 1024n && before.nlink === 1n, 'Select one complete original regular input.');
    bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'The source input changed.');
    assert.equal(hash(bytes), expectedSha256, 'The complete original input SHA-256 differs.');
  } finally { await handle.close(); }
  await exactPrivate(destination, bytes);
  return { path: destination, bytes: bytes.length, sha256: expectedSha256 };
}
function originalProjection(plan) {
  return {
    captureId: plan.captureId, captureSha256: plan.captureSha256,
    reviewId: plan.reviewId, reviewSha256: plan.reviewSha256,
    locations: plan.locations, activities: plan.activities,
    results: plan.results.map(row => ({
      sourceRecordId: row.sourceRecordId, sourceRecordSha256: row.sourceRecordSha256,
      nativeResultId: row.nativeResultId, sourceKey: row.sourceKey, source: row.source,
      destinationActivityId: row.destinationActivityId, destinationLocationId: row.destinationLocationId,
      limits: row.limits.map(limit => Object.fromEntries(['id', 'type', 'value', 'unit', 'comment', 'origin', 'source']
        .map(key => [key, limit[key]]))),
    })),
  };
}
function science(before, after, selected) {
  assert.equal(before.results.length, selected.expectedResults);
  assert.equal(after.results.length, selected.expectedResults);
  equal(originalProjection(after), originalProjection(before), 'Every original result, source pointer, location, activity and limit must survive receiving.');
  let limits = 0, censored = 0;
  const original = new Map(before.results.map(row => [row.sourceRecordId, row]));
  assert.equal(original.size, selected.expectedResults, 'Original result identities are unique.');
  for (const row of after.results) {
    limits += row.limits.length;
    const source = original.get(row.sourceRecordId);
    if (source.fields.RESULT_DETECT_CONDITION === 'Not Detected') {
      const limit = source.limits.find(value => value.type === 'Censoring Level');
      if (!limit) continue;
      censored++;
      assert.equal(row.fields.RESULT_DETECT_CONDITION, source.fields.RESULT_DETECT_CONDITION);
      assert.equal(row.fields.RESULT_MSR ?? '', '', 'A censored observation keeps its blank measured value.');
      assert.equal(row.fields.LAB_REPORTING_LEVEL, limit.value, 'Use this exact source censoring level.');
      assert.equal(row.fields.DETECTION_LIMIT_UNIT, limit.unit, 'Use this exact source censoring unit.');
    }
  }
  assert.equal(limits, selected.expectedLimits); assert.equal(censored, selected.expectedCensoredResults);
  assert.equal(after.summary.readyResults, selected.expectedReadyResults);
  assert.equal(after.summary.reviewResults, selected.expectedReviewResults);
  return { results: after.results.length, limits, censoredResults: censored,
    originalProjectionSha256: openWatersHash(originalProjection(before)),
    before: before.summary, after: after.summary };
}

/** One real MCP listener, two original managed projects, full files and durable restarts. */
export async function receiveWqxOperator(input, { onProgress } = {}) {
  const selected = configuration(input), root = selected.directory;
  assert.equal(await realpath(dirname(root)), dirname(root), 'Use a canonical receiving parent.');
  const parent = await lstat(dirname(root));
  assert(parent.isDirectory() && !(parent.mode & 0o022) && (!process.getuid || parent.uid === process.getuid()),
    'Use an owned parent directory that other users cannot replace.');
  await folder(root);
  const lease = await acquireStateLease(root);
  const startedAt = new Date().toISOString(), started = performance.now();
  let sourceHost, receiverHost, mcp, source, receiver, requests = 0, configurationPath, listenerPort = 0;
  const nativeFiles = [], stages = [], restarts = [];
  const environment = { ...process.env, WQX_RECEIVING_TOKEN: randomBytes(32).toString('hex'),
    MCP_OAUTH_CONFIG: undefined, MCP_CLIENT_ORIGINS: '' };
  const progress = async (phase, details = {}) => {
    const stage = { phase, elapsedMs: Math.round(performance.now() - started), ...details };
    stages.push(stage); await onProgress?.(stage); collect();
  };
  const clients = async () => {
    source = await openWqxWorkspaceClient({ url: mcp.url, workspace: 'source', tokenEnv: 'WQX_RECEIVING_TOKEN', environment });
    receiver = await openWqxWorkspaceClient({ url: mcp.url, workspace: 'receiver', tokenEnv: 'WQX_RECEIVING_TOKEN', environment });
  };
  const openMcp = async () => {
    mcp = await startMerchantMcp({ configPath: configurationPath, port: listenerPort,
      tokenEnv: 'WQX_RECEIVING_TOKEN', environment });
    mcp.server.on('request', () => { requests++; });
    listenerPort = Number(new URL(mcp.url).port);
    await exactPrivate(join(root, 'mcp-listener.json'), Buffer.from(wqxJson({ port: listenerPort })));
    await clients();
  };
  const download = async (client, file, label, options = {}) => {
    const result = await downloadWqxFile(client, { file, directory: join(root, 'downloads', label) }, options);
    assert.equal(result.sha256, file.sha256); assert.equal(result.bytes, file.bytes);
    const reopened = await reopenWqxDownload({ directory: result.directory, expectedSha256: file.sha256 });
    assert.equal(reopened.sha256, file.sha256);
    nativeFiles.push({ label, workspace: client.workspace, file, filename: result.filename,
      bytes: result.bytes, sha256: result.sha256, resumedBytes: result.resumedBytes });
    return result;
  };
  const fullJson = async (client, response, label) => {
    assert(response.file, 'The original native result must retain its entire JSON file.');
    const retained = await download(client, response.file, label);
    return JSON.parse(await readFile(retained.filename, 'utf8'));
  };
  try {
    await exactPrivate(join(root, 'operation.json'), Buffer.from(wqxJson(selected)));
    for (const name of ['inputs', 'downloads', 'source-project', 'receiver-project']) await folder(join(root, name));
    const bundle = await retainPinned(selected.sourceBundle, join(root, 'inputs', 'source-bundle.json'), selected.expectedSourceBundleSha256);
    const documentFile = await retainPinned(selected.documentFile, join(root, 'inputs', 'receiving-document.json'), selected.expectedDocumentFileSha256);
    const document = normalizeReviewSheetDocument(JSON.parse(await readFile(documentFile.path, 'utf8')));
    assert.equal(openWatersHash(document), selected.expectedDocumentSha256);
    assert.equal(document.sourcePlanId, selected.sourcePlanId); assert.equal(document.sourcePlanSha256, selected.expectedSourcePlanSha256);
    sourceHost = await startManagedWaterQuality(await reviewWaterQualityManaged({
      directory: join(root, 'source-project'), bundleFile: bundle.path, expectedSourceSha256: selected.expectedManagedSourceSha256,
    }));
    receiverHost = await startManagedWaterQuality(await reviewWaterQualityManaged({
      directory: join(root, 'receiver-project'), expectedSourceSha256: selected.expectedManagedSourceSha256,
    }));
    const connection = { schema: 'stellar-forge.wqx-workspace-connection.v1', workspaces: {} };
    for (const [alias, host] of [['source', sourceHost], ['receiver', receiverHost]])
      connection.workspaces[alias] = { label: alias === 'source' ? 'Original scientific source' : 'Independent receiving project',
        directory: host.launch.directory, projectBindingId: host.launch.projectBindingId,
        expectedSourceSha256: selected.expectedManagedSourceSha256 };
    const connectionPath = join(root, 'wqx-connection.json');
    await exactPrivate(connectionPath, Buffer.from(wqxJson(connection)));
    const setup = await initializeMerchantProvider('wqx-water-quality', {
      directory: join(root, 'merchant'), connection: connectionPath, name: 'Complete water-quality receiving',
    });
    configurationPath = setup.configuration;
    listenerPort = (await maybeJson(join(root, 'mcp-listener.json')))?.port ?? 0;
    await openMcp();
    assert.equal((await source.status()).workspaces[0].status, 'OPEN');
    assert.equal((await receiver.status()).workspaces[0].status, 'OPEN');
    await progress('managed-projects-and-original-mcp-open', { provider: 'wqx-water-quality' });

    const targets = [], targetPages = [];
    let offset = 0;
    do {
      const page = await source.targets({ planId: selected.sourcePlanId, kind: 'result', field: 'RESULT_STATUS',
        attentionOnly: false, offset, limit: 1000, expectedPlanSha256: selected.expectedSourcePlanSha256 });
      assert.equal(page.total, selected.expectedResults); assert.equal(page.source.sourcePlanSha256, selected.expectedSourcePlanSha256);
      targets.push(...page.rows.map(row => row.targetId)); targetPages.push({ offset, rows: page.rows.length, total: page.total });
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(targets.length, selected.expectedResults); assert.equal(new Set(targets).size, selected.expectedResults);
    const originalPlan = await fullJson(source, await source.record({ family: 'plan', id: selected.sourcePlanId }), 'original-plan');
    assert.equal(originalPlan.planSha256, selected.expectedSourcePlanSha256);
    assert.equal(originalPlan.reviewSha256, selected.expectedReviewSha256); assert.equal(originalPlan.captureSha256, selected.expectedCaptureSha256);

    const firstBytes = await open(bundle.path, 'r').then(async handle => {
      try { const bytes = Buffer.alloc(Math.min(65536, bundle.bytes)); await handle.read(bytes, 0, bytes.length, 0); return bytes; }
      finally { await handle.close(); }
    });
    const inputSelection = { inputId: 'original-source-bundle', name: 'source-bundle.json', contentType: 'application/json',
      bytes: bundle.bytes, sha256: bundle.sha256 };
    const begun = await source.inputBegin(inputSelection);
    const append = { inputId: inputSelection.inputId, sha256: bundle.sha256, offset: 0, dataBase64: firstBytes.toString('base64') };
    if (begun.status !== 'COMPLETE') {
      const first = await source.inputAppend(append), replay = await source.inputAppend(append);
      assert.equal(first.receivedBytes, replay.receivedBytes, 'Replaying the retained exact prefix must not append it twice.');
    }
    const uploaded = await uploadWqxInput(source, { ...inputSelection, path: bundle.path, expectedSha256: bundle.sha256 });
    assert(uploaded.resumedBytes >= firstBytes.length); assert.equal(uploaded.receivedBytes, bundle.bytes);
    await source.receive({ kind: 'plan', inputRef: uploaded.inputRef });
    const uploadedDocument = await uploadWqxInput(source, { inputId: 'receiving-document', path: documentFile.path,
      name: 'receiving-document.json', contentType: 'application/json', expectedSha256: documentFile.sha256 });
    const documentRef = uploadedDocument.inputRef;
    await progress('complete-source-cohort-and-resumed-input', { results: targets.length, pages: targetPages,
      inputBytes: uploaded.bytes, resumedBytes: uploaded.resumedBytes });

    const tables = [];
    for (const format of ['csv', 'tsv']) {
      const file = await source.tableExport({ documentRef, format });
      assert(file.bytes > 2 * 1024 * 1024, 'Exchange the complete native table beyond the inline MCP body.');
      const local = await download(source, file, 'editable-table-' + format);
      const importedInput = await uploadWqxInput(source, { inputId: 'editable-table-' + format, path: local.filename,
        name: basename(local.filename), contentType: file.contentType, expectedSha256: file.sha256 });
      const imported = await fullJson(source, await source.tableImport({ inputRef: importedInput.inputRef, format }), 'imported-table-' + format);
      assert.equal(openWatersHash(normalizeReviewSheetDocument(imported)), selected.expectedDocumentSha256);
      tables.push({ format, bytes: file.bytes, sha256: file.sha256, documentSha256: selected.expectedDocumentSha256 });
    }
    const preview = await fullJson(source, await source.decisionsPreview({ documentRef, newPlanId: selected.newPlanId }), 'native-preview');
    assert.equal(preview.previewSha256, selected.expectedPreviewSha256);
    assert.equal(preview.newPlanSha256, selected.expectedNewPlanSha256);
    assert.equal(preview.documentSha256, selected.expectedDocumentSha256);
    const scientific = science(originalPlan, preview.plan, selected);
    const saveRequest = { documentRef, newPlanId: selected.newPlanId, reviewId: selected.reviewId,
      expectedPreviewSha256: preview.previewSha256 };
    const saved = await fullJson(source, await source.decisionsSave(saveRequest), 'saved-decision-review');
    assert.equal(saved.status, 'COMPLETE'); assert.equal(saved.newPlanSha256, selected.expectedNewPlanSha256);
    const replay = await fullJson(source, await source.decisionsSave(saveRequest), 'reopened-decision-review');
    assert.equal(replay.reviewSha256, saved.reviewSha256); assert.equal(replay.requestSha256, saved.requestSha256);
    await progress('complete-tables-and-native-scientific-plan', { tables, readyResults: scientific.after.readyResults,
      reviewResults: scientific.after.reviewResults, retainedLimits: scientific.limits });

    const sourceExports = {}, receiverExports = {};
    for (const format of WQX_OPERATOR_RECEIVING_FORMATS) {
      const file = await source.file({ family: 'decision', id: selected.reviewId, format });
      sourceExports[format] = file;
      if (format !== 'bundle') { await download(source, file, 'source-' + format); continue; }
      const directory = join(root, 'downloads', 'source-bundle'), abort = new AbortController();
      let interrupted = false;
      try {
        await downloadWqxFile(source, { file, directory }, { signal: abort.signal,
          onProgress: state => { if (state.bytes >= 65536 && state.bytes < state.total) abort.abort(new Error('Retain this original download for the host restart.')); } });
      } catch (error) { if (!abort.signal.aborted) throw error; interrupted = true; }
      source.close(); receiver.close(); const originalUrl = mcp.url; await mcp.close(); mcp = null;
      await openMcp(); assert.equal(mcp.url, originalUrl, 'Resume through the original stable listener identity.');
      const resumed = await download(source, file, 'source-bundle');
      assert(resumed.resumedBytes >= 65536);
      restarts.push({ kind: 'merchant-mcp', retainedBytes: resumed.resumedBytes, interrupted, bytes: file.bytes, sha256: file.sha256 });
    }
    const priorSourceLaunch = sourceHost.launch;
    await sourceHost.close(); sourceHost = null;
    sourceHost = await startManagedWaterQuality(await reviewWaterQualityManaged({
      directory: join(root, 'source-project'), expectedSourceSha256: selected.expectedManagedSourceSha256,
      reviewId: originalPlan.reviewId, planId: selected.newPlanId,
    }));
    assert.notEqual(sourceHost.launch.launchId, priorSourceLaunch.launchId);
    assert.equal(sourceHost.launch.projectBindingId, priorSourceLaunch.projectBindingId);
    const reopenedSource = await source.record({ family: 'decision', id: selected.reviewId });
    const reopenedSourceReview = await fullJson(source, reopenedSource, 'source-after-managed-restart');
    assert.equal(reopenedSourceReview.reviewSha256, saved.reviewSha256);
    restarts.push({ kind: 'source-managed-project', projectBindingId: sourceHost.launch.projectBindingId,
      oldLaunchId: priorSourceLaunch.launchId, launchId: sourceHost.launch.launchId });
    await progress('eleven-complete-source-exports-and-host-restarts', { exports: WQX_OPERATOR_RECEIVING_FORMATS.length,
      totalBytes: Object.values(sourceExports).reduce((sum, file) => sum + file.bytes, 0) });

    const received = await fullJson(receiver, await receiver.receive({ kind: 'decision',
      inputRef: 'file:' + sourceExports.bundle.fileId }), 'independent-receiving-review');
    assert.equal(received.reviewSha256, saved.reviewSha256); assert.equal(received.newPlanSha256, selected.expectedNewPlanSha256);
    for (const format of WQX_OPERATOR_RECEIVING_FORMATS) {
      const file = await receiver.file({ family: 'decision', id: selected.reviewId, format });
      assert.equal(file.sha256, sourceExports[format].sha256, 'The independently received ' + format + ' must be the complete original export.');
      assert.equal(file.bytes, sourceExports[format].bytes);
      receiverExports[format] = file; await download(receiver, file, 'receiver-' + format);
    }
    const receiverPlan = await fullJson(receiver, await receiver.record({ family: 'plan', id: selected.newPlanId }), 'independent-native-plan');
    science(originalPlan, receiverPlan, selected);
    assert.equal(receiverPlan.planSha256, selected.expectedNewPlanSha256);
    const priorReceiverLaunch = receiverHost.launch;
    await receiverHost.close(); receiverHost = null;
    receiverHost = await startManagedWaterQuality(await reviewWaterQualityManaged({
      directory: join(root, 'receiver-project'), expectedSourceSha256: selected.expectedManagedSourceSha256,
      reviewId: originalPlan.reviewId, planId: selected.newPlanId,
    }));
    assert.notEqual(receiverHost.launch.launchId, priorReceiverLaunch.launchId);
    assert.equal(receiverHost.launch.projectBindingId, priorReceiverLaunch.projectBindingId);
    const receiverReview = await fullJson(receiver, await receiver.record({ family: 'decision', id: selected.reviewId }), 'receiver-after-managed-restart');
    assert.equal(receiverReview.reviewSha256, saved.reviewSha256);
    restarts.push({ kind: 'receiver-managed-project', projectBindingId: receiverHost.launch.projectBindingId,
      oldLaunchId: priorReceiverLaunch.launchId, launchId: receiverHost.launch.launchId });
    await progress('independent-complete-project-reopened', { planSha256: receiverPlan.planSha256,
      decisionReviewSha256: saved.reviewSha256, results: receiverPlan.results.length });

    source.close(); receiver.close(); await mcp.close(); mcp = null;
    await sourceHost.close(); sourceHost = null; await receiverHost.close(); receiverHost = null;
    const result = { schema: WQX_OPERATOR_RECEIVING_SCHEMA, operationId: selected.operationId, status: 'COMPLETE',
      startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
      sourceBundle: { bytes: bundle.bytes, sha256: bundle.sha256 },
      sourcePlanSha256: originalPlan.planSha256, documentSha256: selected.expectedDocumentSha256,
      newPlanSha256: selected.expectedNewPlanSha256, previewSha256: selected.expectedPreviewSha256,
      decisionReviewSha256: saved.reviewSha256, scientific, targetPages, tables, restarts,
      mcpRequests: requests, files: nativeFiles, stages,
      exportedBytes: nativeFiles.reduce((sum, file) => sum + file.bytes, 0) };
    lease.assertHeld(); await atomicJson(root, 'receiving-result.json', result);
    return result;
  } finally {
    source?.close(); receiver?.close();
    const stopped = await Promise.allSettled([mcp?.close(), sourceHost?.close(), receiverHost?.close()]);
    await lease.close();
    const failed = stopped.filter(value => value.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(value => value.reason), 'The original receiving hosts did not finish shutdown.');
  }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write('Usage: node --expose-gc wqx-workspace-receiving.mjs /absolute/private/receiving.json\n');
    return;
  }
  assert.equal(args.length, 1, 'Select one complete original receiving configuration.');
  const selected = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
  const result = await receiveWqxOperator(selected, { onProgress: stage => process.stderr.write(JSON.stringify(stage) + '\n') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'WQX_RECEIVING_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
