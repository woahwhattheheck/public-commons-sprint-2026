// MIT. Original loopback/capability pattern applied to the runtime operator workflow.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { imageOperationFields } from './image-workspace.mjs';
import { openRuntimeWorkspace } from './model.mjs';
import { plain, need, fail } from './storage.mjs';

const HOST = '127.0.0.1';
const security = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
async function body(req, allowed, maximum = 32768) {
  need((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json',
    'RUNTIME_WORKSPACE_JSON_REQUIRED', undefined, 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length; need(bytes <= maximum, 'RUNTIME_WORKSPACE_REQUEST_TOO_LARGE', undefined, 413); chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { fail('RUNTIME_WORKSPACE_JSON_INVALID'); }
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), 'RUNTIME_WORKSPACE_FIELDS_INVALID');
  return value;
}
function params(url, allowed) {
  need([...url.searchParams.keys()].every(key => allowed.includes(key) && url.searchParams.getAll(key).length === 1),
    'RUNTIME_WORKSPACE_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}

export async function startRuntimeWorkspace({ directory, port = 8465 } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'RUNTIME_WORKSPACE_PORT_INVALID');
  const model = await openRuntimeWorkspace({ directory });
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/image.mjs', 'image.mjs', 'text/javascript; charset=utf-8'],
  ].map(async ([path, name, type]) => [path, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type }])));
  let origin, host, closing = false;
  const sockets = new Set(), imageDownloads = new Map();
  const server = createServer(async (req, res) => {
    const reply = (status, type, bytes, headers = {}) => {
      if (res.headersSent || res.destroyed) return;
      const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      res.writeHead(status, { ...security, 'content-type': type, 'content-length': data.length, ...headers });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    const send = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      need(req.headers.host === host && (!req.headers.origin || req.headers.origin === origin) &&
        !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'RUNTIME_WORKSPACE_ORIGIN_REQUIRED', undefined, 403);
      need(req.url?.startsWith('/') && !req.url.startsWith('//'), 'RUNTIME_WORKSPACE_TARGET_INVALID');
      const url = new URL(req.url, origin);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return reply(200, asset.type, asset.bytes);
      }
      need(!closing, 'RUNTIME_WORKSPACE_CLOSED', undefined, 409);
      if (req.method === 'GET' && /^\/image-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = imageDownloads.get(key);
        imageDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'RUNTIME_IMAGE_DOWNLOAD_EXPIRED', 'Request a new download from the open workspace', 410);
        const file = await model.imagesDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"' });
          await pipeline(file.handle.createReadStream({ autoClose: false }), res);
        } finally { await file.handle.close(); }
        return;
      }
      const supplied = Buffer.from(typeof req.headers['x-runtime-workspace-token'] === 'string' ? req.headers['x-runtime-workspace-token'] : '');
      need(supplied.length === tokenBytes.length && timingSafeEqual(supplied, tokenBytes),
        'RUNTIME_WORKSPACE_CAPABILITY_REQUIRED', 'Open the current private URL printed by the workspace command', 401);
      if (req.method === 'GET' && url.pathname === '/api/images/state') {
        params(url, []); return send(200, await model.imagesState());
      }
      if (req.method === 'GET' && url.pathname === '/api/state')
        return send(200, await model.state(params(url, ['runtimeId'])));
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        const value = params(url, ['archiveId']); return send(200, await model.catalog(value.archiveId));
      }
      if (req.method === 'GET' && url.pathname === '/api/log')
        return send(200, await model.logs(params(url, ['runtimeId', 'operationId'])));
      if (req.method === 'GET' && url.pathname === '/api/handoff') {
        const value = params(url, ['runtimeId']); return send(200, await model.handoff(value.runtimeId));
      }
      need(req.method === 'POST' && req.headers.origin === origin, 'RUNTIME_WORKSPACE_ORIGIN_REQUIRED', undefined, 403);
      if (url.pathname === '/api/images/upload') {
        need((req.headers['content-type'] ?? '').split(';')[0] === 'application/octet-stream', 'RUNTIME_IMAGE_UPLOAD_TYPE_REQUIRED');
        const value = params(url, ['transferId', 'offset']);
        need(/^(?:0|[1-9][0-9]*)$/.test(value.offset ?? ''), 'RUNTIME_IMAGE_UPLOAD_OFFSET_INVALID');
        return send(200, await model.imagesUpload({ ...value, offset: Number(value.offset), body: req }));
      }
      if (url.pathname === '/api/archive-upload') {
        need((req.headers['content-type'] ?? '').split(';')[0] === 'application/octet-stream', 'RUNTIME_WORKSPACE_ARCHIVE_TYPE_REQUIRED');
        const value = params(url, ['sha256', 'label', 'requestId']);
        return send(202, await model.receiveArchive({ ...value, body: req }));
      }
      need(!url.search, 'RUNTIME_WORKSPACE_QUERY_INVALID');
      if (url.pathname === '/api/images/attach') return send(201, await model.imagesAttach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/images/review') return send(200, await model.imagesReview(await body(req,
        ['runtimeId', 'id', 'baseImage', 'platform', 'sourceRoot', 'runtime', 'uid', 'gid', 'pythonModules', 'nodeHeaders'])));
      if (url.pathname === '/api/images/transfer-attach') return send(201, await model.imagesTransferAttach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/images/transfer') return send(201, await model.imagesTransfer(await body(req, ['manifest', 'requestId', 'label'], 65536)));
      if (url.pathname === '/api/images/container-review') return send(200, await model.imagesContainerReview(await body(req,
        ['imageId', 'transferId', 'runtimeId', 'containerPlan', 'hostPlan', 'sourceMode', 'useImageRuntime', 'selectedSourceRoot'])));
      if (url.pathname === '/api/images/download') {
        const input = await body(req, ['transferId', 'file']), file = await model.imagesDownload(input);
        await file.handle.close();
        for (const [key, value] of imageDownloads) if (value.expires <= Date.now()) imageDownloads.delete(key);
        need(imageDownloads.size < 256, 'RUNTIME_IMAGE_DOWNLOAD_LIMIT', 'Finish or reopen a recent download', 429);
        const key = randomBytes(32).toString('hex');
        imageDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/image-download/' + key, file: file.file, bytes: file.bytes });
      }
      if (url.pathname === '/api/attach') return send(201, await model.attach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/review') return send(200, await model.review(await body(req, ['archiveId', 'selection'])));
      if (url.pathname === '/api/operation') return send(202, await model.begin(await body(req,
        ['requestId', 'operation', 'runtimeId', 'archiveId', 'name', 'selection', 'profileId', 'offline', 'cache',
          'load', 'source', 'install', 'archive', 'sha256', 'label', 'nodeHeaders',
          ...new Set(Object.values(imageOperationFields).flat())])));
      if (url.pathname === '/api/resume-queued') {
        const value = await body(req, ['operationId']); return send(202, await model.resumeQueued(value.operationId));
      }
      if (url.pathname === '/api/compare') return send(200, await model.compare(await body(req, ['before', 'after'])));
      fail('RUNTIME_WORKSPACE_ROUTE_NOT_FOUND', undefined, 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = error.code ?? 'RUNTIME_WORKSPACE_ERROR';
      send(error.status ?? (/(?:CHANGED|BUSY|RUNNING|EXIST)/.test(code) ? 409 : 400),
        { error: code, message: String(error.message ?? error).slice(0, 2000) });
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 120000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, HOST, done); });
  host = HOST + ':' + server.address().port; origin = 'http://' + host;
  return { origin, url: origin + '/#' + token, directory: model.directory,
    async close() {
      if (closing) return;
      closing = true; imageDownloads.clear();
      const stopped = new Promise(done => server.close(done));
      await model.close(); server.closeIdleConnections();
      for (const socket of sockets) socket.destroy();
      await stopped;
    } };
}
