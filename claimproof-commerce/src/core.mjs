import { createHash } from 'node:crypto';

const MONEY = /^\d{1,6}(?:\.\d{1,2})?$/;
const SKU = /^[a-zA-Z0-9_-]{1,30}$/;
export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}
function plainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}
function dollarsToCents(x) {
  if (typeof x !== 'string' || !MONEY.test(x)) throw new InputError('unit_price must be a decimal string up to two places');
  const [left, right = ''] = x.split('.');
  const result = Number(left) * 100 + Number((right + '00').slice(0, 2));
  if (!Number.isSafeInteger(result) || result <= 0) throw new InputError('unit_price must be positive');
  return result;
}
export function money(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new InputError('invalid cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
export function normalizeCart(raw) {
  if (!plainObject(raw) || Object.keys(raw).some(k => !['items', 'merchantTerms', 'currency'].includes(k))) throw new InputError('invalid cart object');
  if (raw.currency !== 'USD') throw new InputError('sandbox demonstration supports USD only');
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 12) throw new InputError('cart must have 1–12 items');
  const ids = new Set();
  let total = 0;
  const items = raw.items.map((v, index) => {
    if (!plainObject(v) || Object.keys(v).sort().join() !== 'name,quantity,sku,unit_price') throw new InputError(`item ${index} fields invalid`);
    if (typeof v.sku !== 'string' || !SKU.test(v.sku) || ids.has(v.sku)) throw new InputError('invalid or repeated SKU');
    ids.add(v.sku);
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120 || /[\x00-\x1f<>]/.test(v.name)) throw new InputError('invalid product name');
    if (!Number.isSafeInteger(v.quantity) || v.quantity < 1 || v.quantity > 99) throw new InputError('quantity must be integer 1–99');
    const unitCents = dollarsToCents(v.unit_price);
    const lineCents = unitCents * v.quantity;
    total += lineCents;
    return {sku:v.sku, name:v.name.trim(), quantity:v.quantity, unit_price:money(unitCents), line_total:money(lineCents)};
  });
  if (!Number.isSafeInteger(total) || total > 2000000) throw new InputError('cart total exceeds demonstration ceiling of $20,000');
  const merchantTerms = raw.merchantTerms;
  if (typeof merchantTerms !== 'string' || merchantTerms.length > 1500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(merchantTerms)) throw new InputError('invalid merchant terms');
  const fingerprint = createHash('sha256').update(JSON.stringify({items, total, merchantTerms, currency:'USD'})).digest('hex');
  return Object.freeze({items, total_cents:total, total:money(total), currency:'USD', merchant_terms:merchantTerms, fingerprint});
}
export function staticReview(cart) {
  const findings = [];
  const terms = cart.merchant_terms.trim();
  if (!terms) findings.push({code:'NO_TERMS',severity:'high',finding:'Merchant terms were not supplied. Ask about returns, support, and fulfillment before purchasing.'});
  if (terms && !/refund|return/i.test(terms)) findings.push({code:'RETURNS_UNCLEAR',severity:'medium',finding:'The provided terms do not clearly mention refunds or returns.'});
  if (terms && !/delivery|shipping|fulfill|digital/i.test(terms)) findings.push({code:'FULFILLMENT_UNCLEAR',severity:'medium',finding:'Fulfillment timing is not explicit in the provided terms.'});
  if (cart.total_cents > 20000) findings.push({code:'LARGE_TOTAL',severity:'medium',finding:'This cart exceeds $200; independently confirm merchant details.'});
  return findings;
}
export function modelSummary(raw, cart) {
  // AI output is advisory only: it is never allowed to choose a payee or payment amount.
  if (!plainObject(raw) || typeof raw.summary !== 'string' || raw.summary.length > 1100) throw new InputError('malformed model summary');
  if (!Array.isArray(raw.questions) || raw.questions.length > 5) throw new InputError('malformed model questions');
  const questions = raw.questions.map(x => {
    if (typeof x !== 'string' || !x.trim() || x.length > 220) throw new InputError('malformed model question');
    return x.trim();
  });
  return {summary:raw.summary.trim(),questions,model_used:true,cart_fingerprint:cart.fingerprint};
}
export function paypalOrderBody(cart, localBaseUrl) {
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(localBaseUrl)) throw new InputError('local callback origin invalid');
  return {
    intent:'CAPTURE',
    purchase_units:[{
      reference_id:cart.fingerprint.slice(0,24),
      amount:{currency_code:'USD', value:cart.total, breakdown:{item_total:{currency_code:'USD',value:cart.total}}},
      items:cart.items.map(x=>({name:x.name,sku:x.sku,quantity:String(x.quantity),unit_amount:{currency_code:'USD',value:x.unit_price},category:'DIGITAL_GOODS'}))
    }],
    payment_source:{paypal:{experience_context:{return_url:`${localBaseUrl}/?flow=approved`,cancel_url:`${localBaseUrl}/?flow=cancelled`,user_action:'PAY_NOW'}}}
  };
}
