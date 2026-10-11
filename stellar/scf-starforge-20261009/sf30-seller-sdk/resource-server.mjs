// MIT. Node HTTP integration for original SF30 offers and the native x402 server.
// This adapter implements no payment scheme, signature verifier or chain client.
import { compileHttpSellerOffer, paymentRequiredResponse, MAX_PAYMENT_OPTIONS } from './seller.mjs';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { evaluateAdmission, validateAdmissionTimeout } from './admission.mjs';
import { createHandlerExecution, validateHandlerTimeout } from './handler-execution.mjs';
import { createRequestLifetime, validateRequestTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from './request-lifetime.mjs';
import { compileServicePath, orderServiceRoutes, selectServiceRoute } from './route-path.mjs';
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';
import { supportsSellerMethod, requiresJsonBody } from './http-methods.mjs';
import { decodeMultipart, compileMultipartSchema } from './multipart.mjs';
import { prepareResponseStream, validateMaxStreamBytes } from './stream-response.mjs';

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);
const paymentHeaders = new Set(['payment-required', 'payment-response', 'payment-signature',
  'x-payment', 'x-payment-response', 'extension-responses', 'settlement-overrides', 'x402-settlement-overrides']);
const fault = (message, status = 400) => Object.assign(new Error(message), { status });

/** Validate an original compiled offer without reducing its input schema. */
function importedOffer(raw, allowLocalhost) {
  if (!plain(raw) || raw.x402Version !== 2 || !plain(raw.resource) ||
      !Array.isArray(raw.accepts) || raw.accepts.length < 1 || raw.accepts.length > MAX_PAYMENT_OPTIONS ||
      !plain(raw.extensions) || Object.keys(raw.extensions).some(key => key !== 'bazaar')) {
    throw new TypeError(`Imported service offer requires x402 v2, 1–${MAX_PAYMENT_OPTIONS} exact payments and Bazaar only`);
  }
  const offer = structuredClone(raw), bazaar = offer.extensions.bazaar;
  const input = bazaar?.info?.input;
  if (input?.type !== 'http' || !supportsSellerMethod(input.method) ||
      (requiresJsonBody(input.method) && !['json','form-data'].includes(input.bodyType))) {
    throw new TypeError('Imported service offer requires GET, HEAD, DELETE or JSON/multipart POST, PUT, PATCH');
  }
  const checked = compileHttpSellerOffer({
    url: offer.resource.url, method: input.method,
    description: offer.resource.description ?? 'Imported API resource',
    serviceName: offer.resource.serviceName, tags: offer.resource.tags,
    paymentOptions: offer.accepts,
    ...(requiresJsonBody(input.method) ? { bodyType: input.bodyType, body: input.body } : {}),
  }, { allowLocalhost });
  if (checked.resource.url !== offer.resource.url ||
      checked.accepts.some((terms, index) => {
        const original = offer.accepts[index];
        return Object.keys(original).length !== Object.keys(terms).length ||
          Object.entries(terms).some(([key, value]) => !isDeepStrictEqual(original[key], value));
      })) {
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

/** Materialize an already-selected original route for its canonical request.
 * Dispatch retains its original schema and payment-header checks below. */
export function materializeSellerRequestOffer(route, target, pathParams) {
  if (!route.binding.dynamic && target.href === route.offer.resource.url) return route.offer;
  const offer = structuredClone(route.offer);
  offer.resource.url = target.href;
  if (route.binding.dynamic) offer.extensions.bazaar.info.input.pathParams = { ...pathParams };
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
  const routes = definitions.map(({ id, definition, offer: originalOffer, handler, admit, maxRequestBytes } = {}) => {
    if (maxRequestBytes!==undefined&&(!Number.isSafeInteger(maxRequestBytes)||maxRequestBytes<1||maxRequestBytes>16*1024*1024)) throw new TypeError('Invalid route request byte limit');
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
    paymentRequiredResponse(offer); // Validate the whole multi-option header before serving or native setup.
    const method = offer.extensions.bazaar.info.input.method;
    if (!supportsSellerMethod(method) || (requiresJsonBody(method) && !['json','form-data'].includes(offer.extensions.bazaar.info.input.bodyType))) {
      throw new TypeError('Seller service supports GET, HEAD, DELETE and JSON/multipart POST, PUT, PATCH');
    }
    if (offer.extensions.bazaar.info.input.bodyType==='form-data') compileMultipartSchema(offer.extensions.bazaar.schema.properties.input.properties.body);
    const url = new URL(offer.resource.url), binding = compileServicePath(offer);
    const path = binding.path;
    const key = `${method} ${path}`;
    if (Object.hasOwn(nativeRoutes, key)) throw new TypeError('Duplicate method/path');
    nativeRoutes[key] = {
      // Native x402 uses the trusted adapter URL when resource is omitted.
      // Fixed paths can carry queries too; bind every request to its exact URL.
      description: offer.resource.description,
      mimeType: offer.resource.mimeType,
      ...(offer.resource.serviceName ? { serviceName: offer.resource.serviceName } : {}),
      ...(offer.resource.tags ? { tags: [...offer.resource.tags] } : {}),
      accepts: offer.accepts.map(accepted => ({ scheme: accepted.scheme, network: accepted.network,
        payTo: accepted.payTo, price: { asset: accepted.asset, amount: accepted.amount,
          ...(accepted.extra === undefined ? {} : { extra: structuredClone(accepted.extra) }) },
        maxTimeoutSeconds: accepted.maxTimeoutSeconds })),
      extensions: structuredClone(offer.extensions),
    };
    ids.add(id); origins.add(url.origin);
    return Object.freeze({ id, path, method, binding, offer: freeze(offer), handler, maxRequestBytes,
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

async function readBody(req, maxBytes, route) {
  const chunks = []; let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > maxBytes) throw fault('REQUEST_BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  const bodyType=route.offer.extensions.bazaar.info.input.bodyType;
  if (!count) return {body:null,bodyPresent:false,bodyType};
  if (!requiresJsonBody(req.method)) throw fault('REQUEST_BODY_NOT_SUPPORTED');
  if (bodyType==='form-data') return decodeMultipart(Buffer.concat(chunks),req.headers['content-type'],route.offer.extensions.bazaar.schema.properties.input.properties.body);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw fault('JSON_CONTENT_TYPE_REQUIRED', 415);
  }
  try { return {body:JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),bodyPresent:true,bodyType}; }
  catch { throw fault('INVALID_JSON_BODY'); }
}

function requestContext(req, route, target, parsed, pathParams, signal) {
  const {body}=parsed;
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
  application: { method: req.method, url: new URL(target.href), query, ...parsed,
    pathParams: Object.freeze({ ...pathParams }),
    headers: { ...req.headers }, signal } };
}

/** Node handler; nativeServer must be the operator-configured canonical SDK. */
export function createSellerResourceHandler({ compiled, nativeServer = null,
  maxRequestBytes = 1024 * 1024, maxResponseBytes = 1024 * 1024,
  maxStreamBytes, streamSpoolDirectory,
  admissionTimeoutMs = 2000, handlerTimeoutMs = 30000,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  validateAdmissionTimeout(admissionTimeoutMs);
  validateRequestTimeout(requestTimeoutMs);
  validateHandlerTimeout(handlerTimeoutMs);
  const streamLimit = validateMaxStreamBytes(maxStreamBytes);
  if (!compiled?.routes?.length || !compiled.nativeRoutes) throw new TypeError('Compiled seller routes required');
  for (const limit of [maxRequestBytes, maxResponseBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 * 1024) throw new TypeError('Invalid body limit');
  }
  if (nativeServer !== null && ['processHTTPRequest', 'processSettlement', 'createFailurePathSettlementHeaders']
      .some(key => typeof nativeServer[key] !== 'function')) throw new TypeError('Native x402 HTTP server required');
  let activeWork = 0;
  const counters = { deadlineExceeded: 0, clientDisconnects: 0, lateVerifiedResults: 0,
    cancellationRequests: 0, cancellationErrors: 0, interruptedSettlements: 0,
    streamsStarted: 0, streamsCompleted: 0, streamDeliveryFailures: 0,
    streamDeliveredBytes: 0, streamCleanupErrors: 0 };
  const handler = async function sellerResourceHandler(req, res) {
    const simple = (status, error, extra = {}) => send(req, res,
      encodeResponse({ status, headers: extra, body: { error } }, maxResponseBytes));
    let payment, lifetime, execution, cancellation, preparedStream, streamCloseReason;
    let phase = 'routing', verificationStarted = false, settlementStarted = false;
    // Original dispatcher, one invocation per verified attempt. A rejected cleanup
    // is observed and counted, never retried and never described as a refund.
    const cancelVerified = (verified, options) => {
      if (settlementStarted || verified?.type !== 'payment-verified' ||
          typeof verified.cancellationDispatcher?.cancel !== 'function') return Promise.resolve();
      if (!cancellation) {
        counters.cancellationRequests++;
        cancellation = lifetime.track(() => execution.cancel(verified, options));
        cancellation.catch(() => { counters.cancellationErrors++; });
      }
      return cancellation;
    };
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
      const requestOffer = materializeSellerRequestOffer(route,target,pathParams);
      if (requestOffer !== route.offer) {
        if (route.binding.dynamic) {
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
      activeWork++;
      lifetime = createRequestLifetime(req, res, { timeoutMs: requestTimeoutMs,
        onRetire(reason) {
        if (reason.code === 'REQUEST_DEADLINE_EXCEEDED') counters.deadlineExceeded++;
        else counters.clientDisconnects++;
        if (settlementStarted) counters.interruptedSettlements++;
      } });
      execution = createHandlerExecution(req, res, { timeoutMs: handlerTimeoutMs, signal: lifetime.signal });
      phase = 'body';
      const body = await lifetime.run(() => readBody(req, Math.min(maxRequestBytes,route.maxRequestBytes??maxRequestBytes), route));
      lifetime.assertOpen();
      const context = requestContext(req, route, target, body, pathParams, execution.signal);
      context.application.deadlineEpochMillis = lifetime.deadlineEpochMillis;
      if (route.admit) {
        phase = 'admission';
        try {
          const decision = await lifetime.run(() => evaluateAdmission(route.admit, context.application,
            { timeoutMs: admissionTimeoutMs, signal: lifetime.signal }));
          lifetime.assertOpen();
          if (decision !== true) {
            const rejected = decision === false ?
              { status: 422, body: { error: 'REQUEST_NOT_ADMITTED' } } : decision;
            if (!plain(rejected) || !Number.isInteger(rejected.status) ||
                rejected.status < 400 || rejected.status > 499 || rejected.status === 402) {
              throw new TypeError('Admission requires true, false or a nonpayment 4xx response');
            }
            return send(req, res, encodeResponse(rejected, maxResponseBytes, true));
          }
        } catch (error) {
          if (lifetime.signal.aborted) throw error;
          // No native verification, cancellation or settlement has been invoked.
          return simple(503, 'REQUEST_ADMISSION_UNAVAILABLE');
        }
      }
      execution.check();
      phase = 'verification';
      payment = await lifetime.run(() => {
        verificationStarted = true;
        return nativeServer.processHTTPRequest(context.sdk);
      }, { onLateValue: verified => {
        if (verified?.type !== 'payment-verified') return;
        counters.lateVerifiedResults++;
        return cancelVerified(verified, { reason: 'after_verify_aborted', error: lifetime.signal.reason });
      } });
      lifetime.assertOpen();
      if (payment?.type === 'payment-error') {
        return send(req, res, encodeResponse(payment.response, maxResponseBytes));
      }
      // Every configured route is paid. Native bypass hooks/unmatched routes
      // must not silently make it free or execute the application.
      if (payment?.type !== 'payment-verified' || typeof payment.cancellationDispatcher?.cancel !== 'function') {
        return simple(503, 'NATIVE_PAYMENT_GATE_NOT_VERIFIED');
      }
      let response;
      phase = 'application';
      try {
        response = await lifetime.run(() => execution.run(async application => {
          const result = await route.handler(application);
          if (!plain(result) || !Object.hasOwn(result, 'stream'))
            return encodeResponse(result, maxResponseBytes, true);
          let preparing = false;
          try {
            if (Object.hasOwn(result, 'body') || (result.status ?? 200) !== 200 || req.method === 'HEAD')
              throw new TypeError('A stream requires a 200 response without a separate body');
            const responseHeaders = headers(result.headers ?? {}, { application: true });
            preparing = true;
            preparedStream = await prepareResponseStream(result.stream, {
              headers: responseHeaders, signal: application.signal, payment, track: lifetime.track,
              maxBytes: streamLimit, ...(streamSpoolDirectory ? { spoolDirectory: streamSpoolDirectory } : {}),
            });
            counters.streamsStarted++;
            return { status: 200, headers: responseHeaders, stream: preparedStream };
          } catch (error) {
            if (!preparing) {
              try { await result.stream?.close?.(error); } catch { counters.streamCleanupErrors++; }
            }
            throw error;
          }
        }, context.application));
        lifetime.assertOpen();
        execution.check();
      } catch (error) {
        const reason = execution.interruption;
        const cleanup = cancelVerified(payment, { reason: 'handler_threw',
          error: reason ? execution.signal.reason : error });
        if (lifetime.signal.aborted) throw error;
        phase = 'cancellation';
        const cancelled = await lifetime.run(() => cleanup);
        lifetime.assertOpen();
        const receiptHeaders = nativeServer.createFailurePathSettlementHeaders(cancelled,
          payment.beforeHandlerSettlement, payment.paymentPayload, 'private, no-store') ?? {};
        return simple(reason === 'handler_timeout' ? 504 : 500,
          reason === 'handler_timeout' ? 'APPLICATION_TIMEOUT' : 'APPLICATION_FAILED', headers(receiptHeaders));
      }
      if (response.status >= 400) {
        const cleanup = cancelVerified(payment, { reason: 'handler_failed', responseStatus: response.status });
        phase = 'cancellation';
        const cancelled = await lifetime.run(() => cleanup);
        lifetime.assertOpen();
        const receiptHeaders = nativeServer.createFailurePathSettlementHeaders(cancelled,
          payment.beforeHandlerSettlement, payment.paymentPayload, 'private, no-store') ?? {};
        response.headers = { ...response.headers, ...headers(receiptHeaders) };
        return send(req, res, response);
      }
      const settled = await lifetime.run(() => {
        // No await between the final liveness check and committing to this one
        // native call. From this point retirement MUST NOT race it with cancel.
        execution.beginSettlement();
        phase = 'settlement';
        settlementStarted = true;
        return nativeServer.processSettlement(payment.paymentPayload, payment.paymentRequirements,
          payment.declaredExtensions, { request: context.sdk, responseBody: response.body,
            responseHeaders: response.headers }, undefined, payment.beforeHandlerSettlement);
      });
      lifetime.assertOpen();
      if (settled?.success !== true) {
        if (!settled?.response) return simple(502, 'SETTLEMENT_RESULT_UNAVAILABLE');
        return send(req, res, encodeResponse(settled.response, maxResponseBytes));
      }
      response.headers = { ...response.headers, ...headers(settled.headers) };
      if (response.stream) {
        phase = 'delivery';
        try {
          await lifetime.run(() => response.stream.send(req, res, response));
          counters.streamsCompleted++;
        } catch (error) {
          counters.streamDeliveryFailures++;
          streamCloseReason = error;
          // Headers already contain the original settlement. Do not replace them,
          // append an invented JSON error/event, or invoke another payment action.
          if (res.headersSent) { res.destroy(); return; }
          throw error;
        } finally {
          counters.streamDeliveredBytes += response.stream.snapshot().deliveredBytes;
        }
        return;
      }
      return send(req, res, response);
    } catch (error) {
      streamCloseReason ??= error;
      // Catch the final pre-settlement liveness/encoding edge as well. The existing
      // latch prevents a second cancellation if the application branch already ran it.
      if (payment?.type === 'payment-verified' && !settlementStarted && !cancellation) {
        const cleanup = cancelVerified(payment, { reason: 'after_verify_aborted', error });
        if (!lifetime.signal.aborted) {
          try { await lifetime.run(() => cleanup); } catch { /* Retirement/error below owns the response. */ }
        }
      }
      if (lifetime?.signal.aborted) {
        // A verification can complete after this response is retired; run() owns
        // that late result. Already-verified work is cleaned up here exactly once.
        if (!settlementStarted) cancelVerified(payment,
          { reason: 'after_verify_aborted', error: lifetime.signal.reason });
        if (res.destroyed || res.writableEnded) return;
        // An incomplete request must not leave a body reader attached to a reused
        // connection after the HTTP attempt has ended. Finish the error then close.
        if (!req.complete) {
          res.shouldKeepAlive = false;
          res.once('finish', () => { if (!req.complete) req.destroy(); });
        }
        return send(req, res, encodeResponse({ status: lifetime.signal.reason.status,
          body: { error: lifetime.signal.reason.code, stage: phase,
            ...(verificationStarted ? { paymentOutcome: 'unconfirmed', retrySafe: false } : {}) },
        }, maxResponseBytes));
      }
      if (!settlementStarted && execution?.interruption === 'handler_timeout')
        return simple(504, 'APPLICATION_TIMEOUT');
      // Only our request parsing/path errors may supply a public error message.
      // Native SDK errors can have status/message fields containing private data.
      const requestFault = ['routing', 'body'].includes(phase) &&
        Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
      return simple(requestFault ? error.status : verificationStarted ? 502 : 500,
        requestFault ? error.message : verificationStarted ? 'PAYMENT_PROCESSING_UNAVAILABLE' : 'SELLER_REQUEST_FAILED');
    } finally {
      try { await preparedStream?.close(streamCloseReason ?? lifetime?.signal.reason); }
      catch { counters.streamCleanupErrors++; }
      lifetime?.close();
      // Sending a 504 or losing the peer does not release the existing lifecycle
      // slot. Wait for real native work, its cleanup, and noncooperative handlers.
      await Promise.all([lifetime?.settled(), execution?.settled()]);
      // A handler which ignored its signal can finish preparation after retirement.
      // Its same close latch releases that late original source without replay.
      try { await preparedStream?.close(streamCloseReason ?? lifetime?.signal.reason); }
      catch { /* Already counted above if applicable. */ }
      execution?.dispose();
      if (lifetime) activeWork--;
    }
  };
  Object.defineProperty(handler, 'lifetimeSnapshot', {
    value: () => Object.freeze({ requestTimeoutMs, handlerTimeoutMs, activeWork, ...counters }),
  });
  return handler;
}

