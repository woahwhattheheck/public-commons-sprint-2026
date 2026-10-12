// MIT. One private loopback browser over the original DuckDB merchant workflow.
import { createServer } from 'node:http';
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LIMITS } from '../cloud-delivery/contract.mjs';
import { CLOUD_UPLOAD_CHUNK_BYTES } from '../cloud-delivery/uploads.mjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createDuckdbWorkspace, WorkspaceError, publicIssue } from './model.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/author.mjs', ['author.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/cloud.mjs', ['../../cloud-delivery/public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/cloud.css', ['../../cloud-delivery/public/style.css', 'text/css; charset=utf-8']],
]);
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': POLICY, 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
function send(res, status, value, type = 'application/json; charset=utf-8', headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  res.writeHead(status, { ...HEADERS, 'content-type': type, 'content-length': bytes.length, ...headers });
  res.end(bytes);
}
function authorized(req, token) {
  const value = req.headers['x-duckdb-workspace'];
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
async function body(req, waiting, maximum = 270336) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new WorkspaceError('JSON_BODY_REQUIRED', 415);
  if (Number(req.headers['content-length'] ?? 0) > maximum) throw new WorkspaceError('REQUEST_TOO_LARGE', 413);
  const chunks = []; let bytes = 0;
  const expired = setTimeout(() => req.destroy(), 10000);
  waiting.add(req);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maximum) throw new WorkspaceError('REQUEST_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new WorkspaceError('INVALID_JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new WorkspaceError('JSON_OBJECT_REQUIRED');
    return result;
  } finally { clearTimeout(expired); waiting.delete(req); }
}

function query(url, required, optional = []) {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || required.some(key => !url.searchParams.has(key)) ||
      keys.some(key => ![...required, ...optional].includes(key))) throw new WorkspaceError('CLOUD_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
async function download(res, descriptor, waiting, signal) {
  signal.throwIfAborted();
  // Own the response before the first filesystem await, so shutdown also sees
  // a download whose descriptor or stream has not finished opening yet.
  waiting.add(res);
  let handle, stream, source;
  try {
    handle = await open(descriptor.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    signal.throwIfAborted();
    const stat = await handle.stat({ bigint: true });
    signal.throwIfAborted();
    const prefix = Buffer.from(descriptor.prefix ?? '');
    if (!stat.isFile()) throw new WorkspaceError('CLOUD_DOWNLOAD_INVALID');
    const length = stat.size + BigInt(prefix.length);
    if (descriptor.bytes !== undefined && length !== BigInt(descriptor.bytes))
      throw new WorkspaceError('CLOUD_DOWNLOAD_CHANGED', 409);
    const filename = String(descriptor.filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
    res.writeHead(200, { ...HEADERS, 'content-type': descriptor.type,
      'content-length': String(length), 'content-disposition': 'attachment; filename="' + filename + '"' });
    stream = handle.createReadStream({ autoClose: false });
    // Prefix and original bytes share the same backpressure and cancellation.
    // There is no separate drain waiter outside the owned download lifecycle.
    source = prefix.length ? Readable.from((async function* () {
      yield prefix;
      yield* stream;
    })(), { objectMode: false }) : stream;
    waiting.add(source);
    await pipeline(source, res, { signal });
  } finally {
    source?.destroy();
    if (stream !== source) stream?.destroy();
    waiting.delete(source);
    waiting.delete(res);
    await handle?.close();
  }
}

export async function startDuckdbWorkspace({ port = 8437, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new WorkspaceError('INVALID_LISTENER_PORT');
  const assets = new Map(await Promise.all([...ASSETS].map(async ([path, [name, type]]) =>
    [path, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type }])));
  const token = randomBytes(32).toString('hex'), waiting = new Set(),instanceId=randomUUID();
  const lifetime = new AbortController();
  let origin, model, closing = false, closePromise;
  const server = createServer((req, res) => {
    Promise.resolve().then(async () => {
      if (closing || !model) throw new WorkspaceError('WORKSPACE_CLOSING', 503);
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin)
        throw new WorkspaceError('WORKSPACE_ORIGIN_REQUIRED', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048)
        throw new WorkspaceError('INVALID_REQUEST_TARGET', 400);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return send(res, 200, asset.bytes, asset.type);
      }
      if (!authorized(req, token)) throw new WorkspaceError('WORKSPACE_KEY_REQUIRED', 401,
        'Open the private workspace URL printed by its launcher.');
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
        throw new WorkspaceError('WORKSPACE_ORIGIN_REQUIRED', 403);
      if(req.method==='GET'&&url.pathname==='/api/identity'&&!url.search)
        return send(res,200,{schema:'stellar-forge.duckdb-workspace-listener.v1',workspaceId:model.workspaceId,instanceId,pid:process.pid});
      if (req.method === 'GET' && url.pathname === '/api/state' && !url.search)
        return send(res, 200, await model.state());
      if (req.method === 'GET' && url.pathname === '/api/runtime' && !url.search)
        return send(res, 200, model.runtime());
      if (req.method === 'GET' && url.pathname === '/api/draft') {
        const keys = [...url.searchParams.keys()], value = url.searchParams.get('revision');
        if (keys.length !== 1 || keys[0] !== 'revision' || !/^[1-9]\d{0,12}$/.test(value ?? ''))
          throw new WorkspaceError('INVALID_DRAFT_REVISION');
        return send(res, 200, model.draft(Number(value)));
      }
      if (req.method === 'GET' && url.pathname === '/api/artifact') {
        const keys = [...url.searchParams.keys()];
        if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(key => !['package', 'name'].includes(key)))
          throw new WorkspaceError('INVALID_ARTIFACT_REQUEST');
        const name = url.searchParams.get('name');
        const artifact = await model.artifact({ packageId: url.searchParams.get('package'), name });
        return send(res, 200, artifact.bytes, artifact.type + '; charset=utf-8',
          { 'content-disposition': 'attachment; filename="' + name.replaceAll('/', '-') + '"' });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/cloud/')) {
        if (url.pathname === '/api/cloud/state' && !url.search) return send(res, 200, await model.cloud.state());
        if (['/api/cloud/edition', '/api/cloud/intake'].includes(url.pathname)) {
          const { id } = query(url, ['id']); return send(res, 200, await model.cloud.edition(id));
        }
        if(url.pathname==='/api/cloud/operation'){
          const {operationId}=query(url,['operationId']);return send(res,200,await model.cloud.operation({operationId}));
        }
        if(url.pathname==='/api/cloud/upload-status'){
          const {edition,file}=query(url,['edition','file']);
          return send(res,200,await model.cloud.uploadStatus({editionId:edition,fileId:file}));
        }
        if(url.pathname==='/api/cloud/received-draft'){
          const {receivingId}=query(url,['receivingId']);return send(res,200,await model.cloud.receivedDraft({receivingId}));
        }
        if (url.pathname === '/api/cloud/comparison') {
          const input = query(url, ['id'], ['offset', 'limit']);
          for (const key of ['offset', 'limit']) if (input[key] !== undefined) {
            if (!/^(0|[1-9]\d{0,8})$/.test(input[key])) throw new WorkspaceError('CLOUD_PAGINATION_INVALID');
            input[key] = Number(input[key]);
          }
          return send(res, 200, await model.cloud.comparison(input));
        }
        if (url.pathname === '/api/cloud/file') {
          const { edition, file } = query(url, ['edition', 'file']);
          return download(res, await model.cloud.file({ editionId: edition, fileId: file }), waiting, lifetime.signal);
        }
        if (url.pathname === '/api/cloud/report') {
          const input = query(url, ['id'], ['kind']);
          if (input.kind !== undefined && input.kind !== 'summary') throw new WorkspaceError('CLOUD_REPORT_KIND_INVALID');
          return download(res, await model.cloud.report(input), waiting, lifetime.signal);
        }
        if (url.pathname === '/api/cloud/delivery') {
          const input = query(url, ['id'], ['kind']);
          if (input.kind === 'summary') {
            const state = await model.cloud.state(), delivery = state.deliveries.find(item => item.id === input.id);
            if (!delivery) throw new WorkspaceError('CLOUD_DELIVERY_NOT_FOUND', 404);
            return send(res, 200, { delivery });
          }
          if (input.kind !== undefined) throw new WorkspaceError('CLOUD_REPORT_KIND_INVALID');
          return download(res, await model.cloud.delivery(input), waiting, lifetime.signal);
        }
      }
      if(req.method==='PUT'&&url.pathname==='/api/cloud/upload-chunk'){
        const {edition,file,offset,sha256}=query(url,['edition','file','offset','sha256']);
        const length=req.headers['content-length'];
        if(!/^(0|[1-9][0-9]{0,10})$/.test(length??'')||Number(length)>CLOUD_UPLOAD_CHUNK_BYTES)
          throw new WorkspaceError('CLOUD_UPLOAD_CHUNK_LENGTH_REQUIRED',411);
        if(!/^application\/octet-stream(?:\s*;|$)/i.test(req.headers['content-type']??''))
          throw new WorkspaceError('CLOUD_UPLOAD_BINARY_REQUIRED',415);
        const chunks=[];let size=0;waiting.add(req);
        const timer=setTimeout(()=>req.destroy(),120000);
        try{
          for await(const chunk of req){size+=chunk.length;if(size>Number(length))throw new WorkspaceError('CLOUD_UPLOAD_LENGTH_MISMATCH');chunks.push(chunk);}
          if(size!==Number(length))throw new WorkspaceError('CLOUD_UPLOAD_LENGTH_MISMATCH');
          return send(res,200,await model.cloud.uploadChunk({editionId:edition,fileId:file,offset,sha256,data:Buffer.concat(chunks,size)}));
        }finally{clearTimeout(timer);waiting.delete(req);}
      }
      if (req.method === 'PUT' && url.pathname === '/api/cloud/upload') {
        const { edition, file } = query(url, ['edition', 'file']);
        if (!/^(0|[1-9]\d{0,11})$/.test(req.headers['content-length'] ?? '') ||
            BigInt(req.headers['content-length']) > BigInt(LIMITS.totalBytes))
          throw new WorkspaceError('CLOUD_UPLOAD_LENGTH_REQUIRED', 411);
        const controller = new AbortController(), abort = () => controller.abort();
        const timer = setTimeout(() => { abort(); req.destroy(); }, 120000);
        waiting.add(req); req.once('aborted', abort);
        try { return send(res, 200, await model.cloud.upload({ editionId: edition, fileId: file,
          stream: req, signal: controller.signal })); }
        finally { clearTimeout(timer); req.removeListener('aborted', abort); waiting.delete(req); }
      }
      const cloudActions = new Map(['intake', 'import', 'commit', 'compare', 'review', 'select', 'export', 'receive', 'uploadChunk']
        .map(name => ['/api/cloud/' + name, input => model.cloud[name](input)]));
      if (req.method === 'POST' && cloudActions.has(url.pathname) && !url.search)
        return send(res, 200, await cloudActions.get(url.pathname)(await body(req, waiting, LIMITS.manifestBytes)));
      const actions = new Map([
        ['/api/draft', input => model.save(input)], ['/api/review', input => model.review(input)],
        ['/api/cloud/adopt-draft',input=>model.adoptReceivedDraft(input)],
        ['/api/prepare', input => model.prepare(input)], ['/api/inspect', input => model.inspect(input)],
        ['/api/start', input => model.start(input)], ['/api/stop', input => model.stop(input)],
        ['/api/preview', input => model.preview(input)],
        ['/api/catalog', input => model.catalog(input)], ['/api/author/review', input => model.authorReview(input)],
        ['/api/author/reopen', input => model.reopenAuthor(input)],
      ]);
      if (req.method === 'POST' && actions.has(url.pathname) && !url.search)
        return send(res, 200, await actions.get(url.pathname)(await body(req, waiting)));
      throw new WorkspaceError('WORKSPACE_ROUTE_NOT_FOUND', 404);
    }).catch(error => {
      const issue = publicIssue(error);
      if (!res.headersSent) send(res, issue.status, issue);
      else res.destroy();
    });
  });
  server.requestTimeout = 125000; server.headersTimeout = 10000; server.keepAliveTimeout = 1500;
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', fail); done(); });
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  try { model = await createDuckdbWorkspace({ ...options, navigationOrigin: origin }); }
  catch (error) {
    lifetime.abort();
    server.closeAllConnections(); await new Promise(done => server.close(done)); throw error;
  }
  return {
    origin, url: origin + '/#key=' + token, model, instanceId,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      lifetime.abort();
      for (const resource of waiting) resource.destroy();
      const listenerClosed = new Promise(done => server.close(done));
      server.closeIdleConnections();
      const pending=Promise.all([model.close(),listenerClosed]).then(()=>undefined);
      closePromise=pending;void pending.catch(()=>{if(closePromise===pending)closePromise=null;});
      return closePromise;
    },
  };
}
