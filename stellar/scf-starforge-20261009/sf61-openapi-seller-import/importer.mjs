// MIT. Offline OpenAPI 3.0/3.1 adapter for the original SF30 seller compiler.
import { createSellerDiscovery, makePaymentRequiredResponse } from '../sf30-seller-discovery/index.mjs';
import { adaptOpenApi30Schema, adaptOpenApi31Schema, applyOpenApiDirection } from './schema-compat.mjs';
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';
import { openApiRequestBody } from './request-body.mjs';
import { selectOpenApiResponseStream } from './response-stream.mjs';
import { QUERY_SERIALIZATION_SCHEMA, validateQueryParameter, validateQuerySerialization } from '../sf30-seller-sdk/query-parameters.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (o, k) => Object.hasOwn(o, k);
const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
const methods = new Set(['get', 'head', 'delete', 'post', 'put', 'patch']);
const clone = value => structuredClone(value);
const canonicalJson = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
function fail(message) { throw new TypeError(message); }
function object(value, name) { if (!plain(value)) fail(`${name} must be an object`); return value; }
function key(value) {
  if (typeof value !== 'string' || !value || badKeys.has(value) || /[\x00-\x1f\x7f]/.test(value)) fail('Invalid parameter name');
  return value;
}
function inspect(value, depth = 0, count = { n: 0 }) {
  if (++count.n > 50000 || depth > 48) fail('Input document exceeds supported complexity');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('Nonfinite JSON number');
  if (Array.isArray(value)) value.forEach(v => inspect(v, depth + 1, count));
  else if (plain(value)) for (const [k, v] of Object.entries(value)) {
    if (badKeys.has(k)) fail('Unsupported dictionary key: ' + k);
    inspect(v, depth + 1, count);
  }
}

// Resolve reference OBJECTS only. Examples are data and are never traversed.
function resolver(document, { direction = 'request' } = {}) {
  if (!['request', 'response'].includes(direction)) fail('OpenAPI schema direction must be request or response');
  const legacy = /^3\.0\./.test(document.openapi);
  let expanded = 0;
  const pointer = ref => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('Only document-local JSON Pointer references are supported');
    let text;
    try { text = decodeURIComponent(ref.slice(2)); } catch { fail('Invalid reference encoding'); }
    let value = document;
    for (const raw of text.split('/')) {
      if (/~(?![01])/.test(raw)) fail('Invalid JSON Pointer escape');
      const name = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (badKeys.has(name) || !value || !own(value, name)) fail('Unresolved local reference: ' + ref);
      value = value[name];
    }
    return object(value, 'Reference target');
  };
  const reference = (value, stack = []) => {
    object(value, 'OpenAPI object');
    if (!own(value, '$ref')) return value;
    if (stack.length >= 16 || stack.includes(value.$ref)) fail('Recursive reference is not supported');
    const extras = legacy ? [] : Object.keys(value).filter(k => k !== '$ref');
    if (extras.some(k => !['description', 'summary'].includes(k))) fail('Semantic $ref siblings are not supported');
    return { ...reference(pointer(value.$ref), [...stack, value.$ref]),
      ...Object.fromEntries(extras.map(k => [k, value[k]])) };
  };
  const schema = (value, stack = [], depth = 0) => {
    if (++expanded > 10000 || depth > 24) fail('Expanded schema exceeds supported complexity');
    object(value, 'Schema');
    if (own(value, '$ref')) {
      if (stack.includes(value.$ref)) fail('Recursive schema is not supported');
      const extras = legacy ? [] : Object.keys(value).filter(k => k !== '$ref');
      if (extras.some(k => !['description', 'title', '$comment'].includes(k))) fail('Semantic schema $ref siblings are not supported');
      return { ...schema(pointer(value.$ref), [...stack, value.$ref], depth + 1),
        ...Object.fromEntries(extras.map(k => [k, clone(value[k])])) };
    }
    if (['$id', '$dynamicRef', '$dynamicAnchor', '$anchor'].some(k => own(value, k))) fail('Schema resource and dynamic references are not supported');
    const result = legacy ? adaptOpenApi30Schema(value) : adaptOpenApi31Schema(value);
    if (own(result, 'example')) {
      if (!own(result, 'examples')) result.examples = [result.example];
      delete result.example;
    }
    for (const k of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) if (own(value, k)) {
      object(value[k], k);
      result[k] = Object.fromEntries(Object.entries(value[k]).map(([name, child]) => [name, schema(child, stack, depth + 1)]));
    }
    for (const k of ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'])
      if (plain(value[k])) result[k] = schema(value[k], stack, depth + 1);
    for (const k of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) if (own(value, k)) {
      if (!Array.isArray(value[k])) fail(k + ' must be an array');
      result[k] = value[k].map(child => schema(child, stack, depth + 1));
    }
    // OAS 3.1 retains JSON Schema required semantics. OAS 3.0 explicitly
    // scopes required readOnly/writeOnly properties to the relevant direction.
    return legacy ? applyOpenApiDirection(result, direction) : result;
  };
  return { reference, schema };
}

// The response compiler uses the same local-reference and 3.0 compatibility
// rules as request import instead of maintaining a second OpenAPI resolver.
export { resolver as createOpenApiResolver };

function declaredExample(value, reference) {
  if (own(value, 'example') && own(value, 'examples')) fail('example and examples are mutually exclusive here');
  if (own(value, 'example')) return { found: true, value: clone(value.example) };
  if (own(value, 'examples')) {
    object(value.examples, 'Examples');
    const first = Object.keys(value.examples).sort()[0];
    if (!first) fail('Examples must contain at least one inline value');
    const example = reference(value.examples[first]);
    if (own(example, 'externalValue') || !own(example, 'value')) fail('Example requires an inline value; no external examples are fetched');
    return { found: true, value: clone(example.value) };
  }
  return { found: false };
}
function sampleOf(schema) {
  if (own(schema, 'const')) return schema.const;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (own(schema, 'example')) return schema.example;
  if (own(schema, 'default')) return schema.default;
  return undefined;
}
function withExample(schema, sample) {
  if (!sample.found) return schema;
  if (own(schema, 'const') && canonicalJson(schema.const) !== canonicalJson(sample.value)) fail('Declared example conflicts with const');
  // SF30 prioritizes schema.examples over schema.example/default.
  return { ...schema, examples: [sample.value] };
}
function scalarParameter(schema, value, label) {
  const type = schema.type;
  if (!['string', 'integer', 'number', 'boolean'].includes(type)) fail(label + ' requires a scalar schema');
  if (value === undefined) return;
  const valid = type === 'integer' ? Number.isSafeInteger(value) :
    type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (!valid) fail(label + ' example does not match its scalar type');
  if (schema.enum && !schema.enum.includes(value)) fail(label + ' example is outside enum');
}

function makeOffer(document, selection, refs) {
  object(selection, 'Operation selection');
  const method = String(selection.method ?? '').toLowerCase();
  if (!methods.has(method)) fail('Select GET, HEAD, DELETE, POST, PUT or PATCH');
  const path = selection.path;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[?#\\\s]/.test(path)) fail('Invalid operation path');
  if (!own(document.paths, path)) fail('Selected path is absent: ' + path);
  const item = refs.reference(document.paths[path]);
  const operation = object(item[method], 'Selected operation');
  const security = operation.security ?? document.security ?? [];
  if (!Array.isArray(security) || security.some(s => !plain(s))) fail('Invalid security requirements');
  if (security.length && !security.some(s => Object.keys(s).length === 0)) fail('Operation requires additional authentication; automatic import does not remove it');
  const servers = operation.servers ?? item.servers ?? document.servers;
  const index = selection.serverIndex ?? 0;
  if (!Array.isArray(servers) || !Number.isSafeInteger(index) || index < 0 || !servers[index]) fail('Select a declared absolute server');
  const server = object(servers[index], 'Server');
  if (typeof server.url !== 'string' || /[{}]/.test(server.url)) fail('Server variables require an explicit expanded server in the source document');
  const base = new URL(server.url);
  if (base.search || base.hash || base.username || base.password || base.href !== server.url) fail('Server URL must be canonical with no query, fragment or credentials');

  const merged = new Map();
  for (const list of [item.parameters ?? [], operation.parameters ?? []]) {
    if (!Array.isArray(list)) fail('parameters must be an array');
    const seen = new Set();
    for (const raw of list) {
      const p = refs.reference(raw);
      key(p.name);
      const id = p.in + ':' + p.name;
      if (seen.has(id)) fail('Duplicate parameter: ' + id);
      seen.add(id); merged.set(id, p);
    }
  }
  let concretePath = path;
  const pathNames = [...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]);
  if (/[{}]/.test(path.replace(/\{[^{}]+\}/g, ''))) fail('Unbalanced path template');
  const properties = {}, required = [], pathProperties = {}, pathExamples = {}, querySerialization = {};
  for (const p of merged.values()) {
    if (!['query', 'path'].includes(p.in)) fail('Header and cookie parameters require a manual seller integration');
    if (p.content || !p.schema) fail('Parameter content encodings are not supported');
    if (p.allowReserved === true || p.allowEmptyValue === true) fail('Reserved or empty parameter serialization requires manual integration');
    if (p.style && p.style !== (p.in === 'query' ? 'form' : 'simple')) fail('Unsupported parameter style');
    if (p.explode !== undefined && typeof p.explode !== 'boolean') fail('Parameter explode must be boolean');
    if (p.in === 'path' && p.explode === true) fail('Nondefault path explode requires manual integration');
    let schema = withExample(refs.schema(p.schema), declaredExample(p, refs.reference));
    if (p.description !== undefined) schema.description = p.description;
    const value = sampleOf(schema);
    if (p.in === 'query') validateQueryParameter(schema, value, p.name);
    else scalarParameter(schema, value, p.name);
    if (p.in === 'path') {
      if (p.required !== true || !pathNames.includes(p.name) || value === undefined || String(value) === '') fail('Path parameter must be required and have a declared example: ' + p.name);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) fail('Path parameter name cannot be represented in Bazaar routeTemplate');
      if (String(value) === '.' || String(value) === '..') fail('Path example cannot be a dot segment');
      concretePath = concretePath.split('{' + p.name + '}').join(encodeURIComponent(String(value)));
      pathProperties[p.name] = schema;
      pathExamples[p.name] = value;
    } else {
      properties[p.name] = schema;
      querySerialization[p.name] = { style: 'form', explode: p.explode ?? true };
      if (p.required === true) required.push(p.name);
    }
  }
  if (/[{}]/.test(concretePath)) fail('Every path placeholder needs a declared path parameter');
  const prefix = base.pathname.replace(/\/$/, '');
  const url = new URL(base.origin + prefix + concretePath);
  if (url.pathname !== prefix + concretePath) fail('Path must not normalize or traverse the server base path');
  const input = { type: 'http', method: method.toUpperCase() };
  if (Object.keys(properties).length) input.querySchema = { type: 'object', properties, required, additionalProperties: false };
  const bodyMethod = ['post', 'put', 'patch'].includes(method);
  let requestBody;
  if (bodyMethod) {
    requestBody = openApiRequestBody(operation,refs);
    if (!requestBody) fail('Body-method requestBody declaration required');
    input.bodyType = requestBody.bodyType;
    input.bodySchema = withExample(requestBody.schema, declaredExample(requestBody.media, refs.reference));
  } else if (operation.requestBody !== undefined) fail('Request bodies on query methods require manual integration');
  const resource = { url: url.href };
  const stream = selectOpenApiResponseStream(operation, refs, selection.responseFormat);
  if (stream && method === 'head') fail('A HEAD response cannot carry a stream');
  if (stream) resource.mimeType = stream.mimeType;
  if (selection.serviceName !== undefined) resource.serviceName = selection.serviceName;
  if (operation.description || operation.summary) resource.description = operation.description || operation.summary;
  if (operation.tags !== undefined) resource.tags = clone(operation.tags);
  const routeTemplate = pathNames.length ? prefix + path.replace(/\{([^{}]+)\}/g, ':$1') : undefined;
  const seller = createSellerDiscovery({ resource, accepts: selection.accepts, input, routeTemplate });
  // The body remains a public example. Presence in an actual request follows
  // the original OpenAPI Request Body Object, independently of its properties.
  if (requestBody && !requestBody.required) {
    const schema = seller.extensions.bazaar.schema.properties.input;
    schema.required = schema.required.filter(name => name !== 'body');
  }
  // Canonical Bazaar dynamic-route contract: concrete pathParams accompany the
  // colon routeTemplate. Extend only the returned value, not SF30 source.
  if (pathNames.length) {
    seller.extensions.bazaar.info.input.pathParams = pathExamples;
    const inputSchema = seller.extensions.bazaar.schema.properties.input;
    inputSchema.properties.pathParams = { type: 'object', properties: pathProperties,
      required: Object.keys(pathProperties), additionalProperties: false };
    inputSchema.required.push('pathParams');
  }
  if (Object.keys(properties).length) {
    const serialization = { schema: QUERY_SERIALIZATION_SCHEMA, parameters: querySerialization };
    validateQuerySerialization(input.querySchema, serialization);
    seller.extensions.bazaar.querySerialization = serialization;
  }
  const validated = validateBazaarExtension(seller.extensions.bazaar);
  if (!validated.ok) fail('Original SF25 schema acceptance rejected metadata: ' + JSON.stringify(validated));
  const response = makePaymentRequiredResponse(seller);
  if (response.headers['PAYMENT-REQUIRED'].length > 32768) fail('402 metadata exceeds the shipped SF31 buyer header limit');
  return { operationId: operation.operationId ?? null, method: input.method, path,
    sourcePointer: '#/paths/' + path.replace(/~/g, '~0').replace(/\//g, '~1') + '/' + method,
    serverIndex: index, seller, response };
}

/** Compile explicitly selected routes. Does not fetch, sign, charge or register. */
export function importOpenApi(document, selections) {
  object(document, 'OpenAPI document'); inspect(document); inspect(selections);
  if (typeof document.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(document.openapi)) fail('Only OpenAPI 3.0 or 3.1 documents are supported');
  object(document.paths, 'paths');
  if (!Array.isArray(selections) || !selections.length || selections.length > 100) fail('Select 1–100 operations explicitly');
  const seen = new Set();
  const refs = resolver(document);
  const offers = selections.map(selection => {
    const id = String(selection?.method).toUpperCase() + ' ' + selection?.path;
    if (seen.has(id)) fail('Duplicate selected operation: ' + id);
    seen.add(id);
    try { return makeOffer(document, selection, refs); }
    catch (error) { throw new TypeError(id + ': ' + error.message, { cause: error }); }
  });
  return { schema: 'stellar.open-api-seller-import.v1', openapiVersion: document.openapi,
    title: document.info?.title ?? null, offers,
    paymentsInitiated: 0, resourcesRegistered: 0 };
}

