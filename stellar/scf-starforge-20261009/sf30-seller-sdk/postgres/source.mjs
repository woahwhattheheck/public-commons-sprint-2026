// MIT. Application data source for the existing SF30 seller lifecycle.
import { performance } from 'node:perf_hooks';
import { compilePostgresQueries, bindPostgresParameters, PostgresInputError, limit } from './parameters.mjs';

export class PostgresSourceError extends Error {
  constructor(code) { super(code); this.name = 'PostgresSourceError'; this.code = code; }
}
const fault = code => new PostgresSourceError(code);
const invalid = error => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: error.code, field: error.field } });
const nativeCode = error => error instanceof PostgresSourceError ? error.code : error?.code === '57014' ? 'QUERY_TIMEOUT' :
  error?.code === '25006' ? 'SOURCE_READ_ONLY_VIOLATION' : 'QUERY_UNAVAILABLE';

export async function createPostgresQuerySource({ connection, queries, maxConnections = 4, maxPending = 32,
  connectTimeoutMs = 5000, idleTimeoutMs = 10000 } = {}) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection) ||
      ['host', 'user', 'database'].some(key => typeof connection[key] !== 'string' || !connection[key]) ||
      Object.hasOwn(connection, 'connectionString')) throw new TypeError('Explicit operator host, user and database configuration required');
  limit(maxConnections, 1, 16, 'maxConnections'); limit(maxPending, maxConnections, 256, 'maxPending');
  limit(connectTimeoutMs, 100, 30000, 'connectTimeoutMs'); limit(idleTimeoutMs, 1000, 300000, 'idleTimeoutMs');
  const compiled = compilePostgresQueries(queries);
  const [{ default: pg }, { default: Cursor }] = await Promise.all([import('pg'), import('pg-cursor')]);
  const pool = new pg.Pool({ host: connection.host, port: connection.port ?? 5432, user: connection.user,
    database: connection.database, password: connection.password, ssl: connection.ssl,
    max: maxConnections, connectionTimeoutMillis: connectTimeoutMs,
    idleTimeoutMillis: idleTimeoutMs, allowExitOnIdle: true, application_name: 'stellar-forge-sf30-postgres',
    options: '-c default_transaction_read_only=on -c standard_conforming_strings=on',
    statement_timeout: 30000, query_timeout: 30000 });
  // Idle failures are handled by pg-pool. Never print provider errors/credentials.
  pool.on('error', () => {});
  const waiting = [], active = new Set();
  let closed = false, closing;
  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw fault('QUERY_NOT_FOUND');
    return compiled[name];
  }
  const validate = (name, input) => bindPostgresParameters(definition(name), input);
  const busy = () => waiting.length + active.size;
  function destroy(job) {
    if (job.client && !job.released) { job.released = true; job.client.release(true); }
  }
  function finish(job, error, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.onAbort);
    error ? job.reject(error) : job.resolve(result);
  }
  function interrupt(job, code) {
    if (job.done) return;
    const index = waiting.indexOf(job);
    if (index >= 0) waiting.splice(index, 1);
    destroy(job); finish(job, fault(code)); queueMicrotask(pump);
  }
  const remaining = job => Math.max(1, Math.ceil(job.deadline - performance.now()));
  async function run(job) {
    active.add(job);
    let cursor;
    try {
      const client = await pool.connect(); job.client = client;
      if (job.done) { destroy(job); return; }
      await client.query({ text: 'BEGIN READ ONLY', query_timeout: remaining(job) });
      if (job.done) return;
      // Server deadline and local deadline both cover the complete read lifecycle.
      await client.query({ text: "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $1, true), set_config('timezone', 'UTC', true), set_config('DateStyle', 'ISO, YMD', true), set_config('bytea_output', 'hex', true)",
        values: [String(remaining(job))], query_timeout: remaining(job) });
      if (job.done) return;
      const spec = definition(job.name);
      cursor = client.query(new Cursor(spec.sql, job.values, { rowMode: 'array', types: { getTypeParser: () => value => value } }));
      const rows = []; let fields = [], bytes = 0, truncated = false;
      while (!job.done) {
        const batch = await new Promise((resolve, reject) => cursor.read(Math.min(32, spec.maxRows + 1 - rows.length),
          (error, values, result) => error ? reject(error) : resolve({ values, fields: result?.fields })));
        if (job.done) return;
        if (batch.fields) fields = batch.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID }));
        if (fields.length !== spec.columns.length || fields.some((field, index) => field.name !== spec.columns[index]))
          throw fault('QUERY_RESULT_CONTRACT');
        for (const row of batch.values) {
          if (rows.length === spec.maxRows) { truncated = true; break; }
          if (row.length !== spec.columns.length || row.some(value => value !== null && typeof value !== 'string')) throw fault('QUERY_RESULT_CONTRACT');
          const item = Object.fromEntries(spec.columns.map((column, index) => [column, row[index]]));
          bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
          if (bytes > spec.maxBytes) throw fault('QUERY_RESULT_TOO_LARGE');
          rows.push(item);
        }
        if (truncated || !batch.values.length) break;
      }
      if (job.done) return;
      await cursor.close(); cursor = null;
      if (job.done) return;
      const result = { schema: 'stellar-forge.postgres-result.v1', query: job.name,
        columns: [...spec.columns], fields, encoding: 'postgres-text', rows, rowCount: rows.length, truncated };
      if (Buffer.byteLength(JSON.stringify(result)) > spec.maxBytes) throw fault('QUERY_RESULT_TOO_LARGE');
      await client.query({ text: 'COMMIT', query_timeout: remaining(job) });
      if (!job.done) finish(job, null, result);
    } catch (error) {
      // A failed/timed-out read destroys this connection, rolling back its
      // transaction and ensuring no uncertain pooled state reaches the next buyer.
      destroy(job); finish(job, fault(nativeCode(error)));
    } finally {
      if (job.client && !job.released) {
        if (cursor || job.done && performance.now() >= job.deadline) destroy(job);
        else { job.released = true; job.client.release(); }
      }
      active.delete(job); queueMicrotask(pump);
    }
  }
  function pump() {
    if (closed) return;
    while (waiting.length && active.size < maxConnections) {
      const job = waiting.shift(); if (!job.done) void run(job);
    }
  }
  function query(name, input, { signal } = {}) {
    try {
      const values = validate(name, input);
      if (closed) throw fault('SOURCE_CLOSED');
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
      if (signal?.aborted) throw fault('QUERY_ABORTED');
      if (busy() >= maxPending) throw fault('SOURCE_BUSY');
      return new Promise((resolve, reject) => {
        const spec = definition(name), job = { name, values, signal, resolve, reject,
          deadline: performance.now() + spec.timeoutMs, done: false, released: false };
        job.onAbort = () => interrupt(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => interrupt(job, 'QUERY_TIMEOUT'), spec.timeoutMs);
        signal?.addEventListener('abort', job.onAbort, { once: true });
        waiting.push(job); pump();
      });
    } catch (error) { return Promise.reject(error); }
  }
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('Route input must be query or body');
    function values(context) {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new PostgresInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    }
    return Object.freeze({
      admit(context) {
        try {
          validate(name, values(context));
          if (closed) throw fault('SOURCE_CLOSED');
          if (busy() >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (error) { if (error instanceof PostgresInputError) return invalid(error); throw error; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await query(name, values(context), { signal: context?.signal }) }; }
        catch (error) {
          if (error instanceof PostgresInputError) return invalid(error);
          return { status: 503, body: { error: nativeCode(error) } };
        }
      },
    });
  }
  function describe() {
    return Object.fromEntries(Object.entries(compiled).map(([name, spec]) => [name, {
      parameters: structuredClone(spec.parameters), columns: [...spec.columns], maxRows: spec.maxRows,
      maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs, encoding: 'postgres-text',
    }]));
  }
  function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...waiting, ...active]) interrupt(job, 'SOURCE_CLOSED');
    closing = pool.end(); return closing;
  }
  return Object.freeze({ query, validate, route, describe, close,
    status: () => ({ state: closed ? 'CLOSED' : 'OPEN', active: active.size, queued: waiting.length,
      maxConnections, maxPending, connected: pool.totalCount, idle: pool.idleCount }) });
}
