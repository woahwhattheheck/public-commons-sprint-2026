// MIT. Fixed native aggregation pipelines; original SF30 scalar/decimal binding.
import { BSON } from 'mongodb';
import { compilePostgresQueries, bindPostgresParameters, QueryInputError } from '../postgres/declaration.mjs';
import { fields, record, fail } from './common.mjs';
export { QueryInputError };

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TYPES = new Set(['string', 'integer', 'decimal', 'number', 'boolean', 'objectId', 'date']);
const STAGES = new Set(['$match', '$project', '$set', '$addFields', '$unset', '$replaceRoot', '$replaceWith',
  '$group', '$sort', '$limit', '$skip', '$count', '$unwind', '$facet', '$bucket', '$bucketAuto',
  '$sortByCount', '$setWindowFields', '$densify', '$fill', '$geoNear', '$lookup', '$unionWith']);
const FORBIDDEN = new Set(['$out', '$merge', '$function', '$accumulator', '$where', '$changeStream', '$currentOp',
  '$collStats', '$indexStats', '$listSessions', '$listLocalSessions', '__proto__', 'constructor', 'prototype']);
const PARAM_FIELDS = ['type', 'nullable', 'default', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxScale', 'maxIntegerDigits'];

export function collectionName(value) {
  if (typeof value !== 'string' || !value.length || value.length > 120 || /[\x00-\x1f\x7f$]/.test(value) ||
      value.startsWith('system.') || value.startsWith('.') || value.endsWith('.')) fail('MONGODB_COLLECTION_NAME_INVALID');
  return value;
}
function extraScalar(value, spec, name) {
  if (value === null) return null;
  if (spec.type === 'objectId') {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) throw new QueryInputError(name, 'EXPECTED_OBJECT_ID');
    return new BSON.ObjectId(value);
  }
  if (spec.type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
      throw new QueryInputError(name, 'EXPECTED_UTC_ISO_DATE');
    return new Date(value);
  }
  if (spec.type === 'decimal') {
    try { return BSON.Decimal128.fromString(value); }
    catch { throw new QueryInputError(name, 'DECIMAL128_NOT_EXACTLY_REPRESENTABLE'); }
  }
  if (spec.type === 'integer') return BSON.Long.fromString(value);
  if (spec.type === 'number') return new BSON.Double(value);
  return value;
}
function sharedParameter(spec, name) {
  fields(spec, PARAM_FIELDS, 'MONGODB_PARAMETER_FIELD_UNKNOWN');
  if (!TYPES.has(spec.type)) fail('MONGODB_PARAMETER_TYPE_INVALID');
  if (!['objectId', 'date'].includes(spec.type)) return structuredClone(spec);
  if (['minimum', 'maximum', 'minLength', 'maxLength', 'maxScale', 'maxIntegerDigits'].some(key => Object.hasOwn(spec, key)))
    fail('MONGODB_TYPED_STRING_CONSTRAINT_INVALID');
  for (const value of [...(Object.hasOwn(spec, 'default') ? [spec.default] : []), ...(spec.enum ?? [])]) {
    if (value !== null) extraScalar(value, spec, name);
  }
  return { ...structuredClone(spec), type: 'string', minLength: 24, maxLength: 24 };
}
function validatePipeline(pipeline, parameters) {
  if (!Array.isArray(pipeline) || !pipeline.length || pipeline.length > 64) fail('MONGODB_PIPELINE_REQUIRES_1_TO_64_STAGES');
  const used = new Set(), namespaces = new Set();
  function visit(value, depth = 0) {
    if (depth > 32) fail('MONGODB_PIPELINE_TOO_DEEP');
    if (typeof value === 'string') {
      if (value.startsWith('$$sf30_')) {
        const name = value.slice(7).split('.')[0];
        if (!Object.hasOwn(parameters, name)) fail('MONGODB_UNDECLARED_PARAMETER');
        used.add(name);
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1));
    else if (record(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN.has(key)) fail('MONGODB_PIPELINE_READ_STAGES_REQUIRED');
        if (key === '$lookup') {
          if (!record(item) || typeof item.from !== 'string') fail('MONGODB_LOOKUP_FIXED_COLLECTION_REQUIRED');
          namespaces.add(collectionName(item.from));
          if (item.pipeline) stages(item.pipeline);
        }
        if (key === '$unionWith') {
          const name = typeof item === 'string' ? item : item?.coll;
          namespaces.add(collectionName(name));
          if (record(item) && item.pipeline) stages(item.pipeline);
        }
        if (key === '$facet') {
          if (!record(item)) fail('MONGODB_FACET_INVALID');
          Object.values(item).forEach(stages);
        }
        visit(item, depth + 1);
      }
    } else if (value !== null && !['boolean', 'number'].includes(typeof value)) fail('MONGODB_PIPELINE_JSON_REQUIRED');
    else if (typeof value === 'number' && !Number.isFinite(value)) fail('MONGODB_PIPELINE_FINITE_NUMBER_REQUIRED');
    else if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))
      fail('MONGODB_LARGE_CONSTANT_REQUIRES_CANONICAL_EJSON');
  }
  function stages(items) {
    if (!Array.isArray(items) || items.length > 64) fail('MONGODB_NESTED_PIPELINE_INVALID');
    for (const stage of items) if (!record(stage) || Object.keys(stage).length !== 1 || !STAGES.has(Object.keys(stage)[0]))
      fail('MONGODB_PIPELINE_READ_STAGES_REQUIRED');
  }
  stages(pipeline); visit(pipeline);
  try { BSON.EJSON.deserialize(pipeline, { relaxed: false }); }
  catch { fail('MONGODB_PIPELINE_EJSON_INVALID'); }
  if (Object.keys(parameters).some(name => !used.has(name))) fail('MONGODB_PARAMETERS_MUST_MATCH_PIPELINE_VARIABLES');
  if (Buffer.byteLength(JSON.stringify(pipeline)) > 65536) fail('MONGODB_PIPELINE_TOO_LARGE');
  return [...namespaces].sort();
}

/** The surrogate only reuses the maintained SF30 scalar compiler, not SQL execution. */
export function mongoPublicQueries(queries) {
  if (!record(queries) || Object.keys(queries).length < 1 || Object.keys(queries).length > 64)
    fail('MONGODB_EXPECTED_NAMED_QUERIES');
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => {
    fields(query, ['collection', 'pipeline', 'parameters', 'columns', 'maxRows', 'maxBytes', 'timeoutMs', 'readConcern'],
      'MONGODB_QUERY_FIELD_UNKNOWN');
    if (!NAME.test(name) || !record(query.parameters ?? {})) fail('MONGODB_QUERY_INVALID');
    for (const parameter of Object.keys(query.parameters ?? {})) if (!/^[a-z][A-Za-z0-9_]{0,55}$/.test(parameter))
      fail('MONGODB_PARAMETER_NAME_INVALID');
    return [name, { sql: 'SELECT 1', parameters: Object.fromEntries(Object.entries(query.parameters ?? {}).map(([key, value]) =>
      [key, sharedParameter(value, key)])), columns: query.columns, maxRows: query.maxRows, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs }];
  }));
}
export function compileMongoQueries(queries) {
  const shared = compilePostgresQueries(mongoPublicQueries(queries));
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => {
    const collection = collectionName(query.collection), parameters = query.parameters ?? {};
    const referencedCollections = validatePipeline(query.pipeline, parameters);
    const concern = query.readConcern ?? 'snapshot';
    if (!['snapshot', 'majority', 'local'].includes(concern)) fail('MONGODB_READ_CONCERN_INVALID');
    const result = { ...shared[name], parameters: structuredClone(parameters), shared: shared[name], collection,
      referencedCollections, pipeline: structuredClone(query.pipeline), readConcern: concern };
    for (const [field, spec] of Object.entries(parameters)) {
      for (const value of [...(Object.hasOwn(spec, 'default') ? [spec.default] : []), ...(spec.enum ?? [])]) {
        if (value !== null) {
          const scalar = bindPostgresParameters({ ...shared[name], parameters: { [field]: shared[name].parameters[field] },
            parameterOrder: [field], scalarParameters: undefined }, { [field]: value })[0];
          extraScalar(scalar, spec, field);
        }
      }
    }
    return [name, result];
  }));
}
export function bindMongoParameters(query, input) {
  const values = bindPostgresParameters(query.shared, input);
  return Object.fromEntries(query.shared.parameterOrder.map((name, index) =>
    ['sf30_' + name, { $literal: extraScalar(values[index], query.parameters[name], name) }]));
}
export function describeMongoQueries(queries) {
  return Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, {
    parameters: structuredClone(query.parameters), parameterOrder: [...query.shared.parameterOrder],
    columns: [...query.columns], maxRows: query.maxRows, maxBytes: query.maxBytes, timeoutMs: query.timeoutMs,
    readConcern: query.readConcern, valueEncoding: 'mongodb-canonical-extended-json-v2',
  }]));
}
export function resultPipeline(query) {
  const projection = Object.fromEntries(query.columns.map(name => [name, 1]));
  if (!query.columns.includes('_id')) projection._id = 0;
  return [...BSON.EJSON.deserialize(query.pipeline, { relaxed: false }), { $project: projection }, { $limit: query.maxRows + 1 }];
}
