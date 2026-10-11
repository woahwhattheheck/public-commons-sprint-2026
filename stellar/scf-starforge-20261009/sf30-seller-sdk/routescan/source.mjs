// MIT. Routescan application source; original SF30 owns the HTTP exchange and payment lifecycle.
import { Agent as HttpsAgent } from 'node:https';
import { createUpstreamHandler } from '../upstream-handler.mjs';
import { PROVIDER_ORIGIN, FILTERS, requestFor, fail, plain, sha256 } from './config.mjs';
import { openRoutescanQuota } from './quota.mjs';

function validResponse(operation, body) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { return false; }
  if (operation === 'series') return Array.isArray(value) && value.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string'));
  return plain(value) && typeof value.value === 'string';
}
function applicationFailure(error) {
  return { status: error.status ?? 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
    ...(error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {}) },
    body: { error: error.code ?? 'ROUTESCAN_SOURCE_UNAVAILABLE', message: error.code ? error.message : 'The gas data source is unavailable.' } };
}
export async function createRoutescanSource(compiled, { quotaDirectory, env = process.env } = {}) {
  let quota, agent;
  try {
  agent = new HttpsAgent({ keepAlive: false, proxyEnv: env });
  quota = await openRoutescanQuota({ directory: quotaDirectory, provider: compiled.config.provider, policy: compiled.config.quota });
  let closed = false, pending = new Set();
  const headers = () => {
    const name = compiled.config.provider.apiKeyEnv;
    if (!name) return {};
    const value = env[name];
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\r\n\0]/.test(value)) fail('The configured provider key environment is unavailable.', 503, 'ROUTESCAN_KEY_UNAVAILABLE');
    return { apikey: value };
  };
  const upstreams = new Map(compiled.products.map(product => [product.id, createUpstreamHandler({
    baseUrl: PROVIDER_ORIGIN, path: product.upstreamPath, method: 'GET',
    query: [...(product.operation === 'series' ? ['dateFrom', 'dateTo', 'unit'] : ['dateFrom', 'dateTo']), ...FILTERS],
    agent,
    headers, responseHeaders: ['content-type'], responseType: 'json', timeoutMs: compiled.config.timeoutMs,
    maxResponseBytes: compiled.config.maxResponseBytes, maxInFlight: Math.min(256, compiled.config.quota.requestsPerSecond),
  })]));
  function request(id, values, { signal } = {}) {
    const operation = (async () => {
      if (closed) fail('The Routescan source is closed.', 503);
      const selected = requestFor(compiled, id, values);
      signal?.throwIfAborted(); headers();
      const reserved = await quota.reserve();
      signal?.throwIfAborted();
      const url = new URL(selected.product.path, compiled.config.publicOrigin);
      for (const [key, value] of Object.entries(selected.request)) url.searchParams.set(key, value);
      const response = await upstreams.get(id)({ method: 'GET', url, query: selected.request, pathParams: {}, headers: {}, body: null, signal });
      await quota.observe(response);
      if (response.status === 200 && (!Buffer.isBuffer(response.body) || !validResponse(selected.product.operation, response.body)))
        return { status: 502, headers: { 'content-type': 'application/json' }, body: { error: 'ROUTESCAN_RESPONSE_CONTRACT_CHANGED' },
          source: { url: selected.sourceUrl, product: id, request: selected.request, reserved } };
      return { ...response, headers: { ...response.headers, 'cache-control': 'no-store', 'x-data-provider': 'Powered by Routescan.io APIs',
        'x-routescan-source-url': selected.sourceUrl,
        ...(Buffer.isBuffer(response.body) ? { 'x-routescan-source-sha256': sha256(response.body) } : {}) },
        source: { url: selected.sourceUrl, product: id, operation: selected.product.operation,
          network: compiled.config.provider.network, chainId: compiled.config.provider.chainId,
          request: selected.request, reserved,
          ...(Buffer.isBuffer(response.body) ? { bytes: response.body.length, sha256: sha256(response.body) } : {}) } };
    })();
    pending.add(operation); operation.finally(() => pending.delete(operation)).catch(() => {}); return operation;
  }
  const handlers = Object.create(null);
  for (const product of compiled.products) {
    handlers[product.id + 'Admission'] = async context => {
      try {
        requestFor(compiled, product.id, context.query); headers();
        const current = await quota.snapshot();
        if (!current.allowed) throw Object.assign(new Error('Provider call quota is currently unavailable.'), {
          status: 429, code: 'ROUTESCAN_QUOTA_UNAVAILABLE', retryAfter: current.retryAfterSeconds,
        });
        return true;
      } catch (error) { return applicationFailure(error); }
    };
    handlers[product.id] = async context => {
      try { const response = await request(product.id, context.query, { signal: context.signal });
        return { status: response.status, headers: response.headers, body: response.body }; }
      catch (error) { return applicationFailure(error); }
    };
  }
  return { handlers, request, quota, async snapshot() { return { quota: await quota.snapshot(),
    upstreams: Object.fromEntries([...upstreams].map(([id, handler]) => [id, handler.snapshot()])) }; },
    async close() { closed = true; await Promise.allSettled([...pending]); agent.destroy(); await quota.close(); } };
  } catch (error) {
    agent?.destroy();
    await quota?.close();
    throw error;
  }
}
