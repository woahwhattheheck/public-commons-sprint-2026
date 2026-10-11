// MIT. Loopback operator UI for the original SF98 destination coordinator.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openDestinationWorkspace } from './model.mjs';
import { codeOf, fault, exactKeys } from './storage.mjs';

const contentTypes = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const operationFields = {
  enroll: ['id', 'label', 'url', 'allowedHost', 'secretEnv', 'routeIds', 'networks', 'history'],
  pause: ['id', 'paused', 'expectedRevision'], sync: ['id'],
  drain: ['id', 'limit', 'concurrency', 'destinationConcurrency', 'timeoutMs'],
  start: ['limit', 'concurrency', 'destinationConcurrency', 'timeoutMs', 'pollMs'], stop: [],
  requeue: ['id', 'eventId', 'expectedRevision', 'expectedDeliveryRevision'],
};
const explanations = {
  SOURCE_JOURNAL_CONTINUITY_CHANGED: 'The source journal no longer matches its retained checkpoint. Reopen the original source and destination history before sending.',
  DESTINATION_JOURNAL_CONTINUITY_CHANGED: 'A previously copied original event is missing from this destination journal. Restore its complete original journal before sending.',
  DESTINATION_CHANGED_REFRESH: 'This destination changed in another operation. Refresh and use its current revision.',
  DESTINATION_SECRET_ENVIRONMENT_UNAVAILABLE: 'Set the destination’s signing environment variable in the process running delivery.',
  DESTINATION_ENDPOINT_ALREADY_ENROLLED: 'This exact endpoint already has an enrolled destination and its own delivery history.',
  SF98_DELIVERY_BUSY: 'The original delivery lease is currently owned by another operation. Its owner appears in the workspace.',
};

export async function startDestinationsServer({ port = 8478, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('INVALID_PORT');
  const model = await openDestinationWorkspace(options), token = randomBytes(32).toString('hex');
  const assets = new Map();
  for (const [path, file] of [['/', 'index.html'], ['/app.mjs', 'app.mjs'], ['/style.css', 'style.css']]) {
    const ext = file.slice(file.lastIndexOf('.'));
    assets.set(path, { bytes: await readFile(new URL('./public/' + file, import.meta.url)), type: contentTypes[ext] });
  }
  let hostnames = new Set(), origins = new Set(), closing = false, closePromise;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
  const readers = new Set(), operations = new Set();
  const server = createServer((req, res) => {
    const task = (async () => {
      const reply = (status, value, type = 'application/json; charset=utf-8', extra = {}) => {
        if (res.destroyed) return;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
        res.writeHead(status, { ...headers, 'content-type': type, 'content-length': String(bytes.length), ...extra });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      };
      try {
        if (closing) throw fault('WORKSPACE_CLOSING', 503);
        if (!hostnames.has(req.headers.host) || req.headers.origin && !origins.has(req.headers.origin) ||
            ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw fault('WORKSPACE_ORIGIN_REQUIRED', 403);
        const url = new URL(req.url, 'http://' + req.headers.host);
        if (req.method === 'GET' || req.method === 'HEAD') {
          const asset = assets.get(url.pathname);
          if (asset && !url.search) return reply(200, asset.bytes, asset.type);
          if (url.pathname === '/api/state' && !url.search) return reply(200, { ...await model.state(), session: token });
          if (url.pathname === '/api/handoff' && !url.search) return reply(200, await model.handoff(),
            'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="sf98-destinations-handoff.json"' });
          const match = /^\/api\/destinations\/([a-z][a-z0-9-]{0,47})\/events$/.exec(url.pathname);
          if (match) {
            if ([...url.searchParams.keys()].some(key => !['state', 'offset', 'limit'].includes(key))) throw fault('INVALID_EVENT_QUERY');
            return reply(200, await model.events({ id: match[1], state: url.searchParams.get('state') ?? 'ALL',
              offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50) }));
          }
          throw fault('NOT_FOUND', 404);
        }
        if (req.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' }, undefined, { allow: 'GET, HEAD, POST' });
        const action = /^\/api\/(enroll|pause|sync|drain|start|stop|requeue)$/.exec(url.pathname)?.[1];
        if (!action || url.search) throw fault('NOT_FOUND', 404);
        const supplied = Buffer.from(String(req.headers['x-sf98-session'] ?? '')), expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fault('WORKSPACE_SESSION_REQUIRED', 403);
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fault('JSON_REQUIRED', 415);
        const chunks = []; let length = 0;
        readers.add(req);
        try {
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 32768) throw fault('REQUEST_TOO_LARGE', 413);
            chunks.push(chunk);
          }
        } finally { readers.delete(req); }
        let input;
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw fault('INVALID_JSON'); }
        exactKeys(input, operationFields[action]);
        const method = action === 'pause' ? 'setPaused' : action;
        return reply(200, await model[method](input));
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        const code = codeOf(error), status = error.status ?? (code === 'SF98_DELIVERY_BUSY' ? 409 : code === 'ENOENT' ? 404 :
          error instanceof TypeError || error instanceof RangeError ? 400 : 500);
        reply(status, { code, message: explanations[code] ?? (status === 500 ?
          'The operation could not complete. Inspect the retained workspace and original journals.' : code.toLowerCase().replaceAll('_', ' ') + '.') });
      }
    })();
    operations.add(task); task.finally(() => operations.delete(task)).catch(() => {});
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); done(); }); });
    const selected = server.address().port, url = 'http://127.0.0.1:' + selected;
    hostnames = new Set(['127.0.0.1:' + selected, 'localhost:' + selected]);
    origins = new Set([url, 'http://localhost:' + selected]);
    return { model, server, url: url + '/', close() {
      return closePromise ??= (async () => {
        closing = true; for (const req of readers) req.destroy();
        const stopped = new Promise(done => server.close(done)); server.closeIdleConnections?.();
        await model.close(); await Promise.allSettled([...operations]);
        server.closeAllConnections?.(); await stopped;
      })();
    } };
  } catch (error) { server.close(); await model.close(); throw error; }
}
