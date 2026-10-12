// MIT. One private listener composes agreement calendars and original receivables.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {ServiceAgreementWorkspace} from './store.mjs';
import {createReceivablesHandler} from '../receivables/server.mjs';
import {RECEIVABLE_REQUEST_BYTES} from '../receivables/store.mjs';
import {renderCustomerTar, need} from '../receivables/core.mjs';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';

const API = '/api/service-agreements';
const UI = '/service-agreements';
const ASSETS = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function headers(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function local(request, port, mutation) {
  const raw = request.headers.host;
  need(typeof raw === 'string' && !/[\s/@?#]/.test(raw), 'INVALID_HOST', 'Use the local workspace address.', 403);
  let host;
  try { host = new URL('http://' + raw); } catch { need(false, 'INVALID_HOST', 'Use the local workspace address.', 403); }
  need(LOOPBACK.has(host.hostname.toLowerCase()) &&
    Number(host.port || 80) === Number(port || request.socket.localPort),
    'INVALID_HOST', 'Use the local workspace address and port.', 403);
  if (request.headers.origin !== undefined) {
    let origin;
    try { origin = new URL(String(request.headers.origin)); } catch { need(false, 'INVALID_ORIGIN', 'Open the original local workspace.', 403); }
    need(origin.protocol === 'http:' && origin.host.toLowerCase() === host.host.toLowerCase() &&
      !origin.username && !origin.password, 'INVALID_ORIGIN', 'Open the original local workspace.', 403);
  }
  if (mutation) {
    need(request.headers['x-workspace-request'] === '1', 'WORKSPACE_REQUEST_REQUIRED',
      'Use the workspace client to save changes.', 403);
    need(String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'application/json',
      'JSON_REQUIRED', 'Send an application/json operator request.', 415);
    need(!request.headers['content-encoding'] || request.headers['content-encoding'] === 'identity',
      'UNSUPPORTED_ENCODING', 'Send an uncompressed operator request.', 415);
  }
}
async function requestBody(request) {
  const declared = request.headers['content-length'];
  need(declared === undefined || /^\d+$/.test(declared) && Number(declared) <= RECEIVABLE_REQUEST_BYTES,
    'REQUEST_TOO_LARGE', 'Choose quotation files within the workspace request limit.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    need(size <= RECEIVABLE_REQUEST_BYTES, 'REQUEST_TOO_LARGE', 'The operator request is too large.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { need(false, 'INVALID_JSON', 'Send a valid JSON operator request.'); }
  need(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_JSON', 'Send one operator request object.');
  return value;
}
function sendJson(response, status, value, head = false) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length});
  response.end(head ? undefined : bytes);
}
function sendFile(response, file, head = false) {
  const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes);
  const name = file.name.replace(/[\r\n"\\]/g, '_').split('/').pop();
  response.writeHead(200, {'Content-Type': file.type ?? 'application/octet-stream',
    'Content-Length': bytes.length, 'Content-Disposition': 'attachment; filename="' + name + '"'});
  response.end(head ? undefined : bytes);
}
export async function serviceAgreementAsset(path) {
  if (path !== UI && !path.startsWith(UI + '/')) return null;
  const name = path === UI ? 'index.html' : path.slice(UI.length + 1) || 'index.html';
  if (name === 'config.json') return {bytes: Buffer.from(JSON.stringify({
    apiPath: API, uiPath: UI, requestBytes: RECEIVABLE_REQUEST_BYTES, receivablesPath: '/receivables/'})),
    type: 'application/json; charset=utf-8'};
  const entry = ASSETS.get(UI + '/' + name);
  return entry ? {bytes: await readFile(entry.url), type: entry.type} : null;
}
export async function handleServiceAgreementRequest(agreements, {method, path, query = {}, value}) {
  if (path !== API && !path.startsWith(API + '/')) return null;
  const parts = path.slice(API.length).split('/').filter(Boolean).map(part => {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { need(false, 'INVALID_IDENTIFIER', 'The selected record identifier is invalid.'); }
    need(!/[\\/\u0000-\u001f]/.test(decoded), 'INVALID_IDENTIFIER', 'The selected record identifier is invalid.');
    return decoded;
  });
  const search = query instanceof URLSearchParams ? query : new URLSearchParams(
    Object.entries(query).filter(([, item]) => item !== undefined && item !== null));
  const asOf = search.get('asOf') || undefined;
  const route = parts.join('/');
  if (method === 'GET') {
    if (route === '' || route === 'state') return {value: await agreements.state({asOf})};
    if (parts[0] === 'agreements' && parts.length === 2) return {value: await agreements.detail(parts[1], {asOf})};
    if (parts[0] === 'agreements' && parts.length === 3 && parts[2] === 'preview')
      return {value: await agreements.preview(parts[1], {periodId: search.get('periodId'), asOf})};
    if (parts[0] === 'agreements' && parts[2] === 'sources' && parts.length === 5)
      return {file: await agreements.sourceFile(parts[1], parts[3], parts[4])};
    if (parts[0] === 'agreements' && parts[2] === 'export' && parts.length === 3) {
      const format = search.get('format') || 'tar';
      need(['tar', 'json', 'csv', 'html'].includes(format), 'INVALID_AGREEMENT_EXPORT',
        'Choose TAR, JSON, CSV or printable HTML.');
      const result = await agreements.exportAgreement(parts[1], {asOf});
      if (format === 'tar') return {file: {name: 'service-agreement-' + parts[1] + '.tar',
        type: 'application/x-tar', bytes: renderCustomerTar(result.files)}};
      const filename = {json: 'agreement.json', csv: 'schedule.csv', html: 'agreement.html'}[format];
      return {file: result.files.find(file => file.name === filename)};
    }
  } else if (method === 'POST') {
    if (route === 'agreements') return {value: await agreements.create(value)};
    if (parts[0] === 'agreements' && parts.length === 3 &&
      ['amend', 'renew', 'cancel', 'bill'].includes(parts[2]))
      return {value: await agreements[parts[2]](parts[1], value)};
  } else need(false, 'METHOD_NOT_ALLOWED', 'Use a supported agreement operation.', 405);
  need(false, 'AGREEMENT_ROUTE_NOT_FOUND', 'This service-agreement operation is unavailable.', 404);
}
export async function createServiceAgreementsHandler(agreements, {port} = {}) {
  await agreements.init();
  const receivables = await createReceivablesHandler(agreements.receivables, {port,
    statements: agreements.receivables.statements});
  return async (request, response) => {
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1'); } catch { return false; }
    if (!(url.pathname === API || url.pathname.startsWith(API + '/') ||
      url.pathname === UI || url.pathname.startsWith(UI + '/') || url.pathname === '/')) {
      return receivables(request, response);
    }
    headers(response);
    try {
      local(request, port, request.method === 'POST');
      if (url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(302, {Location: UI + '/'}); response.end(); return true;
      }
      if (['GET', 'HEAD'].includes(request.method)) {
        const asset = await serviceAgreementAsset(url.pathname);
        if (asset) {
          response.writeHead(200, {'Content-Type': asset.type, 'Content-Length': asset.bytes.length});
          response.end(request.method === 'HEAD' ? undefined : asset.bytes); return true;
        }
      }
      const value = request.method === 'POST' ? await requestBody(request) : undefined;
      const result = await handleServiceAgreementRequest(agreements, {
        method: request.method === 'HEAD' ? 'GET' : request.method, path: url.pathname, query: url.searchParams, value});
      need(result, 'AGREEMENT_ROUTE_NOT_FOUND', 'This service-agreement page is unavailable.', 404);
      if (result.file) sendFile(response, result.file, request.method === 'HEAD');
      else sendJson(response, 200, result.value, request.method === 'HEAD');
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      sendJson(response, status, {error: {code: error.code ?? 'SERVICE_AGREEMENT_FAILED',
        message: status < 500 ? error.message : 'The workspace could not finish this operation. Keep the original request and reopen after recovery.',
        ...(error.details === undefined ? {} : {details: error.details}),
        ...(error.reopenRequired ? {reopenRequired: true} : {})}});
    }
    return true;
  };
}
export async function createServiceAgreementsServer({port = 8449, ...options}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_PORT', 'Choose an available local port.');
  const workspace = await openAccountingWorkspace(options);
  let server;
  try {
    const agreements = await new ServiceAgreementWorkspace(workspace).init();
    const handler = await createServiceAgreementsHandler(agreements, {port});
    server = createServer((request, response) => {
      handler(request, response).then(handled => {
        if (!handled && !response.writableEnded) sendJson(response, 404, {error: {code: 'NOT_FOUND', message: 'Choose a workspace page.'}});
      }).catch(error => {
        if (!response.headersSent) sendJson(response, 500, {error: {code: error.code ?? 'WORKSPACE_FAILED', message: 'Reopen the original workspace.'}});
        else response.destroy();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    let closing = false;
    return {server, workspace, agreements, url: 'http://127.0.0.1:' + server.address().port + UI + '/',
      async close() {
        if (closing) return; closing = true;
        await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
        await workspace.close();
      }};
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await workspace.close(); throw error;
  }
}
