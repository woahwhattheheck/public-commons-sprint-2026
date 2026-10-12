// MIT. Original SAP source editions through the installed catalog, seller preparation and customer receiving.
import assert from 'node:assert/strict';
import { readFile, mkdir, open, lstat, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenSearchWorkspace } from '../workspace/service.mjs';
import { hashCatalogFile } from '../catalog/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
async function originalFile(path, text) {
  try { const file = await open(path, 'wx', 0o600); try { await file.writeFile(text); await file.sync(); } finally { await file.close(); } }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== text) throw error; }
}
async function operation(workspace, id, action) {
  let prior;
  try { prior = workspace.operation(id); } catch (error) { if (error.code !== 'WORKSPACE_OPERATION_NOT_FOUND') throw error; }
  const value = prior ?? await action(id);
  if (value.state !== 'COMPLETE') throw Object.assign(new Error('Original catalog operation ' + id + ': ' + (value.error?.message ?? value.state)), { code: value.error?.code ?? 'CATALOG_NATIVE_OPERATION_INCOMPLETE', operation: value });
  return value.result;
}
async function output(path, descriptor) {
  try {
    await lstat(path);
    return { name: path.split('/').at(-1), ...(await hashCatalogFile(path)), retained: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.writing-' + process.pid;
  const file = await open(temporary, 'wx', 0o600), checksum = createHash('sha256'); let bytes = 0, complete = false;
  try {
    const values = typeof descriptor.body === 'string' || Buffer.isBuffer(descriptor.body) ? [descriptor.body] : descriptor.body;
    for await (const value of values) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      checksum.update(buffer); bytes += buffer.length; await file.writeFile(buffer);
    }
    await file.sync(); complete = true;
  } finally { await file.close(); if (!complete) await unlink(temporary).catch(() => {}); }
  try { await link(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
  return { name: path.split('/').at(-1), bytes, sha256: checksum.digest('hex'), type: descriptor.type };
}
export async function runMaterialCatalogJourney({ directory, inputsDirectory = join(HERE, '../examples/material-catalog'), operationId = 'datax-sap-catalog-2769' } = {}) {
  if (!directory || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId)) throw new TypeError('Supply a private native directory and stable operation ID.');
  directory = resolve(directory); inputsDirectory = resolve(inputsDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'exports'), { recursive: true, mode: 0o700 });
  const sourceFile = join(directory, 'source.json'), planFile = join(directory, 'plan.json');
  const sourceConfig = { schema: 'stellar-forge.opensearch-source.v1', endpointEnv: 'DATAX_OPENSEARCH_ENDPOINT',
    auth: { type: 'none' }, allowLocal: true, maxInFlight: 1, queries: { catalog_bootstrap: {
      indices: ['material_catalog_native'], query: { match_all: {} }, parameters: {}, fields: ['material_id'],
      sort: [], pageSize: 100, maxHits: 1000, maxBytes: 917504, timeoutMs: 15000, probe: {} } } };
  const plan = { schema: 'stellar-forge.opensearch-merchant-plan.v1', publicOrigin: 'https://search.example.com',
    payment: { scheme: 'exact', network: 'stellar:testnet', amount: '10000',
      asset: 'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ',
      payTo: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H', maxTimeoutSeconds: 60 }, routes: [] };
  await originalFile(sourceFile, JSON.stringify(sourceConfig, null, 2) + '\n');
  await originalFile(planFile, JSON.stringify(plan, null, 2) + '\n');
  const config = { sourceFile, planFile, env: { ...process.env, DATAX_OPENSEARCH_ENDPOINT: process.env.DATAX_OPENSEARCH_ENDPOINT ?? 'http://127.0.0.1:9200' } };
  const startedAt = new Date().toISOString(), inputs = {};
  for (const name of ['sap-shine-sps11.csv','sap-shine-sps12.csv','mapping-sap-shine.json']) inputs[name] = await hashCatalogFile(join(inputsDirectory, name));
  const expectedInputs = {
    'sap-shine-sps11.csv': 'b241556799b4aad46455e856cef293f50e21eb7b',
    'sap-shine-sps12.csv': 'e4ad3f0f11da4931879af9a97089b3ec1956d338',
    'mapping-sap-shine.json': 'dc620949461f7eedc903dc2f813e73b493ccac62'
  };
  for (const [name, expected] of Object.entries(expectedInputs)) {
    const bytes = await readFile(join(inputsDirectory, name));
    const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(actual, expected, name + ' original Git bytes'); inputs[name].gitBlob = actual;
  }
  const phases = [], exports = []; let producer, receiver;
  const record = (phase, value) => { phases.push({ phase, ...value }); };
  const openWorkspace = async name => {
    const workspace = await createOpenSearchWorkspace({ ...config, directory: join(directory, name) });
    workspace.store.db.exec('PRAGMA wal_autocheckpoint=100;');
    return workspace;
  };
  try {
    producer = await openWorkspace('producer');
    const mapping = JSON.parse(await readFile(join(inputsDirectory, 'mapping-sap-shine.json'), 'utf8'));
    const saved = await operation(producer, operationId + '-save', requestId => producer.catalog.save({
      requestId, title: 'SAP SHINE material operations', tenantId: 'sap-shine-internal', mapping }));
    const catalogId = saved.catalog.id;
    const upload = async (name, suffix, revision) => operation(producer, operationId + suffix, requestId => producer.catalog.upload({
      requestId, name, format: { kind: 'csv' }, bytes: inputs[name].bytes, sha256: inputs[name].sha256,
      provenance: { publisher: 'SAP-samples/hana-shine-xsa', revision, kind: 'source-derived-text-join',
        url: 'https://github.com/SAP-samples/hana-shine-xsa',
        note: 'All original product columns plus exact original English NAME and DESCRIPTION values; original source identities retained in SOURCE-INDEX.json.' }
    }, createReadStream(join(inputsDirectory, name))));
    const firstSource = await upload('sap-shine-sps11.csv','-source-11','c8ef4bef064bc4b22e777e01ad5e469d070652f8');
    const first = await operation(producer, operationId + '-preview-11', requestId => producer.catalog.preview({
      requestId, catalogId, expectedRevision: saved.catalog.revision, sourceId: firstSource.source.id, mode: 'full', baseEditionId: null }));
    assert.equal(first.edition.counts.total, 106); assert.equal(first.edition.counts.added, 106); assert.equal(first.edition.counts.missingUnit, 0);
    const selectedFirst = await operation(producer, operationId + '-select-11', requestId => producer.catalog.select({
      requestId, catalogId, expectedRevision: saved.catalog.revision, editionId: first.edition.id, reviewSha256: first.edition.reviewSha256 }));
    const original = producer.catalog.materials({ editionId: first.edition.id, search: 'HT-1000' }).rows.find(row => row.materialId === 'HT-1000');
    assert.ok(original); assert.equal(original.unit, 'EA'); assert.equal(original.attributes.supplier, '0100000000');
    const initialDecision = await operation(producer, operationId + '-approve-11', requestId => producer.catalog.saveDecision({
      requestId, catalogId, expectedCatalogRevision: selectedFirst.catalog.revision, customerId: 'internal-procurement',
      description: original.title, materialKey: original.key, expectedMaterialSha256: original.sha256,
      status: 'APPROVED', note: 'Reviewed against the complete original SPS11 material record.' }));
    record('original-catalog-and-customer-match', { catalogId, editionId: first.edition.id, counts: first.edition.counts,
      materialId: original.materialId, supplier: original.attributes.supplier, decisionId: initialDecision.decision.id });
    const secondSource = await upload('sap-shine-sps12.csv','-source-12','db85d866c2189d124184a3e0cc8802bd1f177f36');
    const second = await operation(producer, operationId + '-preview-12', requestId => producer.catalog.preview({
      requestId, catalogId, expectedRevision: selectedFirst.catalog.revision, sourceId: secondSource.source.id,
      mode: 'full', baseEditionId: first.edition.id }));
    assert.deepEqual(second.edition.counts, { added: 0, removed: 0, changed: 106, unchanged: 0, total: 106, missingUnit: 0 });
    const changes = producer.catalog.changes({ editionId: second.edition.id, limit: 500 });
    assert.equal(changes.rows.length, 106);
    for (const row of changes.rows) {
      assert.deepEqual(row.fields, ['attributes']);
      const before = { ...row.before.attributes }, after = { ...row.after.attributes };
      assert.notEqual(before.supplier, after.supplier); delete before.supplier; delete after.supplier;
      assert.deepEqual(before, after);
    }
    const selectedSecond = await operation(producer, operationId + '-select-12', requestId => producer.catalog.select({
      requestId, catalogId, expectedRevision: selectedFirst.catalog.revision, editionId: second.edition.id, reviewSha256: second.edition.reviewSha256 }));
    const oldDecision = producer.catalog.decisions({ catalogId }).rows.find(row => row.id === initialDecision.decision.id);
    // A continued completed journey may already contain the subsequent reapproval.
    if (oldDecision.revision === 1) assert.equal(oldDecision.currentStatus, 'NEEDS_REVIEW');
    const current = producer.catalog.material(second.edition.id, original.key);
    assert.equal(current.materialId, original.materialId); assert.equal(current.attributes.supplier, '100000000');
    const approved = await operation(producer, operationId + '-approve-12', requestId => producer.catalog.saveDecision({
      requestId, catalogId, expectedCatalogRevision: selectedSecond.catalog.revision, customerId: initialDecision.decision.customerId,
      description: initialDecision.decision.description, materialKey: current.key, expectedMaterialSha256: current.sha256,
      decisionId: initialDecision.decision.id, expectedRevision: initialDecision.decision.revision,
      status: 'APPROVED', note: 'Reviewed supplier-field change in the original SPS12 edition.' }));
    record('real-source-delta-and-reapproval', { editionId: second.edition.id, counts: second.edition.counts,
      changedFields: ['attributes.supplier'], decisionRevision: approved.decision.revision });
    const quantity = producer.catalog.quantity({ catalogId, materialKey: current.key, expectedMaterialSha256: current.sha256, quantity: '12.500', unit: 'EA' });
    assert.deepEqual(quantity.quantity.baseQuantity, { numerator: '25', denominator: '2', decimal: '12.5' });
    assert.equal(producer.catalog.suggest({ catalogId, text: '', limit: 10 }).candidates.length, 10);
    assert.equal(producer.catalog.suggest({ catalogId, text: current.materialId }).candidates[0].reason, 'exact-identifier');
    const remembered = producer.catalog.suggest({ catalogId, text: current.title, customerId: 'internal-procurement' });
    assert.equal(remembered.approved.currentStatus, 'APPROVED');
    const facets = producer.catalog.facets({ catalogId });
    assert.equal(facets.facets.unit.find(row => row.value === 'EA').count, 106);
    const filtered = producer.catalog.suggest({ catalogId, text: '', category: current.category, limit: 500 });
    assert.ok(filtered.candidates.every(row => row.material.category === current.category));
    record('catalog-lookup-facets-and-exact-quantity', { returned: remembered.candidates.length, facets, quantity });
    for (const variant of ['baseline','identifiers']) {
      const draft = await operation(producer, operationId + '-draft-' + variant, requestId => producer.catalog.createDraft({
        requestId, catalogId, expectedRevision: selectedSecond.catalog.revision, index: 'material_catalog_native', variant }));
      const validated = producer.validate(draft.draft.id, draft.draft.revision);
      assert.equal(validated.source.queries.material_search.query.bool.filter[0].term.tenant_id, 'sap-shine-internal');
      const prepared = await operation(producer, operationId + '-prepare-' + variant, requestId => producer.run('prepare', {
        requestId, draftId: draft.draft.id, expectedRevision: draft.draft.revision }));
      const client = await producer.downloadPackage(prepared.package.id, 'client/seller-client.mjs');
      assert.ok(client.body.length > 1000);
      record('original-seller-preparation-' + variant, { draftId: draft.draft.id, packageId: prepared.package.id,
        sourceSha256: validated.sourceSha256, originalClientSha256: hash(client.body), files: prepared.package.files.length });
    }
    for (const format of ['catalog.csv','catalog.jsonl','approved-matches.csv','index.json','bulk.ndjson','delta.ndjson','facets.json','source.json','search-client.ts','catalog-bundle.jsonl'])
      exports.push(await output(join(directory, 'exports', format), producer.catalog.export(catalogId, format, { index: 'material_catalog_native' })));
    const bundle = exports.find(row => row.name === 'catalog-bundle.jsonl');
    const producerWorkspaceId = producer.store.id;
    await producer.close(); producer = null;
    producer = await openWorkspace('producer');
    assert.equal(producer.store.id, producerWorkspaceId);
    assert.equal(producer.catalog.catalog(catalogId).activeEditionId, second.edition.id);
    record('producer-close-and-reopen', { workspaceId: producerWorkspaceId, selectedEditionId: second.edition.id });
    receiver = await openWorkspace('receiver');
    const received = await operation(receiver, operationId + '-receive', requestId => receiver.catalog.importBundle({
      requestId, name: 'catalog-bundle.jsonl', bytes: bundle.bytes, sha256: bundle.sha256
    }, createReadStream(join(directory, 'exports', 'catalog-bundle.jsonl'))));
    assert.equal(received.catalog.id, catalogId);
    assert.equal(receiver.catalog.materials({ editionId: second.edition.id, limit: 1 }).total, 106);
    assert.equal(receiver.catalog.decisions({ catalogId }).rows[0].currentStatus, 'APPROVED');
    assert.equal((await receiver.catalog.retainedSource(firstSource.source.id)).sha256, firstSource.source.sha256);
    const later = await operation(receiver, operationId + '-local-work', requestId => receiver.catalog.save({
      requestId, catalogId, expectedRevision: received.catalog.revision, tenantId: received.catalog.tenantId,
      title: 'Received SAP material operations', mapping: received.catalog.mapping }));
    const laterDecision = await operation(receiver, operationId + '-local-review', requestId => receiver.catalog.saveDecision({
      requestId, catalogId, expectedCatalogRevision: later.catalog.revision, customerId: approved.decision.customerId,
      description: approved.decision.description, materialKey: current.key, expectedMaterialSha256: current.sha256,
      decisionId: approved.decision.id, expectedRevision: approved.decision.revision, status: 'APPROVED',
      note: 'Customer receiving review completed from the retained original source history.' }));
    await operation(receiver, operationId + '-receive-again', requestId => receiver.catalog.importBundle({
      requestId, name: 'catalog-bundle.jsonl', bytes: bundle.bytes, sha256: bundle.sha256
    }, createReadStream(join(directory, 'exports', 'catalog-bundle.jsonl'))));
    assert.equal(receiver.catalog.catalog(catalogId).revision, later.catalog.revision);
    assert.equal(receiver.catalog.decisions({ catalogId }).rows[0].revision, laterDecision.decision.revision);
    const receiverWorkspaceId = receiver.store.id;
    await receiver.close(); receiver = null;
    receiver = await openWorkspace('receiver');
    assert.equal(receiver.store.id, receiverWorkspaceId);
    assert.equal(receiver.catalog.catalog(catalogId).revision, later.catalog.revision);
    assert.equal(receiver.catalog.decisions({ catalogId }).rows[0].revision, laterDecision.decision.revision);
    record('customer-receiving-later-work-replay-and-reopen', { workspaceId: receiverWorkspaceId,
      originalCatalogId: catalogId, receivedRevision: received.catalog.revision, retainedCatalogRevision: later.catalog.revision,
      retainedDecisionRevision: laterDecision.decision.revision, materialCount: 106, bundle });
    await producer.close(); producer = null; await receiver.close(); receiver = null;
    const report = { schema: 'stellar-forge.material-catalog-native-journey.v1', operationId, startedAt,
      completedAt: new Date().toISOString(), runtime: process.version, state: 'COMPLETE', inputs, phases, exports,
      lifetimes: 'CLOSED' };
    await originalFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { if (producer) await producer.close(); if (receiver) await receiver.close(); }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node material-catalog-journey.mjs --directory PRIVATE_NATIVE_DIR [--inputs SOURCE_INPUT_DIR] [--operation-id STABLE_ID]\n'); return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--directory','--inputs','--operation-id'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new TypeError('Use --help.');
    options[args[i]] = args[i + 1];
  }
  const report = await runMaterialCatalogJourney({ directory: options['--directory'], inputsDirectory: options['--inputs'], operationId: options['--operation-id'] });
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ code: error.code, message: error.message, stack: error.stack, operation: error.operation }) + '\n'); process.exitCode = 1;
});
