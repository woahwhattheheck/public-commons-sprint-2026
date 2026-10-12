#!/usr/bin/env node
// MIT — Private request-collection review over the maintained SF88 controller.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';
import { openCollections } from './model.mjs';
import { initializationDirectory, initializationBytes } from '../initialization.mjs';

const HELP = [
  'Starforge request collections workspace',
  '',
  '  starforge buyer-collections-workspace --directory ABS_DIRECTORY',
  '    [--queue-root ABS_EXISTING_INBOX] [--port 0]',
  '',
  'Open the printed private URL in a browser on this host.',
  'Review saved requests, queue them, recover outcomes and export results.',
  'The selected run command opens the original per-request terminal approval.',
].join('\n');
const JSON_LIMIT = 256 * 1024;
const EXPORT_LIMIT = 32 * 1024 * 1024;
function need(value, code, status = 400) {
  if (!value) throw Object.assign(new Error(code), { code, status });
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value, allowed) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)),
    'COLLECTION_REQUEST_INVALID');
  return value;
}
function pinned(value) {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    'COLLECTION_MANIFEST_REQUIRED');
  return value;
}
function sameToken(header, token) {
  if (typeof header !== 'string') return false;
  const supplied = Buffer.from(header), expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function jsonBody(request) {
  need((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    === 'application/json', 'JSON_REQUIRED', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    need(size <= JSON_LIMIT, 'REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(Buffer.concat(chunks))); }
  catch { need(false, 'INVALID_JSON'); }
  need(plain(result), 'JSON_OBJECT_REQUIRED');
  return result;
}
function errorStatus(error) {
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600)
    return error.status;
  const code = String(error.code ?? '');
  if (/NOT_FOUND$/.test(code)) return 404;
  if (/BUSY|CHANGED|CONFLICT|NOT_ENQUEUED|REVIEW_REQUIRED|MISSING_INPUT/.test(code))
    return 409;
  if (/^COLLECTION_|^INBOX_|INVALID|REQUIRED/.test(code)) return 400;
  return 500;
}
function selected(value, snapshot) {
  need(Array.isArray(value) && value.length > 0
    && value.length <= snapshot.itemCount
    && value.every(id => typeof id === 'string')
    && new Set(value).size === value.length, 'COLLECTION_INTENT_REQUIRED');
  const known = new Set(snapshot.items.map(item => item.intentId));
  need(value.every(id => known.has(id)), 'COLLECTION_INTENT_UNKNOWN');
  return value;
}
function shellWord(word) {
  return "'" + String(word).replaceAll("'", "'\\''") + "'";
}
function snapshotPin(snapshot, expected) {
  need(snapshot.manifestSha256 === pinned(expected), 'COLLECTION_MANIFEST_CHANGED', 409);
}
export async function serveCollections(collections, { port = 0 } = {}) {
  need(collections && typeof collections.inspect === 'function'
    && typeof collections.preview === 'function', 'COLLECTION_CONTROLLER_REQUIRED');
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'PORT_INVALID');
  const assets = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
  const token = randomBytes(32).toString('hex');
  const reviews = new Map(), exports = new Map(), work = new Set();
  let origin, closing = false, mutation = false;
  function prune() {
    const now = Date.now();
    for (const [key, value] of reviews) if (value.expiresAt <= now) reviews.delete(key);
    for (const [key, value] of exports) if (value.expiresAt <= now) exports.delete(key);
  }
  async function mutate(fn) {
    need(!mutation, 'COLLECTION_WORKSPACE_BUSY', 409);
    mutation = true;
    try { return await fn(); } finally { mutation = false; }
  }
  const server = createServer((request, response) => {
    const send = (value, status = 200) => {
      if (response.destroyed) return;
      const bytes = Buffer.from(JSON.stringify(value));
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bytes.length });
      response.end(bytes);
    };
    async function handle() {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      need(!closing, 'SERVER_CLOSING', 503);
      need(origin && request.headers.host === new URL(origin).host, 'HOST_REFUSED', 403);
      need(!request.headers.origin || request.headers.origin === origin, 'ORIGIN_REFUSED', 403);
      need(!request.headers['sec-fetch-site']
        || ['none', 'same-origin'].includes(request.headers['sec-fetch-site']),
        'CROSS_ORIGIN_REFUSED', 403);
      const url = new URL(request.url, origin);
      need(url.origin === origin && !url.search, 'ROUTE_NOT_FOUND', 404);
      const asset = assets.get(url.pathname);
      if (asset && ['GET', 'HEAD'].includes(request.method)) {
        const bytes = await readFile(asset.url);
        response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      }
      need(sameToken(request.headers.authorization, token), 'PRIVATE_SESSION_REQUIRED', 401);
      prune();
      if (request.method === 'GET' && url.pathname === '/api/status')
        return send({ schema: 'stellar-forge.sf88.collections-workspace.v1',
          directory: collections.directory, queueRoot: collections.queueRoot,
          busy: mutation, paymentApproval: 'original-terminal',
          command: 'buyer-collections', exportRoot: resolve(collections.directory, 'exports') });
      if (request.method === 'GET' && url.pathname === '/api/collections')
        return send(await collections.list());
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        const input = fields(await jsonBody(request), ['configFiles']);
        need(Array.isArray(input.configFiles) && input.configFiles.length > 0
          && input.configFiles.every(file => typeof file === 'string'
            && isAbsolute(file) && !file.includes('\0')), 'COLLECTION_INVALID_INPUT');
        const preview = await collections.preview({ configFiles: input.configFiles });
        while (reviews.size >= 8) reviews.delete(reviews.keys().next().value);
        const reviewId = randomBytes(16).toString('hex');
        reviews.set(reviewId, { configFiles: [...input.configFiles],
          sha256: preview.previewSha256, expiresAt: Date.now() + 15 * 60 * 1000 });
        return send({ ...preview, reviewId });
      }
      if (request.method === 'POST' && url.pathname === '/api/collections') {
        const input = fields(await jsonBody(request),
          ['id', 'name', 'reviewId', 'expectedPreviewSha256']);
        const review = reviews.get(input.reviewId);
        need(review, 'COLLECTION_REVIEW_EXPIRED', 409);
        need(input.expectedPreviewSha256 === review.sha256,
          'COLLECTION_PREVIEW_CHANGED', 409);
        const result = await mutate(() => collections.create({
          id: input.id, name: input.name, configFiles: review.configFiles,
          expectedPreviewSha256: review.sha256,
        }));
        reviews.delete(input.reviewId);
        return send(result, 201);
      }
      const download = /^\/api\/exports\/([a-f0-9]{32})\/([A-Za-z0-9._-]{1,100})$/
        .exec(url.pathname);
      if (request.method === 'GET' && download) {
        const saved = exports.get(download[1]);
        need(saved, 'COLLECTION_EXPORT_EXPIRED', 404);
        const file = saved.files.find(entry => entry.name === download[2]);
        need(file && file.name !== '.' && file.name !== '..', 'EXPORT_FILE_NOT_FOUND', 404);
        const handle = await open(resolve(saved.directory, file.name),
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const stat = await handle.stat();
          need(stat.isFile() && stat.size === file.bytes && stat.size <= EXPORT_LIMIT,
            'COLLECTION_EXPORT_CHANGED', 409);
          const bytes = await handle.readFile();
          need(bytes.length === file.bytes
            && createHash('sha256').update(bytes).digest('hex') === file.sha256,
            'COLLECTION_EXPORT_CHANGED', 409);
          response.writeHead(200, { 'Content-Type': 'application/octet-stream',
            'Content-Length': bytes.length,
            'Content-Disposition': 'attachment; filename="' + file.name + '"' });
          response.end(bytes);
        } finally { await handle.close(); }
        return;
      }
      const route = /^\/api\/collections\/([^/]+)(?:\/(enqueue|cancel|recover|export|command))?$/
        .exec(url.pathname);
      need(route, 'ROUTE_NOT_FOUND', 404);
      let id;
      try { id = decodeURIComponent(route[1]); } catch { need(false, 'COLLECTION_INVALID_INPUT'); }
      need(typeof id === 'string' && !/[/\\\0]/.test(id), 'COLLECTION_INVALID_INPUT');
      const action = route[2];
      if (request.method === 'GET' && !action) return send(await collections.inspect(id));
      need(request.method === 'POST' && action, 'METHOD_NOT_ALLOWED', 405);
      const input = fields(await jsonBody(request),
        action === 'cancel' || action === 'recover' || action === 'command'
          ? ['expectedManifestSha256', 'intentIds'] : ['expectedManifestSha256']);
      const expectedManifestSha256 = pinned(input.expectedManifestSha256);
      if (action === 'command') {
        const snapshot = await collections.inspect(id);
        snapshotPin(snapshot, expectedManifestSha256);
        const ids = selected(input.intentIds, snapshot);
        const argv = [process.execPath, fileURLToPath(new URL('./cli.mjs', import.meta.url)),
          'run', '--directory', collections.directory, '--id', id,
          '--manifest-sha256', expectedManifestSha256,
          ...ids.flatMap(intentId => ['--intent', intentId])];
        return send({ argv, shell: 'posix', command: argv.map(shellWord).join(' '),
          intentIds: ids, manifestSha256: expectedManifestSha256 });
      }
      if (action === 'export') {
        const result = await mutate(async () => {
          const snapshot = await collections.inspect(id);
          snapshotPin(snapshot, expectedManifestSha256);
          const key = randomBytes(16).toString('hex');
          const exportRoot = resolve(collections.directory, 'exports');
          await initializationDirectory(exportRoot, { create: true });
          const directory = resolve(exportRoot, key);
          const saved = await collections.export({ id, directory, expectedManifestSha256 });
          need(Array.isArray(saved.files) && saved.files.every(file =>
            /^[A-Za-z0-9._-]{1,100}$/.test(file.name) && !['.', '..'].includes(file.name)
            && Number.isSafeInteger(file.bytes) && file.bytes >= 0
            && /^[a-f0-9]{64}$/.test(file.sha256)), 'COLLECTION_EXPORT_INVALID', 500);
          const manifest = await initializationBytes(resolve(saved.directory, 'manifest.json'), 65536);
          const files = [...saved.files, { name: 'manifest.json', bytes: manifest.length,
            sha256: createHash('sha256').update(manifest).digest('hex') }];
          while (exports.size >= 32) exports.delete(exports.keys().next().value);
          exports.set(key, { directory: saved.directory, files,
            expiresAt: Date.now() + 60 * 60 * 1000 });
          return { ...saved, files: files.map(file => ({ ...file,
            downloadUrl: '/api/exports/' + key + '/' + file.name })) };
        });
        return send(result, 201);
      }
      const result = await mutate(async () => {
        if (action === 'enqueue')
          return collections.enqueue({ id, expectedManifestSha256 });
        const snapshot = await collections.inspect(id);
        snapshotPin(snapshot, expectedManifestSha256);
        const intentIds = selected(input.intentIds, snapshot);
        return collections[action]({ id, intentIds, expectedManifestSha256 });
      });
      return send(result);
    }
    const operation = handle().catch(error => {
      if (response.headersSent || response.destroyed) response.destroy();
      else send({ error: /^[A-Z0-9_]{1,100}$/.test(String(error.code ?? ''))
        ? error.code : 'COLLECTION_OPERATION_FAILED' }, errorStatus(error));
    });
    work.add(operation);
    operation.finally(() => work.delete(operation));
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      origin = 'http://127.0.0.1:' + server.address().port;
      done();
    });
  });
  let closePromise;
  return { server, origin, token, url: origin + '/#' + token,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        server.closeIdleConnections?.();
        await Promise.allSettled([...work]);
        await new Promise(done => {
          server.close(done);
          server.closeAllConnections?.();
        });
        reviews.clear(); exports.clear();
      })();
      return closePromise;
    },
  };
}
export async function startCollectionsWorkspace(options = {}) {
  const collections = await openCollections({
    directory: options.directory, queueRoot: options.queueRoot,
  });
  let workspace;
  try { workspace = await serveCollections(collections, { port: options.port ?? 0 }); }
  catch (error) { await collections.close(); throw error; }
  const closeServer = workspace.close;
  let closing;
  workspace.close = () => closing ??= (async () => {
    try { await closeServer(); } finally { await collections.close(); }
  })();
  return { ...workspace, collections };
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) {
    console.log(HELP); return;
  }
  const input = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    need(['--directory', '--queue-root', '--port'].includes(key)
      && value !== undefined && !Object.hasOwn(input, key), 'COLLECTION_CLI_ARGUMENT');
    input[key] = value;
  }
  need(input['--directory'] && isAbsolute(input['--directory']), 'COLLECTION_DIRECTORY_REQUIRED');
  const port = input['--port'] ?? '0';
  need(/^\d{1,5}$/.test(port) && Number(port) <= 65535, 'PORT_INVALID');
  const workspace = await startCollectionsWorkspace({
    directory: input['--directory'], queueRoot: input['--queue-root'], port: Number(port),
  });
  console.log('Request collections: ' + workspace.url);
  console.log('Keep this terminal open. Approve selected paid requests in a separate terminal.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    await workspace.close();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return workspace;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
