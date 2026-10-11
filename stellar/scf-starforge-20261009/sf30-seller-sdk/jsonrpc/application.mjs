// MIT. Fixed Stellar read products over ORIGINAL SF30 upstream transport.
import { createUpstreamApplication, createUpstreamHandlers,
  closeUpstreamHandlers } from '../upstream.mjs';
import { prepareProduct, credentialReferences } from './config.mjs';
import { admitRequest, rpcParams, correlationId, responseContract,
  resultMatchesRequest } from './stellar.mjs';

const error = code => Object.assign(new Error(code), { code });
const failure = (status, code) => ({ status,
  headers: { 'content-type': 'application/json; charset=utf-8' }, body: { error: code } });
function endpointFrom(plan, env) {
  const value = Object.hasOwn(env, plan.endpointEnv) ? env[plan.endpointEnv] : undefined;
  let url;
  try { url = new URL(value); } catch { throw error('STELLAR_RPC_ENDPOINT_INVALID'); }
  // The complete credential-bearing URL exists only in this launch-time closure.
  // The original binding compiler applies public HTTPS/DNS policy to its origin.
  if (typeof value !== 'string' || value !== url.href || value.length > 2048 ||
      url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#') ||
      !/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(url.pathname) ||
      url.origin === plan.publicOrigin) throw error('STELLAR_RPC_ENDPOINT_INVALID');
  return url;
}
function bindingFor(plan, endpoint, method, protect = true) {
  return { origin: endpoint.origin, path: endpoint.pathname, method: 'POST',
    requestHeaders: [], responseHeaders: [], responseMode: 'json',
    timeoutMs: plan.limits.timeoutMs, maxResponseBytes: plan.limits.maxResponseBytes,
    maxInFlight: plan.limits.maxInFlight,
    ...(plan.headerEnv ? { headerEnv: plan.headerEnv } : {}),
    ...(plan.oauth2 ? { oauth2: plan.oauth2 } : {}),
    ...(protect && plan.upstreamAvailability ? { availability: plan.upstreamAvailability } : {}),
    responseContract: responseContract(method, plan.limits, plan.dataNetwork),
  };
}
function wireContext(method, context, limits) {
  const params = rpcParams(method, context.body, limits);
  return { ...context, body: { jsonrpc: '2.0', id: correlationId(method), method,
    ...(params === undefined ? {} : { params }) } };
}
function privateNeedles(endpoint, plan, env) {
  const values = [endpoint.href, endpoint.pathname,
    ...endpoint.pathname.split('/').filter(part => part.length >= 8)];
  for (const variable of credentialReferences(plan)) {
    const value = env[variable];
    if (typeof value === 'string') {
      values.push(value);
      if (/^Bearer /i.test(value)) values.push(value.slice(7));
    }
  }
  return [...new Set(values.filter(value => value.length >= 8))];
}
function containsPrivateData(value, needles) {
  const stack = [value];
  let visited = 0;
  while (stack.length) {
    if (++visited > 100000) return true;
    const next = stack.pop();
    if (typeof next === 'string') {
      if (needles.some(secret => next.includes(secret))) return true;
    } else if (next && typeof next === 'object') {
      for (const [key, child] of Object.entries(next)) stack.push(key, child);
    }
  }
  return false;
}

/** No listener or probe starts during construction. Call verifyNetwork before sale. */
export function createStellarRpcApplication(input, { env = process.env,
  allowLoopbackUpstream = false, lookup } = {}) {
  const prepared = prepareProduct(input), { plan } = prepared;
  if (env === null || typeof env !== 'object' || Array.isArray(env) ||
      typeof allowLoopbackUpstream !== 'boolean') throw new TypeError('Invalid RPC runtime options');
  const captured = Object.freeze(Object.fromEntries(credentialReferences(plan)
    .filter(name => Object.hasOwn(env, name)).map(name => [name, env[name]])));
  const endpoint = endpointFrom(plan, captured), needles = privateNeedles(endpoint, plan, captured);
  const runtimeOptions = { env: captured, allowLoopback: allowLoopbackUpstream,
    ...(lookup === undefined ? {} : { lookup }) };
  const upstreams = { schema: 'stellar-forge.seller-upstreams.v1', bindings:
    Object.fromEntries(plan.operations.map(({ method }) => [method, bindingFor(plan, endpoint, method)])) };
  const originalConfig = structuredClone(prepared.service);
  for (const route of originalConfig.routes) delete route.admit;
  // Every envelope contract executes inside the original handler, before the
  // original upstream health accounting accepts a response as successful.
  const application = createUpstreamApplication(originalConfig, upstreams, runtimeOptions);
  let probes;
  try {
    probes = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1',
      bindings: Object.fromEntries(['getNetwork', 'getHealth'].map(method =>
        [method, bindingFor(plan, endpoint, method, false)])) }, runtimeOptions);
  } catch (cause) {
    // Construction has admitted no work. Original close releases private providers.
    application.close().catch(() => {});
    throw error('STELLAR_RPC_CONFIGURATION_INVALID');
  }
  const service = structuredClone(application.config), handlers = { ...application.handlers };
  const totals = { acceptedResults: 0, resultRejected: 0, privateDataRejected: 0, probeReads: 0 };
  const probeController = new AbortController();
  let closed = false, closing, verifiedAt = null, networkPromise, healthPromise;

  function inspectResponse(method, context, response) {
    if (response.status !== 200) return response;
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); }
    catch { totals.resultRejected++; return failure(502, 'STELLAR_RPC_RESULT_INVALID'); }
    if (containsPrivateData(envelope, needles)) {
      totals.privateDataRejected++;
      return failure(502, 'STELLAR_RPC_PRIVATE_DATA_REFUSED');
    }
    if (!resultMatchesRequest(method, envelope.result, rpcParams(method, context.body, plan.limits))) {
      totals.resultRejected++;
      return failure(502, 'STELLAR_RPC_RESULT_INVALID');
    }
    totals.acceptedResults++;
    // Return ORIGINAL bytes, including integer literals beyond JS safe integers.
    return response;
  }
  for (const route of service.routes) {
    const method = route.handler, original = application.handlers[method];
    const upstreamAdmission = route.admit ? application.handlers[route.admit] : undefined;
    const admissionName = 'admit' + method;
    handlers[admissionName] = async context => {
      if (closed) return failure(503, 'STELLAR_RPC_CLOSED');
      if (!verifiedAt) return failure(503, 'STELLAR_RPC_NETWORK_UNCHECKED');
      const valid = admitRequest(method, context, plan.limits);
      if (valid !== true) return valid;
      return upstreamAdmission ? upstreamAdmission(wireContext(method, context, plan.limits)) : true;
    };
    handlers[method] = async context => {
      if (closed) return failure(503, 'STELLAR_RPC_CLOSED');
      if (!verifiedAt) return failure(503, 'STELLAR_RPC_NETWORK_UNCHECKED');
      const valid = admitRequest(method, context, plan.limits);
      if (valid !== true) return valid;
      return inspectResponse(method, context, await original(wireContext(method, context, plan.limits)));
    };
    route.admit = admissionName;
  }
  async function probe(method) {
    if (closed) throw error('STELLAR_RPC_CLOSED');
    const context = { method: 'POST', url: new URL(plan.publicOrigin + '/stellar/' + method),
      query: {}, body: {}, headers: {}, pathParams: {}, signal: probeController.signal };
    totals.probeReads++;
    const response = inspectResponse(method, context,
      await probes[method](wireContext(method, context, plan.limits)));
    if (response.status !== 200) throw error(method === 'getNetwork' ?
      'STELLAR_RPC_NETWORK_PREFLIGHT_FAILED' : 'STELLAR_RPC_HEALTH_PREFLIGHT_FAILED');
    return JSON.parse(response.body.toString('utf8')).result;
  }
  function verifyNetwork() {
    if (closed) return Promise.reject(error('STELLAR_RPC_CLOSED'));
    return networkPromise ??= probe('getNetwork').then(result => {
      if (closed) throw error('STELLAR_RPC_CLOSED');
      verifiedAt = new Date().toISOString();
      return { dataNetwork: plan.dataNetwork, protocolVersion: result.protocolVersion, verifiedAt };
    });
  }
  async function diagnose() {
    const network = await verifyNetwork();
    const health = await (healthPromise ??= probe('getHealth'));
    return { status: 'STELLAR_RPC_READY', ...network, health: health.status,
      latestLedger: health.latestLedger, oldestLedger: health.oldestLedger,
      ledgerRetentionWindow: health.ledgerRetentionWindow, providerReads: totals.probeReads };
  }
  function close() {
    if (closing) return closing;
    closed = true; probeController.abort(error('STELLAR_RPC_CLOSED'));
    return closing = (async () => {
      await Promise.allSettled([networkPromise, healthPromise].filter(Boolean));
      const results = await Promise.allSettled([application.close(), closeUpstreamHandlers(probes)]);
      if (results.some(result => result.status === 'rejected')) throw error('STELLAR_RPC_CLOSE_FAILED');
    })();
  }
  return { plan, config: service, handlers: Object.freeze(handlers), verifyNetwork, diagnose, close,
    snapshot: () => ({ ...application.snapshot(), rpc: { dataNetwork: plan.dataNetwork,
      networkVerifiedAt: verifiedAt, closed, methods: plan.operations.map(row => row.method), ...totals } }) };
}
