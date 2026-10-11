// MIT. Operator configuration for private S3 objects served by the original SF30 runtime.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`Invalid ${label}`);
  return value;
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
};
function keys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError(`Invalid ${label} fields`);
}

/** Private configuration only: HTTP buyers never select a bucket, key or version. */
export function validateS3Config(raw) {
  keys(raw, ['schema', 'region', 'bucket', 'endpoint', 'forcePathStyle', 'allowLocalEndpoint',
    'credentialProvider', 'expectedBucketOwner', 'timeoutMs', 'maxInFlight', 'objects'], 'S3 source');
  if (raw.schema !== 'stellar-forge.s3-source.v1') throw new TypeError('Expected s3-source.v1');
  const region = text(raw.region, 64, 'region');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) throw new TypeError('Invalid region');
  const bucket = text(raw.bucket, 63, 'bucket');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(bucket) || bucket.endsWith('--x-s3'))
    throw new TypeError('Use an ordinary S3 bucket name');
  if (raw.forcePathStyle !== undefined && typeof raw.forcePathStyle !== 'boolean')
    throw new TypeError('forcePathStyle must be boolean');
  if (raw.allowLocalEndpoint !== undefined && typeof raw.allowLocalEndpoint !== 'boolean')
    throw new TypeError('allowLocalEndpoint must be boolean');
  let endpoint;
  if (raw.endpoint !== undefined) {
    const url = new URL(text(raw.endpoint, 2048, 'endpoint'));
    const local = raw.allowLocalEndpoint === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/') throw new TypeError('Endpoint requires an HTTPS origin, or explicitly enabled loopback HTTP');
    endpoint = url.origin;
  } else if (raw.allowLocalEndpoint) throw new TypeError('Local mode requires an explicit endpoint');
  const credentialProvider = raw.credentialProvider ?? 'environment';
  if (!['environment', 'default'].includes(credentialProvider)) throw new TypeError('Invalid credentialProvider');
  if (raw.expectedBucketOwner !== undefined && !/^\d{12}$/.test(raw.expectedBucketOwner))
    throw new TypeError('expectedBucketOwner must be a 12-digit account ID');
  if (!Array.isArray(raw.objects) || raw.objects.length < 1 || raw.objects.length > 64)
    throw new TypeError('Configure 1–64 objects');
  const ids = new Set(), paths = new Set();
  const objects = raw.objects.map((item, index) => {
    keys(item, ['id', 'path', 'key', 'versionId', 'etag', 'expectedBytes', 'sha256', 'mode',
      'maxBytes', 'contentType', 'filename', 'description'], `object ${index}`);
    const id = text(item.id, 64, 'object ID');
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new TypeError('Unique object ID required');
    const path = text(item.path, 256, 'route path');
    if (!/^\/[A-Za-z0-9_.~/-]+$/.test(path) || path.includes('//') || path.startsWith('/_seller/') ||
        new URL(path, 'https://seller.example').pathname !== path || paths.has(path))
      throw new TypeError('Unique canonical fixed route path required');
    const key = text(item.key, 1024, 'object key');
    if (Buffer.byteLength(key) > 1024) throw new TypeError('S3 object key exceeds 1024 UTF-8 bytes');
    const mode = item.mode ?? 'whole';
    if (!['whole', 'chunks'].includes(mode)) throw new TypeError('Invalid delivery mode');
    const maxBytes = integer(item.maxBytes ?? 921600, 1, 1048576, 'object response byte limit');
    const contentType = text(item.contentType ?? 'application/octet-stream', 128, 'content type');
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:; charset=utf-8)?$/.test(contentType))
      throw new TypeError('Invalid content type');
    const filename = text(item.filename ?? `${id}.bin`, 120, 'download filename');
    if (!/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(filename) || filename.endsWith('.') || filename.endsWith(' '))
      throw new TypeError('Download filename must be a portable basename');
    const object = { id, path, key, mode, maxBytes, contentType, filename,
      description: text(item.description ?? `Download ${id}`, 512, 'description') };
    if (own(item, 'versionId')) object.versionId = text(item.versionId, 1024, 'version ID');
    if (own(item, 'etag')) object.etag = text(item.etag, 1024, 'ETag');
    if (own(item, 'expectedBytes')) object.expectedBytes = integer(item.expectedBytes, 0, Number.MAX_SAFE_INTEGER, 'expected bytes');
    if (own(item, 'sha256')) {
      if (mode !== 'whole' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new TypeError('sha256 requires whole mode and lowercase hex');
      object.sha256 = item.sha256;
    }
    ids.add(id); paths.add(path);
    return Object.freeze(object);
  });
  return Object.freeze({ schema: raw.schema, region, bucket, ...(endpoint ? { endpoint } : {}),
    allowLocalEndpoint: raw.allowLocalEndpoint ?? false,
    forcePathStyle: raw.forcePathStyle ?? Boolean(endpoint), credentialProvider,
    ...(raw.expectedBucketOwner ? { expectedBucketOwner: raw.expectedBucketOwner } : {}),
    timeoutMs: integer(raw.timeoutMs ?? 10000, 100, 60000, 'source deadline'),
    maxInFlight: integer(raw.maxInFlight ?? 4, 1, 32, 'source capacity'), objects: Object.freeze(objects) });
}

export async function readS3Config(file) {
  const path = resolve(file), info = await stat(path);
  if (!info.isFile() || info.size > 1048576) throw new TypeError('Source must be a regular JSON file up to 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) throw new TypeError('Source exceeds 1 MiB');
  return validateS3Config(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
