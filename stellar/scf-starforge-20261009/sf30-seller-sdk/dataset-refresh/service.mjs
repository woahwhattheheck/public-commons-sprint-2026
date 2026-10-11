// MIT. Compose versioned CSV handlers with the original SF30 runnable seller.
import { createServer, request as httpRequest } from 'node:http';
import { constants } from 'node:fs';
import { lstat, chmod, rm, open } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { startSellerService } from '../serve.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const socketFor = directory => join(directory, 'control.sock');
const descriptorFor = directory => join(directory, 'control.json');
const respond = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body) }); res.end(body);
};

async function controlServer(versions, transport) {
  if (!['unix', 'loopback'].includes(transport)) throw new TypeError('Control transport must be unix or loopback');
  if (process.platform === 'win32' && transport === 'unix')
    throw new Error('Use --control-transport loopback on Windows');
  const socketPath = socketFor(versions.directory);
  const descriptorPath = descriptorFor(versions.directory), token = randomBytes(32).toString('hex');
  if (transport === 'unix') {
    try {
      const existing = await lstat(socketPath);
      if (!existing.isSocket()) throw new TypeError('Control path exists and is not a socket');
      // The version store already owns the process writer lock.
      await rm(socketPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    const existing = await lstat(descriptorPath);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new TypeError('Control descriptor must be a regular file');
    await rm(descriptorPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = createServer((req, res) => {
    const run = async () => {
      req.setTimeout(120000, () => req.destroy());
      const supplied = req.headers.authorization;
      const expected = 'Bearer ' + token;
      if (req.headers.origin || req.headers['sec-fetch-site'] || typeof supplied !== 'string' ||
          !/^Bearer [a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ||
          (transport === 'loopback' && req.headers.host !== `127.0.0.1:${server.address().port}`))
        return respond(res, 403, { error: 'PRIVATE_CONTROL_REQUIRED' });
      if (req.method === 'GET' && req.url === '/status') return respond(res, 200, versions.status());
      if (req.method !== 'POST' || !['/refresh', '/collect'].includes(req.url))
        return respond(res, 404, { error: 'CONTROL_ROUTE_NOT_FOUND' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
        return respond(res, 415, { error: 'JSON_CONTENT_TYPE_REQUIRED' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { respond(res, 413, { error: 'CONTROL_BODY_TOO_LARGE' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return respond(res, 400, { error: 'INVALID_CONTROL_JSON' }); }
      if (!object(body)) return respond(res, 400, { error: 'INVALID_CONTROL_REQUEST' });
      if (req.url === '/collect') {
        if (Object.keys(body).length) return respond(res, 400, { error: 'INVALID_CONTROL_REQUEST' });
        return respond(res, 200, { removed: await versions.collect(), ...versions.status() });
      }
      if (Object.keys(body).sort().join(',') !== 'configPath,expectedSnapshot' ||
          typeof body.configPath !== 'string' || !isAbsolute(body.configPath))
        return respond(res, 400, { error: 'INVALID_CONTROL_REQUEST' });
      respond(res, 200, await versions.refresh(body));
    };
    run().catch(error => {
      if (!res.writableEnded && !res.destroyed)
        respond(res, [400, 409].includes(error.status) ? error.status : 422,
          { error: error.code ?? 'DATASET_REFRESH_REJECTED', message: error.message });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
  await new Promise((done, fail) => {
    server.once('error', fail);
    if (transport === 'unix') server.listen(socketPath, done);
    else server.listen(0, '127.0.0.1', done);
  });
  try {
    if (transport === 'unix') await chmod(socketPath, 0o600);
    const descriptor = { schema: 'stellar-forge.dataset-control.v1', transport, token,
      ...(transport === 'loopback' ? { port: server.address().port } : {}) };
    const handle = await open(descriptorPath, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(descriptor) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    await new Promise(done => server.close(done)); throw error;
  }
  return { path: transport === 'unix' ? socketPath : descriptorPath,
    close: async () => {
      await new Promise((done, fail) => {
        server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.();
      });
      await rm(descriptorPath, { force: true });
    } };
}

/** Public original seller binds loopback; all dataset mutation uses a PRIVATE
 * filesystem socket. There is no refresh route on the merchant's public HTTP API. */
export async function startVersionedDatasetSeller({ versions, config, port = 8423,
  nativeFactory = null, handlers = {}, control = true, controlTransport = 'unix',
  maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  if (!versions || typeof versions.wrapRequest !== 'function' || !Array.isArray(config?.routes))
    throw new TypeError('An open version store and original seller config are required');
  const routes = config.routes.filter(route => route.handler === 'queryDataset');
  if (!routes.length || routes.some(route => route.admit !== 'admitDataset' ||
      (route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method) !== 'GET'))
    throw new TypeError('Dataset routes require GET, queryDataset and admitDataset from the original generated config');
  let service, controls;
  try {
    service = await startSellerService({ config, port, nativeFactory, maxInFlight, drainGraceMs,
      handlers: { ...handlers, admitDataset: versions.admit, queryDataset: versions.handle } });
    const listeners = service.server.listeners('request');
    if (listeners.length !== 1) throw new TypeError('Expected the original SF30 single request dispatcher');
    service.server.removeListener('request', listeners[0]);
    service.server.on('request', versions.wrapRequest(listeners[0]));
    if (control) controls = await controlServer(versions, controlTransport);
    return { ...service, versions, controlPath: controls?.path ?? null,
      async close() {
        try { await controls?.close(); } finally {
          try { await service.close(); } finally { await versions.close(); }
        }
      } };
  } catch (error) {
    try { await controls?.close(); } finally {
      try { await service?.close(); } finally { await versions.close(); }
    }
    throw error;
  }
}

/** Operator-only request to the socket in a known private state directory. */
export async function datasetControl(directory, action = 'status', body = undefined) {
  if (!['status', 'refresh', 'collect'].includes(action)) throw new TypeError('Unknown dataset control action');
  const file = await open(descriptorFor(directory), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let descriptor;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 || (process.platform !== 'win32' && (info.mode & 0o077)))
      throw new TypeError('Dataset control descriptor must be a small private regular file');
    const bytes = await file.readFile();
    if (bytes.length > 1024) throw new RangeError('Control descriptor exceeds limit');
    descriptor = JSON.parse(bytes.toString('utf8'));
  } finally { await file.close(); }
  if (!object(descriptor) || descriptor.schema !== 'stellar-forge.dataset-control.v1' ||
      !['unix', 'loopback'].includes(descriptor.transport) || !/^[a-f0-9]{64}$/.test(descriptor.token ?? '') ||
      (descriptor.transport === 'loopback' && (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535)))
    throw new TypeError('Invalid private dataset control descriptor');
  const payload = action === 'status' ? null : JSON.stringify(body ?? {});
  return new Promise((done, fail) => {
    const req = httpRequest({ ...(descriptor.transport === 'unix' ? { socketPath: socketFor(directory) } :
      { hostname: '127.0.0.1', port: descriptor.port }), path: '/' + action,
      method: payload === null ? 'GET' : 'POST', timeout: 120000,
      headers: { authorization: 'Bearer ' + descriptor.token,
        ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) res.destroy(new RangeError('Control response exceeds limit'));
        else chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) throw Object.assign(new Error(result.message ?? result.error),
            { code: result.error, status: res.statusCode });
          done(result);
        } catch (error) { fail(error); }
      });
    });
    req.on('error', fail);
    req.on('timeout', () => req.destroy(new Error('Dataset control request timed out; use status before retrying a refresh')));
    req.end(payload ?? undefined);
  });
}
