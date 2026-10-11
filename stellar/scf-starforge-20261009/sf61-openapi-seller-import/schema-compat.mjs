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
  for (const name of ['readOnly', 'writeOnly', 'deprecated'])
    if (own(schema, name) && typeof schema[name] !== 'boolean')
      throw new TypeError('OpenAPI 3.0 ' + name + ' must be boolean');
  if (schema.readOnly === true && schema.writeOnly === true)
    throw new TypeError('OpenAPI 3.0 property cannot be both readOnly and writeOnly');
  const converted = structuredClone(schema);
  // OAS 3.0 uses the ECMA-262 5.1 pattern dialect. Escaping non-syntax
  // punctuation (for example \! in PayPal's published schema) is an identity
  // escape there, but invalid in a Unicode pattern. Preserve its literal value.
  if (typeof converted.pattern === 'string')
    converted.pattern = converted.pattern.replace(/\\([\s\S])/g, (escape, character) =>
      /[A-Za-z0-9^$\\.*+?()[\]{}|/\-]/.test(character) ? escape : character);
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

/** OAS 3.1 discriminator is a serialization hint, not a JSON Schema assertion.
 * Keep every composition and assertion; remove only this OpenAPI annotation.
 * https://spec.openapis.org/oas/v3.1.1.html#discriminator-object
 * As with the 3.0 adapter, callers own traversal and never visit example data.
 */
export function adaptOpenApi31Schema(schema) {
  const converted = structuredClone(schema);
  if (!own(schema, 'discriminator')) return converted;
  const hint = schema.discriminator;
  if (!hint || typeof hint !== 'object' || Array.isArray(hint) ||
      typeof hint.propertyName !== 'string' || !hint.propertyName ||
      Object.keys(hint).some(key => !['propertyName', 'mapping'].includes(key) && !key.startsWith('x-')) ||
      !['oneOf', 'anyOf', 'allOf'].some(key => Array.isArray(schema[key]) && schema[key].length))
    throw new TypeError('OpenAPI discriminator requires a propertyName and composition');
  if (own(hint, 'mapping') && (!hint.mapping || typeof hint.mapping !== 'object' || Array.isArray(hint.mapping) ||
      Object.values(hint.mapping).some(value => typeof value !== 'string')))
    throw new TypeError('OpenAPI discriminator mapping must contain string references');
  delete converted.discriminator;
  return converted;
}

/** OAS 3.0 scopes a required readOnly property to responses and a required
 * writeOnly property to requests. Keep properties and annotations intact;
 * these annotations do not themselves forbid a supplied value. Call only
 * after resolving/traversing property schemas, never on example payloads.
 */
export function applyOpenApiDirection(schema, direction) {
  if (!['request', 'response'].includes(direction))
    throw new TypeError('OpenAPI schema direction must be request or response');
  if (Array.isArray(schema.required) && schema.properties) {
    const annotation = direction === 'request' ? 'readOnly' : 'writeOnly';
    schema.required = schema.required.filter(name => schema.properties[name]?.[annotation] !== true);
  }
  return schema;
}
