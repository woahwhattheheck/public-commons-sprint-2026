#!/usr/bin/env node
// MIT. One original World Bank model shared by its managed browser and merchant MCP.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMerchantConfig } from './config.mjs';

export const WORLDBANK_AGENT_BINDING_SCHEMA = 'stellar-forge.worldbank-agent-binding.v1';
export const WORLDBANK_AGENT_STARTUP_SCHEMA = 'stellar-forge.worldbank-agent-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function need(value, code, message = code) {
  if (value) return;
  const error = new Error(message); error.code = code; throw error;
}
function portNumber(value, label) {
  need(Number.isInteger(value) && value >= 0 && value <= 65535,
    'WORLDBANK_AGENT_PORT', label + ' must be an integer from 0 through 65535.');
  return value;
}
async function originalConfiguration(input, kind) {
  const path = await realpath(resolve(input));
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.size > 0n && before.size <= 1048576n &&
      (process.platform === 'win32' || (before.mode & 0o077n) === 0n &&
        (!process.getuid || before.uid === BigInt(process.getuid()))),
      'WORLDBANK_AGENT_CONFIGURATION', 'Select the original owned private merchant connection JSON.');
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    need(bytes.length <= 1048576 && before.size === after.size && before.ino === after.ino &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
      'WORLDBANK_AGENT_CONFIGURATION_CHANGED', 'The connection changed while it was being read.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'WORLDBANK_AGENT_CONFIGURATION', 'Select the original UTF-8 connection JSON.'); }
    return { value, identity: { kind, path, bytes: bytes.length, sha256: sha256(bytes) } };
  } finally { await file.close(); }
}
/** Read the same host declarations without starting a browser, model or merchant. */
export async function inspectWorldBankAgentBinding({ configPath, workspace } = {}) {
  need(typeof configPath === 'string' && configPath.length > 0 &&
    typeof workspace === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(workspace),
    'WORLDBANK_AGENT_SELECTION', 'Select the merchant configuration and its declared World Bank workspace alias.');
  const merchant = await originalConfiguration(configPath, 'merchant');
  need(typeof merchant.value?.worldbankWorkspaceConnection === 'string',
    'WORLDBANK_AGENT_CONNECTION', 'The merchant configuration must declare worldbankWorkspaceConnection.');
  const connection = await originalConfiguration(
    resolve(dirname(merchant.identity.path), merchant.value.worldbankWorkspaceConnection), 'worldbank');
  const config = await readMerchantConfig(merchant.identity.path);
  const selected = config.worldbankWorkspaces?.workspaces?.[workspace];
  need(selected, 'WORLDBANK_AGENT_WORKSPACE', 'Select a World Bank alias from this merchant configuration.');
  const directory = await realpath(selected.directory), info = await lstat(directory);
  need(info.isDirectory() && !info.isSymbolicLink(), 'WORLDBANK_AGENT_DIRECTORY',
    'Use the original retained World Bank directory.');
  const originals = [merchant, connection];
  for (const original of originals) {
    const current = await originalConfiguration(original.identity.path, original.identity.kind);
    need(JSON.stringify(current.identity) === JSON.stringify(original.identity),
      'WORLDBANK_AGENT_CONFIGURATION_CHANGED', 'Review the current connection files after their change.');
  }
  const identity = {
    schema: WORLDBANK_AGENT_BINDING_SCHEMA,
    configFile: merchant.identity.path, workspace, workspaceDirectory: directory,
    directoryIdentity: { device: String(info.dev), inode: String(info.ino) },
    publisherDirectory: join(directory, 'publisher'),
    releaseStore: config.releaseStore, exportsDirectory: config.exportsDirectory,
    python: selected.python ?? null,
    configurationFiles: originals.map(value => value.identity),
  };
  return { ...identity, bindingSha256: sha256(JSON.stringify(identity)) };
}
/** Start the maintained MCP host once and borrow its already-opened browser model. */
export async function startWorldBankAgentWorkspace({
  configPath, workspace, port = 0, mcpPort = 0, tokenEnv = 'MCP_ACCESS_TOKEN',
  environment = process.env, expectedBindingSha256, signal,
} = {}) {
  portNumber(port, 'Browser port'); portNumber(mcpPort, 'Agent port');
  need(typeof tokenEnv === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(tokenEnv),
    'WORLDBANK_AGENT_TOKEN_ENV', 'Select the host environment name containing the MCP access token.');
  need(expectedBindingSha256 === undefined || HASH.test(expectedBindingSha256),
    'WORLDBANK_AGENT_BINDING', 'Use the binding SHA-256 returned by inspect.');
  signal?.throwIfAborted();
  const binding = await inspectWorldBankAgentBinding({ configPath, workspace });
  need(expectedBindingSha256 === undefined || expectedBindingSha256 === binding.bindingSha256,
    'WORLDBANK_AGENT_BINDING_CHANGED', 'Review the current merchant and World Bank configuration before starting.');
  signal?.throwIfAborted();
  const { startMerchantMcp } = await import('./serve.mjs');
  const host = await startMerchantMcp({
    configPath: binding.configFile, port: mcpPort, tokenEnv, environment,
  });
  let closing;
  const close = () => closing ??= Promise.resolve().then(() => host.close());
  try {
    signal?.throwIfAborted();
    const current = await inspectWorldBankAgentBinding({ configPath: binding.configFile, workspace });
    need(current.bindingSha256 === binding.bindingSha256, 'WORLDBANK_AGENT_BINDING_CHANGED',
      'The original connection changed while the merchant host was starting.');
    const opened = await host.operator.call('merchant_worldbank_open', { workspace });
    need(opened.workspace === workspace && opened.state === 'OPEN' && UUID.test(opened.instanceId ?? ''),
      'WORLDBANK_AGENT_OPEN', 'The original World Bank model must identify its opened instance.');
    signal?.throwIfAborted();
    const browser = await host.operator.call('merchant_worldbank_browser', { workspace, action: 'open', port });
    need(browser.workspace === workspace && browser.instanceId === opened.instanceId &&
      browser.browser === 'OPEN' && browser.launch?.schema === 'stellar-forge.worldbank-workspace-launch.v1' &&
      browser.launch.instanceId === opened.instanceId &&
      UUID.test(browser.launch.browserInstanceId ?? ''),
      'WORLDBANK_AGENT_BROWSER', 'The browser must belong to this same opened World Bank model.');
    signal?.throwIfAborted();
    const startup = {
      schema: WORLDBANK_AGENT_STARTUP_SCHEMA, state: 'LISTENING',
      configFile: binding.configFile, workspace, bindingSha256: binding.bindingSha256,
      workspaceDirectory: binding.workspaceDirectory,
      publisherDirectory: binding.publisherDirectory, releaseStore: binding.releaseStore,
      instanceId: opened.instanceId, browserInstanceId: browser.launch.browserInstanceId,
      startedAt: browser.launch.startedAt, operatorUrl: browser.url, mcpUrl: host.url,
    };
    return { startup, url: browser.url, operator: host.operator, server: host.server, close };
  } catch (error) {
    try { await close(); }
    catch (shutdown) { throw new AggregateError([error, shutdown], 'World Bank startup and original owner shutdown failed.'); }
    throw error;
  }
}
const HELP = [
  'World Bank economic workspace', '',
  '  starforge worldbank-agent inspect --config MERCHANT_JSON --workspace ALIAS',
  '  starforge worldbank-agent serve --config MERCHANT_JSON --workspace ALIAS',
  '    [--port 0] [--mcp-port 0] [--token-env MCP_ACCESS_TOKEN]',
  '    [--expected-binding-sha256 SHA256]', '',
  'The merchant JSON declares worldbankWorkspaceConnection. The original browser',
  'and 22 World Bank MCP tools share one model, retained captures, reviews, source',
  'exports, publisher and buyer preparation. The configured token value stays in',
  'the host environment or the Applications private environment JSON.', '',
].join('\n');
function optionsFor(argv) {
  const action = argv[0];
  if (!action || ['help', '--help', '-h'].includes(action)) return { help: true };
  need(['inspect', 'serve'].includes(action), 'WORLDBANK_AGENT_ARGUMENT', 'Choose inspect or serve.');
  const allowed = new Set(['--config', '--workspace', '--port', '--mcp-port', '--token-env', '--expected-binding-sha256']);
  const options = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    need(allowed.has(name) && !options.has(name) && typeof value === 'string' &&
      value.length > 0 && !value.startsWith('--'), 'WORLDBANK_AGENT_ARGUMENT',
      'Use each named option once with its value.');
    options.set(name, value);
  }
  need(options.has('--config') && options.has('--workspace'), 'WORLDBANK_AGENT_SELECTION',
    'Select --config MERCHANT_JSON and --workspace ALIAS.');
  if (action === 'inspect') need([...options.keys()].every(name => ['--config', '--workspace'].includes(name)),
    'WORLDBANK_AGENT_ARGUMENT', 'Inspection takes only the configuration and workspace selection.');
  const port = name => {
    const value = options.get(name) ?? '0';
    need(/^(0|[1-9]\d*)$/.test(value), 'WORLDBANK_AGENT_PORT', 'Use an integer local port.');
    return portNumber(Number(value), name);
  };
  return { action, configPath: options.get('--config'), workspace: options.get('--workspace'),
    port: port('--port'), mcpPort: port('--mcp-port'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
    expectedBindingSha256: options.get('--expected-binding-sha256') };
}
export async function main(argv = process.argv.slice(2)) {
  const options = optionsFor(argv);
  if (options.help) { process.stdout.write(HELP); return; }
  if (options.action === 'inspect') {
    const binding = await inspectWorldBankAgentBinding(options);
    process.stdout.write(JSON.stringify(binding) + '\n'); return binding;
  }
  const controller = new AbortController();
  let application, stopping;
  const shutdown = signal => {
    if (stopping) return;
    stopping = signal; controller.abort();
    if (application) void application.close().then(() => { process.exitCode = signal === 'SIGINT' ? 130 : 143; })
      .catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'WORLDBANK_AGENT_CLOSE', message: error.message }) + '\n'); process.exitCode = 1; });
  };
  const interrupt = () => shutdown('SIGINT'), terminate = () => shutdown('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    application = await startWorldBankAgentWorkspace({ ...options, signal: controller.signal });
    process.stdout.write(JSON.stringify(application.startup) + '\n');
    return application;
  } catch (error) {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    if (stopping && controller.signal.aborted) { process.exitCode = stopping === 'SIGINT' ? 130 : 143; return; }
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'WORLDBANK_AGENT_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
