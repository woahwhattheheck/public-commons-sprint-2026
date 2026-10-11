// MIT. Native prepared reads bound to the original seller's request lifetime.
import { performance } from 'node:perf_hooks';
import { compileMysqlQueries, bindMysqlParameters, describeMysqlQueries,
  projectedStatement, boundedStatement, QueryInputError } from './declaration.mjs';
import { createMysqlPool, mysqlCall as call, mysqlDeadline } from './lifecycle.mjs';
import { MysqlDatasetError, mysqlDatasetExtractionOptions, readMysqlDataset } from './publisher/stream.mjs';

export class MysqlSourceError extends Error {
  constructor(code, query, sqlState) {
    super(code); this.name = 'MysqlSourceError'; this.code = code;
    if (query) this.query = query;
    if (typeof sqlState === 'string' && /^[A-Z0-9]{5}$/.test(sqlState)) this.sqlState = sqlState;
  }
}
const error = (code, query, state) => new MysqlSourceError(code, query, state);
const limit = (value, minimum, maximum, code) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(code);
  return value;
};
const fieldMetadata = fields => fields.map(field => ({ name: field.name, type: field.columnType,
  flags: field.flags, charset: field.characterSet, decimals: field.decimals }));
function scalar(value) {
  if (value === null || typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64') };
  if (typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  throw error('QUERY_UNSUPPORTED_RESULT_TYPE');
}

function readResult(connection, declaration, values, name, ensureActive) {
  return new Promise((resolve, reject) => {
    const output = { schema: 'stellar-forge.mysql-result.v1', query: name,
      columns: [...declaration.columns], columnTypes: [], rows: [], rowCount: 0, truncated: false,
      valueEncoding: 'mysql-exact-scalars', binaryEncoding: 'base64-object', nullEncoding: 'json-null',
      snapshot: 'single-request-repeatable-read' };
    let done = false, bytes = 0;
    const fail = issue => { if (!done) { done = true; reject(issue); } };
    let command;
    try { command = connection.execute({ sql: boundedStatement(declaration), rowsAsArray: true }, values); }
    catch (issue) { fail(issue); return; }
    command.once('fields', fields => {
      if (done) return;
      try {
        ensureActive();
        if (fields.length !== declaration.columns.length + 1 ||
            fields.slice(0, -1).some((field, index) => field.name !== declaration.columns[index]))
          throw error('QUERY_PROJECTION_CHANGED', name);
        output.columnTypes = fieldMetadata(fields.slice(0, -1));
        bytes = Buffer.byteLength(JSON.stringify(output));
      } catch (issue) { fail(issue); }
    });
    // Without a callback, mysql2 emits each prepared row instead of collecting
    // an unbounded result. Keep only the declared complete response budget.
    command.on('result', row => {
      if (done) return;
      try {
        ensureActive();
        if (output.rows.length === declaration.maxRows) { output.truncated = true; return; }
        if (!Array.isArray(row) || row.length !== declaration.columns.length + 1 || Number(row.at(-1)) !== 0)
          throw error('QUERY_RESULT_TOO_LARGE', name);
        const item = Object.fromEntries(declaration.columns.map((column, index) => [column, scalar(row[index])]));
        const added = Buffer.byteLength(JSON.stringify(item)) + (output.rows.length ? 1 : 0);
        if (bytes + added + 32 > declaration.maxBytes) throw error('QUERY_RESULT_TOO_LARGE', name);
        bytes += added; output.rows.push(item);
      } catch (issue) { fail(issue); }
    });
    command.once('error', fail);
    command.once('end', () => {
      if (done) return;
      try {
        ensureActive(); output.rowCount = output.rows.length;
        if (Buffer.byteLength(JSON.stringify(output)) > declaration.maxBytes) throw error('QUERY_RESULT_TOO_LARGE', name);
        done = true; resolve(output);
      } catch (issue) { fail(issue); }
    });
  });
}

function safeError(issue, name) {
  if (issue instanceof MysqlSourceError || issue instanceof QueryInputError || issue instanceof MysqlDatasetError) return issue;
  if (issue?.errno === 1792 || issue?.sqlState === '25006') return error('QUERY_READ_ONLY_VIOLATION', name, '25006');
  if ([1205, 1317, 1969, 3024].includes(issue?.errno)) return error('QUERY_TIMEOUT', name, issue.sqlState);
  return error('QUERY_UNAVAILABLE', name, issue?.sqlState);
}

export async function createMysqlQuerySource({ connection, queries, maxConnections = 4,
  maxPending = 32, connectTimeoutMs = 5000, idleTimeoutMs = 30000, startupTimeoutMs = 10000 } = {}) {
  if (!connection || typeof connection !== 'object') throw new TypeError('MYSQL_CONNECTION_REQUIRED');
  maxConnections = limit(maxConnections, 1, 32, 'MYSQL_CONNECTION_LIMIT');
  maxPending = limit(maxPending, maxConnections, 256, 'MYSQL_PENDING_LIMIT');
  connectTimeoutMs = limit(connectTimeoutMs, 100, 30000, 'MYSQL_CONNECT_TIMEOUT');
  idleTimeoutMs = limit(idleTimeoutMs, 1000, 300000, 'MYSQL_IDLE_TIMEOUT');
  startupTimeoutMs = limit(startupTimeoutMs, 100, 60000, 'MYSQL_START_TIMEOUT');
  const compiled = compileMysqlQueries(queries);
  let mysql;
  try { ({ default: mysql } = await import('mysql2')); } catch { throw error('MYSQL_DRIVER_UNAVAILABLE'); }
  const pool = createMysqlPool(mysql, { ...connection,
    connectTimeout: connectTimeoutMs, multipleStatements: false, namedPlaceholders: false,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
    dateStrings: true, jsonStrings: true, rowsAsArray: true, timezone: 'Z',
    charset: 'utf8mb4', enableKeepAlive: true, flags: ['-LOCAL_FILES'], maxPreparedStatements: 128 },
    { maxConnections, idleTimeoutMs });
  const acquire = pool.acquire;
  const pending = new Set(), queue = [], running = new Set();
  let active = 0, closed = false, closing, completed = 0, failures = 0, version;
  const metadata = Object.create(null);
  const definition = name => {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw error('QUERY_NOT_FOUND');
    return compiled[name];
  };
  const validate = (name, input) => bindMysqlParameters(definition(name), input);
  function release(job, destroy) {
    const connection = job.connection; job.connection = null;
    if (!connection) return;
    if (job.onError) connection.removeListener('error', job.onError);
    if (job.onEnd) connection.removeListener('end', job.onEnd);
    if (destroy) pool.retire(connection); else pool.release(connection);
  }
  function finish(job, issue, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); pending.delete(job);
    job.signal?.removeEventListener('abort', job.abort);
    if (issue) { failures++; job.reject(issue); } else { completed++; job.resolve(result); }
  }
  function cancel(job, code) {
    if (job.done) return;
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    const issue = error(code, job.name);
    finish(job, issue); job.interrupt?.(issue); release(job, true); pump();
  }
  async function begin(client, wait, extraction = false) {
    await wait(call(client, 'query', 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
    await wait(call(client, 'query', "SET SESSION time_zone = '+00:00'"));
    // Pin parsing to ordinary quoted strings for the declaration lexer.
    await wait(call(client, 'query', "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"));
    await wait(call(client, 'query', extraction ?
      'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' : 'START TRANSACTION READ ONLY'));
  }
  async function execute(job) {
    try {
      const wait = promise => Promise.race([promise, job.interrupted]);
      // A late successful acquisition after cancellation is immediately retired.
      const acquisition = acquire().then(client => {
        if (job.done || closed) { pool.retire(client); throw error('QUERY_ABORTED', job.name); }
        return client;
      });
      const client = await wait(acquisition);
      if (job.done || closed) { pool.retire(client); return; }
      job.connection = client;
      job.onError = () => cancel(job, 'QUERY_UNAVAILABLE'); client.on('error', job.onError);
      job.onEnd = job.onError; client.once('end', job.onEnd);
      const ensureActive = () => { if (job.done || closed) throw error(closed ? 'SOURCE_CLOSED' : 'QUERY_ABORTED', job.name); };
      if (version.toLowerCase().includes('mariadb')) await wait(call(client, 'query', 'SET SESSION max_statement_time = 0'));
      else await wait(call(client, 'query', 'SET SESSION max_execution_time = 0'));
      await begin(client, wait, Boolean(job.extraction)); ensureActive();
      // The client deadline covers acquisition, transaction setup, execution and
      // result processing. Cancellation destroys this socket; it is never reused.
      const budget = Math.max(1, Math.floor(job.deadline - performance.now()));
      if (version.toLowerCase().includes('mariadb'))
        await wait(call(client, 'query', 'SET SESSION max_statement_time = ' + (budget / 1000).toFixed(3)));
      else await wait(call(client, 'query', 'SET SESSION max_execution_time = ' + budget));
      ensureActive();
      const result = await wait(job.extraction ? readMysqlDataset(client, definition(job.name), {
        name: job.name, values: job.values, options: job.extraction, onRow: job.onRow,
        ensureActive, serverVersion: version, metadata: fieldMetadata, encodeScalar: scalar,
      }) : readResult(client, definition(job.name), job.values, job.name, ensureActive));
      ensureActive(); await wait(call(client, 'query', job.extraction ? 'COMMIT' : 'ROLLBACK')); ensureActive();
      if (job.extraction) result.transaction.committed = true;
      release(job, false); finish(job, null, result);
    } catch (issue) {
      release(job, true); if (!job.done) finish(job, safeError(issue, job.name));
    } finally { release(job, true); active--; pump(); }
  }
  function pump() {
    if (closed) return;
    while (active < maxConnections && queue.length) {
      const job = queue.shift(); if (job.done) continue;
      active++; const task = execute(job); running.add(task);
      task.finally(() => running.delete(task));
    }
  }
  function enqueue(name, input, { signal, extraction, onRow } = {}) {
    try {
      if (closed) throw error('SOURCE_CLOSED');
      if (signal !== undefined && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
        throw new TypeError('ABORT_SIGNAL_REQUIRED');
      if (signal?.aborted) throw error('QUERY_ABORTED', name);
      const values = validate(name, input);
      if (pending.size >= maxPending) throw error('SOURCE_BUSY');
      return new Promise((resolve, reject) => {
        const duration = extraction?.timeoutMs ?? definition(name).timeoutMs;
        const job = { name, values, signal, extraction, onRow, resolve, reject, deadline: performance.now() + duration, done: false };
        job.interrupted = new Promise((_, reject) => { job.interrupt = reject; });
        job.interrupted.catch(() => {});
        job.abort = () => cancel(job, 'QUERY_ABORTED');
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), duration);
        signal?.addEventListener('abort', job.abort, { once: true });
        pending.add(job); queue.push(job); pump();
      });
    } catch (issue) { return Promise.reject(issue); }
  }
  const query = (name, input, { signal } = {}) => enqueue(name, input, { signal });
  async function exportDataset(name, input, { signal, onRow, ...supplied } = {}) {
    if (typeof onRow !== 'function') throw new MysqlDatasetError('DATASET_ROW_HANDLER_REQUIRED');
    const extraction = mysqlDatasetExtractionOptions(definition(name), supplied);
    return enqueue(name, input, { signal, extraction, onRow });
  }
  const invalid = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('MYSQL_ROUTE_INPUT_INVALID');
    const getInput = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          validate(name, getInput(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (pending.size >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return invalid(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await query(name, getInput(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return invalid(issue);
          return { status: issue.code === 'QUERY_TIMEOUT' ? 504 : issue.code === 'SOURCE_BUSY' ? 429 : 503,
            body: { error: issue instanceof MysqlSourceError ? issue.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  function close() {
    if (closing) return closing;
    closed = true; for (const job of [...pending]) cancel(job, 'SOURCE_CLOSED'); queue.length = 0;
    pool.close();
    closing = (async () => { await Promise.allSettled([...running]); })();
    return closing;
  }
  let startup;
  const deadline = mysqlDeadline(startupTimeoutMs, error('MYSQL_START_TIMEOUT'), pool.close);
  try {
    startup = await deadline.wait(acquire());
    await begin(startup, deadline.wait);
    const result = await deadline.wait(call(startup, 'query', 'SELECT VERSION() AS version'));
    version = String(result.rows[0][0]);
    for (const [name, declaration] of Object.entries(compiled)) {
      try {
        const result = await deadline.wait(call(startup, 'execute', projectedStatement(declaration, 0), declaration.parameterOrder.map(() => null)));
        if (result.fields.length !== declaration.columns.length || result.fields.some((field, index) => field.name !== declaration.columns[index]))
          throw error('QUERY_PROJECTION_CHANGED', name);
        metadata[name] = fieldMetadata(result.fields);
      } catch (issue) { throw error('SOURCE_QUERY_DECLARATION_INVALID', name, issue?.sqlState); }
    }
    await deadline.wait(call(startup, 'query', 'ROLLBACK')); pool.release(startup); startup = null;
  } catch (issue) {
    if (startup) pool.retire(startup); await close();
    throw deadline.expired ? error('MYSQL_START_TIMEOUT') : issue instanceof MysqlSourceError ? issue : error('SOURCE_START_FAILED', undefined, issue?.sqlState);
  } finally { deadline.close(); }
  return Object.freeze({ query, exportDataset, validate, route, close,
    describe: () => describeMysqlQueries(compiled),
    inspect: () => ({ schema: 'stellar-forge.mysql-inspection.v1', serverVersion: version,
      transactionMode: 'REPEATABLE READ READ ONLY', queries: describeMysqlQueries(compiled), columnTypes: structuredClone(metadata) }),
    status: () => ({ schema: 'stellar-forge.mysql-status.v1', state: closed ? 'CLOSED' : 'READY',
      active, pending: pending.size, maxConnections, maxPending, completed, failures }) });
}
