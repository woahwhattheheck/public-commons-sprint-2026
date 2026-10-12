#!/usr/bin/env node
// MIT. Private Snowflake operator UI; original source/release modules own operations.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSnowflakeWorkspace } from './workspace.mjs';
import { createSnowflakeTransfers } from './transfer.mjs';
import { fault, fields, integer } from './declaration.mjs';

const STATIC = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const security = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
function reply(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { ...security, 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length });
  res.end(bytes);
}
async function bytes(req, maximum) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || BigInt(declared) > BigInt(maximum)))
    throw fault('SNOWFLAKE_REQUEST_TOO_LARGE', undefined, 413);
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    if ((total += chunk.length) > maximum) throw fault('SNOWFLAKE_REQUEST_TOO_LARGE', undefined, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''))
    throw fault('SNOWFLAKE_JSON_REQUIRED', undefined, 415);
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(req, 2097152))); }
  catch (error) { if (error.code) throw error; throw fault('SNOWFLAKE_JSON_INVALID'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw fault('SNOWFLAKE_JSON_OBJECT_REQUIRED');
  return result;
}
const pageOptions = url => {
  if ([...url.searchParams.keys()].some(key => !['offset', 'limit'].includes(key)))
    throw fault('SNOWFLAKE_QUERY_OPTION_INVALID');
  const number = (key, fallback) => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw fault('SNOWFLAKE_QUERY_OPTION_INVALID');
    return Number(value);
  };
  return { offset: integer(number('offset', 0), 0, Number.MAX_SAFE_INTEGER, 'offset'),
    pageSize: integer(number('limit', 50), 1, 200, 'limit') };
};
function sendOriginal(res, content, filename) {
  res.writeHead(200, { ...security, 'content-type': 'application/json',
    'content-disposition': 'attachment; filename="' + filename + '"', 'content-length': content.length });
  res.end(content);
}
export async function startSnowflakeWorkspace({ directory, port = 0, env = process.env, transport } = {}) {
  integer(port, 0, 65535, 'port');
  const workspace = await openSnowflakeWorkspace({ directory, env, transport });
  let transfers, assets;
  try {
    transfers = await createSnowflakeTransfers(workspace);
    assets = new Map(await Promise.all([...STATIC].map(async ([url, [name, type]]) =>
      [url, { type, bytes: await readFile(new URL('./public/' + name, import.meta.url)) }])));
  } catch (error) { await transfers?.close(); await workspace.close(); throw error; }
  const token = randomBytes(32).toString('hex'), instanceId = randomUUID(), sockets = new Set();
  let origin, closing = false, closePromise;
  const authorized = req => {
    const value = req.headers['x-snowflake-workspace'];
    return typeof value === 'string' && Buffer.byteLength(value) === token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token));
  };
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (closing) return reply(res, 503, { error: 'SNOWFLAKE_WORKSPACE_CLOSING' });
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') return reply(res, 403, { error: 'SNOWFLAKE_LOCAL_ORIGIN_REQUIRED' });
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw fault('SNOWFLAKE_REQUEST_TARGET_INVALID');
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && !url.search && assets.has(path)) {
        const file = assets.get(path);
        res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes.length });
        return res.end(file.bytes);
      }
      if (!authorized(req)) return reply(res, 403, { error: 'SNOWFLAKE_WORKSPACE_KEY_REQUIRED' });
      let match;
      if (req.method === 'GET') {
        if (path === '/api/state' && !url.search) return reply(res, 200, { ...await workspace.state(), instanceId });
        if ((match = /^\/api\/(sources|operations|editions|publications)$/.exec(path))) {
          const result = workspace.store.list(match[1], pageOptions(url));
          if (match[1] === 'editions') result.items = result.items.map(item => ({
            id: item.id, createdAt: item.createdAt, queryName: item.queryName, rowCount: item.rowCount,
            partitionCount: item.partitionCount, statementHandle: item.statementHandle }));
          if (match[1] === 'publications') result.items = result.items.map(item => ({
            id: item.id, createdAt: item.createdAt, editionId: item.editionId, status: item.status,
            releaseId: item.releaseId, releaseRoot: item.releaseRoot, lastError: item.lastError }));
          return reply(res, 200, result);
        }
        if ((match = /^\/api\/publications\/([0-9a-f-]+)$/.exec(path)) && !url.search) {
          const publication = workspace.store.getPublication(match[1]);
          if (!publication) throw fault('SNOWFLAKE_PUBLICATION_UNKNOWN', undefined, 404);
          return reply(res, 200, publication);
        }
        if ((match = /^\/api\/operations\/([0-9a-f-]+)$/.exec(path)) && !url.search)
          return reply(res, 200, workspace.store.operation(match[1]));
        if ((match = /^\/api\/operations\/([0-9a-f-]+)\/observations$/.exec(path)))
          return reply(res, 200, workspace.store.observations(match[1], pageOptions(url)));
        if ((match = /^\/api\/editions\/([0-9a-f]{64})$/.exec(path)) && !url.search) {
          const edition = workspace.store.edition(match[1]);
          return reply(res, 200, { ...edition, review: workspace.store.latestReview(edition.id) });
        }
        if ((match = /^\/api\/editions\/([0-9a-f]{64})\/rows$/.exec(path)))
          return reply(res, 200, await workspace.page(match[1], { offset: pageOptions(url).offset, limit: pageOptions(url).pageSize }));
        if ((match = /^\/api\/editions\/([0-9a-f]{64})\/partitions\/(0|[1-9][0-9]*)$/.exec(path)) && !url.search) {
          const part = workspace.store.edition(match[1]).partitions[Number(match[2])];
          if (!part) throw fault('SNOWFLAKE_PARTITION_UNKNOWN', undefined, 404);
          return sendOriginal(res, await workspace.store.readObject(part), 'partition-' + match[2].padStart(5, '0') + '.json');
        }
        if ((match = /^\/api\/transfers\/([0-9a-f]{64})$/.exec(path)) && !url.search)
          return reply(res, 200, await transfers.status(match[1]));
      }
      if (req.method === 'PUT' && !url.search &&
          (match = /^\/api\/transfers\/([0-9a-f]{64})\/partitions\/(0|[1-9][0-9]*)$/.exec(path))) {
        if (!/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type'] ?? ''))
          throw fault('SNOWFLAKE_ORIGINAL_BYTES_REQUIRED', undefined, 415);
        const index = Number(match[2]), part = await transfers.descriptor(match[1], index);
        return reply(res, 200, await transfers.put(match[1], index, await bytes(req, part.bytes)));
      }
      if (req.method === 'POST' && !url.search) {
        const input = await body(req);
        if (path === '/api/source') {
          fields(input, ['config', 'expectedRevision'], 'Source save');
          if (input.expectedRevision === undefined) throw fault('SNOWFLAKE_REVISION_REQUIRED');
          return reply(res, 200, workspace.saveSource(input.config, input.expectedRevision));
        }
        if (path === '/api/captures') {
          fields(input, ['sourceId', 'queryName', 'arguments', 'requestId'], 'Capture');
          if (!input.requestId) throw fault('SNOWFLAKE_REQUEST_ID_REQUIRED');
          return reply(res, 202, workspace.begin(input, { background: true }));
        }
        if ((match = /^\/api\/operations\/([0-9a-f-]+)\/(resume|cancel)$/.exec(path))) {
          fields(input, [], 'Operation action');
          if (match[2] === 'cancel') return reply(res, 200, await workspace.cancel(match[1]));
          workspace.continueOperation(match[1]);
          return reply(res, 202, workspace.store.operation(match[1]));
        }
        if (path === '/api/compare') {
          fields(input, ['beforeId', 'afterId', 'sampleLimit'], 'Edition comparison');
          return reply(res, 200, await workspace.compare(input.beforeId, input.afterId, { limit: input.sampleLimit ?? 50 }));
        }
        if ((match = /^\/api\/editions\/([0-9a-f]{64})\/review$/.exec(path))) {
          fields(input, ['decision', 'actor', 'note', 'comparisonId'], 'Edition review');
          return reply(res, 200, await workspace.review(match[1], input));
        }
        if (path === '/api/receive') {
          fields(input, ['manifestPath'], 'Original receiving');
          return reply(res, 201, await workspace.receive(input.manifestPath));
        }
        if (path === '/api/transfers') {
          fields(input, ['manifest'], 'Browser receiving');
          return reply(res, 201, await transfers.begin(input.manifest));
        }
        if ((match = /^\/api\/transfers\/([0-9a-f]{64})\/commit$/.exec(path))) {
          fields(input, [], 'Browser receiving commit');
          return reply(res, 201, await transfers.commit(match[1]));
        }
        if (path === '/api/export') {
          fields(input, ['editionId', 'destination', 'cloudDelivery'], 'Original export');
          return reply(res, 201, await workspace.exportOriginals(input.editionId, input.destination,
            { cloudDelivery: input.cloudDelivery }));
        }
        if (path === '/api/prepare') {
          fields(input, ['editionId', 'draft', 'publicationId', 'runtime', 'label'], 'Merchant preparation');
          if (!input.publicationId) throw fault('SNOWFLAKE_PUBLICATION_ID_REQUIRED');
          return reply(res, 201, await workspace.prepareMerchant(input));
        }
        if ((match = /^\/api\/publications\/([0-9a-f-]+)\/resume$/.exec(path))) {
          fields(input, [], 'Saved merchant continuation');
          return reply(res, 200, await workspace.resumeMerchant(match[1]));
        }
        if (path === '/api/release-console') {
          fields(input, ['port'], 'Release console');
          return reply(res, 200, await workspace.openReleaseConsole(input));
        }
      }
      return reply(res, 404, { error: 'SNOWFLAKE_ROUTE_NOT_FOUND' });
    }).catch(error => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) reply(res, error.status ?? (error.code === 'ENOENT' ? 404 : 503),
        { error: error.code ?? 'SNOWFLAKE_OPERATION_FAILED', detail: String(error.message).slice(0, 1000) });
      else res.end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 120000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  try { await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); }); }
  catch (error) { await transfers.close(); await workspace.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, workspace, transfers, instanceId, origin, url: origin + '/#' + token,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const ended = new Promise(done => server.close(done));
        for (const socket of sockets) socket.destroy();
        try { await transfers.close(); } finally { await workspace.close(); }
        await ended;
      })();
      return closePromise;
    } };
}
export async function main(args = process.argv.slice(2)) {
  const { main: cli } = await import('./cli.mjs');
  return cli(['serve', ...args]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error.code ?? 'SNOWFLAKE_WORKSPACE_FAILED', detail: error.message })); process.exitCode = 1; });
