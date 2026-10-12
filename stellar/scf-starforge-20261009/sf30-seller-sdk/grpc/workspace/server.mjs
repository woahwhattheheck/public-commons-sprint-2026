#!/usr/bin/env node
// MIT. Private loopback operator UI; every application call uses the original source.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGrpcWorkspace } from './model.mjs';
import { nativeFactoryFor } from '../start.mjs';
import { readBrowserAssets } from '../../../distribution/browser-assets.mjs';

const response = (res, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes);
};
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''))
    throw Object.assign(new Error('GRPC_WORKSPACE_JSON_REQUIRED'), { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > 17825792) throw Object.assign(new Error('GRPC_WORKSPACE_BODY_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw Object.assign(new Error('GRPC_WORKSPACE_JSON_INVALID'), { status: 400 }); }
}
export async function startGrpcWorkspace({ model, port = 8453, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('GRPC_WORKSPACE_PORT_INVALID');
  model ??= await createGrpcWorkspace(options);
  let assets, example;
  try {
    const specification = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
    assets = new Map(await Promise.all([...specification].map(async ([path, { url, type }]) =>
      [path, { type, bytes: await readFile(url) }])));
    example = Object.fromEntries(await Promise.all([['source', 'source.json'], ['plan', 'merchant-plan.json']]
      .map(async ([key, name]) => [key, JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url), 'utf8'))])));
    example.protoDirectory = fileURLToPath(new URL('../examples/proto/', import.meta.url));
    example.entrypoints = ['analytics.proto'];
  } catch (issue) { await model.close(); throw issue; }
  const capability = randomBytes(32).toString('hex'), sockets = new Set(), downloads = new Set();
  let origin, closing = false, closePromise;
  const authorized = req => {
    const token = req.headers['x-workspace-token'];
    return typeof token === 'string' && Buffer.byteLength(token) === capability.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(capability));
  };
  const actions = { save: 'save', capture: 'capture', open: 'open', checkout: 'checkout',
    method: 'method', review: 'review', call: 'call', attempt: 'readAttempt', prepare: 'prepare',
    run: 'run', stop: 'stop', download: 'download', archive: 'archive', stage: 'stage',
    'release-console': 'openReleaseConsole', 'release-close': 'closeReleaseConsole' };
  const server = createServer((req, res) => {
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    Promise.resolve().then(async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return response(res, 403, { error: 'GRPC_WORKSPACE_LOCAL_ORIGIN_REQUIRED' });
      if (closing) return response(res, 503, { error: 'GRPC_WORKSPACE_CLOSING' });
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//'))
        return response(res, 400, { error: 'GRPC_WORKSPACE_TARGET_INVALID' });
      const url = new URL(req.url, origin);
      if (url.search) return response(res, 404, { error: 'GRPC_WORKSPACE_ROUTE_NOT_FOUND' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const file = assets.get(url.pathname);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(file.bytes);
      }
      if (!authorized(req)) return response(res, 403, { error: 'GRPC_WORKSPACE_CAPABILITY_REQUIRED' });
      if (req.method === 'GET' && url.pathname === '/api/state') return response(res, 200, await model.state());
      if (req.method === 'GET' && url.pathname === '/api/runtime') return response(res, 200, model.runtime());
      if (req.method === 'GET' && url.pathname === '/api/example') return response(res, 200, example);
      const action = url.pathname.startsWith('/api/') ? actions[url.pathname.slice(5)] : null;
      if (req.method === 'POST' && action) {
        const value = await model[action](await body(req), { signal: controller.signal });
        if (['download', 'archive'].includes(action)) {
          downloads.add(req.socket); res.once('close', () => downloads.delete(req.socket));
          res.writeHead(200, { 'content-type': value.contentType, 'content-length': value.bytes.length,
            'content-disposition': 'attachment; filename="' + value.filename + '"', 'x-content-sha256': value.sha256,
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(value.bytes);
        }
        return response(res, action === 'prepare' ? 201 : 200, value);
      }
      return response(res, 404, { error: 'GRPC_WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(issue => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.end(); return; }
      const code = /^[A-Z][A-Z0-9_]+$/.test(issue.code ?? issue.message ?? '') ?
        issue.code ?? issue.message : 'GRPC_WORKSPACE_OPERATION_FAILED';
      response(res, issue.status ?? (issue instanceof TypeError || issue instanceof RangeError ? 422 : 503),
        { error: code, ...(issue.field_path ? { field: issue.field_path } : {}),
          detail: String(issue.message ?? code).slice(0, 600) });
    });
  });
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => { sockets.delete(socket); downloads.delete(socket); });
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 3000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  catch (issue) { await model.close(); throw issue; }
  origin = 'http://127.0.0.1:' + server.address().port;
  model.bindOperationsNavigationOrigin(origin);
  return { model, server, origin, url: origin + '/#' + capability,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const closed = new Promise(done => server.close(done)); server.closeIdleConnections();
        try { await model.close(); }
        finally {
          for (const socket of sockets) if (!downloads.has(socket)) socket.destroy();
          let timer;
          if (downloads.size) await Promise.race([closed, new Promise(done => { timer = setTimeout(done, 15000); })]);
          clearTimeout(timer); for (const socket of sockets) socket.destroy(); await closed;
        }
      })();
      return closePromise;
    } };
}
export async function main(args = process.argv.slice(2)) {
  const help = 'node grpc/workspace/server.mjs --state /PRIVATE/WORKSPACE [--port 8453]\n' +
    '  [--source /PRIVATE/source.json --proto-directory /PRIVATE/proto --entry analytics.proto --plan /PRIVATE/merchant-plan.json]\n' +
    '  [--seller-port 0] [--operations-port 0] [--facilitator HTTPS_URL] [--allow-local-facilitator]\n' +
    '  [--max-in-flight 64] [--drain-grace-ms 60000]';
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const flags = new Map(), entrypoints = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--entry' && args[i + 1] && !args[i + 1].startsWith('--')) { entrypoints.push(args[++i]); continue; }
    if (flags.has(key)) throw new TypeError('GRPC_WORKSPACE_DUPLICATE_OPTION');
    if (key === '--allow-local-facilitator') { flags.set(key, true); continue; }
    if (!['--state', '--port', '--source', '--proto-directory', '--plan', '--seller-port', '--operations-port',
      '--facilitator', '--max-in-flight', '--drain-grace-ms'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    flags.set(key, args[++i]);
  }
  if (!flags.has('--state')) throw new TypeError(help);
  const numeric = (key, fallback, low, high) => {
    const value = flags.get(key) ?? String(fallback);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) < low || Number(value) > high) throw new TypeError('GRPC_WORKSPACE_OPTION_INVALID');
    return Number(value);
  };
  const nativeFactory = await nativeFactoryFor(flags.get('--facilitator'), flags.has('--allow-local-facilitator'));
  const session = await startGrpcWorkspace({ stateDirectory: resolve(flags.get('--state')), nativeFactory,
    port: numeric('--port', 8453, 0, 65535), sellerPort: numeric('--seller-port', 0, 0, 65535),
    operationsPort: numeric('--operations-port', 0, 0, 65535), maxInFlight: numeric('--max-in-flight', 64, 1, 1024),
    drainGraceMs: numeric('--drain-grace-ms', 60000, 1000, 300000),
    ...(flags.has('--source') ? { sourceFile: resolve(flags.get('--source')) } : {}),
    ...(flags.has('--proto-directory') ? { protoDirectory: resolve(flags.get('--proto-directory')) } : {}),
    ...(flags.has('--plan') ? { planFile: resolve(flags.get('--plan')) } : {}),
    ...(entrypoints.length ? { entrypoints } : {}),
    releaseRuntime: { port: numeric('--seller-port', 0, 0, 65535),
      ...(flags.has('--facilitator') ? { facilitator: flags.get('--facilitator') } : {}),
      ...(flags.has('--allow-local-facilitator') ? { allowLocalFacilitator: true } : {}) } });
  console.log(JSON.stringify({ workspace: session.url, state: session.model.stateDirectory }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () =>
    session.close().catch(() => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => { console.error(JSON.stringify({ error: issue.code ?? issue.message })); process.exitCode = 1; });
