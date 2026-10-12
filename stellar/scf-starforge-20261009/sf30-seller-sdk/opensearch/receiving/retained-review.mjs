// MIT. Complete local receiving work using original captures and product APIs.
// Run through run-retained-review.py. The original live journey remains unchanged.
import { installLocalOnlyNetwork } from './retained-local-network.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const network = installLocalOnlyNetwork();
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--workspace', '--directory', '--source', '--plan', '--selection', '--mode'].includes(key) ||
      args.has(key) || !value || value.startsWith('--')) throw new Error('Use the documented retained review arguments.');
  args.set(key, value);
}
for (const key of ['--workspace', '--directory', '--source', '--plan', '--selection', '--mode'])
  if (!args.has(key)) throw new Error('Missing ' + key);
const mode = args.get('--mode');
assert.ok(['operate', 'reopen'].includes(mode));
const root = resolve(args.get('--directory')), workspaceDirectory = resolve(args.get('--workspace'));
const selectionRaw = await readFile(resolve(args.get('--selection')));
const selection = JSON.parse(selectionRaw);
assert.equal(selection.schema, 'stellar-forge.opensearch-retained-selection.v1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const reportPath = join(root, 'retained-review.json');
await mkdir(root, { recursive: true, mode: 0o700 });
let report;
try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (report) {
  assert.equal(report.operation, selection.operation);
  assert.equal(report.selectionSha256, hash(selectionRaw));
} else {
  assert.equal(mode, 'operate');
  report = { schema: 'stellar-forge.opensearch-retained-review.v1',
    operation: selection.operation, selectionSha256: hash(selectionRaw),
    startedAt: now(), selection, requests: {}, stages: [], artifacts: [], processes: [] };
}
if (mode === 'reopen') assert.ok(['LOCAL_OPERATIONS_COMPLETE', 'COMPLETE'].includes(report.state));
report.processes.push({ mode, pid: process.pid, runtime: process.version, startedAt: now() });
const processRecord = report.processes.at(-1);
report.state = mode === 'operate' ? 'LOCAL_OPERATIONS_RUNNING' : 'REOPEN_RUNNING';
let workspace, application, closed = false;
async function save() {
  const temporary = reportPath + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, reportPath);
}
async function stage(name, value) {
  const item = { name, completedAt: now(), ...value };
  const index = report.stages.findIndex(item => item.name === name);
  if (index < 0) report.stages.push(item); else report.stages[index] = item;
  await save();
  process.stdout.write(JSON.stringify({ stage: name, ...value }) + '\n');
}
function artifactPath(name) {
  assert.ok(name && !name.startsWith('/') && name.split('/').every(part => part && !['.', '..'].includes(part)));
  const path = resolve(root, name);
  assert.ok(path.startsWith(root + sep)); return path;
}
async function artifact(name, value) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const file = artifactPath(name);
  const item = { file: name, bytes: raw.length, sha256: hash(raw) };
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await readFile(file);
    assert.equal(previous.length, item.bytes, 'Retain the first completed artifact: ' + name);
    assert.equal(hash(previous), item.sha256, 'Retain the first completed artifact: ' + name);
  }
  if (handle) {
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
  }
  const prior = report.artifacts.find(value => value.file === name);
  if (prior) assert.deepEqual(prior, item); else report.artifacts.push(item);
  await save(); return item;
}
async function retainedArtifact(name, produce) {
  const existing = report.artifacts.find(value => value.file === name);
  if (existing) {
    const raw = await readFile(artifactPath(name));
    assert.equal(raw.length, existing.bytes); assert.equal(hash(raw), existing.sha256);
    return existing;
  }
  return artifact(name, await produce());
}
async function requestId(name) {
  if (!report.requests[name]) { report.requests[name] = randomUUID(); await save(); }
  return report.requests[name];
}
async function api(path) {
  const response = await fetch(application.url + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok) throw new Error('Original local API failed: ' + JSON.stringify(value));
  return value;
}
async function localBytes(path) {
  const response = await fetch(application.url + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Original local download returned ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
function selectionView(status) {
  return { active: status.state.active, previous: status.state.previous, generation: status.state.generation };
}
function releaseView(status) {
  return status.releases.map(value => ({ id: value.id, digest: value.digest,
    executionSha256: value.opensearch?.executionSha256 ?? null })).sort((a, b) => a.id.localeCompare(b.id));
}
function unpackClient(raw) {
  const tar = gunzipSync(raw, { maxOutputLength: 32 * 1024 * 1024 }), files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const encoded = header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim();
    assert.match(encoded, /^[0-7]+$/);
    const size = parseInt(encoded, 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    assert.ok(!name.startsWith('/') && name.split('/').every(part => part && part !== '..') && !files.has(name));
    assert.equal(String.fromCharCode(header[156]), '0');
    files.set(name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
async function buildRequest(clientFile, label) {
  const client = await import(pathToFileURL(clientFile));
  const request = client.buildRequest('flight_search', { body: { country: 'US', minimum_price: 0 } },
    { intentId: 'retained-review-' + label, acceptIndex: 0, maxAtomic: '10000' });
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://search.example.com/search/flights');
  return { method: request.method, url: request.url, constructedLocally: true };
}
async function captureView(editionId, expected) {
  const edition = workspace.edition(editionId);
  const raw = Buffer.from(workspace.downloadEdition(editionId, 'result.json').body);
  assert.equal(hash(raw), edition.resultSha256);
  if (expected?.sha256) assert.equal(hash(raw), expected.sha256);
  if (expected?.hits !== undefined) assert.equal(edition.result.hits.length, expected.hits);
  if (expected?.pages !== undefined) assert.equal(edition.result.pages, expected.pages);
  assert.equal(edition.result.snapshotReleased, true);
  return { edition, raw, view: { editionId, requestId: edition.requestId, draftId: edition.draftId,
    draftRevision: edition.draftRevision, resultSha256: hash(raw), resultBytes: raw.length,
    hits: edition.result.hits.length, pages: edition.result.pages,
    snapshotReleased: edition.result.snapshotReleased, capturedAt: edition.capturedAt, source: edition.source } };
}
async function openProduct() {
  const { createOpenSearchWorkspace } = await import('../workspace/service.mjs');
  const { startOpenSearchWorkspace } = await import('../workspace/server.mjs');
  workspace = await createOpenSearchWorkspace({ sourceFile: resolve(args.get('--source')),
    planFile: resolve(args.get('--plan')), directory: workspaceDirectory, env: process.env,
    sourceFactory: network.sourceFactory });
  application = await startOpenSearchWorkspace({ workspace, port: 0 });
  const state = await api('/api/state');
  assert.equal(state.workspaceId, selection.workspaceId);
  assert.equal(state.sourceProfileSha256, selection.sourceProfileSha256);
  return state;
}
async function closeProduct() {
  if (closed) return;
  closed = true;
  if (application) await application.close(); else if (workspace) await workspace.close();
  network.closeIdleConnections();
}
await save();
try {
  const state = await openProduct();
  const base = await captureView(selection.baseEditionId, { sha256: selection.baseResultSha256, hits: 7, pages: 3 });
  const capture = workspace.operation(selection.upgradeCaptureRequestId);
  assert.equal(capture.kind, 'capture'); assert.equal(capture.state, 'COMPLETE');
  const upgrade = await captureView(capture.result.editionId, { hits: 6, pages: 4 });
  const draft = workspace.draft(upgrade.edition.draftId, upgrade.edition.draftRevision);
  assert.equal(draft.query.pageSize, 2); assert.equal(draft.query.maxHits, 6);
  const startingStatus = await workspace.deployment.status();
  if (mode === 'operate') {
    report.originalSelection ??= selectionView(startingStatus);
    await stage('retained-original-captures', { workspaceId: state.workspaceId,
      sourceProfileSha256: state.sourceProfileSha256, base: base.view, upgrade: upgrade.view });
    for (const [label, value] of [['seven-result', base], ['six-result', upgrade]]) {
      for (const format of ['result.json', 'edition.json', 'results.csv'])
        await retainedArtifact('customer/' + label + '/' + format,
          () => workspace.downloadEdition(value.edition.id, format).body);
    }
    await retainedArtifact('customer/capture-comparison.json',
      () => JSON.stringify(workspace.compare(base.edition.id, upgrade.edition.id), null, 2) + '\n');
    const basePackage = workspace.package(selection.basePackageId);
    assert.equal(basePackage.files.length, 11);
    for (const file of basePackage.files) await workspace.downloadPackage(basePackage.id, file.name);
    let prepared = workspace.state().packages.find(value =>
      value.draftId === draft.id && value.draftRevision === draft.revision);
    if (!prepared) {
      const operation = await workspace.run('prepare', { requestId: await requestId('prepareUpgrade'),
        draftId: draft.id, expectedRevision: draft.revision });
      assert.equal(operation.state, 'COMPLETE', JSON.stringify(operation.error));
      prepared = workspace.package(operation.result.packageId);
    } else prepared = workspace.package(prepared.id);
    assert.equal(prepared.files.length, 11);
    for (const file of prepared.files) {
      const value = await workspace.downloadPackage(prepared.id, file.name);
      await artifact('customer/prepared-six-result/' + file.name, value.body);
    }
    const preparedRequest = await buildRequest(
      artifactPath('customer/prepared-six-result/client/seller-client.mjs'), 'prepared-six-result');
    report.upgradePackage = { id: prepared.id, requestId: prepared.requestId,
      draftId: prepared.draftId, draftRevision: prepared.draftRevision,
      sourceSha256: prepared.sourceSha256, planSha256: prepared.planSha256,
      files: prepared.files, generatedRequest: preparedRequest };
    await stage('prepared-six-result-package', report.upgradePackage);
    let status = await workspace.deployment.status();
    if (!status.releases.some(value => value.id === selection.upgradeReleaseId)) {
      const id = await requestId('stageUpgrade');
      await workspace.deployment.run({ action: 'stage', requestId: id, packageId: prepared.id,
        id: selection.upgradeReleaseId, label: 'Flight search — six-result release', runtime: { port: 0 } });
      const task = workspace.deployment.tasks.get(id);
      if (task) await task;
      const operation = workspace.operation(id);
      assert.equal(operation.state, 'COMPLETE', JSON.stringify(operation.error));
    }
    status = await workspace.deployment.status();
    assert.deepEqual(selectionView(status), report.originalSelection);
    const comparison = await workspace.deployment.compare({ from: selection.baseReleaseId, to: selection.upgradeReleaseId });
    assert.notEqual(comparison.before.opensearch.executionSha256, comparison.after.opensearch.executionSha256);
    assert.equal(comparison.summary.paymentChanged, 0);
    assert.ok(comparison.runtimeChanges.some(value => value.field === 'opensearch'));
    await retainedArtifact('customer/release-comparison.json', () => JSON.stringify(comparison, null, 2) + '\n');
    await retainedArtifact('customer/prepared-six-result-deployment.md',
      async () => (await workspace.deployment.handover(selection.upgradeReleaseId)).body);
    report.releaseSelection = selectionView(status); report.releases = releaseView(status);
    await stage('staged-package-and-comparison', { packageId: prepared.id,
      releaseId: selection.upgradeReleaseId, selection: report.releaseSelection,
      releases: report.releases, paymentChanged: comparison.summary.paymentChanged });
    const list = await workspace.deployment.clients();
    const entry = list.entries.find(value => value.exportId === selection.baseClientExportId);
    assert.ok(entry?.manifestFile?.sha256);
    assert.equal(entry.manifestFile.sha256, selection.baseClientManifestSha256);
    const query = new URLSearchParams({ exportId: entry.exportId, expectedManifestSha256: entry.manifestFile.sha256 });
    const raw = await localBytes('/api/deployment/client-download?' + query);
    assert.equal(hash(raw), selection.baseClientArchiveSha256);
    const members = unpackClient(raw);
    const manifestRaw = members.get(entry.exportId + '/client-export.json');
    assert.ok(manifestRaw); assert.equal(hash(manifestRaw), entry.manifestFile.sha256);
    const manifest = JSON.parse(manifestRaw);
    assert.equal(members.size, manifest.files.length + 1);
    for (const file of [...manifest.files,
      { name: 'client-export.json', bytes: manifestRaw.length, sha256: hash(manifestRaw) }]) {
      assert.equal(basename(file.name), file.name);
      const bytes = members.get(entry.exportId + '/' + file.name);
      assert.ok(bytes); assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
      await artifact('customer/retained-v1-managed-client/' + file.name, bytes);
    }
    const archive = await artifact('customer/retained-v1-managed-client.tar.gz', raw);
    const generatedRequest = await buildRequest(
      artifactPath('customer/retained-v1-managed-client/seller-client.mjs'), 'retained-v1');
    report.baseClient = { exportId: entry.exportId, manifestSha256: entry.manifestFile.sha256,
      archive, files: members.size, generatedRequest };
    await stage('original-managed-client-export', report.baseClient);
    for (const path of ['/', '/app.mjs', '/deployment.mjs', '/style.css']) {
      const raw = await localBytes(path); assert.ok(raw.length > 0);
    }
    await stage('original-operator-interface', { routes: ['/', '/app.mjs', '/deployment.mjs', '/style.css'],
      transport: 'owned loopback HTTP' });
    await closeProduct();
    report.state = 'LOCAL_OPERATIONS_COMPLETE'; report.localCompletedAt = now();
  } else {
    assert.equal(upgrade.view.editionId,
      report.stages.find(value => value.name === 'retained-original-captures').upgrade.editionId);
    assert.equal(upgrade.view.resultSha256,
      report.stages.find(value => value.name === 'retained-original-captures').upgrade.resultSha256);
    assert.deepEqual(selectionView(startingStatus), report.releaseSelection);
    assert.deepEqual(releaseView(startingStatus), report.releases);
    const prepared = workspace.package(report.upgradePackage.id);
    assert.equal(prepared.sourceSha256, report.upgradePackage.sourceSha256);
    assert.equal(prepared.planSha256, report.upgradePackage.planSha256);
    for (const file of prepared.files) await workspace.downloadPackage(prepared.id, file.name);
    for (const file of report.artifacts) {
      const bytes = await readFile(artifactPath(file.file));
      assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
    }
    const raw = await localBytes('/api/deployment/client-download?' + new URLSearchParams({
      exportId: report.baseClient.exportId, expectedManifestSha256: report.baseClient.manifestSha256 }));
    assert.equal(hash(raw), report.baseClient.archive.sha256);
    assert.ok(report.processes.some(value => value.mode === 'operate' && value.pid !== process.pid && value.endedAt));
    await stage('fresh-process-reopen', { workspaceId: state.workspaceId,
      baseEditionId: base.view.editionId, upgradeEditionId: upgrade.view.editionId,
      baseResultSha256: base.view.resultSha256, upgradeResultSha256: upgrade.view.resultSha256,
      packageId: prepared.id, releases: releaseView(startingStatus),
      retainedClientManifestSha256: report.baseClient.manifestSha256,
      retainedClientArchiveSha256: hash(raw), allArtifactBytesMatched: report.artifacts.length,
      processId: process.pid });
    await closeProduct();
    report.state = 'COMPLETE'; report.completedAt = now();
  }
  processRecord.network = network.snapshot();
  assert.deepEqual(processRecord.network.deniedAttempts, []);
  processRecord.endedAt = now();
  report.completedScope = 'Original captured editions, preparation, staged release comparison, customer exports and fresh-process reopen';
  report.liveContinuation = {
    originalOperation: selection.deniedNativeOperation,
    providerBoundary: selection.providerBoundary,
    requiredOperations: ['start six-result live seller', 'generate its managed running-instance client',
      'restart the retained seven-result seller after rollback', 'fresh-process live seller start'],
    originalJourneyPreserved: true,
  };
} catch (error) {
  report.state = 'FAILED'; report.error = { code: error.code, message: error.message, stack: error.stack };
  process.stderr.write(JSON.stringify(report.error) + '\n'); process.exitCode = 1;
} finally {
  try { await closeProduct(); } catch (error) {
    report.state = 'FAILED'; report.closeError = { message: error.message }; process.exitCode = 1;
  }
  processRecord.network = network.snapshot(); processRecord.endedAt = now();
  await save();
  process.stdout.write(JSON.stringify({ state: report.state, mode, reportPath }) + '\n');
}
