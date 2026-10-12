// MIT. Private provider accounting and token buyer preparation beside original ops.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { readFile, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';
import { privateDirectory, syncDirectory } from './accounting.mjs';
import { prepareTokenBuyer, planSha, error, plain } from './product.mjs';
import { connectionSummary } from './connection.mjs';
import { reviewConnection, retainConnectionPackage, readRetainedConnection, listRetainedConnections } from './connection-setup.mjs';

const HOST = '127.0.0.1';
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
const LIMIT = 65536;
const TOKEN_HEADER = 'x-blockscout-operator-token';

export async function startBlockscoutDesk({ application, seller, operations, directory, port = 8425 }) {
  const token = randomBytes(32).toString('hex'), expected = Buffer.from(token);
  const exportsDirectory = join(directory, 'exports'); await privateDirectory(exportsDirectory);
  const connectionExports = join(exportsDirectory, 'connections');
  const declaredAssets = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
  const assets = new Map(await Promise.all([...declaredAssets].map(async ([path, asset]) =>
    [path, { type: asset.type, bytes: await readFile(asset.url) }])));
  let origin, authorities, origins, closed = false, closing;
  const allowed = req => {
    const raw = req.headers[TOKEN_HEADER];
    return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) && timingSafeEqual(Buffer.from(raw), expected);
  };
  async function input(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw error('BLOCKSCOUT_JSON_REQUIRED', 415);
    const parts = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > LIMIT) throw error('BLOCKSCOUT_REQUEST_TOO_LARGE', 413); parts.push(chunk); }
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch { throw error('BLOCKSCOUT_REQUEST_JSON_INVALID'); }
    if (!plain(value)) throw error('BLOCKSCOUT_REQUEST_JSON_INVALID');
    return value;
  }
  const respond = (res, status, value, headers = {}) => {
    if (res.destroyed || res.writableEnded) return;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + '\n');
    res.writeHead(status, { ...SECURITY, 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length, ...headers });
    res.end(bytes);
  };
  const activeRequests = new Set();
  async function handle(req, res) {
    const cancel = new AbortController();
    const abort = () => { if (!res.writableEnded) cancel.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      if (closed || !authorities.has(req.headers.host))
        return respond(res, 403, { error: 'BLOCKSCOUT_LOCAL_OPERATOR_REQUIRED' });
      if (req.headers.origin !== undefined && !origins.has(req.headers.origin))
        return respond(res, 403, { error: 'BLOCKSCOUT_ORIGIN_REJECTED' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && !url.search && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname); return respond(res, 200, asset.bytes, { 'content-type': asset.type });
      }
      if (!url.pathname.startsWith('/api/') || !allowed(req)) return respond(res, 403, { error: 'BLOCKSCOUT_OPERATOR_TOKEN_REQUIRED' });
      if (req.method === 'POST' && !origins.has(req.headers.origin))
        return respond(res, 403, { error: 'BLOCKSCOUT_ORIGIN_REQUIRED' });
      if (req.method === 'GET' && url.pathname === '/api/status' && !url.search)
        return respond(res, 200, { ...application.snapshot(), deployment: {
          mode: seller.mode === 'NATIVE_X402' ? 'paid' : 'challenge-only',
          merchantMode: seller.mode, lifecycle: seller.lifecycle.snapshot(),
        }, originalMerchant: { seller: seller.url,
          operations: operations.url, availability: operations.availabilityUrl, fulfillment: operations.url + '/fulfillment' } });
      if (req.method === 'GET' && url.pathname === '/api/navigation' && !url.search)
        return respond(res, 200, { operations: operations.url, availability: operations.availabilityControlUrl,
          fulfillment: operations.deliveryControlUrl });
      if (req.method === 'GET' && url.pathname === '/api/connection' && !url.search)
        return respond(res, 200, { plan: application.plan, planSha256: planSha(application.plan),
          connection: connectionSummary(application.plan) });
      if (req.method === 'POST' && ['/api/connection/review', '/api/connection/prepare'].includes(url.pathname) && !url.search) {
        const data = await input(req), preparing = url.pathname.endsWith('/prepare');
        const fields = preparing ? ['sourcePlanSha256', 'changes', 'reviewSha256'] : ['sourcePlanSha256', 'changes'];
        if (Object.keys(data).length !== fields.length || Object.keys(data).some(key => !fields.includes(key)))
          throw error('BLOCKSCOUT_CONNECTION_REQUEST_INVALID');
        const reviewed = reviewConnection(application.plan, data.changes, data.sourcePlanSha256);
        if (!preparing) return respond(res, 200, reviewed);
        if (reviewed.reviewSha256 !== data.reviewSha256) throw error('BLOCKSCOUT_CONNECTION_REVIEW_CHANGED', 409);
        const result = await retainConnectionPackage(reviewed, connectionExports);
        return respond(res, result.status === 'PREPARED' ? 201 : 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/connection/history') {
        const pairs = [...url.searchParams];
        if (new Set(pairs.map(([key]) => key)).size !== pairs.length || pairs.some(([key]) => !['after', 'limit'].includes(key)))
          throw error('BLOCKSCOUT_CONNECTION_PAGE_INVALID');
        const query = Object.fromEntries(pairs);
        if (query.limit !== undefined) {
          if (!/^(?:[1-9]\d*)$/.test(query.limit)) throw error('BLOCKSCOUT_CONNECTION_PAGE_INVALID');
          query.limit = Number(query.limit);
        }
        return respond(res, 200, await listRetainedConnections(connectionExports, query));
      }
      const connectionPackage = /^\/api\/connection\/packages\/([a-f0-9]{64})$/.exec(url.pathname);
      if (req.method === 'GET' && connectionPackage && !url.search) {
        const record = await readRetainedConnection(connectionExports, connectionPackage[1]);
        return respond(res, 200, record.bytes, {
          'content-disposition': 'attachment; filename="blockscout-connection-' + connectionPackage[1] + '.json"',
          'x-content-sha256': record.sha256 });
      }
      if (req.method === 'GET' && url.pathname === '/api/attempts') {
        const pairs = [...url.searchParams];
        if (new Set(pairs.map(([k]) => k)).size !== pairs.length || pairs.some(([k]) => !['after', 'limit', 'chainId', 'addressHash'].includes(k)))
          throw error('BLOCKSCOUT_ATTEMPT_FILTER_INVALID');
        const options = Object.fromEntries(pairs);
        for (const key of ['after', 'limit']) if (options[key] !== undefined) {
          if (!/^(?:0|[1-9]\d*)$/.test(options[key])) throw error('BLOCKSCOUT_ATTEMPT_FILTER_INVALID'); options[key] = Number(options[key]);
        }
        return respond(res, 200, application.accounting.list(options));
      }
      const attempt = /^\/api\/attempts\/([0-9a-f-]{36})(\/response)?$/.exec(url.pathname);
      if (req.method === 'GET' && attempt && !url.search) {
        if (!attempt[2]) return respond(res, 200, application.accounting.get(attempt[1]));
        const record = application.accounting.response(attempt[1]);
        return respond(res, 200, record.bytes, { 'content-type': 'application/json',
          'content-disposition': 'attachment; filename="blockscout-' + attempt[1] + '.json"',
          'x-content-sha256': record.info.response.sha256 });
      }
      const download = /^\/api\/backups\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && download && !url.search) {
        const id = download[1], receipt = JSON.parse(await readFile(join(exportsDirectory, id + '.json'), 'utf8'));
        const file = await open(join(exportsDirectory, id + '.sqlite'), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size !== receipt.bytes) throw error('BLOCKSCOUT_BACKUP_INTEGRITY_FAILED', 503);
          const hash = createHash('sha256');
          for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
          if (hash.digest('hex') !== receipt.sha256) throw error('BLOCKSCOUT_BACKUP_INTEGRITY_FAILED', 503);
          res.writeHead(200, { ...SECURITY, 'content-type': 'application/vnd.sqlite3', 'content-length': receipt.bytes,
            'content-disposition': 'attachment; filename="blockscout-provider-' + id + '.sqlite"', 'x-content-sha256': receipt.sha256 });
          await pipeline(file.createReadStream({ start: 0, autoClose: false }), res);
        } finally { await file.close(); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reconciliation' && !url.search)
        return respond(res, 200, application.accounting.reconcile(await input(req)));
      if (req.method === 'POST' && url.pathname === '/api/buyer' && !url.search) {
        const data = await input(req);
        if (Object.keys(data).some(k => !['chainId', 'addressHash', 'intentId', 'responseOut'].includes(k))) throw error('BLOCKSCOUT_BUYER_SELECTION_INVALID');
        const prepared = prepareTokenBuyer(application.plan, data);
        return respond(res, 200, { schema: 'stellar-forge.blockscout-buyer-prepared.v1', token: prepared.token,
          planSha256: prepared.planSha256, configSha256: prepared.configSha256, config: prepared.draft });
      }
      if (req.method === 'POST' && url.pathname === '/api/diagnose' && !url.search) {
        const data = await input(req);
        if (Object.keys(data).some(k => !['chainId', 'addressHash'].includes(k))) throw error('BLOCKSCOUT_TOKEN_SELECTION_INVALID');
        return respond(res, 200, await application.diagnose({ ...data, signal: cancel.signal }));
      }
      if (req.method === 'POST' && url.pathname === '/api/backup' && !url.search) {
        const data = await input(req); if (Object.keys(data).length) throw error('BLOCKSCOUT_BACKUP_REQUEST_INVALID');
        const id = randomUUID();
        const receipt = await application.accounting.backup(join(exportsDirectory, id + '.sqlite'));
        const receiptFile = await open(join(exportsDirectory, id + '.json'),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await receiptFile.writeFile(JSON.stringify(receipt) + '\n'); await receiptFile.sync(); }
        finally { await receiptFile.close(); }
        await syncDirectory(exportsDirectory);
        return respond(res, 201, { ...receipt, id, download: '/api/backups/' + id });
      }
      respond(res, 404, { error: 'BLOCKSCOUT_OPERATOR_ROUTE_NOT_FOUND' });
    } catch (e) {
      if (res.headersSent) res.destroy();
      else respond(res, Number.isInteger(e.status) ? e.status : e.code === 'ENOENT' ? 404 : 500,
        { error: typeof e.code === 'string' && /^BLOCKSCOUT_[A-Z0-9_]+$/.test(e.code) ? e.code : 'BLOCKSCOUT_OPERATOR_REQUEST_FAILED',
          ...(e.code === 'BLOCKSCOUT_RECONCILIATION_REVISION_CHANGED' ? { currentRevision: e.currentRevision } : {}) });
    }
  }
  const server = createServer((req, res) => {
    const run = handle(req, res); activeRequests.add(run);
    run.finally(() => activeRequests.delete(run)).catch(() => {});
  });
  server.requestTimeout = 70000; server.headersTimeout = 8000; server.keepAliveTimeout = 2000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
  const listenerPort = server.address().port;
  authorities = new Set([HOST, 'localhost'].flatMap(host =>
    listenerPort === 80 ? [host, host + ':80'] : [host + ':' + listenerPort]));
  origins = new Set([...authorities].map(authority => 'http://' + authority));
  origin = new URL('http://' + HOST + ':' + listenerPort).origin;
  return { server, url: origin, controlUrl: origin + '/#' + token,
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          try {
            await new Promise((done, fail) => {
              server.close(e => e ? fail(e) : done()); server.closeIdleConnections?.();
            });
          } finally { await Promise.allSettled([...activeRequests]); }
        })();
      }
      return closing;
    } };
}

