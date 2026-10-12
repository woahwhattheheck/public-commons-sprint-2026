// MIT. OpenCage's public JSON request contract; payment remains in the original seller.
import { compileUpstreamTransports } from '../upstream-transports.mjs';
export const PLAN = 'stellar-forge.opencage-plan.v1';
export const API_ORIGIN = 'https://api.opencagedata.com';
export const API_PATH = '/geocode/v1/json';
export const PARAMETERS = Object.freeze({
  forward: ['q','abbrv','address_only','bounds','countrycode','language','limit','no_annotations','no_dedupe','no_record','proximity','roadinfo'],
  reverse: ['q','abbrv','address_only','language','no_annotations','no_record','roadinfo'],
});
const FLAGS = new Set(['abbrv','address_only','no_annotations','no_dedupe','no_record','roadinfo']);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fail(code, message = code) { throw Object.assign(new Error(message), { code }); }
export function fields(value, allowed, name = 'object') {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('GEOCODE_CONFIG_INVALID', 'Invalid ' + name + ' fields');
  return value;
}
export function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    fail('GEOCODE_INPUT_INVALID', 'Invalid ' + name);
  return value.trim();
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value)) fail('GEOCODE_ID_INVALID');
  return value;
}
export function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('GEOCODE_CONFIG_INVALID', 'Invalid ' + name);
  return value;
}
export const handlerName = (id, admit = false) => 'opencage_' + Buffer.from(identifier(id)).toString('hex') + (admit ? '_admit' : '');
function coordinates(value, count, order) {
  const parts = String(value).split(',').map(part => part.trim());
  if (parts.length !== count || parts.some(part => !DECIMAL.test(part))) fail('GEOCODE_COORDINATES_INVALID');
  const numbers = parts.map(Number);
  if (numbers.some((number, index) => !Number.isFinite(number) || Math.abs(number) > (order[index] === 'lat' ? 90 : 180)))
    fail('GEOCODE_COORDINATES_INVALID');
  if (count === 4 && (numbers[0] >= numbers[2] || numbers[1] >= numbers[3])) fail('GEOCODE_BOUNDS_INVALID');
  return numbers.map(number => Object.is(number, -0) ? '0' : String(number)).join(',');
}
function parameter(name, raw, mode) {
  if (!['string','number'].includes(typeof raw)) fail('GEOCODE_INPUT_INVALID', name + ' must be a native scalar');
  const value = text(String(raw), name, name === 'q' ? 2048 : 256);
  if (name === 'q') {
    if (value.length < 2) fail('GEOCODE_QUERY_TOO_SHORT');
    return mode === 'reverse' ? coordinates(value, 2, ['lat','lon']) : value;
  }
  if (FLAGS.has(name)) {
    if (!['0','1'].includes(value)) fail('GEOCODE_INPUT_INVALID', name + ' must be 0 or 1');
    return value;
  }
  if (name === 'limit') {
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 100) fail('GEOCODE_LIMIT_INVALID');
    return String(Number(value));
  }
  if (name === 'bounds') return coordinates(value, 4, ['lon','lat','lon','lat']);
  if (name === 'proximity') return coordinates(value, 2, ['lat','lon']);
  if (name === 'countrycode') {
    if (!/^[a-z]{2}(?:,[a-z]{2})*$/i.test(value)) fail('GEOCODE_COUNTRY_INVALID');
    const codes = value.toLowerCase().split(',');
    if (new Set(codes).size !== codes.length) fail('GEOCODE_COUNTRY_INVALID');
    return codes.join(',');
  }
  if (name === 'language') {
    if (!/^(?:native|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)$/i.test(value)) fail('GEOCODE_LANGUAGE_INVALID');
    return value;
  }
  fail('GEOCODE_PARAMETER_UNSUPPORTED');
}
export function queryParameters(input) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (!object(input)) fail('GEOCODE_INPUT_INVALID');
  const params = new URLSearchParams();
  for (const [name,value] of Object.entries(input)) {
    if (!['string','number'].includes(typeof value)) fail('GEOCODE_INPUT_INVALID');
    params.append(name, String(value));
  }
  return params;
}
export function bindGeocodeQuery(product, input) {
  const params = queryParameters(input), supplied = new Map();
  for (const [name,value] of params) {
    if (!['q',...product.options].includes(name) || supplied.has(name)) fail('GEOCODE_PARAMETER_UNSUPPORTED', 'Unknown or duplicate geocoding parameter: ' + name);
    supplied.set(name, parameter(name,value,product.mode));
  }
  if (!supplied.has('q')) fail('GEOCODE_QUERY_REQUIRED');
  const result = { q: supplied.get('q') };
  for (const name of [...product.options].sort()) {
    if (supplied.has(name)) result[name] = supplied.get(name);
    else if (Object.hasOwn(product.defaults,name)) result[name] = product.defaults[name];
  }
  return result;
}
export function compileGeocodePlan(raw) {
  fields(raw,['schema','id','name','apiKeyEnv','minIntervalMs','timeoutMs','maxResponseBytes','products','transport'],'geocoding plan');
  if (raw.schema !== PLAN) fail('GEOCODE_PLAN_SCHEMA');
  const plan = {
    schema: PLAN, id: identifier(raw.id), name: text(raw.name,'name',120),
    apiKeyEnv: raw.apiKeyEnv ?? 'OPENCAGE_API_KEY',
    minIntervalMs: integer(raw.minIntervalMs ?? 1000,0,60000,'minIntervalMs'),
    timeoutMs: integer(raw.timeoutMs ?? 15000,100,60000,'timeoutMs'),
    maxResponseBytes: integer(raw.maxResponseBytes ?? 1048576,1024,1048576,'maxResponseBytes'),
    products: [],
  };
  if (typeof plan.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(plan.apiKeyEnv)) fail('GEOCODE_KEY_ENV_INVALID');
  if (raw.transport !== undefined) {
    const selected=compileUpstreamTransports({opencageHost:raw.transport},
      {provider:{transport:'opencageHost'}}).opencageHost;
    plan.transport={mode:selected.mode,...(selected.proxyEnv ? {proxyEnv:selected.proxyEnv} : {})};
  }
  if (!Array.isArray(raw.products) || raw.products.length < 1 || raw.products.length > 8) fail('GEOCODE_PRODUCTS_INVALID');
  const ids = new Set(), paths = new Set();
  for (const value of raw.products) {
    fields(value,['id','name','description','path','mode','options','defaults'],'product');
    if (!Object.hasOwn(PARAMETERS,value.mode)) fail('GEOCODE_MODE_INVALID');
    const product = {
      id: identifier(value.id), name: text(value.name,'product name',120),
      description: text(value.description ?? (value.mode === 'reverse' ? 'Reverse geocoding from WGS84 latitude,longitude.' : 'Forward geocoding from a place or address.'),'description',800),
      path: value.path, mode: value.mode, options: [], defaults: {},
    };
    if (typeof product.path !== 'string' || !/^\/[A-Za-z0-9][A-Za-z0-9/_.~-]{0,240}$/.test(product.path) ||
        product.path.includes('//') || product.path.startsWith('/_seller/') ||
        new URL(product.path,'https://merchant.invalid').pathname !== product.path) fail('GEOCODE_PATH_INVALID');
    if (ids.has(product.id) || paths.has(product.path)) fail('GEOCODE_PRODUCT_DUPLICATE');
    ids.add(product.id); paths.add(product.path);
    if (!Array.isArray(value.options) || value.options.length > 12 ||
        new Set(value.options).size !== value.options.length ||
        value.options.some(name => name === 'q' || !PARAMETERS[value.mode].includes(name))) fail('GEOCODE_OPTIONS_INVALID');
    product.options = [...value.options].sort();
    fields(value.defaults ?? {}, product.options, 'product defaults');
    for (const name of Object.keys(value.defaults ?? {}).sort()) product.defaults[name] = parameter(name,value.defaults[name],value.mode);
    plan.products.push(product);
  }
  return plan;
}
export function productFor(plan, id) {
  const product = plan.products.find(value => value.id === id);
  if (!product) fail('GEOCODE_PRODUCT_UNKNOWN');
  return product;
}
export const PARAMETER_INFO = Object.freeze({
  q: 'Address/place text for forward geocoding; decimal latitude,longitude for reverse geocoding.',
  abbrv: 'Use abbreviated formatted address (1) or the native default (0).',
  address_only: 'Exclude points of interest from formatted addresses when 1.',
  bounds: 'Forward-only southwest and northeast box: min longitude,min latitude,max longitude,max latitude.',
  countrycode: 'Forward-only ISO 3166-1 alpha-2 country codes separated by commas.',
  language: 'Preferred IETF language tag, or native; availability depends on source data.',
  limit: 'Forward-only returned candidates, 1–100. Provider default: 10.',
  no_annotations: 'Omit ordinary annotations when 1; roadinfo can still supply road annotations.',
  no_dedupe: 'Forward-only: disable the provider\'s result deduplication when 1.',
  no_record: 'Ask the provider not to log this query when 1.',
  proximity: 'Forward-only ranking bias: latitude,longitude.',
  roadinfo: 'Return road information when 1.',
});
export function exampleQuery(product) {
  return bindGeocodeQuery(product,{q:product.mode === 'reverse' ? '51.952659,7.632473' : 'Münster, Germany'});
}
export function querySchema(product) {
  return ['q',...product.options].map(name => ({
    name, in:'query', required:name === 'q', description:PARAMETER_INFO[name],
    schema: { type:'string',
      ...(name === 'q' ? {minLength:2,maxLength:2048} : FLAGS.has(name) ? {enum:['0','1']} : {}),
      ...(Object.hasOwn(product.defaults,name) ? {default:product.defaults[name]} : {}),
    },
    ...(name === 'q' ? {example:exampleQuery(product).q} : {}),
  }));
}
export const examplePlan = () => ({
  schema:PLAN,id:'location-workshare',name:'Location workshare',apiKeyEnv:'OPENCAGE_API_KEY',
  minIntervalMs:1000,timeoutMs:15000,maxResponseBytes:1048576,
  products:[
    {id:'forward',name:'Address candidates',path:'/geocode/forward',mode:'forward',
      options:['bounds','countrycode','language','limit','no_annotations','no_record','proximity'],
      defaults:{limit:'10',no_record:'1'}},
    {id:'reverse',name:'Coordinate address',path:'/geocode/reverse',mode:'reverse',
      options:['language','no_annotations','no_record','roadinfo'],defaults:{no_record:'1'}},
  ],
});
