// MIT — SF-50: pin a Bazaar-discovered x402 v2 offer before any wallet authorization.
// No signing, transport, settlement, seller attestation, or funds access.
import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reject = reason => ({ ok: false, reason });
const METHODS = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const MONEY_KEYS = ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra'];

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (!object(value)) throw new TypeError('Invalid JSON value');
  const names = Object.keys(value).sort();
  return '{' + names.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function checkedURL(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f\\]/.test(value)) throw new TypeError('Unsafe resource URL');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.href !== value) {
    throw new TypeError('Invalid canonical resource URL');
  }
  return url.href;
}

function termsOf(acceptance) {
  if (!object(acceptance)) throw new TypeError('Payment option required');
  for (const key of ['scheme', 'network', 'asset', 'payTo']) {
    if (typeof acceptance[key] !== 'string' || !acceptance[key] || acceptance[key].length > 512) {
      throw new TypeError(`Invalid ${key}`);
    }
  }
  if (typeof acceptance.amount !== 'string' || !/^[1-9][0-9]*$/.test(acceptance.amount)) {
    throw new TypeError('Atomic amount must be a positive decimal string');
  }
  if (acceptance.amount.length > 78) throw new RangeError('Atomic amount too long');
  const timeout = acceptance.maxTimeoutSeconds === undefined ? null : acceptance.maxTimeoutSeconds;
  if (timeout !== null && (!Number.isSafeInteger(timeout) || timeout <= 0)) throw new TypeError('Invalid timeout');
  const extra = acceptance.extra === undefined ? null : acceptance.extra;
  if (extra !== null && !object(extra)) throw new TypeError('Invalid extra terms');
  const result = {
    scheme: acceptance.scheme, network: acceptance.network, asset: acceptance.asset,
    payTo: acceptance.payTo, amount: acceptance.amount, maxTimeoutSeconds: timeout,
    extra: extra === null ? null : structuredClone(extra)
  };
  if (canonical(result).length > 16384) throw new RangeError('Payment terms too large');
  return result;
}

function identityOf(listing) {
  const url = checkedURL(listing?.resource?.url);
  const input = listing?.extensions?.bazaar?.info?.input;
  if (!object(input)) throw new TypeError('Bazaar discovery input required');
  if (input.type === 'http' && METHODS.has(input.method)) {
    return { resourceURL: url, kind: 'http', method: input.method };
  }
  if (input.type === 'mcp' && typeof input.toolName === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(input.toolName)) {
    return { resourceURL: url, kind: 'mcp', toolName: input.toolName };
  }
  throw new TypeError('Invalid Bazaar HTTP/MCP identity');
}

/**
 * Accepts one REAL BazaarCatalog.list/search record. Selection is a client-local
 * immutable intention, not a provider signature or proof of seller ownership.
 */
export function bindDiscoveryQuote({ listing, acceptanceIndex = 0, observedAtMs = Date.now(), ttlMs = 60000 }) {
  if (!object(listing) || !Array.isArray(listing.accepts) ||
      !Number.isSafeInteger(acceptanceIndex) || acceptanceIndex < 0 || acceptanceIndex >= listing.accepts.length) {
    throw new TypeError('Selected Bazaar payment option missing');
  }
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0 ||
      !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 3600000) {
    throw new RangeError('Invalid observation time or quote TTL');
  }
  const details = {
    version: 1, identity: identityOf(listing), terms: termsOf(listing.accepts[acceptanceIndex]),
    observedAtMs, expiresAtMs: observedAtMs + ttlMs
  };
  if (!Number.isSafeInteger(details.expiresAtMs)) throw new RangeError('Invalid expiry');
  const quote = { ...details, quoteId: digest(details) };
  return Object.freeze({ ...quote, identity: Object.freeze(quote.identity), terms: Object.freeze(quote.terms) });
}

/**
 * Must be called with the actual invocation and actual 402 PaymentRequired before
 * any signer is invoked. Returns only preflight approval + selected x402 terms.
 */
export function reviewPaymentRequired({ quote, paymentRequired, invocation, nowMs = Date.now() }) {
  if (!object(quote) || !object(quote.identity) || !object(quote.terms) ||
      quote.version !== 1 || typeof quote.quoteId !== 'string') return reject('QUOTE_INVALID');
  try {
    const { quoteId, ...rest } = quote;
    if (digest(rest) !== quoteId) return reject('QUOTE_CHANGED');
  } catch { return reject('QUOTE_INVALID'); }
  if (!Number.isSafeInteger(nowMs)) return reject('CLOCK_INVALID');
  if (nowMs < quote.observedAtMs || nowMs >= quote.expiresAtMs) return reject('QUOTE_EXPIRED');
  if (!object(invocation) || invocation.kind !== quote.identity.kind ||
      invocation.resourceURL !== quote.identity.resourceURL) return reject('INVOCATION_RESOURCE_CHANGED');
  if (quote.identity.kind === 'http' && invocation.method !== quote.identity.method) return reject('INVOCATION_METHOD_CHANGED');
  if (quote.identity.kind === 'mcp' && invocation.toolName !== quote.identity.toolName) return reject('INVOCATION_TOOL_CHANGED');
  if (!object(paymentRequired) || paymentRequired.x402Version !== 2 || !Array.isArray(paymentRequired.accepts)) {
    return reject('X402_V2_REQUIRED');
  }
  if (paymentRequired.resource?.url !== quote.identity.resourceURL) return reject('CHALLENGE_RESOURCE_CHANGED');
  const offeredInput = paymentRequired.extensions?.bazaar?.info?.input;
  if (offeredInput !== undefined) {
    if (!object(offeredInput) || offeredInput.type !== quote.identity.kind) return reject('CHALLENGE_TYPE_CHANGED');
    if (quote.identity.kind === 'http' && offeredInput.method !== quote.identity.method) return reject('CHALLENGE_METHOD_CHANGED');
    if (quote.identity.kind === 'mcp' && offeredInput.toolName !== quote.identity.toolName) return reject('CHALLENGE_TOOL_CHANGED');
  }
  let route = false, recipient = false, amount = false;
  for (const offered of paymentRequired.accepts) {
    let terms;
    try { terms = termsOf(offered); } catch { continue; }
    const expected = quote.terms;
    if (terms.scheme !== expected.scheme || terms.network !== expected.network || terms.asset !== expected.asset) continue;
    route = true;
    if (terms.payTo !== expected.payTo) continue;
    recipient = true;
    if (terms.amount !== expected.amount) continue;
    amount = true;
    if (terms.maxTimeoutSeconds !== expected.maxTimeoutSeconds || canonical(terms.extra) !== canonical(expected.extra)) continue;
    // Downstream signers must receive ONLY the payment facts reviewed here.
    // Additional top-level fields in an untrusted 402 are not authorized.
    const accepted = {
      scheme: terms.scheme, network: terms.network, asset: terms.asset,
      payTo: terms.payTo, amount: terms.amount,
    };
    if (Object.hasOwn(offered, 'maxTimeoutSeconds')) accepted.maxTimeoutSeconds = terms.maxTimeoutSeconds;
    if (Object.hasOwn(offered, 'extra')) accepted.extra = structuredClone(terms.extra);
    return { ok: true, quoteId: quote.quoteId, accepted };
  }
  return reject(!route ? 'PAYMENT_ROUTE_CHANGED' : !recipient ? 'RECIPIENT_CHANGED' : !amount ? 'AMOUNT_CHANGED' : 'PAYMENT_TERMS_CHANGED');
}
