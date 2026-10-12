// MIT. The existing SF30 transport executes every provider request.
import { createUpstreamHandlers, closeUpstreamHandlers } from '../../sf30-seller-sdk/upstream.mjs';
import { UPSTREAM_ATTEMPT } from '../../sf30-seller-sdk/upstream-handler.mjs';
import { compileResponseContract, RESPONSE_CONTRACT_SCHEMA } from '../../sf30-seller-sdk/response-contract.mjs';
import { openProviderAccounting } from './accounting.mjs';
import { prepareProduct, selectedToken, admitToken, reject, tokenSchema, validateTokenValue, ORIGIN, QUOTA_HEADERS, CONTRACT, error } from './product.mjs';

function providerTarget(value) {
  if (value === undefined) return { origin: ORIGIN, allowLoopback: false, source: 'blockscout-pro' };
  let url;
  try { url = new URL(value); } catch { throw error('BLOCKSCOUT_DEVELOPMENT_ORIGIN_INVALID'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== value || url.username || url.password)
    throw error('BLOCKSCOUT_DEVELOPMENT_ORIGIN_INVALID');
  return { origin: value, allowLoopback: true, source: 'loopback-contract-fixture' };
}

export async function createBlockscoutApplication(input, { directory, env = process.env, lookup,
  developmentProviderOrigin, now } = {}) {
  const prepared = prepareProduct(input), { plan } = prepared;
  const key = env?.[plan.apiKeyEnv];
  if (typeof key !== 'string' || key.length < 16 || key.length > 4096 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(key))
    throw error('BLOCKSCOUT_PRIVATE_API_KEY_REQUIRED');
  const target = providerTarget(developmentProviderOrigin);
  const responseValidator = compileResponseContract({ schema: RESPONSE_CONTRACT_SCHEMA, method: 'GET',
    responses: { '200': { content: { 'application/json': tokenSchema() } } } });
  const bindings = Object.fromEntries(plan.chains.map(chain => ['blockscout_' + chain.chainId, {
    origin: target.origin, path: '/' + chain.chainId + '/api/v2/tokens/:address_hash', method: 'GET',
    responseMode: 'json', headerEnv: { authorization: 'BLOCKSCOUT_RUNTIME_AUTHORIZATION' },
    responseHeaders: ['content-type', 'etag', 'last-modified', ...QUOTA_HEADERS],
    timeoutMs: plan.limits.timeoutMs, maxResponseBytes: plan.limits.maxResponseBytes,
    maxInFlight: plan.limits.maxInFlight,
    availability: { failureThreshold: 3, resetAfterMs: 30000, maxResetAfterMs: 300000 },
  }]));
  const transport = createUpstreamHandlers({ schema: 'stellar-forge.seller-upstreams.v1', bindings },
    { allowLoopback: target.allowLoopback, env: { BLOCKSCOUT_RUNTIME_AUTHORIZATION: 'Bearer ' + key },
      ...(lookup === undefined ? {} : { lookup }) });
  let accounting;
  try { accounting = await openProviderAccounting({ directory, plan, ...(now === undefined ? {} : { now }) }); }
  catch (e) { await closeUpstreamHandlers(transport); throw e; }
  let closing = false, closingPromise;
  const active = new Set(), handlers = {};
  function admit(chain, context) {
    if (closing) return reject(503, 'BLOCKSCOUT_CLOSING');
    const valid = admitToken(context, chain.chainId, plan);
    if (valid !== true) return valid;
    try {
      const d = accounting.admission();
      if (!d.allowed) return reject(d.status, d.code, d.retryAfter);
      return transport['blockscout_' + chain.chainId].admit(context);
    } catch { return reject(503, 'BLOCKSCOUT_ACCOUNTING_UNAVAILABLE'); }
  }
  function invoke(chain, context, purpose = 'customer') {
    if (closing) return Promise.resolve(reject(503, 'BLOCKSCOUT_CLOSING'));
    const run = (async () => {
      const admitted = admit(chain, context);
      if (admitted !== true) return admitted;
      const token = selectedToken(plan, chain.chainId, context.pathParams.address_hash);
      let id;
      try { id = accounting.begin({ ...token, purpose }); }
      catch (e) { return reject(e.status ?? 503, e.code ?? 'BLOCKSCOUT_ACCOUNTING_UNAVAILABLE', e.retryAfter); }
      let response, attempt;
      try {
        response = await transport['blockscout_' + chain.chainId](context);
        attempt = response[UPSTREAM_ATTEMPT];
      } catch {
        response = reject(502, 'BLOCKSCOUT_PROVIDER_REQUEST_FAILED');
      }
      const upstreamStatus = attempt?.upstreamStatus ?? response.body?.upstreamStatus ?? (response.status < 400 ? response.status : null);
      const dispatched = attempt?.dispatched ?? true;
      const providerHeaders = Object.fromEntries(Object.entries(response.headers ?? {})
        .filter(([, value]) => typeof value === 'string' && !value.includes(key)));
      let original = Buffer.isBuffer(response.body) ? response.body : null;
      let code = response.body?.error;
      if (response.status < 400) {
        let value;
        try {
          if (!original) throw Error();
          const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
          // A provider echo must never persist or release the launch credential.
          if (text.includes(key)) { original = null; code = 'BLOCKSCOUT_RESPONSE_PRIVATE'; }
          else value = JSON.parse(text);
        } catch { code = 'BLOCKSCOUT_RESPONSE_INVALID'; }
        if (!code) {
          const invalid = responseValidator.validate({ status: response.status, contentType: response.headers?.['content-type'],
            body: original, value });
          if (invalid) code = 'BLOCKSCOUT_TOKEN_CONTRACT_CHANGED';
          else code = validateTokenValue(value, token.addressHash);
        }
        if (code) response = reject(502, code);
      }
      let retained;
      try {
        retained = accounting.finish(id, { dispatched, status: response.status, upstreamStatus, code,
          body: original, headers: providerHeaders });
      } catch { return reject(503, 'BLOCKSCOUT_RESPONSE_RETENTION_FAILED'); }
      if (response.status >= 400) return { status: response.status, body: response.body,
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store',
          'x-blockscout-observation-id': id,
          ...(providerHeaders['retry-after'] ? { 'retry-after': providerHeaders['retry-after'] } : {}) } };
      const headers = { 'content-type': response.headers['content-type'], 'cache-control': 'private, no-store',
        'x-blockscout-observation-id': id, 'x-blockscout-response-sha256': retained.response.sha256,
        'x-blockscout-data-chain': token.chainId };
      for (const name of ['etag', 'last-modified']) if (providerHeaders[name]) headers[name] = providerHeaders[name];
      return { status: response.status, headers, body: original };
    })();
    active.add(run); run.finally(() => active.delete(run)).catch(() => {}); return run;
  }
  for (const chain of plan.chains) {
    const id = 'blockscout_' + chain.chainId;
    handlers[id] = context => invoke(chain, context);
    handlers['admit_' + id] = context => admit(chain, context);
  }
  function snapshot() {
    return { schema: 'stellar-forge.blockscout-runtime.v1', contract: CONTRACT, source: target.source,
      publicOrigin: plan.publicOrigin, paymentNetwork: plan.payment.network,
      chains: plan.chains.map(row => ({ ...row, dataNetwork: 'eip155:' + row.chainId })),
      provider: accounting.snapshot(), transport: Object.fromEntries(Object.entries(transport)
        .filter(([, handler]) => typeof handler.snapshot === 'function').map(([name, handler]) => [name, handler.snapshot()])) };
  }
  return Object.freeze({ plan, prepared, handlers: Object.freeze(handlers), accounting, snapshot,
    async diagnose({ chainId, addressHash, signal } = {}) {
      const token = selectedToken(plan, chainId, addressHash);
      const chain = plan.chains.find(row => row.chainId === chainId);
      const result = await invoke(chain, { method: 'GET', url: new URL(token.url), query: {}, headers: {},
        pathParams: { address_hash: addressHash }, signal }, 'diagnostic');
      const id = result.headers?.['x-blockscout-observation-id'];
      return { status: result.status, source: target.source, token,
        error: result.body?.error ?? null, observation: id ? accounting.get(id) : null };
    },
    close() {
      if (!closingPromise) {
        closing = true;
        closingPromise = (async () => {
          await Promise.allSettled([...active]);
          try { await closeUpstreamHandlers(transport); } finally { await accounting.close(); }
        })();
      }
      return closingPromise;
    } });
}
