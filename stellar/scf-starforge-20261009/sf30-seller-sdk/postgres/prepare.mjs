// MIT. Offline merchant onboarding for the ORIGINAL SF30 PostgreSQL seller.
import { mkdir, open, unlink, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPostgresSourceFile } from './config.mjs';
import { compilePostgresQueries, bindPostgresParameters } from './declaration.mjs';
import { record } from '../sqlite/parameters.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { readSellerConfig } from '../serve.mjs';
import { supportsSellerMethod, requiresJsonBody } from '../http-methods.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const PLAN = 'stellar-forge.postgres-merchant-plan.v1';
const PAYMENT = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'];
const noOperation = () => { throw new Error('Preparation does not execute a seller request'); };
function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError(`${label} contains unsupported fields`);
}
function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw new TypeError(`${label} must be nonempty printable text within its size limit`);
  return value;
}
function paymentFields(value) {
  const single = own(value, 'payment'), many = own(value, 'paymentOptions');
  if (single && many) throw new TypeError('Choose one complete payment or paymentOptions declaration');
  if (!single && !many) return null;
  const options = many ? value.paymentOptions : [value.payment];
  if (!Array.isArray(options) || !options.length) throw new TypeError('Payment options must be a nonempty array');
  for (const option of options) fields(option, PAYMENT, 'Payment terms');
  // The original seller validates amount, network, option identity and extra.
  return structuredClone(many ? { paymentOptions: options } : { payment: options[0] });
}
function origin(value) {
  text(value, 'publicOrigin', 2048);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.origin !== value.replace(/\/$/, ''))
    throw new TypeError('publicOrigin must be a canonical HTTPS origin');
  return url.origin;
}
function parameterDescription(spec, supplied, isQuery) {
  const parts = [text(supplied, 'Parameter description', 512)];
  if (spec.type === 'string') parts.push(`String length ${spec.minLength ?? 0}–${spec.maxLength ?? 4096} UTF-16 code units; PostgreSQL NUL text is rejected before payment.`);
  if (spec.type === 'integer') parts.push('Canonical signed 64-bit decimal integer text; no plus sign, leading zero or negative zero.' +
    (isQuery ? '' : ' Safe integer JSON numbers are also accepted.'));
  if (spec.type === 'decimal') parts.push('Exact decimal string, at most 128 characters; no exponent, plus sign or leading zero. Numeric comparisons use exact decimal values.');
  if (spec.type === 'decimal' && own(spec, 'maxScale')) parts.push(`At most ${spec.maxScale} fractional digits after removing trailing fractional zeros.`);
  if (spec.type === 'decimal' && own(spec, 'maxIntegerDigits')) parts.push(`At most ${spec.maxIntegerDigits} significant integer digits; zero uses none.`);
  if (spec.type === 'number') parts.push('Finite JavaScript number, or decimal/exponent text up to 128 characters; ordinary binary floating-point conversion applies. Use decimal for exact decimal arithmetic.');
  if (spec.type === 'boolean') parts.push(isQuery ? 'Use the query text true or false.' : 'Use JSON true/false or the strings "true"/"false".');
  if (own(spec, 'minimum')) parts.push(`Inclusive minimum: ${spec.minimum}.`);
  if (own(spec, 'maximum')) parts.push(`Inclusive maximum: ${spec.maximum}.`);
  if (spec.enum) parts.push(`Allowed ${['decimal', 'number'].includes(spec.type) ? 'numeric values (equivalent numeric spellings accepted)' : 'values'}: ${JSON.stringify(spec.enum)}.`);
  if (own(spec, 'default')) parts.push('May be omitted to use the private source default.');
  else parts.push('Required even when nullable.');
  if (spec.nullable) parts.push(isQuery ? 'HTTP query strings cannot transmit SQL null; an omitted field can use a configured null default.' : 'JSON null is accepted subject to the configured enum.');
  return parts.join(' ');
}
function parameterSchema(spec, supplied, isQuery, bindParameters = bindPostgresParameters) {
  // SF25's native-supported schema subset has no pattern keyword and cannot
  // compare exact decimal strings. Keep those constraints in source admission
  // and describe them exactly; never round them into JSON numbers.
  let schema;
  if (isQuery) schema = { type: 'string' };
  else if (spec.type === 'integer') schema = { anyOf: [
    { type: 'string', maxLength: 20 },
    { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    ...(spec.nullable ? [{ type: 'null' }] : []),
  ] };
  else if (spec.type === 'boolean') schema = { enum: [true, false, 'true', 'false', ...(spec.nullable ? [null] : [])] };
  else if (spec.type === 'number') schema = { anyOf: [
    { type: 'number', ...(own(spec, 'minimum') ? { minimum: spec.minimum } : {}), ...(own(spec, 'maximum') ? { maximum: spec.maximum } : {}) },
    { type: 'string', maxLength: 128 }, ...(spec.nullable ? [{ type: 'null' }] : []),
  ] };
  else schema = { type: spec.nullable ? ['string', 'null'] : 'string' };
  if (spec.type === 'string') schema.maxLength = spec.maxLength ?? 4096;
  if (spec.type === 'decimal') schema.maxLength = 128;
  if (isQuery && spec.type === 'integer') schema.maxLength = 20;
  if (isQuery && spec.type === 'boolean') schema.enum = ['true', 'false'];
  if (isQuery && spec.type === 'number') schema.maxLength = 128;
  if (spec.enum && !['decimal', 'number'].includes(spec.type)) {
    const accepted = [];
    for (const value of spec.enum) {
      const parsed = bindParameters({ parameters: { [spec.name]: spec }, parameterOrder: [spec.name] }, { [spec.name]: value })[0];
      if (parsed === null) { if (!isQuery) accepted.push(null); }
      else if (isQuery) accepted.push(String(parsed));
      else if (spec.type === 'integer') {
        accepted.push(parsed);
        if (Number.isSafeInteger(Number(parsed))) accepted.push(Number(parsed));
      } else if (spec.type === 'boolean') accepted.push(parsed, String(parsed));
      else accepted.push(parsed);
    }
    // A nullable, default-null query enum can intentionally allow omission only.
    if (!accepted.length) return { ...schema, description: parameterDescription(spec, supplied, isQuery), enum: [''], allOf: [false] };
    schema.enum = [...new Map(accepted.map(value => [JSON.stringify(value), value])).values()];
  }
  schema.description = parameterDescription(spec, supplied, isQuery);
  return schema;
}

/** Compile approved private queries plus explicit PUBLIC merchant metadata.
 * No environment reads, SQL execution, network requests or payment calls. */
export function compilePostgresMerchantPlan(queries, plan) {
  return compileQueryMerchantPlan(compilePostgresQueries(queries), plan);
}

/** Compile already validated source declarations through the original public
 * seller contract. The source owns declaration validation and scalar binding;
 * this compiler owns the public HTTP, payment, example and route semantics. */
export function compileQueryMerchantPlan(compiled, plan, {
  schema = PLAN, handlerPrefix = 'postgresQuery', admitPrefix = 'postgresAdmit',
  bindParameters = bindPostgresParameters,
} = {}) {
  fields(plan, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'Merchant plan');
  if (plan.schema !== schema || !Array.isArray(plan.routes) || !plan.routes.length || plan.routes.length > 64)
    throw new TypeError(`Expected ${schema.replace(/^stellar-forge\./, '')} with 1–64 routes`);
  const publicOrigin = origin(plan.publicOrigin);
  const inheritedPayment = paymentFields(plan), ids = new Set(), bindings = Object.create(null);
  const routes = plan.routes.map((route, index) => {
    fields(route, ['id', 'path', 'method', 'query', 'serviceName', 'description', 'tags', 'example',
      'parameterDescriptions', 'payment', 'paymentOptions'], 'Merchant route');
    if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id) || ids.has(route.id))
      throw new TypeError('Route IDs must be unique printable identifiers');
    if (typeof route.query !== 'string' || !own(compiled, route.query)) throw new TypeError('Route must name an existing configured query');
    if (!supportsSellerMethod(route.method)) throw new TypeError('Route method must be supported by the original seller');
    if (typeof route.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]*$/.test(route.path) ||
        route.path.startsWith('/_seller/') || route.path === '/_seller' || route.path.includes('//') ||
        new URL(route.path, publicOrigin).pathname !== route.path)
      throw new TypeError('Route requires a canonical fixed public path outside /_seller');
    const spec = compiled[route.query], isQuery = !requiresJsonBody(route.method);
    const parameters = spec.parameterOrder.map(name => ({ ...spec.parameters[name], name }));
    const descriptions = route.parameterDescriptions;
    fields(descriptions, parameters.map(parameter => parameter.name), 'Parameter descriptions');
    if (parameters.some(parameter => !own(descriptions, parameter.name))) throw new TypeError('Describe every configured public parameter');
    if (!record(route.example)) throw new TypeError('Supply an explicit public example object for each route');
    // Validate before publication; missing required fields and invalid defaults,
    // enums, bounds and unsafe numeric examples use the SAME source binder.
    bindParameters(spec, route.example);
    if (isQuery && Object.values(route.example).some(value => value === null))
      throw new TypeError('Query examples cannot transmit null; omit a defaulted field or choose POST');
    const example = Object.fromEntries(Object.entries(route.example).map(([name, value]) =>
      [name, isQuery ? String(value) : structuredClone(value)]));
    // Converting a safe numeric example to its actual HTTP text must also retain
    // the source contract. Never rely on an unexecuted JavaScript sample.
    bindParameters(spec, example);
    if (isQuery) {
      const request = new URL(publicOrigin + route.path);
      for (const [name, value] of Object.entries(example)) request.searchParams.set(name, value);
      if (request.href.length > 2048) throw new RangeError('Query example exceeds the original request target limit; use a smaller sample or POST');
    }
    const payment = paymentFields(route) ?? inheritedPayment;
    if (!payment) throw new TypeError('Every route requires explicit native payment terms');
    const offer = compileHttpSellerOffer({ url: publicOrigin + route.path, method: route.method,
      serviceName: text(route.serviceName, 'serviceName', 32),
      description: text(route.description, 'description', 2048), ...(route.tags === undefined ? {} : { tags: route.tags }),
      ...payment, ...(isQuery ? {} : { bodyType: 'json', body: example }) });
    const input = offer.extensions.bazaar.info.input;
    const inputSchema = offer.extensions.bazaar.schema.properties.input;
    const key = isQuery ? 'queryParams' : 'body';
    input[key] = example;
    inputSchema.properties[key] = { type: 'object', properties: Object.fromEntries(parameters.map(parameter =>
      [parameter.name, parameterSchema(parameter, descriptions[parameter.name], isQuery, bindParameters)])),
    required: parameters.filter(parameter => !own(parameter, 'default')).map(parameter => parameter.name),
    additionalProperties: false };
    if (!inputSchema.required.includes(key)) inputSchema.required.push(key);
    ids.add(route.id);
    bindings[route.id] = { query: route.query, input: isQuery ? 'query' : 'body' };
    return { id: route.id, path: route.path, handler: `${handlerPrefix}${index}`, admit: `${admitPrefix}${index}`,
      validateInput: true, offer };
  });
  // Reuse original imported-offer, route collision, Bazaar schema, public-host,
  // payment-option and buyer-header limits on the exact generated artifacts.
  compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer, handler: noOperation, admit: noOperation })));
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin, routes };
  if (Buffer.byteLength(JSON.stringify(service, null, 2) + '\n') > 1024 * 1024)
    throw new RangeError('Generated service exceeds the original 1 MiB configuration limit');
  return { service, bindings };
}

async function readMerchantPlan(filename) {
  const handle = await open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('Merchant plan must be a regular file up to 256 KiB');
    const bytes = Buffer.alloc(262145); let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > 262144) throw new RangeError('Merchant plan exceeds 256 KiB');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
  } finally { await handle.close(); }
}

/** Create-only private source + seller bundle for the existing start.mjs.
 * Retain the original source, replacing only route bindings in the new copy.
 * SQL/settings stay in private source.json and never enter an offer. */
export async function preparePostgresSeller({ sourceFile, planFile, directory } = {}) {
  for (const [name, value] of Object.entries({ sourceFile, planFile, directory })) text(value, name, 4096);
  const source = resolve(sourceFile), target = resolve(directory);
  const { config } = await readPostgresSourceFile(source);
  const plan = await readMerchantPlan(resolve(planFile));
  const bundle = compilePostgresMerchantPlan(config.queries, plan);
  const privateSource = { ...structuredClone(config), bindings: bundle.bindings,
    ...(config.caFile === undefined ? {} : { caFile: resolve(dirname(source), config.caFile) }) };
  if (Buffer.byteLength(JSON.stringify(privateSource, null, 2) + '\n') > 262144)
    throw new RangeError('Generated source exceeds the original 256 KiB limit');
  // mkdir is intentionally not recursive: an existing destination is never
  // altered, and output creation requires an existing operator-owned parent.
  await mkdir(target, { mode: 0o700 });
  const created = [];
  try {
    for (const [name, value] of [['source.json', privateSource], ['service.json', bundle.service], ['bindings.json', bundle.bindings]]) {
      const file = resolve(target, name);
      const handle = await open(file, 'wx', 0o600);
      created.push(file);
      try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); }
      finally { await handle.close(); }
    }
    await readSellerConfig(resolve(target, 'service.json'));
    await readPostgresSourceFile(resolve(target, 'source.json'));
    return { directory: target, source: resolve(target, 'source.json'), service: resolve(target, 'service.json'), bindings: resolve(target, 'bindings.json'),
      routes: bundle.service.routes.map(({ id, offer }) => ({ id, method: offer.extensions.bazaar.info.input.method,
        url: offer.resource.url, paymentOptions: offer.accepts.length })),
      launcher: fileURLToPath(new URL('./start.mjs', import.meta.url)) };
  } catch (error) {
    for (const file of created) await unlink(file).catch(() => {});
    await rmdir(target).catch(() => {});
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node postgres/prepare.mjs --source PRIVATE_SOURCE --plan MERCHANT_PLAN --directory NEW_DIRECTORY\n');
    return;
  }
  const flags = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--source', '--plan', '--directory'].includes(name) || flags.has(name) || !value || value.startsWith('--'))
      throw new TypeError('Provide source, plan and directory exactly once');
    flags.set(name, value);
  }
  if (flags.size !== 3) throw new TypeError('source, plan and directory are required');
  const result = await preparePostgresSeller({ sourceFile: flags.get('--source'), planFile: flags.get('--plan'), directory: flags.get('--directory') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  // Source SQL, examples, database locations and parser errors are private.
  process.stderr.write('{"error":"POSTGRES_PREPARE_FAILED"}\n'); process.exitCode = 1;
});
