import { sha256Hex } from './canonical.mjs';
import { normalizeAtomicInteger } from './atomic.mjs';
import { exact, normalizeHttpsUrl, nullableSha, nullableString, sha, validateBinding } from './recipe-authority.mjs';

export const LANE_A_SCHEMA = 'agent-revenue-rail/lane-a-settlement-receipt/v1';
export const HEDERA_TESTNET = 'hedera:testnet';
export const HBAR_TOKEN_ID = '0.0.0';
const PURCHASE_STATES = new Set(['SETTLED', 'PAYMENT_REQUIRED', 'FAILED']);

export function validateLaneAReceipt(receipt, binding) {
  validateBinding(binding, 'authority.laneA');
  exact(receipt, [
    'schema', 'state', 'httpStatus', 'network', 'asset', 'amountTinybar', 'serviceUrl',
    'upstreamVerified', 'txHash', 'paymentRequirementDigest', 'serviceResponseDigest',
    'reportPayloadDigest', 'reason', 'receiptDigest',
  ], [], 'laneAReceipt');
  if (receipt.schema !== LANE_A_SCHEMA) throw new TypeError(`laneAReceipt.schema must be ${LANE_A_SCHEMA}`);
  if (!PURCHASE_STATES.has(receipt.state)) throw new TypeError('laneAReceipt.state is invalid');
  if (!Number.isInteger(receipt.httpStatus) || receipt.httpStatus < 100 || receipt.httpStatus > 599) throw new TypeError('laneAReceipt.httpStatus is invalid');
  if (receipt.network !== HEDERA_TESTNET) throw new TypeError(`laneAReceipt.network must be ${HEDERA_TESTNET}`);
  if (receipt.asset !== HBAR_TOKEN_ID) throw new TypeError(`laneAReceipt.asset must be ${HBAR_TOKEN_ID}`);
  const amountTinybar = normalizeAtomicInteger(receipt.amountTinybar, 'laneAReceipt.amountTinybar');
  const serviceUrl = normalizeHttpsUrl(receipt.serviceUrl, 'laneAReceipt.serviceUrl');
  if (typeof receipt.upstreamVerified !== 'boolean') throw new TypeError('laneAReceipt.upstreamVerified must be boolean');
  nullableString(receipt.txHash, 'laneAReceipt.txHash');
  nullableSha(receipt.paymentRequirementDigest, 'laneAReceipt.paymentRequirementDigest');
  nullableSha(receipt.serviceResponseDigest, 'laneAReceipt.serviceResponseDigest');
  nullableSha(receipt.reportPayloadDigest, 'laneAReceipt.reportPayloadDigest');
  nullableString(receipt.reason, 'laneAReceipt.reason');
  sha(receipt.receiptDigest, 'laneAReceipt.receiptDigest');
  const { receiptDigest, ...core } = receipt;
  if (sha256Hex(core) !== receiptDigest) throw new TypeError('laneAReceipt.receiptDigest mismatch');
  if (receiptDigest !== binding.expectedReceiptDigest) throw new TypeError('laneAReceipt is not the out-of-band retained receipt');

  if (receipt.state === 'PAYMENT_REQUIRED') {
    if (receipt.httpStatus !== 402) throw new TypeError('PAYMENT_REQUIRED must bind exact HTTP 402');
    if (receipt.upstreamVerified !== false || receipt.txHash !== null || receipt.serviceResponseDigest !== null || receipt.reportPayloadDigest !== null) throw new TypeError('PAYMENT_REQUIRED cannot carry settlement/report authority');
    if (receipt.paymentRequirementDigest === null) throw new TypeError('PAYMENT_REQUIRED requires paymentRequirementDigest');
  } else if (receipt.state === 'FAILED') {
    if (receipt.httpStatus === 402) throw new TypeError('FAILED cannot relabel exact HTTP 402');
    if (receipt.upstreamVerified !== false || receipt.txHash !== null || receipt.serviceResponseDigest !== null || receipt.reportPayloadDigest !== null) throw new TypeError('FAILED cannot carry settlement/report authority');
    if (receipt.reason === null) throw new TypeError('FAILED requires reason');
  } else {
    if (receipt.httpStatus < 200 || receipt.httpStatus >= 300) throw new TypeError('SETTLED requires 2xx service response');
    if (receipt.upstreamVerified !== true || receipt.txHash === null) throw new TypeError('SETTLED requires independently verified transaction evidence');
    if (receipt.serviceResponseDigest === null || receipt.reportPayloadDigest === null) throw new TypeError('SETTLED requires bound service response and report payload digests');
  }
  return { amountTinybar, serviceUrl };
}
