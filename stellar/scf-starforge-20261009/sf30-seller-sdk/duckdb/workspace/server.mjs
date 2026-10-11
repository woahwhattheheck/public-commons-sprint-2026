// MIT. One private loopback browser over the original DuckDB merchant workflow.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createDuckdbWorkspace, WorkspaceError, publicIssue } from './model.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/author.mjs', ['author.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': POLICY, 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
function send(res, status, value, type = 'application/json; charset=utf-8', headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(status, { ...HEADERS, 'content-type': type, 'content-length': bytes.length, ...headers });
  res.end(bytes);
}
function authorized(req, token) {
  const value = req.headers['x-duckdb-workspace'];
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
async function body(req, waiting) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new WorkspaceError('JSON_BODY_REQUIRED', 415);
  if (Number(req.headers['content-length'] ?? 0) > 270336) throw new WorkspaceError('REQUEST_TOO_LARGE', 413);
  const chunks = []; let bytes = 0;
  const expired = setTimeout(() => req.destroy(), 10000);
  waiting.add(req);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 270336) throw new WorkspaceError('REQUEST_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new WorkspaceError('INVALID_JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new WorkspaceError('JSON_OBJECT_REQUIRED');
    return result;
  } finally { clearTimeout(expired); waiting.delete(req); }
}

export async function startDuckdbWorkspace({ port = 8437, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new WorkspaceError('INVALID_LISTENER_PORT');
  const assets = new Map(await Promise.all([...ASSETS].map(async ([path, [name, type]]) =>
    [path, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type }])));
  const token = randomBytes(32).toString('hex'), waiting = new Set();
  let origin, model, closing = false, closePromise;
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (closing || !model) throw new WorkspaceError('WORKSPACE_CLOSING', 503);
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin)
        throw new WorkspaceError('WORKSPACE_ORIGIN_REQUIRED', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048)
        throw new WorkspaceError('INVALID_REQUEST_TARGET', 400);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return send(res, 200, asset.bytes, asset.type);
      }
      if (!authorized(req, token)) throw new WorkspaceError('WORKSPACE_KEY_REQUIRED', 401,
        'Open the private workspace URL printed by its launcher.');
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
        throw new WorkspaceError('WORKSPACE_ORIGIN_REQUIRED', 403);
      if (req.method === 'GET' && url.pathname === '/api/state' && !url.search)
        return send(res, 200, await model.state());
      if (req.method === 'GET' && url.pathname === '/api/runtime' && !url.search)
        return send(res, 200, model.runtime());
      if (req.method === 'GET' && url.pathname === '/api/draft') {
        const keys = [...url.searchParams.keys()], value = url.searchParams.get('revision');
        if (keys.length !== 1 || keys[0] !== 'revision' || !/^[1-9]\d{0,12}$/.test(value ?? ''))
          throw new WorkspaceError('INVALID_DRAFT_REVISION');
        return send(res, 200, model.draft(Number(value)));
      }
      if (req.method === 'GET' && url.pathname === '/api/artifact') {
        const keys = [...url.searchParams.keys()];
        if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(key => !['package', 'name'].includes(key)))
          throw new WorkspaceError('INVALID_ARTIFACT_REQUEST');
        const name = url.searchParams.get('name');
        const artifact = await model.artifact({ packageId: url.searchParams.get('package'), name });
        return send(res, 200, artifact.bytes, artifact.type + '; charset=utf-8',
          { 'content-disposition': 'attachment; filename="' + name.replaceAll('/', '-') + '"' });
      }
      const actions = new Map([
        ['/api/draft', input => model.save(input)], ['/api/review', input => model.review(input)],
        ['/api/prepare', input => model.prepare(input)], ['/api/inspect', input => model.inspect(input)],
        ['/api/start', input => model.start(input)], ['/api/stop', input => model.stop(input)],
        ['/api/preview', input => model.preview(input)],
        ['/api/catalog', input => model.catalog(input)], ['/api/author/review', input => model.authorReview(input)],
        ['/api/author/reopen', input => model.reopenAuthor(input)],
      ]);
      if (req.method === 'POST' && actions.has(url.pathname) && !url.search)
        return send(res, 200, await actions.get(url.pathname)(await body(req, waiting)));
      throw new WorkspaceError('WORKSPACE_ROUTE_NOT_FOUND', 404);
    }).catch(error => {
      const issue = publicIssue(error);
      if (!res.headersSent) send(res, issue.status, issue);
      else res.destroy();
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1500;
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', fail); done(); });
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  try { model = await createDuckdbWorkspace({ ...options, navigationOrigin: origin }); }
  catch (error) {
    server.closeAllConnections(); await new Promise(done => server.close(done)); throw error;
  }
  return {
    origin, url: origin + '/#key=' + token, model,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const req of waiting) req.destroy();
      const listenerClosed = new Promise(done => server.close(done));
      server.closeIdleConnections();
      closePromise = model.close().finally(() => listenerClosed);
      return closePromise;
    },
  };
}
