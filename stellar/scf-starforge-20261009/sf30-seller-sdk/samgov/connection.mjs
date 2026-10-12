// MIT. Private connection and transport for the original SAM.gov workspace listener.
import {constants} from 'node:fs';
import {open, lstat, realpath, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const SAM_CONNECTION_SCHEMA = 'stellar-forge.samgov-live-connection.v1';
export const SAM_STARTUP_SCHEMA = 'stellar-forge.samgov-workspace-startup.v1';
export const SAM_CONNECTION_FILENAME = 'samgov.connection.json';
export const SAM_MAX_RESPONSE_BYTES = 512 * 1024 * 1024;
export const SAM_MAX_CONTROL_BYTES = 2 * 1024 * 1024;
export const SAM_HASH = /^[a-f0-9]{64}$/;
export const SAM_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const samDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const samPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function samFailure(code, message, status = 400, details) {
  return Object.assign(new Error(message), {code, status, ...(details ? {details, data: details} : {})});
}
export function samNeed(value, code, message, status = 400) {
  if (!value) throw samFailure(code, message || code, status);
}
export function samExact(value, allowed, required = []) {
  samNeed(samPlain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)),
  'SAM_CONFIGURATION_INVALID', 'Use the declared SAM configuration fields.');
}
export function samAbsolute(value) {
  samNeed(typeof value === 'string' && isAbsolute(value) && value.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(value), 'SAM_PATH_INVALID', 'Choose an absolute host-owned path.');
  return resolve(value);
}
export async function samPrivateDirectory(path) {
  path = samAbsolute(path);
  const information = await lstat(path);
  samNeed(information.isDirectory() && !information.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || !(information.mode & 0o077) &&
      (!process.getuid || information.uid === process.getuid())),
  'SAM_PRIVATE_DIRECTORY_REQUIRED', 'Use the original owned private directory.');
  return {path, dev: String(information.dev), ino: String(information.ino)};
}
function privateFile(info) {
  return info.isFile() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()));
}
export async function samReadPrivateFile(path, maximum = SAM_MAX_RESPONSE_BYTES) {
  path = samAbsolute(path);
  samNeed(await realpath(path) === path, 'SAM_PRIVATE_FILE_REQUIRED', 'Use a canonical private file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    samNeed(privateFile(before) && before.size <= maximum,
      'SAM_PRIVATE_FILE_REQUIRED', 'Use an owned private regular file within the declared size limit.');
    const bytes = await file.readFile(), after = await file.stat();
    samNeed(bytes.length === before.size && bytes.length <= maximum &&
      ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]),
    'SAM_PRIVATE_FILE_CHANGED', 'The selected private file changed during reading.', 409);
    return {path, bytes, sha256: samDigest(bytes)};
  } finally { await file.close(); }
}
export function samParseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw samFailure('SAM_JSON_INVALID', 'The selected source is not complete UTF-8 JSON.'); }
}
export async function samReadPrivateJson(path, maximum = 1024 * 1024) {
  const source = await samReadPrivateFile(path, maximum);
  return {...source, value: samParseJson(source.bytes)};
}
/** The existing writer owns replacement; this helper preserves private atomic publication. */
export async function samWritePrivateJson(path, value, {replace = false} = {}) {
  path = samAbsolute(path);
  await samPrivateDirectory(dirname(path));
  try {
    const found = await lstat(path);
    samNeed(replace && privateFile(found) && !found.isSymbolicLink(),
      'SAM_PRIVATE_OUTPUT_EXISTS', 'Choose an unused private output or the same original connection.', 409);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temporary = join(dirname(path), '.sam-' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  catch (error) { await file.close(); await unlink(temporary).catch(() => {}); throw error; }
  finally { await file.close(); }
  try {
    if (!replace) {
      const {link} = await import('node:fs/promises');
      await link(temporary, path); await unlink(temporary);
    } else await rename(temporary, path);
    const folder = await open(dirname(path), 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return {path, sha256: samDigest(bytes), bytes: bytes.length};
}
function liveUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw samFailure('SAM_CONNECTION_INVALID', 'The original private listener URL is invalid.'); }
  samNeed(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && /^#token=[a-f0-9]{64}$/.test(url.hash) &&
    /^\d+$/.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65535,
  'SAM_CONNECTION_INVALID', 'Use the original private loopback SAM listener.');
  return url;
}
export async function readSamConnection(path, {directory} = {}) {
  const source = await samReadPrivateJson(path, 32768), value = source.value;
  samExact(value, ['schema', 'instanceId', 'directory', 'directoryIdentity', 'workspaceId',
    'operator', 'pid', 'startedAt', 'origin', 'url', 'apiKeyEnv', 'endpoint', 'opportunityDirectory'],
  ['schema', 'instanceId', 'directory', 'directoryIdentity', 'workspaceId', 'operator', 'pid',
    'startedAt', 'origin', 'url', 'apiKeyEnv', 'endpoint', 'opportunityDirectory']);
  const selected = await samPrivateDirectory(value.directory);
  samNeed(value.schema === SAM_CONNECTION_SCHEMA && SAM_UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.operator === 'string' &&
    value.operator.length >= 1 && value.operator.length <= 240 &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) &&
    (value.workspaceId === null || /^sam_[a-f0-9-]{36}$/.test(value.workspaceId)) &&
    samPlain(value.directoryIdentity) && value.directoryIdentity.dev === selected.dev &&
    value.directoryIdentity.ino === selected.ino &&
    (!directory || selected.path === samAbsolute(directory)) &&
    source.path === join(selected.path, SAM_CONNECTION_FILENAME),
  'SAM_CONNECTION_CHANGED', 'The original SAM workspace binding changed. Review its current connection.', 409);
  const url = liveUrl(value.url);
  samNeed(value.origin === url.origin, 'SAM_CONNECTION_INVALID', 'The original listener origin changed.');
  return {path: source.path, sha256: source.sha256, value, token: url.hash.slice(7)};
}
export function samConnectionView(connection) {
  const value = connection.value;
  return {instanceId: value.instanceId, workspaceId: value.workspaceId, operator: value.operator,
    startedAt: value.startedAt, origin: value.origin, pid: value.pid};
}
export async function samRequest(connection, path, {
  method = 'GET', body, signal, maximum = SAM_MAX_CONTROL_BYTES, fetchImpl = fetch, raw = false,
} = {}) {
  const url = new URL(path, connection.value.origin);
  samNeed(url.origin === connection.value.origin && url.pathname.startsWith('/api/') &&
    !url.username && !url.password && !url.hash && ['GET', 'POST'].includes(method),
  'SAM_REQUEST_ROUTE_INVALID', 'Choose an original SAM workspace API operation.');
  let serialized;
  if (body !== undefined) {
    serialized = JSON.stringify(body);
    samNeed(Buffer.byteLength(serialized) <= SAM_MAX_RESPONSE_BYTES,
      'SAM_REQUEST_TOO_LARGE', 'The original request exceeds 512 MiB.', 413);
  }
  const timeout = AbortSignal.timeout(120000);
  const controller = new AbortController();
  const relay = selected => { if (!controller.signal.aborted) controller.abort(selected.reason); };
  const onTimeout = () => relay(timeout), onAbort = () => relay(signal);
  timeout.addEventListener('abort', onTimeout, {once: true});
  if (signal) { signal.addEventListener('abort', onAbort, {once: true}); if (signal.aborted) onAbort(); }
  let response, handedOff = false;
  try {
    response = await fetchImpl(url, {method, redirect: 'error', signal: controller.signal,
      headers: {'Authorization': 'Bearer ' + connection.token, ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
      ...(serialized === undefined ? {} : {body: serialized})});
    const advertised = response.headers.get('content-length');
    samNeed(advertised === null || /^\d+$/.test(advertised) && Number(advertised) <= maximum,
      'SAM_RESPONSE_TOO_LARGE', 'The original response exceeds the selected byte limit.', 413);
    if (raw && response.ok) {
      handedOff = true;
      return {response, async release() {
        timeout.removeEventListener('abort', onTimeout);
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
        if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }};
    }
    const chunks = []; let length = 0;
    if (response.body) for await (const chunk of response.body) {
      length += chunk.length;
      samNeed(length <= maximum, 'SAM_RESPONSE_TOO_LARGE', 'The original response exceeds the selected byte limit.', 413);
      chunks.push(chunk);
    }
    if (advertised !== null) samNeed(length === Number(advertised),
      'SAM_RESPONSE_INCOMPLETE', 'The original listener response ended before its declared byte count.', 502);
    const value = samParseJson(Buffer.concat(chunks));
    if (!response.ok) {
      const message = String(value?.error?.message || 'The original SAM operation failed.')
        .split(connection.token).join('[redacted]').slice(0,4000);
      throw samFailure(/^[A-Z0-9_]{1,100}$/.test(value?.error?.code ?? '') ? value.error.code : 'SAM_REQUEST_FAILED',
        message, response.status, {requestId: body?.payload?.requestId ?? null, originalResponse: true});
    }
    return value;
  } catch (error) {
    if (error.details?.originalResponse) throw error;
    if (error.code && String(error.code).startsWith('SAM_')) {
      if (method === 'POST') {
        const details = {...(samPlain(error.details) ? error.details : {}),
          requestId: body?.payload?.requestId ?? null, dispatch: 'unknown'};
        error.details = details; error.data = details;
      }
      throw error;
    }
    throw samFailure('SAM_CONNECTION_UNAVAILABLE',
      method === 'GET' ? 'The original SAM listener did not return this read. Reopen its saved application and connection.'
        : 'The original SAM listener did not return the operation. Inspect its retained state and reuse the same request ID and input.',
      503, {requestId: body?.payload?.requestId ?? null, dispatch: method === 'GET' ? 'read' : 'unknown'});
  } finally {
    if (!handedOff) {
      timeout.removeEventListener('abort', onTimeout);
      signal?.removeEventListener('abort', onAbort);
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }
}
export async function inspectSamListener(connection, options) {
  const result = await samRequest(connection, '/api/workspace', {...options, maximum: 64 * 1024 * 1024});
  samNeed(result?.source === 'SAM.gov' && result.operator === connection.value.operator &&
    result.workspace?.schema === 'stellar-forge.samgov-workspace.v1' &&
    Number.isSafeInteger(result.workspace.revision) &&
    (!connection.value.workspaceId || result.workspace.id === connection.value.workspaceId),
  'SAM_LISTENER_CHANGED', 'The authenticated listener differs from the original selected SAM workspace.', 409);
  return result;
}
