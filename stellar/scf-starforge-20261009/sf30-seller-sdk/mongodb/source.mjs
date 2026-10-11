// MIT. Native cursor reads use the original seller request signal and admission.
import { MongoClient, BSON } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { compileMongoQueries, bindMongoParameters, describeMongoQueries, resultPipeline, QueryInputError } from './declaration.mjs';
import { integer } from './common.mjs';

export class MongoSourceError extends Error {
  constructor(code, query) { super(code); this.name = 'MongoSourceError'; this.code = code; if (query) this.query = query; }
}
const error = (code, query) => new MongoSourceError(code, query);
export const canonicalEjson = value => BSON.EJSON.serialize(value, { relaxed: false });
export function bsonType(value) {
  if (value === null) return 'null';
  if (value?._bsontype) return value._bsontype;
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function publicError(issue, name, signal) {
  if (signal?.aborted) return signal.reason instanceof MongoSourceError ? signal.reason : error('QUERY_ABORTED', name);
  if (issue instanceof MongoSourceError || issue instanceof QueryInputError) return issue;
  const code = Number(issue?.code);
  if (code === 50 || issue?.name === 'MongoOperationTimeoutError') return error('QUERY_TIMEOUT', name);
  if ([246, 286].includes(code)) return error('QUERY_SNAPSHOT_UNAVAILABLE', name);
  if ([13, 18].includes(code)) return error('QUERY_ACCESS_DENIED', name);
  return error('QUERY_UNAVAILABLE', name);
}

export async function connectMongoClient(connection, { maxConnections = 4, connectTimeoutMs = 5000, startupTimeoutMs = 10000 } = {}) {
  if (typeof connection?.uri !== 'string' || typeof connection.database !== 'string') throw error('MONGODB_CONNECTION_REQUIRED');
  const client = new MongoClient(connection.uri, { ...connection.options, appName: 'stellar-forge-mongodb-merchant',
    maxPoolSize: maxConnections, minPoolSize: 0, maxConnecting: Math.min(2, maxConnections),
    connectTimeoutMS: connectTimeoutMs, serverSelectionTimeoutMS: startupTimeoutMs,
    waitQueueTimeoutMS: connectTimeoutMs, readPreference: 'primary',
    promoteValues: false, promoteLongs: false, bsonRegExp: true, ignoreUndefined: false });
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 }, { timeoutMS: startupTimeoutMs, promoteValues: true });
    if (Number(hello.maxWireVersion) < 13 || !hello.logicalSessionTimeoutMinutes) throw error('MONGODB_5_OR_NEWER_WITH_SESSIONS_REQUIRED');
    let serverVersion = null;
    try { serverVersion = (await client.db('admin').command({ buildInfo: 1 }, { timeoutMS: startupTimeoutMs })).version; }
    catch (issue) { if (Number(issue?.code) !== 13) throw issue; }
    return { client, database: client.db(connection.database), metadata: { serverVersion,
      topology: hello.msg === 'isdbgrid' ? 'sharded' : hello.setName ? 'replica-set' : 'standalone',
      maxWireVersion: Number(hello.maxWireVersion), driverVersion: '7.7.0' } };
  } catch (issue) { await client.close(); throw publicError(issue); }
}

export async function createMongoQuerySource({ connection, queries, maxConnections = 4, maxPending = 32,
  connectTimeoutMs = 5000, startupTimeoutMs = 10000 } = {}) {
  integer(maxConnections, 1, 32, 'MONGODB_CONNECTION_LIMIT');
  integer(maxPending, maxConnections, 256, 'MONGODB_PENDING_LIMIT');
  integer(connectTimeoutMs, 100, 30000, 'MONGODB_CONNECT_TIMEOUT');
  integer(startupTimeoutMs, 100, 60000, 'MONGODB_START_TIMEOUT');
  const compiled = compileMongoQueries(queries);
  const { client, database, metadata } = await connectMongoClient(connection, { maxConnections, connectTimeoutMs, startupTimeoutMs });
  if (metadata.topology === 'standalone' && Object.values(compiled).some(query => query.readConcern === 'snapshot')) {
    await client.close(); throw error('MONGODB_SNAPSHOT_REQUIRES_REPLICA_SET_OR_SHARDED_SERVER');
  }
  let closed = false, closing, active = 0, completed = 0, failures = 0;
  const jobs = new Set(), queue = [];
  const definition = name => {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw error('QUERY_NOT_FOUND');
    return compiled[name];
  };
  const validate = (name, input) => bindMongoParameters(definition(name), input);
  function pump() {
    while (!closed && active < maxConnections && queue.length) {
      const waiting = queue.shift();
      if (waiting.signal.aborted) continue;
      waiting.signal.removeEventListener('abort', waiting.abort);
      active++; waiting.resolve();
    }
  }
  function acquire(signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiting = { signal, resolve, reject, abort() {
        const index = queue.indexOf(waiting); if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      } };
      signal.addEventListener('abort', waiting.abort, { once: true }); queue.push(waiting); pump();
    });
  }
  async function execute(name, values, signal, deadline) {
    const declaration = definition(name);
    const session = client.startSession({ snapshot: declaration.readConcern === 'snapshot', causalConsistency: false });
    let cursor;
    const result = { schema: 'stellar-forge.mongodb-result.v1', query: name, columns: [...declaration.columns],
      columnTypes: Object.fromEntries(declaration.columns.map(column => [column, {}])), rows: [], rowCount: 0, truncated: false,
      valueEncoding: 'mongodb-canonical-extended-json-v2', missingFieldEncoding: 'omitted-property',
      read: { concern: declaration.readConcern, preference: 'primary', session: 'one-request',
        consistency: declaration.readConcern === 'snapshot' ? 'one-majority-committed-point-in-time' :
          declaration.readConcern === 'majority' ? 'majority-committed-read-without-point-in-time-guarantee' : 'local-read-without-majority-or-point-in-time-guarantee' } };
    let rowBytes = 0;
    try {
      signal.throwIfAborted();
      cursor = database.collection(declaration.collection).aggregate(resultPipeline(declaration), {
        session, let: values, readConcern: { level: declaration.readConcern }, readPreference: 'primary',
        maxTimeMS: Math.max(1, Math.floor(deadline - performance.now())), signal,
        batchSize: Math.min(20, declaration.maxRows + 1), allowDiskUse: false,
        promoteValues: false, promoteLongs: false, bsonRegExp: true,
        comment: 'stellar-forge:' + name,
      });
      for await (const document of cursor) {
        signal.throwIfAborted();
        if (result.rows.length === declaration.maxRows) { result.truncated = true; break; }
        const value = canonicalEjson(document), added = Buffer.byteLength(JSON.stringify(value)) + (result.rows.length ? 1 : 0);
        for (const field of declaration.columns) {
          const type = Object.hasOwn(document, field) ? bsonType(document[field]) : 'missing';
          result.columnTypes[field][type] = (result.columnTypes[field][type] ?? 0) + 1;
        }
        const metadataBytes = Buffer.byteLength(JSON.stringify({ ...result, rows: [] }));
        if (metadataBytes + rowBytes + added > declaration.maxBytes) throw error('QUERY_RESULT_TOO_LARGE', name);
        result.rows.push(value); rowBytes += added;
      }
      result.rowCount = result.rows.length;
      if (session.operationTime) result.read.operationTime = canonicalEjson(session.operationTime);
      if (session.clusterTime?.clusterTime) result.read.clusterTime = canonicalEjson(session.clusterTime.clusterTime);
      // operationTime/clusterTime are observed server metadata, not a fabricated snapshot timestamp.
      if (Buffer.byteLength(JSON.stringify(result)) > declaration.maxBytes) throw error('QUERY_RESULT_TOO_LARGE', name);
      signal.throwIfAborted();
      return result;
    } finally {
      await cursor?.close().catch(() => {});
      await session.endSession();
    }
  }
  function query(name, input, { signal: callerSignal } = {}) {
    let values;
    try {
      if (closed) throw error('SOURCE_CLOSED');
      values = validate(name, input);
      if (callerSignal?.aborted) throw error('QUERY_ABORTED', name);
      if (jobs.size >= maxPending) throw error('SOURCE_BUSY');
    } catch (issue) { return Promise.reject(issue); }
    const controller = new AbortController(), signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
    const duration = definition(name).timeoutMs, deadline = performance.now() + duration;
    const timer = setTimeout(() => controller.abort(error('QUERY_TIMEOUT', name)), duration);
    const job = { controller, task: null }; jobs.add(job);
    job.task = (async () => {
      let acquired = false;
      try {
        await acquire(signal); acquired = true;
        const result = await execute(name, values, signal, deadline); completed++; return result;
      } catch (issue) { failures++; throw publicError(issue, name, signal); }
      finally { clearTimeout(timer); jobs.delete(job); if (acquired) active--; pump(); }
    })();
    return job.task;
  }
  const invalid = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw error('MONGODB_ROUTE_INPUT_INVALID');
    const inputOf = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          validate(name, inputOf(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (jobs.size >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return invalid(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await query(name, inputOf(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return invalid(issue);
          return { status: issue.code === 'QUERY_TIMEOUT' ? 504 : issue.code === 'QUERY_RESULT_TOO_LARGE' ? 413 : issue.code === 'SOURCE_BUSY' ? 429 : 503,
            body: { error: issue instanceof MongoSourceError ? issue.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const pending = [...jobs]; pending.forEach(job => job.controller.abort(error('SOURCE_CLOSED')));
    closing = Promise.allSettled(pending.map(job => job.task)).then(() => client.close());
    return closing;
  }
  return Object.freeze({ query, validate, route, close,
    describe: () => describeMongoQueries(compiled),
    inspect: () => ({ schema: 'stellar-forge.mongodb-inspection.v1', ...metadata, queries: describeMongoQueries(compiled),
      namespaces: [...new Set(Object.values(compiled).flatMap(query => [query.collection, ...query.referencedCollections]))].sort(),
      credentials: 'environment-only', sourceSemantics: 'live-fixed-read-aggregations' }),
    status: () => ({ schema: 'stellar-forge.mongodb-status.v1', state: closed ? 'CLOSED' : 'READY',
      active, pending: jobs.size, maxConnections, maxPending, completed, failures }) });
}
