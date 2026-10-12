// MIT. Query encoding shared by the original merchant compiler, admission and probes.
export const QUERY_SERIALIZATION_SCHEMA = 'stellar-forge.http-query.v1';
const scalarTypes = new Set(['string', 'integer', 'number', 'boolean']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(message); };
const integer = /^-?(?:0|[1-9][0-9]*)$/;
const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const MAX_ITEMS = 1024, MAX_QUERY = 8192;

function typeOf(schema, label) {
  if (!plain(schema)) fail(label + ' requires a declared schema');
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nonnull = types.filter(type => type !== 'null');
  if (types.length > 2 || new Set(types).size !== types.length || nonnull.length !== 1 ||
      ![...scalarTypes, 'array'].includes(nonnull[0]))
    fail(label + ' requires one scalar or array type, optionally nullable');
  return { type: nonnull[0], nullable: types.includes('null') };
}

/** Preserve nullable schema assertions; a query wire value has a concrete type. */
export function queryParameterShape(schema, label = 'Query parameter') {
  const shape = typeOf(schema, label);
  if (shape.type === 'array') {
    const item = typeOf(schema.items, label + ' item');
    if (!scalarTypes.has(item.type)) fail(label + ' requires scalar array items');
    return { ...shape, item };
  }
  return shape;
}

function scalarMatches(type, value) {
  return type === 'integer' ? Number.isSafeInteger(value) :
    type === 'number' ? typeof value === 'number' && Number.isFinite(value) :
    typeof value === type;
}

/** Validate native examples without removing enum, bounds or null from the schema. */
export function validateQueryParameter(schema, value, label = 'Query parameter') {
  const shape = queryParameterShape(schema, label);
  if (value === undefined) return shape;
  if (value === null) {
    if (!shape.nullable) fail(label + ' example is not nullable');
  } else if (shape.type === 'array') {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) fail(label + ' requires an array of at most 1024 items');
    for (const item of value) validateQueryParameter(schema.items, item, label + ' item');
  } else if (!scalarMatches(shape.type, value)) fail(label + ' example does not match its declared type');
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value)))
    fail(label + ' example is outside its declared enum');
  return shape;
}

function schemaProperties(schema) {
  if (schema === undefined) return {};
  if (!plain(schema) || schema.type !== 'object' || !plain(schema.properties))
    fail('Query parameters require the original object schema');
  return schema.properties;
}

/** Serialization lives beside Bazaar info/schema, never inside JSON Schema. */
export function validateQuerySerialization(schema, document) {
  const properties = schemaProperties(schema);
  if (document === undefined) return {};
  if (!plain(document) || document.schema !== QUERY_SERIALIZATION_SCHEMA ||
      Object.keys(document).some(key => !['schema', 'parameters'].includes(key)) || !plain(document.parameters))
    fail('Unsupported query serialization document');
  for (const [name, rule] of Object.entries(document.parameters)) {
    if (!name || unsafe.has(name) || !own(properties, name)) fail('Query serialization names an undeclared parameter');
    queryParameterShape(properties[name], name);
    if (!plain(rule) || Object.keys(rule).some(key => !['style', 'explode'].includes(key)) ||
        rule.style !== 'form' || typeof rule.explode !== 'boolean')
      fail(name + ' requires explicit form style and boolean explode');
  }
  return document.parameters;
}

function ruleFor(rules, name) { return rules[name] ?? { style: 'form', explode: true }; }
function wireScalar(value, shape, label) {
  if (value === null) fail(label + ' has no unambiguous null query encoding; select a concrete value or omit an optional parameter');
  if (!scalarMatches(shape.type, value)) fail(label + ' does not match its declared query type');
  return String(value);
}

/** Encode operator-selected values using the retained native form/explode rules. */
export function encodeQueryParameters(query, schema, document) {
  if (!plain(query) || Object.keys(query).length > 128) fail('Query values must be an object with at most 128 fields');
  const properties = schemaProperties(schema), rules = validateQuerySerialization(schema, document);
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (unsafe.has(name) || !own(properties, name)) fail('Query contains an undeclared parameter');
    const shape = queryParameterShape(properties[name], name);
    if (shape.type !== 'array') {
      result.append(name, wireScalar(value, shape, name));
      continue;
    }
    if (!Array.isArray(value) || !value.length || value.length > MAX_ITEMS)
      fail(name + ' needs 1–1024 query items; omit an optional empty selection explicitly');
    const values = value.map(item => wireScalar(item, shape.item, name + ' item'));
    if (ruleFor(rules, name).explode) {
      for (const item of values) result.append(name, item);
    } else {
      // The original upstream preserves decoded query pairs. A comma within an
      // item would become indistinguishable from the provider's list delimiter.
      if (values.some(item => item.includes(','))) fail(name + ' comma-delimited items cannot contain a comma');
      result.append(name, values.join(','));
    }
  }
  const encoded = result.toString();
  if (encoded.length > MAX_QUERY) fail('Encoded query exceeds 8 KiB');
  return encoded;
}

function parseScalar(value, shape) {
  if (typeof value !== 'string') fail('Query scalar must occur exactly once');
  if (shape.type === 'string') return value;
  if (shape.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  if (shape.type === 'integer' && integer.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (shape.type === 'number' && number.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  fail('Query value does not match its declared scalar type');
}

/** Decode actual HTTP values; the original SF25 validator applies all assertions. */
export function decodeQueryParameters(query, schema, document) {
  if (!plain(query) || Object.keys(query).length > 128) fail('Invalid actual query object');
  const properties = schemaProperties(schema), rules = validateQuerySerialization(schema, document);
  const result = Object.create(null);
  let size = 0;
  for (const [name, raw] of Object.entries(query)) {
    if (unsafe.has(name) || !own(properties, name)) fail('Actual query contains an undeclared parameter');
    const shape = queryParameterShape(properties[name], name);
    const parts = Array.isArray(raw) ? raw : [raw];
    if (parts.length > MAX_ITEMS || parts.some(value => typeof value !== 'string')) fail('Invalid actual query values');
    size += name.length + parts.reduce((sum, value) => sum + value.length, 0);
    if (size > MAX_QUERY) fail('Actual query exceeds its 8 KiB limit');
    if (shape.type !== 'array') result[name] = parseScalar(raw, shape);
    else {
      let values;
      if (ruleFor(rules, name).explode) values = parts;
      else {
        if (typeof raw !== 'string') fail('A comma-delimited query parameter must occur exactly once');
        values = raw.split(',');
      }
      if (!values.length || values.length > MAX_ITEMS) fail('Actual query array exceeds its item limit');
      result[name] = values.map(value => parseScalar(value, shape.item));
    }
  }
  return result;
}

/** Retain repeated keys when passing a native URL into the original admission API. */
export function queryFromSearchParams(parameters) {
  const result = Object.create(null);
  for (const [name, value] of parameters) {
    if (!own(result, name)) result[name] = value;
    else result[name] = Array.isArray(result[name]) ? [...result[name], value] : [result[name], value];
  }
  return result;
}
