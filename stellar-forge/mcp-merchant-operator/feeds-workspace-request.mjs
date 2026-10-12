// MIT. Exact client requests for the original feed merchant tools.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { feedsWorkspaceTools } from './catalog/feeds-workspace.mjs';

export const FEEDS_REQUEST_SCHEMA = 'stellar-forge.feeds-client-request.v1';
export const FEEDS_REQUEST_RESULT_SCHEMA = 'stellar-forge.feeds-client-response.v1';
export const MAX_FEEDS_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_FEEDS_RESPONSE_BYTES = 32 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const feedsClientFailure = (code, message) => Object.assign(new Error(message), { code });
export const plainFeedsObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const feedsClientHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function feedsClientAlias(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Select the declared feed workspace alias.');
  return value;
}
export function feedsClientEndpoint(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Retain the original MCP endpoint identity.');
  let parsed; try { parsed = new URL(value); } catch {}
  if (parsed && ['http:', 'https:'].includes(parsed.protocol) &&
      (parsed.username || parsed.password || parsed.search || parsed.hash))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Keep HTTP credentials in the original token environment variable.');
  return value;
}
export function feedsClientSha(value, label = 'SHA256') {
  if (typeof value !== 'string' || !SHA.test(value))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Supply the original ' + label + '.');
  return value;
}
export function feedsClientInteger(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Invalid ' + label + '.');
  return value;
}
const tools = new Map(feedsWorkspaceTools((name, description, properties, required) =>
  ({ name, description, properties, required })).map(value => [value.name, value]));
export const FEEDS_CLIENT_TOOLS = Object.freeze([...tools.keys()]);

/** Copy complete JSON; reject values that would lose their original numeric identity. */
export function feedsClientJson(value, maximum = MAX_FEEDS_REQUEST_BYTES) {
  const parents = new Set();
  function visit(item, depth) {
    if (depth > 64) throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'The original JSON exceeds 64 nested levels.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))) return item;
    if (typeof item !== 'object' || item === undefined || !Array.isArray(item) && !plainFeedsObject(item) || parents.has(item))
      throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Use complete JSON values; retain exact large numeric identifiers and atomic amounts as strings.');
    parents.add(item);
    let answer;
    if (Array.isArray(item)) answer = item.map(value => visit(value, depth + 1));
    else {
      answer = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        if (item[key] !== undefined) answer[key] = visit(item[key], depth + 1);
      }
    }
    parents.delete(item); return answer;
  }
  const bytes = Buffer.from(JSON.stringify(visit(value, 0), null, 2) + '\n');
  if (bytes.length > maximum) throw feedsClientFailure('FEEDS_CLIENT_INPUT_SIZE', 'The complete JSON exceeds its selected source limit.');
  return bytes;
}
function decoded(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw feedsClientFailure('FEEDS_CLIENT_JSON', 'The retained file must contain complete UTF-8 JSON.'); }
}
export function feedsClientInput(name, input = {}, workspace) {
  const tool = tools.get(name);
  if (!tool || !plainFeedsObject(input))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Select an original feed tool and its argument object.');
  if (Object.hasOwn(input, 'workspace'))
    throw feedsClientFailure('FEEDS_CLIENT_SCOPE', 'The client already selects its original workspace.');
  const args = { ...input, ...(name === 'merchant_feeds_workspaces' ? {} : { workspace: feedsClientAlias(workspace) }) };
  if (Object.keys(args).some(key => !Object.hasOwn(tool.properties, key)) ||
      tool.required.some(key => args[key] === undefined))
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Supply the original required arguments for ' + name + '.');
  return decoded(feedsClientJson(args));
}
function recoveryFor(name, args, supplied) {
  const originalId = args.input?.operationId ?? args.operationId;
  const automatic = name === 'merchant_feeds_action' && typeof originalId === 'string'
    ? { family: args.action.startsWith('collection-') ? 'collection' : 'feed', operationId: originalId } : null;
  const value = supplied ?? automatic;
  if (value === null) return null;
  if (!plainFeedsObject(value) || Object.keys(value).sort().join(',') !== 'family,operationId' ||
      !['feed', 'collection'].includes(value.family) || !ID.test(value.operationId ?? '') ||
      originalId !== undefined && value.operationId !== originalId)
    throw feedsClientFailure('FEEDS_CLIENT_INPUT', 'Recovery must select this request’s original feed or collection operation ID.');
  return { family: value.family, operationId: value.operationId };
}

/** Preparation is local. Native operation IDs are supplied by the caller. */
export function createFeedsRequest({ endpoint, workspace, tool, input = {}, recovery } = {}) {
  const args = feedsClientInput(tool, input, workspace);
  const body = { schema: FEEDS_REQUEST_SCHEMA, endpoint: feedsClientEndpoint(endpoint),
    workspace: feedsClientAlias(workspace), tool, arguments: args, recovery: recoveryFor(tool, args, recovery) };
  const bytes = feedsClientJson(body);
  return { ...decoded(bytes), requestSha256: feedsClientHash(bytes) };
}
export function validateFeedsRequest(request) {
  if (!plainFeedsObject(request) || Object.keys(request).sort().join(',') !==
      'arguments,endpoint,recovery,requestSha256,schema,tool,workspace' || request.schema !== FEEDS_REQUEST_SCHEMA ||
      !plainFeedsObject(request.arguments))
    throw feedsClientFailure('FEEDS_CLIENT_REQUEST', 'Use the complete original prepared feed request.');
  const args = { ...request.arguments };
  if (request.tool === 'merchant_feeds_workspaces') {
    if (Object.hasOwn(args, 'workspace')) throw feedsClientFailure('FEEDS_CLIENT_SCOPE', 'Workspace discovery has no workspace argument.');
  } else {
    if (args.workspace !== request.workspace) throw feedsClientFailure('FEEDS_CLIENT_SCOPE', 'The saved request has another workspace.');
    delete args.workspace;
  }
  const checked = createFeedsRequest({ endpoint: request.endpoint, workspace: request.workspace,
    tool: request.tool, input: args, recovery: request.recovery });
  if (checked.requestSha256 !== feedsClientSha(request.requestSha256, 'prepared request SHA256'))
    throw feedsClientFailure('FEEDS_CLIENT_REQUEST_CHANGED', 'The saved request differs from its original complete input.');
  return checked;
}
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

/** Exact private bytes used by requests, saved responses and complete JSON delivery. */
export async function readFeedsPrivateFile(path, maximum = MAX_FEEDS_RESPONSE_BYTES, { signal, expectedSha256, expectedBytes } = {}) {
  signal?.throwIfAborted(); path = resolve(path);
  if (await realpath(path) !== path) throw feedsClientFailure('FEEDS_CLIENT_PRIVATE_FILE', 'Use the original canonical private file.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || process.platform !== 'win32' &&
        (before.mode & 0o077n || process.getuid && before.uid !== BigInt(process.getuid())))
      throw feedsClientFailure('FEEDS_CLIENT_PRIVATE_FILE', 'Use a private regular file within the original source limit.');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const part = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!part.bytesRead) throw feedsClientFailure('FEEDS_CLIENT_FILE_CHANGED', 'The retained file ended while reading.');
      offset += part.bytesRead;
    }
    signal?.throwIfAborted();
    if (stamp(before) !== stamp(await handle.stat({ bigint: true })) ||
        expectedBytes !== undefined && expectedBytes !== bytes.length ||
        expectedSha256 !== undefined && feedsClientHash(bytes) !== feedsClientSha(expectedSha256))
      throw feedsClientFailure('FEEDS_CLIENT_FILE_CHANGED', 'The exact retained file changed.');
    return bytes;
  } finally { await handle.close(); }
}
export async function readFeedsPrivateJson(path, maximum, options) {
  return decoded(await readFeedsPrivateFile(path, maximum, options));
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function unlinkOwned(path, owned) {
  try {
    const current = await lstat(path, { bigint: true });
    if (current.dev === owned.dev && current.ino === owned.ino) await unlink(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** A failed or concurrent publication keeps every different existing output. */
export async function writeFeedsPrivateFile(path, bytes, { maximum = MAX_FEEDS_RESPONSE_BYTES } = {}) {
  path = resolve(path);
  if (!Buffer.isBuffer(bytes) || bytes.length > maximum)
    throw feedsClientFailure('FEEDS_CLIENT_INPUT_SIZE', 'Supply complete original bytes within the selected output limit.');
  const parent = dirname(path);
  if (await realpath(parent) !== parent) throw feedsClientFailure('FEEDS_CLIENT_PRIVATE_FILE', 'Use a canonical output directory.');
  try {
    const existing = await readFeedsPrivateFile(path, Math.max(bytes.length, 1));
    if (!existing.equals(bytes)) throw feedsClientFailure('FEEDS_CLIENT_OUTPUT_CONFLICT', 'The existing output contains different bytes.');
    await syncDirectory(parent); return { path, bytes: bytes.length, sha256: feedsClientHash(bytes), reused: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(parent, '.feeds-client-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  let owned;
  try {
    owned = await handle.stat({ bigint: true });
    await handle.writeFile(bytes); await handle.sync();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await readFeedsPrivateFile(path, Math.max(bytes.length, 1))).equals(bytes))
        throw feedsClientFailure('FEEDS_CLIENT_OUTPUT_CONFLICT', 'The existing output contains different bytes.');
    }
    await syncDirectory(parent);
    return { path, bytes: bytes.length, sha256: feedsClientHash(bytes), reused: false };
  } finally {
    try { await handle.close(); } finally { if (owned) await unlinkOwned(temporary, owned); }
  }
}
export async function writeFeedsRequest(path, request) {
  request = validateFeedsRequest(request);
  return writeFeedsPrivateFile(path, feedsClientJson(request));
}
export async function readFeedsRequest(path, { signal } = {}) {
  return validateFeedsRequest(await readFeedsPrivateJson(path, MAX_FEEDS_REQUEST_BYTES, { signal }));
}
async function optionalJson(path, maximum, signal) {
  try { return await readFeedsPrivateJson(path, maximum, { signal }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function feedsClientDirectory(directory, create = false) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') || resolve(directory) === '/')
    throw feedsClientFailure('FEEDS_CLIENT_DIRECTORY', 'Choose an original private request directory.');
  const root = resolve(directory);
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== root) throw feedsClientFailure('FEEDS_CLIENT_DIRECTORY', 'Use a canonical private request directory.');
  const info = await lstat(root);
  if (!info.isDirectory() || process.platform !== 'win32' &&
      (info.mode & 0o077 || process.getuid && info.uid !== process.getuid()))
    throw feedsClientFailure('FEEDS_CLIENT_DIRECTORY', 'The request directory must belong privately to this user.');
  return root;
}
export async function inspectFeedsRequest({ directory, signal } = {}) {
  const root = await feedsClientDirectory(directory, false);
  const request = await readFeedsRequest(join(root, 'request.json'), { signal });
  const invocation = await optionalJson(join(root, 'invocation.json'), 65000, signal);
  const response = await optionalJson(join(root, 'response.json'), MAX_FEEDS_RESPONSE_BYTES, signal);
  for (const saved of [invocation, response]) {
    if (saved && (saved.requestSha256 !== request.requestSha256 || saved.endpoint !== request.endpoint || saved.workspace !== request.workspace))
      throw feedsClientFailure('FEEDS_CLIENT_REQUEST_CHANGED', 'The request directory contains a different original selection.');
  }
  if (invocation && invocation.schema !== 'stellar-forge.feeds-client-invocation.v1' ||
      response && (response.schema !== FEEDS_REQUEST_RESULT_SCHEMA || !plainFeedsObject(response.result) ||
        response.resultSha256 !== feedsClientHash(feedsClientJson(response.result, MAX_FEEDS_RESPONSE_BYTES))) ||
      response && !invocation)
    throw feedsClientFailure('FEEDS_CLIENT_REQUEST', 'The retained request/response closure is inconsistent.');
  return { schema: 'stellar-forge.feeds-client-record.v1', directory: root,
    state: response ? 'RESPONSE_RETAINED' : invocation ? 'RECONCILIATION_REQUIRED' : 'PREPARED',
    request, invocation, response };
}
export async function withFeedsRequest({ directory, request, signal }, action) {
  request = validateFeedsRequest(request); signal?.throwIfAborted();
  const root = await feedsClientDirectory(directory, true), lease = await acquireStateLease(root);
  let originalError;
  try {
    lease.assertHeld(); await writeFeedsRequest(join(root, 'request.json'), request);
    const current = await inspectFeedsRequest({ directory: root, signal });
    return await action({ ...current, assertHeld: () => lease.assertHeld(),
      async markInvocation() {
        signal?.throwIfAborted(); lease.assertHeld();
        const value = { schema: 'stellar-forge.feeds-client-invocation.v1', endpoint: request.endpoint,
          workspace: request.workspace, requestSha256: request.requestSha256 };
        await writeFeedsPrivateFile(join(root, 'invocation.json'), feedsClientJson(value));
      },
      async retainResponse(result) {
        lease.assertHeld();
        const value = { schema: FEEDS_REQUEST_RESULT_SCHEMA, endpoint: request.endpoint,
          workspace: request.workspace, requestSha256: request.requestSha256,
          resultSha256: feedsClientHash(feedsClientJson(result, MAX_FEEDS_RESPONSE_BYTES)), result };
        await writeFeedsPrivateFile(join(root, 'response.json'), feedsClientJson(value, MAX_FEEDS_RESPONSE_BYTES));
        return inspectFeedsRequest({ directory: root });
      },
    });
  } catch (error) { originalError = error; throw error; }
  finally {
    try { await lease.close(); }
    catch (error) {
      const primary = originalError ?? error;
      primary.close = () => lease.close();
      if (originalError) primary.closeError = error;
      throw primary;
    }
  }
}
export async function retainFeedsRequest({ directory, request, signal } = {}) {
  return withFeedsRequest({ directory, request, signal }, current =>
    ({ schema: current.schema, directory: current.directory, state: current.state,
      request: current.request, invocation: current.invocation, response: current.response }));
}
