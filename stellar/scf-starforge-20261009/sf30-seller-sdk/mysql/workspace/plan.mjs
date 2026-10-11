// MIT. Actual MySQL metadata and explicit merchant choices -> original contracts.
import { createHash } from 'node:crypto';
import { record } from '../../sqlite/parameters.mjs';
import { compileMysqlQueries, quoteIdentifier } from '../declaration.mjs';
import { compileMysqlMerchantPlan } from '../prepare.mjs';

export class WorkspaceInputError extends Error {
  constructor(code, status = 422) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new WorkspaceInputError(code, status); };
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fields(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('WORKSPACE_FIELDS_INVALID');
}
const own = (value, key) => Object.hasOwn(value, key);
const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value) && !value.startsWith('__sf30_');
const integer = (value, low, high, code) => {
  if (!Number.isInteger(value) || value < low || value > high) fail(code);
  return value;
};
const text = (value, maximum, code) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail(code);
  return value.trim();
};
const columnRef = name => 'sf30_source.' + quoteIdentifier(name);
const inputRef = name => 'sf30_input.' + quoteIdentifier(name);
const comparisons = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** Types describe the real server representation, including precision and collation. */
export function parameterType(column) {
  const type = column.dataType?.toLowerCase(), unsigned = /\bunsigned\b/i.test(column.columnType ?? '');
  const bits = { tinyint: 8, smallint: 16, mediumint: 24, int: 32, integer: 32, bigint: 64 }[type];
  if (bits) {
    const maximum = String((1n << BigInt(unsigned ? bits : bits - 1)) - 1n);
    const minimum = unsigned ? '0' : String(-(1n << BigInt(bits - 1)));
    if (bits === 64 && unsigned) return { kind: 'exact unsigned integer',
      spec: { type: 'decimal', minimum, maximum, maxScale: 0, maxIntegerDigits: 20 },
      binding: 'CAST(? AS DECIMAL(20,0))', ordered: true };
    return { kind: 'integer', spec: { type: 'integer', minimum, maximum }, binding: 'CAST(? AS SIGNED)', ordered: true };
  }
  if (['decimal', 'numeric'].includes(type)) {
    const precision = Number(column.numericPrecision), scale = Number(column.numericScale);
    if (!Number.isInteger(precision) || precision < 1 || precision > 65 || !Number.isInteger(scale) || scale < 0 || scale > Math.min(38, precision)) return null;
    const whole = precision - scale, maximum = (whole ? '9'.repeat(whole) : '0') + (scale ? '.' + '9'.repeat(scale) : '');
    return { kind: `exact decimal (${precision}, ${scale})`, spec: { type: 'decimal',
      maxScale: scale, maxIntegerDigits: whole, minimum: unsigned ? '0' : '-' + maximum, maximum },
    binding: `CAST(? AS DECIMAL(${precision},${scale}))`, ordered: true };
  }
  if (['float', 'double', 'real'].includes(type)) return { kind: 'approximate number',
    spec: { type: 'number', ...(unsigned ? { minimum: 0 } : {}) }, binding: '(? + 0e0)', ordered: true };
  if (type === 'year') return { kind: 'integer year', spec: { type: 'integer', minimum: '0', maximum: '2155' }, binding: 'CAST(? AS SIGNED)', ordered: true };
  if (['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'].includes(type) &&
      /^[A-Za-z0-9_]+$/.test(column.charset ?? '') && /^[A-Za-z0-9_]+$/.test(column.collation ?? ''))
    return { kind: 'text · ' + column.collation, spec: { type: 'string', maxLength: 4096 },
      binding: `CAST(? AS CHAR CHARACTER SET ${column.charset}) COLLATE ${column.collation}`, ordered: true, prefix: true };
  if (['date', 'datetime', 'timestamp', 'time'].includes(type)) return {
    kind: 'database date/time text', spec: { type: 'string', maxLength: 80 },
    binding: 'CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin', ordered: true, prefix: true,
    columnText: true };
  // JSON, binary, bit and spatial values remain available for original projection.
  return null;
}

export function describeRelation(catalog, profileId) {
  if (catalog?.schema !== 'stellar-forge.mysql-catalog.v1' || typeof catalog.table !== 'string' ||
      !catalog.columns?.length || catalog.truncated) fail('MYSQL_TABLE_NOT_AVAILABLE');
  return { ...catalog, profileId, fingerprint: fingerprint({ profileId, catalog }),
    columns: catalog.columns.map(column => ({ ...column, filterType: parameterType(column) })) };
}

function compileEndpoint(relation, endpoint) {
  fields(endpoint, ['id', 'table', 'fingerprint', 'columns', 'orderBy', 'filters', 'path', 'method',
    'serviceName', 'description', 'maxRows', 'maxBytes', 'timeoutMs']);
  if (!identifier(endpoint.id)) fail('ENDPOINT_ID_INVALID');
  if (endpoint.table !== relation.table || endpoint.fingerprint !== relation.fingerprint) fail('SOURCE_SCHEMA_CHANGED', 409);
  if (!['GET', 'POST'].includes(endpoint.method)) fail('ENDPOINT_METHOD_INVALID');
  const available = new Map(relation.columns.map(column => [column.name, column]));
  if (!Array.isArray(endpoint.columns) || !endpoint.columns.length || endpoint.columns.length > 64 ||
      new Set(endpoint.columns).size !== endpoint.columns.length || endpoint.columns.some(name => !available.has(name))) fail('SELECT_1_TO_64_COLUMNS');
  const reserved = new Set(endpoint.columns.filter(identifier)), used = new Set();
  const mapping = endpoint.columns.map((source, index) => {
    let output = source;
    if (!identifier(output)) {
      output = `column_${index + 1}`;
      while (reserved.has(output) || used.has(output)) output += '_';
    }
    used.add(output); return { source, output };
  });
  if (!Array.isArray(endpoint.orderBy) || !endpoint.orderBy.length || endpoint.orderBy.length > 4) fail('SELECT_1_TO_4_ORDER_COLUMNS');
  const ordered = new Set();
  const order = endpoint.orderBy.map(item => {
    fields(item, ['column', 'direction']);
    if (!available.has(item.column) || !parameterType(available.get(item.column)) ||
        ordered.has(item.column) || !['ASC', 'DESC'].includes(item.direction)) fail('ORDER_COLUMN_INVALID');
    ordered.add(item.column); return columnRef(item.column) + ' ' + item.direction;
  });
  const filters = endpoint.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 16) fail('AT_MOST_16_FILTERS');
  const parameters = Object.create(null), examples = {}, descriptions = {}, bindings = [], predicates = [];
  for (const filter of filters) {
    fields(filter, ['column', 'name', 'operator', 'optional', 'example', 'description']);
    const column = available.get(filter.column), type = column && parameterType(column);
    if (!type || !identifier(filter.name) || own(parameters, filter.name) || typeof filter.optional !== 'boolean' ||
        !(own(comparisons, filter.operator) || filter.operator === 'prefix' && type.prefix)) fail('FILTER_INVALID');
    const spec = { ...type.spec, ...(filter.optional ? { nullable: true, default: null } : {}) };
    parameters[filter.name] = spec;
    bindings.push(type.binding + ' AS ' + quoteIdentifier(filter.name));
    if (own(filter, 'example')) examples[filter.name] = filter.example;
    else if (!filter.optional) fail('REQUIRED_FILTER_EXAMPLE_MISSING');
    descriptions[filter.name] = text(filter.description, 240, 'FILTER_DESCRIPTION_REQUIRED') +
      (type.columnText ? ' Compared as exact UTC database text using binary collation; input is not parsed as a date.' : '') +
      (filter.operator === 'prefix' ? ' Literal prefix using the column collation; wildcard characters have no special meaning.' : '');
    const input = inputRef(filter.name), selected = type.columnText
      ? `CAST(${columnRef(column.name)} AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin` : columnRef(column.name);
    const predicate = filter.operator === 'prefix' ? `LEFT(${selected},CHAR_LENGTH(${input})) = ${input}`
      : `${selected} ${comparisons[filter.operator]} ${input}`;
    predicates.push(filter.optional ? `(${input} IS NULL OR ${predicate})` : `(${predicate})`);
  }
  const query = {
    sql: 'SELECT ' + mapping.map(item => columnRef(item.source) + ' AS ' + quoteIdentifier(item.output)).join(', ') +
      '\nFROM ' + quoteIdentifier(relation.table) + ' AS sf30_source' +
      (bindings.length ? '\nCROSS JOIN (SELECT ' + bindings.join(', ') + ') AS sf30_input' : '') +
      (predicates.length ? '\nWHERE ' + predicates.join('\n  AND ') : '') + '\nORDER BY ' + order.join(', '),
    parameters, parameterOrder: Object.keys(parameters), columns: mapping.map(item => item.output),
    maxRows: integer(endpoint.maxRows, 1, 1000, 'MAX_ROWS_INVALID'),
    maxBytes: integer(endpoint.maxBytes, 1024, 917504, 'MAX_BYTES_INVALID'),
    timeoutMs: integer(endpoint.timeoutMs, 50, 30000, 'QUERY_TIMEOUT_INVALID'),
  };
  const route = { id: endpoint.id, path: endpoint.path, method: endpoint.method, query: endpoint.id,
    serviceName: text(endpoint.serviceName, 32, 'SERVICE_NAME_REQUIRED'),
    description: text(endpoint.description, 2048, 'ENDPOINT_DESCRIPTION_REQUIRED'),
    example: examples, parameterDescriptions: descriptions };
  return { query, route, mapping, relation: { table: relation.table, fingerprint: relation.fingerprint,
    serverVersion: relation.serverVersion }, ordering: endpoint.orderBy };
}

/** Generated SQL is still compiled by the original MySQL declaration and seller. */
export function compileWorkspacePlan(input, relations, source) {
  fields(input, ['schema', 'releaseId', 'label', 'publicOrigin', 'payment', 'paymentOptions', 'endpoints']);
  if (input.schema !== 'stellar-forge.mysql-workspace-plan.v1') fail('WORKSPACE_PLAN_INVALID');
  if (!identifier(input.releaseId)) fail('RELEASE_ID_INVALID');
  text(input.label, 120, 'RELEASE_LABEL_REQUIRED');
  if (!Array.isArray(input.endpoints) || !input.endpoints.length || input.endpoints.length > 64 ||
      new Set(input.endpoints.map(endpoint => endpoint.id)).size !== input.endpoints.length) fail('SELECT_1_TO_64_UNIQUE_ENDPOINTS');
  const compiled = input.endpoints.map(endpoint => {
    const relation = relations.get(endpoint.table);
    if (!relation) fail('SOURCE_SCHEMA_CHANGED', 409);
    return compileEndpoint(relation, endpoint);
  });
  const queries = Object.fromEntries(compiled.map(item => [item.route.id, item.query]));
  compileMysqlQueries(queries);
  const plan = { schema: 'stellar-forge.mysql-merchant-plan.v1', publicOrigin: input.publicOrigin,
    ...(own(input, 'payment') ? { payment: input.payment } : {}),
    ...(own(input, 'paymentOptions') ? { paymentOptions: input.paymentOptions } : {}),
    routes: compiled.map(item => item.route) };
  const { service, bindings } = compileMysqlMerchantPlan(queries, plan);
  const declaration = { ...structuredClone(source), queries, bindings };
  return { source: declaration, plan, service, endpoints: compiled, choices: structuredClone(input) };
}
