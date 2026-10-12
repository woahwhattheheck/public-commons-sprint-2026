// MIT. The completed result body and its immutable delivery manifest share one HMAC.
import { createHash, createHmac } from 'node:crypto';
export const DELIVERY_SCHEMA = 'stellar-forge.job-result-delivery.v1';
export const RECEIPT_SCHEMA = 'stellar-forge.job-result-received.v1';
export const MAX_RESULT_BYTES = 67108864;
export const MAX_MANIFEST_HEADER_BYTES = 12288;
export const HASH = /^[a-f0-9]{64}$/;
export const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FUNCTION_ID = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
const ISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const deliveryError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw deliveryError(code); };
function shape(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('JRD_MANIFEST_INVALID');
}
function webUrl(value, origin = false) {
  if (typeof value !== 'string' || value.length > 2048) fail('JRD_MANIFEST_URL_INVALID');
  let url; try { url = new URL(value); } catch { fail('JRD_MANIFEST_URL_INVALID'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'https:' || origin && url.protocol === 'http:' && loopback) ||
      url.username || url.password || url.search || url.hash ||
      origin && value !== url.origin || !origin && (url.pathname === '/' || value !== url.href)) fail('JRD_MANIFEST_URL_INVALID');
  return value;
}
/** Destination URL belongs to the identity, so a new recipient cannot inherit an old acknowledgment. */
export function deliveryIdFor(manifest) {
  try {
    return digest(JSON.stringify([DELIVERY_SCHEMA, manifest.merchant.configSha256, manifest.merchant.applicationSha256,
      manifest.merchant.publicOrigin, manifest.destination.id, manifest.destination.url, manifest.job.id, manifest.result.sha256]));
  } catch { fail('JRD_MANIFEST_INVALID'); }
}
export function validateManifest(value) {
  shape(value, ['schema', 'deliveryId', 'merchant', 'destination', 'job', 'nativeSettlement', 'result']);
  if (value.schema !== DELIVERY_SCHEMA || !HASH.test(value.deliveryId ?? '')) fail('JRD_MANIFEST_INVALID');
  shape(value.merchant, ['configSha256', 'applicationSha256', 'publicOrigin']);
  if (!HASH.test(value.merchant.configSha256 ?? '') || !HASH.test(value.merchant.applicationSha256 ?? '')) fail('JRD_MANIFEST_SOURCE_INVALID');
  webUrl(value.merchant.publicOrigin, true);
  shape(value.destination, ['id', 'url']);
  if (!DESTINATION_ID.test(value.destination.id ?? '')) fail('JRD_MANIFEST_DESTINATION_INVALID');
  webUrl(value.destination.url);
  shape(value.job, ['id', 'functionId', 'inputSha256', 'completedAt']);
  if (!JOB_ID.test(value.job.id ?? '') || !FUNCTION_ID.test(value.job.functionId ?? '') ||
      !HASH.test(value.job.inputSha256 ?? '') || !ISO(value.job.completedAt)) fail('JRD_MANIFEST_JOB_INVALID');
  shape(value.nativeSettlement, ['id', 'at']);
  if (!HASH.test(value.nativeSettlement.id ?? '') || !ISO(value.nativeSettlement.at)) fail('JRD_MANIFEST_SETTLEMENT_INVALID');
  shape(value.result, ['sha256', 'bytes', 'contentType', 'filename']);
  const result = value.result;
  if (!HASH.test(result.sha256 ?? '') || !Number.isSafeInteger(result.bytes) || result.bytes < 0 || result.bytes > MAX_RESULT_BYTES ||
      typeof result.contentType !== 'string' || result.contentType.length > 200 ||
      !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+\/[!#$%&'*+.^_\x60|~0-9A-Za-z-]+(?:;[\x20-\x7e]*)?$/.test(result.contentType) ||
      typeof result.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(result.filename)) fail('JRD_MANIFEST_RESULT_INVALID');
  if (deliveryIdFor(value) !== value.deliveryId) fail('JRD_DELIVERY_ID_MISMATCH');
  // Fixed key order permits complete manifest comparison across different JSON encoders.
  return { schema: DELIVERY_SCHEMA, deliveryId: value.deliveryId,
    merchant: { configSha256: value.merchant.configSha256, applicationSha256: value.merchant.applicationSha256, publicOrigin: value.merchant.publicOrigin },
    destination: { id: value.destination.id, url: value.destination.url },
    job: { id: value.job.id, functionId: value.job.functionId, inputSha256: value.job.inputSha256, completedAt: value.job.completedAt },
    nativeSettlement: { id: value.nativeSettlement.id, at: value.nativeSettlement.at },
    result: { sha256: result.sha256, bytes: result.bytes, contentType: result.contentType, filename: result.filename } };
}
export function merchantIdentity(source) {
  if (!plain(source)) fail('JRD_MERCHANT_SOURCE_REQUIRED');
  return { configSha256: source.configSha256, applicationSha256: source.applicationSha256, publicOrigin: source.publicOrigin };
}
export function manifestFor(source, job, destination) {
  if (!plain(job) || job.state !== 'COMPLETED' || !job.nativeSettlement || !job.result) fail('JRD_COMPLETED_PAID_JOB_REQUIRED');
  const manifest = { schema: DELIVERY_SCHEMA, deliveryId: '', merchant: merchantIdentity(source),
    destination: { id: destination.id, url: destination.url },
    job: { id: job.id, functionId: job.functionId, inputSha256: job.inputSha256, completedAt: job.updatedAt },
    nativeSettlement: { id: job.nativeSettlement.id, at: job.nativeSettlement.at },
    result: { sha256: job.result.sha256, bytes: job.result.bytes, contentType: job.result.contentType, filename: job.result.filename } };
  manifest.deliveryId = deliveryIdFor(manifest); return validateManifest(manifest);
}
export function manifestHeaderFor(manifest) {
  const header = Buffer.from(JSON.stringify(validateManifest(manifest))).toString('base64url');
  if (header.length > MAX_MANIFEST_HEADER_BYTES) fail('JRD_MANIFEST_TOO_LARGE');
  return header;
}
export function parseManifestHeader(header) {
  if (typeof header !== 'string' || !header || header.length > MAX_MANIFEST_HEADER_BYTES || !/^[A-Za-z0-9_-]+$/.test(header)) fail('JRD_MANIFEST_HEADER_INVALID');
  const bytes = Buffer.from(header, 'base64url');
  if (bytes.toString('base64url') !== header) fail('JRD_MANIFEST_HEADER_INVALID');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('JRD_MANIFEST_HEADER_INVALID'); }
  return validateManifest(value);
}
export function validateSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024) fail('JRD_SECRET_REQUIRED');
  return secret;
}
export function createSignatureHmac(secret, timestamp, manifestHeader) {
  validateSecret(secret);
  // Timestamp is whole Unix seconds. The receiving clock applies its freshness window.
  if (typeof timestamp !== 'string' || !/^[1-9][0-9]{0,12}$/.test(timestamp)) fail('JRD_TIMESTAMP_INVALID');
  parseManifestHeader(manifestHeader);
  return createHmac('sha256', secret).update(timestamp + '.' + manifestHeader + '.');
}
/** Authenticate the manifest before the receiver accepts or stages any result bytes. */
export function signManifest(secret, timestamp, manifestHeader) {
  validateSecret(secret);
  if (typeof timestamp !== 'string' || !/^[1-9][0-9]{0,12}$/.test(timestamp)) fail('JRD_TIMESTAMP_INVALID');
  parseManifestHeader(manifestHeader);
  return 'sha256=' + createHmac('sha256', secret).update('manifest.' + timestamp + '.' + manifestHeader).digest('hex');
}
/** Returns the expected 32-byte digest for timingSafeEqual after the body stream ends. */
export function parseSignature(header) {
  if (typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(header)) fail('JRD_SIGNATURE_INVALID');
  return Buffer.from(header.slice(7), 'hex');
}
export function acknowledgmentFor(manifest) {
  const value = validateManifest(manifest);
  return { schema: RECEIPT_SCHEMA, deliveryId: value.deliveryId, resultSha256: value.result.sha256, bytes: value.result.bytes, state: 'STORED' };
}
export function validateAcknowledgment(value, manifest) {
  const expected = acknowledgmentFor(manifest);
  if (!plain(value) || Object.entries(expected).some(([key, item]) => value[key] !== item)) fail('JRD_ACKNOWLEDGMENT_MISMATCH');
  return expected;
}
