import { paypalOrderBody, InputError } from './core.mjs';

const BASE = 'https://api-m.sandbox.paypal.com'; // Intentionally immutable; production account/payment endpoints are not supported.
function assertOrderId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(id)) throw new InputError('invalid PayPal order identifier');
  return id;
}
export class PayPalSandbox {
  constructor({clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET, transport = fetch} = {}) {
    this.id = clientId; this.secret = secret; this.transport = transport;
  }
  async accessToken() {
    if (!this.id || !this.secret) throw new InputError('PayPal sandbox credentials are not configured');
    const basic = Buffer.from(`${this.id}:${this.secret}`).toString('base64');
    const result = await this.transport(`${BASE}/v1/oauth2/token`, {
      method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)
    });
    if (!result.ok) throw new Error(`PayPal sandbox authentication HTTP ${result.status}`);
    const data = await result.json();
    if (!data.access_token || typeof data.access_token !== 'string') throw new Error('PayPal sandbox did not return access token');
    return data.access_token;
  }
  async api(path,{method='GET',body,requestId}={}) {
    const token = await this.accessToken();
    const headers = {Authorization:`Bearer ${token}`,Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const res = await this.transport(`${BASE}${path}`,{
      method,headers,...(body !== undefined ? {body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)
    });
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
  async captureApproved(orderId,cart,requestId) {
    // Never capture merely because a browser callback claimed success.
    const verifiedId = assertOrderId(orderId);
    const current = await this.get(verifiedId);
    const unit = Array.isArray(current.purchase_units) && current.purchase_units.length === 1
      ? current.purchase_units[0] : null;
    const amount = unit?.amount;
    if (current.id !== verifiedId || current.intent !== 'CAPTURE' || !unit || amount?.currency_code !== 'USD' || amount?.value !== cart.total) {
      throw new InputError('PayPal order identity, intent, or unchanged cart total could not be verified');
    }
    // A prior capture POST may have succeeded even when the response timed out.
    // Reconcile only from PayPal's authoritative order + capture records.
    if (current.status === 'COMPLETED') {
      const captures = unit.payments?.captures;
      const settled = Array.isArray(captures) && captures.length === 1 ? captures[0] : null;
      if (!settled || settled.status !== 'COMPLETED' ||
          settled.amount?.currency_code !== 'USD' || settled.amount?.value !== cart.total) {
        throw new InputError('Completed PayPal order lacks a verified matching capture; manual reconciliation required');
      }
      return {status:'COMPLETED',id:settled.id,already_captured:true};
    }
    if (current.status !== 'APPROVED') {
      throw new InputError('PayPal has not confirmed APPROVED state; capture was not requested');
    }
    return this.api(`/v2/checkout/orders/${verifiedId}/capture`,{method:'POST',body:{},requestId});
  }
}
