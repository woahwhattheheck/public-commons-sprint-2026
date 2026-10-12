// MIT. Loopback operator interface for retained OpenSearch merchant work.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenSearchWorkspace } from './service.mjs';
import { WorkspaceError } from './store.mjs';

const ASSETS = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/deployment.mjs', ['deployment.mjs', 'text/javascript; charset=utf-8']],
  ['/catalog.mjs', ['catalog.mjs', 'text/javascript; charset=utf-8']],
  ['/file-sha256.mjs', ['file-sha256.mjs', 'text/javascript; charset=utf-8']],
  ['/relevance.mjs', ['../relevance/public.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
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
async function catalogDownload(res, value) {
  if (typeof value.body === 'string' || Buffer.isBuffer(value.body) || value.body instanceof Uint8Array)
    return download(res, { ...value, body: Buffer.from(value.body) });
  if (!value.body || (typeof value.body[Symbol.asyncIterator] !== 'function' && typeof value.body[Symbol.iterator] !== 'function'))
    throw new WorkspaceError('WORKSPACE_CATALOG_EXPORT_INVALID', 'The catalog export did not provide a byte stream.', 500);
  const filename = String(value.filename).replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.writeHead(200, { 'content-type': value.type,
    'content-disposition': 'attachment; filename="' + filename + '"',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const stalled = () => res.destroy(new WorkspaceError('WORKSPACE_CATALOG_DOWNLOAD_TIMEOUT',
    'The receiving client stopped consuming this catalog export.', 504));
  res.setTimeout(60000, stalled);
  try { await pipeline(Readable.from(value.body), res); }
  finally { res.setTimeout(0); res.removeListener('timeout', stalled); }
}
function catalogQuery(url, fields) {
  for (const key of url.searchParams.keys()) {
    if (!fields.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new WorkspaceError('WORKSPACE_CATALOG_ROUTE_INVALID', 'Use the declared catalog route and query fields.', 400);
  }
  const input = Object.fromEntries(url.searchParams);
  for (const key of ['offset', 'limit']) {
    if (input[key] !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(input[key]) || !Number.isSafeInteger(Number(input[key])))
        throw new WorkspaceError('WORKSPACE_CATALOG_PAGE_INVALID', 'Use a whole-number page offset and limit.', 400);
      input[key] = Number(input[key]);
      if (key === 'limit' && (input[key] < 1 || input[key] > 200))
        throw new WorkspaceError('WORKSPACE_CATALOG_PAGE_INVALID', 'Page limits must be between 1 and 200.', 400);
    }
  }
  return input;
}
function catalogMetadata(req) {
  const raw = req.headers['x-catalog-metadata'];
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 12288 || !raw.length)
    throw new WorkspaceError('WORKSPACE_CATALOG_METADATA_REQUIRED', 'Supply the catalog file metadata header, up to 12 KiB.', 400);
  let value;
  try { value = JSON.parse(raw); } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceError('WORKSPACE_CATALOG_METADATA_INVALID', 'Catalog upload metadata must be a JSON object.', 400);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1)
    throw new WorkspaceError('WORKSPACE_CATALOG_LENGTH_INVALID', 'Supply the exact nonzero file size.', 400);
  const declared = req.headers['content-length'];
  if (declared !== undefined && (typeof declared !== 'string' || !/^[0-9]+$/.test(declared) || Number(declared) !== value.bytes))
    throw new WorkspaceError('WORKSPACE_CATALOG_LENGTH_INVALID', 'The upload length differs from its selected file.', 400);
  return value;
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
    [route, { type, body: await readFile(new URL(file.startsWith('../') ? file : './public/' + file, import.meta.url)) }])));
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
        if (path === '/api/catalog/state') {
          catalogQuery(url, []);
          return send(res, 200, await workspace.catalog.state());
        }
        if (path.startsWith('/api/catalog/')) {
          const parts = path.slice('/api/catalog/'.length).split('/');
          if (parts.length === 2 && ['catalogs', 'sources', 'editions'].includes(parts[0])) {
            catalogQuery(url, []);
            let id;
            try { id = decodeURIComponent(parts[1]); } catch {
              throw new WorkspaceError('WORKSPACE_CATALOG_IDENTIFIER_INVALID', 'Use a valid catalog record identifier.', 400);
            }
            const method = { catalogs: 'catalog', sources: 'source', editions: 'edition' }[parts[0]];
            return send(res, 200, await workspace.catalog[method](id));
          }
          if (path === '/api/catalog/materials')
            return send(res, 200, await workspace.catalog.materials(catalogQuery(url, ['editionId', 'offset', 'limit', 'search'])));
          if (path === '/api/catalog/changes')
            return send(res, 200, await workspace.catalog.changes(catalogQuery(url, ['editionId', 'offset', 'limit'])));
          if (path === '/api/catalog/suggest')
            return send(res, 200, await workspace.catalog.suggest(catalogQuery(url, ['catalogId', 'text', 'customerId', 'offset', 'limit', 'category', 'manufacturer', 'unit'])));
          if (path === '/api/catalog/facets')
            return send(res, 200, await workspace.catalog.facets(catalogQuery(url, ['catalogId', 'editionId'])));
          if (path === '/api/catalog/quantity')
            return send(res, 200, await workspace.catalog.quantity(catalogQuery(url, ['catalogId', 'materialKey', 'expectedMaterialSha256', 'quantity', 'unit'])));
          if (path === '/api/catalog/decisions')
            return send(res, 200, await workspace.catalog.decisions(catalogQuery(url, ['catalogId', 'offset', 'limit'])));
          if (path === '/api/catalog/export') {
            const { catalogId, format, ...options } = catalogQuery(url, ['catalogId', 'format', 'editionId', 'index']);
            return catalogDownload(res, await workspace.catalog.export(catalogId, format, options));
          }
          throw new WorkspaceError('WORKSPACE_CATALOG_ROUTE_INVALID', 'Catalog route not found.', 404);
        }
        if (path.startsWith('/api/deployment/')) {
          const action = path.slice('/api/deployment/'.length);
          const allowed = { status: [], compare: ['from', 'to'], clients: ['after', 'limit'],
            client: ['exportId'], handover: ['releaseId'],
            'client-download': ['exportId', 'expectedManifestSha256', 'file', 'expectedSha256'] }[action];
          if (!allowed || [...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1))
            throw new WorkspaceError('WORKSPACE_DEPLOYMENT_ROUTE', 'Use the declared deployment route and query fields.', 400);
          const input = Object.fromEntries(url.searchParams);
          if (input.limit !== undefined) input.limit = Number(input.limit);
          if (action === 'status') return send(res, 200, await workspace.deployment.status());
          if (action === 'compare') return send(res, 200, await workspace.deployment.compare(input));
          if (action === 'clients') return send(res, 200, await workspace.deployment.clients(input));
          if (action === 'client') return send(res, 200, await workspace.deployment.client(input.exportId));
          if (action === 'handover') return download(res, await workspace.deployment.handover(input.releaseId));
          if (action === 'client-download') return workspace.deployment.downloadClient(req, res, input);
        }
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'api' && parts[1] === 'relevance') {
          if (parts[2] === 'sets' && parts.length === 4) {
            const revision = url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : undefined;
            return send(res, 200, workspace.relevance.set(decodeURIComponent(parts[3]), revision));
          }
          if (parts[2] === 'sets' && parts.length === 5 && parts[4] === 'set.json')
            return download(res, workspace.relevance.export(decodeURIComponent(parts[3]), 'set.json'));
          if (parts[2] === 'history' && parts.length === 4)
            return send(res, 200, { revisions: workspace.relevance.history(decodeURIComponent(parts[3])) });
          if (parts[2] === 'seed' && parts.length === 4)
            return send(res, 200, workspace.relevance.seed(decodeURIComponent(parts[3]), {
              caseId: url.searchParams.get('caseId') ?? 'case-1',
              limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100 }));
          if (parts[2] === 'editions' && parts.length === 4)
            return send(res, 200, workspace.relevance.edition(decodeURIComponent(parts[3])));
          if (parts[2] === 'editions' && parts.length === 5 && parts[4] !== 'set.json')
            return download(res, workspace.relevance.export(decodeURIComponent(parts[3]), parts[4]));
          if (path === '/api/relevance/compare') {
            const comparison = workspace.relevance.compare(url.searchParams.get('before'), url.searchParams.get('after'));
            if (url.searchParams.get('download') === '1') return download(res, { type: 'application/json; charset=utf-8',
              filename: 'opensearch-relevance-comparison.json', body: JSON.stringify(comparison, null, 2) + '\n' });
            return send(res, 200, comparison);
          }
        }
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
      if (req.method === 'POST' && ['/api/catalog/upload', '/api/catalog/import'].includes(path) && !url.search) {
        const supplied = req.headers['x-workspace-token'];
        if (req.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          return send(res, 403, { error: 'WORKSPACE_TOKEN_REQUIRED' });
        if (!/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type'] ?? ''))
          throw new WorkspaceError('WORKSPACE_CATALOG_BYTES_REQUIRED', 'Send the selected file as application/octet-stream.', 400);
        const metadata = catalogMetadata(req);
        operationId = metadata.requestId;
        const result = path === '/api/catalog/import' ? await workspace.catalog.importBundle(metadata, req)
          : await workspace.catalog.upload(metadata, req);
        return send(res, result.state === 'RUNNING' ? 202 : 200, result);
      }
      if (req.method === 'POST' && ['/api/catalog', '/api/catalog/suggest', '/api/drafts', '/api/validate', '/api/inspect', '/api/capture', '/api/prepare',
        '/api/relevance-save', '/api/relevance-run', '/api/relevance-promote', '/api/relevance/validate', '/api/relevance/normalize', '/api/deployment'].includes(path) && !url.search) {
        const supplied = req.headers['x-workspace-token'];
        if (req.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          return send(res, 403, { error: 'WORKSPACE_TOKEN_REQUIRED' });
        const input = await body(req);
        if (!['/api/validate', '/api/relevance/validate', '/api/relevance/normalize', '/api/catalog/suggest'].includes(path)) operationId = input.requestId;
        if (path === '/api/catalog/suggest') return send(res, 200, await workspace.catalog.suggest(input));
        if (path === '/api/catalog') {
          const { action, ...values } = input;
          const actions = { save: 'save', preview: 'preview', select: 'select', decision: 'saveDecision', 'create-draft': 'createDraft' };
          const method = Object.hasOwn(actions, action) ? actions[action] : null;
          if (!method) throw new WorkspaceError('WORKSPACE_CATALOG_ACTION_INVALID', 'Choose a declared catalog action.', 400);
          const result = await workspace.catalog[method](values);
          return send(res, result.state === 'RUNNING' ? 202 : 200, result);
        }
        if (path === '/api/drafts') return send(res, 200, workspace.save(input));
        if (path === '/api/validate') return send(res, 200, workspace.validate(input.draftId, input.expectedRevision));
        if (path === '/api/relevance/normalize') return send(res, 200, workspace.relevance.normalize(input.set));
        if (path === '/api/relevance-save') return send(res, 200, workspace.relevance.save(input));
        if (path === '/api/relevance-promote') return send(res, 200, workspace.relevance.promote(input));
        if (path === '/api/relevance/validate') return send(res, 200, workspace.relevance.validate(input.setId, input.expectedRevision));
        const result = path === '/api/deployment' ? await workspace.deployment.run(input)
          : path === '/api/relevance-run' ? await workspace.relevance.run(input) : await workspace.run(path.slice('/api/'.length), input);
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
