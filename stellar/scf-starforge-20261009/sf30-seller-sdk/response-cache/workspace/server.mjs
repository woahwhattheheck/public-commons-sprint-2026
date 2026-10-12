// MIT. Optional CLI host for the same cache UI embedded in the original API workspace.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openCacheWorkspace } from './model.mjs';
import { serveCacheWorkspaceAsset, cacheWorkspaceApi, sendCacheWorkspaceResponse } from './http.mjs';

const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function readBody(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 10 * 1024 * 1024) throw Object.assign(new Error('CACHE_WORKSPACE_INPUT_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function startCacheWorkspace({ directory, sources = [], port = 0, workspace } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid local port');
  const owned = !workspace, model = workspace ?? await openCacheWorkspace({ directory, sources });
  const token = randomBytes(32).toString('hex'), pending = new Set();
  let origin, closing = false;
  async function respond(req, res) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      if (closing) throw Object.assign(new Error('CACHE_WORKSPACE_CLOSING'), { status: 503 });
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin)
        throw Object.assign(new Error('CACHE_WORKSPACE_ORIGIN_REQUIRED'), { status: 403 });
      const url = new URL(req.url, origin);
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(302, { location: '/cache-operations' + url.search }); res.end(); return;
      }
      if (await serveCacheWorkspaceAsset(req, res, url.pathname)) return;
      if (!url.pathname.startsWith('/api/cache-operations/')) {
        sendCacheWorkspaceResponse(res, { status: 404, body: { error: 'CACHE_WORKSPACE_ROUTE_UNKNOWN' } }); return;
      }
      if (!same(req.headers['x-workspace-token'], token)) throw Object.assign(new Error('CACHE_WORKSPACE_TOKEN_REQUIRED'), { status: 401 });
      if (req.method === 'POST' && (!same(req.headers.origin, origin) ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')))
        throw Object.assign(new Error('CACHE_WORKSPACE_JSON_ORIGIN_REQUIRED'), { status: 403 });
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      sendCacheWorkspaceResponse(res, await cacheWorkspaceApi(model, {
        operation: url.pathname.slice('/api/cache-operations/'.length), method: req.method, query: url.searchParams, body,
      }));
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]+$/.test(error.code ?? error.message) ? error.code ?? error.message : 'CACHE_WORKSPACE_REQUEST_FAILED';
      if (!res.headersSent) sendCacheWorkspaceResponse(res, { status: error.status ?? 400, body: { error: code, code } });
      else res.destroy();
    }
  }
  const server = createServer((req, res) => {
    const operation = respond(req, res); pending.add(operation); operation.finally(() => pending.delete(operation));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) { if (owned) await model.close(); throw error; }
  let stopped;
  return { origin, url: origin + '/cache-operations#' + token, workspace: model,
    close() { return stopped ??= (async () => {
      closing = true;
      const closed = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      await Promise.allSettled([...pending]); await closed;
      if (owned) await model.close();
    })(); },
  };
}
