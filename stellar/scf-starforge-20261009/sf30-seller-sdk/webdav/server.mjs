// MIT. Same-host operator surface over the retained original source/publisher engines.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openWebDavWorkspace } from './workspace.mjs';
import { fail } from './config.mjs';

const ROOT = new URL('./', import.meta.url);
const HEADER = 'x-workspace-token';
const cleanFilename = value => String(value).replace(/[^\w.()-]/g, '_').slice(0,160) || 'webdav-download';
function send(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}
async function body(request, maximum = 1048576) {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) fail('WEBDAV_REQUEST_LIMIT', 'The request exceeds one MiB.', 413);
  const chunks = []; let count = 0;
  for await (const part of request) {
    count += part.length;
    if (count > maximum) fail('WEBDAV_REQUEST_LIMIT', 'The request exceeds one MiB.', 413);
    chunks.push(part);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, count))); }
  catch { fail('WEBDAV_REQUEST_JSON', 'Supply a complete UTF-8 JSON object.'); }
}
function tokenMatches(provided, token) {
  if (typeof provided !== 'string') return false;
  const left = Buffer.from(provided), right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function start({ directory, port = 0, environment = process.env, python = 'python3' } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) fail('WEBDAV_PORT', 'Choose a valid local port.');
  const workspace = await openWebDavWorkspace({ directory, environment, python });
  const token = randomBytes(32).toString('hex');
  let origin, closing = null;
  const server = http.createServer(async (request, response) => {
    let authorized = false;
    try {
      if (request.headers.host !== new URL(origin).host) fail('WEBDAV_HOST', 'Use the original local operator address.', 403);
      if (request.headers.origin && request.headers.origin !== origin) fail('WEBDAV_ORIGIN', 'Use this local operator page.', 403);
      const url = new URL(request.url, origin), path = url.pathname;
      if (request.method === 'GET' && path === '/api/health') {
        const state = await workspace.inspect();
        return send(response, 200, { status: 'ok', workspaceId: state.id, revision: state.revision, pid: process.pid });
      }
      if (path.startsWith('/api/')) {
        if (!tokenMatches(request.headers[HEADER], token)) fail('WEBDAV_TOKEN', 'Reload this original local operator page.', 403);
        authorized = true;
        if (request.method === 'GET') {
          if (path === '/api/state') return send(response, 200, await workspace.inspect());
          if (path === '/api/operation') return send(response, 200, await workspace.operation(url.searchParams.get('id')));
          if (path === '/api/listing') return send(response, 200, await workspace.listing({
            sourceId: url.searchParams.get('sourceId'), id: url.searchParams.get('id'),
            offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 200) }));
          if (path === '/api/capture') return send(response, 200, await workspace.capture(url.searchParams.get('id')));
          if (path === '/api/mapping') return send(response, 200, await workspace.mapping(url.searchParams.get('id')));
          if (path === '/api/publisher') return send(response, 200, await workspace.publisherState(url.searchParams.get('id')));
          if (path === '/api/file') {
            const value = await workspace.download(url.searchParams.get('kind'), url.searchParams.get('id'),
              url.searchParams.get('name'), url.searchParams.get('sourceId'));
            try {
              response.writeHead(200, { 'Content-Type': value.contentType, 'Content-Length': value.size,
                'Content-Disposition': 'attachment; filename="' + cleanFilename(value.filename) + '"',
                'X-Content-SHA256': value.sha256, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              await pipeline(value.handle.createReadStream({ autoClose: false }), response);
            } finally { await value.handle.close(); }
            return;
          }
          if (path === '/api/publisher-file') {
            const value = await workspace.publisherDownload(url.searchParams.get('productId'), url.searchParams.get('kind'), url.searchParams.get('id'));
            response.writeHead(200, { 'Content-Type': value.contentType, 'Content-Length': value.bytes.length,
              'Content-Disposition': 'attachment; filename="' + cleanFilename(value.filename) + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            response.end(value.bytes); return;
          }
          if (path === '/api/handbook') {
            const content = await readFile(new URL('./README.md', ROOT));
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
            response.end(content); return;
          }
        } else if (request.method === 'POST') {
          if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
            fail('WEBDAV_CONTENT_TYPE', 'Use application/json for an operator command.', 415);
          const value = await body(request);
          if (path === '/api/act') {
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['action','operationId','expectedRevision','input'].includes(key)))
              fail('WEBDAV_REQUEST_FIELDS', 'Use the original action, input, revision and operation ID.');
            const { action, ...payload } = value;
            return send(response, 200, await workspace.act(action, payload));
          }
          if (path === '/api/cancel') return send(response, 200, await workspace.cancel(value.operationId));
          if (path === '/api/preview') return send(response, 200, await workspace.preview(value));
        }
        fail('WEBDAV_ENDPOINT', 'This operator endpoint does not exist.', 404);
      }
      if (request.method !== 'GET') fail('WEBDAV_METHOD', 'Choose an original operator command.', 405);
      const assets = new Map([['/', ['public/index.html', 'text/html; charset=utf-8']],
        ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['public/style.css', 'text/css; charset=utf-8']]]);
      const asset = assets.get(path);
      if (!asset) fail('WEBDAV_FILE', 'This operator page does not exist.', 404);
      let content = await readFile(new URL('./' + asset[0], ROOT));
      if (path === '/') content = Buffer.from(content.toString('utf8').replace('__WORKSPACE_TOKEN__', token));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': content.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
      response.end(content);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      const status = Number.isSafeInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      let state;
      if (authorized && (status === 409 || request.method === 'POST')) { try { state = await workspace.inspect(); } catch {} }
      send(response, status, { error: { code: error.code ?? 'WEBDAV_OPERATION_FAILED',
        message: error.message ?? 'The original operation did not complete.', details: error.details ?? null }, ...(state ? { state } : {}) });
    }
  });
  server.requestTimeout = 0; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  server.on('clientError', (_, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) { await workspace.close(); throw error; }
  const close = () => closing ??= (async () => {
    const closed = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
    server.closeIdleConnections?.();
    try { await workspace.close(); } finally { await closed; }
  })();
  const state = await workspace.inspect();
  return { url: origin, directory, workspaceId: state.id, revision: state.revision, token, workspace, close, pid: process.pid };
}
