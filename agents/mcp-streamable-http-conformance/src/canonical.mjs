import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('canonical JSON requires finite non-negative-zero numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON accepts only plain JSON values');
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function scrubSecrets(value, secrets) {
  const needles = [...new Set((secrets ?? []).filter((item) => typeof item === 'string' && item.length >= 4))];
  const scrubString = (text) => needles.reduce((current, secret) => current.split(secret).join('[REDACTED]'), text);
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, needles));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubSecrets(item, needles)]));
  return value;
}
