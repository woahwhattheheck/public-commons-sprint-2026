// MIT. Private industrial workspace for original water-data operations.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { openWaterProject, operationId } from './project.mjs';
import { prepareWaterPurchase, purchaseWaterEdition, reopenWaterPurchase } from './merchant.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = new Map([['/', ['ui/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['ui/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['ui/style.css', 'text/css; charset=utf-8']]]);
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message, code = 'WATER_WORKSPACE_INVALID', status = 400) { throw Object.assign(new Error(message), { code, status }); }
function sameToken(value, expected) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) fail('Send a JSON request.');
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length; if (size > 2 * 1024 * 1024) fail('The workspace request is too large.', 'WATER_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('Send one complete UTF-8 JSON object.'); }
}
function publicError(error) {
  return { code: error.code ?? 'WATER_OPERATION_FAILED',
    message: typeof error.status === 'number' || error.code?.startsWith('WATER_') || error.code?.startsWith('USGS_')
      ? error.message : error.code === 'ENOENT' ? 'The original saved record is unavailable.' : 'The operation could not complete. Its saved input and completed source pages remain available.',
    retryAt: error.retryAt ?? null, retryAfter: error.retryAfter ?? null };
}
function publicPurchase(value) {
  if (!value || typeof value !== 'object') return value;
  const { result, ...metadata } = value;
  return { ...metadata, ...(result ? { nativeResult: { status: result.status, ok: result.ok, delivery: result.delivery } } : {}) };
}
function plainRuntime(session, editionId) {
  return { running: Boolean(session), editionId: editionId ?? null, merchantUrl: session?.merchantUrl ?? session?.url ?? null,
    paths: session?.paths ?? null, mode: session?.mode ?? null, snapshot: typeof session?.snapshot === 'function' ? null : session?.snapshot ?? null };
}
export async function startWaterWorkspace({ directory, port = 0, merchantPort = 0, nativeFactory, facilitator, transport, buyer, env = process.env } = {}) {
  const project = await openWaterProject(resolve(directory), { transport, env });
  const token = randomBytes(32).toString('hex'), jobs = new Map(), purchasePlans = new Map();
  let origin, activeMerchant, activeEditionId, closing, stopping = false;
  let mutations = Promise.resolve();
  function serial(work) {
    const promise = mutations.then(() => { if (stopping) fail('The workspace is closing.', 'WATER_WORKSPACE_CLOSED', 503); return work(); });
    mutations = promise.catch(() => {}); return promise;
  }
  const send = (response, status, value, mime = 'application/json; charset=utf-8', filename) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : json(value));
    response.writeHead(status, { 'content-type': mime, 'content-length': bytes.length, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      ...(filename ? { 'content-disposition': 'attachment; filename="' + filename.replace(/[^A-Za-z0-9_.-]/g, '_') + '"' } : {}) });
    response.end(bytes);
  };
  async function view() {
    return { project: await project.read(), captures: await project.listCaptures(), reviews: await project.listReviews(),
      editions: await project.listEditions(), runtime: plainRuntime(activeMerchant, activeEditionId),
      buyerConfigured: Boolean(buyer), jobs: [...jobs.values()].map(({ promise, ...row }) => row), token };
  }
  function startJob(id, work) {
    if (jobs.get(id)?.status === 'RUNNING') fail('This operation is already running.', 'WATER_OPERATION_ACTIVE', 409);
    const record = { id, status: 'RUNNING', startedAt: new Date().toISOString(), progress: null };
    jobs.set(id, record);
    record.promise = Promise.resolve().then(() => work(value => { record.progress = value; })).then(result => {
      record.status = result.status ?? 'COMPLETE'; record.result = result; record.completedAt = new Date().toISOString(); return result;
    }, error => { record.status = 'FAILED'; record.error = publicError(error); record.completedAt = new Date().toISOString(); });
    return { id, status: record.status };
  }
  const server = createServer(async (request, response) => {
    try {
      if (!origin || request.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress))
        fail('Open the workspace through its printed local address.', 'WATER_LOCAL_ONLY', 403);
      if (request.headers.origin && request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')
        fail('Use the open workspace page to make this request.', 'WATER_ORIGIN_MISMATCH', 403);
      const url = new URL(request.url, origin), path = url.pathname;
      let match;
      if (request.method === 'GET' && STATIC.has(path)) {
        const [file, mime] = STATIC.get(path); return send(response, 200, await readFile(join(HERE, file)), mime);
      }
      if (request.method === 'GET' && path === '/api/workspace') return send(response, 200, await view());
      if (request.method === 'GET' && path === '/api/status')
        return send(response, 200, { captures: await project.listCaptures(), runtime: plainRuntime(activeMerchant, activeEditionId),
          jobs: [...jobs.values()].map(({ promise, ...row }) => row) });
      if (request.method === 'GET' && (match = /^\/api\/reviews\/([A-Za-z0-9_-]+)(?:\/(html|json|csv|geojson))?$/.exec(path))) {
        if (!match[2]) return send(response, 200, await project.readReview(match[1]));
        const exported = await project.exportReview({ reviewId: match[1], format: match[2] });
        return send(response, 200, exported.bytes, exported.mime, exported.filename);
      }
      if (request.method === 'GET' && (match = /^\/api\/captures\/([A-Za-z0-9_-]+)(?:\/pages\/(\d+))?$/.exec(path))) {
        const capture = await project.capture(match[1]);
        if (match[2] === undefined) return send(response, 200, capture);
        const index = Number(match[2]), page = capture.pages?.[index];
        if (!page) fail('Choose an original response page from this capture.', 'WATER_PAGE_NOT_FOUND', 404);
        const relative = page.bodyFile;
        if (typeof relative !== 'string' || isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '..'))
          fail('The original page path changed.', 'WATER_PAGE_CHANGED', 409);
        const file = join(capture.directory, relative);
        if (await realpath(file) !== file || !(await stat(file)).isFile()) fail('The retained source page changed.', 'WATER_PAGE_CHANGED', 409);
        const bytes = await readFile(file), hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== (page.sha256 ?? page.bodySha256)) fail('The original source page changed.', 'WATER_PAGE_CHANGED', 409);
        return send(response, 200, bytes, 'application/geo+json', match[1] + '-page-' + index + '.geojson');
      }
      if (request.method === 'GET' && (match = /^\/api\/editions\/([A-Za-z0-9_-]+)$/.exec(path)))
        return send(response, 200, await project.readEdition(match[1]));
      if (request.method !== 'POST') fail('Workspace route not found.', 'WATER_ROUTE_NOT_FOUND', 404);
      if (!sameToken(request.headers['x-workspace-token'], token)) fail('Refresh the workspace before making a change.', 'WATER_TOKEN_MISMATCH', 403);
      const input = await body(request);
      if (path === '/api/captures') {
        const id = operationId(input.operationId ?? randomUUID());
        return send(response, 202, startJob(id, progress => project.acquire({ operationId: id, expectedRevision: input.expectedRevision, onProgress: progress })));
      }
      if ((match = /^\/api\/captures\/([A-Za-z0-9_-]+)\/cancel$/.exec(path))) return send(response, 200, project.cancelCapture(match[1]));
      if (path === '/api/analysis') return send(response, 200, await project.analyze(input));
      const result = await serial(async () => {
        if (path === '/api/project') return project.save(input);
        if (path === '/api/reviews') return project.saveReview(input);
        if (path === '/api/editions') return project.prepareEdition(input);
        if (path === '/api/merchant/stage') {
          if (activeMerchant && input.editionId === activeEditionId) fail('Stop this running merchant before changing its launch configuration.', 'WATER_MERCHANT_RUNNING', 409);
          return project.stageEdition(input);
        }
        if (path === '/api/merchant/start') {
          if (activeMerchant) fail('Stop the current merchant before starting another edition.', 'WATER_MERCHANT_RUNNING', 409);
          activeMerchant = await project.startEdition({ ...input, port: merchantPort, nativeFactory, facilitator });
          activeEditionId = input.editionId;
          return plainRuntime(activeMerchant, activeEditionId);
        }
        if (path === '/api/merchant/stop') {
          const result = activeMerchant ? await activeMerchant.close() : { alreadyStopped: true };
          activeMerchant = null; activeEditionId = null; return result;
        }
        if (path === '/api/customer/prepare') {
          if (!buyer) fail('Open this workspace with an original buyer configuration to prepare a purchase.', 'WATER_BUYER_REQUIRED', 409);
          const editionId = operationId(input.editionId), edition = await project.readEdition(editionId);
          const intentId = operationId(input.intentId ?? randomUUID());
          const prepared = await prepareWaterPurchase({ editionDirectory: edition.directory, intentId, query: input.query ?? {}, file: input.file,
            kind: input.kind, previous: input.previous ?? null, acceptIndex: input.acceptIndex ?? 0 });
          purchasePlans.set(intentId, { editionId, prepared });
          return { intentId, editionId, prepared };
        }
        if (path === '/api/customer/execute') {
          if (!buyer) fail('This workspace has no original buyer configuration.', 'WATER_BUYER_REQUIRED', 409);
          const plan = purchasePlans.get(operationId(input.intentId));
          if (!plan) fail('Prepare or reopen this intent in the original buyer before executing it.', 'WATER_PURCHASE_NOT_PREPARED', 409);
          const result = await purchaseWaterEdition({ buyer, prepared: plan.prepared });
          return { intentId: input.intentId, editionId: plan.editionId, result: publicPurchase(result) };
        }
        if (path === '/api/customer/reopen') {
          if (!buyer) fail('This workspace has no original buyer configuration.', 'WATER_BUYER_REQUIRED', 409);
          const edition = await project.readEdition(operationId(input.editionId));
          return publicPurchase(await reopenWaterPurchase({ buyer, intentId: operationId(input.intentId), editionDirectory: edition.directory }));
        }
        fail('Workspace route not found.', 'WATER_ROUTE_NOT_FOUND', 404);
      });
      send(response, 200, result);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      send(response, Number.isInteger(error.status) ? error.status : error.code === 'ENOENT' ? 404 : 500, { error: publicError(error) });
    }
  });
  server.requestTimeout = 180000; server.headersTimeout = 15000;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  } catch (error) { await project.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  function close() {
    return closing ??= (async () => {
      stopping = true;
      const closed = new Promise(done => { server.close(done); server.closeIdleConnections?.(); });
      await project.close();
      await Promise.allSettled([...jobs.values()].map(row => row.promise));
      await mutations; await activeMerchant?.close(); activeMerchant = null;
      server.closeIdleConnections?.(); await closed; return { closed: true };
    })();
  }
  return { url: origin, server, project, view, close };
}
