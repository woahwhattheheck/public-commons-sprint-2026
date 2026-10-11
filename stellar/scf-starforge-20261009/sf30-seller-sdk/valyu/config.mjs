// MIT. Valyu request policy and native SF30 seller metadata.
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';
import { normalizeValyuDeliveryProfile } from './delivery.mjs';

export const VALYU_PROVIDER_SCHEMA = 'stellar-forge.valyu-provider.v1';
export const VALYU_ROUTE = Object.freeze({ id: 'valyuSearch', path: '/research/search', method: 'POST' });
export const VALYU_SOURCE = Object.freeze({
  endpoint: 'https://api.valyu.ai/v1/search',
  reference: 'https://docs.valyu.ai/api-reference/endpoint/search',
  sdk: 'https://github.com/valyuAI/valyu-py/tree/b735d8df4f612b603a61cd0613807d3f89bc814f',
  response: 'https://github.com/valyuAI/valyu-py/blob/b735d8df4f612b603a61cd0613807d3f89bc814f/valyu/types/response.py',
});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const need = (value, message) => { if (!value) throw new TypeError(message); };
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const VALYU_COUNTRY_CODES = Object.freeze('ALL AR AU AT BE BR CA CL DK FI FR DE HK IN ID IT JP KR MY MX NL NZ NO CN PL PT PH RU SA ZA ES SE CH TW TR GB US'.split(' '));
export const VALYU_PRESETS = Object.freeze(['academic', 'finance', 'patent', 'transportation', 'politics', 'legal', 'health', 'genomics', 'chemistry', 'physics']);
export const VALYU_REQUEST_FIELDS = Object.freeze(['query', 'search_type', 'max_num_results', 'is_tool_call',
  'relevance_threshold', 'max_price', 'included_sources', 'excluded_sources', 'country_code', 'response_length',
  'category', 'start_date', 'end_date', 'fast_mode', 'url_only', 'source_biases', 'instructions',
  'historical_cache', 'historical_cache_strict', 'include_abstracts']);
const BASE_DEFAULTS = Object.freeze({ search_type: 'all', max_num_results: 5, is_tool_call: true,
  relevance_threshold: 0.5, response_length: 'short', fast_mode: false, url_only: false, include_abstracts: false });
const BASE_LIMITS = Object.freeze({ maxNumResults: 20, maxPriceCPM: 30, maxQueryBytes: 16000, maxSources: 100 });
function integer(value, min, max, name) {
  need(Number.isSafeInteger(value) && value >= min && value <= max, name + ' must be an integer from ' + min + ' to ' + max);
  return value;
}
function byteLength(value) { return new TextEncoder().encode(value).length; }
function text(value, name, maxBytes) {
  need(typeof value === 'string' && value.trim().length > 0 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    byteLength(value) <= maxBytes, name + ' must contain nonblank text within its UTF-8 byte limit');
  try { encodeURIComponent(value); } catch { throw new TypeError(name + ' must be valid Unicode'); }
  return value;
}
export function normalizeValyuLimits(input = {}) {
  need(plain(input) && Object.keys(input).every(key => own(BASE_LIMITS, key)), 'Unknown Valyu merchant limit');
  const limits = { ...BASE_LIMITS, ...input };
  integer(limits.maxNumResults, 1, 100, 'maxNumResults');
  integer(limits.maxQueryBytes, 1, 65536, 'maxQueryBytes');
  integer(limits.maxSources, 1, 1000, 'maxSources');
  need(typeof limits.maxPriceCPM === 'number' && Number.isFinite(limits.maxPriceCPM) &&
    limits.maxPriceCPM > 0, 'maxPriceCPM must be a positive finite provider CPM ceiling');
  return freeze(limits);
}
function domain(value) {
  return typeof value === 'string' && value.length <= 253 && value.includes('.') &&
    value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
function source(value, { presets = false, bias = false } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value !== value.trim() ||
      byteLength(value) > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (!bias && (value === 'web' || /^collection:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value))) return true;
  if (!bias && presets && VALYU_PRESETS.includes(value)) return true;
  if (!bias && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return domain(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }
  const slash = value.indexOf('/');
  return slash < 0 ? domain(value) : domain(value.slice(0, slash)) &&
    value.slice(slash + 1).length > 0 && !value.slice(slash + 1).startsWith('/');
}
function dateValue(value, historical, name) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value), name + ' requires YYYY-MM-DD or a historical-cache ISO timestamp');
  const day = value.slice(0, 10);
  const parsedDay = new Date(day + 'T00:00:00.000Z');
  need(day >= '0001-01-01' && Number.isFinite(parsedDay.valueOf()) &&
    parsedDay.toISOString().slice(0, 10) === day, name + ' contains an invalid calendar date');
  if (value.length === 10) return value;
  need(historical === true && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) &&
    Number.isFinite(Date.parse(value)), name + ' timestamps require historical_cache:true and an explicit UTC offset');
  return value;
}

/** Validate and freeze the exact snake_case provider request; never coerce a price or drop an option. */
export function normalizeValyuRequest(input, { defaults = {}, limits: limitInput = {} } = {}) {
  const limits = normalizeValyuLimits(limitInput);
  need(plain(input) && plain(defaults), 'Valyu search requires a JSON object');
  for (const [name, value] of [['request', input], ['defaults', defaults]]) {
    need(Object.keys(value).every(key => VALYU_REQUEST_FIELDS.includes(key)), 'Unknown Valyu ' + name + ' field');
  }
  need(!own(defaults, 'query'), 'The research query belongs to each request');
  const body = { ...BASE_DEFAULTS, max_num_results: Math.min(BASE_DEFAULTS.max_num_results, limits.maxNumResults), max_price: limits.maxPriceCPM, ...defaults, ...input };
  text(body.query, 'query', limits.maxQueryBytes);
  need(['all', 'web', 'proprietary', 'news'].includes(body.search_type), 'Invalid search_type');
  integer(body.max_num_results, 1, limits.maxNumResults, 'max_num_results');
  need(typeof body.max_price === 'number' && Number.isFinite(body.max_price) &&
    body.max_price > 0 && body.max_price <= limits.maxPriceCPM,
    'max_price must be positive and within the declared merchant CPM ceiling');
  need(typeof body.relevance_threshold === 'number' && Number.isFinite(body.relevance_threshold) &&
    body.relevance_threshold >= 0 && body.relevance_threshold <= 1, 'relevance_threshold must be from 0 to 1');
  for (const key of ['is_tool_call', 'fast_mode', 'url_only', 'historical_cache', 'include_abstracts'])
    if (own(body, key)) need(typeof body[key] === 'boolean', key + ' must be boolean');
  for (const key of ['included_sources', 'excluded_sources']) {
    if (!own(body, key)) continue;
    need(Array.isArray(body[key]) && body[key].length <= limits.maxSources &&
      body[key].every(value => source(value, { presets: key === 'included_sources' })),
      key + ' must contain valid domains, URLs, datasets, collections or supported include presets');
    body[key] = [...body[key]];
  }
  if (own(body, 'source_biases')) {
    need(body.source_biases === null || plain(body.source_biases), 'source_biases must be an object or null');
    if (body.source_biases !== null) {
      const entries = Object.entries(body.source_biases);
      need(entries.length <= limits.maxSources && entries.every(([key, value]) => source(key, { bias: true }) &&
        Number.isSafeInteger(value) && value >= -5 && value <= 5), 'source_biases needs domain/path keys with integer values from -5 to 5');
      body.source_biases = Object.fromEntries(entries);
    }
  }
  for (const key of ['instructions', 'category']) {
    if (!own(body, key)) continue;
    text(body[key], key, 2000);
    need([...body[key]].length <= 500, key + ' must contain at most 500 characters');
  }
  if (own(body, 'country_code')) {
    need(typeof body.country_code === 'string' && VALYU_COUNTRY_CODES.includes(body.country_code.toUpperCase()),
      'country_code is outside the provider-supported set');
    body.country_code = body.country_code.toUpperCase();
  }
  need(['short', 'medium', 'large', 'max'].includes(body.response_length) ||
    Number.isSafeInteger(body.response_length) && body.response_length > 0,
    'response_length must be short, medium, large, max or a positive integer');
  for (const key of ['start_date', 'end_date'])
    if (own(body, key)) body[key] = dateValue(body[key], body.historical_cache, key);
  if (body.start_date !== undefined && body.end_date !== undefined)
    need(Date.parse(body.start_date) <= Date.parse(body.end_date), 'start_date must not follow end_date');
  if (own(body, 'historical_cache_strict'))
    need(['off', 'prefer', 'only'].includes(body.historical_cache_strict), 'Invalid historical_cache_strict');
  need(!(body.fast_mode && body.search_type === 'proprietary'), 'fast_mode cannot search proprietary sources');
  need(!body.url_only || ['web', 'news'].includes(body.search_type), 'url_only requires web or news search_type');
  let encoded;
  try { encoded = JSON.stringify(body); } catch { throw new TypeError('Valyu search must be JSON serializable'); }
  need(byteLength(encoded) <= 65536, 'Valyu search exceeds the 64 KiB request limit');
  return freeze(body);
}

export function normalizeValyuProvider(input = {}) {
  need(plain(input) && Object.keys(input).every(key => ['schema', 'apiKeyEnv', 'defaults', 'limits',
    'timeoutMs', 'maxResponseBytes', 'maxRequestBytes', 'maxInFlight', 'deliveryProfile'].includes(key)), 'Unknown Valyu provider setting');
  need(input.schema === undefined || input.schema === VALYU_PROVIDER_SCHEMA, 'Invalid Valyu provider schema');
  const limits = normalizeValyuLimits(input.limits);
  const defaultsInput = input.defaults ?? {};
  need(plain(defaultsInput) && !own(defaultsInput, 'query'), 'Provider defaults must not contain a query');
  const defaults = { ...normalizeValyuRequest({ query: 'q' }, { defaults: defaultsInput, limits }) };
  delete defaults.query;
  const apiKeyEnv = input.apiKeyEnv ?? 'VALYU_API_KEY';
  need(typeof apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv), 'apiKeyEnv must be an environment variable name');
  return freeze({ schema: VALYU_PROVIDER_SCHEMA, apiKeyEnv, defaults, limits,
    deliveryProfile: normalizeValyuDeliveryProfile(input.deliveryProfile),
    timeoutMs: integer(input.timeoutMs ?? 60000, 1, 120000, 'timeoutMs'),
    maxResponseBytes: integer(input.maxResponseBytes ?? 8388608, 1024, 16777216, 'maxResponseBytes'),
    maxRequestBytes: integer(input.maxRequestBytes ?? 65536, 1, 65536, 'maxRequestBytes'),
    maxInFlight: integer(input.maxInFlight ?? 16, 1, 256, 'maxInFlight') });
}

/** Original Bazaar/OpenAPI schema used by the original generated customer client. */
export function valyuRequestSchema(provider = {}) {
  const { limits } = normalizeValyuProvider(provider);
  const stringList = { type: 'array', maxItems: limits.maxSources, items: { type: 'string', minLength: 1, maxLength: 2048 } };
  return { type: 'object', required: ['query'], additionalProperties: false, properties: {
    query: { type: 'string', minLength: 1, maxLength: limits.maxQueryBytes },
    search_type: { type: 'string', enum: ['all', 'web', 'proprietary', 'news'] },
    max_num_results: { type: 'integer', minimum: 1, maximum: limits.maxNumResults },
    max_price: { type: 'number', exclusiveMinimum: 0, maximum: limits.maxPriceCPM,
      description: 'Valyu provider CPM ceiling; separate from this route payment amount in atomic Stellar asset units.' },
    relevance_threshold: { type: 'number', minimum: 0, maximum: 1 },
    included_sources: structuredClone(stringList), excluded_sources: structuredClone(stringList),
    source_biases: { anyOf: [{ type: 'null' }, { type: 'object',
      description: 'Source bias entry count is bounded by the public provider maxSources policy and application admission.',
      additionalProperties: { type: 'integer', minimum: -5, maximum: 5 } }] },
    instructions: { type: 'string', minLength: 1, maxLength: 500 },
    category: { type: 'string', minLength: 1, maxLength: 500, description: 'Provider legacy category; prefer instructions.' },
    country_code: { type: 'string', enum: [...VALYU_COUNTRY_CODES] },
    response_length: { anyOf: [{ type: 'string', enum: ['short', 'medium', 'large', 'max'] }, { type: 'integer', minimum: 1 }] },
    start_date: { type: 'string', minLength: 10, maxLength: 40 },
    end_date: { type: 'string', minLength: 10, maxLength: 40 },
    historical_cache_strict: { type: 'string', enum: ['off', 'prefer', 'only'] },
    ...Object.fromEntries(['is_tool_call', 'fast_mode', 'url_only', 'historical_cache', 'include_abstracts'].map(key => [key, { type: 'boolean' }])),
  } };
}

export function createValyuServiceConfig({ publicOrigin, payment, paymentOptions, path = VALYU_ROUTE.path,
  serviceName = 'Valyu Research', provider: providerInput = {} } = {}) {
  const provider = normalizeValyuProvider(providerInput);
  need(path === VALYU_ROUTE.path, 'Valyu uses its fixed /research/search route');
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new TypeError('A public HTTPS merchant origin is required'); }
  need(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search &&
    !origin.hash && origin.pathname === '/' && typeof publicOrigin === 'string' &&
    publicOrigin.replace(/\/$/, '') === origin.origin, 'Use a canonical public HTTPS merchant origin');
  const declaredPayment = paymentOptions === undefined ? { payment } : { paymentOptions };
  need(!(payment !== undefined && paymentOptions !== undefined), 'Choose payment or paymentOptions');
  const offer = compileHttpSellerOffer({ url: origin.origin + path, method: 'POST', serviceName,
    description: 'Run research in the configured Valyu account and receive its operational record plus content covered by the declared source agreement.',
    tags: ['research', 'search', 'valyu'], ...declaredPayment, bodyType: 'json',
    body: { query: 'Current research on low energy desalination'.slice(0, provider.limits.maxQueryBytes), max_num_results: Math.min(5, provider.limits.maxNumResults) } });
  offer.extensions.bazaar.schema.properties.input.properties.body = valyuRequestSchema(provider);
  paymentRequiredResponse(offer);
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin, provider,
    maxRequestBytes: provider.maxRequestBytes, maxResponseBytes: provider.maxResponseBytes,
    handlerTimeoutMs: Math.min(300000, provider.timeoutMs + 10000),
    requestTimeoutMs: Math.min(300000, provider.timeoutMs + 60000),
    routes: [{ id: VALYU_ROUTE.id, path, offer, validateInput: true,
      maxRequestBytes: provider.maxRequestBytes, handler: 'valyuSearch', admit: 'admitValyuSearch' }] };
}


/** Validate the Valyu-specific binding before original SF30 validates its offer. */
export function validateValyuServiceConfig(config) {
  need(plain(config) && config.schema === 'stellar-forge.seller-service.v1' &&
    Array.isArray(config.routes) && config.routes.length === 1, 'Use one compiled Valyu seller route');
  const provider = normalizeValyuProvider(config.provider), route = config.routes[0];
  need(plain(route) && route.id === VALYU_ROUTE.id && route.path === VALYU_ROUTE.path &&
    route.handler === 'valyuSearch' && route.admit === 'admitValyuSearch' && route.validateInput === true &&
    plain(route.offer) && route.offer.resource?.url === config.publicOrigin + VALYU_ROUTE.path &&
    route.offer.extensions?.bazaar?.info?.input?.method === 'POST' &&
    route.offer.extensions?.bazaar?.info?.input?.bodyType === 'json',
    'The Valyu route must use its original POST JSON native offer and admission');
  need(config.maxRequestBytes === provider.maxRequestBytes &&
    config.maxResponseBytes === provider.maxResponseBytes &&
    route.maxRequestBytes === provider.maxRequestBytes,
    'Native request and response limits must match the provider policy');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  need(JSON.stringify(canonical(route.offer.extensions.bazaar.schema?.properties?.input?.properties?.body)) ===
    JSON.stringify(canonical(valyuRequestSchema(provider))), 'Recompile the native request schema after changing provider limits');
  return config;
}
