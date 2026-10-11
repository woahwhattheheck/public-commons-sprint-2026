// MIT. Named SQLite queries for the original SF30 handler/admission interface.
import { fork } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bindParameters, compileQueries, QueryInputError } from './parameters.mjs';

export class SqliteSourceError extends Error {
  constructor(code, query) { super(code); this.name = 'SqliteSourceError'; this.code = code; if (query) this.query = query; }
}
const unavailable = code => new SqliteSourceError(code);
const inputResponse = error => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: error.code, field: error.field } });

/** Operator-trusted database/SQL, explicitly projected output; caller values only. */
export async function createSqliteQuerySource({ database, queries, maxPending = 32, startupTimeoutMs = 5000 } = {}) {
  if (typeof database !== 'string' || !database || database === ':memory:') throw new TypeError('Existing SQLite database file required');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 256) throw new RangeError('maxPending must be 1–256');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 30000) throw new RangeError('startupTimeoutMs must be 100–30000');
  const path = await realpath(database);
  if (!(await stat(path)).isFile()) throw new TypeError('SQLite database must be a regular file');
  const compiled = compileQueries(queries);
  const waiting = [];
  let worker = null, ready = false, starting = null, active = null, closed = false, nextId = 0, closing = null;
  const busy = () => waiting.length + (active ? 1 : 0);
  const idle = () => { if (worker && ready && !active && !waiting.length) { worker.unref(); worker.channel?.unref(); } };
  function finish(job, error, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.onAbort);
    if (active === job) active = null;
    else { const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1); }
    error ? job.reject(error) : job.resolve(result);
    queueMicrotask(pump);
  }
  function stopWorker() {
    const child = worker;
    worker = null; ready = false;
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return child;
  }
  function cancel(job, code) {
    if (job.done) return;
    if (active === job) stopWorker();
    finish(job, unavailable(code));
  }
  function launch() {
    if (closed) return Promise.reject(unavailable('SOURCE_CLOSED'));
    if (worker && ready) return Promise.resolve();
    if (starting) return starting;
    const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
      serialization: 'advanced', execArgv: ['--max-old-space-size=128'], env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    worker = child; ready = false;
    const boot = new Promise((resolve, reject) => {
      let booted = false, rejected = false;
      const timer = setTimeout(() => failure(unavailable('SOURCE_START_TIMEOUT')), startupTimeoutMs);
      function failure(error) {
        if (worker !== child) { if (!booted && !rejected) { rejected = true; clearTimeout(timer); reject(error); } return; }
        stopWorker();
        if (!booted && !rejected) { rejected = true; clearTimeout(timer); reject(error); }
        if (active) finish(active, error);
      }
      child.on('error', () => failure(unavailable('SOURCE_PROCESS_FAILED')));
      child.on('exit', () => failure(unavailable(closed ? 'SOURCE_CLOSED' : 'SOURCE_PROCESS_EXITED')));
      child.on('message', message => {
        if (worker !== child || !message || typeof message !== 'object') return;
        if (message.type === 'startup-error') return failure(new SqliteSourceError(message.code, message.query));
        if (message.type === 'ready' && !booted) {
          booted = true; clearTimeout(timer); ready = true; resolve(); idle(); return;
        }
        if (!active || message.id !== active.id) return;
        if (message.type === 'result') finish(active, null, message.result);
        if (message.type === 'query-error') finish(active, new SqliteSourceError(message.code));
      });
      child.send({ type: 'init', database: path, queries: compiled }, error => {
        if (error) failure(unavailable('SOURCE_PROCESS_FAILED'));
      });
    });
    starting = boot.finally(() => { starting = null; });
    return starting;
  }
  function pump() {
    if (closed || active || !waiting.length) { idle(); return; }
    if (!worker || !ready) {
      launch().then(pump, error => { for (const job of [...waiting]) finish(job, error); });
      return;
    }
    const job = waiting.shift();
    if (job.done) { queueMicrotask(pump); return; }
    active = job; worker.ref(); worker.channel?.ref();
    const child = worker;
    child.send({ type: 'query', id: job.id, name: job.name, parameters: job.parameters }, error => {
      if (error && worker === child && !job.done) { stopWorker(); finish(job, unavailable('SOURCE_PROCESS_FAILED')); }
    });
  }
  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw unavailable('QUERY_NOT_FOUND');
    return compiled[name];
  }
  function validate(name, input) { return bindParameters(definition(name), input); }
  function query(name, input, { signal } = {}) {
    try {
      if (closed) throw unavailable('SOURCE_CLOSED');
      if (signal?.aborted) throw unavailable('QUERY_ABORTED');
      const parameters = validate(name, input);
      if (busy() >= maxPending) throw unavailable('SOURCE_BUSY');
      if (signal !== undefined && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
        throw new TypeError('signal must be an AbortSignal');
      return new Promise((resolve, reject) => {
        const job = { id: ++nextId, name, parameters, resolve, reject, signal, done: false };
        job.onAbort = () => cancel(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), compiled[name].timeoutMs);
        signal?.addEventListener('abort', job.onAbort, { once: true });
        waiting.push(job); pump();
      });
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
  async function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...waiting, ...(active ? [active] : [])]) finish(job, unavailable('SOURCE_CLOSED'));
    const child = worker;
    closing = !child || child.exitCode !== null || child.signalCode !== null ? Promise.resolve() :
      new Promise(resolve => { child.ref(); child.once('exit', resolve); stopWorker(); });
    await starting?.catch(() => {});
    return closing;
  }
  const describe = () => Object.fromEntries(Object.entries(compiled).map(([name, spec]) => [name, {
    parameters: structuredClone(spec.parameters), columns: [...spec.columns], maxRows: spec.maxRows,
    maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs,
  }]));
  try { await launch(); } catch (error) { await close(); throw error; }
  return Object.freeze({ query, validate, route, describe, close });
}
