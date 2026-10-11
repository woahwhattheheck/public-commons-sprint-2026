// MIT. Native ClickHouse HTTP queries using the ORIGINAL bounded SF30 transport.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUpstreamHandler, beginUpstreamRequest } from '../upstream-handler.mjs';
import { record } from '../sqlite/parameters.mjs';
import { fields, bounded, compileClickHouseQueries, bindClickHouseParameters,
  describeClickHouseQueries, projectedStatement, nullColumns, escapedParameter, QueryInputError } from './declaration.mjs';

const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const SETTINGS = ['query', 'query_id', 'wait_end_of_query', 'max_execution_time', 'max_result_rows',
  'max_result_bytes', 'result_overflow_mode', 'max_memory_usage', 'max_rows_to_read', 'max_bytes_to_read',
  'max_threads', 'cancel_http_readonly_queries_on_client_close', 'output_format_json_validate_utf8',
  'read_overflow_mode', 'timeout_overflow_mode', 'output_format_write_statistics'];
const SOURCE_FIELDS = ['schema', 'endpointEnv', 'userEnv', 'passwordEnv', 'database', 'allowLocal',
  'queries', 'bindings', 'maxInFlight', 'maxThreads', 'maxMemoryBytes', 'maxRowsToRead', 'maxBytesToRead'];
export class ClickHouseSourceError extends Error {
  constructor(code, query, upstreamStatus) {
    super(code); this.code = code; this.name = 'ClickHouseSourceError';
    if (query) this.query = query;
    if (Number.isInteger(upstreamStatus)) this.upstreamStatus = upstreamStatus;
  }
}
const fail = (code, query, status) => { throw new ClickHouseSourceError(code, query, status); };

export async function readJSONFile(filename, cap = 262144) {
  const file = await open(resolve(filename), 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > cap) throw new TypeError('CLICKHOUSE_CONFIGURATION_FILE_INVALID');
    const buffer = Buffer.alloc(cap + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > cap) throw new RangeError('CLICKHOUSE_CONFIGURATION_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)));
  } finally { await file.close(); }
}
function configuration(config) {
  fields(config, SOURCE_FIELDS, 'CLICKHOUSE_SOURCE_FIELDS_INVALID');
  if (config.schema !== 'stellar-forge.clickhouse-source.v1' ||
      ![config.endpointEnv, config.userEnv, config.passwordEnv].every(value => typeof value === 'string' && ENV.test(value)) ||
      typeof config.database !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.database) ||
      config.allowLocal !== undefined && typeof config.allowLocal !== 'boolean' ||
      config.bindings !== undefined && !record(config.bindings)) throw new TypeError('CLICKHOUSE_SOURCE_CONFIG_INVALID');
  return {
    maxInFlight: bounded(config.maxInFlight ?? 8, 1, 64, 'CLICKHOUSE_CAPACITY_INVALID'),
    maxThreads: bounded(config.maxThreads ?? 2, 1, 8, 'CLICKHOUSE_THREADS_INVALID'),
    maxMemoryBytes: bounded(config.maxMemoryBytes ?? 268435456, 1048576, 2147483648, 'CLICKHOUSE_MEMORY_LIMIT_INVALID'),
    maxRowsToRead: bounded(config.maxRowsToRead ?? 1000000, 1, 1000000000, 'CLICKHOUSE_SCAN_ROWS_INVALID'),
    maxBytesToRead: bounded(config.maxBytesToRead ?? 67108864, 1024, 2147483648, 'CLICKHOUSE_SCAN_BYTES_INVALID'),
  };
}
export async function readClickHouseSourceFile(filename) {
  const path = resolve(filename), config = await readJSONFile(path);
  configuration(config);
  const compiled = compileClickHouseQueries(config.queries);
  return { path, config, description: describeClickHouseQueries(compiled) };
}
function connection(config, env) {
  const endpoint = env[config.endpointEnv], user = env[config.userEnv], password = env[config.passwordEnv];
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 2048 || endpoint.trim() !== endpoint ||
      typeof user !== 'string' || !user || user.length > 1024 ||
      typeof password !== 'string' || password.length > 8192 ||
      [user, password].some(value => /[\x00-\x1f\x7f]/.test(value))) fail('CLICKHOUSE_ENV_UNAVAILABLE');
  let url;
  try { url = new URL(endpoint); } catch { fail('CLICKHOUSE_ENDPOINT_INVALID'); }
  const local = config.allowLocal === true && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash ||
      !/^\/(?:[A-Za-z0-9_.~-]+\/)*$/.test(url.pathname)) fail('CLICKHOUSE_ENDPOINT_INVALID');
  return { endpoint: url.href, headers: { 'x-clickhouse-user': user, 'x-clickhouse-key': password,
    'x-clickhouse-database': config.database, 'x-clickhouse-format': 'JSONCompactStrings' } };
}
function responseValue(response, name) {
  if (response.status !== 200 || !Buffer.isBuffer(response.body)) {
    const code = response.body?.error === 'UPSTREAM_TIMEOUT' ? 'QUERY_TIMEOUT' :
      response.body?.error === 'UPSTREAM_ABORTED' ? 'QUERY_ABORTED' :
      response.body?.error === 'UPSTREAM_RESPONSE_TOO_LARGE' ? 'QUERY_RESULT_TOO_LARGE' : 'QUERY_UNAVAILABLE';
    fail(code, name, response.body?.upstreamStatus ?? response.status);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); }
  catch { fail('QUERY_RESULT_INVALID', name); }
  if (!record(value) || value.exception !== undefined || !Array.isArray(value.meta) || !Array.isArray(value.data) ||
      !Number.isSafeInteger(value.rows) || value.rows !== value.data.length) fail('QUERY_RESULT_INVALID', name);
  return value;
}
function columnTypes(value, query, name) {
  const count = query.columns.length, expected = [...query.columns, ...nullColumns(query)];
  if (value.meta.length !== expected.length || value.meta.some((column, index) =>
    !record(column) || column.name !== expected[index] || typeof column.type !== 'string' ||
    !column.type || column.type.length > 2048 || index >= count && column.type !== 'UInt8')) fail('QUERY_COLUMN_MISMATCH', name);
  return value.meta.slice(0, count).map(({ name, type }) => ({ name, type }));
}

export async function createClickHouseQuerySource(config, { env = process.env } = {}) {
  const limits = configuration(config), queries = compileClickHouseQueries(config.queries);
  const { endpoint, headers } = connection(config, env), transports = new Map(), jobs = new Set();
  const pinnedTypes = Object.create(null);
  let closed = false, closing, completed = 0, failures = 0, serverVersion;
  function definition(name) {
    if (typeof name !== 'string' || !Object.hasOwn(queries, name)) fail('QUERY_NOT_FOUND');
    return queries[name];
  }
  function request(name, input, limit = undefined) {
    const query = definition(name), values = bindClickHouseParameters(query, input);
    const url = new URL(endpoint);
    const settings = { query: projectedStatement(query, limit), query_id: randomUUID(), wait_end_of_query: '1',
      max_execution_time: String(query.timeoutMs / 1000), max_result_rows: String(query.maxRows + 1),
      max_result_bytes: String(query.maxBytes), result_overflow_mode: 'throw',
      max_memory_usage: String(limits.maxMemoryBytes), max_rows_to_read: String(limits.maxRowsToRead),
      max_bytes_to_read: String(limits.maxBytesToRead), max_threads: String(limits.maxThreads),
      cancel_http_readonly_queries_on_client_close: '1', output_format_json_validate_utf8: '0',
      read_overflow_mode: 'throw', timeout_overflow_mode: 'throw', output_format_write_statistics: '1' };
    for (const [key, value] of Object.entries(settings)) url.searchParams.set(key, value);
    query.parameterOrder.forEach((field, index) => url.searchParams.set('param_' + field, escapedParameter(values[index])));
    if (url.href.length > 8192) throw new QueryInputError(null, 'ENCODED_QUERY_TOO_LARGE');
    return { query, url };
  }
  for (const [name, query] of Object.entries(queries)) transports.set(name, createUpstreamHandler({
    baseUrl: endpoint, path: '/', method: 'GET', headers, allowLocal: config.allowLocal === true,
    query: [...SETTINGS, ...query.parameterOrder.map(field => 'param_' + field)],
    responseType: 'json', responseHeaders: ['content-type'], timeoutMs: query.timeoutMs,
    maxResponseBytes: Math.min(2097152, query.maxBytes * 2 + 65536), maxInFlight: limits.maxInFlight,
  }));
  async function execute(name, input, { signal, preflight = false } = {}) {
    const prepared = request(name, input, preflight ? 0 : undefined), query = prepared.query;
    if (closed) fail('SOURCE_CLOSED', name);
    if (jobs.size >= limits.maxInFlight) fail('SOURCE_BUSY', name);
    const lifetime = beginUpstreamRequest(signal, query.timeoutMs);
    let done;
    const job = { lifetime, done: new Promise(resolve => { done = resolve; }) }; jobs.add(job);
    try {
      const raw = await transports.get(name)({ method: 'GET', url: prepared.url, headers: {}, signal: lifetime.signal });
      if (lifetime.signal.aborted) fail(lifetime.signal.reason?.code === 'UPSTREAM_TIMEOUT' ? 'QUERY_TIMEOUT' : 'QUERY_ABORTED', name);
      const value = responseValue(raw, name), types = columnTypes(value, query, name);
      if (!record(value.statistics) || !['rows_read', 'bytes_read'].every(key =>
        Number.isSafeInteger(value.statistics[key]) && value.statistics[key] >= 0)) fail('QUERY_SCAN_STATISTICS_INVALID', name);
      // Some engines can finish a small block beyond the configured native
      // read limit. Such a result still does not satisfy this source budget.
      if (value.statistics.rows_read > limits.maxRowsToRead || value.statistics.bytes_read > limits.maxBytesToRead)
        fail('QUERY_SCAN_LIMIT', name);
      if (preflight) {
        if (value.rows !== 0) fail('QUERY_PREFLIGHT_RETURNED_ROWS', name);
        pinnedTypes[name] = types; return;
      }
      if (JSON.stringify(types) !== JSON.stringify(pinnedTypes[name])) fail('QUERY_SCHEMA_CHANGED', name);
      const count = query.columns.length;
      if (value.rows > query.maxRows + 1 || value.data.some(row => !Array.isArray(row) || row.length !== count * 2 ||
          row.some((cell, index) => index < count ? typeof cell !== 'string' : !['0', '1'].includes(cell)))) fail('QUERY_RESULT_INVALID', name);
      const rows = value.data.slice(0, query.maxRows).map(row =>
        Object.fromEntries(query.columns.map((column, index) => [column, row[count + index] === '1' ? null : row[index]])));
      const result = { schema: 'stellar-forge.clickhouse-result.v1', query: name, columns: [...query.columns],
        columnTypes: types, rows, rowCount: rows.length, truncated: value.rows > query.maxRows,
        valueEncoding: 'clickhouse-text', nullEncoding: 'json-null', snapshot: 'single-request' };
      if (Buffer.byteLength(JSON.stringify(result)) > query.maxBytes) fail('QUERY_RESULT_TOO_LARGE', name);
      completed++; return result;
    } catch (issue) {
      failures++;
      if (issue instanceof ClickHouseSourceError || issue instanceof QueryInputError) throw issue;
      fail('QUERY_UNAVAILABLE', name);
    } finally { lifetime.close(); jobs.delete(job); done(); }
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const current = [...jobs];
    for (const job of current) job.lifetime.cancel();
    closing = Promise.allSettled(current.map(job => job.done)).then(() => {});
    return closing;
  }
  try {
    // Use the same transport and selected account; no private host or user in
    // inspection. Native startup parses each real schema before seller startup.
    const version = createUpstreamHandler({ baseUrl: endpoint, path: '/', method: 'GET', headers,
      query: ['query', 'wait_end_of_query'], allowLocal: config.allowLocal === true, responseType: 'json',
      timeoutMs: 5000, maxResponseBytes: 32768 });
    const url = new URL(endpoint); url.searchParams.set('query', 'SELECT version() AS version FORMAT JSONCompactStrings');
    url.searchParams.set('wait_end_of_query', '1');
    const value = responseValue(await version({ method: 'GET', url, headers: {} }), undefined);
    serverVersion = value.data?.[0]?.[0];
    if (typeof serverVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(serverVersion)) fail('CLICKHOUSE_VERSION_UNAVAILABLE');
    for (const [name, query] of Object.entries(queries)) await execute(name, query.probe, { preflight: true });
  } catch (issue) { await close(); throw issue; }
  const inputResponse = issue => ({ status: 422, body: { error: 'QUERY_INPUT_INVALID', code: issue.code, field: issue.field } });
  function route(name, { input = 'query' } = {}) {
    definition(name);
    if (!['query', 'body'].includes(input)) throw new TypeError('CLICKHOUSE_ROUTE_INPUT_INVALID');
    const values = context => {
      if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(context?.method))
        throw new QueryInputError(null, 'JSON_BODY_METHOD_REQUIRED');
      return context?.[input];
    };
    return Object.freeze({
      admit(context) {
        try {
          request(name, values(context));
          if (closed) return { status: 503, body: { error: 'SOURCE_CLOSED' } };
          if (jobs.size >= limits.maxInFlight) return { status: 429, headers: { 'retry-after': '1' }, body: { error: 'SOURCE_BUSY' } };
          return true;
        } catch (issue) { if (issue instanceof QueryInputError) return inputResponse(issue); throw issue; }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await execute(name, values(context), { signal: context?.signal }) }; }
        catch (issue) {
          if (issue instanceof QueryInputError) return inputResponse(issue);
          return { status: issue.code === 'QUERY_TIMEOUT' ? 504 : issue.code === 'SOURCE_BUSY' ? 429 : 503,
            body: { error: issue instanceof ClickHouseSourceError ? issue.code : 'QUERY_UNAVAILABLE' } };
        }
      },
    });
  }
  return Object.freeze({ query: (name, input, { signal } = {}) => execute(name, input, { signal }), route, close,
    describe: () => describeClickHouseQueries(queries),
    inspect: () => ({ schema: 'stellar-forge.clickhouse-inspection.v1', serverVersion, queries: describeClickHouseQueries(queries),
      columnTypes: structuredClone(pinnedTypes), limits: { ...limits }, transport: 'native-http-get', snapshot: 'single-request' }),
    status: () => ({ schema: 'stellar-forge.clickhouse-status.v1', state: closed ? 'CLOSED' : 'READY',
      active: jobs.size, maxInFlight: limits.maxInFlight, completed, failures }),
  });
}
export async function openClickHouseSourceFile(filename, options) {
  const declaration = await readClickHouseSourceFile(filename);
  const source = await createClickHouseQuerySource(declaration.config, options);
  return { ...declaration, source };
}
