// MIT. SubQuery fixed-operation adapter for the ORIGINAL SF30 x402 seller.
// All payment verification, cancellation and settlement stay with SF30.
import { createUpstreamHandlers } from '../sf30-seller-sdk/upstream.mjs';

const SCHEMA = 'stellar-forge.subquery-merchant.v1';
const PLAIN = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const OWN = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
const FAIL = (message) => { throw new TypeError(message); };
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;
const TYPES = new Set(['integer', 'string', 'boolean', 'stellar-account']);

function keys(value, allowed, label) {
  if (!PLAIN(value) || Object.keys(value).some(key => !allowed.includes(key))) FAIL('Invalid ' + label);
}
function integer(value, lower, upper, label) {
  if (!Number.isSafeInteger(value) || value < lower || value > upper) FAIL('Invalid ' + label);
  return value;
}
function compileParameter(name, spec) {
  if (!IDENT.test(name)) FAIL('Invalid GraphQL variable name');
  keys(spec, ['type', 'required', 'min', 'max', 'default'], 'variable definition');
  if (!TYPES.has(spec.type) || (spec.required !== undefined && typeof spec.required !== 'boolean')) {
    FAIL('Variable must have a supported type and boolean required flag');
  }
  const min = spec.min ?? (spec.type === 'integer' ? 0 : 1);
  const max = spec.max ?? (spec.type === 'integer' ? 100000 : 256);
  integer(min, 0, 1000000, 'variable minimum');
  integer(max, min, 1000000, 'variable maximum');
  if (spec.type === 'boolean' || spec.type === 'stellar-account') {
    if (OWN(spec, 'min') || OWN(spec, 'max')) FAIL('Variable bounds invalid for type');
  }
  function check(value) {
    if (spec.type === 'integer') return integer(value, min, max, name);
    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') FAIL('Invalid ' + name);
      return value;
    }
    if (typeof value !== 'string') FAIL('Invalid ' + name);
    if (spec.type === 'stellar-account') {
      if (!STELLAR_ADDRESS.test(value)) FAIL('Invalid Stellar account');
      return value;
    }
    if (value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) FAIL('Invalid ' + name);
    return value;
  }
  if (OWN(spec, 'default')) check(spec.default);
  return { name, required: spec.required === true, fallback: spec.default, hasDefault: OWN(spec, 'default'), check };
}
function compileOperation(raw) {
  keys(raw, ['name', 'handler', 'admission', 'query', 'root', 'variables', 'maxNodes'], 'approved operation');
  for (const name of ['name', 'handler', 'admission', 'root']) {
    if (typeof raw[name] !== 'string' || !IDENT.test(raw[name]) ||
        ['__proto__', 'constructor', 'prototype'].includes(raw[name])) FAIL('Invalid approved operation name');
  }
  if (typeof raw.query !== 'string' || raw.query.length < 12 || raw.query.length > 8192 ||
      !/^\s*query(?:\s|\{)/.test(raw.query) ||
      /\b(?:mutation|subscription|__schema|__type)\b/.test(raw.query)) {
    FAIL('Only fixed, bounded read-only GraphQL query documents are supported');
  }
  const params = raw.variables ?? {};
  if (!PLAIN(params) || Object.keys(params).length > 16) FAIL('Too many variable definitions');
  return {
    ...raw, maxNodes: integer(raw.maxNodes ?? 100, 1, 500, 'maxNodes'),
    params: Object.entries(params).map(([name, value]) => compileParameter(name, value)),
  };
}
export function compileSubQueryMerchant(input) {
  keys(input, ['schema', 'origin', 'path', 'authorizationEnv', 'timeoutMs', 'maxResponseBytes',
    'maxInFlight', 'operations'], 'SubQuery merchant configuration');
  if (input.schema !== SCHEMA || !Array.isArray(input.operations) ||
      input.operations.length < 1 || input.operations.length > 16 ||
      typeof input.origin !== 'string' || typeof input.path !== 'string') {
    FAIL('Expected subquery-merchant.v1 with 1–16 approved operations');
  }
  if (input.authorizationEnv !== undefined && (typeof input.authorizationEnv !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(input.authorizationEnv))) FAIL('Invalid credential variable name');
  const operations = input.operations.map(compileOperation);
  const identifiers = new Set();
  for (const op of operations) {
    for (const field of ['name', 'handler', 'admission']) {
      if (identifiers.has(op[field])) FAIL('Duplicate operation or handler identity');
      identifiers.add(op[field]);
    }
  }
  return { input, operations };
}
export function bindSubQueryVariables(body, op) {
  if (body === null || body === undefined) body = {};
  keys(body, ['variables'], 'buyer request body');
  const supplied = body.variables ?? {};
  if (!PLAIN(supplied) || Object.keys(supplied).length > 16) FAIL('Buyer variables must be an object');
  const allowed = new Set(op.params.map(v => v.name));
  if (Object.keys(supplied).some(name => !allowed.has(name))) FAIL('Undeclared buyer variable');
  const variables = Object.create(null);
  for (const p of op.params) {
    if (OWN(supplied, p.name)) variables[p.name] = p.check(supplied[p.name]);
    else if (p.hasDefault) variables[p.name] = p.fallback;
    else if (p.required) FAIL('Missing required variable: ' + p.name);
  }
  return variables;
}
export function createSubQueryMerchantHandlers(config, { env = process.env, allowLoopback = false,
  lookup } = {}) {
  const { input, operations } = compileSubQueryMerchant(config);
  // Original SF30 upstream compiler enforces canonical origins, DNS public-IP
  // pinning, header isolation, response/time limits and no HTTP redirect.
  const bindings = Object.create(null);
  for (const op of operations) {
    bindings[op.handler] = {
      origin: input.origin, path: input.path, method: 'POST', query: [],
      headerEnv: input.authorizationEnv ? { Authorization: input.authorizationEnv } : {},
      responseMode: 'json', maxResponseBytes: integer(input.maxResponseBytes ?? 262144, 1, 1048576, 'response bytes'),
      timeoutMs: integer(input.timeoutMs ?? 8000, 1, 120000, 'timeout'),
      maxInFlight: integer(input.maxInFlight ?? 8, 1, 256, 'concurrency'),
    };
  }
  const backend = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1',
    bindings }, { allowLoopback, env, ...(lookup ? { lookup } : {}) });
  const handlers = Object.create(null);
  for (const op of operations) {
    const check = context => {
      if (!context || context.method !== 'POST' || !(context.url instanceof URL) ||
          context.url.search || context.pathParams && Object.keys(context.pathParams).length) {
        FAIL('Only fixed-path POST with JSON variables is supported');
      }
      return bindSubQueryVariables(context.body, op);
    };
    handlers[op.admission] = context => {
      try { check(context); return true; }
      catch { return { status: 422, body: { error: 'QUERY_VARIABLES_INVALID' } }; }
    };
    handlers[op.handler] = async context => {
      let variables;
      try { variables = check(context); }
      catch { return { status: 422, body: { error: 'QUERY_VARIABLES_INVALID' } }; }
      const result = await backend[op.handler]({
        ...context, body: { query: op.query, variables },
      });
      if (result.status !== 200) return result;
      try {
        if (!Buffer.isBuffer(result.body)) throw new Error('Nonbinary result');
        const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.body));
        if (!PLAIN(parsed) || OWN(parsed, 'errors') ||
            !PLAIN(parsed.data) || !OWN(parsed.data, op.root) || !PLAIN(parsed.data[op.root])) {
          throw new Error('Invalid GraphQL result');
        }
        const value = parsed.data[op.root];
        if (OWN(value, 'nodes') && (!Array.isArray(value.nodes) || value.nodes.length > op.maxNodes)) {
          throw new Error('GraphQL node limit exceeded');
        }
        return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: { schema: 'stellar-forge.subquery-response.v1', operation: op.name,
            data: structuredClone(value) } };
      } catch {
        return { status: 502, body: { error: 'UPSTREAM_GRAPHQL_RESPONSE_INVALID' } };
      }
    };
    handlers[op.handler].snapshot = backend[op.handler].snapshot;
  }
  return Object.freeze(handlers);
}
export function validateSubQuerySellerRoutes(seller, config) {
  const { operations } = compileSubQueryMerchant(config);
  if (!PLAIN(seller) || !Array.isArray(seller.routes) || seller.routes.length !== operations.length) {
    FAIL('Seller routes must bind every configured SubQuery operation exactly once');
  }
  const handlers = new Set(operations.map(op => op.handler));
  const admissions = new Map(operations.map(op => [op.handler, op.admission]));
  for (const route of seller.routes) {
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (method !== 'POST' || !handlers.delete(route.handler) ||
        route.admit !== admissions.get(route.handler) ||
        typeof route.path !== 'string' || !/^\/[A-Za-z0-9_./~-]+$/.test(route.path) ||
        route.path.includes('//')) FAIL('Seller POST/handler/admission binding mismatch');
  }
  if (handlers.size) FAIL('Seller is missing a named SubQuery operation');
  return true;
}
