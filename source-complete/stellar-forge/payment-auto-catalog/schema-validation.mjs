/**
 * SF-25: v2 PaymentPayload Bazaar extension -> trusted SF-46 catalog commit.
 * Source pin: x402-foundation/x402@7f2b2f1f77fa5317615735e3378a6fad41cccb4e
 * Bazaar spec blob: 442708e76d5a129e0c1393471d8ed71e3604c94e
 * Facilitator extractor blob: 083013ee19544e182c2e3185d7853309c34b9d9c
 */
import { compileSchemaPattern } from './schema-pattern.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
// One budget covers all alternatives and recursive instance descent in a validation.
const MAX_SCHEMA_EVALUATIONS = 100_000;
const SCHEMA_KEYS = new Set([
  '$schema', '$id', '$ref', '$defs', 'definitions', 'type', 'properties', 'required',
  'additionalProperties', 'items', 'const', 'enum', 'anyOf', 'allOf', 'oneOf', 'not', 'propertyNames',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems',
  'uniqueItems', 'title', 'description', 'default', 'examples',
  'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format', 'readOnly', 'writeOnly', 'deprecated', '$comment',
]);
const TYPES = {
  object: plain,
  array: Array.isArray,
  string: value => typeof value === 'string',
  number: value => typeof value === 'number' && Number.isFinite(value),
  integer: value => Number.isSafeInteger(value),
  boolean: value => typeof value === 'boolean',
  null: value => value === null,
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

function inspectSchema(schema, depth = 0, state = { nodes: 0, schemas: new WeakSet(), references: [] }) {
  state.nodes += 1;
  if (state.nodes > 512 || depth > 16) return 'SCHEMA_COMPLEXITY_LIMIT';
  if (schema === true || schema === false) return null;
  if (!plain(schema)) return 'SCHEMA_NODE_INVALID';
  if (state.schemas.has(schema)) return null;
  state.schemas.add(schema);
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) return `SCHEMA_KEYWORD_UNSUPPORTED:${key}`;
    if ((key === '$ref' || key === '$id') && (typeof value !== 'string' || !value.startsWith('#'))) {
      return 'SCHEMA_EXTERNAL_REFERENCE';
    }
    if (key === '$ref') state.references.push(value);
    // A malformed assertion keyword cannot be treated as an absent assertion.
    // Network-supplied schemas must fail closed rather than over-admit info.
    if (key === 'type') {
      const types = Array.isArray(value) ? value : [value];
      if (!types.length || types.some(t => typeof t !== 'string' || !Object.hasOwn(TYPES, t)) ||
          new Set(types).size !== types.length) return 'SCHEMA_TYPE_INVALID';
    }
    if (['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key) &&
        (!Number.isSafeInteger(value) || value < 0)) return 'SCHEMA_' + key.toUpperCase() + '_INVALID';
    if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key) &&
        (typeof value !== 'number' || !Number.isFinite(value))) return 'SCHEMA_' + key.toUpperCase() + '_INVALID';
    if (key === 'uniqueItems' && typeof value !== 'boolean') return 'SCHEMA_UNIQUEITEMS_INVALID';
    if (key === 'required' && (!Array.isArray(value) ||
        value.some(k => typeof k !== 'string') || new Set(value).size !== value.length))
      return 'SCHEMA_REQUIRED_INVALID';
    if (key === 'enum' && (!Array.isArray(value) || value.length === 0))
      return 'SCHEMA_ENUM_INVALID';
    if (['title', 'description', 'format', '$comment'].includes(key) && typeof value !== 'string')
      return 'SCHEMA_' + key.toUpperCase() + '_INVALID';
    if (['readOnly', 'writeOnly', 'deprecated'].includes(key) && typeof value !== 'boolean')
      return 'SCHEMA_' + key.toUpperCase() + '_INVALID';
    if (key === 'pattern') {
      try { compileSchemaPattern(value); } catch (error) { return error.message; }
    }
    if (key === 'examples' && !Array.isArray(value)) return 'SCHEMA_EXAMPLES_INVALID';
    if (['properties', '$defs', 'definitions'].includes(key)) {
      if (!plain(value)) return `SCHEMA_${key.toUpperCase()}_INVALID`;
      for (const child of Object.values(value)) {
        const error = inspectSchema(child, depth + 1, state); if (error) return error;
      }
    } else if (['items', 'additionalProperties', 'not', 'propertyNames'].includes(key)) {
      if (!plain(value) && typeof value !== 'boolean')
        return 'SCHEMA_' + key.toUpperCase() + '_INVALID';
      const error = inspectSchema(value, depth + 1, state); if (error) return error;
    } else if (['anyOf', 'allOf', 'oneOf'].includes(key)) {
      if (!Array.isArray(value) || value.length === 0) return `SCHEMA_${key.toUpperCase()}_INVALID`;
      for (const child of value) {
        const error = inspectSchema(child, depth + 1, state); if (error) return error;
      }
    }
  }
  return null;
}

function resolvePointer(root, ref) {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) throw new TypeError('SCHEMA_LOCAL_REFERENCE_INVALID');
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!plain(node) || !Object.hasOwn(node, key)) throw new TypeError('SCHEMA_LOCAL_REFERENCE_MISSING');
    node = node[key];
  }
  return node;
}

function validateNode(value, schema, root, path = '$', refs = new Set(), depth = 0, evaluation = { nodes: 0 }) {
  if (++evaluation.nodes > MAX_SCHEMA_EVALUATIONS) throw new TypeError('SCHEMA_EVALUATION_LIMIT');
  if (depth > 512) throw new TypeError('SCHEMA_EVALUATION_DEPTH_LIMIT');
  if (schema === true) return [];
  if (schema === false) return [`${path}:false_schema`];
  if (!plain(schema)) throw new TypeError('SCHEMA_NODE_INVALID');
  if (schema.$ref !== undefined) {
    if (refs.has(schema.$ref)) throw new TypeError('SCHEMA_REFERENCE_CYCLE');
    const next = new Set(refs); next.add(schema.$ref);
    const errors = validateNode(value, resolvePointer(root, schema.$ref), root, path, next, depth + 1, evaluation);
    if (errors.length) return errors;
    // Draft 2020-12 applies adjacent keywords as well as the referenced schema.
    // Keep the reference stack local to its branch: a sibling can reuse it.
  }
  if (schema.const !== undefined && !equal(value, schema.const)) return [`${path}:const`];
  if (Array.isArray(schema.enum) && !schema.enum.some(item => equal(value, item))) return [`${path}:enum`];
  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some(type => TYPES[type]?.(value))) return [`${path}:type`];
  }
  for (const group of ['allOf', 'anyOf', 'oneOf']) {
    if (schema[group] !== undefined && !Array.isArray(schema[group])) return [`${path}:${group}_invalid`];
  }
  if (schema.allOf) {
    const errors = schema.allOf.flatMap(part => validateNode(value, part, root, path, refs, depth + 1, evaluation));
    if (errors.length) return errors;
  }
  if (schema.anyOf && !schema.anyOf.some(part => validateNode(value, part, root, path, refs, depth + 1, evaluation).length === 0)) return [`${path}:anyOf`];
  if (schema.oneOf && schema.oneOf.filter(part => validateNode(value, part, root, path, refs, depth + 1, evaluation).length === 0).length !== 1) return [`${path}:oneOf`];
  if (Object.hasOwn(schema, 'not')) {
    const errors = validateNode(value, schema.not, root, path, refs, depth + 1, evaluation);
    if (!errors.length) return [`${path}:not`];
  }
  if (typeof value === 'string' && schema.pattern !== undefined && !compileSchemaPattern(schema.pattern).test(value))
    return [`${path}:pattern`];
  if (typeof value === 'string' &&
      (Number.isSafeInteger(schema.minLength) || Number.isSafeInteger(schema.maxLength))) {
    // JSON Schema counts Unicode code points, not UTF-16 code units or graphemes.
    // Iterate without allocating a second array proportional to the string size.
    let length = 0;
    for (const character of value) length++;
    if (Number.isSafeInteger(schema.minLength) && length < schema.minLength) return [`${path}:minLength`];
    if (Number.isSafeInteger(schema.maxLength) && length > schema.maxLength) return [`${path}:maxLength`];
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return [`${path}:minimum`];
    if (typeof schema.maximum === 'number' && value > schema.maximum) return [`${path}:maximum`];
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return [`${path}:exclusiveMinimum`];
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return [`${path}:exclusiveMaximum`];
  }
  if (Array.isArray(value)) {
    if (Number.isSafeInteger(schema.minItems) && value.length < schema.minItems) return [`${path}:minItems`];
    if (Number.isSafeInteger(schema.maxItems) && value.length > schema.maxItems) return [`${path}:maxItems`];
    if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(canonical(item)))).size !== value.length) return [`${path}:uniqueItems`];
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index++) {
        const errors = validateNode(value[index], schema.items, root, `${path}[${index}]`, new Set(), depth + 1, evaluation); if (errors.length) return errors;
      }
    }
  }
  if (plain(value)) {
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string'))) return [`${path}:required_invalid`];
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return [`${path}.${key}:required`];
    const properties = plain(schema.properties) ? schema.properties : {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema, 'propertyNames')) {
        const errors = validateNode(key, schema.propertyNames, root, `${path}.${key}:propertyName`, new Set(), depth + 1, evaluation);
        if (errors.length) return errors;
      }
      if (Object.hasOwn(properties, key)) {
        const errors = validateNode(item, properties[key], root, `${path}.${key}`, new Set(), depth + 1, evaluation); if (errors.length) return errors;
      } else if (schema.additionalProperties === false) return [`${path}.${key}:additionalProperties`];
      else if (plain(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
        const errors = validateNode(item, schema.additionalProperties, root, `${path}.${key}`, new Set(), depth + 1, evaluation); if (errors.length) return errors;
      }
    }
  }
  return [];
}

export function validateBazaarExtension(extension) {
  if (!plain(extension?.info) || !plain(extension?.schema)) return { ok: false, reason: 'BAZAAR_EXTENSION_INVALID' };
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(extension.schema), 'utf8'); }
  catch { return { ok: false, reason: 'SCHEMA_NOT_SERIALIZABLE' }; }
  if (bytes > 32_768) return { ok: false, reason: 'SCHEMA_SIZE_LIMIT' };
  if (extension.schema.$schema !== DRAFT) return { ok: false, reason: 'SCHEMA_DRAFT_REQUIRED' };
  const state = { nodes: 0, schemas: new WeakSet(), references: [] };
  const inspection = inspectSchema(extension.schema, 0, state);
  if (inspection) return { ok: false, reason: inspection };
  try {
    // Check every referenced target, including alternatives not taken by this instance.
    // This follows schema nodes once, so finite recursive message definitions stay valid.
    const checked = new Set();
    for (let index = 0; index < state.references.length; index++) {
      const ref = state.references[index];
      if (checked.has(ref)) continue;
      checked.add(ref);
      const invalid = inspectSchema(resolvePointer(extension.schema, ref), 0, state);
      if (invalid) return { ok: false, reason: invalid };
    }
    const errors = validateNode(extension.info, extension.schema, extension.schema);
    return errors.length ? { ok: false, reason: 'INFO_SCHEMA_MISMATCH', errors } : { ok: true };
  } catch (error) {
    // Schema errors propagate through all combinators instead of becoming an instance mismatch.
    return { ok: false, reason: error.message };
  }
}

