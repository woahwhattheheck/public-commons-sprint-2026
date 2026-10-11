// MIT. Private local control surface for original seller releases.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { readReleaseState, compareReleases, activateRelease, rollbackRelease,
  releaseStatus, runActiveRelease } from './releases.mjs';
import { releaseCacheStatus, invalidateReleaseCache } from './release-cache.mjs';
import { releaseCatalogStatus, reviewReleaseCatalog, applyReleaseCatalog } from './release-catalog.mjs';
import { createReleaseDiscoveryConsole } from './release-discovery-console.mjs';
import { createReleaseClientConsole } from './release-client.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function body(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw failure('JSON body required.', 415);
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length; if (total > 32768) throw failure('Request exceeds 32 KiB.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { throw failure('Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('JSON object required.');
  return value;
}
export async function startReleaseConsole(root, { port = 8425, catalogConfig, discoverySetup, clientExportsDirectory, env = process.env } = {}) {
  root = resolve(root); await readReleaseState(root);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Console port must be 0–65535.');
  if (catalogConfig && discoverySetup !== undefined) throw new TypeError('Use either an existing catalog connection or a managed discovery setup.');
  const discovery = catalogConfig ? null : createReleaseDiscoveryConsole(root, { directory: discoverySetup ?? root + '.discovery' });
  const catalogConnection = () => catalogConfig ?? discovery?.catalogConfig;
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const environment = { ...env };
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/discovery.mjs', 'discovery.mjs', 'text/javascript; charset=utf-8'],
    ['/client.mjs', 'client.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { bytes: await readFile(new URL('./release-ui/' + file, import.meta.url)), type }])));
  let hosts = new Set(), origins = new Set(), url, managed = null, busy = false, stopping = false;
  let lastError = null, resolveClosed, rejectClosed, actionDone = Promise.resolve();
  let catalogReview = null;
  const clients = await createReleaseClientConsole(root, { directory: clientExportsDirectory, getManaged: () => managed });
  const closed = new Promise((done, fail) => { resolveClosed = done; rejectClosed = fail; });
  // Library callers may observe closed later; errors remain available there.
  closed.catch(() => {});
  const status = async () => ({ ...await releaseStatus(root),
    console: { managesRunningSeller: Boolean(managed), instanceId: managed?.observation.instanceId ?? null,
      operations: managed?.operations ?? null,
      catalogConfigured: Boolean(catalogConnection()), clientExports: clients.summary, busy, lastError } });
  const server = createServer(async (req, res) => {
    const reply = (code, type, data) => {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      res.writeHead(code, { 'content-type': type, 'content-length': String(bytes.length), 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const send = (code, value) => reply(code, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      // A local operator workspace may open this public landing document in a
      // new tab. Capability and origin checks still guard every private API.
      const landingNavigation = req.headers['sec-fetch-site'] === 'same-site' &&
        ['GET', 'HEAD'].includes(req.method) && req.url === '/' &&
        req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && !landingNavigation) throw failure('Use this local operator origin.', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw failure('Invalid request target.');
      const target = new URL(req.url, url);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(target.pathname) && !target.search) {
        const asset = assets.get(target.pathname); reply(200, asset.type, asset.bytes); return;
      }
      const supplied = Buffer.from(req.headers['x-release-token'] ?? '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) throw failure('Reopen the operator URL printed by the console command.', 401);
      if (req.method === 'GET' && target.pathname === '/api/status' && !target.search) { send(200, await status()); return; }
      if (req.method === 'GET' && target.pathname === '/api/clients') {
        if ([...target.searchParams.keys()].some(key => !['after', 'limit'].includes(key))) throw failure('Unknown customer listing parameter.');
        send(200, await clients.list({ ...(target.searchParams.has('after') ? { after: target.searchParams.get('after') } : {}),
          ...(target.searchParams.has('limit') ? { limit: Number(target.searchParams.get('limit')) } : {}) })); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/clients/inspect') {
        if ([...target.searchParams.keys()].some(key => key !== 'exportId')) throw failure('Unknown customer inspection parameter.');
        send(200, await clients.inspect({ exportId: target.searchParams.get('exportId') })); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/clients/download') {
        if ([...target.searchParams.keys()].some(key => !['exportId', 'expectedManifestSha256', 'file', 'expectedSha256'].includes(key)))
          throw failure('Unknown customer download parameter.');
        await clients.sendDownload(req, res, Object.fromEntries(target.searchParams)); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/cache' && !target.search) { send(200, await releaseCacheStatus(root)); return; }
      if (req.method === 'GET' && target.pathname === '/api/discovery' && !target.search) {
        send(200, discovery ? await discovery.status() : { enabled: false, state: 'EXTERNAL' }); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/discovery/enrollment' && !target.search) {
        if (!discovery) throw failure('This console uses an existing external catalog connection.', 409);
        send(200, await discovery.enrollment()); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/catalog') {
        if ([...target.searchParams.keys()].some(key => key !== 'id')) throw failure('Unknown catalog parameter.');
        const config = catalogConnection();
        if (!config) { send(200, { configured: false }); return; }
        send(200, { configured: true, ...await releaseCatalogStatus(root, { config,
          releaseId: target.searchParams.get('id') }) }); return;
      }
      if (req.method === 'GET' && target.pathname === '/api/diff') {
        if ([...target.searchParams.keys()].some(k => !['from', 'to'].includes(k))) throw failure('Unknown comparison parameter.');
        const state = await readReleaseState(root);
        send(200, { generation: state.generation, ...await compareReleases(root, target.searchParams.get('from') ?? state.active, target.searchParams.get('to')) }); return;
      }
      if (req.method !== 'POST' || !['/api/activate', '/api/rollback', '/api/run', '/api/stop', '/api/restart', '/api/cache/invalidate', '/api/catalog/review', '/api/catalog/apply',
        '/api/discovery/review', '/api/discovery/create', '/api/discovery/start', '/api/discovery/stop',
        '/api/clients/generate', '/api/clients/adopt'].includes(target.pathname) || target.search)
        throw failure('Unknown console action.', 404);
      if (!req.headers.origin || !origins.has(req.headers.origin)) throw failure('Same-origin operator action required.', 403);
      if (busy || stopping) throw failure('An operator action is already running. Refresh when it completes.', 409);
      const input = await body(req);
      if (busy || stopping) throw failure('An operator action is already running.', 409);
      busy = true;
      let finishAction;
      actionDone = new Promise(done => { finishAction = done; });
      try {
        lastError = null;
        if (target.pathname.startsWith('/api/clients/')) {
          const action = target.pathname.slice('/api/clients/'.length);
          send(200, await clients[action](input)); return;
        } else if (target.pathname.startsWith('/api/discovery/')) {
          if (!discovery) throw failure('This console uses an existing external catalog connection.', 409);
          const action = target.pathname.slice('/api/discovery/'.length);
          const allowed = { review: ['id', 'sellerId', 'sourceURL'], create: ['reviewId'], start: [], stop: ['instanceId'] }[action];
          if (Object.keys(input).some(key => !allowed.includes(key))) throw failure('Unknown discovery action field.');
          catalogReview = null;
          send(200, await discovery[action](action === 'review'
            ? { releaseId: input.id, sellerId: input.sellerId, sourceURL: input.sourceURL } : input)); return;
        } else if (target.pathname === '/api/catalog/review') {
          const config = catalogConnection();
          if (!config) throw failure('Start discovery in this console before reviewing publication.', 409);
          if (Object.keys(input).some(key => !['id', 'action', 'routeId', 'reason'].includes(key))) throw failure('Unknown catalog review field.');
          catalogReview = await reviewReleaseCatalog(root, { config, releaseId: input.id,
            action: input.action, routeId: input.routeId, reason: input.reason });
          send(200, catalogReview); return;
        } else if (target.pathname === '/api/catalog/apply') {
          const config = catalogConnection();
          if (!config || !catalogReview || Object.keys(input).some(key => key !== 'reviewId') || input.reviewId !== catalogReview.id)
            throw failure('Review the current catalog changes in this console first.', 409);
          const reviewed = catalogReview; catalogReview = null;
          send(200, await applyReleaseCatalog(root, { config, review: reviewed })); return;
        } else if (target.pathname === '/api/cache/invalidate') {
          if (!managed || input.instanceId !== managed.observation.instanceId)
            throw failure('This console does not own that running seller cache. Refresh.', 409);
          const invalidated = await invalidateReleaseCache(root, { instanceId: input.instanceId, routeId: input.routeId });
          busy = false; send(200, { ...await releaseCacheStatus(root), invalidatedRoutes: invalidated.invalidatedRoutes }); return;
        } else if (target.pathname === '/api/activate') {
          await activateRelease(root, input.id, { expectedGeneration: input.expectedGeneration, reason: input.reason });
        } else if (target.pathname === '/api/rollback') {
          await rollbackRelease(root, { to: input.to, expectedGeneration: input.expectedGeneration, reason: input.reason });
        } else {
          if (target.pathname === '/api/stop' || target.pathname === '/api/restart') {
            if (!managed || input.instanceId !== managed.observation.instanceId) throw failure('This console does not own that seller instance. Refresh.', 409);
            if (target.pathname === '/api/restart' && (await readReleaseState(root)).generation !== input.expectedGeneration)
              throw failure('Selected release changed. Refresh before restarting.', 409);
            const session = managed; await session.close();
            if (managed === session) managed = null;
          }
          if (target.pathname === '/api/run' || target.pathname === '/api/restart') {
            if (managed) throw failure('This console already owns a seller. Use Restart selected.', 409);
            if (!Number.isSafeInteger(input.expectedGeneration)) throw failure('Current selection generation required.');
            const session = await runActiveRelease(root, { expectedGeneration: input.expectedGeneration, operationsNavigationOrigin: url, env: environment }); managed = session;
            session.completion.then(() => { if (managed === session) managed = null; }, error => {
              lastError = error.message; if (managed === session) managed = null;
            });
          }
        }
        busy = false; send(200, await status());
      } catch (error) { busy = false; lastError = error.message; throw error; }
      finally { busy = false; finishAction(); }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (req.url?.startsWith('/api/clients') && ['EACCES', 'EPERM', 'ENOENT', 'EIO', 'ENOSPC', 'CLIENT_EXPORT_INCOMPLETE'].includes(error.code)) {
        send(error.code === 'ENOENT' ? 404 : error.code === 'CLIENT_EXPORT_INCOMPLETE' ? 409 : 500,
          { error: error.code, message: error.code === 'CLIENT_EXPORT_INCOMPLETE'
            ? 'The customer export stopped before completion. Inspect this export ID to recover its retained files.'
            : 'The original customer files could not be read or written (' + error.code + '). Check the configured export directory on this host.' }); return;
      }
      const code = error.status ?? (['RELEASE_CONFLICT', 'RELEASE_BUSY'].includes(error.code) ? 409 : 400);
      send(code, { error: error.code ?? 'OPERATOR_ERROR', message: error.message,
        ...(error.reviewId ? { reviewId: error.reviewId } : {}),
        ...(typeof error.commandSent === 'boolean' ? { commandSent: error.commandSent } : {}) });
    }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const assigned = server.address().port;
  hosts = new Set(['127.0.0.1:' + assigned, 'localhost:' + assigned]);
  origins = new Set([...hosts].map(host => 'http://' + host)); url = 'http://127.0.0.1:' + assigned;
  let closing;
  const close = () => {
    if (closing) return closing; stopping = true;
    closing = (async () => {
      try {
        await actionDone;
        try { if (managed) await managed.close(); }
        finally {
          try { try { await clients.close(); } finally { await discovery?.close(); } }
          finally {
            await new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.(); });
          }
        }
        resolveClosed();
      } catch (error) { rejectClosed(error); throw error; }
    })();
    return closing;
  };
  return { server, url, token, operatorUrl: url + '/#' + token, close, closed };
}
