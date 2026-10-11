// MIT. Range Stellar intelligence is an application handler, not a payment server.
// The existing SF30 service performs x402 verification and settlement before this runs.
import { createUpstreamHandler } from '../sf30-seller-sdk/upstream-handler.mjs';

const BASE = 'https://api.range.org';
const DEFAULT_PATH = '/v1/address/transactions';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// SEP-23 Ed25519 public account StrKey, including its XModem CRC-16 checksum.
// Deliberately accepts G accounts only for this particular Range operation.
export function isStellarAccount(value) {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) return false;
  const bytes = [];
  let bits = 0, pending = 0;
  for (const char of value) {
    const digit = B32.indexOf(char);
    if (digit < 0) return false;
    pending = (pending << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((pending >>> bits) & 255);
      pending &= (1 << bits) - 1;
    }
  }
  if (bits !== 0 || bytes.length !== 35 || bytes[0] !== 0x30) return false;
  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let n = 0; n < 8; n++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 65535 : (crc << 1) & 65535;
    }
  }
  return bytes[33] === (crc & 255) && bytes[34] === (crc >> 8);
}

function integerParameter(params, name, minimum, maximum) {
  const values = params.getAll(name);
  if (!values.length) return null;
  if (values.length !== 1 || !/^[1-9]\d{0,5}$/.test(values[0])) return `${name.toUpperCase()}_INVALID`;
  const n = Number(values[0]);
  return n < minimum || n > maximum ? `${name.toUpperCase()}_OUT_OF_RANGE` : null;
}

/** Pure, side-effect-free admission used BEFORE the original native payment gate. */
export function validateRangeInput(context) {
  if (context?.method !== 'GET' || !(context?.url instanceof URL)) return 'METHOD_INVALID';
  if (context.url.pathname !== '/range/stellar/address-transactions') return 'ROUTE_INVALID';
  const params = context.url.searchParams;
  const allowed = new Set(['address', 'page', 'limit']);
  for (const name of params.keys()) if (!allowed.has(name)) return 'QUERY_NOT_ALLOWED';
  const addresses = params.getAll('address');
  if (addresses.length !== 1 || !isStellarAccount(addresses[0])) return 'STELLAR_ADDRESS_INVALID';
  return integerParameter(params, 'page', 1, 1000) || integerParameter(params, 'limit', 1, 100);
}

export function admitRangeStellar(context) {
  const problem = validateRangeInput(context);
  return problem === null ? true : {
    status: 400, headers: { 'content-type': 'application/json' }, body: { error: problem },
  };
}

/**
 * Compose the maintained original SF30 upstream transport, no separate HTTP or
 * payment stack. Fixed network=stellar is supplied server-side and cannot be
 * overridden by a buyer. Credential rotation is read only after payment gate.
 * baseUrl/allowLocal exist exclusively for merchant-owned isolated backend runs.
 */
export function createRangeStellarHandler({
  baseUrl = BASE, path = DEFAULT_PATH, allowLocal = false,
  timeoutMs = 10000, maxInFlight = 12, maxResponseBytes = 1048576,
  credential = () => process.env.RANGE_STELLAR_AUTHORIZATION,
} = {}) {
  if (typeof credential !== 'function') throw new TypeError('Credential supplier must be a function');
  const upstream = createUpstreamHandler({
    baseUrl, path, allowLocal, method: 'GET',
    query: ['address', 'page', 'limit', 'network'],
    responseType: 'json', responseHeaders: ['content-type', 'etag'],
    timeoutMs, maxInFlight, maxResponseBytes,
    headers: () => {
      const auth = credential();
      // The merchant sets the *entire* header value through its secret provider.
      if (typeof auth !== 'string' || !/^Bearer [^\s\x00-\x1f\x7f]+$/.test(auth)) {
        throw new TypeError('Range operator credential unavailable');
      }
      return { Authorization: auth };
    },
  });
  const handler = async context => {
    const problem = validateRangeInput(context);
    if (problem !== null) {
      return { status: 400, body: { error: problem } };
    }
    const fixed = new URL(context.url.href);
    fixed.searchParams.set('network', 'stellar');
    return upstream({ ...context, url: fixed });
  };
  handler.snapshot = upstream.snapshot;
  return handler;
}
