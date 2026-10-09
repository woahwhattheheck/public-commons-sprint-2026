import {InputError} from './core.mjs';

// This is an observation of PayPal sandbox's read-only Orders response,
// not a PayPal-signed receipt and never evidence of a real-money payment.
export function makeSandboxReceipt(review, verified, reviewId, observedAt=new Date().toISOString()) {
  const cart=review?.cart,order=review?.order;
  if(review?.state!=='CAPTURED' || cart?.currency!=='USD' ||
     !/^[a-f0-9]{64}$/.test(cart?.fingerprint||'') ||
     !/^[0-9]+[.][0-9]{2}$/.test(cart?.total||'') ||
     !/^[a-f0-9-]{36}$/.test(reviewId||'') ||
     !/^[A-Za-z0-9]{10,30}$/.test(order?.order_id||'') ||
     verified?.status!=='COMPLETED' || verified?.order_status!=='COMPLETED' ||
     !/^[A-Za-z0-9]{10,30}$/.test(verified?.id||'') ||
     !Number.isFinite(Date.parse(observedAt))) {
    throw new InputError('freshly verified, matching completed PayPal sandbox capture required');
  }
  return Object.freeze({
    record_type:'claimproof-sandbox-capture-observation-v1',
    environment:'PAYPAL_SANDBOX',
    provider:'PayPal Orders v2',
    observed_at:observedAt,
    review_id:reviewId,
    cart_fingerprint:cart.fingerprint,
    amount:{currency_code:'USD',value:cart.total},
    order_id:order.order_id,
    capture_id:verified.id,
    order_status:verified.order_status,
    capture_status:verified.status,
    source:'fresh read-only PayPal sandbox Orders v2 check with matching order, capture, amount and cart fingerprint',
    provider_signed:false,
    live_payment:false,
    payment_authority:false
  });
}
