// MIT. Fixed native read products share the original seller scalar contract.
import { record, compileParameterSchema, bindParameters, QueryInputError } from '../sqlite/parameters.mjs';
export { QueryInputError };
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const text = value => typeof value === 'string' && value.isWellFormed() && value.length > 0 && Buffer.byteLength(value) <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
const own = (value, key) => Object.hasOwn(value, key);
const limit = (value, min, max, name) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError('REDIS_LIMIT_INVALID:' + name);
  return value;
};

export function compileRedisQueries(input) {
  if (!record(input) || !Object.keys(input).length || Object.keys(input).length > 64)
    throw new TypeError('REDIS_NAMED_QUERIES_REQUIRED');
  const result = Object.create(null);
  for (const [name, raw] of Object.entries(input)) {
    if (!NAME.test(name) || !record(raw) || !['get', 'hash', 'sorted-set', 'stream', 'list', 'set'].includes(raw.kind) ||
        Object.keys(raw).some(key => !['kind', 'key', 'parameters', 'fields', 'columns', 'offset', 'after',
          'cursor', 'scanCount', 'maxRows', 'maxBytes', 'timeoutMs'].includes(key))) throw new TypeError('REDIS_QUERY_INVALID');
    const parameters = compileParameterSchema(raw.parameters, name), used = new Set();
    for (const spec of Object.values(parameters)) if (!['string', 'integer'].includes(spec.type) || spec.nullable)
      throw new TypeError('REDIS_NON_NULL_TEXT_OR_INTEGER_REQUIRED');
    let key;
    if (text(raw.key)) key = raw.key;
    else {
      if (!record(raw.key) || Object.keys(raw.key).some(k => !['prefix', 'parameter'].includes(k)) ||
          !text(raw.key.prefix) || !NAME.test(raw.key.parameter)) throw new TypeError('REDIS_KEY_INVALID');
      const spec = parameters[raw.key.parameter];
      if (!spec || spec.type !== 'string' || !Array.isArray(spec.enum) ||
          spec.enum.some(value => !text(value) || !text(raw.key.prefix + value)))
        throw new TypeError('REDIS_KEY_REQUIRES_DECLARED_ENUM');
      used.add(raw.key.parameter); key = { prefix: raw.key.prefix, parameter: raw.key.parameter };
    }
    const fieldMap = Object.create(null);
    if (['hash', 'stream'].includes(raw.kind)) {
      if (!record(raw.fields) || !Object.keys(raw.fields).length || Object.keys(raw.fields).length > 63)
        throw new TypeError('REDIS_PROJECTED_FIELDS_REQUIRED');
      for (const [column, field] of Object.entries(raw.fields)) {
        if (!NAME.test(column) || raw.kind === 'stream' && column === 'id' || !text(field))
          throw new TypeError('REDIS_PROJECTED_FIELD_INVALID');
        fieldMap[column] = field;
      }
      if (own(raw, 'columns')) throw new TypeError('REDIS_COLUMNS_COME_FROM_FIELDS');
    } else if (own(raw, 'fields')) throw new TypeError('REDIS_FIELDS_NOT_SUPPORTED');
    const defaults = { get: ['value'], 'sorted-set': ['member', 'score'], list: ['index', 'value'], set: ['member'] };
    const columns = defaults[raw.kind] ? raw.columns ?? defaults[raw.kind]
      : [...(raw.kind === 'stream' ? ['id'] : []), ...Object.keys(fieldMap)];
    const columnCount = defaults[raw.kind]?.length ?? Object.keys(fieldMap).length + (raw.kind === 'stream' ? 1 : 0);
    if (!Array.isArray(columns) || columns.some(column => !NAME.test(column)) ||
        new Set(columns).size !== columns.length || columns.length !== columnCount)
      throw new TypeError('REDIS_COLUMNS_INVALID');
    if (own(raw, 'offset')) {
      const spec = parameters[raw.offset];
      if (!['sorted-set', 'list'].includes(raw.kind) || !spec || spec.type !== 'integer' ||
          !own(spec, 'minimum') || BigInt(spec.minimum) < 0n ||
          !own(spec, 'maximum') || BigInt(spec.maximum) > 10000000n)
        throw new TypeError('REDIS_OFFSET_REQUIRES_BOUNDED_INTEGER');
      used.add(raw.offset);
    }
    if (own(raw, 'after')) {
      const spec = parameters[raw.after];
      if (raw.kind !== 'stream' || !spec || spec.type !== 'string' || (spec.maxLength ?? 4096) > 41)
        throw new TypeError('REDIS_AFTER_REQUIRES_STREAM_ID_TEXT');
      used.add(raw.after);
    }
    if (raw.kind === 'set') {
      const spec = parameters[raw.cursor];
      if (!NAME.test(raw.cursor) || !spec || spec.type !== 'string' ||
          (spec.maxLength ?? 4096) > 20 || used.has(raw.cursor))
        throw new TypeError('REDIS_CURSOR_REQUIRES_UINT64_TEXT');
      used.add(raw.cursor);
      if (own(spec, 'default')) redisScanCursor(spec.default, raw.cursor);
      for (const value of spec.enum ?? []) redisScanCursor(value, raw.cursor);
    } else if (own(raw, 'cursor') || own(raw, 'scanCount')) throw new TypeError('REDIS_SCAN_REQUIRES_SET');
    if (Object.keys(parameters).some(field => !used.has(field))) throw new TypeError('REDIS_UNUSED_PARAMETER');
    const maxRows = limit(raw.maxRows ?? (['get', 'hash'].includes(raw.kind) ? 1 : raw.kind === 'set' ? 1000 : 100), 1, 1000, 'maxRows');
    if (['get', 'hash'].includes(raw.kind) && maxRows !== 1) throw new TypeError('REDIS_LOOKUP_RETURNS_ONE_ROW');
    result[name] = { kind: raw.kind, key, fields: fieldMap, columns: [...columns], parameters,
      parameterOrder: Object.keys(parameters), ...(raw.offset ? { offset: raw.offset } : {}),
      ...(raw.after ? { after: raw.after } : {}),
      ...(raw.kind === 'set' ? { cursor: raw.cursor, scanCount: limit(raw.scanCount ?? Math.min(100, maxRows), 1, maxRows, 'scanCount') } : {}), maxRows,
      maxBytes: limit(raw.maxBytes ?? 524288, 1024, 917504, 'maxBytes'),
      timeoutMs: limit(raw.timeoutMs ?? 1500, 50, 30000, 'timeoutMs') };
    // Defaults and enum values already passed the shared scalar compiler.
    if (raw.after) {
      if (own(parameters[raw.after], 'default')) streamId(parameters[raw.after].default, raw.after);
      for (const value of parameters[raw.after].enum ?? []) streamId(value, raw.after);
    }
  }
  return result;
}

export function redisScanCursor(value, field) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n)
    throw new QueryInputError(field, 'EXPECTED_SCAN_CURSOR');
  return value;
}

function streamId(value, field) {
  if (value === '-') return value;
  const match = /^(0|[1-9]\d{0,19})-(0|[1-9]\d{0,19})$/.exec(value);
  if (!match || BigInt(match[1]) > 18446744073709551615n || BigInt(match[2]) > 18446744073709551615n)
    throw new QueryInputError(field, 'EXPECTED_STREAM_ID');
  return value;
}

export function bindRedisParameters(query, input) {
  const named = bindParameters(query, input);
  return query.parameterOrder.map(name => {
    const value = named['$' + name];
    if (typeof value === 'string' && !value.isWellFormed()) throw new QueryInputError(name, 'TEXT_NOT_WELL_FORMED');
    if (typeof value === 'string' && value.includes('\0')) throw new QueryInputError(name, 'TEXT_CONTAINS_NUL');
    if (query.after === name) streamId(value, name);
    if (query.cursor === name) redisScanCursor(value, name);
    return typeof value === 'bigint' ? String(value) : value;
  });
}

export function bindRedisQuery(query, input) {
  const values = bindRedisParameters(query, input);
  const named = Object.fromEntries(query.parameterOrder.map((name, index) => [name, values[index]]));
  return { key: typeof query.key === 'string' ? query.key : query.key.prefix + named[query.key.parameter],
    position: ['sorted-set', 'list'].includes(query.kind) ? String(named[query.offset] ?? '0')
      : query.kind === 'set' ? named[query.cursor] ?? '0' : named[query.after] ?? '-', values: named };
}

export function describeRedisQueries(queries) {
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, {
    kind: query.kind, parameters: structuredClone(query.parameters), parameterOrder: [...query.parameterOrder],
    columns: [...query.columns], maxRows: query.maxRows, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs,
    ...(query.offset ? { offset: query.offset } : {}), ...(query.after ? { after: query.after } : {}),
    ...(query.cursor ? { cursor: query.cursor, scanCount: query.scanCount } : {}),
  }]));
}
