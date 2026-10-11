#!/usr/bin/env node
// MIT. Private loopback transport for the native MongoDB merchant workspace.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openMongoWorkbench } from './model.mjs';

const HELP = [
  'MongoDB merchant workspace — Node 22+, private loopback browser',
  '',
  '  node workspace/server.mjs --state NEW_DIRECTORY --source SOURCE.json --plan MERCHANT_PLAN.json [--port 0]',
  '  node workspace/server.mjs --state EXISTING_DIRECTORY [--port 0]',
  '  Add --dataset-facilitator HTTPS_URL to use the original native x402 dataset seller.',
  '  Local facilitator development also requires --allow-local-dataset-facilitator.',
  '',
  'Use the exact printed browser URL. Database credentials stay in the launch environment.',
  'Save native revisions, inspect BSON schemas, run fixed reports, prepare seller/client packages,',
  'start the original local seller, publish immutable datasets, schedule complete native refreshes,',
  'and prepare original buyer requests for the selected retained snapshot.',
].join('\n');
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/publisher.mjs', ['publisher.mjs', 'text/javascript; charset=utf-8']],
  ['/publisher-schedules.mjs', ['../../../postgres/publisher/public/schedules.mjs', 'text/javascript; charset=utf-8']]]);
const publicationFields = {
  plans: ['title', 'query', 'input', 'sourceHash', 'dataset', 'extraction'],
  extract: ['id', 'plan'], cancel: ['id'], review: ['id', 'reviewer', 'note', 'initialize', 'expectedSnapshot', 'expectedRevision'],
  publish: ['id', 'reviewId'], recover: ['id'], 'seller/start': [], 'seller/stop': [],
  activate: ['snapshot', 'expectedSnapshot', 'expectedRevision'],
  buyer: ['id', 'query', 'intentId', 'acceptIndex', 'offerSha256'],
  'schedule/save': ['referenceRun', 'planDigest', 'expectedSnapshot', 'expectedRevision', 'revision',
    'intervalSeconds', 'minimumRows', 'maximumRows', 'maximumDropPercent', 'onError', 'reviewer', 'note'],
  'schedule/enable': ['revision', 'expectedSnapshot', 'expectedRevision'], 'schedule/pause': ['revision'],
  'schedule/run': ['revision', 'requestId'], 'schedule/continue': ['revision'],
};
function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length }); res.end(body);
}
async function body(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw Object.assign(new TypeError('Send application/json'), { status: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new RangeError('Source and merchant plan exceed 1 MiB'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new TypeError('Send a valid UTF-8 JSON object'); }
}
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError('Unsupported request fields');
  return value;
}
const revision = value => {
  const number = typeof value === 'number' ? value : /^\d+$/.test(value ?? '') ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > 100000000) throw new TypeError('Select a saved revision');
  return number;
};
export async function startMongoWorkbench(options = {}) {
  const { port = 0, ...modelOptions } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be 0–65535');
  const model = await openMongoWorkbench(modelOptions), token = randomBytes(32).toString('base64url');
  const expected = Buffer.from('Bearer ' + token); let origin, closing = false, pending = Promise.resolve();
  const mutate = action => { const result = pending.then(action); pending = result.catch(() => {}); return result; };
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    Promise.resolve().then(async () => {
      if (closing) return json(res, 503, { error: 'Workspace is closing' });
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Use the printed loopback origin' });
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.hash) return json(res, 400, { error: 'Invalid request target' });
      if (assets.has(url.pathname) && req.method === 'GET' && !url.search) {
        const [name, type] = assets.get(url.pathname), bytes = await readFile(new URL('./public/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': type, 'content-length': bytes.length }); return res.end(bytes);
      }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      const provided = Buffer.from(req.headers.authorization ?? '');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return json(res, 401, { error: 'Open the complete workspace URL printed by the launch terminal' });
      if (req.headers.origin && req.headers.origin !== origin || req.method !== 'GET' && req.headers.origin !== origin)
        return json(res, 403, { error: 'Workspace changes require its exact browser origin' });
      let result;
      const publicationPath = /^\/api\/publications\/([a-z0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
      if (req.method === 'GET') {
        if (url.pathname === '/api/bootstrap') result = await model.bootstrap();
        else if (url.pathname === '/api/history') result = await model.history({
          ...(url.searchParams.has('before') ? { before: revision(url.searchParams.get('before')) } : {}), limit: 20 });
        else if (/^\/api\/history\/\d+$/.test(url.pathname)) result = await model.revision(revision(url.pathname.split('/').at(-1)));
        else if (url.pathname === '/api/packages') result = await model.packages();
        else if (/^\/api\/packages\/[a-z0-9-]+$/.test(url.pathname)) result = await model.inspectPackage(url.pathname.split('/').at(-1));
        else if (url.pathname === '/api/seller') result = model.seller();
        else if (url.pathname === '/api/publications') result = await model.publications();
        else if (publicationPath) {
          const [, id, operation] = publicationPath;
          if (!operation) {
            const options = {};
            for (const name of ['limit', 'plansOffset', 'runsOffset', 'historyOffset'])
              if (url.searchParams.has(name)) options[name] = Number(url.searchParams.get(name));
            result = await model.inspectPublication(id, options);
          } else if (operation === 'run' || operation === 'buyer') {
            result = await model.readPublication(id, operation, { id: url.searchParams.get('id'),
              ...(url.searchParams.has('query') ? { query: url.searchParams.get('query') } : {}) });
          } else if (/^plans\/\d+$/.test(operation)) result = await model.readPublication(id, 'plan', { id: Number(operation.split('/')[1]) });
          else if (operation === 'schedule') result = await model.readPublication(id, 'schedule', {
            ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
            ...(url.searchParams.has('offset') ? { offset: Number(url.searchParams.get('offset')) } : {}) });
          else if (/^files\/[a-f0-9-]+\/(?:data\.csv|dataset\.json|candidate\.json)$/.test(operation)) {
            const [, runId, name] = operation.split('/'), file = await model.publicationDownload(id, runId, name);
            res.writeHead(200, { 'content-type': file.mime, 'content-length': file.size,
              'content-disposition': 'attachment; filename="' + file.name + '"' });
            return pipeline(file.handle.createReadStream(), res);
          } else return json(res, 404, { error: 'Not found' });
        }
        else if (url.pathname.startsWith('/api/files/')) {
          const parts = url.pathname.split('/');
          if (parts.length < 6 || parts.length > 7) return json(res, 404, { error: 'Not found' });
          const file = await model.download(parts[3], parts[4], parts.slice(5).map(decodeURIComponent).join('/'));
          res.writeHead(200, { 'content-type': file.mime, 'content-length': file.bytes.length,
            'content-disposition': 'attachment; filename="' + file.name + '"' }); return res.end(file.bytes);
        } else return json(res, 404, { error: 'Not found' });
      } else if (req.method === 'POST') {
        const value = await body(req);
        if (url.pathname === '/api/review') { fields(value, ['source', 'plan']); result = model.review(value.source, value.plan); }
        else if (url.pathname === '/api/save') { fields(value, ['expectedRevision', 'source', 'plan']); revision(value.expectedRevision); result = await mutate(() => model.save(value)); }
        else if (url.pathname === '/api/catalogue') { fields(value, ['expectedRevision', 'collections', 'sampleSize']); revision(value.expectedRevision); result = await mutate(() => model.catalogue(value)); }
        else if (url.pathname === '/api/preview') { fields(value, ['expectedRevision', 'query', 'input']); revision(value.expectedRevision); result = await mutate(() => model.preview(value)); }
        else if (url.pathname === '/api/prepare') { fields(value, ['expectedRevision']); revision(value.expectedRevision); result = await mutate(() => model.prepare(value)); }
        else if (url.pathname === '/api/seller/start') { fields(value, ['packageId']); result = await mutate(() => model.startSeller(value.packageId)); }
        else if (url.pathname === '/api/seller/stop') { fields(value, []); result = await mutate(() => model.stopSeller()); }
        else if (url.pathname === '/api/buyer') {
          fields(value, ['packageId', 'routeId', 'input', 'acceptIndex', 'intentId']); result = await mutate(() => model.buyer(value));
        } else if (url.pathname === '/api/publications') {
          fields(value, ['expectedRevision', 'routeId', 'path']); revision(value.expectedRevision);
          result = await mutate(() => model.createPublication(value));
        } else if (publicationPath && Object.hasOwn(publicationFields, publicationPath[2])) {
          const [, id, operation] = publicationPath; fields(value, publicationFields[operation]);
          result = await mutate(() => model.changePublication(id, operation, value));
        } else return json(res, 404, { error: 'Not found' });
      } else return json(res, 405, { error: 'Use GET or POST' });
      json(res, 200, result);
    }).catch(error => {
      if (res.headersSent) return res.destroy();
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : 400);
      json(res, status, { error: error.message });
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  let shutdown;
  const close = () => shutdown ??= (async () => {
    closing = true;
    const stopped = new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
    server.closeIdleConnections();
    await pending; await model.close(); await stopped;
  })();
  return { server, model, origin, url: origin + '/#' + token, close };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {}, map = { '--state': 'directory', '--source': 'sourcePath', '--plan': 'planPath',
    '--port': 'port', '--dataset-facilitator': 'datasetFacilitator' };
  let allowLocalDatasetFacilitator = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--allow-local-dataset-facilitator') {
      if (allowLocalDatasetFacilitator) throw new TypeError(HELP);
      allowLocalDatasetFacilitator = true; index++; continue;
    }
    const name = map[args[index]], value = args[index + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw new TypeError(HELP);
    if (name === 'port') {
      if (!/^(0|[1-9]\d{0,4})$/.test(value)) throw new TypeError('Port must be 0–65535');
      options[name] = Number(value);
    } else options[name] = name === 'datasetFacilitator' ? value : resolve(value);
    index += 2;
  }
  if (allowLocalDatasetFacilitator && !options.datasetFacilitator) throw new TypeError(HELP);
  if (options.datasetFacilitator) {
    const url = new URL(options.datasetFacilitator);
    const local = allowLocalDatasetFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Dataset facilitator requires HTTPS or explicitly enabled local HTTP');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../../native-factory.mjs') ]);
    options.datasetNativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
    delete options.datasetFacilitator;
  }
  const session = await startMongoWorkbench(options);
  console.log(JSON.stringify({ mongodbWorkspace: session.url, directory: session.model.root }));
  const stop = () => session.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
