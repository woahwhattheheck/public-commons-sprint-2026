// MIT. Fixed packaged worker, immutable declaration and original seller handlers.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDuckdbSourceFile, bindDuckdbParameters, describeDuckdbSource, QueryInputError } from './config.mjs';

export class DuckdbSourceError extends Error {
  constructor(code, query) { super(code); this.name = 'DuckdbSourceError'; this.code = code;
    if (query) this.query = query; }
}
const error = (code, query) => new DuckdbSourceError(code, query);
const inputFailure = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
const CODES = new Set(['DUCKDB_NOT_INSTALLED', 'DUCKDB_QUERY_UNAVAILABLE', 'DATASET_CHANGED',
  'QUERY_NOT_DECLARED', 'INVALID_INPUT', 'INVALID_RESULT', 'RESULT_TOO_LARGE', 'CONFIG_INVALID']);

export async function openDuckdbSourceFile(filename, { python = 'python3', environment = process.env } = {}) {
  if (typeof python !== 'string' || !python || python.startsWith('-') || /[\x00-\x1f]/.test(python))
    throw new TypeError('DUCKDB_PYTHON_EXECUTABLE_INVALID');
  const declaration = await readDuckdbSourceFile(filename);
  const { queries, options } = declaration;
  const directory = await mkdtemp(join(tmpdir(), 'sf30-duckdb-'));
  const snapshotPath = join(directory, 'source.json');
  try { await writeFile(snapshotPath, JSON.stringify(declaration.snapshot), { flag: 'wx', mode: 0o600 }); }
  catch (issue) { await rm(directory, { recursive: true, force: true }); throw issue; }
  const env = Object.create(null);
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT']) if (typeof environment[name] === 'string') env[name] = environment[name];
  const worker = fileURLToPath(new URL('./worker.py', import.meta.url));
  const waiting = [], jobs = new Set(), children = new Map();
  let closed = false, closing, active = 0, completed = 0, failures = 0, timedOut = 0, highWaterPending = 0;
  let inspection;
  const definition = name => {
    if (typeof name !== 'string' || !Object.hasOwn(queries, name)) throw error('QUERY_NOT_DECLARED');
    return queries[name];
  };
  const validate = (name, input) => bindDuckdbParameters(definition(name), input);
  function finish(job, issue, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
    jobs.delete(job);
    if (issue) { if (job.name) failures++; if (issue.code === 'QUERY_TIMEOUT') timedOut++; job.reject(issue); }
    else { if (job.name) completed++; job.resolve(result); }
  }
  function cancel(job, code) {
    if (job.done) return;
    finish(job, error(code, job.name));
    // A timed-out query is never replayed. Release its slot only after process exit.
    if (job.child && job.child.exitCode === null && job.child.signalCode === null) job.child.kill('SIGKILL');
    pump();
  }
  function launch(job) {
    active++;
    let child;
    try {
      child = spawn(python, ['-I', '-u', worker, '--source', snapshotPath,
        ...(job.name ? ['--query', job.name] : ['--check'])],
      { env, cwd: declaration.snapshot.baseDirectory, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch { active--; finish(job, error('DUCKDB_WORKER_UNAVAILABLE', job.name)); pump(); return; }
    job.child = child;
    let exited; children.set(child, new Promise(resolve => { exited = resolve; }));
    const chunks = []; let bytes = 0;
    const ceiling = job.name ? queries[job.name].maxBytes + 4096 : 262144;
    child.stdout.on('data', chunk => {
      if (job.done) return;
      bytes += chunk.length;
      if (bytes > ceiling) { cancel(job, 'RESULT_TOO_LARGE'); return; }
      chunks.push(chunk);
    });
    child.once('error', () => cancel(job, 'DUCKDB_WORKER_UNAVAILABLE'));
    child.stdin.on('error', () => cancel(job, 'DUCKDB_WORKER_UNAVAILABLE'));
    child.stdout.on('error', () => cancel(job, 'DUCKDB_WORKER_UNAVAILABLE'));
    child.once('close', code => {
      active--; children.delete(child); exited();
      if (!job.done) {
        try {
          const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (message?.ok !== true || code !== 0) throw error(CODES.has(message?.error) ? message.error : 'DUCKDB_QUERY_UNAVAILABLE', job.name);
          if (job.name && (!message.payload || message.payload.schema !== 'stellar-forge.duckdb-result.v1' ||
              message.payload.query !== job.name || !Array.isArray(message.payload.rows) ||
              message.payload.rows.length > queries[job.name].maxRows)) throw error('DUCKDB_PROTOCOL_INVALID', job.name);
          finish(job, null, job.name ? message.payload : message);
        } catch (issue) { finish(job, issue instanceof DuckdbSourceError ? issue : error('DUCKDB_PROTOCOL_INVALID', job.name)); }
      }
      pump();
    });
    child.stdin.end(job.name ? JSON.stringify({ values: job.values }) : '');
  }
  function pump() {
    if (closed) return;
    while (active < options.maxWorkers && waiting.length) {
      const job = waiting.shift();
      if (!job.done) launch(job);
    }
  }
  function enqueue(name, values, timeoutMs, signal) {
    if (closed) return Promise.reject(error('SOURCE_CLOSED', name));
    if (signal !== undefined && !(signal instanceof AbortSignal)) return Promise.reject(new TypeError('signal must be AbortSignal'));
    if (signal?.aborted) return Promise.reject(error('QUERY_ABORTED', name));
    if (jobs.size >= options.maxPending) return Promise.reject(error('SOURCE_BUSY', name));
    return new Promise((resolve, reject) => {
      const job = { name, values, signal, resolve, reject, done: false };
      job.abort = () => cancel(job, 'QUERY_ABORTED');
      job.timer = setTimeout(() => cancel(job, name ? 'QUERY_TIMEOUT' : 'SOURCE_START_TIMEOUT'), timeoutMs);
      jobs.add(job); waiting.push(job); highWaterPending = Math.max(highWaterPending, jobs.size);
      signal?.addEventListener('abort', job.abort, { once: true });
      if (signal?.aborted) cancel(job, 'QUERY_ABORTED'); else pump();
    });
  }
  function query(name, input = {}, { signal } = {}) {
    try { return enqueue(name, validate(name, input), definition(name).timeoutMs, signal); }
    catch (issue) { return Promise.reject(issue); }
  }
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('DUCKDB_INPUT_LOCATION_INVALID');
    const values = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new QueryInputError(null, 'BODY_METHOD_INVALID');
      return context?.[input] ?? {};
    };
    return { admit(context) {
      try {
        validate(name, values(context));
        if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
        if (jobs.size >= options.maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
        return true;
      } catch (issue) { if (issue instanceof QueryInputError) return inputFailure(issue); throw issue; }
    }, async handler(context) {
      try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
        body: await query(name, values(context), { signal: context?.signal }) }; }
      catch (issue) {
        if (issue instanceof QueryInputError) return inputFailure(issue);
        return { status: issue.code === 'QUERY_TIMEOUT' ? 504 : issue.code === 'SOURCE_BUSY' ? 429 : 503,
          body: { error: issue instanceof DuckdbSourceError ? issue.code : 'DUCKDB_QUERY_UNAVAILABLE', query: name } };
      }
    } };
  }
  const status = () => ({ schema: 'stellar-forge.duckdb-status.v1', state: closed ? 'CLOSED' : 'READY',
    active, pending: jobs.size, maxWorkers: options.maxWorkers, maxPending: options.maxPending,
    completed, failures, timedOut, highWaterPending });
  function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...jobs]) cancel(job, 'SOURCE_CLOSED');
    waiting.length = 0;
    closing = Promise.all([...children.values()]).then(() => rm(directory, { recursive: true, force: true }));
    return closing;
  }
  try { inspection = await enqueue(null, null, options.startupTimeoutMs); }
  catch (issue) { await close(); throw issue; }
  const source = Object.freeze({ query, validate, route, status, close,
    describe: () => describeDuckdbSource(declaration),
    inspect: () => ({ ...describeDuckdbSource(declaration), engineVersion: inspection.engineVersion, columnTypes: inspection.columnTypes }) });
  return { source, config: declaration.config };
}
