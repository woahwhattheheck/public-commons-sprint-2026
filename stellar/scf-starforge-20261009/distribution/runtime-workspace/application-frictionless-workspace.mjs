// MIT. Frictionless source onboarding in the original managed Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar-forge/mcp-merchant-operator/';
const STARTUP = 'stellar-forge.frictionless-agent-workspace-startup.v1';
const BINDING = 'stellar-forge.frictionless-agent-workspace-binding.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function frictionlessAgentApplication(common) {
  return {
    id: 'frictionless-agent', command: 'frictionless-agent',
    title: 'Frictionless source workbench', terminal: false,
    requiredSource: ROOT + 'frictionless-workspace-setup.mjs',
    description: 'Capture complete source inputs, review immutable query editions, select the original publisher source and plans, and reopen complete source handovers.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true,
        'Select the original merchant configuration containing its publisher and Frictionless source workspace connections.'),
      field('workspaceAlias', 'Frictionless source workspace alias', 'text', true,
        'Use the declared workspace name. It uses the original Frictionless publisher and its retained source workbench.'),
      field('mcpPort', 'MCP port', 'port', false,
        'Use 0 to choose an available loopback port for the same agent service.'),
      field('tokenEnv', 'MCP token environment name', 'text', false,
        'Defaults to MCP_ACCESS_TOKEN. Supply its value through the host environment or private environment JSON.'),
      ...common,
    ],
  };
}

export async function prepareFrictionlessAgentApplication(settings, inputPath, runtimeDirectory) {
  const configFile = await inputPath(settings.configurationFile, 'file');
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const launcher = join(selected.sourceRoot, ROOT + 'frictionless-workspace-setup.mjs');
  const inputs = [configFile, await inputPath(launcher, 'file'),
    await inputPath(join(selected.sourceRoot, ROOT + 'config.mjs'), 'file')];
  const { inspectFrictionlessAgentBinding } = await import(pathToFileURL(launcher).href);
  need(typeof inspectFrictionlessAgentBinding === 'function',
    'APPLICATION_FRICTIONLESS_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the Frictionless source launcher.');
  const binding = await inspectFrictionlessAgentBinding({
    configPath: settings.configurationFile, workspace: settings.workspaceAlias,
  });
  need(plain(binding) && binding.schema === BINDING &&
    binding.configFile === configFile.path && binding.workspace === settings.workspaceAlias &&
    typeof binding.publisher === 'string' && binding.publisher.length > 0 &&
    binding.publisherDirectory === absolute(binding.publisherDirectory) &&
    HASH.test(binding.bindingSha256 ?? '') &&
    Array.isArray(binding.configurationFiles) && binding.configurationFiles.length === 3,
    'APPLICATION_FRICTIONLESS_BINDING_CHANGED',
    'Review the original merchant, publisher and source workspace declarations.');
  for (const original of binding.configurationFiles) {
    need(plain(original) && typeof original.path === 'string' && HASH.test(original.sha256 ?? ''),
      'APPLICATION_FRICTIONLESS_BINDING_CHANGED');
    let retained = inputs.find(input => input.path === original.path);
    if (!retained) { retained = await inputPath(original.path, 'file'); inputs.push(retained); }
    need(retained.sha256 === original.sha256 && retained.bytes === original.bytes,
      'APPLICATION_FRICTIONLESS_BINDING_CHANGED',
      'An original configuration file changed during application review.');
  }
  // Source selection and the publisher change during normal work. Bind their
  // original declarations and directories; keep mutable source/warehouse bytes
  // outside the Applications configuration fingerprint.
  const tokenEnv = settings.tokenEnv ?? 'MCP_ACCESS_TOKEN';
  need(typeof tokenEnv === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv),
    'APPLICATION_FRICTIONLESS_TOKEN_ENV_INVALID',
    'Use the host environment name containing the MCP token.');
  const mcpPort = settings.mcpPort ?? 0;
  need(Number.isSafeInteger(mcpPort) && mcpPort >= 0 && mcpPort <= 65535,
    'APPLICATION_FRICTIONLESS_PORT_INVALID');
  return {
    args: ['serve', '--config', binding.configFile, '--workspace', binding.workspace,
      '--expected-binding-sha256', binding.bindingSha256,
      '--mcp-port', String(mcpPort), '--token-env', tokenEnv],
    inputs, binding,
  };
}

function selectedValue(request, name, fallback) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length === 0 && fallback !== undefined) return fallback;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_FRICTIONLESS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function localListener(value, selected) {
  let url;
  try { url = new URL(value); }
  catch { need(false, 'APPLICATION_FRICTIONLESS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(selected) && Number(selected) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    port >= 1 && port <= 65535 && (selected === '0' || port === Number(selected)) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'APPLICATION_FRICTIONLESS_STARTUP_CHANGED',
    'Use the original local browser and merchant MCP listeners.');
  return url.href;
}

export function frictionlessAgentStartup(request, text) {
  if (request.command !== 'frictionless-agent' || !Array.isArray(request.args) ||
    request.args[0] !== 'serve' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'FRICTIONLESS_AGENT_READY') return null;
  const configFile = absolute(selectedValue(request, '--config'));
  const workspace = selectedValue(request, '--workspace');
  const bindingSha256 = selectedValue(request, '--expected-binding-sha256');
  need(HASH.test(bindingSha256) && value.configFile === configFile &&
    value.workspace === workspace && value.bindingSha256 === bindingSha256 &&
    typeof value.publisher === 'string' && value.publisher.length > 0 &&
    UUID.test(value.workspaceId ?? '') && UUID.test(value.instanceId ?? '') &&
    UUID.test(value.publisherInstanceId ?? '') &&
    typeof value.publisherDirectory === 'string' &&
    value.publisherDirectory === absolute(value.publisherDirectory) &&
    typeof value.directory === 'string' && value.directory === absolute(value.directory),
    'APPLICATION_FRICTIONLESS_STARTUP_CHANGED',
    'The startup must identify this reviewed publisher and original source workbench.');
  const url = localListener(value.operatorUrl, selectedValue(request, '--port', '0'));
  const mcpUrl = localListener(value.mcpUrl, selectedValue(request, '--mcp-port', '0'));
  need(new URL(url).origin !== new URL(mcpUrl).origin,
    'APPLICATION_FRICTIONLESS_STARTUP_CHANGED',
    'The borrowed browser and MCP service must identify their own listeners.');
  return {
    url,
    workspaceId: value.workspaceId,
    original: {
      schema: STARTUP, configFile, bindingSha256, workspace,
      publisher: value.publisher, publisherDirectory: value.publisherDirectory,
      directory: value.directory,
      workspaceId: value.workspaceId, instanceId: value.instanceId,
      publisherInstanceId: value.publisherInstanceId, mcpUrl,
    },
  };
}
