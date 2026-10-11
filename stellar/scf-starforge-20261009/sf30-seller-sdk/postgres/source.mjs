// MIT. Merchant-owned PostgreSQL -> original SF30 application/admission pair.
import { compilePostgresQueries, bindPostgresParameters, projectedSql, describeQueries, QueryInputError } from './declaration.mjs';

export class PostgresSourceError extends Error {
  constructor(code) { super(code); this.name = 'PostgresSourceError'; this.code = code; }
}
const fail = code => new PostgresSourceError(code);
const textTypes = Object.freeze({ getTypeParser: () => value => value });
const inputResponse = error => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: error.code, field: error.field } });
const limit = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(label);
  return value;
};

/** Creates an empty, lazy pool; no merchant query runs until query()/handler. */
export async function createPostgresQuerySource({ connection, queries, poolSize = 4, maxPending = 32,
  connectTimeoutMs = 5000, idleTimeoutMs = 10000 } = {}) {
  if (!connection || typeof connection !== 'object' || typeof connection.host !== 'string' ||
      typeof connection.user !== 'string' || typeof connection.database !== 'string' ||
      !Object.hasOwn(connection, 'password') || !Object.hasOwn(connection, 'ssl')) throw new TypeError('Explicit PostgreSQL connection required');
  limit(poolSize, 1, 16, 'poolSize must be 1–16');
  limit(maxPending, poolSize, 256, 'maxPending must be poolSize–256');
  limit(connectTimeoutMs, 100, 30000, 'connectTimeoutMs must be 100–30000');
  limit(idleTimeoutMs, 1000, 60000, 'idleTimeoutMs must be 1000–60000');
  const compiled = compilePostgresQueries(queries);
  let Pool, Cursor;
  try { ({ Pool } = await import('pg')); ({ default: Cursor } = await import('pg-cursor')); }
  catch { throw fail('POSTGRES_DRIVER_UNAVAILABLE'); }
  const pool = new Pool({ host: connection.host, port: connection.port, user: connection.user,
    database: connection.database, password: connection.password, ssl: connection.ssl,
    max: poolSize, connectionTimeoutMillis: connectTimeoutMs,
    idleTimeoutMillis: idleTimeoutMs, application_name: 'sf30-paid-query-source',
    options: '-c default_transaction_read_only=on', allowExitOnIdle: true });
  let closed = false, closing = null, idleErrors = 0;
  const waiting = [], active = new Set();
  // The driver's idle-client error event must have a listener. Do not log
  // merchant SQL, hosts, role names, submitted values or raw driver errors.
  pool.on('error', () => { idleErrors++; });
  const busy = () => waiting.length + active.size;
  const definition = name => {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw fail('QUERY_NOT_FOUND');
    return compiled[name];
  };
  const validate = (name, input) => bindPostgresParameters(definition(name), input);
  function finish(job, error, value) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.onAbort);
    if (error) job.reject(error); else job.resolve(value);
  }
  function release(job, destroy = false) {
    if (job.client && !job.released) {
      job.released = true; job.client.release(destroy);
      if (job.connectionError) job.client.removeListener('error', job.connectionError);
    }
  }
  function cancel(job, code) {
    if (job.done) return;
    const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1);
    // Destroy the exact checked-out connection; never return an in-progress
    // transaction to the pool or retry a cancelled merchant query.
    finish(job, fail(code)); release(job, true); queueMicrotask(pump);
  }
  function ensure(job) {
    if (job.done || closed) throw fail(closed ? 'SOURCE_CLOSED' : 'QUERY_ABORTED');
  }
  async function run(job) {
    let cursor = null;
    try {
      job.client = await pool.connect();
      if (job.done || closed) { release(job, true); return; }
      job.connectionError = () => cancel(job, 'QUERY_UNAVAILABLE');
      job.client.on('error', job.connectionError);
      const client = job.client, spec = compiled[job.name];
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY');
      ensure(job);
      const remaining = Math.max(1, Math.ceil(job.deadline - performance.now()));
      await client.query({ text: "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $1, true), set_config('search_path', 'pg_catalog', true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, YMD', true), set_config('IntervalStyle', 'iso_8601', true), set_config('bytea_output', 'hex', true)", values: [String(remaining), String(Math.min(remaining, 1000))] });
      ensure(job);
      const result = { schema: 'stellar-forge.postgres-result.v1', query: job.name,
        columns: [...spec.columns], rows: [], rowCount: 0, truncated: false,
        valueEncoding: 'postgres-text', nullEncoding: 'json-null' };
      let bytes = Buffer.byteLength(JSON.stringify(result));
      cursor = client.query(new Cursor(projectedSql(spec), job.values, { rowMode: 'array', types: textTypes }));
      outer: while (true) {
        const rows = await cursor.read(8); ensure(job);
        if (!rows.length) break;
        for (const row of rows) {
          if (result.rows.length === spec.maxRows) { result.truncated = true; break outer; }
          if (row.length !== spec.columns.length + 1 || row.at(-1) !== 'f') throw fail('QUERY_RESULT_TOO_LARGE');
          const publicRow = Object.fromEntries(spec.columns.map((column, index) => [column, row[index]]));
          const added = Buffer.byteLength(JSON.stringify(publicRow)) + (result.rows.length ? 1 : 0);
          if (bytes + added + 32 > spec.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
          bytes += added; result.rows.push(publicRow);
        }
      }
      await cursor.close(); cursor = null; ensure(job);
      result.rowCount = result.rows.length;
      if (Buffer.byteLength(JSON.stringify(result)) > spec.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE');
      await client.query('COMMIT'); ensure(job);
      finish(job, null, result);
    } catch (error) {
      const safe = error instanceof PostgresSourceError ? error : fail(error?.code === '57014' ? 'QUERY_TIMEOUT' :
        error?.code === '25006' ? 'QUERY_READ_ONLY_VIOLATION' : 'QUERY_UNAVAILABLE');
      // Closing is safer than trying ROLLBACK through an uncertain connection.
      // PostgreSQL discards the open transaction when this session disconnects.
      finish(job, safe); release(job, true);
    } finally {
      release(job); active.delete(job); queueMicrotask(pump);
    }
  }
  function pump() {
    if (closed) return;
    while (waiting.length && active.size < poolSize) {
      const job = waiting.shift();
      if (job.done) continue;
      active.add(job); void run(job);
    }
  }
  function query(name, input, { signal } = {}) {
    try {
      if (closed) throw fail('SOURCE_CLOSED');
      const spec = definition(name), values = validate(name, input);
      if (signal !== undefined && (typeof signal?.addEventListener !== 'function' || typeof signal?.removeEventListener !== 'function'))
        throw new TypeError('signal must be an AbortSignal');
      if (signal?.aborted) throw fail('QUERY_ABORTED');
      if (busy() >= maxPending) throw fail('SOURCE_BUSY');
      return new Promise((resolve, reject) => {
        const job = { name, values, resolve, reject, signal, done: false, client: null, released: false,
          deadline: performance.now() + spec.timeoutMs };
        job.onAbort = () => cancel(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), spec.timeoutMs);
        signal?.addEventListener('abort', job.onAbort, { once: true });
        waiting.push(job); pump();
      });
    } catch (error) { return Promise.reject(error); }
  }
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('Route input must be query or body');
    const values = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new QueryInputError(null, 'JSON_BODY_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          validate(name, values(context));
          if (closed) throw fail('SOURCE_CLOSED');
          if (busy() >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (error) { if (error instanceof QueryInputError) return inputResponse(error); throw error; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: await query(name, values(context), { signal: context?.signal }) }; }
        catch (error) {
          if (error instanceof QueryInputError) return inputResponse(error);
          return { status: 503, body: { error: error instanceof PostgresSourceError ? error.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...waiting, ...active]) cancel(job, 'SOURCE_CLOSED');
    closing = pool.end(); return closing;
  }
  return Object.freeze({ query, validate, route, describe: () => describeQueries(compiled), close,
    status: () => ({ closed, active: active.size, queued: waiting.length, poolSize, maxPending, idleErrors }) });
}
