// MIT. Loopback operator interface for retained OpenSearch merchant work.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenSearchWorkspace } from './service.mjs';
import { WorkspaceError } from './store.mjs';

const ASSETS = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
function download(res, value) {
  const body = Buffer.isBuffer(value.body) ? value.body : Buffer.from(value.body);
  res.writeHead(200, { 'content-type': value.type, 'content-length': body.length,
    'content-disposition': 'attachment; filename="' + value.filename.replaceAll('"', '') + '"',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new WorkspaceError('WORKSPACE_JSON_REQUIRED');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1048576) throw new WorkspaceError('WORKSPACE_REQUEST_TOO_LARGE', 'Request exceeds 1 MiB.', 413);
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Object required');
    return input;
  } catch { throw new WorkspaceError('WORKSPACE_INVALID_JSON'); }
}
export async function startOpenSearchWorkspace({ workspace, port = 8447 } = {}) {
  if (!workspace || typeof workspace.state !== 'function') throw new TypeError('Original OpenSearch workspace required.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Port must be 0–65535.');
  const assets = new Map(await Promise.all([...ASSETS].map(async ([route, [file, type]]) =>
    [route, { type, body: await readFile(new URL('./public/' + file, import.meta.url)) }])));
  const token = randomBytes(24).toString('hex');
  let origin, closing;
  const requests = new Set();
  const server = createServer((req, res) => {
    let operationId;
    const task = Promise.resolve().then(async () => {
      if (closing) return send(res, 503, { error: 'WORKSPACE_CLOSING' });
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin))
        return send(res, 403, { error: 'WORKSPACE_LOCAL_ORIGIN_REQUIRED' });
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return send(res, 400, { error: 'WORKSPACE_REQUEST_TARGET_INVALID' });
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && assets.has(path) && !url.search) {
        const value = assets.get(path);
        res.writeHead(200, { 'content-type': value.type, 'content-length': value.body.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(value.body);
      }
      if (req.method === 'GET') {
        if (path === '/api/session') return send(res, 200, { token, workspaceId: workspace.store.id });
        if (path === '/api/state') return send(res, 200, workspace.state());
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'api' && parts[1] === 'drafts' && parts.length === 3)
          return send(res, 200, workspace.draft(decodeURIComponent(parts[2])));
        if (parts[0] === 'api' && parts[1] === 'history' && parts.length === 3)
          return send(res, 200, { revisions: workspace.history(decodeURIComponent(parts[2])) });
        if (parts[0] === 'api' && parts[1] === 'operations' && parts.length === 3)
          return send(res, 200, workspace.operation(decodeURIComponent(parts[2])));
        if (parts[0] === 'api' && parts[1] === 'editions' && parts.length === 3)
          return send(res, 200, workspace.edition(decodeURIComponent(parts[2])));
        if (parts[0] === 'api' && parts[1] === 'editions' && parts.length === 4)
          return download(res, workspace.downloadEdition(decodeURIComponent(parts[2]), parts[3]));
        if (parts[0] === 'api' && parts[1] === 'packages' && parts.length === 3)
          return send(res, 200, workspace.package(decodeURIComponent(parts[2])));
        if (parts[0] === 'api' && parts[1] === 'packages' && parts.length === 4 && parts[3] === 'file')
          return download(res, await workspace.downloadPackage(decodeURIComponent(parts[2]), url.searchParams.get('name')));
        if (path === '/api/compare') {
          const comparison = workspace.compare(url.searchParams.get('before'), url.searchParams.get('after'));
          if (url.searchParams.get('download') === '1') return download(res, { type: 'application/json; charset=utf-8',
            filename: 'opensearch-comparison.json', body: JSON.stringify(comparison, null, 2) + '\n' });
          return send(res, 200, comparison);
        }
      }
      if (req.method === 'POST' && ['/api/drafts', '/api/validate', '/api/inspect', '/api/capture', '/api/prepare'].includes(path) && !url.search) {
        const supplied = req.headers['x-workspace-token'];
        if (req.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          return send(res, 403, { error: 'WORKSPACE_TOKEN_REQUIRED' });
        const input = await body(req);
        if (path !== '/api/validate') operationId = input.requestId;
        if (path === '/api/drafts') return send(res, 200, workspace.save(input));
        if (path === '/api/validate') return send(res, 200, workspace.validate(input.draftId, input.expectedRevision));
        const result = await workspace.run(path.slice('/api/'.length), input);
        return send(res, result.state === 'RUNNING' ? 202 : 200, result);
      }
      return send(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      const known = error instanceof WorkspaceError || /^OPENSEARCH_|^MERCHANT_|^QUERY_|^SELLER_/.test(error?.code ?? '');
      let requestRecorded;
      if (operationId !== undefined) {
        try { workspace.operation(operationId); requestRecorded = true; }
        catch (lookup) {
          if (['WORKSPACE_OPERATION_NOT_FOUND', 'WORKSPACE_INVALID_IDENTIFIER'].includes(lookup.code)) requestRecorded = false;
        }
      }
      if (!res.headersSent) send(res, error.status >= 400 && error.status <= 599 ? error.status : known ? 422 : 500,
        { error: known ? error.code : 'WORKSPACE_UNAVAILABLE', message: known ? error.message : 'The workspace could not complete this request.',
          ...(requestRecorded === undefined ? {} : { requestRecorded }) });
      else res.end();
    }).finally(() => requests.delete(task));
    requests.add(task);
  });
  server.requestTimeout = 180000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { url: origin, server, workspace, async close() {
    if (!closing) closing = (async () => {
      const stopped = new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); });
      await Promise.allSettled([...requests]); await stopped; await workspace.close();
    })();
    return closing;
  } };
}
export async function main(args = process.argv.slice(2)) {
  const usage = 'node opensearch/workspace/server.mjs --source SOURCE.json --workspace PRIVATE_DIRECTORY [--plan PLAN.json] [--port 8447]';
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); return null; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--workspace', '--plan', '--port'].includes(args[i]) || options.has(args[i]) || !args[i + 1])
      throw new WorkspaceError('WORKSPACE_ARGUMENTS_INVALID', usage);
    options.set(args[i], args[i + 1]);
  }
  if (!options.has('--source') || !options.has('--workspace')) throw new WorkspaceError('WORKSPACE_SOURCE_AND_DIRECTORY_REQUIRED', usage);
  const portText = options.get('--port') ?? '8447';
  if (!/^[0-9]{1,5}$/.test(portText)) throw new WorkspaceError('WORKSPACE_PORT_INVALID');
  const workspace = await createOpenSearchWorkspace({ sourceFile: options.get('--source'), planFile: options.get('--plan'),
    directory: options.get('--workspace') });
  let running;
  try { running = await startOpenSearchWorkspace({ workspace, port: Number(portText) }); }
  catch (error) { await workspace.close(); throw error; }
  process.stdout.write(JSON.stringify({ workspace: running.url, workspaceId: workspace.store.id }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => running.close().catch(() => { process.exitCode = 1; }));
  return running;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write((error.code ?? 'WORKSPACE_START_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });
