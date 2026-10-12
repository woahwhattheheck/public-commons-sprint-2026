// MIT. Native OpenSearch query declarations reuse the original SF30 scalar contract.
import { compileParameterSchema, bindParameters, record, QueryInputError } from '../sqlite/parameters.mjs';
export { QueryInputError };
export const SOURCE_SCHEMA = 'stellar-forge.opensearch-source.v1';
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const INDEX = /^[a-z0-9.][a-z0-9._-]{0,254}$/;
const FIELD = /^[A-Za-z_@][A-Za-z0-9_@.-]{0,255}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export function fields(value, allowed, code) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(code);
}
export function bounded(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(code);
  return value;
}
function named(value) { return typeof value === 'string' && NAME.test(value) && !RESERVED.has(value); }
function field(value) {
  return typeof value === 'string' && FIELD.test(value) && value.split('.').every(part => part && !RESERVED.has(part));
}
function list(value, validator, maximum, code) {
  if (!Array.isArray(value) || !value.length || value.length > maximum ||
      value.some(item => !validator(item)) || new Set(value).size !== value.length) throw new TypeError(code);
  return [...value];
}
function template(value, parameters, used, depth = 0) {
  if (depth > 32) throw new TypeError('OPENSEARCH_TEMPLATE_DEPTH');
  if (Array.isArray(value)) return value.map(item => template(item, parameters, used, depth + 1));
  if (record(value)) {
    if (Object.hasOwn(value, '$param')) {
      if (Object.keys(value).length !== 1 || !named(value.$param) || !Object.hasOwn(parameters, value.$param))
        throw new TypeError('OPENSEARCH_TEMPLATE_PARAMETER_INVALID');
      used.add(value.$param);
      return { $param: value.$param };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (RESERVED.has(key) || key.length > 256) throw new TypeError('OPENSEARCH_TEMPLATE_KEY_INVALID');
      return [key, template(item, parameters, used, depth + 1)];
    }));
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  throw new TypeError('OPENSEARCH_TEMPLATE_VALUE_INVALID');
}
export function bindOpenSearchParameters(query, input) {
  const bound = bindParameters(query, input);
  return query.parameterOrder.map(name => {
    const value = bound['$' + name], spec = query.parameters[name];
    if (value === null) return null;
    if (spec.type === 'integer') return String(value);
    if (spec.type === 'boolean') return value === 1n;
    if (typeof value === 'string' && (value.includes('\0') || Buffer.from(value).toString('utf8') !== value))
      throw new QueryInputError(name, 'INVALID_TEXT');
    return value;
  });
}
export function compileOpenSearchQueries(raw) {
  if (!record(raw) || !Object.keys(raw).length || Object.keys(raw).length > 64)
    throw new TypeError('OPENSEARCH_NAMED_QUERIES_REQUIRED');
  const compiled = Object.create(null);
  for (const [name, value] of Object.entries(raw)) {
    if (!named(name)) throw new TypeError('OPENSEARCH_QUERY_NAME_INVALID');
    fields(value, ['indices', 'query', 'parameters', 'fields', 'sort', 'pageSize', 'maxHits', 'maxBytes', 'timeoutMs', 'probe'],
      'OPENSEARCH_QUERY_FIELDS_INVALID');
    for (const [parameter, spec] of Object.entries(value.parameters ?? {})) {
      if (!named(parameter)) throw new TypeError('OPENSEARCH_PARAMETER_NAME_INVALID');
      fields(spec, ['type', 'nullable', 'minimum', 'maximum', 'minLength', 'maxLength', 'enum', 'default'],
        'OPENSEARCH_PARAMETER_FIELDS_INVALID');
    }
    const parameters = compileParameterSchema(value.parameters, name);
    const used = new Set();
    if (!record(value.query)) throw new TypeError('OPENSEARCH_QUERY_OBJECT_REQUIRED');
    const query = template(value.query, parameters, used);
    if (used.size !== Object.keys(parameters).length) throw new TypeError('OPENSEARCH_UNUSED_PARAMETER');
    if (Buffer.byteLength(JSON.stringify(query)) > 131072) throw new RangeError('OPENSEARCH_TEMPLATE_TOO_LARGE');
    const indices = list(value.indices, item => typeof item === 'string' && INDEX.test(item) &&
      item !== '.' && item !== '..', 16, 'OPENSEARCH_EXPLICIT_INDICES_REQUIRED');
    const projected = list(value.fields, field, 128, 'OPENSEARCH_EXPLICIT_FIELDS_REQUIRED');
    const sort = value.sort ?? [];
    if (!Array.isArray(sort) || sort.length > 8) throw new TypeError('OPENSEARCH_SORT_INVALID');
    const sorted = new Set();
    for (const item of sort) {
      if (!record(item) || Object.keys(item).length !== 1) throw new TypeError('OPENSEARCH_SORT_INVALID');
      const [key, direction] = Object.entries(item)[0];
      if ((!field(key) && key !== '_score') || ['_index', '_shard_doc', '_id'].includes(key) ||
          !['asc', 'desc'].includes(direction) || sorted.has(key)) throw new TypeError('OPENSEARCH_SORT_INVALID');
      sorted.add(key);
    }
    const output = { indices, query, parameters, parameterOrder: Object.keys(parameters), fields: projected,
      sort: structuredClone(sort),
      pageSize: bounded(value.pageSize ?? 100, 1, 1000, 'OPENSEARCH_PAGE_SIZE_INVALID'),
      maxHits: bounded(value.maxHits ?? 1000, 1, 10000, 'OPENSEARCH_HIT_LIMIT_INVALID'),
      maxBytes: bounded(value.maxBytes ?? 917504, 1024, 917504, 'OPENSEARCH_BYTE_LIMIT_INVALID'),
      timeoutMs: bounded(value.timeoutMs ?? 15000, 100, 30000, 'OPENSEARCH_TIMEOUT_INVALID'),
      probe: structuredClone(value.probe ?? {}) };
    bindOpenSearchParameters(output, output.probe);
    compiled[name] = output;
  }
  return compiled;
}
export function describeOpenSearchQueries(compiled) {
  return Object.fromEntries(Object.entries(compiled).map(([name, query]) => [name, {
    parameters: structuredClone(query.parameters), parameterOrder: [...query.parameterOrder],
    indices: [...query.indices], fields: [...query.fields], sort: structuredClone(query.sort),
    pageSize: query.pageSize, maxHits: query.maxHits, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs,
    snapshot: 'point-in-time', tieBreakers: [{ _index: 'asc' }, { _shard_doc: 'asc' }],
  }]));
}
export function validateOpenSearchSource(raw) {
  fields(raw, ['schema', 'endpointEnv', 'auth', 'allowLocal', 'queries', 'bindings', 'maxInFlight'],
    'OPENSEARCH_SOURCE_FIELDS_INVALID');
  if (raw.schema !== SOURCE_SCHEMA || typeof raw.endpointEnv !== 'string' || !ENV.test(raw.endpointEnv) ||
      raw.allowLocal !== undefined && typeof raw.allowLocal !== 'boolean')
    throw new TypeError('OPENSEARCH_SOURCE_CONFIG_INVALID');
  if (!record(raw.auth) || !['none', 'basic', 'bearer'].includes(raw.auth.type))
    throw new TypeError('OPENSEARCH_AUTH_DECLARATION_REQUIRED');
  const authFields = raw.auth.type === 'basic' ? ['type', 'userEnv', 'passwordEnv'] :
    raw.auth.type === 'bearer' ? ['type', 'tokenEnv'] : ['type'];
  fields(raw.auth, authFields, 'OPENSEARCH_AUTH_FIELDS_INVALID');
  for (const key of authFields.filter(key => key !== 'type'))
    if (typeof raw.auth[key] !== 'string' || !ENV.test(raw.auth[key])) throw new TypeError('OPENSEARCH_AUTH_REFERENCE_INVALID');
  if (raw.bindings !== undefined && !record(raw.bindings)) throw new TypeError('OPENSEARCH_BINDINGS_INVALID');
  const config = structuredClone(raw);
  config.maxInFlight = bounded(raw.maxInFlight ?? 8, 1, 64, 'OPENSEARCH_CAPACITY_INVALID');
  compileOpenSearchQueries(config.queries);
  return config;
}
