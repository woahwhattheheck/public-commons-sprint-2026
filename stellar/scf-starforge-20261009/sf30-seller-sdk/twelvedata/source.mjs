// MIT. Provider data uses the original SF30 upstream transport and lifecycle.
import { createUpstreamHandlers } from '../upstream.mjs';
import { compileMarketPlan, bindMarketQuery, queryParameters, productFor,
  API_ORIGIN, PARAMETERS, object, fail, handlerName } from './config.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRING_NUMBERS = ['open', 'high', 'low', 'close', 'volume', 'previous_close', 'price',
  'change', 'percent_change', 'average_volume', 'rolling_1d_change', 'rolling_7d_change',
  'rolling_change', 'extended_change', 'extended_percent_change', 'extended_price'];
function numericStrings(value) {
  for (const name of STRING_NUMBERS) {
    if (own(value, name) && value[name] !== null &&
        (typeof value[name] !== 'string' || !DECIMAL.test(value[name])))
      fail('MARKET_PROVIDER_VALUE_INVALID', 'Provider decimal fields must retain their native string or null value');
  }
}
/** Interpret identity and framing only. The caller retains the unchanged bytes. */
export function readMarketResponse(endpoint, query, bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('MARKET_PROVIDER_JSON_INVALID'); }
  if (!object(value)) fail('MARKET_PROVIDER_SHAPE_INVALID');
  if (value.status === 'error' || own(value, 'code') && own(value, 'message'))
    fail('MARKET_PROVIDER_REJECTED');
  let rows, metadata;
  if (endpoint === 'time_series') {
    if (value.status !== 'ok' || !object(value.meta) || !Array.isArray(value.values) ||
        value.values.length > Number(query.outputsize ?? 5000))
      fail('MARKET_PROVIDER_SHAPE_INVALID');
    if (typeof value.meta.symbol !== 'string' || typeof value.meta.interval !== 'string' ||
        typeof value.meta.exchange_timezone !== 'string') fail('MARKET_PROVIDER_META_INVALID');
    if (value.meta.symbol.toUpperCase() !== String(query.symbol).toUpperCase() ||
        value.meta.interval !== query.interval) fail('MARKET_PROVIDER_IDENTITY_MISMATCH');
    for (const row of value.values) {
      if (!object(row) || typeof row.datetime !== 'string' || !row.datetime ||
          !['open','high','low','close'].every(name => own(row,name)))
        fail('MARKET_PROVIDER_ROW_INVALID');
      numericStrings(row);
    }
    rows = value.values;
    metadata = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'values'));
  } else if (endpoint === 'quote') {
    if (typeof value.symbol !== 'string' || typeof value.datetime !== 'string' ||
        !own(value,'close') || !Number.isSafeInteger(value.timestamp))
      fail('MARKET_PROVIDER_SHAPE_INVALID');
    if (value.symbol.toUpperCase() !== String(query.symbol).toUpperCase())
      fail('MARKET_PROVIDER_IDENTITY_MISMATCH');
    numericStrings(value); rows = [value]; metadata = {};
  } else if (endpoint === 'price') {
    if (!own(value,'price')) fail('MARKET_PROVIDER_SHAPE_INVALID');
    numericStrings(value); rows = [value]; metadata = {};
  } else fail('MARKET_ENDPOINT_UNSUPPORTED');
  const interval = query.interval ?? value.meta?.interval ?? null;
  const daily = ['1day','1week','1month'].includes(interval);
  const requestedTimezone = query.timezone ?? 'Exchange';
  return {
    value, rows, metadata,
    semantics: {
      endpoint, requestedSymbol: query.symbol, returnedSymbol: value.meta?.symbol ?? value.symbol ?? null,
      interval, requestedTimezone,
      datetimeTimezone: daily ? (value.meta?.exchange_timezone ?? 'Exchange') :
        requestedTimezone === 'Exchange' ? (value.meta?.exchange_timezone ?? 'Exchange') : requestedTimezone,
      exchangeTimezone: value.meta?.exchange_timezone ?? null,
      datetimeMeaning: endpoint === 'price' ? 'No price timestamp is supplied by the native price endpoint.' :
        'Native bar opening date/time; capture time is recorded separately.',
      dailyTimezoneParameterIgnored: daily,
      adjustment: endpoint === 'time_series' ? (query.adjust ?? 'splits') : null,
      order: endpoint === 'time_series' ? (query.order ?? 'desc') : null,
      requestedOutputsize: endpoint === 'time_series' ? Number(query.outputsize ?? 5000) : null,
      returnedRows: rows.length,
      coverage: endpoint === 'time_series' ? 'THE_RETURNED_REQUEST_WINDOW_ONLY' : 'NATIVE_RESPONSE_ONLY',
      decimalRepresentation: 'ORIGINAL_PROVIDER_STRINGS_AND_NULLS',
    },
  };
}
const failure = (status, code, headers = {}) => ({
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  body: { error: code },
});

/** One source instance is one operator account. Admission is repeated immediately
 * before dispatch; original SF30 owns cancellation if capacity changes meanwhile. */
export function createTwelveDataSource(raw, { env = process.env, lookup, clock = Date.now } = {}) {
  const plan = compileMarketPlan(raw), key = env[plan.apiKeyEnv];
  if (typeof key !== 'string' || !key || key.length > 2048 || /[\s\x00-\x1f\x7f]/.test(key))
    fail('MARKET_API_KEY_REQUIRED', 'Supply the named Twelve Data API key through the process environment');
  const bindings = {};
  for (const product of plan.products) bindings[handlerName(product.id)] = {
    origin: API_ORIGIN, path: '/' + product.endpoint, method: 'GET',
    query: [...PARAMETERS[product.endpoint], 'format'],
    headerEnv: { Authorization: 'SF_TWELVE_DATA_AUTHORIZATION' },
    responseHeaders: ['content-type'],
    responseMode: 'json', timeoutMs: plan.timeoutMs,
    maxResponseBytes: plan.maxResponseBytes, maxInFlight: plan.maxInFlight,
  };
  const native = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1', bindings },
    { env: { SF_TWELVE_DATA_AUTHORIZATION: 'apikey ' + key }, ...(lookup ? { lookup } : {}) });
  const calls = [], totals = { started: 0, completed: 0, failed: 0, inFlight: 0 };
  let last = null, closed = false;
  function admission() {
    const instant = clock();
    while (calls.length && calls[0] <= instant - 60000) calls.shift();
    if (closed) return failure(503, 'MARKET_SOURCE_CLOSED');
    if (totals.inFlight >= plan.maxInFlight) return failure(503, 'MARKET_SOURCE_BUSY', { 'retry-after': '1' });
    if (calls.length >= plan.maxCallsPerMinute) return failure(429, 'MARKET_SOURCE_REQUEST_BUDGET',
      { 'retry-after': String(Math.max(1, Math.ceil((calls[0] + 60000 - instant) / 1000))) });
    return true;
  }
  function bindContext(product, context) {
    if (!object(context) || context.method !== 'GET' || !(context.url instanceof URL) ||
        context.url.pathname !== product.path ||
        context.pathParams && Object.keys(context.pathParams).length ||
        context.bodyPresent === true) fail('MARKET_REQUEST_INVALID');
    return bindMarketQuery(product, context.url.searchParams);
  }
  async function perform(product, context, query) {
    const admitted = admission();
    if (admitted !== true) return { response: admitted, observation: null };
    const startedAt = new Date(clock()).toISOString();
    calls.push(clock()); totals.started++; totals.inFlight++;
    const outgoing = new URL(context.url);
    outgoing.search = '';
    for (const [name, value] of Object.entries(query)) outgoing.searchParams.append(name, String(value));
    outgoing.searchParams.set('format', 'JSON');
    let response, semantics = null;
    try {
      response = await native[handlerName(product.id)]({ ...context, url: outgoing });
      if (response.status === 200) {
        try {
          if (!(response.body instanceof Uint8Array)) fail('MARKET_PROVIDER_BODY_INVALID');
          semantics = readMarketResponse(product.endpoint, query, response.body).semantics;
          response = { ...response, headers: { ...response.headers, 'cache-control': 'no-store' } };
        } catch (error) {
          response = failure(502, error.code ?? 'MARKET_PROVIDER_RESPONSE_INVALID');
        }
      }
      if (response.status !== 200) totals.failed++;
      last = {
        productId: product.id, endpoint: product.endpoint, startedAt,
        finishedAt: new Date(clock()).toISOString(), status: response.status,
        creditsUsed: response.headers?.['api-credits-used'] ?? null,
        creditsLeft: response.headers?.['api-credits-left'] ?? null,
      };
      return { response, observation: {
        ...last, providerUrl: API_ORIGIN + '/' + product.endpoint,
        query: { ...query, format: 'JSON' }, semantics,
        bodyOrigin: response.status === 200 ? 'TWELVE_DATA_NATIVE_JSON' : 'ORIGINAL_SF30_APPLICATION_ERROR',
      } };
    } finally { totals.inFlight--; totals.completed++; }
  }
  const handlers = {};
  for (const product of plan.products) {
    handlers[handlerName(product.id,true)] = context => {
      try { bindContext(product, context); return admission(); }
      catch (error) { return failure(422, error.code ?? 'MARKET_REQUEST_INVALID'); }
    };
    const handler = async context => {
      let query;
      try { query = bindContext(product, context); }
      catch (error) { return failure(422, error.code ?? 'MARKET_REQUEST_INVALID'); }
      return (await perform(product, context, query)).response;
    };
    handler.snapshot = () => native[handlerName(product.id)].snapshot();
    handlers[handlerName(product.id)] = handler;
  }
  return Object.freeze({
    plan, handlers: Object.freeze(handlers),
    inspect() { return { ...totals, closed, localCallsInWindow: calls.filter(at => at > clock()-60000).length,
      localMaxCallsPerMinute: plan.maxCallsPerMinute, last: last && { ...last } }; },
    close() { closed = true; },
    async capture(productId, input, { signal } = {}) {
      const product = productFor(plan, productId), query = bindMarketQuery(product, queryParameters(input));
      const url = new URL(product.path, 'https://operator.invalid');
      url.search = queryParameters(input).toString();
      const context = { method: 'GET', url, headers: {}, pathParams: {},
        bodyPresent: false, ...(signal ? { signal } : {}) };
      return perform(product, context, query);
    },
  });
}
