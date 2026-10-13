// MIT. Operate the original OpenSanctions console through its saved connection.
import http from 'node:http';
import { constants as FS } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const CLIENT_SCHEMA = 'stellar-forge.source-monitoring-client.v1';
export const DOMAIN_SCHEMA = 'starforge.opensanctions-workspace.v1';
export const STARTUP_SCHEMA = 'stellar-forge.opensanctions-workspace-launch.v1';
export const GET_OPERATIONS = Object.freeze([
  'state', 'contract', 'entity', 'entities', 'aliases', 'changes', 'impacts',
  'case', 'statements', 'response', 'request', 'update-plan',
  'cycles', 'cycle', 'cycle-request', 'cycle-report', 'gleif-intake',
  'review-exchanges', 'review-exchange', 'review-exchange-request', 'review-exchange-compare',
  'portfolio-cycle-reviews', 'portfolio-refreshes', 'portfolio-refresh', 'portfolio-refresh-request', 'portfolio-refresh-report',
]);
export const POST_OPERATIONS = Object.freeze([
  'published-edition', 'edition', 'portfolio', 'statement-set', 'compare', 'update',
  'review-exchange-issue', 'review-exchange-command', 'review-exchange-return-preview',
  'fetch-update', 'select-update', 'review', 'case', 'profile', 'prepare',
  'dispatch', 'receive-response', 'query', 'cycle-command', 'gleif-preview', 'gleif-receive', 'portfolio-refresh-prepare', 'portfolio-refresh-command',
]);
const SHA = /^[a-f0-9]{64}$/;
const MAX_OBJECT = 256 * 1024 * 1024;
const MAX_PACKET = 4 * MAX_OBJECT;
const MAX_JSON = 128 * 1024 * 1024;
const MAX_INPUT = 24 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid']
  .every(key => a[key] === b[key]);

export class MonitoringError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'MonitoringError';
    this.code = code;
    this.detail = detail;
  }
  toJSON() { return { error: this.code, message: this.message, ...this.detail }; }
}
function need(condition, code, message, detail) {
  if (!condition) throw new MonitoringError(code, message, detail);
}
function string(value, name, maximum = 4096) {
  need(typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value), 'MONITORING_INPUT', name + ' must be nonempty text without control characters.');
  return value;
}
function route(operation, parameters = {}) {
  need(GET_OPERATIONS.includes(operation), 'MONITORING_OPERATION', 'Choose an original monitoring read operation.');
  need(record(parameters), 'MONITORING_INPUT', 'Query parameters must be an object.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    string(key, 'Query parameter', 120);
    need(typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'number' && Number.isSafeInteger(value), 'MONITORING_INPUT',
    'Native query parameters must be strings, booleans or safe integers.');
    query.set(key, String(value));
  }
  return '/api/os/' + operation + (query.size ? '?' + query.toString() : '');
}
function jsonInput(value) {
  let bytes;
  if (typeof value === 'string' || value instanceof Uint8Array) {
    bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    try { need(record(JSON.parse(UTF8.decode(bytes))), 'MONITORING_INPUT', 'Supply one original JSON object.'); }
    catch (error) {
      if (error instanceof MonitoringError) throw error;
      throw new MonitoringError('MONITORING_INPUT', 'Supply complete UTF-8 JSON object bytes.');
    }
  } else {
    need(record(value), 'MONITORING_INPUT', 'Supply one original JSON object.');
    try {
      bytes = Buffer.from(JSON.stringify(value, (_key, item) => {
        if (typeof item === 'number') need(Number.isFinite(item) &&
          (!Number.isInteger(item) || Number.isSafeInteger(item)), 'MONITORING_INPUT',
        'Supply original JSON text for numeric values outside the safe JavaScript integer range.');
        need(!['bigint', 'function', 'symbol', 'undefined'].includes(typeof item),
          'MONITORING_INPUT', 'Inputs must contain JSON values.');
        return item;
      }), 'utf8');
    } catch (error) {
      if (error instanceof MonitoringError) throw error;
      throw new MonitoringError('MONITORING_INPUT', 'Supply an acyclic JSON object.');
    }
  }
  need(bytes.length <= MAX_INPUT, 'MONITORING_INPUT', 'The original JSON request exceeds 24 MiB.');
  return bytes;
}
async function selectedFile(filename, maximum, privateConnection = false) {
  const path = resolve(string(filename, 'File path'));
  const before = await lstat(path, { bigint: true });
  need(before.isFile() && !before.isSymbolicLink() && before.size <= BigInt(maximum),
    'MONITORING_FILE', 'Select a complete regular file within the native size limit.');
  if (privateConnection && process.platform !== 'win32') {
    need((before.mode & 0o077n) === 0n &&
      (typeof process.getuid !== 'function' || before.uid === BigInt(process.getuid())),
    'MONITORING_CONNECTION', 'The console connection file must be private and owned by the current operator.');
  }
  const handle = await open(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const actual = await handle.stat({ bigint: true });
    need(actual.isFile() && sameFile(before, actual), 'MONITORING_FILE_CHANGED',
      'The selected original file changed while opening.');
    return { path, handle, before, size: Number(before.size) };
  } catch (error) { await handle.close(); throw error; }
}
async function unchanged(file) {
  const current = await lstat(file.path, { bigint: true });
  const opened = await file.handle.stat({ bigint: true });
  need(current.isFile() && !current.isSymbolicLink() &&
    sameFile(file.before, opened) && sameFile(opened, current),
  'MONITORING_FILE_CHANGED', 'The selected original file changed while reading.');
}
async function* chunks(file) {
  let position = 0;
  while (position < file.size) {
    const data = Buffer.allocUnsafe(Math.min(CHUNK, file.size - position));
    const { bytesRead } = await file.handle.read(data, 0, data.length, position);
    need(bytesRead > 0, 'MONITORING_FILE_CHANGED', 'The original file ended before its selected byte count.');
    position += bytesRead;
    yield data.subarray(0, bytesRead);
  }
  const extra = Buffer.alloc(1);
  need((await file.handle.read(extra, 0, 1, position)).bytesRead === 0,
    'MONITORING_FILE_CHANGED', 'The original file grew during receiving.');
  await unchanged(file);
}
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of chunks(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function readJsonInput(filename) {
  const file = await selectedFile(filename, MAX_INPUT);
  try {
    const parts = [];
    for await (const chunk of chunks(file)) parts.push(chunk);
    return jsonInput(Buffer.concat(parts));
  } finally { await file.handle.close(); }
}
async function readConnection(filename) {
  const file = await selectedFile(filename, 65536, true);
  let text;
  try {
    const parts = [];
    for await (const chunk of chunks(file)) parts.push(chunk);
    text = UTF8.decode(Buffer.concat(parts)).trim();
  } finally { await file.handle.close(); }
  let saved = null;
  if (text.startsWith('{')) {
    try { saved = JSON.parse(text); }
    catch { throw new MonitoringError('MONITORING_CONNECTION', 'The saved Applications connection is not complete JSON.'); }
    need(record(saved) && saved.schema === 'stellar-forge.application-url.v1' &&
      saved.command === 'source-monitoring' && record(saved.original), 'MONITORING_CONNECTION',
    'Select the original source-monitoring Applications connection.');
    text = saved.url;
  }
  need(typeof text === 'string', 'MONITORING_CONNECTION', 'The original connection URL is missing.');
  const match = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/monitor#([A-Za-z0-9_-]{43})$/.exec(text);
  need(match, 'MONITORING_CONNECTION', 'Select the original private loopback monitoring connection.');
  const port = match[1] === undefined ? 80 : Number(match[1]);
  need(port >= 1 && port <= 65535, 'MONITORING_CONNECTION', 'The original console port is invalid.');
  return { port, host: '127.0.0.1' + (port === 80 ? '' : ':' + port), token: match[2], url: text, saved };
}
function responseLength(response, maximum) {
  const value = response.headers['content-length'];
  need(typeof value === 'string' && /^[0-9]+$/.test(value) && BigInt(value) <= BigInt(maximum),
    'MONITORING_RESPONSE', 'The original response has an invalid complete byte count.');
  need(response.headers['content-encoding'] === undefined || response.headers['content-encoding'] === 'identity',
    'MONITORING_RESPONSE', 'Receive the original unencoded response bytes.');
  return Number(value);
}
async function readResponse(response, maximum, expectedMedia) {
  const length = responseLength(response, maximum);
  if (expectedMedia) need(String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() === expectedMedia,
    'MONITORING_RESPONSE', 'The original response has a different media type.');
  let bytes = 0;
  const parts = [];
  for await (const part of response) {
    bytes += part.length;
    need(bytes <= length, 'MONITORING_RESPONSE', 'The response exceeded its declared byte count.');
    parts.push(part);
  }
  need(response.complete && bytes === length, 'MONITORING_INTERRUPTED', 'The original response was interrupted.');
  return Buffer.concat(parts, bytes);
}
function nativeReply(response, raw) {
  let value;
  try { value = JSON.parse(UTF8.decode(raw)); }
  catch { throw new MonitoringError('MONITORING_RESPONSE', 'The native console returned incomplete or invalid JSON.'); }
  return { json: value, raw, status: response.statusCode, headers: { ...response.headers }, sha256: digest(raw) };
}
function nativeError(response, raw, method, path) {
  let value;
  try { value = JSON.parse(UTF8.decode(raw)); } catch {}
  return new MonitoringError('MONITORING_NATIVE_HTTP', record(value) && typeof value.error === 'string' ?
    value.error : 'The original console returned HTTP ' + response.statusCode + '.',
  { status: response.statusCode, method, path, uncertain: method === 'POST', responseComplete: true,
    responseHeaders: { ...response.headers }, native: value ?? null,
    responseBase64: raw.toString('base64'), responseSha256: digest(raw) });
}
function writeRequest(request, bytes, end, { method, path }) {
  return new Promise((accept, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      request.off('error', failed); request.off('close', closed);
      if (error) reject(error); else accept();
    };
    const interrupted = () => new MonitoringError('MONITORING_INTERRUPTED',
      'The original request closed before its selected bytes were sent.',
      { method, path, uncertain: method === 'POST' });
    const failed = error => finish(error);
    const closed = () => finish(end && request.writableFinished ? undefined : interrupted());
    request.once('error', failed); request.once('close', closed);
    if (request.destroyed || request.writableEnded) return finish(interrupted());
    try {
      if (end) request.end(bytes, error => finish(error));
      else request.write(bytes, error => finish(error));
    } catch (error) { finish(error); }
  });
}
function requestFailure(error, method, path) {
  if (error instanceof MonitoringError) {
    return new MonitoringError(error.code, error.message,
      { method, path, uncertain: method === 'POST', ...error.detail });
  }
  return new MonitoringError('MONITORING_TRANSPORT',
    'The original console response could not complete; inspect its retained operation before continuing.',
    { method, path, uncertain: method === 'POST', transportCode: error.code ?? error.name ?? null });
}
function finishOwnedCleanup(primary, cleanup, message) {
 if(primary){if(cleanup.length)primary.cleanupErrors=[...(Array.isArray(primary.cleanupErrors)?primary.cleanupErrors:[]),...cleanup];throw primary;}
 if(cleanup.length===1)throw cleanup[0];
 if(cleanup.length>1)throw new AggregateError(cleanup,message);
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');let primary;
  try { await handle.sync(); }catch(error){primary=error;throw error;}
  finally { const cleanup=[];try{await handle.close();}catch(error){cleanup.push(error);}
    finishOwnedCleanup(primary,cleanup,'Original directory sync cleanup remains unresolved.'); }
}
async function publishFile(temporary, destination, identity) {
  try { await link(temporary, destination); await syncDirectory(dirname(destination)); return { ...identity, path: destination, reused: false }; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await selectedFile(destination, MAX_PACKET);
    try {
      need(existing.size === identity.bytes && await fileHash(existing) === identity.sha256,
        'MONITORING_OUTPUT_EXISTS', 'The selected output already contains a different complete file.');
      return { ...identity, path: destination, reused: true };
    } finally { await existing.handle.close(); }
  }
}
export async function writeReply(filename, reply) {
  need(reply?.raw instanceof Uint8Array, 'MONITORING_INPUT', 'Supply the complete original response bytes.');
  const destination = resolve(string(filename, 'Output path'));
  const temporary = join(dirname(destination), '.monitoring-response-' + randomUUID());
  let out, created = false, primary;
  try {
    out = await open(temporary, 'wx', 0o600); created = true;
    await out.writeFile(reply.raw); await out.sync();
    await out.close(); out = undefined;
    return await publishFile(temporary, destination, { bytes: reply.raw.length, sha256: digest(reply.raw) });
  } catch (error) { primary = error; throw error; }
  finally {
    const cleanup=[];
    if(out)try{await out.close();}catch(error){cleanup.push(error);}
    if(created)try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')cleanup.push(error);}
    finishOwnedCleanup(primary,cleanup,'Original response publication cleanup remains unresolved.');
  }
}

/** Each operation authenticates the current native launch. The server owns all writes. */
export class MonitoringClient {
  #file; #timeout; #expectedWorkspace; #expectedBinding; #identity = null;
  #closed = false; #requests = new Set(); #operations = new Set();
  constructor({ connectionFile, timeoutMs = 120000, expectedWorkspace, expectedBindingSha256 } = {}) {
    this.#file = resolve(string(connectionFile, 'Connection file'));
    need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 2147483647,
      'MONITORING_INPUT', 'timeoutMs must be a positive integer.');
    this.#timeout = timeoutMs;
    this.#expectedWorkspace = expectedWorkspace === undefined ? null : string(expectedWorkspace, 'Expected workspace');
    need(expectedBindingSha256 === undefined || SHA.test(expectedBindingSha256),
      'MONITORING_INPUT', 'Select the original expected binding SHA-256.');
    this.#expectedBinding = expectedBindingSha256 ?? null;
  }
  get identity() { return this.#identity === null ? null : { ...this.#identity }; }
  get closed() { return this.#closed; }
  #run(action) {
    need(!this.#closed, 'MONITORING_CLOSED', 'This monitoring client is closed.');
    const promise = Promise.resolve().then(action);
    this.#operations.add(promise);
    promise.then(() => this.#operations.delete(promise), () => this.#operations.delete(promise));
    return promise;
  }
  async #exchange(connection, path, { method = 'GET', body, file, headers = {} } = {}) {
    need(!this.#closed, 'MONITORING_CLOSED', 'This monitoring client is closed.');
    let request, gotResponse = false, writing, timer;
    const result = new Promise((yes, no) => {
      request = http.request({
        hostname: '127.0.0.1', port: connection.port, path, method, agent: false,
        headers: { Host: connection.host, Authorization: 'Bearer ' + connection.token,
          Connection: 'close', 'Accept-Encoding': 'identity', ...headers,
          ...(method === 'POST' ? { 'Content-Length': String(file ? file.size : body?.length ?? 0) } : {}) },
      });
      this.#requests.add(request);
      request.once('response', response => { gotResponse = true; yes(response); });
      request.once('error', error => no(error instanceof MonitoringError ? error :
        new MonitoringError('MONITORING_TRANSPORT',
          'The original console request could not complete; inspect its current native operation before continuing.',
          { method, path, uncertain: method === 'POST' && error.code !== 'ECONNREFUSED',
            transportCode: error.code ?? null })));
      timer = setTimeout(() => request.destroy(new MonitoringError('MONITORING_TIMEOUT',
        'The original console request timed out; inspect its saved operation before continuing.',
        { method, path, uncertain: method === 'POST' })), this.#timeout);
    });
    if (!request) return await result;
    writing = (async () => {
      const hash = createHash('sha256');
      let bytes = 0, ended = false;
      if (file) {
        for await (const chunk of chunks(file)) {
          need(!this.#closed && !request.destroyed, 'MONITORING_INTERRUPTED',
            'The selected file request was interrupted.', { method, path, uncertain: true });
          hash.update(chunk); bytes += chunk.length;
          // A Content-Length receiver can respond as soon as the last byte arrives.
          // End with that last chunk so its normal close cannot precede our end().
          const last = bytes === file.size;
          await writeRequest(request, chunk, last, { method, path });
          if (last) ended = true;
        }
      }
      if (!ended) await writeRequest(request, file ? undefined : body, true, { method, path });
      return file ? { bytes, sha256: hash.digest('hex') } : null;
    })();
    writing.catch(error => { if (!gotResponse) request.destroy(error); });
    try {
      const response = await result;
      return { response, writing, finish: async () => {
        clearTimeout(timer); request.destroy(); this.#requests.delete(request);
        await writing.catch(() => {});
      } };
    } catch (error) {
      clearTimeout(timer); request.destroy(); this.#requests.delete(request);
      await writing.catch(() => {});
      throw error;
    }
  }
  async #json(connection, path, options = {}) {
    const method = options.method ?? 'GET';
    let exchange;
    try {
      exchange = await this.#exchange(connection, path, options);
      const ok = exchange.response.statusCode >= 200 && exchange.response.statusCode < 300;
      const raw = await readResponse(exchange.response, ok ? MAX_JSON : 1024 * 1024, ok ? 'application/json' : undefined);
      if (!ok) throw nativeError(exchange.response, raw, method, path);
      const sent = await exchange.writing;
      return { reply: nativeReply(exchange.response, raw), sent };
    } catch (error) {
      throw requestFailure(error, method, path);
    } finally { if (exchange) await exchange.finish(); }
  }
  async #connect() {
    need(!this.#closed, 'MONITORING_CLOSED', 'This monitoring client is closed.');
    const connection = await readConnection(this.#file);
    const { reply } = await this.#json(connection, '/api/launch');
    const launch = reply.json;
    need(record(launch) && launch.schema === STARTUP_SCHEMA &&
      launch.status === 'OPENSANCTIONS_WORKSPACE_READY' && launch.domainSchema === DOMAIN_SCHEMA &&
      launch.console === connection.url && typeof launch.workspace === 'string' &&
      SHA.test(launch.bindingSha256 ?? '') && SHA.test(launch.nativeBindingSha256 ?? '') &&
      typeof launch.sourceRoot === 'string' && Number.isSafeInteger(launch.pid) && launch.pid > 0,
    'MONITORING_LAUNCH_CHANGED',
    'Open the original Applications console, or start the source-monitoring command with --startup-format json.');
    const original = connection.saved?.original;
    if (original) {
      for (const key of ['workspace', 'bindingSha256', 'nativeBindingSha256', 'sourceRoot']) {
        if (original[key] !== undefined) need(original[key] === launch[key],
          'MONITORING_LAUNCH_CHANGED', 'The saved application differs from its current native launch.');
      }
    }
    need((this.#expectedWorkspace === null || launch.workspace === this.#expectedWorkspace) &&
      (this.#expectedBinding === null || launch.bindingSha256 === this.#expectedBinding),
    'MONITORING_LAUNCH_CHANGED', 'The selected original workspace or reviewed source binding changed.');
    if (this.#identity !== null) need(this.#identity.workspace === launch.workspace &&
      this.#identity.bindingSha256 === launch.bindingSha256, 'MONITORING_LAUNCH_CHANGED',
    'Review the changed source/workspace and create a client for that explicit selection.');
    this.#identity = {
      schema: STARTUP_SCHEMA, domainSchema: DOMAIN_SCHEMA, workspace: launch.workspace,
      bindingSha256: launch.bindingSha256, nativeBindingSha256: launch.nativeBindingSha256,
      sourceRoot: launch.sourceRoot, python: launch.python, pid: launch.pid,
    };
    return connection;
  }
  inspect() { return this.#run(async () => { await this.#connect(); return this.identity; }); }
  get(operation, parameters = {}) {
    const path = route(operation, parameters);
    return this.#run(async () => {
      const connection = await this.#connect();
      return (await this.#json(connection, path,
        { headers: { 'X-Review-Workspace': encodeURIComponent(this.#identity.workspace) } })).reply;
    });
  }
  post(operation, input) {
    need(POST_OPERATIONS.includes(operation), 'MONITORING_OPERATION', 'Choose an original monitoring write operation.');
    const body = jsonInput(input), path = operation === 'query' ? '/api/query' : '/api/os/' + operation;
    return this.#run(async () => {
      const connection = await this.#connect();
      return (await this.#json(connection, path, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json', 'X-Review-Workspace': encodeURIComponent(this.#identity.workspace) } })).reply;
    });
  }
  upload(filename, { name, media = 'application/octet-stream', sourceUrl = '' } = {}) {
    string(media, 'Media type', 240);
    need(typeof sourceUrl === 'string' && sourceUrl.length <= 4096 &&
      !/[\u0000-\u001f\u007f]/.test(sourceUrl), 'MONITORING_INPUT', 'Source URL must be original text without control characters.');
    return this.#run(async () => {
      const file = await selectedFile(filename, MAX_OBJECT);
      try {
        const label = name ?? basename(file.path);
        string(label, 'Original name', 240);
        const { reply, sent } = await this.#json(await this.#connect(), '/api/os/object', {
          method: 'POST', file,
          headers: { 'Content-Type': media, 'X-Original-Name': encodeURIComponent(label),
            'X-Original-URL': encodeURIComponent(sourceUrl) },
        });
        need(record(reply.json) && reply.json.id === sent.sha256 && reply.json.bytes === sent.bytes,
          'MONITORING_UPLOAD_CHANGED', 'The native retained object differs from the complete selected file.');
        return reply;
      } finally { await file.handle.close(); }
    });
  }
  receiveArchive(filename) {
    return this.#run(async () => {
      const file = await selectedFile(filename, MAX_PACKET);
      try {
        const { reply } = await this.#json(await this.#connect(), '/api/os/import',
          { method: 'POST', file, headers: { 'Content-Type': 'application/zip' } });
        return reply;
      } finally { await file.handle.close(); }
    });
  }
  async receiveEdition({ metadataFile, entitiesFile, metadataUrl, label, entitlement }) {
    const metadata = await this.upload(metadataFile, { media: 'application/json', sourceUrl: metadataUrl });
    const entities = await this.upload(entitiesFile, { media: 'application/x-ndjson' });
    return this.post('edition', { metadata: metadata.json.id, entities: entities.json.id, metadataUrl,
      ...(label === undefined ? {} : { label }), ...(entitlement === undefined ? {} : { entitlement }) });
  }
  async receivePortfolio({ file, key, label }) {
    const original = await this.upload(file, { media: 'application/x-ndjson' });
    return this.post('portfolio', { original: original.json.id, key, label });
  }
  async receiveStatements({ file, edition, sourceUrl, name, complete = false, scope }) {
    const original = await this.upload(file, { media: 'text/csv', sourceUrl });
    return this.post('statement-set', { original: original.json.id, edition, sourceUrl, complete,
      ...(name === undefined ? {} : { name }), ...(scope === undefined ? {} : { scope }) });
  }
  async receiveUpdate({ before, after, indexFile, indexUrl = '', deltas }) {
    need(Array.isArray(deltas), 'MONITORING_INPUT', 'Select every original required delta file with its version.');
    const index = await this.upload(indexFile, { media: 'application/json', sourceUrl: indexUrl });
    const objects = [], versions = new Set();
    for (const entry of deltas) {
      need(record(entry) && typeof entry.version === 'string' && !versions.has(entry.version),
        'MONITORING_INPUT', 'Delta versions must be explicitly selected and unique.');
      versions.add(entry.version);
      const original = await this.upload(entry.file, { media: 'application/x-ndjson', sourceUrl: entry.sourceUrl ?? '' });
      objects.push({ version: entry.version, object: original.json.id });
    }
    return this.post('update', { before, after, index: index.json.id, deltas: objects });
  }
  async receiveResponse({ id, file, status, sourceNote, expected, headers }) {
    const original = await this.upload(file, { media: 'application/json' });
    return this.post('receive-response', { id, original: original.json.id, status, sourceNote, expected,
      ...(headers === undefined ? {} : { headers }) });
  }
  download(kind, { id, role, output, expectedSha256 } = {}) {
    need(['workspace', 'object', 'source', 'review-exchange'].includes(kind), 'MONITORING_OPERATION',
      'Choose the complete workspace, retained object, original source or reviewer file.');
    if (kind !== 'workspace') need(SHA.test(id ?? ''), 'MONITORING_INPUT', 'Select the original object/source SHA-256.');
    if (kind === 'review-exchange') need(['issued_json', 'issued_html', 'returned_file'].includes(role),
      'MONITORING_INPUT', 'Select the exact original issued JSON, issued HTML or returned file role.');
    need(expectedSha256 === undefined || SHA.test(expectedSha256), 'MONITORING_INPUT',
      'Use the complete expected original file SHA-256.');
    const path = kind === 'workspace' ? '/api/os/export' : kind === 'review-exchange' ?
      '/api/os/review-exchange-file?' + new URLSearchParams({ id, role }) :
      '/api/os/' + kind + '?id=' + encodeURIComponent(id);
    const destination = resolve(string(output, 'Output path'));
    return this.#run(async () => {
      const connection = await this.#connect();
      const temporary = join(dirname(destination), '.monitoring-download-' + randomUUID());
      const exchange = await this.#exchange(connection, path,
        { headers: { 'X-Review-Workspace': encodeURIComponent(this.#identity.workspace) } });
      let out, created = false, primary;
      try {
        const response = exchange.response;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const raw = await readResponse(response, 1024 * 1024);
          throw nativeError(response, raw, 'GET', path);
        }
        const expected = responseLength(response, MAX_PACKET);
        if (kind === 'workspace') need(String(response.headers['content-type'] ?? '').split(';', 1)[0] === 'application/zip',
          'MONITORING_RESPONSE', 'The original workspace export must be its complete ZIP.');
        out = await open(temporary, 'wx', 0o600); created = true;
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const part of response) {
          bytes += part.length;
          need(bytes <= expected, 'MONITORING_RESPONSE', 'The native download exceeded its original byte count.');
          hash.update(part);
          let offset = 0;
          while (offset < part.length) {
            const written = await out.write(part, offset, part.length - offset, bytes - part.length + offset);
            need(written.bytesWritten > 0, 'MONITORING_FILE', 'The complete native download could not be written.');
            offset += written.bytesWritten;
          }
        }
        need(response.complete && bytes === expected, 'MONITORING_INTERRUPTED', 'The complete native download was interrupted.');
        const sha256 = hash.digest('hex');
        if (kind === 'object' || kind === 'source') need(sha256 === id, 'MONITORING_DOWNLOAD_CHANGED',
          'The downloaded original differs from its selected content identity.');
        if (expectedSha256 !== undefined) need(sha256 === expectedSha256, 'MONITORING_DOWNLOAD_CHANGED',
          'The complete downloaded reviewer file differs from its selected original descriptor.');
        await exchange.writing;
        await out.sync(); await out.close(); out = undefined;
        return await publishFile(temporary, destination, { bytes, sha256, kind, ...(id ? { id } : {}), ...(role ? { role } : {}) });
      } catch (error) { primary = error; throw error; }
      finally {
        const cleanup=[];
        if(out)try{await out.close();}catch(error){cleanup.push(error);}
        try{await exchange.finish();}catch(error){cleanup.push(error);}
        if(created)try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')cleanup.push(error);}
        finishOwnedCleanup(primary,cleanup,'Original download cleanup remains unresolved.');
      }
    });
  }
  async close() {
    this.#closed = true;
    for (const request of this.#requests) request.destroy(new MonitoringError('MONITORING_CLOSED',
      'The monitoring client closed; retain any original in-flight native operation.'));
    await Promise.allSettled([...this.#operations]);
  }
}
