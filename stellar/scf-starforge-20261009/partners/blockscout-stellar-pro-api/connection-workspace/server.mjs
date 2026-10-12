// MIT. Local browser carrier for the original connection workspace.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { regular, need } from '../../../distribution/runtime-workspace/storage.mjs';
import { createConnectionWorkspace, openConnectionWorkspace, inspectConnectionWorkspace } from './model.mjs';

const HOST = '127.0.0.1';
const HEADER = 'x-blockscout-connection-token';
const SECURITY = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
});
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
function sameToken(value, token) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
function respond(response, status, value, headers = {}) {
  if (response.destroyed) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + '\n');
  response.writeHead(status, { ...SECURITY, 'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length, ...headers });
  response.end(bytes);
}
async function input(request) {
  need(/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''),
    'CONNECTION_WORKSPACE_JSON_REQUIRED', 'Send a JSON request.', 415);
  const maximum = 4 * 1024 * 1024, chunks = []; let bytes = 0;
  const length = request.headers['content-length'];
  need(length === undefined || /^\d+$/.test(length) && Number(length) <= maximum,
    'CONNECTION_WORKSPACE_REQUEST_TOO_LARGE', 'The complete input is too large.', 413);
  for await (const chunk of request) {
    bytes += chunk.length;
    need(bytes <= maximum, 'CONNECTION_WORKSPACE_REQUEST_TOO_LARGE', 'The complete input is too large.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { need(false, 'CONNECTION_WORKSPACE_JSON_INVALID', 'The request is incomplete or invalid JSON.'); }
  return value;
}
function query(url, allowed) {
  const pairs = [...url.searchParams];
  need(new Set(pairs.map(([key]) => key)).size === pairs.length &&
    pairs.every(([key]) => allowed.includes(key)), 'CONNECTION_WORKSPACE_QUERY_INVALID');
  return Object.fromEntries(pairs);
}
export async function startConnectionWorkspace({ directory, applicationsDirectory = null,
  port = 0, expectedWorkspaceId, expectedConfigSha256 } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'CONNECTION_WORKSPACE_PORT_INVALID');
  const config = expectedWorkspaceId !== undefined || expectedConfigSha256 !== undefined
    ? await inspectConnectionWorkspace(directory) : await createConnectionWorkspace({ directory });
  if (expectedWorkspaceId !== undefined)
    need(config.workspaceId === expectedWorkspaceId, 'CONNECTION_WORKSPACE_ID_CHANGED', undefined, 409);
  if (expectedConfigSha256 !== undefined)
    need(config.configSha256 === expectedConfigSha256, 'CONNECTION_WORKSPACE_CONFIG_CHANGED', undefined, 409);
  const model = await openConnectionWorkspace({ directory: config.directory });
  try {
    if (applicationsDirectory) {
      // This is only an existing Applications identity binding; it launches no application.
      const { createHash } = await import('node:crypto');
      const raw = createHash('sha256').update(config.workspaceId + '\n' + applicationsDirectory).digest('hex');
      const id = raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16) + '-' +
        raw.slice(16, 20) + '-' + raw.slice(20, 32);
      await model.call('connect', { directory: applicationsDirectory, requestId: id });
    }
  } catch (error) { await model.close(); throw error; }
  const token = randomBytes(32).toString('hex'), active = new Set();
  let origin = null, authorities = new Set(), origins = new Set(), closing = null, closed = false;
  async function handle(request, response) {
    try {
      need(!closed, 'CONNECTION_WORKSPACE_CLOSING', 'The workspace is closing.', 503);
      need(authorities.has(request.headers.host), 'CONNECTION_WORKSPACE_HOST_INVALID', undefined, 403);
      need(typeof request.url === 'string' && request.url.startsWith('/') && !request.url.startsWith('//'),
        'CONNECTION_WORKSPACE_ROUTE_INVALID', undefined, 400);
      const url = new URL(request.url, origin);
      const asset = ASSETS.get(url.pathname);
      if (request.method === 'GET' && asset && !url.search) {
        const bytes = await regular(fileURLToPath(new URL('./public/' + asset[0], import.meta.url)), 1024 * 1024);
        return respond(response, 200, bytes, { 'content-type': asset[1] });
      }
      need(sameToken(request.headers[HEADER], token), 'CONNECTION_WORKSPACE_AUTH_REQUIRED',
        'Open the private startup URL for this running workspace.', 401);
      need(request.headers.origin === undefined || origins.has(request.headers.origin),
        'CONNECTION_WORKSPACE_ORIGIN_INVALID', undefined, 403);
      if (request.method === 'POST') {
        need(origins.has(request.headers.origin), 'CONNECTION_WORKSPACE_ORIGIN_INVALID', undefined, 403);
        need(!url.search, 'CONNECTION_WORKSPACE_QUERY_INVALID');
        const action = /^\/api\/actions\/([a-z][a-z-]{0,63})$/.exec(url.pathname);
        need(action, 'CONNECTION_WORKSPACE_ROUTE_NOT_FOUND', undefined, 404);
        return respond(response, 200, await model.call(action[1], await input(request)));
      }
      need(request.method === 'GET', 'CONNECTION_WORKSPACE_METHOD_INVALID', undefined, 405);
      if (url.pathname === '/api/state' && !url.search) return respond(response, 200, await model.state());
      if (url.pathname === '/api/history') {
        const values = query(url, ['after', 'limit']);
        if (values.limit !== undefined) {
          need(/^[1-9]\d*$/.test(values.limit), 'CONNECTION_WORKSPACE_PAGE_INVALID');
          values.limit = Number(values.limit);
        }
        return respond(response, 200, await model.history(values));
      }
      const record = /^\/api\/records\/([a-z-]+)\/([a-f0-9-]+)$/.exec(url.pathname);
      if (record && !url.search) return respond(response, 200, await model.record(record[1], record[2]));
      const applications = /^\/api\/applications\/([a-f0-9]{24})$/.exec(url.pathname);
      if (applications && !url.search) return respond(response, 200, await model.applicationsState(applications[1]));
      const output = /^\/api\/output\/([a-f0-9]{24})\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (output && !url.search) return respond(response, 200, await model.output(output[1], output[2]));
      const download = /^\/api\/packages\/([a-f0-9]{24})$/.exec(url.pathname);
      if (download && !url.search) {
        const value = await model.download(download[1]);
        return respond(response, 200, value.bytes, {
          'content-disposition': 'attachment; filename="' + value.filename + '"',
          'x-content-sha256': value.sha256,
        });
      }
      need(false, 'CONNECTION_WORKSPACE_ROUTE_NOT_FOUND', 'This workspace route does not exist.', 404);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else respond(response, Number.isInteger(error.status) ? error.status : error.code === 'ENOENT' ? 404 : 500, {
        error: { code: error.code ?? 'CONNECTION_WORKSPACE_REQUEST_FAILED',
          message: String(error.message ?? error).slice(0, 1200), requestId: error.requestId ?? null },
      });
    }
  }
  const server = createServer((request, response) => {
    const task = handle(request, response); active.add(task);
    task.finally(() => active.delete(task)).catch(() => {});
  });
  server.requestTimeout = 75000; server.headersTimeout = 8000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, HOST, done); });
  } catch (error) { await model.close(); throw error; }
  const listenerPort = server.address().port;
  authorities = new Set([HOST, 'localhost'].flatMap(host =>
    listenerPort === 80 ? [host, host + ':80'] : [host + ':' + listenerPort]));
  origins = new Set([...authorities].map(value => 'http://' + value));
  origin = new URL('http://' + HOST + ':' + listenerPort).origin;
  return {
    server, model, config, url: origin, controlUrl: origin + '/#' + token,
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          try {
            await new Promise((done, reject) => {
              server.close(error => error ? reject(error) : done());
              server.closeIdleConnections?.();
            });
          } finally {
            await Promise.allSettled([...active]);
            await model.close();
          }
        })();
      }
      return closing;
    },
  };
}
