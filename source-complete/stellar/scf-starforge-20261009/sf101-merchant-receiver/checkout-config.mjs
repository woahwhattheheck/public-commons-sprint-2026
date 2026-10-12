// MIT. One paid-file operation using the original Python merchant compiler.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compilePythonMerchant } from '../sf30-seller-sdk/python/config.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const reference = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const need = (value, code) => { if (!value) throw Object.assign(new Error(code), {code}); };
export const application = fileURLToPath(new URL('./checkout-application.py', import.meta.url));
export function privatePath(value) {
  need(typeof value === 'string' && isAbsolute(value) && value !== '/' && !value.includes('\0') && resolve(value) === value,
    'NORMALIZED_PRIVATE_PATH_REQUIRED');
  return value;
}
export async function readJson(path, limit = 131072) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'REGULAR_JSON_FILE_REQUIRED');
  const bytes = await readFile(path);
  need(bytes.length <= limit, 'JSON_FILE_TOO_LARGE');
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

export function compileCheckout(raw) {
  need(object(raw) && raw.schema === 'stellar-forge.sf101.checkout-service.v1', 'CHECKOUT_CONFIG_REQUIRED');
  need(Object.keys(raw).every(key => ['schema','publicOrigin','path','routeId','description','payment',
    'state','outbox','python','workerCount','maxPending'].includes(key)), 'CHECKOUT_CONFIG_FIELD_INVALID');
  need(typeof raw.routeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.routeId), 'CHECKOUT_ROUTE_ID_INVALID');
  const state = privatePath(raw.state), outbox = privatePath(raw.outbox);
  need(state !== outbox, 'CHECKOUT_STATE_AND_OUTBOX_MUST_DIFFER');
  const python = compilePythonMerchant({
    schema:'stellar-forge.python-merchant.v1', application,
    publicOrigin:raw.publicOrigin, python:raw.python, workerCount:raw.workerCount ?? 2,
    maxPending:raw.maxPending ?? 32, environment:['SF101_CHECKOUT_CONTEXT'],
    serviceName:'Paid file checkout', functions:{purchase:{
      method:'GET', path:raw.path, description:raw.description, payment:raw.payment,
      inputSchema:{type:'object', properties:{sf98_order:{type:'string', minLength:1,
        maxLength:80}}, required:['sf98_order'], additionalProperties:false},
      example:{sf98_order:'approved-order-example'}, maxInputBytes:512,
      maxOutputBytes:4096, timeoutMs:10000, output:{format:'json'},
    }},
  });
  const service = structuredClone(python.service);
  service.routes[0].id = raw.routeId;
  const terms = service.routes[0].offer.accepts[0];
  const context = {state, routeId:raw.routeId, method:'GET', network:terms.network,
    amountAtomic:terms.amount, assetDigest:sha(terms.asset), recipientDigest:sha(terms.payTo)};
  return {python, service, context, state, outbox, terms};
}
export async function readCheckout(path) { return compileCheckout(await readJson(path)); }

export function orderHandoff(compiled, order) {
  need(order.routeId === compiled.context.routeId && order.method === 'GET' &&
    ['network','amountAtomic','assetDigest'].every(key => order[key] === compiled.context[key]) &&
    (order.recipientDigest === null || order.recipientDigest === compiled.context.recipientDigest),
    'ENROLLED_ORDER_TERMS_MISMATCH');
  const purchase = new URL(compiled.service.routes[0].offer.resource.url);
  purchase.searchParams.set('sf98_order', order.orderReference);
  return {
    schema:'stellar-forge.sf101.purchase-handoff.v1', orderReference:order.orderReference,
    routeId:order.routeId, purchaseUrl:purchase.href,
    deliveryUrl:new URL('/deliver/' + order.orderReference, purchase.origin).href,
    method:'GET', payment:structuredClone(compiled.terms),
    file:{sha256:order.sourceSha256, bytes:order.sourceBytes},
    recipientBinding:order.recipientDigest === null ? 'ORIGINAL_LEGACY_ORDER' : 'ORIGINAL_RECIPIENT_DIGEST',
  };
}
export function validateHandoff(value) {
  need(object(value) && value.schema === 'stellar-forge.sf101.purchase-handoff.v1' && reference(value.orderReference) &&
    typeof value.routeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.routeId) && value.method === 'GET', 'PURCHASE_HANDOFF_INVALID');
  const purchase = new URL(value.purchaseUrl), delivery = new URL(value.deliveryUrl);
  need(purchase.protocol === 'https:' && !purchase.username && !purchase.password && !purchase.hash &&
    purchase.searchParams.getAll('sf98_order').length === 1 && purchase.searchParams.get('sf98_order') === value.orderReference,
    'PURCHASE_URL_ORDER_MISMATCH');
  need(delivery.origin === purchase.origin && !delivery.username && !delivery.password && !delivery.search && !delivery.hash &&
    delivery.pathname === '/deliver/' + value.orderReference, 'DELIVERY_MUST_MATCH_MERCHANT_AND_ORDER');
  const payment = value.payment;
  need(object(payment) && payment.scheme === 'exact' && ['stellar:testnet','stellar:pubnet'].includes(payment.network) &&
    typeof payment.amount === 'string' && /^[1-9][0-9]{0,38}$/.test(payment.amount) &&
    BigInt(payment.amount) <= (1n << 127n) - 1n &&
    typeof payment.asset === 'string' && payment.asset.length > 0 && payment.asset.length <= 128 &&
    typeof payment.payTo === 'string' && payment.payTo.length > 0 && payment.payTo.length <= 128 &&
    Number.isSafeInteger(payment.maxTimeoutSeconds) && payment.maxTimeoutSeconds > 0 && payment.maxTimeoutSeconds <= 86400,
    'PURCHASE_PAYMENT_INVALID');
  need(object(value.file) && /^[a-f0-9]{64}$/.test(value.file.sha256) &&
    Number.isSafeInteger(value.file.bytes) && value.file.bytes > 0 && value.file.bytes <= 32 * 1024 * 1024,
    'PROMISED_FILE_INVALID');
  return structuredClone(value);
}
