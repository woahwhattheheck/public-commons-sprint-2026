// MIT. Developer documentation from the exact compiled SF30 seller snapshot.
import { readFileSync } from 'node:fs';
import { generateSellerClient } from './developer/client-generator.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = key => encodeURIComponent(String(key).replace(/~/g, '~0').replace(/\//g, '~1'));
const dialect = 'https://json-schema.org/draft/2020-12/schema';
const mapKeywords = new Set(['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas']);
const childKeywords = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']);
const listKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

// Rebase only schema keywords. An example/const/default containing "$ref" is data.
function projectSchema(node, rootRef) {
  if (!object(node)) return structuredClone(node);
  const result = Object.create(null);
  for (const [key, value] of Object.entries(node)) {
    if (key === '$id') continue; // SF25 uses document-root pointers, not nested URI scopes.
    if (key === '$ref') {
      if (typeof value !== 'string' || (value !== '#' && !value.startsWith('#/')))
        throw new TypeError('Seller schema projection requires document-local JSON pointers');
      result[key] = rootRef + value.slice(1).split('/').map(encodeURIComponent).join('/');
    } else if (mapKeywords.has(key) && object(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, projectSchema(child, rootRef)]));
    } else if (childKeywords.has(key)) result[key] = projectSchema(value, rootRef);
    else if (listKeywords.has(key) && Array.isArray(value)) result[key] = value.map(child => projectSchema(child, rootRef));
    else result[key] = structuredClone(value);
  }
  return result;
}

/** OpenAPI is a view of advertised metadata, not new request validation or payment code. */
export function compileSellerOpenApi(compiled, { mode = 'CHALLENGE_ONLY' } = {}) {
  if (!Array.isArray(compiled?.routes) || !compiled.routes.length)
    throw new TypeError('Compiled seller routes required');
  if (!['CHALLENGE_ONLY', 'NATIVE_X402'].includes(mode)) throw new TypeError('Unknown seller mode');
  const paths = Object.create(null), schemas = Object.create(null);
  const origins = new Set(), names = new Set(), notes = [];
  for (const route of compiled.routes) {
    const { offer, id, method, binding } = route;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id ?? '') || names.has(id) ||
        !['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH'].includes(method) || !binding || !Array.isArray(binding.names))
      throw new TypeError('Invalid compiled seller route');
    names.add(id);
    const bazaar = offer.extensions.bazaar, input = bazaar.info.input;
    const key = `Bazaar_${id}`, rootRef = '#/components/schemas/' + key;
    let projected = true;
    try { schemas[key] = projectSchema(bazaar.schema, rootRef); }
    catch {
      projected = false;
      notes.push(`${id}: an unused non-pointer schema reference cannot be projected; the unchanged original schema remains in x-x402-payment-required.`);
    }
    const inputSchema = bazaar.schema.properties?.input;
    const shape = inputSchema?.properties;
    const path = binding.segments.map(segment => segment.startsWith(':') ? `{${segment.slice(1)}}` : segment).join('/');
    const url = new URL(offer.resource.url); origins.add(url.origin);
    const parameters = [];
    for (const [group, location] of [['pathParams', 'path'], ['queryParams', 'query']]) {
      const groupSchema = shape?.[group];
      const fields = groupSchema?.properties;
      const examples = input[group] ?? {};
      if (groupSchema && (groupSchema.$ref || groupSchema.allOf || groupSchema.anyOf || groupSchema.oneOf))
        notes.push(`${id}: composed ${group} constraints remain in the complete original schema; individual parameter views contain direct properties only.`);
      const fieldNames = group === 'pathParams' ? binding.names : [...new Set([...Object.keys(fields ?? {}), ...Object.keys(examples)])];
      for (const name of fieldNames) {
        const field = fields?.[name];
        const parameter = { name, in: location,
          required: location === 'path' || Boolean(groupSchema?.required?.includes(name)),
          ...(location === 'query' ? { style: 'form', explode: true } : {}),
          schema: projected && field !== undefined ? { $ref: rootRef + '/properties/input/properties/' + group + '/properties/' + pointer(name) } : {},
          ...(typeof field?.description === 'string' ? { description: field.description } : {}),
          ...(own(examples, name) ? { example: structuredClone(examples[name]) } : {}),
        };
        parameters.push(parameter);
      }
    }
    const output = bazaar.info.output;
    const outputShape = bazaar.schema.properties?.output?.properties;
    const operation = {
      operationId: id, summary: offer.resource.description,
      ...(offer.resource.tags?.length ? { tags: [...offer.resource.tags] } : {}),
      description: mode === 'CHALLENGE_ONLY' ?
        'Challenge-only runtime: this process advertises payment requirements but does not deliver paid content.' :
        'Native x402 runtime: successful content requires verification and settlement through the configured SDK.',
      parameters,
      responses: {
        '2XX': { description: 'Application success only after native payment success; exact status and output are application-defined.',
          ...(method !== 'HEAD' ? { content: { [offer.resource.mimeType ?? 'application/json']: {
            ...(projected && outputShape && own(outputShape, 'example')
              ? { schema: { $ref: rootRef + '/properties/output/properties/example' } } : {}),
            ...(output && own(output, 'example') ? { example: structuredClone(output.example) } : {}),
          } } } : {}) },
        '402': { description: 'Payment requirements. This is not a payment or a settlement receipt.',
          headers: { 'PAYMENT-REQUIRED': { description: 'Base64-encoded x402 v2 PaymentRequired envelope.', schema: { type: 'string' } } },
          ...(method !== 'HEAD' ? { content: { 'application/json': { example: structuredClone(offer) } } } : {}) },
        default: { description: 'Application, admission, request or payment processing error.' },
      },
      'x-seller-route': { id, path: binding.path, method, samplePath: binding.samplePath,
        admission: typeof route.admit === 'function', mode, maxRequestBytes:route.maxRequestBytes??1048576 },
      'x-x402-payment-required': structuredClone(offer),
    };
    if (['POST', 'PUT', 'PATCH'].includes(method)) operation.requestBody = {
      required:inputSchema?.required?.includes('body')===true, content: { [input.bodyType==='form-data'?'multipart/form-data':'application/json']: {
        schema: projected && shape && own(shape, 'body') ? { $ref: rootRef + '/properties/input/properties/body' } : {},
        ...(own(input, 'body') ? { example: structuredClone(input.body) } : {}),
      } },
    };
    if (!shape || inputSchema.$ref || inputSchema.allOf || inputSchema.anyOf || inputSchema.oneOf)
      notes.push(`${id}: parameter/body views only project direct input properties; consult the complete original Bazaar schema for composed constraints.`);
    if (!own(paths, path)) paths[path] = Object.create(null);
    if (own(paths[path], method.toLowerCase())) throw new TypeError('OpenAPI path/method collision');
    paths[path][method.toLowerCase()] = operation;
  }
  if (origins.size !== 1) throw new TypeError('One trusted seller origin required');
  return { openapi: '3.1.1', jsonSchemaDialect: dialect,
    info: { title: compiled.routes[0].offer.resource.serviceName ?? 'Starforge seller API', version: 'unversioned',
      description: 'Generated from the running seller\'s compiled offers. Atomic prices remain strings. Bazaar schemas describe advertised metadata; the application and admission hooks determine request acceptance. Payment negotiation is x402, not a reusable API key.' },
    servers: [{ url: [...origins][0] }], paths, components: { schemas },
    'x-seller-runtime': mode,
    'x-schema-projection-notes': notes,
  };
}

const assets = new Map([
  ['/_seller/docs', ['text/html; charset=utf-8', 'index.html']],
  ['/_seller/docs/', ['text/html; charset=utf-8', 'index.html']],
  ['/_seller/developer/browser.mjs', ['text/javascript; charset=utf-8', 'browser.mjs']],
  ['/_seller/developer/request.mjs', ['text/javascript; charset=utf-8', 'request.mjs']],
  ['/_seller/developer/style.css', ['text/css; charset=utf-8', 'style.css']],
].map(([path, [mime, name]]) => [path, { mime, bytes: readFileSync(new URL('./developer/' + name, import.meta.url)) }]));

assets.set('/_seller/query-parameters.mjs', {
  mime: 'text/javascript; charset=utf-8',
  bytes: readFileSync(new URL('./query-parameters.mjs', import.meta.url)),
});

/** Handles only reserved documentation paths; never proxies or calls a paid route. */
export function createSellerDeveloperPortal({ compiled, mode } = {}) {
  const specification = compileSellerOpenApi(compiled, { mode });
  const specBytes = Buffer.from(JSON.stringify(specification, null, 2) + '\n');
  const client = generateSellerClient(specBytes);
  const downloads = new Map([
    ['seller-client.mjs', ['text/javascript; charset=utf-8', client.javascript]],
    ['seller-client.d.mts', ['text/plain; charset=utf-8', client.declarations]],
    ['README.md', ['text/markdown; charset=utf-8', client.readme]],
    ['package.json', ['application/json; charset=utf-8', client.packageJson]],
  ].map(([name, [mime, text]]) => ['/_seller/client/' + name,
    { mime, bytes: Buffer.from(text), download: name }]));
  return function developerPortal(req, res) {
    const path = typeof req.url === 'string' ? req.url.split('?')[0] : '';
    const asset = path === '/_seller/openapi.json' ? { mime: 'application/json; charset=utf-8', bytes: specBytes } :
      downloads.get(path) ?? assets.get(path);
    if (!asset) return false;
    const common = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...common, allow: 'GET, HEAD', 'content-length': '0' }); res.end(); return true;
    }
    res.writeHead(200, { ...common, 'content-type': asset.mime, 'content-length': String(asset.bytes.length),
      ...(asset.download ? { 'content-disposition': `attachment; filename="${asset.download}"` } : {}) });
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
    return true;
  };
}
