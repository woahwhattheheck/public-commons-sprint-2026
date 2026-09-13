import { createHash } from 'node:crypto';

export class ContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

export function contractAssert(condition, code, message = code) {
  if (!condition) throw new ContractError(code, message);
}

function encode(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    contractAssert(Number.isFinite(value), 'NON_FINITE_NUMBER');
    contractAssert(Number.isSafeInteger(value), 'UNSAFE_NUMBER');
    return String(value);
  }
  contractAssert(typeof value !== 'bigint', 'BIGINT_MUST_BE_DECIMAL_STRING');
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  contractAssert(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'NON_PLAIN_OBJECT');
  const keys = Object.keys(value).sort();
  for (const key of keys) contractAssert(value[key] !== undefined, 'UNDEFINED_VALUE');
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(value[key])}`).join(',')}}`;
}

export function canonicalStringify(value) {
  return encode(value);
}

export function digestObject(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function parseDecimalInteger(value, code = 'INVALID_DECIMAL_INTEGER', { min = 0n, maxDigits = 78 } = {}) {
  contractAssert(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), code);
  contractAssert(value.length <= maxDigits, code);
  const parsed = BigInt(value);
  contractAssert(parsed >= min, code);
  return parsed;
}

export function rejectUnknownKeys(object, allowed, code = 'UNKNOWN_FIELD') {
  contractAssert(typeof object === 'object' && object !== null && !Array.isArray(object), code);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) contractAssert(allowedSet.has(key), code, `${code}:${key}`);
}

export function requireString(value, code, { minLength = 1, maxLength = 512, pattern = null } = {}) {
  contractAssert(typeof value === 'string', code);
  contractAssert(value.length >= minLength && value.length <= maxLength, code);
  if (pattern) contractAssert(pattern.test(value), code);
  return value;
}

export function requireBoolean(value, code) {
  contractAssert(typeof value === 'boolean', code);
  return value;
}

export function requireSafeInteger(value, code, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  contractAssert(Number.isSafeInteger(value) && value >= min && value <= max, code);
  return value;
}

export function parseIsoInstant(value, code) {
  requireString(value, code, { maxLength: 64 });
  const millis = Date.parse(value);
  contractAssert(Number.isFinite(millis), code);
  return { millis, iso: new Date(millis).toISOString() };
}
