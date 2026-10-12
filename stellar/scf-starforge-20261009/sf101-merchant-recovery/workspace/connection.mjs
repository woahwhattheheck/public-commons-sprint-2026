// MIT. The original recovery listener's private launch and native attachment.
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readRecoveryWorkspaceIdentity } from './model.mjs';

export const RECOVERY_LAUNCH_SCHEMA = 'stellar-forge.recovery-workspace-launch.v1';
export const RECOVERY_LAUNCH_FILE = 'recovery-workspace-launch.json';
export const RECOVERY_SOURCE_DIRECTORY = fileURLToPath(new URL('./', import.meta.url)).replace(/[\\/]$/, '');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_LAUNCH_BYTES = 65536;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
function requireValue(value, code, message) { if (!value) throw failure(code, message); }
function absolute(value, label) {
  requireValue(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'WORKSPACE_PATH_INVALID', label + ' must be a normalized absolute path');
  return value;
}
async function privateDirectory(directory) {
  absolute(directory, 'Workspace');
  const info = await lstat(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && await realpath(directory) === directory &&
    (process.platform === 'win32' || !(info.mode & 0o077) &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid())),
    'WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'Use the owned original private workspace directory');
}
async function privateJSON(path) {
  requireValue(await realpath(path) === path, 'WORKSPACE_LAUNCH_INVALID', 'Use the canonical native launch file');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    requireValue(info.isFile() && info.nlink === 1 && info.size <= MAX_LAUNCH_BYTES &&
      (process.platform === 'win32' || !(info.mode & 0o077) &&
        (typeof process.getuid !== 'function' || info.uid === process.getuid())),
      'WORKSPACE_LAUNCH_INVALID', 'Use an owned private regular native launch file');
    const bytes = await handle.readFile();
    requireValue(bytes.length === info.size && bytes.length <= MAX_LAUNCH_BYTES,
      'WORKSPACE_LAUNCH_CHANGED', 'Read the complete current native launch again');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw failure('WORKSPACE_LAUNCH_INVALID', 'The native launch must contain complete UTF-8 JSON'); }
  } finally { await handle.close(); }
}
function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('WORKSPACE_LAUNCH_INVALID', 'Invalid original listener origin'); }
  requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password &&
    (value === url.origin || value === 'http://127.0.0.1:80'), 'WORKSPACE_LOOPBACK_REQUIRED', 'Select the exact original loopback listener');
  return url.origin;
}
function identity(value) {
  requireValue(plain(value) && value.schema === 'stellar-forge.recovery-workspace-identity.v1' &&
    UUID.test(value.workspaceId ?? '') && SHA.test(value.configurationSha256 ?? ''),
    'WORKSPACE_LAUNCH_INVALID', 'The original workspace identity is required');
  return { schema: value.schema, workspaceId: value.workspaceId,
    directory: absolute(value.directory, 'Workspace'), configFile: absolute(value.configFile, 'Host configuration'),
    configurationSha256: value.configurationSha256 };
}
function sameIdentity(actual, expected) {
  return ['schema', 'workspaceId', 'directory', 'configFile', 'configurationSha256']
    .every(key => actual[key] === expected[key]);
}
function checkedLaunch(value) {
  requireValue(plain(value) && value.schema === RECOVERY_LAUNCH_SCHEMA &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)),
    'WORKSPACE_LAUNCH_INVALID', 'Use the original complete recovery listener launch');
  const selectedOrigin = origin(value.origin), selectedIdentity = identity(value.identity);
  requireValue(typeof value.url === 'string' &&
    value.url.startsWith(selectedOrigin + '/#token=') && SHA.test(value.url.slice((selectedOrigin + '/#token=').length)),
    'WORKSPACE_LAUNCH_INVALID', 'Use the original private recovery listener session');
  return { schema: RECOVERY_LAUNCH_SCHEMA, instanceId: value.instanceId, pid: value.pid,
    startedAt: value.startedAt, origin: selectedOrigin, url: value.url,
    sourceDirectory: absolute(value.sourceDirectory, 'Native source directory'), identity: selectedIdentity };
}
/** This is safe to return through the authenticated native and merchant APIs. */
export function recoveryLaunchView(value) {
  const launch = checkedLaunch(value);
  return { schema: launch.schema, instanceId: launch.instanceId, pid: launch.pid,
    startedAt: launch.startedAt, origin: launch.origin, sourceDirectory: launch.sourceDirectory,
    identity: { ...launch.identity } };
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Called only while serveRecoveryWorkspace owns the original workspace lease. */
export async function publishRecoveryWorkspaceLaunch({ directory, identity: selectedIdentity, origin: selectedOrigin, token } = {}) {
  await privateDirectory(directory);
  requireValue(SHA.test(token ?? ''), 'WORKSPACE_TOKEN_INVALID', 'Use the original generated browser session');
  selectedIdentity = identity(selectedIdentity);
  requireValue(selectedIdentity.directory === directory, 'WORKSPACE_IDENTITY_CHANGED', 'Select this exact native workspace');
  const path = join(directory, RECOVERY_LAUNCH_FILE);
  try {
    const previous = checkedLaunch(await privateJSON(path));
    requireValue(previous.identity.workspaceId === selectedIdentity.workspaceId &&
      previous.identity.directory === directory && previous.identity.configFile === selectedIdentity.configFile,
      'WORKSPACE_LAUNCH_IDENTITY_CHANGED', 'The retained native launch belongs to another workspace');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  selectedOrigin = origin(selectedOrigin);
  const launch = checkedLaunch({ schema: RECOVERY_LAUNCH_SCHEMA, instanceId: randomUUID(),
    pid: process.pid, startedAt: new Date().toISOString(), origin: origin(selectedOrigin),
    url: selectedOrigin + '/#token=' + token, sourceDirectory: RECOVERY_SOURCE_DIRECTORY, identity: selectedIdentity });
  const temporary = join(directory, '.recovery-launch-' + randomUUID());
  let handle;
  try {
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(JSON.stringify(launch, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, path); await syncDirectory(directory);
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  } catch (error) {
    // Publication can fail after rename. This ID is known even before the
    // caller receives the launch, and the caller still holds the model lease.
    await retireRecoveryWorkspaceLaunch({ directory, instanceId: launch.instanceId }).catch(() => {});
    throw error;
  }
  return launch;
}

/** Retire only this server's session; a later native launch remains selected. */
export async function retireRecoveryWorkspaceLaunch({ directory, instanceId } = {}) {
  await privateDirectory(directory);
  requireValue(UUID.test(instanceId ?? ''), 'WORKSPACE_LAUNCH_INVALID', 'Select this original server instance');
  const path = join(directory, RECOVERY_LAUNCH_FILE);
  let launch;
  try { launch = checkedLaunch(await privateJSON(path)); }
  catch (error) { if (error.code === 'ENOENT') return { retired: false }; throw error; }
  if (launch.instanceId !== instanceId) return { retired: false };
  await unlink(path); await syncDirectory(directory);
  return { retired: true };
}

/** Bind a connection to an existing original state without creating a writer. */
export async function readRecoveryWorkspaceSelection({ directory, configFile } = {}) {
  await privateDirectory(directory);
  return readRecoveryWorkspaceIdentity({ directory, configFile });
}

/** Fresh private launch + current authenticated identity; never starts a service. */
export async function readRecoveryWorkspaceLaunch({ directory, configFile, expectedIdentity } = {}) {
  await privateDirectory(directory);
  const selected = await readRecoveryWorkspaceSelection({ directory, configFile });
  if (expectedIdentity) requireValue(sameIdentity(selected, identity(expectedIdentity)),
    'WORKSPACE_HOST_SELECTION_CHANGED', 'Restart the merchant connection with this changed original host selection');
  let launch;
  try { launch = checkedLaunch(await privateJSON(join(directory, RECOVERY_LAUNCH_FILE))); }
  catch (error) {
    if (error.code === 'ENOENT') throw failure('WORKSPACE_NOT_RUNNING',
      'Start the original recovery workspace through Applications or workspace serve, then read the same request');
    throw error;
  }
  requireValue(sameIdentity(launch.identity, selected) && launch.sourceDirectory === RECOVERY_SOURCE_DIRECTORY,
    'WORKSPACE_LAUNCH_IDENTITY_CHANGED', 'Use the same original source, workspace and host configuration');
  const token = launch.url.slice((launch.origin + '/#token=').length);
  let response;
  try {
    response = await fetch(launch.origin + '/api/connection', { redirect: 'error',
      headers: { 'x-recovery-token': token, origin: launch.origin, accept: 'application/json' },
      signal: AbortSignal.timeout(15000) });
  } catch {
    throw failure('WORKSPACE_NOT_RUNNING', 'The retained native listener did not answer; reopen its original launch before continuing');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 401 ? 'WORKSPACE_SESSION_CHANGED' : 'WORKSPACE_CONNECTION_REJECTED',
      'Read the current original recovery listener after its session or host selection changes', response.status);
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    requireValue(size <= MAX_LAUNCH_BYTES, 'WORKSPACE_LAUNCH_INVALID', 'The native connection reply exceeds its declared limit');
    chunks.push(Buffer.from(chunk));
  }
  let actual;
  try { actual = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw failure('WORKSPACE_LAUNCH_INVALID', 'The native connection did not return complete UTF-8 JSON'); }
  const expected = recoveryLaunchView(launch);
  requireValue(plain(actual) && actual.schema === expected.schema && actual.instanceId === expected.instanceId &&
    actual.pid === expected.pid && actual.startedAt === expected.startedAt && actual.origin === expected.origin &&
    actual.sourceDirectory === expected.sourceDirectory && plain(actual.identity) && sameIdentity(actual.identity, expected.identity),
    'WORKSPACE_LAUNCH_IDENTITY_CHANGED', 'The live recovery listener differs from its retained native launch');
  return { ...expected, token };
}
