import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openWorkspace, WorkspaceError, canonical, sha256 } from './workspace.mjs';

export const STARTUP_SCHEMA = 'stellar-forge.open311-workspace-startup.v1';
const MAX_BODY = 192 * 1024 * 1024;
const ASSETS = new Map([
  ['/', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['workspace/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['workspace/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['workspace/style.css', 'text/css; charset=utf-8']]
]);
export function workspaceBinding(directory, workspaceId) {
  const value = { schema: 'stellar-forge.open311-workspace-binding.v1', directory, workspaceId };
  return { ...value, sha256: sha256(canonical(value)) };
}
const errorValue = error => ({ error: { code: String(error.code || 'WORKSPACE_ERROR'),
  message: String(error.message || 'The workspace action failed.'),
  ...(error.details === undefined ? {} : { details: error.details }),
  ...(error.receipt === undefined ? {} : { receipt: error.receipt }) } });
function json(response, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  response.end(data);
}
async function readBody(request, max) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new WorkspaceError('REQUEST_TOO_LARGE', 'The request exceeds the workspace intake limit.', 413);
  const parts = []; let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > max) throw new WorkspaceError('REQUEST_TOO_LARGE', 'The request exceeds the workspace intake limit.', 413);
    parts.push(part);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new WorkspaceError('INVALID_JSON', 'Send a JSON object for this action.'); }
}
export async function startOpen311Server({ workspace, host = '127.0.0.1', port = 0,
  maxBodyBytes = MAX_BODY, clientFactory, expectedWorkspaceId, expectedBindingSha256 } = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new WorkspaceError('LOOPBACK_REQUIRED', 'The private operator server binds to localhost.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new WorkspaceError('INVALID_PORT', 'Use a port between 0 and 65535.');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_BODY) throw new WorkspaceError('INVALID_BODY_LIMIT', 'Use an intake limit no larger than 192 MiB.');
  const store = openWorkspace(workspace, clientFactory ? { clientFactory } : {});
  const initial = store.state(), binding = workspaceBinding(store.directory, initial.workspaceId);
  if ((expectedWorkspaceId && initial.workspaceId !== expectedWorkspaceId) || (expectedBindingSha256 && binding.sha256 !== expectedBindingSha256)) {
    store.close(); throw new WorkspaceError('WORKSPACE_IDENTITY_CHANGED', 'The selected workspace identity changed before startup.', 409);
  }
  const instanceId = randomUUID(), startedAt = new Date().toISOString();
  const pending = new Set();
  let origin, authority, stopping = false, startup, closing;
  const currentStartup = () => {
    const identity = store.state();
    return { ...startup, workspaceId: identity.workspaceId, binding: workspaceBinding(store.directory, identity.workspaceId) };
  };
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const task = (async () => {
      try {
        if (stopping) throw new WorkspaceError('SERVER_CLOSING', 'The workspace is closing.', 503);
        if (request.headers.host !== authority) throw new WorkspaceError('INVALID_HOST', 'Use the address printed by this workspace server.', 403);
        if (request.headers.origin && request.headers.origin !== origin) throw new WorkspaceError('INVALID_ORIGIN', 'This request came from a different origin.', 403);
        if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) throw new WorkspaceError('INVALID_ORIGIN', 'Open this workspace directly in its own tab.', 403);
        const url = new URL(request.url, origin), query = Object.fromEntries(url.searchParams);
        if (request.method === 'GET' && ASSETS.has(url.pathname)) {
          const [file, type] = ASSETS.get(url.pathname), data = await readFile(new URL(file, import.meta.url));
          response.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length }); return response.end(data);
        }
        if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok', workspaceId: store.state().workspaceId });
        if (request.method === 'GET' && url.pathname === '/api/launch') return json(response, 200, currentStartup());
        if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, store.state());
        if (request.method === 'GET' && url.pathname === '/api/services') return json(response, 200, store.services(query));
        if (request.method === 'GET' && url.pathname === '/api/requests') return json(response, 200, store.requests(query));
        if (request.method === 'GET' && url.pathname === '/api/request') return json(response, 200, store.request(query));
        if (request.method === 'GET' && url.pathname === '/api/capture') return json(response, 200, store.captureInfo(query));
        if (request.method === 'GET' && url.pathname === '/api/diff') return json(response, 200, store.diff(query));
        if (request.method === 'GET' && url.pathname === '/api/operation') return json(response, 200, store.operation(query.requestId));
        if (request.method === 'GET' && url.pathname === '/api/export') {
          const exported = store.export(query), data = typeof exported.body === 'string' ? Buffer.from(exported.body) : exported.body;
          response.setHeader('Content-Disposition', 'attachment; filename="' + exported.filename.replace(/[^A-Za-z0-9._-]/g, '_') + '"');
          response.writeHead(200, { 'Content-Type': exported.contentType, 'Content-Length': data.length }); return response.end(data);
        }
        if (request.method === 'POST' && ['/api/connections', '/api/capture', '/api/reviews', '/api/receive'].includes(url.pathname)) {
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new WorkspaceError('JSON_REQUIRED', 'Send application/json for this action.', 415);
          if (request.headers['x-open311-workspace'] !== store.state().workspaceId) throw new WorkspaceError('WORKSPACE_ID_REQUIRED', 'This action must identify the currently open workspace.', 409);
          const input = await readBody(request, url.pathname === '/api/receive' ? maxBodyBytes : Math.min(maxBodyBytes, 2 * 1024 * 1024));
          let result;
          if (url.pathname === '/api/connections') result = store.putConnection(input);
          else if (url.pathname === '/api/capture') result = await store.capture(input);
          else if (url.pathname === '/api/reviews') result = store.putReview(input);
          else result = store.receive(input);
          return json(response, 200, result);
        }
        throw new WorkspaceError('NOT_FOUND', 'This workspace route does not exist.', 404);
      } catch (error) {
        if (!response.headersSent && !response.destroyed) return json(response, Number.isInteger(error.status) ? error.status : 500, errorValue(error));
        response.destroy();
      }
    })();
    pending.add(task); task.finally(() => pending.delete(task)).catch(() => {});
  });
  server.requestTimeout = 120000; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen({ host, port }, () => { server.off('error', reject); accept(); }); });
    const address = server.address();
    authority = (address.address.includes(':') ? '[' + address.address + ']' : address.address) + ':' + address.port;
    origin = 'http://' + authority;
    startup = { schema: STARTUP_SCHEMA, state: 'LISTENING', url: origin, workspaceId: initial.workspaceId, binding, instanceId, startedAt };
  } catch (error) { store.close(); throw error; }
  const close = () => closing ||= (async () => {
    stopping = true;
    const stopped = new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    server.closeIdleConnections?.();
    await Promise.allSettled([...pending]);
    server.closeIdleConnections?.();
    await stopped; store.close();
  })();
  return { url: origin, workspace: store, server, get startup() { return currentStartup(); }, close };
}
