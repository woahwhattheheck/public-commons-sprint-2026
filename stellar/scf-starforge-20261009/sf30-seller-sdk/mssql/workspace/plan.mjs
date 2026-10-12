// MIT. Actual SQL Server metadata and explicit merchant choices -> original contracts.
import { createHash } from 'node:crypto';
import { record } from '../../sqlite/parameters.mjs';
import { compileMssqlQueries, quoteIdentifier } from '../declaration.mjs';
import { compileMssqlMerchantPlan } from '../prepare.mjs';

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
  const type=String(column.baseType??column.dataType??'').toLowerCase();
  const bits={tinyint:8,smallint:16,int:32,bigint:64}[type];
  if(bits){
    const unsigned=type==='tinyint',minimum=unsigned?'0':String(-(1n<<BigInt(bits-1)));
    const maximum=String((1n<<BigInt(unsigned?bits:bits-1))-1n);
    return{kind:'integer',spec:{type:'integer',minimum,maximum},ordered:true};
  }
  if(['decimal','numeric'].includes(type)){
    const precision=Number(column.numericPrecision),scale=Number(column.numericScale);
    if(!Number.isInteger(precision)||precision<1||precision>38||!Number.isInteger(scale)||scale<0||scale>precision)return null;
    const whole=precision-scale,maximum=(whole?'9'.repeat(whole):'0')+(scale?'.'+'9'.repeat(scale):'');
    return{kind:'exact decimal ('+precision+', '+scale+')',spec:{type:'decimal',
      maxScale:scale,maxIntegerDigits:whole,minimum:'-'+maximum,maximum},ordered:true};
  }
  if(['money','smallmoney'].includes(type)){
    const small=type==='smallmoney';
    return{kind:'exact currency (4 fractional digits)',spec:{type:'decimal',maxScale:4,
      maxIntegerDigits:small?6:15,minimum:small?'-214748.3648':'-922337203685477.5808',
      maximum:small?'214748.3647':'922337203685477.5807'},ordered:true};
  }
  if(['float','real'].includes(type))return{kind:'approximate number',spec:{type:'number'},ordered:true};
  if(type==='bit')return{kind:'boolean',spec:{type:'boolean'},ordered:true};
  if(['char','varchar','nchar','nvarchar'].includes(type)&&/^[A-Za-z0-9_]+$/.test(column.collation??''))
    return{kind:'text · '+column.collation,spec:{type:'string',maxLength:4096},
      collation:column.collation,ordered:true,prefix:true};
  if(['date','datetime','datetime2','datetimeoffset','smalldatetime','time','uniqueidentifier'].includes(type))
    return{kind:'exact database-rendered text',spec:{type:'string',maxLength:80},
      columnText:true,ordered:true,prefix:true};
  return null;
}

export function describeRelation(catalog, profileId) {
  if (catalog?.schema !== 'stellar-forge.mssql-catalog.v1' || typeof catalog.table !== 'string' ||
      !catalog.columns?.length || catalog.truncated) fail('MSSQL_TABLE_NOT_AVAILABLE');
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
    if (!endpoint.columns.includes(item.column) || !available.has(item.column) || !parameterType(available.get(item.column)) ||
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
    bindings.push('@' + filter.name + ' AS ' + quoteIdentifier(filter.name));
    if (own(filter, 'example')) examples[filter.name] = filter.example;
    else if (!filter.optional) fail('REQUIRED_FILTER_EXAMPLE_MISSING');
    descriptions[filter.name] = text(filter.description, 240, 'FILTER_DESCRIPTION_REQUIRED') +
      (type.columnText ? ' Compared as the exact database-rendered text using binary collation; date/time input is not reparsed.' : '') +
      (filter.operator === 'prefix' ? ' Literal prefix using the column collation; wildcard characters have no special meaning.' : '');
    const input = inputRef(filter.name), selected = type.columnText
      ? `CONVERT(nvarchar(80),${columnRef(column.name)},127) COLLATE Latin1_General_100_BIN2` : columnRef(column.name);
    const predicate = filter.operator === 'prefix' ? `CONVERT(nvarchar(max),${selected}) LIKE REPLACE(REPLACE(REPLACE(REPLACE(CONVERT(nvarchar(max),${input}),N'^',N'^^'),N'%',N'^%'),N'_',N'^_'),N'[',N'^[')+N'%' ESCAPE N'^'`
      : `${selected} ${comparisons[filter.operator]} ${input}`;
    predicates.push(filter.optional ? `(${input} IS NULL OR ${predicate})` : `(${predicate})`);
  }
  const query = {
    sql: 'SELECT ' + mapping.map(item => columnRef(item.source) + ' AS ' + quoteIdentifier(item.output)).join(', ') +
      '\nFROM ' + quoteIdentifier(relation.schemaName) + '.' + quoteIdentifier(relation.tableName) + ' AS sf30_source' +
      (bindings.length ? '\nCROSS JOIN (SELECT ' + bindings.join(', ') + ') AS sf30_input' : '') +
      (predicates.length ? '\nWHERE ' + predicates.join('\n  AND ') : ''),
    orderBy:endpoint.orderBy.map(item=>({column:mapping.find(column=>column.source===item.column).output,direction:item.direction})),
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

/** Generated SQL is still compiled by the original SQL Server declaration and seller. */
export function compileWorkspacePlan(input, relations, source) {
  fields(input, ['schema', 'releaseId', 'label', 'publicOrigin', 'payment', 'paymentOptions', 'endpoints']);
  if (input.schema !== 'stellar-forge.mssql-workspace-plan.v1') fail('WORKSPACE_PLAN_INVALID');
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
  compileMssqlQueries(queries);
  const plan = { schema: 'stellar-forge.mssql-merchant-plan.v1', publicOrigin: input.publicOrigin,
    ...(own(input, 'payment') ? { payment: input.payment } : {}),
    ...(own(input, 'paymentOptions') ? { paymentOptions: input.paymentOptions } : {}),
    routes: compiled.map(item => item.route) };
  const { service, bindings } = compileMssqlMerchantPlan(queries, plan);
  const declaration = { ...structuredClone(source), queries, bindings };
  return { source: declaration, plan, service, endpoints: compiled, choices: structuredClone(input) };
}
