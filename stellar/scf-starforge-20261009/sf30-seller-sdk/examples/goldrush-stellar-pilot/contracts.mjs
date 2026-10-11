// MIT. Explicit provider policy projected onto the two retained original schemas.
import { resolve } from 'node:path';
import { here, readJson, sha256 } from './runtime.mjs';

export const OPERATIONS = Object.freeze([
  { id: 'balances', slug: 'get-token-balances-for-address',
    path: '/v1/{chainName}/address/{walletAddress}/balances_v2/',
    catalogPath: '/v1/{chain}/address/{address}/balances_v2/' },
  { id: 'transfers', slug: 'get-erc20-token-transfers-for-address',
    path: '/v1/{chainName}/address/{walletAddress}/transfers_v2/',
    catalogPath: '/v1/{chain}/address/{address}/transfers_v2/' },
]);
export const DISCOVERY_URL = 'https://x402.goldrush.dev/v1/x402/endpoints';
export const UPSTREAM_ORIGIN = 'https://api.covalenthq.com';
const PILOT_CHAINS = ['eth-mainnet', 'base-mainnet', 'arbitrum-mainnet'];
const QUOTES = ['USD','CAD','EUR','SGD','INR','JPY','VND','CNY','KRW','RUB','TRY','NGN','ARS','AUD','CHF','GBP'];
const EVM = '^0x[0-9a-fA-F]{40}$';
const exampleWallet = '0xfc43f5f9dd45258b3aff31bdbe6561d97e8b71de';
const exampleContract = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, message) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(message);
}

export function readCatalog(value) {
  if (value?.success !== true || !Array.isArray(value.data?.endpoints) ||
      value.data.endpoints.length > 512 || !object(value.data.x402)) throw new TypeError('GoldRush discovery response is not a successful endpoint catalog');
  const seen = new Set();
  for (const row of value.data.endpoints) {
    if (!object(row) || typeof row.slug !== 'string' || seen.has(row.slug)) throw new TypeError('Invalid or duplicate GoldRush endpoint identity');
    seen.add(row.slug);
  }
  return value.data;
}

export function validatePlan(plan) {
  exactKeys(plan, ['schema','publicOrigin','credentialEnv','chains','maxPageSize','operations'], 'Unknown GoldRush pilot plan field');
  if (plan.schema !== 'stellar-forge.goldrush-pilot.v1') throw new TypeError('Expected goldrush-pilot.v1');
  let origin; try { origin = new URL(plan.publicOrigin); } catch { throw new TypeError('Public merchant HTTPS origin required'); }
  if (origin.protocol !== 'https:' || plan.publicOrigin !== origin.origin || origin.username || origin.password)
    throw new TypeError('Public merchant origin must be exact HTTPS origin');
  if (origin.origin === UPSTREAM_ORIGIN || origin.origin === new URL(DISCOVERY_URL).origin)
    throw new TypeError('Select the provider-owned new Stellar service origin');
  if (typeof plan.credentialEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(plan.credentialEnv))
    throw new TypeError('Credential must be an environment variable NAME for the full Bearer header');
  if (!Array.isArray(plan.chains) || !plan.chains.length || plan.chains.length > 3 ||
      new Set(plan.chains).size !== plan.chains.length || plan.chains.some(chain => !PILOT_CHAINS.includes(chain)))
    throw new TypeError('Choose distinct pilot chains from eth-mainnet, base-mainnet, arbitrum-mainnet');
  if (!Number.isSafeInteger(plan.maxPageSize) || plan.maxPageSize < 1 || plan.maxPageSize > 100)
    throw new TypeError('maxPageSize must be 1–100');
  exactKeys(plan.operations, OPERATIONS.map(x => x.id), 'Unknown pilot operation');
  for (const { id } of OPERATIONS) {
    exactKeys(plan.operations[id], ['accepts'], 'Each operation requires explicit native accepts terms');
    if (!Array.isArray(plan.operations[id].accepts) || !plan.operations[id].accepts.length)
      throw new TypeError('Supply each operation’s original Stellar payment choices');
  }
  return structuredClone(plan);
}

/** Schema assertions come from the retained first-party contracts. Descriptive
 * annotations are omitted from the source projection; policy changes are below. */
export async function buildContract(planInput, catalogInput) {
  const plan = validatePlan(planInput), catalog = readCatalog(catalogInput);
  const sourceManifest = (await readJson(resolve(here, 'source/source-manifest.json'))).value;
  const specification = { openapi: '3.1.0', info: { title: 'GoldRush provider-owned Stellar wallet API', version: '1.0.0' },
    servers: [{ url: new URL(plan.publicOrigin).href }], security: [], paths: {} };
  const selections = [], bindings = [], upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings: {} };
  const sources = [], selectedCatalog = [];
  for (const op of OPERATIONS) {
    // SF30's existing dynamic router uses canonical paths without a trailing
    // slash. The upstream binding keeps GoldRush's original slash unchanged.
    const publicPath = op.path.replace(/\/$/, '');
    const observed = catalog.endpoints.find(row => row.slug === op.slug);
    if (!observed || observed.urlTemplate !== op.catalogPath ||
        !['fixed','linear'].includes(observed.pricing?.model)) throw new TypeError('Selected GoldRush route changed; review current provider contract: ' + op.id);
    if (observed.supportedChains !== 'ALL' && (!Array.isArray(observed.supportedChains) ||
        plan.chains.some(chain => !observed.supportedChains.includes(chain)))) throw new TypeError('Selected chain is absent from the actual endpoint catalog');
    const receipt = sourceManifest.sources.find(row => row.id === op.id);
    const source = await readJson(resolve(here, 'source', receipt.schemaFile));
    if (sha256(source.bytes) !== receipt.schemaSha256) throw new TypeError('Retained supplier schema changed: ' + op.id);
    const sourceOp = source.value.paths?.[op.path]?.get;
    if (!sourceOp || source.value.servers?.[0]?.url !== UPSTREAM_ORIGIN ||
        source.value.security?.[0]?.bearerAuth?.length !== 0) throw new TypeError('Unexpected supplier source contract');
    const route = structuredClone(sourceOp);
    route.summary = op.id === 'balances' ? 'Current wallet token balances' : 'One page of wallet token transfers';
    route.tags = ['GoldRush','wallet-data'];
    // This pilot deliberately omits block filters: independent JSON Schema
    // bounds cannot assert start <= end. Do not defer that mistake until payment.
    route.parameters = route.parameters.filter(parameter => !['starting-block','ending-block'].includes(parameter.name));
    route.security = []; // Only the provider's new front door uses native x402; upstream Bearer remains mandatory.
    for (const parameter of route.parameters) {
      const schema = parameter.schema;
      if (parameter.name === 'chainName') { schema.enum = [...plan.chains]; parameter.example = plan.chains[0]; }
      else if (parameter.name === 'walletAddress') { schema.pattern = EVM; schema.minLength = 42; schema.maxLength = 42; parameter.example = exampleWallet; }
      else if (parameter.name === 'contract-address') { schema.pattern = EVM; schema.minLength = 42; schema.maxLength = 42; parameter.example = exampleContract; }
      else if (parameter.name === 'quote-currency') { schema.enum = QUOTES; parameter.example = 'USD'; }
      else if (parameter.name === 'no-spam') parameter.example = true;
      else if (parameter.name === 'page-size') { schema.minimum = 1; schema.maximum = plan.maxPageSize; parameter.required = true; parameter.example = Math.min(50, plan.maxPageSize); }
      else if (parameter.name === 'page-number') { schema.minimum = 0; schema.maximum = Number.MAX_SAFE_INTEGER; parameter.required = true; parameter.example = 0; }
      else throw new TypeError('New provider parameter requires review: ' + parameter.name);
    }
    // The published OpenAPI describes data; the official 3.0.7 REST SDK reads
    // the wire envelope's data/error fields. Preserve the full data schema.
    const data = structuredClone(route.responses['200'].content['application/json'].schema);
    data.required = [...new Set([...(data.required ?? []), 'address','chain_id','chain_name','updated_at','items', ...(op.id === 'transfers' ? ['pagination'] : [])])];
    route.responses['200'].content['application/json'].schema = {
      type: 'object', required: ['data','error'],
      properties: { data, error: { const: false } },
    };
    specification.paths[publicPath] = { get: route };
    selections.push({ method: 'GET', path: publicPath, serviceName: 'GoldRush Stellar ' + op.id,
      accepts: plan.operations[op.id].accepts });
    bindings.push({ id: 'goldrush-' + op.id, method: 'GET', path: publicPath, handler: op.id, validateInput: true });
    upstreams.bindings[op.id] = { origin: UPSTREAM_ORIGIN,
      path: op.path.replace(/\{([^}]+)\}/g, ':$1'), method: 'GET',
      query: route.parameters.filter(x => x.in === 'query').map(x => x.name),
      headerEnv: { Authorization: plan.credentialEnv }, responseMode: 'json',
      timeoutMs: 20000, maxResponseBytes: 1048576, maxInFlight: 4 };
    sources.push({ ...receipt, operationId: sourceOp.operationId, path: op.path });
    selectedCatalog.push(structuredClone(observed));
  }
  return { plan, specification, selections, bindings, upstreams, sources, selectedCatalog,
    sourcePayment: structuredClone(catalog.x402), sourcePricing: structuredClone(catalog.pricing ?? {}),
    policyChanges: [
      'New provider-controlled public origin; original upstream remains https://api.covalenthq.com.',
      'Native public dynamic routes omit the trailing slash; the actual provider upstream routes preserve it. Use the generated native client.',
      'Provider upstream Bearer authorization remains private. Native Stellar payment authenticates the new public front door.',
      'Two explicit wallet operations and three possible EVM chains; hexadecimal addresses only in this pilot.',
      'Transfer page size and zero-based page number are explicit. One original HTTP request returns one provider page.',
      'Optional block-range filtering is omitted from this pilot; unknown query keys fail original live admission.',
      'Each upstream binding permits four concurrent requests, a 20-second response deadline and a 1 MiB response ceiling. Exceeding these limits returns an original failure, never a complete-wallet claim.',
      'Published data schema assertions are retained under the official REST response envelope; success requires error:false and core wallet fields.',
      'Provider-set Stellar tuples are independent of the observed Base catalog prices; no automatic price conversion or tier escalation.',
    ] };
}
