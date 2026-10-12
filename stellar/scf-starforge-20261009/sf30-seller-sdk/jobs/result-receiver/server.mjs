// MIT. Signed public result intake and a separate private customer desk.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { openResultReceiver } from './store.mjs';
import { validateSecret, MAX_MANIFEST_HEADER_BYTES } from '../result-delivery/wire.mjs';
import { acquireDeliveryLease } from '../../../sf98-merchant-delivery/delivery-lock.mjs';

const publicRoot = new URL('./public/', import.meta.url);
const TYPES = { 'index.html': 'text/html; charset=utf-8', 'app.mjs': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8' };
const fail = (code, status) => Object.assign(new Error(code), { code, status });
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
function security(response) {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', csp);
}
function json(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body) + '\n');
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length });
  response.end(bytes);
}
function report(response, failure) {
  if (response.headersSent) { response.destroy(); return; }
  const code = typeof failure.code === 'string' && /^(?:JRR_|JRD_)[A-Z_]+$/.test(failure.code)
    ? failure.code : failure.code === 'ENOENT' ? 'JRR_NOT_FOUND'
      : failure.code === 'ENOSPC' ? 'JRR_STORAGE_FULL' : 'JRR_OPERATION_FAILED';
  const status = failure.status ?? (failure.code === 'ENOENT' ? 404 : failure.code === 'ENOSPC' ? 507 : 500);
  json(response, status, { error: code });
}
function validToken(actual, expected) {
  if (typeof actual !== 'string' || !actual.startsWith('Bearer ')) return false;
  const value = Buffer.from(actual.slice(7)); const wanted = Buffer.from(expected);
  return value.length === wanted.length && timingSafeEqual(value, wanted);
}
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const bad = failure => reject(failure);
    server.once('error', bad);
    server.listen(port, host, () => { server.off('error', bad); resolve(server.address()); });
  });
}
function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close(failure => failure ? reject(failure) : resolve()));
}
function endpoint(address) {
  const host = address.address.includes(':') ? '[' + address.address + ']' : address.address;
  return 'http://' + host + ':' + address.port;
}

export async function startResultReceiver({ root, secret, host = '127.0.0.1', port = 0,
  operatorPort = 0, operatorToken = randomBytes(32).toString('base64url'),
  maxConcurrent = 4, requestTimeoutMs = 60000, clock = Date.now } = {}) {
  validateSecret(secret);
  if (typeof operatorToken !== 'string' || Buffer.byteLength(operatorToken) < 32 ||
      Buffer.byteLength(operatorToken) > 512) throw fail('JRR_OPERATOR_TOKEN_REQUIRED', 400);
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16 ||
      !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 300000)
    throw fail('JRR_SERVER_OPTIONS_INVALID', 400);
  for (const value of [port, operatorPort]) if (!Number.isInteger(value) || value < 0 || value > 65535)
    throw fail('JRR_PORT_INVALID', 400);
  const store = await openResultReceiver(root, { clock });
  const lease = await acquireDeliveryLease(store.root, { purpose: 'worker' });
  let recovery;
  try { recovery = await store.recoverIncoming({ lease }); }
  catch (failure) { await lease.release(); throw failure; }
  const path = new URL(store.config.destination.url).pathname;
  let receiving = 0; let closing = false;
  const active = new Set();
  const track = operation => { active.add(operation); operation.finally(() => active.delete(operation)).catch(() => {}); };

  const receiver = createServer({ maxHeaderSize: MAX_MANIFEST_HEADER_BYTES + 8192 }, (request, response) => {
    security(response);
    const operation = (async () => {
      if (closing) throw fail('JRR_DRAINING', 503);
      if (request.url !== path || request.method !== 'POST') throw fail('JRR_ROUTE_NOT_FOUND', 404);
      if (receiving >= maxConcurrent) { response.setHeader('retry-after', '5'); throw fail('JRR_RECEIVER_BUSY', 503); }
      receiving++;
      request.setTimeout(requestTimeoutMs, () => request.destroy(fail('JRR_UPLOAD_TIMEOUT', 408)));
      try {
        const result = await store.receive({ headers: request.headers, body: request, secret, lease });
        if (!response.destroyed) json(response, result.duplicate ? 200 : 201, result.receipt);
      } finally { receiving--; }
    })();
    track(operation);
    operation.catch(failure => {
      if (!response.destroyed) {
        if (!response.headersSent) response.setHeader('connection', 'close');
        response.once('finish', () => request.destroy());
        report(response, failure);
      }
    });
  });

  const operator = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    security(response);
    // A client that stops reading a download must not retain the service lease forever.
    response.setTimeout(requestTimeoutMs, () => response.destroy(fail('JRR_DOWNLOAD_TIMEOUT', 408)));
    const operation = (async () => {
      if (closing) throw fail('JRR_DRAINING', 503);
      if (request.method !== 'GET') throw fail('JRR_METHOD_NOT_ALLOWED', 405);
      const address = operator.address();
      const expectedHost = '127.0.0.1:' + address.port;
      if (request.headers.host !== expectedHost) throw fail('JRR_OPERATOR_HOST_INVALID', 403);
      if (request.headers.origin && request.headers.origin !== 'http://' + expectedHost)
        throw fail('JRR_OPERATOR_ORIGIN_INVALID', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('JRR_OPERATOR_ORIGIN_INVALID', 403);
      const url = new URL(request.url, 'http://' + expectedHost);
      const staticName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (Object.hasOwn(TYPES, staticName) && !url.search) {
        const bytes = await readFile(new URL(staticName, publicRoot));
        response.writeHead(200, { 'content-type': TYPES[staticName], 'content-length': bytes.length });
        response.end(bytes); return;
      }
      if (!validToken(request.headers.authorization, operatorToken)) throw fail('JRR_OPERATOR_AUTH_REQUIRED', 401);
      if (url.pathname === '/api/status' && !url.search) {
        const page = await store.list({ limit: 1 });
        json(response, 200, { destination: store.config.destination, merchants: store.config.merchants,
          maxResultBytes: store.config.maxResultBytes, total: page.total, receiving,
          recoveredOnOpen: recovery.recovered.length, retainedIncoming: recovery.retained });
        return;
      }
      if (url.pathname === '/api/results') {
        if ([...url.searchParams.keys()].some(key => !['after', 'limit'].includes(key))) throw fail('JRR_PAGE_INVALID', 400);
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
        json(response, 200, await store.list({ after: url.searchParams.get('after') ?? '', limit })); return;
      }
      const match = /^\/api\/results\/([a-f0-9]{64})(?:\/(body|manifest|receipt|verify|preview))?$/.exec(url.pathname);
      if (!match || url.search) throw fail('JRR_ROUTE_NOT_FOUND', 404);
      const [, id, kind] = match;
      if (!kind) { json(response, 200, await store.metadata(id)); return; }
      if (kind === 'verify') { json(response, 200, await store.verify(id)); return; }
      if (kind === 'manifest' || kind === 'receipt') {
        const value = await store.metadata(id);
        response.setHeader('content-disposition', 'attachment; filename="' + kind + '-' + id.slice(0, 12) + '.json"');
        json(response, 200, value[kind]); return;
      }
      const result = await store.openVerifiedResult(id);
      try {
        if (kind === 'preview') {
          const textType = /^(text\/|application\/(?:json|[\w.+-]+\+json|xml|[\w.+-]+\+xml)(?:;|$))/.test(result.manifest.result.contentType);
          const bytes = Buffer.alloc(Math.min(32768, result.bytes));
          let read = 0;
          while (read < bytes.length) {
            const next = await result.handle.read(bytes, read, bytes.length - read, read);
            if (!next.bytesRead) break; read += next.bytesRead;
          }
          json(response, 200, { contentType: result.manifest.result.contentType, bytes: result.bytes,
            truncated: result.bytes > read, text: textType ? bytes.subarray(0, read).toString('utf8') : null });
          return;
        }
        response.writeHead(200, { 'content-type': result.manifest.result.contentType,
          'content-length': result.bytes, 'x-content-sha256': result.manifest.result.sha256,
          'content-disposition': 'attachment; filename="' + result.manifest.result.filename + '"' });
        await pipeline(result.stream(), response);
      } finally { await result.close(); }
    })();
    track(operation);
    operation.catch(failure => { if (!response.destroyed) report(response, failure); });
  });
  for (const server of [receiver, operator]) {
    server.headersTimeout = Math.min(15000, requestTimeoutMs);
    server.requestTimeout = requestTimeoutMs;
    server.keepAliveTimeout = 5000;
    server.on('clientError', (_failure, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  }
  let receiverAddress; let operatorAddress;
  try {
    receiverAddress = await listen(receiver, port, host);
    operatorAddress = await listen(operator, operatorPort, '127.0.0.1');
  } catch (failure) {
    await Promise.allSettled([closeServer(receiver), closeServer(operator)]);
    await lease.release(); throw failure;
  }
  let shutdown;
  const close = () => shutdown ??= (async () => {
    closing = true;
    const drains = [closeServer(receiver), closeServer(operator)];
    await Promise.allSettled([...active]);
    try { await Promise.all(drains); } finally { await lease.release(); }
  })();
  return { store, receiver, operator, receiverAddress, operatorAddress, recovery,
    receiverUrl: endpoint(receiverAddress) + path,
    operatorUrl: endpoint(operatorAddress) + '/#access=' + encodeURIComponent(operatorToken), close };
}
