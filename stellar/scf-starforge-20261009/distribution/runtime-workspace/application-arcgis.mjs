// MIT. ArcGIS agent and browser entry in the original managed Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar-forge/mcp-merchant-operator/';
const STARTUP = 'stellar-forge.arcgis-agent-workspace-startup.v1';
const BINDING = 'stellar-forge.arcgis-agent-workspace-binding.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function arcgisAgentApplication(common) {
  return {
    id: 'arcgis-agent', command: 'arcgis-agent', title: 'ArcGIS merchant workspace', terminal: false,
    requiredSource: ROOT + 'arcgis-workspace-launcher.mjs',
    description: 'Capture source layers, review field mappings, publish editions and deliver datasets through one saved browser and agent workspace.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true,
        'Select the original merchant-mcp.json containing its publisher and ArcGIS workspace connections.'),
      field('workspaceAlias', 'ArcGIS workspace alias', 'text', true,
        'Use the workspace name declared in that configuration. Its original publisher and release store remain in use.'),
      field('mcpPort', 'MCP port', 'port', false,
        'Use 0 to choose an available loopback port for the same merchant agent service.'),
      field('tokenEnv', 'MCP token environment name', 'text', false,
        'Defaults to MCP_ACCESS_TOKEN. Set its value through the host environment or private environment JSON.'),
      ...common,
    ],
  };
}

export async function prepareArcgisAgentApplication(settings, inputPath, runtimeDirectory) {
  const configFile = await inputPath(settings.configurationFile, 'file');
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const launcher = join(selected.sourceRoot, ROOT + 'arcgis-workspace-launcher.mjs');
  const inputs = [configFile, await inputPath(launcher, 'file'),
    await inputPath(join(selected.sourceRoot, ROOT + 'config.mjs'), 'file')];
  const { inspectArcgisAgentBinding } = await import(pathToFileURL(launcher).href);
  need(typeof inspectArcgisAgentBinding === 'function', 'APPLICATION_ARCGIS_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the original ArcGIS merchant launcher.');
  const binding = await inspectArcgisAgentBinding({
    configPath: settings.configurationFile, workspace: settings.workspaceAlias,
  });
  need(plain(binding) && binding.schema === BINDING &&
    binding.configFile === absolute(settings.configurationFile) &&
    binding.workspace === settings.workspaceAlias && HASH.test(binding.bindingSha256 ?? '') &&
    Array.isArray(binding.configurationFiles) && binding.configurationFiles.length === 3,
    'APPLICATION_ARCGIS_BINDING_CHANGED', 'Review the original merchant and ArcGIS workspace declarations.');
  for (const original of binding.configurationFiles) {
    need(plain(original) && typeof original.path === 'string' && HASH.test(original.sha256 ?? ''),
      'APPLICATION_ARCGIS_BINDING_CHANGED');
    let retained = inputs.find(input => input.path === original.path);
    if (!retained) { retained = await inputPath(original.path, 'file'); inputs.push(retained); }
    need(retained.sha256 === original.sha256 && retained.bytes === original.bytes,
      'APPLICATION_ARCGIS_BINDING_CHANGED', 'The original merchant declaration changed during application review.');
  }
  inputs.push(await inputPath(binding.publisherDirectory, 'directory', false, true));
  const tokenEnv = settings.tokenEnv ?? 'MCP_ACCESS_TOKEN';
  need(/^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv), 'APPLICATION_ARCGIS_TOKEN_ENV_INVALID',
    'Use the host environment name containing the MCP token.');
  const mcpPort = settings.mcpPort ?? 0;
  need(Number.isInteger(mcpPort) && mcpPort >= 0 && mcpPort <= 65535, 'APPLICATION_ARCGIS_PORT_INVALID');
  return {
    args: ['serve', '--config', binding.configFile, '--workspace', binding.workspace,
      '--expected-binding-sha256', binding.bindingSha256,
      '--mcp-port', String(mcpPort), '--token-env', tokenEnv],
    inputs, binding,
  };
}

function selectedValue(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_ARCGIS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function localListener(value, selected, paths) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_ARCGIS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(selected) && Number(selected) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (selected === '0' || port === Number(selected)) &&
    !url.username && !url.password && !url.search && !url.hash && paths.includes(url.pathname),
    'APPLICATION_ARCGIS_STARTUP_CHANGED', 'Use the original local browser and merchant MCP listeners.');
  return url.href;
}
export function arcgisAgentStartup(request, text) {
  if (request.command !== 'arcgis-agent' || !Array.isArray(request.args) ||
    request.args[0] !== 'serve' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'ARCGIS_AGENT_READY') return null;
  const configFile = absolute(selectedValue(request, '--config'));
  const workspace = selectedValue(request, '--workspace');
  const bindingSha256 = selectedValue(request, '--expected-binding-sha256');
  need(HASH.test(bindingSha256) && value.configFile === configFile &&
    value.workspace === workspace && value.bindingSha256 === bindingSha256 &&
    typeof value.publisher === 'string' && value.publisher.length > 0 &&
    UUID.test(value.workbenchId ?? '') && UUID.test(value.instanceId ?? '') &&
    UUID.test(value.publisherInstanceId ?? '') &&
    typeof value.publisherDirectory === 'string' &&
    value.publisherDirectory === absolute(value.publisherDirectory) &&
    typeof value.releaseStore === 'string' && value.releaseStore === absolute(value.releaseStore),
    'APPLICATION_ARCGIS_STARTUP_CHANGED', 'The original startup must match the reviewed ArcGIS workspace.');
  const url = localListener(value.operatorUrl, selectedValue(request, '--port'), ['/']);
  const mcpUrl = localListener(value.mcpUrl, selectedValue(request, '--mcp-port'), ['/']);
  need(new URL(url).origin !== new URL(mcpUrl).origin, 'APPLICATION_ARCGIS_STARTUP_CHANGED',
    'The original browser and MCP service must identify their own listeners.');
  return {
    url, original: {
      schema: STARTUP, configFile, bindingSha256, workspace,
      publisher: value.publisher, publisherDirectory: value.publisherDirectory,
      releaseStore: value.releaseStore, workbenchId: value.workbenchId,
      instanceId: value.instanceId, publisherInstanceId: value.publisherInstanceId, mcpUrl,
    },
  };
}
