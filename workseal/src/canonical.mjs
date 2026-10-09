import { createHash } from 'node:crypto';
import { isValidRfc3339 } from './rfc3339.mjs';

export class WorkSealError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkSealError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new WorkSealError(code, message);
}

function normalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('UNSAFE_NUMBER', `${path} must be a safe integer`);
    return value;
  }

  if (Array.isArray(value)) {
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail('UNDEFINED_VALUE', `${path}[${index}] is a missing array entry`);
      out.push(normalize(value[index], `${path}[${index}]`));
    }
    return out;
  }

  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    // A JSON key must never invoke Object.prototype.__proto__ while copying.
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail('UNDEFINED_VALUE', `${path}.${key} is undefined`);
      out[key] = normalize(value[key], `${path}.${key}`);
    }
    return out;
  }

  fail('UNSUPPORTED_VALUE', `${path} contains an unsupported value`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : canonicalJson(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertSha256(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('BAD_DIGEST', `${name} must be a lowercase sha256 hex digest`);
  }
  return value;
}

export function assertNonEmptyString(value, name, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail('BAD_STRING', `${name} must be a non-empty string <= ${max} chars`);
  }
  return value;
}

export function assertAtomic(value, name = 'amountAtomic') {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    fail('BAD_ATOMIC_AMOUNT', `${name} must be a positive base-10 integer string`);
  }
  return value;
}

export function assertRfc3339(value, name) {
  if (!isValidRfc3339(value)) {
    fail('BAD_TIMESTAMP', `${name} must be a valid Gregorian RFC3339 timestamp with an explicit timezone`);
  }
  return value;
}
