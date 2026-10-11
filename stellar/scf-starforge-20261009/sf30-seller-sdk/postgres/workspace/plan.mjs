// MIT. Explicit operator choices -> fixed SQL and original SF30 seller metadata.
import { createHash } from 'node:crypto';

export class WorkspaceInputError extends Error {
  constructor(code) { super(code); this.name = 'WorkspaceInputError'; this.code = code; }
}
const fail = code => { throw new WorkspaceInputError(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value) &&
  !['constructor', 'prototype'].includes(value);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const reference = value => 'sf30_workspace_input.' + quote(value);
const integer = (value, low, high, label) => {
  if (!Number.isInteger(value) || value < low || value > high) fail(label);
  return value;
};

export function parameterType(column) {
  if (column.typeSchema !== 'pg_catalog') return null;
  if (['int2', 'int4', 'int8'].includes(column.typeName)) return { type: 'integer', cast: 'bigint', ordered: true };
  if (column.typeName === 'bool') return { type: 'boolean', cast: 'boolean', ordered: false };
  if (['float4', 'float8'].includes(column.typeName)) return { type: 'number', cast: 'double precision', ordered: true };
  if (column.typeName === 'numeric') return { type: 'string', cast: 'numeric', ordered: true, maxLength: 128 };
  if (['text', 'varchar', 'bpchar', 'name'].includes(column.typeName)) return { type: 'string', cast: 'text', ordered: false, prefix: true, maxLength: 1024 };
  if (['date', 'timestamp', 'timestamptz', 'time', 'timetz', 'uuid'].includes(column.typeName))
    return { type: 'string', cast: column.typeName, ordered: column.typeName !== 'uuid', maxLength: 80 };
  return null;
}

/** Metadata is freshly reloaded from PostgreSQL by the server before every export. */
export function compileMerchantPlan(relation, input) {
  if (relation?.schema !== 'stellar-forge.postgres-relation.v1' || !Array.isArray(relation.columns) || !record(input))
    fail('RELATION_AND_CHOICES_REQUIRED');
  if (input.fingerprint !== relation.fingerprint || input.relationId !== relation.id) fail('SOURCE_SCHEMA_CHANGED');
  if (!name(input.queryName)) fail('INVALID_QUERY_NAME');
  if (typeof input.routePath !== 'string' || !/^\/[A-Za-z0-9_/-]{1,120}$/.test(input.routePath) ||
      input.routePath.includes('//') || input.routePath.startsWith('/_seller/')) fail('INVALID_ROUTE_PATH');
  const columns = new Map(relation.columns.map(column => [column.name, column]));
  if (!Array.isArray(input.columns) || !input.columns.length || input.columns.length > 64 ||
      new Set(input.columns).size !== input.columns.length || input.columns.some(column => !columns.has(column))) fail('SELECT_1_TO_64_COLUMNS');
  // The canonical source's output projection uses ordinary identifiers. The
  // database identifiers can still be arbitrary: aliases provide stable API keys.
  const aliases = input.columns.map((column, index) => ({ source: column,
    output: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(column) && !['__proto__', 'constructor', 'prototype'].includes(column) ? column : `column_${index + 1}` }));
  if (new Set(aliases.map(item => item.output)).size !== aliases.length) fail('OUTPUT_COLUMN_ALIAS_COLLISION');
  if (!Array.isArray(input.orderBy) || !input.orderBy.length || input.orderBy.length > 4 ||
      new Set(input.orderBy).size !== input.orderBy.length || input.orderBy.some(column => !columns.has(column) || !parameterType(columns.get(column))))
    fail('SELECT_1_TO_4_SCALAR_ORDER_COLUMNS');
  const filters = input.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 16) fail('TOO_MANY_FILTERS');
  const parameters = [], predicates = [], usedNames = new Set();
  for (const filter of filters) {
    const column = columns.get(filter?.column), type = column && parameterType(column);
    if (!type || !name(filter.name) || usedNames.has(filter.name) || !['eq', 'min', 'max', 'prefix'].includes(filter.operator)) fail('INVALID_FILTER');
    if (['min', 'max'].includes(filter.operator) && !type.ordered || filter.operator === 'prefix' && !type.prefix) fail('FILTER_TYPE_NOT_SUPPORTED');
    usedNames.add(filter.name);
    const spec = { name: filter.name, type: type.type, nullable: true, default: null,
      ...(type.maxLength ? { maxLength: type.maxLength } : {}) };
    parameters.push(spec);
    const parameter = `$${parameters.length}::${type.cast}`;
    const expression = filter.operator === 'prefix' ? `pg_catalog.starts_with(${reference(filter.column)}::text, ${parameter})` :
      `${reference(filter.column)} ${filter.operator === 'eq' ? '=' : filter.operator === 'min' ? '>=' : '<='} ${parameter}`;
    predicates.push(`(${parameter} IS NULL OR ${expression})`);
  }
  const maxRows = integer(input.maxRows ?? 100, 1, 1000, 'INVALID_MAX_ROWS');
  const timeoutMs = integer(input.timeoutMs ?? 1500, 50, 10000, 'INVALID_QUERY_TIMEOUT');
  const maxBytes = integer(input.maxBytes ?? 524288, 1024, 917504, 'INVALID_MAX_BYTES');
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : `${relation.name} data query`;
  if (description.length > 512 || /[\x00-\x1f\x7f]/.test(description)) fail('DESCRIPTION_MUST_BE_PRINTABLE_512_CHARACTERS');
  const origin = input.publicOrigin ?? '';
  if (origin) {
    let url; try { url = new URL(origin); } catch { fail('INVALID_PUBLIC_ORIGIN'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        url.origin !== origin.replace(/\/$/, '')) fail('INVALID_PUBLIC_ORIGIN');
  }
  const payment = input.payment;
  if (!record(payment) || !['stellar:testnet', 'stellar:pubnet'].includes(payment.network) ||
      !/^[1-9][0-9]{0,38}$/.test(payment.amount ?? '') || BigInt(payment.amount) > 170141183460469231731687303715884105727n ||
      ![payment.asset, payment.payTo].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) fail('INVALID_PAYMENT_TERMS');
  const sql = `SELECT ${aliases.map(item => `${reference(item.source)} AS ${quote(item.output)}`).join(', ')}\n` +
    `FROM ${quote(relation.namespace)}.${quote(relation.name)} AS sf30_workspace_input\n` +
    (predicates.length ? `WHERE ${predicates.join('\n  AND ')}\n` : '') +
    `ORDER BY ${input.orderBy.map(reference).join(', ')}`;
  const queryParameters = parameters.map((parameter, index) => {
    const filter = filters[index], column = columns.get(filter.column);
    const example = parameter.type === 'boolean' ? true : parameter.type === 'number' ? 0 :
      ({ date: '2000-01-01', timestamp: '2000-01-01 00:00:00', timestamptz: '2000-01-01T00:00:00Z',
        time: '00:00:00', timetz: '00:00:00+00', uuid: '00000000-0000-0000-0000-000000000000',
        int2: '0', int4: '0', int8: '0', numeric: '0' })[column.typeName] ?? '';
    return { name: parameter.name, type: parameter.type === 'integer' ? 'string' : parameter.type,
      description: `${filter.operator} filter; omit to leave unrestricted`, required: false, example };
  });
  const seller = { schema: 'stellar-forge.seller-service.v1', ...(origin ? { publicOrigin: origin.replace(/\/$/, '') } : {}),
    routes: [{ id: input.queryName, path: input.routePath,
      definition: { method: 'GET', serviceName: input.queryName.slice(0, 32), description,
        tags: ['postgresql', 'data'], queryParameters,
        payment: { scheme: 'exact', network: payment.network, amount: payment.amount,
          asset: payment.asset, payTo: payment.payTo, maxTimeoutSeconds: 60 } },
      handler: input.queryName, admit: `${input.queryName}Admission` }] };
  const query = { sql, parameters, columns: aliases.map(item => item.output), maxRows, maxBytes, timeoutMs };
  const plan = { schema: 'stellar-forge.postgres-merchant-plan.v1', relationId: relation.id,
    relationFingerprint: relation.fingerprint, queryName: input.queryName,
    query, seller, columnMapping: aliases, source: { namespace: relation.namespace, name: relation.name } };
  return { ...plan, planId: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}
