import {invariant} from './source-json.mjs';

function reference(spec, ref) {
  invariant(ref.startsWith('#/'), 'EXTERNAL_SCHEMA_REFERENCE_UNSUPPORTED', {ref});
  const result = ref.slice(2).split('/').map(x => x.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value?.[key], spec);
  invariant(result !== undefined, 'SCHEMA_REFERENCE_MISSING', {ref});
  return result;
}

// Validates the request subset used by the retained provider schemas. It does
// not reinterpret a provider response or discard fields the provider added.
export function validateSchema(value, schema, spec, location = '$', depth = 0) {
  invariant(depth <= 100, 'SCHEMA_DEPTH_LIMIT');
  if (schema === true || schema === undefined) return;
  invariant(schema !== false, 'SCHEMA_VALUE_FORBIDDEN', {location});
  invariant(schema && typeof schema === 'object' && !Array.isArray(schema),
    'SCHEMA_DOCUMENT_INVALID', {location});
  if (schema.$ref) validateSchema(value, reference(spec, schema.$ref), spec, location, depth + 1);
  if (value === null && schema.nullable) return;
  const trySchema = candidate => {
    try { validateSchema(value, candidate, spec, location, depth + 1); return true; }
    catch (error) { if (error.code?.startsWith('SCHEMA_') &&
        !['SCHEMA_DOCUMENT_INVALID', 'SCHEMA_REFERENCE_MISSING', 'SCHEMA_DEPTH_LIMIT'].includes(error.code)) return false; throw error; }
  };
  if (schema.allOf) for (const candidate of schema.allOf)
    validateSchema(value, candidate, spec, location, depth + 1);
  if (schema.oneOf) invariant(schema.oneOf.filter(trySchema).length === 1,
    'SCHEMA_ONE_OF', {location});
  if (schema.anyOf) invariant(schema.anyOf.some(trySchema), 'SCHEMA_ANY_OF', {location});
  if (schema.enum) invariant(schema.enum.some(item => item === value), 'SCHEMA_ENUM', {location});
  if (Object.hasOwn(schema, 'const')) invariant(schema.const === value, 'SCHEMA_CONST', {location});
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    invariant(types.some(type => type === actual || type === 'integer' &&
      typeof value === 'number' && Number.isSafeInteger(value)), 'SCHEMA_TYPE', {location, types});
  }
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'SCHEMA_FINITE_NUMBER', {location});
    if (schema.minimum !== undefined) invariant(value >= schema.minimum, 'SCHEMA_MINIMUM', {location});
    if (schema.maximum !== undefined) invariant(value <= schema.maximum, 'SCHEMA_MAXIMUM', {location});
    if (schema.exclusiveMinimum !== undefined && schema.exclusiveMinimum !== false) invariant(value > (schema.exclusiveMinimum === true ? schema.minimum : schema.exclusiveMinimum),
      'SCHEMA_EXCLUSIVE_MINIMUM', {location});
    if (schema.exclusiveMaximum !== undefined && schema.exclusiveMaximum !== false) invariant(value < (schema.exclusiveMaximum === true ? schema.maximum : schema.exclusiveMaximum),
      'SCHEMA_EXCLUSIVE_MAXIMUM', {location});
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) invariant([...value].length >= schema.minLength,
      'SCHEMA_MIN_LENGTH', {location});
    if (schema.maxLength !== undefined) invariant([...value].length <= schema.maxLength,
      'SCHEMA_MAX_LENGTH', {location});
    if (schema.pattern) invariant(new RegExp(schema.pattern, 'u').test(value), 'SCHEMA_PATTERN', {location});
    if (schema.format === 'uuid') invariant(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
      'SCHEMA_UUID', {location});
    if (schema.format === 'date-time') invariant(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value) &&
      Number.isFinite(Date.parse(value)), 'SCHEMA_DATE_TIME', {location});
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) invariant(value.length >= schema.minItems, 'SCHEMA_MIN_ITEMS', {location});
    if (schema.maxItems !== undefined) invariant(value.length <= schema.maxItems, 'SCHEMA_MAX_ITEMS', {location});
    if (schema.items) value.forEach((item, index) =>
      validateSchema(item, schema.items, spec, location + '[' + index + ']', depth + 1));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? []) invariant(Object.hasOwn(value, key),
      'SCHEMA_REQUIRED', {location, field: key});
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) validateSchema(item, child, spec, location + '.' + key, depth + 1);
      else if (schema.additionalProperties === false) invariant(false, 'SCHEMA_UNKNOWN_PROPERTY', {location, field: key});
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        validateSchema(item, schema.additionalProperties, spec, location + '.' + key, depth + 1);
    }
  }
}

