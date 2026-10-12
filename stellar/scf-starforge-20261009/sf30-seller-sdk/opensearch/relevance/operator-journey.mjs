// MIT. One real native evaluation through the original retained HTTP workspace.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOpenSearchWorkspace } from '../workspace/service.mjs';
import { startOpenSearchWorkspace } from '../workspace/server.mjs';
import { canonical } from '../workspace/store.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const encoded = value => JSON.stringify(value, null, 2) + '\n';
function completed(operation, label) {
  if (operation.state !== 'COMPLETE') {
    const error = new Error(label + ': ' + (operation.error?.message ?? operation.error?.code ?? operation.state));
    error.code = operation.error?.code ?? 'OPENSEARCH_OPERATOR_JOURNEY_INCOMPLETE';
    error.operation = operation;
    throw error;
  }
  return operation.result;
}
async function writeArtifact(directory, name, body) {
  const value = typeof body === 'string' || Buffer.isBuffer(body) ? body : encoded(body);
  const path = join(directory, name);
  await writeFile(path, value, { mode: 0o600 });
  return { name, path, bytes: Buffer.byteLength(value), sha256: sha256(value) };
}
export async function runRelevanceOperatorJourney({ sourceFile, planFile, directory, evaluationSet,
  env = process.env, operationId = 'opensearch-relevance-operator',
  artifactDirectory = join(directory, 'customer-exports'), onStage = () => {} } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,77}$/.test(operationId))
    throw new TypeError('OPENSEARCH_OPERATOR_OPERATION_ID_INVALID');
  directory = resolve(directory);
  artifactDirectory = resolve(artifactDirectory);
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const report = { schema: 'stellar-forge.opensearch-relevance-operator-journey.v1',
    operationId, startedAt: new Date().toISOString(), runtime: process.version,
    directory, stages: [], exports: [] };
  let workspace, running, session;
  const stage = (name, data = {}) => {
    report.stages.push({ name, ...data }); onStage({ stage: name, ...data });
  };
  async function open() {
    workspace = await createOpenSearchWorkspace({ sourceFile, planFile, directory, env });
    try { running = await startOpenSearchWorkspace({ workspace, port: 0 }); }
    catch (error) { await workspace.close(); workspace = null; throw error; }
    const response = await fetch(running.url + '/api/session', { redirect: 'error' });
    assert.equal(response.status, 200);
    session = await response.json();
    assert.equal(session.workspaceId, workspace.store.id);
  }
  async function close() {
    const active = running;
    running = null;
    if (active) await active.close();
    else await workspace?.close();
    workspace = null;
  }
  async function response(path, value) {
    return fetch(running.url + path, value === undefined
      ? { redirect: 'error', cache: 'no-store' }
      : { method: 'POST', redirect: 'error', headers: {
          'content-type': 'application/json', origin: running.url, 'x-workspace-token': session.token },
          body: JSON.stringify(value) });
  }
  async function api(path, value) {
    const received = await response(path, value);
    const result = await received.json();
    if (!received.ok) {
      const error = new Error(result.message ?? result.error ?? ('Workspace HTTP ' + received.status));
      error.code = result.error; error.status = received.status;
      throw error;
    }
    return result;
  }
  async function download(path, name) {
    const received = await response(path);
    assert.equal(received.status, 200);
    assert.ok(received.headers.get('content-disposition')?.startsWith('attachment;'));
    const body = Buffer.from(await received.arrayBuffer());
    const artifact = await writeArtifact(artifactDirectory, name, body);
    report.exports.push(artifact);
    return body;
  }
  try {
    await open();
    const originalWorkspaceId = session.workspaceId;
    const state = await api('/api/state');
    assert.ok(state.relevance.metrics.metrics.some(item => item.key === 'precision'));
    const asset = await response('/relevance.mjs');
    assert.equal(asset.status, 200);
    assert.ok((await asset.text()).includes('createRelevanceController'));
    const imported = await api('/api/relevance/normalize', { set: evaluationSet });
    const saved = completed(await api('/api/relevance-save', {
      requestId: operationId + '-save', set: imported }), 'Save evaluation set');
    const selection = { setId: saved.relevanceSetId, expectedRevision: saved.revision };
    const validation = await api('/api/relevance/validate', selection);
    assert.equal(validation.setId, selection.setId);
    assert.equal(validation.revision, selection.expectedRevision);
    const queryHistory = await api('/api/relevance/history/' + selection.setId);
    assert.equal(queryHistory.revisions[0].revision, selection.expectedRevision);
    stage('saved-native-evaluation', { workspaceId: originalWorkspaceId, ...selection, counts: validation.counts });

    // This is the sole new evaluation. The second identical request is resolved
    // by the existing request journal and keeps the original native result.
    const runRequest = { requestId: operationId + '-run', ...selection };
    const performed = completed(await api('/api/relevance-run', runRequest), 'Native relevance evaluation');
    const editionId = performed.relevanceEditionId;
    const edition = await api('/api/relevance/editions/' + editionId);
    const originalResult = canonical(edition.result);
    const reused = completed(await api('/api/relevance-run', runRequest), 'Retained evaluation request');
    assert.equal(reused.relevanceEditionId, editionId);
    assert.equal(edition.set.id, selection.setId);
    assert.equal(edition.set.revision, selection.expectedRevision);
    assert.equal(edition.result.schema, 'stellar-forge.opensearch-relevance-result.v1');
    assert.deepEqual(edition.result.caseIds, edition.set.cases.map(item => item.id));
    for (const variant of edition.result.variants) {
      assert.equal(variant.source.clusterFingerprint, edition.result.source.clusterFingerprint);
      assert.ok(Array.isArray(variant.concreteIndices) && variant.concreteIndices.length);
      assert.ok(Array.isArray(variant.effectiveSort) && variant.effectiveSort.length >= 2);
      assert.equal(typeof variant.snapshot.scopeId, 'string');
    }
    stage('native-evaluation-retained', { editionId, resultSha256: edition.resultSha256,
      complete: edition.result.complete, source: edition.result.source,
      coverage: edition.result.coverage, snapshotReleased: edition.result.snapshotReleased });

    const base = '/api/relevance/editions/' + editionId + '/';
    const nativeBytes = await download(base + 'native.json', 'native-relevance-result.json');
    assert.equal(sha256(nativeBytes), edition.resultSha256);
    assert.equal(canonical(JSON.parse(nativeBytes.toString('utf8'))), originalResult);
    const editionBytes = await download(base + 'edition.json', 'relevance-edition.json');
    assert.equal(canonical(JSON.parse(editionBytes.toString('utf8')).set), canonical(edition.set));
    const customer = JSON.parse((await download(base + 'report.json', 'relevance-customer-report.json')).toString('utf8'));
    assert.equal(customer.resultSha256, edition.resultSha256);
    assert.equal(customer.native.length, edition.result.variants.length);
    for (const item of customer.native) {
      const native = edition.result.variants.find(variant => variant.id === item.id);
      assert.deepEqual(item.execution.concreteIndices, native.concreteIndices);
      assert.deepEqual(item.execution.effectiveSort, native.effectiveSort);
      assert.deepEqual(item.execution.snapshot, native.snapshot);
      assert.deepEqual(item.cases, native.cases);
    }
    const html = await download(base + 'report.html', 'relevance-customer-report.html');
    assert.ok(html.toString('utf8').includes(edition.resultSha256));
    const csv = await download(base + 'cases.csv', 'relevance-cases.csv');
    assert.ok(csv.toString('utf8').includes('native_metric_score'));
    const setBytes = await download('/api/relevance/sets/' + selection.setId + '/set.json', 'relevance-evaluation-set.json');
    const exportedSet = JSON.parse(setBytes.toString('utf8'));
    const reopenedDefinition = await api('/api/relevance/normalize', { set: exportedSet });
    assert.equal(canonical(reopenedDefinition.cases), canonical(imported.cases));
    assert.equal(canonical(reopenedDefinition.variants), canonical(imported.variants));
    const importedCopy = completed(await api('/api/relevance-save', {
      requestId: operationId + '-import', set: { ...reopenedDefinition,
        title: ('Imported · ' + reopenedDefinition.title).slice(0, 120),
        importedFrom: { evaluationId: editionId, resultSha256: edition.resultSha256 } }
    }), 'Import customer judgment set');
    stage('customer-exports-and-import', { exportCount: report.exports.length,
      importedSetId: importedCopy.relevanceSetId, sourceRevision: selection.expectedRevision });

    const ranked = [...edition.result.variants].sort((left, right) =>
      Number(right.complete) - Number(left.complete) ||
      (right.metricScore ?? -Infinity) - (left.metricScore ?? -Infinity));
    const chosen = ranked[0];
    const chosenCase = edition.set.cases[0];
    const promoted = completed(await api('/api/relevance-promote', {
      requestId: operationId + '-promote', editionId, variantId: chosen.id, caseId: chosenCase.id,
      title: ('Evaluated · ' + chosen.label).slice(0, 120)
    }), 'Promote evaluated query');
    const draftSelection = { draftId: promoted.draftId, expectedRevision: promoted.revision };
    await api('/api/validate', draftSelection);
    const prepared = completed(await api('/api/prepare', {
      requestId: operationId + '-prepare', ...draftSelection }), 'Prepare original merchant');
    const pack = await api('/api/packages/' + prepared.packageId);
    const client = await import(pathToFileURL(join(pack.handoff.client, 'seller-client.mjs')).href);
    const route = promoted.draft.plan.routes.find(item => item.query === promoted.draft.queryName);
    assert.ok(route);
    const payment = promoted.draft.plan.payment;
    const request = client.buildRequest(route.id,
      route.method === 'GET' ? { query: chosenCase.input } : { body: chosenCase.input },
      { intentId: operationId + '-customer', acceptIndex: 0, maxAtomic: payment.amount });
    assert.equal(request.method, route.method);
    if (route.method !== 'GET') assert.deepEqual(JSON.parse(request.body), chosenCase.input);
    assert.equal(request.expect.asset, payment.asset);
    assert.equal(request.expect.payTo, payment.payTo);
    report.exports.push(await writeArtifact(artifactDirectory, 'merchant-client-request.json', request));
    stage('evaluated-merchant-handoff', { variantId: chosen.id, caseId: chosenCase.id,
      draftId: promoted.draftId, packageId: prepared.packageId, fileCount: pack.files.length,
      clientUrl: request.url, method: request.method });

    await close();
    await open();
    assert.equal(session.workspaceId, originalWorkspaceId);
    const retained = await api('/api/relevance/editions/' + editionId);
    assert.equal(retained.resultSha256, edition.resultSha256);
    assert.equal(canonical(retained.result), originalResult);
    assert.equal((await api('/api/operations/' + runRequest.requestId)).result.relevanceEditionId, editionId);
    assert.equal((await api('/api/operations/' + operationId + '-prepare')).result.packageId, prepared.packageId);
    assert.equal((await api('/api/relevance/sets/' + importedCopy.relevanceSetId)).revision, 1);
    stage('workspace-reopened', { workspaceId: originalWorkspaceId, editionId, packageId: prepared.packageId,
      identicalNativeResult: true, originalRequestRetained: true });
    report.state = edition.result.complete === true ? 'PASS' : 'NATIVE_INCOMPLETE';
    report.completedAt = new Date().toISOString();
    report.evaluationId = editionId;
    report.resultSha256 = edition.resultSha256;
    report.nativeComplete = edition.result.complete === true;
    report.nativeCoverage = edition.result.coverage;
    report.selectedVariant = chosen.id;
    report.packageId = prepared.packageId;
    await writeArtifact(artifactDirectory, 'operator-journey.json', report);
    return { report, edition, package: pack, importedSetId: importedCopy.relevanceSetId };
  } catch (error) {
    report.state = 'FAIL'; report.completedAt = new Date().toISOString();
    report.error = { code: error.code, message: error.message, operation: error.operation };
    await writeArtifact(artifactDirectory, 'operator-journey.json', report);
    throw error;
  } finally { await close(); }
}
