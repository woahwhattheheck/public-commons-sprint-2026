// MIT. Private browser presentation over the ORIGINAL SF66 commerce session.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { readFile, open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { openCommerce, completeCommerceShutdown, commerceErrorCode } from './commerce.mjs';
import { readCommerceRecoveryConfig } from './commerce-recovery.mjs';
import { createCommerceRecoveryController } from './commerce-recovery-controller.mjs';

const HOST = '127.0.0.1';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const PREVIEW_BYTES = 256 * 1024;
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function input(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json')
    throw problem('JSON operator action required.', 415);
  let length = 0; const parts = [];
  for await (const part of req) {
    length += part.length;
    if (length > 16384) throw problem('Operator action exceeds 16 KiB.', 413);
    parts.push(part);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts)); } catch { throw problem('Invalid JSON operator action.'); }
  if (!object(value)) throw problem('JSON object required.');
  return value;
}
function savedDelivery(outcome) {
  const saved = outcome?.responseFile;
  if (saved?.status !== 'SAVED' || typeof saved.path !== 'string' ||
      !Number.isSafeInteger(saved.bytes) || saved.bytes < 0 || !/^[a-f0-9]{64}$/.test(saved.sha256 ?? ''))
    return { available: false, status: saved?.status ?? 'NO_SAVED_RESPONSE' };
  return { available: true, status: 'SAVED', path: saved.path, name: basename(saved.path),
    bytes: saved.bytes, sha256: saved.sha256, contentType: saved.contentType ?? null,
    source: saved.source ?? 'ORIGINAL_BUYER_RESPONSE',
    originalAttemptStartedAt: saved.originalAttemptStartedAt,
    recoveryReadStartedAt: saved.recoveryReadStartedAt, responseObservedAt: saved.responseObservedAt };
}
const jobDelivery = job => savedDelivery(job?.rpcRecovery?.responseFile ?
  { responseFile: job.rpcRecovery.responseFile } : job?.outcome);
async function savedFile(delivery) {
  if (!delivery.available) throw problem('The buyer has no saved response.', 404);
  // The path comes solely from the original buyer's retained result. Browser
  // requests cannot supply a file path, destination, URL or response identity.
  let handle;
  try {
    handle = await open(delivery.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size !== delivery.bytes) throw problem('The saved response has changed.', 409);
    const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      if (!bytesRead) throw problem('The saved response was truncated.', 409);
      digest.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat();
    if (digest.digest('hex') !== delivery.sha256 || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw problem('The saved response no longer matches the recorded buyer result.', 409);
    return handle;
  } catch (error) {
    await handle?.close();
    if (error.status) throw error;
    throw problem('The saved response is unavailable.', 409);
  }
}
async function preview(delivery) {
  const handle = await savedFile(delivery);
  try {
    const buffer = Buffer.alloc(Math.min(delivery.bytes, PREVIEW_BYTES));
    let position = 0;
    while (position < buffer.length) {
      const { bytesRead } = await handle.read(buffer, position, buffer.length - position, position);
      if (!bytesRead) break;
      position += bytesRead;
    }
    let text;
    const truncated = delivery.bytes > position;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, position), { stream: truncated });
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Binary');
      if (!truncated && /(?:^|\/)json(?:;|$)|\+json(?:;|$)/i.test(delivery.contentType ?? ''))
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    } catch { text = 'This response is binary. Download the saved file to use it.'; }
    return { text, bytes: position, totalBytes: delivery.bytes, truncated, contentType: delivery.contentType };
  } finally { await handle.close(); }
}

async function download(delivery, res) {
  const handle = await savedFile(delivery);
  const filename = delivery.name.replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 120) || 'response.bin';
  try {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(delivery.bytes),
      'content-disposition': 'attachment; filename="' + filename + '"',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' });
    await pipeline(handle.createReadStream({ start: 0, autoClose: false }), res);
  } finally { await handle.close(); }
}

/** Present the original commerce session; the original inbox owns durable state. */
export async function startCommerceConsole(session, { port = 8426, recoveryProfile,
  environment = process.env, reopen, finalityNode = process.execPath } = {}) {
  function validateSession(value) {
    for (const method of ['status', 'review', 'execute', 'cancel', 'recover', 'close'])
      if (typeof value?.[method] !== 'function') throw new TypeError('Original commerce session must provide ' + method + '().');
  }
  if (session) validateSession(session);
  else if (!recoveryProfile) throw new TypeError('A retained recovery configuration is required without a session.');
  if (session && recoveryProfile && (await session.status()).directory !== recoveryProfile.directory)
    throw problem('Recovery must use this original commerce session directory.', 409);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Console port must be 0–65535.');
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/request.mjs', 'request.mjs', 'text/javascript; charset=utf-8'],
    ['/request.css', 'request.css', 'text/css; charset=utf-8'],
    ['/stream.mjs', 'stream.mjs', 'text/javascript; charset=utf-8'],
    ['/stream.css', 'stream.css', 'text/css; charset=utf-8'],
    ['/recovery.mjs', 'recovery.mjs', 'text/javascript; charset=utf-8'],
    ['/recovery.css', 'recovery.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, {
    bytes: await readFile(new URL('./commerce-ui/' + file, import.meta.url)), type,
  }])));
  let hosts = new Set(), origins = new Set(), url;
  // These maps retain only this browser session's review/dispatch presentation.
  // Terminal results, replay prevention and files are always read from SF88.
  const reviews = new Map(), dispatches = new Map(), retrievals = new Map(), rpcActions = new Map();
  let work = null, action = null, stopping = false, stopPromise, shutdown, shutdownError, closing;
  let recoveryController;
  const offlineSnapshot = () => ({
    session: { id: 'Retained commerce recovery', state: stopping ? 'STOPPING' : 'OFFLINE',
      directory: recoveryProfile.directory, shutdown, shutdownError },
    seller: { publicOrigin: null, listener: null, mode: 'OFFLINE', routes: [] },
    facilitator: { mode: 'NOT_CONFIGURED' }, operations: [], operation: null,
    review: null, attempt: null, delivery: { available: false }, stream: null,
    rpcRecovery: null, rpcAction: null, purchase: null, retrieval: null, activeIntent: null,
    controls: {}, recoveryEnabled: true, recoveryBusy: recoveryController?.busy ?? false,
    updatedAt: new Date().toISOString(),
  });
  const fingerprint = job => createHash('sha256').update(JSON.stringify([
    job.configSha256, job.bodySha256, job.bodyBytes, job.operation, job.merchant,
  ])).digest('hex');
  function choose(original, intent) {
    if (typeof intent !== 'string' || !intent) throw problem('Select a prepared operation.');
    const job = original.buyers.find(row => row.operation?.intentId === intent);
    if (!job) throw problem('This intent is not in this commerce session.', 404);
    return job;
  }
  async function current(intent) {
    if (!session) throw problem('Restore and reopen the original commerce session first.', 409);
    const original = await session.status();
    return { original, job: choose(original, intent) };
  }
  async function snapshot(intent) {
    if (!session) return offlineSnapshot();
    const original = await session.status();
    const job = intent ? choose(original, intent) : original.buyers[0];
    const id = job?.operation?.intentId;
    let review = reviews.get(id) ?? null;
    if (review && review.fingerprint !== fingerprint(job)) { reviews.delete(id); review = null; }
    const local = dispatches.get(id), running = work?.intent === id;
    const attempt = job?.attempt || local ? {
      state: running ? 'RUNNING' : local?.error && job.state === 'QUEUED' ? 'SETUP_FAILED' : job.state,
      startedAt: job.attempt?.startedAt ?? local?.startedAt,
      endedAt: local?.endedAt,
      outcome: job.outcome ?? null,
      error: job.lastError?.code ?? local?.error ?? null,
      exitCode: local?.exitCode,
      recovery: job.recovery ?? null,
    } : null;
    const runningSession = original.state === 'RUNNING' && !stopping && !recoveryController?.busy;
    return {
      session: { id: original.operations.traffic.sessionId, state: stopping ? 'STOPPING' : original.state,
        startedAt: original.operations.traffic.startedAt, directory: original.directory,
        shutdown, shutdownError },
      seller: { publicOrigin: original.seller.publicOrigin, listener: original.seller.url,
        mode: original.seller.mode, developerUrl: original.seller.docs,
        jsonrpc: original.seller.jsonrpc ?? null,
        operationsUrl: original.operations.url,
        routes: session.seller.compiled.routes.map(route => ({ id: route.id, method: route.method, path: route.path })) },
      facilitator: { mode: original.facilitator?.mode ?? 'NOT_CONFIGURED',
        network: original.facilitator?.network ?? null, state: original.facilitator?.state ?? null,
        readiness: original.facilitator?.readiness ?? null,
        activeVerify: original.facilitator?.activeVerify ?? 0, activeSettle: original.facilitator?.activeSettle ?? 0,
        ownership: original.facilitator?.ownership ? {
          mode: original.facilitator.ownership.mode, state: original.facilitator.ownership.state,
          accounts: original.facilitator.ownership.accounts,
        } : null },
      operations: original.buyers.map(row => ({ intentId: row.operation.intentId,
        method: row.operation.method, url: row.operation.url, state: row.state,
        active: work?.intent === row.operation.intentId })),
      operation: job ? { ...job.operation, state: job.state, routeId: job.merchant.routeId,
        acceptIndex: job.merchant.acceptIndex, originalTerms: job.merchant.originalTerms,
        quotedAtomic: job.merchant.originalTerms.amount,
        bodyPresent: job.bodySha256 !== null, bodyBytes: job.bodyBytes,
        bodySha256: job.bodySha256, configSha256: job.configSha256,
        operatorId: job.operator.actor, serviceId: job.operator.service,
        signerFilename: basename(job.dependencies.signer.path) } : null,
      review: review ? { id: review.id, at: review.at, original: review.original } : null,
      attempt, delivery: jobDelivery(job), stream: job?.stream ?? null, rpcRecovery: job?.rpcRecovery ?? null,
      rpcAction: rpcActions.has(id) ? { state: rpcActions.get(id).running ? 'RUNNING' : 'FINISHED',
        operation: rpcActions.get(id).operation, result: rpcActions.get(id).result ?? null,
        error: rpcActions.get(id).error ?? null } : null,
      purchase: job?.paidFile ?? null,
      retrieval: retrievals.has(id) ? { state: retrievals.get(id).running ? 'RUNNING' : 'FINISHED',
        result: retrievals.get(id).result ?? null, error: retrievals.get(id).error ?? null } : null,
      activeIntent: work?.intent ?? null,
      controls: { canReview: Boolean(job) && runningSession && !action,
        canInspectRequest: Boolean(job) && runningSession && typeof session.requestInput === 'function',
        canDownloadRequest: Boolean(job) && job.bodySha256 !== null && runningSession && typeof session.requestBytes === 'function',
        canProbeFacilitator: runningSession && !action && typeof session.probeReadiness === 'function' &&
          original.facilitator?.mode === 'NATIVE_X402_FACILITATOR',
        canExecute: Boolean(review) && runningSession && !action && !work && job.state === 'QUEUED' && original.seller.mode === 'NATIVE_X402',
        canCancel: runningSession && !action && !running && job?.state === 'QUEUED',
        canInterrupt: runningSession && !action && running && typeof session.interrupt === 'function',
        canRecover: runningSession && !action && !work && ['RUNNING_OR_INTERRUPTED', 'REVIEW_REQUIRED'].includes(job?.state),
        canVerifyRpcPayment: runningSession && !action && !work && !rpcActions.get(id)?.running &&
          job?.rpcRecovery?.canVerify === true && typeof session.verifyRpcPayment === 'function',
        canRecoverRpcResponse: runningSession && !action && !work && !rpcActions.get(id)?.running &&
          job?.rpcRecovery?.canRecover === true && typeof session.recoverRpcResponse === 'function',
        canRetrieve: Boolean(job?.paidFile) && typeof session.retrieve === 'function' && runningSession && !action &&
          !retrievals.get(id)?.running && !['ACTIVE', 'REJECTED'].includes(job?.paidFile?.transfer?.status),
        canResetTransfer: Boolean(job?.paidFile?.transfer?.canReset) && typeof session.resetTransfer === 'function' &&
          runningSession && !action && !retrievals.get(id)?.running,
        canStop: runningSession },
      recoveryEnabled: Boolean(recoveryController), recoveryBusy: recoveryController?.busy ?? false,
      updatedAt: new Date().toISOString(),
    };
  }
  async function stopSession() {
    if (!session) return shutdown ?? { state: 'STOPPED', drained: true };
    if (stopPromise) return stopPromise;
    stopping = true; reviews.clear();
    stopPromise = (async () => {
      try {
        const closing = session.close().then(result => { shutdown = result; return result; });
        shutdown = await completeCommerceShutdown(session, closing);
        return shutdown;
      }
      catch (error) { shutdownError = commerceErrorCode(error); throw error; }
      finally { if (work) await work.promise; stopping = false; }
    })();
    return stopPromise;
  }
  if (recoveryProfile) recoveryController = createCommerceRecoveryController(recoveryProfile, {
    environment,
    state: async () => session ? (await session.status()).state : 'OFFLINE',
    pause: async () => {
      if (!session) return;
      await stopSession();
      // Also wait for a host-provided native factory's accepted work. Source
      // capture begins only after every original owner has become quiescent.
      const completed = await session.waitForIdle?.();
      if (completed) shutdown = { ...shutdown, nativeCompletion: completed };
      session = null;
    },
    reopen: async () => {
      if (closing) throw problem('This commerce console is closing.', 409);
      const opened = await (reopen ? reopen(recoveryProfile.directory) :
        openCommerce(recoveryProfile.directory, { environment, finalityNode }));
      try {
        validateSession(opened);
        if ((await opened.status()).directory !== recoveryProfile.directory)
          throw problem('Reopening must retain the original commerce directory.', 409);
      } catch (error) {
        await completeCommerceShutdown(opened, opened.close()).catch(() => {}); throw error;
      }
      session = opened; stopPromise = null; shutdown = null; shutdownError = null; stopping = false;
      reviews.clear(); dispatches.clear(); retrievals.clear(); rpcActions.clear();
    },
  });
  const server = createServer(async (req, res) => {
    const reply = (code, type, value, extra = {}) => {
      if (res.destroyed || res.headersSent) return;
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      res.writeHead(code, { 'content-type': type, 'content-length': String(bytes.length),
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': CSP, 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin', ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const send = (code, value) => reply(code, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      if (!hosts.has(req.headers.host) || req.headers.origin && !origins.has(req.headers.origin) ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
        throw problem('Use the local commerce workspace origin.', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw problem('Invalid request target.');
      const target = new URL(req.url, url);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(target.pathname) && !target.search) {
        const asset = assets.get(target.pathname); return reply(200, asset.type, asset.bytes);
      }
      const supplied = Buffer.from(req.headers['x-commerce-token'] ?? '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes))
        throw problem('Reopen the complete operator URL printed by the commerce console command.', 401);
      if (req.method === 'GET' && target.pathname === '/api/recovery' && !target.search)
        return send(200, recoveryController ? await recoveryController.status() : { enabled: false });
      if (target.pathname.startsWith('/api/recovery/')) {
        if (!recoveryController) throw problem('Start this console with a recovery configuration.', 409);
        const command = target.pathname.slice('/api/recovery/'.length);
        if (target.search || req.method !== 'POST' ||
            !['review', 'capture', 'verify', 'restore', 'reopen', 'cancel'].includes(command))
          throw problem('Unknown commerce recovery action.', 404);
        if (!origins.has(req.headers.origin)) throw problem('Same-origin operator action required.', 403);
        if (action || closing) throw problem('Wait for the current operator action.', 409);
        const id = recoveryController.dispatch(command, await input(req));
        return send(202, { jobId: id });
      }
      if (req.method === 'GET' && ['/api/stream-records', '/api/stream-answer', '/api/stream-file'].includes(target.pathname)) {
        const fields = target.pathname === '/api/stream-records' ? ['intent','partial','offset','limit','query'] : ['intent','partial'];
        if ([...target.searchParams.keys()].some(key => !fields.includes(key) || target.searchParams.getAll(key).length !== 1) ||
            target.searchParams.has('partial') && target.searchParams.get('partial') !== '1')
          throw problem('Select one original intent and its retained stream options.');
        const intent = target.searchParams.get('intent');
        await current(intent);
        const options = { allowPartial:target.searchParams.get('partial') === '1' };
        const method = target.pathname === '/api/stream-records' ? 'streamRecords' :
          target.pathname === '/api/stream-answer' ? 'streamAnswer' : 'streamFile';
        if (typeof session[method] !== 'function') throw problem('This session has no retained stream reader.', 409);
        if (method === 'streamRecords') {
          for (const key of ['offset','limit']) if (target.searchParams.has(key)) {
            const value = target.searchParams.get(key);
            if (!/^(0|[1-9][0-9]{0,6})$/.test(value)) throw problem('Stream page numbers must be positive integers or zero.');
            options[key] = Number(value);
          }
          if (target.searchParams.has('query')) options.query = target.searchParams.get('query');
        }
        const reader = new AbortController(), abort = () => reader.abort();
        res.once('close', abort);
        try {
          const result = await session[method](intent, { ...options, signal:reader.signal });
          if (method === 'streamFile') await download(result, res);
          else send(200, result);
        } finally { res.removeListener('close', abort); }
        return;
      }
      if (req.method === 'GET' && ['/api/session', '/api/preview', '/api/delivery', '/api/product-preview', '/api/product-delivery', '/api/request-input', '/api/request-body'].includes(target.pathname)) {
        if ([...target.searchParams.keys()].some(key => key !== 'intent') || target.searchParams.getAll('intent').length > 1)
          throw problem('Only one exact intent selection is accepted.');
        const intent = target.searchParams.get('intent');
        if (target.pathname === '/api/session') return send(200, await snapshot(intent));
        const { job } = await current(intent);
        if (target.pathname === '/api/request-input') {
          if (typeof session.requestInput !== 'function') throw problem('This session has no request inspection.', 409);
          return send(200, await session.requestInput(job.operation.intentId));
        }
        if (target.pathname === '/api/request-body') {
          if (typeof session.requestBytes !== 'function') throw problem('This session has no retained request download.', 409);
          const retained = await session.requestBytes(job.operation.intentId);
          return reply(200, 'application/octet-stream', Buffer.from(retained.bytes), {
            'content-disposition': 'attachment; filename="request-body.bin"',
            'x-request-body-sha256': retained.sha256, 'x-request-config-sha256': retained.configSha256,
          });
        }
        const delivery = target.pathname.startsWith('/api/product-') ? job.paidFile?.delivery ?? { available: false } : jobDelivery(job);
        if (['/api/preview', '/api/product-preview'].includes(target.pathname)) return send(200, await preview(delivery));
        await download(delivery, res);
        return;
      }
      if (target.search || req.method !== 'POST' || !['/api/review', '/api/execute', '/api/interrupt', '/api/cancel', '/api/recover', '/api/stop', '/api/retrieve', '/api/reset-transfer', '/api/facilitator', '/api/verify-rpc-payment', '/api/recover-rpc-response'].includes(target.pathname))
        throw problem('Unknown commerce workspace action.', 404);
      if (!origins.has(req.headers.origin)) throw problem('Same-origin operator action required.', 403);
      const value = await input(req);
      const allowed = target.pathname === '/api/execute' ? ['intent', 'reviewId'] :
        ['/api/verify-rpc-payment', '/api/recover-rpc-response'].includes(target.pathname) ?
          ['intent', 'transaction', 'expectedRequestSha256', 'expectedAttemptId', 'expectedConfigSha256'] :
        ['/api/retrieve', '/api/reset-transfer'].includes(target.pathname) ? ['intent', 'configSha256', 'handoffSha256'] : ['intent'];
      if (Object.keys(value).some(key => !allowed.includes(key))) throw problem('Unknown operator action field.');
      if (!session || recoveryController?.busy) throw problem('Wait for state recovery, then reopen this commerce session.', 409);
      if (target.pathname === '/api/stop') {
        void stopSession().catch(() => {});
        return send(202, await snapshot(value.intent));
      }
      if (stopping || stopPromise) throw problem('This commerce session is stopping or has stopped.', 409);
      if (action) throw problem('An operator action is already running.', 409);
      action = target.pathname;
      if (target.pathname === '/api/facilitator') {
        try {
          if (typeof session.probeReadiness !== 'function') throw problem('This session has no embedded native facilitator.', 409);
          await session.probeReadiness();
        } finally { action = null; }
        return send(200, await snapshot(value.intent));
      }
      try {
        const { original, job } = await current(value.intent), intent = job.operation.intentId;
        if (original.state !== 'RUNNING') throw problem('The commerce session is not running.', 409);
        if (['/api/verify-rpc-payment', '/api/recover-rpc-response'].includes(target.pathname)) {
          const original = job.rpcRecovery?.original;
          if (work || rpcActions.get(intent)?.running) throw problem('Wait for the current buyer or recovery operation.', 409);
          if (!original || value.expectedAttemptId !== original.attemptId ||
              value.expectedConfigSha256 !== original.configSha256 ||
              value.expectedRequestSha256 !== original.expectedRequestSha256 ||
              !/^[a-f0-9]{64}$/.test(value.transaction ?? ''))
            throw problem('Refresh this original attempt and select its exact transaction hash.', 409);
          const verify = target.pathname === '/api/verify-rpc-payment';
          const method = verify ? 'verifyRpcPayment' : 'recoverRpcResponse';
          if (typeof session[method] !== 'function' || !(verify ? job.rpcRecovery.canVerify : job.rpcRecovery.canRecover))
            throw problem('The selected payment or product is not ready for this recovery action.', 409);
          const selected = { transaction: value.transaction, expectedRequestSha256: value.expectedRequestSha256,
            expectedAttemptId: value.expectedAttemptId, expectedConfigSha256: value.expectedConfigSha256 };
          const pending = { running: true, operation: verify ? 'VERIFY_PAYMENT' : 'RECOVER_RESPONSE' };
          rpcActions.set(intent, pending);
          pending.promise = Promise.resolve().then(() => session[method](intent, selected))
            .then(result => { pending.result = result; }, error => { pending.error = commerceErrorCode(error); })
            .finally(() => { pending.running = false; });
        } else if (['/api/retrieve', '/api/reset-transfer'].includes(target.pathname)) {
          const method = target.pathname === '/api/retrieve' ? 'retrieve' : 'resetTransfer';
          if (typeof session[method] !== 'function' || !job.paidFile) throw problem('This operation has no configured paid-file action.', 409);
          if (retrievals.get(intent)?.running) throw problem('This file is already being retrieved.', 409);
          if (value.configSha256 !== job.configSha256 || value.handoffSha256 !== job.paidFile.handoffSha256)
            throw problem('The selected request or file handoff changed. Refresh before changing its download.', 409);
          if (method === 'resetTransfer') {
            if (!job.paidFile.transfer?.canReset) throw problem('This order has no idle retained download to clear. Refresh its current state.', 409);
            const result = await session.resetTransfer(intent);
            retrievals.set(intent, { running: false, result });
          } else {
            const file = { running: true }; retrievals.set(intent, file);
            file.promise = Promise.resolve().then(() => session.retrieve(intent)).then(result => { file.result = result; },
              error => { file.error = commerceErrorCode(error); }).finally(() => { file.running = false; });
          }
        } else if (target.pathname === '/api/review') {
          const result = await session.review(intent);
          if (result.exitCode !== 0 || result.original?.mode !== 'OFFLINE_REVIEW')
            throw problem('Buyer review failed. ' + (result.original?.error ?? ''), 409);
          const fresh = (await current(intent)).job;
          if (fingerprint(fresh) !== fingerprint(job)) throw problem('The prepared request changed during review. Review it again.', 409);
          reviews.set(intent, { id: randomUUID(), at: new Date().toISOString(), fingerprint: fingerprint(job), original: result.original });
        } else if (target.pathname === '/api/interrupt') {
          if (work?.intent !== intent || typeof session.interrupt !== 'function')
            throw problem('This selected buyer is no longer active. Read its retained result.', 409);
          await session.interrupt(intent);
          if (work?.intent === intent) await work.promise;
        } else if (target.pathname === '/api/cancel') {
          if (job.state !== 'QUEUED' || work?.intent === intent)
            throw problem('Only a queued request can be cancelled. Use Interrupt this buyer for its active request.', 409);
          await session.cancel(intent); reviews.delete(intent);
        } else if (target.pathname === '/api/recover') {
          if (work) throw problem('Wait for the current buyer before reading interrupted-operation recovery.', 409);
          await session.recover(intent); reviews.delete(intent);
        } else {
          if (work) throw problem('The session already has an active buyer.', 409);
          if (job.state !== 'QUEUED') throw problem('This intent has already been attempted or cancelled. Use its retained result.', 409);
          if (original.seller.mode !== 'NATIVE_X402') throw problem('Configure the native facilitator before executing purchases.', 409);
          const review = reviews.get(intent);
          if (!review || value.reviewId !== review.id || review.fingerprint !== fingerprint(job))
            throw problem('Review this exact operation before executing it.', 409);
          reviews.delete(intent);
          const local = { startedAt: new Date().toISOString() };
          dispatches.set(intent, local);
          const active = { intent, promise: null }; work = active;
          // SF66 invokes the original inbox CLI and terminal approval. A browser
          // reload never dispatches another attempt or supplies approval input.
          active.promise = Promise.resolve().then(() => session.execute(intent)).then(result => {
            local.exitCode = result.exitCode;
          }, error => { local.error = commerceErrorCode(error); }).finally(() => {
            local.endedAt = new Date().toISOString(); if (work === active) work = null;
          });
        }
      } finally { action = null; }
      return send(['/api/execute', '/api/retrieve', '/api/verify-rpc-payment', '/api/recover-rpc-response'].includes(target.pathname) ? 202 : 200, await snapshot(value.intent));
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      send(error.status ?? 400, { error: error.code ?? 'COMMERCE_OPERATOR_ERROR', message: error.message });
    }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done, fail) => {
    const onError = error => { server.removeListener('listening', onListen); fail(error); };
    const onListen = () => { server.removeListener('error', onError); done(); };
    server.once('error', onError); server.once('listening', onListen); server.listen(port, HOST);
  });
  const assigned = server.address().port;
  hosts = new Set([HOST + ':' + assigned, 'localhost:' + assigned]);
  origins = new Set([...hosts].map(host => 'http://' + host)); url = 'http://' + HOST + ':' + assigned;
  const close = () => closing ??= (async () => {
    try { await recoveryController?.close(); return await stopSession(); }
    finally {
      await new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.(); });
    }
  })();
  return { server, url, token, operatorUrl: url + '/#' + token, close,
    recovery: recoveryController ?? null };
}

const HELP = `StellarForge commerce browser workspace

  node commerce-console.mjs start --directory /private/merchant-session [--port 8426]
                            [--finality-node /absolute/trusted-node]
                            [--recovery-config /private/host/recovery.json]
  node commerce-console.mjs recover --recovery-config /private/host/recovery.json [--port 8426]

Initialize the session with commerce-cli.mjs init first.
Open the complete local operator URL printed here. Review and select requests
in the browser; payment approval remains in this terminal.
Stop session drains this process's seller and buyer. Saved inbox results remain.
Recovery pauses this original session, checkpoints its operators and encrypts
its retained state. The recover command starts with the source state absent.
See COMMERCE_RECOVERY.md for private configuration and original-path restore.
SIGINT/SIGTERM finishes any accepted recovery job, then closes the browser server
and its current owned session.
`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['help', '--help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args, opts = {};
  if (!['start', 'recover'].includes(command) || rest.length % 2) throw new Error(HELP);
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--directory', '--port', '--finality-node', '--recovery-config'].includes(rest[i]) || Object.hasOwn(opts, rest[i]) || !rest[i + 1]) throw new Error(HELP);
    opts[rest[i]] = rest[i + 1];
  }
  if (command === 'start' && !opts['--directory'] || command === 'recover' && !opts['--recovery-config'] ||
      opts['--port'] !== undefined && !/^[0-9]{1,5}$/.test(opts['--port'])) throw new Error(HELP);
  const port = opts['--port'] === undefined ? 8426 : Number(opts['--port']);
  if (port > 65535) throw new Error(HELP);
  const recoveryProfile = opts['--recovery-config'] ?
    await readCommerceRecoveryConfig(resolve(opts['--recovery-config'])) : undefined;
  if (opts['--directory'] && recoveryProfile && resolve(opts['--directory']) !== recoveryProfile.directory)
    throw problem('The session directory must match the retained recovery configuration.', 409);
  const session = command === 'start' ? await openCommerce(resolve(opts['--directory']),
    { finalityNode: opts['--finality-node'] }) : null;
  let consoleSession, ending;
  const stop = () => ending ??= (async () => {
    const result = consoleSession ? await consoleSession.close() : session ?
      await completeCommerceShutdown(session, session.close()) : { state: 'STOPPED', drained: true };
    if (result?.drained === false) { process.exitCode = 2; setTimeout(() => process.exit(2), 20); }
    return result;
  })();
  let resolveSignal;
  const signalled = new Promise(done => { resolveSignal = done; });
  const interrupt = () => { resolveSignal(); void stop().catch(() => {}); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    consoleSession = await startCommerceConsole(session, { port, recoveryProfile,
      finalityNode: opts['--finality-node'] });
    process.stdout.write('Commerce workspace: ' + consoleSession.operatorUrl + '\n' +
      'Payment approval remains in this terminal. Keep it open.\n');
    await signalled;
  } finally {
    try { await stop(); if (consoleSession) await consoleSession.close(); }
    finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: commerceErrorCode(error),
      ...(error.message === HELP ? { usage: HELP } : {}) }) + '\n');
    process.exitCode = 1;
  });
}
