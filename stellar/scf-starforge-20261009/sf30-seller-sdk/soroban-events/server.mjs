import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openSorobanEventsWorkspace, inspectSorobanEventsWorkspace } from './engine.mjs';
import { SorobanEventsError, requireValue, integer } from './rpc.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const API_CODES = { NOT_FOUND: 404, REVISION_CONFLICT: 409, REQUEST_CONFLICT: 409, WORKSPACE_BUSY: 409, SOURCE_CONFLICT: 409, CAPTURE_INCOMPLETE: 409, CONNECTION_REQUIRED: 409, WORKSPACE_CLOSED: 503 };
function send(res, status, value, contentType = 'application/json; charset=utf-8', headers = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': contentType, 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, ...headers });
  res.end(bytes);
}
async function bodyJSON(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    requireValue(length <= 2 * 1024 * 1024, 'BODY_TOO_LARGE', 'Request is larger than the supported input');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SorobanEventsError('INVALID_JSON', 'Request must contain JSON'); }
}
function authenticated(req, token) {
  const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export async function startSorobanEventsServer(options = {}) {
  const host = options.host ?? '127.0.0.1', port = options.port ?? 0;
  requireValue(['127.0.0.1', '::1', 'localhost'].includes(host), 'INVALID_HOST', 'The operator workspace binds to a local host');
  integer(port, 'port', 0, 65535);
  const token = options.token ?? randomBytes(32).toString('base64url');
  requireValue(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token), 'INVALID_TOKEN', 'Use a private 32-byte base64url session token');
  if (options.expectedWorkspaceId) {
    const inspected = await inspectSorobanEventsWorkspace(options.directory, { allowMissing: true });
    requireValue(inspected.exists && inspected.workspaceId === options.expectedWorkspaceId, 'WORKSPACE_ID_MISMATCH', 'The selected directory is not the expected original workspace');
  }
  const workspace = options.workspace ?? await openSorobanEventsWorkspace(options);
  const ownedWorkspace = !options.workspace;
  const tasks = new Set();
  let origin;
  const server = createServer((req, res) => {
    const task = (async () => {
      const url = new URL(req.url, origin ?? 'http://127.0.0.1');
      if (req.headers.host !== new URL(origin).host) return send(res, 421, { error: { code: 'HOST_MISMATCH', message: 'Open this workspace at its original operator address' } });
      if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: { code: 'ORIGIN_MISMATCH', message: 'Use the original operator page' } });
      const asset = ASSETS.get(url.pathname);
      if (req.method === 'GET' && asset) {
        const bytes = await fs.readFile(new URL('./public/' + asset[0], import.meta.url));
        return send(res, 200, bytes, asset[1]);
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown workspace route' } });
      if (!authenticated(req, token)) return send(res, 401, { error: { code: 'AUTH_REQUIRED', message: 'Open the private workspace link or enter its session token' } });
      const args = Object.fromEntries(url.searchParams);
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') return send(res, 200, await workspace.describe());
        if (url.pathname === '/api/capture') return send(res, 200, await workspace.captureStatus({ captureId: args.captureId }));
        if (url.pathname === '/api/events') return send(res, 200, await workspace.eventPage({ captureId: args.captureId, after: args.after ?? null, limit: args.limit === undefined ? 100 : Number(args.limit), contractId: args.contractId || null, type: args.type || null }));
        if (url.pathname === '/api/edition') return send(res, 200, await workspace.edition({ editionId: args.editionId }));
        if (url.pathname === '/api/publisher-source') return send(res, 200, await workspace.publisherSource({ editionId: args.editionId }));
        if (url.pathname === '/api/source-file') {
          const result = await workspace.sourceFile({ exportId: args.exportId, path: args.path });
          return send(res, 200, result.content, result.contentType,
            { 'content-disposition': 'attachment; filename="' + args.path.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g, '_') + '"' });
        }
      }
      if (req.method === 'POST') {
        requireValue((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json', 'CONTENT_TYPE', 'Use application/json for workspace changes');
        const methods = new Map([
          ['/api/plan', 'planSave'], ['/api/capture/start', 'captureStart'], ['/api/capture/resume', 'captureResume'],
          ['/api/edition', 'editionCreate'], ['/api/export', 'sourceExport'], ['/api/receive', 'sourceReceive'],
        ]);
        const method = methods.get(url.pathname);
        if (method) return send(res, 200, await workspace[method](await bodyJSON(req)));
      }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown workspace route' } });
    })();
    tasks.add(task);
    task.catch((error) => {
      if (!res.headersSent) send(res, API_CODES[error.code] ?? (error instanceof SorobanEventsError ? 400 : 500),
        { error: { code: error.code ?? 'WORKSPACE_ERROR', message: error instanceof SorobanEventsError ? error.message : 'The workspace operation failed', details: error.details ?? {} } });
      else res.destroy();
    }).finally(() => tasks.delete(task));
  });
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
  } catch (error) { if (ownedWorkspace) await workspace.close(); throw error; }
  const address = server.address();
  const hostname = host === '::1' ? '[::1]' : host;
  origin = 'http://' + hostname + ':' + address.port;
  let closing;
  return { workspace, origin, url: origin + '/#token=' + encodeURIComponent(token), token, address,
    close() {
      if (!closing) closing = (async () => {
        const stopped = new Promise((accept) => server.close(accept));
        server.closeIdleConnections?.();
        await Promise.allSettled([...tasks]);
        await stopped;
        if (ownedWorkspace) await workspace.close();
      })();
      return closing;
    } };
}
export const startSorobanEventsWorkspaceServer = startSorobanEventsServer;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  import('./cli.mjs').then(({ runSorobanEventsCLI }) => runSorobanEventsCLI(['open', ...process.argv.slice(2)])).catch((error) => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'WORKSPACE_ERROR', message: error.message, details: error.details ?? {} } }) + '\n');
    process.exitCode = 1;
  });
}
