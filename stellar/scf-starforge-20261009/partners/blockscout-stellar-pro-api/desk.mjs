// MIT. Private provider accounting and token buyer preparation beside original ops.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { readFile, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { privateDirectory, syncDirectory } from './accounting.mjs';
import { prepareTokenBuyer, error, plain } from './product.mjs';

const HOST = '127.0.0.1';
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
const LIMIT = 65536;
const TOKEN_HEADER = 'x-blockscout-operator-token';

export async function startBlockscoutDesk({ application, seller, operations, directory, port = 8425 }) {
  const token = randomBytes(32).toString('hex'), expected = Buffer.from(token);
  const exportsDirectory = join(directory, 'exports'); await privateDirectory(exportsDirectory);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { type, bytes: await readFile(new URL('./public/' + file, import.meta.url)) }])));
  let origin, authority, closed = false, closing;
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
  const server = createServer(async (req, res) => {
    const cancel = new AbortController();
    const abort = () => { if (!res.writableEnded) cancel.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      if (closed || req.headers.host !== authority && req.headers.host !== 'localhost:' + server.address()?.port)
        return respond(res, 403, { error: 'BLOCKSCOUT_LOCAL_OPERATOR_REQUIRED' });
      if (req.headers.origin !== undefined && req.headers.origin !== origin && req.headers.origin !== 'http://localhost:' + server.address().port)
        return respond(res, 403, { error: 'BLOCKSCOUT_ORIGIN_REJECTED' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && !url.search && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname); return respond(res, 200, asset.bytes, { 'content-type': asset.type });
      }
      if (!url.pathname.startsWith('/api/') || !allowed(req)) return respond(res, 403, { error: 'BLOCKSCOUT_OPERATOR_TOKEN_REQUIRED' });
      if (req.method === 'POST' && req.headers.origin !== origin && req.headers.origin !== 'http://localhost:' + server.address().port)
        return respond(res, 403, { error: 'BLOCKSCOUT_ORIGIN_REQUIRED' });
      if (req.method === 'GET' && url.pathname === '/api/status' && !url.search)
        return respond(res, 200, { ...application.snapshot(), originalMerchant: { seller: seller.url,
          operations: operations.url, availability: operations.availabilityUrl, fulfillment: operations.url + '/fulfillment' } });
      if (req.method === 'GET' && url.pathname === '/api/navigation' && !url.search)
        return respond(res, 200, { operations: operations.url, availability: operations.availabilityControlUrl,
          fulfillment: operations.deliveryControlUrl });
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
        { error: typeof e.code === 'string' && /^BLOCKSCOUT_[A-Z0-9_]+$/.test(e.code) ? e.code : 'BLOCKSCOUT_OPERATOR_REQUEST_FAILED' });
    }
  });
  server.requestTimeout = 70000; server.headersTimeout = 8000; server.keepAliveTimeout = 2000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
  authority = HOST + ':' + server.address().port; origin = 'http://' + authority;
  return { server, url: origin, controlUrl: origin + '/#' + token,
    close() {
      if (!closing) { closed = true; closing = new Promise((done, fail) => {
        server.close(e => e ? fail(e) : done()); server.closeIdleConnections?.();
      }); }
      return closing;
    } };
}
