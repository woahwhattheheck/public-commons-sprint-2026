// MIT. Multi-authority loopback ingress for independent ORIGINAL SF30 seller processes.
// No payment verification, signing, facilitator, wallet access or settlement simulation here.
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { compileAssetRouteOffer, responseAssetLimits } from '../sf30-seller-sdk/response-asset.mjs';
import { selectServiceRoute } from '../sf30-seller-sdk/route-path.mjs';
import { createFleetRollout } from './rollout.mjs';
import { openRolloutState } from './rollout-state.mjs';
import { createFleetControl } from './control-server.mjs';

const HOST = '127.0.0.1';
const SCHEMA = 'stellar-forge.merchant-fleet.v1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const domainLabel = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const domainPattern = new RegExp('^' + domainLabel + '(?:\\.' + domainLabel + ')+$');
const banned = new Set(['host', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']);
const number = (x, min, max, name) => {
  if (!Number.isSafeInteger(x) || x < min || x > max) throw new TypeError(name + ' outside ' + min + '..' + max);
  return x;
};
function fault(res, status, code, headers = {}) {
  if (res.headersSent) { res.destroy(); return; }
  const body = JSON.stringify({ error: code });
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function authority(req) {
  const entries = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'host') entries.push(req.rawHeaders[i + 1]);
  }
  if (entries.length !== 1 || typeof entries[0] !== 'string') return null;
  const host = entries[0].toLowerCase().replace(/:443$/, '');
  if (!domainPattern.test(host) || host.length > 253) return null;
  return host;
}
function safePath(raw) {
  if (typeof raw !== 'string' || raw.length > 8192 || !raw.startsWith('/') ||
      raw.startsWith('//') || raw.includes('#') || /%(?:2f|5c|00)/i.test(raw)) return null;
  try {
    const url = new URL(raw, 'https://seller.invalid');
    return url.pathname === raw.split('?')[0] ? url.pathname : null;
  } catch { return null; }
}
function safeHeaders(input, response = false) {
  const headers = {};
  for (const [key, value] of Object.entries(input)) {
    const name = key.toLowerCase();
    if (banned.has(name) || name.startsWith('x-forwarded-')) continue;
    if (!response && name === 'content-length') continue;
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}
async function originalRead(port, route, timeoutMs = 3000) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => call.destroy(new Error('ORIGINAL_SELLER_PROBE_TIMEOUT')), timeoutMs);
    const call = httpRequest({ hostname: HOST, port, path: route, method: 'GET',
      headers: { host: HOST } }, response => {
      if (response.statusCode !== 200) {
        response.resume(); fail(new Error('ORIGINAL_SELLER_STATUS_' + response.statusCode)); return;
      }
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 512 * 1024) { response.destroy(new Error('ORIGINAL_SELLER_PROBE_OVERSIZE')); return; }
        chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        try { done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { fail(e); }
      });
    });
    call.once('close', () => clearTimeout(timer));
    call.on('error', fail);
    call.end();
  });
}
export async function loadMerchantFleet(manifestPath) {
  const bytes = await readFile(manifestPath);
  if (bytes.length > 256 * 1024) throw new TypeError('FLEET_MANIFEST_TOO_LARGE');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!object(raw) || raw.schema !== SCHEMA || !Array.isArray(raw.tenants) ||
      raw.tenants.length < 2 || raw.tenants.length > 32) {
    throw new TypeError('Expected merchant-fleet.v1 with 2..32 independent tenants');
  }
  const names = new Set(), hosts = new Set(), ports = new Set(), tenants = [], sourceConfigs = [];
  for (const item of raw.tenants) {
    if (!object(item) || typeof item.id !== 'string' ||
        !/^[a-z][a-z0-9-]{1,39}$/.test(item.id) || names.has(item.id) ||
        typeof item.host !== 'string' || !domainPattern.test(item.host) ||
        item.host.length > 253 || hosts.has(item.host) ||
        typeof item.sellerConfig !== 'string' || !item.sellerConfig.trim()) {
      throw new TypeError('Each tenant requires a unique ID, lowercase DNS host, and sellerConfig');
    }
    const upstreamPort = number(item.upstreamPort, 1, 65535, 'upstreamPort');
    if (ports.has(upstreamPort)) throw new TypeError('Each merchant must own a different local seller port');
    const maxInFlight = number(item.maxInFlight ?? 12, 1, 512, 'maxInFlight');
    const maxRequestBytes = number(item.maxRequestBytes ?? 1024 * 1024, 1024, 4 * 1024 * 1024, 'maxRequestBytes');
    const maxResponseBytes = number(item.maxResponseBytes ?? 8 * 1024 * 1024, 1024, 16 * 1024 * 1024, 'maxResponseBytes');
    const timeoutMs = number(item.timeoutMs ?? 15000, 1000, 60000, 'timeoutMs');
    const source = await readSellerConfig(resolve(dirname(resolve(manifestPath)), item.sellerConfig));
    if (source.publicOrigin !== 'https://' + item.host) {
      throw new TypeError(item.id + ': original seller publicOrigin MUST equal https://' + item.host);
    }
    const sellerLimits = responseAssetLimits(source);
    const compiled = compileSellerRoutes(source.routes.map(route => ({ id: route.id,
      ...(route.responseAsset ? { offer: compileAssetRouteOffer(route, source.publicOrigin, compileHttpSellerOffer) } :
        route.offer ? { offer: route.offer } :
        { definition: { ...route.definition, url: source.publicOrigin + route.path } }),
      handler: () => { throw new Error('Gateway never executes merchant applications'); },
    })));
    for (const route of source.routes) {
      const path = route.path.toLowerCase();
      if (path === '/_seller' || path.startsWith('/_seller/') ||
          path === '/_fleet' || path.startsWith('/_fleet/')) {
        throw new TypeError(item.id + ': original operator routes cannot be published');
      }
    }
    const expectedHealth = compiled.routes.map(route => {
      const config = source.routes.find(entry => entry.id === route.id);
      return { id: route.id, method: route.method, url: route.offer.resource.url,
        admission: Boolean(config.admit) || config.validateInput === true || Boolean(config.responseAsset),
        inputValidation: config.validateInput === true,
        ...(config.responseAsset ? { asset: { sha256: config.responseAsset.sha256,
          contentType: config.responseAsset.contentType, downloadName: config.responseAsset.downloadName } } : {}),
        ...(route.binding.dynamic ? { routeTemplate: route.path } : {}) };
    });
    const identity = { id: item.id, host: item.host, upstreamPort, maxInFlight,
      maxRequestBytes, maxResponseBytes, timeoutMs, config: source };
    names.add(item.id); hosts.add(item.host); ports.add(upstreamPort);
    tenants.push({ id: item.id, host: item.host, upstreamPort, maxInFlight, maxRequestBytes,
      maxResponseBytes, timeoutMs, compiled, expectedHealth, sellerLimits, fingerprint: fingerprint(identity),
      nativeFingerprint: fingerprint({ host: item.host, config: source }),
      active: 0, accepted: 0, completed: 0, refused: 0, errors: 0, mode: null });
    sourceConfigs.push(source);
  }
  return { schema: SCHEMA, tenants, sourceManifest: raw, sourceConfigs };
}
async function checkOriginal(tenant) {
  const [health, offers] = await Promise.all([
    originalRead(tenant.upstreamPort, '/_seller/health'),
    originalRead(tenant.upstreamPort, '/_seller/offers'),
  ]);
  if (health.schema !== 'stellar-forge.seller-service.v1' ||
      !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(health.mode) ||
      !Array.isArray(health.routes) || !Array.isArray(offers) || health.lifecycle?.accepting !== true) {
    throw new Error(tenant.id + ': upstream is NOT an original SF30 seller');
  }
  let assetBytes = 0, assets = 0;
  const liveRoutes = health.routes.map(route => {
    if (!Object.hasOwn(route, 'asset')) return route;
    const { bytes, ...metadata } = route.asset ?? {};
    if (!Number.isSafeInteger(bytes) || bytes < 0 ||
        bytes > tenant.sellerLimits.maxResponseBytes || bytes > tenant.maxResponseBytes)
      throw new Error(tenant.id + ': original asset exceeds published gateway response capacity');
    assetBytes += bytes; assets++;
    return { ...route, asset: metadata };
  });
  if (assets && (assetBytes > tenant.sellerLimits.assetBudgetBytes ||
      health.assetSnapshotBytes !== assetBytes || health.maxResponseBytes !== tenant.sellerLimits.maxResponseBytes))
    throw new Error(tenant.id + ': original retained asset limits drift from config');
  if (!isDeepStrictEqual(tenant.expectedHealth, liveRoutes) ||
      !isDeepStrictEqual(tenant.compiled.routes.map(route => route.offer), offers)) {
    throw new Error(tenant.id + ': original live seller offers/routes/admission drift from config');
  }
  tenant.mode = health.mode;
}
async function collectBody(req, maxBytes) {
  const stated = req.headers['content-length'];
  if (stated !== undefined && (!/^(0|[1-9]\d*)$/.test(stated) || Number(stated) > maxBytes)) {
    throw Object.assign(new Error('REQUEST_TOO_LARGE'), { status: 413 });
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function forward(req, res, tenant, body) {
  return new Promise(done => {
    let settled = false, bytes = 0;
    const finish = () => { if (!settled) { settled = true; done(); } };
    const headers = safeHeaders(req.headers);
    headers.host = tenant.host;
    headers['x-forwarded-proto'] = 'https';
    headers['content-length'] = String(body.length);
    const upstream = httpRequest({ hostname: HOST, port: tenant.upstreamPort,
      method: req.method, path: req.url, headers }, received => {
      if (settled) { received.destroy(); return; }
      const responseHeaders = safeHeaders(received.headers, true);
      if ([204, 205, 304].includes(received.statusCode)) delete responseHeaders['content-length'];
      const announced = Number(responseHeaders['content-length']);
      if (Number.isFinite(announced) && announced > tenant.maxResponseBytes) {
        received.destroy(); tenant.errors++; fault(res, 502, 'SELLER_RESPONSE_LIMIT'); finish(); return;
      }
      res.writeHead(received.statusCode ?? 502, responseHeaders);
      received.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > tenant.maxResponseBytes) {
          tenant.errors++; received.destroy(); res.destroy(); finish(); return;
        }
        if (!res.write(chunk)) received.pause();
      });
      res.on('drain', () => received.resume());
      received.on('end', () => {
        if (!res.writableEnded) res.end();
        tenant.completed++; finish();
      });
      received.on('error', () => {
        tenant.errors++; if (!res.writableEnded) res.destroy(); finish();
      });
    });
    upstream.on('error', () => {
      tenant.errors++;
      fault(res, 502, 'ORIGINAL_SELLER_UNREACHABLE'); finish();
    });
    upstream.setTimeout(tenant.timeoutMs, () => upstream.destroy(new Error('ORIGINAL_SELLER_TIMEOUT')));
    res.once('close', () => { if (!res.writableEnded) upstream.destroy(); });
    upstream.end(body);
  });
}
export async function startMerchantFleet(fleet, { port = 8400, adminPort = 8401,
  stateDirectory = null, initialManifest = null } = {}) {
  number(port, 0, 65535, 'publicPort'); number(adminPort, 0, 65535, 'adminPort');
  if (port !== 0 && port === adminPort) throw new TypeError('Separate public/admin loopback ports required');
  const store = stateDirectory === null ? null : await openRolloutState(stateDirectory);
  let publicServer, adminServer, rollout, stopping = false, closePromise;
  const closeOne = server => !server?.listening ? Promise.resolve() : new Promise((done, fail) => {
    server.close(error => error ? fail(error) : done());
    server.closeIdleConnections?.();
  });
  try {
    let record = store?.read();
    // Retained selection is authoritative. Editing an input manifest cannot
    // silently bypass preparation/activation on a gateway restart.
    if (record) fleet = await loadMerchantFleet(store.manifest(record));
    else if (!fleet && initialManifest) fleet = await loadMerchantFleet(initialManifest);
    if (fleet?.schema !== SCHEMA || !Array.isArray(fleet.tenants) || fleet.tenants.length < 2 ||
        fleet.tenants.some(tenant => !tenant.compiled?.routes?.length))
      throw new TypeError('A prepared merchant fleet or retained --state is required');
    for (const tenant of fleet.tenants) {
      if (port !== 0 && tenant.upstreamPort === port || adminPort !== 0 && tenant.upstreamPort === adminPort)
        throw new TypeError('An ingress port conflicts with an original seller port');
    }
    await Promise.all(fleet.tenants.map(checkOriginal));
    if (store && !record) record = store.activate(store.snapshot(fleet), 0);
    rollout = createFleetRollout(fleet, { store, record, load: loadMerchantFleet, check: checkOriginal,
      ports: () => [publicServer?.address()?.port, adminServer?.address()?.port].filter(Boolean) });
    publicServer = createServer(async (req, res) => {
      if (stopping) return fault(res, 503, 'FLEET_DRAINING');
      const host = authority(req);
      if (!host) return fault(res, 400, 'CANONICAL_HOST_REQUIRED');
      // This exact object stays captured through body collection and forwarding,
      // even when another generation is activated during either await.
      const tenant = rollout.tenant(host);
      if (!tenant) return fault(res, 421, 'UNKNOWN_MERCHANT_AUTHORITY');
      const path = safePath(req.url);
      if (!path || /^\/_(?:seller|fleet)(?:\/|$)/i.test(path)) {
        tenant.refused++; return fault(res, 404, 'SELLER_ROUTE_NOT_PUBLIC');
      }
      let selected;
      try { selected = selectServiceRoute(tenant.compiled.routes, path, req.method); }
      catch { tenant.refused++; return fault(res, 400, 'INVALID_ORIGINAL_ROUTE_TARGET'); }
      if (!selected) { tenant.refused++; return fault(res, 404, 'SELLER_ROUTE_NOT_PUBLISHED'); }
      if (!selected.route) {
        tenant.refused++; return fault(res, 405, 'SELLER_METHOD_NOT_PUBLISHED',
          { allow: selected.allow.join(', ') });
      }
      const acceptsBody = selected.route.offer.extensions.bazaar.info.input.bodyType === 'json';
      const bodyForbidden = !acceptsBody &&
        (Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding']);
      if (bodyForbidden) { tenant.refused++; return fault(res, 400, 'BODY_NOT_PUBLISHED'); }
      const release = rollout.admit(tenant);
      if (!release) {
        tenant.refused++; return fault(res, 503, 'SELLER_AT_CAPACITY', { 'retry-after': '1' });
      }
      try {
        const body = acceptsBody ? await collectBody(req, tenant.maxRequestBytes) : Buffer.alloc(0);
        await forward(req, res, tenant, body);
      } catch (error) {
        tenant.errors++;
        fault(res, error.status === 413 ? 413 : 400,
          error.status === 413 ? 'REQUEST_TOO_LARGE' : 'REQUEST_BODY_INVALID');
      } finally { release(); }
    });
    publicServer.headersTimeout = 10000;
    publicServer.requestTimeout = 60000;
    publicServer.keepAliveTimeout = 5000;
    adminServer = createServer(createFleetControl({ rollout, store,
      url: () => 'http://' + HOST + ':' + adminServer.address().port }));
    adminServer.headersTimeout = 10000;
    adminServer.requestTimeout = 10000;
    adminServer.keepAliveTimeout = 5000;
    const listen = (server, listenPort) => new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(listenPort, HOST, done);
    });
    await listen(publicServer, port);
    await listen(adminServer, adminPort);
    const adminURL = 'http://' + HOST + ':' + adminServer.address().port;
    store?.publish(adminURL);
    const close = () => {
      if (!closePromise) {
        stopping = true;
        const operationDone = rollout.shutdown();
        closePromise = Promise.all([closeOne(publicServer), closeOne(adminServer), operationDone])
          .then(() => store?.close());
      }
      return closePromise;
    };
    return { publicServer, adminServer, close, status: rollout.status,
      withRetiredPort: rollout.withRetiredPort,
      publicURL: 'http://' + HOST + ':' + publicServer.address().port, adminURL,
      controlPath: store?.controlPath ?? null };
  } catch (error) {
    stopping = true;
    const operationDone = rollout?.shutdown();
    await Promise.allSettled([closeOne(publicServer), closeOne(adminServer), operationDone]);
    await store?.close();
    throw error;
  }
}
