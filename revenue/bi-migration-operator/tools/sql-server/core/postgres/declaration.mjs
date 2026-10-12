// MIT. PostgreSQL declarations reuse the original SF30 scalar input contract.
import { bindParameters, compileQueries, QueryInputError, record } from '../sqlite/parameters.mjs';
import { bindDecimalParameter, compileDecimalParameter, decimalScalarParameter } from './decimal.mjs';
export { QueryInputError };

export function compilePostgresQueries(queries) {
  if (!record(queries) || Object.keys(queries).length < 1 || Object.keys(queries).length > 64)
    throw new TypeError('POSTGRES_EXPECTED_NAMED_QUERIES');
  const scalarDeclarations = Object.create(null);
  const decimals = Object.create(null);
  for (const [name, query] of Object.entries(queries)) {
    if (!record(query) || typeof query.sql !== 'string' || !query.sql.trim() || query.sql.length > 65536)
      throw new TypeError('POSTGRES_QUERY_SQL_REQUIRED');
    if (!record(query.parameters ?? {})) throw new TypeError('POSTGRES_PARAMETERS_INVALID');
    // Compile the existing shared scalar schema without interpreting PostgreSQL
    // syntax as SQLite syntax. PostgreSQL parses the real statement at preflight.
    const names = Object.keys(query.parameters ?? {});
    decimals[name] = Object.create(null);
    const parameters = Object.fromEntries(Object.entries(query.parameters ?? {}).map(([field, spec]) => {
      if (!record(spec) || spec.type !== 'decimal') return [field, spec];
      decimals[name][field] = compileDecimalParameter(spec, field);
      return [field, decimalScalarParameter(spec)];
    }));
    scalarDeclarations[name] = { ...query, parameters,
      sql: names.length ? 'SELECT ' + names.map(field => '$' + field).join(', ') : 'SELECT 1' };
  }
  const compiled = compileQueries(scalarDeclarations);
  for (const [name, query] of Object.entries(queries)) {
    const names = Object.keys(compiled[name].parameters);
    const order = query.parameterOrder ?? names;
    if (!Array.isArray(order) || order.length !== names.length || new Set(order).size !== order.length ||
        order.some(field => typeof field !== 'string' || !names.includes(field)))
      throw new TypeError('POSTGRES_PARAMETER_ORDER_INVALID');
    const sql = query.sql.trim().replace(/;\s*$/, '');
    const scalarParameters = compiled[name].parameters;
    for (const spec of Object.values(scalarParameters)) {
      if (spec.type === 'string' && [spec.default, ...(spec.enum ?? [])].some(value =>
        typeof value === 'string' && value.includes('\0')))
        throw new TypeError('POSTGRES_TEXT_CONTAINS_NUL');
    }
    compiled[name] = { ...compiled[name], sql, parameterOrder: [...order],
      ...(Object.keys(decimals[name]).length ? { scalarParameters,
        parameters: { ...scalarParameters, ...decimals[name] } } : {}) };
  }
  return compiled;
}

export function bindPostgresParameters(query, input) {
  // A compiled query carries the shared scalar projection. Direct callers of
  // this binder can use the same decimal declaration without exposing SQL.
  const parameters = query.scalarParameters ?? Object.fromEntries(Object.entries(query.parameters).map(([name, spec]) =>
    [name, spec.type === 'decimal' ? decimalScalarParameter(spec) : spec]));
  const named = bindParameters({ ...query, parameters }, input);
  return query.parameterOrder.map(name => {
    const value = named['$' + name];
    if (query.parameters[name].type === 'decimal') return bindDecimalParameter(value, query.parameters[name], name);
    if (value === null) return null;
    if (query.parameters[name].type === 'string' && value.includes('\0'))
      throw new QueryInputError(name, 'INVALID_POSTGRES_TEXT');
    if (query.parameters[name].type === 'boolean') return value === 1n;
    return typeof value === 'bigint' ? String(value) : value;
  });
}

export function projectedStatement(query, limit = query.maxRows + 1) {
  // Column names already passed the original strict identifier validator.
  // queryMode=extended makes PostgreSQL parse exactly one statement, even when
  // the operator's query has no parameters. No request value enters SQL text.
  return 'SELECT ' + query.columns.map(name => '"' + name + '"').join(', ') +
    '\nFROM (\n' + query.sql + '\n) AS sf30_postgres_source\nLIMIT ' + limit;
}

export function describePostgresQueries(queries) {
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, {
    parameters: structuredClone(query.parameters), parameterOrder: [...query.parameterOrder],
    columns: [...query.columns], maxRows: query.maxRows, maxBytes: query.maxBytes,
    timeoutMs: query.timeoutMs,
  }]));
}
