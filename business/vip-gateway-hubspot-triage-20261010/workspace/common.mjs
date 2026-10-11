import { createHash, randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => sha(canonical(value));
export class WorkspaceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function requireThat(test, code, message, status = 400) { if (!test) throw new WorkspaceError(code, message, status); }
export function text(value, name, max = 160, empty = false) {
  requireThat(typeof value === 'string' && (empty || value.trim()) && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'INVALID_INPUT', `${name} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters`);
  return value.trim();
}
export function integer(value, name, min, max) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `${name} must be an integer from ${min} to ${max}`); return value;
}
export function iso(value, name, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_TIME', `${name} must be an ISO timestamp with an explicit time zone`);
  return new Date(value).toISOString();
}
export function nativeId(value, name = 'native ID', nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  requireThat(typeof value === 'string' && /^\d{1,25}$/.test(value), 'INVALID_NATIVE_ID', `${name} must retain its original numeric string`); return value;
}
export function page(options = {}) {
  return { offset: integer(Number(options.offset ?? 0), 'offset', 0, 1000000), limit: integer(Number(options.limit ?? 50), 'limit', 1, 100) };
}
export function parse(bytes, name = 'JSON') {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new WorkspaceError('INVALID_JSON', `${name} must be valid UTF-8 JSON`); }
}
export function decode64(value, max = 64 * 1024 * 1024) {
  requireThat(typeof value === 'string' && value.length <= Math.ceil(max / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'INVALID_FILE', 'File must be canonical base64 within the upload limit');
  const bytes = Buffer.from(value, 'base64'); requireThat(bytes.length && bytes.length <= max, 'INVALID_FILE', 'File is empty or exceeds the upload limit'); return bytes;
}
export const portableError = error => ({ code: error.code ?? 'OPERATION_FAILED', message: error.message ?? String(error), at: now() });
export function summary(object) {
  if (!object) return object;
  const { config, report, records, details, prepared, approval, sourceFiles, capturedConfig, credentialBinding, providerBinding, ...rest } = object;
  return typeof records === 'number' ? { ...rest, records } : rest;
}
