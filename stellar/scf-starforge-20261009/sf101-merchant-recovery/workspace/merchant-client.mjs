// MIT. Merchant agent operations through the original recovery workspace listener.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { recoveryWorkspaceTools, RECOVERY_ID_PATTERN, RECOVERY_SHA_PATTERN } from './merchant-catalog.mjs';

export { recoveryWorkspaceTools } from './merchant-catalog.mjs';
export const RECOVERY_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.recovery-workspace-connection.v1';
const SOURCE_DIRECTORY = fileURLToPath(new URL('./', import.meta.url)).replace(/[\\/]$/, '');
const MAX_REQUEST_BYTES = 65536, MAX_REPLY_BYTES = 32 * 1024 * 1024;
const ID = new RegExp(RECOVERY_ID_PATTERN), SHA = new RegExp(RECOVERY_SHA_PATTERN);
const encodeSha = value => createHash('sha256').update(value).digest('hex');
const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
const metadataFields = ['status', 'providerCode', 'originalCode', 'requestId', 'putRequestId',
  'retryAfter', 'retryable', 'mayHaveCommitted', 'reconciliationCode', 'reconciliationStatus'];
const checked = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value))
    throw failure('INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
};
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Select an original host path in the private connection.');
  return resolve(base, value);
}
async function privateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory ||
    process.platform !== 'win32' && ((info.mode & 0o077) ||
      typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw failure('CONFIGURATION_ERROR', 'Select the owned canonical private original recovery workspace.');
}
async function privateBytes(path) {
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Select the canonical private recovery connection.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_REQUEST_BYTES ||
      process.platform !== 'win32' && ((info.mode & 0o077) ||
        typeof process.getuid === 'function' && info.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Read an owned private regular recovery connection within 64 KiB.');
    const bytes = await handle.readFile();
    if (bytes.length !== info.size || bytes.length > MAX_REQUEST_BYTES)
      throw failure('CONFIGURATION_ERROR', 'Read the complete unchanged recovery connection.');
    return bytes;
  } finally { await handle.close(); }
}
async function nativeModule(sourceDirectory) {
  const info = await lstat(sourceDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(sourceDirectory) !== sourceDirectory)
    throw failure('CONFIGURATION_ERROR', 'Select the canonical installed original recovery source directory.');
  const entry = join(sourceDirectory, 'connection.mjs'), entryInfo = await lstat(entry);
  if (!entryInfo.isFile() || entryInfo.isSymbolicLink() || await realpath(entry) !== entry)
    throw failure('CONFIGURATION_ERROR', 'The selected original source must contain its native connection.mjs.');
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.readRecoveryWorkspaceSelection !== 'function' || typeof module.readRecoveryWorkspaceLaunch !== 'function')
    throw failure('CONFIGURATION_ERROR', 'Use the maintained original recovery connection interface.');
  return module;
}

/** Host paths are selected here, never in agent-supplied tool arguments. */
export async function readRecoveryWorkspaceConfiguration(path) {
  path = resolve(path);
  const bytes = await privateBytes(path);
  let raw;
  try { raw = JSON.parse(decode(bytes)); }
  catch { throw failure('CONFIGURATION_ERROR', 'Read the complete UTF-8 recovery workspace connection JSON.'); }
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== RECOVERY_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare one to thirty-two original recovery workspace aliases.');
  const base = dirname(path), workspaces = Object.create(null), directories = new Set();
  for (const [workspace, value] of Object.entries(raw.workspaces)) {
    identifier(workspace, 'recovery workspace alias');
    exact(value, ['label', 'directory', 'configFile', 'sourceDirectory'], ['directory', 'configFile']);
    const directory = hostPath(value.directory, base), configFile = hostPath(value.configFile, base);
    await privateDirectory(directory);
    if (directories.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original recovery workspace one alias.');
    directories.add(directory);
    const sourceDirectory = value.sourceDirectory === undefined ? SOURCE_DIRECTORY : hostPath(value.sourceDirectory, base);
    const native = await nativeModule(sourceDirectory);
    const identity = await native.readRecoveryWorkspaceSelection({ directory, configFile });
    workspaces[workspace] = { label: line(value.label ?? workspace, 'Recovery workspace label'),
      directory, configFile, sourceDirectory, identity };
  }
  return { schema: RECOVERY_WORKSPACE_CONNECTION_SCHEMA, connectionFile: path,
    selectionSha256: encodeSha(bytes), workspaces };
}

const definitions = new Map(recoveryWorkspaceTools((name, description, properties, required, options) =>
  ({ name, properties, required, options })).map(value => [value.name, value]));
const paged = new Set(['merchant_recovery_inventory', 'merchant_recovery_requests', 'merchant_recovery_operations']);
const writes = new Set(['merchant_recovery_start', 'merchant_recovery_resume', 'merchant_recovery_cancel']);
function validateSelection(value) {
  exact(value, ['profileId', 'action', 'id', 'bundleId', 'snapshotId', 'destinationName',
    'capturePlanId', 'quiesced', 'restoreId', 'publisherRestoreId'], ['profileId', 'action', 'id']);
  checked(value.profileId, ID, 'profile ID'); checked(value.id, ID, 'operation ID');
  if (!['snapshot', 'verify', 'publisher-prepare', 'push', 'pull', 'restore', 'resume'].includes(value.action))
    throw failure('INVALID_PARAMS', 'Choose an original recovery action.');
  for (const key of ['destinationName', 'capturePlanId', 'restoreId', 'publisherRestoreId'])
    if (value[key] !== undefined) checked(value[key], ID, key);
  if (value.snapshotId !== undefined) checked(value.snapshotId, SHA, 'snapshot SHA256');
  if (value.bundleId !== undefined && (typeof value.bundleId !== 'string' || value.bundleId.length > 1024 ||
      !value.bundleId.includes('/') || /[\0\r\n\\]/.test(value.bundleId)))
    throw failure('INVALID_PARAMS', 'Use the exact bundleId returned by this original workspace.');
  if (value.quiesced !== undefined && value.quiesced !== true)
    throw failure('INVALID_PARAMS', 'Fresh capture requires the explicit actual producer-quiescence acknowledgment.');
}
function validate(name, input) {
  if (input.profileId !== undefined) checked(input.profileId, ID, 'profile ID');
  if (input.id !== undefined) checked(input.id, ID, 'operation ID');
  if (input.selection !== undefined) validateSelection(input.selection);
  if (input.expectedReviewHash !== undefined) checked(input.expectedReviewHash, SHA, 'native review hash');
  if (paged.has(name)) {
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))
      throw failure('INVALID_PARAMS', 'Use the original page size from one through one hundred.');
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 8192 ||
        /[\0\r\n]/.test(input.cursor)))
      throw failure('INVALID_PARAMS', 'Continue the original opaque nextCursor unchanged.');
  }
}
function urlQuery(route, values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value));
  return route + (query.size ? '?' + query.toString() : '');
}
function scope(workspace, input) {
  const selected = input.selection ?? input;
  return { workspace, ...(selected.profileId === undefined ? {} : { profileId: selected.profileId }),
    ...(selected.id === undefined ? {} : { operationId: selected.id }) };
}
function nativeFailure(native, { workspace, input, status, uncertain = false, mutationRequestAttempted = false } = {}) {
  const safe = { code: typeof native?.code === 'string' ? native.code.slice(0,100) : 'RECOVERY_WORKSPACE_FAILED',
    message: typeof native?.message === 'string' ? native.message.slice(0,500) : 'The original recovery request failed.' };
  for (const key of metadataFields) if (['string','number','boolean'].includes(typeof native?.[key])) safe[key] = native[key];
  const selected = scope(workspace, input ?? {});
  const details = { outcome: uncertain ? 'OUTCOME_UNKNOWN' : Number.isInteger(status) && status >= 400 ? 'REJECTED' : 'READ_FAILED', ...selected,
    ...(Number.isInteger(status) ? { httpStatus: status } : {}), mutationRequestAttempted, error: safe };
  if (selected.profileId && selected.operationId) details.readback = {
    tool: 'merchant_recovery_request', arguments: { workspace, profileId: selected.profileId, id: selected.operationId } };
  if (uncertain) details.mayHaveCommitted = true;
  // The original MCP HTTP/stdio transport retains code and reason. Keep the
  // complete sanitized native envelope in that reason and on direct callers.
  const error = failure(safe.code, JSON.stringify(details));
  Object.assign(error, { details }, Number.isInteger(status) ? { status } : {});
  return error;
}

/** Borrows the original native listener; close drains only this adapter's calls. */
export class MerchantRecoveryWorkspaces {
  #workspaces; #active = new Set(); #closing = false; #closed;
  constructor(config) { this.#workspaces = config.recoveryWorkspaces?.workspaces ?? Object.create(null); }
  get summary() {
    return { configured: Object.keys(this.#workspaces).length > 0, ownership: 'ORIGINAL_RECOVERY_WORKSPACE',
      workspaces: Object.entries(this.#workspaces).map(([workspace, value]) => ({
        workspace, label: value.label, workspaceId: value.identity.workspaceId,
        configurationSha256: value.identity.configurationSha256 })),
      activeCalls: this.#active.size, closing: this.#closing };
  }
  async #launch(workspace) {
    const selected = this.#workspaces[workspace];
    if (!selected) throw failure('RECOVERY_WORKSPACE_NOT_CONFIGURED', 'Select a host-declared original recovery workspace alias.');
    const native = await nativeModule(selected.sourceDirectory);
    return native.readRecoveryWorkspaceLaunch({ directory: selected.directory, configFile: selected.configFile,
      expectedIdentity: selected.identity });
  }
  async #request(workspace, name, input) {
    const launch = await this.#launch(workspace);
    const action = name.slice('merchant_recovery_'.length);
    let method = 'GET', route, body;
    if (action === 'status') route = '/api/state';
    else if (action === 'requests') route = urlQuery('/api/requests', { cursor: input.cursor, limit: input.limit });
    else if (['request', 'operation'].includes(action)) route = urlQuery('/api/' + action, { profile: input.profileId, id: input.id });
    else if (['bundles', 'inventory', 'operations'].includes(action))
      route = urlQuery('/api/' + action, { profile: input.profileId, cursor: input.cursor, limit: input.limit });
    else {
      method = 'POST'; route = '/api/' + action;
      body = JSON.stringify(action === 'review' ? input.selection : input);
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES)
        throw failure('INVALID_PARAMS', 'The original native recovery request exceeds 64 KiB.');
    }
    let response;
    try {
      response = await fetch(launch.origin + route, { method, redirect: 'error',
        headers: { 'x-recovery-token': launch.token, origin: launch.origin, accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(120000) });
    } catch {
      throw nativeFailure({ code: 'RECOVERY_WORKSPACE_RESPONSE_UNAVAILABLE',
        message: 'Read the same original request before continuing an interrupted response.' },
        { workspace, input, uncertain: writes.has(name), mutationRequestAttempted: writes.has(name) });
    }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > MAX_REPLY_BYTES) throw failure('RECOVERY_WORKSPACE_REPLY_LIMIT',
          'Read the exact retained request or a smaller original page; this response exceeds 32 MiB.');
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      throw nativeFailure({ code: error.code ?? 'RECOVERY_WORKSPACE_RESPONSE_INTERRUPTED',
        message: error.message ?? 'The native response was interrupted.' },
        { workspace, input, status: response.status, uncertain: writes.has(name), mutationRequestAttempted: writes.has(name) });
    }
    let value;
    try { value = JSON.parse(decode(Buffer.concat(chunks, size))); }
    catch {
      throw nativeFailure({ code: 'RECOVERY_WORKSPACE_REPLY_INVALID', message: 'The native listener did not return complete UTF-8 JSON.' },
        { workspace, input, status: response.status, uncertain: writes.has(name), mutationRequestAttempted: writes.has(name) });
    }
    if (!response.ok) throw nativeFailure(value?.error, { workspace, input, status: response.status,
      uncertain: writes.has(name) && (response.status >= 500 || value?.error?.mayHaveCommitted === true),
      mutationRequestAttempted: writes.has(name) });
    if (!plain(value)) throw nativeFailure({ code: 'RECOVERY_WORKSPACE_REPLY_INVALID',
      message: 'The native recovery operation did not return an object.' },
      { workspace, input, status: response.status, uncertain: writes.has(name), mutationRequestAttempted: writes.has(name) });
    return { ...value, workspace, connection: { instanceId: launch.instanceId,
      workspaceId: launch.identity.workspaceId, configurationSha256: launch.identity.configurationSha256,
      sourceDirectory: launch.sourceDirectory, origin: launch.origin } };
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(failure('RECOVERY_WORKSPACE_CLOSING', 'The recovery agent adapter is closing.'));
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(failure('TOOL_NOT_FOUND', 'Unknown original recovery workspace tool.'));
    exact(args, Object.keys(definition.properties), definition.required);
    const workspace = identifier(args.workspace, 'recovery workspace alias'), { workspace: ignored, ...input } = args;
    validate(name, input);
    const selected = JSON.parse(JSON.stringify(input)), pending = this.#request(workspace, name, selected);
    this.#active.add(pending); pending.finally(() => this.#active.delete(pending)).catch(() => {});
    return pending;
  }
  close() {
    return this.#closed ??= (async () => {
      this.#closing = true;
      await Promise.allSettled([...this.#active]);
    })();
  }
}
