// MIT. Operate the original saved 360Giving publisher without replacing its jobs.
import http from 'node:http';
import {constants as FS} from 'node:fs';
import {open, lstat, link, unlink} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {TextDecoder} from 'node:util';
import {parseExactJSON} from '../../../stellar-expert/exact-json.mjs';

const SCHEMA = 'stellar-forge.360giving-operator.v1';
const STARTUP = 'stellar-forge.360giving-console.v1';
const CONNECTION = 'stellar-forge.application-url.v1';
const COMMAND = 'dataset-360giving-workspace';
const MAX_FILE = 1024 ** 3;
const MAX_JSON = 128 * 1024 ** 2;
const MAX_REQUEST = 131072;
const CHUNK = 1024 ** 2;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ACTIONS = new Set(['intake', 'decisions', 'candidate', 'build', 'compare', 'export', 'receive']);
const STATES = new Set(['pending', 'running', 'complete', 'interrupted']);
const CONNECT = Symbol('connect360GivingPublisher');
const UTF8 = new TextDecoder('utf-8', {fatal: true});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class PublisherError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause === undefined ? undefined : {cause: details.cause});
    this.name = 'PublisherError';
    this.code = code;
    for (const name of ['operation', 'requestId', 'objectId', 'statusCode', 'record']) {
      if (details[name] !== undefined) this[name] = details[name];
    }
  }
}
function fail(code, message, details) {
  throw new PublisherError('PUBLISHER360_' + code, message, details);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('INPUT', label + ' must be a nonempty string without control characters');
  }
  return value;
}
function requestId(value) {
  if (typeof value !== 'string' || !KEY.test(value)) fail('INPUT', 'Select the original publisher request ID');
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    fail('INPUT', label + ' must be a positive integer no greater than 2147483647');
  }
  return value;
}
function counter(value, label, maximum = MAX_FILE) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value) || BigInt(value) > BigInt(maximum)) {
    fail('PROTOCOL', label + ' is not a valid original byte/count value');
  }
  return Number(value);
}
function digest(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail('PROTOCOL', label + ' must be the original SHA-256');
  return value;
}
function aborted(context) {
  if (context.signal.aborted) throw context.signal.reason;
}
function annotate(error, context) {
  const chosen = context.signal.aborted ? context.signal.reason : error;
  const result = chosen instanceof PublisherError ? chosen : new PublisherError(
    'PUBLISHER360_INTERRUPTED',
    'The publisher client operation was interrupted; reopen the saved application and continue the original request',
    {cause: chosen instanceof Error ? chosen : undefined});
  if (result.operation === undefined) result.operation = context.operation;
  if (context.requestId !== undefined && result.requestId === undefined) result.requestId = context.requestId;
  return result;
}
function consoleConnection(value) {
  text(value, 'consoleUrl');
  const match = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/#([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) fail('CONNECTION', 'Select the original private loopback publisher console URL');
  const port = match[1] === undefined ? 80 : Number(match[1]);
  if (port < 1 || port > 65535) fail('CONNECTION', 'The publisher connection port is invalid');
  const host = '127.0.0.1' + (port === 80 ? '' : ':' + port);
  return {port, host, origin: 'http://' + host, token: match[2],
    url: 'http://' + host + '/#' + match[2]};
}
function exact(raw, label) {
  try {
    return parseExactJSON(UTF8.decode(raw));
  } catch (cause) {
    fail('PROTOCOL', label + ' is not complete exact JSON', {cause});
  }
}
function jsonInput(value, ancestors = new Set(), depth = 0) {
  if (depth > 80) fail('INPUT', 'Publisher input nesting exceeds 80');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      fail('INPUT', 'Use original JSON text for numeric values outside the safe JavaScript range');
    }
    return value;
  }
  if (!isRecord(value) && !Array.isArray(value)) fail('INPUT', 'Publisher input must contain JSON values');
  if (ancestors.has(value)) fail('INPUT', 'Publisher input must not contain a cycle');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('INPUT', 'Publisher input objects must be plain JSON records');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, item => jsonInput(item, ancestors, depth + 1));
    }
    const copied = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable) continue;
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) {
        fail('INPUT', 'Publisher input must contain original JSON data properties');
      }
      copied[key] = jsonInput(descriptor.value, ancestors, depth + 1);
    }
    return copied;
  } finally {
    ancestors.delete(value);
  }
}
function encode(value) {
  const serialized = JSON.stringify(jsonInput(value));
  if (Buffer.byteLength(serialized) > MAX_REQUEST) fail('INPUT', 'Publisher JSON input exceeds the original 128 KiB request limit');
  return Buffer.from(serialized, 'utf8');
}
function route(path, query) {
  return path + '?' + new URLSearchParams(query).toString();
}
function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid'].every(key => a[key] === b[key]);
}
function sameNode(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}
function privateFile(info) {
  if (process.platform !== 'win32' &&
      ((info.mode & 0o077n) !== 0n || typeof process.getuid === 'function' && info.uid !== BigInt(process.getuid()))) {
    fail('CONNECTION', 'The saved publisher connection must be private and owned by the current operator');
  }
}
async function selectedFile(path, context, {privateConnection = false, maximum = MAX_FILE} = {}) {
  path = resolve(text(path, 'file path'));
  aborted(context);
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximum)) {
    fail('FILE', 'Select a complete regular file within the publisher file limit');
  }
  if (privateConnection) privateFile(before);
  const handle = await open(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    aborted(context);
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameFile(before, opened)) fail('FILE_CHANGED', 'The selected original file changed while opening');
    return {path, handle, before, maximum};
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function unchanged(file, context) {
  aborted(context);
  const opened = await file.handle.stat({bigint: true});
  const current = await lstat(file.path, {bigint: true});
  if (!opened.isFile() || !current.isFile() || current.isSymbolicLink() ||
      !sameFile(file.before, opened) || !sameFile(opened, current)) {
    fail('FILE_CHANGED', 'The selected original file changed while reading');
  }
}
async function* fileChunks(file, context) {
  let position = 0;
  const size = Number(file.before.size);
  while (position < size) {
    aborted(context);
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK, size - position));
    const {bytesRead} = await file.handle.read(chunk, 0, chunk.length, position);
    if (!bytesRead) fail('FILE_CHANGED', 'The selected original file ended before its saved byte count');
    position += bytesRead;
    yield chunk.subarray(0, bytesRead);
  }
  const extra = Buffer.alloc(1);
  if ((await file.handle.read(extra, 0, 1, position)).bytesRead) fail('FILE_CHANGED', 'The selected original file grew while reading');
  await unchanged(file, context);
}
async function hashFile(file, context) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fileChunks(file, context)) {
    hash.update(chunk); bytes += chunk.length;
  }
  return {sha256: hash.digest('hex'), bytes};
}
async function readConnection(path, context) {
  const file = await selectedFile(path, context, {privateConnection: true, maximum: 65536});
  try {
    const chunks = [];
    for await (const chunk of fileChunks(file, context)) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let content;
    try { content = UTF8.decode(raw).trim(); }
    catch (cause) { fail('CONNECTION', 'The saved publisher connection is not UTF-8', {cause}); }
    let record = null;
    if (content.startsWith('{')) {
      record = exact(Buffer.from(content), 'The saved Applications connection');
      if (!isRecord(record) || record.schema !== CONNECTION || record.command !== COMMAND ||
          typeof record.workspaceId !== 'string' || !UUID.test(record.workspaceId) || !isRecord(record.original) ||
          typeof record.original.workspace !== 'string' || !SHA.test(record.original.bindingSha256 ?? '')) {
        fail('CONNECTION', 'Select the saved 360Giving Applications connection with its original workspace binding');
      }
      content = record.url;
    }
    return {...consoleConnection(content), record};
  } finally {
    await file.handle.close();
  }
}
function headerLength(response, maximum, required = true) {
  const value = response.headers['content-length'];
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || BigInt(value) > BigInt(maximum)) {
    fail('PROTOCOL', 'The publisher response has an invalid complete byte count');
  }
  return Number(value);
}
function mediaType(response, expected) {
  const value = response.headers['content-type'];
  const encoding = response.headers['content-encoding'];
  if (typeof value !== 'string' || value.split(';', 1)[0].trim().toLowerCase() !== expected ||
      encoding !== undefined && encoding !== 'identity') {
    fail('PROTOCOL', 'The original publisher returned a different response type');
  }
}
async function responseBytes(response, context, maximum, length = null) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    aborted(context);
    bytes += chunk.length;
    if (bytes > maximum || length !== null && bytes > length) fail('PROTOCOL', 'The publisher response exceeds its complete byte count');
    chunks.push(chunk);
  }
  if (!response.complete || length !== null && bytes !== length) fail('INTERRUPTED', 'The complete publisher response was interrupted');
  return Buffer.concat(chunks, bytes);
}
function writeRequest(request, chunk, ending = false) {
  return new Promise((resolveWrite, rejectWrite) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      request.removeListener('error', onError);
      request.removeListener('close', onClose);
      if (error) rejectWrite(error); else resolveWrite();
    };
    const onError = error => finish(error);
    const onClose = () => finish(new PublisherError('PUBLISHER360_INTERRUPTED', 'The publisher request transport closed while writing'));
    request.once('error', onError);
    request.once('close', onClose);
    try {
      if (ending) {
        if (chunk === null) request.end(finish); else request.end(chunk, finish);
      }
      else request.write(chunk, finish);
    } catch (error) { finish(error); }
  });
}
async function writeAll(handle, chunk, position, context) {
  let offset = 0;
  while (offset < chunk.length) {
    aborted(context);
    const {bytesWritten} = await handle.write(chunk, offset, chunk.length - offset, position + offset);
    if (!bytesWritten) fail('FILE', 'The complete publisher download could not be written');
    offset += bytesWritten;
  }
}
function* textChunks(value) {
  for (let at = 0; at < value.length;) {
    let end = Math.min(at + CHUNK, value.length);
    const previous = value.charCodeAt(end - 1);
    if (end < value.length && previous >= 0xd800 && previous <= 0xdbff) end--;
    yield Buffer.from(value.slice(at, end), 'utf8');
    at = end;
  }
}
async function existingOutput(path, expected, context) {
  let file;
  try { file = await selectedFile(path, context); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const identity = await hashFile(file, context);
    if (identity.sha256 !== expected.sha256 || expected.bytes !== undefined && identity.bytes !== expected.bytes) {
      fail('OUTPUT_EXISTS', 'The selected output already contains a different complete publisher file');
    }
    return {path: file.path, ...identity};
  } finally { await file.handle.close(); }
}
async function removeOwned(path, identity) {
  try {
    const current = await lstat(path, {bigint: true});
    if (current.isFile() && sameNode(identity, current)) await unlink(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function requestSnapshot(record) {
  return JSON.stringify([record.status, record.phase ?? null, record.updatedAt ?? null, record.error ?? null]);
}

/**
 * The connection file is reread and /api/launch authenticated for every operation.
 * Accepted publisher requests belong to the original console, including after close().
 * JSON response number tokens remain strings through the original exact parser.
 */
export class PublisherClient {
  #file;
  #url;
  #workspaceId;
  #timeoutMs;
  #active = new Set();
  #accepted = new Map();
  #closed = false;
  #closing;

  constructor(options) {
    if (!isRecord(options)) fail('INPUT', 'Supply one saved publisher connection');
    const hasFile = options.connectionFile !== undefined;
    const hasUrl = options.consoleUrl !== undefined;
    if (hasFile === hasUrl) fail('INPUT', 'Supply connectionFile or consoleUrl, exclusively');
    this.#file = hasFile ? resolve(text(options.connectionFile, 'connectionFile')) : null;
    this.#url = hasUrl ? consoleConnection(options.consoleUrl).url : null;
    this.#timeoutMs = positive(options.timeoutMs ?? 120000, 'timeoutMs');
    if (options.expectedWorkspaceId !== undefined &&
        (typeof options.expectedWorkspaceId !== 'string' || !UUID.test(options.expectedWorkspaceId))) {
      fail('INPUT', 'expectedWorkspaceId must be the original canonical workspace UUID');
    }
    this.#workspaceId = options.expectedWorkspaceId ?? null;
  }

  get workspaceId() { return this.#workspaceId; }
  get closed() { return this.#closed; }

  async #run(operation, options, action) {
    if (this.#closed) fail('CLOSED', 'This publisher client is closed', {operation, requestId: options.requestId});
    const timeout = positive(options.timeoutMs ?? this.#timeoutMs, 'timeoutMs');
    const external = options.signal;
    if (external !== undefined && (!external || typeof external.aborted !== 'boolean' ||
        typeof external.addEventListener !== 'function' || typeof external.removeEventListener !== 'function')) {
      fail('INPUT', 'signal must be an AbortSignal');
    }
    const controller = new AbortController();
    const context = {operation, requestId: options.requestId, signal: controller.signal, controller};
    let finish;
    context.done = new Promise(resolveDone => { finish = resolveDone; });
    const abortExternal = () => controller.abort(new PublisherError(
      'PUBLISHER360_ABORTED', 'The publisher client operation was aborted',
      {cause: external?.reason instanceof Error ? external.reason : undefined}));
    const timer = setTimeout(() => controller.abort(new PublisherError(
      'PUBLISHER360_TIMEOUT', 'The publisher client operation timed out; continue its original saved request')), timeout);
    external?.addEventListener('abort', abortExternal, {once: true});
    if (external?.aborted) abortExternal();
    this.#active.add(context);
    try {
      aborted(context);
      return await action(context);
    } catch (error) {
      throw annotate(error, context);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abortExternal);
      this.#active.delete(context);
      finish();
    }
  }

  async #exchange(connection, path, context, options, consume) {
    aborted(context);
    if (!path.startsWith('/api/') || /[\r\n]/.test(path)) fail('INPUT', 'Select an original publisher API operation');
    const headers = {Host: connection.host, Authorization: 'Bearer ' + connection.token, Connection: 'close'};
    if (options.body !== undefined) {
      headers['Content-Type'] = options.media ?? 'application/json';
      headers['Content-Length'] = String(options.length);
    }
    const request = http.request({hostname: '127.0.0.1', port: connection.port, method: options.method ?? 'GET',
      path, headers, agent: false, signal: context.signal});
    const closed = new Promise(resolveClosed => request.once('close', resolveClosed));
    const responseReady = new Promise((resolveResponse, rejectResponse) => {
      request.once('response', resolveResponse);
      request.once('error', rejectResponse);
    });
    responseReady.catch(() => {});
    request.setTimeout(this.#timeoutMs, () => request.destroy(new PublisherError(
      'PUBLISHER360_TIMEOUT', 'The original publisher transport timed out')));
    const sent = (async () => {
      let ended = false, written = 0;
      if (options.body !== undefined) {
        for await (const chunk of options.body) {
          aborted(context);
          written += chunk.length;
          if (ended || written > options.length) fail('FILE_CHANGED', 'The original request body exceeds its declared size');
          // End with the final bytes: the original HTTP/1.0 server may reply and
          // close as soon as Content-Length is satisfied, before file postchecks.
          ended = written === options.length;
          await writeRequest(request, chunk, ended);
        }
        if (written !== options.length) fail('FILE_CHANGED', 'The original request body ended before its declared size');
      }
      aborted(context);
      if (!ended) await writeRequest(request, null, true);
    })();
    sent.catch(error => request.destroy(error));
    let response;
    try {
      response = await responseReady;
      if (response.statusCode !== (options.status ?? 200)) {
        let message;
        try {
          const raw = await responseBytes(response, context, 65536, headerLength(response, 65536, false));
          const value = exact(raw, 'The publisher error response');
          if (isRecord(value) && typeof value.error === 'string') message = value.error.slice(0,2000);
        } catch (_) { /* The HTTP status remains usable when its error body is incomplete. */ }
        fail('HTTP', message ? message.split(connection.token).join('[redacted]') : 'The original publisher returned HTTP ' + response.statusCode,
          {statusCode: response.statusCode});
      }
      const value = await consume(response);
      await sent;
      aborted(context);
      return value;
    } finally {
      response?.destroy();
      request.destroy();
      await Promise.allSettled([sent, responseReady, closed]);
    }
  }

  async #json(connection, path, context, body, {status = 200, maximum = MAX_JSON} = {}) {
    return this.#exchange(connection, path, context,
      {method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : [body],
        length: body?.length, status}, async response => {
        mediaType(response, 'application/json');
        const length = headerLength(response, maximum);
        return exact(await responseBytes(response, context, maximum, length), 'The complete publisher response');
      });
  }

  async #connect(context) {
    const connection = this.#file ? await readConnection(this.#file, context) :
      {...consoleConnection(this.#url), record: null};
    const launch = await this.#json(connection, '/api/launch', context);
    if (!isRecord(launch) || launch.schema !== STARTUP || launch.status !== '360GIVING_WORKSPACE_READY' ||
        typeof launch.workspaceId !== 'string' || !UUID.test(launch.workspaceId) ||
        typeof launch.workspace !== 'string' || !launch.workspace.length ||
        typeof launch.bindingSha256 !== 'string' || !SHA.test(launch.bindingSha256) ||
        consoleConnection(launch.url).url !== connection.url) {
      fail('CONNECTION_CHANGED', 'The running publisher differs from its original connection');
    }
    const saved = connection.record;
    if (saved && (saved.workspaceId !== launch.workspaceId || saved.original.workspace !== launch.workspace ||
        saved.original.bindingSha256 !== launch.bindingSha256)) {
      fail('CONNECTION_CHANGED', 'The saved application points to a different original publisher binding');
    }
    if (this.#workspaceId !== null && this.#workspaceId !== launch.workspaceId) {
      fail('WORKSPACE_CHANGED', 'The original publisher workspace changed during this client lifetime');
    }
    // Concurrent initial operations may both authenticate, but only one UUID wins.
    this.#workspaceId = launch.workspaceId;
    return connection;
  }

  [CONNECT]() {
    return this.#run('connect', {}, async context => { await this.#connect(context); });
  }

  #requestRecord(value, id, action) {
    if (!isRecord(value) || value.schema !== SCHEMA + '.request' || value.id !== id ||
        value.workspaceId !== this.#workspaceId || !ACTIONS.has(value.action) ||
        action !== undefined && value.action !== action || !STATES.has(value.status)) {
      fail('PROTOCOL', 'The publisher returned a different original saved request', {requestId: id});
    }
    return value;
  }

  state() {
    return this.#run('state', {}, async context => {
      const connection = await this.#connect(context);
      const value = await this.#json(connection, '/api/state', context);
      if (!isRecord(value) || value.schema !== SCHEMA || value.id !== this.#workspaceId) {
        fail('PROTOCOL', 'The publisher returned state for another original workspace');
      }
      return value;
    });
  }

  review({edition, decision} = {}) {
    const query = {edition: text(edition, 'edition')};
    if (decision !== undefined) query.decision = text(decision, 'decision');
    return this.#run('review', {}, async context => {
      const connection = await this.#connect(context);
      const value = await this.#json(connection, route('/api/review', query), context);
      if (!isRecord(value) || value.workspaceId !== this.#workspaceId) {
        fail('PROTOCOL', 'The publisher returned a review for another original workspace');
      }
      return value;
    });
  }

  nativeState(dataset) {
    dataset = text(dataset, 'dataset');
    return this.#run('nativeState', {}, async context => {
      const connection = await this.#connect(context);
      return this.#json(connection, route('/api/native-state', {dataset}), context);
    });
  }

  query({dataset, build, query = {}} = {}) {
    if (!isRecord(query) || Object.values(query).some(value => typeof value !== 'string')) {
      fail('INPUT', 'Original native query parameters must be scalar strings');
    }
    const body = encode({dataset: text(dataset, 'dataset'), build: text(build, 'build'), query});
    return this.#run('query', {}, async context => {
      const connection = await this.#connect(context);
      return this.#json(connection, '/api/query', context, body);
    });
  }

  changes({dataset, comparison, offset = 0, limit = 50} = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      fail('INPUT', 'Changes offset must be nonnegative and its page limit must be from 1 through 250');
    }
    const query = {dataset: text(dataset, 'dataset'), comparison: text(comparison, 'comparison'),
      offset: String(offset), limit: String(limit)};
    return this.#run('changes', {}, async context => {
      const connection = await this.#connect(context);
      return this.#json(connection, route('/api/changes', query), context);
    });
  }

  request(id) {
    id = requestId(id);
    return this.#run('request', {requestId: id}, async context => {
      const connection = await this.#connect(context);
      return this.#requestRecord(await this.#json(connection, route('/api/request', {id}), context), id);
    });
  }

  submit({id, action, input} = {}) {
    id = requestId(id);
    if (!ACTIONS.has(action) || !isRecord(input)) fail('INPUT', 'Select an original publisher action and JSON input', {requestId: id});
    const body = encode({id, action, input});
    return this.#run('submit', {requestId: id}, async context => {
      const connection = await this.#connect(context);
      const accepted = this.#requestRecord(await this.#json(connection, '/api/requests', context, body, {status: 202}), id, action);
      if (accepted.status === 'interrupted') this.#accepted.set(id, requestSnapshot(accepted));
      else this.#accepted.delete(id);
      return accepted;
    });
  }

  resume(id) {
    id = requestId(id);
    const body = encode({id});
    return this.#run('resume', {requestId: id}, async context => {
      const connection = await this.#connect(context);
      const accepted = this.#requestRecord(await this.#json(connection, '/api/resume', context, body, {status: 202}), id);
      if (accepted.status === 'interrupted') this.#accepted.set(id, requestSnapshot(accepted));
      else this.#accepted.delete(id);
      return accepted;
    });
  }

  wait(id, {signal, timeoutMs, pollMs = 500} = {}) {
    id = requestId(id);
    positive(pollMs, 'pollMs');
    return this.#run('wait', {requestId: id, signal, timeoutMs}, async context => {
      while (true) {
        const connection = await this.#connect(context);
        const value = this.#requestRecord(await this.#json(connection, route('/api/request', {id}), context), id);
        if (value.status === 'complete') {
          this.#accepted.delete(id);
          return value;
        }
        if (value.status === 'interrupted' && this.#accepted.get(id) !== requestSnapshot(value)) {
          this.#accepted.delete(id);
          fail('REQUEST_INTERRUPTED', typeof value.error?.message === 'string' ? value.error.message :
            'Resume the original interrupted publisher request', {requestId: id, record: value});
        }
        if (value.status !== 'interrupted') this.#accepted.delete(id);
        await delay(pollMs, undefined, {signal: context.signal});
      }
    });
  }

  async #upload(connection, body, expected, context) {
    let bytes = 0;
    const hash = createHash('sha256');
    async function* measured() {
      for await (const chunk of body) {
        aborted(context);
        bytes += chunk.length;
        if (bytes > expected.bytes || bytes > MAX_FILE) fail('FILE_CHANGED', 'The selected original upload grew while reading');
        hash.update(chunk);
        yield chunk;
      }
    }
    const result = await this.#exchange(connection, '/api/upload', context,
      {method: 'POST', body: measured(), length: expected.bytes, media: 'application/octet-stream', status: 201},
      async response => {
        mediaType(response, 'application/json');
        const length = headerLength(response, 65536);
        return exact(await responseBytes(response, context, 65536, length), 'The complete upload receipt');
      });
    if (!isRecord(result) || result.id !== expected.sha256 || result.sha256 !== expected.sha256 ||
        counter(result.bytes, 'Upload bytes') !== expected.bytes || bytes !== expected.bytes ||
        hash.digest('hex') !== expected.sha256) {
      fail('FILE_CHANGED', 'The complete uploaded file differs from the selected original', {objectId: expected.sha256});
    }
    return result;
  }

  upload(path, {expectedSha256, signal} = {}) {
    if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' || !SHA.test(expectedSha256))) {
      fail('INPUT', 'expectedSha256 must be an exact lowercase SHA-256');
    }
    return this.#run('upload', {signal}, async context => {
      const file = await selectedFile(path, context);
      let expected;
      try {
        expected = await hashFile(file, context);
        if (expectedSha256 !== undefined && expected.sha256 !== expectedSha256) {
          fail('FILE_CHANGED', 'The selected upload differs from its expected SHA-256');
        }
        const connection = await this.#connect(context);
        const result = await this.#upload(connection, fileChunks(file, context), expected, context);
        await unchanged(file, context);
        return result;
      } catch (error) {
        const failure = annotate(error, context);
        if (expected) failure.objectId = expected.sha256;
        throw failure;
      } finally {
        await file.handle.close();
      }
    });
  }

  uploadText(value, {signal} = {}) {
    if (typeof value !== 'string' || !value.isWellFormed()) fail('INPUT', 'uploadText requires original well-formed UTF-8 text');
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_FILE) fail('INPUT', 'The complete publisher text exceeds 1 GiB');
    return this.#run('uploadText', {signal}, async context => {
      const hash = createHash('sha256');
      for (const chunk of textChunks(value)) { aborted(context); hash.update(chunk); }
      const expected = {bytes, sha256: hash.digest('hex')};
      try {
        const connection = await this.#connect(context);
        // Raw decision JSON retains its original numeric tokens and byte spelling.
        return await this.#upload(connection, textChunks(value), expected, context);
      } catch (error) {
        const failure = annotate(error, context);
        failure.objectId = expected.sha256;
        throw failure;
      }
    });
  }

  async #download(connection, path, media, expected, output, context) {
    const destination = resolve(text(output, 'output'));
    const previous = await existingOutput(destination, expected, context);
    if (previous) return previous;
    const parent = dirname(destination);
    const directory = await lstat(parent, {bigint: true});
    if (!directory.isDirectory() || directory.isSymbolicLink()) fail('FILE', 'Select an existing real output directory');
    const temporary = join(parent, '.360giving-download-' + randomUUID() + '.tmp');
    const handle = await open(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | (FS.O_NOFOLLOW ?? 0), 0o600);
    let owned;
    let openHandle = true;
    try {
      owned = await handle.stat({bigint: true});
      const identity = await this.#exchange(connection, path, context, {}, async response => {
        mediaType(response, media);
        const length = headerLength(response, MAX_FILE);
        if (expected.bytes !== undefined && expected.bytes !== length) fail('PROTOCOL', 'The download differs from its saved byte count');
        let bytes = 0;
        const hash = createHash('sha256');
        for await (const chunk of response) {
          aborted(context);
          if (bytes + chunk.length > length || bytes + chunk.length > MAX_FILE) {
            fail('PROTOCOL', 'The complete download exceeds its saved byte count');
          }
          await writeAll(handle, chunk, bytes, context);
          hash.update(chunk); bytes += chunk.length;
        }
        const sha256 = hash.digest('hex');
        if (!response.complete || bytes !== length || sha256 !== expected.sha256) {
          fail('INTERRUPTED', 'The complete publisher download differs from its original SHA-256 or byte count');
        }
        await handle.sync();
        const completed = await handle.stat({bigint: true});
        const named = await lstat(temporary, {bigint: true});
        if (!completed.isFile() || !named.isFile() || !sameNode(owned, completed) || !sameFile(completed, named) ||
            completed.size !== BigInt(bytes)) fail('FILE_CHANGED', 'The complete temporary download changed before publication');
        return {bytes, sha256};
      });
      await handle.close();
      openHandle = false;
      aborted(context);
      const currentDirectory = await lstat(parent, {bigint: true});
      if (!currentDirectory.isDirectory() || !sameNode(directory, currentDirectory)) {
        fail('FILE_CHANGED', 'The original output directory changed during the download');
      }
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const matched = await existingOutput(destination, identity, context);
        if (!matched) throw error;
        return matched;
      }
      const parentHandle = await open(parent, FS.O_RDONLY | (FS.O_DIRECTORY ?? 0) | (FS.O_NOFOLLOW ?? 0));
      try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      // Reopen through one stable descriptor, including a create-only publication race.
      const published = await existingOutput(destination, identity, context);
      if (!published) fail('FILE_CHANGED', 'The complete published output disappeared before receiving');
      return published;
    } finally {
      try { if (openHandle) await handle.close(); }
      finally { if (owned) await removeOwned(temporary, owned); }
    }
  }

  downloadExport(id, {output, signal} = {}) {
    id = requestId(id);
    text(output, 'output');
    return this.#run('downloadExport', {requestId: id, signal}, async context => {
      const connection = await this.#connect(context);
      const saved = this.#requestRecord(await this.#json(connection, route('/api/request', {id}), context), id, 'export');
      if (saved.status !== 'complete' || !isRecord(saved.result)) {
        fail('REQUEST_INCOMPLETE', 'Wait for the original export request before downloading it', {requestId: id, record: saved});
      }
      const manifest = saved.result.manifest;
      if (!isRecord(manifest) || manifest.schema !== SCHEMA + '.handoff' ||
          manifest.workspaceId !== this.#workspaceId || manifest.request !== id || saved.result.file !== id) {
        fail('PROTOCOL', 'The complete export manifest belongs to another original request or workspace', {requestId: id});
      }
      const expected = {sha256: digest(saved.result.sha256, 'Export SHA-256'),
        bytes: counter(saved.result.bytes, 'Export bytes')};
      const received = await this.#download(connection, route('/api/download', {request: id}),
        'application/zip', expected, output, context);
      return {...received, request: saved};
    });
  }

  downloadChanges({dataset, comparison, output, signal} = {}) {
    const selected = {dataset: text(dataset, 'dataset'), comparison: text(comparison, 'comparison')};
    text(output, 'output');
    return this.#run('downloadChanges', {signal}, async context => {
      const connection = await this.#connect(context);
      const native = await this.#json(connection, route('/api/native-state', {dataset: selected.dataset}), context);
      if (!isRecord(native) || !Array.isArray(native.comparisons)) fail('PROTOCOL', 'The publisher returned no original comparison catalogue');
      const matched = native.comparisons.filter(item => isRecord(item) && item.id === selected.comparison);
      if (matched.length !== 1) fail('INPUT', 'Select one original saved comparison');
      const expected = {sha256: digest(matched[0].changesSha256, 'Comparison file SHA-256')};
      const received = await this.#download(connection, route('/api/changes-file', selected),
        'application/x-ndjson', expected, output, context);
      return {...received, comparison: matched[0]};
    });
  }

  close() {
    if (!this.#closing) {
      this.#closed = true;
      const selected = [...this.#active];
      for (const context of selected) context.controller.abort(new PublisherError(
        'PUBLISHER360_CLOSED', 'This publisher client has closed its borrowed operation'));
      this.#closing = Promise.allSettled(selected.map(context => context.done)).then(() => {
        this.#accepted.clear();
      });
    }
    return this.#closing;
  }
}

export async function connect360GivingPublisher(options) {
  const client = new PublisherClient(options);
  try {
    await client[CONNECT]();
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
