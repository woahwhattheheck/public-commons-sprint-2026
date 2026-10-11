// MIT. Embed the original SF30 seller in a caller-owned Node HTTP application.
import { AsyncLocalStorage } from 'node:async_hooks';
import { compileSellerRoutes, createSellerResourceHandler } from '../resource-server.mjs';
import { selectServiceRoute } from '../route-path.mjs';
import { createSellerLifecycle } from '../lifecycle.mjs';
import { createSellerDeveloperPortal } from '../developer-portal.mjs';
import { requiresJsonBody } from '../http-methods.mjs';

const contexts = new AsyncLocalStorage();
const reserved = path => {
  const folded = path.replace(/[A-Z]/g, letter => letter.toLowerCase());
  return folded === '/_seller' || folded.startsWith('/_seller/');
};

function nativePathOwned(compiled, path) {
  // Native patterns ignore ASCII case and normalize trailing slashes. Keep those
  // aliases owned even when the original strict adapter answers them with 404;
  // Express's non-strict later routes must never make that same resource free.
  const decoded = decodeURIComponent(path);
  const trimmed = decoded.replace(/\/+$/, '') || '/';
  return compiled.routes.some(route => [decoded, trimmed, trimmed === '/' ? '/' : trimmed + '/']
    .some(candidate => route.binding.nativePattern.test(candidate)));
}

/** The host's explicit context, isolated across concurrent seller requests. */
export function getEmbeddedRequestContext() {
  return contexts.getStore()?.value;
}

function respond(req, res, status, value, extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length), 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function originalTarget(req) {
  // Express preserves the complete incoming target here when a mount strips url.
  // Never take payment identity from Host, Forwarded, req.protocol or req.hostname.
  const target = req.originalUrl === undefined ? req.url : req.originalUrl;
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') ||
      /[\x00-\x20\x7f]/.test(target) || target.includes('#')) {
    throw Object.assign(new TypeError('INVALID_REQUEST_TARGET'), { status: 400 });
  }
  return target;
}

function bodyConsumed(req) {
  if (!requiresJsonBody(req.method)) return false;
  // A framework parser has irreversibly consumed the stream. Its object is not
  // substituted for the body supplied to the original verifier/application.
  return req.body !== undefined || (req.readableEnded === true &&
    (Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined));
}

/**
 * Build once before mounting. Supply routes for the original compiler, or an
 * already compiled seller; nativeFactory is the original facilitator integration.
 * The caller keeps its listener, free routes, framework and facilitator lifetime.
 */
export async function createEmbeddedSeller({ routes, compiled: suppliedCompiled,
  allowLocalhost = false, nativeFactory = null, contextFromRequest = () => undefined,
  documentation = true, maxInFlight = 64, drainGraceMs = 60000,
  maxRequestBytes, maxResponseBytes, admissionTimeoutMs, handlerTimeoutMs,
  requestTimeoutMs } = {}) {
  if ((routes === undefined) === (suppliedCompiled === undefined))
    throw new TypeError('Choose original seller routes or one compiled seller');
  if (typeof contextFromRequest !== 'function' || typeof documentation !== 'boolean' ||
      nativeFactory !== null && typeof nativeFactory !== 'function')
    throw new TypeError('Invalid embedded seller options');
  const compiled = suppliedCompiled ?? compileSellerRoutes(routes, { allowLocalhost });
  if (!compiled?.routes?.length || !compiled.nativeRoutes)
    throw new TypeError('Original compiled seller required');
  if (compiled.routes.some(route => reserved(route.path) || route.binding?.segments?.[1]?.startsWith(':')))
    throw new TypeError('Seller resources need a fixed first path segment outside the reserved /_seller namespace');

  // Give the ORIGINAL lifecycle a request-scoped close boundary. Closing this
  // boundary stops paid admission; it never calls the host HTTP server's close.
  // Its active count still waits for both HTTP termination and original native
  // dispatch, including late verification, cancellation and settlement.
  const ownedResponses = new Set();
  const boundary = {
    close(done) { done(); },
    closeIdleConnections() {},
    closeAllConnections() {
      for (const response of ownedResponses) if (!response.destroyed) response.destroy();
    },
  };
  const lifecycle = createSellerLifecycle(boundary, { maxInFlight, drainGraceMs });
  const nativeServer = nativeFactory ? await nativeFactory(compiled) : null;
  if (nativeFactory && !nativeServer)
    throw new TypeError('Native factory did not return a resource server');
  const resources = createSellerResourceHandler({ compiled, nativeServer,
    ...Object.fromEntries(Object.entries({ maxRequestBytes, maxResponseBytes,
      admissionTimeoutMs, handlerTimeoutMs, requestTimeoutMs }).filter(([, value]) => value !== undefined)),
  });
  const mode = nativeServer ? 'NATIVE_X402' : 'CHALLENGE_ONLY';
  const portal = documentation ? createSellerDeveloperPortal({ compiled, mode }) : null;
  const info = Object.freeze({ schema: 'stellar-forge.embedded-seller.v1', mode,
    routes: Object.freeze(compiled.routes.map(route => Object.freeze({ id: route.id,
      method: route.method, url: route.offer.resource.url,
      ...(route.binding.dynamic ? { routeTemplate: route.path } : {}),
    }))),
  });

  function snapshot() {
    return { ...info, lifecycle: lifecycle.snapshot(), requestLifetime: resources.lifetimeSnapshot() };
  }

  function diagnostics(req, res, path) {
    if (!documentation || !reserved(path)) return false;
    if (portal(req, res)) return true;
    if (!['/_seller/health', '/_seller/offers', '/_seller/ready'].includes(path)) {
      respond(req, res, 404, { error: 'SELLER_RESOURCE_NOT_FOUND' }); return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      respond(req, res, 405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET, HEAD' }); return true;
    }
    if (path === '/_seller/ready') {
      const { state, accepting } = lifecycle.snapshot();
      respond(req, res, accepting ? 200 : 503, { state, accepting });
    } else {
      respond(req, res, 200, path === '/_seller/offers' ? compiled.routes.map(route => route.offer) : snapshot());
    }
    return true;
  }

  /** Resolve true for a consumed request, false when the host should continue. */
  async function handle(req, res) {
    if (!req || !res || typeof res.writeHead !== 'function' || typeof req.on !== 'function')
      throw new TypeError('Node IncomingMessage and ServerResponse required');
    let target, selected;
    try {
      target = originalTarget(req);
      const path = target.split('?')[0];
      selected = selectServiceRoute(compiled.routes, path, req.method);
      if (!selected && !nativePathOwned(compiled, path) && !(documentation && reserved(path))) return false;
    } catch (error) {
      respond(req, res, 400, { error: error?.message === 'NATIVE_ROUTE_CASE_COLLISION' ?
        'NATIVE_ROUTE_CASE_COLLISION' : 'INVALID_REQUEST_TARGET' });
      return true;
    }
    const priorUrl = req.url;
    try {
      req.url = target;
      if (diagnostics(req, res, target.split('?')[0])) return true;
      if (res.destroyed || res.writableEnded) return true;
      // Keep wrong-method ownership with the original adapter's 405. Otherwise
      // an application's later free route could bypass a paid resource's method.
      if (selected?.route && bodyConsumed(req)) {
        respond(req, res, 400, { error: 'SELLER_BODY_ALREADY_CONSUMED',
          action: 'Mount the seller before request body parsers' });
        return true;
      }
      let value;
      try {
        value = selected?.route ? contextFromRequest(req) : undefined;
        if (value && typeof value.then === 'function') {
          // Observe a mistaken async extractor without leaking its rejection.
          Promise.resolve(value).catch(() => {});
          throw new TypeError('Context extraction must be synchronous');
        }
      } catch {
        respond(req, res, 500, { error: 'SELLER_HOST_CONTEXT_UNAVAILABLE' });
        return true;
      }
      ownedResponses.add(res);
      const releaseResponse = () => {
        ownedResponses.delete(res);
        res.removeListener('finish', releaseResponse);
        res.removeListener('close', releaseResponse);
      };
      res.once('finish', releaseResponse);
      res.once('close', releaseResponse);
      try {
        await contexts.run({ value }, () => lifecycle.handle(req, res, () => resources(req, res)));
      } finally {
        if (res.writableFinished || res.destroyed) releaseResponse();
      }
      return true;
    } catch {
      if (res.headersSent) {
        if (!res.writableEnded && !res.destroyed) res.destroy();
      } else respond(req, res, 500, { error: 'SELLER_REQUEST_FAILED' });
      return true;
    } finally {
      // A mounted framework owns its request object outside this dispatch.
      if (req.url === target) req.url = priorUrl;
    }
  }

  /** Connect/Express 4 and 5 middleware, including async error propagation. */
  function middleware(req, res, next) {
    if (typeof next !== 'function') throw new TypeError('Middleware next callback required; use handle() for plain Node');
    return handle(req, res).then(consumed => { if (!consumed) return next(); }, next);
  }

  return Object.freeze({ compiled, mode, handle, middleware, snapshot, close: () => lifecycle.close() });
}
