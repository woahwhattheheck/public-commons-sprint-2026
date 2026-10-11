// MIT. Public, offline merchant plan; original SF61 generates SF30 offers/service.
import { lstat, readFile } from 'node:fs/promises';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';
import { compileUpstreamBindings, upstreamCredentialReferences } from '../upstream.mjs';
import { compileAvailabilityPolicy } from '../upstream-readiness.mjs';
import { METHODS, LIMITS, NETWORKS, requestSchema, exampleRequest,
  responseSchema } from './stellar.mjs';

export const PLAN_SCHEMA = 'stellar-forge.stellar-jsonrpc-merchant.v1';
export { METHODS, LIMITS, NETWORKS };
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new TypeError(message); };
const envName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(name);
function fields(value, names, label) {
  if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) fail('Invalid ' + label + ' fields');
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Invalid ' + name);
}
export async function readPlan(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 131072) fail('Plan must be a regular JSON file up to 128 KiB');
  const data = await readFile(path);
  if (data.length > 131072) fail('Plan exceeds 128 KiB');
  return validatePlan(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
}

export function validatePlan(input) {
  fields(input, ['schema', 'publicOrigin', 'dataNetwork', 'endpointEnv', 'headerEnv',
    'oauth2', 'payment', 'operations', 'limits', 'upstreamAvailability'], 'RPC plan');
  if (input.schema !== PLAN_SCHEMA) fail('Expected ' + PLAN_SCHEMA);
  if (!Object.hasOwn(NETWORKS, input.dataNetwork)) fail('Select stellar:pubnet or stellar:testnet data');
  if (!envName(input.endpointEnv)) fail('endpointEnv must name a private environment variable');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { fail('Canonical public merchant HTTPS origin required'); }
  if (origin.protocol !== 'https:' || input.publicOrigin !== origin.origin || origin.username || origin.password)
    fail('Canonical public merchant HTTPS origin required');
  fields(input.payment, ['network', 'asset', 'payTo', 'maxTimeoutSeconds'], 'payment');
  const limits = { ...LIMITS, ...(input.limits ?? {}) };
  if (input.limits !== undefined) fields(input.limits, Object.keys(LIMITS), 'limits');
  for (const [name, min, max] of [['timeoutMs', 1000, 60000], ['maxResponseBytes', 1024, 1048576],
    ['maxInFlight', 1, 64], ['maxEventPage', 1, 10000], ['maxTransactionPage', 1, 200],
    ['maxLedgerKeys', 1, 200], ['maxLedgerPage', 1, 200]]) integer(limits[name], min, max, name);
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > METHODS.length)
    fail('Choose explicit Stellar read products with atomic prices');
  const selected = new Set();
  const operations = input.operations.map(row => {
    fields(row, ['method', 'amountAtomic'], 'operation');
    if (!METHODS.includes(row.method) || selected.has(row.method)) fail('Unknown or duplicate Stellar read method');
    selected.add(row.method);
    if (typeof row.amountAtomic !== 'string' || !/^[1-9][0-9]{0,38}$/.test(row.amountAtomic))
      fail('Set a positive atomic-unit price for every selected product');
    return { method: row.method, amountAtomic: row.amountAtomic };
  });
  const auth = {
    ...(input.headerEnv === undefined ? {} : { headerEnv: structuredClone(input.headerEnv) }),
    ...(input.oauth2 === undefined ? {} : { oauth2: structuredClone(input.oauth2) }),
  };
  // Exercise ORIGINAL declaration validation with local placeholder values only.
  // This never reads process.env or constructs a provider or network request.
  const declaration = { schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    declaration: { origin: 'https://rpc.example', path: '/rpc', method: 'POST', ...auth },
  } };
  const references = upstreamCredentialReferences(declaration);
  if (references.some(name => !envName(name))) fail('Invalid credential environment reference');
  compileUpstreamBindings(declaration, { env: Object.fromEntries(references.map(name => [name, 'offline-declaration-value'])) });
  const upstreamAvailability = input.upstreamAvailability === undefined ? undefined :
    compileAvailabilityPolicy(input.upstreamAvailability);
  return { schema: PLAN_SCHEMA, publicOrigin: origin.origin, dataNetwork: input.dataNetwork,
    endpointEnv: input.endpointEnv, ...auth, payment: structuredClone(input.payment),
    operations, limits, ...(upstreamAvailability === undefined ? {} : { upstreamAvailability }) };
}

export function credentialReferences(plan) {
  const references = upstreamCredentialReferences({ schema: 'stellar-forge.seller-upstreams.v1',
    bindings: { rpc: { ...(plan.headerEnv ? { headerEnv: plan.headerEnv } : {}),
      ...(plan.oauth2 ? { oauth2: plan.oauth2 } : {}) } } });
  return [...new Set([plan.endpointEnv, ...references])].sort();
}

export function prepareProduct(input) {
  const plan = validatePlan(input);
  const spec = { openapi: '3.1.0', info: { title: 'Stellar RPC read merchant', version: '1.0.0',
    description: 'Selected Stellar reads on ' + plan.dataNetwork + '. Payment network is declared separately in each original offer.' },
    servers: [{ url: plan.publicOrigin + '/' }], paths: {} };
  const selections = [], bindings = [];
  for (const { method, amountAtomic } of plan.operations) {
    const path = '/stellar/' + method;
    spec.paths[path] = { post: { operationId: method, summary: method + ' on ' + plan.dataNetwork,
      description: 'One fixed ' + method + ' read. Send the params object only. The response preserves the original JSON-RPC success envelope bytes. Every page is a separate purchase.',
      requestBody: { required: true, content: { 'application/json': {
        schema: requestSchema(method, plan.limits), example: exampleRequest(method),
      } } }, responses: {
        '200': { description: 'Original JSON-RPC result envelope. FAILED and NOT_FOUND transaction statuses describe chain data.',
          content: { 'application/json': { schema: responseSchema(method, plan.limits, plan.dataNetwork) } } },
        '422': { description: 'Request parameters rejected before payment.' },
        '502': { description: 'Provider HTTP, JSON-RPC or result contract failed.' },
        '503': { description: 'Product paused, merchant draining, or provider admission unavailable.' },
      } } };
    selections.push({ method: 'POST', path, serviceName: 'Stellar ' + method,
      accepts: [{ scheme: 'exact', ...plan.payment, amount: amountAtomic }] });
    bindings.push({ method: 'POST', path, id: method, handler: method,
      admit: 'admit' + method, validateInput: true });
  }
  const imported = importOpenApi(spec, selections);
  const service = createSellerServiceConfig(imported, bindings);
  return { plan, spec, selections, bindings, imported, service };
}
