// MIT. Private, create-only S3 transport for the original encrypted SF101 objects.
// The original recovery engine remains responsible for manifest authentication.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

export const S3_STORE_SCHEMA = 'stellar-forge.merchant-recovery-s3.v1';
const MAX_BYTES = 4 * 1024 ** 3 + 12 * 1024 ** 2;
const HEX = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw new TypeError(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeToken = (value, maximum = 1024) => typeof value === 'string' && value.length > 0 &&
  value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const providerToken = value => typeof value === 'string' && /^[A-Za-z0-9_.:/+=-]{1,256}$/.test(value) ? value : undefined;

export class RecoveryStoreError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'RecoveryStoreError';
    this.code = code;
    Object.assign(this, details);
  }
}
const failure = (code, details) => new RecoveryStoreError(code, details);

function providerFailure(error, code = 'S3_RECOVERY_REQUEST_FAILED') {
  if (error instanceof RecoveryStoreError) return error;
  const status = error?.$metadata?.httpStatusCode;
  const providerCode = providerToken(error?.name === 'Error' ? error?.code ?? error?.name : error?.name ?? error?.code);
  const requestId = providerToken(error?.$metadata?.requestId);
  const retry = error?.$response?.headers?.['retry-after'];
  const retryAfter = typeof retry === 'string' && retry.length <= 128 && !/[\x00-\x1f\x7f]/.test(retry) ? retry : undefined;
  return failure(code, {
    ...(Number.isInteger(status) ? { status } : {}),
    ...(providerCode ? { providerCode } : {}), ...(requestId ? { requestId } : {}),
    ...(retryAfter ? { retryAfter } : {}),
    retryable: status === 429 || status >= 500 || !status && ['TimeoutError', 'RequestTimeout', 'NetworkingError',
      'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'AbortError'].includes(providerCode),
  });
}
const absent = error => error?.status === 404 || error?.status === undefined &&
  ['NotFound', 'NoSuchKey', 'NoSuchVersion'].includes(error?.providerCode);
const ambiguous = error => error?.code === 'S3_RECOVERY_TIMEOUT' || error?.status >= 500 ||
  ['TimeoutError', 'RequestTimeout', 'NetworkingError', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error?.providerCode);

function relativeKey(value, { empty = false, prefix = false } = {}) {
  need(typeof value === 'string' && (empty || value.length > 0) && Buffer.byteLength(value) <= 1024 &&
    /^[A-Za-z0-9._/-]*$/.test(value) && !value.startsWith('/') && !value.includes('//') &&
    value.split('/').every((part, index, all) => part !== '.' && part !== '..' &&
      (part.length > 0 || prefix && index === all.length - 1 || empty && all.length === 1)),
  'Use a relative recovery object key or prefix');
  need(prefix || !value.endsWith('/'), 'A recovery object key must name a file');
  return value;
}

export function validateS3StoreConfig(raw) {
  const allowed = ['schema', 'region', 'bucket', 'prefix', 'endpoint', 'forcePathStyle', 'allowLocalEndpoint',
    'credentialProvider', 'expectedBucketOwner', 'timeoutMs', 'proxyEnvironment'];
  need(object(raw) && Object.keys(raw).every(key => allowed.includes(key)) && raw.schema === S3_STORE_SCHEMA,
    'Expected the original merchant-recovery-s3.v1 configuration');
  need(safeToken(raw.region, 64) && /^[a-z0-9][a-z0-9-]*$/.test(raw.region), 'Invalid S3 region');
  need(safeToken(raw.bucket, 63) && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(raw.bucket) &&
    !raw.bucket.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(raw.bucket) && !raw.bucket.endsWith('--x-s3'),
  'Use an ordinary existing S3 bucket');
  need(raw.forcePathStyle === undefined || typeof raw.forcePathStyle === 'boolean', 'Invalid forcePathStyle');
  need(raw.allowLocalEndpoint === undefined || typeof raw.allowLocalEndpoint === 'boolean', 'Invalid allowLocalEndpoint');
  need(raw.proxyEnvironment === undefined || typeof raw.proxyEnvironment === 'boolean', 'Invalid proxyEnvironment');
  let endpoint;
  if (raw.endpoint !== undefined) {
    need(safeToken(raw.endpoint, 2048), 'Invalid S3 endpoint');
    const url = new URL(raw.endpoint);
    const local = raw.allowLocalEndpoint === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    need((url.protocol === 'https:' || local) && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/', 'Use an HTTPS S3 origin or explicitly enabled loopback HTTP');
    endpoint = url.origin;
  } else need(!raw.allowLocalEndpoint, 'Local S3 mode requires an explicit endpoint');
  const prefix = relativeKey(raw.prefix, { prefix: true }).replace(/\/$/, '') + '/';
  need(Buffer.byteLength(prefix) <= 768, 'Recovery storage prefix is too long');
  const credentialProvider = raw.credentialProvider ?? 'environment';
  need(['environment', 'default'].includes(credentialProvider), 'Invalid S3 credentialProvider');
  need(raw.expectedBucketOwner === undefined || typeof raw.expectedBucketOwner === 'string' && /^\d{12}$/.test(raw.expectedBucketOwner),
    'expectedBucketOwner must be a 12-digit account ID');
  const timeoutMs = raw.timeoutMs ?? 60000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 3600000, 'timeoutMs must be 100–3600000');
  return Object.freeze({ schema: S3_STORE_SCHEMA, region: raw.region, bucket: raw.bucket, prefix,
    ...(endpoint ? { endpoint } : {}), forcePathStyle: raw.forcePathStyle ?? false,
    allowLocalEndpoint: raw.allowLocalEndpoint ?? false, credentialProvider,
    proxyEnvironment: raw.proxyEnvironment ?? false,
    ...(raw.expectedBucketOwner ? { expectedBucketOwner: raw.expectedBucketOwner } : {}), timeoutMs });
}

/** Read configuration without loading credentials, the SDK, or a remote object. */
export async function readS3StoreConfig(input) {
  if (object(input)) return validateS3StoreConfig(input);
  need(typeof input === 'string' && isAbsolute(input) && resolve(input) === input, 'Absolute S3 configuration path required');
  const before = await lstat(input);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= 65536 &&
    !(before.mode & 0o077), 'Use a private regular S3 configuration file');
  const file = await open(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await file.stat();
    need(current.isFile() && current.nlink === 1 && current.ino === before.ino && current.dev === before.dev &&
      current.size <= 65536 && !(current.mode & 0o077), 'S3 configuration changed while opening');
    const bytes = await file.readFile();
    const after = await file.stat();
    need(bytes.length <= 65536 && after.size === current.size && after.mtimeMs === current.mtimeMs &&
      after.ctimeMs === current.ctimeMs, 'S3 configuration changed while reading');
    return validateS3StoreConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } finally { await file.close(); }
}

function checksum(value, type) {
  if (value === undefined || type && type !== 'FULL_OBJECT') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw failure('S3_RECOVERY_CHECKSUM_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw failure('S3_RECOVERY_CHECKSUM_INVALID');
  return bytes.toString('hex');
}

function objectMetadata(value) {
  if (!Number.isSafeInteger(value.ContentLength) || value.ContentLength < 0 || value.ContentLength > MAX_BYTES ||
      !safeToken(value.ETag) || value.DeleteMarker === true ||
      value.ContentEncoding && value.ContentEncoding !== 'identity' ||
      value.VersionId !== undefined && !safeToken(value.VersionId)) throw failure('S3_RECOVERY_OBJECT_METADATA_INVALID');
  return { bytes: value.ContentLength, etag: value.ETag,
    ...(value.VersionId !== undefined ? { versionId: value.VersionId } : {}),
    ...(value.ChecksumSHA256 !== undefined ? { checksumSha256: checksum(value.ChecksumSHA256, value.ChecksumType) } : {}),
    ...(value.$metadata?.requestId ? { requestId: providerToken(value.$metadata.requestId) } : {}) };
}

/** Use the original optional S3 dependency and one selected, unchanged provider. */
export async function openS3Store(input, { client: suppliedClient, sdk: suppliedSdk, env = process.env } = {}) {
  const config = await readS3StoreConfig(input);
  const nativeRequire = createRequire(new URL('../sf30-seller-sdk/s3/package.json', import.meta.url));
  const sdk = suppliedSdk ?? nativeRequire('@aws-sdk/client-s3');
  for (const name of ['S3Client', 'HeadObjectCommand', 'GetObjectCommand', 'PutObjectCommand', 'ListObjectsV2Command'])
    need(typeof sdk?.[name] === 'function', 'Original official S3 command classes required');
  let credentials;
  if (!suppliedClient && config.credentialProvider === 'environment') {
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw failure('S3_RECOVERY_ENVIRONMENT_CREDENTIALS_REQUIRED');
    credentials = { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) };
  }
  let requestHandler;
  if (!suppliedClient && config.proxyEnvironment) {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (!(major >= 25 || major === 24 && minor >= 5 || major === 22 && minor >= 21))
      throw failure('S3_RECOVERY_PROXY_NODE_VERSION_REQUIRED');
    // Keep transport credentials in the process environment. The selected origin,
    // immutable keys and recovery journal identity continue to name the same store.
    const proxyEnv = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'no_proxy'].filter(key => typeof env[key] === 'string')
      .map(key => [key, env[key]]));
    const agents = [];
    try {
      const sdkRequire = createRequire(nativeRequire.resolve('@aws-sdk/client-s3'));
      const { NodeHttpHandler } = sdkRequire('@smithy/node-http-handler');
      need(typeof NodeHttpHandler === 'function', 'Original Smithy HTTP handler required');
      const httpAgent = new HttpAgent({ keepAlive: true, proxyEnv });
      agents.push(httpAgent);
      const httpsAgent = new HttpsAgent({ keepAlive: true, proxyEnv });
      agents.push(httpsAgent);
      requestHandler = new NodeHttpHandler({ httpAgent, httpsAgent,
        connectionTimeout: config.timeoutMs, requestTimeout: config.timeoutMs });
    } catch {
      for (const agent of agents) agent.destroy();
      throw failure('S3_RECOVERY_PROXY_CONFIGURATION_INVALID');
    }
  }
  let client;
  try {
    client = suppliedClient ?? new sdk.S3Client({ region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}), forcePathStyle: config.forcePathStyle,
      maxAttempts: 1, followRegionRedirects: false, ...(credentials ? { credentials } : {}),
      ...(requestHandler ? { requestHandler } : {}) });
  } catch (error) { requestHandler?.destroy(); throw error; }
  need(client && typeof client.send === 'function', 'S3 client required');
  const target = { region: config.region, bucket: config.bucket, prefix: config.prefix,
    endpoint: config.endpoint ?? null, forcePathStyle: config.forcePathStyle,
    expectedBucketOwner: config.expectedBucketOwner ?? null };
  const identity = Object.freeze({ ...target, fingerprint: digest(JSON.stringify(target)) });
  const active = new Map();
  let closed = false;
  const base = () => ({ Bucket: config.bucket,
    ...(config.expectedBucketOwner ? { ExpectedBucketOwner: config.expectedBucketOwner } : {}) });
  const keyOf = key => {
    const full = config.prefix + relativeKey(key);
    need(Buffer.byteLength(full) <= 1024, 'Recovery object key exceeds S3 byte limit');
    return full;
  };
  function context(external) {
    if (closed) throw failure('S3_RECOVERY_STORE_CLOSED');
    const controller = new AbortController();
    const relay = () => controller.abort(failure('S3_RECOVERY_CANCELLED'));
    external?.addEventListener('abort', relay, { once: true });
    if (external?.aborted) relay();
    const timer = setTimeout(() => controller.abort(failure('S3_RECOVERY_TIMEOUT', { retryable: true })), config.timeoutMs);
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); active.delete(controller);
      external?.removeEventListener('abort', relay); };
    active.set(controller, finish);
    return { signal: controller.signal,
      cancel: () => controller.abort(failure('S3_RECOVERY_CANCELLED')), finish };
  }
  async function request(Command, input, signal) {
    signal.throwIfAborted();
    try { return await client.send(new Command(input), { abortSignal: signal }); }
    catch (error) { throw signal.aborted ? signal.reason : providerFailure(error); }
  }
  async function head({ key, versionId, etag, signal }) {
    if (versionId !== undefined) need(safeToken(versionId), 'Invalid object versionId');
    if (etag !== undefined) need(safeToken(etag), 'Invalid object ETag');
    const ctx = context(signal);
    try {
      const result = objectMetadata(await request(sdk.HeadObjectCommand, { ...base(), Key: keyOf(key),
        ...(versionId !== undefined ? { VersionId: versionId } : {}), ...(etag ? { IfMatch: etag } : {}),
        ChecksumMode: 'ENABLED' }, ctx.signal));
      if (versionId !== undefined && result.versionId !== versionId || etag && result.etag !== etag)
        throw failure('S3_RECOVERY_OBJECT_CHANGED', { status: 409 });
      return result;
    } finally { ctx.finish(); }
  }
  async function get({ key, versionId, etag, signal } = {}) {
    if (versionId !== undefined) need(safeToken(versionId), 'Invalid object versionId');
    if (etag !== undefined) need(safeToken(etag), 'Invalid object ETag');
    const ctx = context(signal);
    let raw;
    const stopBody = () => { if (typeof raw?.destroy === 'function') raw.destroy(); };
    ctx.signal.addEventListener('abort', stopBody, { once: true });
    const cancel = () => { ctx.cancel(); stopBody(); ctx.finish(); ctx.signal.removeEventListener('abort', stopBody); };
    try {
      const response = await request(sdk.GetObjectCommand, { ...base(), Key: keyOf(key),
        ...(versionId !== undefined ? { VersionId: versionId } : {}), ...(etag ? { IfMatch: etag } : {}),
        ChecksumMode: 'ENABLED' }, ctx.signal);
      raw = response.Body;
      const meta = objectMetadata(response);
      if (versionId !== undefined && meta.versionId !== versionId || etag && meta.etag !== etag)
        throw failure('S3_RECOVERY_OBJECT_CHANGED', { status: 409 });
      if (!raw || typeof raw[Symbol.asyncIterator] !== 'function') throw failure('S3_RECOVERY_STREAM_REQUIRED');
      const body = (async function* () {
        let received = 0;
        try {
          ctx.signal.throwIfAborted();
          for await (const chunk of raw) {
            ctx.signal.throwIfAborted();
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += bytes.length;
            if (received > meta.bytes) throw failure('S3_RECOVERY_LENGTH_MISMATCH');
            yield bytes;
          }
          ctx.signal.throwIfAborted();
          if (received !== meta.bytes) throw failure('S3_RECOVERY_LENGTH_MISMATCH');
        } catch (error) { throw ctx.signal.aborted ? ctx.signal.reason : providerFailure(error, 'S3_RECOVERY_STREAM_FAILED'); }
        finally { stopBody(); ctx.finish(); ctx.signal.removeEventListener('abort', stopBody); }
      })();
      return { body, ...meta, cancel };
    } catch (error) { cancel(); throw error; }
  }
  async function verifyObject(expected, pinned) {
    const selected = pinned ?? await head(expected);
    if (selected.bytes !== expected.bytes || selected.checksumSha256 && selected.checksumSha256 !== expected.sha256)
      throw failure('S3_RECOVERY_IMMUTABLE_CONFLICT', { status: 409 });
    const remote = await get({ key: expected.key, versionId: selected.versionId, etag: selected.etag, signal: expected.signal });
    try {
      const hash = createHash('sha256');
      for await (const chunk of remote.body) hash.update(chunk);
      if (remote.bytes !== expected.bytes || hash.digest('hex') !== expected.sha256 ||
        remote.checksumSha256 && remote.checksumSha256 !== expected.sha256)
        throw failure('S3_RECOVERY_IMMUTABLE_CONFLICT', { status: 409 });
      return { bytes: remote.bytes, etag: remote.etag,
        ...(remote.versionId !== undefined ? { versionId: remote.versionId } : {}),
        sha256: expected.sha256, ...(remote.requestId ? { requestId: remote.requestId } : {}) };
    } finally { remote.cancel(); }
  }
  async function putImmutable({ key, file, bytes, sha256, contentType = 'application/octet-stream', signal } = {}) {
    if (closed) throw failure('S3_RECOVERY_STORE_CLOSED');
    keyOf(key);
    need(typeof file === 'string' && isAbsolute(file) && resolve(file) === file, 'Absolute encrypted-object file required');
    need(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_BYTES && HEX.test(sha256 ?? ''),
      'Exact encrypted-object byte count and SHA256 required');
    need(safeToken(contentType, 128) && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType),
      'Invalid encrypted-object content type');
    const expected = { key, bytes, sha256, signal };
    const before = await lstat(file);
    need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size === bytes,
      'Original encrypted object must be a regular file with its retained size');
    const fd = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const first = await fd.stat();
      need(first.isFile() && first.nlink === 1 && first.dev === before.dev && first.ino === before.ino && first.size === bytes,
        'Encrypted object changed while opening');
      const localHash = createHash('sha256');
      for await (const chunk of fd.createReadStream({ autoClose: false, start: 0 })) {
        signal?.throwIfAborted(); localHash.update(chunk);
      }
      const afterHash = await fd.stat();
      need(afterHash.size === first.size && afterHash.mtimeMs === first.mtimeMs && afterHash.ctimeMs === first.ctimeMs &&
        localHash.digest('hex') === sha256, 'Encrypted object differs from its retained SHA256');
      try { const existing = await head(expected); return { created: false, reused: true, ...await verifyObject(expected, existing) }; }
      catch (error) { if (!absent(error)) throw error; }
      const ctx = context(signal);
      const body = fd.createReadStream({ autoClose: false, start: 0 });
      const stopBody = () => body.destroy();
      ctx.signal.addEventListener('abort', stopBody, { once: true });
      let result, uncertain;
      try {
        result = await request(sdk.PutObjectCommand, { ...base(), Key: keyOf(key), Body: body,
          ContentLength: bytes, ContentType: contentType, CacheControl: 'no-store',
          IfNoneMatch: '*', ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
          Metadata: { 'sf101-sha256': sha256 } }, ctx.signal);
      } catch (error) {
        const normalized = providerFailure(error);
        if (normalized.status === 412 || normalized.status === 409 || ambiguous(normalized)) uncertain = normalized;
        else throw normalized;
      } finally { stopBody(); ctx.finish(); ctx.signal.removeEventListener('abort', stopBody); }
      if (uncertain?.retryAfter) throw failure('S3_RECOVERY_PUT_OUTCOME_UNKNOWN', { ...uncertain,
        code: 'S3_RECOVERY_PUT_OUTCOME_UNKNOWN', mayHaveCommitted: true });
      if (uncertain) {
        try { return { created: false, reused: true, reconciled: true, ...await verifyObject(expected) }; }
        catch (error) {
          if (error.code === 'S3_RECOVERY_IMMUTABLE_CONFLICT') throw error;
          throw failure('S3_RECOVERY_PUT_OUTCOME_UNKNOWN', { providerCode: uncertain.providerCode,
            status: uncertain.status, requestId: uncertain.requestId, mayHaveCommitted: true,
            reconciliationCode: error.code, reconciliationStatus: error.status, retryable: true });
        }
      }
      if (result.ChecksumSHA256 !== undefined && checksum(result.ChecksumSHA256, result.ChecksumType) !== sha256)
        throw failure('S3_RECOVERY_PUT_CHECKSUM_MISMATCH', { mayHaveCommitted: true });
      try {
        const observed = await head({ ...expected, ...(result.VersionId !== undefined ? { versionId: result.VersionId } : {}),
          ...(result.ETag ? { etag: result.ETag } : {}) });
        const verified = await verifyObject(expected, observed);
        return { created: true, reused: false, ...verified,
          ...(providerToken(result.$metadata?.requestId) ? { putRequestId: providerToken(result.$metadata.requestId) } : {}) };
      } catch (error) {
        const normalized = providerFailure(error, 'S3_RECOVERY_PUT_READBACK_FAILED');
        normalized.mayHaveCommitted = true;
        const requestId = providerToken(result.$metadata?.requestId);
        if (requestId) normalized.putRequestId = requestId;
        throw normalized;
      }
    } finally { await fd.close(); }
  }
  async function list({ prefix = '', cursor, limit = 100, signal } = {}) {
    relativeKey(prefix, { empty: true, prefix: true });
    need(cursor === undefined || safeToken(cursor, 8192), 'Invalid S3 continuation cursor');
    need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, 'S3 inventory limit must be 1–1000');
    const requestedPrefix = config.prefix + prefix;
    need(Buffer.byteLength(requestedPrefix) <= 1024, 'Inventory prefix exceeds S3 byte limit');
    const ctx = context(signal);
    try {
      const result = await request(sdk.ListObjectsV2Command, { ...base(), Prefix: requestedPrefix, MaxKeys: limit,
        ...(cursor !== undefined ? { ContinuationToken: cursor } : {}) }, ctx.signal);
      if (result.Contents !== undefined && !Array.isArray(result.Contents) || (result.Contents?.length ?? 0) > limit ||
        typeof result.IsTruncated !== 'boolean') throw failure('S3_RECOVERY_INVENTORY_INVALID');
      const seen = new Set();
      const objects = (result.Contents ?? []).map(item => {
        if (typeof item.Key !== 'string' || !item.Key.startsWith(requestedPrefix) ||
          !Number.isSafeInteger(item.Size) || item.Size < 0 || item.Size > MAX_BYTES)
          throw failure('S3_RECOVERY_INVENTORY_INVALID');
        const key = item.Key.slice(config.prefix.length);
        relativeKey(key, { prefix: true });
        if (seen.has(key)) throw failure('S3_RECOVERY_INVENTORY_INVALID');
        seen.add(key);
        const modified = item.LastModified instanceof Date ? item.LastModified : new Date(item.LastModified);
        if (!Number.isFinite(modified.getTime())) throw failure('S3_RECOVERY_INVENTORY_INVALID');
        return { key, bytes: item.Size, lastModified: modified.toISOString(), ...(safeToken(item.ETag) ? { etag: item.ETag } : {}) };
      });
      const nextCursor = result.IsTruncated ? result.NextContinuationToken : null;
      if (result.IsTruncated && (!safeToken(nextCursor, 8192) || nextCursor === cursor))
        throw failure('S3_RECOVERY_INVENTORY_CURSOR_INVALID');
      return { objects, nextCursor, ...(providerToken(result.$metadata?.requestId) ?
        { requestId: providerToken(result.$metadata.requestId) } : {}) };
    } finally { ctx.finish(); }
  }
  const close = () => {
    if (closed) return;
    closed = true;
    for (const [controller, finish] of active) { controller.abort(failure('S3_RECOVERY_STORE_CLOSED')); finish(); }
    if (!suppliedClient && typeof client.destroy === 'function') client.destroy();
  };
  return { identity, putImmutable, get, list, close };
}
