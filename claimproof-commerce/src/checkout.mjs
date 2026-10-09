import {InputError} from './core.mjs';
import {CaptureOutcomeUnknown} from './paypal.mjs';

// Per-review, per-process only. Distinct operations do not queue hidden payment writes.
const flights = new WeakMap();
const terminal = new Set(['CAPTURED','CAPTURE_FAILED','CAPTURE_REVERSED','ORDER_VOIDED']);
function applyCapture(review,capture) {
  const states = {
    COMPLETED:'CAPTURED',PENDING:'CAPTURE_PENDING',UNKNOWN:'CAPTURE_UNKNOWN',
    DECLINED:'CAPTURE_FAILED',DENIED:'CAPTURE_FAILED',FAILED:'CAPTURE_FAILED',
    REFUNDED:'CAPTURE_REVERSED',PARTIALLY_REFUNDED:'CAPTURE_REVERSED',VOIDED:'ORDER_VOIDED'
  };
  if (states[capture.status]) review.state = states[capture.status];
  // APPROVED after a timed-out POST does not establish that retrying is safe.
  review.captureStatus = capture.status;
  return {state:review.state,order_id:review.order.order_id,capture_status:capture.status,payment_authority:false};
}
export function checkout(review,operation,request,paypal,base) {
  if (request.fingerprint !== review.cart.fingerprint) throw new InputError('approved cart fingerprint mismatch');
  if (!['create','capture','status'].includes(operation)) throw new InputError('unknown checkout operation');
  if (operation !== 'status' && request.confirm !== true) throw new InputError('explicit human confirmation required');
  const running = flights.get(review);
  if (running) {
    if (running.operation !== operation) throw new InputError('another checkout operation is in progress');
    return running.promise;
  }
  const promise = Promise.resolve().then(async()=>{
    if (operation === 'create') {
      if (!['REVIEWED','ORDER_CREATED'].includes(review.state)) throw new InputError('order creation not allowed in this state');
      if (review.state === 'REVIEWED') {
        review.order = await paypal.create(review.cart,base,review.createRequestId);
        review.state = 'ORDER_CREATED';
      }
      return {state:review.state,order:review.order,payment_authority:false};
    }
    if (!review.order) throw new InputError('no order awaits approval');
    if (operation === 'status' || ['CAPTURE_PENDING','CAPTURE_UNKNOWN'].includes(review.state)) {
      return applyCapture(review,await paypal.captureStatus(review.order.order_id,review.cart));
    }
    if (terminal.has(review.state)) {
      return {state:review.state,order_id:review.order.order_id,capture_status:review.captureStatus,payment_authority:false};
    }
    if (review.state !== 'ORDER_CREATED') throw new InputError('capture not allowed in this state');
    try {
      return applyCapture(review,await paypal.captureApproved(review.order.order_id,review.cart,review.captureRequestId));
    } catch (error) {
      if (error instanceof CaptureOutcomeUnknown) review.state = 'CAPTURE_UNKNOWN';
      throw error;
    }
  }).finally(()=>{if (flights.get(review)?.promise === promise) flights.delete(review);});
  flights.set(review,{operation,promise});
  return promise;
}
