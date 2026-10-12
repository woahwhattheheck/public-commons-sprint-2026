// MIT. Private industrial workspace for original water-data operations.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { openWaterQualityProject, operationId } from './project.mjs';
import { prepareQualityPurchase, purchaseQualityEdition, reopenQualityPurchase, exportQualityPurchase } from './merchant.mjs';
import { retainedFiles } from './provider.mjs';
import { reviewSheetSource, listReviewSheetTargets } from './review-sheet/model.mjs';
import { reviewSheetCsv, reviewSheetTsv, parseReviewSheetCsv, parseReviewSheetTsv } from './review-sheet/csv.mjs';
import { previewReviewSheet, saveReviewSheet, listReviewSheets, readReviewSheet,
  exportReviewSheet, receiveReviewSheet } from './review-sheet/workflow.mjs';

import { concentrationSourceGroups, prepareConcentrationChoices, concentrationReportForDocument,
  concentrationReportCsv } from './review-sheet/concentrations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = new Map([['/', ['ui/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['ui/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['ui/style.css', 'text/css; charset=utf-8']],
  ['/openwaters.mjs', ['ui/openwaters.mjs', 'text/javascript; charset=utf-8']],
  ['/review-sheet.mjs', ['ui/review-sheet.mjs', 'text/javascript; charset=utf-8']],
  ['/concentrations.mjs', ['ui/concentrations.mjs', 'text/javascript; charset=utf-8']]]);
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message, code = 'WQX_WORKSPACE_INVALID', status = 400) { throw Object.assign(new Error(message), { code, status }); }
function sameToken(value, expected) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(request, limit = 2 * 1024 * 1024) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) fail('Send a JSON request.');
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length; if (size > limit) fail('The workspace request is too large.', 'WQX_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('Send one complete UTF-8 JSON object.'); }
}
function publicError(error) {
  return { code: error.code ?? 'WQX_OPERATION_FAILED',
    message: typeof error.status === 'number' || error.code?.startsWith('WQX_') || error.code?.startsWith('WQX_')
      ? error.message : error.code === 'ENOENT' ? 'The original saved record is unavailable.' : 'The operation could not complete. Its saved input and retained source files remain available.',
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
export async function startWaterQualityWorkspace({ directory, port = 0, merchantPort = 0, nativeFactory, facilitator, allowLocalFacilitator = false, transport, buyer, env = process.env } = {}) {
  const project = await openWaterQualityProject(resolve(directory), { transport, env });
  const token = randomBytes(32).toString('hex'), jobs = new Map(), purchasePlans = new Map();
  let origin, activeMerchant, activeEditionId, closing, stopping = false;
  let mutations = Promise.resolve();
  function serial(work) {
    const promise = mutations.then(() => { if (stopping) fail('The workspace is closing.', 'WQX_WORKSPACE_CLOSED', 503); return work(); });
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
      editions: await project.listEditions(), openWaters: await project.listOpenWaters(), runtime: plainRuntime(activeMerchant, activeEditionId),
      buyerConfigured: Boolean(buyer), reviewSheets: await listReviewSheets({ project }), jobs: [...jobs.values()].map(({ promise, ...row }) => row), token };
  }
  function startJob(id, work) {
    if (jobs.get(id)?.status === 'RUNNING') fail('This operation is already running.', 'WQX_OPERATION_ACTIVE', 409);
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
        fail('Open the workspace through its printed local address.', 'WQX_LOCAL_ONLY', 403);
      if (request.headers.origin && request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')
        fail('Use the open workspace page to make this request.', 'WQX_ORIGIN_MISMATCH', 403);
      const url = new URL(request.url, origin), path = url.pathname;
      let match;
      if (request.method === 'GET' && STATIC.has(path)) {
        const [file, mime] = STATIC.get(path); return send(response, 200, await readFile(join(HERE, file)), mime);
      }
      if (request.method === 'GET' && path === '/api/workspace') return send(response, 200, await view());
      if (request.method === 'GET' && path === '/api/status')
        return send(response, 200, { captures: await project.listCaptures(), runtime: plainRuntime(activeMerchant, activeEditionId),
          jobs: [...jobs.values()].map(({ promise, ...row }) => row) });
      if (request.method === 'GET' && path === '/api/review-sheets')
        return send(response, 200, await listReviewSheets({ project }));
      if (request.method === 'GET' && (match = /^\/api\/review-sheets\/source\/([A-Za-z0-9_-]+)(?:\/(targets|concentrations))?$/.exec(path))) {
        const plan = await project.readOpenWaters(match[1]);
        if (!match[2]) return send(response, 200, reviewSheetSource(plan));
        if (match[2] === 'concentrations') return send(response, 200, concentrationSourceGroups(plan));
        const query = { offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100) };
        for (const key of ['kind', 'field', 'search', 'status']) if (url.searchParams.has(key)) query[key] = url.searchParams.get(key);
        if (url.searchParams.has('attentionOnly')) {
          const value = url.searchParams.get('attentionOnly');
          if (!['true', 'false'].includes(value)) fail('Choose true or false for attentionOnly.');
          query.attentionOnly = value === 'true';
        }
        return send(response, 200, listReviewSheetTargets(plan, query));
      }
      if (request.method === 'GET' && (match = /^\/api\/review-sheets\/([A-Za-z0-9_-]+)\/concentrations$/.exec(path))) {
        const record = await readReviewSheet({project, reviewId:match[1]});
        if (record.status !== 'COMPLETE') fail('Save the prepared review before reopening its concentration report.', 'WQX_CONCENTRATION_PREPARED', 409);
        const source = await project.readOpenWaters(record.document.sourcePlanId), resultPlan = await project.readOpenWaters(record.newPlanId);
        return send(response, 200, concentrationReportForDocument(source, record.document, {resultPlan}));
      }
      if (request.method === 'GET' && (match = /^\/api\/review-sheets\/([A-Za-z0-9_-]+)(?:\/(csv|tsv|json|report|bundle|native-locations|native-results|native-crosswalk|native-report|native-references|native-bundle))?$/.exec(path))) {
        if (!match[2]) return send(response, 200, await readReviewSheet({ project, reviewId: match[1] }));
        const exported = await exportReviewSheet({ project, reviewId: match[1], format: match[2] });
        return send(response, 200, exported.bytes, exported.mime, exported.filename);
      }
      if (request.method === 'GET' && path === '/api/open-waters') return send(response, 200, await project.listOpenWaters());
      if (request.method === 'GET' && (match = /^\/api\/open-waters\/([A-Za-z0-9_-]+)(?:\/(locations|results|crosswalk|report|bundle|references))?$/.exec(path))) {
        if (!match[2]) return send(response, 200, await project.readOpenWaters(match[1]));
        const exported = await project.exportOpenWaters({ planId: match[1], format: match[2] });
        return send(response, 200, exported.bytes, exported.mime, exported.filename);
      }
      if (request.method === 'GET' && (match = /^\/api\/reviews\/([A-Za-z0-9_-]+)(?:\/(html|json|csv|geojson|bundle))?$/.exec(path))) {
        if (!match[2]) return send(response, 200, await project.readReview(match[1]));
        const exported = match[2] === 'bundle' ? await project.exportReviewBundle({ reviewId: match[1] }) : await project.exportReview({ reviewId: match[1], format: match[2] });
        return send(response, 200, exported.bytes, exported.mime, exported.filename);
      }
      if (request.method === 'GET' && (match = /^\/api\/captures\/([A-Za-z0-9_-]+)\/result$/.exec(path))) {
        return send(response, 200, await project.readResult({ captureId: match[1], resultId: url.searchParams.get('id'),
          sourceSha256: url.searchParams.get('sourceSha256'), sourceIndex: Number(url.searchParams.get('sourceIndex')),
          expectedCaptureSha256: url.searchParams.get('captureSha256') }));
      }
      if (request.method === 'GET' && (match = /^\/api\/captures\/([A-Za-z0-9_-]+)(?:\/files\/(\d+))?$/.exec(path))) {
        const capture = await project.capture(match[1]), sourceFiles = await retainedFiles(capture);
        if (match[2] === undefined) return send(response, 200, { ...capture, sourceFiles });
        const index = Number(match[2]), page = sourceFiles[index];
        if (!page) fail('Choose an original response file from this capture.', 'WQX_PAGE_NOT_FOUND', 404);
        const relative = page.path;
        if (typeof relative !== 'string' || isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '..'))
          fail('The original page path changed.', 'WQX_PAGE_CHANGED', 409);
        const file = join(capture.directory, relative);
        if (await realpath(file) !== file || !(await stat(file)).isFile()) fail('The retained source file changed.', 'WQX_PAGE_CHANGED', 409);
        const bytes = await readFile(file), hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== (page.sha256 ?? page.bodySha256)) fail('The original source file changed.', 'WQX_PAGE_CHANGED', 409);
        return send(response, 200, bytes, page.contentType ?? (relative.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json'), relative.split('/').at(-1));
      }
      if (request.method === 'GET' && (match = /^\/api\/editions\/([A-Za-z0-9_-]+)$/.exec(path)))
        return send(response, 200, await project.readEdition(match[1]));
      if (request.method === 'GET' && (match = /^\/api\/customer\/files\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(path))) {
        if (!buyer) fail('This workspace has no original buyer configuration.', 'WQX_BUYER_REQUIRED', 409);
        const edition = await project.readEdition(operationId(match[1]));
        const exported = await exportQualityPurchase({ buyer, intentId: operationId(match[2]), editionDirectory: edition.directory });
        return send(response, 200, exported.bytes, exported.mime, exported.filename);
      }
      if (request.method !== 'POST') fail('Workspace route not found.', 'WQX_ROUTE_NOT_FOUND', 404);
      if (!sameToken(request.headers['x-workspace-token'], token)) fail('Refresh the workspace before making a change.', 'WQX_TOKEN_MISMATCH', 403);
      const input = await body(request,
        ['/api/open-waters/receive', '/api/review-sheets/receive'].includes(path) ? 128 * 1024 * 1024 :
        path.startsWith('/api/review-sheets') ? 64 * 1024 * 1024 : path === '/api/receive' ? 96 * 1024 * 1024 : undefined);
      if (path === '/api/captures') {
        const id = operationId(input.operationId ?? randomUUID());
        return send(response, 202, startJob(id, progress => project.acquire({ operationId: id, expectedRevision: input.expectedRevision, onProgress: progress })));
      }
      if ((match = /^\/api\/captures\/([A-Za-z0-9_-]+)\/cancel$/.exec(path))) return send(response, 200, project.cancelCapture(match[1]));
      if (path === '/api/analysis') return send(response, 200, await project.analyze(input));
      if (path === '/api/open-waters/preview') return send(response, 200, await project.previewOpenWaters(input));
      const result = await serial(async () => {
        if (path === '/api/review-sheets/concentrations') return prepareConcentrationChoices({project, document:input.document,
          resultIds:input.resultIds, targetUnit:input.targetUnit, reason:input.reason});
        if (path === '/api/review-sheets/concentrations/csv') return {filename:input.report?.source?.sourcePlanId + '-concentration-report.csv',
          mime:'text/csv;charset=utf-8', text:concentrationReportCsv(input.report)};
        if (path === '/api/review-sheets/preview') return previewReviewSheet({ project, document: input.document, newPlanId: input.newPlanId });
        if (path === '/api/review-sheets') return saveReviewSheet({ project, reviewId: input.reviewId,
          document: input.document, newPlanId: input.newPlanId, expectedPreviewSha256: input.expectedPreviewSha256 });
        if (path === '/api/review-sheets/receive') return receiveReviewSheet({ project, bundle: input.bundle });
        if (path === '/api/review-sheets/import-table') {
          if (!['csv', 'tsv'].includes(input.format ?? 'csv')) fail('Choose CSV or TSV for the editable receiving table.');
          return (input.format === 'tsv' ? parseReviewSheetTsv : parseReviewSheetCsv)(input.text);
        }
        if (path === '/api/review-sheets/table') {
          if (!['csv', 'tsv'].includes(input.format ?? 'csv')) fail('Choose CSV or TSV for the editable receiving table.');
          const plan = await project.readOpenWaters(input.document?.sourcePlanId), tsv = input.format === 'tsv';
          return { filename: plan.planId + '-decisions.' + (tsv ? 'tsv' : 'csv'),
            mime: tsv ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8',
            text: (tsv ? reviewSheetTsv : reviewSheetCsv)(plan, input.document, { attentionOnly: false }) };
        }
        if (path === '/api/project') return project.save(input);
        if (path === '/api/import-capture') return project.importCapture(input);
        if (path === '/api/receive') return project.receiveReviewBundle(input);
        if (path === '/api/reviews') return project.saveReview(input);
        if (path === '/api/open-waters') return project.saveOpenWaters(input);
        if (path === '/api/open-waters/receive') return project.receiveOpenWaters(input);
        if (path === '/api/editions') return project.prepareEdition(input);
        if (path === '/api/merchant/stage') {
          if (activeMerchant && input.editionId === activeEditionId) fail('Stop this running merchant before changing its launch configuration.', 'WQX_MERCHANT_RUNNING', 409);
          return project.stageEdition(input);
        }
        if (path === '/api/merchant/start') {
          if (activeMerchant) fail('Stop the current merchant before starting another edition.', 'WQX_MERCHANT_RUNNING', 409);
          activeMerchant = await project.startEdition({ ...input, port: merchantPort, nativeFactory, facilitator,
            allowLocalFacilitator: input.allowLocalFacilitator ?? allowLocalFacilitator });
          activeEditionId = input.editionId;
          return plainRuntime(activeMerchant, activeEditionId);
        }
        if (path === '/api/merchant/stop') {
          const result = activeMerchant ? await activeMerchant.close() : { alreadyStopped: true };
          activeMerchant = null; activeEditionId = null; return result;
        }
        if (path === '/api/customer/prepare') {
          const editionId = operationId(input.editionId), edition = await project.readEdition(editionId);
          const intentId = operationId(input.intentId ?? randomUUID());
          const prepared = await prepareQualityPurchase({ editionDirectory: edition.directory, intentId, query: input.query ?? {}, file: input.file,
            kind: input.kind, previous: input.previous ?? null, acceptIndex: input.acceptIndex ?? 0 });
          purchasePlans.set(intentId, { editionId, prepared });
          return { intentId, editionId, prepared };
        }
        if (path === '/api/customer/execute') {
          if (!buyer) fail('This workspace has no original buyer configuration.', 'WQX_BUYER_REQUIRED', 409);
          const plan = purchasePlans.get(operationId(input.intentId));
          if (!plan) fail('Prepare or reopen this intent in the original buyer before executing it.', 'WQX_PURCHASE_NOT_PREPARED', 409);
          const result = await purchaseQualityEdition({ buyer, prepared: plan.prepared });
          return { intentId: input.intentId, editionId: plan.editionId, result: publicPurchase(result) };
        }
        if (path === '/api/customer/reopen') {
          if (!buyer) fail('This workspace has no original buyer configuration.', 'WQX_BUYER_REQUIRED', 409);
          const edition = await project.readEdition(operationId(input.editionId));
          return publicPurchase(await reopenQualityPurchase({ buyer, intentId: operationId(input.intentId), editionDirectory: edition.directory }));
        }
        fail('Workspace route not found.', 'WQX_ROUTE_NOT_FOUND', 404);
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
  origin = new URL('http://127.0.0.1:' + server.address().port).origin;
  function close() {
    return closing ??= (async () => {
      stopping = true;
      const closed = new Promise(done => { server.close(done); server.closeIdleConnections?.(); });
      await mutations; await project.close();
      await Promise.allSettled([...jobs.values()].map(row => row.promise));
      await activeMerchant?.close(); activeMerchant = null;
      server.closeIdleConnections?.(); await closed; return { closed: true };
    })();
  }
  return { url: origin, server, project, view, close };
}
