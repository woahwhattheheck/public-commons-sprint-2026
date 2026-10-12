// MIT. Private operator host for original supplier account configuration and saved reviews.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openSupplierAccountWorkspace } from './model.mjs';
import { need } from './plan.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const codeOf = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'SUPPLIER_WORKSPACE_REQUEST_FAILED';
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body) + '\n');
}
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    need(size <= 2 * 1024 * 1024, 'SUPPLIER_WORKSPACE_INPUT_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('SUPPLIER_WORKSPACE_JSON_REQUIRED'), { code: 'SUPPLIER_WORKSPACE_JSON_REQUIRED', status: 400 }); }
}

export async function startSupplierAccountWorkspace({ directory, upstreamsFile, port = 0, workspace } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'SUPPLIER_WORKSPACE_PORT_INVALID');
  const manifest = JSON.parse(await readFile(new URL('./browser-assets.json', import.meta.url), 'utf8'));
  need(manifest.schema === 'stellar-forge.browser-assets.v1' && manifest.root === './' &&
    Array.isArray(manifest.routes), 'SUPPLIER_WORKSPACE_ASSETS_INVALID');
  const assets = new Map();
  for (const [route, [file, type]] of manifest.routes) {
    need(['/','/browser.mjs','/style.css'].includes(route) &&
      ['index.html','browser.mjs','style.css'].includes(file) && !assets.has(route),
    'SUPPLIER_WORKSPACE_ASSETS_INVALID');
    assets.set(route, { body: await readFile(new URL('./' + file, import.meta.url)), type });
  }
  need(assets.size === 3, 'SUPPLIER_WORKSPACE_ASSETS_MISSING');
  const owned = workspace === undefined, model = workspace ?? await openSupplierAccountWorkspace({ directory, upstreamsFile });
  const token = randomBytes(32).toString('hex'), pending = new Set();
  let origin, closing = false, stopped;
  async function respond(req, res) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      need(!closing, 'SUPPLIER_WORKSPACE_CLOSING', 503);
      need(req.headers.host === new URL(origin).host && (!req.headers.origin || req.headers.origin === origin),
        'SUPPLIER_WORKSPACE_ORIGIN_REQUIRED', 403);
      const url = new URL(req.url, origin);
      need(url.origin === origin && !url.username && !url.password, 'SUPPLIER_WORKSPACE_ORIGIN_REQUIRED', 403);
      if (assets.has(url.pathname)) {
        need(req.method === 'GET', 'SUPPLIER_WORKSPACE_METHOD_REQUIRED', 405);
        const asset = assets.get(url.pathname);
        res.writeHead(200, { 'content-type': asset.type }); res.end(asset.body); return;
      }
      need(url.pathname.startsWith('/api/'), 'SUPPLIER_WORKSPACE_ROUTE_UNKNOWN', 404);
      need(same(req.headers['x-workspace-token'], token), 'SUPPLIER_WORKSPACE_TOKEN_REQUIRED', 401);
      let result;
      if (req.method === 'GET') {
        if (url.pathname === '/api/workspace') result = await model.view({
          offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50) });
        else if (url.pathname === '/api/change') result = await model.read(url.searchParams.get('id'));
        else if (url.pathname === '/api/report') result = await model.report();
        else throw Object.assign(new Error('SUPPLIER_WORKSPACE_ROUTE_UNKNOWN'), { code: 'SUPPLIER_WORKSPACE_ROUTE_UNKNOWN', status: 404 });
      } else {
        need(req.method === 'POST', 'SUPPLIER_WORKSPACE_METHOD_REQUIRED', 405);
        need(same(req.headers.origin, origin) &&
          /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''),
        'SUPPLIER_WORKSPACE_JSON_ORIGIN_REQUIRED', 403);
        const body = await bodyOf(req);
        if (url.pathname === '/api/prepare') result = await model.prepare(body);
        else if (url.pathname === '/api/restore-change') result = await model.prepareRestore(body);
        else if (url.pathname === '/api/rebase') result = await model.prepareRebase(body);
        else if (url.pathname === '/api/apply') result = await model.apply(body);
        else if (url.pathname === '/api/recover') result = await model.recover(body);
        else if (url.pathname === '/api/cancel') result = await model.cancel(body);
        else if (url.pathname === '/api/inspect-quota') result = await model.inspectQuota();
        else throw Object.assign(new Error('SUPPLIER_WORKSPACE_ROUTE_UNKNOWN'), { code: 'SUPPLIER_WORKSPACE_ROUTE_UNKNOWN', status: 404 });
      }
      send(res, 200, result);
    } catch (error) {
      if (!res.headersSent) send(res, Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 400,
        { error: codeOf(error), ...(error.changeId ? { changeId: error.changeId } : {}) });
      else res.destroy();
    }
  }
  const server = createServer((req, res) => {
    const operation = respond(req, res);
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  try {
    await new Promise((done, reject) => {
      const onError = error => { server.off('listening', onListening); reject(error); };
      const onListening = () => {
        server.off('error', onError); origin = 'http://127.0.0.1:' + server.address().port; done();
      };
      server.once('error', onError); server.once('listening', onListening); server.listen(port, '127.0.0.1');
    });
  } catch (error) { if (owned) await model.close(); throw error; }
  return Object.freeze({
    origin, url: origin + '/#' + token, port: server.address().port, workspace: model,
    close() {
      return stopped ??= (async () => {
        closing = true;
        const drained = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
        server.closeIdleConnections();
        try { await Promise.allSettled([...pending]); await drained; }
        finally { if (owned) await model.close(); }
      })();
    },
  });
}
