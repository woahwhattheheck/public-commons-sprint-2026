// MIT. Purchased allowance runs the original source-pinned application executor.
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { openJobStore } from '../../sf30-seller-sdk/jobs/store.mjs';
import { executeJob } from '../../sf30-seller-sdk/jobs/execution.mjs';
import { canonical, digest, plain, validateJobInput, jobError } from '../../sf30-seller-sdk/jobs/config.mjs';
import { OPERATION, KEY_HEADER, MAX_RESULT, requestIdentity, jsonBytes } from './configuration.mjs';
import { allowance } from './allowance-client.mjs';

export const ADMISSION_SCHEMA = 'stellar-forge.sf101.api-application-admission.v1';
export const EXECUTION_SCHEMA = 'stellar-forge.sf101.api-application-execution.v1';
export const CONTROL_PATH = '/_sf101-application';
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'CANCELLING']);
const now = () => new Date().toISOString();
const fail = (code, status = 409) => { throw jobError(code, status); };
const safeCode = error => /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'APP_OPERATION_FAILED';
function history(row, action, detail = {}) {
  row.history.push({ at: now(), action, state: row.state, ...detail });
  row.history = row.history.slice(-512);
  return row;
}
export function validateExecution(runtime, row) {
  const payment = row.payment;
  const route = runtime.routes.find(item => item.id === payment?.routeId);
  if (!plain(payment) || payment.schema !== ADMISSION_SCHEMA ||
      payment.authority !== 'sf101-purchased-api-allowance' || payment.operation !== row.id ||
      payment.profileSha256 !== runtime.profileSha256 || payment.gatewaySha256 !== runtime.profile.gatewaySha256 ||
      payment.functionId !== row.functionId || payment.inputSha256 !== row.inputSha256 ||
      !route || route.functionId !== row.functionId || route.path !== payment.path ||
      payment.method !== 'POST' || row.settlement !== null || !OPERATION.test(row.id) ||
      typeof payment.orderRef !== 'string' || typeof payment.requestId !== 'string' ||
      row.id !== 'sf101-' + digest(canonical([payment.orderRef, payment.requestId])) ||
      !['requestSha256', 'inputSha256', 'bodySha256', 'manifestSha256', 'planSha256'].every(key =>
        typeof payment[key] === 'string' && /^[a-f0-9]{64}$/.test(payment[key])) ||
      !Number.isSafeInteger(payment.units) || payment.units < 1 || typeof payment.responseContentType !== 'string' ||
      (row.result !== null && row.result.contentType !== payment.responseContentType))
    fail('APP_NATIVE_ADMISSION_CHANGED');
  return row;
}
export function executionView(row, { includeInput = false } = {}) {
  return { id: row.id, revision: row.revision, state: row.state, functionId: row.functionId,
    createdAt: row.createdAt, updatedAt: row.updatedAt, source: row.source,
    payment: row.payment, settlement: null, inputSha256: row.inputSha256,
    ...(includeInput ? { input: row.input } : {}), result: row.result,
    attempts: row.attempts, history: row.history, error: row.error ?? null };
}
export async function executionExport(runtime, store, id, { body = true } = {}) {
  const row = validateExecution(runtime, store.get(id));
  const result = { schema: EXECUTION_SCHEMA, profileSha256: runtime.profileSha256,
    execution: executionView(row) };
  if (body && row.result) {
    const bytes = await store.readResult(row.result);
    if (bytes.length > MAX_RESULT) fail('APP_RETAINED_RESULT_TOO_LARGE');
    result.bodyBase64 = bytes.toString('base64');
  }
  return result;
}
function uniqueHeader(request, name) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index].toLowerCase() === name.toLowerCase()) values.push(request.rawHeaders[index + 1]);
  if (values.length > 1) fail('APP_DUPLICATE_HEADER', 400);
  return values[0] ?? '';
}
function authorize(runtime, request) {
  const actual = Buffer.from(uniqueHeader(request, KEY_HEADER));
  const expected = Buffer.from(runtime.capability);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('APP_ACCESS_DENIED', 404);
  if (uniqueHeader(request, 'host') !== new URL(runtime.profile.origin).host) fail('APP_HOST_DENIED', 403);
  if (uniqueHeader(request, 'origin')) fail('APP_PRIVATE_CLIENT_REQUIRED', 403);
}
async function bodyBytes(request, limit) {
  if (uniqueHeader(request, 'transfer-encoding')) fail('APP_CONTENT_LENGTH_REQUIRED', 411);
  const length = uniqueHeader(request, 'content-length');
  if (length && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit))
    fail('APP_BODY_TOO_LARGE', 413);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail('APP_BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  if (length && size !== Number(length)) fail('APP_BODY_INCOMPLETE', 400);
  return Buffer.concat(chunks);
}
function reply(response, status, bytes, contentType = 'application/json') {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Connection': 'close' });
  response.end(bytes);
}
const jsonReply = (response, status, value) => reply(response, status, jsonBytes(value));

export async function cancelUnstartedExecution(runtime, store, id, { expectedRevision, reason, operationId } = {}) {
  const before = validateExecution(runtime, store.get(id));
  if ((expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) ||
      (reason !== undefined && (typeof reason !== 'string' || !reason || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))) ||
      (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId))))
    fail('APP_CANCEL_FIELDS_REQUIRED', 400);
  const requestSha256 = operationId ? digest(canonical({ id, expectedRevision, reason, operationId })) : null;
  const prior = operationId && before.history.find(item => item.action === 'unstarted-cancelled' && item.operationId === operationId);
  if (prior && prior.requestSha256 !== requestSha256) fail('APP_CANCELLATION_INPUT_CHANGED');
  if (before.state === 'CANCELLED' && before.attempts.length === 0) return before;
  if (before.attempts.length || !['QUEUED', 'INTERRUPTED'].includes(before.state))
    fail('APP_EXECUTION_HAS_STARTED');
  return store.update(id, expectedRevision ?? before.revision, current => {
    if (current.attempts.length || !['QUEUED', 'INTERRUPTED'].includes(current.state))
      fail('APP_EXECUTION_HAS_STARTED');
    current.state = 'CANCELLED'; current.error = { code: 'APP_EXECUTION_NOT_STARTED', at: now() };
    return history(current, 'unstarted-cancelled', {
      reason: reason || 'Gateway connection closed before native execution.',
      ...(operationId ? { operationId, requestSha256 } : {}),
    });
  });
}

/** The original exclusive job lease owns this separate application's execution root. */
export async function startApplication(runtime, { env = process.env, python } = {}) {
  const store = await openJobStore(runtime.profile.store, runtime.source);
  let running = true, pumping = null, stopping = null, lastFault = null;
  const pending = new Map(), active = new Map(), admissions = new Map(), requests = new Set(), sockets = new Set();
  const queue = [];
  let server;
  const admissionRequest = (route, requestSha256, operation) =>
    ({ operation, routeId: route.id, method: 'POST', path: route.path, requestSha256,
      responseContentType: runtime.source.compiled.functions[route.functionId].output.contentType });
  const checkAdmission = async (route, requestSha256, operation) => {
    try { return await allowance(runtime, 'admit', admissionRequest(route, requestSha256, operation), { python }); }
    catch (error) { error.suppressHttp = true; throw error; }
  };
  function get(id) { return validateExecution(runtime, store.get(id)); }
  function settle(entry, error = null) {
    if (!entry || entry.settled) return;
    entry.settled = true; pending.delete(entry.id);
    for (const [response, handler] of entry.listeners) response.off('close', handler);
    entry.listeners.clear();
    if (error) entry.reject(error); else {
      try { entry.resolve(get(entry.id)); } catch (failure) { entry.reject(failure); }
    }
  }
  function entryFor(id) {
    let entry = pending.get(id);
    if (!entry) {
      let resolve, reject;
      const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
      // Socket disappearance can leave no waiter. Persisting its terminal outcome
      // must still complete without an unhandled rejected promise.
      promise.catch(() => {});
      entry = { id, promise, resolve, reject, listeners: new Map(), settled: false };
      pending.set(id, entry); queue.push(id);
    }
    return entry;
  }
  function liveWaiters(entry) {
    return [...entry.listeners.keys()].some(response => !response.destroyed && !response.writableEnded);
  }
  async function cancelUnstarted(id, options = {}) {
    const row = await cancelUnstartedExecution(runtime, store, id, options);
    settle(pending.get(id));
    return row;
  }
  async function normalizeInterrupted() {
    for (const row of store.rows()) {
      validateExecution(runtime, row);
      if (!ACTIVE.has(row.state)) continue;
      await store.update(row.id, row.revision, current => {
        if (current.state === 'QUEUED' && current.attempts.length === 0) {
          current.state = 'CANCELLED'; current.error = { code: 'APP_EXECUTION_NOT_STARTED', at: now() };
          return history(current, 'unstarted-cancelled', { reason: 'Worker restarted before native execution.' });
        }
        current.state = 'INTERRUPTED'; current.error = { code: 'JOB_PROCESS_INTERRUPTED', at: now() };
        const attempt = current.attempts.at(-1);
        if (attempt) { attempt.state = 'INTERRUPTED'; attempt.finishedAt = now(); attempt.error = current.error; }
        return history(current, 'interruption-recovered');
      });
    }
  }
  async function retainAdmission(route, body, contentType, accept, operation) {
    const identity = requestIdentity(runtime, route, body, contentType, accept);
    const requestSha256 = digest(canonical(identity));
    let existing;
    try { existing = get(operation); } catch (error) { if (error.code !== 'JOB_NOT_FOUND') throw error; }
    if (existing) {
      if (existing.payment.requestSha256 !== requestSha256 || existing.functionId !== route.functionId)
        fail('APP_OPERATION_INPUT_CHANGED');
      return existing;
    }
    if (admissions.has(operation)) {
      const row = await admissions.get(operation);
      if (row.payment.requestSha256 !== requestSha256 || row.functionId !== route.functionId)
        fail('APP_OPERATION_INPUT_CHANGED');
      return row;
    }
    const task = (async () => {
      if (!running) fail('APP_WORKER_STOPPING', 503);
      if (!/^application\/json(?: *; *charset=(?:utf-8|"utf-8"))?$/i.test(contentType))
        fail('APP_JSON_CONTENT_TYPE_REQUIRED', 415);
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
      catch { fail('APP_JSON_INPUT_REQUIRED', 422); }
      const definition = runtime.source.compiled.functions[route.functionId];
      const checked = validateJobInput(definition, parsed);
      const admission = await checkAdmission(route, requestSha256, operation);
      if (!running) fail('APP_WORKER_STOPPING', 503);
      const at = now();
      const row = { schema: 'stellar-forge.application-job.v1', id: operation, revision: 1,
        state: 'QUEUED', createdAt: at, updatedAt: at, functionId: route.functionId,
        input: checked.input, inputSha256: checked.inputSha256,
        claimTokenHash: digest(runtime.capability + '\0' + operation),
        source: runtime.source.identity, payment: { ...admission,
          profileSha256: runtime.profileSha256, gatewaySha256: runtime.profile.gatewaySha256,
          functionId: route.functionId, inputSha256: checked.inputSha256, bodySha256: digest(body) },
        settlement: null, result: null, attempts: [], history: [], error: null };
      history(row, 'allowance-admitted', { requestSha256, orderRef: admission.orderRef,
        requestId: admission.requestId, units: admission.units });
      return store.create(row);
    })();
    admissions.set(operation, task);
    try { return await task; } finally { if (admissions.get(operation) === task) admissions.delete(operation); }
  }
  async function finishAttempt(slot, body, failure) {
    const definition = runtime.source.compiled.functions[slot.row.functionId];
    let saved = null;
    if (slot.controller.signal.aborted) failure = slot.controller.signal.reason || jobError('JOB_WORKER_STOPPED', 409);
    if (!failure) {
      try { saved = await store.writeResult(body); }
      catch (error) { failure = error; }
    }
    return store.update(slot.row.id, undefined, current => {
      const attempt = current.attempts.at(-1);
      if (!attempt || attempt.id !== slot.attempt.id || !['RUNNING', 'CANCELLING'].includes(current.state))
        fail('APP_EXECUTION_ATTEMPT_CHANGED');
      if (slot.controller.signal.aborted) failure = slot.controller.signal.reason || jobError('JOB_WORKER_STOPPED', 409);
      if (current.state === 'CANCELLING') failure = jobError('JOB_EXECUTION_CANCELLED', 409);
      if (failure) {
        const code = /^JOB_[A-Z_]+$/.test(failure.code ?? '') ? failure.code : 'JOB_EXECUTION_FAILED';
        current.state = code === 'JOB_EXECUTION_CANCELLED' ? 'CANCELLED'
          : code === 'JOB_WORKER_STOPPED' ? 'INTERRUPTED' : 'FAILED';
        current.error = { code, at: now() }; attempt.state = current.state; attempt.error = current.error;
      } else {
        current.result = { ...saved, contentType: current.payment.responseContentType, filename: definition.output.filename };
        current.state = 'COMPLETED'; current.error = null; attempt.state = 'COMPLETED';
        attempt.error = null; attempt.resultSha256 = saved.sha256;
      }
      attempt.finishedAt = now();
      return history(current, 'execution-finished', { attemptId: attempt.id });
    });
  }
  function launch(row, entry) {
    const attempt = row.attempts.at(-1), controller = new AbortController();
    const slot = { row, attempt, controller, promise: null };
    active.set(row.id, slot);
    slot.promise = executeJob(runtime.source, row, attempt, { env, signal: controller.signal })
      .then(body => finishAttempt(slot, body, null), error => finishAttempt(slot, null, error))
      .then(() => settle(entry))
      .catch(error => {
        lastFault = safeCode(error);
        try {
          const retained = get(row.id);
          if (retained.state === 'COMPLETED' && retained.result) { settle(entry); return; }
        } catch { /* The original store remains the source of the readable row. */ }
        settle(entry, error);
      })
      .finally(() => { active.delete(row.id); pump(); });
  }
  function pump() {
    if (!running || pumping) return;
    pumping = (async () => {
      while (running && active.size < runtime.source.compiled.workerCount && queue.length) {
        const id = queue.shift(), entry = pending.get(id);
        if (!entry || entry.settled || active.has(id)) continue;
        try {
          let row = get(id);
          if (row.state !== 'QUEUED') { settle(entry); continue; }
          if (!liveWaiters(entry)) { await cancelUnstarted(id); continue; }
          const route = runtime.routes.find(value => value.functionId === row.functionId);
          const admission = await checkAdmission(route, row.payment.requestSha256, id);
          if (!running || !liveWaiters(entry)) {
            await cancelUnstarted(id, { reason: 'Gateway stopped waiting before native execution.' }); continue;
          }
          row = await store.update(id, row.revision, current => {
            if (current.state !== 'QUEUED' || current.attempts.length !== 0)
              fail('APP_EXECUTION_ALREADY_ATTEMPTED');
            if (Date.now() >= Date.parse(admission.deadlineAt)) fail('APP_RESERVATION_EXPIRED');
            current.state = 'RUNNING'; current.error = null;
            const attempt = { id: randomUUID(), startedAt: now(), finishedAt: null, state: 'RUNNING', error: null };
            current.attempts.push(attempt);
            return history(current, 'execution-started', { attemptId: attempt.id });
          });
          launch(row, entry);
        } catch (error) {
          lastFault = safeCode(error);
          try {
            const retained = get(id);
            if (retained.state === 'QUEUED' && !retained.attempts.length)
              await cancelUnstarted(id, { reason: 'Native admission ended: ' + safeCode(error) });
            else settle(entry);
          } catch (failure) { settle(entry, failure); }
        }
      }
    })().catch(error => { lastFault = safeCode(error); })
      .finally(() => {
        pumping = null;
        if (running && queue.length && active.size < runtime.source.compiled.workerCount) pump();
      });
  }
  async function waitFor(row, response) {
    if (row.state !== 'QUEUED' && !active.has(row.id)) return row;
    const entry = entryFor(row.id);
    const closed = () => {
      entry.listeners.delete(response);
      if (!active.has(row.id) && !liveWaiters(entry))
        cancelUnstarted(row.id).catch(error => { if (error.code !== 'APP_EXECUTION_HAS_STARTED' && error.code !== 'JOB_REVISION_CHANGED') lastFault = safeCode(error); });
    };
    entry.listeners.set(response, closed); response.once('close', closed);
    if (response.destroyed) closed();
    pump();
    return entry.promise;
  }
  function status() {
    const rows = store.rows(), counts = {};
    let resultBytes = 0;
    for (const row of rows) {
      counts[row.state] = (counts[row.state] || 0) + 1;
      resultBytes += row.result?.bytes ?? 0;
    }
    return { schema: 'stellar-forge.sf101.api-application-status.v1', running,
      source: runtime.source.identity, profileSha256: runtime.profileSha256,
      routes: runtime.routes.map(route => ({ id: route.id, functionId: route.functionId, path: route.path })),
      counts, retainedExecutions: rows.length, retainedResultBytes: resultBytes, activeWorkers: active.size,
      pendingExecutions: [...pending.values()].filter(entry => !active.has(entry.id)).length,
      workerCount: runtime.source.compiled.workerCount, maxPending: runtime.source.compiled.maxPending,
      maxJobs: runtime.source.compiled.maxJobs, fault: store.fault || lastFault };
  }
  async function control(request, response, url) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === CONTROL_PATH + '/status' && !url.search)
      return jsonReply(response, 200, status());
    if (parts.length === 2 && parts[1] === 'executions' && request.method === 'GET') {
      if ([...url.searchParams.keys()].some(key => !['after', 'limit'].includes(key))) fail('APP_QUERY_REQUIRED', 400);
      const limit = Number(url.searchParams.get('limit') || 50), after = url.searchParams.get('after') || '';
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (after && !OPERATION.test(after)))
        fail('APP_PAGE_REQUIRED', 400);
      const selected = store.rows().filter(row => row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit + 1);
      const more = selected.length > limit, page = selected.slice(0, limit);
      return jsonReply(response, 200, { schema: 'stellar-forge.sf101.api-application-executions.v1',
        executions: page.map(row => executionView(validateExecution(runtime, row))),
        nextAfter: more ? page.at(-1).id : null });
    }
    if (parts.length < 3 || parts[1] !== 'executions' || !OPERATION.test(parts[2]) || url.search)
      fail('APP_NOT_FOUND', 404);
    const id = parts[2];
    if (parts.length === 3 && request.method === 'GET')
      return jsonReply(response, 200, await executionExport(runtime, store, id, { body: false }));
    if (parts.length === 4 && parts[3] === 'recovery' && request.method === 'GET')
      return jsonReply(response, 200, await executionExport(runtime, store, id));
    if (parts.length === 4 && parts[3] === 'cancel-unstarted' && request.method === 'POST') {
      let value;
      try { value = JSON.parse((await bodyBytes(request, 8192)).toString('utf8')); }
      catch { fail('APP_CONTROL_JSON_REQUIRED', 400); }
      if (!plain(value) || Object.keys(value).some(key => !['expectedRevision', 'operationId', 'reason'].includes(key)) ||
          !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 ||
          typeof value.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.operationId) ||
          typeof value.reason !== 'string' || !value.reason || value.reason.length > 500 || /[\x00-\x1f\x7f]/.test(value.reason))
        fail('APP_CANCEL_FIELDS_REQUIRED', 400);
      await cancelUnstarted(id, value);
      return jsonReply(response, 200, await executionExport(runtime, store, id, { body: false }));
    }
    fail('APP_NOT_FOUND', 404);
  }
  async function handle(request, response) {
    let retained = false;
    try {
      authorize(runtime, request);
      const url = new URL(request.url, runtime.profile.origin);
      if (url.origin !== runtime.profile.origin) fail('APP_ORIGIN_DENIED', 403);
      if (url.pathname.startsWith(CONTROL_PATH + '/')) return await control(request, response, url);
      const route = runtime.routes.find(item => item.path === url.pathname);
      if (!route || request.method !== 'POST' || url.search) fail('APP_ROUTE_NOT_FOUND', 404);
      const operation = uniqueHeader(request, 'idempotency-key');
      if (!OPERATION.test(operation)) fail('APP_OPERATION_REQUIRED', 400);
      const contentType = uniqueHeader(request, 'content-type'), accept = uniqueHeader(request, 'accept');
      if (!contentType || contentType.length > 255 || !accept || accept.length > 256 ||
          /[^\x20-\x7e]/.test(contentType + accept)) fail('APP_REQUEST_HEADERS_REQUIRED', 400);
      const body = await bodyBytes(request, route.maxInputBytes);
      const row = await retainAdmission(route, body, contentType, accept, operation);
      retained = true;
      const outcome = await waitFor(row, response);
      if (outcome.state !== 'COMPLETED' || !outcome.result) {
        response.destroy(); return;
      }
      const result = await store.readResult(outcome.result);
      reply(response, 200, result, outcome.result.contentType);
    } catch (error) {
      lastFault = safeCode(error);
      // A retained/uncertain native execution never becomes a charged HTTP error.
      // The original gateway retains its reservation for explicit native recovery.
      if (retained || error.suppressHttp || /^APP_(?:LIVE_RESERVATION|RESERVATION_EXPIRED|ORIGINAL_ACCESS|REQUEST_FINGERPRINT|PASS_RESERVATION)/.test(error.code || '')) {
        response.destroy(); return;
      }
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      jsonReply(response, status, { ok: false, error: safeCode(error) });
    }
  }
  try {
    await normalizeInterrupted();
    server = createServer((request, response) => {
      const task = handle(request, response).catch(() => response.destroy());
      requests.add(task); task.finally(() => requests.delete(task));
    });
    server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
    server.maxRequestsPerSocket = 1;
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(runtime.profile.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { running = false; await store.close(); throw error; }
  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      running = false;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections?.();
      await pumping;
      await Promise.allSettled([...admissions.values()]);
      for (const entry of [...pending.values()]) {
        if (!active.has(entry.id)) {
          try { await cancelUnstarted(entry.id, { reason: 'Worker stopped before native execution.' }); }
          catch (error) { settle(entry, error); }
        }
      }
      for (const slot of active.values()) slot.controller.abort(jobError('JOB_WORKER_STOPPED', 409));
      await Promise.allSettled([...active.values()].map(slot => slot.promise));
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...requests]); await closed;
      await store.close();
    })();
    return stopping;
  }
  return Object.freeze({ origin: runtime.profile.origin, status, stop });
}
