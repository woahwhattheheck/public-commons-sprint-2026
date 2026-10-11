// MIT. Routescan's original gas aggregation contract compiled into original SF30 offers.
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { compileHttpSellerOffer } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';

export const SCHEMA = 'stellar-forge.routescan-merchant.v1';
export const PROVIDER_ORIGIN = 'https://api.routescan.io';
export const SOURCE_URL = 'https://api.routescan.io/v2/documentation/json';
export const FILTERS = Object.freeze(['ecosystem', 'includedChainIds', 'excludedChainIds']);
export const UNITS = Object.freeze(['second', 'minute', 'hour', 'day']);
export const OPERATIONS = Object.freeze({
  series: { suffix: '/aggregations/avg-gas-price', description: 'Average gas price series',
    response: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
  total: { suffix: '/aggregations/avg-gas-price/tot', description: 'Average gas price over the selected days',
    response: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
});
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fail = (message, status = 400, code = 'ROUTESCAN_INVALID') => {
  throw Object.assign(new Error(message), { status, code });
};
const own = (value, key) => Object.hasOwn(value, key);
function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid ' + label + '.');
}
function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('Invalid ' + label + '.');
  return value;
}
function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('Invalid ' + label + '.');
  return value;
}
export function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail(label + ' must be a complete ISO timestamp with a timezone.');
  // Validate calendar dates as well as Date.parse's normalized timestamp.
  const date = value.slice(0, 10), parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('Invalid ' + label + ' calendar date.');
  return value;
}
export function requestFor(compiled, id, supplied) {
  const product = compiled.products.find(item => item.id === id);
  if (!product) fail('Choose a configured gas product.');
  const allowed = [...(product.operation === 'series' ? ['dateFrom', 'dateTo', 'unit'] : ['dateFrom', 'dateTo']), ...FILTERS];
  fields(supplied, allowed, 'gas request');
  for (const name of ['dateFrom', 'dateTo']) instant(supplied[name], name);
  const duration = Date.parse(supplied.dateTo) - Date.parse(supplied.dateFrom);
  if (duration <= 0 || duration > compiled.config.maxRangeDays * 86400000)
    fail('Select a positive date range of at most ' + compiled.config.maxRangeDays + ' days.');
  if (product.operation === 'series' && !compiled.config.units.includes(supplied.unit)) fail('Choose an enabled aggregation interval.');
  if (own(supplied, 'ecosystem')) text(supplied.ecosystem, 'ecosystem filter', 80);
  for (const name of ['includedChainIds', 'excludedChainIds']) if (own(supplied, name)) {
    if (typeof supplied[name] !== 'string' || !/^[1-9]\d{0,19}(?:,[1-9]\d{0,19}){0,31}$/.test(supplied[name]))
      fail(name + ' must use comma-separated numeric chain IDs, as in the provider examples.');
  }
  const request = Object.fromEntries(allowed.filter(key => own(supplied, key)).map(key => [key, supplied[key]]));
  const path = '/v2/network/' + compiled.config.provider.network + '/evm/' + compiled.config.provider.chainId + OPERATIONS[product.operation].suffix;
  const url = new URL(path, PROVIDER_ORIGIN);
  for (const [key, value] of Object.entries(request)) url.searchParams.set(key, value);
  return { product, request, sourceUrl: url.href, path };
}

export function compileRoutescanMerchant(input) {
  fields(input, ['schema', 'title', 'publicOrigin', 'provider', 'quota', 'maxRangeDays', 'units', 'timeoutMs', 'maxResponseBytes', 'products'], 'Routescan merchant');
  if (input.schema !== SCHEMA) fail('Expected ' + SCHEMA + '.');
  const config = structuredClone(input);
  text(config.title, 'merchant title', 100);
  let origin;
  try { origin = new URL(config.publicOrigin); } catch { fail('Use the merchant public HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    fail('Use the merchant public HTTPS origin without a path.');
  fields(config.provider, ['network', 'chainId', 'account', 'apiKeyEnv'], 'provider selection');
  if (!['mainnet', 'testnet'].includes(config.provider.network) || typeof config.provider.chainId !== 'string' || !/^(?:all|[1-9]\d{0,19})$/.test(config.provider.chainId))
    fail('Choose mainnet or testnet and one explicit numeric Routescan chain ID or the operator choice all.');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(config.provider.account ?? '')) fail('Set a stable provider account label shared by its quota users.');
  if (own(config.provider, 'apiKeyEnv') && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.provider.apiKeyEnv)) fail('Use an environment name for the provider key.');
  fields(config.quota, ['requestsPerSecond', 'callsPerDay'], 'operator quota');
  integer(config.quota.requestsPerSecond, 1, 1000, 'requests per second');
  integer(config.quota.callsPerDay, 1, 100000000, 'calls per day');
  config.maxRangeDays = integer(config.maxRangeDays ?? 31, 1, 3660, 'maximum date range');
  config.timeoutMs = integer(config.timeoutMs ?? 15000, 1000, 120000, 'source timeout');
  config.maxResponseBytes = integer(config.maxResponseBytes ?? 1048576, 1024, 16777216, 'maximum source response size');
  config.units ??= ['hour', 'day'];
  if (!Array.isArray(config.units) || !config.units.length || new Set(config.units).size !== config.units.length || config.units.some(unit => !UNITS.includes(unit)))
    fail('Choose unique documented aggregation intervals.');
  if (!Array.isArray(config.products) || !config.products.length || config.products.length > 16) fail('Configure 1–16 named gas products.');
  const ids = new Set(), paths = new Set(), products = [], routes = [];
  for (const product of config.products) {
    fields(product, ['id', 'path', 'operation', 'description', 'paymentOptions', 'example'], 'gas product');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(product.id ?? '') || ids.has(product.id) || !/^\/[A-Za-z0-9_/-]+$/.test(product.path ?? '') ||
        product.path.includes('//') || product.path.startsWith('/_seller/') || paths.has(product.path) || !own(OPERATIONS, product.operation)) fail('Products need unique IDs and fixed paths.');
    ids.add(product.id); paths.add(product.path); text(product.description, 'product description', 512);
    const queryParameters = [
      { name: 'dateFrom', type: 'string', required: true, description: 'Exact source range start, ISO timestamp with timezone', example: product.example?.dateFrom },
      { name: 'dateTo', type: 'string', required: true, description: 'Exact source range end, ISO timestamp with timezone', example: product.example?.dateTo },
      ...(product.operation === 'series' ? [{ name: 'unit', type: 'string', required: true, description: 'Time aggregation interval; original source value strings remain unchanged', example: product.example?.unit }] : []),
      ...FILTERS.map(name => ({ name, type: 'string', required: false,
        description: name === 'ecosystem' ? 'Optional original ecosystem filter' : 'Optional provider chain-ID array in first-party comma-separated wire format',
        example: product.example?.[name] ?? '' })),
    ];
    const offer = compileHttpSellerOffer({ url: config.publicOrigin + product.path, method: 'GET',
      description: product.description + ' · Powered by Routescan.io APIs', serviceName: 'Routescan gas data', tags: ['gas', 'routescan'],
      paymentOptions: product.paymentOptions, queryParameters, mimeType: 'application/json' });
    const query = offer.extensions.bazaar.schema.properties.input.properties.queryParams;
    for (const name of FILTERS) {
      query.properties[name].maxLength = name === 'ecosystem' ? 80 : 671;
      if (!own(product.example ?? {}, name)) delete offer.extensions.bazaar.info.input.queryParams[name];
    }
    for (const name of ['dateFrom', 'dateTo']) query.properties[name].maxLength = 35;
    if (product.operation === 'series') query.properties.unit.enum = [...config.units];
    products.push({ ...product, offer, upstreamPath: '/v2/network/' + config.provider.network + '/evm/' + config.provider.chainId + OPERATIONS[product.operation].suffix });
    routes.push({ id: product.id, path: product.path, offer, validateInput: true, handler: product.id, admit: product.id + 'Admission' });
  }
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: config.publicOrigin,
    handlerTimeoutMs: Math.min(120000, config.timeoutMs + 1000), maxResponseBytes: config.maxResponseBytes, routes };
  const compiled = { config, products, service, inputSha256: sha256(json(config)) };
  for (const product of products) requestFor(compiled, product.id, product.example);
  // Original compiler is the authority for terms, metadata and resource schemas.
  compileSellerRoutes(routes.map(({ id, offer }) => ({ id, offer, handler: async () => ({ status: 503, body: null }) })));
  return compiled;
}
export function merchantOpenApi(compiled, mode = 'CHALLENGE_ONLY') {
  const routes = compileSellerRoutes(compiled.service.routes.map(({ id, offer }) => ({ id, offer, handler: async () => ({ status: 503, body: null }) })));
  return compileSellerOpenApi(routes, { mode });
}
export function merchantReview(compiled) {
  return { schema: 'stellar-forge.routescan-review.v1', inputSha256: compiled.inputSha256,
    title: compiled.config.title, publicOrigin: compiled.config.publicOrigin,
    source: { origin: PROVIDER_ORIGIN, schemaUrl: SOURCE_URL, ...compiled.config.provider },
    quota: compiled.config.quota, maxRangeDays: compiled.config.maxRangeDays, units: compiled.config.units,
    attribution: 'Powered by Routescan.io APIs', products: compiled.products.map(({ id, path, operation, description, offer, example, upstreamPath }) => ({
      id, path, operation, description, upstreamPath, example, paymentOptions: offer.accepts,
      outputSchema: OPERATIONS[operation].response, dateSemantics: operation === 'total' ? 'Provider total uses day-granularity date filters.' : 'Provider series uses the selected aggregation interval.',
    })) };
}
export async function readRoutescanMerchant(file) {
  const path = resolve(file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) fail('Use a regular merchant JSON file up to 1 MiB.');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) fail('Merchant JSON exceeds 1 MiB.');
  return compileRoutescanMerchant(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
