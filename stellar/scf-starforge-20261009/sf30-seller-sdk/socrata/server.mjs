// MIT. Local Socrata operator transport over the original workspace.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {openSocrataWorkspace} from './workspace.mjs';

const actions = new Set([
  'source.configure', 'source.inspect', 'source.search',
  'capture.start', 'capture.advance', 'capture.pause', 'capture.resume', 'capture.import',
  'mapping.save', 'edition.build', 'edition.activate', 'dataset.query',
  'merchant.configure', 'package.export', 'package.import'
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const commonHeaders = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': policy,
  'cross-origin-resource-policy': 'same-origin'
};

async function readJson(request) {
  if ((request.headers['content-type'] ?? '').split(';', 1)[0].trim() !== 'application/json')
    throw Object.assign(new Error('Send JSON with Content-Type application/json.'), {status: 415, code: 'JSON_REQUIRED'});
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 524288)
      throw Object.assign(new Error('The request exceeds 512 KiB.'), {status: 413, code: 'REQUEST_TOO_LARGE'});
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('The request body is not valid UTF-8 JSON.'), {status: 400, code: 'INVALID_JSON'}); }
}

/** One local listener; all source, capture, edition and merchant work stays in workspace. */
export async function startSocrataWorkspace({directory, port = 0,
  appToken = process.env.SOCRATA_APP_TOKEN, ...backendOptions} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A workspace directory is required.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be between 0 and 65535.');
  const workspace = await openSocrataWorkspace({...backendOptions, directory: resolve(directory), appToken});
  let assets;
  try {
    assets = await Promise.all(['index.html', 'app.mjs', 'style.css'].map(name => readFile(new URL('./public/' + name, import.meta.url))));
  } catch (error) {
    try { await workspace.close(); } catch {}
    throw error;
  }
  const token = randomBytes(32).toString('base64url');
  const expected = Buffer.from('Bearer ' + token);
  let origin, closing;
  const server = createServer({maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000,
    keepAliveTimeout: 1000}, async (request, response) => {
    const reply = (status, value, contentType = 'application/json; charset=utf-8') => {
      if (response.destroyed) return;
      response.writeHead(status, {...commonHeaders, 'content-type': contentType});
      response.end(contentType.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== new URL(origin).host ||
          (request.headers.origin && request.headers.origin !== origin) ||
          request.headers['sec-fetch-site'] === 'cross-site')
        return reply(403, {error: 'LOCAL_ORIGIN_REQUIRED', message: 'Open this workspace on its printed local session URL.'});
      if (request.method === 'GET') {
        if (request.url === '/') return reply(200, assets[0], 'text/html; charset=utf-8');
        if (request.url === '/app.mjs') return reply(200, assets[1], 'text/javascript; charset=utf-8');
        if (request.url === '/style.css') return reply(200, assets[2], 'text/css; charset=utf-8');
        if (request.url === '/favicon.ico') return reply(204, '');
      }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply(401, {error: 'SESSION_REQUIRED', message: 'Reopen the session URL printed by the workspace command.'});
      if (request.method === 'GET' && request.url === '/api/state')
        return reply(200, await workspace.state());
      const download = /^\/api\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url ?? '');
      if (request.method === 'GET' && download) {
        let exportId, filename;
        try { exportId = decodeURIComponent(download[1]); filename = decodeURIComponent(download[2]); }
        catch { return reply(400, {error: 'INVALID_DOWNLOAD', message: 'Invalid export file identifier.'}); }
        const file = await workspace.readExport(exportId, filename);
        const info = await stat(file.path);
        if (!info.isFile()) return reply(404, {error: 'EXPORT_FILE_UNAVAILABLE'});
        response.writeHead(200, {...commonHeaders,
          'content-type': file.contentType || 'application/octet-stream',
          'content-length': info.size,
          'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename).replaceAll("'", '%27')
        });
        await pipeline(createReadStream(file.path), response);
        return;
      }
      if (request.url !== '/api/action') return reply(404, {error: 'NOT_FOUND'});
      if (request.method !== 'POST') return reply(405, {error: 'POST_REQUIRED'});
      const input = await readJson(request);
      if (!object(input) || !actions.has(input.action) || !object(input.payload ?? {}) ||
          Object.keys(input).some(key => !['action', 'payload'].includes(key)))
        return reply(400, {error: 'INVALID_ACTION', message: 'Choose a supported workspace action and an object payload.'});
      // Do not abort or replay an accepted mutation when the browser disconnects.
      const result = await workspace.act(input.action, input.payload ?? {});
      return reply(200, result);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        if (!response.writableEnded) response.end();
        return;
      }
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ?
        error.status : error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
      return reply(status, {error: typeof error.code === 'string' ? error.code : 'WORKSPACE_REQUEST_FAILED',
        message: error.message || 'The workspace could not complete this request.'});
    }
  });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try {
    await new Promise((yes, no) => {
      server.once('error', no);
      server.listen(port, '127.0.0.1', () => { server.off('error', no); yes(); });
    });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) {
    try { await workspace.close(); } catch {}
    throw error;
  }
  return {origin, url: origin + '/#' + token, token,
    close() {
      if (!closing) closing = (async () => {
        let serverError;
        try {
          await new Promise((yes, no) => {
            server.close(error => error ? no(error) : yes());
            server.closeIdleConnections?.();
          });
        } catch (error) { serverError = error; }
        try { await workspace.close(); } catch (error) { if (!serverError) throw error; }
        if (serverError) throw serverError;
      })();
      return closing;
    }
  };
}
