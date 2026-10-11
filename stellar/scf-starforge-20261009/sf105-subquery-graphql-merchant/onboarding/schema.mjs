// MIT. Actual GraphQL reference schema/operation validation, original SF30 transport.
import { buildClientSchema, buildASTSchema, getIntrospectionQuery,
  getNullableType, getVariableValues, isObjectType, isNonNullType, Kind, parse, print,
  printSchema, typeFromAST, validate, validateSchema, visit } from 'graphql';
import { compileUpstreamBindings, createUpstreamHandlers } from '../../sf30-seller-sdk/upstream.mjs';
import { compileSubQueryMerchant, bindSubQueryVariables } from '../adapter.mjs';
import { decode, digest, fail, fields, jsonBytes, own, parseJson, readBytes, record, writeBundle } from './files.mjs';

const CAPTURE = 'stellar-forge.subquery-schema-capture.v1';
const ENDPOINT = 'stellar-forge.subquery-schema-endpoint.v1';
const HASH = /^[a-f0-9]{64}$/;
const MAX_SCHEMA = 1048576;

/** Accept the SERVED query schema, not an indexer's entity-only SDL. */
export function compileSchemaSource(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : jsonBytes(input);
  if (!bytes.length || bytes.length > MAX_SCHEMA) fail('SCHEMA_SIZE', 'Schema input must be 1 byte–1 MiB');
  let value = input, format = 'sdl', provenance = { kind: 'SUPPLIED_SCHEMA' };
  if (typeof input === 'string' && input.trimStart().startsWith('{')) value = parseJson(bytes);
  let schema;
  if (record(value)) {
    if (value.schema === CAPTURE) {
      fields(value, ['schema', 'capturedAt', 'source', 'introspection'], 'Schema capture');
      fields(value.source, ['origin', 'path', 'requestSha256', 'responseSha256', 'responseBytes', 'introspectionSha256'], 'Capture source');
      if (!Number.isFinite(Date.parse(value.capturedAt)) ||
          !HASH.test(value.source.requestSha256) || !HASH.test(value.source.responseSha256) ||
          !Number.isSafeInteger(value.source.responseBytes) || value.source.responseBytes < 1 || value.source.responseBytes > MAX_SCHEMA ||
          value.source.introspectionSha256 !== digest(jsonBytes(value.introspection)))
        fail('CAPTURE_IDENTITY', 'Schema capture source identity is invalid');
      endpointBindings({ schema: ENDPOINT, origin: value.source.origin, path: value.source.path });
      provenance = { kind: 'CAPTURED_SCHEMA', capturedAt: value.capturedAt, ...value.source };
      value = value.introspection; format = 'capture';
    } else format = 'introspection';
    if (own(value, 'errors')) fail('SCHEMA_ERRORS', 'Introspection contains GraphQL errors; capture a complete successful schema');
    if (own(value, 'data')) value = value.data;
    if (!record(value) || !record(value.__schema)) fail('SCHEMA_SHAPE', 'Expected a GraphQL introspection data object');
    try { schema = buildClientSchema(value); }
    catch { fail('SCHEMA_INVALID', 'Introspection is incomplete or invalid for the GraphQL reference schema builder'); }
  } else {
    if (typeof value !== 'string') fail('SCHEMA_SHAPE', 'Supply served SDL text or an introspection object');
    try { schema = buildASTSchema(parse(value, { maxTokens: 100000 })); }
    catch { fail('SCHEMA_INVALID', 'Supply the served query-service SDL or introspection. Indexer @entity/@derivedFrom definitions alone are not the API schema'); }
  }
  if (!schema.getQueryType()) fail('SCHEMA_QUERY_ROOT', 'The served query schema requires a Query root; capture the running query service, not entity-only indexer SDL');
  if (validateSchema(schema).length) fail('SCHEMA_INVALID', 'The GraphQL reference schema validator rejected this schema');
  return { schema, format, sourceSha256: digest(bytes), sourceBytes: bytes,
    schemaSha256: digest(Buffer.from(printSchema(schema))), provenance };
}

export async function readSchemaSource(filename) {
  const bytes = await readBytes(filename, MAX_SCHEMA);
  return { ...compileSchemaSource(decode(bytes)), sourceBytes: bytes, sourceSha256: digest(bytes) };
}

/** An operator inventory, using actual argument/type names from the source. */
export function inspectSchema(compiled) {
  const argument = value => ({ name: value.name, type: String(value.type),
    description: value.description ?? null, required: isNonNullType(value.type) && value.defaultValue === undefined,
    hasDefault: value.defaultValue !== undefined });
  const field = value => ({ name: value.name, type: String(value.type), description: value.description ?? null,
    deprecated: Boolean(value.deprecationReason), arguments: (value.args ?? []).map(argument) });
  const schema = compiled.schema;
  return { schema: 'stellar-forge.subquery-schema-review.v1', sourceSha256: compiled.sourceSha256,
    schemaSha256: compiled.schemaSha256, format: compiled.format, provenance: compiled.provenance,
    queryType: schema.getQueryType().name,
    queryFields: Object.values(schema.getQueryType().getFields()).map(field),
    types: Object.values(schema.getTypeMap()).filter(type => !type.name.startsWith('__')).map(type => ({
      name: type.name, kind: type.constructor.name, description: type.description ?? null,
      ...(typeof type.getFields === 'function' ? { fields: Object.values(type.getFields()).map(field) } : {}),
      ...(typeof type.getValues === 'function' ? { values: type.getValues().map(value => ({ name: value.name, deprecated: Boolean(value.deprecationReason) })) } : {}),
    })) };
}

function topFields(selectionSet, fragments, depth = 0) {
  if (depth > 32) fail('QUERY_DEPTH', 'Root fragment expansion exceeds 32 levels');
  const result = [];
  for (const node of selectionSet.selections) {
    if (node.directives?.length) fail('QUERY_ROOT_CONDITIONAL', 'The selected data root must be unconditional');
    if (node.kind === Kind.FIELD) result.push(node);
    else result.push(...topFields(node.kind === Kind.FRAGMENT_SPREAD ?
      fragments.get(node.name.value).selectionSet : node.selectionSet, fragments, depth + 1));
    // More than one root is already invalid. Stop before repeated nested
    // fragments can expand a small document into a large intermediate array.
    if (result.length > 1) return result.slice(0, 2);
  }
  return result;
}

/** Preserve original operation identities, bounds, defaults and native binder. */
export function validateApprovedQueries(compiled, input, { examples = {} } = {}) {
  const queries = structuredClone(input);
  if (!record(queries) || !Array.isArray(queries.operations) || queries.operations.length < 1 || queries.operations.length > 16)
    fail('QUERIES_SHAPE', 'Supply the original subquery-merchant.v1 configuration with 1–16 operations');
  if (compiled.provenance.kind === 'CAPTURED_SCHEMA' &&
      (queries.origin !== compiled.provenance.origin || queries.path !== compiled.provenance.path))
    fail('SCHEMA_ENDPOINT_MISMATCH', 'Queries must target the exact endpoint whose served schema was captured');
  const reviews = [];
  for (const raw of queries.operations) {
    if (!record(raw) || typeof raw.query !== 'string' || raw.query.length > 8192)
      fail('QUERY_SIZE', 'An original fixed operation must be at most 8192 characters');
    let document;
    try { document = parse(raw.query, { maxTokens: 4096 }); }
    catch { fail('QUERY_SYNTAX', 'A fixed operation is not a valid GraphQL document within 4096 tokens'); }
    const operations = document.definitions.filter(node => node.kind === Kind.OPERATION_DEFINITION);
    if (operations.length !== 1 || operations[0].operation !== 'query' || document.definitions.some(node =>
      ![Kind.OPERATION_DEFINITION, Kind.FRAGMENT_DEFINITION].includes(node.kind)))
      fail('QUERY_READ_ONLY', 'Each product must contain exactly one read-only query operation and its fragments');
    const operation = operations[0];
    // An explicit operation name keeps anonymous source compatible with SF105's
    // existing read-only document guard; no selection or literal is rewritten.
    if (!operation.name) operation.name = { kind: Kind.NAME, value: raw.name };
    const errors = validate(compiled.schema, document, undefined, { maxErrors: 20 });
    if (errors.length) fail('QUERY_SCHEMA_MISMATCH', 'Fixed operation does not validate against the supplied served schema: ' + errors[0].message);
    let fieldCount = 0;
    visit(document, { Field(node) {
      if (['__schema', '__type'].includes(node.name.value)) fail('QUERY_INTROSPECTION', 'Schema introspection belongs to onboarding, not a paid data product');
      fieldCount += 1;
    } });
    const fragments = new Map(document.definitions.filter(node => node.kind === Kind.FRAGMENT_DEFINITION).map(node => [node.name.value, node]));
    const roots = topFields(operation.selectionSet, fragments);
    if (roots.length !== 1 || (roots[0].alias?.value ?? roots[0].name.value) !== raw.root)
      fail('QUERY_ROOT_MISMATCH', 'The query must select exactly the configured single response root');
    const rootField = compiled.schema.getQueryType().getFields()[roots[0].name.value];
    if (!rootField || !isObjectType(getNullableType(rootField.type)))
      fail('QUERY_ROOT_TYPE', 'The original adapter requires one object-valued data root');
    const definitions = operation.variableDefinitions ?? [];
    const variables = raw.variables ?? {};
    if (!record(variables) || definitions.length !== Object.keys(variables).length ||
        definitions.some(node => !own(variables, node.variable.name.value)))
      fail('VARIABLE_DECLARATIONS', 'Every GraphQL variable must have exactly one original native variable declaration');
    const variableTypes = {};
    for (const node of definitions) {
      const name = node.variable.name.value, spec = variables[name], type = typeFromAST(compiled.schema, node.type);
      if (!record(spec)) fail('VARIABLE_DECLARATIONS', 'Original native variable declarations must be objects');
      if (node.defaultValue) fail('VARIABLE_DEFAULT', 'Put variable defaults in the original variables declaration, not inside the GraphQL document');
      const expected = { integer: ['Int'], boolean: ['Boolean'], string: ['String', 'ID'], 'stellar-account': ['String', 'ID'] }[spec.type];
      if (!expected?.includes(String(getNullableType(type))))
        fail('VARIABLE_TYPE', 'Native variables must use compatible Int, Boolean, String or ID types. Keep enum/input-object filter structure as fixed query literals');
      if (isNonNullType(type) && spec.required !== true && !own(spec, 'default'))
        fail('VARIABLE_REQUIRED', 'A non-null GraphQL variable must be required or have a native default');
      variableTypes[name] = String(type);
    }
    raw.query = print(document);
    reviews.push({ name: raw.name, root: raw.root, rootField: roots[0].name.value,
      rootType: String(rootField.type), fieldCount, graphqlVariables: variableTypes,
      querySha256: digest(Buffer.from(raw.query)), definitions });
  }
  const native = compileSubQueryMerchant(queries);
  for (const [index, operation] of native.operations.entries()) {
    const review = reviews[index];
    // All private native defaults must themselves be valid GraphQL values.
    for (const definition of review.definitions) {
      const name = definition.variable.name.value, spec = operation.variables?.[name];
      if (spec && own(spec, 'default') && getVariableValues(compiled.schema, [definition], { [name]: spec.default }).errors)
        fail('VARIABLE_DEFAULT', 'A native default is invalid for its GraphQL variable type');
    }
    if (own(examples, operation.name)) {
      const bound = bindSubQueryVariables({ variables: examples[operation.name] }, operation);
      if (getVariableValues(compiled.schema, review.definitions, bound).errors)
        fail('VARIABLE_SAMPLE', 'A public sample fails original GraphQL variable coercion');
    }
    delete review.definitions;
  }
  return { queries, operations: reviews };
}

function endpointBindings(endpoint, { allowLoopback = true, env = {} } = {}) {
  fields(endpoint, ['schema', 'origin', 'path', 'authorizationEnv', 'timeoutMs', 'maxResponseBytes'], 'Schema endpoint');
  if (endpoint.schema !== ENDPOINT) fail('ENDPOINT_SCHEMA', 'Expected subquery-schema-endpoint.v1');
  if (endpoint.authorizationEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(endpoint.authorizationEnv))
    fail('ENDPOINT_CREDENTIAL', 'Use a named server-side credential environment variable');
  const bindings = { schema: 'stellar-forge.seller-upstreams.v1', bindings: { captureSchema: {
    origin: endpoint.origin, path: endpoint.path, method: 'POST', query: [], responseMode: 'json',
    headerEnv: endpoint.authorizationEnv ? { Authorization: endpoint.authorizationEnv } : {},
    timeoutMs: endpoint.timeoutMs ?? 15000, maxResponseBytes: endpoint.maxResponseBytes ?? MAX_SCHEMA, maxInFlight: 1,
  } } };
  const compiled = compileUpstreamBindings(bindings, { allowLoopback, env });
  if (compiled.captureSchema.pathKeys.length) fail('ENDPOINT_PATH', 'Schema capture requires a fixed endpoint path');
  return bindings;
}

/** One explicit introspection POST, using the original public-DNS/HTTPS/deadline
 * transport. The result contains schema data and source identity, no credentials. */
export async function captureSchemaSource(endpoint, { env = process.env, allowLoopback = false, signal } = {}) {
  const bindings = endpointBindings(endpoint, { env, allowLoopback });
  const body = { query: getIntrospectionQuery({ descriptions: true }), variables: {} };
  const handler = createUpstreamHandlers(bindings, { env, allowLoopback }).captureSchema;
  const result = await handler({ method: 'POST', url: new URL(endpoint.origin + endpoint.path),
    pathParams: {}, headers: {}, body, ...(signal ? { signal } : {}) });
  if (result.status !== 200 || !Buffer.isBuffer(result.body)) fail('SCHEMA_HTTP', 'The original upstream did not return a successful schema response');
  const response = parseJson(result.body);
  if (!record(response) || own(response, 'errors') || !record(response.data?.__schema))
    fail('SCHEMA_RESPONSE', 'Query service returned an unsuccessful or incomplete introspection result');
  const snapshot = { schema: CAPTURE, capturedAt: new Date().toISOString(), source: {
    origin: endpoint.origin, path: endpoint.path, requestSha256: digest(Buffer.from(JSON.stringify(body))),
    responseSha256: digest(result.body), responseBytes: result.body.length,
    introspectionSha256: digest(jsonBytes(response.data)),
  }, introspection: response.data };
  const compiled = compileSchemaSource(snapshot);
  return { snapshot, compiled, responseBytes: result.body };
}

export async function captureSchema({ endpointFile, directory, ...options }) {
  const endpoint = parseJson(await readBytes(endpointFile, 16384));
  const result = await captureSchemaSource(endpoint, options);
  const target = await writeBundle(directory, [['schema-source.json', jsonBytes(result.snapshot)],
    ['introspection-response.json', result.responseBytes], ['schema.graphql', printSchema(result.compiled.schema) + '\n'],
    ['schema-review.json', jsonBytes(inspectSchema(result.compiled))]]);
  return { directory: target, source: target + '/schema-source.json',
    sourceSha256: result.compiled.sourceSha256,
    queryFields: Object.keys(result.compiled.schema.getQueryType().getFields()).length };
}
