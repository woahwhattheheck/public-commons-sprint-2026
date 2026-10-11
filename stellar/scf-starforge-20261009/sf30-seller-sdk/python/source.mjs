// MIT. Persistent local Python workers composed with the original SF30 lifecycle.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { inputBinder, PythonInputError } from './config.mjs';

export class PythonSourceError extends Error {
  constructor(code) { super(code); this.name = 'PythonSourceError'; this.code = code; }
}
const error = code => new PythonSourceError(code);
const rejection = failure => ({ status: 422, body: { error: failure.code } });
const MAX_PROTOCOL = 1500000;

export async function createPythonSource(compiled, { env = process.env } = {}) {
  if (!compiled?.functions || !compiled?.options) throw new TypeError('Compiled Python merchant required');
  const { application, executable, environment, workerCount, maxPending, startupTimeoutMs,
    shutdownTimeoutMs = 5000, lifecycle = {} } = compiled.options;
  const info = await stat(application);
  if (!info.isFile() || info.size > 2097152) throw new TypeError('Python application must be a regular module up to 2 MiB');
  const applicationBytes = await readFile(application);
  if (applicationBytes.length > 2097152) throw new TypeError('Python application exceeds 2 MiB');
  const applicationSha256 = createHash('sha256').update(applicationBytes).digest('hex');
  const selectedEnvironment = Object.create(null);
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', ...environment]) {
    if (env[key] !== undefined) selectedEnvironment[key] = String(env[key]);
  }
  const bindings = new Map(Object.entries(compiled.functions).map(([name, spec]) => [name, inputBinder(spec)]));
  const definitions = Object.fromEntries(Object.entries(compiled.functions).map(([name, spec]) =>
    [name, { output: spec.output, maxOutputBytes: spec.maxOutputBytes }]));
  const waiting = [], children = new Map();
  const slots = Array.from({ length: workerCount }, () => ({ child: null, ready: false, stopping: false,
    starting: null, active: null, failed: false, starts: 0, rejectBoot: null,
    stopRequested: false, graceful: false, stopReceipt: null, stopTimer: null,
    forceCounted: false, shutdownFailureCounted: false }));
  const totals = { submitted: 0, completed: 0, failed: 0, aborted: 0, timedOut: 0, overloaded: 0,
    workerStarts: 0, workerRestarts: 0, peakProcesses: 0, highWaterPending: 0, totalQueueMs: 0, totalExecutionMs: 0,
    startupFailures: 0, gracefulStops: 0, forcedStops: 0, shutdownFailures: 0, shutdownTimeouts: 0 };
  let closed = false, closing = null, nextId = 0, scheduled = false;
  const activeCount = () => slots.filter(slot => slot.active).length;
  const pending = () => waiting.length + activeCount();
  function schedule() {
    if (closed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }
  function finish(job, failure, body) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.onAbort);
    if (job.slot?.active === job) job.slot.active = null;
    else { const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1); }
    const now = performance.now();
    totals.totalQueueMs += (job.startedAt ?? now) - job.enqueuedAt;
    if (job.startedAt !== undefined) totals.totalExecutionMs += now - job.startedAt;
    if (failure) {
      totals.failed++;
      if (failure.code === 'PYTHON_CALL_ABORTED') totals.aborted++;
      if (failure.code === 'PYTHON_CALL_TIMEOUT') totals.timedOut++;
      job.reject(failure);
    } else { totals.completed++; job.resolve(body); }
    schedule();
  }
  function shutdownFailure(slot) {
    if (!slot.shutdownFailureCounted) { slot.shutdownFailureCounted = true; totals.shutdownFailures++; }
  }
  function retire(slot) {
    slot.ready = false; slot.stopping = true; slot.graceful = false;
    slot.rejectBoot?.(error(closed ? 'PYTHON_SOURCE_CLOSED' : 'PYTHON_WORKER_FAILED'));
    if (slot.child && slot.child.exitCode === null && slot.child.signalCode === null) {
      if (!slot.forceCounted) { slot.forceCounted = true; totals.forcedStops++; }
      slot.child.kill('SIGKILL');
    }
  }
  function stopGracefully(slot) {
    slot.ready = false; slot.stopping = true; slot.stopRequested = true; slot.graceful = true;
    slot.stopTimer = setTimeout(() => {
      totals.shutdownTimeouts++; shutdownFailure(slot); retire(slot);
    }, shutdownTimeoutMs);
    // EOF is private to this worker's existing protocol; no caller can request it.
    // The worker acknowledges only after hooks, tasks and the loop have closed.
    slot.child.stdin.end();
  }
  function cancel(job, code) {
    if (job.done) return;
    if (job.slot?.active === job) retire(job.slot);
    finish(job, error(code));
  }
  function launch(slot) {
    if (closed) return Promise.reject(error('PYTHON_SOURCE_CLOSED'));
    if (slot.starting) return slot.starting;
    if (slot.child) return Promise.reject(error('PYTHON_WORKER_STOPPING'));
    let child;
    try {
      child = spawn(executable, ['-I', '-u', fileURLToPath(new URL('./worker.py', import.meta.url)), application], {
        env: selectedEnvironment, stdio: ['pipe', 'ignore', 'ignore', 'pipe'], windowsHide: true,
      });
    } catch { slot.failed = true; return Promise.reject(error('PYTHON_WORKER_FAILED')); }
    slot.child = child; slot.stopping = false; slot.ready = false; slot.failed = false;
    slot.stopRequested = false; slot.graceful = false; slot.stopReceipt = null;
    slot.forceCounted = false; slot.shutdownFailureCounted = false; slot.stopTimer = null;
    totals.workerStarts++; if (slot.starts++) totals.workerRestarts++;
    let exited;
    children.set(child, new Promise(resolve => { exited = resolve; }));
    totals.peakProcesses = Math.max(totals.peakProcesses, children.size);
    const boot = new Promise((resolveBoot, rejectBoot) => {
      let bootDone = false, buffer = Buffer.alloc(0);
      const timer = setTimeout(() => failed(error('PYTHON_START_TIMEOUT')), startupTimeoutMs);
      function reject(failure) {
        if (bootDone) return;
        bootDone = true; clearTimeout(timer); slot.rejectBoot = null; slot.failed = true; rejectBoot(failure);
        if (!closed) totals.startupFailures++;
      }
      slot.rejectBoot = reject;
      function failed(failure) {
        if (slot.child !== child || (slot.stopping && !slot.graceful)) return;
        if (slot.stopRequested) shutdownFailure(slot);
        reject(failure); retire(slot);
        if (slot.active) finish(slot.active, failure);
      }
      child.once('error', () => failed(error('PYTHON_WORKER_FAILED')));
      child.stdin.on('error', () => failed(error('PYTHON_WORKER_FAILED')));
      child.stdio[3].on('error', () => failed(error('PYTHON_WORKER_FAILED')));
      child.once('close', code => {
        if (slot.child === child) {
          clearTimeout(slot.stopTimer); slot.stopTimer = null;
          if (slot.stopRequested) {
            if (slot.stopReceipt === 'clean' && code === 0) totals.gracefulStops++;
            else shutdownFailure(slot);
          }
          reject(error(closed ? 'PYTHON_SOURCE_CLOSED' : 'PYTHON_WORKER_EXITED'));
          slot.child = null; slot.ready = false; slot.stopping = false;
          if (slot.active) finish(slot.active, error(closed ? 'PYTHON_SOURCE_CLOSED' : 'PYTHON_WORKER_EXITED'));
        }
        children.delete(child); exited(); schedule();
      });
      child.stdio[3].on('data', chunk => {
        if (slot.child !== child || (slot.stopping && !slot.graceful)) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_PROTOCOL) return failed(error('PYTHON_PROTOCOL_REJECTED'));
        let at;
        while ((at = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, at); buffer = buffer.subarray(at + 1);
          let message;
          try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
          catch { return failed(error('PYTHON_PROTOCOL_REJECTED')); }
          if (!message || typeof message !== 'object') return failed(error('PYTHON_PROTOCOL_REJECTED'));
          if (slot.stopRequested) {
            if (message.type !== 'stopped' || !['clean', 'failed'].includes(message.status) || slot.stopReceipt !== null)
              return failed(error('PYTHON_PROTOCOL_REJECTED'));
            slot.stopReceipt = message.status;
            if (message.status === 'failed') shutdownFailure(slot);
            continue;
          }
          if (message.type === 'startup-error') return failed(error('PYTHON_APPLICATION_UNAVAILABLE'));
          if (!bootDone && message.type === 'ready') {
            bootDone = true; clearTimeout(timer); slot.rejectBoot = null; slot.ready = true;
            resolveBoot(); schedule(); continue;
          }
          const job = slot.active;
          if (!job || message.id !== job.id) return failed(error('PYTHON_PROTOCOL_REJECTED'));
          if (message.type === 'error' && ['PYTHON_FUNCTION_FAILED', 'PYTHON_OUTPUT_REJECTED'].includes(message.code)) {
            finish(job, error(message.code)); continue;
          }
          if (message.type !== 'result' || typeof message.body !== 'string' ||
              message.body.length > Math.ceil(compiled.functions[job.name].maxOutputBytes / 3) * 4)
            return failed(error('PYTHON_PROTOCOL_REJECTED'));
          const body = Buffer.from(message.body, 'base64');
          if (body.length > compiled.functions[job.name].maxOutputBytes || body.toString('base64') !== message.body)
            return failed(error('PYTHON_PROTOCOL_REJECTED'));
          finish(job, null, body);
        }
      });
      child.stdin.write(JSON.stringify({ functions: definitions, applicationSha256, lifecycle }) + '\n', failure => {
        if (failure) failed(error('PYTHON_WORKER_FAILED'));
      });
    });
    slot.starting = boot.finally(() => { slot.starting = null; schedule(); });
    return slot.starting;
  }
  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (!slot.ready || slot.stopping || slot.active || !waiting.length) continue;
      const job = waiting.shift();
      slot.active = job; job.slot = slot; job.startedAt = performance.now();
      slot.child.stdin.write(JSON.stringify({ id: job.id, name: job.name, input: job.input }) + '\n', failure => {
        if (failure && !job.done) { retire(slot); finish(job, error('PYTHON_WORKER_FAILED')); }
      });
    }
    if (!waiting.length) return;
    for (const slot of slots) if (!slot.child && !slot.starting && !slot.failed) launch(slot).catch(schedule);
    if (slots.every(slot => !slot.child && !slot.starting && slot.failed))
      for (const job of [...waiting]) finish(job, error('PYTHON_APPLICATION_UNAVAILABLE'));
  }
  function validate(name, context) {
    if (!bindings.has(name)) throw error('PYTHON_FUNCTION_NOT_FOUND');
    return bindings.get(name)(context);
  }
  function call(name, context, { signal } = {}) {
    try {
      if (closed) throw error('PYTHON_SOURCE_CLOSED');
      if (signal !== undefined && (!(signal instanceof AbortSignal))) throw new TypeError('signal must be AbortSignal');
      if (signal?.aborted) throw error('PYTHON_CALL_ABORTED');
      const input = validate(name, context);
      if (pending() >= maxPending) { totals.overloaded++; throw error('PYTHON_SOURCE_BUSY'); }
      // A new explicit call may repair a failed import; no unbounded respawn loop.
      for (const slot of slots) if (!slot.child && !slot.starting) slot.failed = false;
      return new Promise((resolve, reject) => {
        const job = { id: ++nextId, name, input, resolve, reject, signal, enqueuedAt: performance.now(), done: false };
        job.onAbort = () => cancel(job, 'PYTHON_CALL_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'PYTHON_CALL_TIMEOUT'), compiled.functions[name].timeoutMs);
        waiting.push(job); totals.submitted++; totals.highWaterPending = Math.max(totals.highWaterPending, pending());
        signal?.addEventListener('abort', job.onAbort, { once: true });
        if (signal?.aborted) cancel(job, 'PYTHON_CALL_ABORTED'); else pump();
      });
    } catch (failure) { return Promise.reject(failure); }
  }
  function route(name) {
    if (!bindings.has(name)) throw error('PYTHON_FUNCTION_NOT_FOUND');
    return {
      admit(context) {
        try {
          validate(name, context);
          if (closed) throw error('PYTHON_SOURCE_CLOSED');
          if (pending() >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'PYTHON_SOURCE_BUSY' } };
          return true;
        } catch (failure) { if (failure instanceof PythonInputError) return rejection(failure); throw failure; }
      },
      async handler(context) {
        try {
          return { status: 200, headers: { 'content-type': compiled.functions[name].output.contentType },
            body: await call(name, context, { signal: context?.signal }) };
        } catch (failure) {
          if (failure instanceof PythonInputError) return rejection(failure);
          return { status: 503, body: { error: failure instanceof PythonSourceError ? failure.code : 'PYTHON_RESOURCE_UNAVAILABLE' } };
        }
      },
    };
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const before = { gracefulStops: totals.gracefulStops, forcedStops: totals.forcedStops,
      shutdownFailures: totals.shutdownFailures, shutdownTimeouts: totals.shutdownTimeouts };
    for (const job of [...waiting]) finish(job, error('PYTHON_SOURCE_CLOSED'));
    const exits = [...children.values()];
    for (const slot of slots) {
      if (!slot.child) continue;
      if (slot.active) {
        const job = slot.active; retire(slot); finish(job, error('PYTHON_SOURCE_CLOSED'));
      } else if (slot.ready && !slot.stopping) stopGracefully(slot);
      else retire(slot);
    }
    closing = Promise.all(exits).then(() => {
      const counts = Object.fromEntries(Object.keys(before).map(key => [key, totals[key] - before[key]]));
      return Object.freeze({ schema: 'stellar-forge.python-shutdown.v1',
        clean: counts.forcedStops === 0 && counts.shutdownFailures === 0,
        ...counts, processes: children.size });
    });
    return closing;
  }
  const stats = () => ({ schema: 'stellar-forge.python-pool.v1', applicationSha256, closed, workerCount, maxPending,
    lifecycle: { eventLoop: 'persistent', ...lifecycle }, startupTimeoutMs, shutdownTimeoutMs,
    processes: children.size, readyWorkers: slots.filter(slot => slot.ready).length,
    running: activeCount(), queued: waiting.length, pending: pending(), ...totals });
  try { await Promise.all(slots.map(launch)); } catch (failure) { await close(); throw failure; }
  return Object.freeze({ call, validate, route, stats, close });
}
