// MIT. Multi-authority loopback ingress for independent ORIGINAL SF30 seller processes.
// No payment verification, signing, facilitator, wallet access or settlement simulation here.
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';

const HOST = '127.0.0.1';
const SCHEMA = 'stellar-forge.merchant-fleet.v1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
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
    return url.pathname;
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
    call.setTimeout(timeoutMs, () => call.destroy(new Error('ORIGINAL_SELLER_PROBE_TIMEOUT')));
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
  const names = new Set(), hosts = new Set(), ports = new Set(), tenants = [];
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
    const paths = new Map();
    for (const route of source.routes) {
      const method = route.offer?.extensions?.bazaar?.info?.input?.method ?? route.definition?.method;
      if (!['GET', 'HEAD', 'POST'].includes(method) || route.path.startsWith('/_seller/') ||
          route.path.startsWith('/_fleet/') || route.path.includes('%')) {
        throw new TypeError(item.id + ': invalid original seller method/path');
      }
      if (!paths.has(route.path)) paths.set(route.path, new Set());
      if (paths.get(route.path).has(method)) throw new TypeError('DUPLICATE_ORIGINAL_ROUTE');
      paths.get(route.path).add(method);
    }
    names.add(item.id); hosts.add(item.host); ports.add(upstreamPort);
    tenants.push({ id: item.id, host: item.host, upstreamPort, maxInFlight, maxRequestBytes,
      maxResponseBytes, timeoutMs, paths, active: 0, accepted: 0, completed: 0,
      refused: 0, errors: 0, mode: null });
  }
  return { schema: SCHEMA, tenants };
}
async function checkOriginal(tenant) {
  const [health, offers] = await Promise.all([
    originalRead(tenant.upstreamPort, '/_seller/health'),
    originalRead(tenant.upstreamPort, '/_seller/offers'),
  ]);
  if (health.schema !== 'stellar-forge.seller-service.v1' ||
      !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(health.mode) ||
      !Array.isArray(health.routes) || !Array.isArray(offers)) {
    throw new Error(tenant.id + ': upstream is NOT an original SF30 seller');
  }
  const expected = [...tenant.paths].flatMap(([path, methods]) =>
    [...methods].map(method => method + ' https://' + tenant.host + path)).sort();
  const actual = health.routes.map(route => route.method + ' ' + route.url).sort();
  const actualOffers = offers.map(offer => offer.extensions?.bazaar?.info?.input?.method +
    ' ' + offer.resource?.url).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual) ||
      JSON.stringify(expected) !== JSON.stringify(actualOffers)) {
    throw new Error(tenant.id + ': original live seller routes/identity drift from config');
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
export async function startMerchantFleet(fleet, { port = 8400, adminPort = 8401 } = {}) {
  if (fleet?.schema !== SCHEMA || !Array.isArray(fleet.tenants) || fleet.tenants.length < 2)
    throw new TypeError('A prepared merchant fleet is required');
  number(port, 0, 65535, 'publicPort'); number(adminPort, 0, 65535, 'adminPort');
  if (port !== 0 && port === adminPort) throw new TypeError('Separate public/admin loopback ports required');
  for (const tenant of fleet.tenants) {
    if (port !== 0 && tenant.upstreamPort === port || adminPort !== 0 && tenant.upstreamPort === adminPort) {
      throw new TypeError('An ingress port conflicts with an original seller port');
    }
    await checkOriginal(tenant); // Only real ORIGINAL running sellers, never pretend merchant service.
  }
  const byHost = new Map(fleet.tenants.map(t => [t.host, t]));
  const publicServer = createServer(async (req, res) => {
    const host = authority(req);
    if (!host) return fault(res, 400, 'CANONICAL_HOST_REQUIRED');
    const tenant = byHost.get(host);
    if (!tenant) return fault(res, 421, 'UNKNOWN_MERCHANT_AUTHORITY');
    const path = safePath(req.url);
    if (!path || path.startsWith('/_seller/') || path.startsWith('/_fleet/')) {
      tenant.refused++; return fault(res, 404, 'SELLER_ROUTE_NOT_PUBLIC');
    }
    const allowed = tenant.paths.get(path);
    if (!allowed) { tenant.refused++; return fault(res, 404, 'SELLER_ROUTE_NOT_PUBLISHED'); }
    if (!allowed.has(req.method)) {
      tenant.refused++; return fault(res, 405, 'SELLER_METHOD_NOT_PUBLISHED',
        { allow: [...allowed].join(', ') });
    }
    if (tenant.active >= tenant.maxInFlight) {
      tenant.refused++; return fault(res, 503, 'SELLER_AT_CAPACITY', { 'retry-after': '1' });
    }
    const bodyForbidden = req.method !== 'POST' &&
      (Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding']);
    if (bodyForbidden) { tenant.refused++; return fault(res, 400, 'BODY_ON_READ_METHOD'); }
    tenant.active++;
    tenant.accepted++;
    try {
      const body = req.method === 'POST' ? await collectBody(req, tenant.maxRequestBytes) : Buffer.alloc(0);
      await forward(req, res, tenant, body);
    } catch (error) {
      tenant.errors++;
      fault(res, error.status === 413 ? 413 : 400,
        error.status === 413 ? 'REQUEST_TOO_LARGE' : 'REQUEST_BODY_INVALID');
    } finally { tenant.active--; }
  });
  publicServer.headersTimeout = 10000;
  publicServer.requestTimeout = 60000;
  publicServer.keepAliveTimeout = 5000;
  const adminServer = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/_fleet/health') {
      return fault(res, 404, 'ADMIN_ROUTE_NOT_FOUND');
    }
    const data = { schema: SCHEMA, merchants: fleet.tenants.map(t => ({
      id: t.id, host: t.host, mode: t.mode, upstreamPort: t.upstreamPort,
      routes: [...t.paths.values()].reduce((n, methods) => n + methods.size, 0),
      active: t.active, maxInFlight: t.maxInFlight, accepted: t.accepted,
      completed: t.completed, refused: t.refused, errors: t.errors,
    })) };
    const body = JSON.stringify(data);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  const listen = (server, listenPort) => new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(listenPort, HOST, done);
  });
  try {
    await listen(publicServer, port);
    await listen(adminServer, adminPort);
    const closeOne = server => new Promise((done, fail) => {
      server.close(error => error ? fail(error) : done());
      server.closeIdleConnections?.();
    });
    const close = () => Promise.all([closeOne(publicServer), closeOne(adminServer)]);
    return { publicServer, adminServer, close,
      publicURL: 'http://' + HOST + ':' + publicServer.address().port,
      adminURL: 'http://' + HOST + ':' + adminServer.address().port };
  } catch (error) {
    publicServer.closeIdleConnections?.();
    if (publicServer.listening) await new Promise(done => publicServer.close(done));
    if (adminServer.listening) await new Promise(done => adminServer.close(done));
    throw error;
  }
}
