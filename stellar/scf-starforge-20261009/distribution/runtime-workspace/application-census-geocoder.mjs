// MIT. Census geocoder browser and agent in the existing managed Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';
const ROOT = 'stellar-forge/mcp-merchant-operator/';
const BINDING = 'stellar-forge.census-geocoder-agent-workspace-binding.v1';
const STARTUP = 'stellar-forge.census-geocoder-agent-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') => ({ name, label, type, required, description });
export function censusGeocoderApplication(common) {
  return {
    id: 'census-geocoder-agent', command: 'census-geocoder-agent', title: 'Census address operations', terminal: true,
    requiredSource: ROOT + 'census-geocoder-workspace-launcher.mjs',
    description: 'Review original Census address matches, publish native dataset editions and receive customer pages through one saved browser and agent workspace.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true, 'Original merchant-mcp.json containing censusGeocoderWorkspaceConnection.'),
      field('workspaceAlias', 'Geocoder workspace alias', 'text', true, 'Select the initialized original workspace declared by this host.'),
      field('mcpPort', 'MCP port', 'port', false, 'Use 0 for an available authenticated loopback agent listener.'),
      field('tokenEnv', 'MCP token environment name', 'text', false, 'Defaults to MCP_ACCESS_TOKEN; values stay in the host environment or private environment JSON.'),
      field('terminalPython', 'Terminal Python executable', 'path', false, 'Defaults to /usr/bin/python3. The original managed PTY carries SF88 purchase approval.'),
      ...common,
    ],
  };
}
export async function prepareCensusGeocoderApplication(settings, inputPath, runtimeDirectory) {
  const configFile = await inputPath(settings.configurationFile, 'file');
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const launcher = join(runtime.sourceRoot, ROOT + 'census-geocoder-workspace-launcher.mjs');
  const inputs = [configFile, await inputPath(launcher, 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'config.mjs'), 'file')];
  const { inspectCensusGeocoderAgentBinding } = await import(pathToFileURL(launcher).href);
  need(typeof inspectCensusGeocoderAgentBinding === 'function', 'APPLICATION_CENSUS_GEOCODER_BINDING_UNAVAILABLE');
  const binding = await inspectCensusGeocoderAgentBinding({ configPath: settings.configurationFile, workspace: settings.workspaceAlias });
  need(plain(binding) && binding.schema === BINDING && binding.configFile === absolute(settings.configurationFile) &&
    binding.workspace === settings.workspaceAlias && UUID.test(binding.workspaceId ?? '') &&
    HASH.test(binding.bindingSha256 ?? '') && Array.isArray(binding.configurationFiles) && binding.configurationFiles.length === 2,
    'APPLICATION_CENSUS_GEOCODER_BINDING_CHANGED');
  for (const original of binding.configurationFiles) {
    need(plain(original) && typeof original.path === 'string' && HASH.test(original.sha256 ?? ''), 'APPLICATION_CENSUS_GEOCODER_BINDING_CHANGED');
    let retained = inputs.find(input => input.path === original.path);
    if (!retained) { retained = await inputPath(original.path, 'file'); inputs.push(retained); }
    need(retained.sha256 === original.sha256 && retained.bytes === original.bytes,
      'APPLICATION_CENSUS_GEOCODER_BINDING_CHANGED', 'The original merchant declaration changed during review.');
  }
  inputs.push(await inputPath(binding.workspaceDirectory, 'directory', false, true));
  const tokenEnv = settings.tokenEnv ?? 'MCP_ACCESS_TOKEN', mcpPort = settings.mcpPort ?? 0;
  need(/^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv), 'APPLICATION_CENSUS_GEOCODER_TOKEN_ENV_INVALID');
  need(Number.isInteger(mcpPort) && mcpPort >= 0 && mcpPort <= 65535, 'APPLICATION_CENSUS_GEOCODER_PORT_INVALID');
  return { args: ['serve', '--config', binding.configFile, '--workspace', binding.workspace,
    '--expected-binding-sha256', binding.bindingSha256, '--mcp-port', String(mcpPort), '--token-env', tokenEnv], inputs, binding };
}
function selected(request, name, fallback) {
  const indexes = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length === 0 && fallback !== undefined) return fallback;
  need(indexes.length === 1 && typeof request.args[indexes[0] + 1] === 'string', 'APPLICATION_CENSUS_GEOCODER_STARTUP_CHANGED');
  return request.args[indexes[0] + 1];
}
function listener(value, port, browser) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_CENSUS_GEOCODER_STARTUP_CHANGED'); }
  need(/^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && (browser ? /^#[a-f0-9]{64}$/.test(url.hash) : !url.hash) &&
    Number(url.port || 80) >= 1 && (port === '0' || Number(url.port || 80) === Number(port)),
    'APPLICATION_CENSUS_GEOCODER_STARTUP_CHANGED', 'Use the original private browser and authenticated MCP listeners.');
  return url.href;
}
export function censusGeocoderStartup(request, text) {
  if (request.command !== 'census-geocoder-agent' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'CENSUS_GEOCODER_AGENT_READY') return null;
  const configFile = absolute(selected(request, '--config')), workspace = selected(request, '--workspace');
  const bindingSha256 = selected(request, '--expected-binding-sha256');
  need(HASH.test(bindingSha256) && value.bindingSha256 === bindingSha256 && value.configFile === configFile &&
    value.workspace === workspace && UUID.test(value.workspaceId ?? '') && UUID.test(value.instanceId ?? '') &&
    typeof value.workspaceDirectory === 'string' && value.workspaceDirectory === absolute(value.workspaceDirectory) &&
    value.publisherDirectory === join(value.workspaceDirectory, 'publisher'), 'APPLICATION_CENSUS_GEOCODER_STARTUP_CHANGED');
  const url = listener(value.operatorUrl, selected(request, '--port', '0'), true);
  const mcpUrl = listener(value.mcpUrl, selected(request, '--mcp-port'), false);
  need(new URL(url).origin !== new URL(mcpUrl).origin, 'APPLICATION_CENSUS_GEOCODER_STARTUP_CHANGED');
  return { url, original: { schema: STARTUP, configFile, bindingSha256, workspace,
    workspaceId: value.workspaceId, workspaceDirectory: value.workspaceDirectory,
    publisherDirectory: value.publisherDirectory, instanceId: value.instanceId, mcpUrl } };
}

