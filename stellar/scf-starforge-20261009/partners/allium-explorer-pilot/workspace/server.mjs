// MIT. Private loopback host for the original Allium retained operator workspace.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openAlliumWorkspace } from './model.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/browser.mjs', ['browser.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/local-draft-store.mjs', ['../../../sf30-seller-sdk/python/workspace/local-draft-store.mjs', 'text/javascript; charset=utf-8']],
]);
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const issue = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
function send(response, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  response.writeHead(status, { ...headers, 'content-type': type, 'content-length': data.length, ...extra }); response.end(data);
}
async function json(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw issue('JSON_REQUIRED', 'Send application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) throw issue('REQUEST_TOO_LARGE', 'The request exceeds 2 MiB.', 413); chunks.push(chunk); }
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw issue('JSON_INVALID', 'Correct the JSON request.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw issue('OBJECT_REQUIRED', 'Use a JSON object.');
  return value;
}

export async function startAlliumWorkspaceServer({ directory, port = 8447, env = process.env, allowLoopback = false } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw issue('PORT_INVALID', 'Use a port from 0 to 65535.');
  const workspace = await openAlliumWorkspace({ directory, env, allowLoopback });
  const token = randomBytes(32).toString('hex'), active = new Set(); let origin, stopping = false;
  const operations = new Map([
    ['/api/product/save', body => workspace.saveProduct(body)],
    ['/api/product/restore', body => workspace.restoreProduct(body)],
    ['/api/import', body => workspace.importResult(body)],
    ['/api/query/start', body => workspace.startQuery(body)],
    ['/api/query/resume', body => workspace.resumePrepared(body)],
    ['/api/query/collect', body => workspace.collect(body)],
    ['/api/query/recover', body => workspace.recover(body)],
    ['/api/preview', body => workspace.query(body)],
    ['/api/merchant/configure', body => workspace.configure(body)],
    ['/api/merchant/start', body => workspace.startMerchant(body)],
    ['/api/merchant/stop', body => workspace.stopMerchant(body)],
    ['/api/merchant/refresh', body => workspace.refresh(body)],
    ['/api/merchant/activate', body => workspace.activate(body)],
    ['/api/merchant/collect', () => workspace.collectVersions()],
    ['/api/publisher', () => workspace.openPublisher()],
    ['/api/publisher/stage', body => workspace.stageForPublisher(body)],
  ]);
  const server = createServer((request, response) => {
    const operation = (async () => {
      if (stopping) throw issue('WORKSPACE_STOPPING', 'The workspace is closing. Reopen it to continue.', 503);
      if (request.headers.host !== new URL(origin).host ||
          request.headers.origin && request.headers.origin !== origin ||
          ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) throw issue('LOCAL_ORIGIN_REQUIRED', 'Use this workspace’s loopback operator URL.', 403);
      const target = new URL(request.url, origin);
      if (target.origin !== origin) throw issue('LOCAL_ORIGIN_REQUIRED', 'Use the local workspace.', 403);
      if (request.method === 'GET' && ASSETS.has(target.pathname)) {
        const [path, type] = ASSETS.get(target.pathname); return send(response, 200, await readFile(new URL(path, import.meta.url)), type);
      }
      const supplied = request.headers['x-allium-workspace-token'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
        throw issue('OPERATOR_TOKEN_REQUIRED', 'Open the complete private operator URL printed by the CLI.', 403);
      if (request.method === 'GET') {
        if (target.pathname === '/api/state') return send(response, 200, await workspace.state());
        if (target.pathname === '/api/revision') return send(response, 200, await workspace.revision(target.searchParams.get('id')));
        if (target.pathname === '/api/acquisition') return send(response, 200, await workspace.acquisition(target.searchParams.get('id')));
        if (target.pathname === '/api/download') {
          const file = await workspace.download({ acquisitionId: target.searchParams.get('id'), kind: target.searchParams.get('kind') });
          return send(response, 200, file.data, file.contentType, { 'content-disposition': 'attachment; filename="' + file.filename + '"', 'x-content-sha256': file.sha256 });
        }
      }
      if (request.method === 'POST') {
        const body = await json(request);
        if (target.pathname === '/api/export') {
          if (Object.keys(body).length) throw issue('EXPORT_INPUT_INVALID', 'Export takes no filters; it retains the complete workspace.');
          const bundle = await workspace.exportBundle();
          return send(response, 200, JSON.stringify(bundle, null, 2) + '\n', 'application/json',
            { 'content-disposition': 'attachment; filename="' + bundle.workspaceId + '.allium-workspace.json"', 'x-manifest-sha256': bundle.manifestSha256 });
        }
        const action = operations.get(target.pathname);
        if (action) return send(response, 200, { result: await action(body), state: await workspace.state() });
      }
      throw issue('ROUTE_NOT_FOUND', 'This workspace route does not exist.', 404);
    })();
    active.add(operation); operation.catch(error => {
      if (!response.writableEnded && !response.destroyed) send(response, Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 422,
        { error: error.code ?? 'OPERATION_FAILED', message: error.message ?? 'The operation failed; reload its retained state before continuing.' });
    }).finally(() => active.delete(operation));
  });
  server.requestTimeout = 300000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) { await workspace.close(); throw error; }
  let closing;
  return { origin, url: origin + '/#' + token, token, workspace, server,
    close() {
      if (closing) return closing; stopping = true;
      closing = (async () => {
        const stopped = new Promise((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeIdleConnections?.(); });
        await Promise.allSettled([...active]); await stopped; await workspace.close();
      })(); return closing;
    } };
}
