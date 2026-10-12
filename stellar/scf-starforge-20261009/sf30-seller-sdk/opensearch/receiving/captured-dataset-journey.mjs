// MIT. Operate actual saved OpenSearch editions through the original dataset product.
import { installCapturedLocalNetwork } from './captured-local-network.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert.ok(['--workspace','--directory','--selection','--plan','--flock','--flock-sha256','--mode'].includes(key) &&
    value && !value.startsWith('--') && !args.has(key), 'Use the complete captured-edition receiving arguments.');
  args.set(key, value);
}
for (const name of ['--workspace','--directory','--selection','--plan','--flock','--flock-sha256','--mode']) assert.ok(args.has(name), name);
const root = resolve(args.get('--directory')), versionDirectory = join(root, 'versions');
const network = installCapturedLocalNetwork({ versionDirectories: [versionDirectory],
  flockPath: resolve(args.get('--flock')), flockSha256: args.get('--flock-sha256') });
const { openWorkspaceStore } = await import('../workspace/store.mjs');
const { prepareCapturedDataset, readCapturedDataset, startCapturedDataset } = await import('../captured-dataset.mjs');
const { inspectSellerClientExport } = await import('../../developer/client-export.mjs');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
const mode = args.get('--mode'); assert.ok(['operate','reopen'].includes(mode));
const selectionRaw = await readFile(args.get('--selection')), selection = JSON.parse(selectionRaw);
assert.equal(selection.schema, 'stellar-forge.opensearch-captured-customer.v1');
await mkdir(root, { recursive: true, mode: 0o700 });
const reportPath = join(root, 'captured-dataset-journey.json');
async function atomic(path, raw) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
  try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}
async function retain(path, raw) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(path), raw); }
  return { path: path.slice(root.length + 1), bytes: raw.length, sha256: hash(raw) };
}
let report;
try { report = JSON.parse(await readFile(reportPath)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (report) {
  assert.equal(report.operation, selection.operation); assert.equal(report.selectionSha256, hash(selectionRaw));
} else {
  assert.equal(mode, 'operate');
  report = { schema: 'stellar-forge.opensearch-captured-customer-result.v1', operation: selection.operation,
    selectionSha256: hash(selectionRaw), startedAt: now(), stages: [], artifacts: [], attempts: [] };
}
if (mode === 'reopen') assert.ok(report.stages.some(stage => stage.name === 'operator-rollback') &&
  report.finalVersionState && report.baseClient && report.upgradeClient, 'Finish the original operator lifecycle before its fresh-process reopening.');
const attempt = { id: mode + '-' + String(report.attempts.length + 1).padStart(4, '0'),
  mode, pid: process.pid, node: process.version, startedAt: now() };
report.attempts.push(attempt); delete report.error;
const save = () => atomic(reportPath, json(report));
const completed = name => report.stages.some(stage => stage.name === name);
async function stage(name, value) {
  if (!completed(name)) report.stages.push({ name, completedAt: now(), ...value });
  await save();
}
async function artifact(name, raw) {
  const record = await retain(join(root, name), Buffer.isBuffer(raw) ? raw : json(raw));
  const previous = report.artifacts.find(item => item.path === name);
  if (previous) assert.deepEqual(previous, record); else report.artifacts.push(record);
  return record;
}
function nativeField(source, path) {
  if (source && Object.hasOwn(source, path)) return source[path];
  return path.split('.').reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, source);
}
function chooseProjection(editions) {
  const fields = editions[0].result.fields.filter(name => editions.every(value => value.result.fields.includes(name)));
  const used = new Set(['rank','document_index','document_id','score_json','source_json','sort_json','exact_integer_paths_json']);
  return fields.slice(0, 32).map((field, index) => {
    let name = field.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 42);
    if (!/^[A-Za-z]/.test(name) || used.has(name)) name = 'field_' + (index + 1);
    while (used.has(name)) name += '_';
    used.add(name);
    const values = editions.flatMap(edition => edition.result.hits.map(hit => nativeField(hit._source, field)));
    const present = values.filter(value => value !== null && value !== undefined);
    const nullable = present.length !== values.length;
    if (present.length && present.every(value => typeof value === 'string')) return { field, name, type: 'string', nullable };
    if (present.length && present.every(value => typeof value === 'boolean')) return { field, name, type: 'boolean', nullable };
    if (present.length && present.every(value => Number.isSafeInteger(value))) return { field, name, type: 'integer', nullable };
    if (present.length && present.every(value => typeof value === 'number' && Number.isFinite(value))) return { field, name, type: 'number', nullable };
    return { field, name, type: 'string', encoding: 'json', nullable: false };
  });
}
let store, app;
async function request(path, value) {
  const response = await fetch(app.workspace.origin + path, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + app.workspace.token,
      ...(value === undefined ? {} : { 'content-type': 'application/json', origin: app.workspace.origin }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); return body;
}
async function queryAll(label, prepared, original) {
  const query = new URLSearchParams({ snapshot: prepared.description.snapshot,
    fields: 'rank,document_index,document_id,source_json,sort_json,exact_integer_paths_json', limit: '2' });
  const pages = [], rows = [];
  do {
    const page = await request('/api/query', { query: query.toString() });
    assert.equal(page.mode, 'LOCAL_OPERATOR_PREVIEW'); assert.equal(page.snapshot, prepared.description.snapshot);
    assert.equal(page.result.dataset.snapshot, prepared.description.snapshot);
    assert.equal(page.result.page.total, original.result.hits.length);
    rows.push(...page.result.rows); pages.push(page);
    if (!page.result.page.nextCursor) break;
    assert.ok(pages.length <= original.result.hits.length + 1, 'Native continuation must make progress.');
    query.set('cursor', page.result.page.nextCursor);
  } while (true);
  assert.deepEqual(rows.map(row => [row.document_index, row.document_id]), original.result.hits.map(hit => [hit._index, hit._id]));
  rows.forEach((row, index) => {
    assert.equal(row.rank, index + 1);
    assert.deepEqual(JSON.parse(row.source_json), original.result.hits[index]._source ?? null);
    assert.deepEqual(JSON.parse(row.sort_json), original.result.hits[index].sort ?? []);
    assert.deepEqual(JSON.parse(row.exact_integer_paths_json), original.result.hits[index].exactIntegerPaths ?? []);
  });
  await artifact('queries/' + attempt.id + '/' + label + '.json', { snapshot: prepared.description.snapshot,
    originalResultSha256: original.resultSha256, pages, rows });
  return { rows: rows.length, pages: pages.length, snapshot: prepared.description.snapshot };
}
async function exportClient(label, prepared, payment) {
  const directory = join(root, 'clients', label), exportId = 'captured-flights-' + label;
  const exported = await app.exportClient({ directory, exportId });
  const inspected = await inspectSellerClientExport({ directory, exportId });
  assert.equal(inspected.state, 'COMPLETE');
  const sdk = await import(pathToFileURL(join(directory, 'seller-client.mjs')));
  const id = inspected.operations[0].id;
  const built = sdk.buildRequest(id, { query: { snapshot: prepared.description.snapshot, fields: 'rank,document_id', limit: '2' } },
    { intentId: 'captured-flight-' + label, acceptIndex: 0, maxAtomic: payment.amount });
  assert.equal(built.method, 'GET');
  const url = new URL(built.url); assert.equal(url.searchParams.get('snapshot'), prepared.description.snapshot);
  assert.equal(url.origin, inspected.origin);
  const recipe = { method: built.method, url: built.url, datasetSnapshot: prepared.description.snapshot,
    resultSha256: prepared.captured.resultSha256, sourceOpenApiSha256: inspected.sourceSha256,
    constructedLocally: true };
  await artifact('clients/' + label + '-request.json', recipe);
  return { exportId, snapshot: prepared.description.snapshot, originalResultSha256: prepared.captured.resultSha256,
    manifestSha256: inspected.manifestFile.sha256, filesSha256: inspected.filesSha256,
    sourceOpenApiSha256: inspected.sourceSha256, files: inspected.files, recipe };
}
try {
  await save();
  store = await openWorkspaceStore(resolve(args.get('--workspace')), selection.sourceProfileSha256);
  assert.equal(store.id, selection.workspaceId);
  const base = store.edition(selection.baseEditionId, true);
  assert.equal(base.resultSha256, selection.baseResultSha256);
  assert.equal(base.result.hits.length, 7); assert.equal(base.result.pages, 3); assert.equal(base.result.snapshotReleased, true);
  const operation = store.operation(selection.upgradeCaptureRequestId);
  assert.equal(operation.state, 'COMPLETE');
  const upgrade = store.edition(operation.result.editionId, true);
  assert.equal(upgrade.result.hits.length, 6); assert.equal(upgrade.result.pages, 4); assert.equal(upgrade.result.snapshotReleased, true);
  const plan = JSON.parse(await readFile(args.get('--plan')));
  assert.equal(plan.schema, 'stellar-forge.opensearch-merchant-plan.v1');
  const projection = chooseProjection([base, upgrade]), filter = projection.find(item => item.type === 'string' && !item.encoding);
  const projectOptions = { projection, filters: ['document_index','document_id', ...(filter ? [filter.name] : [])],
    ranges: ['rank'], sorts: ['rank'] };
  await artifact('projection.json', projectOptions);
  const common = { store, versionDirectory, payment: plan.payment, origin: plan.publicOrigin,
    path: '/captured-flight-results', ...projectOptions };
  const baseline = await prepareCapturedDataset({ ...common, editionId: base.id, directory: join(root, 'editions', 'seven-result') });
  const next = await prepareCapturedDataset({ ...common, editionId: upgrade.id, directory: join(root, 'editions', 'six-result') });
  assert.equal(baseline.description.rowCount, 7); assert.equal(next.description.rowCount, 6);
  assert.notEqual(baseline.description.snapshot, next.description.snapshot);
  assert.equal(baseline.binding.contractSha256, next.binding.contractSha256);
  assert.deepEqual(baseline.retained['seller.json'], next.retained['seller.json']);
  assert.equal(hash(await readFile(join(baseline.directory, 'capture/result.json'))), base.resultSha256);
  assert.equal(hash(await readFile(join(next.directory, 'capture/result.json'))), upgrade.resultSha256);
  report.captures = [baseline, next].map(item => ({ editionId: item.captured.editionId,
    resultSha256: item.captured.resultSha256, datasetSnapshot: item.description.snapshot,
    rows: item.description.rowCount, sourceFiles: item.sourceFiles }));
  store.close(); store = null;
  await stage('source-and-native-projection', { captures: report.captures, projectionColumns: projection.length });
  app = await startCapturedDataset({ directory: baseline.directory, releaseDirectory: join(root, 'release'), port: 0, workspacePort: 0 });
  for (const asset of ['/', '/workspace.js']) {
    const response = await fetch(app.workspace.origin + asset, { redirect: 'error' });
    assert.equal(response.status, 200); const raw = Buffer.from(await response.arrayBuffer()); assert.ok(raw.length > 1000);
    if (mode === 'operate') await artifact('operator/' + (asset === '/' ? 'index.html' : 'workspace.js'), raw);
  }
  const schema = await request('/api/schema'); assert.equal(schema.source, 'service'); assert.equal(schema.publicSnapshotSelection, true);
  const current = await app.status();
  const basePage = await queryAll('seven-result', baseline, base);
  const challenge = await fetch(app.url + '/captured-flight-results?limit=2', { redirect: 'error' });
  assert.equal(challenge.status, 402); await challenge.arrayBuffer();
  if (mode === 'operate') {
    await stage('original-operator-and-seller', { mode: app.session.mode, query: basePage, httpStatus: challenge.status });
    report.baseClient = await exportClient('seven-result', baseline, plan.payment);
    await stage('first-customer-client', report.baseClient);
    if (!completed('published-six-result-capture')) {
      const before = await app.status();
      if (before.current !== next.description.snapshot) {
        assert.equal(before.current, baseline.description.snapshot);
        const published = await app.publish({ directory: next.directory, expectedSnapshot: before.current, expectedRevision: before.revision });
        assert.equal(published.versions.current, next.description.snapshot);
        await stage('published-six-result-capture', { snapshot: published.versions.current, revision: published.versions.revision });
      } else await stage('published-six-result-capture', { snapshot: before.current, revision: before.revision, recoveredCurrent: true });
    }
    const sixPage = await queryAll('six-result', next, upgrade); assert.equal(sixPage.pages, 3);
    const ordered = await request('/api/query', { query: new URLSearchParams({ snapshot: next.description.snapshot,
      fields: 'rank,document_id', gte_rank: '2', sort: '-rank', limit: '10' }).toString() });
    assert.deepEqual(ordered.result.rows.map(row => row.rank), [6,5,4,3,2]);
    await artifact('queries/' + attempt.id + '/six-result-range-order.json', ordered);
    report.upgradeClient = await exportClient('six-result', next, plan.payment);
    await stage('upgraded-query-and-client', { query: sixPage, client: report.upgradeClient });
    const before = await app.status();
    if (before.current !== baseline.description.snapshot) {
      const response = await request('/api/activate', { snapshot: baseline.description.snapshot,
        expectedSnapshot: before.current, expectedRevision: before.revision });
      assert.equal(response.activation.current, baseline.description.snapshot);
    }
    const reverted = await app.status();
    assert.equal(reverted.current, baseline.description.snapshot);
    const rollback = await queryAll('rollback-seven-result', baseline, base);
    report.finalVersionState = { revision: reverted.revision, current: reverted.current,
      versions: reverted.versions.map(item => ({ snapshot: item.snapshot, rowCount: item.rowCount })) };
    await stage('operator-rollback', { query: rollback, versions: report.finalVersionState });
    await app.close(); app = null; network.closeIdleConnections();
    report.state = 'OPERATIONS_COMPLETE';
  } else {
    assert.equal(current.current, baseline.description.snapshot);
    assert.equal(current.revision, report.finalVersionState.revision);
    const six = await queryAll('six-result', next, upgrade); assert.equal(six.rows, 6);
    for (const [label, expected] of [['seven-result', report.baseClient], ['six-result', report.upgradeClient]]) {
      const actual = await inspectSellerClientExport({ directory: join(root, 'clients', label), exportId: expected.exportId });
      assert.equal(actual.state, 'COMPLETE'); assert.equal(actual.manifestFile.sha256, expected.manifestSha256);
      assert.equal(actual.filesSha256, expected.filesSha256);
    }
    for (const value of report.artifacts) {
      const raw = await readFile(join(root, value.path)); assert.equal(raw.length, value.bytes); assert.equal(hash(raw), value.sha256);
    }
    await app.close(); app = null; network.closeIdleConnections();
    await stage('fresh-process-reopen', { baseRows: basePage.rows, upgradeRows: six.rows,
      revision: current.revision, current: current.current, previousAttempts: report.attempts.length - 1 });
    report.state = 'COMPLETE'; report.completedAt = now();
  }
  attempt.network = network.snapshot();
  assert.deepEqual(attempt.network.deniedAttempts, []);
  assert.deepEqual(attempt.network.activeOrigins, []);
  assert.ok(attempt.network.datasetLeaseCalls >= 2);
  attempt.completedAt = now(); await save();
  process.stdout.write(JSON.stringify({ state: report.state, captures: report.captures,
    stages: report.stages.length, report: reportPath }) + '\n');
} catch (error) {
  attempt.error = { code: error.code ?? error.name, message: error.message }; attempt.endedAt = now();
  report.error = attempt.error; report.state = 'FAILED'; await save();
  process.stderr.write(JSON.stringify(attempt.error) + '\n'); process.exitCode = 1;
} finally {
  store?.close(); if (app) await app.close().catch(error => { report.closeError = error.message; process.exitCode = 1; });
  network.closeIdleConnections(); attempt.network = network.snapshot(); await save();
}
