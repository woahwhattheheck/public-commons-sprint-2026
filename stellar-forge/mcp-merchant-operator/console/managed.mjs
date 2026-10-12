// MIT. The original merchant console under the existing Applications owner.
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, plain, need, digest, regular, privateDirectory, operationLease } from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export const MERCHANT_CONSOLE_SELECTION_SCHEMA = 'stellar-forge.merchant-console-selection.v1';
export const MERCHANT_CONSOLE_STARTUP_SCHEMA = 'stellar-forge.merchant-console-startup.v1';
export const MERCHANT_CONSOLE_BINDING_SCHEMA = 'stellar-forge.merchant-console-binding.v1';
export const MERCHANT_CONSOLE_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT = 'stellar-forge/mcp-merchant-operator/';
const CONSOLE_SCHEMA = 'stellar-forge.merchant-operator-console.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => digest(canonical(value));
const equal = (left, right) => canonical(left) === canonical(right);
export const MERCHANT_CONSOLE_SOURCE_FILES = Object.freeze([
  ...['serve.mjs', 'operator.mjs', 'config.mjs', 'host-files.mjs', 'catalog.mjs', 'providers.mjs',
    'provider-lifecycle.mjs', 'instructions.mjs', 'client-exports.mjs', 'retained-file-reads.mjs',
    'console/managed.mjs', 'console/service.mjs', 'console/store.mjs', 'console/customers.mjs',
    'console/public/index.html', 'console/public/app.mjs', 'console/public/style.css'].map(path => ROOT + path),
  'stellar-forge/mcp-paid-agent/http-tools.mjs',
  'stellar-forge/mcp-paid-agent/oauth-host.mjs',
  'stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs',
]);

async function originalFile(path, maximum = 1024 * 1024) {
  path = absolute(path);
  need(await realpath(path) === path, 'MERCHANT_CONSOLE_REAL_FILE_REQUIRED');
  const bytes = await regular(path, maximum);
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}
export async function merchantConsoleSource(sourceRoot = MERCHANT_CONSOLE_SOURCE_ROOT) {
  sourceRoot = absolute(sourceRoot);
  need(await realpath(sourceRoot) === sourceRoot, 'MERCHANT_CONSOLE_SOURCE_ROOT');
  const files = [];
  for (const name of MERCHANT_CONSOLE_SOURCE_FILES) {
    const file = await originalFile(join(sourceRoot, name), 8 * 1024 * 1024);
    files.push({ name, bytes: file.bytes, sha256: file.sha256 });
  }
  return { root: sourceRoot, files, sha256: hash(files) };
}

/** Read only the existing original console identity; Review never creates a store. */
export async function inspectMerchantConsoleDirectory(directory) {
  directory = absolute(directory);
  need(await realpath(dirname(directory)) === dirname(directory), 'MERCHANT_CONSOLE_REAL_PARENT_REQUIRED');
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await privateDirectory(dirname(directory));
    return { directory, workspaceId: null };
  }
  need(info.isDirectory() && !info.isSymbolicLink(), 'MERCHANT_CONSOLE_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  const database = join(directory, 'operator.sqlite');
  try {
    const databaseInfo = await lstat(database);
    need(databaseInfo.isFile() && !databaseInfo.isSymbolicLink() && await realpath(database) === database,
      'MERCHANT_CONSOLE_DATABASE_REQUIRED');
  }
  catch (error) {
    if (error.code === 'ENOENT') return { directory, workspaceId: null };
    throw error;
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const schema = db.prepare('SELECT value FROM metadata WHERE key=?').get('schema')?.value;
    const workspaceId = db.prepare('SELECT value FROM metadata WHERE key=?').get('id')?.value;
    need(schema === CONSOLE_SCHEMA && UUID.test(workspaceId ?? ''), 'MERCHANT_CONSOLE_WORKSPACE_CHANGED');
    return { directory, workspaceId };
  } finally { db.close(); }
}

async function configurationSelection(configPath, oauthConfigPath) {
  configPath = absolute(configPath);
  const first = await originalFile(configPath);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(configPath, 1024 * 1024)));
  const paths = new Set([configPath]);
  for (const [name, value] of Object.entries(raw))
    if (name.endsWith('Connection') && value !== undefined) {
      need(typeof value === 'string', 'MERCHANT_CONSOLE_CONFIGURATION_CHANGED');
      paths.add(resolve(dirname(configPath), value));
    }
  if (raw.fleet?.planFile) paths.add(resolve(dirname(configPath), raw.fleet.planFile));
  if (oauthConfigPath) paths.add(absolute(oauthConfigPath));
  const files = [];
  for (const path of [...paths].sort()) files.push(await originalFile(path));
  need(equal(files.find(file => file.path === configPath), first), 'MERCHANT_CONSOLE_CONFIGURATION_CHANGED');
  const { readMerchantConfig } = await import('../config.mjs');
  // Use the original configured metadata reader, preserving its provider ownership.
  const configuration = await readMerchantConfig(configPath);
  for (const file of files)
    need(equal(await originalFile(file.path), file), 'MERCHANT_CONSOLE_CONFIGURATION_CHANGED');
  return { file: configPath, files, fingerprint: hash(configuration) };
}
function selectedAuthorization(tokenEnv, oauthConfigPath, environment) {
  need(typeof tokenEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv),
    'MERCHANT_CONSOLE_TOKEN_ENV_INVALID');
  const selected = oauthConfigPath ?? environment.MCP_OAUTH_CONFIG;
  if (selected) {
    absolute(selected);
    need(!environment[tokenEnv], 'MERCHANT_CONSOLE_AUTH_SELECTION',
      'The original OAuth host requires its fixed bearer token setting to be empty.');
    return { mode: 'oauth', tokenEnv, configurationFile: selected };
  }
  need(typeof environment[tokenEnv] === 'string' && environment[tokenEnv].length >= 24,
    'MERCHANT_CONSOLE_TOKEN_REQUIRED', 'Set the original merchant token in the selected private environment.');
  return { mode: 'fixed-bearer', tokenEnv, configurationFile: null };
}
function selectionShape(selection) {
  need(plain(selection) && selection.schema === MERCHANT_CONSOLE_SELECTION_SCHEMA &&
    plain(selection.configuration) && Array.isArray(selection.configuration.files) &&
    SHA.test(selection.configuration.fingerprint ?? '') && plain(selection.console) &&
    (selection.console.workspaceId === null || UUID.test(selection.console.workspaceId ?? '')) &&
    plain(selection.authorization) && ['fixed-bearer', 'oauth'].includes(selection.authorization.mode) &&
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(selection.authorization.tokenEnv ?? '') &&
    plain(selection.source) && SHA.test(selection.source.sha256 ?? '') &&
    Array.isArray(selection.source.files) && selection.source.files.length === MERCHANT_CONSOLE_SOURCE_FILES.length,
  'MERCHANT_CONSOLE_SELECTION_INVALID');
  absolute(selection.configuration.file); absolute(selection.console.directory); absolute(selection.source.root);
  const paths = new Set();
  for (const file of selection.configuration.files) {
    need(plain(file) && SHA.test(file.sha256 ?? '') && Number.isSafeInteger(file.bytes) && file.bytes >= 0 &&
      file.bytes <= 1024 * 1024 && !paths.has(file.path), 'MERCHANT_CONSOLE_SELECTION_INVALID');
    absolute(file.path); paths.add(file.path);
  }
  need(paths.has(selection.configuration.file), 'MERCHANT_CONSOLE_SELECTION_INVALID');
  if (selection.authorization.mode === 'oauth') {
    absolute(selection.authorization.configurationFile);
    need(paths.has(selection.authorization.configurationFile), 'MERCHANT_CONSOLE_SELECTION_INVALID');
  } else need(selection.authorization.configurationFile === null, 'MERCHANT_CONSOLE_SELECTION_INVALID');
  selection.source.files.forEach((file, index) => need(plain(file) &&
    file.name === MERCHANT_CONSOLE_SOURCE_FILES[index] && SHA.test(file.sha256 ?? '') &&
    Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 8 * 1024 * 1024,
  'MERCHANT_CONSOLE_SELECTION_INVALID'));
  need(hash(selection.source.files) === selection.source.sha256, 'MERCHANT_CONSOLE_SOURCE_CHANGED');
  return selection;
}
export async function prepareMerchantConsoleSelection({
  configPath, consoleDirectory, tokenEnv = 'MCP_ACCESS_TOKEN', oauthConfigPath,
  environment = process.env, sourceRoot = MERCHANT_CONSOLE_SOURCE_ROOT,
} = {}) {
  need(plain(environment), 'MERCHANT_CONSOLE_ENVIRONMENT_REQUIRED');
  const authorization = selectedAuthorization(tokenEnv, oauthConfigPath, environment);
  return selectionShape({
    schema: MERCHANT_CONSOLE_SELECTION_SCHEMA,
    configuration: await configurationSelection(configPath, authorization.configurationFile),
    console: await inspectMerchantConsoleDirectory(consoleDirectory),
    authorization, source: await merchantConsoleSource(sourceRoot),
  });
}

function localUrls(startup, port = 0) {
  let mcp, consoleUrl, openUrl;
  try { mcp = new URL(startup.mcpUrl); consoleUrl = new URL(startup.consoleUrl); openUrl = new URL(startup.openUrl); }
  catch { need(false, 'MERCHANT_CONSOLE_URL_INVALID'); }
  for (const url of [mcp, consoleUrl, openUrl]) {
    need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      !url.username && !url.password && !url.search && Number(url.port || 80) >= 1 &&
      Number(url.port || 80) <= 65535 && (!port || Number(url.port || 80) === port),
    'MERCHANT_CONSOLE_URL_INVALID');
  }
  need(mcp.pathname === '/' && !mcp.hash && consoleUrl.pathname === '/operator/' && !consoleUrl.hash &&
    openUrl.pathname === '/operator/' && mcp.origin === consoleUrl.origin && mcp.origin === openUrl.origin &&
    openUrl.href.length <= 4096, 'MERCHANT_CONSOLE_URL_INVALID');
  const fragment = new URLSearchParams(openUrl.hash.slice(1));
  need([...fragment.keys()].every(key => key === 'token') && [...fragment].length <= 1,
    'MERCHANT_CONSOLE_URL_INVALID');
  const token = fragment.get('token');
  need(startup.authorization?.mode === 'oauth' ? !openUrl.hash :
    typeof token === 'string' && token.length >= 24 && token.length <= 2048,
  'MERCHANT_CONSOLE_AUTH_CHANGED');
  return { mcp, consoleUrl, openUrl, token };
}
async function getBytes(url, path, token, maximum = 4 * 1024 * 1024) {
  let response;
  try {
    response = await fetch(new URL(path, url.origin), {
      ...(token ? { headers: { authorization: 'Bearer ' + token } } : {}),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { need(false, 'MERCHANT_CONSOLE_LISTENER_UNAVAILABLE'); }
  need(response.ok, 'MERCHANT_CONSOLE_LISTENER_CHANGED',
    'The selected original console returned HTTP ' + response.status + '.');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; need(total <= maximum, 'MERCHANT_CONSOLE_RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
function verifyHost(host, startup, selection) {
  need(host.schema === 'stellar-forge.merchant-host-profile.v1' &&
    host.configurationFingerprint === selection.configuration.fingerprint &&
    host.configuration?.sha256 === selection.configuration.files.find(file =>
      file.path === selection.configuration.file)?.sha256 &&
    host.console?.schema === CONSOLE_SCHEMA && host.console.workspaceId === startup.workspaceId &&
    host.console.closing === false && equal(host.console.binding, startup.binding) &&
    host.operator?.closing === false, 'MERCHANT_CONSOLE_LIVE_IDENTITY_CHANGED');
}

/** Bind the original child's announcement, selected source, store and actual interface. */
export async function verifyManagedMerchantConsoleStartup(startup, {
  selection, sourceRoot = MERCHANT_CONSOLE_SOURCE_ROOT, port = 0, pid,
} = {}) {
  selectionShape(selection);
  need(plain(startup) && startup.schema === MERCHANT_CONSOLE_STARTUP_SCHEMA &&
    plain(startup.binding) && UUID.test(startup.workspaceId ?? '') &&
    startup.authorization?.mode === selection.authorization.mode, 'MERCHANT_CONSOLE_STARTUP_INVALID');
  const binding = startup.binding;
  need(binding.schema === MERCHANT_CONSOLE_BINDING_SCHEMA && UUID.test(binding.instanceId ?? '') &&
    Number.isSafeInteger(binding.pid) && binding.pid > 0 && (!pid || binding.pid === pid) &&
    Number.isFinite(Date.parse(binding.startedAt)) && binding.selectionSha256 === hash(selection) &&
    binding.configurationFile === selection.configuration.file &&
    binding.configurationFingerprint === selection.configuration.fingerprint &&
    binding.consoleDirectory === selection.console.directory &&
    binding.selectedSourceRoot === selection.source.root && binding.sourceRoot === absolute(sourceRoot) &&
    binding.sourceSha256 === selection.source.sha256, 'MERCHANT_CONSOLE_STARTUP_CHANGED');
  const source = await merchantConsoleSource(sourceRoot);
  need(source.sha256 === selection.source.sha256 && equal(source.files, selection.source.files),
    'MERCHANT_CONSOLE_SOURCE_CHANGED');
  for (const file of selection.configuration.files)
    need(equal(await originalFile(file.path), file), 'MERCHANT_CONSOLE_CONFIGURATION_CHANGED');
  const workspace = await inspectMerchantConsoleDirectory(selection.console.directory);
  need(workspace.workspaceId === startup.workspaceId &&
    (selection.console.workspaceId === null || selection.console.workspaceId === startup.workspaceId),
  'MERCHANT_CONSOLE_WORKSPACE_CHANGED');
  const urls = localUrls(startup, port);
  const page = await getBytes(urls.consoleUrl, '/operator/', null, 2 * 1024 * 1024);
  need(page.equals(await regular(join(sourceRoot, ROOT + 'console/public/index.html'), 2 * 1024 * 1024)),
    'MERCHANT_CONSOLE_BROWSER_SOURCE_CHANGED');
  if (urls.token) {
    const host = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      await getBytes(urls.consoleUrl, '/operator/api/host', urls.token)));
    verifyHost(host, startup, selection);
  }
  return { url: urls.openUrl.href, original: startup,
    links: [{ id: 'merchant-console', label: 'Merchant operator', url: urls.openUrl.href }] };
}

export async function startManagedMerchantConsole({
  configPath, consoleDirectory, selection, port = 0, tokenEnv = 'MCP_ACCESS_TOKEN',
  oauthConfigPath, environment = process.env,
} = {}) {
  selectionShape(selection);
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'MERCHANT_CONSOLE_PORT_INVALID');
  need(absolute(configPath) === selection.configuration.file &&
    absolute(consoleDirectory) === selection.console.directory &&
    tokenEnv === selection.authorization.tokenEnv, 'MERCHANT_CONSOLE_SELECTION_CHANGED');
  // Applications creates its reviewed missing directory immediately before launch.
  await privateDirectory(consoleDirectory);
  const lease = await operationLease(join(consoleDirectory, '.merchant-console-owner.lock'));
  let session;
  try {
    const current = await prepareMerchantConsoleSelection({
      configPath, consoleDirectory, tokenEnv, oauthConfigPath, environment,
    });
    const selectedCurrent = { ...current, source: { ...current.source, root: selection.source.root } };
    need(equal(selectedCurrent, selection), 'MERCHANT_CONSOLE_REVIEW_CHANGED',
      'The selected configuration, console or installed source changed. Review Start again.');
    const binding = {
      schema: MERCHANT_CONSOLE_BINDING_SCHEMA, instanceId: randomUUID(), pid: process.pid,
      startedAt: new Date().toISOString(), selectionSha256: hash(selection),
      configurationFile: selection.configuration.file, configurationFingerprint: selection.configuration.fingerprint,
      consoleDirectory, selectedSourceRoot: selection.source.root,
      sourceRoot: current.source.root, sourceSha256: current.source.sha256,
    };
    const { startMerchantMcp } = await import('../serve.mjs');
    session = await startMerchantMcp({
      configPath, consoleDirectory, port, tokenEnv, oauthConfigPath, environment, consoleBinding: binding,
    });
    need(session.operatorConsole && session.consoleUrl, 'MERCHANT_CONSOLE_HOST_REQUIRED');
    const mcpUrl = new URL(session.url).origin;
    const consoleUrl = new URL('/operator/', mcpUrl).href;
    const openUrl = new URL(consoleUrl);
    if (selection.authorization.mode === 'fixed-bearer') {
      need(environment[tokenEnv].length <= 2048, 'MERCHANT_CONSOLE_TOKEN_LIMIT',
        'Use a merchant token up to 2048 characters for the private managed Open link.');
      openUrl.hash = 'token=' + encodeURIComponent(environment[tokenEnv]);
    }
    const startup = {
      schema: MERCHANT_CONSOLE_STARTUP_SCHEMA, mcpUrl, consoleUrl, openUrl: openUrl.href,
      workspaceId: session.operatorConsole.store.id, authorization: session.authorization, binding,
    };
    verifyHost(session.operatorConsole.snapshot(), startup, selection);
    await verifyManagedMerchantConsoleStartup(startup, { selection, port, pid: process.pid });
    let closing, resolveClosed, rejectClosed;
    const closed = new Promise((done, fail) => { resolveClosed = done; rejectClosed = fail; });
    closed.catch(() => {});
    const close = () => {
      if (closing) return closing;
      closing = (async () => {
        await session.close();
        await lease.close();
        resolveClosed();
      })().catch(error => { closing = undefined; throw error; });
      closing.catch(() => {});
      return closing;
    };
    session.server.once('close', () => {
      if (!closing) close().catch(rejectClosed);
    });
    return { ...session, url: mcpUrl, consoleUrl, startup, close, closed };
  } catch (error) {
    try { await session?.close(); } finally { await lease.close(); }
    throw error;
  }
}
