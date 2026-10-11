// MIT. Blockscout token information on the original SF61 offer compiler.
import { createHash } from 'node:crypto';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { compileSellerRoutes, materializeSellerRequestOffer } from '../../sf30-seller-sdk/resource-server.mjs';

export const PLAN_SCHEMA = 'stellar-forge.blockscout-token-plan.v1';
export const CONTRACT = 'blockscout-pro-token-detail-2026-10-11';
export const ORIGIN = 'https://api.blockscout.com';
export const ADDRESS = /^0x[A-Fa-f0-9]{40}$/;
export const QUOTA_HEADERS = Object.freeze(['x-credits-remaining', 'x-ratelimit-limit',
  'x-ratelimit-remaining', 'x-ratelimit-reset']);
export const LIMITS = Object.freeze({ timeoutMs: 10000, maxResponseBytes: 1048576, maxInFlight: 5,
  dayAttempts: 1000, dayCredits: 20000, creditsPerAttempt: 20, perSecond: 5,
  minProviderCredits: 20, quotaFreshnessMs: 30000, maxRecords: 10000, maxStoredBodyBytes: 67108864 });
export const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
export const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
const fail = code => { throw error(code); };
const own = (o, k) => Object.hasOwn(o, k);
function fields(o, names, code) {
  if (!plain(o) || Object.keys(o).some(k => !names.includes(k))) fail(code);
}
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
export const planSha = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export function validatePlan(input) {
  fields(input, ['schema', 'publicOrigin', 'accountAlias', 'apiKeyEnv', 'payment', 'chains', 'limits'], 'BLOCKSCOUT_PLAN_INVALID');
  if (input.schema !== PLAN_SCHEMA) fail('BLOCKSCOUT_PLAN_SCHEMA_INVALID');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { fail('BLOCKSCOUT_MERCHANT_ORIGIN_INVALID'); }
  if (origin.protocol !== 'https:' || origin.origin !== input.publicOrigin || origin.username || origin.password ||
      origin.hostname === 'api.blockscout.com') fail('BLOCKSCOUT_MERCHANT_ORIGIN_INVALID');
  if (typeof input.accountAlias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.accountAlias))
    fail('BLOCKSCOUT_ACCOUNT_ALIAS_INVALID');
  if (typeof input.apiKeyEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,79}$/.test(input.apiKeyEnv))
    fail('BLOCKSCOUT_KEY_ENVIRONMENT_NAME_REQUIRED');
  fields(input.payment, ['network', 'asset', 'payTo', 'maxTimeoutSeconds'], 'BLOCKSCOUT_PAYMENT_INVALID');
  if (!['stellar:testnet', 'stellar:pubnet'].includes(input.payment.network)) fail('BLOCKSCOUT_STELLAR_PAYMENT_REQUIRED');
  if (!Array.isArray(input.chains) || !input.chains.length || input.chains.length > 32) fail('BLOCKSCOUT_CHAINS_INVALID');
  const seen = new Set();
  const chains = input.chains.map(row => {
    fields(row, ['chainId', 'name', 'amountAtomic'], 'BLOCKSCOUT_CHAIN_INVALID');
    if (typeof row.chainId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(row.chainId) || seen.has(row.chainId) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || /[\u0000-\u001f\u007f]/.test(row.name) ||
        typeof row.amountAtomic !== 'string' || !/^[1-9][0-9]{0,38}$/.test(row.amountAtomic)) fail('BLOCKSCOUT_CHAIN_INVALID');
    seen.add(row.chainId);
    return { chainId: row.chainId, name: row.name, amountAtomic: row.amountAtomic };
  });
  if (input.limits !== undefined) fields(input.limits, Object.keys(LIMITS), 'BLOCKSCOUT_LIMITS_INVALID');
  const limits = { ...LIMITS, ...input.limits };
  const ranges = { timeoutMs: [1000, 60000], maxResponseBytes: [1024, 1048576], maxInFlight: [1, 64],
    dayAttempts: [1, 1000000], dayCredits: [1, 1000000000], creditsPerAttempt: [1, 1000000], perSecond: [1, 1000],
    minProviderCredits: [0, 1000000000], quotaFreshnessMs: [1000, 3600000], maxRecords: [1, 1000000],
    maxStoredBodyBytes: [1048576, 1073741824] };
  if (Object.entries(ranges).some(([k, [lo, hi]]) => !integer(limits[k], lo, hi)) ||
      limits.dayCredits < limits.creditsPerAttempt || limits.maxStoredBodyBytes < limits.maxResponseBytes)
    fail('BLOCKSCOUT_LIMITS_INVALID');
  return { schema: PLAN_SCHEMA, publicOrigin: origin.origin, accountAlias: input.accountAlias,
    apiKeyEnv: input.apiKeyEnv, payment: structuredClone(input.payment), chains, limits };
}

export function tokenSchema() {
  const nullable = { type: ['string', 'null'] };
  const decimal = { ...nullable, description: 'Nonnegative decimal string; the native provider adapter enforces its exact wire format.' };
  const whole = { ...nullable, description: 'Exact integer string; retained without numeric coercion.' };
  const properties = { address_hash: { type: 'string', minLength: 42, maxLength: 42 },
    circulating_market_cap: decimal, circulating_supply: decimal, decimals: whole,
    exchange_rate: decimal, holders_count: whole, icon_url: nullable, name: nullable,
    reputation: { ...nullable, enum: [null, 'ok', 'scam'] }, symbol: nullable, total_supply: whole,
    type: { ...nullable, enum: [null, 'ERC-20', 'ERC-721', 'ERC-1155', 'ERC-404', 'ERC-7984'] }, volume_24h: decimal,
    bridge_type: { ...nullable, enum: [null, 'omni', 'amb'] },
    foreign_address: { ...nullable, minLength: 42, maxLength: 42 }, origin_chain_id: whole };
  return { type: 'object', properties, required: Object.keys(properties).slice(0, 13), additionalProperties: true };
}

export function prepareProduct(input) {
  const plan = validatePlan(input);
  const spec = { openapi: '3.1.0', info: { title: 'Blockscout token information', version: '1.0.0',
    description: 'Original EVM token information purchased using explicitly selected Stellar payment terms. Numeric strings and original response bytes are preserved.' },
    servers: [{ url: plan.publicOrigin + '/' }], paths: {} };
  const selections = [], bindings = [];
  for (const chain of plan.chains) {
    const path = '/' + chain.chainId + '/api/v2/tokens/{address_hash}';
    const id = 'blockscout_' + chain.chainId;
    spec.paths[path] = { get: { operationId: id, summary: chain.name + ' token information',
      description: 'One Blockscout PRO token-detail read. EVM chain ' + chain.chainId + '. Provider account quota and merchant attempt limits apply.',
      parameters: [{ in: 'path', name: 'address_hash', required: true,
        schema: { type: 'string', minLength: 42, maxLength: 42, description: '0x followed by exactly 40 ASCII hexadecimal digits; enforced by native admission.' },
        example: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
      responses: { '200': { description: 'Original successful Blockscout response bytes.',
        content: { 'application/json': { schema: tokenSchema() } } },
      '400': { description: 'Request fails the original route input schema, rejected before payment.' },
      '422': { description: 'Invalid token identity or request semantics, rejected before payment.' },
      '429': { description: 'Merchant or provider capacity is exhausted.' },
      '502': { description: 'Provider request or token response contract failed.' },
      '503': { description: 'Merchant paused, storage unavailable or provider recovery pending.' } } } };
    selections.push({ method: 'GET', path, serviceName: chain.name + ' token information',
      accepts: [{ scheme: 'exact', ...plan.payment, amount: chain.amountAtomic }] });
    bindings.push({ method: 'GET', path, id, handler: id, admit: 'admit_' + id, validateInput: true });
  }
  const imported = importOpenApi(spec, selections);
  return { plan, planSha256: planSha(plan), spec, selections, bindings, imported,
    service: createSellerServiceConfig(imported, bindings) };
}

export function selectedToken(plan, chainId, address) {
  const chain = plan.chains.find(row => row.chainId === chainId);
  if (!chain || typeof address !== 'string' || !ADDRESS.test(address)) fail('BLOCKSCOUT_TOKEN_SELECTION_INVALID');
  return { chainId, addressHash: address, chainName: chain.name,
    dataNetwork: 'eip155:' + chainId, paymentNetwork: plan.payment.network,
    url: plan.publicOrigin + '/' + chainId + '/api/v2/tokens/' + address,
    providerUrl: ORIGIN + '/' + chainId + '/api/v2/tokens/' + address };
}

export function admitToken(context, chainId, plan) {
  const address = context?.pathParams?.address_hash;
  try { selectedToken(plan, chainId, address); } catch { return reject(422, 'BLOCKSCOUT_TOKEN_SELECTION_INVALID'); }
  if (context.method !== 'GET' || context.body !== undefined && context.body !== null ||
      context.query && Object.keys(context.query).length || context.url?.search)
    return reject(422, 'BLOCKSCOUT_TOKEN_REQUEST_INVALID');
  return true;
}
export const reject = (status, code, retryAfter) => ({ status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store',
    ...(retryAfter === undefined ? {} : { 'retry-after': String(Math.max(1, Math.ceil(retryAfter))) }) }, body: { error: code } });

/** Resolve the exact selected template once, then use the original SF88 preparer. */
export function prepareTokenBuyer(input, { chainId, addressHash, intentId, responseOut }) {
  const prepared = prepareProduct(input), token = selectedToken(prepared.plan, chainId, addressHash);
  const index = prepared.plan.chains.findIndex(row => row.chainId === chainId);
  const compiled = compileSellerRoutes(prepared.service.routes.map(row => ({ ...row, admit: undefined, handler: async () => {} })));
  const listing = materializeSellerRequestOffer(compiled.routes[index], new URL(token.url), { address_hash: addressHash });
  const raw = Buffer.from(JSON.stringify({ resources: [listing] }) + '\n');
  const review = prepareReview(raw, { rowIndex: 0, acceptIndex: 0, intentId, url: token.url, method: 'GET',
    ...(responseOut === undefined ? {} : { responseOut }) });
  return { ...review, token, planSha256: prepared.planSha256, discoveryBytes: raw };
}

/** Native provider wire checks alongside the original bounded SF25 schema. */
export function validateTokenValue(value, address) {
  if (!ADDRESS.test(value.address_hash) || value.address_hash.toLowerCase() !== address.toLowerCase())
    return 'BLOCKSCOUT_TOKEN_IDENTITY_MISMATCH';
  const decimal = /^(?:[1-9][0-9]*|0)(?:\.[0-9]+)?$/;
  const whole = /^-?(?:[1-9][0-9]*|0)$/;
  for (const key of ['circulating_market_cap', 'circulating_supply', 'exchange_rate', 'volume_24h'])
    if (value[key] !== null && !decimal.test(value[key])) return 'BLOCKSCOUT_TOKEN_CONTRACT_CHANGED';
  for (const key of ['decimals', 'holders_count', 'total_supply', 'origin_chain_id'])
    if (value[key] !== null && value[key] !== undefined && !whole.test(value[key])) return 'BLOCKSCOUT_TOKEN_CONTRACT_CHANGED';
  if (value.foreign_address !== null && value.foreign_address !== undefined && !ADDRESS.test(value.foreign_address))
    return 'BLOCKSCOUT_TOKEN_CONTRACT_CHANGED';
  if (value.icon_url !== null) { try { new URL(value.icon_url); } catch { return 'BLOCKSCOUT_TOKEN_CONTRACT_CHANGED'; } }
  return null;
}
