// MIT. Owner-local schema-to-paid-API workspace; never accepts connection secrets over HTTP.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogError, createMerchantCatalog } from './catalog.mjs';
import { compileMerchantPlan, parameterType, WorkspaceInputError } from './plan.mjs';
import { buildMerchantPackage, saveMerchantPackage, workspaceProfile } from './package.mjs';
import { createWorkspaceReleaseHandoff } from './release-handoff.mjs';

const ROOT = new URL('./public/', import.meta.url);
const FILES = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/postgres.mjs', ['../../../../sf82-seller-pilot/release-ui/postgres.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const safeError = error => error instanceof CatalogError || error instanceof WorkspaceInputError || /^(POSTGRES_|EXPORT_|EXPORTED_|RELEASE_|WORKSPACE_BUSY)/.test(error.code ?? '') ? error.code : 'WORKSPACE_UNAVAILABLE';
const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(text) }); res.end(text);
};
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new WorkspaceInputError('JSON_REQUIRED');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw new WorkspaceInputError('INPUT_TOO_LARGE'); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new WorkspaceInputError('INVALID_JSON'); }
}

export async function startMerchantWorkspace({ catalog, profile, outputRoot,
  port = 8428, releaseStore } = {}) {
  if (!catalog || typeof catalog.list !== 'function' || typeof catalog.inspect !== 'function') throw new TypeError('Original merchant catalog required');
  if (!profile?.source || typeof outputRoot !== 'string' || !outputRoot) throw new TypeError('Canonical source profile and export directory required');
  profile = structuredClone(profile);
  const credentialEnv = profile.source.connectionEnv ?? profile.source.connection?.passwordEnv ?? null;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be 0–65535');
  const files = new Map(await Promise.all([...FILES].map(async ([path, [filename, type]]) =>
    [path, { body: await readFile(new URL(filename, ROOT)), type }])));
  const handoff = await createWorkspaceReleaseHandoff({ outputRoot, releaseStore });
  const token = randomBytes(24).toString('hex');
  let origin, closing, releaseBusy = false, releaseAction = Promise.resolve();
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin)
        return json(res, 403, { error: 'LOCAL_WORKSPACE_ORIGIN_REQUIRED' });
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'INVALID_REQUEST_TARGET' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && files.has(url.pathname) && !url.search) {
        const file = files.get(url.pathname);
        res.writeHead(200, { 'content-type': file.type, 'content-length': file.body.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(file.body);
      }
      if (req.method === 'GET' && url.pathname === '/api/session')
        return json(res, 200, { token, credentialEnv, outputRoot: resolve(outputRoot), releases: { enabled: handoff.enabled, store: handoff.releaseStore } });
      if (req.method === 'GET' && url.pathname === '/api/catalog')
        return json(res, 200, await catalog.list(url.searchParams.get('schema') ?? ''));
      if (req.method === 'GET' && url.pathname === '/api/relation') {
        const relation = await catalog.inspect(url.searchParams.get('id'));
        return json(res, 200, { ...relation, columns: relation.columns.map(column => ({ ...column, filterType: parameterType(column) })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/releases/exports') {
        if ([...url.searchParams.keys()].some(key => !['after', 'limit'].includes(key)))
          return json(res, 422, { error: 'EXPORT_PAGE_INVALID' });
        return json(res, 200, await handoff.list({ after: url.searchParams.get('after') ?? '',
          limit: Number(url.searchParams.get('limit') ?? '50') }));
      }
      if (req.method === 'POST' && ['/api/releases/review', '/api/releases/stage', '/api/releases/console'].includes(url.pathname) && !url.search) {
        const supplied = req.headers['x-workspace-token'];
        if (req.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          return json(res, 403, { error: 'WORKSPACE_TOKEN_REQUIRED' });
        if (releaseBusy || closing) return json(res, 409, { error: 'WORKSPACE_BUSY', message: 'A release action is already in progress. Refresh its retained result before another action.' });
        const input = await readBody(req);
        if (releaseBusy || closing) return json(res, 409, { error: 'WORKSPACE_BUSY' });
        releaseBusy = true;
        releaseAction = (async () => {
          if (url.pathname === '/api/releases/stage') return handoff.stage(input);
          if (!input || Array.isArray(input) || Object.keys(input).some(key => !['exportId'].includes(key)))
            throw new WorkspaceInputError('INVALID_COMMAND_OPTIONS');
          return url.pathname === '/api/releases/review' ? handoff.review(input.exportId) : handoff.openConsole();
        })();
        try { return json(res, 200, await releaseAction); }
        finally { releaseBusy = false; }
      }
      if (req.method === 'POST' && ['/api/preview', '/api/export'].includes(url.pathname)) {
        const supplied = req.headers['x-workspace-token'];
        if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
          return json(res, 403, { error: 'WORKSPACE_TOKEN_REQUIRED' });
        const input = await readBody(req);
        const relation = await catalog.inspect(input?.relationId);
        const plan = compileMerchantPlan(relation, input);
        const bundle = await buildMerchantPackage(plan, { profile });
        if (url.pathname === '/api/preview') return json(res, 200, { planId: plan.planId,
          sql: plan.query.sql, source: bundle.source, seller: bundle.seller, columnMapping: plan.columnMapping,
          run: bundle.run, files: Object.keys(bundle.files) });
        if (input.expectedPlanId !== plan.planId) return json(res, 409, { error: 'PREVIEW_CURRENT_CHOICES_BEFORE_EXPORT' });
        const saved = await saveMerchantPackage(bundle, { outputRoot, queryName: plan.queryName, planId: plan.planId });
        const retained = await handoff.register(saved, bundle.seller.publicOrigin);
        return json(res, 201, { ...saved, exportId: retained.exportId, retained });
      }
      return json(res, 404, { error: 'WORKSPACE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      const code = safeError(error);
      const status = error.status ?? (code === 'SOURCE_SCHEMA_CHANGED' ? 409 : error instanceof WorkspaceInputError ? 422 : 503);
      if (!res.headersSent) json(res, status, { error: code, ...(code !== 'WORKSPACE_UNAVAILABLE' ? { message: error.message } : {}) }); else res.end();
    });
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, server, async close() {
    closing ??= new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); }).then(async () => {
      await releaseAction.catch(() => {});
      try { await handoff.close(); } finally { await catalog.close(); }
    });
    return closing;
  } };
}

export async function main(args = process.argv.slice(2)) {
  const usage = 'Usage: node postgres/workspace/server.mjs --source SOURCE_FILE --output /private/merchant-packages [--port 8428] [--release-store EXISTING_RELEASE_STORE]';
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); return null; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--source', '--port', '--release-store'].includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new WorkspaceInputError('INVALID_COMMAND_OPTIONS');
    options.set(args[i], args[i + 1]);
  }
  if (!options.has('--output') || !options.has('--source')) throw new WorkspaceInputError('SOURCE_AND_EXPORT_DIRECTORY_REQUIRED');
  const portText = options.get('--port') ?? '8428';
  if (!/^[0-9]{1,5}$/.test(portText)) throw new WorkspaceInputError('INVALID_PORT');
  const { readPostgresSourceFile, resolvePostgresConnection } = await import('../config.mjs');
  if (typeof resolvePostgresConnection !== 'function') throw new WorkspaceInputError('CANONICAL_CONNECTION_RESOLVER_REQUIRED');
  let declaration, connection;
  try {
    declaration = await readPostgresSourceFile(options.get('--source'));
    connection = await resolvePostgresConnection(declaration, process.env);
  } catch { throw new WorkspaceInputError('SOURCE_PROFILE_OR_CREDENTIALS_INVALID'); }
  const profile = workspaceProfile(declaration, connection);
  const catalog = await createMerchantCatalog({ connection });
  let session;
  try { session = await startMerchantWorkspace({ catalog, profile, outputRoot: options.get('--output'), port: Number(portText), releaseStore: options.get('--release-store') }); }
  catch (error) { await catalog.close(); throw error; }
  process.stdout.write(JSON.stringify({ workspace: session.url, outputRoot: resolve(options.get('--output')) }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; });
}
