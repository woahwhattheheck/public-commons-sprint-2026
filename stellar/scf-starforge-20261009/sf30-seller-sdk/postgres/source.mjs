// MIT. A pooled PostgreSQL data source for the ORIGINAL SF30 seller lifecycle.
import { performance } from 'node:perf_hooks';
import { bindPostgresParameters, compilePostgresQueries, describePostgresQueries,
  projectedStatement, QueryInputError } from './declaration.mjs';

export class PostgresSourceError extends Error {
  constructor(code, query = undefined, sqlState = undefined) {
    super(code); this.name = 'PostgresSourceError'; this.code = code;
    if (query) this.query = query;
    if (typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState)) this.sqlState = sqlState;
  }
}
const error = (code, query, state) => new PostgresSourceError(code, query, state);
const TEXT_TYPES = Object.freeze({ getTypeParser: () => value => value });
const limit = (value, low, high, code) => {
  if (!Number.isInteger(value) || value < low || value > high) throw new RangeError(code);
  return value;
};
const inputResponse = issue => ({ status: 422,
  body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
function safeFailure(issue, name) {
  if (issue instanceof PostgresSourceError || issue instanceof QueryInputError) return issue;
  if (issue?.code === '57014') return error('QUERY_TIMEOUT', name, issue.code);
  if (issue?.code === '55P03') return error('QUERY_LOCK_TIMEOUT', name, issue.code);
  return error('QUERY_UNAVAILABLE', name, issue?.code);
}

export async function createPostgresQuerySource({ connection, queries, maxConnections = 4,
  maxPending = 32, connectTimeoutMs = 5000, idleTimeoutMs = 30000,
  lockTimeoutMs = 500, startupTimeoutMs = 10000 } = {}) {
  if (!connection || typeof connection !== 'object') throw new TypeError('POSTGRES_CONNECTION_REQUIRED');
  maxConnections = limit(maxConnections, 1, 32, 'POSTGRES_CONNECTION_LIMIT');
  maxPending = limit(maxPending, maxConnections, 256, 'POSTGRES_PENDING_LIMIT');
  connectTimeoutMs = limit(connectTimeoutMs, 100, 30000, 'POSTGRES_CONNECT_TIMEOUT');
  idleTimeoutMs = limit(idleTimeoutMs, 1000, 300000, 'POSTGRES_IDLE_TIMEOUT');
  lockTimeoutMs = limit(lockTimeoutMs, 1, 30000, 'POSTGRES_LOCK_TIMEOUT');
  startupTimeoutMs = limit(startupTimeoutMs, 100, 60000, 'POSTGRES_STARTUP_TIMEOUT');
  const compiled = compilePostgresQueries(queries);
  let Pool;
  try { ({ Pool } = await import('pg')); }
  catch { throw error('POSTGRES_DRIVER_UNAVAILABLE'); }
  const pool = new Pool({ ...connection, max: maxConnections,
    connectionTimeoutMillis: connectTimeoutMs, idleTimeoutMillis: idleTimeoutMs,
    allowExitOnIdle: true, application_name: 'sf30-postgres-source',
    statement_timeout: startupTimeoutMs, query_timeout: startupTimeoutMs + 1000,
    idle_in_transaction_session_timeout: startupTimeoutMs + 1000 });
  // A terminated idle backend must not crash the process or log its credentials.
  pool.on('error', () => { failures++; });
  const queue = [], jobs = new Set(), running = new Set();
  let active = 0, closed = false, closing = null, completed = 0, failures = 0;
  let serverVersion, columnTypes = Object.create(null);

  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw error('QUERY_NOT_FOUND');
    return compiled[name];
  }
  const validate = (name, input) => bindPostgresParameters(definition(name), input);
  function release(job, destroy) {
    const client = job.client;
    if (!client) return;
    job.client = null;
    try { client.release(destroy === true); } catch { /* already retired */ }
  }
  function finish(job, issue, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    jobs.delete(job);
    if (issue) { failures++; job.reject(issue); }
    else { completed++; job.resolve(result); }
  }
  function cancel(job, code) {
    if (job.done) return;
    finish(job, error(code, job.name));
    // Retire this connection. Never put an uncertain/aborted transaction back
    // into the pool, and never replay the query on a replacement connection.
    release(job, true);
    pump();
  }
  const remaining = job => Math.max(1, Math.floor(job.deadline - performance.now()));
  async function execute(job) {
    try {
      const client = await pool.connect();
      if (job.done || closed) { client.release(true); return; }
      job.client = client;
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (job.done) return;
      const budget = remaining(job);
      await client.query({ text: "SELECT set_config('statement_timeout',$1,true), " +
        "set_config('lock_timeout',$2,true), set_config('idle_in_transaction_session_timeout',$3,true), " +
        "set_config('search_path','pg_catalog',true)",
        values: [String(budget), String(Math.min(lockTimeoutMs, budget)), String(budget + 1000)],
        queryMode: 'extended' });
      if (job.done) return;
      const query = compiled[job.name];
      const result = await client.query({ text: projectedStatement(query), values: job.values,
        rowMode: 'array', types: TEXT_TYPES, queryMode: 'extended' });
      if (job.done) return;
      if (result.fields.length !== query.columns.length ||
          result.fields.some((field, index) => field.name !== query.columns[index]))
        throw error('QUERY_PROJECTION_CHANGED', job.name);
      const rows = result.rows.slice(0, query.maxRows).map(row =>
        Object.fromEntries(query.columns.map((name, index) => [name, row[index]])));
      const output = { schema: 'stellar-forge.postgres-result.v1', query: job.name,
        columns: [...query.columns], columnTypes: result.fields.map(field => ({ name: field.name, oid: field.dataTypeID })),
        rows, rowCount: rows.length, truncated: result.rows.length > query.maxRows,
        valueEncoding: 'postgres-text', snapshot: 'single-request-repeatable-read' };
      if (Buffer.byteLength(JSON.stringify(output)) > query.maxBytes) throw error('QUERY_RESULT_TOO_LARGE', job.name);
      await client.query('COMMIT');
      if (job.done) return;
      release(job, false); finish(job, null, output);
    } catch (issue) {
      release(job, true);
      if (!job.done) finish(job, safeFailure(issue, job.name));
    } finally {
      release(job, true); active--;
      pump();
    }
  }
  function pump() {
    if (closed) return;
    while (active < maxConnections && queue.length) {
      const job = queue.shift();
      if (job.done) continue;
      active++;
      const task = execute(job);
      running.add(task);
      task.finally(() => running.delete(task));
    }
  }
  function query(name, input, { signal } = {}) {
    try {
      if (closed) throw error('SOURCE_CLOSED');
      if (signal !== undefined && (typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function')) throw new TypeError('ABORT_SIGNAL_REQUIRED');
      if (signal?.aborted) throw error('QUERY_ABORTED', name);
      const values = validate(name, input);
      if (jobs.size >= maxPending) throw error('SOURCE_BUSY');
      return new Promise((resolve, reject) => {
        const duration = compiled[name].timeoutMs;
        const job = { name, values, signal, resolve, reject, done: false, client: null,
          deadline: performance.now() + duration };
        job.abort = () => cancel(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), duration);
        signal?.addEventListener('abort', job.abort, { once: true });
        jobs.add(job); queue.push(job); pump();
      });
    } catch (issue) { return Promise.reject(issue); }
  }
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('POSTGRES_ROUTE_INPUT_INVALID');
    const values = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method))
        throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          validate(name, values(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (jobs.size >= maxPending) return { status: 429,
            headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return inputResponse(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await query(name, values(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return inputResponse(issue);
          return { status: issue.code === 'QUERY_TIMEOUT' ? 504 : issue.code === 'SOURCE_BUSY' ? 429 : 503,
            body: { error: issue instanceof PostgresSourceError ? issue.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  function status() { return { schema: 'stellar-forge.postgres-status.v1', state: closed ? 'CLOSED' : 'READY',
    active, pending: jobs.size, maxConnections, maxPending, completed, failures }; }
  const describe = () => describePostgresQueries(compiled);
  const inspect = () => ({ schema: 'stellar-forge.postgres-inspection.v1', serverVersion,
    transactionMode: 'REPEATABLE READ READ ONLY', queries: describe(), columnTypes: structuredClone(columnTypes) });
  function close() {
    if (closing) return closing;
    closed = true;
    for (const job of [...jobs]) cancel(job, 'SOURCE_CLOSED');
    queue.length = 0;
    closing = (async () => { await Promise.allSettled([...running]); await pool.end(); })();
    return closing;
  }

  // Parse declarations against the operator's actual schema before exposing a
  // seller. LIMIT 0 returns metadata only. No caller input or paid operation.
  let startupClient, startupExpired = false;
  const startupTimer = setTimeout(() => {
    startupExpired = true;
    if (startupClient) { try { startupClient.release(true); } catch {} startupClient = null; }
  }, startupTimeoutMs);
  try {
    const client = await pool.connect();
    if (startupExpired) { client.release(true); throw error('SOURCE_START_TIMEOUT'); }
    startupClient = client;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL search_path = pg_catalog");
    const version = await client.query("SELECT current_setting('server_version') AS version, current_setting('transaction_read_only') AS readonly");
    if (version.rows[0]?.readonly !== 'on') throw error('SOURCE_READ_ONLY_NOT_ACTIVE');
    serverVersion = version.rows[0].version;
    for (const [name, declaration] of Object.entries(compiled)) {
      try {
        const result = await client.query({ text: projectedStatement(declaration, 0),
          values: declaration.parameterOrder.map(() => null), rowMode: 'array',
          types: TEXT_TYPES, queryMode: 'extended' });
        columnTypes[name] = result.fields.map(field => ({ name: field.name, oid: field.dataTypeID }));
      } catch (issue) { throw error('SOURCE_QUERY_DECLARATION_INVALID', name, issue?.code); }
    }
    await client.query('COMMIT');
    if (startupClient) { startupClient.release(); startupClient = null; }
  } catch (issue) {
    if (startupClient) { startupClient.release(true); startupClient = null; }
    await close();
    throw startupExpired ? error('SOURCE_START_TIMEOUT') :
      issue instanceof PostgresSourceError ? issue : error('SOURCE_START_FAILED', undefined, issue?.code);
  } finally { clearTimeout(startupTimer); }
  return Object.freeze({ query, validate, route, describe, inspect, status, close });
}
