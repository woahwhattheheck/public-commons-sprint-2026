// MIT. Export payment-specific fields from an actual SF81 call, never Response body or signing keys.
const id = v => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
const approvedFields = ['request_id','actor','service','network','asset','scheme','max_amount',
  'resource','pay_to','max_timeout_seconds','method','body_present','body_bytes',
  'body_sha256','accepted_terms_sha256'];
export function sf81ReconciliationRecord(result) {
  if (!result || !id(result.intentId) || result.attempts !== 2 ||
      !result.requirement || !result.receipt || !result.operatorReservation ||
      !['REPORTED_SUCCESS', 'PENDING'].includes(result.settlement)) {
    throw new TypeError('original paid SF81 result with receipt and reservation required');
  }
  const { requirement: q, receipt: r, operatorReservation: p } = result;
  if (p.schema !== 'stellar-forge.sf62.result.v1' ||
      p.outcome !== 'FRESH_RESERVATION_APPROVED' || p.request_id !== result.intentId ||
      p.network !== q.network || p.asset !== q.asset ||
      p.reserved_atomic_units !== q.amount || r.network !== q.network) {
    throw new TypeError('original SF81 operator reservation/receipt mismatch');
  }
  return {
    intentId: result.intentId,
    requirement: { scheme: q.scheme, network: q.network, asset: q.asset,
      payTo: q.payTo, amount: q.amount },
    receipt: { network: r.network, transaction: r.transaction, payer: r.payer,
      success: r.success, ...(r.amount === undefined ? {} : { amount: r.amount }),
      ...(r.errorReason === undefined ? {} : { errorReason: r.errorReason }) },
    operatorReservation: { schema: p.schema, outcome: p.outcome,
      request_id: p.request_id, network: p.network, asset: p.asset,
      ...(p.request_sha256 === undefined ? {} : {request_sha256:p.request_sha256}),
      ...(p.approved_request === undefined ? {} :
        {approved_request:Object.fromEntries(approvedFields.map(key=>[key,p.approved_request[key]]))}),
      reserved_atomic_units: p.reserved_atomic_units },
  };
}
