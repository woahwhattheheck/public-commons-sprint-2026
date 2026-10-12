// MIT. Private loopback reporting desk with exact workspace binding and atomic actions.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { openWorkspace } from './workspace.mjs';
import { fail } from './calendar.mjs';

export const STARTUP_SCHEMA = 'stellar-forge.open311-reporting-startup.v1';
export const BINDING_SCHEMA = 'stellar-forge.open311-reporting-binding.v1';
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
export const workspaceBinding = (directory, workspaceId) => createHash('sha256').update(JSON.stringify({ directory, schema: BINDING_SCHEMA, workspaceId })).digest('hex');
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); response.end(JSON.stringify(value));
}
async function body(request, maximum = 128 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) fail('REQUEST_TOO_LARGE', 'The complete file exceeds the 128 MiB local import limit.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('INVALID_JSON', 'Send a complete JSON action.'); }
}
export async function serveReporting({ directory, host = '127.0.0.1', port = 0, expectedWorkspaceId, expectedBindingSha256 } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) fail('PRIVATE_HOST_REQUIRED', 'The reporting desk listens on a loopback address.');
  port = Number(port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('INVALID_PORT', 'Port must be 0–65535.');
  const workspace = openWorkspace(directory, { create: false }), initial = workspace.state();
  const bindingSha256 = workspaceBinding(workspace.directory, initial.workspaceId);
  if (expectedWorkspaceId && expectedWorkspaceId !== initial.workspaceId || expectedBindingSha256 && expectedBindingSha256 !== bindingSha256) {
    workspace.close(); fail('WORKSPACE_BINDING_MISMATCH', 'The selected reporting workspace differs from the original launch selection.', 409);
  }
  const session = randomBytes(32).toString('hex'), cookieName = 'open311_reporting_' + randomBytes(6).toString('hex');
  const instanceId = randomUUID(), startedAt = new Date().toISOString(), assetRoot = fileURLToPath(new URL('.', import.meta.url));
  let launch, origin;
  const server = createServer(async (request, response) => {
    try {
      if (!origin || request.headers.host !== new URL(origin).host) fail('INVALID_HOST', 'Use the selected local reporting address.', 403);
      if (request.headers.origin && request.headers.origin !== origin) fail('INVALID_ORIGIN', 'This action must originate in the selected reporting desk.', 403);
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/api/launch') { json(response, 200, launch); return; }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [filename, contentType] = assets.get(url.pathname);
        const data = await readFile(join(assetRoot, filename));
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ...(url.pathname === '/' || url.pathname === '/index.html' ? { 'Set-Cookie': cookieName + '=' + session + '; HttpOnly; SameSite=Strict; Path=/' } : {}) });
        response.end(data); return;
      }
      const cookies = String(request.headers.cookie ?? '').split(';').map(v => v.trim());
      if (!cookies.includes(cookieName + '=' + session)) fail('REPORTING_SESSION_REQUIRED', 'Open the reporting desk to begin a private local session.', 403);
      const id = url.searchParams.get('id'), requestId = url.searchParams.get('requestId');
      if (request.method === 'GET') {
        let value;
        if (url.pathname === '/api/state') value = workspace.state();
        else if (url.pathname === '/api/source') value = workspace.source(id);
        else if (url.pathname === '/api/profile') value = workspace.profile(id);
        else if (url.pathname === '/api/report') value = workspace.report(id);
        else if (url.pathname === '/api/review') value = workspace.review(id);
        else if (url.pathname === '/api/operation') value = workspace.operation(requestId);
        else if (url.pathname === '/api/compare') value = workspace.compare(url.searchParams.get('before'), url.searchParams.get('after'));
        else if (url.pathname === '/api/export') {
          const rawRevision = url.searchParams.get('expectedRevision');
          const exported = workspace.exportFile({ kind: url.searchParams.get('kind'), reportId: url.searchParams.get('reportId') || null,
            ...(rawRevision !== null ? { expectedRevision: Number(rawRevision) } : {}) });
          response.writeHead(200, { 'Content-Type': exported.contentType, 'Cache-Control': 'no-store',
            'Content-Disposition': 'attachment; filename="' + exported.filename.replace(/["\r\n]/g, '_') + '"',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
          response.end(exported.body); return;
        } else fail('ROUTE_NOT_FOUND', 'This reporting route was not found.', 404);
        json(response, 200, { ok: true, value }); return;
      }
      if (request.method === 'POST') {
        if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) fail('JSON_CONTENT_TYPE_REQUIRED', 'Reporting actions use application/json.', 415);
        const input = await body(request);
        let value;
        if (url.pathname === '/api/import') value = workspace.importSource(input);
        else if (url.pathname === '/api/profile') value = workspace.putProfile(input);
        else if (url.pathname === '/api/build') value = workspace.build(input);
        else if (url.pathname === '/api/review-import') value = workspace.importReview(input);
        else if (url.pathname === '/api/review-apply') value = workspace.applyReview(input);
        else if (url.pathname === '/api/receive') value = workspace.receive(input.originalText, input);
        else fail('ROUTE_NOT_FOUND', 'This reporting route was not found.', 404);
        json(response, 200, { ok: true, value }); return;
      }
      fail('METHOD_NOT_ALLOWED', 'Choose GET or POST for this reporting route.', 405);
    } catch (error) {
      if (!response.headersSent) json(response, Number.isInteger(error.status) ? error.status : 500,
        { ok: false, error: { code: error.code ?? 'REPORTING_ERROR', message: error.message, details: error.details ?? null } });
      else response.destroy(error);
    }
  });
  try {
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, host, resolvePromise); });
    const address = server.address(); origin = 'http://' + (host === '::1' ? '[' + host + ']' : host) + ':' + address.port;
    launch = { schema: STARTUP_SCHEMA, state: 'LISTENING', directory: workspace.directory, workspaceId: initial.workspaceId,
      bindingSha256, binding: { schema: BINDING_SCHEMA, directory: workspace.directory, workspaceId: initial.workspaceId, sha256: bindingSha256 }, instanceId, startedAt, url: origin + '/' };
    let closing = null;
    return { server, workspace, launch,
      close: () => closing ??= new Promise((resolvePromise, reject) => server.close(error => { workspace.close(); error ? reject(error) : resolvePromise(); })) };
  } catch (error) { workspace.close(); throw error; }
}
