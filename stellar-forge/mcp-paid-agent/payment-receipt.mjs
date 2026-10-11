/** MIT. Retain the native facilitator receipt across the official MCP wrapper. */
import {AsyncLocalStorage} from 'node:async_hooks';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const RECEIPT_KEY = 'x402/payment-response';
const MAX_RECEIPT_BYTES = 48 * 1024;

/** Compact quote metadata; the complete MCP result retains every original field. */
export function paymentResponseSummary(receipt) {
  if (!plain(receipt)) return null;
  const result = {success:receipt.success === true};
  const limits = {network:128, transaction:256, payer:128, errorReason:512, errorMessage:4096};
  const truncated = [];
  for (const [name, limit] of Object.entries(limits)) {
    if (['errorReason','errorMessage'].includes(name) && receipt[name] === undefined) continue;
    result[name] = typeof receipt[name] === 'string' ? receipt[name].slice(0, limit) : null;
    if (typeof receipt[name] === 'string' && receipt[name].length > limit) truncated.push(name);
  }
  if (truncated.length) result.truncatedFields = truncated;
  return result;
}

/**
 * The native client and official resource server keep their original behavior.
 * Only their returned public SettleResponse is observed. Per-call async context
 * prevents concurrent MCP sessions from receiving another caller's receipt.
 */
export function createSettlementReceiptCapture(facilitator) {
  const context = new AsyncLocalStorage();
  const client = Object.freeze({
    getSupported:(...args) => facilitator.getSupported(...args),
    verify:(...args) => facilitator.verify(...args),
    async settle(...args) {
      const receipt = await facilitator.settle(...args);
      const current = context.getStore();
      if (current) current.receipt = receipt;
      return receipt;
    },
  });
  return Object.freeze({client,
    run:(observation, operation) => context.run(observation, operation),
    attach(result, observation) {
      // An existing SDK receipt is authoritative; preserve the complete result.
      if (!plain(result) || result._meta?.[RECEIPT_KEY] !== undefined ||
          !plain(observation.receipt) || typeof observation.receipt.success !== 'boolean') return result;
      let receipt;
      try {
        const bytes = JSON.stringify(observation.receipt);
        if (Buffer.byteLength(bytes) > MAX_RECEIPT_BYTES) return result;
        receipt = JSON.parse(bytes);
      } catch { return result; }
      // x402/mcp 2.28 returns a new PaymentRequired error on failed settlement
      // and omits this native receipt. Restore metadata without changing that
      // error, invoking a handler again, or calling the facilitator again.
      return {...result, _meta:{...result._meta, [RECEIPT_KEY]:receipt}};
    },
  });
}
