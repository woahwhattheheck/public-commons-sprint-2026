// MIT. Named Snowflake reads use the original SF30 scalar and exact-decimal binder.
import { compilePostgresQueries, bindPostgresParameters } from '../postgres/declaration.mjs';
import { record } from '../sqlite/parameters.mjs';

export const SOURCE_SCHEMA = 'stellar-forge.snowflake-source.v1';
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const own = (value, key) => Object.hasOwn(value, key);
export function fault(code, message = code, status = 422) {
  return Object.assign(new Error(message), { code, status });
}
export function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw fault('SNOWFLAKE_DECLARATION_INVALID', label + ' contains unsupported fields.');
}
export function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw fault('SNOWFLAKE_LIMIT_INVALID', name + ' must be an integer from ' + min + ' to ' + max + '.');
  return value;
}
const identifier = value => {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\x00-\x1f\x7f]/.test(value))
    throw fault('SNOWFLAKE_CONTEXT_INVALID', 'Use the exact existing warehouse, database, schema and role names.');
  return value;
};

/** Preserve literals/comments verbatim. Only declared $name tokens become native binds. */
function tokens(sql, parameters) {
  const parts = [], used = new Set(); let text = '', start = 0;
  const flush = () => { if (text) parts.push(text); text = ''; };
  while (start < sql.length) {
    if (sql.startsWith('--', start)) {
      const end = sql.indexOf('\n', start), stop = end < 0 ? sql.length : end + 1;
      text += sql.slice(start, stop); start = stop; continue;
    }
    if (sql.startsWith('/*', start)) {
      let end = start + 2, depth = 1;
      while (end < sql.length && depth) {
        if (sql.startsWith('/*', end)) { depth++; end += 2; }
        else if (sql.startsWith('*/', end)) { depth--; end += 2; }
        else end++;
      }
      if (depth) throw fault('SNOWFLAKE_SQL_INVALID', 'Close the SQL comment.');
      text += sql.slice(start, end); start = end; continue;
    }
    if (sql.startsWith('$$', start)) {
      const end = sql.indexOf('$$', start + 2);
      if (end < 0) throw fault('SNOWFLAKE_SQL_INVALID', 'Close the dollar-quoted SQL literal.');
      text += sql.slice(start, end + 2); start = end + 2; continue;
    }
    const c = sql[start];
    if (c === "'" || c === '"') {
      let end = start + 1, closed = false;
      while (end < sql.length) {
        if (sql[end] === '\\' && c === "'") { end += 2; continue; }
        if (sql[end++] !== c) continue;
        if (sql[end] === c) { end++; continue; }
        closed = true; break;
      }
      if (!closed) throw fault('SNOWFLAKE_SQL_INVALID', 'Close the SQL literal or identifier.');
      text += sql.slice(start, end); start = end; continue;
    }
    if (c === ';' || c === '?' || c === ':' && sql[start + 1] !== ':' && sql[start - 1] !== ':')
      throw fault('SNOWFLAKE_SQL_INVALID', 'Declare one read query and use only $name parameters.');
    if (c === '$') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(start + 1));
      if (!match || !own(parameters, match[0]))
        throw fault('SNOWFLAKE_SQL_INVALID', 'Every SQL parameter needs a declaration.');
      flush(); parts.push({ parameter: match[0] }); used.add(match[0]); start += match[0].length + 1; continue;
    }
    text += c; start++;
  }
  flush();
  if (used.size !== Object.keys(parameters).length)
    throw fault('SNOWFLAKE_SQL_INVALID', 'Use every declared parameter in its named query.');
  return parts;
}

export function compileSnowflakeQueries(raw) {
  if (!record(raw) || !Object.keys(raw).length || Object.keys(raw).length > 64)
    throw fault('SNOWFLAKE_QUERIES_REQUIRED', 'Declare between 1 and 64 named Snowflake reads.');
  const normalized = Object.create(null);
  for (const [name, query] of Object.entries(raw)) {
    fields(query, ['sql', 'columns', 'parameters', 'parameterOrder', 'keyColumns', 'maxRows',
      'maxResultBytes', 'timeoutSeconds', 'description'], 'Query');
    const parameters = structuredClone(query.parameters ?? {});
    for (const [key, spec] of Object.entries(parameters)) if (spec.type === 'decimal') {
      const precision = integer(spec.precision, 1, 38, key + ' precision');
      const scale = integer(spec.scale, 0, precision, key + ' scale');
      spec.maxScale = Math.min(spec.maxScale ?? scale, scale);
      spec.maxIntegerDigits = Math.min(spec.maxIntegerDigits ?? precision - scale, precision - scale);
    }
    // Original compiler owns schema/default/enum/bound semantics. Capture limits
    // belong to the full provider result, not a 1000-row paid response page.
    normalized[name] = { sql: query.sql, columns: query.columns, parameters,
      ...(query.parameterOrder ? { parameterOrder: query.parameterOrder } : {}),
      maxRows: 1000, maxBytes: 917504, timeoutMs: 30000 };
  }
  const compiled = compilePostgresQueries(normalized);
  for (const [name, query] of Object.entries(compiled)) {
    const declared = raw[name];
    if (query.columns.some(name => name.toLowerCase().startsWith('__sf30_'))) throw fault('SNOWFLAKE_COLUMN_RESERVED');
    if (new Set(query.columns.map(value => value.toLowerCase())).size !== query.columns.length)
      throw fault('SNOWFLAKE_COLUMNS_AMBIGUOUS', 'Choose output column names that also remain distinct in SQLite.');
    const keyColumns = declared.keyColumns ?? [];
    if (!Array.isArray(keyColumns) || keyColumns.some(key => !query.columns.includes(key)) ||
        new Set(keyColumns).size !== keyColumns.length)
      throw fault('SNOWFLAKE_KEYS_INVALID', 'Comparison keys must be distinct declared output columns.');
    query.parts = tokens(query.sql, query.parameters);
    query.keyColumns = [...keyColumns];
    query.maxRows = integer(declared.maxRows ?? 250000, 1, 1000000, 'maxRows');
    query.maxResultBytes = integer(declared.maxResultBytes ?? 268435456, 1024, 1073741824, 'maxResultBytes');
    query.timeoutSeconds = integer(declared.timeoutSeconds ?? 300, 1, 86400, 'timeoutSeconds');
    query.description = declared.description ?? name;
    if (typeof query.description !== 'string' || query.description.length > 2048)
      throw fault('SNOWFLAKE_DESCRIPTION_INVALID');
  }
  return compiled;
}

export function compileSnowflakeSource(input) {
  fields(input, ['schema', 'label', 'accountUrlEnv', 'tokenEnv', 'tokenType', 'context',
    'queries', 'requestTimeoutMs', 'maxPartitionBytes', 'pollIntervalMs'], 'Source');
  if (input.schema !== SOURCE_SCHEMA || typeof input.label !== 'string' || !input.label.trim() ||
      input.label.length > 128 || !ENV.test(input.accountUrlEnv ?? '') || !ENV.test(input.tokenEnv ?? ''))
    throw fault('SNOWFLAKE_SOURCE_REQUIRED', 'Name the source and its host-held account URL and token environment variables.');
  if (!['OAUTH', 'KEYPAIR_JWT', 'PROGRAMMATIC_ACCESS_TOKEN'].includes(input.tokenType))
    throw fault('SNOWFLAKE_TOKEN_TYPE_REQUIRED', 'Choose the existing OAuth, key-pair JWT or programmatic access token.');
  fields(input.context, ['warehouse', 'database', 'schema', 'role'], 'Connection context');
  const context = Object.fromEntries(['warehouse', 'database', 'schema', 'role'].map(key => [key, identifier(input.context[key])]));
  return { config: structuredClone(input), context, queries: compileSnowflakeQueries(input.queries),
    requestTimeoutMs: integer(input.requestTimeoutMs ?? 30000, 1000, 120000, 'requestTimeoutMs'),
    maxPartitionBytes: integer(input.maxPartitionBytes ?? 33554432, 16777216, 67108864, 'maxPartitionBytes'),
    pollIntervalMs: integer(input.pollIntervalMs ?? 1000, 500, 30000, 'pollIntervalMs') };
}

export function accountOrigin(config, env) {
  let url;
  try { url = new URL(env[config.accountUrlEnv]); } catch { throw fault('SNOWFLAKE_ACCOUNT_UNAVAILABLE', 'The selected host account URL is unavailable.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      url.port || !/^[a-z0-9.-]+\.snowflakecomputing\.(?:com|cn)$/i.test(url.hostname))
    throw fault('SNOWFLAKE_ACCOUNT_INVALID', 'Use the existing account HTTPS origin ending in snowflakecomputing.com or snowflakecomputing.cn.');
  return url.origin;
}

export function statementBody(source, queryName, input) {
  const query = source.queries[queryName];
  if (!query) throw fault('SNOWFLAKE_QUERY_UNKNOWN', 'Choose a declared query.');
  const values = bindPostgresParameters(query, input);
  const byName = new Map(query.parameterOrder.map((name, index) => [name, values[index]]));
  const bindings = Object.create(null); let number = 0;
  const sql = query.parts.map(part => {
    if (typeof part === 'string') return part;
    const spec = query.parameters[part.parameter], value = byName.get(part.parameter);
    const type = value === null || spec.type === 'string' || spec.type === 'decimal' ? 'TEXT' :
      spec.type === 'integer' ? 'FIXED' : spec.type === 'number' ? 'REAL' : 'BOOLEAN';
    bindings[String(++number)] = { type, value: value === null ? null : String(value) };
    return spec.type === 'decimal' ? 'CAST(? AS NUMBER(' + spec.precision + ',' + spec.scale + '))' : '?';
  }).join('');
  return {
    statement: 'SELECT ' + query.columns.map(name => '"' + name + '"').join(', ') +
      '\nFROM (\n' + sql + '\n) AS SF30_SNOWFLAKE_SOURCE\nLIMIT ' + (query.maxRows + 1),
    ...source.context, timeout: query.timeoutSeconds, bindings,
    parameters: { multi_statement_count: '1', client_result_chunk_size: 16,
      query_tag: 'stellar-forge/snowflake/v1', rows_per_resultset: 0, timezone: 'UTC',
      binary_output_format: 'HEX', date_output_format: 'YYYY-MM-DD', time_output_format: 'HH24:MI:SS.FF9',
      timestamp_ntz_output_format: 'YYYY-MM-DD"T"HH24:MI:SS.FF9',
      timestamp_ltz_output_format: 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM',
      timestamp_tz_output_format: 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM' },
  };
}

export function describeSnowflakeSource(source) {
  return { schema: SOURCE_SCHEMA, label: source.config.label, context: source.context,
    environment: { account: source.config.accountUrlEnv, token: source.config.tokenEnv, tokenType: source.config.tokenType },
    queries: Object.fromEntries(Object.entries(source.queries).map(([name, query]) => [name, {
      description: query.description, parameters: query.parameters, columns: query.columns,
      keyColumns: query.keyColumns, maxRows: query.maxRows, maxResultBytes: query.maxResultBytes,
      timeoutSeconds: query.timeoutSeconds }])),
    requestTimeoutMs: source.requestTimeoutMs, maxPartitionBytes: source.maxPartitionBytes };
}
