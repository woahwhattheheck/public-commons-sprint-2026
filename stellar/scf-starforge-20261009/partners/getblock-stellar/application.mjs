// MIT. Fixed-method JSON-RPC application on the original SF30 upstream transport.
import { randomUUID } from 'node:crypto';
import { createUpstreamHandlers } from '../../sf30-seller-sdk/upstream.mjs';
import { prepareProduct, DATA_NETWORK, RPC_HOSTS, plain, admitRequest, rpcParams } from './product.mjs';

const MAINNET = 'Public Global Stellar Network ; September 2015';
const own = (o, key) => Object.hasOwn(o, key);
const positiveLedger = n => Number.isSafeInteger(n) && n > 0 && n <= 4294967295;
const failure = (status, error, extra = {}) => ({ status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }, body: { error, ...extra } });

/** The complete dashboard endpoint is read once at launch and never serialized. */
function privateEndpoint(plan, env) {
  const raw = own(env, plan.endpointEnv) ? env[plan.endpointEnv] : undefined;
  let url;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw Error(); url = new URL(raw); }
  catch { throw new TypeError('GETBLOCK_ENDPOINT_MISSING_OR_INVALID'); }
  if (url.protocol !== 'https:' || url.href !== raw || url.port || url.username || url.password || url.search || url.hash ||
      !RPC_HOSTS.includes(url.hostname) || !/^\/[A-Za-z0-9._~-]{1,512}\/$/.test(url.pathname) ||
      ['.', '..'].includes(url.pathname.slice(1, -1))) throw new TypeError('GETBLOCK_ENDPOINT_MISSING_OR_INVALID');
  return { origin: url.origin, path: url.pathname, secret: url.pathname.slice(1, -1),
    region: url.hostname.split('.')[1] };
}

/** Return the provider result, never its error message/data or JSON-RPC envelope. */
export function decodeRpcResult(response, { id, method, params, secret }) {
  if (!Number.isInteger(response?.status)) return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  if (response.status >= 400) return response;
  if (response.status < 200 || response.status >= 300) return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  let envelope;
  try {
    if (!Buffer.isBuffer(response.body)) throw Error();
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
  } catch { return failure(502, 'STELLAR_RPC_RESPONSE_INVALID'); }
  if (!plain(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id ||
      own(envelope, 'result') === own(envelope, 'error')) return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  if (own(envelope, 'error')) {
    const code = envelope.error?.code;
    if (!plain(envelope.error) || !Number.isSafeInteger(code)) return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
    // Provider text and error.data can contain endpoint paths or echo input.
    return failure(code === -32602 ? 422 : 502, 'STELLAR_RPC_REJECTED', { rpcCode: code });
  }
  const result = envelope.result;
  if (!plain(result)) return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  if (method === 'getNetwork') {
    if (typeof result.passphrase !== 'string' || !Number.isSafeInteger(result.protocolVersion))
      return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  } else if (!positiveLedger(result.latestLedger) || method === 'getHealth' && typeof result.status !== 'string') {
    return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  }
  if (method === 'getTransaction' && (!['SUCCESS', 'FAILED', 'NOT_FOUND'].includes(result.status) || result.txHash !== params.hash))
    return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  if (['getEvents', 'getTransactions', 'getLedgerEntries'].includes(method)) {
    const key = method === 'getEvents' ? 'events' : method === 'getTransactions' ? 'transactions' : 'entries';
    const cap = method === 'getLedgerEntries' ? params.keys.length : params.pagination.limit;
    if (!Array.isArray(result[key]) || result[key].length > cap || result[key].some(row => !plain(row)) ||
        method !== 'getLedgerEntries' && (typeof result.cursor !== 'string' || result.cursor.length > 512))
      return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
    if (method === 'getLedgerEntries' && result.entries.some(entry => !params.keys.includes(entry.key)))
      return failure(502, 'STELLAR_RPC_RESPONSE_INVALID');
  }
  // Even an unexpected successful backend echo cannot release the path token.
  if (typeof secret === 'string' && secret.length && JSON.stringify(result).includes(secret))
    return failure(502, 'STELLAR_RPC_RESPONSE_PRIVATE');
  return { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }, body: result };
}

/** All exchanges use one shared original transport/capacity budget. No new HTTP client. */
export function createGetBlockApplication(input, { env = process.env, lookup } = {}) {
  const { plan } = prepareProduct(input);
  if (env === null || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('GETBLOCK_ENVIRONMENT_INVALID');
  const target = privateEndpoint(plan, env);
  const transport = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1', bindings: {
    getblockRpc: { origin: target.origin, path: target.path, method: 'POST', responseMode: 'json',
      timeoutMs: plan.limits.timeoutMs, maxResponseBytes: plan.limits.maxResponseBytes,
      maxInFlight: plan.limits.maxInFlight,
      availability: { failureThreshold: 3, resetAfterMs: 30000, maxResetAfterMs: 300000 } },
  } }, { env: {}, ...(lookup === undefined ? {} : { lookup }) }).getblockRpc;
  const counts = Object.fromEntries(plan.operations.map(({ method }) => [method,
    { requests: 0, succeeded: 0, failed: 0, inputRejected: 0, rpcRejected: 0 }]));
  const handlers = {};
  const call = async (method, params, context) => {
    const id = randomUUID();
    const response = await transport({ ...context, method: 'POST',
      body: { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) } });
    return decodeRpcResult(response, { id, method, params, secret: target.secret });
  };
  for (const { method } of plan.operations) {
    handlers['admit' + method] = context => {
      const decision = admitRequest(method, context, plan.limits);
      if (decision !== true) { counts[method].inputRejected++; return decision; }
      return transport.admit(context);
    };
    handlers[method] = async context => {
      // Native admission is isolated from the protected handler. Check again at
      // this trusted exported function so embedding code cannot bypass formats.
      const admitted = admitRequest(method, context, plan.limits);
      if (admitted !== true) { counts[method].inputRejected++; return admitted; }
      counts[method].requests++;
      const result = await call(method, rpcParams(method, context.body, plan.limits), context);
      counts[method][result.status < 400 ? 'succeeded' : 'failed']++;
      if (result.body?.error === 'STELLAR_RPC_REJECTED') counts[method].rpcRejected++;
      return result;
    };
  }
  return Object.freeze({ handlers: Object.freeze(handlers),
    snapshot: () => ({ schema: 'stellar-forge.getblock-stellar-runtime.v1', dataNetwork: DATA_NETWORK,
      region: target.region, transport: transport.snapshot(), operations: structuredClone(counts) }),
    /** Explicit operator diagnosis costs two provider reads; never runs during prepare/import. */
    async diagnose({ signal } = {}) {
      const context = { method: 'POST', url: new URL(plan.publicOrigin), headers: {}, query: {}, signal };
      const network = await call('getNetwork', undefined, context);
      if (network.status !== 200) return { status: 'PROVIDER_READ_FAILED', error: network.body?.error, rpcCode: network.body?.rpcCode };
      if (network.body.passphrase !== MAINNET) return { status: 'DATA_NETWORK_MISMATCH', expected: DATA_NETWORK };
      const health = await call('getHealth', undefined, context);
      if (health.status !== 200) return { status: 'PROVIDER_READ_FAILED', error: health.body?.error, rpcCode: health.body?.rpcCode };
      if (health.body.status !== 'healthy' || !positiveLedger(health.body.oldestLedger) ||
          health.body.oldestLedger > health.body.latestLedger) return { status: 'PROVIDER_NOT_HEALTHY' };
      return { status: 'PROVIDER_MAINNET_READY', dataNetwork: DATA_NETWORK, region: target.region,
        latestLedger: health.body.latestLedger, oldestLedger: health.body.oldestLedger,
        ...(Number.isSafeInteger(health.body.ledgerRetentionWindow) ? { ledgerRetentionWindow: health.body.ledgerRetentionWindow } : {}),
        protocolVersion: network.body.protocolVersion, observedAt: new Date().toISOString() };
    },
  });
}
