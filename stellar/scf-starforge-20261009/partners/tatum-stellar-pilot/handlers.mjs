// MIT. Merchant-operated, read-only Tatum Stellar Soroban JSON-RPC data behind original SF30 x402.
// This module does not verify payments, sign transactions or provide a generic RPC proxy.
const ENDPOINT = 'https://stellar-testnet-soroban.gateway.tatum.io/';
const NETWORK = 'stellar:testnet';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const METHODS = Object.freeze({
  latestLedger: 'getLatestLedger',
  feeStats: 'getFeeStats',
  networkInfo: 'getNetwork',
});
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 5000;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const string = (x, length = 256) => typeof x === 'string' && x.length > 0 && x.length <= length;

function requestKey(key) {
  if (!string(key, 1024) || /[\r\n\0]/.test(key)) {
    throw new Error('TATUM_API_KEY not configured');
  }
  return key;
}

async function parseLimited(response) {
  if (response.status !== 200 || !response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Tatum RPC unavailable');
  }
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength && Number(contentLength) > MAX_BYTES) throw new Error('Tatum RPC response too large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid Tatum RPC body');
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Tatum RPC response too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  let envelope;
  try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid Tatum RPC response'); }
  if (!object(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== 1 ||
      !object(envelope.result) || envelope.error !== undefined) {
    throw new Error('Tatum RPC method failed');
  }
  return envelope.result;
}

function selectResult(method, value) {
  if (method === 'getLatestLedger') {
    if (!integer(value.sequence) || !/^[0-9a-f]{64}$/i.test(value.id ?? '') ||
        !integer(value.protocolVersion) || !string(value.closeTime, 64)) {
      throw new Error('Tatum RPC ledger shape changed');
    }
    return { sequence: value.sequence, hash: value.id,
      protocolVersion: value.protocolVersion, closeTime: value.closeTime };
  }
  if (method === 'getFeeStats') {
    if (!integer(value.latestLedger)) throw new Error('Tatum RPC fee shape changed');
    // Fee statistics are returned as original exact values, with a bounded set of fields.
    const copy = { latestLedger: value.latestLedger };
    for (const key of ['ledgerCapacityUsage', 'inclusionFee', 'sorobanInclusionFee']) {
      if (value[key] !== undefined) {
        if (!object(value[key]) || JSON.stringify(value[key]).length > 8192)
          throw new Error('Tatum RPC fee field invalid');
        copy[key] = value[key];
      }
    }
    return copy;
  }
  if (method === 'getNetwork') {
    if (value.passphrase !== PASSPHRASE || !integer(value.protocolVersion)) {
      throw new Error('Tatum RPC network is not Stellar testnet');
    }
    return { passphrase: value.passphrase, protocolVersion: value.protocolVersion };
  }
  throw new TypeError('Unsupported Tatum RPC method');
}

export function createTatumHandlers({ apiKey = () => process.env.TATUM_API_KEY,
  transport = globalThis.fetch } = {}) {
  if (typeof transport !== 'function') throw new TypeError('HTTP transport required');
  const handlers = Object.create(null);
  for (const [name, method] of Object.entries(METHODS)) {
    handlers[name] = async () => {
      // Each call is one paid request already authorized by original SF30 x402.
      // Never embed the API key or raw upstream response into an error message.
      const secret = requestKey(typeof apiKey === 'function' ? apiKey() : apiKey);
      let result;
      try {
        const response = await transport(ENDPOINT, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'content-type': 'application/json', 'accept': 'application/json',
            'x-api-key': secret },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
        });
        result = selectResult(method, await parseLimited(response));
      } catch {
        // No upstream origin, error text, key, raw RPC payload, or request context exposed.
        throw new Error('Stellar data temporarily unavailable');
      }
      return { status: 200, headers: { 'content-type': 'application/json',
        'cache-control': 'no-store' }, body: { provider: 'tatum',
        network: NETWORK, rpcMethod: method, data: result } };
    };
  }
  return handlers;
}

// Names match original seller-service.v1 route.handler exports in generated config.
const defaults = createTatumHandlers();
export const latestLedger = defaults.latestLedger;
export const feeStats = defaults.feeStats;
export const networkInfo = defaults.networkInfo;
