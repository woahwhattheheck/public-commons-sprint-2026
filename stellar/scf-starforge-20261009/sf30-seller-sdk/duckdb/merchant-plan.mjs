// MIT. Merchant metadata for the ORIGINAL DuckDB source and SF30 seller.
import { compileDuckdbQueries, bindDuckdbParameters } from './config.mjs';
import { record } from '../sqlite/parameters.mjs';
import { compileHttpSellerOffer, normalizeSellerPaymentOptions } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { generateSellerClient } from '../developer/client-generator.mjs';
import { supportsSellerMethod, requiresJsonBody } from '../http-methods.mjs';

export const DUCKDB_MERCHANT_PLAN_SCHEMA = 'stellar-forge.duckdb-merchant-plan.v1';
const own = (value, key) => Object.hasOwn(value, key);
const json = value => JSON.stringify(value, null, 2) + '\n';
const unavailable = () => { throw new Error('Merchant preparation does not execute a seller request'); };
function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError(`${label} contains unsupported fields`);
}
function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw new TypeError(`${label} must be nonempty printable text (max ${maximum})`);
  return value;
}
function payment(value) {
  if (!own(value, 'payment') && !own(value, 'paymentOptions')) return null;
  const normalized = normalizeSellerPaymentOptions(value);
  for (const option of own(value, 'paymentOptions') ? value.paymentOptions : [value.payment])
    fields(option, ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra'], 'Payment terms');
  // Keep every exact network/asset/recipient choice together. Normalization and
  // duplicate-option rejection remain the original seller's responsibility.
  return { paymentOptions: normalized };
}
function parameterDescription(spec, supplied, query) {
  const notes = [text(supplied, 'Parameter description', 512)];
  if (spec.type === 'string') notes.push(`String length ${spec.minLength ?? 0}–${spec.maxLength ?? 4096} UTF-16 code units.`);
  if (spec.type === 'integer') notes.push('Canonical signed 64-bit decimal integer text; no plus sign, leading zero or negative zero.' +
    (query ? '' : ' Safe integer JSON numbers are also accepted.'));
  if (spec.type === 'number') notes.push('Finite JavaScript number or decimal/exponent text of at most 128 characters. Binary floating-point conversion applies.');
  if (spec.type === 'boolean') notes.push(query ? 'Use the query text true or false.' : 'Use JSON true/false or the strings "true"/"false".');
  if (own(spec, 'minimum')) notes.push(`Inclusive minimum: ${spec.minimum}.`);
  if (own(spec, 'maximum')) notes.push(`Inclusive maximum: ${spec.maximum}.`);
  if (spec.enum) notes.push(`Allowed values after native scalar conversion: ${JSON.stringify(spec.enum)}.`);
  notes.push(own(spec, 'default') ? 'May be omitted to use the private source default.' : 'Required even when nullable.');
  if (spec.nullable) notes.push(query ? 'Query strings cannot transmit SQL null; omission can use a configured null default.' : 'JSON null is accepted subject to the source enum.');
  return notes.join(' ');
}
function parameterSchema(name, spec, description, query) {
  // Wire shape is a projection of the original scalar binder. Exact integer
  // bounds, numeric string spellings and numeric enums stay in source admission;
  // do not round them or introduce unsupported regex validation into SF25.
  let schema;
  if (query) schema = { type: 'string' };
  else if (spec.type === 'integer') schema = { anyOf: [
    { type: 'string', maxLength: 20 },
    { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    ...(spec.nullable ? [{ type: 'null' }] : []),
  ] };
  else if (spec.type === 'number') schema = { anyOf: [
    { type: 'number' }, { type: 'string', maxLength: 128 },
    ...(spec.nullable ? [{ type: 'null' }] : []),
  ] };
  else if (spec.type === 'boolean') schema = { enum: [true, false, 'true', 'false', ...(spec.nullable ? [null] : [])] };
  else schema = { type: spec.nullable ? ['string', 'null'] : 'string' };
  if (spec.type === 'string') Object.assign(schema, { minLength: spec.minLength ?? 0, maxLength: spec.maxLength ?? 4096 });
  if (query && spec.type === 'integer') schema.maxLength = 20;
  if (query && spec.type === 'number') schema.maxLength = 128;
  if (query && spec.type === 'boolean') schema.enum = ['true', 'false'];
  if (spec.enum && spec.type !== 'number') {
    const accepted = [];
    for (const raw of spec.enum) {
      const value = bindDuckdbParameters({ parameters: { [name]: spec } }, { [name]: raw })[name];
      if (value === null) { if (!query) accepted.push(null); }
      else if (query) accepted.push(String(value));
      else if (spec.type === 'integer') {
        accepted.push(value);
        if (Number.isSafeInteger(Number(value))) accepted.push(Number(value));
      } else if (spec.type === 'boolean') accepted.push(value, String(value));
      else accepted.push(value);
    }
    // A null-only, default-null query field can only be omitted. Preserve that
    // useful source contract without advertising a string as SQL null.
    if (!accepted.length) Object.assign(schema, { enum: [''], allOf: [false] });
    else schema.enum = [...new Map(accepted.map(value => [JSON.stringify(value), value])).values()];
  }
  schema.description = parameterDescription(spec, description, query);
  return schema;
}

/** Compile public samples and exact native offers. No SQL, network or payment. */
export function compileDuckdbMerchantPlan(queries, plan) {
  fields(plan, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'Merchant plan');
  if (plan.schema !== DUCKDB_MERCHANT_PLAN_SCHEMA || !Array.isArray(plan.routes) ||
      plan.routes.length < 1 || plan.routes.length > 64)
    throw new TypeError('Expected duckdb-merchant-plan.v1 with 1–64 routes');
  text(plan.publicOrigin, 'publicOrigin', 2048);
  const origin = new URL(plan.publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/' || origin.origin !== plan.publicOrigin.replace(/\/$/, ''))
    throw new TypeError('publicOrigin must be a canonical HTTPS origin');
  const publicOrigin = origin.origin, compiledQueries = compileDuckdbQueries(queries);
  const inherited = payment(plan), ids = new Set(), bindings = Object.create(null), reviewRoutes = [];
  const routes = plan.routes.map((route, index) => {
    fields(route, ['id', 'path', 'method', 'query', 'serviceName', 'description', 'tags', 'example',
      'parameterDescriptions', 'payment', 'paymentOptions'], 'Merchant route');
    if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id) || ids.has(route.id))
      throw new TypeError('Merchant route IDs must be unique identifiers');
    if (!supportsSellerMethod(route.method)) throw new TypeError('Choose an original supported HTTP method');
    if (typeof route.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]*$/.test(route.path) ||
        route.path === '/_seller' || route.path.startsWith('/_seller/') || route.path.includes('//') ||
        new URL(route.path, publicOrigin).pathname !== route.path)
      throw new TypeError('Use a canonical fixed public route outside /_seller');
    if (typeof route.query !== 'string' || !own(compiledQueries, route.query))
      throw new TypeError('Route must name an existing approved DuckDB query');
    const spec = compiledQueries[route.query], names = Object.keys(spec.parameters);
    const query = !requiresJsonBody(route.method), descriptions = route.parameterDescriptions;
    fields(descriptions, names, 'Parameter descriptions');
    if (names.some(name => !own(descriptions, name))) throw new TypeError('Describe every configured public parameter');
    if (!record(route.example)) throw new TypeError('Supply a deliberately public example object');
    bindDuckdbParameters(spec, route.example);
    if (query && Object.values(route.example).some(value => value === null))
      throw new TypeError('HTTP query examples cannot carry SQL null; omit a defaulted value or use a JSON body');
    const example = Object.fromEntries(Object.entries(route.example).map(([name, value]) =>
      [name, query ? String(value) : structuredClone(value)]));
    bindDuckdbParameters(spec, example); // Validate the actual public wire values too.
    if (query) {
      const url = new URL(publicOrigin + route.path);
      for (const [name, value] of Object.entries(example)) url.searchParams.set(name, value);
      if (url.href.length > 2048) throw new RangeError('Public query example exceeds the original 2048-character URL limit');
    }
    const terms = payment(route) ?? inherited;
    if (!terms) throw new TypeError('Every merchant route needs explicit native payment terms');
    const offer = compileHttpSellerOffer({ url: publicOrigin + route.path, method: route.method,
      serviceName: text(route.serviceName, 'serviceName', 32), description: text(route.description, 'description', 2048),
      ...(route.tags === undefined ? {} : { tags: route.tags }), ...terms,
      ...(query ? {} : { bodyType: 'json', body: example }),
      // Actual customer rows and private source defaults never become examples.
      outputExample: { schema: 'stellar-forge.duckdb-result.v1', query: route.query, columns: spec.columns,
        rows: [], rowCount: 0, truncated: false,
        encodings: { integer: 'decimal-string', decimal: 'decimal-string', blob: '$base64', date: 'iso8601' } },
    });
    const input = offer.extensions.bazaar.info.input, inputSchema = offer.extensions.bazaar.schema.properties.input;
    const key = query ? 'queryParams' : 'body';
    input[key] = example;
    inputSchema.properties[key] = { type: 'object', properties: Object.fromEntries(names.map(name =>
      [name, parameterSchema(name, spec.parameters[name], descriptions[name], query)])),
    required: names.filter(name => !own(spec.parameters[name], 'default')), additionalProperties: false };
    if (!inputSchema.required.includes(key)) inputSchema.required.push(key);
    ids.add(route.id); bindings[route.id] = { query: route.query, input: query ? 'query' : 'body' };
    reviewRoutes.push({ id: route.id, method: route.method, url: offer.resource.url, query: route.query,
      input: query ? 'query' : 'body', example, parameters: structuredClone(inputSchema.properties[key]),
      columns: [...spec.columns], maxRows: spec.maxRows, maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs,
      paymentOptions: structuredClone(offer.accepts) });
    return { id: route.id, path: route.path, handler: `duckdbQuery${index}`, admit: `duckdbAdmit${index}`,
      validateInput: true, offer };
  });
  const compiled = compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer,
    handler: unavailable, admit: unavailable })));
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin, routes };
  if (Buffer.byteLength(json(service)) > 1048576) throw new RangeError('Service exceeds the original 1 MiB limit');
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const client = generateSellerClient(json(openapi));
  return { service, bindings, review: { schema: 'stellar-forge.duckdb-merchant-review.v1', publicOrigin,
    mode: 'CHALLENGE_ONLY', routes: reviewRoutes }, openapi, client };
}
