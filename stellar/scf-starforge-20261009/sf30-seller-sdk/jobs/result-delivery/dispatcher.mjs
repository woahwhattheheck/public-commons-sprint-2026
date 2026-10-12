// MIT. Deliver completed paid-job results through the original merchant and retained sender queue.
import { join } from 'node:path';
import { compileDeliveryConfig, destinationMatches } from './config.mjs';
import { openDeliveryStore } from './store.mjs';
import { sendSignedResult } from './transport.mjs';
import { digest, deliveryError, manifestFor, merchantIdentity, validateSecret, validateAcknowledgment } from './wire.mjs';
const faultCode = error => /^JRD_[A-Z_]+$/.test(error?.code ?? '') ? error.code :
  error?.name === 'AbortError' ? 'JRD_SEND_INTERRUPTED' :
  error?.name === 'TimeoutError' ? 'JRD_SEND_TIMEOUT' : 'JRD_DELIVERY_UNAVAILABLE';
/** Borrow the owning merchant model; close this dispatcher before closing that model. */
export async function openResultDelivery({ model, directory, config, env = process.env,
  clock = Date.now, send = sendSignedResult } = {}) {
  if (!model || !['snapshot', 'get', 'result'].every(name => typeof model[name] === 'function'))
    throw deliveryError('JRD_JOB_MODEL_REQUIRED');
  if (typeof send !== 'function' || !env || typeof env !== 'object') throw deliveryError('JRD_CONFIGURATION_INVALID');
  const configured = compileDeliveryConfig(config), initial = await model.snapshot(), source = merchantIdentity(initial.source);
  const functionIds = new Set((initial.functions ?? []).map(value => value.id));
  if (configured.destinations.some(destination => destination.functionIds?.some(id => !functionIds.has(id))))
    throw deliveryError('JRD_DESTINATION_FUNCTION_UNKNOWN');
  const store = await openDeliveryStore(directory ?? join(initial.directory, 'result-delivery'), source, { clock });
  let running = false, closed = false, closing = false, closePromise, stopping = null;
  let activeDrain = null, activeController = null, activeScan = null, timer = null;
  let lastError = null, lastRun = null, destinationErrors = {}, storageFault = null;
  const now = () => new Date(clock()).toISOString();
  const assertOpen = () => {
    if (closed || closing) throw deliveryError('JRD_DISPATCHER_CLOSED', 503);
  };
  function latchStorageFault(error) {
    if (!storageFault) { storageFault = store.fault ?? 'JRD_STATE_REOPEN_REQUIRED'; lastError = faultCode(error); }
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    activeController?.abort(deliveryError('JRD_STATE_REOPEN_REQUIRED', 503));
  }
  function assertWritable() {
    assertOpen();
    if (storageFault || store.fault) throw deliveryError('JRD_STATE_REOPEN_REQUIRED', 503);
  }
  const selected = manifest => configured.destinations.find(destination => destinationMatches(destination, manifest));
  function stateSnapshot() {
    const deliveries = store.rows(), counts = { QUEUED: 0, SENDING: 0, RETRY: 0, DELIVERED: 0, EXHAUSTED: 0 };
    for (const row of deliveries) counts[row.state]++;
    const paused = deliveries.filter(row => row.state !== 'DELIVERED' && !selected(row.manifest)).map(row => row.id);
    return { schema: 'stellar-forge.job-result-deliveries.v1', directory: store.directory, merchant: source,
      running, sending: activeDrain !== null, stopping: stopping !== null, storage: storageFault ?? store.fault ?? 'READY', reopenRequired: Boolean(storageFault || store.fault),
      lastError, lastRun, counts, paused,
      destinations: configured.destinations.map(destination => {
        let secretConfigured = false;
        try { validateSecret(env[destination.secretEnv]); secretConfigured = true; } catch {}
        return { ...destination, secretConfigured, error: destinationErrors[destination.id] ?? null };
      }),
      deliveries: deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
    };
  }
  function collect() {
    if (activeScan) return activeScan;
    activeScan = (async () => {
      const snapshot = await model.snapshot();
      if (JSON.stringify(merchantIdentity(snapshot.source)) !== JSON.stringify(source))
        throw deliveryError('JRD_MERCHANT_SOURCE_CHANGED', 409);
      let created = 0, existing = 0;
      for (const job of snapshot.jobs ?? []) {
        if (job.state !== 'COMPLETED') continue;
        for (const destination of configured.destinations) {
          if (!destination.enabled || destination.functionIds && !destination.functionIds.includes(job.functionId) ||
              destination.completedAfter && job.updatedAt < destination.completedAfter) continue;
          const outcome = await store.enqueue(manifestFor(source, job, destination));
          if (outcome.created) created++; else existing++;
        }
      }
      return { created, existing };
    })().catch(error => { if (store.fault) latchStorageFault(error); throw error; })
      .finally(() => { activeScan = null; });
    return activeScan;
  }
  async function deliver(value, destination, secret, signal) {
    signal.throwIfAborted();
    const row = await store.begin(value.id, { attemptLimit: configured.attemptLimit });
    if (row.state === 'EXHAUSTED') return { row, attempted: false };
    const attemptId = row.attempts.at(-1).id;
    let outcome;
    try {
      signal.throwIfAborted();
      if (storageFault) throw deliveryError('JRD_STATE_REOPEN_REQUIRED', 503);
      const original = await model.get(row.manifest.job.id);
      const observed = manifestFor(source, original, destination);
      observed.job.completedAt = row.manifest.job.completedAt;
      if (JSON.stringify(observed) !== JSON.stringify(row.manifest)) throw deliveryError('JRD_ORIGINAL_JOB_CHANGED', 409);
      const result = await model.result(row.manifest.job.id);
      if (!Buffer.isBuffer(result.body) || result.bytes !== row.manifest.result.bytes ||
          result.body.length !== row.manifest.result.bytes || result.sha256 !== row.manifest.result.sha256 ||
          digest(result.body) !== row.manifest.result.sha256 || result.contentType !== row.manifest.result.contentType ||
          result.filename !== row.manifest.result.filename) throw deliveryError('JRD_ORIGINAL_RESULT_CHANGED', 409);
      signal.throwIfAborted();
      outcome = await send({ manifest: row.manifest, body: result.body, allowedHost: destination.allowedHost,
        secret, signal, timeoutMs: configured.timeoutMs, clock });
      if (outcome?.ok) outcome = { ...outcome, receipt: validateAcknowledgment(outcome.receipt, row.manifest) };
    } catch (error) {
      outcome = { ok: false, httpStatus: null, code: signal.aborted ? 'JRD_SEND_INTERRUPTED' : faultCode(error) };
    }
    if (outcome?.ok) return { attempted: true,
      row: await store.finish(row.id, attemptId, { receipt: outcome.receipt, httpStatus: outcome.httpStatus }) };
    // Aborting a response can surface as either a request error or an incomplete acknowledgment.
    const code = signal.aborted ? 'JRD_SEND_INTERRUPTED' :
      /^JRD_[A-Z_]+$/.test(outcome?.code ?? '') ? outcome.code : 'JRD_SEND_FAILED';
    const used = row.attemptCount - row.retryBase;
    const exhausted = used >= configured.attemptLimit || ['JRD_ORIGINAL_JOB_CHANGED', 'JRD_ORIGINAL_RESULT_CHANGED'].includes(code);
    const delay = Math.min(1800000, 30000 * 2 ** Math.min(Math.max(used - 1, 0), 16));
    const providerRetry = typeof outcome?.retryAfter === 'string' ? Date.parse(outcome.retryAfter) : NaN;
    const next = Math.max(clock() + delay, Number.isFinite(providerRetry) ? providerRetry : 0);
    return { attempted: true, row: await store.finish(row.id, attemptId, {
      code, httpStatus: outcome?.httpStatus ?? null, exhausted,
      nextAttemptAt: exhausted ? null : new Date(next).toISOString() }) };
  }
  function schedule(delay = configured.pollIntervalMs) {
    if (!running || closed || closing || stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      api.drain().catch(error => { lastError = faultCode(error); }).finally(() => schedule());
    }, delay);
  }
  const api = {
    snapshot() { assertOpen(); return stateSnapshot(); },
    get(id) { assertOpen(); return store.get(id); },
    async scan() {
      assertWritable();
      if (stopping) throw deliveryError('JRD_DISPATCHER_STOPPING', 409);
      const collected = await collect(); return { ...collected, snapshot: stateSnapshot() };
    },
    drain({ signal } = {}) {
      assertWritable();
      if (stopping) throw deliveryError('JRD_DISPATCHER_STOPPING', 409);
      if (activeDrain) return activeDrain;
      activeController = new AbortController();
      const attemptSignal = signal ? AbortSignal.any([signal, activeController.signal]) : activeController.signal;
      activeDrain = (async () => {
        const startedAt = now();
        attemptSignal.throwIfAborted();
        const collected = await collect();
        const ready = store.rows().filter(row => ['QUEUED', 'RETRY'].includes(row.state) &&
          (!row.nextAttemptAt || Date.parse(row.nextAttemptAt) <= clock()) && selected(row.manifest));
        const credentials = new Map(); destinationErrors = {};
        for (const destination of configured.destinations) {
          if (!destination.enabled) continue;
          try { credentials.set(destination.id, validateSecret(env[destination.secretEnv])); }
          catch { destinationErrors[destination.id] = 'JRD_SECRET_REQUIRED'; }
        }
        let index = 0, attempted = 0, delivered = 0, exhausted = 0, storageError = null;
        async function worker() {
          while (index < ready.length && !attemptSignal.aborted && !storageError && !storageFault) {
            const row = ready[index++], destination = selected(row.manifest);
            if (!destination || !credentials.has(destination.id)) continue;
            try {
              const outcome = await deliver(row, destination, credentials.get(destination.id), attemptSignal);
              if (outcome.attempted) attempted++;
              if (outcome.row.state === 'DELIVERED') delivered++;
              if (outcome.row.state === 'EXHAUSTED') exhausted++;
            } catch (error) {
              if (!attemptSignal.aborted || error !== attemptSignal.reason) {
                storageError = error; latchStorageFault(error);
              }
            }
          }
        }
        try { await Promise.all(Array.from({ length: Math.min(configured.concurrency, ready.length) }, worker)); }
        finally { credentials.clear(); }
        if (storageError) throw storageError;
        if (storageFault) throw deliveryError('JRD_STATE_REOPEN_REQUIRED', 503);
        lastError = null;
        lastRun = { startedAt, finishedAt: now(), collected, attempted, delivered, exhausted, interrupted: attemptSignal.aborted };
        return { ...lastRun, snapshot: { ...stateSnapshot(), sending: false } };
      })().catch(error => { lastError = faultCode(error); throw error; })
        .finally(() => { activeDrain = null; activeController = null; });
      return activeDrain;
    },
    start() {
      assertWritable();
      if (stopping) throw deliveryError('JRD_DISPATCHER_STOPPING', 409);
      if (!running) { running = true; schedule(0); }
      return stateSnapshot();
    },
    stop() {
      assertOpen();
      if (stopping) return stopping;
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      activeController?.abort(deliveryError('JRD_SEND_INTERRUPTED', 503));
      stopping = (async () => {
        await Promise.allSettled([activeDrain, activeScan].filter(Boolean));
        return { ...stateSnapshot(), sending: false, stopping: false };
      })().finally(() => { stopping = null; });
      return stopping;
    },
    async requeue(input) {
      assertWritable();
      if (stopping) throw deliveryError('JRD_DISPATCHER_STOPPING', 409);
      try { const row = await store.requeue(input); schedule(0); return row; }
      catch (error) { if (store.fault) latchStorageFault(error); throw error; }
    },
    close() {
      if (!closePromise) {
        running = false; closing = true;
        if (timer) { clearTimeout(timer); timer = null; }
        activeController?.abort(deliveryError('JRD_SEND_INTERRUPTED', 503));
        closePromise = (async () => {
          await Promise.allSettled([activeDrain, activeScan].filter(Boolean));
          await store.close(); closed = true;
        })();
      }
      return closePromise;
    },
  };
  return api;
}
