// MIT. Selected Stellar RPC reads as original SF61/SF30 merchant operations.
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';

export const PLAN_SCHEMA = 'stellar-forge.getblock-stellar-plan.v1';
export const DATA_NETWORK = 'stellar:pubnet';
export const RPC_HOSTS = Object.freeze(['shared.eu-central-1.getblock.io', 'shared.us-east-1.getblock.io', 'shared.ap-southeast-1.getblock.io']);
export const METHODS = Object.freeze(['getTransaction', 'getTransactions', 'getEvents', 'getLedgerEntries']);
export const LIMITS = Object.freeze({ timeoutMs: 10000, maxResponseBytes: 1048576,
  maxInFlight: 8, maxEventPage: 500, maxTransactionPage: 200, maxLedgerKeys: 200 });
const U32 = 4294967295;
const own = (o, key) => Object.hasOwn(o, key);
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new TypeError(message); };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength, description, minLength = 1) => ({ type: 'string', minLength, maxLength, description });
const ledger = { type: 'integer', minimum: 1, maximum: U32 };
function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid ' + label + ' fields');
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Invalid ' + name);
  return value;
}
export function validatePlan(input) {
  fields(input, ['schema', 'publicOrigin', 'endpointEnv', 'payment', 'operations', 'limits'], 'GetBlock plan');
  if (input.schema !== PLAN_SCHEMA) fail('Expected ' + PLAN_SCHEMA);
  if (typeof input.endpointEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,79}$/.test(input.endpointEnv))
    fail('endpointEnv must name the operator environment variable; never paste an endpoint');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { fail('publicOrigin must be a merchant HTTPS origin'); }
  if (origin.protocol !== 'https:' || origin.origin !== input.publicOrigin || origin.username || origin.password ||
      RPC_HOSTS.includes(origin.hostname) || origin.hostname === 'go.getblock.io')
    fail('publicOrigin must be the merchant HTTPS origin, separate from the private provider endpoint');
  fields(input.payment, ['network', 'asset', 'payTo', 'maxTimeoutSeconds'], 'payment');
  const limits = { ...LIMITS, ...(input.limits ?? {}) };
  if (input.limits !== undefined) fields(input.limits, Object.keys(LIMITS), 'limits');
  integer(limits.timeoutMs, 1000, 60000, 'timeoutMs');
  integer(limits.maxResponseBytes, 1024, 1048576, 'maxResponseBytes');
  integer(limits.maxInFlight, 1, 64, 'maxInFlight');
  integer(limits.maxEventPage, 1, 10000, 'maxEventPage');
  integer(limits.maxTransactionPage, 1, 200, 'maxTransactionPage');
  integer(limits.maxLedgerKeys, 1, 200, 'maxLedgerKeys');
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > METHODS.length)
    fail('Select one to four Stellar read methods with explicit atomic prices');
  const seen = new Set();
  const operations = input.operations.map(row => {
    fields(row, ['method', 'amountAtomic'], 'operation');
    if (!METHODS.includes(row.method) || seen.has(row.method)) fail('Unknown or duplicate Stellar read method');
    seen.add(row.method);
    if (typeof row.amountAtomic !== 'string' || !/^[1-9][0-9]{0,38}$/.test(row.amountAtomic))
      fail('Each price must be a positive integer string in asset atomic units');
    return { method: row.method, amountAtomic: row.amountAtomic };
  });
  return { schema: PLAN_SCHEMA, publicOrigin: origin.origin, endpointEnv: input.endpointEnv,
    payment: structuredClone(input.payment), operations, limits };
}

function pagination(maximum) {
  return obj({ cursor: string(512, 'Opaque cursor returned by the previous response. Omit startLedger and endLedger when using it.'),
    limit: { type: 'integer', minimum: 1, maximum } });
}
export function requestSchema(method, limits = LIMITS) {
  const format = { type: 'string', enum: ['base64'], description: 'This product returns stable base64 XDR representations.' };
  if (method === 'getTransaction') return obj({ hash: string(64, 'Lowercase 64-character hexadecimal transaction hash.', 64), xdrFormat: format }, ['hash']);
  if (method === 'getLedgerEntries') return obj({ keys: { type: 'array', minItems: 1, maxItems: limits.maxLedgerKeys,
    uniqueItems: true, items: string(4096, 'Canonical base64-encoded Stellar LedgerKey XDR.') }, xdrFormat: format }, ['keys']);
  if (!['getEvents', 'getTransactions'].includes(method)) fail('Unsupported RPC method');
  const properties = { startLedger: ledger, pagination: pagination(method === 'getEvents' ? limits.maxEventPage : limits.maxTransactionPage), xdrFormat: format };
  if (method === 'getEvents') {
    properties.endLedger = { ...ledger, description: 'Exclusive end of the ledger search window; greater than startLedger.' };
    properties.filters = { type: 'array', maxItems: 5, items: { type: 'object' },
      description: 'At most five filters containing only type (system or contract), contractIds (at most five contract StrKeys across the request), and topics (up to five arrays of one to four base64 ScVal strings or * wildcards). Compound topic matchers are not selected. Exact nested fields and formats are checked by prepayment admission.' };
  }
  // The original discovery compiler has a bounded JSON nesting depth. Runtime
  // admission applies cursor/window relationships and wire formats prepayment.
  return obj(properties);
}
export function exampleRequest(method) {
  if (method === 'getTransaction') return { hash: '0'.repeat(64) };
  if (method === 'getLedgerEntries') return { keys: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='] };
  return { startLedger: 1, pagination: { limit: 1 } };
}
function responseSchema(method) {
  const properties = { latestLedger: ledger };
  const required = ['latestLedger'];
  if (method === 'getTransaction') {
    properties.status = { type: 'string', enum: ['SUCCESS', 'FAILED', 'NOT_FOUND'] };
    properties.txHash = string(64, 'Queried transaction hash.', 64); required.push('status', 'txHash');
  } else {
    const name = method === 'getLedgerEntries' ? 'entries' : method === 'getEvents' ? 'events' : 'transactions';
    properties[name] = { type: 'array', items: { type: 'object' } }; required.push(name);
    if (method !== 'getLedgerEntries') { properties.cursor = string(512, 'Use this returned cursor for the next explicitly purchased page.', 0); required.push('cursor'); }
  }
  return { type: 'object', properties, required, additionalProperties: true };
}

/** Original OpenAPI compiler and original service bindings are the only offer builders. */
export function prepareProduct(input) {
  const plan = validatePlan(input);
  const spec = { openapi: '3.1.0', info: { title: 'Stellar paid reads', version: '1.0.0',
    description: 'Selected Stellar mainnet data reads. Payment terms explicitly identify their own Stellar network.' },
    servers: [{ url: plan.publicOrigin + '/' }], paths: {} };
  const selections = [], bindings = [];
  for (const row of plan.operations) {
    const path = '/stellar/' + row.method;
    spec.paths[path] = { post: { operationId: row.method, summary: row.method + ' on Stellar mainnet',
      description: 'One selected ' + row.method + ' read. The response is the original RPC result object. Each requested page is a separate purchase; no automatic pagination, retry, transaction submission or simulation.',
      requestBody: { required: true, content: { 'application/json': { schema: requestSchema(row.method, plan.limits), example: exampleRequest(row.method) } } },
      responses: { '200': { description: 'Original successful JSON-RPC result. Transaction status FAILED or NOT_FOUND is valid read data, not a payment result.',
        content: { 'application/json': { schema: responseSchema(row.method) } } },
      '422': { description: 'Request rejected before payment, or provider rejected admitted RPC parameters.' },
      '502': { description: 'Provider or RPC response failed; native merchant failure/cancellation handling applies.' } } } };
    selections.push({ method: 'POST', path, serviceName: 'Stellar ' + row.method,
      accepts: [{ scheme: 'exact', ...plan.payment, amount: row.amountAtomic }] });
    bindings.push({ method: 'POST', path, id: row.method, handler: row.method, admit: 'admit' + row.method, validateInput: true });
  }
  const imported = importOpenApi(spec, selections);
  const service = createSellerServiceConfig(imported, bindings);
  return { plan, spec, selections, bindings, imported, service };
}

const base64 = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
  Buffer.from(value, 'base64').toString('base64') === value;
const positiveLedger = value => Number.isSafeInteger(value) && value > 0 && value <= U32;
const exact = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));

/** Supplemental wire-format checks; schema and this function both run prepayment. */
export function admitRequest(method, context, limits = LIMITS) {
  const body = context?.body;
  const reject = field => ({ status: 422, headers: { 'content-type': 'application/json' },
    body: { error: 'STELLAR_READ_INPUT_INVALID', field } });
  if (context?.method !== 'POST' || !plain(body) ||
      context.url?.search || Object.keys(context.query ?? {}).length) return reject('request');
  if (body.xdrFormat !== undefined && body.xdrFormat !== 'base64') return reject('xdrFormat');
  if (method === 'getTransaction') return exact(body, ['hash', 'xdrFormat']) &&
    typeof body.hash === 'string' && /^[a-f0-9]{64}$/.test(body.hash) ? true : reject('hash');
  if (method === 'getLedgerEntries') return exact(body, ['keys', 'xdrFormat']) && Array.isArray(body.keys) &&
    body.keys.length >= 1 && body.keys.length <= limits.maxLedgerKeys && body.keys.every(base64) &&
    new Set(body.keys).size === body.keys.length ? true : reject('keys');
  if (!['getEvents', 'getTransactions'].includes(method) || !exact(body,
    method === 'getEvents' ? ['startLedger', 'endLedger', 'filters', 'pagination', 'xdrFormat'] : ['startLedger', 'pagination', 'xdrFormat'])) return reject('request');
  const page = body.pagination ?? {};
  if (!exact(page, ['cursor', 'limit'])) return reject('pagination');
  if (own(page, 'cursor')) {
    if (typeof page.cursor !== 'string' || !page.cursor.length || page.cursor.length > 512 || /[\x00-\x20\x7f]/.test(page.cursor) ||
        own(body, 'startLedger') || own(body, 'endLedger')) return reject('pagination.cursor');
  } else if (!positiveLedger(body.startLedger)) return reject('startLedger');
  if (own(body, 'endLedger') && (!positiveLedger(body.endLedger) || body.endLedger <= body.startLedger)) return reject('endLedger');
  const max = method === 'getEvents' ? limits.maxEventPage : limits.maxTransactionPage;
  if (own(page, 'limit') && (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > max)) return reject('pagination.limit');
  if (method === 'getEvents' && own(body, 'filters')) {
    if (!Array.isArray(body.filters) || body.filters.length > 5) return reject('filters');
    let contractIds = 0;
    for (const filter of body.filters) {
      if (!exact(filter, ['type', 'contractIds', 'topics']) || own(filter, 'type') && !['system', 'contract'].includes(filter.type)) return reject('filters.type');
      if (own(filter, 'contractIds') && (!Array.isArray(filter.contractIds) || filter.contractIds.length > 5 ||
          new Set(filter.contractIds).size !== filter.contractIds.length || filter.contractIds.some(id => typeof id !== 'string' || !/^C[A-Z2-7]{55}$/.test(id)))) return reject('filters.contractIds');
      contractIds += filter.contractIds?.length ?? 0;
      if (contractIds > 5) return reject('filters.contractIds');
      if (own(filter, 'topics') && (!Array.isArray(filter.topics) || filter.topics.length > 5 || filter.topics.some(topic =>
        !Array.isArray(topic) || !topic.length || topic.length > 4 || topic.some(segment => segment !== '*' && !base64(segment))))) return reject('filters.topics');
    }
  }
  return true;
}

export function rpcParams(method, body, limits = LIMITS) {
  const params = { ...structuredClone(body), xdrFormat: 'base64' };
  if (['getEvents', 'getTransactions'].includes(method)) {
    const maximum = method === 'getEvents' ? limits.maxEventPage : limits.maxTransactionPage;
    const fallback = method === 'getEvents' ? 100 : 50;
    params.pagination = { ...params.pagination, limit: params.pagination?.limit ?? Math.min(fallback, maximum) };
  }
  return params;
}
