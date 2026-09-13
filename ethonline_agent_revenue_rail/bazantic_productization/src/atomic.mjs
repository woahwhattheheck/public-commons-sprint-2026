const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/;

export function normalizeAtomicInteger(value, label = 'atomic integer') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} number must be a non-negative safe integer`);
    return String(value);
  }
  if (typeof value !== 'string' || !DECIMAL_UINT.test(value)) throw new TypeError(`${label} must be a canonical non-negative decimal string`);
  return value;
}

export function atomicBigInt(value, label = 'atomic integer') {
  return BigInt(normalizeAtomicInteger(value, label));
}
