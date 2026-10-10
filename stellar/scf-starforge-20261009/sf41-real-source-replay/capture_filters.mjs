// MIT. Native x402 Bazaar GET /discovery/resources filter and page-scope contract.
// Only documented read-only list filters are accepted. No query or paid-origin calls.
export const NATIVE_FILTER_KEYS = Object.freeze(['type','payTo','scheme','network','extensions']);
const MAX_FILTER_LENGTH = 256;
const textOk = value => typeof value === 'string' && value.length > 0 &&
  value.length <= MAX_FILTER_LENGTH && !/[\x00-\x1f\x7f]/.test(value) && !value.startsWith('--');

export function validateCaptureFilters(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw Error('Native capture filters must be an object');
  for (const key of Object.keys(input))
    if (!NATIVE_FILTER_KEYS.includes(key)) throw Error('Unsupported native capture filter '+key);
  const out = {};
  for (const key of NATIVE_FILTER_KEYS) {
    if (Object.hasOwn(input,key)) {
      if (!textOk(input[key])) throw Error('Invalid native capture filter '+key);
      out[key] = input[key];
    }
  }
  return out;
}

export function parseCaptureFilters(args) {
  if (!Array.isArray(args)) throw Error('Capture CLI args must be array');
  const filters = {};
  for (const key of NATIVE_FILTER_KEYS) {
    const flag = '--'+key;
    const positions = args.flatMap((x,i)=>x===flag?[i]:[]);
    if (positions.length > 1) throw Error('Duplicate native capture filter '+key);
    if (positions.length) filters[key] = args[positions[0]+1];
  }
  return validateCaptureFilters(filters);
}

export function buildNativePageURL(endpoint, inputFilters, offset, limit) {
  const filters=validateCaptureFilters(inputFilters);
  if (!Number.isSafeInteger(offset) || offset<0 ||
      !Number.isSafeInteger(limit) || limit<1 || limit>100) throw Error('Invalid native capture page');
  const url=new URL(endpoint);
  if (url.search || url.hash) throw Error('Base capture URL must have no query or fragment');
  for (const key of NATIVE_FILTER_KEYS)
    if (Object.hasOwn(filters,key)) url.searchParams.set(key,filters[key]);
  url.searchParams.set('limit',String(limit));
  url.searchParams.set('offset',String(offset));
  return url;
}

export function assertNativePageScope(url, inputFilters) {
  const filters=validateCaptureFilters(inputFilters ?? {});
  const u=url instanceof URL?url:new URL(url);
  const expected=new Set([...Object.keys(filters),'limit','offset']);
  for (const key of u.searchParams.keys()) {
    if (!expected.has(key)) throw Error('Undeclared native page query '+key);
    if (u.searchParams.getAll(key).length!==1) throw Error('Duplicate native page query '+key);
  }
  for (const key of expected) {
    if (!u.searchParams.has(key)) throw Error('Missing native page query '+key);
    if (Object.hasOwn(filters,key)&&u.searchParams.get(key)!==filters[key])
      throw Error('Native capture filter drift: '+key);
  }
  return true;
}
