// MIT. Schema-bound merchant setup for the ORIGINAL SF105 adapter and SF30 seller.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileHttpSellerOffer } from '../../sf30-seller-sdk/seller.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../../sf30-seller-sdk/developer-portal.mjs';
import { generateSellerClient } from '../../sf30-seller-sdk/developer/client-generator.mjs';
import { compileUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';
import { readSellerConfig } from '../../sf30-seller-sdk/serve.mjs';
import { compileSubQueryMerchant, validateSubQuerySellerRoutes } from '../adapter.mjs';
import { inspectSchema, readSchemaSource, validateApprovedQueries } from './schema.mjs';
import { digest, fail, fields, jsonBytes, own, parseJson, readBytes, record, text, writeBundle } from './files.mjs';

const PLAN = 'stellar-forge.subquery-merchant-plan.v1';
const PAYMENT = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'];
const noOperation = () => { throw new Error('Merchant preparation does not execute an application request'); };

function paymentFields(value) {
  const single = own(value, 'payment'), many = own(value, 'paymentOptions');
  if (single && many) fail('PAYMENT_DECLARATION', 'Choose one complete payment or ordered paymentOptions declaration');
  if (!single && !many) return null;
  const options = many ? value.paymentOptions : [value.payment];
  if (!Array.isArray(options) || !options.length) fail('PAYMENT_DECLARATION', 'Declare at least one native payment option');
  for (const option of options) fields(option, PAYMENT, 'Native payment option');
  return structuredClone(many ? { paymentOptions: options } : { payment: options[0] });
}
function publicOrigin(value) {
  text(value, 'publicOrigin');
  let url;
  try { url = new URL(value); } catch { fail('PUBLIC_ORIGIN', 'publicOrigin must be a canonical HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.origin !== value.replace(/\/$/, ''))
    fail('PUBLIC_ORIGIN', 'publicOrigin must be a canonical HTTPS origin');
  return url.origin;
}
function variableSchema(spec, description) {
  let schema;
  const details = [text(description, 'Variable description', 512)];
  if (spec.type === 'integer') {
    schema = { type: 'integer', minimum: spec.min ?? 0, maximum: spec.max ?? 100000 };
    details.push('JSON integer, within the original inclusive bounds.');
  } else if (spec.type === 'boolean') schema = { type: 'boolean' };
  else if (spec.type === 'stellar-account') {
    schema = { type: 'string', minLength: 56, maxLength: 56 };
    details.push('Original Stellar account input: G followed by 55 uppercase base32 characters.');
  } else {
    // Original SF105 counts UTF-16 units; native Bazaar counts code points.
    // Preserve source enforcement and state its exact semantics instead of
    // emitting a stronger, incompatible minLength assertion for Unicode.
    schema = { type: 'string', maxLength: spec.max ?? 256 };
    details.push(`Original length ${spec.min ?? 1}–${spec.max ?? 256} UTF-16 code units; control characters are rejected.`);
  }
  if (own(spec, 'default')) details.push('Omission uses the merchant’s private native default.');
  else if (spec.required) details.push('Required.');
  else details.push('May be omitted.');
  return { ...schema, description: details.join(' ') };
}

/** Pure preparation. The original runtime validates the exact exported offers,
 * variables and payment choices. No environment reads, sockets or payments. */
export function compileSubQueryMerchantPlan({ schemaSource, queries, plan }) {
  fields(plan, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'Merchant plan');
  if (plan.schema !== PLAN || !Array.isArray(plan.routes) || !plan.routes.length || plan.routes.length > 16)
    fail('PLAN_SCHEMA', 'Expected subquery-merchant-plan.v1 with 1–16 routes');
  const origin = publicOrigin(plan.publicOrigin), inherited = paymentFields(plan);
  const examples = Object.create(null), ids = new Set(), operations = new Set();
  for (const route of plan.routes) {
    fields(route, ['id', 'path', 'operation', 'serviceName', 'description', 'tags', 'variables',
      'variableDescriptions', 'payment', 'paymentOptions'], 'Merchant route');
    if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id) || ids.has(route.id))
      fail('ROUTE_ID', 'Route IDs must be unique native seller identifiers');
    if (typeof route.operation !== 'string' || operations.has(route.operation))
      fail('ROUTE_OPERATION', 'Select each approved operation exactly once');
    if (typeof route.path !== 'string' || !/^\/[A-Za-z0-9_./~-]+$/.test(route.path) ||
        route.path.includes('//') || route.path === '/_seller' || route.path.startsWith('/_seller/') ||
        new URL(route.path, origin).pathname !== route.path)
      fail('ROUTE_PATH', 'Use a canonical fixed seller path outside /_seller');
    if (!record(route.variables)) fail('VARIABLE_SAMPLE', 'Provide an explicit public variables sample for every route');
    ids.add(route.id); operations.add(route.operation); examples[route.operation] = structuredClone(route.variables);
  }
  const validated = validateApprovedQueries(schemaSource, queries, { examples });
  const native = compileSubQueryMerchant(validated.queries);
  if (native.operations.length !== plan.routes.length || native.operations.some(op => !operations.has(op.name)))
    fail('ROUTE_OPERATION', 'The plan must bind every configured operation exactly once');
  // Compile the exact original transport settings without resolving credentials.
  // Runtime creation still requires the real env value and explicit loopback flag.
  const endpoint = compileUpstreamBindings({ schema: 'stellar-forge.seller-upstreams.v1', bindings: { graphql: {
    origin: queries.origin, path: queries.path, method: 'POST', query: [], responseMode: 'json',
    timeoutMs: queries.timeoutMs ?? 8000, maxResponseBytes: queries.maxResponseBytes ?? 262144,
    maxInFlight: queries.maxInFlight ?? 8,
  } } }, { allowLoopback: true, env: {} });
  if (endpoint.graphql.pathKeys.length) fail('ENDPOINT_PATH', 'The original GraphQL adapter requires a fixed backend path');
  const routes = plan.routes.map(route => {
    const operation = native.operations.find(op => op.name === route.operation);
    const variables = operation.variables ?? {};
    fields(route.variableDescriptions, Object.keys(variables), 'Variable descriptions');
    if (Object.keys(variables).some(name => !own(route.variableDescriptions, name)))
      fail('VARIABLE_DESCRIPTION', 'Describe every public buyer variable');
    const payment = paymentFields(route) ?? inherited;
    if (!payment) fail('PAYMENT_DECLARATION', 'Every route needs explicit native payment terms');
    const body = { variables: structuredClone(route.variables) };
    const offer = compileHttpSellerOffer({ url: origin + route.path, method: 'POST', bodyType: 'json', body,
      serviceName: text(route.serviceName, 'serviceName', 32), description: text(route.description, 'description'),
      ...(route.tags === undefined ? {} : { tags: route.tags }), ...payment });
    const inputSchema = offer.extensions.bazaar.schema.properties.input;
    inputSchema.properties.body = { type: 'object', properties: { variables: { type: 'object',
      properties: Object.fromEntries(Object.entries(variables).map(([name, spec]) =>
        [name, variableSchema(spec, route.variableDescriptions[name])])),
      required: Object.entries(variables).filter(([, spec]) => spec.required && !own(spec, 'default')).map(([name]) => name),
      additionalProperties: false } }, required: ['variables'], additionalProperties: false };
    if (!inputSchema.required.includes('body')) inputSchema.required.push('body');
    return { id: route.id, path: route.path, handler: operation.handler, admit: operation.admission,
      validateInput: true, offer };
  });
  const compiled = compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer,
    handler: noOperation, admit: noOperation })));
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin, routes };
  validateSubQuerySellerRoutes(service, validated.queries);
  if (jsonBytes(service).length > 1048576 || jsonBytes(validated.queries).length > 1048576)
    fail('OUTPUT_SIZE', 'Prepared service or queries exceed the original 1 MiB file limit');
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const client = generateSellerClient(jsonBytes(openapi));
  const requests = plan.routes.map(route => ({ operationId: route.id, inputs: { body: { variables: route.variables } },
    method: 'POST', url: origin + route.path }));
  const review = { schema: 'stellar-forge.subquery-onboarding-review.v1',
    source: { sourceSha256: schemaSource.sourceSha256, schemaSha256: schemaSource.schemaSha256,
      format: schemaSource.format, provenance: schemaSource.provenance },
    endpoint: { origin: validated.queries.origin, path: validated.queries.path,
      credentialRequired: Boolean(validated.queries.authorizationEnv) },
    routes: routes.map((route, index) => ({ id: route.id, method: 'POST', url: route.offer.resource.url,
      operation: plan.routes[index].operation, description: route.offer.resource.description,
      accepts: route.offer.accepts, input: route.offer.extensions.bazaar.info.input.body })),
    operations: validated.operations, mode: 'PREPARED',
    launcher: 'sf105-subquery-graphql-merchant/launch.mjs',
  };
  return { service, queries: validated.queries, review, requests, openapi, client };
}

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
function renderReview(bundle) {
  const review = bundle.review;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>GraphQL merchant setup</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#f5f5f5;margin:0}main{max-width:1080px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:20px}section{background:#fff;border:1px solid #bbb;padding:20px;margin:20px 0}table{border-collapse:collapse;width:100%}th,td{padding:9px;border:1px solid #bbb;text-align:left;vertical-align:top}th{background:#e8e8e8}pre,code{font:13px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}small{color:#555}a{color:inherit}</style>
<main><h1>GraphQL merchant setup</h1><p>Prepared configuration for the original SF105 launcher and SF30 seller. Review the selected products and native payment choices, then use the commands in RUN.md.</p>
<section><h2>Query service</h2><p>${escape(review.endpoint.origin + review.endpoint.path)}</p><p>Schema source: ${escape(review.source.provenance.kind)}. Credential environment value required: ${review.endpoint.credentialRequired ? 'yes' : 'no'}.</p><small>Schema SHA-256 ${escape(review.source.sourceSha256)}</small></section>
${review.routes.map(route => `<section><h2>${escape(route.id)}</h2><p>${escape(route.description)}</p><code>POST ${escape(route.url)}</code>
<table><thead><tr><th>Option</th><th>Network / scheme</th><th>Atomic amount</th><th>Asset / recipient</th></tr></thead><tbody>${route.accepts.map((option, index) => `<tr><td>${index}</td><td>${escape(option.network)} / ${escape(option.scheme)}</td><td>${escape(option.amount)}</td><td><code>${escape(option.asset)}<br>${escape(option.payTo)}</code></td></tr>`).join('')}</tbody></table>
<h3>Public buyer input</h3><pre>${escape(JSON.stringify(route.input, null, 2))}</pre></section>`).join('')}
<section><h2>Use the existing buyer client</h2><p>The buyer folder contains the original generated JavaScript/TypeScript client and exact OpenAPI contract. requests.json supplies each operation's input object. The buyer explicitly chooses its existing intent, payment option and atomic ceiling.</p><p>Schema validation checks the captured or supplied API contract. Start the original launcher to observe its current challenge or native runtime, and retain the actual provider result through the existing operator workflow.</p></section></main></html>\n`;
}

export async function prepareSubQuerySeller({ schemaFile, queriesFile, planFile, directory }) {
  for (const [label, value] of Object.entries({ schemaFile, queriesFile, planFile, directory })) text(value, label, 4096);
  const [schemaSource, queriesBytes, planBytes] = await Promise.all([
    readSchemaSource(schemaFile), readBytes(queriesFile), readBytes(planFile, 262144),
  ]);
  const bundle = compileSubQueryMerchantPlan({ schemaSource, queries: parseJson(queriesBytes), plan: parseJson(planBytes) });
  const launcher = fileURLToPath(new URL('../launch.mjs', import.meta.url));
  const schemaName = schemaSource.format === 'sdl' ? 'schema-source.graphql' : 'schema-source.json';
  const run = `# GraphQL merchant package\n\nUse the original SF105 launcher from your checkout or installed distribution. All files in this folder are private operator material.\n\nFrom this folder:\n\n\`\`\`sh\nnode /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs --seller service.json --queries queries.json --check\nnode /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs --seller service.json --queries queries.json --port 8423\n\`\`\`\n\nFor a configured native merchant, use the SAME launcher with its existing --facilitator HTTPS_URL option. Supply the named credential environment value at launch. A declared same-host HTTP backend additionally requires --allow-loopback-upstream. The challenge-only launch does not deliver the indexed query result.\n\nOpen review.html and buyer/README.md. buyer/requests.json contains the exact public input objects. The original generated client delegates once to the caller's configured buyer and retains its native approval, signer, payment and recovery behavior. The saved client mode is CHALLENGE_ONLY for this offline preparation; export again from the live seller for its current runtime snapshot.\n\nUse a new output directory for a changed schema, query or merchant plan. The source files and manifest preserve the version being reviewed.\n`;
  const files = [[schemaName, schemaSource.sourceBytes], ['approved-queries.original.json', queriesBytes],
    ['merchant-plan.json', planBytes], ['queries.json', jsonBytes(bundle.queries)], ['service.json', jsonBytes(bundle.service)],
    ['schema-review.json', jsonBytes(inspectSchema(schemaSource))], ['review.json', jsonBytes(bundle.review)],
    ['review.html', renderReview(bundle)], ['RUN.md', run],
    ['buyer/seller-openapi.json', jsonBytes(bundle.openapi)], ['buyer/seller-client.mjs', bundle.client.javascript],
    ['buyer/seller-client.d.mts', bundle.client.declarations], ['buyer/package.json', bundle.client.packageJson],
    ['buyer/README.md', bundle.client.readme], ['buyer/requests.json', jsonBytes(bundle.requests)]];
  const manifest = { schema: 'stellar-forge.subquery-merchant-bundle.v1', createdAt: new Date().toISOString(),
    sourceSha256: schemaSource.sourceSha256, originalQueriesSha256: digest(queriesBytes), planSha256: digest(planBytes),
    files: files.map(([name, bytes]) => ({ name, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) })) };
  files.push(['manifest.json', jsonBytes(manifest)]);
  const target = await writeBundle(directory, files);
  await readSellerConfig(resolve(target, 'service.json'));
  return { directory: target, service: resolve(target, 'service.json'), queries: resolve(target, 'queries.json'),
    client: resolve(target, 'buyer/seller-client.mjs'), review: resolve(target, 'review.html'),
    manifest: resolve(target, 'manifest.json'), launcher, routes: bundle.review.routes.map(({ id, method, url }) => ({ id, method, url })) };
}
