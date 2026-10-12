// MIT. Saved access to the original merchant operator console.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { absolute, need, digest, json, canonical } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

const ROOT = 'stellar-forge/mcp-merchant-operator/console/';
export const MERCHANT_CONSOLE_APPLICATION_STARTUP = 'stellar-forge.merchant-console-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
export function merchantConsoleApplication(common) {
  return {
    id: 'merchant-console', command: 'merchant-mcp', title: 'Merchant operator', terminal: false,
    requiredSource: ROOT + 'managed.mjs',
    description: 'Open the configured merchant, save original tool requests, retain their returns and receive complete customer files in the same private operator workspace.',
    fields: [
      field('configurationFile', 'Merchant configuration', 'path', true,
        'Choose the original merchant-mcp.json with its existing source, release store and provider connections.'),
      field('consoleDirectory', 'Saved operator workspace', 'path', true,
        'Choose an existing private console directory or one new directory inside a private parent. Keep this directory to reopen requests and customer downloads.'),
      field('tokenEnv', 'Merchant token environment name', 'text', false,
        'Defaults to MCP_ACCESS_TOKEN. Keep its value in the private environment or the original host environment.'),
      field('oauthConfigFile', 'Original OAuth configuration', 'path', false,
        'For an OAuth host, select its existing resource configuration and leave the fixed bearer token empty. Open uses the console’s original sign-in form.'),
      ...common,
    ],
  };
}
export async function prepareMerchantConsoleApplication(settings, {
  inputPath, runtimeDirectory, applicationEnvironment,
} = {}) {
  need(typeof inputPath === 'function' && typeof applicationEnvironment === 'function',
    'APPLICATION_MERCHANT_CONSOLE_READERS_REQUIRED');
  const config = await inputPath(absolute(settings.configurationFile), 'file');
  const workspace = await inputPath(absolute(settings.consoleDirectory), 'directory', true, true);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const native = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + 'managed.mjs')).href);
  const { environment } = await applicationEnvironment(settings.environmentFile);
  const selection = await native.prepareMerchantConsoleSelection({
    configPath: config.path, consoleDirectory: workspace.path,
    tokenEnv: settings.tokenEnv || 'MCP_ACCESS_TOKEN', oauthConfigPath: settings.oauthConfigFile,
    environment, sourceRoot: runtime.sourceRoot,
  });
  const inputs = [config, workspace];
  for (const file of selection.configuration.files) {
    let retained = inputs.find(input => input.path === file.path);
    if (!retained) { retained = await inputPath(file.path, 'file'); inputs.push(retained); }
    need(retained.bytes === file.bytes && retained.sha256 === file.sha256,
      'APPLICATION_MERCHANT_CONSOLE_CONFIGURATION_CHANGED');
  }
  for (const file of selection.source.files) {
    const retained = await inputPath(join(selection.source.root, file.name), 'file');
    need(retained.bytes === file.bytes && retained.sha256 === file.sha256,
      'APPLICATION_MERCHANT_CONSOLE_SOURCE_CHANGED');
    inputs.push(retained);
  }
  const args = ['serve', '--config', config.path, '--operator-console-dir', workspace.path,
    '--token-env', selection.authorization.tokenEnv, '--managed-console-selection', JSON.stringify(selection)];
  if (selection.authorization.configurationFile)
    args.push('--oauth-config', selection.authorization.configurationFile);
  return {
    args, inputs, createDirectories: workspace.exists ? [] : [workspace.path],
    resourceKey: digest(json(canonical({ family: 'merchant-mcp', directory: config.path }))),
  };
}
function option(request, name, optional = false) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_MERCHANT_CONSOLE_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function merchantConsoleStartup(request, text, context = {}) {
  if (request.command !== 'merchant-mcp' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
    typeof text !== 'string' || text.length > 32768 ||
    !text.startsWith('{"schema":"' + MERCHANT_CONSOLE_APPLICATION_STARTUP + '",')) return null;
  let startup, selection;
  try { startup = JSON.parse(text); selection = JSON.parse(option(request, '--managed-console-selection')); }
  catch { need(false, 'APPLICATION_MERCHANT_CONSOLE_STARTUP_CHANGED'); }
  need(selection?.configuration?.file === absolute(option(request, '--config')) &&
    selection?.console?.directory === absolute(option(request, '--operator-console-dir')) &&
    selection?.authorization?.tokenEnv === (option(request, '--token-env', true) ?? 'MCP_ACCESS_TOKEN') &&
    (selection?.authorization?.configurationFile ?? undefined) === option(request, '--oauth-config', true),
  'APPLICATION_MERCHANT_CONSOLE_STARTUP_CHANGED');
  const sourceRoot = join(absolute(request.releaseDirectory), 'source');
  const native = await import(pathToFileURL(join(sourceRoot, ROOT + 'managed.mjs')).href);
  const rawPort = option(request, '--port', true) ?? '0';
  need(/^(0|[1-9]\d*)$/.test(rawPort) && Number(rawPort) <= 65535,
    'APPLICATION_MERCHANT_CONSOLE_STARTUP_CHANGED');
  return native.verifyManagedMerchantConsoleStartup(startup, {
    selection, sourceRoot, port: Number(rawPort), ...(context.pid ? { pid: context.pid } : {}),
  });
}
