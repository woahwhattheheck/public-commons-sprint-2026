import { paypalOrderBody, InputError } from './core.mjs';

const BASE = 'https://api-m.sandbox.paypal.com'; // Intentionally immutable; production account/payment endpoints are not supported.
function assertOrderId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(id)) throw new InputError('invalid PayPal order identifier');
  return id;
}
// Order completion alone does not establish that its capture settled.
function inspectOrder(current, orderId, cart) {
  const unit = Array.isArray(current?.purchase_units) && current.purchase_units.length === 1
    ? current.purchase_units[0] : null;
  if (current?.id !== orderId || current.intent !== 'CAPTURE' || !unit ||
      unit.amount?.currency_code !== 'USD' || unit.amount?.value !== cart.total) {
    throw new InputError('PayPal order identity, intent, or unchanged cart total could not be verified');
  }
  const captures = unit.payments?.captures;
  if (captures !== undefined && (!Array.isArray(captures) || captures.length > 1)) {
    throw new InputError('Unexpected PayPal capture records; manual reconciliation required');
  }
  const capture = captures?.[0];
  if (captures?.length === 1) {
    if (typeof capture?.id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(capture.id) ||
        capture.amount?.currency_code !== 'USD' || capture.amount?.value !== cart.total) {
      throw new InputError('PayPal capture identity or amount mismatch; manual reconciliation required');
    }
    if (['DECLINED','DENIED','FAILED','REFUNDED','PARTIALLY_REFUNDED'].includes(capture.status)) {
      return {status:capture.status,id:capture.id,order_status:current.status,already_captured:true};
    }
    if (capture.status === 'PENDING') return {status:'PENDING',id:capture.id,order_status:current.status};
    if (capture.status === 'COMPLETED' && current.status === 'COMPLETED') {
      return {status:'COMPLETED',id:capture.id,order_status:current.status,already_captured:true};
    }
    throw new InputError('PayPal capture is not verified as settled or pending; check the sandbox order');
  }
  if (current.status === 'VOIDED') return {status:'VOIDED',order_status:current.status};
  if (!['CREATED','SAVED','APPROVED','PAYER_ACTION_REQUIRED'].includes(current.status)) {
    throw new InputError('PayPal order lacks a verified matching capture; manual reconciliation required');
  }
  return {status:'NOT_CAPTURED',order_status:current.status};
}
export class PayPalSandbox {
  constructor({clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET, transport = fetch} = {}) {
    this.id = clientId; this.secret = secret; this.transport = transport;
    this.token = null; this.tokenUntil = 0; this.tokenRequest = null;
  }
  async accessToken() {
    if (!this.id || !this.secret) throw new InputError('PayPal sandbox credentials are not configured');
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    if (this.tokenRequest) return this.tokenRequest;
    const requestedAt = Date.now();
    const pending = (async () => {
      const basic = Buffer.from(`${this.id}:${this.secret}`).toString('base64');
      const result = await this.transport(`${BASE}/v1/oauth2/token`, {
        method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},
        body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)
      });
      if (!result.ok) throw new Error(`PayPal sandbox authentication HTTP ${result.status}`);
      const data = await result.json();
      if (!data.access_token || typeof data.access_token !== 'string') throw new Error('PayPal sandbox did not return access token');
      // Cache only an explicit lifetime, measured from request start with expiry slack.
      const lifetime = typeof data.expires_in === 'number' ? data.expires_in * 1000 : 0;
      if (Number.isFinite(lifetime) && lifetime > 0) {
        this.token = data.access_token;
        this.tokenUntil = requestedAt + lifetime - Math.min(30000, lifetime / 10);
      }
      return data.access_token;
    })();
    this.tokenRequest = pending;
    try { return await pending; }
    finally { if (this.tokenRequest === pending) this.tokenRequest = null; }
  }
  async api(path,{method='GET',body,requestId}={}) {
    const token = await this.accessToken();
    const headers = {Authorization:`Bearer ${token}`,Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await this.transport(`${BASE}${path}`,{
      method,headers,...(body !== undefined ? {body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)
    });
    if (res.status === 401 && this.token === token) { this.token = null; this.tokenUntil = 0; }
    // Never replay an order/capture mutation automatically after an auth or transport error.
    if (!res.ok) throw new Error(`PayPal sandbox ${path.split('/').slice(0,4).join('/')} HTTP ${res.status}`);
    return res.json();
  }
  async create(cart,callback,requestId) {
    if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new InputError('invalid idempotency id');
    const created = await this.api('/v2/checkout/orders',{method:'POST',body:paypalOrderBody(cart,callback),requestId});
    const approve = created.links?.find(x => x.rel === 'payer-action' || x.rel === 'approve')?.href;
    if (!created.id || !approve || !/^https:\/\/[a-z0-9.-]*paypal\.com\//i.test(approve)) throw new Error('No authentic PayPal sandbox approval link returned');
    assertOrderId(created.id);
    if (new URL(approve).hostname !== 'www.sandbox.paypal.com' && new URL(approve).hostname !== 'sandbox.paypal.com') throw new Error('unexpected PayPal approval host');
    return {order_id:created.id,approval_url:approve,status:created.status};
  }
  async get(orderId) { return this.api(`/v2/checkout/orders/${assertOrderId(orderId)}`); }
  async captureStatus(orderId,cart) {
    const verifiedId = assertOrderId(orderId);
    return inspectOrder(await this.get(verifiedId), verifiedId, cart);
  }
  async captureApproved(orderId,cart,requestId) {
    if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new InputError('invalid idempotency id');
    const verifiedId = assertOrderId(orderId);
    const current = await this.captureStatus(verifiedId,cart);
    // A prior capture can be pending even when the order itself says COMPLETED.
    if (current.status !== 'NOT_CAPTURED') return current;
    if (current.order_status !== 'APPROVED') {
      throw new InputError('PayPal has not confirmed APPROVED state; capture was not requested');
    }
    try {
      await this.api(`/v2/checkout/orders/${verifiedId}/capture`,{method:'POST',body:{},requestId});
      // Capture responses may be minimal. Re-read the authoritative order rather than
      // treating HTTP success or the outer order status as a verified settlement.
      const settled = await this.captureStatus(verifiedId,cart);
      return settled.status === 'NOT_CAPTURED' ? {...settled,status:'UNKNOWN'} : {...settled,already_captured:false};
    } catch {
      // Once POST may have left, an error cannot establish that no payment happened.
      // Keep this review read-only even if a later GET still shows APPROVED.
      return {status:'UNKNOWN',order_status:'UNKNOWN'};
    }
  }
}
