#!/usr/bin/env node
// MIT. Loopback operator browser; original source, payment and lifecycle APIs.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClickHouseWorkspace } from './model.mjs';

const STATIC = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const code = error => /^[A-Z][A-Z0-9_]+$/.test(error.code ?? error.message ?? '')
  ? error.code ?? error.message : 'CLICKHOUSE_WORKSPACE_OPERATION_FAILED';
const respond = (res, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes);
};
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''))
    throw Object.assign(new Error('WORKSPACE_JSON_REQUIRED'), { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > 614400) throw Object.assign(new Error('WORKSPACE_INPUT_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('WORKSPACE_JSON_INVALID'), { status: 400 }); }
}

export async function startClickHouseWorkspace({ model, port = 8443, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('WORKSPACE_PORT_INVALID');
  model ??= await createClickHouseWorkspace(options);
  let assets, example;
  try {
    assets = new Map(await Promise.all([...STATIC].map(async ([url, [name, type]]) =>
      [url, { type, bytes: await readFile(new URL('./public/' + name, import.meta.url)) }])));
    example = Object.fromEntries(await Promise.all([['source', 'source.json'], ['plan', 'merchant-plan.json']]
      .map(async ([key, name]) => [key, JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url), 'utf8'))])));
  } catch (error) { await model.close(); throw error; }
  const capability = randomBytes(32).toString('hex'), sockets = new Set(), downloads = new Set();
  let origin, closing = false, closePromise;
  const authorized = req => {
    const token = req.headers['x-workspace-token'];
    return typeof token === 'string' && Buffer.byteLength(token) === capability.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(capability));
  };
  const actions = { '/api/save': 'save', '/api/open': 'open', '/api/checkout': 'checkout',
    '/api/review': 'review', '/api/preview': 'preview', '/api/prepare': 'prepare',
    '/api/release': 'release', '/api/run': 'run', '/api/stop': 'stop', '/api/export': 'exportClient' };
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return respond(res, 403, { error: 'WORKSPACE_LOCAL_ORIGIN_REQUIRED' });
      if (closing) return respond(res, 503, { error: 'WORKSPACE_CLOSING' });
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//'))
        return respond(res, 400, { error: 'WORKSPACE_REQUEST_TARGET_INVALID' });
      const url = new URL(req.url, origin);
      if (url.search) return respond(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const file = assets.get(url.pathname);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(file.bytes);
      }
      if (!authorized(req)) return respond(res, 403, { error: 'WORKSPACE_CAPABILITY_REQUIRED' });
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') return respond(res, 200, await model.state());
        if (url.pathname === '/api/runtime') return respond(res, 200, model.runtime());
        if (url.pathname === '/api/example') return respond(res, 200, example);
      }
      if (req.method === 'POST' && Object.hasOwn(actions, url.pathname)) {
        const result = await model[actions[url.pathname]](await body(req));
        if (url.pathname === '/api/export') {
          downloads.add(req.socket); res.once('close', () => downloads.delete(req.socket));
          res.writeHead(200, { 'content-type': result.contentType, 'content-length': result.bytes.length,
            'content-disposition': 'attachment; filename="' + result.filename + '"', 'x-content-sha256': result.sha256,
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(result.bytes);
        }
        return respond(res, url.pathname === '/api/prepare' ? 201 : 200, result);
      }
      return respond(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      const status = error.status ?? (error.field !== undefined || error instanceof TypeError || error instanceof RangeError ? 422 : 503);
      if (!res.headersSent) respond(res, status, { error: code(error),
        ...(error.field ? { field: error.field } : {}),
        ...(error instanceof TypeError || error instanceof RangeError ? { detail: String(error.message).slice(0, 400) } : {}) });
      else res.end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); downloads.delete(socket); }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await model.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  try { model.bindOperationsNavigationOrigin(origin); }
  catch (error) { await new Promise(done => server.close(done)); await model.close(); throw error; }
  return { url: origin + '/#' + capability, origin, model, server,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const listenerClosed = new Promise(done => server.close(done)); server.closeIdleConnections();
        try { await model.close(); }
        finally {
          for (const socket of sockets) if (!downloads.has(socket)) socket.destroy();
          let timer;
          if (downloads.size) await Promise.race([listenerClosed, new Promise(done => { timer = setTimeout(done, 15000); })]);
          clearTimeout(timer); for (const socket of sockets) socket.destroy();
          await listenerClosed;
        }
      })();
      return closePromise;
    },
  };
}

async function nativeFactoryFor(facilitator, allowLocal) {
  if (!facilitator) {
    if (allowLocal) throw new TypeError('CLICKHOUSE_FACILITATOR_URL_REQUIRED');
    return null;
  }
  let url;
  try { url = new URL(facilitator); } catch { throw new TypeError('CLICKHOUSE_FACILITATOR_URL_INVALID'); }
  const local = allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    throw new TypeError('CLICKHOUSE_FACILITATOR_URL_INVALID');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../../native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
  });
}
export async function main(args = process.argv.slice(2)) {
  const help = 'ClickHouse merchant operator workspace\n' +
    '  node clickhouse/workspace/server.mjs --state /private/clickhouse-workspace\n' +
    '    [--source /private/source.json --plan /private/merchant-plan.json]\n' +
    '    [--port 8443] [--seller-port 0] [--operations-port 0]\n' +
    '    [--facilitator HTTPS_URL] [--allow-local-facilitator]\n' +
    '    [--max-in-flight 64] [--drain-grace-ms 60000]\n' +
    'Open the printed private URL. Keep the terminal open; Ctrl-C drains the original merchant.';
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('WORKSPACE_DUPLICATE_OPTION');
    if (key === '--allow-local-facilitator') { options.set(key, true); continue; }
    if (!['--state', '--source', '--plan', '--port', '--seller-port', '--operations-port',
      '--facilitator', '--max-in-flight', '--drain-grace-ms'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    options.set(key, args[++i]);
  }
  if (!options.has('--state') || options.has('--source') !== options.has('--plan')) throw new TypeError(help);
  const integer = (key, fallback, low, high) => {
    const value = options.get(key) ?? String(fallback);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) < low || Number(value) > high) throw new TypeError('WORKSPACE_OPTION_INVALID');
    return Number(value);
  };
  const nativeFactory = await nativeFactoryFor(options.get('--facilitator'), options.has('--allow-local-facilitator'));
  const session = await startClickHouseWorkspace({
    stateDirectory: resolve(options.get('--state')),
    ...(options.has('--source') ? { sourceFile: resolve(options.get('--source')), planFile: resolve(options.get('--plan')) } : {}),
    port: integer('--port', 8443, 0, 65535), sellerPort: integer('--seller-port', 0, 0, 65535),
    operationsPort: integer('--operations-port', 0, 0, 65535),
    maxInFlight: integer('--max-in-flight', 64, 1, 1024), drainGraceMs: integer('--drain-grace-ms', 60000, 1000, 300000), nativeFactory,
  });
  console.log(JSON.stringify({ workspace: session.url, state: session.model.stateDirectory }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: code(error) })); process.exitCode = 1; });
