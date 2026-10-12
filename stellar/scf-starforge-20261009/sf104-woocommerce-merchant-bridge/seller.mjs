#!/usr/bin/env node
// MIT. Original SF30 native seller + live Woo order admission + original SF98.
import {createHmac} from 'node:crypto';
import {constants} from 'node:fs';
import {open, unlink} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fields, publicUrl, reference, generation, sha256} from './buyer.mjs';
import {validateBasketCatalog} from './basket.mjs';
import {need, operation} from '../sf88-operator-buyer-cli/config.mjs';
import {compileHttpSellerOffer} from '../sf30-seller-sdk/seller.mjs';
import {startSellerService} from '../sf30-seller-sdk/serve.mjs';
import {startSellerOperations} from '../sf30-seller-sdk/operations/server.mjs';
import {createPublicHttpsFetch} from '../sf31-buyer-client/public-transport.mjs';
import {openOutbox, instrumentNativeSettlement} from '../sf98-merchant-delivery/outbox.mjs';

export const MERCHANT_SCHEMA = 'stellar-forge.sf104.merchant.v1';
export const BASKET_MERCHANT_SCHEMA = 'stellar-forge.sf104.merchant.v2';
const REQUEST_SCHEMA = 'stellar-forge.sf104.checkout-admission.v1';
const RESULT_SCHEMA = 'stellar-forge.sf104.checkout-admission-result.v1';
const ENDPOINT = '/wp-json/stellar-forge/v1/checkout-admission';

export function compileMerchant(raw) {
  const basketConfig = raw?.schema === BASKET_MERCHANT_SCHEMA;
  fields(raw, ['schema','storeOrigin','admissionUrl','secretEnv','outbox','routes','timeoutMs',
    ...(basketConfig ? ['baskets'] : [])], 'WOO_MERCHANT_FIELDS_INVALID');
  need((raw.schema === MERCHANT_SCHEMA || basketConfig) && Array.isArray(raw.routes) &&
    (basketConfig || raw.routes.length >= 1) && raw.routes.length <= 64, 'WOO_MERCHANT_CONFIG_INVALID');
  const store = publicUrl(raw.storeOrigin, 'WOO_STORE_ORIGIN_INVALID');
  need(store.pathname === '/' && !store.search, 'WOO_STORE_ORIGIN_INVALID');
  const endpoint = publicUrl(raw.admissionUrl ?? store.origin + ENDPOINT, 'WOO_ADMISSION_URL_INVALID');
  need(endpoint.origin === store.origin && !endpoint.search && endpoint.pathname.endsWith(ENDPOINT),
    'WOO_ADMISSION_ORIGIN_MISMATCH');
  const secretEnv = raw.secretEnv ?? 'SF98_WEBHOOK_SECRET';
  need(typeof secretEnv === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(secretEnv), 'WOO_SECRET_ENV_INVALID');
  need(typeof raw.outbox === 'string' && isAbsolute(raw.outbox) && resolve(raw.outbox) === raw.outbox,
    'WOO_OUTBOX_ABSOLUTE_PATH_REQUIRED');
  const timeoutMs = raw.timeoutMs ?? 5000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10000, 'WOO_TIMEOUT_INVALID');
  const ids = new Set(), products = new Set(), origins = new Set();
  const routes = raw.routes.map((input, index) => {
    fields(input, ['productId','routeId','url','method','expect','description'], 'WOO_ROUTE_FIELDS_INVALID');
    need(reference(input.productId) && !products.has(input.productId) &&
      typeof input.routeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.routeId) &&
      !ids.has(input.routeId), 'WOO_ROUTE_IDENTITY_INVALID');
    ids.add(input.routeId); products.add(input.productId);
    const url = publicUrl(input.url, 'WOO_ROUTE_URL_INVALID');
    need(!url.search && !url.href.endsWith('?') && ['GET','HEAD'].includes(input.method), 'WOO_FIXED_ROUTE_REQUIRED');
    fields(input.expect, ['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds'], 'WOO_ROUTE_TERMS_INVALID');
    operation({intentId:'woo-merchant-config', url:input.url, method:input.method, expect:input.expect});
    const payment = {...input.expect, amount:input.expect.maxAtomic};
    delete payment.maxAtomic;
    const offer = compileHttpSellerOffer({url:url.href, method:input.method,
      description:input.description ?? 'Native payment for the mapped WooCommerce order; merchant review releases delivery.',
      serviceName:'WooCommerce Stellar checkout', payment,
      queryParameters:[{name:'sf98_order', type:'string', required:true, example:'1',
        description:'The exact unpaid order created by the WooCommerce checkout.'},
        {name:'sf104_attempt', type:'string', required:true, example:'1',
          description:'The merchant-approved attempt generation bound to this order.'}]});
    origins.add(url.origin);
    return {productId:input.productId, routeId:input.routeId, url:url.href, method:input.method,
      expect:structuredClone(input.expect), offer, handler:'wooOrder' + index, admit:'wooAdmission' + index};
  });
  const baskets = [];
  if (basketConfig) {
    need(Array.isArray(raw.baskets) && raw.baskets.length >= 1 && raw.baskets.length <= 32, 'WOO_BASKET_CATALOGS_REQUIRED');
    const retained = new Set();
    for (const input of raw.baskets) {
      const catalog = validateBasketCatalog(input), first = baskets[0];
      need(catalog.storeOrigin === store.origin && !retained.has(catalog.catalogDigest), 'WOO_BASKET_CATALOG_IDENTITY_INVALID');
      need(!ids.has(catalog.routeId) && !routes.some(r => new URL(r.url).pathname.toLowerCase() === new URL(catalog.url).pathname.toLowerCase()),
        'WOO_BASKET_ROUTE_MUST_BE_DISTINCT');
      need(!first || ['routeId','url','method'].every(key => first[key] === catalog[key]), 'WOO_BASKET_CATALOG_ENDPOINT_CHANGED');
      retained.add(catalog.catalogDigest); origins.add(new URL(catalog.url).origin); baskets.push(catalog);
    }
  }
  need(origins.size === 1, 'WOO_ROUTES_REQUIRE_ONE_SELLER_ORIGIN');
  return {storeOrigin:store.origin, admissionUrl:endpoint.href, secretEnv, outbox:raw.outbox, timeoutMs, routes, baskets,
    service:{schema:'stellar-forge.seller-service.v1', publicOrigin:[...origins][0],
      admissionTimeoutMs:Math.min(timeoutMs + 500, 60000), handlerTimeoutMs:Math.min(timeoutMs + 1000, 60000),
      routes:routes.map(route => ({id:route.routeId, path:new URL(route.url).pathname, offer:route.offer,
        handler:route.handler, admit:route.admit}))}};
}

export async function readJson(path, limit = 262144) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size > 0 && info.size <= limit, 'WOO_JSON_FILE_INVALID');
    const bytes = await file.readFile();
    need(bytes.length <= limit, 'WOO_JSON_FILE_INVALID');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } finally { await file.close(); }
}

async function boundedJson(response) {
  need(response instanceof Response, 'WOO_ADMISSION_SERVICE_UNAVAILABLE');
  if (response.status >= 400 && response.status < 500) need(false, 'WOO_ORDER_UNAVAILABLE');
  need(response.status === 200 && response.body, 'WOO_ADMISSION_SERVICE_UNAVAILABLE');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength; need(length <= 8192, 'WOO_ADMISSION_RESPONSE_TOO_LARGE'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
}

/** Only exact order data and a digest of an already-verified native request cross
 * to WordPress. No payment headers, wallet identity, signature or private key do. */
export function createWooApplication(compiled, {env = process.env, fetchImpl} = {}) {
  const secret = env[compiled.secretEnv];
  need(typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 1024,
    'WOO_PRIVATE_SHARED_SECRET_REQUIRED');
  need(fetchImpl === undefined || typeof fetchImpl === 'function', 'WOO_TRUSTED_FETCH_REQUIRED');
  const fetchOrder = fetchImpl ?? createPublicHttpsFetch({timeoutMs:compiled.timeoutMs});
  const handlers = {};
  for (const route of compiled.routes) {
    function request(context, phase) {
      const url = context.url, ref = context.query.sf98_order;
      const attemptGeneration = Number(context.query.sf104_attempt);
      need(url instanceof URL && reference(ref) && context.method === route.method &&
        generation(attemptGeneration) && context.query.sf104_attempt === String(attemptGeneration) &&
        url.origin === new URL(route.url).origin && url.pathname === new URL(route.url).pathname &&
        [...url.searchParams.keys()].length === 2 && url.searchParams.get('sf98_order') === ref &&
        url.searchParams.get('sf104_attempt') === String(attemptGeneration) &&
        new Headers(context.headers).get('x-sf98-order-id') === ref, 'WOO_ORDER_REQUEST_MISMATCH');
      const result = {schema:REQUEST_SCHEMA, phase, orderReference:ref, attemptGeneration, productId:route.productId,
        routeId:route.routeId, method:route.method, network:route.expect.network,
        amountAtomic:route.expect.maxAtomic, assetDigest:sha256(route.expect.asset),
        recipientDigest:sha256(route.expect.payTo), resourceUrl:url.href};
      if (phase === 'reserve') {
        const signature = new Headers(context.headers).get('payment-signature') ||
          new Headers(context.headers).get('x-payment');
        need(typeof signature === 'string' && signature.length >= 1 && signature.length <= 65536,
          'WOO_VERIFIED_NATIVE_REQUEST_REQUIRED');
        result.attemptDigest = sha256(signature);
      }
      return result;
    }
    async function call(context, phase) {
      const payload = request(context, phase), body = JSON.stringify(payload);
      const stamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', secret).update(stamp + '.' + body).digest('hex');
      let response;
      try {
        response = await fetchOrder(compiled.admissionUrl, {method:'POST', redirect:'manual', body,
          signal:context.signal, headers:{'content-type':'application/json',
            'x-sf98-timestamp':stamp, 'x-sf98-signature':'sha256=' + signature}});
        const result = await boundedJson(response);
        need(result.schema === RESULT_SCHEMA && result.orderReference === payload.orderReference &&
          result.status === (phase === 'inspect' ? 'READY' : 'RESERVED'), 'WOO_ORDER_ADMISSION_MISMATCH');
        return payload;
      } finally {
        if (response?.body && !response.body.locked && !response.bodyUsed) await response.body.cancel().catch(() => {});
      }
    }
    handlers[route.admit] = async context => {
      try { await call(context, 'inspect'); return true; }
      catch (error) {
        if (['WOO_ORDER_UNAVAILABLE','WOO_ORDER_REQUEST_MISMATCH'].includes(error.code))
          return {status:409, body:{error:'WOO_PENDING_ORDER_NOT_AVAILABLE'}};
        // Original admission reports a shop/TLS/protocol outage as 503 before
        // native verification, preserving a useful difference from stale orders.
        throw error;
      }
    };
    handlers[route.handler] = async context => {
      // SF30 calls a handler only AFTER its ORIGINAL native verification. The
      // durable Woo CAS wins before settlement; ambiguity never frees it on a timer.
      const reserved = await call(context, 'reserve');
      return {status:200, headers:{'content-type':'application/json'}, body:{
        schema:'stellar-forge.sf104.order-result.v1', orderReference:reserved.orderReference,
        storeOrigin:compiled.storeOrigin, status:'ORDER_RESERVED_FOR_NATIVE_SETTLEMENT',
        delivery:'WOO_MERCHANT_REVIEW_REQUIRED'}};
    };
  }
  return handlers;
}

export async function startWooMerchant(compiled, {nativeFactory = null, env = process.env,
  fetchImpl, port = 8423, operationsPort = 8424, maxInFlight = 64, drainGraceMs = 60000} = {}) {
  if (compiled.baskets?.length) {
    const {startWooBasketMerchant} = await import('./basket-seller.mjs');
    return startWooBasketMerchant(compiled, {nativeFactory, env, fetchImpl, port, operationsPort, maxInFlight, drainGraceMs});
  }
  const outbox = await openOutbox(compiled.outbox);
  const handlers = createWooApplication(compiled, {env, fetchImpl});
  let seller, operations, closing;
  const close = () => closing ??= (async () => {
    let failure;
    for (const resource of [seller, operations]) try { await resource?.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  })();
  try {
    seller = await startSellerService({config:compiled.service, handlers, port, maxInFlight, drainGraceMs,
      nativeFactory:nativeFactory ? async routes => instrumentNativeSettlement(await nativeFactory(routes), {
        compiled:routes, outbox, onWriteFailure:() => process.stderr.write('WOO_NATIVE_OUTBOX_RECONCILIATION_REQUIRED\n')}) : null});
    operations = await startSellerOperations(seller, {port:operationsPort, deliveryOutbox:outbox});
    return {seller, operations, outbox, close};
  } catch (error) { await close().catch(() => {}); throw error; }
}

async function writeNewJson(path, value) {
  let file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  catch (error) { await file.close().catch(() => {}); await unlink(path).catch(() => {}); throw error; }
  await file.close();
}

const USAGE = `node seller.mjs prepare [--route /absolute/woo-product.json] [--basket /absolute/basket-catalog.json] --store-origin https://shop.example --outbox /private/sf98-outbox --out /private/woo-merchant.json [--admission-url https://shop.example/subdir/wp-json/stellar-forge/v1/checkout-admission]
Repeat --route for existing fixed-product routes and --basket for retained catalog versions.
Basket catalogs are exported by the original Woo gateway; keep earlier catalogs for pending orders.
node seller.mjs inspect --config /private/woo-merchant.json
node seller.mjs serve --config /private/woo-merchant.json --facilitator https://facilitator.example [--port 8423] [--operations-port 8424]

The original SF30 seller listens on loopback; use the merchant's existing HTTPS ingress.
Set the SAME private secret in SF98_WEBHOOK_SECRET for WordPress, this service and the
original SF98 sender. An explicit native facilitator is required by serve; no keys or
payments are created by setup. --allow-local-facilitator permits explicit loopback HTTP.
The original SF98 worker delivers native success to WordPress's /settlement route.
An uncertain reserved order stays reserved until original merchant reconciliation.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const action = args[0], options = new Map(), routeFiles = [], basketFiles = [];
  const allowed = {prepare:['--route','--basket','--store-origin','--outbox','--out','--admission-url'],
    inspect:['--config'], serve:['--config','--facilitator','--allow-local-facilitator','--port','--operations-port']}[action];
  need(allowed, 'WOO_SELLER_ACTION_REQUIRED');
  for (let i = 1; i < args.length; i++) {
    const key = args[i]; need(allowed.includes(key) && (['--route','--basket'].includes(key) || !options.has(key)), 'WOO_SELLER_ARGUMENT_INVALID');
    if (key === '--allow-local-facilitator') { options.set(key, true); continue; }
    need(typeof args[i+1] === 'string' && !args[i+1].startsWith('--'), 'WOO_SELLER_VALUE_REQUIRED');
    const value = args[++i];
    if (key === '--route') routeFiles.push(value); else if (key === '--basket') basketFiles.push(value); else options.set(key, value);
  }
  if (action === 'prepare') {
    need((routeFiles.length || basketFiles.length) && ['--store-origin','--outbox','--out'].every(key => options.has(key)), 'WOO_SETUP_ARGUMENT_REQUIRED');
    const raw = {schema:basketFiles.length ? BASKET_MERCHANT_SCHEMA : MERCHANT_SCHEMA, storeOrigin:options.get('--store-origin'),
      outbox:resolve(options.get('--outbox')), routes:await Promise.all(routeFiles.map(path => readJson(resolve(path)))),
      ...(basketFiles.length ? {baskets:await Promise.all(basketFiles.map(path => readJson(resolve(path))))} : {}),
      ...(options.has('--admission-url') ? {admissionUrl:options.get('--admission-url')} : {})};
    const compiled = compileMerchant(raw), output = resolve(options.get('--out'));
    await writeNewJson(output, raw);
    const result = {status:'WOO_NATIVE_MERCHANT_PREPARED', output, routes:compiled.routes.length, basketCatalogs:compiled.baskets.length, networkRequests:0};
    console.log(JSON.stringify(result)); return result;
  }
  need(options.has('--config'), 'WOO_CONFIG_REQUIRED');
  const compiled = compileMerchant(await readJson(resolve(options.get('--config')), 2097152));
  if (action === 'inspect') {
    const result = {status:'WOO_MERCHANT_CONFIG_VALID', storeOrigin:compiled.storeOrigin,
      admissionUrl:compiled.admissionUrl, baskets:compiled.baskets.map(catalog => ({catalogDigest:catalog.catalogDigest,
        routeId:catalog.routeId, url:catalog.url, method:catalog.method, products:catalog.products})),
      routes:compiled.routes.map(route => ({productId:route.productId,
        routeId:route.routeId, url:route.url, method:route.method, expect:route.expect})), networkRequests:0};
    console.log(JSON.stringify(result, null, 2)); return result;
  }
  need(options.has('--facilitator'), 'ORIGINAL_NATIVE_FACILITATOR_REQUIRED');
  const facilitator = new URL(options.get('--facilitator'));
  const local = options.has('--allow-local-facilitator') && facilitator.protocol === 'http:' && facilitator.hostname === '127.0.0.1';
  need((local || facilitator.protocol === 'https:') && !facilitator.username && !facilitator.password &&
    !facilitator.search && !facilitator.hash, 'WOO_FACILITATOR_INVALID');
  for (const key of ['--port','--operations-port']) if (options.has(key)) need(/^\d{1,5}$/.test(options.get(key)) &&
    Number(options.get(key)) <= 65535, 'WOO_PORT_INVALID');
  const [{HTTPFacilitatorClient},{createNativeSellerServer}] = await Promise.all([
    import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs')]);
  const client = new HTTPFacilitatorClient({url:facilitator.href.replace(/\/$/,'')});
  const session = await startWooMerchant(compiled, {port:Number(options.get('--port') ?? 8423),
    operationsPort:Number(options.get('--operations-port') ?? 8424),
    nativeFactory:routes => createNativeSellerServer(routes, {facilitatorClient:client})});
  for (const name of ['SIGINT','SIGTERM']) process.once(name, () => session.close().catch(() => {process.exitCode = 1;}));
  console.log(JSON.stringify({status:'WOO_NATIVE_MERCHANT_RUNNING', mode:session.seller.mode,
    seller:session.seller.url, operations:session.operations.url, routes:compiled.routes.length, basketCatalogs:compiled.baskets.length}));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({error:/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'WOO_SELLER_COMMAND_FAILED',
      automaticPaymentRetry:false})); process.exitCode = 1;
  });

