// MIT. Complete original feed delivery identity; usable by a receiving client alone.
import { createHash } from 'node:crypto';
export const FEEDS_DELIVERY_SCHEMA = 'stellar-forge.feeds-delivery.v1';
export const FEEDS_MANIFEST_NAME = 'feed-delivery.json';
export const MAX_FEEDS_DELIVERY_BYTES = 1536 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/, NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw Object.assign(new Error(message), { code: 'FEEDS_DELIVERY_MANIFEST' }); };
export function parseFeedsDeliveryManifest(bytes, exportId) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65000) fail('Select the complete original feed delivery manifest.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('The retained feed delivery manifest is not valid UTF-8 JSON.'); }
  if (!plain(value) || value.schema !== FEEDS_DELIVERY_SCHEMA || !SHA.test(value.exportId ?? '') ||
      value.exportId !== exportId || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace ?? '') ||
      typeof value.kind !== 'string' || !plain(value.selection) || !Array.isArray(value.files) || !value.files.length || value.files.length > 64)
    fail('The original feed delivery has an invalid identity or file inventory.');
  const seen = new Set(); let total = 0;
  for (const file of value.files) {
    if (!plain(file) || !NAME.test(file.name ?? '') || file.name === FEEDS_MANIFEST_NAME ||
        ['request.json','lease.lock'].includes(file.name) || seen.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !SHA.test(file.sha256 ?? '') ||
        typeof file.contentType !== 'string' || /[\x00-\x1f\x7f]/.test(file.contentType))
      fail('The original feed file inventory contains an invalid or repeated member.');
    seen.add(file.name); total += file.bytes;
    if (!Number.isSafeInteger(total) || total > MAX_FEEDS_DELIVERY_BYTES) fail('This original delivery exceeds the supported 1.5 GiB complete-file limit.');
  }
  return value;
}
export const feedsManifestSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
