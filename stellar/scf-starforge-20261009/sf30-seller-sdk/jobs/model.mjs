// MIT. Purchased jobs over ORIGINAL SF30/SF98 settlement; application execution has its own durable lifetime.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { readJobMerchant, validateJobInput, digest, JOB_ID, HASH, jobError, plain } from './config.mjs';
import { openJobStore } from './store.mjs';
import { executeJob } from './execution.mjs';
import { openOutbox, instrumentNativeSettlement, SCHEMA as NATIVE_EVENT_SCHEMA } from '../../sf98-merchant-delivery/outbox.mjs';

const fail = (code, status = 400) => { throw jobError(code, status); };
const now = () => new Date().toISOString();
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
const pendingStates = new Set(['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING', 'CANCELLING']);
function label(value, fallback = '') {
  value ??= fallback;
  if (typeof value !== 'string' || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) fail('JOB_LABEL_INVALID');
  return value;
}
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) fail('JOB_REASON_REQUIRED');
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('JOB_EXPECTED_REVISION_REQUIRED');
  return value;
}
function history(row, action, detail = {}) {
  row.history.push({ at: now(), action, state: row.state, ...detail });
  row.history = row.history.slice(-512);
  return row;
}
function tokenMatches(row, token) {
  return tokenValid(token) && timingSafeEqual(Buffer.from(row.claimTokenHash, 'hex'), Buffer.from(digest(token), 'hex'));
}
function summary(row) {
  return { id: row.id, jobId: row.id, functionId: row.functionId, label: row.label,
    state: row.state, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
    submittedAt: row.submittedAt, inputSha256: row.inputSha256, payment: structuredClone(row.payment),
    nativeSettlement: row.settlement ? { id: row.settlement.id, at: row.settlement.at } : null,
    result: row.result ? (({ file, ...result }) => result)(row.result) : null,
    error: row.error, attempts: row.attempts.length };
}

export async function openJobMerchant({ configPath, directory, env = process.env } = {}) {
  if (typeof configPath !== 'string') fail('JOB_CONFIG_PATH_REQUIRED');
  const source = await readJobMerchant(configPath);
  const store = await openJobStore(directory, source);
  let outbox;
  try { outbox = await openOutbox(join(directory, 'outbox')); }
  catch (error) { await store.close(); throw error; }
  const active = new Map();
  let workerRunning = false, pumping = null, pumpAgain = false, closed = false, closing = null;
  let mode = 'STOPPED', sellerUrl = null, lastWorkerError = null, lastNativeError = null;
  let eventExceptions = [];
  function assertOpen() { if (closed || closing) fail('JOB_MERCHANT_CLOSED', 503); }
  function rowFor(id) {
    assertOpen(); if (typeof id !== 'string' || !JOB_ID.test(id)) fail('JOB_NOT_FOUND', 404);
    return store.get(id);
  }
  function urls(id) {
    const statusUrl = source.compiled.publicOrigin + '/jobs/' + encodeURIComponent(id);
    return { statusUrl, resultUrl: statusUrl + '/result' };
  }
  function accepted(row) {
    return { schema: 'stellar-forge.job-accepted.v1', jobId: row.id, functionId: row.functionId,
      inputSha256: row.inputSha256, state: 'AWAITING_SETTLEMENT', ...urls(row.id) };
  }
  function handoff(row, token, created = false) {
    const definition = source.compiled.functions[row.functionId];
    const purchaseUrl = new URL(definition.offer.resource.url);
    purchaseUrl.searchParams.set('sf98_order', row.id);
    const purchase = { url: purchaseUrl.href, method: 'POST', orderReference: row.id,
      headers: { 'x-sf98-order-id': row.id, 'x-sfjobs-token': token }, body: { jobId: row.id },
      payment: structuredClone(row.payment) };
    return { schema: 'stellar-forge.job-handoff.v1', created, job: summary(row),
      claimToken: token, purchase, acceptance: accepted(row), ...urls(row.id) };
  }
  function customerView(row) {
    return { schema: 'stellar-forge.job-status.v1', jobId: row.id, functionId: row.functionId,
      label: row.label, state: row.state, revision: row.revision, createdAt: row.createdAt,
      updatedAt: row.updatedAt, inputSha256: row.inputSha256,
      nativeSettlement: row.settlement ? { id: row.settlement.id, at: row.settlement.at } : null,
      result: row.state === 'COMPLETED' && row.result ? { bytes: row.result.bytes,
        sha256: row.result.sha256, contentType: row.result.contentType, filename: row.result.filename,
        url: urls(row.id).resultUrl } : null,
      error: row.error ? { code: row.error.code } : null };
  }
  function customerRow(id, token) {
    const row = rowFor(id);
    if (!tokenMatches(row, token)) fail('JOB_NOT_FOUND', 404);
    return row;
  }
  function eventMismatch(row, event) {
    if (event.schema !== NATIVE_EVENT_SCHEMA || event.authority !== 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' ||
        !HASH.test(event.id ?? '') || !HASH.test(event.receiptFingerprint ?? '') ||
        event.orderReference !== row.id || event.routeId !== row.functionId || event.method !== 'POST' ||
        event.network !== row.payment.network || event.amountAtomic !== row.payment.amount ||
        event.assetDigest !== digest(row.payment.asset) || event.recipientDigest !== digest(row.payment.payTo))
      return 'JOB_NATIVE_TERMS_MISMATCH';
    if (!row.submittedAt) return 'JOB_NOT_SUBMITTED';
    if (row.settlement && row.settlement.id !== event.id) return 'JOB_MULTIPLE_NATIVE_SETTLEMENTS';
    return null;
  }
  async function applyNativeEvent(event) {
    if (!event?.orderReference || !JOB_ID.test(event.orderReference)) return { ignored: true };
    let row;
    try { row = store.get(event.orderReference); } catch (error) {
      if (error.code === 'JOB_NOT_FOUND') return { ignored: true }; throw error;
    }
    const mismatch = eventMismatch(row, event);
    if (mismatch) return { exception: { jobId: row.id, eventId: event.id, code: mismatch } };
    if (row.settlement?.id === event.id) return { unchanged: true };
    await store.update(row.id, undefined, current => {
      const changed = eventMismatch(current, event);
      if (changed) fail(changed, 409);
      if (current.settlement?.id === event.id) return null;
      current.settlement = structuredClone(event);
      if (current.state === 'AWAITING_SETTLEMENT') current.state = 'QUEUED';
      current.error = null;
      return history(current, 'native-settlement', { eventId: event.id });
    });
    return { activated: true };
  }
  async function reconcile() {
    assertOpen();
    const result = { schema: 'stellar-forge.job-reconciliation.v1', activated: 0, unchanged: 0, ignored: 0, exceptions: [] };
    for (const { event } of await outbox.rows()) {
      const outcome = await applyNativeEvent(event);
      if (outcome.exception) result.exceptions.push(outcome.exception);
      else if (outcome.activated) result.activated++;
      else if (outcome.unchanged) result.unchanged++;
      else result.ignored++;
    }
    eventExceptions = result.exceptions.slice(-100); lastNativeError = null;
    schedule(); return result;
  }
  async function finishAttempt(id, attemptId, body, error) {
    const slot = active.get(id);
    if (slot?.controller.signal.aborted) error ??= slot.controller.signal.reason;
    let saved = null;
    if (!error && body) {
      try { saved = await store.writeResult(body); }
      catch (failure) { error = failure; }
    }
    await store.update(id, undefined, current => {
      const attempt = current.attempts.at(-1);
      if (!attempt || attempt.id !== attemptId || !['RUNNING', 'CANCELLING'].includes(current.state))
        fail('JOB_ATTEMPT_STATE_CHANGED', 409);
      if (slot?.controller.signal.aborted) error ??= slot.controller.signal.reason;
      if (current.state === 'CANCELLING') error = jobError('JOB_EXECUTION_CANCELLED', 409);
      attempt.finishedAt = now();
      if (error) {
        const code = /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_EXECUTION_FAILED';
        current.state = code === 'JOB_EXECUTION_CANCELLED' ? 'CANCELLED' :
          code === 'JOB_WORKER_STOPPED' ? 'INTERRUPTED' : 'FAILED';
        current.error = { code, at: attempt.finishedAt }; attempt.state = current.state; attempt.error = current.error;
        return history(current, 'execution-finished', { attemptId, code });
      }
      const definition = source.compiled.functions[current.functionId];
      current.result = { ...saved, contentType: definition.output.contentType, filename: definition.output.filename };
      current.state = 'COMPLETED'; current.error = null; attempt.state = 'COMPLETED';
      attempt.resultSha256 = saved.sha256;
      return history(current, 'execution-finished', { attemptId, resultSha256: saved.sha256 });
    });
  }
  function schedule() {
    if (closed || closing || !workerRunning) return;
    if (pumping) { pumpAgain = true; return; }
    pumping = Promise.resolve().then(async () => {
      while (workerRunning && active.size < source.compiled.workerCount) {
        const candidate = store.rows().filter(row => row.state === 'QUEUED' && !active.has(row.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
        if (!candidate) break;
        const slot = { controller: new AbortController(), promise: null };
        active.set(candidate.id, slot);
        let row;
        try {
          row = await store.update(candidate.id, candidate.revision, current => {
            if (current.state !== 'QUEUED' || !current.settlement) fail('JOB_NOT_READY', 409);
            if (current.attempts.length >= 100) fail('JOB_ATTEMPT_LIMIT', 409);
            const attempt = { id: randomUUID(), startedAt: now(), finishedAt: null, state: 'RUNNING', error: null };
            current.attempts.push(attempt); current.state = 'RUNNING'; current.error = null;
            return history(current, 'execution-started', { attemptId: attempt.id });
          });
        } catch (error) {
          active.delete(candidate.id);
          // An operator may cancel a queued record before its serialized claim.
          // Refresh the queue after that revision race and keep other paid jobs moving.
          if (error.code === 'JOB_REVISION_CHANGED') continue;
          throw error;
        }
        const attempt = row.attempts.at(-1);
        slot.promise = executeJob(source, row, attempt, { env, signal: slot.controller.signal })
          .then(body => finishAttempt(row.id, attempt.id, body, null), error => finishAttempt(row.id, attempt.id, null, error))
          .catch(error => { lastWorkerError = /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_STORAGE_UNAVAILABLE'; workerRunning = false; })
          .finally(() => { active.delete(row.id); schedule(); });
      }
    }).catch(error => {
      lastWorkerError = /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_WORKER_UNAVAILABLE'; workerRunning = false;
    }).finally(() => {
      pumping = null;
      if (pumpAgain) { pumpAgain = false; schedule(); }
    });
  }
  async function stopWorker({ cancelRunning = true } = {}) {
    workerRunning = false;
    await pumping;
    if (cancelRunning) for (const slot of active.values())
      slot.controller.abort(jobError('JOB_WORKER_STOPPED', 409));
    await Promise.all([...active.values()].map(slot => slot.promise));
    return { running: false, active: active.size, error: lastWorkerError };
  }
  async function output(row) {
    if (row.state !== 'COMPLETED' || !row.result) fail('JOB_RESULT_NOT_READY', 409);
    const body = await store.readResult(row.result);
    return { body, bytes: body.length, sha256: row.result.sha256, contentType: row.result.contentType, filename: row.result.filename };
  }
  // Acquiring the kernel-held original lease proves the previous merchant process
  // and its Worker threads retired. Unfinished executions require explicit retry.
  try {
    for (const row of store.rows()) if (['RUNNING', 'CANCELLING'].includes(row.state)) {
      await store.update(row.id, row.revision, current => {
        current.state = 'INTERRUPTED'; current.error = { code: 'JOB_PROCESS_INTERRUPTED', at: now() };
        const attempt = current.attempts.at(-1);
        if (attempt) { attempt.state = 'INTERRUPTED'; attempt.finishedAt = now(); attempt.error = current.error; }
        return history(current, 'interruption-recovered');
      });
    }
    await reconcile();
  } catch (error) { await store.close(); throw error; }

  const model = {
    directory, configPath: source.configPath, configuration: source.compiled,
    async snapshot() {
      assertOpen();
      const rows = store.rows(), counts = {};
      for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
      return { schema: 'stellar-forge.job-workspace.v1', revision: rows.reduce((sum, row) => sum + row.revision, 0),
        directory, configPath: source.configPath, source: source.identity,
        serviceName: source.compiled.serviceName, publicOrigin: source.compiled.publicOrigin, mode, sellerUrl,
        worker: { running: workerRunning, draining: !workerRunning && active.size > 0,
          active: active.size, maxConcurrency: source.compiled.workerCount, error: lastWorkerError },
        storage: store.fault ?? 'ready', nativeActivationError: lastNativeError,
        functions: Object.values(source.compiled.functions).map(({ inputOffer, offer, ...definition }) => structuredClone(definition)),
        jobs: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(summary),
        counts, eventExceptions: structuredClone(eventExceptions) };
    },
    async get(id) {
      const { claimTokenHash, ...row } = rowFor(id);
      return { ...row, ...urls(id), nativeSettlement: row.settlement ? { id: row.settlement.id, at: row.settlement.at } : null };
    },
    async createJob({ functionId, input, label: requestedLabel, reference, claimToken } = {}) {
      assertOpen();
      const definition = source.compiled.functions[functionId];
      if (!definition) fail('JOB_FUNCTION_NOT_FOUND', 404);
      const validated = validateJobInput(definition, input);
      const id = reference ?? ('job_' + randomUUID());
      if (typeof id !== 'string' || !JOB_ID.test(id)) fail('JOB_REFERENCE_INVALID');
      const token = claimToken ?? randomBytes(32).toString('base64url');
      if (!tokenValid(token)) fail('JOB_CLAIM_TOKEN_INVALID');
      let existing = null;
      try { existing = store.get(id); } catch (error) { if (error.code !== 'JOB_NOT_FOUND') throw error; }
      let row;
      if (existing) {
        if (!claimToken || !tokenMatches(existing, claimToken) || existing.functionId !== functionId ||
            existing.inputSha256 !== validated.inputSha256) fail('JOB_REFERENCE_EXISTS', 409);
        row = existing;
      } else {
        if (store.rows().filter(item => pendingStates.has(item.state)).length >= source.compiled.maxPending)
          fail('JOB_QUEUE_FULL', 429);
        const at = now();
        row = await store.create({ schema: 'stellar-forge.application-job.v1', id, functionId,
          label: label(requestedLabel, id), state: 'PREPARED', revision: 1, createdAt: at, updatedAt: at,
          submittedAt: null, ...validated, claimTokenHash: digest(token), source: source.identity,
          payment: structuredClone(definition.payment), settlement: null, result: null, error: null,
          attempts: [], history: [{ at, action: 'prepared', state: 'PREPARED' }] });
      }
      return handoff(row, token, !existing);
    },
    async renewClaim({ id, expectedRevision, reason: why, claimToken } = {}) {
      assertOpen(); revision(expectedRevision); reason(why);
      if (typeof id !== 'string' || !JOB_ID.test(id)) fail('JOB_NOT_FOUND', 404);
      const token = claimToken ?? randomBytes(32).toString('base64url');
      if (!tokenValid(token)) fail('JOB_CLAIM_TOKEN_INVALID');
      const row = await store.renewClaim(id, expectedRevision, digest(token), why);
      return handoff(row, token);
    },
    async withdrawPrepared({ id, token, expectedRevision, reason: why } = {}) {
      assertOpen(); revision(expectedRevision); reason(why);
      if (typeof id !== 'string' || !JOB_ID.test(id)) fail('JOB_NOT_FOUND', 404);
      const row = await store.update(id, undefined, current => {
        // Capability and phase are checked in the same original store operation
        // as cancellation. A concurrently staged purchase wins or loses atomically.
        if (!tokenMatches(current, token)) fail('JOB_NOT_FOUND', 404);
        if (current.state === 'CANCELLED' && current.submittedAt === null && current.settlement === null)
          return null;
        if (current.revision !== expectedRevision) fail('JOB_REVISION_CHANGED', 409);
        if (current.state !== 'PREPARED' || current.submittedAt !== null || current.settlement !== null)
          fail('JOB_WITHDRAWAL_NOT_AVAILABLE', 409);
        current.state = 'CANCELLED';
        return history(current, 'customer-withdrawn', { reason: why });
      });
      return customerView(row);
    },
    async admitJob(functionId, context) {
      try {
        assertOpen();
        const id = context?.body?.jobId;
        if (!plain(context?.body) || Object.keys(context.body).length !== 1 || typeof id !== 'string' || !JOB_ID.test(id))
          fail('JOB_REQUEST_INVALID', 422);
        const row = store.get(id);
        if (row.functionId !== functionId || context.query?.sf98_order !== id || context.headers?.['x-sf98-order-id'] !== id ||
            !tokenMatches(row, context.headers?.['x-sfjobs-token'])) fail('JOB_NOT_FOUND', 404);
        if (row.state !== 'PREPARED') fail('JOB_ALREADY_SUBMITTED', 409);
        return true;
      } catch (error) { return { status: [404, 409, 422, 429].includes(error.status) ? error.status : 409,
        body: { error: /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_REQUEST_UNAVAILABLE' } }; }
    },
    async stageJob(functionId, context) {
      const admission = await model.admitJob(functionId, context);
      if (admission !== true) return admission;
      try {
        const id = context.body.jobId;
        const row = await store.update(id, undefined, current => {
          // Admission precedes native verification. A claim can be renewed while
          // that verification is in flight, so recheck it in the serialized stage.
          if (!tokenMatches(current, context.headers?.['x-sfjobs-token'])) fail('JOB_NOT_FOUND', 404);
          if (current.state !== 'PREPARED') fail('JOB_ALREADY_SUBMITTED', 409);
          current.state = 'AWAITING_SETTLEMENT'; current.submittedAt = now();
          return history(current, 'submitted');
        });
        return { status: 202, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }, body: accepted(row) };
      } catch (error) { return { status: [404, 409].includes(error.status) ? error.status : 503,
        body: { error: /^JOB_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'JOB_STAGING_UNAVAILABLE' } }; }
    },
    bindNativeFactory(factory) {
      if (typeof factory !== 'function') fail('JOB_NATIVE_FACTORY_REQUIRED');
      return async compiled => instrumentNativeSettlement(await factory(compiled), { compiled,
        outbox: { async record(event) {
          const receipt = await outbox.record(event);
          const result = await applyNativeEvent(event);
          if (result.exception) eventExceptions = [...eventExceptions, result.exception].slice(-100);
          lastNativeError = null; schedule(); return receipt;
        } },
        onWriteFailure: () => { lastNativeError = 'JOB_NATIVE_ACTIVATION_UNAVAILABLE'; },
      });
    },
    deliveryOutbox: outbox,
    setSellerStatus(status) { mode = status.mode; sellerUrl = status.url ?? null; },
    reconcile,
    async startWorker() { assertOpen(); await reconcile(); lastWorkerError = null; workerRunning = true; schedule(); return model.snapshot(); },
    stopWorker,
    async cancel({ id, expectedRevision, reason: why } = {}) {
      assertOpen(); revision(expectedRevision); reason(why);
      const row = await store.update(id, expectedRevision, current => {
        if (current.state === 'COMPLETED') fail('JOB_ALREADY_COMPLETED', 409);
        if (current.state === 'CANCELLED') return null;
        current.state = ['RUNNING', 'CANCELLING'].includes(current.state) ? 'CANCELLING' : 'CANCELLED';
        return history(current, 'cancel-requested', { reason: why });
      });
      active.get(id)?.controller.abort(jobError('JOB_EXECUTION_CANCELLED', 409));
      return model.get(row.id);
    },
    async retry({ id, expectedRevision, reason: why } = {}) {
      assertOpen(); revision(expectedRevision); reason(why);
      const row = await store.update(id, expectedRevision, current => {
        if (!['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(current.state) || !current.settlement || current.result || active.has(id))
          fail('JOB_RETRY_NOT_AVAILABLE', 409);
        if (current.attempts.length >= 100) fail('JOB_ATTEMPT_LIMIT', 409);
        current.state = 'QUEUED'; current.error = null;
        return history(current, 'retry-requested', { reason: why });
      });
      schedule(); return model.get(row.id);
    },
    async result(id) { return output(rowFor(id)); },
    async customerStatus({ id, token } = {}) { return customerView(customerRow(id, token)); },
    async customerResult({ id, token } = {}) { return output(customerRow(id, token)); },
    async close() {
      if (closing) return closing;
      closing = (async () => { await stopWorker(); await store.close(); closed = true; return { stopped: true }; })();
      return closing;
    },
  };
  return Object.freeze(model);
}
