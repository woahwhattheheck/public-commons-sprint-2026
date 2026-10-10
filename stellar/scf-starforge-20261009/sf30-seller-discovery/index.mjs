import { isIP } from 'node:net';
/**
 * SF-30: dependency-free seller-side x402 v2 Bazaar discovery metadata.
 * The seller's canonical x402 HTTP/MCP middleware remains responsible for
 * validating payment. This code does NOT authorize or settle any payment.
 *
 * Upstream x402 v2 spec 3b4631af0684748966eafcdf6a6a90a8cbbf7198,
 * Bazaar extension 442708e76d5a129e0c1393471d8ed71e3604c94e,
 * v2 HTTP a21213c02706208b2268a5fdab7dc6d5b468edbd.
 */

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);
const METHODS_QUERY = new Set(['GET', 'HEAD', 'DELETE']);
const ALLOWED_SCHEMES = new Set(['exact', 'upto']);
const OMIT = Symbol('missing-example');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

function fail(message) { throw new TypeError(message); }
function copy(value) {
  let json;
  try { json = JSON.stringify(value); } catch { fail('Discovery values must be serializable JSON'); }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > 60_000) fail('Discovery JSON size exceeded');
  const obj = JSON.parse(json);
  assertTree(obj);
  return obj;
}
function assertTree(value, depth = 0, counter = { n: 0 }) {
  if (++counter.n > 2_000 || depth > 12) fail('Discovery JSON complexity exceeded');
  if (Array.isArray(value)) { for (const part of value) assertTree(part, depth + 1, counter); return; }
  if (!plain(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Forbidden JSON key: ' + key);
    assertTree(item, depth + 1, counter);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const nonempty = (v, what) => {
  if (typeof v !== 'string' || !v.trim() || /[\u0000-\u001f\u007f]/.test(v)) fail(what + ' must be a nonempty control-free string');
  return v;
};
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function validResource(url, allowHttpLoopback = false) {
  nonempty(url, 'resource.url');
  let parsed;
  try { parsed = new URL(url); } catch { fail('resource.url must be an absolute URL'); }
  if (parsed.username || parsed.password || parsed.hash || parsed.href !== url) fail('resource.url must be canonical and have no credentials or fragment');
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const ipHost = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const localName = ['localhost', 'local', 'localdomain', 'internal', 'home.arpa',
    'ip6-localhost', 'ip6-loopback'].includes(hostname) ||
    ['.localhost', '.localhost.localdomain', '.local', '.localdomain',
      '.internal', '.home.arpa'].some(suffix => hostname.endsWith(suffix));
  const loopbackDev = allowHttpLoopback && loopback && parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !loopbackDev)
    fail('resource.url must use HTTPS; HTTP permitted only for explicit loopback development');
  if ((isIP(ipHost) !== 0 || localName) && !loopbackDev)
    fail('Private or local seller resource host not permitted');
  return parsed;
}
function checkedMetadata(resource, allowHttpLoopback) {
  if (!plain(resource)) fail('resource must be an object');
  const raw = copy(resource);
  validResource(raw.url, allowHttpLoopback);
  const result = { url: raw.url };
  if (raw.description !== undefined) result.description = nonempty(raw.description, 'resource.description');
  if (raw.mimeType !== undefined) result.mimeType = nonempty(raw.mimeType, 'resource.mimeType');
  if (raw.serviceName !== undefined) {
    if (typeof raw.serviceName !== 'string' || raw.serviceName.length > 32 || !/^[\x20-\x7e]+$/.test(raw.serviceName)) fail('Invalid serviceName');
    result.serviceName = raw.serviceName;
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 5) fail('tags must contain at most five items');
    if (raw.tags.some(x => typeof x !== 'string' || !x.length || x.length > 32 || !/^[\x20-\x7e]+$/.test(x))) fail('Invalid tags');
    const lower = new Set();
    result.tags = raw.tags.filter(tag => { const key = tag.toLowerCase(); if (lower.has(key)) return false; lower.add(key); return true; });
  }
  if (raw.iconUrl !== undefined) {
    const url = new URL(nonempty(raw.iconUrl, 'iconUrl'));
    if (url.href !== raw.iconUrl || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || raw.iconUrl.length > 2048 ||
        /^\d+$/.test(url.hostname) || /^0x[0-9a-f]+$/i.test(url.hostname) || ['localhost','localhost.localdomain','ip6-localhost','ip6-loopback'].includes(url.hostname) ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')) fail('Unsafe iconUrl');
    result.iconUrl = raw.iconUrl;
  }
  return result;
}
function checkedPayment(payment) {
  if (!plain(payment)) fail('Each payment requirement must be an object');
  const p = copy(payment);
  if (!ALLOWED_SCHEMES.has(p.scheme)) fail('Unsupported scheme (exact or upto required)');
  if (typeof p.network !== 'string' || !/^stellar:[A-Za-z0-9_-]+$/.test(p.network)) fail('A Stellar CAIP-2 network is required');
  nonempty(p.asset, 'asset'); nonempty(p.payTo, 'payTo');
  if (typeof p.amount !== 'string' || !/^[1-9]\d*$/.test(p.amount)) fail('amount must be a positive atomic-unit decimal string');
  if (!Number.isSafeInteger(p.maxTimeoutSeconds) || p.maxTimeoutSeconds <= 0) fail('maxTimeoutSeconds must be a positive integer');
  const { scheme, network, amount, asset, payTo, maxTimeoutSeconds } = p;
  return { scheme, network, amount, asset, payTo, maxTimeoutSeconds, ...(p.extra === undefined ? {} : { extra: p.extra }) };
}

// Declarative sample construction preserves developer-authored descriptions and
// actual input schemas; it never invents values for required fields.
function example(schema, path = '$') {
  if (!plain(schema)) return OMIT;
  if (own(schema, 'const')) return copy(schema.const);
  if (Array.isArray(schema.examples) && schema.examples.length) return copy(schema.examples[0]);
  if (own(schema, 'example')) return copy(schema.example);
  if (own(schema, 'default')) return copy(schema.default);
  if (schema.type === 'object' && plain(schema.properties)) {
    const result = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      const value = example(child, `${path}.${key}`);
      if (value === OMIT && schema.required?.includes(key)) fail('No declared example/default for required parameter ' + `${path}.${key}`);
      if (value !== OMIT) result[key] = value;
    }
    return result;
  }
  if (schema.type === 'array' && (schema.minItems === undefined || schema.minItems === 0)) return [];
  return OMIT;
}
function schemaObject(schema, name) {
  if (!plain(schema) || schema.type !== 'object' || !plain(schema.properties)) fail(name + ' requires a JSON Schema object with properties');
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(k => !own(schema.properties, k)))) fail(name + ' has invalid required names');
  return copy(schema);
}
function makeHttpInput(input) {
  const method = nonempty(input.method, 'input.method').toUpperCase();
  if (!METHODS_QUERY.has(method) && !METHODS_WITH_BODY.has(method)) fail('Unsupported HTTP method');
  const hasBody = METHODS_WITH_BODY.has(method);
  if (!hasBody && (input.bodySchema !== undefined || input.bodyType !== undefined)) fail('Query methods cannot describe bodies');
  if (hasBody && input.bodySchema === undefined) fail('Body methods require a JSON Schema describing the body');
  const info = { type: 'http', method };
  const properties = { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: [method] } };
  const required = ['type', 'method'];
  if (input.querySchema !== undefined) {
    const schema = schemaObject(input.querySchema, 'querySchema');
    const sample = example(schema, 'queryParams');
    if (sample !== OMIT) info.queryParams = sample;
    properties.queryParams = schema;
    if (schema.required?.length) required.push('queryParams');
  }
  if (hasBody) {
    const bodyType = input.bodyType ?? 'json';
    if (!['json', 'form-data', 'text'].includes(bodyType)) fail('Unsupported bodyType');
    const schema = schemaObject(input.bodySchema, 'bodySchema');
    const sample = example(schema, 'body');
    if (sample === OMIT) fail('Body example is required');
    info.bodyType = bodyType; info.body = sample;
    properties.bodyType = { type: 'string', enum: [bodyType] };
    properties.body = schema;
    required.push('bodyType', 'body');
  }
  if (input.headers !== undefined) {
    if (!plain(input.headers)) fail('headers must be a dictionary');
    const headers = copy(input.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (!/^[A-Za-z0-9-]+$/.test(key) || !scalar(value) || typeof value !== 'string') fail('Headers must have valid names and string values');
      if (/authorization|cookie|token|api.?key|payment-signature|secret/i.test(key)) fail('Never place credentials in discovery examples');
    }
    info.headers = headers;
    properties.headers = { type: 'object', additionalProperties: { type: 'string' } };
  }
  return { info, schema: { type: 'object', properties, required, additionalProperties: false } };
}
function makeMcpInput(input) {
  nonempty(input.toolName, 'input.toolName');
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(input.toolName)) fail('Invalid MCP toolName');
  const toolSchema = schemaObject(input.inputSchema, 'inputSchema');
  const info = { type: 'mcp', toolName: input.toolName, inputSchema: toolSchema };
  if (input.description !== undefined) info.description = nonempty(input.description, 'tool description');
  if (input.transport !== undefined) {
    if (!['sse', 'streamable-http'].includes(input.transport)) fail('Invalid MCP transport');
    info.transport = input.transport;
  }
  const args = example(toolSchema, 'arguments');
  if (args !== OMIT) info.example = args;
  const schema = {
    type: 'object', properties: {
      type: { type: 'string', const: 'mcp' },
      toolName: { type: 'string', const: input.toolName },
      inputSchema: { type: 'object' },
      description: { type: 'string' },
      transport: { type: 'string', enum: ['sse','streamable-http'] },
      example: { type: 'object' },
    }, required: ['type','toolName','inputSchema'], additionalProperties: false,
  };
  return { info, schema };
}
/** Build an x402 v2 PaymentRequired object with a supplied-schema Bazaar extension. */
export function createSellerDiscovery({ resource, accepts, input, output, routeTemplate, allowHttpLoopback = false } = {}) {
  const safeResource = checkedMetadata(resource, allowHttpLoopback);
  if (!Array.isArray(accepts) || accepts.length === 0 || accepts.length > 8) fail('1–8 payment requirements required');
  const safeAccepts = accepts.map(checkedPayment);
  if (!plain(input)) fail('input must be a declarative HTTP or MCP definition');
  const built = input.type === 'http' ? makeHttpInput(input) : input.type === 'mcp' ? makeMcpInput(input) : fail('input.type must be http or mcp');
  const info = { input: built.info };
  const schema = { $schema: DRAFT, type: 'object', properties: { input: built.schema }, required: ['input'], additionalProperties: false };
  if (output !== undefined) {
    if (!plain(output)) fail('output must be an object');
    info.output = copy(output);
    nonempty(info.output.type, 'output.type');
    schema.properties.output = { type: 'object', properties: { type: { type: 'string' }, format: { type: 'string' }, example: true }, required: ['type'], additionalProperties: false };
  }
  const ext = { info, schema };
  if (routeTemplate !== undefined) {
    // Keep the behavior aligned with PR451: no traversal or double-encoded scheme.
    if (typeof routeTemplate !== 'string' || !/^\/[a-zA-Z0-9_/:.\-~%]+$/.test(routeTemplate)) fail('Invalid routeTemplate');
    let decoded;
    try { decoded = decodeURIComponent(routeTemplate); } catch { fail('Invalid routeTemplate encoding'); }
    if (decoded.includes('..') || decoded.includes('://')) fail('Unsafe routeTemplate');
    ext.routeTemplate = routeTemplate;
  }
  return copy({ x402Version: 2, error: 'PAYMENT-SIGNATURE header is required', resource: safeResource,
    accepts: safeAccepts, extensions: { bazaar: ext } });
}
/** Canonical v2 HTTP 402 header. This is metadata only, not a payment verifier. */
export function makePaymentRequiredResponse(seller) {
  if (seller?.x402Version !== 2 || !plain(seller?.extensions?.bazaar)) fail('Seller PaymentRequired v2 object missing');
  const record = copy(seller);
  return { statusCode: 402, headers: {
    'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(record), 'utf8').toString('base64'),
    'content-type': 'application/json', 'cache-control': 'no-store',
  }, body: '{}', paymentRequired: record };
}
/**
 * Optional local contract probe for the actual SF25 PaymentAutoCatalog. Caller
 * MUST pass a trusted, independently verified and settled facilitator hook.
 * Neither the echoed PaymentPayload nor this function verifies payment.
 */
export function verifyCatalogAcceptance({ seller, paymentPayload, settlement, sequence, catalog } = {}) {
  if (!plain(seller) || !plain(paymentPayload) || !plain(settlement) || !catalog || typeof catalog.ingest !== 'function') fail('Missing catalog probe dependencies');
  if (settlement.status !== 'settled') return { decision: 'reject', reason: 'SETTLEMENT_NOT_CONFIRMED' };
  if (paymentPayload.x402Version !== 2 || paymentPayload.resource?.url !== seller.resource?.url) return { decision: 'reject', reason: 'SELLER_RESOURCE_MISMATCH' };
  if (!same(paymentPayload.extensions?.bazaar, seller.extensions?.bazaar)) return { decision: 'reject', reason: 'DISCOVERY_ECHO_MISMATCH' };
  if (!seller.accepts.some(term => same(term, paymentPayload.accepted))) return { decision: 'reject', reason: 'PAYMENT_REQUIREMENT_MISMATCH' };
  for (const field of ['network','scheme','payTo','asset','amount']) {
    if (paymentPayload.accepted[field] !== settlement[field]) return { decision: 'reject', reason: 'SETTLEMENT_' + field.toUpperCase() + '_MISMATCH' };
  }
  if (settlement.origin !== new URL(seller.resource.url).origin) return { decision: 'reject', reason: 'SETTLEMENT_ORIGIN_MISMATCH' };
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return { decision: 'reject', reason: 'SEQUENCE_INVALID' };
  return catalog.ingest({ paymentPayload, settlement, sequence });
}

