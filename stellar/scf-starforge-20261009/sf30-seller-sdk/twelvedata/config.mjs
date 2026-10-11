// MIT. Native Twelve Data product configuration; no provider credential values.
export const PLAN_SCHEMA = 'stellar-forge.twelvedata-plan.v1';
export const CONTRACT = Object.freeze({
  openapi: 'https://api.twelvedata.com/doc/swagger/openapi.json',
  openapiSha256: 'd613c91f4a4e51600960858ae8ce30325d8b485be6489bc4fdf5ede254fc2995',
  upstream: 'https://github.com/twelvedata/mcp',
  upstreamRevision: 'd139a77ea0f7d40995e6979cd09c22dd142fbfe8',
  partners: 'https://github.com/twelvedata/mcp/blob/d139a77ea0f7d40995e6979cd09c22dd142fbfe8/PARTNERS.md',
});
export const API_ORIGIN = 'https://api.twelvedata.com';
export const INTERVALS = Object.freeze([
  '1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h', '8h', '1day', '1week', '1month',
]);
const COMMON = ['symbol', 'exchange', 'mic_code', 'country', 'type', 'prepost', 'dp'];
export const PARAMETERS = Object.freeze({
  time_series: Object.freeze([...COMMON, 'interval', 'outputsize', 'timezone', 'start_date',
    'end_date', 'date', 'order', 'previous_close', 'adjust']),
  quote: Object.freeze([...COMMON, 'interval', 'timezone', 'volume_time_period', 'eod', 'rolling_period']),
  price: Object.freeze([...COMMON]),
});
const BOOLEAN = new Set(['prepost', 'previous_close', 'eod']);
const INTEGER = new Set(['outputsize', 'dp', 'volume_time_period', 'rolling_period']);
const DATE = /^(?:\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2})?$/;
const own = (value, key) => Object.hasOwn(value, key);
export const object = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function fail(code, message = code) {
  const error = new TypeError(message); error.code = code; throw error;
}
export function fields(value, names, label) {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key)))
    fail('MARKET_CONFIG_FIELDS', 'Invalid ' + label + ' fields');
}
export function text(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\x00-\x1f\x7f]/.test(value)) fail('MARKET_TEXT_INVALID', 'Invalid ' + label);
  return value;
}
export function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('MARKET_INTEGER_INVALID', 'Invalid ' + label);
  return value;
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
    fail('MARKET_ID_INVALID', 'Use a stable 1–64 character identifier');
  return value;
}
/** Public route IDs stay unchanged; SF30 function/binding names use JS identifiers. */
export function handlerName(id, admission = false) {
  return (admission ? 'admitTd_' : 'td_') +
    Buffer.from(identifier(id),'utf8').toString('base64url').replaceAll('-','$');
}
function uniqueStrings(value, label, maximum, validate = x => text(x, label)) {
  if (!Array.isArray(value) || !value.length || value.length > maximum)
    fail('MARKET_LIST_INVALID', 'Invalid ' + label);
  const result = value.map(validate);
  if (new Set(result).size !== result.length) fail('MARKET_LIST_DUPLICATE', 'Duplicate ' + label);
  return result;
}
function symbol(value) {
  text(value, 'symbol', 80);
  // A single ticker/pair per provider call. Use exchange/mic_code separately;
  // comma batches and colon-qualified batch syntax never multiply credits.
  if (/[,;:\s]/u.test(value)) fail('MARKET_SYMBOL_INVALID', 'Use one unqualified symbol or currency pair');
  return value;
}
function timezone(value) {
  text(value, 'timezone', 100);
  if (['Exchange', 'UTC'].includes(value)) return value;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); }
  catch { fail('MARKET_TIMEZONE_INVALID', 'Use Exchange, UTC, or an IANA timezone'); }
  return value;
}
function date(value, human = false) {
  text(value, 'date', 32);
  if (human && ['today', 'yesterday'].includes(value)) return value;
  if (!DATE.test(value)) fail('MARKET_DATE_INVALID', 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss in the selected timezone');
  const [day, clock] = value.split('T');
  const [year, month, number] = day.split('-').map(Number);
  const actual = new Date(Date.UTC(year, month - 1, number));
  if (year < 1000 || actual.getUTCFullYear() !== year ||
      actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== number)
    fail('MARKET_DATE_INVALID', 'Invalid calendar date');
  if (clock) {
    const [h, m, s] = clock.split(':').map(Number);
    if (h > 23 || m > 59 || s > 59) fail('MARKET_DATE_INVALID', 'Invalid wall-clock time');
  }
  return value;
}
export function parameterValue(name, value, product, fromQuery = false) {
  if (!PARAMETERS[product.endpoint]?.includes(name)) fail('MARKET_PARAMETER_UNKNOWN', 'Undeclared provider parameter');
  if (BOOLEAN.has(name)) {
    if (fromQuery) {
      if (!['true', 'false'].includes(value)) fail('MARKET_BOOLEAN_INVALID', 'Boolean query values are true or false');
      return value === 'true';
    }
    if (typeof value !== 'boolean') fail('MARKET_BOOLEAN_INVALID');
    return value;
  }
  if (INTEGER.has(name)) {
    if (fromQuery) {
      if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) fail('MARKET_INTEGER_INVALID');
      value = Number(value);
    }
    const bounds = name === 'outputsize' ? [1, product.maxRows] : name === 'dp' ? [0, 11] :
      name === 'rolling_period' ? [1, 168] : [1, 5000];
    return integer(value, bounds[0], bounds[1], name);
  }
  if (name === 'symbol') {
    symbol(value);
    if (!product.symbols.includes(value)) fail('MARKET_SYMBOL_NOT_OFFERED', 'Symbol is outside this product');
    return value;
  }
  if (name === 'interval') {
    if (!product.intervals.includes(value)) fail('MARKET_INTERVAL_NOT_OFFERED', 'Interval is outside this product');
    return value;
  }
  if (name === 'timezone') return timezone(value);
  if (['date', 'start_date', 'end_date'].includes(name)) return date(value, name === 'date');
  if (name === 'order') {
    if (!['asc', 'desc'].includes(value)) fail('MARKET_ORDER_INVALID');
    return value;
  }
  if (name === 'adjust') {
    if (!['all', 'splits', 'dividends', 'none'].includes(value)) fail('MARKET_ADJUST_INVALID');
    return value;
  }
  text(value, name, 100);
  if (value.includes(',') || value.includes(';')) fail('MARKET_PARAMETER_INVALID', 'One selector value per parameter');
  return value;
}
export function bindMarketQuery(product, query) {
  if (!(query instanceof URLSearchParams)) fail('MARKET_QUERY_REQUIRED');
  const result = { ...product.defaults }, seen = new Set();
  for (const [name, value] of query) {
    if (!product.inputs.includes(name) || seen.has(name)) fail('MARKET_QUERY_NOT_OFFERED', 'Unknown or repeated query parameter');
    seen.add(name); result[name] = parameterValue(name, value, product, true);
  }
  if (!own(result, 'symbol')) fail('MARKET_SYMBOL_REQUIRED');
  if (product.endpoint === 'time_series' && !own(result, 'interval')) fail('MARKET_INTERVAL_REQUIRED');
  if (product.endpoint === 'time_series' && !own(result, 'outputsize')) result.outputsize = product.maxRows;
  if (own(result, 'date') && (own(result, 'start_date') || own(result, 'end_date')))
    fail('MARKET_DATE_SELECTION_CONFLICT', 'Choose date or a start/end window');
  if (result.start_date && result.end_date && result.start_date > result.end_date)
    fail('MARKET_DATE_WINDOW_REVERSED');
  if (result.prepost === true && result.interval &&
      !['1min', '5min', '15min', '30min'].includes(result.interval))
    fail('MARKET_PREPOST_INTERVAL', 'Pre/post data supports the published intraday intervals only');
  return result;
}
export function queryParameters(value) {
  const query = new URLSearchParams();
  if (!object(value)) fail('MARKET_QUERY_REQUIRED');
  for (const [key, item] of Object.entries(value)) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) fail('MARKET_QUERY_SCALAR_REQUIRED');
    query.append(key, String(item));
  }
  return query;
}
export function compileMarketPlan(raw) {
  fields(raw, ['schema', 'apiKeyEnv', 'timeoutMs', 'maxResponseBytes', 'maxInFlight',
    'maxCallsPerMinute', 'usage', 'products'], 'market plan');
  if (raw.schema !== PLAN_SCHEMA) fail('MARKET_PLAN_SCHEMA');
  const apiKeyEnv = raw.apiKeyEnv ?? 'TWELVE_DATA_API_KEY';
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv)) fail('MARKET_CREDENTIAL_NAME_INVALID');
  fields(raw.usage, ['purpose', 'authorizationReference', 'retentionSeconds'], 'data use');
  if (!['internal-evaluation', 'authorized-service'].includes(raw.usage.purpose))
    fail('MARKET_DATA_USE_INVALID', 'Choose the actual evaluation or authorized-service purpose');
  const usage = {
    purpose: raw.usage.purpose,
    retentionSeconds: integer(raw.usage.retentionSeconds, 1, 315360000, 'operator retention period'),
    ...(raw.usage.authorizationReference === undefined ? {} :
      { authorizationReference: text(raw.usage.authorizationReference, 'authorization reference', 1024) }),
  };
  if (!Array.isArray(raw.products) || !raw.products.length || raw.products.length > 32)
    fail('MARKET_PRODUCTS_REQUIRED', 'Configure 1–32 named products');
  const ids = new Set(), paths = new Set();
  const products = raw.products.map(item => {
    fields(item, ['id', 'path', 'name', 'description', 'endpoint', 'symbols', 'intervals',
      'inputs', 'defaults', 'maxRows'], 'market product');
    const id = identifier(item.id), path = text(item.path, 'route path', 256);
    if (ids.has(id) || paths.has(path) || !/^\/[A-Za-z0-9._~/-]+$/.test(path) ||
        path.includes('//') || path === '/_seller' || path.startsWith('/_seller/') ||
        new URL(path, 'https://merchant.example').pathname !== path)
      fail('MARKET_ROUTE_INVALID', 'Use unique canonical fixed route paths');
    if (!own(PARAMETERS, item.endpoint)) fail('MARKET_ENDPOINT_UNSUPPORTED');
    const product = {
      id, path, name: text(item.name, 'product name', 32),
      description: text(item.description, 'product description', 2048), endpoint: item.endpoint,
      symbols: uniqueStrings(item.symbols, 'symbols', 500, symbol),
      intervals: item.intervals === undefined ? ['1day'] :
        uniqueStrings(item.intervals, 'intervals', INTERVALS.length, value => {
          if (!INTERVALS.includes(value)) fail('MARKET_INTERVAL_INVALID'); return value;
        }),
      maxRows: integer(item.maxRows ?? 5000, 1, 5000, 'time-series row limit'),
      inputs: item.inputs ?? ['symbol'],
      defaults: {},
    };
    if (!Array.isArray(product.inputs) || product.inputs.length > 24 ||
        new Set(product.inputs).size !== product.inputs.length ||
        product.inputs.some(name => !PARAMETERS[product.endpoint].includes(name)))
      fail('MARKET_INPUTS_INVALID');
    fields(item.defaults ?? {}, PARAMETERS[product.endpoint], 'fixed/default query');
    for (const [name, value] of Object.entries(item.defaults ?? {}))
      product.defaults[name] = parameterValue(name, value, product);
    if (!product.inputs.includes('symbol') && !own(product.defaults, 'symbol'))
      fail('MARKET_SYMBOL_REQUIRED', 'Supply a fixed symbol or expose its approved selection');
    if (product.endpoint === 'time_series' && !product.inputs.includes('interval') &&
        !own(product.defaults, 'interval')) fail('MARKET_INTERVAL_REQUIRED');
    if (!/^[\x20-\x7e]+$/.test(product.name)) fail('MARKET_NAME_INVALID', 'Native service names use printable ASCII');
    ids.add(id); paths.add(path); return product;
  });
  return {
    schema: PLAN_SCHEMA, apiKeyEnv, usage, products,
    timeoutMs: integer(raw.timeoutMs ?? 30000, 1, 120000, 'provider timeout'),
    maxResponseBytes: integer(raw.maxResponseBytes ?? 1048576, 1, 1048576, 'provider response byte limit'),
    maxInFlight: integer(raw.maxInFlight ?? 4, 1, 32, 'provider concurrency'),
    maxCallsPerMinute: integer(raw.maxCallsPerMinute ?? 8, 1, 100000, 'local provider request budget'),
  };
}
export function productFor(plan, id) {
  const product = plan.products.find(item => item.id === id);
  if (!product) fail('MARKET_PRODUCT_UNKNOWN'); return product;
}
export function exampleQuery(product) {
  const sample = {};
  for (const name of product.inputs) {
    if (own(product.defaults, name)) sample[name] = product.defaults[name];
    else if (name === 'symbol') sample.symbol = product.symbols[0];
    else if (name === 'interval') sample.interval = product.intervals[0];
    else if (name === 'outputsize') sample.outputsize = Math.min(30, product.maxRows);
  }
  bindMarketQuery(product, queryParameters(sample)); return sample;
}
export function parameterDescription(name, product) {
  if (name === 'symbol') return 'One operator-approved symbol. Offered: ' + product.symbols.join(', ').slice(0,400);
  if (name === 'interval') return 'Native bar interval. Offered: ' + product.intervals.join(', ');
  if (name === 'outputsize') return 'Requested points, 1–' + product.maxRows + '; not a complete-history assertion.';
  if (name === 'timezone') return 'Exchange, UTC or IANA timezone. Daily/weekly/monthly bars remain exchange-local.';
  if (['date', 'start_date', 'end_date'].includes(name)) return 'Native date/wall-clock time interpreted in the selected provider timezone.';
  if (name === 'adjust') return 'Native adjustment mode: all, splits, dividends or none.';
  return 'Twelve Data ' + name + '; the native API and this product enforce its configured limits.';
}
export function parameterExample(name, product) {
  if (own(product.defaults, name)) return product.defaults[name];
  if (name === 'symbol') return product.symbols[0];
  if (name === 'interval') return product.intervals[0];
  if (name === 'outputsize') return Math.min(30, product.maxRows);
  if (BOOLEAN.has(name)) return false;
  if (name === 'dp') return 5;
  if (name === 'volume_time_period') return 9;
  if (name === 'rolling_period') return 24;
  if (name === 'timezone') return 'Exchange';
  if (name === 'order') return 'desc';
  if (name === 'adjust') return 'splits';
  if (['date', 'start_date', 'end_date'].includes(name)) return '2026-01-02';
  if (name === 'exchange') return 'NASDAQ';
  if (name === 'mic_code') return 'XNAS';
  if (name === 'country') return 'US';
  if (name === 'type') return 'Common Stock';
  fail('MARKET_PARAMETER_UNKNOWN');
}
export function parameterType(name) {
  return BOOLEAN.has(name) ? 'boolean' : INTEGER.has(name) ? 'integer' : 'string';
}
