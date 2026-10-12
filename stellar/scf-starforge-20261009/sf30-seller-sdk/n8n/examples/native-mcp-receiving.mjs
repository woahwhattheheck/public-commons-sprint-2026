// MIT. One complete original n8n merchant receiving through the full MCP host.
// node native-mcp-receiving.mjs --source ROOT --source-ref COMMIT --directory NEW_PRIVATE_DIR --receipt OUTPUT_JSON
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) =>
  index % 2 ? items : [...items, [value.replace(/^--/, ''), all[index + 1]]], []));
for (const key of ['source', 'directory', 'receipt']) assert.ok(args[key], 'Supply --' + key);
const source = resolve(args.source), directory = resolve(args.directory), receiptPath = resolve(args.receipt);
assert.notEqual(directory, '/');
process.umask(0o077);
await mkdir(directory, { recursive: true, mode: 0o700 });
assert.equal((await stat(directory)).mode & 0o077, 0);
const loadJson = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const operationPath = join(directory, 'native-mcp-operation.json');
let operation;
try { operation = await loadJson(operationPath); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (operation?.state === 'COMPLETE') {
  console.log(JSON.stringify(operation.receipt)); process.exit(0);
}
operation ??= {
  schema: 'stellar-forge.n8n-mcp-receiving-operation.v1',
  source, directory, startedAt: new Date().toISOString(), state: 'PREPARING',
  requests: { prepare: randomUUID(), renew: randomUUID(), export: randomUUID() },
  token: randomBytes(32).toString('hex'),
};
assert.equal(operation.source, source); assert.equal(operation.directory, directory);
if (args['source-ref'] !== undefined) assert.match(args['source-ref'], /^[0-9a-f]{40}$/);
operation.sourceCommit = args['source-ref'] ?? operation.sourceCommit ?? null;
const persist = () => save(operationPath, operation);
await persist();
const native = join(source, 'stellar/scf-starforge-20261009/sf30-seller-sdk/n8n');
const host = join(source, 'stellar-forge/mcp-merchant-operator');
operation.hostSourceFiles = await Promise.all(['config.mjs', 'operator.mjs', 'serve.mjs', 'catalog.mjs',
  'providers.mjs', 'instructions.mjs', 'catalog/n8n-workspace.mjs', 'n8n-workspace.mjs',
  'n8n-workspace-client.mjs', 'retained-file-contracts.mjs', 'retained-file-reads.mjs',
  'retained-download.mjs', 'host-files.mjs'].map(async path => {
    const bytes = await readFile(join(host, path)); return { path, bytes: bytes.length, sha256: digest(bytes) };
  }));
await persist();
const { startN8nMerchantLaunch, readN8nMerchantLaunch } = await import(pathToFileURL(join(native, 'launch.mjs')));
const { initializeN8nWorkspaceMerchant } = await import(pathToFileURL(join(host, 'config.mjs')));
const { startMerchantMcp } = await import(pathToFileURL(join(host, 'serve.mjs')));
const { openMerchantFileClient } = await import(pathToFileURL(join(host, 'retained-download.mjs')));
const { inspectN8nJobDownload, downloadN8nJobExport, reopenN8nJobDownload } =
  await import(pathToFileURL(join(host, 'n8n-workspace-client.mjs')));
const { MCP_VERSION } = await import(pathToFileURL(join(source, 'stellar-forge/mcp-paid-agent/http-tools.mjs')));
const originalInput = await loadJson(join(native, 'example-input.json'));
const merchantDirectory = join(directory, 'merchant'), workspace = 'invoices';
const downloadDirectory = join(directory, 'received-export');
const connectionPath = join(directory, 'n8n-workspace-connection.json');
const mcpDirectory = join(directory, 'mcp');
const connection = {
  schema: 'stellar-forge.n8n-workspace-connection.v1',
  workspaces: { [workspace]: { label: 'Original n8n MCP receiving', directory: merchantDirectory, sourceDirectory: native } },
};
let merchant, mcp, result;
const checks = operation.checks ??= [];
const check = value => { if (!checks.includes(value)) checks.push(value); };
const endpointRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'The receiving journey uses its original loopback services.');
  endpointRequests.push({ path: url.pathname, method: init?.method ?? 'GET' });
  return originalFetch(input, init);
};
try {
  merchant = await startN8nMerchantLaunch({
    directory: merchantDirectory, configPath: join(native, 'example-merchant.json'),
    sourceDirectory: native, startWorker: false,
  });
  const beforeLaunch = await readN8nMerchantLaunch({ directory: merchantDirectory, sourceDirectory: native });
  operation.firstInstance ??= beforeLaunch.instanceId;
  operation.configurationSha256 = beforeLaunch.configurationSha256;
  operation.applicationSha256 = beforeLaunch.applicationSha256;
  operation.sourceFiles = beforeLaunch.sourceFiles;
  await save(connectionPath, connection);
  let initialized;
  const configuration = join(mcpDirectory, 'merchant-mcp.json');
  try { await stat(configuration); initialized = { configuration }; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    initialized = await initializeN8nWorkspaceMerchant({
      directory: mcpDirectory, connection: connectionPath, name: 'Native n8n receiving',
    });
    assert.equal(initialized.ownership, 'ORIGINAL_N8N_MERCHANT');
  }
  const environment = { ...process.env, MCP_ACCESS_TOKEN: operation.token };
  mcp = await startMerchantMcp({ configPath: initialized.configuration, port: operation.mcpPort ?? 0, environment });
  operation.mcpPort = mcp.server.address().port;
  await persist();
  const endpoint = mcp.url + '/mcp';
  const client = await openMerchantFileClient({
    url: endpoint, environment, errorPrefix: 'N8N', clientName: 'starforge-native-n8n-receiving',
  });
  const listed = await fetch(endpoint, {
    method: 'POST', redirect: 'error',
    headers: { authorization: 'Bearer ' + operation.token, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
    body: JSON.stringify({ jsonrpc: '2.0', id: 73001, method: 'tools/list', params: {} }),
  });
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.equal(catalog.id, 73001); assert.ok(Array.isArray(catalog.result?.tools));
  const n8nNames = catalog.result.tools.map(value => value.name).filter(value => value.startsWith('merchant_n8n_')).sort();
  const expectedNames = ['status','jobs','job','prepare','renew','cancel','retry','reconcile','authorize_rerun',
    'worker_start','worker_stop','export','exports','manifest','file','file_release'].map(value=>'merchant_n8n_'+value).sort();
  assert.deepEqual(n8nNames, expectedNames);
  operation.toolCount = catalog.result.tools.length;
  check('Full original authenticated MCP host lists all 16 n8n operations');
  const call = (name, selected = {}) => client.call('merchant_n8n_' + name, { workspace, ...selected });
  const status = await call('status');
  assert.equal(status.workspace, workspace);
  assert.equal(status.configuration.configurationSha256, operation.configurationSha256);
  if (!operation.prepared) {
    const request = { requestId: operation.requests.prepare, reference: '3BDA-MCP-20261012',
      functionId: 'invoiceSummary', input: originalInput, label: 'Original MCP receiving' };
    const prepared = await call('prepare', request), retried = await call('prepare', request);
    assert.equal(prepared.job.state, 'PREPARED'); assert.equal(prepared.job.revision, 1);
    assert.equal(typeof prepared.created, 'boolean'); assert.equal(retried.created, false);
    assert.equal(retried.claimToken, prepared.claimToken);
    assert.deepEqual(retried.job, prepared.job); assert.deepEqual(retried.purchase, prepared.purchase);
    const full = await call('job', { jobId: prepared.job.id });
    assert.deepEqual(full.job.input, originalInput); assert.equal(full.dispatch, null);
    operation.prepared = prepared;
    operation.originalJobSha256 = digest(Buffer.from(JSON.stringify(full.job)));
    check('Exact prepare retry recovers the same original job, complete input and private claim');
    await persist();
  }
  const jobId = operation.prepared.job.id;
  if (!operation.export) {
    const selected = await call('job', { jobId });
    const request = { requestId: operation.requests.export, jobId,
      expectedRevision: selected.job.revision, expectedDispatchRevision: selected.dispatch?.revision ?? null };
    operation.export = await call('export', request);
    assert.deepEqual(await call('export', request), operation.export);
    check('Revision-bound original export is retained once and exact request retries return its manifest');
    await persist();
  }
  const exportId = operation.export.exportId;
  const expectedManifestSha256 = operation.export.manifestFile.sha256;
  const inspected = await inspectN8nJobDownload({ client, workspace, exportId, expectedManifestSha256 });
  assert.equal(inspected.manifest.job.id, jobId);
  assert.deepEqual(inspected.manifest.files.map(file=>file.name).sort(), ['dispatch.json', 'job.json']);
  if (!operation.interrupted) {
    const interruption = new Error('OWNED_NATIVE_RECEIVING_INTERRUPTION');
    let first;
    await assert.rejects(downloadN8nJobExport({
      client, workspace, exportId, directory: downloadDirectory, chunkSize: 128, expectedManifestSha256,
      onProgress(value) { first = value; throw interruption; },
    }), error => error === interruption);
    assert.ok(first.bytes > 0);
    const checkpoint = await loadJson(join(downloadDirectory, 'download-state/checkpoint.json'));
    const saved = checkpoint.files[first.file];
    const prefix = await readFile(join(downloadDirectory, 'download-state', first.file + '.part'));
    assert.equal(saved.bytes, first.bytes); assert.equal(prefix.length, saved.bytes);
    assert.equal(digest(prefix), saved.sha256); assert.equal(saved.complete, false);
    assert.equal(checkpoint.endpoint, client.endpoint + '#n8n-workspace=' + workspace);
    operation.interrupted = { file: first.file, bytes: saved.bytes, sha256: saved.sha256 };
    check('The maintained receiver fsyncs the first original file prefix before the deliberate interruption');
    await persist();
  }
  if (!operation.renewed) {
    const request = { requestId: operation.requests.renew, jobId,
      expectedRevision: operation.prepared.job.revision, reason: 'Renew the same retained handoff during native MCP receiving' };
    const renewed = await call('renew', request), retried = await call('renew', request);
    assert.equal(renewed.job.revision, 2); assert.equal(renewed.job.state, 'PREPARED');
    assert.equal(renewed.claimToken, retried.claimToken);
    assert.notEqual(renewed.claimToken, operation.prepared.claimToken);
    assert.deepEqual(renewed.job, retried.job);
    operation.renewed = renewed;
    check('One original claim renewal advances revision once and exact retries recover its same token');
    await persist();
  }
  const beforeClose = await call('job', { jobId });
  await merchant.close(); merchant = undefined;
  merchant = await startN8nMerchantLaunch({ directory: merchantDirectory, sourceDirectory: native, startWorker: false });
  const afterLaunch = await readN8nMerchantLaunch({ directory: merchantDirectory, sourceDirectory: native });
  assert.notEqual(afterLaunch.instanceId, beforeLaunch.instanceId);
  assert.deepEqual(await call('job', { jobId }), beforeClose);
  assert.deepEqual(await call('manifest', { exportId }), operation.export);
  const renewedAgain = await call('renew', {
    requestId: operation.requests.renew, jobId, expectedRevision: operation.prepared.job.revision,
    reason: 'Renew the same retained handoff during native MCP receiving',
  });
  assert.equal(renewedAgain.claimToken, operation.renewed.claimToken);
  assert.equal(renewedAgain.job.revision, operation.renewed.job.revision);
  check('The same MCP endpoint authenticates the reopened original merchant and recovers the same renewed handoff and frozen export');
  const downloaded = await downloadN8nJobExport({
    client, workspace, exportId, directory: downloadDirectory, chunkSize: 128, expectedManifestSha256,
  });
  assert.equal(downloaded.state, 'COMPLETE'); assert.equal(downloaded.resumed, true);
  assert.ok(downloaded.resumedBytes >= operation.interrupted.bytes);
  assert.equal(downloaded.recordsValidated, true);
  const receivedManifest = await loadJson(join(downloadDirectory, 'n8n-job-export.json'));
  const files = [];
  for (const file of receivedManifest.files) {
    const bytes = await readFile(join(downloadDirectory, file.name));
    assert.equal(bytes.length, file.bytes); assert.equal(digest(bytes), file.sha256);
    files.push({ name: file.name, bytes: bytes.length, sha256: digest(bytes) });
  }
  const originalExportedJob = await loadJson(join(downloadDirectory, 'job.json'));
  assert.deepEqual(originalExportedJob.input, originalInput);
  assert.equal(originalExportedJob.id, jobId); assert.equal(originalExportedJob.revision, 1);
  assert.equal(originalExportedJob.state, 'PREPARED');
  check('The maintained client resumes its exact endpoint, alias, export and verified prefix, then validates every original file');
  await mcp.close(); mcp = undefined;
  await merchant.close(); merchant = undefined;
  const reopened = await reopenN8nJobDownload({ directory: downloadDirectory, expectedManifestSha256 });
  assert.equal(reopened.state, 'REOPENED'); assert.equal(reopened.recordsValidated, true);
  assert.equal(reopened.exportId, exportId); assert.equal(reopened.job.id, jobId);
  check('Local receiving reopens and validates the full original export after both native services close');
  result = {
    schema: 'stellar-forge.n8n-mcp-native-receiving.v1', state: 'COMPLETE',
    sourceCommit: operation.sourceCommit,
    startedAt: operation.startedAt, completedAt: new Date().toISOString(),
    configurationSha256: operation.configurationSha256, applicationSha256: operation.applicationSha256,
    sourceFiles: operation.sourceFiles, hostSourceFiles: operation.hostSourceFiles, totalMcpTools: operation.toolCount, n8nTools: n8nNames,
    job: { id: jobId, state: 'PREPARED', exportedRevision: originalExportedJob.revision,
      currentRevision: operation.renewed.job.revision, inputSha256: originalExportedJob.inputSha256 },
    exportId, manifestSha256: expectedManifestSha256, files,
    interruption: operation.interrupted, resumedBytes: downloaded.resumedBytes,
    originalLaunchInstance: beforeLaunch.instanceId, reopenedLaunchInstance: afterLaunch.instanceId,
    sameMcpEndpoint: true, reopenedLocally: true, recordsValidated: true,
    servicesClosed: true, checks, loopbackRequests: endpointRequests.length,
  };
  operation.state = 'COMPLETE'; operation.receipt = result;
  delete operation.error; await persist(); await save(receiptPath, result);
} catch (error) {
  operation.state = 'INTERRUPTED';
  operation.error = { name: error.name, code: error.code ?? null, message: error.message, at: new Date().toISOString() };
  await persist().catch(()=>{});
  throw error;
} finally {
  if (mcp) await mcp.close();
  if (merchant) await merchant.close();
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify(result));
