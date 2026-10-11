// MIT. ClickHouse syntax over the ORIGINAL SF30 scalar and exact-decimal contract.
import { compilePostgresQueries, bindPostgresParameters, describePostgresQueries,
  QueryInputError } from '../postgres/declaration.mjs';
import { record } from '../sqlite/parameters.mjs';
export { QueryInputError };

const own = (value, key) => Object.hasOwn(value, key);
const QUERY_FIELDS = ['sql', 'parameters', 'parameterOrder', 'columns', 'maxRows', 'maxBytes', 'timeoutMs', 'probe'];
const PARAMETER_FIELDS = ['type', 'nullable', 'minimum', 'maximum', 'minLength', 'maxLength', 'enum', 'default', 'precision', 'scale'];
export function fields(value, allowed, code) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(code);
}
export function bounded(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(code);
  return value;
}
function nativeType(spec) {
  let value = { string: 'String', integer: 'Int64', number: 'Float64', boolean: 'Bool' }[spec.type];
  if (spec.type === 'decimal') {
    bounded(spec.precision, 1, 76, 'CLICKHOUSE_DECIMAL_PRECISION_REQUIRED');
    bounded(spec.scale, 0, spec.precision, 'CLICKHOUSE_DECIMAL_SCALE_REQUIRED');
    value = `Decimal(${spec.precision}, ${spec.scale})`;
  } else if (own(spec, 'precision') || own(spec, 'scale')) throw new TypeError('CLICKHOUSE_DECIMAL_FIELDS_ONLY');
  return spec.nullable ? `Nullable(${value})` : value;
}

// A template linter, not a SQL authorization boundary. ClickHouse parses the
// actual SELECT wrapper; the database user must have only the intended grants.
// No submitted value is interpolated into this SQL text.
function template(sql, types) {
  let output = '', i = 0;
  const used = new Set();
  while (i < sql.length) {
    const start = i, ch = sql[i];
    if (sql.startsWith('--', i) || ch === '#') {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new TypeError('CLICKHOUSE_UNCLOSED_SQL_COMMENT');
    } else if (['\'', '"', '`'].includes(ch)) {
      let ended = false; i++;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== ch) continue;
        if (sql[i] === ch) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new TypeError('CLICKHOUSE_UNCLOSED_SQL_LITERAL');
    } else if (ch === '$') {
      const heredoc = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (heredoc) {
        const end = sql.indexOf(heredoc[0], i + heredoc[0].length);
        if (end < 0) throw new TypeError('CLICKHOUSE_UNCLOSED_SQL_LITERAL');
        i = end + heredoc[0].length;
      } else {
        const match = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i));
        if (!match || !own(types, match[1])) throw new TypeError('CLICKHOUSE_UNDECLARED_SQL_PARAMETER');
        used.add(match[1]); output += `{${match[1]}:${types[match[1]]}}`; i += match[0].length; continue;
      }
    } else {
      if (ch === ';' || ch === '{' || ch === '}') throw new TypeError('CLICKHOUSE_USE_ONE_SELECT_AND_DOLLAR_PARAMETERS');
      i++;
    }
    output += sql.slice(start, i);
  }
  if (used.size !== Object.keys(types).length) throw new TypeError('CLICKHOUSE_UNUSED_SQL_PARAMETER');
  return output;
}

function nativeValue(value, spec, field) {
  if (value === null) return value;
  if (typeof value === 'string' && Buffer.from(value).toString('utf8') !== value)
    throw new QueryInputError(field, 'INVALID_UNICODE');
  if (spec.type === 'decimal') {
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const significantWhole = whole.replace(/^0+/, '').length;
    if (significantWhole > spec.precision - spec.scale || /[1-9]/.test(fraction.slice(spec.scale)))
      throw new QueryInputError(field, 'DECIMAL_PRECISION_OR_SCALE');
  }
  return value;
}
export function bindClickHouseParameters(query, input) {
  return bindPostgresParameters(query, input).map((value, index) =>
    nativeValue(value, query.parameters[query.parameterOrder[index]], query.parameterOrder[index]));
}
export function compileClickHouseQueries(raw) {
  if (!record(raw)) throw new TypeError('CLICKHOUSE_NAMED_QUERIES_REQUIRED');
  for (const query of Object.values(raw)) {
    fields(query, QUERY_FIELDS, 'CLICKHOUSE_QUERY_FIELDS_INVALID');
    for (const spec of Object.values(query.parameters ?? {})) fields(spec, PARAMETER_FIELDS, 'CLICKHOUSE_PARAMETER_FIELDS_INVALID');
  }
  const queries = compilePostgresQueries(raw);
  for (const [name, query] of Object.entries(queries)) {
    if (query.parameterOrder.length > 48) throw new TypeError('CLICKHOUSE_AT_MOST_48_PARAMETERS');
    query.nativeTypes = Object.fromEntries(query.parameterOrder.map(field => [field, nativeType(query.parameters[field])]));
    query.nativeSql = template(query.sql, query.nativeTypes);
    if (!record(raw[name].probe)) throw new TypeError('CLICKHOUSE_EXPLICIT_PREFLIGHT_PROBE_REQUIRED');
    query.probe = structuredClone(raw[name].probe);
    bindClickHouseParameters(query, query.probe);
    // Defaults, enum values and bounds must fit the native decimal type too.
    for (const [field, spec] of Object.entries(query.parameters)) if (spec.type === 'decimal') {
      for (const key of ['default', 'minimum', 'maximum']) if (own(spec, key)) nativeValue(spec[key], spec, field);
      for (const value of spec.enum ?? []) nativeValue(value, spec, field);
    }
  }
  return queries;
}
export function nullColumns(query) {
  const used = new Set(query.columns);
  return query.columns.map((_, index) => {
    let name = '__sf30_null_' + index;
    while (used.has(name)) name += '_';
    used.add(name); return name;
  });
}
export function projectedStatement(query, limit = query.maxRows + 1) {
  const columns = query.columns.map(name => `sf30_clickhouse_source."${name}"`), masks = nullColumns(query);
  // JSONCompactStrings encodes a SQL NULL as a printable string. Native null
  // flags preserve NULL separately from an identical literal String value,
  // without converting Decimal/UInt64 through JSON numbers or another query.
  return 'SELECT ' + [...columns.map((column, index) => `${column} AS "${query.columns[index]}"`),
    ...columns.map((column, index) => `isNull(${column}) AS "${masks[index]}"`)].join(', ') +
    '\nFROM (\n' + query.nativeSql + '\n) AS sf30_clickhouse_source\nLIMIT ' + limit + '\nFORMAT JSONCompactStrings';
}
export function describeClickHouseQueries(queries) {
  const result = describePostgresQueries(queries);
  for (const [name, query] of Object.entries(queries)) result[name].nativeTypes = { ...query.nativeTypes };
  return result;
}
export function escapedParameter(value) {
  if (value === null) return '\\N';
  // ClickHouse's HTTP typed parameters use Escaped serialization before URL
  // encoding. A literal backslash-N is therefore distinct from SQL NULL.
  return String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r').replace(/\u0008/g, '\\b').replace(/\f/g, '\\f');
}
