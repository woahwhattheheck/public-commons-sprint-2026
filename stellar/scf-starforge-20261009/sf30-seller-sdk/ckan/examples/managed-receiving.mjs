#!/usr/bin/env node
// MIT. Complete original CKAN browser/MCP receiving and same-project reopen.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MCP_VERSION } from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import { startCkanAgentWorkspace, prepareCkanManagedSelection } from '../../../../../stellar-forge/mcp-merchant-operator/ckan-workspace-launcher.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function need(value, message) { if (!value) throw new Error(message); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function receiveCkanManagedWorkspace({
  configPath, workspace, sourceId, publicationId, exportId, outputDirectory,
  tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env,
} = {}) {
  outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const directory = await stat(outputDirectory);
  need(directory.isDirectory() && !(directory.mode & 0o077), 'Use a private output directory.');
  const save = async (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
    await writeFile(join(outputDirectory, name), bytes, { mode: 0o600 });
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  };
  const selection = await prepareCkanManagedSelection({ configPath, workspace });
  const record = {
    schema: 'stellar-forge.ckan-managed-receiving.v1', state: 'RUNNING',
    startedAt: new Date().toISOString(), workspace, project: selection.binding.project,
    sourceSha256: selection.source.sha256, bindingSha256: selection.binding.bindingSha256, steps: [], files: [],
  };
  record.files.push(await save('selection.json', selection));
  let application;
  async function checkpoint(name, value) {
    record.steps.push({ name, at: new Date().toISOString(), value });
    await save('receiving.json', record);
    process.stdout.write(JSON.stringify({ step: name, value }) + '\n');
  }
  async function browser(path, bytes = false) {
    const address = new URL(application.url);
    const response = await fetch(new URL(path, address), {
      headers: { authorization: 'Bearer ' + address.hash.slice(1) },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    need(response.status === 200, 'Original CKAN browser request failed: ' + path);
    return bytes ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  let rpcId = 0;
  async function rpc(method, params) {
    const response = await fetch(application.startup.mcpUrl, {
      method: 'POST', headers: { authorization: 'Bearer ' + environment[tokenEnv], 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    need(response.status === 200, 'Original merchant MCP transport returned HTTP ' + response.status + '.');
    const value = await response.json();
    need(!value.error, 'Original merchant MCP returned an error: ' + JSON.stringify(value.error));
    return value.result;
  }
  function resultValue(result) {
    need(!result.isError, 'Original merchant tool returned an error.');
    return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  }
  try {
    application = await startCkanAgentWorkspace({ configPath, workspace, tokenEnv, environment, selection });
    const first = application.startup;
    const native = await browser('/api/status');
    need(native.directory === selection.binding.project.directory, 'The original project changed.');
    for (const [name, id] of [['sources', sourceId], ['publications', publicationId], ['exports', exportId]])
      need(native[name].some(item => item.id === id), 'Select an existing completed ' + name + ' item.');
    const identifiers = Object.fromEntries(['editions', 'sources', 'publications', 'exports', 'buyerRequests']
      .map(name => [name, native[name].map(item => item.id)]));
    await checkpoint('opened original project and browser', {
      instanceId: first.instanceId, pid: first.pid, project: selection.binding.project, identifiers,
      listener: await browser('/api/launch'),
    });
    const initialized = await rpc('initialize', { protocolVersion: MCP_VERSION, capabilities: {},
      clientInfo: { name: 'ckan-managed-receiving', version: '1.0.0' } });
    need(initialized.protocolVersion === MCP_VERSION, 'The original merchant MCP protocol changed.');
    const tools = await rpc('tools/list', {});
    const ckan = tools.tools.filter(tool => tool.name.startsWith('merchant_ckan_'));
    need(ckan.some(tool => tool.name === 'merchant_ckan_source_semantics'), 'The native CKAN semantic tool is missing.');
    const mcpStatus = resultValue(await rpc('tools/call', { name: 'merchant_ckan_status', arguments: { workspace, limit: 100 } }));
    need(mcpStatus.instanceId === first.instanceId, 'Browser and MCP must use the same original owner.');
    const meanings = await browser('/api/sources/' + sourceId + '/semantics');
    const mcpMeanings = resultValue(await rpc('tools/call', { name: 'merchant_ckan_source_semantics',
      arguments: { workspace, sourceId } }));
    need(meanings.sha256 === mcpMeanings.native.sha256, 'Browser and agent source definitions changed.');
    await checkpoint('read source meanings through authenticated MCP and browser', {
      tools: ckan.length, instanceId: mcpStatus.instanceId, semanticSha256: meanings.sha256,
      definitionSha256: meanings.definitionSha256,
    });
    record.files.push(await save('source-meanings.json', meanings));
    record.files.push(await save('source.json', await browser('/api/sources/' + sourceId + '/download', true)));
    const publication = await browser('/api/publications/' + publicationId);
    record.files.push(await save('publication.json', publication));
    const archive = await browser('/api/exports/' + exportId + '/download', true);
    need(archive.length > 100 && archive[0] === 0x1f && archive[1] === 0x8b, 'Receive the complete original merchant archive.');
    record.files.push(await save('merchant.tar.gz', archive));
    await checkpoint('received original source, publication and complete merchant archive', {
      sourceId, publicationId, exportId, archive: record.files.at(-1),
    });
    await application.close(); application = null;
    await checkpoint('stopped original browser and merchant owner', { instanceId: first.instanceId });
    application = await startCkanAgentWorkspace({ configPath, workspace, tokenEnv, environment, selection });
    const reopened = await browser('/api/status');
    need(application.startup.instanceId !== first.instanceId &&
      same(projectIdentity(reopened), selection.binding.project), 'Reopen the same project under its new owner.');
    for (const name of Object.keys(identifiers))
      need(same(reopened[name].map(item => item.id), identifiers[name]), 'The saved original ' + name + ' changed.');
    const reopenedMeanings = await browser('/api/sources/' + sourceId + '/semantics');
    need(reopenedMeanings.sha256 === meanings.sha256, 'Source meanings changed after project reopen.');
    await checkpoint('reopened same project, source meanings and publication', {
      instanceId: application.startup.instanceId, project: selection.binding.project,
      semanticSha256: reopenedMeanings.sha256, identifiers,
    });
    await application.close(); application = null;
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await save('receiving.json', record);
    return record;
  } catch (error) {
    record.state = 'INTERRUPTED'; record.error = { code: error.code ?? null, message: error.message };
    await save('receiving.json', record); throw error;
  } finally { await application?.close(); }
}
function projectIdentity(value) {
  return { directory: value.directory, createdAt: value.createdAt,
    catalogOrigin: value.catalogOrigin, authTokenEnv: value.authTokenEnv ?? null };
}
async function main(argv) {
  const names = new Map([['--config', 'configPath'], ['--workspace', 'workspace'], ['--source', 'sourceId'],
    ['--publication', 'publicationId'], ['--export', 'exportId'], ['--out', 'outputDirectory'], ['--token-env', 'tokenEnv']]);
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = names.get(argv[i]), value = argv[i + 1];
    need(name && value && !value.startsWith('--') && !Object.hasOwn(options, name), 'Use the named options once with a value.');
    options[name] = value;
  }
  for (const name of ['configPath', 'workspace', 'sourceId', 'publicationId', 'exportId', 'outputDirectory'])
    need(options[name], 'Missing ' + name + '.');
  const result = await receiveCkanManagedWorkspace(options);
  process.stdout.write(JSON.stringify({ state: result.state, completedAt: result.completedAt, steps: result.steps.length }) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'CKAN_RECEIVING_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
