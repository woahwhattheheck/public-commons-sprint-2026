// MIT. Loopback HTTP transport for the original SF101 recovery workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openRecoveryWorkspace } from './model.mjs';

const MAX_BODY = 65536;
const TYPES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function fail(code, message, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function responseError(error) {
  const value = { code: String(error.code ?? 'RECOVERY_WORKSPACE_FAILED').slice(0, 100),
    message: String(error.message ?? 'The recovery workspace request failed').slice(0, 500) };
  for (const key of ['providerCode', 'requestId', 'putRequestId', 'retryAfter', 'retryable', 'mayHaveCommitted'])
    if (['string', 'number', 'boolean'].includes(typeof error[key])) value[key] = error[key];
  return value;
}
function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) + '\n' : body);
  headers(res); res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length }); res.end(data);
}
function authorized(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function fields(value, allowed) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some(key => !allowed.includes(key)))
    fail('WORKSPACE_INPUT_INVALID', 'Unexpected recovery request fields');
  return value;
}
function body(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json')
    fail('WORKSPACE_JSON_REQUIRED', 'Send the recovery selection as application/json', 415);
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    fail('WORKSPACE_REQUEST_TOO_LARGE', 'Recovery request exceeds 64 KiB', 413);
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!settled) { settled = true; const error = new Error('Recovery request exceeds 64 KiB'); error.code = 'WORKSPACE_REQUEST_TOO_LARGE'; error.status = 413; reject(error); }
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { const error = new Error('Recovery request is not valid JSON'); error.code = 'WORKSPACE_JSON_INVALID'; error.status = 400; reject(error); }
    });
    req.on('aborted', () => { if (!settled) { settled = true; const error = new Error('Recovery request was interrupted'); error.code = 'WORKSPACE_REQUEST_INTERRUPTED'; error.status = 400; reject(error); } });
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}
function query(url, allowed) {
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) fail('WORKSPACE_QUERY_INVALID', 'Unexpected or repeated recovery query field');
    seen.add(key);
  }
  return Object.fromEntries(url.searchParams);
}
function page(input) {
  const value = {};
  if (input.cursor) value.cursor = input.cursor;
  if (input.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(input.limit) || Number(input.limit) > 100)
      fail('WORKSPACE_PAGE_LIMIT_INVALID', 'Page limit must be between 1 and 100');
    value.limit = Number(input.limit);
  }
  return value;
}

// An embedding host can mount this exact handler after providing its owned
// workspace and exact loopback origin. Sensitive API responses require the token.
export function createRecoveryHandler({ workspace, token, origin }) {
  const expected = new URL(origin);
  if (expected.protocol !== 'http:' || expected.hostname !== '127.0.0.1' ||
      expected.pathname !== '/' || expected.search || expected.hash || expected.username || expected.password)
    fail('WORKSPACE_LOOPBACK_REQUIRED', 'Recovery workspace uses an exact loopback origin');
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) fail('WORKSPACE_TOKEN_INVALID', 'A generated recovery session token is required');
  const assets = new Map();
  return async function recoveryHandler(req, res) {
    try {
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress))
        fail('WORKSPACE_LOOPBACK_REQUIRED', 'Recovery workspace accepts local connections only', 403);
      if (req.headers.host !== expected.host) fail('WORKSPACE_HOST_REJECTED', 'Open the printed recovery workspace address', 403);
      if (req.headers.origin && req.headers.origin !== expected.origin)
        fail('WORKSPACE_ORIGIN_REJECTED', 'Recovery workspace requires its own origin', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site')
        fail('WORKSPACE_ORIGIN_REJECTED', 'Recovery workspace requires its own origin', 403);
      const url = new URL(req.url, expected.origin);
      if (url.origin !== expected.origin) fail('WORKSPACE_ORIGIN_REJECTED', 'Invalid recovery request origin', 403);
      if (TYPES.has(url.pathname)) {
        if (!['GET', 'HEAD'].includes(req.method)) fail('WORKSPACE_METHOD_INVALID', 'Use GET for workspace assets', 405);
        if (url.search) fail('WORKSPACE_QUERY_INVALID', 'Workspace assets do not accept query parameters');
        const [filename, type] = TYPES.get(url.pathname);
        if (!assets.has(filename)) assets.set(filename, await readFile(new URL(filename, import.meta.url)));
        const data = assets.get(filename);
        headers(res); res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      if (!url.pathname.startsWith('/api/')) fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
      if (!authorized(req.headers['x-recovery-token'], token))
        fail('WORKSPACE_SESSION_REQUIRED', 'Open the current browser URL printed by workspace serve', 401);
      if (req.method === 'GET') {
        let value;
        switch (url.pathname) {
          case '/api/state': query(url, []); value = await workspace.state(); break;
          case '/api/requests': { const q = query(url, ['cursor', 'limit']); value = await workspace.requests(page(q)); break; }
          case '/api/bundles': { const q = query(url, ['profile']); value = await workspace.localBundles(q.profile); break; }
          case '/api/operations': { const q = query(url, ['profile', 'cursor', 'limit']); value = await workspace.operations(q.profile, page(q)); break; }
          case '/api/operation': { const q = query(url, ['profile', 'id']); value = await workspace.operation(q.profile, q.id); break; }
          case '/api/inventory': { const q = query(url, ['profile', 'cursor', 'limit']); value = await workspace.inventory(q.profile, page(q)); break; }
          default: fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
        }
        send(res, 200, value); return;
      }
      if (req.method === 'POST') {
        query(url, []);
        const value = await body(req);
        let result;
        switch (url.pathname) {
          case '/api/review': result = await workspace.review(value); break;
          case '/api/start': fields(value, ['selection', 'expectedReviewHash']); result = await workspace.start(value); break;
          case '/api/resume': fields(value, ['profileId', 'id']); result = await workspace.resume(value.profileId, value.id); break;
          case '/api/cancel': fields(value, ['profileId', 'id']); result = await workspace.cancel(value.profileId, value.id); break;
          default: fail('WORKSPACE_ROUTE_NOT_FOUND', 'Unknown recovery workspace route', 404);
        }
        send(res, 200, result); return;
      }
      fail('WORKSPACE_METHOD_INVALID', 'Use the documented recovery workspace method', 405);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
        error.code === 'ENOENT' ? 404 : 500;
      send(res, status, { error: responseError(error) });
    }
  };
}

export async function serveRecoveryWorkspace({ configFile, directory, port = 8481 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    fail('WORKSPACE_PORT_INVALID', 'Choose a TCP port from 0 through 65535');
  const workspace = await openRecoveryWorkspace({ configFile, directory });
  const token = randomBytes(32).toString('hex');
  let handler, closePromise;
  const server = createServer((req, res) => handler ? handler(req, res) : send(res, 503, { error: { code: 'WORKSPACE_STARTING', message: 'Recovery workspace is starting' } }));
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  try {
    await new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', listening); reject(error); };
      const listening = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', listening);
      server.listen(port, '127.0.0.1');
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    handler = createRecoveryHandler({ workspace, token, origin });
    const close = ({ cancelActive = true } = {}) => {
      if (!closePromise) closePromise = (async () => {
        const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeIdleConnections();
        try { await workspace.close({ cancelActive }); await stopped; }
        finally { finish(); }
      })();
      return closePromise;
    };
    return { server, workspace, origin, url: origin + '/#token=' + token, close, closed };
  } catch (error) {
    server.close();
    await workspace.close({ cancelActive: true }); finish(); throw error;
  }
}
