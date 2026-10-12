// MIT. World Bank browser and agent in the original managed Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar-forge/mcp-merchant-operator/';
const BINDING = 'stellar-forge.worldbank-agent-binding.v1';
const STARTUP = 'stellar-forge.worldbank-agent-startup.v1';
const BROWSER = 'stellar-forge.worldbank-workspace-launch.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function worldbankAgentApplication(common = []) {
  return {
    id: 'worldbank-agent', command: 'worldbank-agent', title: 'World Bank economic data', terminal: false,
    requiredSource: ROOT + 'worldbank-workspace-launcher.mjs',
    description: 'Capture economic indicators, compare revisions, review and publish editions, then deliver and reopen complete customer data through one browser and agent workspace.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true,
        'Select the original private merchant JSON containing worldbankWorkspaceConnection. It retains the same publisher, releases and source import aliases.'),
      field('workspaceAlias', 'World Bank workspace', 'text', true,
        'Select a workspace alias declared in the original connection. Its saved selections, captures, reviews and customer handovers reopen together.'),
      field('mcpPort', 'Agent port', 'port', false,
        'Zero selects an available loopback port for the existing merchant MCP endpoint.'),
      field('tokenEnv', 'Agent token environment name', 'text', false,
        'Defaults to MCP_ACCESS_TOKEN. The value comes from the host or the selected private environment JSON.'),
      ...common,
    ],
  };
}
export async function prepareWorldBankAgentApplication(settings, { inputPath, runtimeDirectory } = {}) {
  const config = await inputPath(settings.configurationFile, 'file', false, true);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const launch = join(runtime.sourceRoot, ROOT + 'worldbank-workspace-launcher.mjs');
  const inputs = [config, await inputPath(launch, 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'worldbank-workspace.mjs'), 'file'),
    await inputPath(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/native.mjs'), 'file')];
  const original = await import(pathToFileURL(launch).href);
  need(typeof original.inspectWorldBankAgentBinding === 'function', 'APPLICATION_WORLDBANK_BINDING_UNAVAILABLE',
    'Select an installed release containing the World Bank managed launcher.');
  const binding = await original.inspectWorldBankAgentBinding({
    configPath: settings.configurationFile, workspace: settings.workspaceAlias,
  });
  need(plain(binding) && binding.schema === BINDING &&
    binding.configFile === absolute(settings.configurationFile) &&
    binding.workspace === settings.workspaceAlias && HASH.test(binding.bindingSha256 ?? '') &&
    Array.isArray(binding.configurationFiles) && binding.configurationFiles.length === 2,
    'APPLICATION_WORLDBANK_BINDING_CHANGED');
  for (const declared of binding.configurationFiles) {
    need(plain(declared) && typeof declared.path === 'string' && HASH.test(declared.sha256 ?? ''),
      'APPLICATION_WORLDBANK_BINDING_CHANGED');
    let retained = inputs.find(item => item.path === declared.path);
    if (!retained) { retained = await inputPath(declared.path, 'file', false, true); inputs.push(retained); }
    need(retained.sha256 === declared.sha256 && retained.bytes === declared.bytes,
      'APPLICATION_WORLDBANK_BINDING_CHANGED', 'Review the same current merchant and World Bank connection files.');
  }
  inputs.push(await inputPath(binding.workspaceDirectory, 'directory', false, true));
  const tokenEnv = settings.tokenEnv ?? 'MCP_ACCESS_TOKEN', mcpPort = settings.mcpPort ?? 0;
  need(/^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv), 'APPLICATION_WORLDBANK_TOKEN_ENV',
    'Select the host environment name containing the agent token.');
  need(Number.isInteger(mcpPort) && mcpPort >= 0 && mcpPort <= 65535, 'APPLICATION_WORLDBANK_PORT');
  return {
    args: ['serve', '--config', binding.configFile, '--workspace', binding.workspace,
      '--expected-binding-sha256', binding.bindingSha256, '--mcp-port', String(mcpPort), '--token-env', tokenEnv],
    inputs, binding,
  };
}
function selectedValue(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_WORLDBANK_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function listener(value, selected, browser) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_WORLDBANK_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(selected) && Number(selected) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    (browser ? /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)) : !url.hash) &&
    port >= 1 && port <= 65535 && (selected === '0' || port === Number(selected)),
    'APPLICATION_WORLDBANK_STARTUP_CHANGED', 'Open the original local browser and agent listeners.');
  return url;
}
async function originalBrowser(url) {
  const response = await fetch(new URL('/api/launch', url), {
    headers: { authorization: 'Bearer ' + url.hash.slice(1), accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json\b/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_WORLDBANK_STARTUP_CHANGED', 'The original authenticated World Bank browser must be running.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    need(size <= 16384, 'APPLICATION_WORLDBANK_STARTUP_CHANGED');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function worldbankAgentStartup(request, text) {
  if (request.command !== 'worldbank-agent' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
    typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let ready;
  try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== STARTUP || ready.state !== 'LISTENING') return null;
  const configFile = absolute(selectedValue(request, '--config'));
  const workspace = selectedValue(request, '--workspace');
  const bindingSha256 = selectedValue(request, '--expected-binding-sha256');
  need(HASH.test(bindingSha256) && ready.configFile === configFile &&
    ready.workspace === workspace && ready.bindingSha256 === bindingSha256 &&
    UUID.test(ready.instanceId ?? '') && UUID.test(ready.browserInstanceId ?? '') &&
    typeof ready.workspaceDirectory === 'string' && ready.workspaceDirectory === absolute(ready.workspaceDirectory) &&
    ready.publisherDirectory === join(ready.workspaceDirectory, 'publisher') &&
    typeof ready.releaseStore === 'string' && ready.releaseStore === absolute(ready.releaseStore),
    'APPLICATION_WORLDBANK_STARTUP_CHANGED', 'The original process must match the reviewed World Bank connection.');
  const url = listener(ready.operatorUrl, selectedValue(request, '--port'), true);
  const mcp = listener(ready.mcpUrl, selectedValue(request, '--mcp-port'), false);
  need(url.origin !== mcp.origin, 'APPLICATION_WORLDBANK_STARTUP_CHANGED');
  const live = await originalBrowser(url);
  need(live?.schema === BROWSER && live.state === 'LISTENING' &&
    live.directory === ready.workspaceDirectory && live.instanceId === ready.instanceId &&
    live.browserInstanceId === ready.browserInstanceId && live.startedAt === ready.startedAt,
    'APPLICATION_WORLDBANK_STARTUP_CHANGED', 'The live browser must use this same original World Bank model.');
  return { url: url.href, original: {
    schema: STARTUP, configFile, workspace, bindingSha256,
    workspaceDirectory: ready.workspaceDirectory, publisherDirectory: ready.publisherDirectory,
    releaseStore: ready.releaseStore, instanceId: ready.instanceId,
    browserInstanceId: ready.browserInstanceId, mcpUrl: mcp.href, startedAt: ready.startedAt,
  } };
}
