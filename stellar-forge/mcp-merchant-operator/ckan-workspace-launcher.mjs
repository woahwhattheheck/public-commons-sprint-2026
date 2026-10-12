#!/usr/bin/env node
// MIT. One original CKAN merchant owner for Applications, browser and MCP.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMerchantConfig } from './config.mjs';

export const CKAN_AGENT_BINDING_SCHEMA = 'stellar-forge.ckan-agent-binding.v1';
export const CKAN_AGENT_SELECTION_SCHEMA = 'stellar-forge.ckan-agent-selection.v1';
export const CKAN_AGENT_STARTUP_SCHEMA = 'stellar-forge.ckan-agent-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CKAN = 'stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/';
const MCP = 'stellar-forge/mcp-merchant-operator/';
const SOURCE_FILES = [
  ...['ckan-workspace-launcher.mjs', 'ckan-workspace.mjs', 'config.mjs', 'operator.mjs', 'serve.mjs'].map(name => MCP + name),
  ...['model.mjs', 'server.mjs', 'source.mjs', 'capture.mjs', 'semantics.mjs', 'declaration.mjs',
    'public/index.html', 'public/app.mjs', 'public/style.css'].map(name => CKAN + name),
].sort();
const originalSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
function need(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), { code });
}
function portNumber(value) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= 65535, 'CKAN_AGENT_PORT_INVALID',
    'Use an integer MCP port from 0 through 65535.');
  return value;
}
async function originalFile(path, { privateOnly = false, maximum = 1048576 } = {}) {
  const canonical = await realpath(resolve(path));
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size > 0 && before.size <= maximum &&
      (!privateOnly || before.nlink === 1 && !(before.mode & 0o077)),
      'CKAN_AGENT_FILE_INVALID', 'Select the original regular file with its required private permissions.');
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      need(result.bytesRead > 0, 'CKAN_AGENT_FILE_CHANGED');
      offset += result.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(canonical);
    need(before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && named.dev === after.dev && named.ino === after.ino,
      'CKAN_AGENT_FILE_CHANGED', 'The selected file changed during review; read its current version.');
    return { bytes, identity: { path: canonical, bytes: bytes.length, sha256: hash(bytes) } };
  } finally { await handle.close(); }
}
function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'CKAN_AGENT_JSON_INVALID', 'Use the original UTF-8 JSON file.'); }
}
function projectIdentity(directory, value) {
  need(plain(value) && value.schema === 'stellar-forge.ckan-workbench.v1' &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.catalogOrigin === 'string', 'CKAN_AGENT_PROJECT_INVALID');
  return { directory, createdAt: value.createdAt, catalogOrigin: value.catalogOrigin,
    authTokenEnv: value.authTokenEnv ?? null };
}

/** Read the original declarations and stable project identity without acquiring it. */
export async function inspectCkanAgentBinding({ configPath, workspace } = {}) {
  need(typeof configPath === 'string' && configPath.length > 0 &&
    typeof workspace === 'string' && workspace.length > 0 && workspace.length <= 64,
    'CKAN_AGENT_SELECTION_REQUIRED', 'Select a merchant configuration and its CKAN workspace alias.');
  const merchant = await originalFile(configPath, { privateOnly: true });
  const declaration = json(merchant.bytes);
  need(typeof declaration.ckanWorkspaceConnection === 'string' && declaration.ckanWorkspaceConnection,
    'CKAN_AGENT_CONNECTION_REQUIRED', 'The merchant configuration must contain ckanWorkspaceConnection.');
  const connection = await originalFile(resolve(dirname(merchant.identity.path), declaration.ckanWorkspaceConnection),
    { privateOnly: true });
  const config = await readMerchantConfig(merchant.identity.path);
  need(plain(config.ckanWorkspaces?.workspaces) && Object.hasOwn(config.ckanWorkspaces.workspaces, workspace),
    'CKAN_AGENT_WORKSPACE_UNKNOWN', 'Choose a CKAN alias declared by this merchant configuration.');
  const directory = config.ckanWorkspaces.workspaces[workspace].directory;
  const retained = await originalFile(join(directory, 'workbench.json'),
    { privateOnly: true, maximum: 16777216 });
  const project = projectIdentity(directory, json(retained.bytes));
  for (const selected of [merchant, connection]) {
    const current = await originalFile(selected.identity.path, { privateOnly: true });
    need(JSON.stringify(current.identity) === JSON.stringify(selected.identity),
      'CKAN_AGENT_BINDING_CHANGED', 'Review the current merchant and CKAN connection files.');
  }
  const identity = {
    schema: CKAN_AGENT_BINDING_SCHEMA, configFile: merchant.identity.path, workspace, project,
    releaseStore: config.releaseStore, releaseStoreMatches: config.releaseStore === join(directory, 'seller-releases'),
    configurationFiles: [merchant.identity, connection.identity],
  };
  return { ...identity, bindingSha256: hash(JSON.stringify(identity)) };
}

async function sourceIdentity(sourceRoot) {
  const root = await realpath(resolve(sourceRoot)), files = [];
  for (const name of SOURCE_FILES) {
    const current = await originalFile(join(root, name), { maximum: 4194304 });
    need(current.identity.path === join(root, name), 'CKAN_AGENT_SOURCE_CHANGED');
    files.push({ name, bytes: current.identity.bytes, sha256: current.identity.sha256 });
  }
  return { root, files, sha256: hash(JSON.stringify(files)) };
}
export async function prepareCkanManagedSelection({ configPath, workspace, sourceRoot = originalSourceRoot } = {}) {
  const binding = await inspectCkanAgentBinding({ configPath, workspace });
  const source = await sourceIdentity(sourceRoot);
  return { schema: CKAN_AGENT_SELECTION_SCHEMA, binding, source };
}
function selectionValue(value) {
  const selected = typeof value === 'string' ? json(Buffer.from(value)) : value;
  need(plain(selected) && selected.schema === CKAN_AGENT_SELECTION_SCHEMA &&
    plain(selected.binding) && selected.binding.schema === CKAN_AGENT_BINDING_SCHEMA &&
    HASH.test(selected.binding.bindingSha256 ?? '') && plain(selected.source) &&
    HASH.test(selected.source.sha256 ?? '') && Array.isArray(selected.source.files) &&
    JSON.stringify(selected.source.files.map(file => file.name)) === JSON.stringify(SOURCE_FILES) &&
    hash(JSON.stringify(selected.source.files)) === selected.source.sha256,
    'CKAN_AGENT_SELECTION_INVALID', 'Use the complete selection returned by the original installed launcher.');
  return selected;
}
function localUrl(value, { capability = false, port = 0 } = {}) {
  let url;
  try { url = new URL(value); } catch { need(false, 'CKAN_AGENT_LISTENER_INVALID'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && actualPort >= 1 && actualPort <= 65535 &&
    (!port || actualPort === port) && (capability
      ? url.pathname === '/' && /^#[A-Za-z0-9_-]{43}$/.test(url.hash)
      : ['/', '/mcp'].includes(url.pathname) && !url.hash),
    'CKAN_AGENT_LISTENER_INVALID', 'Use the original local CKAN browser and MCP listeners.');
  return url;
}
async function launchIdentity(url) {
  const response = await fetch(new URL('/api/launch', url), {
    headers: { authorization: 'Bearer ' + url.hash.slice(1) },
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200 && response.headers.get('content-type')?.startsWith('application/json'),
    'CKAN_AGENT_LISTENER_UNAVAILABLE', 'The original authenticated CKAN listener did not answer.');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      need(length <= 16384, 'CKAN_AGENT_LISTENER_INVALID');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return json(Buffer.concat(chunks));
}

/** Match the selected project to the actual adopted source and authenticated child. */
export async function verifyCkanAgentStartup(value, { selection, launchSourceRoot, port = 0, pid } = {}) {
  const selected = selectionValue(selection), binding = selected.binding;
  portNumber(port);
  need(plain(value) && value.schema === CKAN_AGENT_STARTUP_SCHEMA && value.status === 'CKAN_AGENT_READY' &&
    value.configFile === binding.configFile && value.workspace === binding.workspace &&
    value.bindingSha256 === binding.bindingSha256 && value.sourceSha256 === selected.source.sha256 &&
    JSON.stringify(value.project) === JSON.stringify(binding.project) &&
    value.sourceRoot === resolve(launchSourceRoot) && UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && (pid === undefined || value.pid === pid) &&
    value.releaseStore === binding.releaseStore && value.releaseStoreMatches === binding.releaseStoreMatches,
    'CKAN_AGENT_STARTUP_CHANGED', 'The startup must identify the reviewed source, project and process.');
  const browser = localUrl(value.operatorUrl, { capability: true }), mcp = localUrl(value.mcpUrl, { port });
  need(browser.origin !== mcp.origin, 'CKAN_AGENT_STARTUP_CHANGED');
  const live = await launchIdentity(browser);
  need(live.schema === 'stellar-forge.ckan-workbench-listener.v1' &&
    live.instanceId === value.instanceId && live.pid === value.pid &&
    JSON.stringify(projectIdentity(live.directory, live.project)) === JSON.stringify(binding.project),
    'CKAN_AGENT_STARTUP_CHANGED', 'Open the listener owned by this same CKAN project instance.');
  return { url: browser.href, original: {
    schema: CKAN_AGENT_STARTUP_SCHEMA, configFile: binding.configFile, workspace: binding.workspace,
    project: binding.project, bindingSha256: binding.bindingSha256, sourceSha256: selected.source.sha256,
    sourceRoot: value.sourceRoot, instanceId: value.instanceId, pid: value.pid, mcpUrl: mcp.href,
    releaseStore: binding.releaseStore, releaseStoreMatches: binding.releaseStoreMatches,
  } };
}

/** The original merchant owner opens and closes its CKAN model and browser once. */
export async function startCkanAgentWorkspace({
  configPath, workspace, port = 0, tokenEnv = 'MCP_ACCESS_TOKEN',
  environment = process.env, selection, woocommerceFetchImpl,
} = {}) {
  portNumber(port);
  need(typeof tokenEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv),
    'CKAN_AGENT_TOKEN_ENV_INVALID', 'Select the existing environment name for MCP authentication.');
  const current = await prepareCkanManagedSelection({ configPath, workspace });
  const selected = selection === undefined ? current : selectionValue(selection);
  need(current.binding.bindingSha256 === selected.binding.bindingSha256 &&
    current.source.sha256 === selected.source.sha256, 'CKAN_AGENT_SELECTION_CHANGED',
    'Review this application again after changing its configuration or installed source.');
  const { startMerchantMcp } = await import('./serve.mjs');
  const host = await startMerchantMcp({ configPath: current.binding.configFile, port, tokenEnv, environment, woocommerceFetchImpl });
  let closing;
  const close = () => closing ??= Promise.resolve().then(() => host.close());
  try {
    const opened = await host.operator.call('merchant_ckan_open', { workspace });
    const after = await prepareCkanManagedSelection({ configPath: current.binding.configFile, workspace });
    need(after.binding.bindingSha256 === current.binding.bindingSha256 &&
      after.source.sha256 === current.source.sha256 && opened.workspace === workspace &&
      UUID.test(opened.instanceId ?? ''), 'CKAN_AGENT_SELECTION_CHANGED');
    const startup = {
      schema: CKAN_AGENT_STARTUP_SCHEMA, status: 'CKAN_AGENT_READY',
      configFile: current.binding.configFile, workspace, project: current.binding.project,
      bindingSha256: current.binding.bindingSha256, sourceRoot: current.source.root,
      sourceSha256: current.source.sha256, instanceId: opened.instanceId, pid: process.pid,
      operatorUrl: opened.browserUrl, mcpUrl: host.url,
      releaseStore: current.binding.releaseStore, releaseStoreMatches: current.binding.releaseStoreMatches,
    };
    await verifyCkanAgentStartup(startup, { selection: selected, launchSourceRoot: current.source.root, port, pid: process.pid });
    return { startup, operator: host.operator, server: host.server, url: startup.operatorUrl, close };
  } catch (error) {
    try { await close(); } catch (shutdown) { throw new AggregateError([error, shutdown], 'CKAN startup and shutdown failed.'); }
    throw error;
  }
}

const HELP = 'CKAN merchant workspace\n\n' +
  '  stellar-forge ckan-agent inspect --config MERCHANT_JSON --workspace ALIAS\n' +
  '  stellar-forge ckan-agent serve --config MERCHANT_JSON --workspace ALIAS\n' +
  '    [--port 0] [--token-env MCP_ACCESS_TOKEN] [--managed-selection JSON]\n\n' +
  'Select the original private merchant-mcp.json and declared CKAN project alias.\n' +
  'The port is the authenticated merchant MCP port; the browser chooses its own\n' +
  'free local port. One original host owns both. Stop drains that host and releases\n' +
  'the project; serve reopens its retained captures, publications and customer files.\n';
export async function main(argv = process.argv.slice(2)) {
  const action = argv[0];
  if (!action || ['help', '--help', '-h'].includes(action)) { process.stdout.write(HELP); return; }
  need(['inspect', 'serve'].includes(action), 'CKAN_AGENT_ARGUMENT_INVALID', 'Choose inspect or serve.');
  const allowed = new Set(['--config', '--workspace', '--port', '--token-env', '--managed-selection']);
  const options = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    need(allowed.has(name) && !options.has(name) && typeof value === 'string' && value.length > 0 &&
      !value.startsWith('--'), 'CKAN_AGENT_ARGUMENT_INVALID', 'Use each named option once with its value.');
    options.set(name, value);
  }
  const configPath = options.get('--config'), workspace = options.get('--workspace');
  if (action === 'inspect') {
    need([...options.keys()].every(name => ['--config', '--workspace'].includes(name)), 'CKAN_AGENT_ARGUMENT_INVALID');
    const selected = await prepareCkanManagedSelection({ configPath, workspace });
    process.stdout.write(JSON.stringify(selected) + '\n'); return selected;
  }
  const rawPort = options.get('--port') ?? '0';
  need(/^(0|[1-9]\d*)$/.test(rawPort), 'CKAN_AGENT_PORT_INVALID');
  const application = await startCkanAgentWorkspace({
    configPath, workspace, port: Number(rawPort), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
    selection: options.get('--managed-selection'),
  });
  const shutdown = () => {
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
    application.close().catch(error => {
      process.stderr.write(JSON.stringify({ error: error.code ?? 'CKAN_AGENT_CLOSE_FAILED', message: error.message }) + '\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  process.stdout.write(JSON.stringify(application.startup) + '\n');
  return application;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'CKAN_AGENT_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
