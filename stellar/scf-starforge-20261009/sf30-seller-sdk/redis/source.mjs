// MIT. Native Redis/Valkey execution with an exclusively owned connection per read.
import { createHash } from 'node:crypto';
import { compileRedisQueries, bindRedisQuery, describeRedisQueries, QueryInputError } from './declaration.mjs';
import { READ_SCRIPT } from './read-script.mjs';
import { createUpstashRestClient, RedisHttpError } from './upstash-rest.mjs';
export class RedisSourceError extends Error {
  constructor(code, query) { super(code); this.name = 'RedisSourceError'; this.code = code; if (query) this.query = query; }
}
const fail = (code, query) => new RedisSourceError(code, query);
const number = (value, low, high, name) => {
  if (!Number.isInteger(value) || value < low || value > high) throw new TypeError('REDIS_LIMIT_INVALID:' + name);
  return value;
};
const scriptSha256 = createHash('sha256').update(READ_SCRIPT).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function scalar(value) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) {
    try { return decoder.decode(value); } catch { return { base64: value.toString('base64') }; }
  }
  throw fail('QUERY_RESULT_INVALID');
}
function safeError(issue, name) {
  if (issue instanceof RedisSourceError || issue instanceof QueryInputError) return issue;
  if (issue instanceof RedisHttpError) {
    const mapped = fail(issue.code, name);
    if (issue.retryAfter) mapped.retryAfter = issue.retryAfter;
    return mapped;
  }
  const message = typeof issue?.message === 'string' ? issue.message : '';
  if (message.includes('SF30_RESULT_TOO_LARGE')) return fail('QUERY_RESULT_TOO_LARGE', name);
  if (message.includes('WRONGTYPE')) return fail('QUERY_SOURCE_TYPE_CHANGED', name);
  if (/NOPERM|NOAUTH|WRONGPASS/.test(message)) return fail('SOURCE_ACCESS_DENIED', name);
  if (/unknown command.*EVAL_RO/i.test(message)) return fail('SOURCE_REQUIRES_READONLY_SCRIPTING', name);
  return fail('QUERY_UNAVAILABLE', name);
}
function resultOf(name, query, bound, raw) {
  if (!Array.isArray(raw) || raw.length !== 2 || ![0, 1].includes(raw[0]) || !Array.isArray(raw[1]) || raw[1].length > query.maxRows)
    throw fail('QUERY_RESULT_INVALID', name);
  const rows = raw[1].map(row => {
    if (!Array.isArray(row) || row.length !== query.columns.length) throw fail('QUERY_RESULT_INVALID', name);
    return Object.fromEntries(query.columns.map((column, index) => [column, scalar(row[index])]));
  });
  const output = { schema: 'stellar-forge.redis-result.v1', query: name, kind: query.kind,
    columns: [...query.columns], rows, rowCount: rows.length, truncated: raw[0] === 1,
    valueEncoding: 'utf8-or-base64-object', nullEncoding: 'json-null',
    readConsistency: 'single-native-read-script',
    ...(query.kind === 'stream' ? { duplicateFieldProjection: 'last-value' } : {}) };
  if (output.truncated && query.offset) {
    const next = BigInt(bound.position) + BigInt(rows.length);
    if (next <= BigInt(query.parameters[query.offset].maximum))
      output.nextInput = { ...bound.values, [query.offset]: String(next) };
    else output.continuationUnavailable = 'OFFSET_LIMIT';
  }
  if (output.truncated && query.after && rows.length) output.nextInput = { ...bound.values, [query.after]: rows.at(-1).id };
  if (output.nextInput) {
    try { bindRedisQuery(query, output.nextInput); }
    catch (issue) {
      if (!(issue instanceof QueryInputError)) throw issue;
      delete output.nextInput; output.continuationUnavailable = 'INPUT_LIMIT';
    }
  }
  if (Buffer.byteLength(JSON.stringify(output)) > query.maxBytes) throw fail('QUERY_RESULT_TOO_LARGE', name);
  return output;
}

export async function createRedisQuerySource({ connection, queries, maxConnections = 4, maxPending = 32,
  connectTimeoutMs = 5000, idleTimeoutMs = 30000, startupTimeoutMs = 10000 } = {}) {
  const http = connection?.transport === 'upstash-rest';
  if (!connection || typeof connection !== 'object' || !http && !connection.socket) throw new TypeError('REDIS_CONNECTION_REQUIRED');
  maxConnections = number(maxConnections, 1, 32, 'maxConnections');
  maxPending = number(maxPending, maxConnections, 256, 'maxPending');
  connectTimeoutMs = number(connectTimeoutMs, 100, 30000, 'connectTimeoutMs');
  idleTimeoutMs = number(idleTimeoutMs, 1000, 300000, 'idleTimeoutMs');
  startupTimeoutMs = number(startupTimeoutMs, 100, 60000, 'startupTimeoutMs');
  const compiled = compileRedisQueries(queries);
  let makeClient;
  if (http) makeClient = () => createUpstashRestClient(connection);
  else {
    let createClient, RESP_TYPES;
    try { ({ createClient, RESP_TYPES } = await import('@redis/client')); }
    catch { throw fail('REDIS_DRIVER_UNAVAILABLE'); }
    makeClient = () => createClient({ ...connection, RESP: 2, disableClientInfo: true, disableOfflineQueue: true,
      commandsQueueMaxLength: 16, commandOptions: { timeout: 0, typeMapping: { [RESP_TYPES.BLOB_STRING]: Buffer } },
      socket: { ...connection.socket, connectTimeout: connectTimeoutMs, reconnectStrategy: false } });
  }
  const connections = new Set(), idle = [], ownership = new Map(), timers = new Map();
  const pending = new Set(), queue = [], running = new Set();
  let active = 0, closed = false, closing, completed = 0, failures = 0;
  function retire(client) {
    if (!client) return;
    const index = idle.indexOf(client); if (index >= 0) idle.splice(index, 1);
    clearTimeout(timers.get(client)); timers.delete(client); ownership.delete(client); connections.delete(client);
    try { if (client.isOpen) client.destroy(); } catch { /* Already closed by the native client. */ }
  }
  function release(client) {
    if (!client) return;
    ownership.delete(client);
    if (closed || !client.isReady) { retire(client); return; }
    idle.push(client);
    const timer = setTimeout(() => retire(client), idleTimeoutMs); timer.unref?.(); timers.set(client, timer);
  }
  async function acquire(job) {
    let client;
    while (idle.length && !client) {
      const candidate = idle.pop(); clearTimeout(timers.get(candidate)); timers.delete(candidate);
      if (candidate.isReady) client = candidate; else retire(candidate);
    }
    if (!client) {
      client = makeClient();
      connections.add(client);
      client.on?.('error', () => {
        const owner = ownership.get(client);
        if (typeof owner?.reject === 'function') cancel(owner, 'QUERY_UNAVAILABLE');
        else retire(client);
      });
    }
    job.client = client; ownership.set(client, job);
    if (!client.isOpen) await client.connect();
    if (job.done || closed) { retire(client); throw fail('QUERY_ABORTED', job.name); }
    return client;
  }
  const definition = name => {
    if (typeof name !== 'string' || !Object.hasOwn(compiled, name)) throw fail('QUERY_NOT_FOUND');
    return compiled[name];
  };
  const validate = (name, input) => bindRedisQuery(definition(name), input);
  function finish(job, issue, result) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer); pending.delete(job);
    job.signal?.removeEventListener('abort', job.abort);
    if (issue) { failures++; job.reject(issue); } else { completed++; job.resolve(result); }
  }
  function cancel(job, code) {
    if (job.done) return;
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    const issue = fail(code, job.name);
    finish(job, issue); job.interrupt(issue); retire(job.client); job.client = null; pump();
  }
  async function execute(job) {
    let healthy = false;
    try {
      const wait = promise => Promise.race([promise, job.interrupted]);
      const client = await wait(acquire(job));
      if (job.done) return;
      const q = definition(job.name);
      const raw = await wait(client.sendCommand(['EVAL_RO', READ_SCRIPT, '1', job.bound.key,
        q.kind, String(q.maxRows), String(q.maxBytes), job.bound.position, ...Object.values(q.fields)],
        http ? { maxResponseBytes: q.maxBytes + 16 * q.maxRows * (q.columns.length + 1) + 1024 } : undefined));
      if (job.done || closed) throw fail('QUERY_ABORTED', job.name);
      const result = resultOf(job.name, q, job.bound, raw); healthy = true; finish(job, null, result);
    } catch (issue) { if (!job.done) finish(job, safeError(issue, job.name)); }
    finally {
      if (healthy) release(job.client); else retire(job.client);
      job.client = null; active--; pump();
    }
  }
  function pump() {
    if (closed) return;
    while (active < maxConnections && queue.length) {
      const job = queue.shift(); if (job.done) continue;
      active++; const task = execute(job); running.add(task);
      task.finally(() => running.delete(task));
    }
  }
  function query(name, input, { signal } = {}) {
    try {
      if (closed) throw fail('SOURCE_CLOSED');
      if (signal !== undefined && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
        throw new TypeError('ABORT_SIGNAL_REQUIRED');
      if (signal?.aborted) throw fail('QUERY_ABORTED', name);
      const bound = validate(name, input);
      if (pending.size >= maxPending) throw fail('SOURCE_BUSY');
      return new Promise((resolve, reject) => {
        const job = { name, bound, signal, resolve, reject, done: false, client: null };
        job.interrupted = new Promise((_, reject) => { job.interrupt = reject; });
        // Queued cancellation must not create an unhandled rejection.
        job.interrupted.catch(() => {});
        job.abort = () => cancel(job, 'QUERY_ABORTED');
        pending.add(job); queue.push(job);
        signal?.addEventListener('abort', job.abort, { once: true });
        job.timer = setTimeout(() => cancel(job, 'QUERY_TIMEOUT'), definition(name).timeoutMs);
        if (signal?.aborted) job.abort(); else pump();
      });
    } catch (issue) { return Promise.reject(issue); }
  }
  const invalid = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('REDIS_ROUTE_INPUT_INVALID');
    const submitted = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method)) throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          validate(name, submitted(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (pending.size >= maxPending) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return invalid(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await query(name, submitted(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return invalid(issue);
          return { status: issue.code === 'QUERY_TIMEOUT' ? 504 :
            ['SOURCE_BUSY', 'SOURCE_RATE_LIMITED', 'SOURCE_QUOTA_EXCEEDED'].includes(issue.code) ? 429 :
            issue.code === 'QUERY_RESULT_TOO_LARGE' ? 413 : 503,
            ...(issue.retryAfter ? { headers: { 'retry-after': issue.retryAfter } } : {}),
            body: { error: issue instanceof RedisSourceError ? issue.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  function close() {
    if (closing) return closing;
    closed = true; for (const job of [...pending]) cancel(job, 'SOURCE_CLOSED'); queue.length = 0;
    for (const client of [...connections]) retire(client);
    closing = (async () => { await Promise.allSettled([...running]); })();
    return closing;
  }
  // Check the real read-only scripting capability without reading merchant data.
  const startup = { done: false, name: undefined };
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    startup.done = true; retire(startup.client); reject(fail('SOURCE_START_TIMEOUT'));
  }, startupTimeoutMs); });
  startup.interrupt = () => {};
  // Startup has its own error path; it is not an admitted customer job.
  try {
    const client = await Promise.race([acquire(startup), deadline]); ownership.delete(client);
    await Promise.race([client.sendCommand(['EVAL_RO', "return redis.call('PING')", '0']), deadline]);
    release(client); startup.client = null;
  } catch (issue) { retire(startup.client); await close(); throw safeError(issue); }
  finally { clearTimeout(timer); }
  return Object.freeze({ query, validate, route, close,
    describe: () => describeRedisQueries(compiled),
    inspect: () => ({ schema: 'stellar-forge.redis-inspection.v1', driver: http ? 'Upstash REST' : '@redis/client@6.2.1',
      protocol: http ? 'HTTPS_RESP2' : 'RESP2', scriptSha256, readConsistency: 'single-native-read-script', queries: describeRedisQueries(compiled) }),
    status: () => ({ schema: 'stellar-forge.redis-status.v1', state: closed ? 'CLOSED' : 'READY', active,
      pending: pending.size, connections: connections.size, idle: idle.length, maxConnections, maxPending, completed, failures }) });
}
