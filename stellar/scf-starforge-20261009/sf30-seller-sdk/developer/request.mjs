// MIT. Shared browser/Node request construction. No network I/O or wallet access.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = text => "'" + String(text).replace(/'/g, "'\\''") + "'";
const supportedMethods = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const jsonBodyMethods = new Set(['POST', 'PUT', 'PATCH']);

export function buildUnpaidRequest(operation, values, browserOrigin) {
  const route = operation['x-seller-route'];
  const offer = operation['x-x402-payment-required'];
  if (!route || !supportedMethods.has(route.method) || !object(values)) throw new TypeError('Seller operation and request inputs required');
  let path = route.path.split('/').map(segment => {
    if (!segment.startsWith(':')) return segment;
    const name = segment.slice(1), value = values.path?.[name];
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\?#%\x00-\x1f\x7f]/u.test(value))
      throw new TypeError(`Path parameter ${name} needs one nonempty segment without separators, percent escapes or dot navigation`);
    return encodeURIComponent(value);
  }).join('/');
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/_seller/') || /[\\?#\x00-\x1f\x7f]/.test(path))
    throw new TypeError('Invalid seller resource path');
  const browser = new URL(browserOrigin), local = new URL(path, browser);
  if (!['http:', 'https:'].includes(browser.protocol) || browser.username || browser.password || local.origin !== browser.origin || local.pathname !== path)
    throw new TypeError('Request must stay on the current seller origin');
  const query = values.query ?? {};
  if (!object(query)) throw new TypeError('Query parameters must be a JSON object');
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in === 'query' && parameter.required && !own(query, parameter.name))
      throw new TypeError(`Required query parameter missing: ${parameter.name}`);
  }
  for (const [key, value] of Object.entries(query)) {
    const items = Array.isArray(value) ? value : [value];
    if (!items.length || items.some(item => typeof item !== 'string'))
      throw new TypeError(`Query ${key} must be a string or a nonempty array of strings`);
    for (const item of items) local.searchParams.append(key, item);
  }
  const advertised = new URL(offer.resource.url);
  const publicUrl = new URL(local.pathname + local.search, advertised.origin);
  if (local.href.length > 2048 || publicUrl.href.length > 2048) throw new RangeError('Request URL exceeds the seller 2048-character limit');
  const init = { method: route.method, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } };
  let command = `curl --include --max-time 15${route.method === 'HEAD' ? ' --head' : ' --request ' + route.method} ` + quote(publicUrl.href);
  if (jsonBodyMethods.has(route.method)) {
    if (typeof values.body !== 'string') throw new TypeError('JSON body text required');
    JSON.parse(values.body);
    if (new TextEncoder().encode(values.body).length > 1024 * 1024) throw new RangeError('JSON body exceeds 1 MiB');
    init.headers['content-type'] = 'application/json'; init.body = values.body;
    command += " \\\n  --header 'Content-Type: application/json' \\\n  --data-raw " + quote(values.body);
  }
  return { url: local.href, publicUrl: publicUrl.href, init, curl: command };
}

export async function readLimitedResponse(response, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('Response exceeds the 1 MiB display limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function decodePaymentRequired(header) {
  if (typeof header !== 'string' || !header || header.length > 32768 || !/^[A-Za-z0-9+/]*={0,2}$/.test(header))
    throw new TypeError('Missing, oversized or invalid PAYMENT-REQUIRED header');
  const bytes = Uint8Array.from(atob(header), char => char.charCodeAt(0));
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value?.x402Version !== 2 || !Array.isArray(value.accepts)) throw new TypeError('Header is not an x402 v2 payment requirement');
  return value;
}
