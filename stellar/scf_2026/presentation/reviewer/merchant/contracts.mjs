// MIT. Original purchase-reviewer merchant formats and exact input contracts.
import {createHash} from 'node:crypto';
export const CONNECTION_SCHEMA = 'stellar-forge.grant-reviewer-merchant-connection.v1';
export const EXPORT_SCHEMA = 'stellar-forge.grant-reviewer-merchant-export.v1';
export const MANIFEST_NAME = 'grant-reviewer-manifest.json';
export const TOOL_PREFIX = 'merchant_grant_reviewer_';
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export {MAX_RETAINED_CHUNK_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const SHA = '^[0-9a-f]{64}$';
export const ALIAS = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function failure(code, message = code, details) {
  return Object.assign(new Error(message), {code, ...(details ? {details} : {})});
}
export function need(value, code, message, details) { if (!value) throw failure(code, message, details); }
export function decode(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw failure('GRANT_REVIEWER_JSON_INVALID', 'The original file is not UTF-8 JSON.'); }
}
export function exact(value, allowed, required = []) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'GRANT_REVIEWER_INPUT_INVALID',
  'Use the original declared fields: ' + allowed.join(', ') + '.');
}
export function text(value, label, maximum = 180) {
  need(typeof value === 'string' && value.trim() && value.length <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value), 'GRANT_REVIEWER_INPUT_INVALID', label + ' must be nonempty text without control characters.');
  return value;
}
export function checked(value, pattern, label) {
  need(typeof value === 'string' && new RegExp(pattern).test(value), 'GRANT_REVIEWER_INPUT_INVALID',
    'Use the exact original ' + label + '.'); return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
export function manifestIdentity(value) {
  const copy = {...value}; delete copy.exportId;
  return digest(Buffer.from(JSON.stringify(canonical(copy))));
}
export function parseReviewerExport(bytes, expectedId) {
  need(bytes.length <= 65000, 'GRANT_REVIEWER_MANIFEST_INVALID', 'The original manifest exceeds its declared bound.');
  const value = decode(bytes);
  exact(value, ['schema','exportId','workspace','workbenchId','kind','source','files'],
    ['schema','exportId','workspace','workbenchId','kind','source','files']);
  checked(value.exportId, SHA, 'export ID'); checked(value.workspace, ALIAS, 'workspace alias');
  checked(value.workbenchId, UUID, 'workbench ID');
  need(value.schema === EXPORT_SCHEMA && value.exportId === manifestIdentity(value) &&
    (expectedId === undefined || expectedId === value.exportId) && plain(value.source) &&
    ['native-response','source-document','saved-result','reviewer-packet'].includes(value.kind) &&
    Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 4,
  'GRANT_REVIEWER_MANIFEST_INVALID', 'Use the complete original reviewer export manifest.');
  const names = new Set(); let total = 0;
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256','contentType'], ['name','bytes','sha256','contentType']);
    need(typeof file.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file.name) &&
      file.name !== MANIFEST_NAME && !names.has(file.name) && Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 && file.bytes <= MAX_RESPONSE_BYTES, 'GRANT_REVIEWER_MANIFEST_INVALID',
    'Retained files use unique plain names and their complete original byte counts.');
    names.add(file.name); checked(file.sha256, SHA, 'file SHA256'); text(file.contentType, 'Content type', 200);
    total += file.bytes;
  }
  need(total <= MAX_RESPONSE_BYTES + MAX_PACKET_BYTES, 'GRANT_REVIEWER_MANIFEST_INVALID',
    'The complete selected export exceeds its original response and packet limits.');
  return value;
}
export function jsonPointer(value, pointer = '') {
  need(typeof pointer === 'string' && pointer.length <= 4000 && (!pointer || pointer.startsWith('/')),
    'GRANT_REVIEWER_POINTER_INVALID', 'Use an original JSON pointer.');
  for (const bit of pointer ? pointer.slice(1).split('/') : []) {
    need(!/~(?![01])/.test(bit), 'GRANT_REVIEWER_POINTER_INVALID');
    const key = bit.replace(/~1/g, '/').replace(/~0/g, '~');
    need(value !== null && typeof value === 'object' && Object.hasOwn(value, key) &&
      (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/.test(key)),
    'GRANT_REVIEWER_POINTER_NOT_FOUND', 'The pointer is absent from this exact retained response.');
    value = value[key];
  }
  return value;
}
