// MIT. Node HTTP integration for original SF30 offers and the native x402 server.
// This adapter implements no payment scheme, signature verifier or chain client.
import { compileHttpSellerOffer, paymentRequiredResponse } from './seller.mjs';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { evaluateAdmission, validateAdmissionTimeout } from './admission.mjs';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from './route-path.mjs';
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';

const METHODS = new Set(['GET', 'HEAD', 'POST']);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);
const paymentHeaders = new Set(['payment-required', 'payment-response', 'payment-signature',
  'x-payment', 'x-payment-response', 'extension-responses', 'settlement-overrides', 'x402-settlement-overrides']);
const fault = (message, status = 400) => Object.assign(new Error(message), { status });

/** Validate an original compiled offer without reducing its input schema. */
function importedOffer(raw, allowLocalhost) {
  if (!plain(raw) || raw.x402Version !== 2 || !plain(raw.resource) ||
      !Array.isArray(raw.accepts) || raw.accepts.length !== 1 ||
      !plain(raw.extensions) || Object.keys(raw.extensions).some(key => key !== 'bazaar')) {
    throw new TypeError('Imported service offer requires x402 v2, one exact payment and Bazaar only');
  }
  const offer = structuredClone(raw), bazaar = offer.extensions.bazaar;
  const input = bazaar?.info?.input;
  if (input?.type !== 'http' || !METHODS.has(input.method) ||
      (input.method === 'POST' && input.bodyType !== 'json')) {
    throw new TypeError('Imported service offer requires GET, HEAD or JSON POST');
  }
  const checked = compileHttpSellerOffer({
    url: offer.resource.url, method: input.method,
    description: offer.resource.description ?? 'Imported API resource',
    serviceName: offer.resource.serviceName, tags: offer.resource.tags,
    payment: offer.accepts[0],
    ...(input.method === 'POST' ? { bodyType: 'json', body: input.body } : {}),
  }, { allowLocalhost });
  const terms = checked.accepts[0], original = offer.accepts[0];
  if (checked.resource.url !== offer.resource.url ||
      Object.keys(original).length !== Object.keys(terms).length ||
      Object.entries(terms).some(([key, value]) => original[key] !== value)) {
    throw new TypeError('Imported offer contains noncanonical URL or unsupported payment terms');
  }
  if (offer.resource.mimeType !== undefined &&
      (typeof offer.resource.mimeType !== 'string' || !offer.resource.mimeType || /[\x00-\x1f\x7f]/.test(offer.resource.mimeType))) {
    throw new TypeError('Invalid imported resource mimeType');
  }
  const result = validateBazaarExtension(bazaar);
  if (!result.ok) throw new TypeError('Imported Bazaar metadata rejected: ' + JSON.stringify(result));
  paymentRequiredResponse(offer); // Enforce the original buyer/header interoperability limit.
  return offer;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Compile SF30 declarations once; these exact terms configure the native SDK. */
export function compileSellerRoutes(definitions, { allowLocalhost = false } = {}) {
  if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 100) {
    throw new TypeError('One to 100 seller route definitions required');
  }
  const nativeRoutes = Object.create(null), ids = new Set(), origins = new Set();
  const routes = definitions.map(({ id, definition, offer: originalOffer, handler, admit } = {}) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.has(id)) {
      throw new TypeError('Unique printable route id required');
    }
    if ((definition === undefined) === (originalOffer === undefined) || typeof handler !== 'function')
      throw new TypeError('Choose one route definition or compiled offer, plus a handler');
    if (admit !== undefined && typeof admit !== 'function')
      throw new TypeError('Optional admission must be a function');
    if (definition !== undefined && (!plain(definition) || definition.routeTemplate !== undefined))
      throw new TypeError('Seller service requires a fixed-path definition');
    const offer = originalOffer === undefined ? compileHttpSellerOffer(definition, { allowLocalhost }) :
      importedOffer(originalOffer, allowLocalhost);
    const method = offer.extensions.bazaar.info.input.method;
    if (!METHODS.has(method) || (method === 'POST' && offer.extensions.bazaar.info.input.bodyType !== 'json')) {
      throw new TypeError('Seller service supports GET, HEAD and JSON POST only');
    }
    const url = new URL(offer.resource.url), binding = compileServicePath(offer);
    const path = binding.path;
    const key = `${method} ${path}`;
    if (Object.hasOwn(nativeRoutes, key)) throw new TypeError('Duplicate method/path');
    const accepted = offer.accepts[0];
    nativeRoutes[key] = {
      // Native x402 uses the trusted adapter URL when resource is omitted.
      // Fixed paths can carry queries too; bind every request to its exact URL.
      description: offer.resource.description,
      mimeType: offer.resource.mimeType,
      ...(offer.resource.serviceName ? { serviceName: offer.resource.serviceName } : {}),
      ...(offer.resource.tags ? { tags: [...offer.resource.tags] } : {}),
      accepts: [{ scheme: accepted.scheme, network: accepted.network,
        payTo: accepted.payTo, price: { asset: accepted.asset, amount: accepted.amount },
        maxTimeoutSeconds: accepted.maxTimeoutSeconds }],
      extensions: structuredClone(offer.extensions),
    };
    ids.add(id); origins.add(url.origin);
    return Object.freeze({ id, path, method, binding, offer: freeze(offer), handler,
      ...(admit === undefined ? {} : { admit }) });
  });
  if (origins.size !== 1) throw new TypeError('All seller routes must use one public origin');
  const ordered = orderServiceRoutes(routes);
  const orderedNative = Object.create(null);
  for (const route of ordered) {
    const key = `${route.method} ${route.path}`;
    orderedNative[key] = nativeRoutes[key];
  }
  return Object.freeze({ routes: Object.freeze(ordered), nativeRoutes: freeze(orderedNative) });
}

function headers(input = {}, { application = false } = {}) {
  if (!plain(input)) throw new TypeError('Response headers must be an object');
  const result = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || typeof value !== 'string' || /[\r\n\x00]/.test(value)) {
      throw new TypeError('Invalid response header');
    }
    validateHeaderName(key);
    validateHeaderValue(key, value);
    if (hopHeaders.has(key)) continue;
    if (application && paymentHeaders.has(key)) throw new TypeError('Application cannot supply payment headers');
    result[key] = value;
  }
  return result;
}

function encodeResponse(result, maxBytes, application = false) {
  if (!plain(result)) throw new TypeError('Handler must return a response object');
  const status = result.status ?? 200;
  if (!Number.isInteger(status) || status < 200 || status > 599 ||
      (application && status >= 300 && status < 400)) throw new TypeError('Unsupported response status');
  const responseHeaders = headers(result.headers ?? {}, { application });
  let body;
  if (Buffer.isBuffer(result.body)) {
    body = Buffer.from(result.body);
    responseHeaders['content-type'] ??= 'application/octet-stream';
  } else if (typeof result.body === 'string') {
    body = Buffer.from(result.body);
    responseHeaders['content-type'] ??= 'text/plain; charset=utf-8';
  } else {
    body = Buffer.from(JSON.stringify(Object.hasOwn(result, 'body') ? result.body : {}));
    responseHeaders['content-type'] ??= 'application/json; charset=utf-8';
  }
  if (body.length > maxBytes) throw new RangeError('Handler response exceeds configured limit');
  return { status, headers: responseHeaders, body };
}

function send(req, res, response) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(response.status, { ...response.headers,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    'content-length': String([204, 205, 304].includes(response.status) ? 0 : response.body.length) });
  res.end(req.method === 'HEAD' || [204, 205, 304].includes(response.status) ? undefined : response.body);
}

async function readBody(req, maxBytes) {
  const chunks = []; let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > maxBytes) throw fault('REQUEST_BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  if (!count) return null;
  if (req.method !== 'POST') throw fault('REQUEST_BODY_NOT_SUPPORTED');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw fault('JSON_CONTENT_TYPE_REQUIRED', 415);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('INVALID_JSON_BODY'); }
}

function requestContext(req, route, target, body, pathParams) {
  const decodedPath = decodeURIComponent(target.pathname);
  const query = Object.create(null);
  for (const [key, value] of target.searchParams) {
    if (!Object.hasOwn(query, key)) query[key] = value;
    else query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
  }
  const getHeader = name => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(', ') : value;
  };
  const adapter = {
    getHeader, getMethod: () => req.method, getPath: () => decodedPath,
    getUrl: () => target.href, getAcceptHeader: () => getHeader('accept') ?? '',
    getUserAgent: () => getHeader('user-agent') ?? '', getQueryParams: () => query,
    getQueryParam: name => query[name], getBody: () => body,
  };
  return { sdk: { adapter, path: target.pathname, decodedPath, method: req.method,
    paymentHeader: getHeader('payment-signature') || getHeader('x-payment') },
  application: { method: req.method, url: new URL(target.href), query, body,
    pathParams: Object.freeze({ ...pathParams }),
    headers: { ...req.headers } } };
}

/** Node handler; nativeServer must be the operator-configured canonical SDK. */
export function createSellerResourceHandler({ compiled, nativeServer = null,
  maxRequestBytes = 1024 * 1024, maxResponseBytes = 1024 * 1024,
  admissionTimeoutMs = 2000 } = {}) {
  validateAdmissionTimeout(admissionTimeoutMs);
  if (!compiled?.routes?.length || !compiled.nativeRoutes) throw new TypeError('Compiled seller routes required');
  for (const limit of [maxRequestBytes, maxResponseBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 * 1024) throw new TypeError('Invalid body limit');
  }
  if (nativeServer !== null && ['processHTTPRequest', 'processSettlement', 'createFailurePathSettlementHeaders']
      .some(key => typeof nativeServer[key] !== 'function')) throw new TypeError('Native x402 HTTP server required');
  return async function sellerResourceHandler(req, res) {
    const simple = (status, error, extra = {}) => send(req, res,
      encodeResponse({ status, headers: extra, body: { error } }, maxResponseBytes));
    let payment;
    try {
      // Never derive advertised payment/resource identity from the Host header.
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
        return simple(400, 'INVALID_REQUEST_TARGET');
      }
      const rawPath = req.url.split('?')[0];
      const selected = selectServiceRoute(compiled.routes, rawPath, req.method);
      if (!selected) return simple(404, 'RESOURCE_NOT_FOUND');
      const { route, pathParams } = selected;
      if (!route) return simple(405, 'METHOD_NOT_ALLOWED', { allow: selected.allow.join(', ') });
      const target = new URL(req.url, route.offer.resource.url);
      if (target.hash || target.pathname !== rawPath) return simple(400, 'INVALID_REQUEST_TARGET');
      if (target.href.length > 2048) return simple(414, 'REQUEST_TARGET_TOO_LONG');
      let requestOffer = route.offer;
      if (route.binding.dynamic || target.href !== route.offer.resource.url) {
        requestOffer = structuredClone(route.offer);
        requestOffer.resource.url = target.href;
        if (route.binding.dynamic) {
          requestOffer.extensions.bazaar.info.input.pathParams = { ...pathParams };
          if (!validateBazaarExtension(requestOffer.extensions.bazaar).ok)
            return simple(400, 'PATH_PARAMETERS_REJECTED');
        }
        // Enforce the same header limit before entering either runtime mode.
        paymentRequiredResponse(requestOffer);
      }
      if (nativeServer === null) {
        const challenge = paymentRequiredResponse(requestOffer);
        return send(req, res, encodeResponse({ status: challenge.statusCode,
          headers: challenge.headers, body: challenge.body }, maxResponseBytes));
      }
      const body = await readBody(req, maxRequestBytes);
      const context = requestContext(req, route, target, body, pathParams);
      if (route.admit) {
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        res.once('close', disconnected);
        try {
          if (res.destroyed || req.aborted) controller.abort();
          const decision = await evaluateAdmission(route.admit, context.application,
            { timeoutMs: admissionTimeoutMs, signal: controller.signal });
          if (res.destroyed || res.writableEnded || req.aborted) return;
          if (decision !== true) {
            const rejected = decision === false ?
              { status: 422, body: { error: 'REQUEST_NOT_ADMITTED' } } : decision;
            if (!plain(rejected) || !Number.isInteger(rejected.status) ||
                rejected.status < 400 || rejected.status > 499 || rejected.status === 402) {
              throw new TypeError('Admission requires true, false or a nonpayment 4xx response');
            }
            return send(req, res, encodeResponse(rejected, maxResponseBytes, true));
          }
        } catch {
          // No native verification, cancellation or settlement has been invoked.
          return simple(503, 'REQUEST_ADMISSION_UNAVAILABLE');
        } finally {
          res.removeListener('close', disconnected);
        }
      }
      payment = await nativeServer.processHTTPRequest(context.sdk);
      if (payment?.type === 'payment-error') {
        return send(req, res, encodeResponse(payment.response, maxResponseBytes));
      }
      // Every configured route is paid. Native bypass hooks/unmatched routes
      // must not silently make it free or execute the application.
      if (payment?.type !== 'payment-verified' || typeof payment.cancellationDispatcher?.cancel !== 'function') {
        return simple(503, 'NATIVE_PAYMENT_GATE_NOT_VERIFIED');
      }
      let response;
      try {
        response = encodeResponse(await route.handler(context.application), maxResponseBytes, true);
      } catch (error) {
        const cancelled = await payment.cancellationDispatcher.cancel({ reason: 'handler_threw', error });
        const receiptHeaders = nativeServer.createFailurePathSettlementHeaders(cancelled,
          payment.beforeHandlerSettlement, payment.paymentPayload, 'private, no-store') ?? {};
        return simple(500, 'APPLICATION_FAILED', headers(receiptHeaders));
      }
      if (response.status >= 400) {
        const cancelled = await payment.cancellationDispatcher.cancel({ reason: 'handler_failed', responseStatus: response.status });
        const receiptHeaders = nativeServer.createFailurePathSettlementHeaders(cancelled,
          payment.beforeHandlerSettlement, payment.paymentPayload, 'private, no-store') ?? {};
        response.headers = { ...response.headers, ...headers(receiptHeaders) };
        return send(req, res, response);
      }
      const settled = await nativeServer.processSettlement(payment.paymentPayload, payment.paymentRequirements,
        payment.declaredExtensions, { request: context.sdk, responseBody: response.body,
          responseHeaders: response.headers }, undefined, payment.beforeHandlerSettlement);
      if (settled?.success !== true) {
        if (!settled?.response) return simple(502, 'SETTLEMENT_RESULT_UNAVAILABLE');
        return send(req, res, encodeResponse(settled.response, maxResponseBytes));
      }
      response.headers = { ...response.headers, ...headers(settled.headers) };
      return send(req, res, response);
    } catch (error) {
      // Never retry an uncertain settlement or send an application body after
      // a native exception. Raw SDK/handler errors may contain private data.
      return simple(error?.status ?? (payment ? 502 : 500),
        error?.status ? error.message : payment ? 'PAYMENT_PROCESSING_UNAVAILABLE' : 'SELLER_REQUEST_FAILED');
    }
  };
}

