#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Continue an existing collection through the original MCP server and customer receiver.
import { randomBytes, createHash } from 'node:crypto';
import { readdir, rename, unlink, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeNativeWorkspace, openNativeWorkspace } from '../native-workspace.mjs';
import { startMcpWorkspace } from '../serve.mjs';
import { openNativeCollectionsClient, inspectNativeCollectionExport,
  downloadNativeCollectionExport, reopenNativeCollectionExport } from '../native-collections-download.mjs';
import { startCollectionsWorkspace } from '../../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/server.mjs';
import { collectionsWorkspaceLaunch } from '../../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/launch.mjs';
import { initializationDirectory, initializationBytes, optionalInitializationBytes,
  retainInitializationRecord, syncInitializationDirectory } from '../../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const SCHEMA = 'stellar-forge.collection-mcp-customer-handoff.v1';
const OPERATION = 'SCF-BUYER-REQUEST-COLLECTIONS-0D0B-20261012';
const WORKSPACE = 'original';
const HASH = /^[a-f0-9]{64}$/;
const FILES = ['collection.json', 'results.json', 'requests.csv', 'review.html', 'manifest.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code :
  error?.name === 'AbortError' ? 'COLLECTION_HANDOFF_INTERRUPTED' : 'COLLECTION_HANDOFF_FAILED';
const HELP = 'Continue an original request collection through the native MCP customer receiver.\n\n' +
  '  node stellar-forge/mcp-paid-agent/examples/collections-handoff.mjs\n' +
  '    --native-workspace ABS_EXISTING_NATIVE_MCP --collections ABS_ORIGINAL_COLLECTION_STORE\n' +
  '    --id ORIGINAL_COLLECTION_ID --out ABS_PRIVATE_RECEIVING_DIRECTORY --source-ref GIT_SHA\n' +
  '    [--collection-sha256 ORIGINAL_COLLECTION_MANIFEST_SHA]\n\n' +
  'The existing native workspace supplies its original buyer and catalog.\n' +
  'The first invocation creates one receiving adapter, starts the original collection browser,\n' +
  'exports the retained collection through MCP, and closes that browser. Receiving then pauses\n' +
  'after a durable first chunk and resumes the same five-file export through the original MCP.\n' +
  'Both services close before the final offline reopen. Repeat the exact command to resume\n' +
  'the same directory; the export ID, MCP endpoint and download checkpoint remain original.\n' +
  'Node 24, Linux and the existing util-linux flock are required.\n';
function argumentsFor(argv) {
  const values = {}, allowed = ['--native-workspace', '--collections', '--id', '--out', '--source-ref', '--collection-sha256'];
  need(argv.length % 2 === 0, 'COLLECTION_HANDOFF_ARGUMENTS_INVALID');
  for (let i = 0; i < argv.length; i += 2) {
    need(allowed.includes(argv[i]) && !Object.hasOwn(values, argv[i]) &&
      typeof argv[i + 1] === 'string' && argv[i + 1] && !argv[i + 1].startsWith('--'),
    'COLLECTION_HANDOFF_ARGUMENTS_INVALID');
    values[argv[i]] = argv[i + 1];
  }
  for (const key of ['--native-workspace', '--collections', '--out'])
    need(typeof values[key] === 'string' && isAbsolute(values[key]) && resolve(values[key]) === values[key] &&
      values[key] !== '/' && !values[key].includes('\0'), 'COLLECTION_HANDOFF_ABSOLUTE_PATH_REQUIRED');
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(values['--id'] ?? '') &&
    /^[a-f0-9]{40}$/.test(values['--source-ref'] ?? '') &&
    (values['--collection-sha256'] === undefined || HASH.test(values['--collection-sha256'])),
  'COLLECTION_HANDOFF_SELECTION_REQUIRED');
  const options = { nativeWorkspace: values['--native-workspace'], collections: values['--collections'],
    id: values['--id'], directory: values['--out'], sourceRef: values['--source-ref'],
    expectedCollectionSha256: values['--collection-sha256'] ?? null };
  for (const original of [options.nativeWorkspace, options.collections])
    need(options.directory !== original && !options.directory.startsWith(original + '/') &&
      !original.startsWith(options.directory + '/'), 'COLLECTION_HANDOFF_DIRECTORY_OVERLAP');
  return options;
}
async function optionalJson(path, maximum = 65536) {
  const bytes = await optionalInitializationBytes(path, maximum);
  return bytes === null ? null : parse(bytes);
}
function sameSelection(record, options) {
  return record?.schema === SCHEMA && record.operation === OPERATION &&
    ['nativeWorkspace', 'collections', 'id', 'directory', 'sourceRef', 'expectedCollectionSha256']
      .every(key => record[key] === options[key]) &&
    /^[a-f0-9]{32}$/.test(record.exportId ?? '');
}

/** One retained local receiving operation; all product effects use maintained modules. */
export async function receiveCollection(options, { signal, environment = process.env } = {}) {
  need(plain(options), 'COLLECTION_HANDOFF_SELECTION_REQUIRED');
  // Apply the same validation to SDK callers as to the command line.
  options = argumentsFor(['--native-workspace', options.nativeWorkspace, '--collections', options.collections,
    '--id', options.id, '--out', options.directory, '--source-ref', options.sourceRef,
    ...(options.expectedCollectionSha256 == null ? [] : ['--collection-sha256', options.expectedCollectionSha256])]);
  signal?.throwIfAborted();
  await initializationDirectory(dirname(options.directory));
  await initializationDirectory(options.directory, { create: true });
  const stateDirectory = join(options.directory, 'run-state');
  const firstNames = await readdir(options.directory);
  const retained = await optionalJson(join(options.directory, 'run.json'));
  need(retained || firstNames.every(name => name === 'run-state'), 'COLLECTION_HANDOFF_DIRECTORY_IN_USE');
  await initializationDirectory(stateDirectory, { create: true });
  const lease = await acquireStateLease(stateDirectory);
  const path = name => join(options.directory, name);
  const read = (name, maximum) => optionalJson(path(name), maximum);
  const save = async (name, value) => {
    lease.assertHeld();
    return retainInitializationRecord(path(name), value, { resume: true });
  };
  const replace = async (name, value) => {
    const temporary = path('.handoff-' + randomBytes(16).toString('hex'));
    lease.assertHeld();
    await retainInitializationRecord(temporary, value);
    try { lease.assertHeld(); await rename(temporary, path(name)); await syncInitializationDirectory(options.directory); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  };
  let original, registration, browser, mcp, phase = 'original-selection';
  let run, selection, exportInfo;
  const cleanup = async () => {
    const errors = [];
    for (const service of [mcp, registration, browser, original]) {
      try { await service?.close(); } catch (error) { errors.push(safeCode(error)); }
    }
    mcp = registration = browser = original = null;
    return errors;
  };
  try {
    run = await read('run.json');
    if (run) need(sameSelection(run, options), 'COLLECTION_HANDOFF_RUN_CHANGED');
    else run = await save('run.json', { schema: SCHEMA, operation: OPERATION, ...options,
      exportId: randomBytes(16).toString('hex'), createdAt: new Date().toISOString() });
    const receivedDirectory = path('customer-files');
    selection = await read('collection-selection.json');
    exportInfo = await read('export.json');
    const completed = await read('native-result.json', 262144);
    const localSelection = () => ({ collectionWorkspace: WORKSPACE, id: run.id,
      collectionManifestSha256: selection.manifestSha256, exportId: run.exportId,
      expectedManifestSha256: exportInfo.files.find(file => file.name === 'manifest.json').sha256,
      directory: receivedDirectory });
    if (completed) {
      need(completed.schema === SCHEMA && completed.operation === OPERATION && completed.state === 'COMPLETED' &&
        completed.sourceRef === run.sourceRef && completed.exportId === run.exportId && selection?.id === run.id &&
        exportInfo?.id === run.id && exportInfo.exportId === run.exportId &&
        exportInfo.manifestSha256 === selection.manifestSha256 && Array.isArray(exportInfo.files) &&
        JSON.stringify(completed.files) === JSON.stringify(exportInfo.files),
      'COLLECTION_HANDOFF_RESULT_CHANGED');
      const reopened = await reopenNativeCollectionExport(localSelection());
      need(reopened.manifestSha256 === completed.receiving.manifestSha256 &&
        reopened.collectionManifestSha256 === completed.collection.manifestSha256 &&
        reopened.files === 5 && reopened.bytes === completed.receiving.bytes,
      'COLLECTION_HANDOFF_RESULT_CHANGED');
      return { ...completed, resumedExistingRun: true, offlineReopenedAt: new Date().toISOString() };
    }
    signal?.throwIfAborted();
    original = await openNativeWorkspace(run.nativeWorkspace);
    const originalManifest = original.manifest;
    const nativeManifestSha256 = sha(await initializationBytes(join(run.nativeWorkspace, 'native-workspace.json'), 65536));
    await save('original-native.json', { nativeWorkspace: run.nativeWorkspace, nativeManifestSha256,
      originalBuyer: originalManifest.workspace, catalogSha256: sha(Buffer.from(JSON.stringify(originalManifest.catalog))) });
    await original.close(); original = null;
    const store = parse(await initializationBytes(join(run.collections, 'collections.json'), 65536));
    need(store.schema === 'stellar-forge.sf88.collections.v1' && typeof store.queueRoot === 'string',
      'COLLECTION_HANDOFF_ORIGINAL_STORE_REQUIRED');
    await initializationDirectory(run.collections); await initializationDirectory(store.queueRoot);
    const adapterDirectory = path('native-mcp');
    phase = 'receiving-adapter';
    let adapterManifest = await optionalJson(join(adapterDirectory, 'native-workspace.json'));
    if (adapterManifest === null) {
      // The constructor owns cleanup before its completion manifest. Preserve a
      // hard-crash partial directory for the original constructor's diagnosis.
      await initializeNativeWorkspace({ directory: adapterDirectory, workspace: originalManifest.workspace,
        catalog: originalManifest.catalog, response: originalManifest.response });
      adapterManifest = parse(await initializationBytes(join(adapterDirectory, 'native-workspace.json'), 65536));
    }
    need(adapterManifest.schema === originalManifest.schema && adapterManifest.directory === adapterDirectory &&
      adapterManifest.workspace === originalManifest.workspace &&
      JSON.stringify(adapterManifest.catalog) === JSON.stringify(originalManifest.catalog) &&
      JSON.stringify(adapterManifest.response) === JSON.stringify(originalManifest.response) &&
      JSON.stringify(adapterManifest.workspaceBinding) === JSON.stringify(originalManifest.workspaceBinding) &&
      JSON.stringify(adapterManifest.route) === JSON.stringify(originalManifest.route),
    'COLLECTION_HANDOFF_ADAPTER_CHANGED');
    // Registration is unchanged after a restart; its actual listener capability
    // is refreshed in the same private connection file before live operations.
    if (exportInfo === null) {
      phase = 'original-collection-browser';
      browser = await startCollectionsWorkspace({ directory: run.collections, queueRoot: store.queueRoot,
        approvalMode: 'BROWSER', port: 0, environment });
      await replace('collection-launch.json', collectionsWorkspaceLaunch({
        directory: browser.collections.directory, queueRoot: browser.collections.queueRoot,
        approvalMode: 'BROWSER' }, browser.url));
      registration = await openNativeWorkspace(adapterDirectory);
      await registration.registerCollections({ name: WORKSPACE, connectionFile: path('collection-launch.json'),
        sources: {}, buyers: { primary: originalManifest.workspace } });
      await registration.close(); registration = null;
    }
    phase = 'original-mcp-listener';
    const rememberedEndpoint = await read('mcp-endpoint.json');
    need(rememberedEndpoint === null || Number.isInteger(rememberedEndpoint.port) &&
      rememberedEndpoint.port > 0 && rememberedEndpoint.port <= 65535 &&
      rememberedEndpoint.url === 'http://127.0.0.1:' + rememberedEndpoint.port + '/mcp',
    'COLLECTION_HANDOFF_ENDPOINT_CHANGED');
    const token = randomBytes(32).toString('hex');
    mcp = await startMcpWorkspace({ environment: { ...environment,
      MCP_ACCESS_TOKEN: token, MCP_OAUTH_CONFIG: undefined, MCP_CLIENT_ORIGINS: '',
      MCP_OPERATOR_MODULE: join(adapterDirectory, 'operator.mjs'), MCP_STATE_DIR: join(adapterDirectory, 'quotes'),
      BAZAAR_DISCOVERY_URL: adapterManifest.catalog.origin, PAID_RESOURCE_ORIGINS: adapterManifest.route.origin,
      MCP_PORT: String(rememberedEndpoint?.port ?? 0), MCP_PROVIDER_TIMEOUT_MS: '120000' } });
    const endpoint = { port: Number(new URL(mcp.address).port || 80), url: mcp.address + '/mcp' };
    await save('mcp-endpoint.json', endpoint);
    const clientOptions = { url: endpoint.url, collectionWorkspace: WORKSPACE,
      environment: { MCP_ACCESS_TOKEN: token }, signal };
    const client = await openNativeCollectionsClient(clientOptions);
    if (exportInfo === null) {
      phase = 'original-collection-inspect-and-export';
      const inspected = await client.call('inspect', { id: run.id, limit: 100, runLimit: 100 });
      need(inspected.id === run.id && HASH.test(inspected.manifestSha256 ?? '') &&
        (run.expectedCollectionSha256 === null || inspected.manifestSha256 === run.expectedCollectionSha256),
      'COLLECTION_HANDOFF_COLLECTION_CHANGED');
      selection = await save('collection-selection.json', { id: inspected.id, name: inspected.name,
        manifestSha256: inspected.manifestSha256, itemCount: inspected.itemCount });
      exportInfo = await client.call('export', { id: run.id,
        expectedManifestSha256: selection.manifestSha256, exportId: run.exportId });
      await save('export.json', exportInfo);
    }
    need(selection?.id === run.id && HASH.test(selection?.manifestSha256 ?? '') &&
      exportInfo?.id === run.id && exportInfo.exportId === run.exportId &&
      exportInfo.manifestSha256 === selection.manifestSha256 &&
      Array.isArray(exportInfo.files) && exportInfo.files.length === 5 &&
      new Set(exportInfo.files.map(file => file.name)).size === 5 &&
      exportInfo.files.every(file => FILES.includes(file.name) && HASH.test(file.sha256 ?? '') &&
        Number.isSafeInteger(file.bytes) && file.bytes >= 0),
    'COLLECTION_HANDOFF_EXPORT_CHANGED');
    phase = 'receiving-after-browser-close';
    if (browser) { await browser.close(); browser = null; }
    await save('browser-closed.json', { exportId: run.exportId, collection: selection });
    const offlineMetadata = await client.call('export-status', { id: run.id,
      expectedManifestSha256: selection.manifestSha256, exportId: run.exportId });
    need(JSON.stringify(offlineMetadata) === JSON.stringify(exportInfo), 'COLLECTION_HANDOFF_EXPORT_CHANGED');
    const downloadOptions = { ...clientOptions, ...localSelection() };
    const reviewed = await inspectNativeCollectionExport(downloadOptions);
    need(reviewed.manifestSha256 === downloadOptions.expectedManifestSha256,
      'COLLECTION_HANDOFF_EXPORT_CHANGED');
    let interruption = await read('first-chunk.json');
    if (interruption === null) {
      phase = 'first-durable-customer-chunk';
      const pause = new AbortController();
      const intendedPause = Object.assign(new Error('COLLECTION_HANDOFF_CHUNK_RETAINED'),
        { code: 'COLLECTION_HANDOFF_CHUNK_RETAINED' });
      let progress = null, stopped = false;
      try {
        await downloadNativeCollectionExport({ ...downloadOptions, chunkSize: 1,
          signal: signal ? AbortSignal.any([signal, pause.signal]) : pause.signal,
          async onProgress(value) {
            progress ??= value;
            pause.abort(intendedPause);
          } });
      } catch (error) {
        if (error !== intendedPause) throw error;
        stopped = true;
      }
      need(stopped && progress && progress.bytes > 0 && progress.bytes < progress.total,
        'COLLECTION_HANDOFF_PARTIAL_REQUIRED');
      const checkpoint = parse(await initializationBytes(join(receivedDirectory, 'download-state', 'checkpoint.json'), 65536));
      const partial = checkpoint.files[progress.file];
      need(checkpoint.schema === 'stellar-forge.collection-download-state.v1' &&
        checkpoint.exportId === run.exportId && checkpoint.manifestSha256 === reviewed.manifestSha256 &&
        partial?.bytes === progress.bytes && partial.complete === false && HASH.test(partial.sha256 ?? ''),
      'COLLECTION_HANDOFF_CHECKPOINT_CHANGED');
      interruption = await save('first-chunk.json', { file: progress.file, bytes: progress.bytes,
        total: progress.total, prefixSha256: partial.sha256, exportId: run.exportId,
        manifestSha256: reviewed.manifestSha256, endpoint: endpoint.url });
    }
    need(interruption.exportId === run.exportId && interruption.manifestSha256 === reviewed.manifestSha256 &&
      interruption.endpoint === endpoint.url && interruption.bytes > 0 &&
      interruption.bytes < interruption.total, 'COLLECTION_HANDOFF_CHECKPOINT_CHANGED');
    phase = 'same-directory-customer-resume';
    const downloaded = await downloadNativeCollectionExport({ ...downloadOptions, chunkSize: 65536 });
    need(downloaded.state === 'COMPLETE' && downloaded.resumed && downloaded.files === 5 &&
      downloaded.manifestSha256 === reviewed.manifestSha256 &&
      downloaded.resumedBytes >= interruption.bytes, 'COLLECTION_HANDOFF_RECEIVING_CHANGED');
    const priorDownload = await read('download.json');
    if (priorDownload) need(['schema', 'state', 'directory', 'exportId', 'collectionId', 'collectionManifestSha256',
      'manifestSha256', 'files', 'dataFiles', 'bytes'].every(key => priorDownload[key] === downloaded[key]) &&
      priorDownload.resumed === true && priorDownload.resumedBytes >= interruption.bytes,
    'COLLECTION_HANDOFF_RECEIVING_CHANGED');
    const downloadReceipt = priorDownload ?? await save('download.json', downloaded);
    phase = 'offline-customer-reopen';
    await mcp.close(); mcp = null;
    const reopened = await reopenNativeCollectionExport(localSelection());
    need(reopened.state === 'COMPLETE' && reopened.files === 5 && reopened.dataFiles === 4 &&
      reopened.manifestSha256 === downloaded.manifestSha256 && reopened.bytes === downloaded.bytes,
    'COLLECTION_HANDOFF_REOPEN_CHANGED');
    const result = { schema: SCHEMA, operation: OPERATION, state: 'COMPLETED',
      sourceRef: run.sourceRef, driverSha256: sha(await readFile(fileURLToPath(import.meta.url))),
      node: process.version, directory: run.directory, startedAt: run.createdAt,
      completedAt: new Date().toISOString(), originalNativeWorkspace: run.nativeWorkspace,
      nativeManifestSha256, originalBuyer: originalManifest.workspace, collectionDirectory: run.collections,
      collection: selection, nativeAdapter: adapterDirectory, exportId: run.exportId,
      exportCompletedAt: exportInfo.completedAt, files: exportInfo.files,
      receiving: { ...reopened, firstChunk: interruption,
        resumedBytes: downloadReceipt.resumedBytes, browserClosedBeforeReceiving: true,
        mcpClosedBeforeReopen: true } };
    await save('native-result.json', result);
    return result;
  } catch (error) {
    const cleanupErrors = await cleanup();
    await replace('native-failure.json', { schema: SCHEMA, operation: OPERATION,
      state: signal?.aborted ? 'INTERRUPTED' : 'FAILED', sourceRef: options.sourceRef,
      directory: options.directory, exportId: run?.exportId ?? null, phase,
      code: safeCode(error), stoppedAt: new Date().toISOString(), cleanupErrors }).catch(() => {});
    throw error;
  } finally {
    try {
      const errors = await cleanup();
      need(errors.length === 0, 'COLLECTION_HANDOFF_CLOSE_FAILED');
    } finally { await lease.close(); }
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await receiveCollection(argumentsFor(argv), { signal: controller.signal });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: safeCode(error) }) + '\n');
    process.exitCode = error?.name === 'AbortError' ? 130 : 1; });
