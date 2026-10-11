// MIT. Read-only S3 application adapter. Native SF30 alone controls payment and delivery.
import { createHash } from 'node:crypto';
import { readS3Config, validateS3Config } from './config.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (code, status = 503) => Object.assign(new Error(code), { code, status });
const response = error => ({ status: error.status ?? 503, body: { error: error.code ?? 'S3_SOURCE_UNAVAILABLE' } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const CONTROLS = ['range', 'if-match', 'if-none-match', 'if-range', 'if-modified-since', 'if-unmodified-since'];

function safeFailure(error, signal) {
  if (signal?.aborted) return signal.reason?.code ? signal.reason : failure('S3_REQUEST_ABORTED', 503);
  if (typeof error?.code === 'string' && error.code.startsWith('S3_')) return error;
  const status = error?.$metadata?.httpStatusCode;
  if (status === 404 || status === 412 || ['NoSuchKey', 'NoSuchVersion', 'PreconditionFailed'].includes(error?.name))
    return failure('S3_OBJECT_CHANGED_OR_UNAVAILABLE', 409);
  if (status === 416) return failure('S3_OBJECT_RANGE_UNAVAILABLE', 409);
  return failure('S3_SOURCE_UNAVAILABLE');
}

function shape(head, item) {
  if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength < 0 ||
      typeof head.ETag !== 'string' || !head.ETag || head.ETag.length > 1024 || /[\x00-\x1f\x7f]/.test(head.ETag) ||
      head.DeleteMarker === true) throw failure('S3_OBJECT_METADATA_INVALID');
  if (head.ContentEncoding && head.ContentEncoding !== 'identity') throw failure('S3_OBJECT_CONTENT_ENCODING_UNSUPPORTED');
  if (item.expectedBytes !== undefined && item.expectedBytes !== head.ContentLength ||
      item.etag !== undefined && item.etag !== head.ETag ||
      item.versionId !== undefined && item.versionId !== head.VersionId)
    throw failure('S3_CONFIGURED_OBJECT_CHANGED', 409);
  if (item.mode === 'whole' && head.ContentLength > item.maxBytes) throw failure('S3_OBJECT_REQUIRES_CHUNKS', 413);
  let versionId;
  if (head.VersionId !== undefined) {
    if (typeof head.VersionId !== 'string' || !head.VersionId || head.VersionId.length > 1024 || /[\x00-\x1f\x7f]/.test(head.VersionId))
      throw failure('S3_OBJECT_METADATA_INVALID');
    versionId = head.VersionId;
  }
  return Object.freeze({ bytes: head.ContentLength, etag: head.ETag, versionId,
    snapshot: hash(JSON.stringify({ id: item.id, bytes: head.ContentLength, etag: head.ETag, versionId: versionId ?? null })) });
}

function selection(context, item, pinned) {
  if (!object(context) || context.method !== 'GET' || context.body !== null && context.body !== undefined)
    throw failure('S3_GET_REQUIRED', 405);
  if (object(context.headers) && Object.keys(context.headers).some(key => CONTROLS.includes(key.toLowerCase())))
    throw failure('S3_USE_OFFSET_LENGTH_QUERY', 400);
  if (context.pathParams && Object.keys(context.pathParams).length) throw failure('S3_FIXED_ROUTE_REQUIRED', 400);
  const query = context.query ?? {};
  if (!object(query)) throw failure('S3_INVALID_QUERY', 400);
  const allowed = item.mode === 'chunks' ? ['offset', 'length'] : [];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw failure('S3_INVALID_QUERY', 400);
  const number = (name, fallback, min) => {
    if (!own(query, name)) return fallback;
    const value = query[name];
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < min) throw failure('S3_INVALID_QUERY', 400);
    return Number(value);
  };
  if (item.mode === 'whole') return { offset: 0, bytes: pinned.bytes, range: null };
  const offset = number('offset', 0, 0), length = number('length', item.maxBytes, 1);
  if (length > item.maxBytes) throw failure('S3_CHUNK_TOO_LARGE', 413);
  if (offset >= pinned.bytes) throw failure('S3_OFFSET_OUTSIDE_OBJECT', 416);
  const bytes = Math.min(length, pinned.bytes - offset), end = offset + bytes - 1;
  return { offset, bytes, range: `bytes=${offset}-${end}`, contentRange: `bytes ${offset}-${end}/${pinned.bytes}` };
}

async function collect(body, wanted, signal) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') throw failure('S3_OBJECT_BODY_UNAVAILABLE');
  const chunks = []; let count = 0;
  const abort = () => { if (typeof body.destroy === 'function') body.destroy(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const chunk of body) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      count += bytes.length;
      if (count > wanted) throw failure('S3_RESPONSE_LENGTH_MISMATCH', 502);
      chunks.push(bytes);
    }
    if (count !== wanted) throw failure('S3_RESPONSE_LENGTH_MISMATCH', 502);
    return Buffer.concat(chunks, count);
  } finally {
    signal.removeEventListener('abort', abort);
    if (typeof body.destroy === 'function') body.destroy();
  }
}

/** Open and pin each approved object once. Pass an existing official SDK client when embedding. */
export async function createS3ObjectSource(input, { client: suppliedClient, sdk: suppliedSdk, env = process.env } = {}) {
  const config = validateS3Config(input);
  const sdk = suppliedSdk ?? await import('@aws-sdk/client-s3');
  if (typeof sdk.HeadObjectCommand !== 'function' || typeof sdk.GetObjectCommand !== 'function')
    throw new TypeError('Official S3 command classes required');
  let credentials;
  if (!suppliedClient && config.credentialProvider === 'environment') {
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw failure('S3_ENVIRONMENT_CREDENTIALS_REQUIRED');
    credentials = { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) };
  }
  const client = suppliedClient ?? new sdk.S3Client({ region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}), forcePathStyle: config.forcePathStyle,
    maxAttempts: 1, followRegionRedirects: false, ...(credentials ? { credentials } : {}) });
  if (!client || typeof client.send !== 'function') throw new TypeError('S3 client required');
  const active = new Set(), bindings = new Map(); let closed = false;
  const base = item => ({ Bucket: config.bucket, Key: item.key,
    ...(config.expectedBucketOwner ? { ExpectedBucketOwner: config.expectedBucketOwner } : {}) });
  async function operation(external, perform) {
    if (closed) throw failure('S3_SOURCE_CLOSED');
    if (active.size >= config.maxInFlight) throw failure('S3_SOURCE_BUSY', 503);
    const controller = new AbortController(); active.add(controller);
    const relay = () => controller.abort(failure('S3_REQUEST_ABORTED', 503));
    external?.addEventListener('abort', relay, { once: true });
    if (external?.aborted) relay();
    const timer = setTimeout(() => controller.abort(failure('S3_REQUEST_TIMEOUT', 504)), config.timeoutMs);
    let onAbort;
    try {
      const interrupted = new Promise((_resolve, reject) => {
        onAbort = () => reject(controller.signal.reason ?? failure('S3_REQUEST_ABORTED'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      });
      const work = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return perform(controller.signal);
      }).finally(() => active.delete(controller));
      return await Promise.race([work, interrupted]);
    } catch (error) { throw safeFailure(error, controller.signal); }
    finally {
      clearTimeout(timer); external?.removeEventListener('abort', relay);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    }
  }
  const close = () => {
    if (closed) return;
    closed = true;
    for (const controller of active) controller.abort(failure('S3_SOURCE_CLOSED'));
    if (!suppliedClient && typeof client.destroy === 'function') client.destroy();
  };
  try {
    for (const item of config.objects) {
      const pinned = await operation(undefined, async signal => shape(await client.send(new sdk.HeadObjectCommand({
        ...base(item), ...(item.versionId ? { VersionId: item.versionId } : {}),
        ...(item.etag ? { IfMatch: item.etag } : {}),
      }), { abortSignal: signal }), item));
      const admit = context => {
        try {
          selection(context, item, pinned);
          if (closed) throw failure('S3_SOURCE_CLOSED');
          if (active.size >= config.maxInFlight) return { status: 429,
            headers: { 'retry-after': '1' }, body: { error: 'S3_SOURCE_BUSY' } };
          return true;
        } catch (error) {
          if (error.status >= 400 && error.status < 500) return response(error);
          throw error; // Original SF30 maps unavailable admission to 503 before native verification.
        }
      };
      const handler = async context => {
        let selected;
        try {
          selected = selection(context, item, pinned);
          return await operation(context.signal, async signal => {
            const result = await client.send(new sdk.GetObjectCommand({ ...base(item), IfMatch: pinned.etag,
              ...(pinned.versionId ? { VersionId: pinned.versionId } : {}),
              ...(selected.range ? { Range: selected.range } : {}),
            }), { abortSignal: signal });
            try {
              if (result.ETag !== pinned.etag || pinned.versionId !== undefined && result.VersionId !== pinned.versionId)
                throw failure('S3_OBJECT_CHANGED_OR_UNAVAILABLE', 409);
              if (result.ContentLength !== selected.bytes || selected.range && result.ContentRange !== selected.contentRange ||
                  !selected.range && result.ContentRange !== undefined || result.ContentEncoding && result.ContentEncoding !== 'identity')
                throw failure('S3_RESPONSE_METADATA_MISMATCH', 502);
              const body = await collect(result.Body, selected.bytes, signal), sha256 = hash(body);
              if (item.sha256 && sha256 !== item.sha256) throw failure('S3_OBJECT_DIGEST_MISMATCH', 502);
              return { status: selected.range ? 206 : 200,
                headers: { 'content-type': item.contentType,
                  'content-disposition': `attachment; filename="${item.filename}"`,
                  'accept-ranges': 'none', 'x-content-sha256': sha256,
                  'x-sf30-object-snapshot': pinned.snapshot, 'x-sf30-object-bytes': String(pinned.bytes),
                  ...(selected.range ? { 'content-range': selected.contentRange } : {}) }, body };
            } finally { if (typeof result.Body?.destroy === 'function') result.Body.destroy(); }
          });
        } catch (error) { return response(safeFailure(error)); }
      };
      bindings.set(item.id, Object.freeze({ item, pinned, admit, handler }));
    }
  } catch (error) { close(); throw safeFailure(error); }
  const route = id => {
    const found = bindings.get(id);
    if (!found) throw new TypeError('Unknown configured object ID');
    return Object.freeze({ admit: found.admit, handler: found.handler });
  };
  const describe = () => ({ schema: 'stellar-forge.s3-description.v1', closed,
    inFlight: active.size, maxInFlight: config.maxInFlight,
    objects: [...bindings.values()].map(({ item, pinned }) => ({ id: item.id, path: item.path,
      description: item.description, mode: item.mode, bytes: pinned.bytes, maxBytes: item.maxBytes,
      contentType: item.contentType, filename: item.filename, snapshot: pinned.snapshot,
      versioned: pinned.versionId !== undefined && pinned.versionId !== 'null',
      ...(item.sha256 ? { expectedSha256: item.sha256 } : {}) })) });
  // Privileged operator export for durable setup; contains private bucket/keys,
  // never credential values and never attached to a public HTTP response.
  const snapshotConfig = () => structuredClone({ ...config,
    objects: [...bindings.values()].map(({ item, pinned }) => ({ ...item,
      etag: pinned.etag, expectedBytes: pinned.bytes,
      ...(pinned.versionId !== undefined ? { versionId: pinned.versionId } : {}) })) });
  return Object.freeze({ route, describe, snapshotConfig, close });
}

export async function openS3ObjectFile(path, options = {}) {
  return createS3ObjectSource(await readS3Config(path), options);
}
