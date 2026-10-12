// MIT. Shared host connection to the original SF61 OpenAPI and HAR console.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
export const SF61_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.sf61-workspace-connection.v1';
export const SF61_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const SF61_MAX_JSON_BYTES = 10 * 1024 * 1024;
export const SF61_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const SF61_SHA = /^[a-f0-9]{64}$/;
export const sf61Hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const sf61Failure = (code, message) => Object.assign(new Error(message), { code });
export const sf61Plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export function sf61Exact(value, keys, required = []) {
  if (!sf61Plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value,key)))
    throw sf61Failure('INVALID_PARAMS', 'Supply the declared fields and every required field.');
}
export function sf61Checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw sf61Failure('INVALID_PARAMS', 'Select a valid ' + label + '.');
  return value;
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value))
    throw sf61Failure('CONFIGURATION_ERROR', 'Use a nonempty printable label of at most 160 characters.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw sf61Failure('CONFIGURATION_ERROR', 'Declare an original host file or receiving directory.');
  return resolve(base, value);
}
export async function readSf61HostFile(path, maximum, { privateFile = false, sha256 } = {}) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || privateFile && (before.nlink !== 1 || process.platform !== 'win32' && (before.mode & 0o077)))
      throw sf61Failure('SF61_HOST_FILE_INVALID', 'Select a regular host file within its original size and privacy limits.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || before.ino !== after.ino || before.dev !== after.dev)
      throw sf61Failure('SF61_HOST_FILE_CHANGED', 'The selected host file changed while it was being read.');
    if (sha256 !== undefined && sf61Hash(bytes) !== sf61Checked(sha256, SF61_SHA, 'host file SHA256'))
      throw sf61Failure('SF61_HOST_FILE_CHANGED', 'The complete host file differs from its configured SHA256.');
    return bytes;
  } finally { await handle.close(); }
}
/** Host handles are the only file and receiving paths exposed to consumers. */
export async function readSf61WorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(decode(await readSf61HostFile(path, 1024 * 1024, { privateFile: true })));
  sf61Exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== SF61_WORKSPACE_CONNECTION_SCHEMA || !sf61Plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw sf61Failure('CONFIGURATION_ERROR', 'Declare 1–32 original SF61 workspaces.');
  const base = dirname(path), workspaces = Object.create(null);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    sf61Checked(alias, SF61_ALIAS, 'workspace alias');
    sf61Exact(input, ['label','consoleUrlEnv','consoleUrlFile','files','deliveries']);
    if ((input.consoleUrlEnv === undefined) === (input.consoleUrlFile === undefined))
      throw sf61Failure('CONFIGURATION_ERROR', 'Choose exactly one original console URL environment or private file reference.');
    const files = Object.create(null), deliveries = Object.create(null);
    if (input.files !== undefined && (!sf61Plain(input.files) || Object.keys(input.files).length > 128))
      throw sf61Failure('CONFIGURATION_ERROR', 'Declare at most 128 original file handles.');
    for (const [name, file] of Object.entries(input.files ?? {})) {
      sf61Checked(name, SF61_ALIAS, 'file handle'); sf61Exact(file, ['path','kind','label','sha256'], ['path','kind']);
      if (!['source','plan','har','decisions','packet'].includes(file.kind))
        throw sf61Failure('CONFIGURATION_ERROR', 'File kind must be source, plan, har, decisions or packet.');
      files[name] = { path: hostPath(file.path, base), kind: file.kind,
        ...(file.label === undefined ? {} : { label: label(file.label) }),
        ...(file.sha256 === undefined ? {} : { sha256: sf61Checked(file.sha256, SF61_SHA, 'file SHA256') }) };
    }
    if (input.deliveries !== undefined && (!sf61Plain(input.deliveries) || Object.keys(input.deliveries).length > 64))
      throw sf61Failure('CONFIGURATION_ERROR', 'Declare at most 64 complete receiving-directory handles.');
    for (const [name, delivery] of Object.entries(input.deliveries ?? {})) {
      sf61Checked(name, SF61_ALIAS, 'delivery handle'); sf61Exact(delivery, ['directory','label','manifestSha256'], ['directory']);
      deliveries[name] = { directory: hostPath(delivery.directory, base),
        ...(delivery.label === undefined ? {} : { label: label(delivery.label) }),
        ...(delivery.manifestSha256 === undefined ? {} : { manifestSha256: sf61Checked(delivery.manifestSha256, SF61_SHA, 'delivery manifest SHA256') }) };
    }
    workspaces[alias] = { label: label(input.label ?? alias), files, deliveries,
      ...(input.consoleUrlEnv === undefined ? { consoleUrlFile: hostPath(input.consoleUrlFile, base) }
        : { consoleUrlEnv: sf61Checked(input.consoleUrlEnv, /^[A-Za-z_][A-Za-z0-9_]*$/, 'console URL environment name') }) };
  }
  return { schema: SF61_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}
export async function readSf61Response(response, maximum = 16 * 1024 * 1024) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > maximum) throw sf61Failure('SF61_RESPONSE_TOO_LARGE', 'Use the original retained file download for this complete result.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
}
function connectionValue(text) {
  if (!text.trimStart().startsWith('{')) return text;
  let record; try { record = JSON.parse(text); } catch {}
  if (!sf61Plain(record) || record.schema !== 'stellar-forge.application-url.v1' ||
      record.command !== 'openapi-workspace' || record.source !== 'original-command-stdout' ||
      typeof record.applicationId !== 'string' || !record.applicationId || typeof record.operationId !== 'string' ||
      !record.operationId || !Number.isFinite(Date.parse(record.observedAt)) || typeof record.url !== 'string' ||
      record.original !== undefined && !sf61Plain(record.original))
    throw sf61Failure('SF61_CONSOLE_CONNECTION_INVALID', 'Select the original Applications openapi-workspace URL record or printed console URL.');
  return record.url;
}
/** Rereads the selected private URL record after every original managed restart. */
export class Sf61WorkspaceClient {
  #definition; #environment;
  constructor(definition, { environment = process.env } = {}) { this.#definition = definition; this.#environment = environment; }
  get definition() { return this.#definition; }
  async connection() {
    let raw;
    try {
      raw = this.#definition.consoleUrlFile
        ? connectionValue(decode(await readSf61HostFile(this.#definition.consoleUrlFile, 16384, { privateFile: true })).trim())
        : this.#environment[this.#definition.consoleUrlEnv];
    } catch (error) {
      if (error.code === 'SF61_CONSOLE_CONNECTION_INVALID') throw error;
      throw sf61Failure('SF61_CONSOLE_UNAVAILABLE', 'Reopen the original console and update its declared private URL file.');
    }
    let url; try { url = new URL(raw); } catch {}
    const port = Number(url?.port || 80);
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) || !Number.isInteger(port) || port < 1 || port > 65535)
      throw sf61Failure('SF61_CONSOLE_CONNECTION_INVALID', 'Use the complete private URL printed by the original SF61 console.');
    return { origin: url.origin, token: url.hash.slice(1) };
  }
  async request(route, { body, method = body === undefined ? 'GET' : 'POST', headers = {}, signal, timeoutMs = 240000 } = {},
    consume = response => readSf61Response(response)) {
    if (typeof route !== 'string' || !route.startsWith('/api/') || /[\x00-\x20#]/.test(route) || !['GET','POST'].includes(method))
      throw sf61Failure('INVALID_PARAMS', 'Select an original SF61 API operation.');
    const connection = await this.connection(), target = new URL(route, connection.origin);
    if (target.origin !== connection.origin || !target.pathname.startsWith('/api/')) throw sf61Failure('INVALID_PARAMS', 'Use the original local console API.');
    const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(target, { method, redirect: 'error', signal: combined,
        headers: { ...headers, 'x-workspace-token': connection.token, Origin: connection.origin },
        ...(body === undefined ? {} : { body, ...(typeof body === 'string' || Buffer.isBuffer(body) ||
          body instanceof Uint8Array || body instanceof FormData ? {} : { duplex: 'half' }) }) });
      if (!response.ok) {
        let detail = {}; try { detail = JSON.parse(decode(await readSf61Response(response, 65536))); } catch {}
        const error = sf61Failure(typeof detail.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(detail.code) ? detail.code : 'SF61_CONSOLE_REJECTED',
          typeof detail.error === 'string' ? detail.error.slice(0,2000) : 'The original console returned HTTP ' + response.status + '.');
        error.status = response.status; if (detail.outcomeUnknown) error.outcomeUnknown = true; throw error;
      }
      return await consume(response);
    } catch (error) {
      if (error.status || error.code?.startsWith('SF61_') || error.code === 'INVALID_PARAMS') throw error;
      const issue = sf61Failure('SF61_CONSOLE_OPERATION_INTERRUPTED', 'The original console request was interrupted. Reopen the saved package, review or export to continue this operation.');
      if (method === 'POST') issue.outcomeUnknown = true; throw issue;
    }
  }
  json(route, body, options = {}) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > SF61_MAX_JSON_BYTES)
      throw sf61Failure('INVALID_PARAMS', 'The original SF61 JSON request exceeds 10 MiB.');
    return this.request(route, { ...options, body: payload,
      headers: { ...(options.headers ?? {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) } },
      async response => JSON.parse(decode(await readSf61Response(response))));
  }
  file(handle, kind) {
    const file = this.#definition.files[sf61Checked(handle, SF61_ALIAS, 'file handle')];
    if (!file || kind !== undefined && file.kind !== kind) throw sf61Failure('INVALID_PARAMS', 'Select a configured original ' + (kind ?? 'source') + ' file handle.');
    return file;
  }
  async source(handle, kind = 'source', maximum = SF61_MAX_SOURCE_BYTES) {
    const file = this.file(handle, kind), bytes = await readSf61HostFile(file.path, maximum, { sha256: file.sha256 });
    return { text: decode(bytes), sha256: sf61Hash(bytes), bytes: bytes.length };
  }
  delivery(handle) {
    const delivery = this.#definition.deliveries[sf61Checked(handle, SF61_ALIAS, 'delivery handle')];
    if (!delivery) throw sf61Failure('INVALID_PARAMS', 'Choose a configured complete receiving-directory handle.');
    return delivery;
  }
}
