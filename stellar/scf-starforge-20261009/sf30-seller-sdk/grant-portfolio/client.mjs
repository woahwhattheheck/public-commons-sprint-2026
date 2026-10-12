// MIT. Typed access to the original saved grant-portfolio console.
import { open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const GRANT_PORTFOLIO_SCHEMA = 'stellar-forge.grant-portfolio.v1';
export const GRANT_PORTFOLIO_MAX_PACKET_BYTES = 4 * 1024 * 1024 * 1024;
export const GRANT_PORTFOLIO_MAX_ACTION_BYTES = 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TABLES = new Set(['entities','financial','links','decisions','candidates','changes','sources']);
const ACTIONS = new Set(['source.receive','portfolio.save','review.save','portfolio.export','portfolio.receive']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code, message, details = {}) => Object.assign(new Error(message), { code: 'GRANT_PORTFOLIO_' + code, ...details });
const need = (condition, code, message) => { if (!condition) throw issue(code, message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const checked = (value, pattern, label) => {
  need(typeof value === 'string' && pattern.test(value), 'SELECTION', 'Use the original ' + label + '.'); return value;
};
const revision = (value, minimum = 1) => {
  need(Number.isSafeInteger(value) && value >= minimum, 'REVISION', 'Use the inspected original revision.'); return value;
};
const query = values => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
};
function optionsSignal(signal) {
  need(signal === undefined || signal instanceof AbortSignal, 'SIGNAL', 'Use an AbortSignal for this caller.'); return signal;
}
function exact(value, allowed, required = []) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'INPUT', 'Use the declared fields and original complete payload.');
}
function selection(input) {
  exact(input, ['portfolioId','revision'], ['portfolioId','revision']);
  return {portfolioId:checked(input.portfolioId, UUID, 'portfolio ID'), revision:revision(input.revision)};
}
function retainedRequest(value, id) {
  need(plain(value) && value.id === id && ['RUNNING','COMPLETED','FAILED'].includes(value.state) &&
    HASH.test(value.inputSha256 ?? ''), 'RESPONSE', 'The console returned a different retained request.');
  return value;
}
function descriptor(response, expected = {}) {
  const count = response.headers.get('content-length'), sha256 = response.headers.get('x-content-sha256');
  need(/^(0|[1-9]\d*)$/.test(count ?? '') && Number.isSafeInteger(Number(count)) &&
    Number(count) <= GRANT_PORTFOLIO_MAX_PACKET_BYTES && HASH.test(sha256 ?? '') &&
    response.headers.get('etag') === '"' + sha256 + '"' &&
    /^application\/zip(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
  'FILE_RESPONSE', 'The original complete file descriptor is missing or changed.');
  need(expected.sha256 === undefined || expected.sha256 === sha256, 'FILE_CHANGED', 'The received file is a different original object.');
  need(expected.bytes === undefined || expected.bytes === Number(count), 'FILE_CHANGED', 'The original file length changed.');
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /^attachment;\s*filename="([A-Za-z0-9][A-Za-z0-9._-]{0,199})"$/.exec(disposition)?.[1] ??
    'grant-portfolio-' + sha256 + '.zip';
  return {sha256, bytes:Number(count), filename};
}
async function boundedJson(response, maximum) {
  const length = response.headers.get('content-length');
  if (length !== null) need(/^\d+$/.test(length) && Number(length) <= maximum,
    'RESPONSE_LIMIT', 'Use a pinned page or the complete original file export.');
  let size = 0; const chunks = [];
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength; need(size <= maximum, 'RESPONSE_LIMIT', 'Use a pinned page or the complete original file export.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, size)));
  } catch (error) {
    if (error.code?.startsWith('GRANT_PORTFOLIO_')) throw error;
    throw issue('RESPONSE', 'The original console did not return complete JSON.');
  }
}

/** Borrow the original running console. Closing this client never stops its owner. */
export class GrantPortfolioClient {
  #origin; #token; #timeout; #controller = new AbortController(); #pending = new Set(); #closed = false;
  constructor(consoleUrl, {timeoutMs = 240000} = {}) {
    let url; try { url = new URL(consoleUrl); } catch {}
    need(url && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
      !url.username && !url.password && !url.search && url.pathname === '/' &&
      /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),
    'CONNECTION', 'Use the complete private loopback URL printed by the original portfolio console.');
    need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 900000,
      'TIMEOUT', 'Choose a caller timeout from 1 to 900000 milliseconds.');
    this.#origin = url.origin; this.#token = url.hash.slice(1); this.#timeout = timeoutMs;
  }
  get origin() { return this.#origin; }
  get closed() { return this.#closed; }
  async #track(run) {
    if (this.#closed) throw issue('CLOSED', 'This borrowed portfolio client is closed.');
    const task = Promise.resolve().then(run); this.#pending.add(task);
    try { return await task; } finally { this.#pending.delete(task); }
  }
  async #http(path, {body, headers = {}, signal} = {}) {
    if (this.#closed) throw issue('CLOSED', 'This borrowed portfolio client is closed.');
    optionsSignal(signal);
    return fetch(this.#origin + path, {
      method:body === undefined ? 'GET' : 'POST', redirect:'error',
      signal:AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.#timeout), ...(signal ? [signal] : [])]),
      headers:{...headers, authorization:'Bearer ' + this.#token, origin:this.#origin},
      ...(body === undefined ? {} : {body, ...(typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Blob ? {} : {duplex:'half'})}),
    });
  }
  async #response(response) {
    const value = await boundedJson(response, response.ok ? 16 * 1024 * 1024 : 65536);
    need(plain(value), 'RESPONSE', 'The original console returned an incomplete object response.');
    if (!response.ok) {
      const native = plain(value.error) ? value.error : value;
      throw issue('HTTP_' + response.status,
        typeof native.message === 'string' ? native.message.slice(0, 2000) :
        typeof value.error === 'string' ? value.error.slice(0, 2000) : 'The original portfolio operation was rejected.',
        {status:response.status, details:value, ...(typeof native.code === 'string' ? {nativeCode:native.code} : {})});
    }
    return value;
  }
  #json(path, input, options = {}) {
    let body;
    if (input !== undefined) {
      need(plain(input), 'INPUT', 'Use the original object payload.');
      body = JSON.stringify(input);
      need(Buffer.byteLength(body) <= GRANT_PORTFOLIO_MAX_ACTION_BYTES, 'INPUT_LIMIT', 'The native action exceeds its 1 MiB JSON limit.');
    }
    return this.#track(async () => this.#response(await this.#http(path, {...options, body,
      headers:body === undefined ? {} : {'content-type':'application/json', 'content-length':String(Buffer.byteLength(body))}})));
  }
  schema(options) { return this.#json('/api/schema', undefined, options); }
  async state(options) {
    const state = await this.#json('/api/state', undefined, options);
    need(state.schema === GRANT_PORTFOLIO_SCHEMA && UUID.test(state.workspaceId ?? '') &&
      Number.isSafeInteger(state.revision) && state.revision >= 0, 'WORKSPACE', 'This console returned another workspace format.');
    return state;
  }
  launch(options) { return this.#json('/api/launch', undefined, options); }
  source(id, options) { return this.#json('/api/source?' + query({id:checked(id, HASH, 'source SHA-256')}), undefined, options); }
  portfolio(id, {revision:selected, ...options} = {}) {
    return this.#json('/api/portfolio?' + query({id:checked(id, UUID, 'portfolio ID'), revision:revision(selected)}), undefined, options);
  }
  async rows(input, options) {
    exact(input, ['portfolioId','revision','table','offset','limit','search','status','standard','entityKey'],
      ['portfolioId','revision','table']);
    const selected = selection({portfolioId:input.portfolioId, revision:input.revision});
    need(TABLES.has(input.table), 'TABLE', 'Select a complete original portfolio table.');
    const offset = input.offset ?? 0, limit = input.limit ?? 50;
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 250,
      'PAGE', 'Select a nonnegative offset and 1 to 250 original rows.');
    for (const key of ['search','status','standard'])
      if (input[key] !== undefined) need(typeof input[key] === 'string' && input[key].length <= 2000,
        'FILTER', 'Pass the original text filter.');
    if (input.entityKey !== undefined && input.entityKey !== '') checked(input.entityKey, HASH, 'entity key');
    const page = await this.#json('/api/rows?' + query({...input, ...selected, offset, limit}), undefined, options);
    need(plain(page) && Array.isArray(page.rows) && page.rows.length <= limit &&
      page.revision === selected.revision && HASH.test(page.snapshot ?? '') && page.offset === offset &&
      Number.isSafeInteger(page.total) && page.total >= 0 &&
      (page.nextOffset === null || Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset),
    'PAGE_CHANGED', 'The original revision page is incomplete or changed.');
    return page;
  }
  async *pages(input, {signal, onPage} = {}) {
    let offset = input.offset ?? 0, snapshot, total;
    for (;;) {
      const page = await this.rows({...input, offset}, {signal});
      if (snapshot === undefined) { snapshot = page.snapshot; total = page.total; }
      need(page.snapshot === snapshot && page.total === total, 'PAGE_CHANGED', 'The original revision snapshot changed between pages.');
      if (onPage) await onPage(page);
      yield page;
      if (page.nextOffset === null) break;
      need(page.rows.length > 0 && page.nextOffset === offset + page.rows.length,
        'PAGE_CHANGED', 'The original page cursor would skip or repeat rows.');
      offset = page.nextOffset;
    }
  }
  detail(input, options) {
    exact(input, ['portfolioId','revision','sourceId','entityKey'], ['portfolioId','revision','sourceId','entityKey']);
    return this.#json('/api/detail?' + query({...selection({portfolioId:input.portfolioId, revision:input.revision}),
      sourceId:checked(input.sourceId, HASH, 'source SHA-256'), entityKey:checked(input.entityKey, HASH, 'entity key')}), undefined, options);
  }
  async action(input, options) {
    exact(input, ['operationId','action','payload','expectedRevision'], ['operationId','action','payload']);
    checked(input.operationId, OPERATION, 'operation ID'); need(ACTIONS.has(input.action), 'ACTION', 'Select an original portfolio action.');
    need(plain(input.payload), 'INPUT', 'Preserve the complete original action payload.');
    if (input.expectedRevision !== undefined) revision(input.expectedRevision, 0);
    try { return retainedRequest(await this.#json('/api/action', input, options), input.operationId); }
    catch (error) {
      error.operationId = input.operationId;
      error.recovery = 'Read this original request ID before repeating or resuming the action.';
      throw error;
    }
  }
  async request(operationId, options) {
    return retainedRequest(await this.#json('/api/request?' + query({id:checked(operationId, OPERATION, 'operation ID')}), undefined, options), operationId);
  }
  async resume(operationId, options) {
    checked(operationId, OPERATION, 'operation ID');
    return retainedRequest(await this.#json('/api/resume', {operationId}, options), operationId);
  }
  async wait(operationId, {pollMs = 500, timeoutMs = 240000, signal, onUpdate} = {}) {
    checked(operationId, OPERATION, 'operation ID');
    need(Number.isSafeInteger(pollMs) && pollMs >= 50 && pollMs <= 30000 &&
      Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 3600000,
    'TIMEOUT', 'Choose an explicit polling interval and original request wait lifetime.');
    const selected = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [optionsSignal(signal)] : [])]);
    for (;;) {
      const request = await this.request(operationId, {signal:selected});
      if (onUpdate) await onUpdate(request);
      if (request.state !== 'RUNNING') return request;
      await new Promise((resolveWait, reject) => {
        const abort = () => { clearTimeout(timer); reject(selected.reason); };
        const timer = setTimeout(() => { selected.removeEventListener('abort', abort); resolveWait(); }, pollMs);
        if (selected.aborted) abort(); else selected.addEventListener('abort', abort, {once:true});
      });
    }
  }
  receiveSource(operationId, payload, options = {}) {
    const {expectedRevision, ...requestOptions} = options;
    return this.action({operationId, action:'source.receive', payload, ...(expectedRevision === undefined ? {} : {expectedRevision})}, requestOptions);
  }
  savePortfolio(operationId, payload, options = {}) {
    const {expectedRevision, ...requestOptions} = options;
    return this.action({operationId, action:'portfolio.save', payload, ...(expectedRevision === undefined ? {} : {expectedRevision})}, requestOptions);
  }
  saveReview(operationId, payload, options = {}) {
    const {expectedRevision, ...requestOptions} = options;
    return this.action({operationId, action:'review.save', payload, ...(expectedRevision === undefined ? {} : {expectedRevision})}, requestOptions);
  }
  createExport(operationId, payload, options = {}) {
    const {expectedRevision, ...requestOptions} = options;
    return this.action({operationId, action:'portfolio.export', payload, ...(expectedRevision === undefined ? {} : {expectedRevision})}, requestOptions);
  }
  receivePortfolio(operationId, payload, options = {}) {
    const {expectedRevision, ...requestOptions} = options;
    return this.action({operationId, action:'portfolio.receive', payload, ...(expectedRevision === undefined ? {} : {expectedRevision})}, requestOptions);
  }
  upload({body, bytes, sha256}, options = {}) {
    need(Number.isSafeInteger(bytes) && bytes >= 1 && bytes <= GRANT_PORTFOLIO_MAX_PACKET_BYTES,
      'PACKET_SIZE', 'Select a complete original ZIP of 1 byte to 4 GiB.');
    if (sha256 !== undefined) checked(sha256, HASH, 'packet SHA-256');
    return this.#track(async () => {
      const uploaded = await this.#response(await this.#http('/api/upload', {...options, body,
        headers:{'content-type':'application/zip', 'content-length':String(bytes)}}));
      need(plain(uploaded) && HASH.test(uploaded.sha256 ?? '') && uploaded.bytes === bytes &&
        (sha256 === undefined || uploaded.sha256 === sha256), 'PACKET_CHANGED', 'The uploaded original packet differs from its selected bytes.');
      return uploaded;
    });
  }
  /** Streams a trusted local file from its original open inode. MCP callers use configured handles. */
  async uploadFile(filename, {sha256, ...options} = {}) {
    const {handle, info} = await regularFile(filename, GRANT_PORTFOLIO_MAX_PACKET_BYTES);
    let stream;
    try {
      const expected = sha256 ?? await hashHandle(handle);
      checked(expected, HASH, 'packet SHA-256');
      stream = handle.createReadStream({autoClose:false, start:0});
      const result = await this.upload({body:stream, bytes:info.size, sha256:expected}, options);
      const after = await handle.stat(), current = await lstat(resolve(filename));
      need(after.dev === info.dev && after.ino === info.ino && after.size === info.size &&
        after.mtimeMs === info.mtimeMs && after.ctimeMs === info.ctimeMs &&
        current.dev === info.dev && current.ino === info.ino, 'PACKET_CHANGED', 'The selected packet changed during upload.');
      return result;
    } finally { stream?.destroy(); await handle.close(); }
  }
  /** Consume or cancel the returned complete original stream; dispose aborts borrowed HTTP work. */
  openObject(sha256, options = {}) { return this.#openFile('/api/object?' + query({sha256:checked(sha256, HASH, 'object SHA-256')}), {...options, sha256}); }
  openExport(id, options = {}) { return this.#openFile('/api/export?' + query({id:checked(id, HASH, 'export SHA-256')}), {...options, sha256:id}); }
  #openFile(path, {sha256, bytes, ...options}) {
    return this.#track(async () => {
      const response = await this.#http(path, options);
      if (!response.ok) await this.#response(response);
      try { return {descriptor:descriptor(response, {sha256, bytes}), response}; }
      catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    });
  }
  async downloadObject(sha256, filename, options = {}) {
    return this.#track(async () => saveGrantPortfolioFile(await this.openObject(sha256, options), filename));
  }
  async downloadExport(id, filename, options = {}) {
    return this.#track(async () => saveGrantPortfolioFile(await this.openExport(id, options), filename));
  }
  async dispose() {
    if (!this.#closed) { this.#closed = true; this.#controller.abort(issue('CLOSED', 'The borrowed portfolio client is closing.')); }
    await Promise.allSettled([...this.#pending]);
  }
}

async function regularFile(filename, maximum, privateFile = false) {
  need(typeof filename === 'string' && isAbsolute(filename) && !filename.includes('\0'), 'FILE', 'Select one absolute original file.');
  const handle = await open(resolve(filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size > 0 && info.size <= maximum, 'FILE', 'Use a complete regular file within the original byte limit.');
    if (privateFile && process.platform !== 'win32') need((info.mode & 0o077) === 0 && info.uid === process.getuid(),
      'FILE_PRIVACY', 'The original connection file must be private and operator-owned.');
    return {handle, info};
  } catch (error) { await handle.close(); throw error; }
}
async function hashHandle(handle) {
  const hasher = createHash('sha256');
  for await (const chunk of handle.createReadStream({autoClose:false, start:0})) hasher.update(chunk);
  return hasher.digest('hex');
}
async function checkedExisting(filename, expected) {
  let opened;
  try { opened = await regularFile(filename, GRANT_PORTFOLIO_MAX_PACKET_BYTES); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    need(opened.info.size === expected.bytes && await hashHandle(opened.handle) === expected.sha256,
      'DESTINATION_CONFLICT', 'The destination belongs to different original bytes.');
    const after = await opened.handle.stat(), attached = await lstat(filename);
    need(after.size === opened.info.size && after.mtimeMs === opened.info.mtimeMs && after.ctimeMs === opened.info.ctimeMs &&
      attached.dev === opened.info.dev && attached.ino === opened.info.ino, 'DESTINATION_CONFLICT', 'The retained destination changed during its complete read.');
    return {...expected, path:filename, retained:true};
  } finally { await opened.handle.close(); }
}
/** Publishes a complete stream once. A repeated receive preserves the matching original file. */
export async function saveGrantPortfolioFile({descriptor:expected, response}, filename) {
  need(plain(expected) && HASH.test(expected.sha256 ?? '') && Number.isSafeInteger(expected.bytes) &&
    expected.bytes >= 1 && expected.bytes <= GRANT_PORTFOLIO_MAX_PACKET_BYTES, 'FILE_RESPONSE', 'Use the complete original file descriptor.');
  need(typeof filename === 'string' && isAbsolute(filename) && !filename.includes('\0'), 'FILE', 'Select one absolute output file.');
  filename = resolve(filename);
  let temporary, handle;
  try {
    const current = await checkedExisting(filename, expected);
    if (current) { await response.body?.cancel(); return current; }
    const parent = await realpath(dirname(filename)), info = await lstat(parent);
    need(parent === dirname(filename) && info.isDirectory(), 'FILE', 'Use the real original output directory.');
    temporary = join(parent, '.' + basename(filename) + '.partial-' + randomUUID());
    handle = await open(temporary, 'wx', 0o600);
    const hasher = createHash('sha256'); let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength; need(size <= expected.bytes, 'FILE_CHANGED', 'The original file exceeded its declared byte count.');
      hasher.update(chunk); await handle.writeFile(chunk);
    }
    need(size === expected.bytes && hasher.digest('hex') === expected.sha256,
      'FILE_CHANGED', 'The complete original file differs from its retained descriptor.');
    await handle.sync(); await handle.close(); handle = null;
    await link(temporary, filename).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return await checkedExisting(filename, expected);
  } finally {
    await handle?.close(); if (temporary) await unlink(temporary).catch(() => {});
    await response.body?.cancel().catch(() => {});
  }
}
export async function readGrantPortfolioConnection(filename) {
  const {handle, info} = await regularFile(filename, 4096, true);
  try {
    need(info.nlink === 1 && await realpath(filename) === resolve(filename), 'CONNECTION_FILE', 'Use the original private connection without path aliases.');
    const parent = await lstat(dirname(resolve(filename)));
    if (process.platform !== 'win32') need(parent.isDirectory() && (parent.mode & 0o077) === 0 &&
      parent.uid === process.getuid(), 'CONNECTION_FILE', 'Keep the console connection in its original private directory.');
    const data = await handle.readFile(), after = await handle.stat(), attached = await lstat(filename);
    need(data.length === info.size && after.size === info.size && after.mtimeMs === info.mtimeMs &&
      after.ctimeMs === info.ctimeMs && after.nlink === 1 && attached.dev === info.dev && attached.ino === info.ino,
    'CONNECTION_FILE_CHANGED', 'The original console connection changed during reading.');
    const text = new TextDecoder('utf-8', {fatal:true}).decode(data).trim();
    if (!text.startsWith('{')) return text;
    let value; try { value = JSON.parse(text); } catch {}
    need(plain(value) && value.schema === 'stellar-forge.grant-portfolio-workspace-launch.v1' &&
      value.status === 'GRANT_PORTFOLIO_WORKSPACE_READY' && typeof value.console === 'string' &&
      UUID.test(value.workspaceId ?? '') && HASH.test(value.bindingSha256 ?? '') &&
      (value.connectionFile === undefined || value.connectionFile === resolve(filename)),
      'CONNECTION_FILE', 'Use the original console connection announcement.');
    return value.console;
  } finally { await handle.close(); }
}
export async function connectGrantPortfolio({consoleUrl, consoleUrlFile, timeoutMs} = {}) {
  need((consoleUrl === undefined) !== (consoleUrlFile === undefined), 'CONNECTION', 'Select one original console URL or private connection file.');
  return new GrantPortfolioClient(consoleUrlFile === undefined ? consoleUrl : await readGrantPortfolioConnection(consoleUrlFile), {timeoutMs});
}
