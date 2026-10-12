// MIT. Composable Xero handover routes over one original accounting owner.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openAccountingWorkspace} from '../../workspace/store.mjs';
import {ReceivablesWorkspace} from '../store.mjs';
import {createReceivablesHttpHandler} from '../server.mjs';
import {renderCustomerTar} from '../core.mjs';
import {CustomerStatementWorkspace} from '../../customer-statements/store.mjs';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {XeroReceivablesWorkspace} from './store.mjs';

export const XERO_OPERATOR_REQUEST_BYTES = 32 * 1024 * 1024;
export const XERO_OPERATOR_TEMPLATE_BYTES = 256 * 1024;
export const XERO_OPERATOR_RETURN_BYTES = 8 * 1024 * 1024;
const STATIC = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function problem(code, message, status = 400, details) {
  return Object.assign(new Error(message), {code, status, details});
}
function basePath(value, fallback) {
  const path = String(value || fallback).replace(/\/+$/, '');
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('//') || path.split('/').includes('..')) {
    throw new TypeError('A local absolute route path is required.');
  }
  return path;
}
function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function json(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length});
  response.end(bytes);
}
function localRequest(request, configuredPort, mutation) {
  const raw = request.headers.host;
  if (typeof raw !== 'string' || raw.includes('@') || /[\s/#?]/.test(raw)) throw problem('INVALID_HOST', 'Use the local workspace address.', 403);
  let host;
  try { host = new URL('http://' + raw); } catch { throw problem('INVALID_HOST', 'Use the local workspace address.', 403); }
  const port = configuredPort || request.socket?.localPort;
  const effectivePort = host.port ? Number(host.port) : 80;
  if (!LOOPBACK.has(host.hostname.toLowerCase()) || (port && Number(port) !== effectivePort)) {
    throw problem('INVALID_HOST', 'Use the local workspace address and port.', 403);
  }
  if (request.headers.origin !== undefined) {
    let origin;
    try { origin = new URL(String(request.headers.origin)); } catch { throw problem('INVALID_ORIGIN', 'Open this request in the local workspace.', 403); }
    if (origin.protocol !== 'http:' || origin.host.toLowerCase() !== host.host.toLowerCase() || origin.username || origin.password) {
      throw problem('INVALID_ORIGIN', 'Open this request in the local workspace.', 403);
    }
  }
  if (mutation) {
    if (request.headers['x-workspace-request'] !== '1') throw problem('WORKSPACE_REQUEST_REQUIRED', 'Use the workspace client to save changes.', 403);
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw problem('JSON_REQUIRED', 'Send an application/json request.', 415);
    const encoding = request.headers['content-encoding'];
    if (encoding && encoding !== 'identity') throw problem('UNSUPPORTED_ENCODING', 'Send an uncompressed JSON request.', 415);
  }
  return host;
}
async function body(request, maximum = XERO_OPERATOR_REQUEST_BYTES) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > maximum)) {
    throw problem('REQUEST_TOO_LARGE', 'The request exceeds the workspace document limit.', 413);
  }
  const buffers = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw problem('REQUEST_TOO_LARGE', 'The request exceeds the workspace document limit.', 413);
    buffers.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { throw problem('INVALID_JSON', 'The request body must contain valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw problem('INVALID_JSON', 'The request must be a JSON object.');
  return value;
}
function identifier(raw) {
  let value;
  try { value = decodeURIComponent(raw); } catch { throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.'); }
  if (!value || value.length > 240 || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) throw problem('INVALID_IDENTIFIER', 'The record identifier is malformed.');
  return value;
}
function file(response, result, head = false) {
  if (!result || !result.bytes || typeof result.name !== 'string') throw problem('DOCUMENT_NOT_FOUND', 'The requested document is unavailable.', 404);
  const bytes = Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes);
  const filename = result.name.replace(/[\r\n"\\]/g, '_').split('/').pop();
  response.writeHead(200, {
    'Content-Type': result.type || 'application/octet-stream',
    'Content-Length': bytes.length,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
  });
  response.end(head ? undefined : bytes);
}
function publicError(error) {
  const code = String(error?.code || 'INTERNAL_ERROR');
  let status = Number(error?.status || error?.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    status = /NOT_FOUND|UNKNOWN_(INVOICE|CUSTOMER|RECEIPT|DOCUMENT|RUN|PACKAGE|PROFILE)/i.test(code) ? 404 :
      /CONFLICT|STALE|REVISION|VERSION|REQUEST_ID_REUSED|LEASE|ALREADY/i.test(code) ? 409 :
      code === 'INTERNAL_ERROR' ? 500 : 400;
  }
  return {status, value: {error: {code, message: status >= 500 ? 'The workspace could not finish this request. Keep the operation and retry after recovery.' : String(error?.message || code), ...(error?.details === undefined ? {} : {details: error.details})}}};
}


/** Static assets also compose into the original accounting HTTP runtime. */
export async function xeroReceivablesAsset(path, {
  apiPath = '/api/receivables/xero', uiPath = '/receivables/xero',
  receivablesApiPath = '/api/receivables', receivablesUiPath = '/receivables',
} = {}) {
  apiPath = basePath(apiPath, '/api/receivables/xero'); uiPath = basePath(uiPath, '/receivables/xero');
  receivablesApiPath = basePath(receivablesApiPath, '/api/receivables');
  receivablesUiPath = basePath(receivablesUiPath, '/receivables');
  if (path !== uiPath && !path.startsWith(uiPath + '/')) return null;
  const name = path === uiPath ? 'index.html' : path.slice(uiPath.length + 1) || 'index.html';
  if (name === 'config.json') return {bytes: Buffer.from(JSON.stringify({
    apiPath, uiPath, receivablesApiPath, receivablesUiPath,
    requestBytes: XERO_OPERATOR_REQUEST_BYTES,
    templateBytes: XERO_OPERATOR_TEMPLATE_BYTES, returnedFileBytes: XERO_OPERATOR_RETURN_BYTES,
  })), type: 'application/json; charset=utf-8'};
  const entry = STATIC.get('/receivables/xero/' + name);
  return entry ? {bytes: await readFile(entry.url), type: entry.type} : null;
}

/** The parent runtime retains its existing authorization and request boundary. */
export async function handleXeroReceivablesRequest(controller, {
  method, path, query = {}, value, apiPath = '/api/receivables/xero',
}) {
  apiPath = basePath(apiPath, '/api/receivables/xero');
  if (path !== apiPath && !path.startsWith(apiPath + '/')) return null;
  const parts = path.slice(apiPath.length).split('/').filter(Boolean).map(identifier);
  const route = parts.join('/');
  const search = query instanceof URLSearchParams ? query :
    new URLSearchParams(Object.entries(query).filter(([, item]) => item !== undefined && item !== null));
  let result;
  if (method === 'GET') {
    if (route === '' || route === 'state') result = await controller.state({asOf: search.get('asOf') || undefined});
    else if (parts[0] === 'packages' && parts.length === 2) result = await controller.detail(parts[1]);
    else if (parts[0] === 'packages' && parts[2] === 'files' && parts.length === 4) {
      const selected = await controller.file(parts[1], parts[3]); return {file: selected, type: selected.type};
    } else if (parts[0] === 'packages' && parts[2] === 'export' && parts.length === 3) {
      const bundle = await controller.export(parts[1]), name = search.get('name');
      if (name === 'handover.tar') {
        const selected = {name: 'xero-handover-' + parts[1] + '.tar', type: 'application/x-tar', bytes: renderCustomerTar(bundle.files)};
        return {file: selected, type: selected.type};
      }
      if (name) {
        const selected = bundle.files.find(item => item.name === name);
        if (!selected) throw problem('DOCUMENT_NOT_FOUND', 'Choose a file listed in this handover export.', 404);
        return {file: selected, type: selected.type};
      }
      result = bundle.value;
    } else throw problem('NOT_FOUND', 'This Xero handover route does not exist.', 404);
  } else if (method === 'POST') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw problem('INVALID_JSON', 'Send a JSON operator request.');
    if (route === 'profiles') result = await controller.saveProfile(value);
    else if (route === 'preview') result = await controller.preview(value);
    else if (route === 'packages') result = await controller.prepare(value);
    else if (parts[0] === 'packages' && parts.length === 3 && parts[2] === 'receive') result = await controller.receive(parts[1], value);
    else if (parts[0] === 'packages' && parts.length === 3 && parts[2] === 'correct') result = await controller.correct(parts[1], value);
    else throw problem('NOT_FOUND', 'This Xero handover operation does not exist.', 404);
  } else throw problem('METHOD_NOT_ALLOWED', 'Use a supported Xero handover operation.', 405);
  return {value: result};
}

/** No lease is acquired here: the supplied controller keeps its existing owner. */
export async function createXeroReceivablesHandler(controller, options = {}) {
  const apiPath = basePath(options.apiPath, '/api/receivables/xero');
  const uiPath = basePath(options.uiPath, '/receivables/xero');
  await controller.init();
  return async function xeroReceivablesHandler(request, response) {
    let url;
    try { url = new URL(request.url || '/', 'http://localhost'); } catch { return false; }
    const api = url.pathname === apiPath || url.pathname.startsWith(apiPath + '/');
    const ui = url.pathname === uiPath || url.pathname.startsWith(uiPath + '/');
    if (!api && !ui) return false;
    securityHeaders(response);
    try {
      const mutation = request.method === 'POST';
      localRequest(request, options.port, mutation);
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (url.pathname === uiPath) { response.writeHead(302, {Location: uiPath + '/'}); response.end(); return true; }
        const asset = ui ? await xeroReceivablesAsset(url.pathname, {...options, apiPath, uiPath}) : null;
        if (asset) {
          response.writeHead(200, {'Content-Type': asset.type, 'Content-Length': asset.bytes.length});
          response.end(request.method === 'HEAD' ? undefined : asset.bytes); return true;
        }
      }
      if (request.method !== 'GET' && request.method !== 'POST')
        throw problem('METHOD_NOT_ALLOWED', 'Use a supported Xero handover operation.', 405);
      const value = mutation ? await body(request, XERO_OPERATOR_REQUEST_BYTES) : undefined;
      const result = await handleXeroReceivablesRequest(controller, {
        method: request.method, path: url.pathname, query: url.searchParams, value, apiPath,
      });
      if (!result) throw problem('NOT_FOUND', 'This workspace route does not exist.', 404);
      if (result.file) file(response, result.file);
      else {
        const requestId = result.value?.operation?.id || value?.requestId;
        if (typeof requestId === 'string' && !/[\r\n]/.test(requestId)) response.setHeader('X-Request-Id', requestId);
        json(response, 200, result.value);
      }
    } catch (error) {
      if (response.headersSent) { response.end(); return true; }
      const failure = publicError(error);
      if (failure.status === 405) response.setHeader('Allow', ui ? 'GET, HEAD' : 'GET, POST');
      json(response, failure.status, failure.value);
    }
    return true;
  };
}
export async function createXeroReceivablesHttpHandler(workspace, options) {
  const receivables = await new ReceivablesWorkspace(workspace).init();
  return createXeroReceivablesHandler(new XeroReceivablesWorkspace(receivables), options);
}

/** Standalone service composes existing receivables routes behind the Xero routes. */
export async function prepareXeroReceivablesServer(options = {}) {
  const port = Number(options.port ?? 8449), host = String(options.host || '127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Use a valid local port.');
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new TypeError('The Xero handover workspace binds to loopback.');
  const apiPath = basePath(options.apiPath, '/api/receivables/xero'), uiPath = basePath(options.uiPath, '/receivables/xero');
  const receivablesApiPath = basePath(options.receivablesApiPath, '/api/receivables');
  const receivablesUiPath = basePath(options.receivablesUiPath, '/receivables');
  const ownsWorkspace = !options.workspace;
  const workspace = options.workspace || await openAccountingWorkspace({
    directory: resolve(options.directory || '.'),
    ...(options.expectedWorkspaceId ? {expectedWorkspaceId: options.expectedWorkspaceId} : {}),
    ...(options.expectedSourcesSha256 ? {expectedSourcesSha256: options.expectedSourcesSha256} : {}),
    ...(options.outboxDir ? {outboxDir: resolve(options.outboxDir)} : {}),
    ...(options.proofDir ? {proofDir: resolve(options.proofDir)} : {}),
    ...(options.termsFile ? {termsFile: resolve(options.termsFile)} : {}),
    ...(options.recoveredDir ? {recoveredDir: resolve(options.recoveredDir)} : {}),
  });
  let receivables, controller, statements, handler;
  try {
    receivables = await new ReceivablesWorkspace(workspace).init();
    controller = await new XeroReceivablesWorkspace(receivables).init();
    const xeroHandler = await createXeroReceivablesHandler(controller, {
      ...options, apiPath, uiPath, receivablesApiPath, receivablesUiPath, port: port || undefined,
    });
    let originalHandler;
    if (options.includeReceivables !== false) {
      if (options.includeCustomerStatements !== false) {
        statements = await new CustomerStatementWorkspace(workspace).init();
      }
      originalHandler = await createReceivablesHttpHandler(workspace, {
        ...options, apiPath: receivablesApiPath, uiPath: receivablesUiPath, statements, port: port || undefined,
      });
    }
    handler = async (request, response) =>
      await xeroHandler(request, response) || Boolean(originalHandler && await originalHandler(request, response));
  } catch (error) { if (ownsWorkspace) await workspace.close(); throw error; }
  const server = createServer(async (request, response) => {
    try {
      if (!(await handler(request, response))) {
        securityHeaders(response);
        json(response, 404, {error: {code: 'NOT_FOUND', message: 'Open the Xero handover desk at ' + uiPath + '/'}});
      }
    } catch {
      if (!response.headersSent) json(response, 500, {error: {code: 'INTERNAL_ERROR', message: 'The workspace request could not finish.'}});
      else response.end();
    }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    if (server.listening) await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    if (ownsWorkspace) await workspace.close();
  }
  return {server, workspace, receivables, controller, xero: controller, statements, handler, port, close,
    async listen() {
      await new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); accept(); });
      });
      return 'http://' + host + ':' + server.address().port + uiPath + '/';
    },
  };
}
export async function createXeroReceivablesServer(options = {}) {
  const service = await prepareXeroReceivablesServer(options);
  try { service.url = await service.listen(); return service; }
  catch (error) { await service.close(); throw error; }
}
export const startXeroReceivablesServer = createXeroReceivablesServer;
