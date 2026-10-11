// MIT. SF86: direct read-only Stellar RPC transfer reconciliation for original SF81 records.
// Complements the original SF82 Stellar CLI verifier; never mutates the SF36 ledger.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// One source also read by the original Python accounting worker. Public RPC
// choices come from Stellar's provider directory, never a seller's receipt.
export const NETWORKS = Object.freeze(Object.fromEntries(Object.entries(
  JSON.parse(readFileSync(new URL('./networks.json', import.meta.url), 'utf8'))
).map(([network, profile]) => [network, Object.freeze({...profile,
  rpcEndpoints:Object.freeze(profile.rpcEndpoints)})])));
export const DEFAULT_RPC = NETWORKS['stellar:testnet'].defaultRpc;
export const TESTNET_RPC_ENDPOINTS = NETWORKS['stellar:testnet'].rpcEndpoints;
export const TESTNET_PASSPHRASE = NETWORKS['stellar:testnet'].passphrase;
const I128MAX = (1n << 127n) - 1n;
const TX = /^[0-9a-f]{64}$/;
const INTENT = /^[A-Za-z0-9._:-]{1,160}$/;
const AMOUNT = /^[1-9][0-9]{0,38}$/;
export const LOCAL_RPC = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/$/;
export class ReconciliationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const requireTruth = (value, code) => { if (!value) throw new ReconciliationError(code); };
export const object = v => v && typeof v === 'object' && !Array.isArray(v);
export const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function networkProfile(network) {
  requireTruth(typeof network === 'string' && Object.hasOwn(NETWORKS, network), 'RPC_NETWORK_NOT_SUPPORTED');
  return NETWORKS[network];
}
export function resolveRpcEndpoint(network, endpoint, {allowLocal = false} = {}) {
  const profile = networkProfile(network);
  const selected = endpoint ?? profile.defaultRpc;
  if (allowLocal && typeof selected === 'string' && LOCAL_RPC.test(selected)) return selected;
  let url;
  try { url = new URL(selected); } catch { throw new ReconciliationError('RPC_ENDPOINT_NOT_ALLOWED'); }
  const known = profile.rpcEndpoints.find(candidate => new URL(candidate).href === url.href);
  requireTruth(known !== undefined, 'RPC_ENDPOINT_NOT_ALLOWED');
  return known;
}

// Exactly the Stellar StrKey version/checksum convention; not only a regex.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(value) {
  if (typeof value !== 'string' || !/^[A-Z2-7]{56}$/.test(value)) return null;
  let bits = 0, acc = 0; const result = [];
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    acc = (acc << 5) | digit; bits += 5;
    if (bits >= 8) { bits -= 8; result.push((acc >>> bits) & 255); }
    acc &= (1 << bits) - 1;
  }
  return bits === 0 || acc === 0 ? Buffer.from(result) : null;
}
function crc16(buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc ^= byte << 8;
    for (let i=0; i<8; i++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function validStrKey(value, type) {
  const b = base32(value);
  if (!b || b.length !== 35 || b[0] !== (type === 'C' ? 16 : type === 'G' ? 48 : -1)) return false;
  const check=crc16(b.subarray(0,33));
  return b[33] === (check & 255) && b[34] === (check >> 8);
}
export function checkOriginalTerms(record, payer) {
  requireTruth(object(record), 'INVALID_SF81_RECORD');
  const { intentId, requirement:q, receipt:r, operatorReservation:p } = record;
  requireTruth(typeof intentId === 'string' && INTENT.test(intentId), 'INVALID_INTENT_ID');
  requireTruth(object(q) && object(r), 'MISSING_NATIVE_TERMS_OR_RECEIPT');
  requireTruth(object(p) && p.schema === 'stellar-forge.sf62.result.v1' &&
    p.outcome === 'FRESH_RESERVATION_APPROVED' && p.request_id === intentId,
  'NO_MATCHING_SF81_RESERVATION');
  requireTruth(q.scheme === 'exact', 'NOT_AN_EXACT_PAYMENT');
  networkProfile(q.network);
  requireTruth(p.network === q.network && p.asset === q.asset &&
    p.reserved_atomic_units === q.amount, 'RESERVED_TERMS_MISMATCH');
  requireTruth(r.network === q.network && (r.success === true ||
    (r.success === false && r.errorReason === 'settlement_pending')),
  'NO_ELIGIBLE_SELLER_TRANSACTION_CLAIM');
  requireTruth(validStrKey(payer,'G'), 'INVALID_TRUSTED_PAYER');
  requireTruth(r.payer === payer, 'RECEIPT_PAYER_MISMATCH');
  requireTruth(validStrKey(q.asset,'C'), 'INVALID_ASSET_STRKEY');
  requireTruth(validStrKey(q.payTo,'G') || validStrKey(q.payTo,'C'), 'INVALID_RECIPIENT');
  requireTruth(typeof q.amount === 'string' && AMOUNT.test(q.amount) &&
    BigInt(q.amount) <= I128MAX, 'INVALID_ATOMIC_AMOUNT');
  requireTruth(r.amount === undefined || r.amount === q.amount, 'RECEIPT_AMOUNT_MISMATCH');
  requireTruth(typeof r.transaction === 'string' && TX.test(r.transaction), 'INVALID_TRANSACTION_HASH');
  return {intentId, requirement:q, receipt:r};
}
