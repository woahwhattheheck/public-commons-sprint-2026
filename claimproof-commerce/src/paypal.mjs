import { paypalOrderBody, InputError } from './core.mjs';

const BASE = 'https://api-m.sandbox.paypal.com'; // Intentionally immutable; production account/payment endpoints are not supported.
function assertOrderId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(id)) throw new InputError('invalid PayPal order identifier');
  return id;
}
export class CaptureOutcomeUnknown extends Error {
  constructor() { super('Capture outcome requires read-only reconciliation'); }
}
const CAPTURE_STATES = new Set(['COMPLETED','PENDING','DECLINED','DENIED','FAILED','REFUNDED','PARTIALLY_REFUNDED']);
function inspectOrder(current, orderId, cart) {
  const unit = Array.isArray(current?.purchase_units) && current.purchase_units.length === 1
    ? current.purchase_units[0] : null;
  if (current?.id !== orderId || current.intent !== 'CAPTURE' ||
      unit?.amount?.currency_code !== 'USD' || unit.amount.value !== cart.total) {
    throw new InputError('PayPal order identity, intent, or unchanged cart total could not be verified');
  }
  const captures = unit.payments?.captures;
  if (captures !== undefined && (!Array.isArray(captures) || captures.length !== 1)) {
    throw new InputError('Expected one matching PayPal capture; manual reconciliation required');
  }
  const capture = captures?.[0];
  if (capture) {
    if (typeof capture.id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(capture.id) ||
        capture.amount?.currency_code !== 'USD' || capture.amount.value !== cart.total ||
        !CAPTURE_STATES.has(capture.status)) {
      throw new InputError('PayPal capture identity, amount or status could not be verified');
    }
    return {status:capture.status,id:capture.id,already_captured:true};
  }
  if (!['CREATED','SAVED','APPROVED','PAYER_ACTION_REQUIRED','VOIDED'].includes(current.status)) {
    throw new InputError('PayPal order lacks a verified capture; manual reconciliation required');
  }
  return {status:current.status,id:null,already_captured:false};
}
export class PayPalSandbox {
  #token = null;
  #tokenExpires = 0;
  #tokenFlight = null;
  constructor({clientId = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET, transport = fetch, clock = Date.now} = {}) {
    this.id = clientId; this.secret = secret; this.transport = transport; this.clock = clock;
  }
  async accessToken() {
    if (!this.id || !this.secret) throw new InputError('PayPal sandbox credentials are not configured');
    if (this.#token && this.clock() < this.#tokenExpires) return this.#token;
    if (this.#tokenFlight) return this.#tokenFlight;
    this.#tokenFlight = this.requestAccessToken();
    try { return await this.#tokenFlight; }
    finally { this.#tokenFlight = null; }
  }
  async requestAccessToken() {
    const started = this.clock();
    const basic = Buffer.from(`${this.id}:${this.secret}`).toString('base64');
    const result = await this.transport(`${BASE}/v1/oauth2/token`, {
      method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)
    });
    if (!result.ok) throw new Error(`PayPal sandbox authentication HTTP ${result.status}`);
    const data = await result.json();
    if (!data.access_token || typeof data.access_token !== 'string') throw new Error('PayPal sandbox did not return access token');
    // Missing/invalid expiry permits this call but never indefinite token reuse.
    const lifetime = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? Math.min(data.expires_in,86400) * 1000 : 0;
    this.#token = data.access_token;
    this.#tokenExpires = started + lifetime - Math.min(30000,lifetime / 10);
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
    // A later explicit call may refresh auth; never replay an uncertain write here.
    if (res.status === 401 && this.#token === token) { this.#token = null; this.#tokenExpires = 0; }
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
    return inspectOrder(await this.get(verifiedId),verifiedId,cart);
  }
  async captureApproved(orderId,cart,requestId) {
    if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new InputError('invalid idempotency id');
    const verifiedId = assertOrderId(orderId);
    const current = await this.captureStatus(verifiedId,cart);
    // An existing pending, failed or completed capture is never a new capture request.
    if (current.already_captured) return current;
    if (current.status !== 'APPROVED') {
      throw new InputError('PayPal has not confirmed APPROVED state; capture was not requested');
    }
    try {
      await this.api(`/v2/checkout/orders/${verifiedId}/capture`,{method:'POST',body:{},requestId});
      // Order COMPLETED is not payment settlement. Read the full authoritative record.
      const captured = await this.captureStatus(verifiedId,cart);
      return captured.already_captured ? captured : {status:'UNKNOWN',id:null,already_captured:false};
    } catch {
      // Once POST may have left, do not equate any error with a failed payment.
      throw new CaptureOutcomeUnknown();
    }
  }
}
