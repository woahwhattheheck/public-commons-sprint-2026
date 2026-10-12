// MIT. Exact retained Woo basket/catalog contracts; original SF88 owns payment.
import {createHash} from 'node:crypto';
import {need, operation} from '../sf88-operator-buyer-cli/config.mjs';
import {fields, publicUrl, reference} from './buyer.mjs';

export const BASKET_SCHEMA = 'stellar-forge.sf104.checkout-handoff.v2';
export const CATALOG_SCHEMA = 'stellar-forge.sf104.basket-catalog.v1';
export const BASKET_ADMISSION_SCHEMA = 'stellar-forge.sf104.checkout-admission.v2';
export const MAX_LINES = 20, MAX_UNITS = 100;
const MAX_ATOMIC = (1n << 127n) - 1n;
const HASH = /^[a-f0-9]{64}$/;
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
export const canonical = value => JSON.stringify(normalize(value));
export const basketDigest = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a,b) => canonical(a) === canonical(b);
const exact = (value, keys, code) => {
  fields(value, keys, code);
  need(keys.every(key => Object.hasOwn(value,key)),code); return value;
};
const name = value => typeof value === 'string' && value.length >= 1 && value.length <= 240 &&
  !/[\x00-\x1f\x7f]/.test(value);
const compareReference = (a,b) => a.length - b.length || a.localeCompare(b);
export function storeMinor(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,8})?$/.test(value),
    'WOO_BASKET_STORE_AMOUNT_INVALID');
  const [whole,fraction=''] = value.split('.');
  return BigInt(whole + fraction.padEnd(8,'0'));
}
export function storeDecimal(value) {
  need(typeof value === 'bigint' && value >= 0n,'WOO_BASKET_STORE_AMOUNT_INVALID');
  const whole = value / 100000000n, fraction = String(value % 100000000n).padStart(8,'0').replace(/0+$/,'');
  const result = String(whole) + (fraction ? '.' + fraction : '');
  storeMinor(result); return result;
}
function atomic(value) {
  need(typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) <= MAX_ATOMIC,
    'WOO_BASKET_ATOMIC_INVALID');
  return BigInt(value);
}
function quantity(value) {
  need(typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value) && Number(value) <= MAX_UNITS,
    'WOO_BASKET_QUANTITY_INVALID');
  return Number(value);
}
function payment(expect, url, method) {
  exact(expect,['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds'],'WOO_BASKET_TERMS_INVALID');
  atomic(expect.maxAtomic);
  need(Number.isInteger(expect.maxTimeoutSeconds) && expect.maxTimeoutSeconds >= 1 && expect.maxTimeoutSeconds <= 86400,
    'WOO_BASKET_TIMEOUT_INVALID');
  operation({intentId:'woo-basket-catalog',url,method,expect});
}
export function validateBasketCatalog(raw) {
  exact(raw,['schema','storeOrigin','routeId','url','method','limits','products','catalogDigest'],'WOO_BASKET_CATALOG_FIELDS_INVALID');
  need(raw.schema === CATALOG_SCHEMA && typeof raw.routeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.routeId),
    'WOO_BASKET_CATALOG_INVALID');
  const store = publicUrl(raw.storeOrigin,'WOO_STORE_ORIGIN_INVALID'), url = publicUrl(raw.url,'WOO_BASKET_URL_INVALID');
  need(raw.storeOrigin === store.origin && !store.search && store.pathname === '/' && !url.search &&
    !raw.url.endsWith('?') && raw.url === url.href && ['GET','HEAD'].includes(raw.method),'WOO_BASKET_URL_INVALID');
  exact(raw.limits,['maxLines','maxUnits'],'WOO_BASKET_LIMITS_INVALID');
  need(raw.limits.maxLines === MAX_LINES && raw.limits.maxUnits === MAX_UNITS,'WOO_BASKET_LIMITS_INVALID');
  need(Array.isArray(raw.products) && raw.products.length >= 1 && raw.products.length <= 64,'WOO_BASKET_PRODUCTS_INVALID');
  let previous, first;
  for(const p of raw.products) {
    exact(p,['productId','name','storefront','expect'],'WOO_BASKET_PRODUCT_FIELDS_INVALID');
    need(reference(p.productId) && (!previous || compareReference(previous,p.productId) < 0) && name(p.name),
      'WOO_BASKET_PRODUCT_INVALID'); previous = p.productId;
    exact(p.storefront,['currency','total'],'WOO_BASKET_STORE_FIELDS_INVALID');
    need(typeof p.storefront.currency === 'string' && /^[A-Z][A-Z0-9]{2,9}$/.test(p.storefront.currency) &&
      storeMinor(p.storefront.total) > 0n && storeDecimal(storeMinor(p.storefront.total)) === p.storefront.total,
      'WOO_BASKET_STORE_AMOUNT_INVALID');
    payment(p.expect,raw.url,raw.method);
    const identity = [p.storefront.currency,p.expect.scheme,p.expect.network,p.expect.asset,p.expect.payTo];
    need(!first || same(first,identity),'WOO_BASKET_ONE_PAYMENT_IDENTITY_REQUIRED'); first ??= identity;
  }
  const body = structuredClone(raw); delete body.catalogDigest;
  need(HASH.test(raw.catalogDigest) && basketDigest(body) === raw.catalogDigest,'WOO_BASKET_CATALOG_DIGEST_MISMATCH');
  return structuredClone(raw);
}
export function basketTerms(h) {
  const url = new URL(h.operation.url); url.search = '';
  return {storeOrigin:h.storeOrigin,orderReference:h.orderReference,catalogDigest:h.catalogDigest,
    routeId:h.routeId,storefront:h.storefront,items:h.items,
    resource:{url:url.href,method:h.operation.method},expect:h.operation.expect};
}
/** Called after the original handoff validator checks URL, identity and SF88 terms. */
export function validateBasketHandoff(h) {
  need(h.schema === BASKET_SCHEMA && HASH.test(h.catalogDigest) && HASH.test(h.basketDigest) &&
    Array.isArray(h.items) && h.items.length >= 1 && h.items.length <= MAX_LINES,'WOO_BASKET_HANDOFF_INVALID');
  let previous, units = 0, store = 0n, total = 0n;
  const products = new Set();
  for(const line of h.items) {
    exact(line,['lineId','productId','quantity','name','unitStoreTotal','lineStoreTotal',
      'unitAmountAtomic','lineAmountAtomic','maxTimeoutSeconds','downloads'],'WOO_BASKET_LINE_FIELDS_INVALID');
    need(reference(line.lineId) && reference(line.productId) && !products.has(line.productId) &&
      (!previous || compareReference(previous,line.lineId) < 0) && name(line.name),'WOO_BASKET_LINE_IDENTITY_INVALID');
    previous = line.lineId; products.add(line.productId);
    const q = quantity(line.quantity); units += q;
    const unitStore = storeMinor(line.unitStoreTotal), lineStore = storeMinor(line.lineStoreTotal);
    const unitAmount = atomic(line.unitAmountAtomic), lineAmount = atomic(line.lineAmountAtomic);
    need(unitStore > 0n && lineStore === unitStore * BigInt(q) && lineAmount === unitAmount * BigInt(q) &&
      storeDecimal(unitStore) === line.unitStoreTotal && storeDecimal(lineStore) === line.lineStoreTotal,
      'WOO_BASKET_LINE_TOTAL_MISMATCH');
    need(Number.isInteger(line.maxTimeoutSeconds) && line.maxTimeoutSeconds >= 1 && line.maxTimeoutSeconds <= 86400 &&
      Array.isArray(line.downloads) && line.downloads.length <= 64 && line.downloads.every(name),
      'WOO_BASKET_LINE_DELIVERY_INVALID');
    store += lineStore; total += lineAmount;
  }
  need(units <= MAX_UNITS && store === storeMinor(h.storefront.total) && total === atomic(h.operation.expect.maxAtomic) &&
    h.operation.expect.maxTimeoutSeconds === Math.min(...h.items.map(x=>x.maxTimeoutSeconds)),
    'WOO_BASKET_AGGREGATE_MISMATCH');
  need(basketDigest(basketTerms(h)) === h.basketDigest,'WOO_BASKET_DIGEST_MISMATCH');
  const u = new URL(h.operation.url);
  need([...u.searchParams.keys()].length === 3 && u.searchParams.get('sf104_basket') === h.basketDigest,
    'WOO_BASKET_RESOURCE_MISMATCH');
  return h;
}
/** Merchant-authenticated Woo quote must also match an operator-retained catalog. */
export function matchBasketCatalog(h, catalog) {
  validateBasketHandoff(h);
  need(h.catalogDigest === catalog.catalogDigest && h.storeOrigin === catalog.storeOrigin &&
    h.routeId === catalog.routeId && h.operation.method === catalog.method &&
    new URL(h.operation.url).origin + new URL(h.operation.url).pathname === catalog.url,
    'WOO_BASKET_CATALOG_MISMATCH');
  const byProduct = new Map(catalog.products.map(p=>[p.productId,p]));
  for(const line of h.items) {
    const p = byProduct.get(line.productId);
    need(p && p.storefront.currency === h.storefront.currency && p.storefront.total === line.unitStoreTotal &&
      p.expect.maxAtomic === line.unitAmountAtomic && p.expect.maxTimeoutSeconds === line.maxTimeoutSeconds &&
      ['scheme','network','asset','payTo'].every(key=>p.expect[key] === h.operation.expect[key]),
      'WOO_BASKET_UNIT_MAPPING_CHANGED');
  }
  return h;
}

