// MIT. Export an API-specific client from the original seller's complete OpenAPI snapshot.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { generateClientDeclarations } from './client-types.mjs';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const LIMIT = 16 * 1024 * 1024;
const runtimeImport = "import { buildUnpaidRequest } from './request.mjs';";
const runtimeSource = readFileSync(new URL('./client-runtime.mjs', import.meta.url), 'utf8');
const requestSource = readFileSync(new URL('./request.mjs', import.meta.url), 'utf8');
const queryImport = "import { encodeQueryParameters, decodeQueryParameters } from '../query-parameters.mjs';";
const querySource = readFileSync(new URL('../query-parameters.mjs', import.meta.url), 'utf8');
if (!requestSource.includes(queryImport)) throw new Error('Developer query codec import is missing');
// Keep the exact maintained codec in the dependency-free generated module.
// Its lexical scope is separate from the original request/runtime helpers.
const queryRuntime = [
  'const { encodeQueryParameters, decodeQueryParameters } = (() => {',
  querySource.replace(/^export /gm, ''),
  'return { encodeQueryParameters, decodeQueryParameters };',
  '})();',
  '',
].join('\n');
const standaloneRequestSource = requestSource.replace(queryImport, queryRuntime);
if (!runtimeSource.includes(runtimeImport)) throw new Error('Client runtime request import is missing');

function pointer(root, ref) {
  if (ref === '#') return root;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let current = root;
  for (const token of ref.slice(2).split('/')) {
    let name;
    try { name = decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~'); } catch { return undefined; }
    if (!object(current) && !Array.isArray(current) || !has(current, name)) return undefined;
    current = current[name];
  }
  return current;
}

// Required keys that apply in every branch. These are input conveniences;
// the original merchant admission remains the authoritative validator.
function requiredNames(schema, root, trail = new Set()) {
  if (!object(schema) || trail.has(schema)) return new Set();
  const seen = new Set(trail); seen.add(schema);
  const result = new Set(Array.isArray(schema.required) ? schema.required.filter(x => typeof x === 'string') : []);
  if (schema.$ref) for (const name of requiredNames(pointer(root, schema.$ref), root, seen)) result.add(name);
  for (const child of Array.isArray(schema.allOf) ? schema.allOf : [])
    for (const name of requiredNames(child, root, seen)) result.add(name);
  for (const key of ['anyOf', 'oneOf']) if (Array.isArray(schema[key]) && schema[key].length) {
    const branches = schema[key].map(child => requiredNames(child, root, seen));
    for (const name of branches[0]) if (branches.every(branch => branch.has(name))) result.add(name);
  }
  return result;
}

function propertySchemas(schema, name, root, trail = new Set()) {
  if (!object(schema) || trail.has(schema)) return [];
  const seen = new Set(trail); seen.add(schema);
  const result = has(schema.properties ?? {}, name) ? [schema.properties[name]] : [];
  if (schema.$ref) result.push(...propertySchemas(pointer(root, schema.$ref), name, root, seen));
  for (const child of Array.isArray(schema.allOf) ? schema.allOf : []) result.push(...propertySchemas(child, name, root, seen));
  // Alternatives have no unconditional projection here; the full source is retained.
  return result;
}

function makeSnapshot(specification, sourceSha256) {
  if (!object(specification) || specification.openapi !== '3.1.1' || !object(specification.paths) ||
      !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(specification['x-seller-runtime']))
    throw new TypeError('Expected the original SF30 OpenAPI 3.1.1 developer export');
  const originals = [];
  for (const [path, item] of Object.entries(specification.paths)) {
    if (!object(item)) throw new TypeError('Invalid seller OpenAPI path item');
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'head', 'delete', 'post', 'put', 'patch'].includes(method) || !object(operation))
        throw new TypeError('The seller client supports the original six HTTP methods');
      const route = operation['x-seller-route'], offer = operation['x-x402-payment-required'];
      if (!object(route) || !object(offer) || route.id !== operation.operationId ||
          route.method !== method.toUpperCase() || route.mode !== specification['x-seller-runtime'])
        throw new TypeError('Operation identity does not match its original seller route');
      originals.push({ path, route, offer });
    }
  }
  if (!originals.length || originals.length > 64) throw new TypeError('Expected 1–64 original seller operations');
  const origins = new Set(originals.map(({ offer }) => new URL(offer.resource?.url).origin));
  if (origins.size !== 1 || specification.servers?.length !== 1 || specification.servers[0]?.url !== [...origins][0])
    throw new TypeError('OpenAPI server must equal the original seller’s single resource origin');
  const origin = [...origins][0];
  const local = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?$/.test(origin);
  // Use the original compiler for payment, schema, dynamic-path and URL acceptance.
  const compiled = compileSellerRoutes(originals.map(({ route, offer }) => ({ id: route.id, offer,maxRequestBytes:route.maxRequestBytes,
    handler: async () => { throw new Error('Client generation has no application handler'); },
  })), { allowLocalhost: local });
  const operations = compiled.routes.map(route => {
    const original = originals.find(value => value.route.id === route.id);
    const openApiPath = route.binding.segments.map(segment => segment.startsWith(':') ? `{${segment.slice(1)}}` : segment).join('/');
    if (original.route.path !== route.path || original.path !== openApiPath ||
        original.route.method !== route.method || original.route.samplePath !== route.binding.samplePath)
      throw new TypeError(`Operation ${route.id} path does not match the original compiler`);
    const root = route.offer.extensions.bazaar.schema;
    const querySchemas = propertySchemas(root, 'input', root).flatMap(input => propertySchemas(input, 'queryParams', root));
    const requiredQuery = [...new Set(querySchemas.flatMap(schema => [...requiredNames(schema, root)]))].sort();
    const inputs=propertySchemas(root,'input',root);
    return { id: route.id, method: route.method, path: route.path, pathNames: [...route.binding.names],
      bodyType:route.offer.extensions.bazaar.info.input.bodyType??null,
      bodyRequired:inputs.some(input=>requiredNames(input,root).has('body')),maxRequestBytes:route.maxRequestBytes??1048576,
      requiredQuery, offer: structuredClone(route.offer) };
  });
  return { schema: 'stellar-forge.seller-client.v1', sourceSha256,
    mode: specification['x-seller-runtime'],
    title: typeof specification.info?.title === 'string' ? specification.info.title : 'Starforge seller API',
    origin, operations };
}

function guide(snapshot) {
  const id = JSON.stringify(snapshot.operations[0].id);
  return `# ${snapshot.title.replace(/[\r\n]/g, ' ')} — customer client

This package binds requests to the original seller OpenAPI export with SHA-256
\`${snapshot.sourceSha256}\`. Its configured origin is \`${snapshot.origin}\`
and recorded runtime mode is \`${snapshot.mode}\`. That saved mode is not a current
availability or settlement observation. Keep seller-client.mjs and seller-client.d.mts
together for JavaScript execution and TypeScript autocomplete.

## Build a request

\`buildRequest(operationId, inputs, authorization)\` is offline. The exact operation
IDs are listed in \`operations\` and the declaration file. Supply \`inputs.path\`
for dynamic paths, \`inputs.query\` as scalar text or nonempty arrays of textual items, and
an explicit JSON \`inputs.body\` for JSON POST, PUT or PATCH. Multipart operations
use \`inputs.multipart = {body: retainedUint8Array, contentType: exactContentType}\`.
Prepare and review those bytes once with the merchant workspace or the original
SF88 \`--prepare --form-file … --form-out …\` command. The content type must retain
that file's exact boundary. The client copies the selected bytes before returning
the request. Optional request bodies may use \`inputs.omitBody = true\` explicitly;
required bodies cannot be omitted. GET, HEAD and DELETE cannot contain a body.

\`\`\`js
import { buildRequest, operations } from './seller-client.mjs';
const request = buildRequest(${id}, yourOperationInputs, {
  intentId: 'your-stable-business-operation-id',
  acceptIndex: 0, // Choose the intended original option explicitly.
  maxAtomic: 'YOUR_EXPLICIT_ATOMIC_SPEND_CEILING',
});
\`\`\`

No URL, method, asset, network, recipient or timeout override is accepted. The
caller explicitly supplies the atomic spend ceiling; saved advertised prices do
not authorize a purchase. If an operation has multiple advertised payment choices,
authorization must include an explicit zero-based \`acceptIndex\`; it has no default
in that case. The selected option supplies the exact original payment identity.
Inputs are serialized by the original SF30 developer
request builder. Saved query serialization determines whether array items become
repeated keys or one comma-separated field. Textual numeric and boolean values
are checked against the declared type; explicit null and empty arrays have no
implicit wire representation. Offers without serialization metadata retain their
existing raw string/repeated-key behavior. JSON bodies reject lossy values and cycles. Body bytes must fit
the merchant's exported request limit (1 MiB by default, up to 16 MiB).
Input declarations project advertised Bazaar metadata; numeric ranges, patterns
and the application's complete business constraints remain with the seller.
Response types remain the existing buyer's types, never inferred from examples.

Payment flow defaults to authorization. For an original offer that explicitly
advertises upfront payment, add \`paymentFlow: 'upfront'\` to the authorization
object. The runtime requires that choice to match the selected saved offer and
passes it to the original buyer's fresh-offer review. Upfront settlement can
precede application generation and can remain charged after a delivery failure.

## Use your existing buyer

\`\`\`js
import { createSellerClient } from './seller-client.mjs';
const api = createSellerClient({ buyer: configuredBuyer });
const outcome = await api.call(${id}, yourOperationInputs, {
  intentId: 'your-stable-business-operation-id',
  acceptIndex: 0, // Choose the intended original option explicitly.
  maxAtomic: 'YOUR_EXPLICIT_ATOMIC_SPEND_CEILING',
  // Optional original SF31 callbacks when not already owned by your buyer:
  approve: yourExistingApproval,
  sign: yourExistingOfficialSigner,
  signal: yourAbortController.signal,
});
\`\`\`

The injected buyer must expose \`call(request)\`. The original SF31
\`X402BuyerClient\` requires \`approve\` and \`sign\` callbacks in each request;
operator wrappers may own those callbacks themselves. This package implements
no buyer transport, signer, wallet, payment verification, budget journal or retry.
It delegates once and returns the original result or error unchanged. Retain the
original approval, spend governor and receipt/reconciliation integration used
by your application. A failed download or unknown payment result does not
authorize another purchase or a new operation ID.

## Streamed event and record resources

An operation whose saved \`offer.resource.mimeType\` is \`text/event-stream\`
or \`application/x-ndjson\` retains that media type in the request and original
OpenAPI. Its Bazaar output example describes a record. Configure the existing
Node buyer's \`responseFile.stream\` to select \`sse\` or \`ndjson\`, record limits
and retained output. A wrapper may delegate
\`call: request => buyer.call(request, { responseFile: { stream: { format: 'sse' } } })\`
while preserving that buyer's already configured private output path and limits.
The buyer owns incremental record parsing, payment receipts, complete or partial
bytes and final outcome. This generated module retains its single delegation;
it never reconnects or purchases another stream automatically.

Only the saved seller origin is used. A local generated client retains its actual
loopback origin and port; configure the original SF31 buyer's allowLocal option
only for that local development session. Export again from the intended public
seller before distributing a deployed client. The raw OpenAPI file and hash are
source identity, not a signature or proof of seller control.

Generated code does not fetch, sign or make any request when imported, when
\`buildRequest\` is called, or when a client is constructed. Only an explicit
\`api.call\` delegates to the existing buyer. The browser developer explorer
continues to make unpaid requests only.

MIT. Generated from the original Starforge SF30 developer workspace.
`;
}

/** Original snapshot validation, also used when inspecting retained customer files. */
export function sellerClientSnapshot(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input ?? []);
  if (!bytes.length || bytes.length > LIMIT) throw new RangeError('OpenAPI source must be 1 byte–16 MiB');
  const specification = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return makeSnapshot(specification, createHash('sha256').update(bytes).digest('hex'));
}

/** Exact bytes in; standalone source and declaration artifacts out. No I/O beyond source reads. */
export function generateSellerClient(input) {
  const snapshot = sellerClientSnapshot(input);
  const runtime = runtimeSource.replace(runtimeImport, standaloneRequestSource.replace(/^export /gm, ''))
    .replace('export function createClientRuntime', 'function createClientRuntime');
  const javascript = `// MIT. Generated from original SF30 seller OpenAPI SHA-256 ${snapshot.sourceSha256}.\n` + runtime +
    '\nconst generated = createClientRuntime(JSON.parse(' + JSON.stringify(JSON.stringify(snapshot)) + '));\n' +
    'export const source = generated.source;\nexport const operations = generated.operations;\n' +
    'export const buildRequest = generated.buildRequest;\nexport const createSellerClient = generated.createSellerClient;\n';
  const declarations = generateClientDeclarations(snapshot);
  return { snapshot, javascript, declarations, readme: guide(snapshot),
    packageJson: JSON.stringify({ name: 'starforge-seller-client', version: '0.0.0', private: true,
      type: 'module', main: './seller-client.mjs', types: './seller-client.d.mts',
      exports: { '.': { types: './seller-client.d.mts', import: './seller-client.mjs' } },
      license: 'MIT', description: 'Generated customer client for the configured Starforge seller API' }, null, 2) + '\n',
  };
}
