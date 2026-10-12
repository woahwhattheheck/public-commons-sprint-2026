// MIT. Complete client for the original FRED economic-edition workspace.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const FRED_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.fred-workspace-connection.v1';
export const FRED_CLIENT_MAX_BYTES = 256 * 1024 * 1024;
export const FRED_CLIENT_MAX_REQUEST_BYTES = 128 * 1024 * 1024;
export const fredDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const SHA = /^[a-f0-9]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const UUID = /^[a-f0-9-]{36}$/;
export class FredWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'FredWorkspaceError'; this.code = code; Object.assign(this, details);
  }
}
const fail = (code, message, details) => { throw new FredWorkspaceError(code, message, details); };
function object(value, label = 'Input') {
  if (!plain(value)) fail('FRED_CLIENT_INPUT_INVALID', label + ' must be a JSON object.');
  return value;
}
function text(value, label, maximum = 2048) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    fail('FRED_CLIENT_INPUT_INVALID', 'Supply the original ' + label + '.');
  return value;
}
function digest(value, label = 'SHA256') {
  if (typeof value !== 'string' || !SHA.test(value)) fail('FRED_CLIENT_INPUT_INVALID', 'Supply the exact ' + label + '.');
  return value;
}
function operation(value) {
  if (typeof value !== 'string' || !ID.test(value)) fail('FRED_CLIENT_OPERATION_REQUIRED', 'Supply the same original operation or intent ID.');
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('FRED_CLIENT_REVISION_REQUIRED', 'Supply the current original project revision.');
  return value;
}
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('FRED_CLIENT_INPUT_INVALID', 'Supply a supported integer ' + label + '.');
  return value;
}
function fields(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key)))
    fail('FRED_CLIENT_INPUT_INVALID', label + ' contains an undeclared field.');
}
export function canonicalFredJSON(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'number' && !Number.isFinite(value))
      fail('FRED_CLIENT_JSON_INVALID', 'Use complete, finite JSON values.');
    const result = JSON.stringify(value);
    if (result === undefined) fail('FRED_CLIENT_JSON_INVALID', 'Use JSON values.');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalFredJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalFredJSON(value[key])).join(',') + '}';
}

/** Reads the complete original regular file through one stable descriptor. */
export async function readFredHostFile(path, maximum = FRED_CLIENT_MAX_BYTES, { privateFile = false, expectedSha256 } = {}) {
  integer(maximum, 1, FRED_CLIENT_MAX_BYTES, 'file capacity');
  if (expectedSha256 !== undefined) digest(expectedSha256);
  const handle = await open(resolve(text(path, 'file path', 8192)),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || privateFile && (before.nlink !== 1 ||
        process.platform !== 'win32' && (before.mode & 0o077 || typeof process.getuid === 'function' && before.uid !== process.getuid())))
      fail('FRED_CLIENT_FILE_INVALID', 'Select a regular file within its capacity; the original connection record must be private and owned by this user.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some(key => before[key] !== after[key]))
      fail('FRED_CLIENT_FILE_CHANGED', 'The selected original file changed during its read.');
    if (expectedSha256 && fredDigest(bytes) !== expectedSha256)
      fail('FRED_CLIENT_FILE_CHANGED', 'The selected original file differs from its reviewed SHA256.');
    return bytes;
  } finally { await handle.close(); }
}

export async function readFredWorkspaceConfiguration(path) {
  path = resolve(text(path, 'connection configuration path', 8192));
  let raw;
  try { raw = JSON.parse((await readFredHostFile(path, 1024 * 1024, { privateFile: true })).toString('utf8')); }
  catch (error) { if (error instanceof FredWorkspaceError) throw error; fail('FRED_CONNECTION_INVALID', 'Read a complete private FRED connection JSON file.'); }
  fields(raw, ['schema', 'workspaces'], 'Connection');
  if (raw.schema !== FRED_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    fail('FRED_CONNECTION_INVALID', 'Declare 1–32 original workspace aliases under the FRED connection schema.');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    if (!ALIAS.test(alias)) fail('FRED_CONNECTION_INVALID', 'Use a lowercase workspace alias.');
    fields(value, ['label', 'consoleUrlFile', 'consoleUrlEnv', 'projectId', 'expectedBindingSha256',
      'timeoutMs', 'maxResponseBytes', 'inputs', 'merchantProfiles'], 'Workspace');
    if (Boolean(value.consoleUrlFile) === Boolean(value.consoleUrlEnv))
      fail('FRED_CONNECTION_INVALID', 'Select exactly one original consoleUrlFile or consoleUrlEnv.');
    const entry = { label: text(value.label ?? alias, 'workspace label', 240),
      inputs: Object.create(null), merchantProfiles: Object.create(null) };
    if (value.consoleUrlFile) entry.consoleUrlFile = resolve(base, text(value.consoleUrlFile, 'native connection record path', 8192));
    if (value.consoleUrlEnv) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.consoleUrlEnv))
        fail('FRED_CONNECTION_INVALID', 'Name the host environment variable retaining the original workspace connection.');
      entry.consoleUrlEnv = value.consoleUrlEnv;
    }
    if (value.projectId !== undefined) {
      if (!UUID.test(value.projectId)) fail('FRED_CONNECTION_INVALID', 'Use the exact original project ID.');
      entry.projectId = value.projectId;
    }
    if (value.expectedBindingSha256 !== undefined) entry.expectedBindingSha256 = digest(value.expectedBindingSha256, 'launch binding SHA256');
    for (const [key, maximum] of [['timeoutMs', 30 * 60 * 1000], ['maxResponseBytes', FRED_CLIENT_MAX_BYTES]])
      if (value[key] !== undefined) entry[key] = integer(value[key], 1, maximum, key);
    if (value.inputs !== undefined) {
      object(value.inputs, 'Host inputs');
      if (Object.keys(value.inputs).length > 128) fail('FRED_CONNECTION_INVALID', 'Declare at most 128 original input aliases.');
      for (const [name, input] of Object.entries(value.inputs)) {
        if (!ALIAS.test(name)) fail('FRED_CONNECTION_INVALID', 'Use a lowercase input alias.');
        fields(input, ['path', 'kind', 'label', 'sha256'], 'Host input');
        if (!['public-table', 'capture'].includes(input.kind))
          fail('FRED_CONNECTION_INVALID', 'Select an original public-table wrapper or retained capture.');
        entry.inputs[name] = { path: resolve(base, text(input.path, 'original source path', 8192)),
          kind: input.kind, label: text(input.label ?? name, 'input label', 240),
          ...(input.sha256 === undefined ? {} : { sha256: digest(input.sha256, 'complete input file SHA256') }) };
      }
    }
    if (value.merchantProfiles !== undefined) {
      object(value.merchantProfiles, 'Merchant profiles');
      if (Object.keys(value.merchantProfiles).length > 32) fail('FRED_CONNECTION_INVALID', 'Declare at most 32 original merchant profiles.');
      for (const [name, profile] of Object.entries(value.merchantProfiles)) {
        if (!ALIAS.test(name)) fail('FRED_CONNECTION_INVALID', 'Use a lowercase merchant profile alias.');
        fields(profile, ['label', 'origin', 'path', 'payment'], 'Merchant profile');
        let origin;
        try { origin = new URL(profile.origin); } catch { fail('FRED_CONNECTION_INVALID', 'Select the original merchant HTTPS origin.'); }
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
          fail('FRED_CONNECTION_INVALID', 'Select an HTTPS merchant origin without credentials or an added path.');
        object(profile.payment, 'Original public payment terms');
        const route = profile.path ?? '/economic-data';
        if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[?#\s]/.test(route))
          fail('FRED_CONNECTION_INVALID', 'Select the original publication route.');
        entry.merchantProfiles[name] = { label: text(profile.label ?? name, 'merchant label', 240),
          origin: origin.origin, path: route, payment: JSON.parse(canonicalFredJSON(profile.payment)) };
      }
    }
    workspaces[alias] = entry;
  }
  return Object.freeze({ schema: raw.schema, path, workspaces });
}

function connection(raw, definition, boundId) {
  let value = raw;
  if (typeof value === 'string') {
    value = value.trim();
    if (value.startsWith('{')) {
      try { value = JSON.parse(value); } catch { fail('FRED_CONNECTION_INVALID', 'Use the complete original startup JSON record or private session URL.'); }
    }
  }
  let rawUrl = value, projectId = definition.projectId ?? boundId, bindingSha256 = definition.expectedBindingSha256;
  if (plain(value)) {
    if (value.schema !== undefined && value.schema !== 'stellar-forge.fred-workspace-startup.v1')
      fail('FRED_CONNECTION_INVALID', 'Use the original FRED workspace startup record.');
    rawUrl = value.url;
    const recordedId = value.binding?.projectId ?? value.projectId;
    if (recordedId !== undefined) {
      if (projectId !== undefined && projectId !== recordedId) fail('FRED_CLIENT_PROJECT_CHANGED', 'This connection record belongs to a different original project.');
      projectId = recordedId;
    }
    const recordedBinding = value.binding?.sha256 ?? value.bindingSha256;
    if (recordedBinding !== undefined) {
      digest(recordedBinding, 'recorded native binding SHA256');
      if (bindingSha256 !== undefined && bindingSha256 !== recordedBinding)
        fail('FRED_CLIENT_BINDING_CHANGED', 'The original configured launch binding changed.');
      bindingSha256 = recordedBinding;
    }
  }
  if (!UUID.test(projectId ?? '')) fail('FRED_CONNECTION_INVALID', 'Retain the original projectId in the startup record or connection definition.');
  if (boundId !== undefined && projectId !== boundId) fail('FRED_CLIENT_PROJECT_CHANGED', 'This client remains bound to its original project.');
  let url;
  try { url = new URL(rawUrl); } catch { fail('FRED_CONNECTION_INVALID', 'Read the original private URL printed by fred serve.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
      url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash))
    fail('FRED_CONNECTION_INVALID', 'Use the unchanged original loopback FRED URL and session fragment.');
  return { origin: url.origin, token: url.hash.slice(1), projectId, bindingSha256,
    fingerprint: fredDigest(Buffer.from(url.href + '\n' + projectId + '\n' + (bindingSha256 ?? ''))) };
}
async function responseBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => {});
    fail('FRED_CLIENT_RESPONSE_TOO_LARGE', 'The complete original response exceeds the selected byte capacity.');
  }
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  if (!reader) {
    if (declared !== null && Number(declared) !== 0) fail('FRED_CLIENT_RESPONSE_INCOMPLETE', 'The original response body was not received.');
    return Buffer.alloc(0);
  }
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('FRED_CLIENT_RESPONSE_TOO_LARGE', 'The complete original response exceeds the selected byte capacity.'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  if (declared !== null && size !== Number(declared)) fail('FRED_CLIENT_RESPONSE_INCOMPLETE', 'The original response ended before its declared byte count.');
  return Buffer.concat(chunks, size);
}
function page(result, key) {
  if (!plain(result) || !Array.isArray(result[key]) || !Number.isSafeInteger(result.total) ||
      !Number.isSafeInteger(result.offset) || result.offset < 0 || result.total < result.offset ||
      result.offset + result[key].length > result.total)
    fail('FRED_CLIENT_RESPONSE_INVALID', 'The original page response is incomplete.');
  if (result.offset < result.total && result[key].length === 0)
    fail('FRED_CLIENT_RESPONSE_INVALID', 'The original page did not advance within its declared rows.');
  return { ...result, nextOffset: result.offset + result[key].length < result.total ? result.offset + result[key].length : null };
}

/** Attaches to the existing server; every mutation has one native HTTP attempt. */
export class FredWorkspaceClient {
  #definition; #environment; #fetch; #lifetime = new AbortController(); #boundId; #bound; #binding; #closed = false;
  constructor(definition, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    object(definition, 'Host connection');
    if ([definition.url, definition.consoleUrlFile, definition.consoleUrlEnv].filter(value => value !== undefined).length !== 1 ||
        typeof fetchImpl !== 'function')
      fail('FRED_CONNECTION_INVALID', 'Select one original URL, native startup file or host variable.');
    this.#definition = { ...definition }; this.#environment = environment; this.#fetch = fetchImpl;
    this.timeoutMs = integer(definition.timeoutMs ?? 120000, 1, 30 * 60 * 1000, 'request timeout');
    this.maxResponseBytes = integer(definition.maxResponseBytes ?? FRED_CLIENT_MAX_BYTES, 1, FRED_CLIENT_MAX_BYTES, 'response capacity');
    if (definition.projectId !== undefined && !UUID.test(definition.projectId))
      fail('FRED_CONNECTION_INVALID', 'Use the exact original project ID.');
    if (definition.expectedBindingSha256 !== undefined) digest(definition.expectedBindingSha256);
    this.#boundId = definition.projectId;
  }
  get metadata() {
    return { projectId: this.#boundId ?? null, connected: Boolean(this.#bound), closed: this.#closed,
      bindingSha256: this.#bound?.launch.binding.sha256 ?? null, instanceId: this.#bound?.launch.instanceId ?? null,
      timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes, hostOwnership: 'ORIGINAL_FRED_WORKSPACE' };
  }
  async #connection() {
    if (this.#closed) fail('FRED_CLIENT_CLOSED', 'The FRED workspace client is closed.');
    const definition = this.#definition;
    const raw = definition.consoleUrlFile
      ? (await readFredHostFile(definition.consoleUrlFile, 65536, { privateFile: true })).toString('utf8')
      : definition.consoleUrlEnv ? this.#environment[definition.consoleUrlEnv] : definition.url;
    return connection(raw, definition, this.#boundId);
  }
  async #fetchResponse(selected, path, { method = 'GET', body, signal, operationId, maximum, readOnly = false } = {}) {
    const headers = { accept: 'application/json', authorization: 'Bearer ' + selected.token, origin: selected.origin };
    let encoded;
    if (body !== undefined) {
      encoded = JSON.stringify(body);
      if (Buffer.byteLength(encoded) > FRED_CLIENT_MAX_REQUEST_BYTES)
        fail('FRED_CLIENT_REQUEST_TOO_LARGE', 'The complete original request exceeds the native workspace capacity.');
      headers['content-type'] = 'application/json';
    }
    const requestSignal = AbortSignal.any([this.#lifetime.signal, AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    const details = { method, path, projectId: selected.projectId, ...(operationId ? { operationId } : {}) };
    let response, bytes;
    try { response = await this.#fetch(selected.origin + path, { method, headers, ...(encoded === undefined ? {} : { body: encoded }),
      redirect: 'error', signal: requestSignal }); }
    catch { fail('FRED_CLIENT_TRANSPORT_ERROR', 'The original response was not received. Inspect the same project operation or recover the same customer intent.',
      { ...details, ambiguous: method !== 'GET' && !readOnly, responseReceived: false }); }
    try { bytes = await responseBytes(response, maximum ?? this.maxResponseBytes); }
    catch (error) {
      throw new FredWorkspaceError(error.code ?? 'FRED_CLIENT_RESPONSE_INCOMPLETE',
        error instanceof FredWorkspaceError ? error.message : 'The original response body did not complete.',
        { ...details, status: response.status, ambiguous: method !== 'GET' && !readOnly, responseReceived: true });
    }
    if (!response.ok) {
      let original; try { original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {}
      const error = original?.error ?? original;
      const code = typeof error?.code === 'string' ? error.code : 'FRED_CLIENT_HTTP_ERROR';
      const message = (typeof error?.message === 'string' ? error.message : 'The original workspace rejected the request.')
        .split(selected.token).join('[private]').slice(0, 6000);
      fail(code, message, { ...details, status: response.status, ambiguous: method !== 'GET' && !readOnly && response.status >= 500,
        responseReceived: true, inspectOriginalOperation: method !== 'GET' && !readOnly, responseBytes: bytes.length, responseSha256: fredDigest(bytes),
        ...(typeof error?.retryAt === 'string' ? { retryAt: error.retryAt } : {}) });
    }
    return { response, bytes };
  }
  async #connect(signal) {
    signal?.throwIfAborted();
    const selected = await this.#connection();
    if (this.#bound?.fingerprint === selected.fingerprint) return selected;
    if (this.#binding) { await this.#binding; signal?.throwIfAborted(); return this.#connect(signal); }
    this.#binding = (async () => {
      const result = await this.#fetchResponse(selected, '/api/launch', { signal, maximum: 65536 });
      let launch; try { launch = JSON.parse(result.bytes.toString('utf8')); } catch { fail('FRED_CLIENT_RESPONSE_INVALID', 'The original launch response was not JSON.'); }
      if (launch?.schema !== 'stellar-forge.fred-workspace-startup.v1' || launch.state !== 'LISTENING' ||
          launch.binding?.schema !== 'stellar-forge.fred-workspace-binding.v1' || launch.binding.projectId !== selected.projectId)
        fail('FRED_CLIENT_PROJECT_CHANGED', 'The selected native server does not belong to the original project.');
      const { sha256, ...core } = launch.binding;
      if (!SHA.test(sha256 ?? '') || fredDigest(Buffer.from(canonicalFredJSON(core))) !== sha256 ||
          selected.bindingSha256 !== undefined && selected.bindingSha256 !== sha256)
        fail('FRED_CLIENT_BINDING_CHANGED', 'The native launch differs from its exact original project and operator binding.');
      if (this.#closed) fail('FRED_CLIENT_CLOSED', 'The client closed during its original launch read.');
      this.#boundId = selected.projectId; this.#bound = { fingerprint: selected.fingerprint, launch };
    })();
    try { await this.#binding; } finally { this.#binding = null; }
    return selected;
  }
  async #request(path, options = {}) {
    const selected = await this.#connect(options.signal);
    return this.#fetchResponse(selected, path, options);
  }
  async #json(path, options = {}) {
    const result = await this.#request(path, options);
    try { return JSON.parse(result.bytes.toString('utf8')); }
    catch { fail('FRED_CLIENT_RESPONSE_INVALID', 'The original response was not complete JSON.',
      { ambiguous: options.method === 'POST' && !options.readOnly, ...(options.operationId ? { operationId: options.operationId } : {}) }); }
  }
  async launch(options = {}) {
    await this.#connect(options.signal);
    return JSON.parse(JSON.stringify(this.#bound.launch));
  }
  async state(options = {}) {
    const value = await this.#json('/api/state', options);
    if (value?.project?.schema !== 'stellar-forge.fred-project.v1' || value.project.id !== this.#boundId)
      fail('FRED_CLIENT_PROJECT_CHANGED', 'The selected workspace no longer exposes its original project.');
    return value;
  }
  async operation(id, options = {}) {
    operation(id); const state = await this.state(options);
    return { projectId: state.project.id, revision: state.project.revision, busy: state.busy,
      operation: state.project.operations.find(item => item.id === id) ?? null,
      pending: state.project.pending?.id === id ? state.project.pending : null, acquisition: state.project.acquisition ?? null };
  }
  async observations({ captureId, series, offset = 0 }, options) {
    const query = new URLSearchParams({ capture: digest(captureId, 'capture ID'), offset: String(integer(offset, 0, 1000000, 'observation offset')) });
    if (series !== undefined) query.set('series', text(series, 'native series ID', 120));
    const result = page(await this.#json('/api/observations?' + query, options), 'rows');
    if (result.captureId !== captureId) fail('FRED_CLIENT_CAPTURE_CHANGED', 'The response belongs to a different original capture.');
    return result;
  }
  async compare({ before, after, offset = 0 }, options) {
    const query = new URLSearchParams({ before: digest(before, 'earlier capture ID'), after: digest(after, 'later capture ID'),
      offset: String(integer(offset, 0, 1000000, 'comparison offset')) });
    return page(await this.#json('/api/compare?' + query, options), 'changes');
  }
  async previewBriefing({ captureId, briefing, offset = 0 }, options) {
    digest(captureId, 'capture ID'); object(briefing, 'Original analyst selection');
    const value = await this.#json('/api/briefing-preview', { ...options, method: 'POST', readOnly: true,
      body: { captureId, briefing, offset: integer(offset, 0, 30000, 'measure offset') } });
    return briefingPage(value, { captureId, reviewId: null });
  }
  async briefing({ reviewId, offset = 0 }, options) {
    digest(reviewId, 'saved analyst review ID');
    return briefingPage(await this.#json('/api/briefing?' + new URLSearchParams({ review: reviewId,
      offset: String(integer(offset, 0, 30000, 'measure offset')) }), options), { reviewId });
  }
  publication(publicationId, options) {
    return this.#json('/api/publication?' + new URLSearchParams({ publication: digest(publicationId, 'publication ID') }), options);
  }
  preview({ publicationId, query = '' }, options) {
    if (typeof query !== 'string' || query.length > 32768) fail('FRED_CLIENT_INPUT_INVALID', 'Use the original dataset query string.');
    return this.#json('/api/preview?' + new URLSearchParams({ publication: digest(publicationId, 'publication ID'), query }), options);
  }
  #action(action, input, options = {}, journaled = true) {
    object(input);
    if (journaled) { operation(input.id); revision(input.expectedRevision); }
    return this.#json('/api/action', { ...options, method: 'POST',
      operationId: journaled ? input.id : input.intentId, body: { ...input, action } });
  }
  configure(input, options) { object(input?.selection, 'Original FRED selection'); return this.#action('configure', input, options); }
  capture(input, options) { return this.#action('capture', input, options); }
  importCapture(input, options) { object(input?.capture, 'Complete original source'); return this.#action('import', input, options); }
  combine(input, options) {
    if (!Array.isArray(input?.captureIds) || input.captureIds.length < 1 || input.captureIds.length > 50 ||
        new Set(input.captureIds).size !== input.captureIds.length) fail('FRED_CLIENT_INPUT_INVALID', 'Choose the distinct retained public-table capture IDs.');
    input.captureIds.forEach(value => digest(value, 'capture ID')); return this.#action('combine', input, options);
  }
  select(input, options) { digest(input?.captureId, 'capture ID'); return this.#action('select', input, options); }
  review(input, options) { digest(input?.captureId, 'capture ID'); return this.#action('review', input, options); }
  publish(input, options) { digest(input?.reviewId, 'saved review ID'); object(input?.payment, 'Original payment terms'); return this.#action('publish', input, options); }
  abandon(input, options) { operation(input?.pendingId); return this.#action('abandon', input, options); }
  startMerchant({ publicationId }, options) { return this.#action('merchant-start', { publicationId: digest(publicationId, 'publication ID') }, options, false); }
  stopMerchant({ publicationId }, options) { return this.#action('merchant-stop', { publicationId: digest(publicationId, 'original running publication ID') }, options, false); }
  prepare(input, options) {
    object(input); digest(input.publicationId, 'publication ID'); operation(input.intentId);
    if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 32768))
      fail('FRED_CLIENT_INPUT_INVALID', 'Use the original dataset query string.');
    return this.#action('prepare', input, options, false);
  }
  buy({ publicationId, intentId }, options) {
    return this.#action('buy', { publicationId: digest(publicationId, 'publication ID'), intentId: operation(intentId) }, options, false);
  }
  recover({ publicationId, intentId }, options) {
    return this.#action('recover', { publicationId: digest(publicationId, 'publication ID'), intentId: operation(intentId) }, options, false);
  }
  async wait(id, { signal, timeoutMs = 60000, intervalMs = 1000 } = {}) {
    operation(id); integer(timeoutMs, 1, 30 * 60 * 1000, 'observation timeout'); integer(intervalMs, 100, 30000, 'read interval');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const current = await this.operation(id, { signal });
      if (current.operation || !current.pending) return current;
      if (Date.now() >= deadline) return { ...current, observationTimedOut: true };
      await new Promise((done, reject) => {
        const joined = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : [])]);
        const timer = setTimeout(finish, Math.min(intervalMs, deadline - Date.now()));
        function finish() { joined.removeEventListener('abort', stopped); done(); }
        function stopped() { clearTimeout(timer); joined.removeEventListener('abort', stopped); reject(joined.reason); }
        joined.addEventListener('abort', stopped, { once: true }); if (joined.aborted) stopped();
      });
    }
  }
  async file(selection, options = {}) {
    object(selection, 'Original file selection');
    let path, fallback, expectedMember = null;
    if (selection.kind === 'source') {
      path = '/api/source?' + new URLSearchParams({ capture: digest(selection.captureId, 'capture ID') }); fallback = 'fred-original-capture.json';
    } else if (selection.kind === 'comparison') {
      path = '/api/compare?' + new URLSearchParams({ before: digest(selection.before, 'earlier capture ID'), after: digest(selection.after, 'later capture ID'), download: '1' });
      fallback = 'fred-vintage-comparison.json';
    } else if (selection.kind === 'project') { path = '/api/bundle'; fallback = 'fred-economic-project.json'; }
    else if (selection.kind === 'customer') {
      path = '/api/customer-download?' + new URLSearchParams({ publication: digest(selection.publicationId, 'publication ID'), intent: operation(selection.intentId) });
      fallback = 'fred-customer-response.bin';
    } else if (selection.kind === 'briefing') {
      const memberNames = { html: 'briefing.html', csv: 'briefing-measures.csv', json: 'briefing.json', manifest: 'briefing-manifest.json' };
      fallback = memberNames[selection.format];
      if (!fallback) fail('FRED_CLIENT_INPUT_INVALID', 'Choose the original HTML, CSV, JSON or manifest briefing file.');
      const saved = await this.briefing({ reviewId: selection.reviewId }, options);
      expectedMember = saved.files?.find(file => file.path === fallback);
      if (!expectedMember || !SHA.test(expectedMember.sha256) || !Number.isSafeInteger(expectedMember.bytes) || expectedMember.bytes < 1)
        fail('FRED_CLIENT_BRIEFING_CHANGED', 'The original saved briefing file descriptor is missing.');
      path = '/api/briefing?' + new URLSearchParams({ review: selection.reviewId, format: selection.format });
    } else fail('FRED_CLIENT_INPUT_INVALID', 'Choose an original source, comparison, briefing, project or customer file.');
    const { response, bytes } = await this.#request(path, options);
    const sha256 = fredDigest(bytes);
    if (expectedMember && (sha256 !== expectedMember.sha256 || bytes.length !== expectedMember.bytes))
      fail('FRED_CLIENT_BRIEFING_CHANGED', 'The complete original briefing differs from its saved source review.', { sha256, bytes: bytes.length });
    if (options.expectedSha256 !== undefined && digest(options.expectedSha256) !== sha256)
      fail('FRED_CLIENT_FILE_CHANGED', 'The complete original download differs from its reviewed SHA256.', { sha256, bytes: bytes.length });
    const proposed = (response.headers.get('content-disposition') ?? '').match(/filename="([^"]*)"/)?.[1] ?? fallback;
    const name = basename(proposed).replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0, 180) || fallback;
    const result = { name, type: response.headers.get('content-type') ?? 'application/octet-stream', bytes, sha256,
      status: response.status, projectId: this.#boundId };
    if (selection.kind === 'project') {
      let bundle;
      try { bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('FRED_CLIENT_BUNDLE_INVALID', 'The complete project export is not JSON.'); }
      result.bundle = inspectFredProjectBundle(bundle);
      if (result.bundle.projectId !== this.#boundId) fail('FRED_CLIENT_PROJECT_CHANGED', 'The export belongs to another original project.');
    }
    return result;
  }
  close() { this.#closed = true; this.#bound = null; this.#lifetime.abort(new Error('FRED workspace client closed')); }
}

function briefingPage(value, binding) {
  if (value?.schema !== 'stellar-forge.fred-briefing-model.v1' || !Array.isArray(value.measures) || !Array.isArray(value.series) ||
      !Number.isSafeInteger(value.measureCount) || value.measureCount < 0 || value.measureCount > 30000 ||
      !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > value.measureCount ||
      value.limit !== 100 || value.measures.length !== Math.min(100, value.measureCount - value.offset) ||
      value.nextOffset !== (value.offset + 100 < value.measureCount ? value.offset + 100 : null) ||
      Object.entries(binding).some(([key, expected]) => value[key] !== expected))
    fail('FRED_CLIENT_BRIEFING_CHANGED', 'The original analyst page or its source/review binding changed.');
  if (binding.reviewId !== null && (!value.manifest || value.manifest.reviewId !== binding.reviewId ||
      value.manifest.captureId !== value.captureId || value.manifest.reportId !== value.reportId ||
      !Array.isArray(value.files) || value.files.length !== 4))
    fail('FRED_CLIENT_BRIEFING_CHANGED', 'The saved analyst page lost its complete original file inventory.');
  return value;
}
export function inspectFredProjectBundle(bundle) {
  const briefing = bundle?.schema === 'stellar-forge.fred-project-bundle.v2';
  if ((!briefing && bundle?.schema !== 'stellar-forge.fred-project-bundle.v1') || !plain(bundle.state) ||
      !Array.isArray(bundle.captures) || !Array.isArray(bundle.publicationPlans) || !SHA.test(bundle.bundleSha256 ?? '') ||
      (briefing ? !Array.isArray(bundle.briefings) || bundle.briefings.length < 1 : bundle.briefings !== undefined))
    fail('FRED_CLIENT_BUNDLE_INVALID', 'Use the complete original versioned FRED project bundle.');
  const identity = { schema: bundle.schema, state: bundle.state, captures: bundle.captures, publicationPlans: bundle.publicationPlans,
    ...(briefing ? { briefings: bundle.briefings } : {}) };
  if (fredDigest(Buffer.from(canonicalFredJSON(identity))) !== bundle.bundleSha256 ||
      bundle.state.schema !== 'stellar-forge.fred-project.v1' || !UUID.test(bundle.state.id ?? '') || bundle.state.pending ||
      !Array.isArray(bundle.state.reviews))
    fail('FRED_CLIENT_BUNDLE_INVALID', 'The original completed project bundle identity changed.');
  const analystReviews = bundle.state.reviews.filter(review => review.briefing);
  if ((bundle.briefings ?? []).length !== analystReviews.length ||
      new Set((bundle.briefings ?? []).map(item => item.manifest?.reviewId)).size !== analystReviews.length ||
      (bundle.briefings ?? []).some(item => !analystReviews.some(review => review.id === item.manifest?.reviewId)))
    fail('FRED_CLIENT_BUNDLE_INVALID', 'The complete project export lost an original analyst briefing.');
  return { schema: bundle.schema, projectId: bundle.state.id, revision: bundle.state.revision,
    bundleSha256: bundle.bundleSha256, captures: bundle.captures.length, publications: bundle.publicationPlans.length,
    ...(briefing ? { briefings: bundle.briefings.length } : {}) };
}

/** Publishes the complete original bytes without replacing an existing file. */
export async function saveFredFile(client, selection, destination, options = {}) {
  const result = await client.file(selection, options);
  destination = resolve(text(destination, 'download destination', 8192));
  const temporary = join(dirname(destination), '.' + basename(destination) + '.fred-' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(result.bytes); await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFredHostFile(destination, FRED_CLIENT_MAX_BYTES, { expectedSha256: result.sha256 });
      if (existing.length !== result.bytes.length) fail('FRED_CLIENT_FILE_CHANGED', 'The existing download has a different original byte count.');
      return { path: destination, name: result.name, type: result.type, bytes: result.bytes.length, sha256: result.sha256,
        projectId: result.projectId, reused: true, ...(result.bundle ? { bundle: result.bundle } : {}) };
    }
    return { path: destination, name: result.name, type: result.type, bytes: result.bytes.length, sha256: result.sha256,
      projectId: result.projectId, reused: false, ...(result.bundle ? { bundle: result.bundle } : {}) };
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Reopens a retained source bundle through the maintained local project receiver. */
export async function receiveFredWorkspaceFile(source, directory, { expectedSha256 } = {}) {
  const bytes = await readFredHostFile(source, FRED_CLIENT_MAX_BYTES, { expectedSha256 });
  let bundle;
  try { bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('FRED_CLIENT_BUNDLE_INVALID', 'The original project file is not complete JSON.'); }
  const identity = inspectFredProjectBundle(bundle);
  const { receiveFredProject } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/project.mjs');
  const result = await receiveFredProject({ directory: resolve(directory), bundle });
  return { ...identity, sourceBytes: bytes.length, sourceSha256: fredDigest(bytes), received: result };
}
