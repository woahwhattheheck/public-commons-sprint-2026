// MIT. Huwise / Opendatasoft Automation v1.0; all actions use the pinned native contract.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalogOrigin, parseOpendatasoftJson, ExactOpendatasoftNumber } from '../capture.mjs';
import { AUTOMATION_SOURCE, AUTOMATION_API_PREFIX, AUTOMATION_OPERATIONS,
  AUTOMATION_SCHEMAS, AUTOMATION_DATASET_STATES, automationOperation } from './contract.mjs';

export { AUTOMATION_SOURCE, AUTOMATION_OPERATIONS } from './contract.mjs';
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const emptySha = sha(Buffer.alloc(0));
const controls = /[\u0000-\u001f\u007f]/;
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

export class OpendatasoftAutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OpendatasoftAutomationError';
    this.code = code;
    this.outcome = details.outcome ?? 'NOT_SENT';
    Object.assign(this, details);
  }
  toJSON() {
    return { code: this.code, message: this.message, outcome: this.outcome,
      ...(this.category ? { category: this.category } : {}),
      ...(this.request ? { request: this.request } : {}),
      ...(this.receipt ? { receipt: this.receipt } : {}),
      ...(this.providerCode ? { providerCode: this.providerCode } : {}),
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}) };
  }
}
function fail(code, message, details) { throw new OpendatasoftAutomationError(code, message, details); }
function own(value, names, code = 'ODS_AUTOMATION_INPUT_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key)))
    fail(code, 'Use the named inputs in the native Automation contract.');
  return value;
}
function exactInteger(value) {
  if (!(value instanceof ExactOpendatasoftNumber)) return Number.isSafeInteger(value);
  const match = /^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.source);
  if (!match) return false;
  const fraction = match[2] ?? '', digits = match[1] + fraction;
  if (!/[1-9]/.test(digits)) return true;
  const trailing = /0*$/.exec(digits)[0].length;
  return BigInt(match[3] ?? '0') - BigInt(fraction.length) + BigInt(trailing) >= 0n;
}
function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail(code, 'Use an integer within the configured range.');
  return value;
}
function text(value, max, code) {
  if (typeof value !== 'string' || !value.length || value.length > max || controls.test(value))
    fail(code, 'Use a nonempty value without control characters.');
  return value;
}
function identifier(value) {
  text(value, 2048, 'ODS_AUTOMATION_IDENTIFIER_INVALID');
  if (value === '.' || value === '..' || /[\/\\?#]/.test(value))
    fail('ODS_AUTOMATION_IDENTIFIER_INVALID', 'Use the exact native identifier as one URL path segment.');
  return value;
}
function aborted(signal) {
  if (signal?.aborted) fail('ODS_AUTOMATION_CANCELLED', 'The local request was cancelled before dispatch.');
}
export function normalizeOpendatasoftAutomationConnection(input) {
  own(input, ['origin','authTokenEnv','timeoutMs','maxResponseBytes','maxRequestBytes','maxUploadBytes']);
  if (typeof input.authTokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.authTokenEnv))
    fail('ODS_AUTOMATION_TOKEN_REFERENCE_INVALID', 'Configure the private API-key environment reference on the host.');
  return freeze({
    origin: catalogOrigin(input.origin), authTokenEnv: input.authTokenEnv,
    timeoutMs: integer(input.timeoutMs ?? 60000, 100, 3600000, 'ODS_AUTOMATION_TIMEOUT_INVALID'),
    maxResponseBytes: integer(input.maxResponseBytes ?? 67108864, 1024, 2147483647, 'ODS_AUTOMATION_RESPONSE_LIMIT_INVALID'),
    maxRequestBytes: integer(input.maxRequestBytes ?? 16777216, 1024, 268435456, 'ODS_AUTOMATION_REQUEST_LIMIT_INVALID'),
    maxUploadBytes: integer(input.maxUploadBytes ?? 1073741824, 0, Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_UPLOAD_LIMIT_INVALID')
  });
}
function resolveSchema(schema) {
  if (!schema?.$ref) return schema ?? {};
  const name = schema.$ref.split('/').at(-1), base = AUTOMATION_SCHEMAS[name];
  if (!base) fail('ODS_AUTOMATION_SCHEMA_REFERENCE', 'The retained native schema reference is unavailable.');
  return { ...base, ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) };
}
// Structural native-body validation leaves optional, provider-specific and future fields intact.
// The original OpenAPI remains the complete reference; this is not a schema rewrite.
function checkBody(value, schema, at = 'body', refs = new Set(), depth = 0) {
  if (depth > 96) fail('ODS_AUTOMATION_BODY_DEPTH', 'The request structure is too deeply nested.');
  if (schema?.$ref) {
    if (refs.has(schema.$ref)) return;
    refs = new Set(refs); refs.add(schema.$ref);
  }
  schema = resolveSchema(schema);
  if (schema === true) return;
  if (schema === false) fail('ODS_AUTOMATION_BODY_INVALID', 'The native schema excludes ' + at + '.');
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) {
    let matched = false;
    for (const variant of variants) {
      try { checkBody(value, variant, at, new Set(refs), depth + 1); matched = true; break; }
      catch (error) { if (!(error instanceof OpendatasoftAutomationError)) throw error; }
    }
    if (!matched) fail('ODS_AUTOMATION_BODY_INVALID', 'The native union does not accept ' + at + '.');
  }
  for (const part of schema.allOf ?? []) checkBody(value, part, at, new Set(refs), depth + 1);
  let types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types) {
    types = types.map(type => type === null ? 'null' : type);
    const numeric = typeof value === 'number' || value instanceof ExactOpendatasoftNumber;
    const matches = types.some(type => type === 'null' ? value === null :
      type === 'object' ? object(value) && !(value instanceof ExactOpendatasoftNumber) :
      type === 'array' ? Array.isArray(value) : type === 'number' ? numeric :
      type === 'integer' ? exactInteger(value) : typeof value === type);
    if (!matches) fail('ODS_AUTOMATION_BODY_INVALID', 'The native type does not match ' + at + '.');
  }
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value)))
    fail('ODS_AUTOMATION_BODY_INVALID', 'The native enum does not accept ' + at + '.');
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Number.MAX_SAFE_INTEGER)))
    fail('ODS_AUTOMATION_BODY_INVALID', 'The native string length does not match ' + at + '.');
  if (typeof value === 'number' && (!Number.isFinite(value) ||
      value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)))
    fail('ODS_AUTOMATION_BODY_INVALID', 'The native numeric range does not match ' + at + '.');
  if (Array.isArray(value) && schema.items)
    for (let i = 0; i < value.length; i++) checkBody(value[i], schema.items, at + '[' + i + ']', new Set(), depth + 1);
  if (object(value) && !(value instanceof ExactOpendatasoftNumber)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!properties[key]?.readOnly && !Object.hasOwn(value, key))
        fail('ODS_AUTOMATION_BODY_REQUIRED', 'The native request requires ' + at + '.' + key + '.');
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        if (!properties[key].readOnly) checkBody(child, properties[key], at + '.' + key, new Set(), depth + 1);
      } else if (schema.additionalProperties === false) {
        fail('ODS_AUTOMATION_BODY_INVALID', 'The native request does not accept ' + at + '.' + key + '.');
      } else if (object(schema.additionalProperties)) {
        checkBody(child, schema.additionalProperties, at + '.' + key, new Set(), depth + 1);
      }
    }
    const discriminator = schema.discriminator;
    const discriminatorValue = discriminator ? value[discriminator.propertyName] : undefined;
    const mapped = discriminator?.mapping && Object.hasOwn(discriminator.mapping, discriminatorValue) ? discriminator.mapping[discriminatorValue] : null;
    if (mapped && !refs.has(mapped)) checkBody(value, { $ref: mapped }, at, new Set(refs), depth + 1);
  }
}
export function validateOpendatasoftAutomationBody(operationId, body) {
  const op = automationOperation(operationId);
  if (op.body !== 'json') fail('ODS_AUTOMATION_JSON_BODY_UNSUPPORTED', 'This native operation does not accept a JSON body.');
  if (!object(body)) fail('ODS_AUTOMATION_BODY_INVALID', 'Use a complete native JSON object.');
  checkBody(body, op.bodySchema);
  return body;
}
function jsonBody(operationId, body) {
  let raw;
  if (body instanceof Uint8Array) {
    raw = Buffer.from(body);
    body = parseOpendatasoftJson(raw);
  } else {
    validateOpendatasoftAutomationBody(operationId, body);
    try {
      raw = Buffer.from(JSON.stringify(body, (_key, value) => {
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol' ||
            typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value))
          fail('ODS_AUTOMATION_BODY_INVALID', 'The reviewed body must contain exact JSON values.');
        return value;
      }), 'utf8');
    } catch (error) {
      if (error instanceof OpendatasoftAutomationError) throw error;
      fail('ODS_AUTOMATION_BODY_INVALID', 'The reviewed body must serialize as complete native JSON.');
    }
  }
  validateOpendatasoftAutomationBody(operationId, body);
  return raw;
}
function queryValue(key, value, schema) {
  if (schema.type === 'number' || schema.type === 'integer') {
    integer(value, schema.minimum ?? 0, schema.maximum ?? Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_QUERY_INVALID');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('ODS_AUTOMATION_QUERY_INVALID', 'Use a boolean for ' + key + '.');
  } else {
    text(value, 16384, 'ODS_AUTOMATION_QUERY_INVALID');
    const comparison = key === 'sort' && value.startsWith('-') ? value.slice(1) : value;
    if (schema.enum && !schema.enum.includes(comparison)) fail('ODS_AUTOMATION_QUERY_INVALID', 'Use a documented value for ' + key + '.');
  }
  return String(value);
}
export function opendatasoftAutomationUrl(origin, operationId, { params = {}, query = {} } = {}) {
  const op = automationOperation(operationId);
  own(params, Object.keys(op.params)); own(query, Object.keys(op.query));
  let path = op.path;
  for (const key of Object.keys(op.params))
    path = path.replace('{' + key + '}', encodeURIComponent(identifier(params[key])));
  const url = new URL(AUTOMATION_API_PREFIX + path, catalogOrigin(origin));
  for (const key of Object.keys(query).sort()) {
    if (query[key] !== undefined) url.searchParams.set(key, queryValue(key, query[key], op.query[key]));
  }
  return url;
}
function retryAfter(headers) {
  const value = headers['retry-after'];
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1000));
  const absolute = Date.parse(value);
  return Number.isFinite(absolute) ? Math.max(0, absolute - Date.now()) : null;
}
function outcomeFor(op, status) {
  if (op.effect === 'read') return status >= 300 && status < 400 ? 'REDIRECTED' : status >= 200 && status < 300 ? 'OBSERVED' : 'READ_FAILED';
  if (status >= 200 && status < 300) return 'ACKNOWLEDGED';
  if (status >= 500 || status === 408 || status >= 300 && status < 400) return 'UNCERTAIN';
  return 'REJECTED';
}
function categoryFor(status) {
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 429) return 'rate';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'validation';
  return status >= 500 ? 'provider' : 'http';
}

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
}
async function readFileChunks(handle, length, consume, signal) {
  let position = 0;
  while (position < length) {
    aborted(signal);
    const buffer = Buffer.allocUnsafe(Math.min(65536, length - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) fail('ODS_AUTOMATION_UPLOAD_CHANGED', 'The retained upload ended before its reviewed length.');
    position += bytesRead;
    await consume(buffer.subarray(0, bytesRead));
  }
}
async function prepareMultipart(upload, op, config, signal) {
  own(upload, ['file','filename','mimetype','expectedSha256','expectedBytes','fields']);
  const fields = upload.fields ?? {};
  own(fields, Object.keys(op.bodySchema?.properties ?? {}).filter(key => key !== 'file'));
  checkBody({ ...fields, file: '' }, op.bodySchema);
  const filename = text(upload.filename ?? (typeof upload.file === 'string' ? basename(upload.file) : ''),
    4096, 'ODS_AUTOMATION_UPLOAD_FILENAME_REQUIRED');
  if (/[\/\\"]/.test(filename)) fail('ODS_AUTOMATION_UPLOAD_FILENAME_INVALID', 'Use a plain file name without path separators or quotes.');
  const mimetype = upload.mimetype ?? 'application/octet-stream';
  if (typeof mimetype !== 'string' || mimetype.length > 256 ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[^\r\n\u0000]*)?$/.test(mimetype))
    fail('ODS_AUTOMATION_UPLOAD_MIMETYPE_INVALID', 'Use an explicit MIME type for the reviewed file.');
  if (upload.expectedSha256 !== undefined && !HASH.test(upload.expectedSha256))
    fail('ODS_AUTOMATION_UPLOAD_HASH_INVALID', 'Use the retained SHA256 of the complete upload.');
  if (upload.expectedBytes !== undefined)
    integer(upload.expectedBytes, 0, config.maxUploadBytes, 'ODS_AUTOMATION_UPLOAD_SIZE_INVALID');
  const boundary = 'ods-' + randomBytes(24).toString('hex');
  const fieldParts = [];
  for (const key of Object.keys(fields).sort()) {
    if (typeof fields[key] !== 'string') fail('ODS_AUTOMATION_MULTIPART_FIELD_INVALID', 'Native multipart fields are strings.');
    fieldParts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + fields[key] + '\r\n');
  }
  const prefix = Buffer.from(fieldParts.join('') + '--' + boundary +
    '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + mimetype + '\r\n\r\n', 'utf8');
  const suffix = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  let handle, buffer, length, originalIdentity;
  try {
    if (typeof upload.file === 'string') {
      if (!isAbsolute(upload.file)) fail('ODS_AUTOMATION_UPLOAD_PATH_INVALID', 'Use the absolute path of the retained source file.');
      const before = await lstat(upload.file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink())
        fail('ODS_AUTOMATION_UPLOAD_FILE_INVALID', 'The upload must be a regular retained file.');
      handle = await open(upload.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const held = await handle.stat({ bigint: true });
      if (!held.isFile() || fileIdentity(before) !== fileIdentity(held))
        fail('ODS_AUTOMATION_UPLOAD_CHANGED', 'The upload changed while its descriptor was opened.');
      length = Number(held.size);
      integer(length, 0, config.maxUploadBytes, 'ODS_AUTOMATION_UPLOAD_SIZE_INVALID');
      originalIdentity = fileIdentity(held);
    } else if (upload.file instanceof Uint8Array) {
      length = upload.file.byteLength;
      integer(length, 0, config.maxUploadBytes, 'ODS_AUTOMATION_UPLOAD_SIZE_INVALID');
      buffer = Buffer.from(upload.file);
    } else fail('ODS_AUTOMATION_UPLOAD_FILE_REQUIRED', 'Supply an immutable local file path or Uint8Array.');
    const fileHash = createHash('sha256'), wireHash = createHash('sha256').update(prefix);
    const consume = chunk => { fileHash.update(chunk); wireHash.update(chunk); };
    if (handle) await readFileChunks(handle, length, consume, signal);
    else { aborted(signal); consume(buffer); }
    if (handle && fileIdentity(await handle.stat({ bigint: true })) !== originalIdentity)
      fail('ODS_AUTOMATION_UPLOAD_CHANGED', 'The retained file changed during request preparation.');
    const fileSha256 = fileHash.digest('hex');
    if (upload.expectedSha256 !== undefined && upload.expectedSha256 !== fileSha256 ||
        upload.expectedBytes !== undefined && upload.expectedBytes !== length)
      fail('ODS_AUTOMATION_UPLOAD_BINDING_MISMATCH', 'The complete upload differs from the reviewed hash or length.');
    const bodySha256 = wireHash.update(suffix).digest('hex'), bodyBytes = prefix.length + length + suffix.length;
    integer(bodyBytes, 0, Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_UPLOAD_SIZE_INVALID');
    let used = false, settle;
    const completion = new Promise(resolve => { settle = resolve; });
    const body = {
      async *[Symbol.asyncIterator]() {
        if (used) fail('ODS_AUTOMATION_UPLOAD_REPLAY', 'An upload body is dispatched only once.');
        used = true;
        let complete = false, error = null, sent = 0;
        const actual = createHash('sha256');
        try {
          aborted(signal);
          yield prefix;
          if (handle) {
            let position = 0;
            while (position < length) {
              aborted(signal);
              const chunk = Buffer.allocUnsafe(Math.min(65536, length - position));
              const read = await handle.read(chunk, 0, chunk.length, position);
              if (!read.bytesRead) fail('ODS_AUTOMATION_UPLOAD_CHANGED', 'The retained upload changed during dispatch.');
              const value = chunk.subarray(0, read.bytesRead);
              position += read.bytesRead; sent += read.bytesRead; actual.update(value);
              yield value;
            }
          } else {
            actual.update(buffer); sent = length;
            yield buffer;
          }
          if (actual.digest('hex') !== fileSha256 || sent !== length ||
              handle && fileIdentity(await handle.stat({ bigint: true })) !== originalIdentity)
            fail('ODS_AUTOMATION_UPLOAD_CHANGED', 'The dispatched source bytes differ from the reviewed upload.');
          aborted(signal);
          yield suffix;
          complete = true;
        } catch (caught) { error = caught; throw caught; }
        finally { settle({ complete, error, sent }); }
      }
    };
    return { body, completion, contentType: 'multipart/form-data; boundary=' + boundary,
      bodyBytes, bodySha256, upload: { filename, mimetype, bytes: length, sha256: fileSha256 },
      close: async () => { await handle?.close(); } };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof OpendatasoftAutomationError) throw error;
    fail('ODS_AUTOMATION_UPLOAD_UNAVAILABLE', 'The retained source file could not be read.');
  }
}
async function completionOrAbort(promise, signal) {
  if (signal.aborted) return { complete: false, error: signal.reason };
  let listener;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      listener = () => resolve({ complete: false, error: signal.reason });
      signal.addEventListener('abort', listener, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', listener); }
}
function validateDownload(download) {
  own(download, ['destination','expectedSha256','expectedBytes']);
  if (typeof download.destination !== 'string' || !isAbsolute(download.destination) || controls.test(download.destination))
    fail('ODS_AUTOMATION_DOWNLOAD_PATH_INVALID', 'Use a new absolute retained download path.');
  if (download.expectedSha256 !== undefined && !HASH.test(download.expectedSha256))
    fail('ODS_AUTOMATION_DOWNLOAD_HASH_INVALID', 'Use an exact expected SHA256.');
  if (download.expectedBytes !== undefined)
    integer(download.expectedBytes, 0, Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_DOWNLOAD_SIZE_INVALID');
  return download;
}
async function receiveBody(response, maximum, download) {
  const chunks = [], hasher = createHash('sha256');
  let count = 0, handle, outputOwned = false, complete = false;
  const headers = Object.fromEntries(response.headers.entries());
  const knownLength = /^\d+$/.test(headers['content-length'] ?? '') ? Number(headers['content-length']) : null;
  try {
    if (knownLength !== null && knownLength > maximum) {
      await response.body?.cancel();
      fail('ODS_AUTOMATION_RESPONSE_TOO_LARGE', 'The original response exceeds the configured receiving limit.');
    }
    if (download) {
      handle = await open(download.destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      outputOwned = true;
    }
    if (response.body) for await (const chunk of response.body) {
      const value = Buffer.from(chunk);
      if (count + value.length > maximum)
        fail('ODS_AUTOMATION_RESPONSE_TOO_LARGE', 'The original response exceeds the configured receiving limit.');
      if (handle) {
        let written = 0;
        while (written < value.length) {
          const next = await handle.write(value, written, value.length - written, count);
          if (!next.bytesWritten) fail('ODS_AUTOMATION_DOWNLOAD_INTERRUPTED', 'The retained download could not be written completely.');
          hasher.update(value.subarray(written, written + next.bytesWritten));
          count += next.bytesWritten; written += next.bytesWritten;
        }
      } else { chunks.push(value); hasher.update(value); count += value.length; }
    }
    if (knownLength !== null && (!headers['content-encoding'] || headers['content-encoding'] === 'identity') &&
        knownLength !== count)
      fail('ODS_AUTOMATION_RESPONSE_INTERRUPTED', 'The received response length differs from the provider header.');
    if (handle) await handle.sync();
    complete = true;
  } catch (error) {
    const body = { raw: outputOwned ? null : Buffer.concat(chunks),
      ...(outputOwned ? { file: { path: download.destination, bytes: count, complete: false } } : {}),
      bytes: count, sha256: hasher.digest('hex'), complete: false };
    if (outputOwned) body.file.sha256 = body.sha256;
    throw Object.assign(error, { partialBody: body });
  } finally { await handle?.close().catch(() => {}); }
  const digest = hasher.digest('hex');
  const body = { raw: download ? null : Buffer.concat(chunks), bytes: count, sha256: digest, complete,
    ...(download ? { file: { path: download.destination, bytes: count, sha256: digest, complete } } : {}) };
  if (download && (download.expectedSha256 !== undefined && download.expectedSha256 !== digest ||
      download.expectedBytes !== undefined && download.expectedBytes !== count)) {
    fail('ODS_AUTOMATION_DOWNLOAD_BINDING_MISMATCH', 'The complete provider file differs from the expected source bytes.',
      { partialBody: { ...body, complete: true } });
  }
  return body;
}

/** Every provider operation has one dispatch; local retry/recovery belongs to the retained workspace. */
export function createOpendatasoftAutomationClient(input) {
  own(input, ['origin','authTokenEnv','env','fetch','timeoutMs','maxResponseBytes','maxRequestBytes','maxUploadBytes']);
  const { env = process.env, fetch: fetchImpl = globalThis.fetch, ...configured } = input;
  const config = normalizeOpendatasoftAutomationConnection(configured);
  if (!object(env) || typeof fetchImpl !== 'function') fail('ODS_AUTOMATION_TRANSPORT_INVALID', 'Use the host environment and a native fetch implementation.');
  const active = new Set(), pendingWaits = new Set(), lifecycle = new AbortController();
  let closed = false;
  async function perform(operationId, parameters = {}, options = {}, continuationUrl = null) {
    if (closed) fail('ODS_AUTOMATION_CLOSED', 'This Automation client has been closed.');
    const op = automationOperation(operationId);
    own(parameters, ['params','query','body','upload','download']);
    own(options, ['signal','onRequest','onResponse']);
    for (const key of ['onRequest','onResponse'])
      if (options[key] !== undefined && typeof options[key] !== 'function')
        fail('ODS_AUTOMATION_CALLBACK_INVALID', 'Receiving callbacks must be host functions.');
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      fail('ODS_AUTOMATION_SIGNAL_INVALID', 'Use an AbortSignal for cancellation.');
    const ordinaryUrl = opendatasoftAutomationUrl(config.origin, operationId, parameters);
    const url = continuationUrl ?? ordinaryUrl;
    if (op.body === 'json' && parameters.upload !== undefined ||
        op.body === 'multipart' && parameters.body !== undefined ||
        op.body === null && (parameters.body !== undefined || parameters.upload !== undefined))
      fail('ODS_AUTOMATION_BODY_INVALID', 'The body does not match the native operation content type.');
    if (parameters.download !== undefined && op.response !== 'binary')
      fail('ODS_AUTOMATION_DOWNLOAD_UNSUPPORTED', 'Only a native file download can stream into a local file.');
    const download = parameters.download === undefined ? null : validateDownload(parameters.download);
    const controller = new AbortController(), timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = AbortSignal.any([controller.signal, lifecycle.signal, timeout, ...(options.signal ? [options.signal] : [])]);
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const entry = { controller, done }; active.add(entry);
    let upload, request, response, reply, dispatched = false, reported = false;
    const report = async () => {
      if (reported || !reply) return;
      reported = true;
      try { await options.onResponse?.(reply); }
      catch {
        fail('ODS_AUTOMATION_RESPONSE_SAVE_FAILED', 'The native response arrived but the host receiving callback failed.',
          { outcome: reply.receipt.outcome, request, receipt: reply.receipt, response: reply, category: 'receiving' });
      }
    };
    try {
      aborted(signal);
      let body, contentType = null, bodyBytes = 0, bodySha256 = emptySha;
      if (op.body === 'json') {
        if (parameters.body instanceof Uint8Array && parameters.body.byteLength > config.maxRequestBytes)
          fail('ODS_AUTOMATION_REQUEST_TOO_LARGE', 'The reviewed JSON body exceeds the configured request limit.');
        body = jsonBody(operationId, parameters.body);
        if (body.length > config.maxRequestBytes)
          fail('ODS_AUTOMATION_REQUEST_TOO_LARGE', 'The reviewed JSON body exceeds the configured request limit.');
        contentType = 'application/json'; bodyBytes = body.length; bodySha256 = sha(body);
      } else if (op.body === 'multipart') {
        upload = await prepareMultipart(parameters.upload, op, config, signal);
        ({ body, contentType, bodyBytes, bodySha256 } = upload);
      }
      aborted(signal);
      const token = env[config.authTokenEnv];
      if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
        fail('ODS_AUTOMATION_TOKEN_UNAVAILABLE', 'The host API-key environment reference has no usable value.');
      const binding = { operationId, method: op.method, url: url.href, contentType, bodyBytes, bodySha256,
        ...(upload ? { upload: upload.upload } : {}) };
      request = freeze({ schema: 'stellar-forge.opendatasoft-automation-request.v1',
        ...binding, sha256: sha(Buffer.from(JSON.stringify(binding))), preparedAt: timestamp() });
      try { await options.onRequest?.(request); }
      catch {
        fail('ODS_AUTOMATION_REQUEST_SAVE_FAILED', 'The host must retain the original request before dispatch.',
          { request, category: 'receiving' });
      }
      aborted(signal);
      const headers = { accept: op.response === 'binary' ? '*/*' : 'application/json',
        authorization: 'apikey ' + token };
      if (contentType) headers['content-type'] = contentType;
      if (body !== undefined) headers['content-length'] = String(bodyBytes);
      const sentAt = timestamp();
      dispatched = true;
      try {
        response = await fetchImpl(url, { method: op.method, headers, body, signal, redirect: 'manual',
          ...(upload ? { duplex: 'half' } : {}) });
      } catch {
        fail(timeout.aborted ? 'ODS_AUTOMATION_TIMEOUT' : signal.aborted ? 'ODS_AUTOMATION_CANCELLED' :
          'ODS_AUTOMATION_TRANSPORT_INTERRUPTED', 'The original Automation request did not return a complete response.',
          { request, outcome: op.effect === 'read' ? 'READ_FAILED' : 'UNCERTAIN', category: 'transport' });
      }
      const nativeHeaders = Object.fromEntries(response.headers.entries()), receivedAt = timestamp();
      const baseReceipt = { schema: 'stellar-forge.opendatasoft-automation-receipt.v1', operationId,
        method: op.method, url: url.href, request, sentAt, receivedAt, status: response.status,
        headers: nativeHeaders, effect: op.effect, outcome: outcomeFor(op, response.status),
        bodyRepresentation: 'fetch-response-body' };
      let received;
      try {
        received = await receiveBody(response,
          download && response.status >= 200 && response.status < 300 ? config.maxUploadBytes : config.maxResponseBytes,
          download && response.status >= 200 && response.status < 300 ? download : null);
      } catch (error) {
        const partial = error.partialBody ?? { raw: Buffer.alloc(0), bytes: 0, sha256: emptySha, complete: false };
        const failedOutcome = op.effect === 'read' ? 'READ_FAILED' :
          baseReceipt.outcome === 'REJECTED' ? 'REJECTED' : 'UNCERTAIN';
        reply = { raw: partial.raw, value: null, ...(partial.file ? { file: partial.file } : {}),
          receipt: { ...baseReceipt, completedAt: timestamp(), bytes: partial.bytes, sha256: partial.sha256,
            complete: partial.complete, outcome: failedOutcome } };
        await report();
        fail(error.code?.startsWith('ODS_AUTOMATION_') ? error.code : 'ODS_AUTOMATION_RESPONSE_INTERRUPTED',
          'The native response could not be retained completely.',
          { request, receipt: reply.receipt, response: reply, outcome: failedOutcome, category: 'receiving' });
      }
      let value = null, parseError = null, uploadError = null, uploadVerified = false;
      const jsonResponse = op.response === 'json' || response.status >= 400;
      if (jsonResponse && received.raw?.length) {
        try { value = parseOpendatasoftJson(received.raw); } catch (error) { parseError = error; }
      } else if (op.response === 'json' && response.status !== 204 && response.status >= 200 && response.status < 300) {
        parseError = new Error('Empty native JSON response.');
      }
      if (upload && response.status >= 200 && response.status < 300) {
        const completed = await completionOrAbort(upload.completion, signal);
        uploadVerified = completed.complete;
        if (!completed.complete) uploadError = completed.error ?? new Error('Upload was not consumed completely.');
      }
      let outcome = baseReceipt.outcome;
      if ((parseError || uploadError) && op.effect !== 'read' && outcome === 'ACKNOWLEDGED') outcome = 'UNCERTAIN';
      const providerCode = object(value) && typeof value.error_code === 'string' && value.error_code ? value.error_code : null;
      if (providerCode && response.status < 500 && (response.status < 300 || response.status >= 400) &&
          op.effect !== 'read' && response.status !== 408) outcome = 'REJECTED';
      reply = { raw: received.raw, value, ...(received.file ? { file: received.file } : {}),
        receipt: { ...baseReceipt, completedAt: timestamp(), bytes: received.bytes, sha256: received.sha256,
          complete: true, outcome, ...(upload ? { uploadVerified } : {}) } };
      await report();
      if (uploadError) fail('ODS_AUTOMATION_UPLOAD_NOT_CONFIRMED',
        'The response arrived while the original upload could not be verified completely.',
        { request, receipt: reply.receipt, response: reply, outcome, category: 'transport' });
      if (!op.success.includes(response.status) || providerCode) {
        fail(providerCode ? 'ODS_AUTOMATION_PROVIDER_ERROR' : 'ODS_AUTOMATION_HTTP_' + response.status,
          'The native Automation operation returned HTTP ' + response.status + (providerCode ? ' (' + providerCode + ').' : '.'),
          { request, receipt: reply.receipt, response: reply, outcome, category: categoryFor(response.status),
            ...(providerCode ? { providerCode } : {}), retryAfterMs: retryAfter(nativeHeaders) });
      }
      if (parseError) fail('ODS_AUTOMATION_RESPONSE_JSON_INVALID', 'The complete native response is not valid expected JSON.',
        { request, receipt: reply.receipt, response: reply, outcome, category: 'provider' });
      return reply;
    } catch (error) {
      if (error instanceof OpendatasoftAutomationError) {
        if (request && !error.request) error.request = request;
        if (dispatched && error.outcome === 'NOT_SENT') error.outcome = op.effect === 'read' ? 'READ_FAILED' : 'UNCERTAIN';
        throw error;
      }
      fail('ODS_AUTOMATION_LOCAL_FAILURE', dispatched ? 'The original request requires native readback after an unexpected interruption.' :
        'The native request could not be prepared.', { ...(request ? { request } : {}),
        ...(reply ? { receipt: reply.receipt, response: reply } : {}),
        outcome: dispatched ? op.effect === 'read' ? 'READ_FAILED' : 'UNCERTAIN' : 'NOT_SENT', category: 'local' });
    } finally {
      controller.abort();
      await upload?.close().catch(() => {});
      active.delete(entry); finish();
    }
  }

  function validatedPageUrl(nextUrl, { expectedOperationId, params = {}, query = {} }, previousUrl = null) {
    const op = automationOperation(expectedOperationId);
    if (op.method !== 'GET' || !op.paginated)
      fail('ODS_AUTOMATION_PAGINATION_UNSUPPORTED', 'Follow pages only for a native paginated read.');
    const base = opendatasoftAutomationUrl(config.origin, expectedOperationId, { params, query });
    text(nextUrl, 32768, 'ODS_AUTOMATION_NEXT_PAGE_INVALID');
    let next;
    try { next = new URL(nextUrl, previousUrl ?? base); } catch {
      fail('ODS_AUTOMATION_NEXT_PAGE_INVALID', 'The provider next page is not a valid URL.');
    }
    if (next.origin !== base.origin || next.pathname !== base.pathname || next.username || next.password || next.hash)
      fail('ODS_AUTOMATION_NEXT_PAGE_CHANGED', 'The provider next page changed the configured tenant or native collection.');
    const permitted = new Set([...Object.keys(op.query), 'limit','offset']);
    const seen = new Set();
    for (const [key, value] of next.searchParams) {
      if (seen.has(key) || !permitted.has(key)) fail('ODS_AUTOMATION_NEXT_PAGE_CHANGED', 'The provider page contains an unexpected query parameter.');
      seen.add(key);
      if (key === 'limit' || key === 'offset') {
        if (!/^\d+$/.test(value)) fail('ODS_AUTOMATION_NEXT_PAGE_INVALID', 'The provider page has invalid pagination numbers.');
        integer(Number(value), key === 'limit' ? 1 : 0,
          key === 'limit' ? op.query.limit?.maximum ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
          'ODS_AUTOMATION_NEXT_PAGE_INVALID');
      } else if (base.searchParams.get(key) !== value)
        fail('ODS_AUTOMATION_NEXT_PAGE_CHANGED', 'The provider page changed the original collection filter.');
    }
    for (const [key, value] of base.searchParams) {
      if (key !== 'limit' && key !== 'offset' && next.searchParams.get(key) !== value)
        fail('ODS_AUTOMATION_NEXT_PAGE_CHANGED', 'The provider page dropped an original collection filter.');
    }
    if (previousUrl) {
      const previous = new URL(previousUrl);
      const previousOffset = Number(previous.searchParams.get('offset') ?? 0);
      const nextOffset = Number(next.searchParams.get('offset') ?? 0);
      if (nextOffset <= previousOffset) fail('ODS_AUTOMATION_NEXT_PAGE_LOOP', 'The native next page does not advance its offset.');
    }
    return next;
  }
  async function followPage(nextUrl, input, options = {}) {
    own(input, ['expectedOperationId','params','query']);
    const { expectedOperationId, params = {}, query = {} } = input;
    const url = validatedPageUrl(nextUrl, { expectedOperationId, params, query });
    return perform(expectedOperationId, { params, query }, options, url);
  }
  async function* paginate(operationId, parameters = {}, options = {}) {
    const op = automationOperation(operationId);
    own(parameters, ['params','query']);
    own(options, ['signal','onRequest','onResponse','maxPages','maxResults']);
    if (op.method !== 'GET' || !op.paginated) fail('ODS_AUTOMATION_PAGINATION_UNSUPPORTED', 'This native response is not a paginated collection.');
    if (parameters.query?.limit === 0) fail('ODS_AUTOMATION_METADATA_ONLY_PAGE', 'A limit of zero only reads collection metadata; choose a positive page size to collect records.');
    const maxPages = integer(options.maxPages ?? 10000, 1, 1000000, 'ODS_AUTOMATION_PAGE_LIMIT_INVALID');
    const maxResults = integer(options.maxResults ?? 1000000, 1, Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_RESULT_LIMIT_INVALID');
    const callbacks = { signal: options.signal, onRequest: options.onRequest, onResponse: options.onResponse };
    const visited = new Set(); let pageNumber = 0, total = 0, nextUrl = null, previousUrl = null;
    while (true) {
      if (pageNumber >= maxPages) fail('ODS_AUTOMATION_PAGE_LIMIT_REACHED', 'More native pages remain; retain the continuation before increasing the collection limit.',
        { nextUrl: nextUrl?.href ?? null, pages: pageNumber, results: total, outcome: 'OBSERVED' });
      const received = await perform(operationId, parameters, callbacks, nextUrl);
      pageNumber++;
      const value = received.value;
      if (!object(value) || !Array.isArray(value.results) ||
          value.next !== null && value.next !== undefined && typeof value.next !== 'string')
        fail('ODS_AUTOMATION_PAGE_SHAPE_INVALID', 'The native collection did not return its complete results/next envelope.',
          { receipt: received.receipt, response: received, outcome: 'OBSERVED' });
      if (visited.has(received.receipt.url)) fail('ODS_AUTOMATION_NEXT_PAGE_LOOP', 'The native collection repeated a page.',
        { receipt: received.receipt, response: received, outcome: 'OBSERVED' });
      visited.add(received.receipt.url); total += value.results.length;
      if (total > maxResults) fail('ODS_AUTOMATION_RESULT_LIMIT_REACHED', 'The complete native page exceeds the configured collection size.',
        { receipt: received.receipt, response: received, results: total, outcome: 'OBSERVED' });
      yield received;
      if (value.next === null || value.next === undefined || value.next === '') return;
      previousUrl = received.receipt.url;
      nextUrl = validatedPageUrl(value.next, { expectedOperationId: operationId, ...parameters }, previousUrl);
    }
  }
  async function collect(operationId, parameters = {}, options = {}) {
    own(options, ['signal','onRequest','onResponse','maxPages','maxResults','maxBytes']);
    const { maxBytes = config.maxResponseBytes, ...pagingOptions } = options;
    integer(maxBytes, 1, Number.MAX_SAFE_INTEGER, 'ODS_AUTOMATION_COLLECTION_LIMIT_INVALID');
    const results = [], pages = [], totals = [];
    let totalBytes = 0;
    for await (const page of paginate(operationId, parameters, pagingOptions)) {
      totalBytes += page.receipt.bytes;
      if (totalBytes > maxBytes) fail('ODS_AUTOMATION_COLLECTION_LIMIT_REACHED', 'The full received collection exceeds the configured in-memory size; consume paginate() into the retained journal.',
        { receipt: page.receipt, response: page, partial: { results, pages, complete: false }, outcome: 'OBSERVED' });
      pages.push(page); results.push(...page.value.results);
      totals.push(Object.hasOwn(page.value, 'total_count') ? page.value.total_count : null);
    }
    return { results, pages, totals, bytes: totalBytes, complete: true };
  }
  async function waitForDatasetStatus(input, options = {}) {
    own(input, ['datasetUid','baseline','requireTransition','expectedPublished','intervalMs','maxWaitMs']);
    own(options, ['signal','onRequest','onResponse']);
    const intervalMs = integer(input.intervalMs ?? 2000, 100, 30000, 'ODS_AUTOMATION_POLL_INTERVAL_INVALID');
    const maxWaitMs = integer(input.maxWaitMs ?? 300000, 0, 3600000, 'ODS_AUTOMATION_POLL_TIMEOUT_INVALID');
    if (input.expectedPublished !== undefined && typeof input.expectedPublished !== 'boolean')
      fail('ODS_AUTOMATION_PUBLICATION_EXPECTATION_INVALID', 'Use a boolean publication expectation.');
    const requireTransition = input.requireTransition ?? input.baseline !== undefined;
    if (typeof requireTransition !== 'boolean' || requireTransition && input.baseline === undefined)
      fail('ODS_AUTOMATION_BASELINE_REQUIRED', 'A transition-bound wait requires the original native status.');
    const baseline = input.baseline === undefined ? null : automationStatusIdentity(input.baseline);
    const waitSignal = AbortSignal.any([lifecycle.signal, ...(options.signal ? [options.signal] : [])]);
    let finishWait;
    const waiting = new Promise(resolve => { finishWait = resolve; });
    pendingWaits.add(waiting);
    const started = Date.now(); let observations = 0, transitionObserved = false, latest;
    try { while (true) {
      latest = await perform('get-dataset-status', { params: { dataset_uid: input.datasetUid } }, options);
      observations++;
      const state = classifyOpendatasoftAutomationStatus(latest.value);
      if (baseline !== null && automationStatusIdentity(latest.value) !== baseline) transitionObserved = true;
      const eligible = !requireTransition || transitionObserved;
      if (state.phase === 'UNKNOWN') return { outcome: 'UNKNOWN_STATE', observations, transitionObserved, latest, state };
      if (eligible && (state.phase === 'ERROR' || state.phase === 'LIMIT_REACHED'))
        return { outcome: state.phase, observations, transitionObserved, latest, state };
      if (eligible && state.phase === 'IDLE' &&
          (input.expectedPublished === undefined || state.isPublished === input.expectedPublished))
        return { outcome: state.recordErrorCount > 0 ? 'IDLE_WITH_RECORD_ERRORS' : 'IDLE',
          observations, transitionObserved, latest, state };
      const remaining = maxWaitMs - (Date.now() - started);
      if (remaining <= 0) return { outcome: 'WAITING', observations, transitionObserved, latest, state };
      try { await delay(Math.min(intervalMs, remaining), undefined, { signal: waitSignal }); }
      catch { fail('ODS_AUTOMATION_POLL_CANCELLED', 'Status observation was cancelled; the provider action retains its original state.',
        { outcome: 'OBSERVED', receipt: latest.receipt, response: latest }); }
    } } finally { pendingWaits.delete(waiting); finishWait(); }
  }
  const client = { config, invoke: (operationId, parameters = {}, options = {}) => perform(operationId, parameters, options),
    followPage, paginate, collect, waitForDatasetStatus,
    async close() {
      closed = true; lifecycle.abort();
      const waiting = [...pendingWaits], pending = [...active];
      for (const item of pending) item.controller.abort();
      await Promise.allSettled([...pending.map(item => item.done), ...waiting]);
    }
  };
  for (const [operationId, op] of Object.entries(AUTOMATION_OPERATIONS)) {
    client[op.name] = (input = {}, options = {}) => {
      const names = [...Object.values(op.params), 'query'];
      if (op.body !== null) names.push('body');
      if (op.body === 'multipart') names.push('file','filename','mimetype','expectedSha256','expectedBytes');
      if (op.response === 'binary') names.push('destination','expectedSha256','expectedBytes');
      own(input, names);
      const params = Object.fromEntries(Object.entries(op.params).map(([native, name]) => [native, input[name]]));
      const native = { params, query: input.query ?? {} };
      if (op.body === 'json') native.body = input.body;
      if (op.body === 'multipart') native.upload = { file: input.file, filename: input.filename,
        mimetype: input.mimetype, expectedSha256: input.expectedSha256, expectedBytes: input.expectedBytes,
        fields: input.body ?? {} };
      if (op.response === 'binary' && input.destination !== undefined)
        native.download = { destination: input.destination, expectedSha256: input.expectedSha256, expectedBytes: input.expectedBytes };
      else if (op.response === 'binary' && (input.expectedSha256 !== undefined || input.expectedBytes !== undefined))
        fail('ODS_AUTOMATION_DOWNLOAD_PATH_REQUIRED', 'Supply the retained destination when binding a downloaded file.');
      return perform(operationId, native, options);
    };
  }
  return Object.freeze(client);
}
export function classifyOpendatasoftAutomationStatus(value) {
  if (!object(value) || typeof value.status !== 'string')
    fail('ODS_AUTOMATION_STATUS_INVALID', 'The provider status must retain its native status field.');
  const status = value.status;
  const phase = !AUTOMATION_DATASET_STATES.includes(status) ? 'UNKNOWN' :
    status === 'error' ? 'ERROR' : status === 'limit_reached' ? 'LIMIT_REACHED' :
    status === 'idle' && (value.next === null || value.next === undefined) ? 'IDLE' : 'RUNNING';
  return { status, phase, isPublished: typeof value.is_published === 'boolean' ? value.is_published : null,
    since: value.since ?? null, previous: value.previous ?? null, next: value.next ?? null,
    recordErrorCount: Array.isArray(value.records_errors) ? value.records_errors.length : null };
}
function automationStatusIdentity(value) {
  classifyOpendatasoftAutomationStatus(value);
  return JSON.stringify(Object.fromEntries(['status','previous','next','since','is_published']
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])));
}
