// MIT. Managed launch for the original merchant accounting and OAuth owners.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, basename, join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectOpenApiLaunch } from '../../sf61-openapi-seller-import/workspace/managed-launch.mjs';
import { identity, digest, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { plain, hex, envName } from '../../sf30-seller-sdk/oauth-connections/profile.mjs';
import { quickbooksSource, quickBooksSelectionSummary } from '../../sf30-seller-sdk/oauth-connections/quickbooks.mjs';
import { xeroSource, xeroSelectionSummary } from '../../sf30-seller-sdk/oauth-connections/xero.mjs';
import { readAccountingSelections, openAccountingConnections } from './connections-workspace.mjs';

export const ACCOUNTING_MANAGED_SCHEMA = 'stellar-forge.managed-accounting-binding.v1';
export const ACCOUNTING_STARTUP_SCHEMA = 'stellar-forge.managed-accounting-startup.v1';
const need = (ok, code, message, status = 409) => { if (!ok) throw fault(code, message, status); };
const absolute = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\x00-\x1f\x7f]/.test(value), 'ACCOUNTING_MANAGED_PATH', 'Use a canonical original accounting path.', 400);
  return value;
};
const optionalPaths = ['outboxDir', 'proofDir', 'termsFile', 'recoveredDir', 'recoveryStateRoot', 'recoveryBackupRoot'];
const optionalEnvs = ['rpcProxyEnv', 'recoveryPassEnv', 'deliverySecretEnv'];
const permitted = ['directory', 'port', 'connectionsFile', 'selectionDirectory', 'allowLoopbackOAuth',
  'recoveryStartPaused', ...optionalPaths, ...optionalEnvs];
function settings(raw) {
  need(plain(raw) && Object.keys(raw).every(name => permitted.includes(name)),
    'ACCOUNTING_MANAGED_OPTIONS', 'Use the original managed accounting options.', 400);
  const value = { directory: absolute(raw.directory), port: raw.port ?? 0,
    connectionsFile: raw.connectionsFile ? absolute(raw.connectionsFile) : null,
    selectionDirectory: raw.selectionDirectory ? absolute(raw.selectionDirectory) :
      join(dirname(raw.directory), basename(raw.directory) + '-connections'),
    allowLoopbackOAuth: raw.allowLoopbackOAuth === true, recoveryStartPaused: raw.recoveryStartPaused === true };
  need(Number.isInteger(value.port) && value.port >= 0 && value.port <= 65535 &&
    (raw.allowLoopbackOAuth === undefined || typeof raw.allowLoopbackOAuth === 'boolean') &&
    (raw.recoveryStartPaused === undefined || typeof raw.recoveryStartPaused === 'boolean'),
  'ACCOUNTING_MANAGED_OPTIONS', 'Use a valid local listener and explicit recovery options.', 400);
  for (const name of optionalPaths) if (raw[name]) value[name] = absolute(raw[name]);
  for (const name of optionalEnvs) if (raw[name]) {
    need(envName(raw[name]), 'ACCOUNTING_MANAGED_OPTIONS', 'Use a named host environment reference.', 400);
    value[name] = raw[name];
  }
  need(value.directory !== value.selectionDirectory, 'ACCOUNTING_MANAGED_PATH',
    'Keep saved company selections separate from the original accounting state.');
  return value;
}
async function sourceInput(path, type) {
  const before = await lstat(path);
  need(!before.isSymbolicLink() && (type === 'file' ? before.isFile() : before.isDirectory()) &&
    await realpath(path) === path, 'ACCOUNTING_MANAGED_INPUT_CHANGED', 'Use the original source file or directory.');
  const result = { path, type, device: String(before.dev), inode: String(before.ino) };
  if (type === 'file') {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const first = await handle.stat();
      need(first.isFile() && first.size <= 16 * 1024 * 1024 && first.dev === before.dev &&
        first.ino === before.ino, 'ACCOUNTING_MANAGED_INPUT_CHANGED', 'The selected accounting input changed.');
      const bytes = await handle.readFile(), after = await handle.stat();
      need(bytes.length === first.size && after.size === first.size &&
        first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs,
      'ACCOUNTING_MANAGED_INPUT_CHANGED', 'Read the current accounting source before starting.');
      result.bytes = bytes.length; result.sha256 = digest(bytes);
    } finally { await handle.close(); }
  }
  return result;
}

/** Read-only launch review; grant generation changes are retained by the original OAuth core. */
export async function inspectAccountingLaunch(raw, { env = process.env, allowMissing = false } = {}) {
  const selected = settings(raw);
  const oauth = await inspectOpenApiLaunch({
    outputParent: selected.directory, port: selected.port, oauthConnectionsFile: selected.connectionsFile,
    allowLoopbackOAuth: selected.allowLoopbackOAuth,
  }, { env, allowMissingOutput: allowMissing });
  let selections = { quickbooks: null, xero: null }, selectionRoot = null;
  if (selected.connectionsFile) {
    const root = await inspectOpenApiLaunch({ outputParent: selected.selectionDirectory, port: 0 },
      { env, allowMissingOutput: allowMissing });
    selectionRoot = root.binding.output;
    if (selectionRoot.exists) selections = await readAccountingSelections(selected.selectionDirectory);
    const sources = { quickbooks: await quickbooksSource(), xero: await xeroSource() };
    for (const provider of ['quickbooks', 'xero']) {
      const choice = selections[provider]; if (!choice) continue;
      const connection = oauth.binding.profiles.find(value => value.alias === choice.alias);
      need(connection && connection.profileSha256 === choice.profileSha256 &&
        identity(connection.source) === identity(sources[provider]) &&
        identity(choice.source) === identity(sources[provider]),
      'ACCOUNTING_MANAGED_SELECTION_CHANGED', 'The saved company or tenant must belong to this registered source and alias.');
    }
  }
  const inputs = [];
  for (const name of ['outboxDir', 'proofDir', 'recoveredDir'])
    if (selected[name]) inputs.push({ name, ...await sourceInput(selected[name], 'directory') });
  if (selected.termsFile) inputs.push({ name: 'termsFile', ...await sourceInput(selected.termsFile, 'file') });
  for (const name of ['recoveryStateRoot', 'recoveryBackupRoot']) if (selected[name]) {
    const inspected = await inspectOpenApiLaunch({ outputParent: selected[name], port: 0 }, { env });
    inputs.push({ name, type: 'directory', path: selected[name], ...inspected.binding.output });
  }
  const selectedDigests = Object.fromEntries(Object.entries(selections).map(([provider, value]) =>
    [provider, value?.integrity.sha256 ?? null]));
  const binding = { schema: ACCOUNTING_MANAGED_SCHEMA, settings: selected, oauth: oauth.binding,
    selectionRoot, selections: selectedDigests, inputs };
  return { binding, bindingSha256: identity(binding), selections,
    review: { schema: ACCOUNTING_MANAGED_SCHEMA, bindingSha256: identity(binding),
      directory: selected.directory, port: selected.port, allowLoopbackOAuth: selected.allowLoopbackOAuth,
      connectionsFile: selected.connectionsFile, selectionDirectory: selected.connectionsFile ? selected.selectionDirectory : null,
      connectionsSha256: oauth.binding.registry?.sha256 ?? null,
      profiles: oauth.review.profiles, selections: selectedDigests, inputs,
      targets: { quickbooks: selections.quickbooks ? quickBooksSelectionSummary(selections.quickbooks) : null,
        xero: selections.xero ? xeroSelectionSummary(selections.xero) : null },
      recoveryStartPaused: selected.recoveryStartPaused } };
}

export async function startManagedAccountingWorkspace(raw, {
  expectedSha256, startWorkspace, env = process.env, lookup, agent, fetchImpl,
  announce = value => process.stdout.write(JSON.stringify(value) + '\n'),
} = {}) {
  need(hex(expectedSha256) && typeof startWorkspace === 'function' && typeof announce === 'function',
    'ACCOUNTING_MANAGED_HOST', 'Start the original reviewed accounting host.');
  const environment = { ...env }, before = await inspectAccountingLaunch(raw, { env: environment });
  need(before.bindingSha256 === expectedSha256, 'ACCOUNTING_MANAGED_INPUT_CHANGED',
    'The registered source, saved company, accounting inputs or private directories changed. Review the current application start.');
  const selected = before.binding.settings;
  let accounting, connections, closing;
  const close = () => {
    if (!closing) {
      connections?.stop();
      closing = (async () => {
        const errors = [];
        try { await accounting?.close(); } catch (error) { errors.push(error); }
        try { await connections?.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw Object.assign(new AggregateError(errors,
          'The managed accounting owners did not all close cleanly.'), { code: 'ACCOUNTING_MANAGED_CLOSE_FAILED' });
      })();
    }
    return closing;
  };
  try {
    if (selected.connectionsFile) {
      connections = await openAccountingConnections({
        connectionsFile: selected.connectionsFile, selectionDirectory: selected.selectionDirectory,
        env: environment, allowLoopback: selected.allowLoopbackOAuth,
        ...(lookup ? { lookup } : {}), ...(agent ? { agent } : {}), ...(fetchImpl ? { fetchImpl } : {}),
        origin: () => accounting?.url ?? 'http://127.0.0.1:' + selected.port,
      });
      for (const provider of ['quickbooks', 'xero'])
        need((connections.activeSelections[provider]?.integrity.sha256 ?? null) === before.binding.selections[provider],
          'ACCOUNTING_MANAGED_SELECTION_CHANGED', 'A saved company selection changed while the host was opening.');
    }
    const { connectionsFile, selectionDirectory, allowLoopbackOAuth, ...accountingOptions } = selected;
    accounting = await startWorkspace({
      ...accountingOptions,
      ...(connections ? { qboClient: connections.qboClient, xeroClient: connections.xeroClient,
        connectionsWorkspace: connections } : {}),
    });
    const after = await inspectAccountingLaunch(selected, { env: environment });
    need(after.bindingSha256 === expectedSha256, 'ACCOUNTING_MANAGED_INPUT_CHANGED',
      'The reviewed accounting inputs changed while the original host was opening.');
    const url = new URL(accounting.url);
    need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/' &&
      (selected.port === 0 || Number(url.port) === selected.port),
    'ACCOUNTING_MANAGED_STARTUP', 'Use the original local accounting address.');
    const startup = {
      schema: ACCOUNTING_STARTUP_SCHEMA, status: 'ACCOUNTING_WORKSPACE_READY',
      instanceId: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(),
      directory: selected.directory, selectionDirectory: connections ? selected.selectionDirectory : null,
      requestedPort: selected.port, port: Number(url.port), bindingSha256: expectedSha256,
      connectionsFile: selected.connectionsFile,
      connectionsSha256: before.binding.oauth.registry?.sha256 ?? null,
      profileCount: before.binding.oauth.profiles.length, selections: before.binding.selections,
      url: accounting.url, connectionsUrl: connections ? accounting.url + '/connections.html' : null,
    };
    await announce(startup);
    return Object.freeze({ accounting, connections, managed: startup, url: accounting.url, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}

const argumentNames = Object.freeze({
  '--workspace': 'directory', '--port': 'port', '--oauth-connections': 'connectionsFile',
  '--connection-selections': 'selectionDirectory', '--outbox': 'outboxDir', '--proof-dir': 'proofDir',
  '--terms': 'termsFile', '--recovered-dir': 'recoveredDir', '--rpc-proxy-env': 'rpcProxyEnv',
  '--recovery-state-root': 'recoveryStateRoot', '--recovery-backup-root': 'recoveryBackupRoot',
  '--recovery-pass-env': 'recoveryPassEnv', '--delivery-secret-env': 'deliverySecretEnv',
});
export function accountingManagedArguments(raw) {
  need(Array.isArray(raw), 'ACCOUNTING_MANAGED_ARGUMENTS', 'Use the original managed accounting command.', 400);
  const values = {}, seen = new Set(); let expectedSha256;
  for (let index = 0; index < raw.length; index++) {
    const name = raw[index];
    need(typeof name === 'string' && !seen.has(name), 'ACCOUNTING_MANAGED_ARGUMENTS',
      'Each accounting launch option appears once.', 400); seen.add(name);
    if (name === '--allow-loopback-oauth') { values.allowLoopbackOAuth = true; continue; }
    if (name === '--recovery-start-paused') { values.recoveryStartPaused = true; continue; }
    need((Object.hasOwn(argumentNames, name) || name === '--managed-launch-sha256') &&
      typeof raw[index + 1] === 'string' && raw[index + 1] && !raw[index + 1].startsWith('--'),
    'ACCOUNTING_MANAGED_ARGUMENTS', 'Use the exact reviewed accounting launch arguments.', 400);
    const value = raw[++index];
    if (name === '--managed-launch-sha256') expectedSha256 = value;
    else values[argumentNames[name]] = name === '--port' ? Number(value) : value;
  }
  need(hex(expectedSha256), 'ACCOUNTING_MANAGED_ARGUMENTS', 'Keep the reviewed accounting launch digest.', 400);
  return { settings: settings(values), expectedSha256 };
}
