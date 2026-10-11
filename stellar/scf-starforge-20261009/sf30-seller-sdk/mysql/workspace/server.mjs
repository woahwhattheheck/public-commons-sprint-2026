#!/usr/bin/env node
// MIT. Owner-local MySQL merchant workspace; host CLI owns paths and credentials.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMysqlWorkspace } from './model.mjs';
import { createMysqlNativeFactory } from '../merchant.mjs';

const FILES = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const errorCode = error => /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_./-]+)?$/.test(error.code ?? error.message ?? '')
  ? error.code ?? error.message : 'MYSQL_WORKSPACE_OPERATION_FAILED';
const json = (res, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes);
};
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('JSON_REQUIRED'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 524288) throw Object.assign(new Error('INPUT_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}

export async function startMysqlMerchantWorkspace({ model, port = 8439, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('WORKSPACE_PORT_INVALID');
  model ??= await createMysqlWorkspace(options);
  const files = new Map(await Promise.all([...FILES].map(async ([url, [name, type]]) =>
    [url, { type, bytes: await readFile(new URL('./public/' + name, import.meta.url)) }])));
  const capability = randomBytes(32).toString('hex'), tickets = new Map(), sockets = new Set(), downloads = new Set();
  let origin, closing = false, closePromise;
  const authorized = req => {
    const token = req.headers['x-workspace-token'];
    return typeof token === 'string' && Buffer.byteLength(token) === capability.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(capability));
  };
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'LOCAL_WORKSPACE_ORIGIN_REQUIRED' });
      if (closing) return json(res, 503, { error: 'WORKSPACE_CLOSING' });
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'INVALID_REQUEST_TARGET' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && files.has(url.pathname) && !url.search) {
        const file = files.get(url.pathname);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(file.bytes);
      }
      for (const [key, value] of tickets) if (Date.now() > value.expiresAt) tickets.delete(key);
      if (req.method === 'GET' && /^\/download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.slice('/download/'.length), ticket = tickets.get(key);
        if (!ticket) return json(res, 410, { error: 'DOWNLOAD_TICKET_EXPIRED' });
        tickets.delete(key); downloads.add(req.socket);
        res.once('close', () => downloads.delete(req.socket));
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': ticket.bytes.length,
          'content-disposition': `attachment; filename="${ticket.filename}"`, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'x-content-sha256': ticket.sha256 });
        return res.end(ticket.bytes);
      }
      if (!authorized(req)) return json(res, 403, { error: 'WORKSPACE_CAPABILITY_REQUIRED' });
      if (req.method === 'GET') {
        if (url.pathname === '/api/info' && !url.search) return json(res, 200, await model.info());
        if (url.pathname === '/api/runtime' && !url.search) return json(res, 200, { runtime: await model.runtime() });
        if (url.pathname === '/api/catalog' && !url.search) return json(res, 200, await model.catalog());
        if (url.pathname === '/api/table' && [...url.searchParams.keys()].join(',') === 'name') return json(res, 200, await model.catalog(url.searchParams.get('name')));
        if (url.pathname === '/api/release' && [...url.searchParams.keys()].join(',') === 'id') return json(res, 200, await model.open(url.searchParams.get('id')));
        if (url.pathname === '/api/releases' && (!url.search || [...url.searchParams.keys()].join(',') === 'page'))
          return json(res, 200, await model.list(Number(url.searchParams.get('page') ?? 0)));
      }
      if (req.method === 'POST' && !url.search) {
        const actions = { '/api/review': 'review', '/api/preview': 'preview', '/api/prepare': 'prepare',
          '/api/run': 'run', '/api/stop': 'stop', '/api/export-client': 'exportClient' };
        if (Object.hasOwn(actions, url.pathname)) {
          const result = await model[actions[url.pathname]](await body(req));
          if (url.pathname === '/api/export-client') {
            while (tickets.size >= 4) tickets.delete(tickets.keys().next().value);
            const ticket = randomBytes(32).toString('hex');
            tickets.set(ticket, { ...result, expiresAt: Date.now() + 60000 });
            return json(res, 200, { download: '/download/' + ticket, filename: result.filename, bytes: result.bytes.length, sha256: result.sha256 });
          }
          return json(res, url.pathname === '/api/prepare' ? 201 : 200, result);
        }
      }
      return json(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      const status = error.status ?? (error.field !== undefined || error instanceof TypeError || error instanceof RangeError ? 422 : 503);
      if (!res.headersSent) json(res, status, { error: errorCode(error), ...(error.field ? { field: error.field } : {}),
        ...(error instanceof TypeError || error instanceof RangeError ? { detail: String(error.message).slice(0, 300) } : {}) }); else res.end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); downloads.delete(socket); }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await model.close(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + '/#' + capability, origin, model, server,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const listenerClosed = new Promise(done => server.close(done)); server.closeIdleConnections();
        try { await model.close(); }
        finally {
          for (const socket of sockets) if (!downloads.has(socket)) socket.destroy();
          let grace;
          if (downloads.size) await Promise.race([listenerClosed, new Promise(done => { grace = setTimeout(done, 15000); })]);
          clearTimeout(grace); for (const socket of sockets) socket.destroy();
          await listenerClosed; tickets.clear();
        }
      })();
      return closePromise;
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  const help = 'MySQL merchant browser workspace\n' +
    '  node mysql/cli.mjs workspace --source /private/source.json --state /private/mysql-workspace\n' +
    '    [--port 8439] [--seller-port 0] [--operations-port 0]\n' +
    '    [--facilitator HTTPS_URL] [--allow-local-facilitator]\n' +
    'Open the printed workspace URL. Keep the launching terminal for native operator approval.';
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help + '\n'); return null; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('WORKSPACE_DUPLICATE_OPTION');
    if (key === '--allow-local-facilitator') { options.set(key, true); continue; }
    if (!['--source', '--state', '--port', '--seller-port', '--operations-port', '--facilitator'].includes(key) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(help);
    options.set(key, args[++i]);
  }
  if (!options.has('--source') || !options.has('--state')) throw new TypeError(help);
  const port = (key, fallback) => {
    const value = options.get(key) ?? String(fallback);
    if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new TypeError('WORKSPACE_PORT_INVALID');
    return Number(value);
  };
  const nativeFactory = await createMysqlNativeFactory({ facilitator: options.get('--facilitator'),
    allowLocalFacilitator: options.has('--allow-local-facilitator') });
  const session = await startMysqlMerchantWorkspace({ sourceFile: resolve(options.get('--source')),
    stateDirectory: resolve(options.get('--state')), port: port('--port', 8439), sellerPort: port('--seller-port', 0),
    operationsPort: port('--operations-port', 0), nativeFactory });
  process.stdout.write(JSON.stringify({ workspace: session.url, state: session.model.stateDirectory }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: errorCode(error) }) + '\n'); process.exitCode = 1;
});
