// MIT. One-node OpenAPI 3.0 Schema Object -> JSON Schema 2020-12 adaptation.
// The original importer owns traversal and reference resolution. Never recurse
// into example/default/enum payloads: those are customer data, not schemas.
const own = (value, key) => Object.hasOwn(value, key);
const types = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);
const fields = new Set([
  'title', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems',
  'maxProperties', 'minProperties', 'required', 'enum', 'type', 'allOf', 'oneOf',
  'anyOf', 'not', 'items', 'properties', 'additionalProperties', 'description',
  'format', 'default', 'nullable', 'discriminator', 'readOnly', 'writeOnly',
  'xml', 'externalDocs', 'example', 'deprecated',
]);

/** Convert ONLY a resolved schema node. Unchanged assertion keywords remain
 * subject to the original SF25 validator; conversion never removes them merely
 * to make the import succeed. This is not a generic OpenAPI document converter.
 */
export function adaptOpenApi30Schema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new TypeError('OpenAPI 3.0 Schema Object required');
  for (const name of Object.keys(schema)) {
    if (!fields.has(name) && !name.startsWith('x-'))
      throw new TypeError('Unsupported OpenAPI 3.0 schema field: ' + name);
  }
  if (own(schema, 'type') && !types.has(schema.type))
    throw new TypeError('OpenAPI 3.0 type must be one non-null type');
  if (own(schema, 'nullable') && typeof schema.nullable !== 'boolean')
    throw new TypeError('OpenAPI 3.0 nullable must be boolean');
  const converted = structuredClone(schema);
  // OAS 3.0.4: nullable changes only an explicitly declared type on THIS node.
  // enum and composition retain their restrictions, even when null is in type.
  if (schema.nullable === true && own(schema, 'type'))
    converted.type = [schema.type, 'null'];
  delete converted.nullable;
  for (const [exclusive, inclusive] of [
    ['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum'],
  ]) {
    if (!own(schema, exclusive)) continue;
    if (typeof schema[exclusive] !== 'boolean')
      throw new TypeError('OpenAPI 3.0 ' + exclusive + ' must be boolean');
    delete converted[exclusive];
    if (schema[exclusive]) {
      if (typeof schema[inclusive] !== 'number' || !Number.isFinite(schema[inclusive]))
        throw new TypeError(exclusive + ' requires a finite ' + inclusive);
      converted[exclusive] = schema[inclusive];
      delete converted[inclusive];
    }
  }
  return converted;
}
