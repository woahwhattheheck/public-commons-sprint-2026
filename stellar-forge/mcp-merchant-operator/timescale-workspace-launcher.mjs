#!/usr/bin/env node
// MIT. One original merchant MCP owner and its borrowed Timescale browser.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMerchantConfig } from './config.mjs';

export const TIMESCALE_AGENT_BINDING_SCHEMA = 'stellar-forge.timescale-agent-workspace-binding.v1';
export const TIMESCALE_AGENT_STARTUP_SCHEMA = 'stellar-forge.timescale-agent-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_CONFIG_BYTES = 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function need(condition, code, message) {
  if (condition) return;
  const error = new Error(message ?? code);
  error.code = code;
  throw error;
}
function selectedPort(value, label) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= 65535,
    'TIMESCALE_AGENT_PORT_INVALID', label + ' must be an integer from 0 through 65535.');
  return value;
}
async function originalConfiguration(path, kind) {
  const canonical = await realpath(resolve(path));
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size > 0 && before.size <= MAX_CONFIG_BYTES,
      'TIMESCALE_AGENT_CONFIG_INVALID', 'Use the original bounded merchant configuration file.');
    const bytes = Buffer.allocUnsafe(before.size);
    let position = 0;
    while (position < bytes.length) {
      const result = await handle.read(bytes, position, Math.min(65536, bytes.length - position), position);
      need(result.bytesRead > 0, 'TIMESCALE_AGENT_CONFIG_CHANGED', 'The original configuration changed during reading.');
      position += result.bytesRead;
    }
    const after = await handle.stat();
    need(before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'TIMESCALE_AGENT_CONFIG_CHANGED',
      'The original configuration changed during reading.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'TIMESCALE_AGENT_CONFIG_INVALID', 'Use the original UTF-8 merchant configuration JSON.'); }
    return { value, identity: { kind, path: canonical, bytes: bytes.length, sha256: sha256(bytes) } };
  } finally { await handle.close(); }
}

/** Inspect declarations without creating a publisher, scheduler, browser or project. */
export async function inspectTimescaleAgentBinding({ configPath, workspace } = {}) {
  need(typeof configPath === 'string' && configPath.length > 0 &&
    typeof workspace === 'string' && workspace.length > 0 && workspace.length <= 64,
    'TIMESCALE_AGENT_SELECTION_REQUIRED', 'Select an original merchant configuration and Timescale workspace alias.');
  const merchant = await originalConfiguration(configPath, 'merchant');
  const configFile = merchant.identity.path;
  const originals = [merchant];
  for (const [key, kind] of [['publisherConnection', 'publishers'], ['timescaleWorkspaceConnection', 'timescale']]) {
    need(typeof merchant.value?.[key] === 'string' && merchant.value[key].length > 0,
      'TIMESCALE_AGENT_CONNECTION_REQUIRED', 'The merchant configuration must declare its original publisher and Timescale connection files.');
    originals.push(await originalConfiguration(resolve(dirname(configFile), merchant.value[key]), kind));
  }
  const config = await readMerchantConfig(configFile);
  need(config.timescaleWorkspaces?.workspaces && Object.hasOwn(config.timescaleWorkspaces.workspaces, workspace),
    'TIMESCALE_AGENT_WORKSPACE_UNKNOWN', 'Select an Timescale alias declared by this merchant host.');
  const selected = config.timescaleWorkspaces.workspaces[workspace];
  const publisher = config.publishers?.workspaces?.[selected.publisher];
  need(publisher?.kind === 'timescale' && typeof publisher.directory === 'string',
    'TIMESCALE_AGENT_PUBLISHER_INVALID', 'The selected workspace must use its declared original Timescale publisher.');
  // The original parser remains the configuration authority. Retain the exact
  // three declarations it consumed, then confirm they did not change in review.
  for (const original of originals) {
    const current = await originalConfiguration(original.identity.path, original.identity.kind);
    need(JSON.stringify(current.identity) === JSON.stringify(original.identity),
      'TIMESCALE_AGENT_CONFIG_CHANGED', 'The original configuration changed during review; inspect its current declarations.');
  }
  const identity = {
    schema: TIMESCALE_AGENT_BINDING_SCHEMA, configFile, workspace,
    publisher: selected.publisher, publisherDirectory: publisher.directory, workspaceId: selected.workspaceId,
    releaseStore: config.releaseStore,
    configurationFiles: originals.map(original => original.identity),
  };
  return { ...identity, bindingSha256: sha256(JSON.stringify(identity)) };
}

/** Open the MCP owner once; the browser borrows its existing Timescale resources. */
export async function startTimescaleAgentWorkspace({
  configPath, workspace, port = 0, mcpPort = 0, tokenEnv = 'MCP_ACCESS_TOKEN',
  environment = process.env, expectedBindingSha256, woocommerceFetchImpl,
} = {}) {
  selectedPort(port, 'Browser port');
  selectedPort(mcpPort, 'MCP port');
  need(typeof tokenEnv === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv),
    'TIMESCALE_AGENT_TOKEN_ENV_INVALID', 'Select the existing host environment name for MCP authentication.');
  need(expectedBindingSha256 === undefined || HASH.test(expectedBindingSha256),
    'TIMESCALE_AGENT_BINDING_INVALID', 'Use the SHA-256 returned by the original configuration inspection.');
  const binding = await inspectTimescaleAgentBinding({ configPath, workspace });
  need(expectedBindingSha256 === undefined || expectedBindingSha256 === binding.bindingSha256,
    'TIMESCALE_AGENT_BINDING_CHANGED', 'Review the current merchant configuration before starting this workspace.');
  const { startMerchantMcp } = await import('./serve.mjs');
  const host = await startMerchantMcp({
    configPath: binding.configFile, port: mcpPort, tokenEnv, environment, woocommerceFetchImpl,
  });
  let closing;
  const close = () => {
    if (closing) return closing;
    closing = Promise.resolve().then(() => host.close()).catch(issue => { closing = null; throw issue; });
    return closing;
  };
  try {
    const current = await inspectTimescaleAgentBinding({ configPath: binding.configFile, workspace });
    need(current.bindingSha256 === binding.bindingSha256,
      'TIMESCALE_AGENT_BINDING_CHANGED', 'The merchant configuration changed while starting its original host.');
    const opened = await host.operator.call('merchant_timescale_open', { workspace });
    need(opened.workspace === workspace && opened.publisher === binding.publisher &&
      opened.workspaceId === binding.workspaceId && UUID.test(opened.workspaceId ?? '') && UUID.test(opened.instanceId ?? '') &&
      UUID.test(opened.publisherInstanceId ?? ''), 'TIMESCALE_AGENT_STARTUP_CHANGED',
      'The native workspace must identify its original publisher and project.');
    const browser = await host.operator.call('merchant_timescale_browser', {
      workspace, workspaceId: opened.workspaceId, action: 'open', port,
    });
    need(browser.result?.state === 'OPEN' && typeof browser.result.url === 'string',
      'TIMESCALE_AGENT_BROWSER_UNAVAILABLE', 'The original Timescale browser did not announce its listener.');
    const startup = {
      schema: TIMESCALE_AGENT_STARTUP_SCHEMA, status: 'TIMESCALE_AGENT_READY',
      configFile: binding.configFile, bindingSha256: binding.bindingSha256,
      workspace, publisher: binding.publisher, publisherDirectory: binding.publisherDirectory,
      releaseStore: binding.releaseStore,
      workspaceId: opened.workspaceId, instanceId: opened.instanceId,
      publisherInstanceId: opened.publisherInstanceId,
      operatorUrl: browser.result.url, mcpUrl: host.url,
    };
    return { startup, operator: host.operator, server: host.server, url: startup.operatorUrl, close };
  } catch (error) {
    try { await close(); }
    catch (shutdown) { throw new AggregateError([error, shutdown], 'Timescale startup and original owner shutdown failed.'); }
    throw error;
  }
}

const HELP = `Timescale merchant workspace

  starforge timescale-agent inspect --config MERCHANT_JSON --workspace ALIAS
  starforge timescale-agent serve --config MERCHANT_JSON --workspace ALIAS
    [--port 0] [--mcp-port 0] [--token-env MCP_ACCESS_TOKEN]
    [--expected-binding-sha256 SHA256]

Use the original merchant-mcp.json with publisherConnection and
timescaleWorkspaceConnection. Serve opens one merchant MCP owner and its borrowed
Timescale browser. Both use the same saved publisher, project and scheduler.
Set the selected MCP token environment variable in the host environment.
`;

function argumentsFor(argv) {
  const action = argv[0];
  if (!action || ['--help', '-h', 'help'].includes(action)) return { help: true };
  need(['inspect', 'serve'].includes(action), 'TIMESCALE_AGENT_ARGUMENT_INVALID', 'Choose inspect or serve.');
  const allowed = new Set(['--config', '--workspace', '--port', '--mcp-port', '--token-env', '--expected-binding-sha256']);
  const options = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    need(allowed.has(name) && !options.has(name) && typeof value === 'string' &&
      value.length > 0 && !value.startsWith('--'), 'TIMESCALE_AGENT_ARGUMENT_INVALID',
      'Use each named option once with its value.');
    options.set(name, value);
  }
  need(options.has('--config') && options.has('--workspace'), 'TIMESCALE_AGENT_SELECTION_REQUIRED',
    'Select --config MERCHANT_JSON and --workspace ALIAS.');
  if (action === 'inspect') need([...options.keys()].every(name => ['--config', '--workspace'].includes(name)),
    'TIMESCALE_AGENT_ARGUMENT_INVALID', 'Inspection accepts only the configuration and workspace selection.');
  const port = name => {
    const value = options.get(name) ?? '0';
    need(/^(0|[1-9]\d*)$/.test(value), 'TIMESCALE_AGENT_PORT_INVALID', 'Use an integer port from 0 through 65535.');
    return selectedPort(Number(value), name);
  };
  return {
    action, configPath: options.get('--config'), workspace: options.get('--workspace'),
    port: port('--port'), mcpPort: port('--mcp-port'),
    tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
    expectedBindingSha256: options.get('--expected-binding-sha256'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  if (options.help) { process.stdout.write(HELP); return; }
  if (options.action === 'inspect') {
    const binding = await inspectTimescaleAgentBinding(options);
    process.stdout.write(JSON.stringify(binding) + '\n');
    return binding;
  }
  const application = await startTimescaleAgentWorkspace(options);
  const shutdown = signal => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    application.close().then(() => { process.exitCode = signal === 'SIGINT' ? 130 : 143; })
      .catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'TIMESCALE_AGENT_CLOSE_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
  };
  const interrupt = () => shutdown('SIGINT'), terminate = () => shutdown('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  process.stdout.write(JSON.stringify(application.startup) + '\n');
  return application;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'TIMESCALE_AGENT_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
