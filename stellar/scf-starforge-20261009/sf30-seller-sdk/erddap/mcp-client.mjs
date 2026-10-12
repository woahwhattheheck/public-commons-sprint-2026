// MIT. Complete client for the original retained ERDDAP operator.
import { constants } from 'node:fs';
import { open, mkdir, link, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const CONNECTION_SCHEMA = 'stellar-forge.erddap-workspace-connection.v1';
export const STARTUP_SCHEMA = 'stellar-forge.erddap-workspace-startup.v1';
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const SHA = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function failure(code, message, details = {}) {
  return Object.assign(new Error(message), { name: 'ErddapClientError', code: 'ERDDAP_' + code, ...details });
}
function need(value, code, message) { if (!value) throw failure(code, message); }
function fields(value, keys, label) {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)), 'CONFIG_INVALID', 'Use the declared ' + label + ' fields.');
}
function text(value, label, max = 8192) {
  need(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value),
    'CONFIG_INVALID', 'Supply the original ' + label + '.'); return value;
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    need(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'JSON_INVALID', 'Use complete finite JSON.');
    const encoded = JSON.stringify(value); need(encoded !== undefined, 'JSON_INVALID', 'Use JSON values.'); return encoded;
  }
  return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
    '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export async function readHostFile(path, maximum = MAX_FILE_BYTES, { privateFile = false, expectedSha256 } = {}) {
  need(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= MAX_FILE_BYTES, 'FILE_LIMIT_INVALID', 'Use the declared file capacity.');
  if (expectedSha256 !== undefined) need(SHA.test(expectedSha256), 'DIGEST_REQUIRED', 'Use the complete expected SHA256.');
  const handle = await open(resolve(text(path, 'file path')), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maximum, 'FILE_INVALID', 'Read one complete regular original file within its declared capacity.');
    if (privateFile) need(before.nlink === 1 && (process.platform === 'win32' ||
      (before.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || before.uid === process.getuid())),
    'FILE_NOT_PRIVATE', 'The original capability or connection file must be private and owned by this host user.');
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]),
      'FILE_CHANGED', 'The original file changed during the complete read.');
    need(expectedSha256 === undefined || digest(bytes) === expectedSha256, 'FILE_CHANGED', 'The original file differs from its reviewed SHA256.');
    return bytes;
  } finally { await handle.close(); }
}
export async function privateDirectory(path) {
  const full = await realpath(resolve(text(path, 'private directory')));
  const handle = await open(full, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isDirectory() && (process.platform === 'win32' || (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid())), 'DIRECTORY_NOT_PRIVATE',
    'Use the original private, operator-owned directory.');
  } finally { await handle.close(); }
  return full;
}
export async function readErddapConfiguration(path) {
  path = resolve(text(path, 'connection configuration path'));
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readHostFile(path, 1024 * 1024, { privateFile: true })));
  fields(raw, ['schema', 'workspaces'], 'connection');
  need(raw.schema === CONNECTION_SCHEMA && plain(raw.workspaces) && Object.keys(raw.workspaces).length >= 1 &&
    Object.keys(raw.workspaces).length <= 32, 'CONFIG_INVALID', 'Declare 1–32 existing ERDDAP operator aliases.');
  const base = dirname(path), workspaces = Object.create(null);
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    need(ALIAS.test(alias), 'CONFIG_INVALID', 'Use a lower-case workspace alias.');
    fields(value, ['label', 'workspace', 'connectionFile', 'connectionEnv', 'timeoutMs', 'maxResponseBytes', 'inputs'], 'workspace');
    need(Boolean(value.connectionFile) !== Boolean(value.connectionEnv), 'CONFIG_INVALID', 'Select the existing private startup file or host environment variable.');
    const item = { label: text(value.label ?? alias, 'workspace label', 240),
      workspace: await privateDirectory(resolve(base, text(value.workspace, 'original workspace'))), inputs: Object.create(null) };
    if (value.connectionFile) item.connectionFile = resolve(base, text(value.connectionFile, 'original startup file'));
    if (value.connectionEnv) {
      need(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.connectionEnv), 'CONFIG_INVALID', 'Name the original host environment variable.');
      item.connectionEnv = value.connectionEnv;
    }
    item.timeoutMs = value.timeoutMs ?? 180000;
    item.maxResponseBytes = value.maxResponseBytes ?? 64 * 1024 * 1024;
    need(Number.isSafeInteger(item.timeoutMs) && item.timeoutMs >= 1 && item.timeoutMs <= 30 * 60 * 1000 &&
      Number.isSafeInteger(item.maxResponseBytes) && item.maxResponseBytes >= 1024 && item.maxResponseBytes <= MAX_FILE_BYTES,
    'CONFIG_INVALID', 'Choose explicit supported request time and complete-response capacity.');
    if (value.inputs !== undefined) {
      need(plain(value.inputs) && Object.keys(value.inputs).length <= 128, 'CONFIG_INVALID', 'Declare at most 128 original input aliases.');
      for (const [name, input] of Object.entries(value.inputs)) {
        need(ALIAS.test(name), 'CONFIG_INVALID', 'Use a lower-case input alias.');
        fields(input, ['path', 'kind', 'label', 'sha256'], 'original input');
        need(['source', 'packet'].includes(input.kind) && SHA.test(input.sha256 ?? ''), 'CONFIG_INVALID',
          'Pin the complete source or customer packet with its original SHA256.');
        item.inputs[name] = { path: resolve(base, text(input.path, 'source path')), kind: input.kind,
          label: text(input.label ?? name, 'input label', 160), sha256: input.sha256 };
      }
    }
    workspaces[alias] = item;
  }
  return { schema: CONNECTION_SCHEMA, path, workspaces };
}
function parseConnection(raw, definition) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.trim()); } catch { throw failure('CONNECTION_INVALID', 'Read the complete original private startup JSON record.'); }
  }
  if (raw?.schema === 'stellar-forge.application-url.v1' && raw.command === 'erddap' && raw.original?.schema === STARTUP_SCHEMA)
    raw = { ...raw.original, url: raw.url };
  need(plain(raw) && raw.schema === STARTUP_SCHEMA && raw.state === 'LISTENING' &&
    typeof raw.instanceId === 'string' && /^[a-f0-9-]{36}$/.test(raw.instanceId) && raw.workspace === definition.workspace,
  'CONNECTION_CHANGED', 'The startup record must select this original workspace and running instance.');
  let url; try { url = new URL(raw.url); } catch { throw failure('CONNECTION_INVALID', 'Use the original private ERDDAP operator URL.'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && Number(url.port) >= 1 && Number(url.port) <= 65535 &&
    /^#[A-Za-z0-9_-]{43}$/.test(url.hash), 'CONNECTION_INVALID', 'Use the original loopback operator and its capability fragment.');
  return { origin: url.origin, token: url.hash.slice(1), instanceId: raw.instanceId,
    workspace: raw.workspace, startedAt: raw.startedAt };
}
async function consume(response, maximum) {
  const declared = response.headers.get('content-length');
  need(declared === null || /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared)) &&
    Number(declared) <= maximum, 'RESPONSE_TOO_LARGE', 'The original response exceeds its complete byte capacity.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maximum) { await response.body?.cancel().catch(() => {}); throw failure('RESPONSE_TOO_LARGE', 'The original response exceeded its declared capacity.'); }
    chunks.push(Buffer.from(chunk));
  }
  need(declared === null || Number(declared) === size, 'RESPONSE_INCOMPLETE', 'The original response ended before its declared byte count.');
  return Buffer.concat(chunks, size);
}
export class ErddapClient {
  #definition; #environment; #fetch; #closed = false; #closing; #pending = new Set(); #bound = null;
  constructor(definition, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    need(plain(definition) && typeof fetchImpl === 'function', 'CONFIG_INVALID', 'Use the configured original workspace.');
    this.#definition = definition; this.#environment = environment; this.#fetch = fetchImpl;
  }
  get metadata() { return { workspace: this.#definition.workspace, connected: Boolean(this.#bound),
    instanceId: this.#bound?.instanceId ?? null, closed: this.#closed, activeRequests: this.#pending.size, hostOwnership: 'ORIGINAL_ERDDAP_WORKSPACE' }; }
  #run(fn) {
    if (this.#closed) return Promise.reject(failure('CLIENT_CLOSED', 'The original client is closing.'));
    const pending = Promise.resolve().then(fn); this.#pending.add(pending);
    pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending)); return pending;
  }
  async #connection() {
    const d = this.#definition, raw = d.connectionFile ?
      new TextDecoder('utf-8', { fatal: true }).decode(await readHostFile(d.connectionFile, 65536, { privateFile: true })) :
      d.connectionEnv ? this.#environment[d.connectionEnv] : d.startup;
    const selected = parseConnection(raw, d);
    const response = await this.#send(selected, '/api/launch', {});
    const live = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await consume(response, 16384)));
    need(live?.schema === STARTUP_SCHEMA && live.state === 'LISTENING' && live.workspace === selected.workspace &&
      live.instanceId === selected.instanceId, 'CONNECTION_CHANGED', 'The authenticated live owner differs from the selected original workspace.');
    this.#bound = selected; return selected;
  }
  async #send(selected, path, { method = 'GET', body, type = 'application/json', headers = {}, operationId } = {}) {
    const safe = { method, path, workspace: selected.workspace, ...(operationId ? { operationId } : {}) };
    let response;
    try { response = await this.#fetch(selected.origin + path, { method, redirect: 'error',
      headers: { accept: 'application/json', authorization: 'Bearer ' + selected.token, origin: selected.origin,
        ...(body === undefined ? {} : { 'content-type': type }), ...headers },
      ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(this.#definition.timeoutMs ?? 180000) }); }
    catch { throw failure('TRANSPORT_UNCERTAIN', 'The original response was not received. Reopen the saved query, mapping, build or acquisition operation before retrying.',
      { ...safe, responseReceived: false, ambiguous: method !== 'GET' }); }
    if (!response.ok) {
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await consume(response, 1024 * 1024))); } catch {}
      const message = typeof value?.message === 'string' ? value.message :
        typeof value?.error === 'string' ? value.error : typeof value?.error?.message === 'string' ? value.error.message : 'The original operator rejected the request.';
      throw failure('HTTP_' + response.status, message.split(selected.token).join('[private capability]'),
        { ...safe, status: response.status, responseReceived: true, providerStatus: value?.providerStatus ?? null,
          retryAfter: value?.retryAfter ?? response.headers.get('retry-after') ?? null });
    }
    return response;
  }
  json(path, body, { operationId } = {}) {
    return this.#run(async () => {
      const selected = await this.#connection(), method = body === undefined ? 'GET' : 'POST';
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      need(encoded === undefined || Buffer.byteLength(encoded) <= 1024 * 1024, 'REQUEST_TOO_LARGE', 'Use a complete mapping or explicit selection within the native JSON capacity.');
      const response = await this.#send(selected, path, { method, body: encoded, operationId });
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await consume(response, this.#definition.maxResponseBytes ?? 64 * 1024 * 1024))); }
      catch (error) { if (error.code?.startsWith('ERDDAP_')) throw error;
        throw failure('RESPONSE_INCOMPLETE', 'The original JSON response did not complete. Reopen the same retained operation.',
          { method, path, ambiguous: method !== 'GET', operationId }); }
    });
  }
  upload(input) {
    return this.#run(async () => {
      const bytes = await readHostFile(input.path, input.kind === 'source' ? 256 * 1024 * 1024 : MAX_FILE_BYTES, { expectedSha256: input.sha256 });
      const selected = await this.#connection(), path = input.kind === 'source' ? '/api/sources' : '/api/packets';
      const response = await this.#send(selected, path, { method: 'POST', body: bytes, type: 'application/zip',
        headers: { 'x-source-name': encodeURIComponent(basename(input.path)), 'x-source-label': encodeURIComponent(input.label) } });
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await consume(response, this.#definition.maxResponseBytes ?? 64 * 1024 * 1024))); }
      catch { throw failure('RESPONSE_INCOMPLETE', 'The original import response did not complete. Inspect the source ID or received build before retrying.',
        { path, ambiguous: true, sourceSha256: input.sha256 }); }
    });
  }
  file(selection, directory, expectedSha256) {
    return this.#run(async () => {
      let path, name;
      if (selection.kind === 'source') {
        need(SHA.test(selection.sourceId ?? '') && ['manifest.json', 'metadata.json', 'dataset.dds', 'dataset.das', 'data.json', 'data.csv'].includes(selection.member),
          'FILE_SELECTION_INVALID', 'Choose the retained source and its exact original member.');
        path = '/api/sources/' + selection.sourceId + '/files/' + encodeURIComponent(selection.member); name = selection.member;
      } else {
        need(['packet', 'dataset'].includes(selection.kind) && SHA.test(selection.buildId ?? ''), 'FILE_SELECTION_INVALID', 'Choose the complete original build export.');
        path = '/api/builds/' + selection.buildId + '/' + selection.kind; name = 'erddap-' + selection.kind + '-' + selection.buildId.slice(0, 12) + '.zip';
      }
      if (expectedSha256 !== undefined) need(SHA.test(expectedSha256), 'DIGEST_REQUIRED', 'Use a complete expected SHA256.');
      directory = await privateDirectory(directory);
      const selected = await this.#connection(), response = await this.#send(selected, path, {});
      const limit = this.#definition.maxResponseBytes ?? 64 * 1024 * 1024;
      const declared = response.headers.get('content-length');
      need(declared === null || /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared)) && Number(declared) <= limit,
        'RESPONSE_TOO_LARGE', 'The complete native export exceeds the configured capacity.');
      const temporary = join(directory, '.erddap-' + randomUUID()), hash = createHash('sha256');
      let writer, reader, size = 0;
      try {
        writer = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        for await (const chunk of response.body ?? []) {
          size += chunk.length; need(size <= limit, 'RESPONSE_TOO_LARGE', 'The native export exceeded its configured capacity.');
          hash.update(chunk); await writer.writeFile(chunk);
        }
        need(declared === null || Number(declared) === size, 'RESPONSE_INCOMPLETE', 'The complete native export did not finish.');
        await writer.sync(); await writer.close(); writer = null;
        const sha256 = hash.digest('hex');
        need(expectedSha256 === undefined || expectedSha256 === sha256, 'FILE_CHANGED', 'The original export differs from the selected SHA256.');
        const retained = join(directory, 'erddap-' + sha256 + '.bin');
        try { await link(temporary, retained); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        reader = await open(retained, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const stat = await reader.stat(); need(stat.isFile() && stat.size === size, 'FILE_CHANGED', 'The retained export identity differs.');
        const owned = reader; reader = null;
        return { readonlyFileHandle: owned, bytes: size, sha256, name, type: response.headers.get('content-type') ?? 'application/octet-stream' };
      } finally { await writer?.close(); await reader?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  }
  close() {
    if (!this.#closing) { this.#closed = true; this.#closing = Promise.allSettled([...this.#pending]).then(() => { this.#bound = null; }); }
    return this.#closing;
  }
}
