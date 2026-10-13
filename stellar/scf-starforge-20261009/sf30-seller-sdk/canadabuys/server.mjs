// MIT. Loopback operator service for retained CanadaBuys projects.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CanadaBuysWorkspace, failure } from './workspace.mjs';
import { captureCanadaBuys } from './capture.mjs';
import { routeBidderDesk } from './bidder-desk-http.mjs';
import { routeResponseReview } from './response-review/routes.mjs';
import { routeAPM2Capacity } from './examples/apm2/capacity/routes.mjs';

const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function sendJSON(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}
async function requestJSON(request, maximum = 256 * 1024 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw failure('JSON_REQUIRED', 'Send this request as application/json', 415);
  if (Number(request.headers['content-length']) > maximum) throw failure('REQUEST_CAPACITY', 'Request exceeds the configured source capacity', 413);
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) throw failure('REQUEST_CAPACITY', 'Request exceeds the configured source capacity', 413);
    chunks.push(chunk);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes));
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
    return value;
  } catch { throw failure('INVALID_JSON', 'Request must contain a complete JSON object'); }
}
function writeAllowed(request, origin) {
  const source = request.headers.origin;
  if (!source) return;
  let parsed;
  try { parsed = new URL(source); } catch { throw failure('ORIGIN_REJECTED', 'Open this workspace directly before saving', 403); }
  const target = new URL(origin);
  if (parsed.protocol !== target.protocol || !loopback.has(parsed.hostname) || parsed.port !== target.port || parsed.username || parsed.password)
    throw failure('ORIGIN_REJECTED', 'Open this workspace directly before saving', 403);
}
function attachment(response, report) {
  const name = String(report.filename || 'canadabuys-export.json').replace(/[^a-zA-Z0-9._-]/g, '_');
  response.writeHead(200, { 'Content-Type': report.mime, 'Content-Length': Buffer.byteLength(report.body),
    'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  response.end(report.body);
}
export async function startCanadaBuysServer({ directory, operator = 'operator', title, host = '127.0.0.1', port = 0, maxRequestBytes = 256 * 1024 * 1024, captureOptions = {} } = {}) {
  if (!loopback.has(host)) throw failure('LOOPBACK_REQUIRED', 'The operator workspace listens on 127.0.0.1, localhost or ::1');
  port = Number(port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure('INVALID_PORT', 'Port must be an integer between 0 and 65535');
  const workspace = new CanadaBuysWorkspace(directory, { operator, title });
  let html, bidderHtml;
  try { [html, bidderHtml] = await Promise.all([readFile(new URL('./operator/index.html', import.meta.url)), readFile(new URL('./operator/bidder-desk.html', import.meta.url))]); }
  catch (error) { workspace.close(); throw error; }
  let origin = '', closing = false;
  const activeCaptures = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const requestHost = request.headers.host;
      let hostURL;
      try { hostURL = new URL('http://' + requestHost); } catch { throw failure('HOST_REJECTED', 'Invalid workspace host', 400); }
      if (!loopback.has(hostURL.hostname) || hostURL.port !== new URL(origin).port) throw failure('HOST_REJECTED', 'Open the local workspace address', 403);
      const url = new URL(request.url, origin);
      if (url.origin !== origin) throw failure('PATH_REJECTED', 'Invalid request path', 400);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writeAllowed(request, origin);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/operator/' || url.pathname === '/bidder-desk' || url.pathname === '/bidder-desk/')) {
        const page = url.pathname.startsWith('/bidder-desk') ? bidderHtml : html;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff' }); response.end(page); return;
      }
      if (await routeAPM2Capacity({ request, response, url })) return;
      if (await routeResponseReview({ workspace, request, response, url, requestJSON, sendJSON, attachment })) return;
      if (await routeBidderDesk({ workspace, request, response, url, requestJSON, sendJSON, attachment, maxRequestBytes })) return;
      if (request.method === 'GET' && url.pathname === '/health') { sendJSON(response, 200, { schema: 'stellar-forge.canadabuys-health.v1', workspace: workspace.metadata() }); return; }
      if (request.method === 'GET' && url.pathname === '/api/workspace') { sendJSON(response, 200, workspace.view()); return; }
      if (request.method === 'GET' && url.pathname.startsWith('/api/notices/')) {
        sendJSON(response, 200, workspace.getNotice(decodeURIComponent(url.pathname.slice('/api/notices/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/workshares/')) {
        sendJSON(response, 200, workspace.getWorkshare(decodeURIComponent(url.pathname.slice('/api/workshares/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/entries/')) {
        sendJSON(response, 200, workspace.getEntry(decodeURIComponent(url.pathname.slice('/api/entries/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/sources/')) {
        sendJSON(response, 200, workspace.getSource(decodeURIComponent(url.pathname.slice('/api/sources/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/receiving/')) {
        sendJSON(response, 200, workspace.getReceiving(decodeURIComponent(url.pathname.slice('/api/receiving/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/captures/')) {
        sendJSON(response, 200, workspace.getCapture(decodeURIComponent(url.pathname.slice('/api/captures/'.length)))); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/compare') {
        sendJSON(response, 200, workspace.compare(url.searchParams.get('before'), url.searchParams.get('after'))); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/export') {
        attachment(response, workspace.report({ format: url.searchParams.get('format') || 'json', scope: url.searchParams.get('scope') || 'all', noticeIds: url.searchParams.getAll('noticeId') })); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/package') {
        const packet = workspace.exportPackage({ scope: url.searchParams.get('scope') || 'all', noticeIds: url.searchParams.getAll('noticeId') });
        attachment(response, { mime: 'application/json; charset=utf-8', filename: 'canadabuys-workspace-' + packet.packageId.slice(0, 12) + '.json', body: JSON.stringify(packet, null, 2) + '\n' }); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const body = await requestJSON(request, maxRequestBytes);
        sendJSON(response, 200, workspace.importCsv(body.rawText, { stream: body.stream, label: body.label, url: body.url, retrievedAt: body.retrievedAt, expectedSha256: body.expectedSha256, response: body.response, coverage: body.coverage,
          bodyKind: body.bodyKind, derivation: body.derivation, derivationSha256: body.derivationSha256 }, body.expectedRevision)); return;
      }
      if (request.method === 'PATCH' && /^\/api\/notices\/[^/]+\/review$/.test(url.pathname)) {
        const ocid = decodeURIComponent(url.pathname.slice('/api/notices/'.length, -'/review'.length));
        sendJSON(response, 200, { ...workspace.updateReview(ocid, await requestJSON(request, 1024 * 1024)), ...workspace.view() }); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/workshares') {
        const body = await requestJSON(request, 4 * 1024 * 1024);
        sendJSON(response, 200, { ...workspace.createWorkshare(body, body.expectedRevision), ...workspace.view() }); return;
      }
      if (request.method === 'PATCH' && url.pathname.startsWith('/api/workshares/')) {
        sendJSON(response, 200, { ...workspace.updateWorkshare(decodeURIComponent(url.pathname.slice('/api/workshares/'.length)), await requestJSON(request, 4 * 1024 * 1024)), ...workspace.view() }); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/qualify') {
        const body = await requestJSON(request, 1024 * 1024);
        sendJSON(response, 200, workspace.qualify(body.profile || body)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/receive') {
        const body = await requestJSON(request, maxRequestBytes);
        sendJSON(response, 200, { ...workspace.receivePackage(body.package, { expectedRevision: body.expectedRevision }), ...workspace.view() }); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/capture') {
        const spec = await requestJSON(request, 64 * 1024);
        const controller = new AbortController(); activeCaptures.add(controller);
        try {
          const result = await captureCanadaBuys(workspace, spec, { ...captureOptions, signal: controller.signal });
          if (!response.destroyed) sendJSON(response, 200, { ...result, ...workspace.view() });
        } finally { activeCaptures.delete(controller); }
        return;
      }
      throw failure('NOT_FOUND', 'Workspace route does not exist', 404);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) sendJSON(response, Number.isInteger(error.status) ? error.status : 500,
        { error: { code: error.code || 'WORKSPACE_ERROR', message: error.message || 'Workspace request failed', ...(error.details !== undefined ? { details: error.details } : {}) } });
      else if (!response.destroyed) response.destroy(error);
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); }).catch(error => { workspace.close(); throw error; });
  const address = server.address(), hostname = address.address.includes(':') ? '[' + address.address + ']' : address.address;
  origin = 'http://' + hostname + ':' + address.port;
  const close = async () => {
    if (closing) return; closing = true;
    for (const controller of activeCaptures) controller.abort(failure('CAPTURE_INTERRUPTED', 'Workspace is closing; resume its saved capture', 499));
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    workspace.close();
  };
  return { server, workspace, origin, url: origin, close };
}
