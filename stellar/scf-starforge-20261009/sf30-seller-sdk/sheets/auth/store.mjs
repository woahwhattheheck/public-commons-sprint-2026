// MIT. Private Google connection storage and kernel-owned cross-process refresh lock.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  absolute, privateDirectory, readJson, atomicJson, createFile, bytes, identity, fault, stamp,
} from '../../postgres/publisher/files.mjs';

export const CONNECTION_SCHEMA = 'stellar-forge.sheets-google-connection.v1';
export const CLIENT_SCHEMA = 'stellar-forge.sheets-google-desktop-client.v1';
const printable = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[^\x21-\x7e]/.test(value);
export const validToken = printable;
export async function optionalJson(filename) {
  try { return await readJson(filename, 131072); }
  catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
}
export async function withConnectionLock(directory, action, { signal, name = 'connection.lock', waitSeconds = 30 } = {}) {
  absolute(directory); await privateDirectory(directory);
  if (process.platform !== 'linux') throw fault('SHEETS_OAUTH_LINUX_REQUIRED', 'The publisher connection uses Linux util-linux flock.');
  signal?.throwIfAborted();
  const handle = await open(join(directory, name), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077) throw fault('SHEETS_OAUTH_PRIVATE_LOCK_REQUIRED');
    await new Promise((done, reject) => {
      const child = spawn('flock', ['--exclusive', '--timeout', String(waitSeconds), '--conflict-exit-code', '75', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', handle.fd], shell: false });
      const cancel = () => child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), (waitSeconds + 5) * 1000);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      child.once('error', () => { cleanup(); reject(fault('SHEETS_OAUTH_LOCK_UNAVAILABLE')); });
      child.once('exit', code => {
        cleanup();
        if (signal?.aborted) reject(fault('SHEETS_OAUTH_CANCELLED'));
        else if (code === 0) done();
        else reject(fault(code === 75 ? 'SHEETS_OAUTH_CONNECTION_BUSY' : 'SHEETS_OAUTH_LOCK_FAILED',
          code === 75 ? 'The existing connection operation is still running; use its status or wait for it.' : 'The private connection lock could not be acquired.', 409));
      });
    });
    signal?.throwIfAborted();
    return await action();
  } finally { await handle.close(); }
}
export function normalizeDesktopClient(input) {
  const value = input?.installed;
  if (!value || typeof value !== 'object' || Array.isArray(value) || input.web ||
      typeof value.client_id !== 'string' || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value.client_id) ||
      value.client_id.length > 255 || value.client_secret !== undefined && !printable(value.client_secret) ||
      value.auth_uri !== undefined && value.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' &&
        value.auth_uri !== 'https://accounts.google.com/o/oauth2/v2/auth' ||
      value.token_uri !== undefined && value.token_uri !== 'https://oauth2.googleapis.com/token')
    throw fault('SHEETS_OAUTH_DESKTOP_CLIENT_REQUIRED', 'Choose the private JSON download for your registered Google Desktop app client.');
  return { schema: CLIENT_SCHEMA, clientId: value.client_id, ...(value.client_secret ? { clientSecret: value.client_secret } : {}) };
}
export async function initializeGoogleConnection(directory, clientFile) {
  absolute(directory); absolute(clientFile, 'client file');
  const client = normalizeDesktopClient(await readJson(clientFile, 65536));
  await privateDirectory(directory, true);
  return withConnectionLock(directory, async () => {
    const existing = await optionalJson(join(directory, 'client.json'));
    if (existing && identity(existing) !== identity(client))
      throw fault('SHEETS_OAUTH_CLIENT_CHANGED', 'Use a separate connection directory for a different registered desktop client.');
    if (!existing) await createFile(join(directory, 'client.json'), bytes(client));
    if (!await optionalJson(join(directory, 'connection.json'))) {
      await atomicJson(directory, 'connection.json', {
        schema: CONNECTION_SCHEMA, connectionId: randomUUID(), clientHash: identity(client),
        revision: 0, state: 'disconnected', createdAt: stamp(), updatedAt: stamp(), events: [],
      });
    }
    return connectionStatus(await loadConnection(directory), directory);
  });
}
export async function loadConnection(directory) {
  absolute(directory); await privateDirectory(directory);
  const client = await readJson(join(directory, 'client.json'), 65536);
  if (client?.schema !== CLIENT_SCHEMA || typeof client.clientId !== 'string' ||
      client.clientSecret !== undefined && !printable(client.clientSecret))
    throw fault('SHEETS_OAUTH_CLIENT_INVALID');
  const grant = await readJson(join(directory, 'connection.json'), 131072);
  if (grant?.schema !== CONNECTION_SCHEMA || grant.clientHash !== identity(client) ||
      typeof grant.connectionId !== 'string' || !Number.isSafeInteger(grant.revision) || grant.revision < 0 ||
      !['connected', 'disconnected', 'reconnect_required'].includes(grant.state) ||
      !Array.isArray(grant.events) ||
      grant.state === 'connected' && (!printable(grant.accessToken) || !printable(grant.refreshToken) ||
        !Number.isFinite(Date.parse(grant.expiresAt)) || !Array.isArray(grant.scopes) ||
        typeof grant.account?.subject !== 'string' || typeof grant.account?.email !== 'string'))
    throw fault('SHEETS_OAUTH_CONNECTION_INVALID');
  return { client, grant };
}
export async function saveConnection(directory, current, changes, event) {
  const next = { ...current, ...changes, revision: current.revision + 1, updatedAt: stamp() };
  next.events = [...current.events, { at: next.updatedAt, operation: event }].slice(-32);
  await atomicJson(directory, 'connection.json', next);
  return next;
}
export function connectionStatus({ client, grant }, directory) {
  return {
    schema: 'stellar-forge.sheets-google-connection-status.v1',
    directory, connectionId: grant.connectionId, revision: grant.revision, state: grant.state,
    clientId: client.clientId, account: grant.account ?? null, grantedScopes: grant.scopes ?? [],
    expiresAt: grant.expiresAt ?? null, refreshExpiresAt: grant.refreshExpiresAt ?? null,
    refreshable: grant.state === 'connected' && Boolean(grant.refreshToken),
    needsRefresh: grant.state === 'connected' && Date.parse(grant.expiresAt) <= Date.now() + 60000,
    lastFailure: grant.lastFailure ?? null, retryAfter: grant.retryAfter ?? null,
    refreshPending: Boolean(grant.refreshPending), remoteRevocation: grant.remoteRevocation ?? null,
    updatedAt: grant.updatedAt, events: grant.events,
  };
}
export async function googleConnectionStatus(directory) {
  return connectionStatus(await loadConnection(directory), directory);
}
