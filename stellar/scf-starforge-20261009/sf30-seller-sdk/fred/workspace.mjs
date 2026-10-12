// MIT. Private industrial operator UI over the maintained FRED project and native engines.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { readPrivateJson } from '../routescan/quota.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { need, inspectCapture, MAX_CAPTURE_BYTES, operationId } from './model.mjs';
import { jsonBytes } from './source.mjs';
import { readFredProject, fredProjectView, getFredCapture, configureFredProject, importFredCapture, acquireFredCapture,
  selectFredCapture, reviewFredCapture, compareFredCaptures, publishFredReview, exportFredProject,
  selectFredPublication, abandonFredOperation } from './project.mjs';
import { startFredMerchant, readFredMerchant, prepareFredPurchase, executeFredPurchase,
  recoverFredPurchase, exportFredPurchase } from './merchant.mjs';

const securityHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
function send(res, status, value, contentType = 'application/json; charset=utf-8', filename) {
  const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  res.writeHead(status, { ...securityHeaders, 'content-type': contentType, 'content-length': bytes.length,
    ...(filename ? { 'content-disposition': 'attachment; filename="' + filename + '"' } : {}) });
  res.end(bytes);
}
async function body(req, max = MAX_CAPTURE_BYTES * 2) {
  need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''), 'Use a JSON request.', 'FRED_JSON_REQUIRED', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; need(size <= max, 'Request exceeds its source capacity.', 'FRED_REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { need(false, 'Request is not complete JSON.'); }
}
function pageNumber(value, max = 1000000) {
  need(value === null || /^\d+$/.test(value) && Number(value) <= max, 'Invalid page offset.');
  return Number(value ?? 0);
}
function output(value) {
  if (!value || typeof value !== 'object') return value;
  const { result, ...plain } = value;
  return plain;
}
export async function startFredWorkspace({ directory, port = 0, buyerConfig, environment = process.env,
  facilitator, allowLocalFacilitator = false } = {}) {
  directory = resolve(directory);
  await readFredProject(directory);
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'Use an available local port.');
  const token = randomBytes(32).toString('hex'), abort = new AbortController(), assetMap = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']] ]);
  const assets = new Map();
  for (const [route, [file, type]] of assetMap) assets.set(route, [await readFile(new URL('./ui/' + file, import.meta.url)), type]);
  const buyer = buyerConfig ? await new Buyer(await readPrivateJson(resolve(buyerConfig), 65536)).ready() : null;
  let merchant = null, runningPublication = null, pending = null, closing = false, origin;
  const runtimeView = () => merchant ? { publicationId: runningPublication, url: merchant.url, mode: merchant.mode,
    editionId: merchant.editionId, snapshot: merchant.snapshot, resource: merchant.resource } : null;
  const run = async request => {
    const id = request.id, expectedRevision = request.expectedRevision, common = { directory, id, expectedRevision };
    switch (request.action) {
      case 'configure': return configureFredProject({ ...common, selection: request.selection });
      case 'capture': return acquireFredCapture({ ...common, environment, signal: abort.signal });
      case 'import': return importFredCapture({ ...common, capture: request.capture });
      case 'select': return selectFredCapture({ ...common, captureId: request.captureId });
      case 'review': return reviewFredCapture({ ...common, captureId: request.captureId, policy: request.policy, note: request.note });
      case 'publish': return publishFredReview({ ...common, reviewId: request.reviewId, origin: request.origin, path: request.path, payment: request.payment });
      case 'abandon': return abandonFredOperation({ ...common, pendingId: request.pendingId });
      case 'merchant-start': {
        need(!merchant, 'Stop the currently owned merchant before selecting another publication.', 'FRED_MERCHANT_RUNNING', 409);
        const selected = await selectFredPublication(directory, request.publicationId);
        merchant = await startFredMerchant({ directory: selected, port: 0, facilitator, allowLocalFacilitator });
        runningPublication = request.publicationId; return runtimeView();
      }
      case 'merchant-stop': {
        need(!merchant || request.publicationId === runningPublication, 'Choose the original running merchant.', 'FRED_MERCHANT_CHANGED', 409);
        if (merchant) await merchant.close();
        merchant = null; runningPublication = null; return { state: 'STOPPED' };
      }
      case 'prepare': {
        const selected = await selectFredPublication(directory, request.publicationId);
        return prepareFredPurchase({ directory: selected, intentId: request.intentId, query: new URLSearchParams(request.query ?? ''),
          file: request.file ?? null, previous: request.previous ?? null, acceptIndex: request.acceptIndex ?? 0 });
      }
      case 'buy': {
        need(buyer, 'Start this workspace with the existing buyer configuration.', 'FRED_BUYER_REQUIRED');
        const selected = await selectFredPublication(directory, request.publicationId);
        operationId(request.intentId);
        const purchase = await readPrivateJson(join(selected, 'customer-requests', request.intentId, 'prepared.json'), 131072);
        return output(await executeFredPurchase({ directory: selected, buyer, purchase, signal: abort.signal }));
      }
      case 'recover': {
        need(buyer, 'Start this workspace with the existing buyer configuration.', 'FRED_BUYER_REQUIRED');
        const selected = await selectFredPublication(directory, request.publicationId);
        return output(await recoverFredPurchase({ directory: selected, buyer, intentId: request.intentId }));
      }
      default: need(false, 'Unknown economic workspace action.');
    }
  };
  const server = createServer((req, res) => {
    const handler = async () => {
      need(req.headers.host === new URL(origin).host && (!req.headers.origin || req.headers.origin === origin),
        'Use this workspace’s private local origin.', 'FRED_LOCAL_ORIGIN_REQUIRED', 403);
      const url = new URL(req.url, origin);
      const asset = assets.get(url.pathname);
      if (req.method === 'GET' && asset && !url.search) return send(res, 200, asset[0], asset[1]);
      const supplied = req.headers.authorization, expected = 'Bearer ' + token;
      need(typeof supplied === 'string' && supplied.length === expected.length &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)), 'Use the original workspace session.', 'FRED_SESSION_REQUIRED', 403);
      need(!closing, 'The workspace is closing.', 'FRED_WORKSPACE_CLOSING', 503);
      if (req.method === 'GET' && url.pathname === '/api/state')
        return send(res, 200, { project: await fredProjectView(directory), merchant: runtimeView(),
          busy: pending?.action ?? null, buyerConfigured: Boolean(buyer) });
      if (req.method === 'GET' && url.pathname === '/api/observations') {
        const capture = await getFredCapture(directory, url.searchParams.get('capture')), model = inspectCapture(capture);
        const series = url.searchParams.get('series') ?? '', offset = pageNumber(url.searchParams.get('offset'));
        const rows = series ? model.rows.filter(row => row.series === series) : model.rows;
        return send(res, 200, { captureId: capture.captureSha256, series: model.series, total: rows.length,
          offset, limit: 100, rows: rows.slice(offset, offset + 100) });
      }
      if (req.method === 'GET' && url.pathname === '/api/source')
        return send(res, 200, await getFredCapture(directory, url.searchParams.get('capture')), 'application/json', 'fred-original-capture.json');
      if (req.method === 'GET' && url.pathname === '/api/compare') {
        const report = await compareFredCaptures({ directory, before: url.searchParams.get('before'), after: url.searchParams.get('after') });
        if (url.searchParams.get('download') === '1') return send(res, 200, report, 'application/json', 'fred-vintage-comparison.json');
        const offset = pageNumber(url.searchParams.get('offset')), { changes, ...summary } = report;
        return send(res, 200, { ...summary, total: changes.length, offset, limit: 100, changes: changes.slice(offset, offset + 100) });
      }
      if (req.method === 'GET' && url.pathname === '/api/bundle')
        return send(res, 200, await exportFredProject({ directory }), 'application/json', 'fred-economic-project.json');
      if (req.method === 'GET' && url.pathname === '/api/publication') {
        const selected = await selectFredPublication(directory, url.searchParams.get('publication'));
        const { edition, plan, offers } = await readFredMerchant(selected);
        const names = await readdir(join(selected, 'customer-requests')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        const requests = [];
        for (const name of names) {
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(name)) continue;
          const saved = await readPrivateJson(join(selected, 'customer-requests', name, 'prepared.json'), 131072);
          requests.push({ intentId: saved.intentId, url: saved.url, file: saved.file, purchaseSha256: saved.purchaseSha256 });
        }
        const { directory: privateDirectory, ...publicEdition } = edition;
        return send(res, 200, { edition: publicEdition, plan, offers, requests });
      }
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const selected = await selectFredPublication(directory, url.searchParams.get('publication'));
        const { edition } = await readFredMerchant(selected), dataset = await loadDatasetConfig(join(selected, 'dataset.json'));
        const query = new URLSearchParams(url.searchParams.get('query') ?? '');
        need(!query.has('snapshot') || query.get('snapshot') === edition.snapshot, 'Keep the original edition snapshot.');
        query.delete('snapshot');
        const context = { query }, admission = dataset.admit(context), result = admission === true ? dataset.handle(context) : admission;
        return send(res, result.status, { mode: 'ORIGINAL_DATASET_PREVIEW', ...result.body });
      }
      if (req.method === 'GET' && url.pathname === '/api/customer-download') {
        need(buyer, 'Start the workspace with the original buyer configuration.');
        const selected = await selectFredPublication(directory, url.searchParams.get('publication'));
        const result = await exportFredPurchase({ directory: selected, buyer, intentId: url.searchParams.get('intent') });
        return send(res, 200, result.bytes, result.contentType, result.filename);
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const request = await body(req);
        need(request && typeof request === 'object' && !Array.isArray(request) && typeof request.action === 'string', 'Select a workspace action.');
        need(!pending, 'The original workspace action is still running; read its state.', 'FRED_WORKSPACE_BUSY', 409);
        const task = run(request); pending = { action: request.action, task };
        try { return send(res, 200, await task); } finally { pending = null; }
      }
      return send(res, 404, { code: 'FRED_ROUTE_NOT_FOUND', message: 'Workspace route not found.' });
    };
    handler().catch(error => {
      if (!res.writableEnded && !res.destroyed) send(res, Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 400,
        { code: typeof error.code === 'string' ? error.code : 'FRED_OPERATION_FAILED', message: error.message,
          ...(error.retryAt ? { retryAt: error.retryAt } : {}) });
    });
  });
  server.headersTimeout = 10000; server.requestTimeout = 120000; server.keepAliveTimeout = 1000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  let closePromise;
  return { server, directory, url: origin + '/#' + token, origin, close: () => closePromise ??= (async () => {
    closing = true; abort.abort();
    await pending?.task.catch(() => {});
    try { if (merchant) await merchant.close(); }
    finally { merchant = null; runningPublication = null;
      await new Promise((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeIdleConnections?.(); }); }
  })() };
}
