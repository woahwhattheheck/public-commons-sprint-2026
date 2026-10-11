// MIT. PostgreSQL declarations reuse the original SF30 typed-value contract.
import { compileQueries, bindParameters, record, QueryInputError } from '../sqlite/parameters.mjs';

export { QueryInputError };
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// Lint the operator's SQL, not a tenant SQL sandbox. PostgreSQL parses the
// SELECT wrapper and enforces the transaction/role permissions independently.
function placeholders(sql) {
  const found = new Set();
  let i = 0, first = '';
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new TypeError('Unclosed PostgreSQL comment');
      continue;
    }
    if (!first) { first = /^[A-Za-z]+/.exec(sql.slice(i))?.[0]?.toUpperCase() ?? '?'; }
    const escapeString = /[eE]/.test(sql[i]) && sql[i + 1] === "'" && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1]));
    if (escapeString) i++;
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]; let ended = false;
      while (i < sql.length) {
        if (escapeString && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new TypeError('Unclosed PostgreSQL literal');
      continue;
    }
    if (sql[i] === '$') {
      const delimiter = /^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(sql.slice(i))?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) throw new TypeError('Unclosed PostgreSQL dollar quote');
        i = end + delimiter.length; continue;
      }
      const parameter = /^\$([1-9]\d*)(?![A-Za-z0-9_])/.exec(sql.slice(i));
      if (!parameter || Number(parameter[1]) > 64) throw new TypeError('Use positional $1 through $64 parameters');
      found.add(Number(parameter[1])); i += parameter[0].length; continue;
    }
    if (sql[i] === ';' || sql.charCodeAt(i) === 0) throw new TypeError('Exactly one PostgreSQL SELECT statement required');
    i++;
  }
  if (!['SELECT', 'WITH'].includes(first)) throw new TypeError('PostgreSQL query must start with SELECT or WITH');
  return found;
}

export function compilePostgresQueries(input) {
  if (!record(input) || !Object.keys(input).length || Object.keys(input).length > 64) throw new TypeError('Expected 1–64 named PostgreSQL queries');
  const result = Object.create(null);
  for (const [name, raw] of Object.entries(input)) {
    if (!NAME.test(name) || name.startsWith('__sf30_') || !record(raw) || typeof raw.sql !== 'string' || raw.sql.length > 65536)
      throw new TypeError('Named query requires trusted PostgreSQL SQL');
    const parameters = raw.parameters ?? {}, order = raw.parameterOrder ?? [];
    if (!record(parameters) || !Array.isArray(order) || order.length > 64 || new Set(order).size !== order.length ||
        order.some(field => typeof field !== 'string' || !NAME.test(field) || !Object.hasOwn(parameters, field)) ||
        Object.keys(parameters).length !== order.length) throw new TypeError('parameterOrder must name every declared parameter exactly once');
    const sql = raw.sql.trim().replace(/;\s*$/, '');
    const used = placeholders(sql);
    if (used.size !== order.length || order.some((_, index) => !used.has(index + 1)))
      throw new TypeError('Positional SQL parameters must exactly match parameterOrder');
    if (raw.columns?.some(column => column.startsWith('__sf30_'))) throw new TypeError('Reserved PostgreSQL output column');
    // Original validator handles names, defaults, enums, nullability, integer
    // precision, bounds, projection and limits. Only its SQL lint is replaced.
    const validated = compileQueries({ [name]: { ...raw, parameters,
      sql: 'SELECT ' + (order.length ? order.map(field => '$' + field).join(', ') : '1') } })[name];
    result[name] = Object.freeze({ ...validated, sql, parameterOrder: Object.freeze([...order]) });
  }
  return result;
}

export function bindPostgresParameters(query, input) {
  const values = bindParameters(query, input);
  return query.parameterOrder.map(name => {
    const value = values['$' + name];
    if (value === null) return null;
    if (query.parameters[name].type === 'boolean') return value === 1n;
    return typeof value === 'bigint' ? value.toString() : value;
  });
}

export function projectedSql(spec) {
  const ref = column => '__sf30_data."' + column + '"';
  const bytes = spec.columns.map(column => 'coalesce(pg_catalog.octet_length(' + ref(column) + '::text), 0)::bigint').join(' + ');
  const tooLarge = '(' + bytes + ') > ' + spec.maxBytes;
  const fields = spec.columns.map(column => 'CASE WHEN ' + tooLarge + ' THEN NULL ELSE ' + ref(column) + '::text END AS "' + column + '"');
  return 'SELECT ' + fields.join(', ') + ', (' + tooLarge + ') AS "__sf30_oversize" FROM (\n' + spec.sql + '\n) AS __sf30_data LIMIT ' + (spec.maxRows + 1);
}

export function describeQueries(compiled) {
  return Object.fromEntries(Object.entries(compiled).map(([name, spec]) => [name, {
    parameters: structuredClone(spec.parameters), parameterOrder: [...spec.parameterOrder],
    columns: [...spec.columns], maxRows: spec.maxRows, maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs,
    valueEncoding: 'postgres-text', nullEncoding: 'json-null',
  }]));
}
