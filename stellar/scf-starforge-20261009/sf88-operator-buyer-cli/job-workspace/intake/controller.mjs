// MIT. Durable self-service requests join the existing original job checkout.
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicHttpsFetch } from '../../../sf31-buyer-client/public-transport.mjs';
import { readBytes, writeBytes, parseJson, exists } from '../../node/store.mjs';
import { readJobCheckoutTicket } from '../checkout/contract.mjs';
import { canonicalDirectory } from '../state.mjs';
import { CATALOG_PATH, REQUEST_PATH, WITHDRAW_PATH, REQUEST_SCHEMA, WITHDRAW_SCHEMA, HASH, JOB_ID, CLAIM,
  MAX_CATALOG_BYTES, MAX_RESPONSE_BYTES, canonical, sha256, text, object, need, problem, originOf,
  validateCatalog, validateFunction, validateRequest, validateResponse } from '../../../sf30-seller-sdk/jobs/intake/protocol.mjs';

export const JOB_INTAKE_SCHEMA = 'stellar-forge.sf88.job-intake.v1';
export const JOB_INTAKE_PHASES = ['DRAFT', 'READY', 'IMPORTED', 'RECOVERABLE', 'WITHDRAWN'];
const MAX_ROW_BYTES = 2097152;
const now = () => new Date().toISOString();
const safeCode = error => /^[A-Z][A-Z0-9_]{0,119}$/.test(error?.code ?? '') ? error.code : 'JOB_INTAKE_OPERATION_FAILED';
const tokenValue = value => value === null || typeof value === 'string' && /^[\x21-\x7e]{16,1024}$/.test(value);
const requestId = (origin, reference) => sha256(canonical(['job-intake', origin, reference]));
function requestFor(row) {
  return { schema: REQUEST_SCHEMA, catalogSha256: row.merchant.catalogSha256,
    functionSha256: row.merchant.function.functionSha256, functionId: row.merchant.function.id,
    reference: row.reference, claimToken: row.claimToken, label: row.label, input: row.input };
}
function validateRow(row) {
  need(object(row) && row.schema === JOB_INTAKE_SCHEMA && HASH.test(row.id ?? '') &&
    JOB_ID.test(row.reference ?? '') && Number.isSafeInteger(row.revision) && row.revision >= 0 &&
    JOB_INTAKE_PHASES.includes(row.phase) && text(row.label, 300) && object(row.merchant) &&
    text(row.merchant.serviceName, 512) && HASH.test(row.merchant.catalogSha256 ?? '') &&
    ['none', 'access-token'].includes(row.merchant.authentication) &&
    CLAIM.test(row.claimToken ?? '') && tokenValue(row.accessToken) &&
    Number.isSafeInteger(row.requestAttempts) && row.requestAttempts >= 0 &&
    Number.isSafeInteger(row.withdrawalAttempts) && row.withdrawalAttempts >= 0 &&
    Array.isArray(row.history) && row.history.length <= 128, 'JOB_INTAKE_STATE_INVALID');
  const origin = originOf(row.merchant.origin);
  validateFunction(row.merchant.function, origin); validateRequest(requestFor(row));
  need(row.id === requestId(origin, row.reference) &&
    row.inputSha256 === sha256(canonical(row.input)) &&
    row.requestSha256 === sha256(canonical(requestFor(row))) &&
    (row.checkoutId === null || HASH.test(row.checkoutId)) &&
    typeof row.createdAt === 'string' && typeof row.updatedAt === 'string',
    'JOB_INTAKE_STATE_BINDING_CHANGED', 409);
  if (row.handoffBase64 !== null) {
    need(typeof row.handoffBase64 === 'string' && row.handoffBase64.length <= 87384 &&
      Buffer.from(row.handoffBase64, 'base64').toString('base64') === row.handoffBase64 &&
      sha256(Buffer.from(row.handoffBase64, 'base64')) === row.handoffSha256 &&
      typeof row.responseBase64 === 'string' && row.responseBase64.length <= Math.ceil(MAX_RESPONSE_BYTES / 3) * 4 &&
      Buffer.from(row.responseBase64, 'base64').toString('base64') === row.responseBase64 &&
      sha256(Buffer.from(row.responseBase64, 'base64')) === row.responseSha256,
      'JOB_INTAKE_TICKET_CHANGED', 409);
    const response = validateResponse(parseJson(Buffer.from(row.responseBase64, 'base64')),
      requestFor(row), row.merchant.function, origin);
    need(canonical(parseJson(Buffer.from(row.handoffBase64, 'base64'))) === canonical(response.handoff),
      'JOB_INTAKE_TICKET_CHANGED', 409);
  } else need(row.handoffSha256 === null && row.responseBase64 === null && row.responseSha256 === null,
    'JOB_INTAKE_STATE_INVALID');
  return row;
}

/** Same original workspace lease; no independent payer, queue, wallet or worker. */
export async function openJobIntake({ directory, lease, checkout, transport, fetchImpl,
  requestTimeoutMs = 60000, maxConcurrent = 4 } = {}) {
  directory = await canonicalDirectory(directory, { privateState: true, create: true });
  need(lease && typeof lease.assertHeld === 'function' && checkout && typeof checkout.import === 'function',
    'JOB_INTAKE_WORKSPACE_REQUIRED');
  need(Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs >= 100 && requestTimeoutMs <= 300000 &&
    Number.isSafeInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 4,
    'JOB_INTAKE_TRANSPORT_CONFIG_INVALID');
  const fetcher = fetchImpl ?? createPublicHttpsFetch({ timeoutMs: requestTimeoutMs, trustedProxy: transport ?? null });
  need(typeof fetcher === 'function', 'JOB_INTAKE_TRANSPORT_REQUIRED');
  const rows = new Map(), tasks = new Map(), discoveries = new Set();
  let tail = Promise.resolve(), closing = false, closePromise;
  const active = () => { lease.assertHeld(); need(!closing, 'JOB_INTAKE_CLOSING', 503); };
  const rowPath = id => {
    need(typeof id === 'string' && HASH.test(id), 'JOB_INTAKE_ID_INVALID');
    return join(directory, id + '.json');
  };
  const serial = work => {
    const pending = tail.then(() => { lease.assertHeld(); return work(); });
    tail = pending.catch(() => {}); return pending;
  };
  function summary(value) {
    let linked = null;
    if (value.checkoutId) {
      try { linked = checkout.get(value.checkoutId); }
      catch (error) { if (error.code !== 'JOB_CHECKOUT_NOT_FOUND') linked = { id: value.checkoutId, error: safeCode(error) }; }
    }
    const ownTask = tasks.get(value.id);
    return { id: value.id, reference: value.reference, label: value.label, revision: value.revision,
      phase: value.phase, createdAt: value.createdAt, updatedAt: value.updatedAt,
      merchant: { origin: value.merchant.origin, serviceName: value.merchant.serviceName,
        catalogSha256: value.merchant.catalogSha256, functionId: value.merchant.function.id,
        functionSha256: value.merchant.function.functionSha256, authentication: value.merchant.authentication },
      payment: structuredClone(value.merchant.function.payment), inputSha256: value.inputSha256,
      requestSha256: value.requestSha256, requestAttempts: value.requestAttempts, withdrawalAttempts: value.withdrawalAttempts,
      hasAccessToken: value.accessToken !== null, hasTicket: value.handoffBase64 !== null,
      handoffSha256: value.handoffSha256, responseSha256: value.responseSha256,
      checkoutId: value.checkoutId, checkout: linked, lastError: value.lastError,
      task: structuredClone(ownTask?.public ?? value.lastTask),
      actions: { prepare: !ownTask && !['IMPORTED', 'WITHDRAWN'].includes(value.phase),
        import: !ownTask && value.handoffBase64 !== null && !['IMPORTED', 'WITHDRAWN'].includes(value.phase),
        withdraw: !ownTask && value.phase !== 'WITHDRAWN', stop: Boolean(ownTask) } };
  }
  async function readRow(id) {
    const path = rowPath(id);
    need(await exists(path), 'JOB_INTAKE_REQUEST_NOT_FOUND', 404);
    const stat = await lstat(path);
    need(stat.isFile() && !stat.isSymbolicLink() &&
      (process.platform === 'win32' || !(stat.mode & 0o077) && (!process.getuid || stat.uid === process.getuid())),
      'JOB_INTAKE_PRIVATE_FILE_REQUIRED');
    const value = validateRow(parseJson(await readBytes(path, MAX_ROW_BYTES)));
    need(value.id === id, 'JOB_INTAKE_STATE_BINDING_CHANGED', 409);
    return value;
  }
  async function writeRow(value, { exclusive = false } = {}) {
    lease.assertHeld(); validateRow(value);
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    need(bytes.length <= MAX_ROW_BYTES, 'JOB_INTAKE_STATE_TOO_LARGE');
    try { await writeBytes(rowPath(value.id), bytes, { exclusive }); rows.set(value.id, summary(value)); }
    catch (error) {
      try { rows.set(value.id, summary(await readRow(value.id))); } catch { /* The named original file remains the recovery source. */ }
      throw error;
    }
    return value;
  }
  async function change(id, changes, action, detail = {}) {
    return serial(async () => {
      const before = await readRow(id), patch = typeof changes === 'function' ? await changes(before) : changes;
      need(!(patch.requestAttempts < before.requestAttempts) && !(patch.withdrawalAttempts < before.withdrawalAttempts),
        'JOB_INTAKE_ATTEMPT_FACT_IMMUTABLE', 409);
      const timestamp = now();
      return writeRow({ ...before, ...patch, revision: before.revision + 1, updatedAt: timestamp,
        history: [...before.history, { at: timestamp, action, previousRevision: before.revision,
          revision: before.revision + 1, ...detail }].slice(-128) });
    });
  }
  async function fetchJson(url, { method = 'GET', body, headers = {}, signal, maximum } = {}) {
    signal?.throwIfAborted();
    const response = await fetcher(url, { method, headers: { accept: 'application/json', ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }), redirect: 'manual', signal });
    need(response && typeof response.status === 'number' && response.headers && response.body,
      'JOB_INTAKE_HTTP_RESPONSE_INVALID', 502);
    try {
      need(!response.url || response.url === url, 'JOB_INTAKE_RESPONSE_URL_CHANGED', 502);
      need(response.status < 300 || response.status >= 400, 'JOB_INTAKE_REDIRECT_REJECTED', 502);
      need(response.status !== 402, 'JOB_INTAKE_PAYMENT_REQUESTED', 502);
      const encoding = response.headers.get('content-encoding');
      need(!encoding || encoding.toLowerCase() === 'identity', 'JOB_INTAKE_RESPONSE_ENCODING_REJECTED', 502);
      const length = response.headers.get('content-length');
      need(length === null || /^[0-9]+$/.test(length) && Number(length) <= maximum,
        'JOB_INTAKE_RESPONSE_TOO_LARGE', 502);
      const reader = response.body.getReader(); let total = 0; const chunks = [];
      try {
        for (;;) {
          signal?.throwIfAborted(); const part = await reader.read(); if (part.done) break;
          total += part.value.byteLength; need(total <= maximum, 'JOB_INTAKE_RESPONSE_TOO_LARGE', 502);
          chunks.push(Buffer.from(part.value));
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      const raw = Buffer.concat(chunks, total);
      need(length === null || Number(length) === total, 'JOB_INTAKE_RESPONSE_LENGTH_CHANGED', 502);
      need(/^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
        'JOB_INTAKE_RESPONSE_TYPE_INVALID', 502);
      const value = parseJson(raw);
      if (response.status >= 400) {
        const code = /^JOB_[A-Z0-9_]{1,100}$/.test(value?.error ?? '') ? value.error : 'JOB_INTAKE_HTTP_ERROR';
        throw problem(code, [400, 401, 403, 404, 409, 413, 415, 422, 429].includes(response.status) ? response.status : 502);
      }
      need([200, 201].includes(response.status), 'JOB_INTAKE_HTTP_STATUS_INVALID', 502);
      return { raw, value, status: response.status };
    } finally { if (!response.body.locked) await response.body.cancel().catch(() => {}); }
  }
  async function discover({ origin, signal } = {}) {
    active(); origin = originOf(origin);
    need(discoveries.size + tasks.size < maxConcurrent, 'JOB_INTAKE_CAPACITY_REACHED', 429);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(problem('JOB_INTAKE_DEADLINE', 408)), requestTimeoutMs);
    let finish; const complete = new Promise(done => { finish = done; });
    const slot = { controller, complete }; discoveries.add(slot);
    try {
      const result = await fetchJson(origin + CATALOG_PATH, { signal: controller.signal, maximum: MAX_CATALOG_BYTES });
      return validateCatalog(result.value, origin);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); discoveries.delete(slot); finish(); }
  }
  async function draft({ catalog, functionId, input, label, reference, accessToken = null } = {}) {
    active(); catalog = validateCatalog(catalog);
    const definition = catalog.functions.find(value => value.id === functionId);
    need(definition && object(input) && Buffer.byteLength(canonical(input)) <= definition.maxInputBytes,
      'JOB_INTAKE_INPUT_REQUIRED');
    reference ??= 'request_' + randomUUID(); label ??= reference;
    need(JOB_ID.test(reference) && text(label, 300) && tokenValue(accessToken), 'JOB_INTAKE_DRAFT_INVALID');
    const id = requestId(catalog.publicOrigin, reference);
    return serial(async () => {
      active();
      if (await exists(rowPath(id))) {
        const retained = await readRow(id);
        need(retained.inputSha256 === sha256(canonical(input)) && retained.label === label &&
          retained.merchant.catalogSha256 === catalog.catalogSha256 &&
          retained.merchant.function.functionSha256 === definition.functionSha256,
          'JOB_INTAKE_REFERENCE_EXISTS', 409);
        return { request: summary(retained), reused: true };
      }
      need(rows.size < 10000, 'JOB_INTAKE_CAPACITY_REACHED', 429);
      const timestamp = now(), value = { schema: JOB_INTAKE_SCHEMA, id, reference, label, revision: 0,
        phase: 'DRAFT', createdAt: timestamp, updatedAt: timestamp,
        merchant: { origin: catalog.publicOrigin, serviceName: catalog.serviceName,
          catalogSha256: catalog.catalogSha256, authentication: catalog.authentication, function: definition },
        input: structuredClone(input), inputSha256: sha256(canonical(input)),
        claimToken: randomBytes(32).toString('base64url'), accessToken, requestSha256: null,
        requestAttempts: 0, withdrawalAttempts: 0, handoffBase64: null, handoffSha256: null,
        responseBase64: null, responseSha256: null, checkoutId: null, lastTask: null, lastError: null,
        history: [{ at: timestamp, action: 'request-retained', revision: 0 }] };
      value.requestSha256 = sha256(canonical(requestFor(value)));
      await writeRow(value, { exclusive: true });
      return { request: summary(value), reused: false };
    });
  }
  async function obtainTicket(id, signal) {
    let value = await readRow(id);
    if (value.handoffBase64 !== null) return value;
    need(value.merchant.authentication !== 'access-token' || value.accessToken !== null || value.requestAttempts > 0,
      'JOB_INTAKE_ACCESS_TOKEN_REQUIRED', 401);
    signal.throwIfAborted();
    value = await change(id, before => ({ requestAttempts: before.requestAttempts + 1,
      phase: 'RECOVERABLE', lastError: null }), 'request-dispatch-retained');
    signal.throwIfAborted();
    const response = await fetchJson(value.merchant.origin + REQUEST_PATH, { method: 'POST',
      body: canonical(requestFor(value)), headers: value.accessToken ? { 'x-sfjobs-intake-token': value.accessToken } : {},
      signal, maximum: MAX_RESPONSE_BYTES });
    const received = validateResponse(response.value, requestFor(value), value.merchant.function, value.merchant.origin);
    const ticket = Buffer.from(JSON.stringify(received.handoff) + '\n');
    need(ticket.length <= 65536, 'JOB_INTAKE_TICKET_TOO_LARGE', 502);
    return change(id, { phase: 'READY', handoffBase64: ticket.toString('base64'), handoffSha256: sha256(ticket),
      responseBase64: response.raw.toString('base64'), responseSha256: sha256(response.raw), lastError: null },
      'merchant-ticket-retained', { merchantRevision: received.handoff.job.revision, merchantState: received.handoff.job.state });
  }
  async function importTicket(value) {
    const bytes = Buffer.from(value.handoffBase64, 'base64');
    const expectedId = sha256(JSON.stringify(['paid-job-checkout',
      value.merchant.origin + '/jobs/' + encodeURIComponent(value.reference)]));
    let existing;
    try { existing = checkout.get(expectedId); }
    catch (error) { if (error.code !== 'JOB_CHECKOUT_NOT_FOUND') throw error; }
    if (existing) {
      need(existing.ticket.jobId === value.reference && existing.ticket.inputSha256 === value.inputSha256 &&
        existing.ticket.functionId === value.merchant.function.id &&
        existing.handoffSha256 === value.handoffSha256, 'JOB_INTAKE_CHECKOUT_BINDING_CHANGED', 409);
    } else {
      // This original validator requires a still-PREPARED merchant ticket and
      // composes the original SF88 operation. It never executes the purchase here.
      const ticket = readJobCheckoutTicket(bytes);
      need(ticket.id === expectedId, 'JOB_INTAKE_CHECKOUT_BINDING_CHANGED', 409);
      existing = (await checkout.import({ handoffBytes: bytes, label: value.label })).checkout;
    }
    return change(value.id, { checkoutId: existing.id, phase: 'IMPORTED', lastError: null }, 'original-checkout-linked');
  }
  async function withdraw(value, signal, why) {
    if (value.requestAttempts === 0 && value.handoffBase64 === null)
      return change(value.id, { phase: 'WITHDRAWN', lastError: null }, 'unsent-draft-withdrawn', { reason: why });
    value = await obtainTicket(value.id, signal);
    const statusUrl = value.merchant.origin + '/jobs/' + encodeURIComponent(value.reference);
    const status = (await fetchJson(statusUrl, { headers: { 'x-sfjobs-token': value.claimToken },
      signal, maximum: MAX_RESPONSE_BYTES })).value;
    need(status?.schema === 'stellar-forge.job-status.v1' && status.jobId === value.reference &&
      status.functionId === value.merchant.function.id && status.inputSha256 === value.inputSha256 &&
      Number.isSafeInteger(status.revision) && status.revision >= 1, 'JOB_INTAKE_STATUS_BINDING_CHANGED', 409);
    value = await change(value.id, before => ({ withdrawalAttempts: before.withdrawalAttempts + 1 }),
      'withdrawal-dispatch-retained', { merchantRevision: status.revision, reason: why });
    signal.throwIfAborted();
    const result = (await fetchJson(value.merchant.origin + WITHDRAW_PATH, { method: 'POST',
      body: canonical({ schema: WITHDRAW_SCHEMA, reference: value.reference, claimToken: value.claimToken,
        expectedRevision: status.revision, reason: why }), signal, maximum: MAX_RESPONSE_BYTES })).value;
    need(result?.schema === 'stellar-forge.job-status.v1' && result.jobId === value.reference &&
      result.functionId === value.merchant.function.id && result.inputSha256 === value.inputSha256 &&
      result.state === 'CANCELLED' && result.nativeSettlement === null, 'JOB_INTAKE_WITHDRAWAL_BINDING_CHANGED', 409);
    return change(value.id, { phase: 'WITHDRAWN', lastError: null }, 'merchant-request-withdrawn',
      { merchantRevision: result.revision, reason: why });
  }
  async function execute(task) {
    let error = null;
    try {
      let value = await readRow(task.id), signal = task.controller.signal;
      signal.throwIfAborted();
      if (task.public.kind === 'withdraw') await withdraw(value, signal, task.reason);
      else if (value.phase !== 'IMPORTED') {
        if (task.public.kind === 'prepare') value = await obtainTicket(task.id, signal);
        need(value.handoffBase64 !== null, 'JOB_INTAKE_TICKET_REQUIRED', 409);
        signal.throwIfAborted(); await importTicket(value);
      }
    } catch (caught) { error = task.controller.signal.aborted ? 'JOB_INTAKE_OPERATION_CANCELLED' : safeCode(caught); }
    finally {
      clearTimeout(task.timer);
      const result = { ...task.public, state: error ? task.controller.signal.aborted ? 'CANCELLED' : 'FAILED' : 'COMPLETE',
        completedAt: now(), error };
      task.public = result;
      try { await change(task.id, { lastTask: result, lastError: error }, 'operation-finished'); }
      finally { tasks.delete(task.id); }
    }
  }
  async function start(id, { kind = 'prepare', expectedRevision, reason = 'Customer withdrew the unsubmitted request.' } = {}) {
    return serial(async () => {
      active(); const value = await readRow(id);
      need(['prepare', 'import', 'withdraw'].includes(kind), 'JOB_INTAKE_OPERATION_INVALID');
      need(!tasks.has(id), 'JOB_INTAKE_OPERATION_ACTIVE', 409);
      need(tasks.size + discoveries.size < maxConcurrent, 'JOB_INTAKE_CAPACITY_REACHED', 429);
      need(expectedRevision === value.revision, 'JOB_INTAKE_REVISION_CONFLICT', 409);
      need(value.phase !== 'WITHDRAWN', 'JOB_INTAKE_REQUEST_WITHDRAWN', 409);
      need(text(reason, 500) && reason.trim(), 'JOB_INTAKE_REASON_REQUIRED');
      const task = { id, reason, controller: new AbortController(),
        public: { id: randomUUID(), kind, state: 'RUNNING', startedAt: now(), completedAt: null, error: null } };
      const updated = { ...value, revision: value.revision + 1, updatedAt: now(),
        lastTask: task.public, lastError: null };
      await writeRow(updated); tasks.set(id, task);
      task.timer = setTimeout(() => task.controller.abort(problem('JOB_INTAKE_DEADLINE', 408)), requestTimeoutMs);
      task.promise = Promise.resolve().then(() => execute(task));
      task.promise.catch(() => {});
      return summary(updated);
    });
  }
  async function cancel(id) {
    return serial(async () => {
      active(); const value = await readRow(id), task = tasks.get(id);
      if (task) {
        task.public = { ...task.public, state: 'CANCELLING' };
        task.controller.abort(problem('JOB_INTAKE_OPERATION_CANCELLED'));
      }
      return summary(value);
    });
  }
  async function setAccess(id, { expectedRevision, accessToken } = {}) {
    active(); need(tokenValue(accessToken), 'JOB_INTAKE_ACCESS_TOKEN_INVALID');
    const value = await change(id, before => {
      need(!tasks.has(id) && before.revision === expectedRevision, 'JOB_INTAKE_REVISION_CONFLICT', 409);
      return { accessToken };
    }, 'intake-access-updated');
    return summary(value);
  }
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    need(rows.size < 10000, 'JOB_INTAKE_CAPACITY_REACHED');
    const value = await readRow(name.slice(0, -5));
    if (['RUNNING', 'CANCELLING'].includes(value.lastTask?.state)) {
      value.revision++; value.updatedAt = now(); value.lastError = 'JOB_INTAKE_PROCESS_REOPENED';
      value.lastTask = { ...value.lastTask, state: 'INTERRUPTED', completedAt: now(), error: value.lastError };
      await writeRow(value);
    } else rows.set(value.id, summary(value));
  }
  return Object.freeze({
    directory, discover, draft, start, cancel, setAccess,
    status() { return { schema: JOB_INTAKE_SCHEMA, directory, requests: rows.size, closing,
      capacity: maxConcurrent, active: [...tasks].map(([id, task]) => ({ requestId: id, ...task.public })) }; },
    list({ q = '', phase = '', offset = 0, limit = 50 } = {}) {
      need(text(q, 1000) && ['', ...JOB_INTAKE_PHASES].includes(phase) &&
        Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200,
        'JOB_INTAKE_FILTER_INVALID');
      const wanted = q.toLocaleLowerCase();
      const found = [...rows.values()].filter(value => (!phase || value.phase === phase) &&
        [value.label, value.reference, value.merchant.origin, value.merchant.functionId].join(' ').toLocaleLowerCase().includes(wanted))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return { total: found.length, offset, limit, items: found.slice(offset, offset + limit).map(value => {
        const task = tasks.get(value.id); return { ...structuredClone(value), ...(task ? { task: task.public } : {}),
          actions: { prepare: !task && !['IMPORTED', 'WITHDRAWN'].includes(value.phase),
            import: !task && value.hasTicket && !['IMPORTED', 'WITHDRAWN'].includes(value.phase),
            withdraw: !task && value.phase !== 'WITHDRAWN', stop: Boolean(task) } };
      }) };
    },
    async get(id) {
      const value = await readRow(id);
      return { ...summary(value), input: structuredClone(value.input), function: structuredClone(value.merchant.function),
        history: structuredClone(value.history) };
    },
    async ticket(id) {
      const value = await readRow(id); need(value.handoffBase64 !== null, 'JOB_INTAKE_TICKET_REQUIRED', 409);
      return Buffer.from(value.handoffBase64, 'base64');
    },
    async wait(id) {
      const task = tasks.get(id); if (task) await task.promise;
      const value = await readRow(id);
      return { ...summary(value), input: structuredClone(value.input), function: structuredClone(value.merchant.function),
        history: structuredClone(value.history) };
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await tail;
        for (const task of tasks.values()) task.controller.abort(problem('JOB_INTAKE_CLOSED'));
        for (const task of discoveries) task.controller.abort(problem('JOB_INTAKE_CLOSED'));
        const outcomes = await Promise.allSettled([...tasks.values()].map(task => task.promise)
          .concat([...discoveries].map(task => task.complete)));
        await tail;
        const failed = outcomes.filter(value => value.status === 'rejected');
        if (failed.length) throw new AggregateError(failed.map(value => value.reason), 'JOB_INTAKE_CLOSE_FAILED');
      })();
      return closePromise;
    },
  });
}
