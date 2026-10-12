// MIT. Captured unary methods compiled by the original seller and client generator.
import { mkdir, unlink, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileHttpSellerOffer } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { generateSellerClient } from '../developer/client-generator.mjs';
import { readSellerConfig } from '../serve.mjs';
import { validateGrpcConfig, validateGrpcLimits } from './config.mjs';
import { compileProtoSource } from './proto.mjs';
import { normalizeGrpcRequest, grpcMethodSchema } from './values.mjs';
import { fields, text, fail, canonical, sha256, jsonBytes, readJson, readBytes, writeNew, syncDirectory, assertProtoArchiveFits } from './common.mjs';

export const PREPARED_FILES = Object.freeze({
  'source.json': 65536, 'proto-source.json': 8388608, 'merchant-plan.json': 262144,
  'service.json': 1048576, 'bindings.json': 262144, 'methods.json': 4194304,
  'openapi.json': 16777216, 'client/seller-client.mjs': 1048576,
  'client/seller-client.d.mts': 1048576, 'client/seller-openapi.json': 16777216,
  'client/package.json': 65536, 'client/README.md': 1048576,
});
export const CUSTOMER_FILES = Object.freeze(['methods.json', 'openapi.json',
  'client/seller-client.mjs', 'client/seller-client.d.mts', 'client/seller-openapi.json',
  'client/package.json', 'client/README.md']);
const PAYMENT = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'];
const noop = () => { throw new Error('GRPC_PREPARATION_HAS_NO_APPLICATION_CALL'); };
const own = (value, name) => Object.hasOwn(value, name);
function payment(value) {
  if (own(value, 'payment') && own(value, 'paymentOptions')) fail('GRPC_PAYMENT_DECLARATION_AMBIGUOUS');
  if (!own(value, 'payment') && !own(value, 'paymentOptions')) return null;
  const options = own(value, 'payment') ? [value.payment] : value.paymentOptions;
  if (!Array.isArray(options) || !options.length) fail('GRPC_COMPLETE_PAYMENT_TERMS_REQUIRED');
  for (const item of options) fields(item, PAYMENT, 'GRPC_PAYMENT_FIELDS_INVALID');
  return structuredClone(own(value, 'payment') ? { payment: options[0] } : { paymentOptions: options });
}
const MAP_SCHEMA_KEYS = new Set(['properties', '$defs', 'definitions']);
const CHILD_SCHEMA_KEYS = new Set(['items', 'additionalProperties', 'not', 'propertyNames']);
const LIST_SCHEMA_KEYS = new Set(['anyOf', 'allOf', 'oneOf']);
export function rebaseGrpcSchema(value, prefix) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return structuredClone(value);
  const result = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (key === '$id' || key === '$schema') continue;
    if (key === '$ref') {
      if (typeof child !== 'string' || child !== '#' && !child.startsWith('#/')) fail('GRPC_LOCAL_SCHEMA_REFERENCE_REQUIRED');
      result[key] = prefix + child.slice(1);
    } else if (MAP_SCHEMA_KEYS.has(key)) result[key] = Object.fromEntries(Object.entries(child).map(([name, schema]) =>
      [name, rebaseGrpcSchema(schema, prefix)]));
    else if (CHILD_SCHEMA_KEYS.has(key)) result[key] = rebaseGrpcSchema(child, prefix);
    else if (LIST_SCHEMA_KEYS.has(key)) result[key] = child.map(schema => rebaseGrpcSchema(schema, prefix));
    else result[key] = structuredClone(child);
  }
  return result;
}
export function compileGrpcMerchantPlan(contract, plan, { limits: configuredLimits } = {}) {
  const limits = validateGrpcLimits(configuredLimits);
  fields(plan, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'GRPC_PLAN_FIELDS_INVALID');
  if (plan.schema !== 'stellar-forge.grpc-merchant-plan.v1' || !Array.isArray(plan.routes) ||
      plan.routes.length < 1 || plan.routes.length > 64) fail('GRPC_PLAN_SCHEMA_INVALID');
  const origin = new URL(text(plan.publicOrigin, 'GRPC_PUBLIC_ORIGIN_REQUIRED'));
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash || origin.origin !== plan.publicOrigin.replace(/\/$/, ''))
    fail('GRPC_PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const inherited = payment(plan), ids = new Set(), bindings = Object.create(null), methods = Object.create(null);
  const routes = plan.routes.map((route, index) => {
    fields(route, ['id', 'path', 'grpcMethod', 'serviceName', 'description', 'tags', 'example',
      'payment', 'paymentOptions'], 'GRPC_ROUTE_FIELDS_INVALID');
    if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id) || ids.has(route.id))
      fail('GRPC_ROUTE_ID_INVALID');
    if (typeof route.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]*$/.test(route.path) ||
        route.path.startsWith('/_seller/') || route.path === '/_seller' || route.path.includes('//') ||
        new URL(route.path, origin).pathname !== route.path) fail('GRPC_PUBLIC_PATH_INVALID');
    const selected = contract.methods[route.grpcMethod];
    if (!selected || selected.requestStream || selected.responseStream) fail('GRPC_APPROVED_UNARY_METHOD_REQUIRED');
    const example = normalizeGrpcRequest(contract, route.grpcMethod, route.example);
    const terms = payment(route) ?? inherited;
    if (!terms) fail('GRPC_COMPLETE_PAYMENT_TERMS_REQUIRED');
    const schema = grpcMethodSchema(contract, route.grpcMethod);
    if (!schema?.request || !schema?.response) fail('GRPC_METHOD_SCHEMA_REQUIRED');
    const offer = compileHttpSellerOffer({ url: origin.origin + route.path, method: 'POST', bodyType: 'json', body: example,
      serviceName: text(route.serviceName, 'GRPC_SERVICE_NAME_REQUIRED', 32),
      description: text(route.description, 'GRPC_DESCRIPTION_REQUIRED', 2048),
      ...(route.tags === undefined ? {} : { tags: route.tags }), ...terms });
    const input = offer.extensions.bazaar.schema.properties.input;
    input.properties.body = rebaseGrpcSchema(schema.request, '#/properties/input/properties/body');
    if (!input.required.includes('body')) input.required.push('body');
    offer.extensions.bazaar.schema.properties.output.properties.example =
      rebaseGrpcSchema(schema.response, '#/properties/output/properties/example');
    ids.add(route.id);
    bindings[route.id] = { method: route.grpcMethod };
    methods[route.id] = { method: route.grpcMethod, requestType: selected.requestType,
      responseType: selected.responseType, request: schema.request, response: schema.response };
    return { id: route.id, path: route.path, handler: 'grpcCall' + index, admit: 'grpcAdmit' + index,
      validateInput: true, maxRequestBytes: limits.maxJsonRequestBytes, offer };
  });
  // Preserve the native source's complete terms and the original buyer header,
  // route collision, request-schema and public-origin admission limits.
  compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer, handler: noop, admit: noop, maxRequestBytes: route.maxRequestBytes })));
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin,
    handlerTimeoutMs: limits.timeoutMs, requestTimeoutMs: limits.timeoutMs + 120000,
    maxRequestBytes: limits.maxJsonRequestBytes, maxResponseBytes: limits.maxJsonResponseBytes, routes };
  jsonBytes(service);
  return { service, bindings, methods: { schema: 'stellar-forge.grpc-public-methods.v1', routes: methods } };
}
function openApiFor(bundle) {
  const compiled = compileSellerRoutes(bundle.service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler: noop, admit: noop, maxRequestBytes: route.maxRequestBytes })));
  return compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
}

export async function prepareGrpcSeller({ source, protoSource, plan, directory, sourceFile, protoFile, planFile } = {}) {
  const connection = validateGrpcConfig(source ?? await readJson(sourceFile, 65536));
  const captured = protoSource ?? await readJson(protoFile, 8388608);
  const requested = plan ?? await readJson(planFile, 262144);
  const contract = compileProtoSource(assertProtoArchiveFits(captured)), bundle = compileGrpcMerchantPlan(contract, requested, { limits: connection.limits });
  const target = resolve(text(directory, 'GRPC_PREPARED_DIRECTORY_REQUIRED', 4096));
  const documents = { 'source.json': connection, 'proto-source.json': contract.source, 'merchant-plan.json': requested,
    'service.json': bundle.service, 'bindings.json': bundle.bindings, 'methods.json': bundle.methods,
    'openapi.json': openApiFor(bundle) };
  // Validate every retained source/example and size before publishing a folder.
  for (const [name, value] of Object.entries(documents)) jsonBytes(value, PREPARED_FILES[name]);
  await mkdir(target, { mode: 0o700 });
  try {
    await writeNew(join(target, 'INCOMPLETE'), 'The captured gRPC merchant has not finished preparing.\n');
    for (const [name, value] of Object.entries(documents))
      await writeNew(join(target, name), jsonBytes(value, PREPARED_FILES[name]));
    await exportSellerClient({ openapi: join(target, 'openapi.json'), out: join(target, 'client') });
    await readSellerConfig(join(target, 'service.json'));
    const files = Object.create(null);
    for (const [name, cap] of Object.entries(PREPARED_FILES)) {
      const bytes = await readBytes(join(target, name), cap);
      files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
    const manifest = { schema: 'stellar-forge.grpc-prepared.v1', protoSha256: contract.source.sha256,
      sourceSha256: sha256(canonical(connection)), planSha256: sha256(canonical(requested)), files };
    await writeNew(join(target, 'prepared.json'), jsonBytes(manifest, 65536));
    await unlink(join(target, 'INCOMPLETE')); await syncDirectory(target);
    return { directory: target, ...manifest, routes: bundle.service.routes.map(route => ({
      id: route.id, method: bundle.bindings[route.id].method, url: route.offer.resource.url,
      paymentOptions: structuredClone(route.offer.accepts) })) };
  } catch (issue) {
    // This function owns the newly created destination only. A caller can retry
    // a retained source/plan into another new folder after an interrupted write.
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw issue;
  }
}
export async function readGrpcPrepared(directory) {
  const target = resolve(directory);
  try { await readBytes(join(target, 'INCOMPLETE'), 1024); fail('GRPC_PREPARATION_INCOMPLETE', 409); }
  catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  const manifest = await readJson(join(target, 'prepared.json'), 65536);
  fields(manifest, ['schema', 'protoSha256', 'sourceSha256', 'planSha256', 'files'], 'GRPC_PREPARED_MANIFEST_INVALID');
  if (manifest.schema !== 'stellar-forge.grpc-prepared.v1' ||
      canonical(Object.keys(manifest.files ?? {}).sort()) !== canonical(Object.keys(PREPARED_FILES).sort()))
    fail('GRPC_PREPARED_FILES_INVALID', 409);
  const documents = Object.create(null), retained = Object.create(null);
  for (const [name, cap] of Object.entries(PREPARED_FILES)) {
    const bytes = await readBytes(join(target, name), cap), expected = manifest.files[name];
    if (expected.bytes !== bytes.length || expected.sha256 !== sha256(bytes)) fail('GRPC_PREPARED_FILE_CHANGED', 409);
    retained[name] = bytes;
    if (name.endsWith('.json') && !name.startsWith('client/'))
      documents[name] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const source = validateGrpcConfig(documents['source.json']);
  const contract = compileProtoSource(documents['proto-source.json']);
  const plan = documents['merchant-plan.json'], bundle = compileGrpcMerchantPlan(contract, plan, { limits: source.limits });
  if (manifest.protoSha256 !== contract.source.sha256 || manifest.sourceSha256 !== sha256(canonical(source)) ||
      manifest.planSha256 !== sha256(canonical(plan)) || canonical(bundle.service) !== canonical(documents['service.json']) ||
      canonical(bundle.bindings) !== canonical(documents['bindings.json']) ||
      canonical(bundle.methods) !== canonical(documents['methods.json']) ||
      canonical(openApiFor(bundle)) !== canonical(documents['openapi.json'])) fail('GRPC_PREPARED_CONTRACT_CHANGED', 409);
  const client = generateSellerClient(retained['openapi.json']);
  for (const [name, expected] of [['seller-client.mjs', client.javascript], ['seller-client.d.mts', client.declarations],
    ['seller-openapi.json', retained['openapi.json']], ['package.json', client.packageJson], ['README.md', client.readme]])
    if (!retained['client/' + name].equals(Buffer.from(expected))) fail('GRPC_PREPARED_CLIENT_CHANGED', 409);
  return { directory: target, manifest, source, protoSource: contract.source, contract, plan, ...bundle };
}
