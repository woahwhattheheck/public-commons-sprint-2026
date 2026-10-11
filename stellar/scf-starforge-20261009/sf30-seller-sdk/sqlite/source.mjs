// MIT. Named SQLite queries for the original SF30 handler/admission interface.
import { fork } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { bindParameters, compileQueries, QueryInputError } from './parameters.mjs';
import { sqliteExtractionOptions } from './publisher/extraction.mjs';

export class SqliteSourceError extends Error {
  constructor(code, query) { super(code); this.name = 'SqliteSourceError'; this.code = code; if (query) this.query = query; }
}
const unavailable = code => new SqliteSourceError(code);
const inputResponse = error => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: error.code, field: error.field } });

/** Operator-trusted SQL. Each warm process has its own read-only connection. */
export async function createSqliteQuerySource({
  database, queries, maxPending = 32, startupTimeoutMs = 5000, workerCount = 1,
} = {}) {
  if (typeof database !== 'string' || !database || database === ':memory:') throw new TypeError('Existing SQLite database file required');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 256) throw new RangeError('maxPending must be 1–256');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 30000) throw new RangeError('startupTimeoutMs must be 100–30000');
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) throw new RangeError('workerCount must be 1–8');
  const path = await realpath(database);
  if (!(await stat(path)).isFile()) throw new TypeError('SQLite database must be a regular file');
  const compiled = compileQueries(queries);
  const waiting = [], children = new Map(), rowCallbacks = new Set();
  const slots = Array.from({ length: workerCount }, () => ({
    child: null, ready: false, stopping: false, starting: null, rejectBoot: null,
    active: null, failed: null, starts: 0,
  }));
  const totals = {
    accepted: 0, succeeded: 0, failed: 0, timedOut: 0, aborted: 0, overloaded: 0,
    workerStarts: 0, workerRestarts: 0, peakProcesses: 0, highWaterPending: 0,
    totalQueueMs: 0, totalExecutionMs: 0,
  };
  let closed = false, closing = null, nextId = 0, pumpScheduled = false;
  const running = () => slots.reduce((n, slot) => n + Number(Boolean(slot.active)), 0);
  const busy = () => waiting.length + running();

  function schedulePump() {
    if (closed || pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => { pumpScheduled = false; pump(); });
  }
  function idle(slot) {
    if (slot.child && slot.ready && !slot.active) {
      slot.child.unref(); slot.child.channel?.unref();
    }
  }
  function finish(job, error, result) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    try { job.signal?.removeEventListener('abort', job.onAbort); } catch { /* listener cleanup must not strand work */ }
    if (job.slot?.active === job) job.slot.active = null;
    else {
      const index = waiting.indexOf(job);
      if (index >= 0) waiting.splice(index, 1);
    }
    const now = performance.now();
    totals.totalQueueMs += (job.startedAt ?? now) - job.enqueuedAt;
    if (job.startedAt !== undefined) totals.totalExecutionMs += now - job.startedAt;
    if (error) {
      totals.failed++;
      if (error.code === 'QUERY_TIMEOUT') totals.timedOut++;
      if (error.code === 'QUERY_ABORTED') totals.aborted++;
      // Drain the consumer's accepted row write before reporting failure. A
      // publisher may then close/delete its incomplete candidate safely.
      if (job.rowPending) job.rowPending.then(() => job.reject(error), () => job.reject(error));
      else job.reject(error);
    } else { totals.succeeded++; job.resolve(result); }
    schedulePump();
  }
  function retire(slot) {
    slot.ready = false;
    slot.stopping = true;
    slot.rejectBoot?.(unavailable(closed ? 'SOURCE_CLOSED' : 'SOURCE_PROCESS_FAILED'));
    const child = slot.child;
    // Keep the dying process referenced until close; never replace a slot before
    // its previous process exits. Timeout bursts cannot exceed workerCount.
    if (child) {
      child.ref(); child.channel?.ref();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
  function cancel(job, code) {
    if (job.done) return;
    if (job.slot?.active === job) retire(job.slot);
    finish(job, unavailable(code));
  }

  function launch(slot) {
    if (closed) return Promise.reject(unavailable('SOURCE_CLOSED'));
    if (slot.ready) return Promise.resolve();
    if (slot.starting) return slot.starting;
    if (slot.child) return Promise.reject(unavailable('SOURCE_PROCESS_STOPPING'));
    let child;
    try {
      child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
        serialization: 'advanced', execArgv: ['--max-old-space-size=128'], env: {},
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
    } catch {
      slot.failed = unavailable('SOURCE_PROCESS_FAILED');
      return Promise.reject(slot.failed);
    }
    slot.child = child; slot.ready = false; slot.stopping = false; slot.failed = null;
    totals.workerStarts++;
    if (slot.starts++) totals.workerRestarts++;
    let resolveExit;
    children.set(child, new Promise(resolve => { resolveExit = resolve; }));
    totals.peakProcesses = Math.max(totals.peakProcesses, children.size);
    const boot = new Promise((resolve, reject) => {
      let bootSettled = false;
      const timer = setTimeout(() => failure(unavailable('SOURCE_START_TIMEOUT')), startupTimeoutMs);
      function rejectBoot(error) {
        if (bootSettled) return;
        bootSettled = true; clearTimeout(timer); slot.rejectBoot = null;
        slot.failed = error; reject(error);
      }
      slot.rejectBoot = rejectBoot;
      function failure(error) {
        if (slot.child !== child || slot.stopping) return;
        rejectBoot(error);
        retire(slot);
        if (slot.active) finish(slot.active, error);
      }
      child.on('error', () => failure(unavailable('SOURCE_PROCESS_FAILED')));
      child.once('close', () => {
        if (slot.child === child) {
          rejectBoot(unavailable(closed ? 'SOURCE_CLOSED' : 'SOURCE_PROCESS_EXITED'));
          slot.child = null; slot.ready = false; slot.stopping = false;
          if (slot.active) finish(slot.active, unavailable(closed ? 'SOURCE_CLOSED' : 'SOURCE_PROCESS_EXITED'));
        }
        children.delete(child); resolveExit(); schedulePump();
      });
      child.on('message', message => {
        if (slot.child !== child || slot.stopping || !message || typeof message !== 'object') return;
        if (message.type === 'startup-error') return failure(new SqliteSourceError(message.code, message.query));
        if (message.type === 'ready' && !bootSettled) {
          bootSettled = true; clearTimeout(timer); slot.rejectBoot = null;
          slot.ready = true; resolve(); idle(slot); schedulePump(); return;
        }
        const job = slot.active;
        if (!job || message.id !== job.id) return;
        if (message.type === 'dataset-row' && job.kind === 'dataset-export') {
          if (job.rowPending || message.sequence !== job.rows + 1) {
            retire(slot); finish(job, unavailable('DATASET_STREAM_SEQUENCE_INVALID')); return;
          }
          const callback = Promise.resolve().then(() => {
            if (!job.done) return job.onRow(message.row, message.columnTypes, message.progress);
          });
          job.rowPending = callback; rowCallbacks.add(callback);
          callback.then(() => {
            job.rowPending = null; rowCallbacks.delete(callback);
            if (job.done || slot.child !== child || slot.stopping) return;
            job.rows = message.sequence;
            child.send({ type: 'dataset-row-ack', id: job.id, sequence: message.sequence }, error => {
              if (error && !job.done) { retire(slot); finish(job, unavailable('SOURCE_PROCESS_FAILED')); }
            });
          }, error => {
            job.rowPending = null; rowCallbacks.delete(callback);
            if (job.done) return;
            retire(slot);
            finish(job, new SqliteSourceError(typeof error?.code === 'string' &&
              /^DATASET_[A-Z_]+$/.test(error.code) ? error.code : 'DATASET_CONSUMER_FAILED'));
          });
          return;
        }
        if (message.type === 'result') finish(job, null, message.result);
        if (message.type === 'query-error') finish(job, new SqliteSourceError(message.code));
      });
      child.send({ type: 'init', database: path, queries: compiled }, error => {
        if (error) failure(unavailable('SOURCE_PROCESS_FAILED'));
      });
    });
    slot.starting = boot.finally(() => { slot.starting = null; schedulePump(); });
    return slot.starting;
  }

  function pump() {
    if (closed) return;
    // Always assign the oldest queued job to an already-warm available slot
    // before launching a replacement. Completion order may differ from FIFO.
    for (const slot of slots) {
      if (!slot.ready || slot.active || !waiting.length) { idle(slot); continue; }
      const job = waiting.shift(), child = slot.child;
      slot.active = job; job.slot = slot; job.startedAt = performance.now();
      child.ref(); child.channel?.ref();
      child.send({ type: job.kind, id: job.id, name: job.name, parameters: job.parameters,
        ...(job.exportOptions ? { options: job.exportOptions } : {}) }, error => {
        if (error && slot.child === child && !job.done) {
          retire(slot); finish(job, unavailable('SOURCE_PROCESS_FAILED'));
        }
      });
    }
    if (!waiting.length) return;
    for (const slot of slots) {
      if (!slot.child && !slot.starting && !slot.failed) {
        // A boot failure disables just this slot for the current queue cohort.
        // A later explicit query may retry; no timer or infinite respawn loop.
        launch(slot).catch(() => schedulePump());
      }
    }
    if (slots.every(slot => !slot.child && !slot.starting && slot.failed)) {
      const error = slots.find(slot => slot.failed).failed;
      for (const job of [...waiting]) finish(job, error);
    }
  }
  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw unavailable('QUERY_NOT_FOUND');
    return compiled[name];
  }
  function validate(name, input) { return bindParameters(definition(name), input); }
  function enqueue(name, input, { signal, exportOptions, onRow } = {}) {
    try {
      if (closed) throw unavailable('SOURCE_CLOSED');
      if (signal?.aborted) throw unavailable('QUERY_ABORTED');
      const parameters = validate(name, input);
      if (busy() >= maxPending) { totals.overloaded++; throw unavailable('SOURCE_BUSY'); }
      if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
        throw new TypeError('signal must be an AbortSignal');
      for (const slot of slots) if (!slot.child && !slot.starting) slot.failed = null;
      return new Promise((resolve, reject) => {
        const job = { id: ++nextId, name, parameters, resolve, reject, signal, done: false, enqueuedAt: performance.now(),
          kind: exportOptions ? 'dataset-export' : 'query', exportOptions, onRow, rows: 0, rowPending: null };
        job.onAbort = () => cancel(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), exportOptions?.timeoutMs ?? compiled[name].timeoutMs);
        waiting.push(job); totals.accepted++;
        totals.highWaterPending = Math.max(totals.highWaterPending, busy());
        try { signal?.addEventListener('abort', job.onAbort, { once: true }); }
        catch (error) { finish(job, error); return; }
        if (signal?.aborted) cancel(job, 'QUERY_ABORTED');
        else pump();
      });
    } catch (error) { return Promise.reject(error); }
  }
  function query(name, input, { signal } = {}) { return enqueue(name, input, { signal }); }
  function exportDataset(name, input, { signal, onRow, ...options } = {}) {
    try {
      if (typeof onRow !== 'function') throw unavailable('DATASET_CONSUMER_REQUIRED');
      return enqueue(name, input, { signal, onRow, exportOptions: sqliteExtractionOptions(definition(name), options) });
    } catch (error) { return Promise.reject(error); }
  }
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('Route input must be query or body');
    const values = context => {
      if (input === 'body' && context?.method !== 'POST') throw new QueryInputError(null, 'JSON_POST_REQUIRED');
      return context?.[input];
    };
    return {
      admit(context) {
        try {
          validate(name, values(context));
          if (closed) throw unavailable('SOURCE_CLOSED');
          if (busy() >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (error) { if (error instanceof QueryInputError) return inputResponse(error); throw error; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: await query(name, values(context), { signal: context?.signal }) }; }
        catch (error) {
          if (error instanceof QueryInputError) return inputResponse(error);
          return { status: 503, body: { error: error instanceof SqliteSourceError ? error.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    };
  }
  function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...waiting, ...slots.flatMap(slot => slot.active ? [slot.active] : [])])
      finish(job, unavailable('SOURCE_CLOSED'));
    const exits = [...children.values()];
    for (const slot of slots) retire(slot);
    closing = Promise.all([...exits, ...[...rowCallbacks].map(callback => callback.catch(() => {}))]).then(() => undefined);
    return closing;
  }
  const describe = () => Object.fromEntries(Object.entries(compiled).map(([name, spec]) => [name, {
    parameters: structuredClone(spec.parameters), columns: [...spec.columns], maxRows: spec.maxRows,
    maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs,
  }]));
  // Aggregate process/queue state only: no SQL, database path, PID or caller data.
  const stats = () => Object.freeze({
    schema: 'stellar-forge.sqlite-pool.v1', closed, workerCount, maxPending,
    processes: children.size, readyWorkers: slots.filter(slot => slot.ready).length,
    startingWorkers: slots.filter(slot => slot.starting).length,
    retiringWorkers: slots.filter(slot => slot.child && slot.stopping).length,
    unavailableWorkers: slots.filter(slot => slot.failed && !slot.child).length,
    running: running(), queued: waiting.length, pending: busy(), ...totals,
  });
  try { await Promise.all(slots.map(launch)); } catch (error) { await close(); throw error; }
  return Object.freeze({ query, exportDataset, validate, route, describe, stats, close });
}
