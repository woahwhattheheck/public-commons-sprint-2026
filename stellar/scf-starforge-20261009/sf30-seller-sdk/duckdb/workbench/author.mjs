// MIT. Explicit actual-column choices -> original named DuckDB queries.
import { createHash } from 'node:crypto';
import { compileQueries, record } from '../../sqlite/parameters.mjs';
import { requireDuckdbCatalogProfile } from './catalog.mjs';

const fault = code => Object.assign(new Error(code), { code });
const reserved = new Set(['constructor', 'prototype', '__proto__']);
const name = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value) &&
  !reserved.has(value.toLowerCase());
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const columnReference = value => 'sf30_workbench.' + quote(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Preserve exact decimal/large-integer text through the original scalar binder. */
export function duckdbColumnParameter(column) {
  if (typeof column?.type !== 'string') return null;
  const type = column.type.toUpperCase().replace(/\s+/g, ' ').trim();
  if (['TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'UTINYINT', 'USMALLINT', 'UINTEGER'].includes(type))
    return { type: 'integer', cast: 'BIGINT', ordered: true, prefix: false, example: '0' };
  if (['UBIGINT', 'HUGEINT', 'UHUGEINT'].includes(type))
    return { type: 'string', cast: type, maxLength: 40, ordered: true, prefix: false, example: '0' };
  if (/^DECIMAL\((?:[1-9]|[12][0-9]|3[0-8]),\s*(?:[0-9]|[12][0-9]|3[0-8])\)$/.test(type))
    return { type: 'string', cast: type, maxLength: 128, ordered: true, prefix: false, example: '0' };
  if (['FLOAT', 'REAL', 'DOUBLE', 'DOUBLE PRECISION'].includes(type))
    return { type: 'number', cast: 'DOUBLE', ordered: true, prefix: false, example: 0 };
  if (type === 'BOOLEAN') return { type: 'boolean', cast: 'BOOLEAN', ordered: false, prefix: false, example: true };
  if (['VARCHAR', 'CHAR', 'BPCHAR', 'TEXT', 'STRING'].includes(type))
    return { type: 'string', cast: 'VARCHAR', maxLength: 4096, ordered: true, prefix: true, example: '' };
  if (['DATE', 'TIME', 'TIME WITH TIME ZONE', 'TIMESTAMP', 'TIMESTAMP_S', 'TIMESTAMP_MS',
    'TIMESTAMP_NS', 'TIMESTAMP WITH TIME ZONE', 'UUID'].includes(type)) {
    const example = type === 'DATE' ? '2000-01-01' : type.startsWith('TIME') && !type.startsWith('TIMESTAMP') ?
      '00:00:00' : type === 'UUID' ? '00000000-0000-0000-0000-000000000000' : '2000-01-01T00:00:00Z';
    return { type: 'string', cast: type, maxLength: 80, ordered: type !== 'UUID', prefix: false, example };
  }
  return null;
}

function aliasesFor(columns) {
  const reservedNames = new Set(columns.filter(name).map(value => value.toLowerCase())), used = new Set();
  return columns.map((source, index) => {
    let output = name(source) && !used.has(source.toLowerCase()) ? source : `column_${index + 1}`;
    if (output !== source) {
      let counter = 1;
      while (used.has(output.toLowerCase()) || reservedNames.has(output.toLowerCase())) output = `column_${index + 1}_${counter++}`;
    }
    used.add(output.toLowerCase());
    return { source, output };
  });
}

function bounded(value, low, high, code) {
  if (!Number.isInteger(value) || value < low || value > high) throw fault(code);
  return value;
}

/**
 * plan: {relationId, relationFingerprint, queryName, columns:[sourceName],
 * orderBy:[{column,direction:'asc'|'desc'}],
 * filters:[{column,name,operator:'eq'|'min'|'max'|'gt'|'lt'|'prefix'}],
 * maxRows?,maxBytes?,timeoutMs?}. This does not choose payment terms or run SQL.
 */
export function compileDuckdbQueryPlan({ profile, plan } = {}) {
  requireDuckdbCatalogProfile(profile);
  const allowed = ['relationId', 'relationFingerprint', 'queryName', 'columns', 'orderBy', 'filters',
    'maxRows', 'maxBytes', 'timeoutMs'];
  if (!record(plan) || Object.keys(plan).some(key => !allowed.includes(key))) throw fault('DUCKDB_QUERY_PLAN_INVALID');
  const relation = profile.catalog.relations.find(item => item.id === plan.relationId);
  if (!relation || plan.relationFingerprint !== relation.fingerprint) throw fault('SOURCE_SCHEMA_CHANGED');
  if (relation.unavailable || !relation.columns.length) throw fault('CATALOG_RELATION_UNAVAILABLE');
  if (!name(plan.queryName)) throw fault('INVALID_QUERY_NAME');
  const columns = new Map(relation.columns.map(item => [item.name, item]));
  if (!Array.isArray(plan.columns) || !plan.columns.length || plan.columns.length > 64 ||
      new Set(plan.columns).size !== plan.columns.length || plan.columns.some(value => !columns.has(value)))
    throw fault('SELECT_1_TO_64_PUBLIC_COLUMNS');
  const orderBy = plan.orderBy;
  if (!Array.isArray(orderBy) || orderBy.length < 1 || orderBy.length > 4 ||
      new Set(orderBy.map(item => item?.column)).size !== orderBy.length ||
      orderBy.some(item => !record(item) || Object.keys(item).some(key => !['column', 'direction'].includes(key)) ||
        !columns.has(item.column) || !duckdbColumnParameter(columns.get(item.column)) ||
        !['asc', 'desc'].includes(item.direction ?? 'asc'))) throw fault('SELECT_1_TO_4_SCALAR_ORDER_COLUMNS');
  const filters = plan.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 32) throw fault('TOO_MANY_FILTERS');
  const parameters = Object.create(null), parameterDescriptions = Object.create(null), predicates = [], filterReview = [];
  const parameterNames = new Set();
  for (const filter of filters) {
    const definition = columns.get(filter?.column), type = definition && duckdbColumnParameter(definition);
    if (!record(filter) || Object.keys(filter).some(key => !['column', 'name', 'operator'].includes(key)) ||
        !type || !name(filter.name) || parameterNames.has(filter.name.toLowerCase()) ||
        !['eq', 'min', 'max', 'gt', 'lt', 'prefix'].includes(filter.operator)) throw fault('INVALID_FILTER');
    if (['min', 'max', 'gt', 'lt'].includes(filter.operator) && !type.ordered || filter.operator === 'prefix' && !type.prefix)
      throw fault('FILTER_TYPE_NOT_SUPPORTED');
    parameterNames.add(filter.name.toLowerCase());
    parameters[filter.name] = { type: type.type, nullable: true, default: null,
      ...(type.maxLength ? { maxLength: type.maxLength } : {}) };
    const value = `CAST($${filter.name} AS ${type.cast})`, reference = columnReference(filter.column);
    const operation = filter.operator === 'prefix' ? `starts_with(CAST(${reference} AS VARCHAR), ${value})` :
      `${reference} ${{ eq: '=', min: '>=', max: '<=', gt: '>', lt: '<' }[filter.operator]} ${value}`;
    predicates.push(`(${value} IS NULL OR ${operation})`);
    const publicLabel = filter.column.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300);
    parameterDescriptions[filter.name] = `${{ eq: 'Equals', min: 'At least', max: 'At most', gt: 'Greater than',
      lt: 'Less than', prefix: 'Starts with' }[filter.operator]} ${publicLabel}; omit to leave unrestricted.`;
    filterReview.push({ ...filter, inputType: type.type, databaseType: definition.type, optional: true,
      formatExample: type.example });
  }
  const mapping = aliasesFor(plan.columns), locator = profile.locators[relation.id];
  const from = locator.kind === 'parquet' ? `read_parquet(${literal(locator.file)})` :
    `${quote(locator.namespace)}.${quote(locator.name)}`;
  const query = { sql: `SELECT ${mapping.map(item => `${columnReference(item.source)} AS ${quote(item.output)}`).join(', ')}\n` +
    `FROM ${from} AS sf30_workbench\n` + (predicates.length ? `WHERE ${predicates.join('\n  AND ')}\n` : '') +
    `ORDER BY ${orderBy.map(item => `${columnReference(item.column)} ${(item.direction ?? 'asc').toUpperCase()}`).join(', ')}`,
    parameters, columns: mapping.map(item => item.output),
    maxRows: bounded(plan.maxRows ?? 100, 1, 1000, 'INVALID_MAX_ROWS'),
    maxBytes: bounded(plan.maxBytes ?? 524288, 1024, 917504, 'INVALID_MAX_BYTES'),
    timeoutMs: bounded(plan.timeoutMs ?? 5000, 50, 30000, 'INVALID_QUERY_TIMEOUT') };
  const compiled = compileQueries({ [plan.queryName]: query })[plan.queryName];
  // Explicitly selected authoring replaces the starter query list. The native
  // merchant compiler adds its own exact bindings from the separate public plan.
  const sourceConfig = { ...structuredClone(profile.sourceConfig), queries: { [plan.queryName]: compiled } };
  delete sourceConfig.bindings;
  const review = { schema: 'stellar-forge.duckdb-query-authoring.v1', sourceSha256: profile.sourceSha256,
    relationId: relation.id, relationFingerprint: relation.fingerprint,
    relation: { kind: relation.kind, namespace: relation.namespace, name: relation.name },
    queryName: plan.queryName, columns: mapping.map(item => ({ ...item, type: columns.get(item.source).type })),
    filters: filterReview, orderBy: orderBy.map(item => ({ column: item.column, direction: item.direction ?? 'asc' })),
    maxRows: query.maxRows, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs,
    datasetFiles: profile.catalog.source.approvedFileCount, datasetBytes: profile.catalog.source.totalBytes };
  return { queryName: plan.queryName, query: compiled, columnMapping: mapping, parameterDescriptions,
    example: {}, sourceConfig, review, planId: digest({ sourceSha256: profile.sourceSha256, plan, query: compiled }) };
}
