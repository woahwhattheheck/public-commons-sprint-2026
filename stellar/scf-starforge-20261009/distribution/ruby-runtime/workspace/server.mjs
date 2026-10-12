// MIT. Private browser operations over the maintained Ruby runtime handle.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { openRubyRuntimeUploads } from './uploads.mjs';

const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const MAX_JSON_BYTES = 65536;
const METHODS = Object.freeze({
  '/api/probe': 'probe', '/api/environments/create': 'create', '/api/operations/start': 'start',
  '/api/operations/resume': 'resume', '/api/operations/cancel': 'cancel',
  '/api/applications/register': 'registerApplication', '/api/applications/launch': 'launchApplication',
  '/api/applications/stop': 'stopApplication', '/api/receive': 'receive',
});
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
function headers(mime = 'application/json; charset=utf-8') {
  return { 'content-type': mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'same-origin' };
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw fault('RUBY_DESK_JSON_REQUIRED', 'Send the selected action as application/json.', 415);
  const parts = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > MAX_JSON_BYTES) throw fault('RUBY_DESK_INPUT_SIZE', 'The selected action is too large.', 413);
    parts.push(part);
  }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw fault('RUBY_DESK_JSON_INVALID', 'Use a complete JSON action.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw fault('RUBY_DESK_OBJECT_REQUIRED', 'Use the original selected action object.');
  return result;
}
function scalar(url, name, required = true) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1 || required && values.length !== 1 || values[0] === '')
    throw fault('RUBY_DESK_QUERY', 'Select one original ' + name + '.');
  return values[0];
}
function integer(url, name, fallback, maximum) {
  const value = scalar(url, name, false);
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
    throw fault('RUBY_DESK_INTEGER', 'Use a valid ' + name + '.');
  return Number(value);
}
function cookieValue(header, name) {
  if (typeof header !== 'string') return '';
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
function byteRange(value, size) {
  if (value === undefined) return null;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(value);
  if (!match || !match[1] && !match[2] || size === 0) throw fault('RUBY_DESK_RANGE', 'Select one valid byte range.', 416);
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw fault('RUBY_DESK_RANGE', 'Select a valid suffix range.', 416);
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start)
      throw fault('RUBY_DESK_RANGE', 'The selected byte range is outside this file.', 416);
    end = Math.min(end, size - 1);
  }
  return { start, end, bytes: end - start + 1 };
}

export async function serveRubyRuntimeWorkspace({ workspace, port = 8474 } = {}) {
  if (!workspace || !['inspect', 'operation', 'log', 'openFile', 'receive', 'close'].every(key => typeof workspace[key] === 'function') ||
    !Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Open the maintained Ruby runtime and choose a valid local port.');
  const initial = await workspace.inspect(), uploads = await openRubyRuntimeUploads({ directory: initial.directory });
  const token = randomBytes(32).toString('hex'), expected = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/browser.mjs', 'browser.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, name, mime]) => [path, { bytes: await readFile(new URL('./' + name, import.meta.url)), mime }])));
  let origin, cookieName, closing = null;
  const tasks = new Set();
  const server = createServer((req, res) => {
    const send = (status, value, mime, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(status, { ...headers(mime), 'content-length': bytes.length, ...extra }); res.end(bytes);
    };
    const validToken = value => {
      const supplied = Buffer.from(typeof value === 'string' ? value : '');
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    };
    const authenticated = () => req.headers['x-ruby-runtime-token'] !== undefined
      ? validToken(req.headers['x-ruby-runtime-token'])
      : validToken(cookieValue(req.headers.cookie, cookieName));
    const download = async url => {
      const operationId = scalar(url, 'operationId'), name = scalar(url, 'name');
      const file = await workspace.openFile({ operationId, name });
      if (!file?.handle || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        await file?.handle?.close?.();
        throw fault('RUBY_DESK_FILE', 'The original operation did not return its complete saved file.', 409);
      }
      try {
        const originalName = String(file.name ?? name);
        const filename = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0,180) || 'runtime-file';
        const etag = '"' + file.sha256 + '"';
        const mime = typeof file.type === 'string' && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(file.type)
          ? file.type : 'application/octet-stream';
        const common = { ...headers(mime), 'content-disposition': 'attachment; filename="' + filename + '"',
          'accept-ranges': 'bytes', 'x-content-sha256': file.sha256, etag };
        let range;
        try { range = byteRange(req.headers['if-range'] && req.headers['if-range'] !== etag ? undefined : req.headers.range, file.bytes); }
        catch (issue) {
          if (issue.status === 416) { res.writeHead(416, { ...common, 'content-range': 'bytes */' + file.bytes, 'content-length': 0 }); res.end(); return; }
          throw issue;
        }
        res.writeHead(range ? 206 : 200, { ...common, 'content-length': range?.bytes ?? file.bytes,
          ...(range ? { 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + file.bytes } : {}) });
        if (req.method === 'HEAD' || file.bytes === 0) { res.end(); return; }
        const stream = file.handle.createReadStream({ autoClose: false, start: range?.start ?? 0,
          ...(range ? { end: range.end } : {}) });
        await pipeline(stream, res);
      } finally { await file.handle.close(); }
    };
    const handle = async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
        req.headers['sec-fetch-site'] === 'cross-site')
        throw fault('RUBY_DESK_ORIGIN', 'Open the exact private local address printed by this runtime.', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//'))
        throw fault('RUBY_DESK_TARGET', 'Use the local runtime address.');
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && !url.search && assets.has(path)) {
        const asset = assets.get(path); return send(200, asset.bytes, asset.mime);
      }
      if (req.method === 'GET' && path === '/api/health' && !url.search)
        return send(200, { ready: !closing, service: 'ruby-runtime-workspace' });
      if (path === '/api/session' && req.method === 'POST' && !url.search) {
        if (!validToken(req.headers['x-ruby-runtime-token']))
          throw fault('RUBY_DESK_SESSION', 'Open the complete private URL printed by this runtime.', 403);
        await jsonBody(req);
        return send(200, { connected: true, directory: initial.directory }, undefined,
          { 'set-cookie': cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict' });
      }
      if (!authenticated()) throw fault('RUBY_DESK_SESSION', 'Open the complete private URL printed by this runtime.', 403);
      if (closing) throw fault('RUBY_DESK_CLOSING', 'The runtime desk is stopping. Reopen its saved directory.', 409);
      if (req.method === 'GET') {
        if (path === '/api/state' && !url.search) return send(200, await workspace.inspect());
        if (path === '/api/operation') return send(200, await workspace.operation({ operationId: scalar(url, 'operationId') }));
        if (path === '/api/log') return send(200, await workspace.log({ operationId: scalar(url, 'operationId'),
          offset: integer(url, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: integer(url, 'limit', 65536, 65536) }));
        if (path === '/api/application') return send(200, await workspace.application({ id: scalar(url, 'id') }));
        if (path === '/api/receive-upload/status') return send(200, await uploads.status({ operationId: scalar(url, 'operationId') }));
        if (path === '/api/file') return download(url);
        throw fault('RUBY_DESK_NOT_FOUND', 'This runtime view was not found.', 404);
      }
      if (req.method === 'HEAD' && path === '/api/file') return download(url);
      if (req.method === 'PUT' && path === '/api/receive-upload') {
        if (!/^application\/(?:x-tar|octet-stream)(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
          throw fault('RUBY_DESK_ARCHIVE_TYPE', 'Upload the original complete TAR archive.', 415);
        req.setTimeout(120000, () => req.destroy(fault('RUBY_DESK_UPLOAD_TIMEOUT', 'The original archive transfer stopped receiving bytes.', 408)));
        return send(200, await uploads.write({ operationId: scalar(url, 'operationId'),
          readable: req, contentLength: req.headers['content-length'] }));
      }
      if (req.method !== 'POST' || url.search) throw fault('RUBY_DESK_NOT_FOUND', 'This runtime action was not found.', 404);
      const input = await jsonBody(req);
      if (closing) throw fault('RUBY_DESK_CLOSING', 'The runtime desk is stopping.', 409);
      if (path === '/api/session/close') return send(200, { connected: false }, undefined,
        { 'set-cookie': cookieName + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      if (path === '/api/receive-upload/prepare') return send(200, await uploads.prepare(input));
      if (path === '/api/receive-upload/commit') return send(200, await uploads.commit(input, workspace));
      const method = METHODS[path];
      if (!method || typeof workspace[method] !== 'function')
        throw fault('RUBY_DESK_NOT_FOUND', 'This runtime action was not found.', 404);
      return send(200, await workspace[method](input));
    };
    const task = handle().catch(issue => {
      if (!res.headersSent && !res.destroyed) {
        const status = Number.isInteger(issue.status) && issue.status >= 400 && issue.status <= 599 ? issue.status : 422;
        send(status, { code: issue.code ?? 'RUBY_DESK_ACTION_FAILED',
          message: issue.code ? issue.message : 'Read the selected operation and its complete log.' });
      } else if (!res.writableEnded) res.destroy(issue);
    }).finally(() => tasks.delete(task));
    tasks.add(task);
  });
  server.requestTimeout = 0; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
  await new Promise((done, reject) => {
    const failed = issue => { server.off('listening', ready); reject(issue); };
    const ready = () => { server.off('error', failed); done(); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  origin = new URL('http://127.0.0.1:' + server.address().port).origin;
  cookieName = 'ruby_runtime_' + server.address().port;
  return { server, workspace, directory: initial.directory, origin, token, url: origin + '/#token=' + token,
    close() {
      closing ??= (async () => {
        const stopped = new Promise((done, reject) => server.close(issue => issue ? reject(issue) : done()));
        server.closeIdleConnections?.(); server.closeAllConnections?.();
        let stopIssue;
        await stopped.catch(issue => { stopIssue = issue; });
        while (tasks.size) await Promise.allSettled([...tasks]);
        await workspace.close();
        if (stopIssue) throw stopIssue;
      })();
      return closing;
    },
  };
}
