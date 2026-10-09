/** DisputeLedger: evidence-aware, read-only PayPal sandbox dispute analysis. */
const CASE_ID = /^[A-Za-z0-9-]{8,48}$/;
const FIELDS = ['delivery', 'refund', 'order_record', 'merchant_terms', 'buyer_messages'];
const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ['delivery', 'buyer_messages', 'order_record'],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ['merchant_terms', 'buyer_messages', 'order_record'],
  UNAUTHORISED: ['order_record', 'buyer_messages'],
  UNAUTHORIZED_TRANSACTION: ['order_record', 'buyer_messages'],
  CREDIT_NOT_PROCESSED: ['refund', 'buyer_messages', 'order_record'],
  DUPLICATE_TRANSACTION: ['order_record', 'refund'],
  INCORRECT_AMOUNT: ['order_record', 'refund'],
};
export const SAMPLE = Object.freeze({
  dispute_id: 'DEMO-PP-D-001',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: {currency_code: 'USD', value: '49.00'},
  create_time: '2026-10-01T14:00:00Z',
  update_time: '2026-10-08T14:00:00Z',
  disputed_transactions: [{seller_transaction_id: 'DEMO-TXN-NOT-REAL'}]
});
function clean(value, max=130) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').slice(0,max) : '';
}
export function validId(id) { return typeof id === 'string' && CASE_ID.test(id); }
export function normalizeCase(raw, demo=false) {
  if (!raw || !validId(raw.dispute_id)) throw Error('PayPal dispute identity missing or invalid');
  const amt = raw.dispute_amount || {};
  const value = typeof amt.value === 'string' && /^\d{1,9}(?:\.\d{1,2})?$/.test(amt.value) ? amt.value : null;
  const currency = typeof amt.currency_code === 'string' && /^[A-Z]{3}$/.test(amt.currency_code) ? amt.currency_code : null;
  return Object.freeze({
    dispute_id: raw.dispute_id,
    reason: clean(raw.reason,90) || 'UNSPECIFIED',
    status: clean(raw.status,90) || 'UNKNOWN',
    stage: clean(raw.dispute_life_cycle_stage,90) || 'UNKNOWN',
    amount: value, currency,
    opened_at: clean(raw.create_time,35) || null,
    updated_at: clean(raw.update_time,35) || null,
    disputed_transaction_count: Array.isArray(raw.disputed_transactions) ? raw.disputed_transactions.length : 0,
    source: demo ? 'SYNTHETIC_DEMO' : 'PAYPAL_SANDBOX_API',
    provider_verified: !demo,
    payment_verified: false,
    evidence_submitted: false
  });
}
export function preparePacket(entry, evidence) {
  if (!entry || !validId(entry.dispute_id)) throw Error('Select a fetched dispute first');
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      Object.keys(evidence).some(x => !FIELDS.includes(x)) ||
      Object.values(evidence).some(x => typeof x !== 'boolean')) throw Error('Evidence flags invalid');
  const recorded = Object.fromEntries(FIELDS.map(x => [x, evidence[x] === true]));
  const relevant = REASONS[entry.reason] || FIELDS;
  const gaps = relevant.filter(x => !recorded[x]);
  const supplied = relevant.filter(x => recorded[x]);
  return {
    packet_type: 'disputeledger-draft-v1', created_at: new Date().toISOString(),
    case: entry, source: entry.source, synthetic: !entry.provider_verified,
    marked_available: supplied, needs_human_evidence: gaps,
    flags: recorded, submissions_performed: 0, refund_actions_performed: 0,
    review_status: 'DRAFT_ONLY',
    notice: 'Evidence checkboxes are operator assertions, not verified documents. Confirm each item and applicable PayPal submission requirements. Nothing has been filed or paid.'
  };
}
export function modelFacts(packet) {
  // No customer identifiers, transaction IDs, notes, documents or merchant messages.
  return {
    reason:packet.case.reason,status:packet.case.status,stage:packet.case.stage,
    amount:packet.case.amount,currency:packet.case.currency,
    available_categories:packet.marked_available,
    missing_categories:packet.needs_human_evidence,
    is_synthetic:packet.synthetic
  };
}
