import { fail } from './json.mjs';

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function assertExactKeys(obj, keys, code = 'UNKNOWN_FIELD') {
  if (!isObj(obj)) fail('OBJECT_REQUIRED');
  const allowed = new Set(keys);
  for (const key of Object.keys(obj)) if (!allowed.has(key)) fail(code, key);
  for (const key of keys) if (!has(obj, key)) fail('MISSING_FIELD', key);
}

export function assertString(value, code, max = 200) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(code);
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

export function rejectSensitive(value, code = 'SENSITIVE_DURABLE_TEXT') {
  const candidates = [value];
  let decoded = value;
  for (let round = 0; round < 2; round += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      candidates.push(next);
      decoded = next;
    } catch {
      break;
    }
  }
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/u.test(candidate)) fail(code);
    if (/(?:^|[^a-z0-9])(?:sk-|ghp_|github_pat_|akia)[a-z0-9_\-]{6,}/iu.test(candidate)) fail(code);
    if (/begin\s+(?:rsa\s+)?private\s+key/iu.test(candidate)) fail(code);
    if (/(?:password|passwd|secret|token|api[_-]?key)\s*[:=]/iu.test(lower)) fail(code);
    if (/^(?:mailto|tel|sms):/iu.test(candidate)) fail(code);
  }
  return value;
}

export function assertOpaqueId(value, code = 'INVALID_ID') {
  assertString(value, code, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value)) fail(code);
  rejectSensitive(value, code);
  return value;
}

export function assertSupplierRef(value) {
  assertString(value, 'INVALID_SUPPLIER_REF', 96);
  if (!/^supplier:[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u.test(value)) fail('INVALID_SUPPLIER_REF');
  rejectSensitive(value, 'INVALID_SUPPLIER_REF');
  return value;
}

export function assertEvidenceRef(value) {
  assertString(value, 'INVALID_EVIDENCE_REF', 240);
  rejectSensitive(value);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._~:/#?&=+%\-]{1,220}$/u.test(value)) fail('INVALID_EVIDENCE_REF');
  return value;
}

export function assertDigest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('INVALID_SHA256');
  return value;
}

export function assertCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)) fail('INVALID_CURRENCY');
  return value;
}

export function assertDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('INVALID_DATE');
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('INVALID_DATE');
  return value;
}

export function assertUtc(value, code = 'INVALID_TIMESTAMP') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) fail(code);
  const d = new Date(value);
  if (!Number.isFinite(d.getTime()) || d.toISOString().replace('.000Z', 'Z') !== value) fail(code);
  return value;
}

export function assertSignedMinor(value, code = 'INVALID_MINOR_AMOUNT') {
  if (typeof value !== 'number' || typeof value === 'boolean' || !Number.isSafeInteger(value)) fail(code);
  return value;
}

export function assertPositiveInt(value, code) {
  if (typeof value !== 'number' || typeof value === 'boolean' || !Number.isInteger(value) || value < 0) fail(code);
  return value;
}

export function canonicalDocumentRef(value) {
  assertString(value, 'INVALID_DOCUMENT_REF', 96);
  rejectSensitive(value);
  if (value !== value.trim()) fail('INVALID_DOCUMENT_REF');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/ \-]{0,95}$/u.test(value)) fail('INVALID_DOCUMENT_REF');
  return value.replace(/\s+/gu, ' ').toUpperCase();
}

export function checkedAddSigned(values, code = 'MONEY_OVERFLOW') {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) fail(code);
  return Number(total);
}

export function safeSignedAdd(values) { return checkedAddSigned(values); }
export function canonicalRef(value) { return canonicalDocumentRef(value); }

export function daysBetween(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let mismatch = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i] && ++mismatch > 1) return false;
    return true;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0; let j = 0; let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i += 1; j += 1; continue; }
    if (skipped) return false;
    skipped = true; j += 1;
  }
  return true;
}
