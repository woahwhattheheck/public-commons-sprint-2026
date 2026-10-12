// MIT. CKAN in the original managed Applications console.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain, hash } from './storage.mjs';

const ROOT = 'stellar-forge/mcp-merchant-operator/';
const STARTUP = 'stellar-forge.ckan-agent-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function ckanAgentApplication(common) {
  return {
    id: 'ckan-agent', command: 'ckan-agent', title: 'CKAN data merchant', terminal: false,
    requiredSource: ROOT + 'ckan-workspace-launcher.mjs',
    description: 'Open a saved CKAN project to capture data, review field meanings, publish merchant editions and receive customer handovers through the same browser and agent service.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true,
        'Select the original private merchant-mcp.json containing its CKAN workspace connection.'),
      field('workspaceAlias', 'CKAN project alias', 'text', true,
        'Choose the name declared in that connection file. Captures, publications and customer files stay in this project.'),
      field('tokenEnv', 'MCP token environment name', 'text', false,
        'Defaults to MCP_ACCESS_TOKEN. Put its value in the private environment file or host environment.'),
      ...common.map(item => item.name === 'port' ? { ...item, label: 'Merchant MCP port',
        description: 'Use 0 to choose an available local MCP port. The CKAN browser chooses a separate free port.' } : item),
    ],
  };
}

export async function prepareCkanAgentApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_CKAN_INPUT_READER_REQUIRED');
  const configFile = await inputPath(absolute(settings.configurationFile), 'file');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const launcher = join(runtime.sourceRoot, ROOT + 'ckan-workspace-launcher.mjs');
  const native = await import(pathToFileURL(launcher).href);
  need(typeof native.prepareCkanManagedSelection === 'function' &&
    typeof native.verifyCkanAgentStartup === 'function', 'APPLICATION_CKAN_LAUNCHER_REQUIRED');
  const selection = await native.prepareCkanManagedSelection({
    configPath: configFile.path, workspace: settings.workspaceAlias, sourceRoot: runtime.sourceRoot,
  });
  const inputs = [configFile];
  for (const original of selection.binding.configurationFiles) {
    let selected = inputs.find(item => item.path === original.path);
    if (!selected) { selected = await inputPath(original.path, 'file'); inputs.push(selected); }
    need(selected.sha256 === original.sha256 && selected.bytes === original.bytes,
      'APPLICATION_CKAN_CONFIGURATION_CHANGED');
  }
  inputs.push(await inputPath(selection.binding.project.directory, 'directory', false, true));
  for (const file of selection.source.files) {
    const selected = await inputPath(join(selection.source.root, file.name), 'file');
    need(selected.sha256 === file.sha256 && selected.bytes === file.bytes, 'APPLICATION_CKAN_SOURCE_CHANGED');
    inputs.push(selected);
  }
  const tokenEnv = settings.tokenEnv || 'MCP_ACCESS_TOKEN';
  need(typeof tokenEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv),
    'APPLICATION_CKAN_TOKEN_ENV_INVALID');
  return {
    args: ['serve', '--config', selection.binding.configFile, '--workspace', selection.binding.workspace,
      '--token-env', tokenEnv, '--managed-selection', JSON.stringify(selection)],
    inputs, createDirectories: [],
    resourceKey: hash({ family: 'merchant-mcp', directory: selection.binding.configFile }),
  };
}
function option(request, name, optional = false) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_CKAN_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function ckanAgentStartup(request, text, context = {}) {
  if (request.command !== 'ckan-agent' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
    typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let startup, selection;
  try { startup = JSON.parse(text); selection = JSON.parse(option(request, '--managed-selection')); }
  catch { need(false, 'APPLICATION_CKAN_STARTUP_CHANGED'); }
  need(plain(startup) && plain(selection) && plain(selection.source) && plain(selection.binding) &&
    selection.binding.configFile === absolute(option(request, '--config')) &&
    selection.binding.workspace === option(request, '--workspace'), 'APPLICATION_CKAN_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(absolute(selection.source.root),
    ROOT + 'ckan-workspace-launcher.mjs')).href);
  const rawPort = option(request, '--port', true) ?? '0';
  need(/^(0|[1-9]\d*)$/.test(rawPort), 'APPLICATION_CKAN_STARTUP_CHANGED');
  return native.verifyCkanAgentStartup(startup, {
    selection, launchSourceRoot: join(absolute(request.releaseDirectory), 'source'),
    port: Number(rawPort), ...(context.pid ? { pid: context.pid } : {}),
  });
}
