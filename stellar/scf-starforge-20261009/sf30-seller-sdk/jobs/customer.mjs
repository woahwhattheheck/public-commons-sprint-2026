// MIT. Authenticated customer status and immutable output; purchases remain on ORIGINAL SF30.
import { createServer } from 'node:http';
import { JOB_ID, jobError } from './config.mjs';
import { createJobIntake } from './intake/service.mjs';
import { isIntakeRoute, handleJobIntake } from './intake/http.mjs';
import { CATALOG_PATH } from './intake/protocol.mjs';

function token(req) {
  const counts = { authorization: 0, 'x-sfjobs-token': 0 };
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index].toLowerCase();
    if (Object.hasOwn(counts, name)) counts[name]++;
  }
  if (counts.authorization + counts['x-sfjobs-token'] !== 1) throw jobError('JOB_NOT_FOUND', 404);
  if (counts['x-sfjobs-token'] === 1 && typeof req.headers['x-sfjobs-token'] === 'string') return req.headers['x-sfjobs-token'];
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers.authorization ?? '');
  if (!match) throw jobError('JOB_NOT_FOUND', 404);
  return match[1];
}
const baseHeaders = {
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};
function json(req, res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { ...baseHeaders, 'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length), ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export async function startCustomerServer({ model, port = 8477, maxInFlight = 8, intakeConfig, env = process.env } = {}) {
  if (typeof model?.customerStatus !== 'function' || typeof model?.customerResult !== 'function') throw jobError('JOB_MERCHANT_MODEL_REQUIRED');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw jobError('JOB_CUSTOMER_PORT_INVALID');
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 64) throw jobError('JOB_CUSTOMER_CAPACITY_INVALID');
  const publicOrigin = new URL(model.configuration.publicOrigin);
  const intake = createJobIntake({ model, intakeConfig, env });
  let active = 0, closed = false, closing;
  const sockets = new Set();
  function takeCapacity(req, res) {
    if (active >= maxInFlight) {
      json(req, res, 429, { error: 'JOB_CUSTOMER_BUSY' }, { 'retry-after': '1' }); return false;
    }
    active++; let released = false;
    const release = () => {
      if (released) return; released = true; active--;
      res.off('finish', release); res.off('close', release);
    };
    res.once('finish', release); res.once('close', release);
    if (res.destroyed) { release(); return false; }
    return true;
  }
  const server = createServer(async (req, res) => {
    try {
      if (closed) return json(req, res, 503, { error: 'JOB_CUSTOMER_STOPPING' });
      const localHost = '127.0.0.1:' + server.address().port;
      if (![localHost, publicOrigin.host].includes(req.headers.host)) return json(req, res, 421, { error: 'JOB_CUSTOMER_HOST_REJECTED' });
      if (req.headers.origin !== undefined && req.headers.origin !== publicOrigin.origin)
        return json(req, res, 403, { error: 'JOB_CUSTOMER_ORIGIN_REJECTED' });
      if (intake && isIntakeRoute(req.url)) {
        if (!takeCapacity(req, res)) return;
        await handleJobIntake({ intake, request: req, respond: (status, value) => {
          if (!res.destroyed) json(req, res, status, value);
        } });
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(req, res, 405, { error: 'JOB_CUSTOMER_METHOD_REJECTED' }, { allow: 'GET, HEAD' });
      if (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) !== 0) {
        res.shouldKeepAlive = false;
        return json(req, res, 400, { error: 'JOB_CUSTOMER_BODY_REJECTED' }, { connection: 'close' });
      }
      const match = /^\/jobs\/([^/?#]+)(\/result)?$/.exec(req.url ?? '');
      if (!match) return json(req, res, 404, { error: 'JOB_NOT_FOUND' });
      let id;
      try { id = decodeURIComponent(match[1]); } catch { return json(req, res, 404, { error: 'JOB_NOT_FOUND' }); }
      if (!JOB_ID.test(id) || encodeURIComponent(id) !== match[1]) return json(req, res, 404, { error: 'JOB_NOT_FOUND' });
      const claim = token(req);
      if (!takeCapacity(req, res)) return;
      if (!match[2]) return json(req, res, 200, await model.customerStatus({ id, token: claim }));
      const result = await model.customerResult({ id, token: claim });
      if (res.destroyed) return;
      res.writeHead(200, { ...baseHeaders, 'content-type': result.contentType,
        'content-length': String(result.bytes), etag: '"' + result.sha256 + '"',
        'x-content-sha256': result.sha256, 'content-disposition': 'attachment; filename="' + result.filename + '"' });
      res.end(req.method === 'HEAD' ? undefined : result.body);
    } catch (error) {
      if (res.destroyed) return;
      if (!res.headersSent) json(req, res, [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 503].includes(error.status) ? error.status : 503,
        { error: /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_CUSTOMER_UNAVAILABLE' });
      else res.destroy();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + server.address().port;
  return { server, url, publicOrigin: publicOrigin.origin,
    intakeUrl: intake ? publicOrigin.origin + CATALOG_PATH : null,
    close() {
      if (closing) return closing;
      closed = true;
      closing = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 15000);
        server.close(error => { clearTimeout(timer); error ? reject(error) : resolve({ stopped: true }); });
        server.closeIdleConnections?.();
      });
      closing = closing.then(async result => { await intake?.drain(); return result; });
      return closing;
    },
  };
}
