import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {openSamWorkspace} from './workspace.mjs';
import {exportSamWorkspace} from './reports.mjs';
import {serveSamMerchant} from './merchant.mjs';

const WEB = new URL('./web/', import.meta.url);
const STATIC = new Map([
  ['/', {url: new URL('index.html', WEB), type: 'text/html; charset=utf-8'}],
  ['/index.html', {url: new URL('index.html', WEB), type: 'text/html; charset=utf-8'}],
  ['/app.js', {url: new URL('app.js', WEB), type: 'text/javascript; charset=utf-8'}],
  ['/style.css', {url: new URL('style.css', WEB), type: 'text/css; charset=utf-8'}],
  ['/guide', {url: new URL('./README.md', import.meta.url), type: 'text/plain; charset=utf-8'}],
]);
const READ_ACTIONS = new Set(['view', 'get', 'notice', 'read_source', 'compare']);
const CONTROL_LIMIT = 2 * 1024 * 1024;
const DATA_LIMIT = 512 * 1024 * 1024;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), {code, status});
}
function safeError(error) {
  const message = String(error?.message || 'The request could not be completed.')
    .replace(/([?&](?:api_key|apikey|access_token|token)=)[^&\s"'<>]+/gi, '$1[redacted]');
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status : Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode : 500;
  return {status, error: {code: String(error?.code || 'WORKSPACE_REQUEST_FAILED'), message}};
}
function send(res, status, body, mediaType = 'application/json; charset=utf-8', extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.isBuffer(body) ? body
    : Buffer.from(mediaType.startsWith('application/json') ? JSON.stringify(body) : String(body));
  res.writeHead(status, {
    'Content-Type': mediaType, 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP, ...extra,
  });
  res.end(bytes);
}
async function readJson(req, limit) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw fail('JSON_REQUIRED', 'Send an application/json request.', 415);
  const advertised = req.headers['content-length'];
  if (advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > limit))
    throw fail('REQUEST_TOO_LARGE', 'The request exceeds the supported input size.', 413);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw fail('REQUEST_TOO_LARGE', 'The request exceeds the supported input size.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('JSON_INVALID', 'The request contains invalid JSON.'); }
  if (!object(value)) throw fail('JSON_OBJECT_REQUIRED', 'The request body must be a JSON object.');
  return value;
}
function exactToken(value, expected) {
  const left = Buffer.from(String(value || '')), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function recordId(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw fail('RECORD_ID_INVALID', 'Invalid record ID.'); }
  if (!decoded || decoded.length > 240 || /[/\\\u0000-\u001f]/.test(decoded))
    throw fail('RECORD_ID_INVALID', 'Invalid record ID.');
  return decoded;
}
function integer(value, fallback, {minimum = 0, maximum = 1000000} = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw fail('PAGING_INVALID', 'Use whole numbers for paging.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    throw fail('PAGING_INVALID', 'The requested page is outside the supported range.');
  return number;
}
function attachmentName(name) {
  return String(name || 'sam-opportunity-export').replace(/[\r\n"\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180);
}
function checkedPort(value) {
  const port = Number(value ?? 0);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw fail('PORT_INVALID', 'Port must be between 0 and 65535.');
  return port;
}
function packTask(task) {
  return {captureId: task.captureId, state: task.state, startedAt: task.startedAt,
    updatedAt: task.updatedAt, completedAt: task.completedAt || null,
    progress: task.progress || null, result: task.result || null, error: task.error || null};
}

/** Start the original SAM workspace as a private loopback operator. */
export async function startSamWorkspace({
  directory, operator = 'SAM opportunity operator', apiKeyEnv = 'SAM_GOV_API_KEY',
  endpoint, opportunityDirectory, port = 0, store: suppliedStore,
} = {}) {
  if (typeof directory !== 'string' || !directory.trim())
    throw fail('WORKSPACE_DIRECTORY_REQUIRED', 'Provide the workspace directory.');
  if (typeof operator !== 'string' || !operator.trim() || operator.length > 240)
    throw fail('OPERATOR_REQUIRED', 'Provide an operator name of 1–240 characters.');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv))
    throw fail('API_KEY_ENV_INVALID', 'Provide the existing SAM API key environment variable name.');
  const workspaceDirectory = resolve(directory), selectedPort = checkedPort(port);
  const store = suppliedStore || await openSamWorkspace({
    directory: workspaceDirectory, operator, apiKeyEnv,
    ...(endpoint ? {endpoint} : {}), ...(opportunityDirectory ? {opportunityDirectory: resolve(opportunityDirectory)} : {}),
  });
  const ownsStore = !suppliedStore;
  const token = randomBytes(32).toString('hex'), tasks = new Map(), requests = new Set(), merchantHosts = new Map();
  let origin, host, closing = false, closePromise;

  function startCapture(captureId) {
    if (closing) throw fail('SERVER_CLOSING', 'The workspace is closing.', 503);
    const existing = tasks.get(captureId);
    if (existing?.state === 'running') return existing;
    const now = new Date().toISOString();
    const task = {captureId, state: 'running', startedAt: now, updatedAt: now, progress: null};
    tasks.set(captureId, task);
    task.promise = Promise.resolve().then(() => store.runCapture(captureId, {
      onProgress: progress => { task.progress = progress; task.updatedAt = new Date().toISOString(); },
    })).then(result => {
      task.state = 'completed'; task.result = result?.result ?? result;
      task.completedAt = task.updatedAt = new Date().toISOString();
      return result;
    }, error => {
      task.state = 'failed'; task.error = safeError(error).error;
      task.completedAt = task.updatedAt = new Date().toISOString();
      return null;
    });
    return task;
  }


  function packMerchant(entry) {
    return {publicationId: entry.publicationId, state: entry.state, origin: entry.origin || null,
      startedAt: entry.startedAt, updatedAt: entry.updatedAt, closedAt: entry.closedAt || null,
      error: entry.error || null};
  }
  async function startMerchant(publicationId, port) {
    if (closing) throw fail('SERVER_CLOSING', 'The workspace is closing.', 503);
    const existing = merchantHosts.get(publicationId);
    if (existing && ['starting', 'running'].includes(existing.state)) {
      await existing.promise; return existing;
    }
    const now = new Date().toISOString();
    const entry = {publicationId, state: 'starting', startedAt: now, updatedAt: now, stopRequested: false};
    merchantHosts.set(publicationId, entry);
    entry.promise = (async () => {
      const found = await store.get(publicationId, {offset: 0, limit: 1});
      if (found.kind !== 'publication' || found.record?.kind !== 'merchant' ||
          found.record.directory !== 'merchant/' + publicationId)
        throw fail('MERCHANT_PUBLICATION_REQUIRED', 'Choose a retained merchant preparation.');
      if (closing || entry.stopRequested) throw fail('MERCHANT_START_CANCELLED', 'The seller start was cancelled.', 409);
      entry.service = await serveSamMerchant(join(workspaceDirectory, 'merchant', publicationId), {port});
      const address = entry.service.server.address();
      if (!address || typeof address === 'string' || !['127.0.0.1', '::1'].includes(address.address))
        throw fail('MERCHANT_ADDRESS_INVALID', 'The prepared seller did not bind a loopback address.');
      entry.origin = 'http://' + (address.address === '::1' ? '[::1]' : '127.0.0.1') + ':' + address.port;
      if (closing || entry.stopRequested) throw fail('MERCHANT_START_CANCELLED', 'The seller start was cancelled.', 409);
      entry.state = 'running'; entry.updatedAt = new Date().toISOString();
      return entry;
    })().catch(async error => {
      if (entry.service) await entry.service.close().catch(() => {});
      entry.service = null; entry.state = 'failed'; entry.error = safeError(error).error;
      entry.updatedAt = new Date().toISOString();
      throw error;
    });
    return entry.promise;
  }
  async function closeMerchant(publicationId) {
    const entry = merchantHosts.get(publicationId);
    if (!entry) return {publicationId, state: 'not_running', origin: null};
    entry.stopRequested = true;
    await entry.promise.catch(() => {});
    if (entry.closePromise) { await entry.closePromise; return packMerchant(entry); }
    entry.closePromise = (async () => {
      if (entry.service) await entry.service.close();
      entry.service = null; entry.state = 'closed'; entry.error = null;
      entry.closedAt = entry.updatedAt = new Date().toISOString();
    })();
    await entry.closePromise;
    return packMerchant(entry);
  }

  async function handle(req, res) {
    if (req.headers.host !== host) throw fail('HOST_REJECTED', 'Use the private loopback workspace address.', 403);
    if (req.headers.origin && req.headers.origin !== origin)
      throw fail('ORIGIN_REJECTED', 'Open this action from the workspace origin.', 403);
    const url = new URL(req.url, origin);
    if (url.origin !== origin) throw fail('ORIGIN_REJECTED', 'The request origin is invalid.', 403);
    const method = req.method || 'GET';
    if (url.pathname.startsWith('/api/')) {
      if (!exactToken(req.headers.authorization, 'Bearer ' + token))
        throw fail('AUTHENTICATION_REQUIRED', 'Open the private workspace link to authenticate this tab.', 401);
      if (closing) throw fail('SERVER_CLOSING', 'The workspace is closing.', 503);
      if (method === 'GET' && url.pathname === '/api/workspace')
        return send(res, 200, {workspace: await store.list(), operator,
          date: new Date().toISOString(), source: 'SAM.gov',
          opportunityConfigured: Boolean(opportunityDirectory),
          tasks: [...tasks.values()].map(packTask), merchantHosts: [...merchantHosts.values()].map(packMerchant)});
      if (method === 'GET' && url.pathname === '/api/capture-runs')
        return send(res, 200, {tasks: [...tasks.values()].map(packTask)});
      if (method === 'GET' && url.pathname === '/api/merchant-hosts')
        return send(res, 200, {merchantHosts: [...merchantHosts.values()].map(packMerchant)});
      const merchant = /^\/api\/publications\/([^/]+)\/(serve|close)$/.exec(url.pathname);
      if (method === 'POST' && merchant) {
        const body = await readJson(req, CONTROL_LIMIT), publicationId = recordId(merchant[1]);
        if (Object.keys(body).some(key => key !== 'port'))
          throw fail('MERCHANT_OPTIONS_INVALID', 'The local seller control accepts only an optional port.');
        if (merchant[2] === 'close') return send(res, 200, await closeMerchant(publicationId));
        const entry = await startMerchant(publicationId, checkedPort(body.port));
        return send(res, 200, packMerchant(entry));
      }
      const record = /^\/api\/records\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && record) return send(res, 200, await store.get(recordId(record[1]), {
        offset: integer(url.searchParams.get('offset'), 0),
        limit: integer(url.searchParams.get('limit'), 50, {minimum: 1, maximum: 1000}),
        search: (url.searchParams.get('search') || '').slice(0, 1000),
      }));
      const source = /^\/api\/sources\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && source) {
        const result = await store.readSource(recordId(source[1]));
        if (url.searchParams.get('download') === '1')
          return send(res, 200, Buffer.from(result.contentBase64, 'base64'), 'application/octet-stream', {
            'Content-Disposition': 'attachment; filename="' + attachmentName(result.filename) + '"',
          });
        return send(res, 200, result);
      }
      const run = /^\/api\/captures\/([^/]+)\/run$/.exec(url.pathname);
      if (run && method === 'POST') {
        await readJson(req, CONTROL_LIMIT);
        const captureId = recordId(run[1]);
        const found = await store.get(captureId, {offset: 0, limit: 1});
        if (found.kind !== 'capture') throw fail('CAPTURE_REQUIRED', 'Choose a retained capture.');
        const task = startCapture(captureId);
        return send(res, 202, packTask(task));
      }
      if (run && method === 'GET') {
        const captureId = recordId(run[1]), task = tasks.get(captureId);
        if (task) return send(res, 200, packTask(task));
        return send(res, 200, {captureId, state: 'not_running', retained: await store.get(captureId, {offset: 0, limit: 1})});
      }
      const cancel = /^\/api\/captures\/([^/]+)\/cancel$/.exec(url.pathname);
      if (method === 'POST' && cancel) {
        await readJson(req, CONTROL_LIMIT);
        const captureId = recordId(cancel[1]);
        const result = await store.cancelCapture(captureId);
        return send(res, 200, {captureId, result: result ?? null});
      }
      if (method === 'POST' && url.pathname === '/api/read') {
        const body = await readJson(req, CONTROL_LIMIT);
        if (!READ_ACTIONS.has(body.action) || !object(body.payload ?? {}))
          throw fail('READ_ACTION_INVALID', 'Choose a supported read operation.');
        return send(res, 200, await store.dispatch(body.action, body.payload ?? {}));
      }
      if (method === 'POST' && url.pathname === '/api/dispatch') {
        const body = await readJson(req, DATA_LIMIT);
        if (typeof body.action !== 'string' || !object(body.payload))
          throw fail('ACTION_INVALID', 'Provide an action and its object payload.');
        if (READ_ACTIONS.has(body.action)) return send(res, 200, await store.dispatch(body.action, body.payload));
        if (body.action === 'run_capture' || body.action === 'cancel_capture')
          throw fail('CAPTURE_ROUTE_REQUIRED', 'Use the capture run controls for acquisition.');
        return send(res, 200, await store.dispatch(body.action, body.payload));
      }
      if (method === 'POST' && url.pathname === '/api/receive') {
        const body = await readJson(req, DATA_LIMIT);
        if (!object(body.packet)) throw fail('PACKET_REQUIRED', 'Provide the complete portable workspace packet.');
        return send(res, 200, {workspace: await store.importPacket(body.packet)});
      }
      if (method === 'GET' && url.pathname === '/api/export') {
        const format = url.searchParams.get('format') || 'portable';
        const options = {format};
        for (const key of ['selectionId', 'handoffId'])
          if (url.searchParams.has(key)) options[key] = recordId(url.searchParams.get(key));
        if (url.searchParams.has('revision'))
          options.revision = integer(url.searchParams.get('revision'), undefined, {minimum: 1, maximum: 100000000});
        if (options.selectionId && options.handoffId)
          throw fail('EXPORT_SELECTION_CONFLICT', 'Choose a selection or a named handoff.');
        const result = await exportSamWorkspace(store, options);
        return send(res, 200, result.bytes, result.mediaType, {
          'Content-Disposition': 'attachment; filename="' + attachmentName(result.filename) + '"',
        });
      }
      throw fail('API_ROUTE_NOT_FOUND', 'This workspace route does not exist.', 404);
    }
    if (method !== 'GET' && method !== 'HEAD') throw fail('METHOD_REJECTED', 'This resource supports GET and HEAD.', 405);
    const item = STATIC.get(url.pathname);
    if (!item) throw fail('RESOURCE_NOT_FOUND', 'This workspace resource does not exist.', 404);
    const bytes = await readFile(item.url);
    if (method === 'HEAD') {
      res.writeHead(200, {'Content-Type': item.type, 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP}); res.end(); return;
    }
    send(res, 200, bytes, item.type);
  }

  const server = createServer((req, res) => {
    const work = handle(req, res).catch(error => {
      const safe = safeError(error);
      send(res, safe.status, {error: safe.error});
    });
    requests.add(work); void work.finally(() => requests.delete(work)).catch(() => {});
  });
  server.requestTimeout = 120000; server.headersTimeout = 20000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 60;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(selectedPort, '127.0.0.1', () => { server.off('error', reject); accept(); });
    });
    const address = server.address(); host = '127.0.0.1:' + address.port; origin = 'http://' + host;
  } catch (error) {
    if (ownsStore) await store.close();
    throw error;
  }

  async function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const stopped = new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
      for (const task of tasks.values()) if (task.state === 'running') await store.cancelCapture(task.captureId);
      await Promise.allSettled([...tasks.values()].map(task => task.promise));
      await Promise.allSettled([...requests]);
      const merchantResults = await Promise.allSettled([...merchantHosts.keys()].map(closeMerchant));
      server.closeIdleConnections?.();
      if (ownsStore) await store.close();
      await stopped;
      const merchantFailure = merchantResults.find(result => result.status === 'rejected');
      if (merchantFailure) throw merchantFailure.reason;
    })();
    return closePromise;
  }
  return {directory: workspaceDirectory, operator, origin, url: origin + '/#token=' + token,
    server, store, close};
}
