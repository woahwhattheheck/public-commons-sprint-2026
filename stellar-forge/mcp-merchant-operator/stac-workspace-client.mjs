// MIT. Client for the ORIGINAL authenticated STAC analyst host.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { STAC_PRESCIENT_ACTIONS } from './stac-prescient-contract.mjs';

export const STAC_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.stac-workspace-connection.v1';
export const STAC_CLIENT_MAX_BYTES = 512 * 1024 * 1024;
export const stacDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = /^[a-f0-9]{64}$/;
const nativeName = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const cleanId = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
export class StacWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'StacWorkspaceError'; this.code = code; Object.assign(this, details);
  }
}
const fail = (code, message, details) => { throw new StacWorkspaceError(code, message, details); };
function object(value, name = 'Input') {
  if (!plain(value)) fail('STAC_CLIENT_INPUT_INVALID', name + ' must be a JSON object.');
  return value;
}
function id(value, name = 'Saved identifier') {
  if (!cleanId(value)) fail('STAC_CLIENT_INPUT_INVALID', name + ' is required.');
  return value;
}
function actionId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    fail('STAC_CLIENT_OPERATION_ID_REQUIRED', 'Supply one stable original operationId before dispatch.');
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail('STAC_CLIENT_REVISION_REQUIRED', 'Supply the current original workspace revision.');
  return value;
}
function selectedName(value) {
  if (typeof value !== 'string' || !nativeName.test(value))
    fail('STAC_CLIENT_CAPABILITY_INVALID', 'Choose an original declared capability name.');
  return value;
}
export function canonicalStacJSON(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'number' && !Number.isFinite(value))
      fail('STAC_CLIENT_JSON_INVALID', 'Use finite, defined JSON values.');
    const result = JSON.stringify(value);
    if (result === undefined) fail('STAC_CLIENT_JSON_INVALID', 'Use JSON values.');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalStacJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalStacJSON(value[key])).join(',') + '}';
}
export function nativeStacItemId(item) {
  id(item?.collection, 'Native collection'); id(item?.id, 'Native item ID');
  return encodeURIComponent(item.collection) + '/' + encodeURIComponent(item.id);
}

/** Read one stable regular host file; private connection records must be owner-only. */
export async function readStacHostFile(path, maximum = STAC_CLIENT_MAX_BYTES, { privateFile = false, expectedSha256 } = {}) {
  if (!positive(maximum, STAC_CLIENT_MAX_BYTES)) fail('STAC_CLIENT_LIMIT_INVALID', 'Choose a supported file limit.');
  if (expectedSha256 !== undefined && !sha.test(expectedSha256)) fail('STAC_CLIENT_DIGEST_INVALID', 'Use the exact SHA256.');
  const handle = await open(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || privateFile && (before.nlink !== 1 ||
        process.platform !== 'win32' && (before.mode & 0o077 || typeof process.getuid === 'function' && before.uid !== process.getuid())))
      fail('STAC_CLIENT_FILE_INVALID', 'Use a regular file within its byte limit; connection files must be private and owned by this user.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || after.ino !== before.ino || after.dev !== before.dev)
      fail('STAC_CLIENT_FILE_CHANGED', 'The selected host file changed while it was read.');
    if (expectedSha256 && stacDigest(bytes) !== expectedSha256)
      fail('STAC_CLIENT_FILE_CHANGED', 'The selected file does not match the reviewed SHA256.');
    return bytes;
  } finally { await handle.close(); }
}

export async function readStacWorkspaceConfiguration(path) {
  path = resolve(path);
  let raw;
  try { raw = JSON.parse((await readStacHostFile(path, 1024 * 1024, { privateFile: true })).toString('utf8')); }
  catch (error) { if (error instanceof StacWorkspaceError) throw error; fail('STAC_CONNECTION_INVALID', 'Read a private STAC connection JSON file.'); }
  object(raw, 'Connection');
  if (raw.schema !== STAC_WORKSPACE_CONNECTION_SCHEMA || Object.keys(raw).some(k => !['schema', 'workspaces'].includes(k)) ||
      !plain(raw.workspaces) || Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    fail('STAC_CONNECTION_INVALID', 'Declare the STAC connection schema and 1–32 workspace aliases.');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(alias)) fail('STAC_CONNECTION_INVALID', 'Use a lowercase workspace alias.');
    object(value, 'Workspace');
    if (Object.keys(value).some(k => !['label', 'consoleUrlFile', 'consoleUrlEnv', 'workspaceId', 'timeoutMs', 'maxResponseBytes', 'inputs', 'processingProfiles', 'prescientDeliveries'].includes(k)) ||
        Boolean(value.consoleUrlFile) === Boolean(value.consoleUrlEnv))
      fail('STAC_CONNECTION_INVALID', 'Each workspace needs exactly one original private consoleUrlFile or consoleUrlEnv.');
    const entry = { label: value.label ?? alias, inputs: Object.create(null), processingProfiles: Object.create(null), prescientDeliveries: Object.create(null) };
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 240 || /[\x00-\x1f\x7f]/.test(entry.label))
      fail('STAC_CONNECTION_INVALID', 'Use a short single-line workspace label.');
    if (value.consoleUrlFile) { id(value.consoleUrlFile, 'Connection file'); entry.consoleUrlFile = resolve(base, value.consoleUrlFile); }
    if (value.consoleUrlEnv) {
      if (typeof value.consoleUrlEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.consoleUrlEnv))
        fail('STAC_CONNECTION_INVALID', 'Name one host environment variable for the original console connection.');
      entry.consoleUrlEnv = value.consoleUrlEnv;
    }
    if (value.workspaceId !== undefined) entry.workspaceId = id(value.workspaceId, 'Expected original workspace ID');
    for (const [key, maximum] of [['timeoutMs', 30 * 60 * 1000], ['maxResponseBytes', STAC_CLIENT_MAX_BYTES]])
      if (value[key] !== undefined) { if (!positive(value[key], maximum)) fail('STAC_CONNECTION_INVALID', 'Invalid ' + key + '.'); entry[key] = value[key]; }
    if (value.inputs !== undefined) {
      object(value.inputs, 'Input aliases');
      if (Object.keys(value.inputs).length > 128) fail('STAC_CONNECTION_INVALID', 'Use at most 128 host input aliases.');
      for (const [name, input] of Object.entries(value.inputs)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) fail('STAC_CONNECTION_INVALID', 'Use a lowercase input alias.');
        object(input, 'Host input');
        if (Object.keys(input).some(k => !['path', 'kind', 'label', 'sha256'].includes(k)) ||
            !['imagery-handover', 'processing-handover', 'processing-source', 'processing-page'].includes(input.kind))
          fail('STAC_CONNECTION_INVALID', 'Choose an original STAC input kind.');
        const inputPath = resolve(base, id(input.path, 'Input file'));
        if (input.sha256 !== undefined && !sha.test(input.sha256)) fail('STAC_CONNECTION_INVALID', 'Use the original input SHA256.');
        entry.inputs[name] = { path: inputPath, kind: input.kind, label: input.label ?? name, ...(input.sha256 ? { sha256: input.sha256 } : {}) };
      }
    }
    if (value.processingProfiles !== undefined) {
      object(value.processingProfiles, 'Processing profile aliases');
      for (const [name, profile] of Object.entries(value.processingProfiles)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) fail('STAC_CONNECTION_INVALID', 'Use a lowercase processing profile alias.');
        object(profile, 'Processing profile');
        if (Object.keys(profile).some(k => !['label', 'deployment', 'sourceInput', 'sourceMetadata'].includes(k)) ||
            !plain(profile.deployment) || entry.inputs[profile.sourceInput]?.kind !== 'processing-source')
          fail('STAC_CONNECTION_INVALID', 'A processing profile needs its original deployment and declared processing-source input.');
        if (profile.sourceMetadata !== undefined) object(profile.sourceMetadata, 'Source metadata');
        entry.processingProfiles[name] = { ...profile, label: profile.label ?? name };
      }
    }
    if (value.prescientDeliveries !== undefined) {
      object(value.prescientDeliveries, 'Prescient delivery aliases');
      if (Object.keys(value.prescientDeliveries).length > 128)
        fail('STAC_CONNECTION_INVALID', 'Use at most 128 host delivery aliases.');
      for (const [name, delivery] of Object.entries(value.prescientDeliveries)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) fail('STAC_CONNECTION_INVALID', 'Use a lowercase delivery alias.');
        object(delivery, 'Host delivery');
        if (Object.keys(delivery).some(key => !['directory', 'label', 'manifestSha256'].includes(key)))
          fail('STAC_CONNECTION_INVALID', 'Declare the original delivery directory, label and optional receiving manifest SHA256.');
        const label = delivery.label ?? name;
        if (!cleanId(label) || label.length > 240 || !label.trim() ||
            delivery.manifestSha256 !== undefined && !sha.test(delivery.manifestSha256))
          fail('STAC_CONNECTION_INVALID', 'Use a short delivery label and the exact receiving manifest SHA256.');
        entry.prescientDeliveries[name] = { directory: resolve(base, id(delivery.directory, 'Delivery directory')), label,
          ...(delivery.manifestSha256 === undefined ? {} : { manifestSha256: delivery.manifestSha256 }) };
      }
    }
    workspaces[alias] = entry;
  }
  return Object.freeze({ schema: raw.schema, path, workspaces });
}

function parseConnection(raw, declaredId) {
  let value = raw;
  if (typeof value === 'string') {
    value = value.trim();
    if (value.startsWith('{')) {
      try { value = JSON.parse(value); } catch { fail('STAC_CONNECTION_INVALID', 'Read the original serve JSON record or private URL.'); }
    }
  }
  let text = value, expected = declaredId;
  if (plain(value)) {
    text = value.url;
    if (value.workspaceId !== undefined) {
      if (expected !== undefined && expected !== value.workspaceId) fail('STAC_WORKSPACE_ID_CHANGED', 'The native connection record belongs to a different workspace.');
      expected = value.workspaceId;
    }
  }
  if (typeof text !== 'string' || text.length > 8192) fail('STAC_CONNECTION_INVALID', 'Read the original private URL printed by stac serve.');
  let url;
  try { url = new URL(text); } catch { fail('STAC_CONNECTION_INVALID', 'Read the original private URL printed by stac serve.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || !/^#session=[A-Za-z0-9_-]{43}$/.test(url.hash))
    fail('STAC_CONNECTION_INVALID', 'Use the original loopback session URL without changing its address or fragment.');
  id(expected, 'Expected original workspaceId from the native serve record');
  return { origin: url.origin, token: url.hash.slice('#session='.length), workspaceId: expected,
    fingerprint: stacDigest(Buffer.from(url.href + '\n' + expected)) };
}
async function responseBytes(response, maximum) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum)) {
    await response.body?.cancel().catch(() => {});
    fail('STAC_CLIENT_RESPONSE_TOO_LARGE', 'The original response exceeds this client byte limit. Use the native portable edition directory for larger handovers.');
  }
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  if (!reader) return Buffer.alloc(0);
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('STAC_CLIENT_RESPONSE_TOO_LARGE', 'The original response exceeds this client byte limit.'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  if (length !== null && size !== Number(length)) fail('STAC_CLIENT_RESPONSE_INCOMPLETE', 'The original response ended before its declared byte length.');
  return Buffer.concat(chunks, size);
}
function awaitShared(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}
function filename(response, fallback) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i), plainName = disposition.match(/filename="([^"]*)"/i);
  let name = plainName?.[1] ?? fallback;
  if (encoded) { try { name = decodeURIComponent(encoded[1]); } catch {} }
  return basename(String(name)).replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0,180) || fallback;
}

/**
 * Attaches to one original host. close() stops only this client's reads/waits;
 * original captures continue until an explicit native cancel operation.
 */
export class StacWorkspaceClient {
  #definition; #environment; #fetch; #session; #auth; #lifetime = new AbortController(); #closed = false; #boundId;
  constructor(definition, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    object(definition, 'Host connection');
    const count = [definition.url, definition.consoleUrlFile, definition.consoleUrlEnv].filter(v => v !== undefined).length;
    if (count !== 1 || typeof fetchImpl !== 'function') fail('STAC_CONNECTION_INVALID', 'Choose one original URL, private URL file or host variable.');
    this.#definition = { ...definition }; this.#environment = environment; this.#fetch = fetchImpl;
    this.timeoutMs = definition.timeoutMs ?? 60000; this.maxResponseBytes = definition.maxResponseBytes ?? 128 * 1024 * 1024;
    if (!positive(this.timeoutMs, 30 * 60 * 1000) || !positive(this.maxResponseBytes, STAC_CLIENT_MAX_BYTES))
      fail('STAC_CLIENT_LIMIT_INVALID', 'Choose a supported timeout and response limit.');
    this.#boundId = definition.workspaceId;
  }
  get metadata() { return { workspaceId: this.#boundId ?? null, connected: Boolean(this.#session), closed: this.#closed,
    timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes, hostOwnership: 'ORIGINAL_STAC_HOST' }; }
  async #connection() {
    if (this.#closed) fail('STAC_CLIENT_CLOSED', 'This client is closed.');
    const d = this.#definition;
    const raw = d.consoleUrlFile ? (await readStacHostFile(d.consoleUrlFile, 16384, { privateFile: true })).toString('utf8')
      : d.consoleUrlEnv ? this.#environment[d.consoleUrlEnv] : d.url;
    return parseConnection(raw, this.#boundId);
  }
  async #fetchResponse(connection, path, { method = 'GET', body, signal, session, operationId, maximum, stream = false, range, ifRange } = {}) {
    const joined = AbortSignal.any([this.#lifetime.signal, AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    const headers = { accept: 'application/json', origin: connection.origin };
    if (range !== undefined) {
      if (!/^bytes=\d+-\d+$/.test(range) || !sha.test(ifRange ?? '')) fail('STAC_CLIENT_RANGE_INVALID', 'Use a verified original asset range.');
      headers.range = range; headers['if-range'] = '"' + ifRange + '"';
    }
    if (session) { headers.cookie = session.cookie; if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = session.csrf; }
    let encoded;
    if (body !== undefined) { encoded = JSON.stringify(body); headers['content-type'] = 'application/json';
      if (session && Buffer.byteLength(encoded) > session.maxRequestBytes)
        fail('STAC_CLIENT_REQUEST_TOO_LARGE', 'This original host cannot accept that request size; use its portable directory receiving command.'); }
    let response;
    try { response = await this.#fetch(connection.origin + path, { method, headers, ...(encoded === undefined ? {} : { body: encoded }),
      redirect: 'error', signal: joined }); }
    catch {
      fail('STAC_CLIENT_TRANSPORT_ERROR', 'The original host response was not received. Read the same workspace and operation before choosing an explicit continuation.',
        { ambiguous: method !== 'GET' && method !== 'HEAD', method, ...(operationId ? { operationId } : {}) });
    }
    if (stream && response.ok) return { response };
    let bytes;
    try { bytes = await responseBytes(response, maximum ?? this.maxResponseBytes); }
    catch (error) { if (method !== 'GET' && method !== 'HEAD') { error.ambiguous = true; if (operationId) error.operationId = operationId; } throw error; }
    if (!response.ok) {
      let error; try { error = JSON.parse(bytes.toString('utf8')).error; } catch {}
      let message = typeof error?.message === 'string' ? error.message : 'The original host rejected this request.';
      for (const secret of [connection.token, session?.csrf, session?.cookie]) if (secret) message = message.split(secret).join('[private]');
      fail(typeof error?.code === 'string' ? error.code : 'STAC_CLIENT_HTTP_ERROR', message.slice(0, 6000),
        { status: response.status, responseReceived: true, ambiguous: method !== 'GET' && method !== 'HEAD' && response.status >= 500,
          method, ...(operationId ? { operationId } : {}) });
    }
    return { response, bytes };
  }
  async #connect(signal) {
    signal?.throwIfAborted();
    const connection = await this.#connection();
    if (this.#session?.fingerprint === connection.fingerprint) return { connection, session: this.#session };
    if (this.#auth) { await awaitShared(this.#auth, signal); return this.#connect(signal); }
    this.#auth = (async () => {
      const established = await this.#fetchResponse(connection, '/api/session', { method: 'POST', body: { token: connection.token }, signal, maximum: 16384 });
      let auth; try { auth = JSON.parse(established.bytes.toString('utf8')); } catch { fail('STAC_CLIENT_SESSION_INVALID', 'The original host returned an invalid session response.'); }
      const cookies = established.response.headers.getSetCookie?.() ?? [established.response.headers.get('set-cookie') ?? ''];
      const cookieName = 'stac_session_' + new URL(connection.origin).port;
      const cookie = cookies.map(v => v.split(';')[0]).find(v => v.startsWith(cookieName + '='));
      if (!cookie || !new RegExp('^' + cookieName + '=[A-Za-z0-9_-]{43}$').test(cookie) ||
          typeof auth.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(auth.csrfToken) ||
          !positive(auth.maxRequestBytes, Number.MAX_SAFE_INTEGER))
        fail('STAC_CLIENT_SESSION_INVALID', 'The original host session contract is incomplete.');
      const session = { cookie, csrf: auth.csrfToken, maxRequestBytes: auth.maxRequestBytes, fingerprint: connection.fingerprint };
      const checked = await this.#fetchResponse(connection, '/api/state', { signal, session });
      let state; try { state = JSON.parse(checked.bytes.toString('utf8')); } catch { fail('STAC_CLIENT_RESPONSE_INVALID', 'The original state response is not JSON.'); }
      if (state?.workspace?.id !== connection.workspaceId) fail('STAC_WORKSPACE_ID_CHANGED', 'The original host belongs to a different workspace. No workspace operation was dispatched.');
      if (this.#closed) fail('STAC_CLIENT_CLOSED', 'This client closed during session establishment.');
      this.#boundId = connection.workspaceId; this.#session = session;
    })();
    try { await this.#auth; } finally { this.#auth = null; }
    return { connection, session: this.#session };
  }
  async #request(path, options = {}) {
    const { connection, session } = await this.#connect(options.signal);
    return this.#fetchResponse(connection, path, { ...options, session });
  }
  async #json(path, options = {}) {
    const { bytes } = await this.#request(path, options);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { fail('STAC_CLIENT_RESPONSE_INVALID', 'The original host response was not complete JSON.',
      { ambiguous: options.method === 'POST', ...(options.operationId ? { operationId: options.operationId } : {}) }); }
  }
  state(options) { return this.#json('/api/state', options); }
  jobs(options) { return this.#json('/api/jobs', options); }
  job(operationId, options) { return this.#json('/api/jobs/' + encodeURIComponent(id(operationId)), options); }
  edition(editionId, options) { return this.#json('/api/editions/' + encodeURIComponent(id(editionId)), options); }
  compare({ leftEditionId, rightEditionId }, options) { return this.#json('/api/compare?left=' + encodeURIComponent(id(leftEditionId)) + '&right=' + encodeURIComponent(id(rightEditionId)), options); }
  discover({ operationId, expectedRevision }, options = {}) {
    return this.#json('/api/discover', { ...options, method: 'POST', operationId: actionId(operationId), body: { operationId, expectedRevision: revision(expectedRevision) } });
  }
  saveQuery(input, options = {}) {
    object(input); revision(input.expectedRevision);
    return this.#json('/api/queries', { ...options, method: 'POST', body: input });
  }
  reviewSearch({ queryId }, options = {}) { return this.#json('/api/search/review', { ...options, method: 'POST', body: { queryId: id(queryId) } }); }
  acquire({ reviewId, operationId }, options = {}) {
    return this.#json('/api/search/acquire', { ...options, method: 'POST', operationId: actionId(operationId), body: { reviewId: id(reviewId), operationId } });
  }
  resume({ editionId, operationId }, options = {}) {
    return this.#json('/api/search/resume', { ...options, method: 'POST', operationId: actionId(operationId), body: { editionId: id(editionId), operationId } });
  }
  cancel({ editionId }, options = {}) { return this.#json('/api/search/cancel', { ...options, method: 'POST', body: { editionId: id(editionId) } }); }
  reviewAsset(input, options = {}) {
    object(input); for (const k of ['editionId', 'itemId', 'assetKey']) id(input[k], k);
    if (!positive(input.maxBytes, Number.MAX_SAFE_INTEGER)) fail('STAC_CLIENT_ASSET_LIMIT_REQUIRED', 'Supply the reviewed maximum asset bytes.');
    return this.#json('/api/assets/review', { ...options, method: 'POST', body: input });
  }
  acquireAsset({ reviewId, operationId }, options = {}) {
    return this.#json('/api/assets/acquire', { ...options, method: 'POST', operationId: actionId(operationId), body: { reviewId: id(reviewId), operationId } });
  }
  setDecision(input, options = {}) {
    object(input); revision(input.expectedRevision);
    return this.#json('/api/decisions', { ...options, method: 'POST', body: input });
  }
  importHandover(bundle, options = {}) {
    object(bundle, 'Original handover');
    if (bundle.schema !== 'scf-stac-handover/v1' || !sha.test(bundle.digest ?? '')) fail('STAC_CLIENT_HANDOVER_INVALID', 'Import the complete original imagery handover.');
    const { digest, ...core } = bundle;
    if (stacDigest(Buffer.from(canonicalStacJSON(core))) !== digest) fail('STAC_CLIENT_HANDOVER_CHANGED', 'The original handover digest does not match its complete contents.');
    return this.#json('/api/handover/import', { ...options, method: 'POST', body: bundle });
  }
  async processingState(options) { return this.#json('/api/processing/state', options); }
  async processingRead(name, query = {}, options = {}) {
    selectedName(name); object(query);
    const state = await this.state(options);
    if (!state.capabilities?.processing?.enabled || !state.capabilities.processing.reads?.includes(name))
      fail('STAC_CLIENT_CAPABILITY_UNAVAILABLE', 'This original host has not enabled that processing read.');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) for (const item of (Array.isArray(value) ? value : [value])) {
      if (!['string', 'number', 'boolean'].includes(typeof item)) fail('STAC_CLIENT_QUERY_INVALID', 'Processing query values must be strings, numbers, booleans or arrays of those values.');
      params.append(key, String(item));
    }
    return this.#json('/api/processing/reads/' + encodeURIComponent(name) + (params.size ? '?' + params : ''), options);
  }
  async processingAction(name, { input = {}, operationId }, options = {}) {
    selectedName(name); object(input); actionId(operationId);
    const state = await this.state(options);
    if (!state.capabilities?.processing?.enabled || !state.capabilities.processing.actions?.includes(name))
      fail('STAC_CLIENT_CAPABILITY_UNAVAILABLE', 'This original host has not enabled that processing action.');
    return this.#json('/api/processing/actions/' + encodeURIComponent(name), { ...options, method: 'POST', body: { input, operationId }, operationId });
  }
  /** Read only: never starts the SDK or refreshes a provider session. */
  async prescientState(options = {}) {
    const value = await this.#json('/api/prescient/state', options);
    if (value?.schema !== 'starforge.prescient-operator-view/v1' || value.workspaceId !== this.#boundId ||
        !plain(value.configuration) || !Number.isSafeInteger(value.configuration.revision) || value.configuration.revision < 0)
      fail('STAC_CLIENT_RESPONSE_INVALID', 'The original Prescient state does not match this workspace.');
    return value;
  }
  /** The native portable profile excludes the receiver-owned credential binding. */
  async prescientProfile(profileSha256, options = {}) {
    if (!sha.test(profileSha256 ?? '')) fail('STAC_CLIENT_DIGEST_INVALID', 'Choose the original saved profile SHA256.');
    const value = await this.#json('/api/prescient/profiles/' + profileSha256 + '/export', options);
    if (!plain(value) || value.schema !== 'starforge.prescient-portable-profile/v1' || !plain(value.configuration) ||
        Object.hasOwn(value.configuration, 'bindingId') || !sha.test(value.sha256 ?? ''))
      fail('STAC_CLIENT_RESPONSE_INVALID', 'The original portable profile contract is incomplete.');
    const { sha256, ...core } = value;
    if (stacDigest(Buffer.from(canonicalStacJSON(core))) !== sha256)
      fail('STAC_CLIENT_FILE_CHANGED', 'The portable profile does not match its native digest.');
    return value;
  }
  /** Dispatch once with the caller's retained original body. No mutation retry or SDK fallback. */
  prescientAction(name, body, options = {}) {
    if (!Object.hasOwn(STAC_PRESCIENT_ACTIONS, name)) fail('STAC_CLIENT_CAPABILITY_INVALID', 'Choose a declared original Prescient action.');
    const definition = STAC_PRESCIENT_ACTIONS[name], common = ['actor', 'operationId', 'expectedRevision'];
    object(body, 'Prescient action');
    // Session establishment awaits I/O. Validate and dispatch one owned JSON snapshot.
    body = JSON.parse(canonicalStacJSON(body));
    if (Object.keys(body).some(key => !common.includes(key) && !definition.fields.includes(key)) ||
        [...common, ...definition.required].some(key => !Object.hasOwn(body, key)))
      fail('STAC_CLIENT_INPUT_INVALID', 'Supply exactly the selected native action fields, actor, operationId and configuration revision.');
    if (typeof body.actor !== 'string' || !body.actor.trim() || body.actor.length > 240 || /[\x00-\x1f\x7f]/.test(body.actor))
      fail('STAC_CLIENT_INPUT_INVALID', 'Supply the original reviewer as a short single-line actor.');
    if (typeof body.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.operationId))
      fail('STAC_CLIENT_OPERATION_ID_REQUIRED', 'Supply one stable original Prescient operationId.');
    revision(body.expectedRevision);
    for (const key of ['profileSha256', 'reviewSha256', 'manifestSha256'])
      if (body[key] !== undefined && !sha.test(body[key])) fail('STAC_CLIENT_DIGEST_INVALID', 'Supply the exact native ' + key + '.');
    for (const key of ['reviewId', 'bindingId', 'directory']) if (body[key] !== undefined) id(body[key], key);
    if (body.profile !== undefined) object(body.profile, 'Complete native profile');
    if (body.refresh !== undefined && typeof body.refresh !== 'boolean')
      fail('STAC_CLIENT_INPUT_INVALID', 'Choose an explicit boolean refresh value.');
    canonicalStacJSON(body);
    return this.#json('/api/prescient' + definition.path, { ...options, method: 'POST', body, operationId: body.operationId });
  }
  async #asset(assetId, expectedSha256, options) {
    const state = await this.state(options), asset = state.workspace.assets.find(value => value.id === id(assetId));
    if (!asset || asset.status !== 'COMPLETE' || !sha.test(asset.sha256 ?? '') || !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 || asset.bytes > 2 * 1024 ** 3)
      fail('STAC_CLIENT_ASSET_UNAVAILABLE', 'Choose a complete original retained asset.');
    if (expectedSha256 !== undefined && (!sha.test(expectedSha256) || expectedSha256 !== asset.sha256))
      fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset differs from the selected SHA256.');
    return asset;
  }
  /** Stream the original complete asset without buffering its body in the client. */
  async streamAsset(assetId, { expectedSha256, signal } = {}) {
    const asset = await this.#asset(assetId, expectedSha256, { signal });
    const { response } = await this.#request('/api/assets/' + encodeURIComponent(asset.id) + '/download', { signal, stream: true });
    if (response.status !== 200 || response.headers.get('etag') !== '"' + asset.sha256 + '"' ||
        response.headers.get('content-length') !== String(asset.bytes)) {
      await response.body?.cancel().catch(() => {});
      fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset response differs from its saved identity.');
    }
    return { name: filename(response, asset.filename ?? asset.assetKey ?? 'stac-asset'),
      type: response.headers.get('content-type') ?? 'application/octet-stream', bytes: asset.bytes,
      sha256: asset.sha256, body: response.body };
  }
  /** Read one bounded range of a native immutable asset; consumers verify the complete digest after assembly. */
  async assetRange(assetId, { offset = 0, limit = 65536, expectedSha256, signal } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !positive(limit, 196608) || offset > 0 && !sha.test(expectedSha256 ?? ''))
      fail('STAC_CLIENT_RANGE_INVALID', 'Use a nonnegative offset, at most 196,608 bytes, and the original SHA256 after the first range.');
    const asset = await this.#asset(assetId, expectedSha256, { signal });
    if (offset > asset.bytes) fail('STAC_CLIENT_RANGE_INVALID', 'The selected offset is beyond this original asset.');
    if (offset === asset.bytes) {
      return { file: { name: asset.filename ?? asset.assetKey ?? 'stac-asset', contentType: asset.mime ?? 'application/octet-stream',
        bytes: asset.bytes, sha256: asset.sha256 }, offset, bytesRead: 0, nextOffset: null, encoding: 'base64', data: '',
        chunkSha256: stacDigest(Buffer.alloc(0)) };
    }
    const end = Math.min(asset.bytes - 1, offset + limit - 1);
    const { response, bytes } = await this.#request('/api/assets/' + encodeURIComponent(asset.id) + '/download',
      { signal, maximum: limit, range: 'bytes=' + offset + '-' + end, ifRange: asset.sha256 });
    if (response.status !== 206 || response.headers.get('etag') !== '"' + asset.sha256 + '"' ||
        response.headers.get('content-range') !== 'bytes ' + offset + '-' + end + '/' + asset.bytes || bytes.length !== end - offset + 1)
      fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset range does not match its saved identity.');
    return { file: { name: filename(response, asset.filename ?? asset.assetKey ?? 'stac-asset'),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream', bytes: asset.bytes, sha256: asset.sha256 },
      offset, bytesRead: bytes.length, nextOffset: end + 1 < asset.bytes ? end + 1 : null, encoding: 'base64',
      data: bytes.toString('base64'), chunkSha256: stacDigest(bytes) };
  }
  /** One selected native job; timeout/abort stops polling, never repeats its action. */
  async wait(operationId, { signal, timeoutMs = 60000, intervalMs = 500 } = {}) {
    actionId(operationId);
    if (!positive(timeoutMs, 30 * 60 * 1000) || !positive(intervalMs, 60000)) fail('STAC_CLIENT_LIMIT_INVALID', 'Choose positive bounded polling intervals.');
    const until = Date.now() + timeoutMs, deadline = AbortSignal.timeout(timeoutMs);
    const joined = AbortSignal.any([this.#lifetime.signal, deadline, ...(signal ? [signal] : [])]);
    try { for (;;) {
      joined.throwIfAborted();
      const job = await this.job(operationId, { signal: joined });
      if (job.status !== 'RUNNING') return job;
      if (Date.now() >= until) fail('STAC_CLIENT_WAIT_EXPIRED', 'The same original job is still running; inspect or wait on its operationId.', { operationId });
      await new Promise((resolve, reject) => {
        const end = () => { clearTimeout(timer); joined.removeEventListener('abort', stop); resolve(); };
        const stop = () => { clearTimeout(timer); joined.removeEventListener('abort', stop); reject(joined.reason); };
        const timer = setTimeout(end, Math.min(intervalMs, Math.max(1, until - Date.now())));
        joined.addEventListener('abort', stop, { once: true }); if (joined.aborted) stop();
      });
    } } catch (error) {
      if (deadline.aborted && !this.#lifetime.signal.aborted && !signal?.aborted)
        fail('STAC_CLIENT_WAIT_EXPIRED', 'The wait deadline expired; inspect or wait on the same original operationId.', { operationId });
      throw error;
    }
  }
  /** Complete ORIGINAL bytes. MCP uses RetainedFileReads to expose the same bytes in bounded chunks. */
  async file(selection, options = {}) {
    object(selection); let result, fallback = 'stac.json', expected;
    if (selection.kind === 'asset') {
      const state = await this.state(options);
      const asset = state.workspace.assets.find(v => v.id === id(selection.assetId));
      if (!asset || asset.status !== 'COMPLETE' || !sha.test(asset.sha256 ?? ''))
        fail('STAC_CLIENT_ASSET_UNAVAILABLE', 'Choose a complete original retained asset.');
      result = await this.#request('/api/assets/' + encodeURIComponent(asset.id) + '/download', options);
      expected = asset.sha256;
      if (result.bytes.length !== asset.bytes) fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset byte length changed.');
      fallback = asset.filename ?? asset.assetKey ?? 'stac-asset';
    } else if (selection.kind === 'report') {
      if (!['json', 'csv', 'html'].includes(selection.format)) fail('STAC_CLIENT_FORMAT_INVALID', 'Choose the original JSON, CSV or HTML report.');
      result = await this.#request('/api/report?editionId=' + encodeURIComponent(id(selection.editionId)) + '&format=' + selection.format, options);
      fallback = 'stac-report.' + selection.format;
    } else if (selection.kind === 'handover') {
      if (selection.editionIds !== undefined && (!Array.isArray(selection.editionIds) || !selection.editionIds.length || selection.editionIds.some(v => !cleanId(v))))
        fail('STAC_CLIENT_INPUT_INVALID', 'Choose the complete edition IDs.');
      const body = { ...(selection.editionIds ? { editionIds: selection.editionIds } : {}), includeAssets: selection.includeAssets !== false };
      result = await this.#request('/api/handover/export', { ...options, method: 'POST', body });
      fallback = 'stac-workspace-handover.json';
    } else if (selection.kind === 'processing-source' || selection.kind === 'processing-handover') {
      const isSource = selection.kind === 'processing-source';
      const value = await this.processingRead(isSource ? 'source' : 'handover',
        isSource ? { deploymentKey: id(selection.deploymentKey) } : { exportId: id(selection.exportId) }, options);
      if (typeof value.contentBase64 !== 'string' || !sha.test(value.sha256 ?? ''))
        fail('STAC_CLIENT_FILE_INVALID', 'The original processing file contract is incomplete.');
      const bytes = Buffer.from(value.contentBase64, 'base64');
      if (bytes.toString('base64') !== value.contentBase64 || bytes.length !== value.bytes || stacDigest(bytes) !== value.sha256)
        fail('STAC_CLIENT_FILE_CHANGED', 'The original processing bytes do not match their retained digest.');
      return { name: value.filename ?? (isSource ? 'processing-source.json' : 'processing-handover.json'),
        type: value.mime ?? 'application/json', bytes, sha256: value.sha256 };
    } else {
      let value;
      if (selection.kind === 'state') value = await this.state(options);
      else if (selection.kind === 'edition') value = await this.edition(selection.editionId, options);
      else if (selection.kind === 'comparison') value = await this.compare(selection, options);
      else if (selection.kind === 'prescient-state') value = await this.prescientState(options);
      else if (selection.kind === 'prescient-profile') value = await this.prescientProfile(selection.profileSha256, options);
      else if (selection.kind === 'processing-state') value = await this.processingState(options);
      else if (selection.kind === 'processing-read') value = await this.processingRead(selection.name, selection.query ?? {}, options);
      else fail('STAC_CLIENT_FILE_KIND_INVALID', 'Choose an original STAC file or complete JSON view.');
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      return { name: 'stac-' + selection.kind + '.json', type: 'application/json', bytes, sha256: stacDigest(bytes) };
    }
    const hash = stacDigest(result.bytes);
    if (expected && hash !== expected) fail('STAC_CLIENT_ASSET_CHANGED', 'The original saved asset digest changed.');
    return { name: filename(result.response, fallback), type: result.response.headers.get('content-type') ?? 'application/octet-stream', bytes: result.bytes, sha256: hash };
  }
  close() { this.#closed = true; this.#session = null; this.#lifetime.abort(new Error('STAC client closed')); }
}

/** Atomically publish one complete native download; never overwrite an existing file. */
export async function saveStacFile(client, selection, destination, { expectedSha256, signal } = {}) {
  if (expectedSha256 !== undefined && !sha.test(expectedSha256)) fail('STAC_CLIENT_DIGEST_INVALID', 'Use the exact original file SHA256.');
  const streamed = selection.kind === 'asset';
  const result = streamed ? await client.streamAsset(selection.assetId, { expectedSha256, signal }) : await client.file(selection, { signal });
  if (expectedSha256 && result.sha256 !== expectedSha256) fail('STAC_CLIENT_FILE_CHANGED', 'The original file differs from the selected SHA256.');
  const size = streamed ? result.bytes : result.bytes.length;
  const target = resolve(destination), parent = dirname(target), temporary = join(parent, '.' + basename(target) + '.' + randomUUID() + '.partial');
  let handle, published = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    if (streamed) {
      const hash = createHash('sha256'); let count = 0;
      if (result.body) for await (const chunk of result.body) {
        count += chunk.byteLength;
        if (count > size) fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset body exceeded its declared byte length.');
        hash.update(chunk); await handle.writeFile(chunk);
      }
      if (count !== size || hash.digest('hex') !== result.sha256)
        fail('STAC_CLIENT_ASSET_CHANGED', 'The original asset body did not match its complete saved digest.');
    } else await handle.writeFile(result.bytes);
    await handle.sync(); await handle.close(); handle = null;
    await link(temporary, target); published = true;
    const directory = await open(parent, 'r'); try { await directory.sync(); } finally { await directory.close(); }
    return { filename: target, bytes: size, sha256: result.sha256, contentType: result.type, sourceFilename: result.name };
  } catch (error) {
    if (published) Object.assign(error, { published: true, filename: target, bytes: size, sha256: result.sha256 });
    throw error;
  } finally {
    if (streamed && !result.body?.locked) await result.body?.cancel().catch(() => {});
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
