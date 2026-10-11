// MIT. Private operator workspace; publish the separate ingress listener through TLS.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { FeedError, integer, requireId } from './model.mjs';
import { buildWebhookFeedService, prepareWebhookFeedRelease } from './merchant.mjs';
import { createSnapshot, listSnapshots, fileIdentity } from './snapshots.mjs';
import { readRequestBody, sendJson } from './receiver.mjs';

export async function startWebhookFeedWorkspace({ store, port = 8493 } = {}) {
  if (!store || !Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Store and valid port required');
  const token = randomBytes(32).toString('base64url'), key = Buffer.from('Bearer ' + token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { body: await readFile(new URL('./public/' + file, import.meta.url)), type }])));
  let origin;
  const authorized = request => {
    const candidate = Buffer.from(request.headers.authorization ?? '');
    return candidate.length === key.length && timingSafeEqual(candidate, key);
  };
  const server = createServer((request, response) => {
    (async () => {
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new FeedError('NOT_FOUND', 404);
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        response.writeHead(200, {
          'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        });
        return response.end(asset.body);
      }
      if (!authorized(request)) throw new FeedError('WORKSPACE_TOKEN_REQUIRED', 401);
      if (request.method === 'POST' && request.headers.origin !== origin) throw new FeedError('WORKSPACE_ORIGIN_REQUIRED', 403);
      const query = Object.fromEntries(url.searchParams);
      let body = {};
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new FeedError('JSON_REQUIRED', 415);
        try { body = JSON.parse((await readRequestBody(request, 1048576)).toString('utf8')); }
        catch (error) { if (error instanceof FeedError) throw error; throw new FeedError('INVALID_JSON', 422); }
      }
      let value;
      const route = request.method + ' ' + url.pathname;
      if (route === 'GET /api/status') value = { ...store.status(), merchant: store.merchantPlan(), snapshots: await listSnapshots(resolve(store.directory, 'snapshots')) };
      else if (route === 'GET /api/events') value = store.listEvents({
        after: integer(query.after, 'after', 0, Number.MAX_SAFE_INTEGER, 0),
        limit: integer(query.limit, 'limit', 1, 200, 50), ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      });
      else if (route === 'GET /api/event') value = store.inspectEvent(integer(query.sequence, 'sequence', 1, Number.MAX_SAFE_INTEGER));
      else if (route === 'GET /api/preview') value = store.readPage(query.feedId, { ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.limit ? { limit: query.limit } : {}) });
      else if (route === 'POST /api/source') value = store.saveDefinition('source', body.definition, body.expectedRevision ?? null);
      else if (route === 'POST /api/feed') value = store.saveDefinition('feed', body.definition, body.expectedRevision ?? null);
      else if (route === 'POST /api/plan') {
        buildWebhookFeedService({ store, plan: body.plan });
        value = store.saveMerchantPlan(body.plan, body.expectedRevision ?? null);
      } else if (route === 'POST /api/release') {
        const parent = resolve(store.directory, 'releases'); await mkdir(parent, { recursive: true, mode: 0o700 });
        const plan = store.merchantPlan().plan; if (!plan) throw new FeedError('SAVED_PLAN_REQUIRED', 422);
        value = await prepareWebhookFeedRelease({ store, plan, directory: resolve(parent, requireId(body.name)) });
        value.downloads = {};
        for (const file of ['seller-service.json', 'merchant-plan.json', 'handlers.mjs', 'release.json'])
          value.downloads[file] = await readFile(resolve(value.directory, file), 'utf8');
      } else if (route === 'POST /api/snapshot') {
        const parent = resolve(store.directory, 'snapshots'); await mkdir(parent, { recursive: true, mode: 0o700 });
        value = await createSnapshot({ store, directory: resolve(parent, requireId(body.name)) });
      } else if (route === 'POST /api/retention') value = store.purge(body.throughSequence, body.expectedHighWatermark);
      else if (route === 'GET /api/snapshot-file') {
        requireId(query.name);
        if (!['events.sqlite', 'snapshot.json'].includes(query.file)) throw new FeedError('NOT_FOUND', 404);
        const file = resolve(store.directory, 'snapshots', query.name, query.file), identity = await fileIdentity(file);
        response.writeHead(200, {
          'content-type': query.file.endsWith('.json') ? 'application/json' : 'application/vnd.sqlite3',
          'content-length': String(identity.bytes), 'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment; filename="' + query.name + '-' + query.file + '"',
        });
        const stream = createReadStream(file);
        stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return;
      } else throw new FeedError('NOT_FOUND', 404);
      sendJson(response, 200, value);
    })().catch(error => {
      request.resume(); const known = error instanceof FeedError;
      if (response.headersSent) return response.destroy();
      sendJson(response, known ? error.status : error.code === 'EEXIST' ? 409 : 500, {
        error: known ? error.code : error.code === 'EEXIST' ? 'NAME_ALREADY_EXISTS' : 'WORKSPACE_OPERATION_FAILED',
        ...(known ? error.details : {}),
      });
    });
  });
  server.headersTimeout = 10000; server.requestTimeout = 20000; server.keepAliveTimeout = 5000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  let closing;
  return { server, origin, url: origin + '/#token=' + token,
    close: () => closing ??= new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections(); }),
  };
}
