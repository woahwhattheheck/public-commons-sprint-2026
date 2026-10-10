import { isIP } from 'node:net';
// MIT — SF-30. Seller-side declarative x402 v2 Bazaar metadata for HTTP endpoints.
// This prepares a PaymentRequired offer; only the canonical facilitator may
// authenticate payment, verify finality and promote a listing to a trusted catalog.
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const SOROBAN_I128_MAX = (1n << 127n) - 1n;
const METHODS = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const BODY = new Set(['POST', 'PUT', 'PATCH']);
const TYPES = new Set(['string', 'integer', 'number', 'boolean']);
// Avoid JavaScript prototype keys in metadata later consumed as JSON dictionaries.
const RESERVED_QUERY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const ASCII = /^[\x20-\x7e]+$/;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);
const obj = o => { if (!plain(o)) throw new TypeError('Expected plain object'); return o; };
const copy = x => structuredClone(x);
function requiredString(x, name, limit = 512) {
  if (typeof x !== 'string' || !x.trim() || x.length > limit || /[\x00-\x1f\x7f]/.test(x))
    throw new TypeError(`${name} must be nonempty printable text (max ${limit})`);
  return x;
}
function resourceUrl(raw, allowLocalhost) {
  const u = new URL(requiredString(raw, 'resource.url', 2048));
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const loopbackDev = allowLocalhost === true && u.protocol === 'http:' && host === '127.0.0.1';
  if (u.username || u.password || u.hash || u.search ||
      (u.protocol !== 'https:' && !loopbackDev))
    throw new TypeError('Paid resource URL must be HTTPS, without credentials, fragment or query');
  // Seller metadata must not advertise private destinations that SF31 buyers
  // reject. URL canonicalization also normalizes hex/octal/numeric IPv4 forms.
  const ipHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const localName = ['localhost', 'local', 'localdomain', 'internal', 'home.arpa',
    'ip6-localhost', 'ip6-loopback'].includes(host) ||
    ['.localhost', '.localhost.localdomain', '.local', '.localdomain',
      '.internal', '.home.arpa'].some(s => host.endsWith(s));
  if (!host || ((isIP(ipHost) !== 0 || localName) && !loopbackDev))
    throw new TypeError('Disallowed resource host');
  return u.href;
}
function serviceMetadata(o) {
  const result = {};
  if (o.serviceName !== undefined) {
    if (typeof o.serviceName !== 'string' || !ASCII.test(o.serviceName) ||
        !o.serviceName.trim() || o.serviceName.length > 32)
      throw new TypeError('serviceName must be 1–32 printable ASCII characters');
    result.serviceName = o.serviceName;
  }
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags) || o.tags.length > 5 || o.tags.some(t => typeof t !== 'string' ||
        !ASCII.test(t) || !t.trim() || t.length > 32) ||
        new Set(o.tags.map(x => x.toLowerCase())).size !== o.tags.length)
      throw new TypeError('tags must be <=5 unique printable ASCII strings (1–32)');
    result.tags = [...o.tags];
  }
  return result;
}
function parameters(input, method) {
  const paramDefs = input.queryParameters ?? [];
  if (!Array.isArray(paramDefs) || paramDefs.length > 32) throw new TypeError('Too many query parameters');
  const queryParams = Object.create(null);
  const properties = Object.create(null);
  const required = [];
  for (const p of paramDefs) {
    obj(p);
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(p.name || '') ||
        RESERVED_QUERY_NAMES.has(p.name) || hasOwn(properties, p.name))
      throw new TypeError('Parameter name invalid or repeated');
    if (!TYPES.has(p.type)) throw new TypeError(`Unsupported parameter type: ${p.name}`);
    const desc = requiredString(p.description, `${p.name} description`, 512);
    if (p.example === undefined || typeof p.example === 'object' || p.example === null ||
        (p.type === 'string' && typeof p.example !== 'string') ||
        (p.type === 'boolean' && typeof p.example !== 'boolean') ||
        (p.type === 'integer' && !Number.isSafeInteger(p.example)) ||
        (p.type === 'number' && (typeof p.example !== 'number' || !Number.isFinite(p.example))))
      throw new TypeError(`Invalid example value: ${p.name}`);
    if (String(p.example).length > 500) throw new TypeError('Example exceeds limit');
    queryParams[p.name] = String(p.example);
    properties[p.name] = { type: 'string', description: desc };
    if (p.required) required.push(p.name);
  }
  const inputInfo = { type: 'http', method };
  const inputProps = { type: { type: 'string', const: 'http' },
    method: { type: 'string', enum: [method] } };
  const inputReq = ['type', 'method'];
  if (paramDefs.length) {
    inputInfo.queryParams = queryParams;
    inputProps.queryParams = { type: 'object', properties,
      required, additionalProperties: false };
  }
  if (BODY.has(method)) {
    const type = input.bodyType || 'json';
    if (!['json', 'form-data', 'text'].includes(type)) throw new TypeError('Invalid bodyType');
    if (input.body === undefined || !plain(input.body) && typeof input.body !== 'string')
      throw new TypeError('POST/PUT/PATCH requires example body');
    inputInfo.bodyType = type;
    inputInfo.body = copy(input.body);
    inputProps.bodyType = { type: 'string', enum: [type] };
    inputProps.body = typeof input.body === 'string' ? { type: 'string' } : { type: 'object' };
    inputReq.push('bodyType', 'body');
  } else if (input.body !== undefined || input.bodyType !== undefined) {
    throw new TypeError('GET/HEAD/DELETE must not declare a body');
  }
  return { inputInfo, inputSchema: {
    type: 'object', properties: inputProps, required: inputReq,
    additionalProperties: false,
  } };
}
function terms(payment) {
  obj(payment);
  if (!['stellar:testnet', 'stellar:pubnet'].includes(payment.network))
    throw new TypeError('Network must be explicit Stellar CAIP-2 testnet or pubnet');
  if (payment.scheme !== 'exact')
    throw new TypeError('Only scheme exact is implemented; upto needs dedicated verified contract');
  if (typeof payment.amount !== 'string' || !/^[1-9][0-9]*$/.test(payment.amount) ||
      payment.amount.length > 39) throw new TypeError('amount must be positive base units as a decimal string');
  if (BigInt(payment.amount) > SOROBAN_I128_MAX)
    throw new RangeError('Payment amount exceeds signed Soroban i128 limit');
  requiredString(payment.asset, 'SEP-41 asset', 128);
  requiredString(payment.payTo, 'payTo', 128);
  if (typeof payment.maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(payment.maxTimeoutSeconds) ||
      payment.maxTimeoutSeconds < 1 || payment.maxTimeoutSeconds > 86400)
    throw new TypeError('maxTimeoutSeconds must be 1–86400');
  // Address checksum, SEP-41 asset contract and seller ownership are intentionally
  // NOT purported to be verified by this schema helper; that is the payment SDK boundary.
  return { scheme: 'exact', network: payment.network, amount: payment.amount,
    asset: payment.asset, payTo: payment.payTo, maxTimeoutSeconds: payment.maxTimeoutSeconds };
}
export function compileHttpSellerOffer(input, { allowLocalhost = false } = {}) {
  obj(input);
  const method = String(input.method ?? '').toUpperCase();
  if (!METHODS.has(method)) throw new TypeError('Unsupported HTTP method');
  const url = resourceUrl(input.url, allowLocalhost);
  const metadata = serviceMetadata(input);
  const accepted = terms(input.payment);
  const { inputInfo, inputSchema } = parameters(input, method);
  if (input.routeTemplate !== undefined) {
    const tpl = input.routeTemplate;
    if (typeof tpl !== 'string' || !/^\/[a-zA-Z0-9_/:.\-~%]+$/.test(tpl))
      throw new TypeError('Invalid routeTemplate');
    let decoded;
    try { decoded = decodeURIComponent(tpl); } catch { throw new TypeError('Malformed routeTemplate'); }
    if (decoded.includes('..') || decoded.includes('://') || /%2e|%2f/i.test(decoded))
      throw new TypeError('Unsafe routeTemplate');
  }
  const output = { type: 'json' };
  if (input.outputExample !== undefined) output.example = copy(input.outputExample);
  const schema = {
    $schema: DRAFT, type: 'object',
    properties: {
      input: inputSchema,
      output: { type: 'object', properties: {
        type: { type: 'string', enum: ['json'] },
        ...(input.outputExample !== undefined ? { example: {} } : {}),
      }, required: ['type'], additionalProperties: false },
    }, required: ['input'], additionalProperties: false,
  };
  const extension = { info: { input: inputInfo, output }, schema };
  if (input.routeTemplate) extension.routeTemplate = input.routeTemplate;
  const offer = {
    x402Version: 2, error: 'Payment required',
    resource: { url, description: requiredString(input.description, 'description', 2048),
      mimeType: 'application/json', ...metadata },
    accepts: [accepted], extensions: { bazaar: extension },
  };
  if (Buffer.byteLength(JSON.stringify(schema)) > 32768) throw new TypeError('Schema too large');
  return copy(offer);
}

/** Produces a normal x402 v2 402 response, but DOES NOT verify or settle payment. */
export function paymentRequiredResponse(offer) {
  if (offer?.x402Version !== 2 || !Array.isArray(offer.accepts) ||
      !plain(offer.extensions?.bazaar)) throw new TypeError('Valid v2 offer required');
  const body = JSON.stringify(offer);
  return {
    statusCode: 402,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
      'PAYMENT-REQUIRED': Buffer.from(body).toString('base64') },
    body,
  };
}

/**
 * Treat discovery as an untrusted visibility check, not proof of payment or
 * seller identity. Compares method, route, payment amount, asset and recipient.
 */
export function auditCatalogVisibility(body, offer) {
  const rows = body?.resources;
  if (!Array.isArray(rows)) throw new TypeError('Invalid discovery response');
  const expected = offer?.accepts?.[0];
  const eInput = offer?.extensions?.bazaar?.info?.input;
  const eURL = offer?.resource?.url;
  if (!expected || !eInput || !eURL) throw new TypeError('Invalid seller offer');
  const matches = rows.filter(r => r?.resource?.url === eURL &&
    r?.extensions?.bazaar?.info?.input?.type === 'http' &&
    r?.extensions?.bazaar?.info?.input?.method === eInput.method);
  const verified = matches.some(r => (r.accepts || []).some(a =>
    ['network', 'scheme', 'asset', 'amount', 'payTo'].every(k => a?.[k] === expected[k])));
  return { visible: matches.length > 0, termsMatch: verified,
    decision: !matches.length ? 'NOT_INDEXED' : verified ? 'VISIBLE_TERMS_MATCH_UNVERIFIED' : 'TERMS_DRIFT',
    matchingRows: matches.length, settlementAuthenticated: false };
}

/** Probe an explicitly supplied loopback baseURL, never an arbitrary URL. */
export async function probeLocalVisibility(baseUrl, offer) {
  const u = new URL(baseUrl);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port ||
      u.username || u.password || u.pathname !== '/' || u.search || u.hash)
    throw new TypeError('Only explicit http://127.0.0.1:PORT/ catalog is permitted');
  const path = new URL('/discovery/resources', u);
  path.searchParams.set('type', 'http');
  path.searchParams.set('network', offer.accepts[0].network);
  path.searchParams.set('limit', '100');
  let offset = 0, pages = 0, matches = [];
  while (pages++ < 100) {
    path.searchParams.set('offset', String(offset));
    const r = await fetch(path, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Catalog GET failed: HTTP ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.resources) || !plain(body.pagination)) throw new TypeError('Bad catalog response');
    matches.push(...body.resources.filter(row => row?.resource?.url === offer.resource.url));
    offset += body.resources.length;
    if (offset >= body.pagination.total || body.resources.length === 0) break;
  }
  if (pages > 100) throw new RangeError('Catalog pagination safety limit');
  return { ...auditCatalogVisibility({ resources: matches }, offer), pages, url: path.origin + '/discovery/resources' };
}
