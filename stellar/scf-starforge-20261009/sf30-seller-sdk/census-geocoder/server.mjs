// MIT. Local authenticated operator over one original geocoder workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fault } from '../postgres/publisher/files.mjs';

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw fault('JSON_REQUIRED', 'Send application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > 8 * 1024 * 1024) throw fault('REQUEST_TOO_LARGE', 'The input exceeds 8 MiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('JSON_INVALID'); }
}
export async function startGeocoderServer({ workspace, port = 0 } = {}) {
  if (!workspace || typeof workspace.act !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Open a geocoder workspace and choose a valid local port.');
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8']
  ].map(async ([path, name, type]) => [path, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type }])));
  const token = randomBytes(32).toString('hex'), authorization = Buffer.from('Bearer ' + token);
  let origin, closing;
  const server = createServer((req, res) => {
    function send(status, value, type = 'application/json; charset=utf-8', filename) {
      if (res.destroyed || res.writableEnded) return;
      const output = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      const headers = { 'content-type': type, 'content-length': output.length, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
      if (filename) headers['content-disposition'] = 'attachment; filename="' + filename.replace(/[^A-Za-z0-9_.-]/g, '_') + '"';
      res.writeHead(status, headers); res.end(output);
    }
    async function dispatch() {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') throw fault('LOCAL_ORIGIN_REQUIRED', 'Use the printed local operator URL.', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw fault('INVALID_REQUEST_TARGET');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && !url.search && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname); return send(200, asset.bytes, asset.type);
      }
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization))
        throw fault('SESSION_REQUIRED', 'Reopen the private session URL printed by the local command.', 401);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await workspace.status());
      if (req.method === 'GET' && url.pathname === '/api/batch') return send(200, await workspace.inspectBatch(url.searchParams.get('id'), {
        attemptId: url.searchParams.get('attempt') || undefined, status: url.searchParams.get('status') || 'all',
        offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100) }));
      if (req.method === 'GET' && url.pathname === '/api/download') {
        const file = await workspace.download(url.searchParams.get('kind'), url.searchParams.get('id'));
        return send(200, file.bytes, file.contentType, file.filename);
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const input = await readBody(req);
        if (!input || typeof input.action !== 'string' || Object.keys(input).some(key => !['action', 'payload'].includes(key)))
          throw fault('ACTION_REQUIRED');
        const result = await workspace.act(input.action, input.payload ?? {});
        return send(200, { result, state: await workspace.status() });
      }
      throw fault('NOT_FOUND', 'Choose an available operator action.', 404);
    }
    dispatch().catch(error => send([400,401,403,404,409,413,415,422,502].includes(error.status) ? error.status : 422,
      { error: error.code ?? 'GEOCODER_OPERATION_FAILED', message: error.message }));
  });
  server.requestTimeout = 920000; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await workspace.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, workspace, url: origin, operatorUrl: origin + '/#' + token, close() {
    closing ??= (async () => {
      const connections = new Promise((done, reject) => {
        server.close(error => error ? reject(error) : done()); server.closeIdleConnections?.();
      });
      const result = await Promise.allSettled([workspace.close(), connections]);
      const failure = result.find(item => item.status === 'rejected'); if (failure) throw failure.reason;
    })();
    return closing;
  } };
}
