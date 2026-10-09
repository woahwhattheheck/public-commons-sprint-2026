// FinalityLens: cross-provider Solana signature evidence, read-only and fail closed.
// A local quorum is a comparison of RPC responses, NOT a cryptographic finality proof.
import { createHash } from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_RESPONSE_BYTES = 262144;
const REQUEST_MS = 7000;

export function encode58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) { out = BASE58_ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const x of bytes) { if (x !== 0) break; out = `1${out}`; }
  return out || '1';
}
export const DEMO_SIGNATURE = encode58(Buffer.alloc(64, 23));

export function validateSignature(value) {
  if (typeof value !== 'string' || value.length < 64 || value.length > 90) throw new Error('Signature must be a Solana base58 Ed25519 signature');
  let n = 0n;
  for (const ch of value) {
    const index = BASE58_ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('Signature contains a non-base58 character');
    n = n * 58n + BigInt(index);
  }
  let size = 0;
  while (n > 0n) { n >>= 8n; size++; }
  for (const ch of value) { if (ch !== '1') break; size++; }
  if (size !== 64) throw new Error('Signature must decode to exactly 64 bytes');
  return value;
}

export function parseProviders(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Set FINALITY_RPC_URLS to at least two distinct Solana HTTPS RPC URLs, separated by commas');
  const strings = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (strings.length < 2 || strings.length > 5) throw new Error('Provide between 2 and 5 independent RPC endpoints');
  const hosts = new Set();
  return strings.map((value, i) => {
    let url;
    try { url = new URL(value); } catch { throw new Error(`RPC ${i + 1}: invalid endpoint URL`); }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error(`RPC ${i + 1}: HTTPS required for non-local endpoints`);
    if (url.username || url.password || url.hash) throw new Error(`RPC ${i + 1}: embedded credentials/fragments not supported`);
    if (hosts.has(url.hostname.toLowerCase())) throw new Error('RPC endpoints must have distinct hostnames (not independent aliases on one host)');
    hosts.add(url.hostname.toLowerCase());
    return { id: `rpc-${i + 1}`, label: url.hostname, url: url.href };
  });
}

async function readBoundedJson(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const len = Number(response.headers.get('content-length'));
  if (Number.isFinite(len) && len > limit) throw new Error('RPC payload exceeds safety limit');
  if (!response.body) throw new Error('RPC body unavailable');
  const reader = response.body.getReader();
  const parts = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('RPC streaming payload exceeds safety limit');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let obj;
  try { obj = JSON.parse(Buffer.concat(parts.map(p => Buffer.from(p))).toString('utf8')); }
  catch { throw new Error('RPC returned malformed JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('Invalid RPC JSON envelope');
  if (obj.error) throw new Error(`RPC JSON error code ${Number.isSafeInteger(obj.error.code) ? obj.error.code : 'unknown'}`);
  if (!Object.hasOwn(obj, 'result')) throw new Error('RPC result missing');
  return obj.result;
}

export async function rpc(provider, method, params, opts = {}) {
  const { fetchImpl = fetch, timeoutMs = REQUEST_MS } = opts;
  // The provider URL is never included in thrown error text or sent to browsers.
  const response = await fetchImpl(provider.url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store'
  });
  return readBoundedJson(response);
}

function jsonErrFingerprint(value) {
  if (value == null) return 'none';
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export async function queryProvider(provider, signature, opts = {}) {
  const evidence = { id: provider.id, label: provider.label, verdict: 'UNAVAILABLE', slot: null, confirmation: null, blockhash: null, errFingerprint: null, detail: '' };
  try {
    const statuses = await rpc(provider, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }], opts);
    const status = statuses?.value?.[0];
    if (!status) return { ...evidence, verdict: 'MISSING', detail: 'Provider has no signature status' };
    if (!Number.isSafeInteger(status.slot) || status.slot < 0) throw new Error('Invalid signature-status slot');
    evidence.slot = status.slot;
    evidence.confirmation = status.confirmationStatus ?? null;
    if (status.err != null) return { ...evidence, verdict: 'EXECUTION_ERROR', errFingerprint: jsonErrFingerprint(status.err), detail: 'Provider reports transaction error' };
    if (status.confirmationStatus !== 'finalized') return { ...evidence, verdict: 'PENDING', detail: 'Provider does not report finalized commitment' };

    const tx = await rpc(provider, 'getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }], opts);
    if (!tx) return { ...evidence, verdict: 'INCOMPLETE', detail: 'Finalized status, but transaction not available from provider' };
    if (!Number.isSafeInteger(tx.slot) || tx.slot !== status.slot) return { ...evidence, verdict: 'INCONSISTENT', detail: 'Transaction and status slots differ' };
    if (tx.meta?.err != null) return { ...evidence, verdict: 'INCONSISTENT', errFingerprint: jsonErrFingerprint(tx.meta.err), detail: 'Status succeeded but transaction meta reports error' };
    if (!Array.isArray(tx.transaction?.signatures) || !tx.transaction.signatures.includes(signature)) return { ...evidence, verdict: 'INCONSISTENT', detail: 'Queried signature missing from transaction record' };
    const blockhash = tx.transaction?.message?.recentBlockhash;
    if (typeof blockhash !== 'string' || blockhash.length < 32 || blockhash.length > 48) return { ...evidence, verdict: 'INCOMPLETE', detail: 'Transaction blockhash unavailable' };
    return { ...evidence, verdict: 'VERIFIED', blockhash, detail: 'Finalized status and matching transaction record' };
  } catch (error) {
    let detail = 'Provider request failed, timed out or returned unsupported payload';
    // Network library errors can disclose secret-bearing endpoint URLs; do not forward them.
    if (typeof error?.message === 'string' && /^(RPC HTTP|RPC JSON|RPC result|Invalid RPC JSON|RPC body|RPC payload|RPC streaming|RPC returned malformed|Invalid signature-status)/.test(error.message)) detail = error.message.slice(0, 140);
    return { ...evidence, verdict: 'UNAVAILABLE', detail };
  }
}

export function classify(evidence) {
  if (!Array.isArray(evidence) || evidence.length < 2) throw new Error('At least two independent provider results required');
  const verified = evidence.filter(x => x.verdict === 'VERIFIED');
  const err = evidence.filter(x => x.verdict === 'EXECUTION_ERROR');
  if (verified.length && err.length) return { verdict: 'CONFLICT', reason: 'Providers disagree on successful versus failed execution' };
  if (verified.length > 1 && verified.some(x => x.slot !== verified[0].slot || x.blockhash !== verified[0].blockhash)) return { verdict: 'CONFLICT', reason: 'Verified providers report different transaction slots or blockhashes' };
  if (verified.length === evidence.length) return { verdict: 'AGREED_FINALIZED', reason: 'All independent RPC providers reported matching finalized, successful transaction records' };
  if (err.length === evidence.length && err.every(x => x.errFingerprint === err[0].errFingerprint)) return { verdict: 'AGREED_EXECUTION_ERROR', reason: 'All RPC providers report a matching execution failure (not a payment)' };
  if (evidence.every(x => x.verdict === 'MISSING' || x.verdict === 'PENDING')) return { verdict: 'PENDING', reason: 'No provider has supplied sufficient finalized transaction evidence' };
  return { verdict: 'INDETERMINATE', reason: 'Incomplete or inconsistent provider observations; not safe to assert finalized success' };
}

function syntheticProvider(id, label, verdict, slot = null, blockhash = null, detail = 'Synthetic fixture — not a real network observation') {
  return { id, label, verdict, slot, confirmation: verdict === 'VERIFIED' ? 'finalized' : null, blockhash, errFingerprint: null, detail };
}
const DEMO_HASH_A = encode58(Buffer.alloc(32, 7));
const DEMO_HASH_B = encode58(Buffer.alloc(32, 8));
export function demoEvidence(scenario = 'aligned') {
  const presets = {
    aligned: [syntheticProvider('rpc-1', 'mock-provider-a', 'VERIFIED', 280150001, DEMO_HASH_A), syntheticProvider('rpc-2', 'mock-provider-b', 'VERIFIED', 280150001, DEMO_HASH_A)],
    pending: [syntheticProvider('rpc-1', 'mock-provider-a', 'PENDING', 280150001), syntheticProvider('rpc-2', 'mock-provider-b', 'MISSING')],
    divergent: [syntheticProvider('rpc-1', 'mock-provider-a', 'VERIFIED', 280150001, DEMO_HASH_A), syntheticProvider('rpc-2', 'mock-provider-b', 'VERIFIED', 280150002, DEMO_HASH_B)],
    outage: [syntheticProvider('rpc-1', 'mock-provider-a', 'VERIFIED', 280150001, DEMO_HASH_A), syntheticProvider('rpc-2', 'mock-provider-b', 'UNAVAILABLE')]
  };
  if (!Object.hasOwn(presets, scenario)) throw new Error('Unknown demonstration scenario');
  return presets[scenario];
}

export async function checkSignature(signature, { providers, demo = false, scenario = 'aligned', fetchImpl, observedAt = new Date().toISOString() } = {}) {
  validateSignature(signature);
  if (demo && signature !== DEMO_SIGNATURE) throw new Error('Synthetic demonstration requires the packaged demonstration signature');
  if (!demo && (!Array.isArray(providers) || providers.length < 2)) throw new Error('Two RPC providers required');
  const evidence = demo ? demoEvidence(scenario) : await Promise.all(providers.map(p => queryProvider(p, signature, { fetchImpl })));
  const assessment = classify(evidence);
  return { schema: 'finalitylens-evidence-v1', observedAt, mode: demo ? 'SYNTHETIC_DEMO' : 'LIVE_READ_ONLY', signature, assessment, providers: evidence,
    caveat: 'Independent RPC agreement is observational evidence, not a consensus proof or guarantee of irreversible settlement. Do not release funds based solely on this tool.' };
}
