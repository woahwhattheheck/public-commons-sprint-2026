#!/usr/bin/env node
// MIT. Complete original Huwise capture and customer receiving through the merchant host.
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { initializeOpendatasoftWorkspaceMerchant } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openOpendatasoftClient, downloadOpendatasoftExport, reopenOpendatasoftExport } from '../opendatasoft-client.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' &&
      ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
    throw failure('RECEIVING_DIRECTORY', 'Select an owned private operation directory.');
}
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
async function save(path, value) {
  const temporary = path + '.next';
  await writeFile(temporary, json(value), { mode: 0o600 });
  await rename(temporary, path);
}
function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i], value = argv[i + 1];
    if (!['--directory', '--project', '--origin', '--dataset', '--export', '--source-ref'].includes(name) ||
        !value || value.startsWith('--') || Object.hasOwn(result, name))
      throw failure('RECEIVING_ARGUMENTS', 'Use --directory PRIVATE_DIRECTORY and optional --project, --origin, --dataset, --export, --source-ref.');
    result[name] = value;
  }
  if (!result['--directory']) throw failure('RECEIVING_ARGUMENTS', 'Supply --directory PRIVATE_DIRECTORY.');
  if (result['--source-ref'] && !/^[a-f0-9]{40}$/.test(result['--source-ref'])) throw failure('RECEIVING_ARGUMENTS', 'Supply a complete source commit.');
  return result;
}
async function sourceFiles() {
  const root = new URL('../', import.meta.url);
  const paths = ['config.mjs','catalog.mjs','providers.mjs','operator.mjs','serve.mjs','instructions.mjs',
    'catalog/opendatasoft-workspace.mjs','opendatasoft-workspace.mjs','opendatasoft-files.mjs',
    'opendatasoft-client.mjs','retained-download.mjs','retained-source-files.mjs','retained-file-reads.mjs',
    'examples/opendatasoft-receiving.mjs',
    '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/engine.mjs',
    '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/capture.mjs',
    '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/workspace/server.mjs'];
  return Promise.all(paths.map(async path => { const bytes = await readFile(new URL(path, root)); return { path, bytes: bytes.length, sha256: sha(bytes) }; }));
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Complete original Huwise receiving\n\nnode opendatasoft-receiving.mjs --directory PRIVATE_DIRECTORY [--project EXISTING_WORKBENCH] [--origin https://public.opendatasoft.com] [--dataset open-data-sources] [--export huwise-agent-delivery] [--source-ref COMMIT]\n\nA new project captures the complete live public dataset through the native engine. An existing project reuses its original complete edition and selected merchant/buyer files. Keep the same directory to resume the same receiving operation.\n');
    return;
  }
  const args = options(argv), root = resolve(args['--directory']), workspace = 'portals';
  await privateDirectory(root);
  const lease = await acquireStateLease(root), recordPath = join(root, 'native-receiving.json');
  let host;
  try {
    const project = resolve(args['--project'] ?? join(root, 'project'));
    const input = { project, origin: args['--origin'] ?? 'https://public.opendatasoft.com',
      datasetId: args['--dataset'] ?? 'open-data-sources', exportId: args['--export'] ?? 'huwise-agent-delivery' };
    let record = await optionalJson(recordPath);
    if (record && JSON.stringify(record.input) !== JSON.stringify(input))
      throw failure('RECEIVING_INPUT_CHANGED', 'Continue this original receiving directory with its original project and dataset.');
    record ??= { schema: 'stellar-forge.opendatasoft-native-receiving.v1', input, startedAt: new Date().toISOString(), phases: [] };
    const phase = async (name, value) => {
      lease.assertHeld(); record.phases.push({ name, at: new Date().toISOString(), ...value });
      await save(recordPath, record); process.stdout.write(json({ phase: name, ...value }));
    };
    record.source = { declaredRef: args['--source-ref'] ?? null, files: await sourceFiles() };
    const receiving = join(root, 'received');
    if (record.state === 'COMPLETE') {
      const reopened = await reopenOpendatasoftExport({ directory: receiving, exportId: input.exportId,
        expectedManifestSha256: record.manifestSha256 });
      process.stdout.write(json({ state: 'REOPENED', originalCompletedAt: record.completedAt, ...reopened }));
      return record;
    }
    await privateDirectory(project);
    const connection = join(root, 'connection.json'), connectionValue = {
      schema: 'stellar-forge.opendatasoft-workspace-connection.v1',
      workspaces: { [workspace]: { label: 'Huwise portal data', directory: project, origin: input.origin,
        create: !args['--project'], imports: {}, merchants: {}, sellers: {} } }
    };
    const originalConnection = await optionalJson(connection);
    if (originalConnection && JSON.stringify(originalConnection) !== JSON.stringify(connectionValue))
      throw failure('RECEIVING_CONNECTION_CHANGED', 'Use the original host connection.');
    if (!originalConnection) await save(connection, connectionValue);
    const merchant = join(root, 'merchant'), configPath = join(merchant, 'merchant-mcp.json');
    if (!await optionalJson(configPath)) await initializeOpendatasoftWorkspaceMerchant({ directory: merchant, connection });
    const environment = { ...process.env, MCP_ACCESS_TOKEN: randomBytes(32).toString('hex') };
    host = await startMerchantMcp({ configPath, port: 0, environment });
    const client = await openOpendatasoftClient({ url: host.url, environment });
    const opens = await Promise.all([1,2,3].map(() => client.open({ workspace, browser: true })));
    if (new Set(opens.map(value => value.browser.url)).size !== 1 ||
        new Set(opens.map(value => value.instanceId)).size !== 1)
      throw failure('RECEIVING_OWNERSHIP', 'Concurrent opens did not share the same original workbench and browser.');
    await phase('original_host_open', { instanceId: opens[0].instanceId, sharedBrowserOpens: opens.length });
    let status = await client.status({ workspace, limit: 100 });
    const editions = [...status.native.editions], histories = {
      sources: [...status.native.sources], publications: [...status.native.publications],
      exports: [...status.native.exports], buyerRequests: [...status.native.buyerRequests]
    };
    for (let offset = 100; Object.values(status.native.pages).some(page => page.nextOffset !== null); offset += 100) {
      status = await client.status({ workspace, offset, limit: 100 });
      editions.push(...status.native.editions);
      for (const key of Object.keys(histories)) histories[key].push(...status.native[key]);
    }
    let selected = record.editionId ? editions.find(value => value.id === record.editionId) :
      editions.filter(value => value.datasetId === input.datasetId && value.state === 'COMPLETE').at(-1);
    if (!selected) selected = editions.filter(value => value.datasetId === input.datasetId).at(-1);
    const complete = async started => {
      const done = await client.awaitOperation({ workspace, operationId: started.operationId }, { timeoutMs: 3600000 });
      if (done.operation.state !== 'COMPLETE')
        throw failure(done.operation.error?.code ?? 'RECEIVING_OPERATION', done.operation.error?.message ?? 'Continue the retained native operation.');
      return done.operation;
    };
    if (!selected || selected.state !== 'COMPLETE') {
      const started = selected ? await client.resume({ workspace, editionId: selected.id }) :
        await client.capture({ workspace, selection: { datasetId: input.datasetId } });
      record.editionId = selected?.id ?? started.editionId;
      await phase('original_capture_started', { editionId: record.editionId, operationId: started.operationId });
      await complete(started);
    } else record.editionId = selected.id;
    let edition = await client.edition({ workspace, editionId: record.editionId }), rows = 0, pages = 0;
    for (let offset = 0; offset !== null;) {
      const page = await client.rows({ workspace, editionId: edition.id, offset, limit: 500 });
      rows += page.records.length; pages++; offset = page.page.next;
    }
    if (rows !== edition.rowCount) throw failure('RECEIVING_ROWS', 'The complete native row pages differ from the retained capture.');
    await phase('complete_source_reviewed', { editionId: edition.id, datasetId: edition.datasetId,
      rowCount: rows, pages, captureSha256: edition.manifestSha256, notesRevision: edition.notes.revision });
    if (!record.exportRequest) {
      const source = histories.sources.filter(value => value.editionId === edition.id).at(-1);
      const publications = new Set(histories.publications.filter(value => histories.sources.some(s => s.id === value.sourceId && s.editionId === edition.id)).map(value => value.id));
      const merchantExport = histories.exports.filter(value => publications.has(value.publicationId)).at(-1);
      const buyer = merchantExport && histories.buyerRequests.filter(value => value.exportId === merchantExport.id).at(-1);
      const geometry = edition.fields.find(value => ['geo_point_2d','geo_shape'].includes(value.type));
      record.exportRequest = { workspace, exportId: input.exportId, editionId: edition.id,
        expectedCaptureSha256: edition.manifestSha256, expectedNotesRevision: edition.notes.revision,
        ...(geometry ? { geometryField: geometry.id } : {}), ...(source ? { sourceId: source.id } : {}),
        ...(merchantExport ? { merchantExportId: merchantExport.id } : {}), ...(buyer ? { buyerRequestId: buyer.id } : {}) };
      await save(recordPath, record);
    }
    const retained = await client.export(record.exportRequest);
    record.manifestSha256 = retained.manifestSha256;
    await phase('complete_native_files_retained', { manifestSha256: retained.manifestSha256,
      files: retained.manifest.files, original: retained.manifest.source });
    if (!args['--project'] && !record.notesReviewed) {
      const marker = 'Merchant client review: all ' + rows + ' original rows were paged and all four analyst formats were retained. Capture ' + edition.manifestSha256 + '.';
      if (!edition.notes.text.includes(marker)) {
        await complete(await client.notes({ workspace, editionId: edition.id,
          expectedCaptureSha256: edition.manifestSha256, expectedRevision: edition.notes.revision,
          text: edition.notes.text ? edition.notes.text + '\n\n' + marker : marker, rowNotes: edition.notes.rowNotes }));
      }
      edition = await client.edition({ workspace, editionId: edition.id });
      record.notesReviewed = true; await phase('analyst_receiving_note_saved', { notesRevision: edition.notes.revision });
    }
    const replay = await client.export(record.exportRequest);
    if (replay.manifestSha256 !== retained.manifestSha256) throw failure('RECEIVING_EXPORT_CHANGED', 'The original completed delivery changed on replay.');
    await privateDirectory(receiving);
    if (!record.interruption) {
      const controller = new AbortController();
      try {
        await downloadOpendatasoftExport({ client, exportId: input.exportId, directory: receiving,
          expectedManifestSha256: retained.manifestSha256, chunkSize: 65536, signal: controller.signal,
          onProgress: event => { if (!controller.signal.aborted) controller.abort(failure('RECEIVING_INTERRUPTED', 'Continue the same durable file checkpoint.')); } });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        record.interruption = { at: new Date().toISOString(), code: error.code ?? error.name };
        await phase('native_file_receiving_interrupted', record.interruption);
      }
    }
    const downloaded = await downloadOpendatasoftExport({ client, exportId: input.exportId, directory: receiving,
      expectedManifestSha256: retained.manifestSha256, chunkSize: 196608 });
    record.download = downloaded; await phase('complete_customer_files_received', downloaded);
    await client.close({ workspace, instanceId: opens[0].instanceId });
    const closedManifest = await client.manifest({ exportId: input.exportId });
    if (closedManifest.manifestSha256 !== retained.manifestSha256) throw failure('RECEIVING_EXPORT_CHANGED', 'Closing the workbench changed its retained delivery.');
    const reopened = await client.open({ workspace });
    const reopenedEdition = await client.edition({ workspace, editionId: edition.id });
    if (reopenedEdition.manifestSha256 !== edition.manifestSha256) throw failure('RECEIVING_SOURCE_CHANGED', 'Reopening changed the original capture.');
    await client.close({ workspace, instanceId: reopened.instanceId });
    await host.close(); host = null;
    record.reopened = await reopenOpendatasoftExport({ directory: receiving, exportId: input.exportId,
      expectedManifestSha256: retained.manifestSha256 });
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await phase('closed_and_reopened_locally', { state: record.state, files: record.reopened.files,
      bytes: record.reopened.bytes, originalCaptureSha256: edition.manifestSha256, manifestSha256: retained.manifestSha256 });
    return record;
  } finally { try { await host?.close(); } finally { await lease.close(); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write((error.code ?? 'OPENDATASOFT_RECEIVING') + ': ' + error.message + '\n'); process.exitCode = 2; });
