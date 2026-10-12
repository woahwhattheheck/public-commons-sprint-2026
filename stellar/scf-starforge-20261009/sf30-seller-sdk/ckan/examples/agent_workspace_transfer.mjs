#!/usr/bin/env node
// MIT. Complete original workspace handover over authenticated merchant MCP/HTTP.
import { constants } from 'node:fs';
import { mkdir, readdir, open, lstat, readFile, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { MCP_VERSION } from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import { readMerchantConfig } from '../../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { startCkanAgentWorkspace } from '../../../../../stellar-forge/mcp-merchant-operator/ckan-workspace-launcher.mjs';
import { CKAN_WORKSPACE_CONNECTION_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/ckan-workspace.mjs';
import { atomicJson, createFile, privateDirectory, readJson, bytes } from '../../postgres/publisher/files.mjs';

const insist = (value, message) => { if (!value) throw new Error(message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function retained(path, content) {
  const raw = bytes(content);
  if (await exists(path)) insist((await readFile(path)).equals(raw), 'The original receiving configuration changed: ' + basename(path));
  else await createFile(path, raw);
}
async function fileDigest(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(), hash = createHash('sha256'); let count = 0;
    insist(info.isFile() && info.nlink === 1 && !(info.mode & 0o077), 'Use an owned private receiving file.');
    for await (const part of handle.createReadStream({ autoClose: false })) { hash.update(part); count += part.length; }
    insist(count === info.size, 'The received file changed.');
    return { bytes: count, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function downloadArchive(browserUrl, selected, destination) {
  if (await exists(destination)) {
    const saved = await fileDigest(destination);
    insist(saved.bytes === selected.bytes && saved.sha256 === selected.sha256, 'The completed customer archive changed.');
    return saved;
  }
  const address = new URL(browserUrl), response = await fetch(new URL(selected.download.path, address), {
    headers: { authorization: 'Bearer ' + address.hash.slice(1) }, redirect: 'error',
  });
  insist(response.status === 200 && response.headers.get('x-archive-sha256') === selected.sha256,
    'The original authenticated archive download failed.');
  const pending = destination + '.partial';
  const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  const hash = createHash('sha256'); let count = 0;
  try {
    const info = await handle.stat();
    insist(info.isFile() && info.nlink === 1 && !(info.mode & 0o077), 'The original download staging file changed.');
    await handle.truncate(0);
    for await (const part of response.body) {
      count += part.length; insist(count <= selected.bytes, 'The archive download grew beyond its original byte count.');
      hash.update(part); let offset = 0;
      while (offset < part.length) {
        const written = await handle.write(part, offset, part.length - offset);
        insist(written.bytesWritten > 0, 'The customer archive write made no progress.'); offset += written.bytesWritten;
      }
    }
    insist(count === selected.bytes && hash.digest('hex') === selected.sha256, 'The complete archive download differs from its selected SHA256.');
    await handle.sync();
    await link(pending, destination); await unlink(pending);
    return { bytes: count, sha256: selected.sha256 };
  } finally { await handle.close(); }
}
export async function runCkanAgentWorkspaceTransfer({
  configPath, workspace, targetWorkspace = 'received', targetDirectory, outputDirectory,
  tokenEnv = 'CKAN_HANDOVER_MCP_TOKEN', environment = process.env,
} = {}) {
  configPath = resolve(configPath); outputDirectory = resolve(outputDirectory); targetDirectory = resolve(targetDirectory);
  insist(workspace !== targetWorkspace, 'Use different original and receiving aliases.');
  const original = await readMerchantConfig(configPath), selected = original.ckanWorkspaces?.workspaces[workspace];
  insist(selected && selected.directory !== targetDirectory && dirname(selected.directory) === dirname(targetDirectory),
    'Select a new receiving directory beside the original declared project.');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 }); await privateDirectory(outputDirectory);
  const recordPath = join(outputDirectory, 'receiving.json');
  let record;
  try { record = await readJson(recordPath, 33554432); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record) {
    insist(record.configPath === configPath && record.workspace === workspace && record.targetWorkspace === targetWorkspace &&
      record.targetDirectory === targetDirectory, 'Resume this original configured handover.');
    if (record.state === 'COMPLETE') return record;
  } else {
    insist((await readdir(outputDirectory)).length === 0, 'Use an empty private receiving output directory.');
    record = { schema: 'stellar-forge.ckan-agent-workspace-transfer.v1', configPath, workspace, targetWorkspace,
      targetDirectory, state: 'RUNNING', startedAt: new Date().toISOString(), steps: [] };
  }
  record.state = 'RUNNING'; delete record.error;
  const save = () => atomicJson(outputDirectory, 'receiving.json', record);
  const note = async (name, value) => {
    record.steps.push({ name, at: new Date().toISOString(), value }); await save();
    process.stdout.write(JSON.stringify({ step: name, value }) + '\n');
  };
  await save();
  const declaration = { directory: selected.directory, label: selected.label, inputs: selected.inputs,
    ...(selected.receiveTarget ? { receiveTarget: true } : {}),
    ...(selected.merchant ? { merchant: selected.merchant } : {}), ...(selected.seller ? { seller: selected.seller } : {}) };
  const connectionPath = join(outputDirectory, 'workspace-connection.json');
  await retained(connectionPath, { schema: CKAN_WORKSPACE_CONNECTION_SCHEMA,
    workspaces: { [workspace]: declaration, [targetWorkspace]: { directory: targetDirectory,
      label: 'Received CKAN workspace', receiveTarget: true } } });
  const exportsDirectory = join(outputDirectory, 'customer-exports');
  await mkdir(exportsDirectory, { mode: 0o700, recursive: true });
  const hostConfig = join(outputDirectory, 'merchant-mcp.json');
  await retained(hostConfig, { schema: 'stellar-forge.merchant-mcp.v1', name: 'CKAN workspace handover',
    releaseStore: original.releaseStore, exportsDirectory, sources: {}, ckanWorkspaceConnection: connectionPath });
  const ownedEnvironment = { ...environment, [tokenEnv]: environment[tokenEnv] || randomBytes(32).toString('hex') };
  let application, rpcId = 0;
  async function rpc(method, params) {
    const response = await fetch(application.startup.mcpUrl, {
      method: 'POST', headers: { authorization: 'Bearer ' + ownedEnvironment[tokenEnv],
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), redirect: 'error',
    });
    insist(response.status === 200, 'The original MCP transport returned HTTP ' + response.status);
    const body = await response.json(); insist(!body.error, JSON.stringify(body.error)); return body.result;
  }
  async function tool(name, args) {
    const result = await rpc('tools/call', { name, arguments: args });
    insist(!result.isError, 'Original MCP tool failed: ' + name + ' ' + JSON.stringify(result.content));
    return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  }
  async function connect() {
    application = await startCkanAgentWorkspace({ configPath: hostConfig, workspace, tokenEnv, environment: ownedEnvironment });
    const initialized = await rpc('initialize', { protocolVersion: MCP_VERSION, capabilities: {},
      clientInfo: { name: 'ckan-agent-workspace-receiver', version: '1.0.0' } });
    insist(initialized.protocolVersion === MCP_VERSION, 'The original MCP protocol changed.');
  }
  const status = alias => tool('merchant_ckan_status', { workspace: alias, limit: 100 });
  async function waitOperation(operationId) {
    for (;;) {
      const current = await status(workspace), operation = current.native.operation;
      insist(operation?.id === operationId, 'Reconcile the original handover operation before another changing action.');
      if (current.native.active === operationId) { await new Promise(done => setTimeout(done, 200)); continue; }
      insist(operation.state === 'COMPLETE', 'The original handover operation ended: ' + JSON.stringify(operation));
      return operation.result;
    }
  }
  async function archives() {
    const items = []; let offset = 0;
    do {
      const page = await tool('merchant_ckan_workspace_archives', { workspace, offset, limit: 100 });
      items.push(...page.items); offset = page.nextOffset;
    } while (offset !== null);
    return items;
  }
  try {
    await connect();
    const catalog = await rpc('tools/list', {});
    const names = catalog.tools.map(item => item.name);
    for (const name of ['archives', 'archive', 'inspect', 'read', 'receive'])
      insist(names.includes('merchant_ckan_workspace_' + name), 'The installed workspace handover tool is missing: ' + name);
    const before = await status(workspace);
    if (!record.selected) {
      const source = before.native.sources.find(item => item.semanticReview);
      const publication = before.native.publications.find(item => item.sourceId === source?.id && item.state === 'PUBLISHED');
      insist(source && publication, 'Use an existing reviewed and published CKAN project.');
      record.selected = { sourceId: source.id, sourceSha256: source.sha256, publicationId: publication.id,
        semanticSha256: source.semanticReview.sha256, definitionSha256: source.semanticReview.definitionSha256 };
      record.original = { instanceId: before.instanceId, counts: Object.fromEntries(
        Object.entries(before.paging).map(([key, value]) => [key, value.total])) };
      await note('original owner and complete tool catalog opened', { instanceId: before.instanceId,
        tools: names.filter(name => name.startsWith('merchant_ckan_')).length, counts: record.original.counts });
    }
    if (!record.archive) {
      let all = await archives();
      if (!record.archiveBaseline) { record.archiveBaseline = all.map(item => item.archiveId); await save(); }
      const retainedArchive = all.filter(item => !record.archiveBaseline.includes(item.archiveId));
      insist(retainedArchive.length <= 1, 'More than one new archive exists; reconcile the original handover selection.');
      if (!retainedArchive.length) {
        const current = await status(workspace);
        const operation = await tool('merchant_ckan_workspace_archive', {
          workspace, expectedOperationId: current.native.operation?.id ?? null });
        record.archiveOperationId = operation.operationId; await save(); await waitOperation(operation.operationId);
        all = await archives();
      }
      const selectedArchives = all.filter(item => !record.archiveBaseline.includes(item.archiveId));
      insist(selectedArchives.length === 1, 'The original completed archive is missing.');
      record.archive = selectedArchives[0]; await note('complete original workspace archived', record.archive);
    }
    if (!record.inventory) {
      const files = []; let offset = 0, inspected;
      do {
        inspected = await tool('merchant_ckan_workspace_inspect', { workspace, archiveId: record.archive.archiveId,
          expectedSha256: record.archive.sha256, offset, limit: 100 });
        files.push(...inspected.files.items); offset = inspected.files.nextOffset;
      } while (offset !== null);
      insist(files.length === record.archive.files && files.some(item => item.name === 'workbench.json') &&
        files.some(item => item.name === 'sources/' + record.selected.sourceId + '.json'), 'The whole workspace file inventory is incomplete.');
      await atomicJson(outputDirectory, 'archive-files.json', { sha256: inspected.sha256, files });
      record.inventory = { files: files.length, bytes: inspected.unpackedBytes, manifestSha256: inspected.manifestSha256 };
      await note('complete archive inspected through MCP', record.inventory);
    }
    if (!record.download) {
      record.download = await downloadArchive((await status(workspace)).browserUrl, record.archive,
        join(outputDirectory, 'complete-workspace.ckanw'));
      await note('complete original authenticated archive received', record.download);
    }
    if (!record.mcpDownload) {
      let offset = 0, readId, receivedBytes = 0; const hash = createHash('sha256');
      do {
        const part = await tool('merchant_ckan_workspace_read', { workspace, archiveId: record.archive.archiveId,
          expectedSha256: record.archive.sha256, offset, ...(readId ? { readId } : {}) });
        const chunk = Buffer.from(part.data, 'base64'); hash.update(chunk); receivedBytes += chunk.length;
        insist(receivedBytes <= record.archive.bytes, 'The MCP archive grew beyond the original selection.');
        offset = part.nextOffset; readId = part.readId;
      } while (offset !== null);
      insist(receivedBytes === record.archive.bytes && hash.digest('hex') === record.archive.sha256,
        'The full native MCP archive differs from its original download.');
      record.mcpDownload = { bytes: receivedBytes, sha256: record.archive.sha256 };
      await note('complete original archive also received through native MCP chunks', record.mcpDownload);
    }
    if (!record.receiving) {
      const current = await status(workspace);
      const operation = await tool('merchant_ckan_workspace_receive', { workspace, targetWorkspace,
        archiveId: record.archive.archiveId, expectedSha256: record.archive.sha256,
        expectedOperationId: current.native.operation?.id ?? null });
      record.receiveOperationId = operation.operationId; await save();
      record.receiving = await waitOperation(operation.operationId);
      await note('configured destination received through the original operation', {
        operationId: operation.operationId, targetWorkspace, state: record.receiving.state });
    }
    const opened = await tool('merchant_ckan_open', { workspace: targetWorkspace });
    insist(opened.instanceId !== application.startup.instanceId, 'The receiving project needs its own original owner.');
    const meanings = await tool('merchant_ckan_source_semantics', { workspace: targetWorkspace, sourceId: record.selected.sourceId });
    const publication = await tool('merchant_ckan_publication', { workspace: targetWorkspace,
      publicationId: record.selected.publicationId, query: 'limit=5' });
    insist(meanings.native.sha256 === record.selected.semanticSha256 &&
      meanings.native.definitionSha256 === record.selected.definitionSha256 &&
      publication.native.run.state === 'PUBLISHED', 'The original source meanings or publication changed after receive.');
    const sourceFiles = await tool('merchant_ckan_files', { workspace: targetWorkspace, kind: 'source', itemId: record.selected.sourceId });
    const source = sourceFiles.files[0]; let offset = 0, readId, chunks = [];
    do {
      const part = await tool('merchant_ckan_file_read', { workspace: targetWorkspace, kind: 'source',
        itemId: record.selected.sourceId, file: source.file, expectedSha256: source.sha256, offset,
        ...(readId ? { readId } : {}) });
      chunks.push(Buffer.from(part.data, 'base64')); offset = part.nextOffset; readId = part.readId;
    } while (offset !== null);
    const sourceBytes = Buffer.concat(chunks);
    insist(digest(sourceBytes) === record.selected.sourceSha256, 'The received source declaration bytes changed.');
    await retained(join(outputDirectory, 'source-meanings.json'), meanings.native);
    if (!await exists(join(outputDirectory, 'source.json'))) await createFile(join(outputDirectory, 'source.json'), sourceBytes);
    else insist((await readFile(join(outputDirectory, 'source.json'))).equals(sourceBytes), 'The retained customer source changed.');
    record.received = { instanceId: opened.instanceId, sourceSha256: digest(sourceBytes), semanticSha256: meanings.native.sha256,
      publicationId: record.selected.publicationId, previewRows: publication.native.detail.preview.rows.length };
    await note('received project queried and source downloaded through MCP', record.received);
    await application.close(); application = null;
    await connect();
    const reopened = await tool('merchant_ckan_open', { workspace: targetWorkspace });
    const restored = await tool('merchant_ckan_source_semantics', { workspace: targetWorkspace, sourceId: record.selected.sourceId });
    insist(reopened.instanceId !== record.received.instanceId && restored.native.sha256 === record.selected.semanticSha256,
      'The same configured received workspace did not reopen after host restart.');
    await application.close(); application = null;
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await note('both original owners closed and received workspace reopened', {
      originalInstanceId: record.received.instanceId, reopenedInstanceId: reopened.instanceId, semanticSha256: restored.native.sha256 });
    return record;
  } catch (error) {
    record.state = 'INTERRUPTED'; record.error = { code: error.code ?? 'CKAN_AGENT_WORKSPACE_TRANSFER_FAILED', message: error.message };
    await save(); throw error;
  } finally { await application?.close(); }
}
export async function main(argv = process.argv.slice(2)) {
  const names = new Map([['--config', 'configPath'], ['--workspace', 'workspace'],
    ['--target-workspace', 'targetWorkspace'], ['--target', 'targetDirectory'], ['--out', 'outputDirectory']]);
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    insist(names.has(argv[i]) && argv[i + 1] && !Object.hasOwn(options, names.get(argv[i])), 'Use each named receiving option once.');
    options[names.get(argv[i])] = argv[i + 1];
  }
  insist(options.configPath && options.workspace && options.targetDirectory && options.outputDirectory,
    'Use --config MERCHANT_JSON --workspace ORIGINAL_ALIAS --target NEW_SIBLING --out PRIVATE_OUTPUT [--target-workspace ALIAS].');
  const result = await runCkanAgentWorkspaceTransfer(options);
  process.stdout.write(JSON.stringify({ state: result.state, outputDirectory: resolve(options.outputDirectory),
    archive: result.download, received: result.received }) + '\n');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
