// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';
import { readContract, normalizeConnection, credential, planRequest, sha256, hashJSON, requireValue, publicError } from './contract.mjs';
export function retryNotBefore(headers, observedAt) {
  const raw = headers?.['retry-after'];
  const value = typeof raw === 'string' ? raw.trim() : '';
  const base = Date.parse(observedAt);
  if (!value || !Number.isFinite(base)) return null;
  let time;
  if (/^\d+(?:\.\d+)?$/.test(value)) time = base + Math.ceil(Number(value) * 1000);
  else time = Date.parse(value);
  if (!Number.isFinite(time) || Math.abs(time) > 8640000000000000) return null;
  return new Date(Math.max(base, time)).toISOString();
}
export function deferredAdmission(exchange, priorAttempts = 0) {
  const observed = Number.isFinite(Date.parse(exchange.completedAt)) ? exchange.completedAt : new Date().toISOString();
  const provider = retryNotBefore(exchange.headers, observed);
  const delayMs = Math.min(3600000, 60000 * 2 ** Math.min(6, Math.max(0, priorAttempts)));
  return { notBefore: provider ?? new Date(Date.parse(observed) + delayMs).toISOString(),
    basis: provider ? 'provider-retry-after' : 'local-exponential-delay',
    observedAt: observed, localDelayMs: provider ? null : delayMs };
}
const capturedExchange=exchange=>exchange.retained?{id:exchange.id,requestSha256:exchange.request?.sha256??null,status:exchange.status,complete:exchange.complete,bodyBytes:exchange.bodyBytes,bodySha256:exchange.bodySha256,reference:exchange.retained}:exchange;
export async function createGraviteeClient(configuration, { environment = process.env, fetch = globalThis.fetch, onExchange } = {}) {
  const connection = normalizeConnection(configuration), contract = await readContract(connection.contract);
  async function perform(plan, { signal, retain = onExchange, beforeDispatch } = {}) {
    requireValue(plan.connectionId === connection.id && plan.contractSha256 === hashJSON(contract), 'REQUEST_TARGET_CHANGED');
    const { sha256: savedHash, ...unsigned } = plan;
    requireValue(hashJSON(unsigned) === savedHash, 'REQUEST_CHANGED');
    const declared=planRequest(connection,contract,plan.operationId,plan.parameters??{});
    requireValue(declared.sha256===plan.sha256,'NATIVE_REQUEST_CONTRACT_CHANGED','The original request must match this connection and its selected native operation.');
    const headers = { accept: 'application/json', authorization: credential(connection, environment), ...(plan.publicHeaders ?? {}) };
    if (plan.bodyText !== null) headers['content-type'] = 'application/json';
    const timeout = AbortSignal.timeout(connection.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const exchange = { schema: 'gravitee.native-exchange.v1', id: randomUUID(), request: plan,
      startedAt: new Date().toISOString(), status: null, headers: {}, bodyBase64: '', bodyBytes: 0,
      bodySha256: sha256(''), complete: false, outcomeUnknown: false };
    if (beforeDispatch) await beforeDispatch(exchange);
    try {
      const response = await fetch(plan.url, { method: plan.method, headers, body: plan.bodyText ?? undefined,
        signal: requestSignal, redirect: 'manual' });
      exchange.status = response.status; exchange.statusText = response.statusText;
      exchange.headers = Object.fromEntries([...response.headers].filter(([key]) => !['set-cookie', 'www-authenticate', 'proxy-authenticate'].includes(key.toLowerCase())));
      const chunks = []; let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.byteLength; chunks.push(Buffer.from(part.value));
            requireValue(length <= connection.maximumResponseBytes, 'PROVIDER_RESPONSE_LIMIT', 'The response exceeded this connection’s configured full-response limit.');
          }
        } catch (error) {
          await reader.cancel(error).catch(()=>{});
          const bytes = Buffer.concat(chunks); exchange.bodyBase64 = bytes.toString('base64');
          exchange.bodyBytes = bytes.length; exchange.bodySha256 = sha256(bytes);
          throw error;
        } finally { reader.releaseLock(); }
      }
      const bytes = Buffer.concat(chunks);
      exchange.bodyBytes = bytes.length; exchange.bodySha256 = sha256(bytes); exchange.bodyBase64 = bytes.toString('base64');
      try { exchange.json = bytes.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : null; }
      catch { exchange.json = null; }
      exchange.complete = true; exchange.accepted = plan.expectedStatuses.includes(response.status);
      exchange.completedAt = new Date().toISOString();
      exchange.notBefore = retryNotBefore(exchange.headers, exchange.completedAt);
    } catch (error) {
      exchange.completedAt = new Date().toISOString(); exchange.error = publicError(error);
      exchange.outcomeUnknown = plan.changesProvider;
    }
    // Keep the provider result even when publication of the original call fails.
    if (retain) { try { exchange.retained = await retain(exchange); }
      catch (error) { error.exchange = exchange; error.outcomeUnknown = plan.changesProvider; throw error; } }
    return exchange;
  }
  const call = (operationId, input = {}, options = {}) => perform(planRequest(connection, contract, operationId, input), options);
  async function all(operationId, input = {}, options = {}) {
    const pages = [], items = [], seen = new Set(); let page = 1, finished = false, firstTotal = null, finalTotal = null;
    const perPage = input.query?.perPage ?? 100;
    requireValue(Number.isSafeInteger(perPage) && perPage > 0, 'PAGE_SIZE_INVALID');
    while (!finished) {
      const exchange = await call(operationId, { ...input, query: { ...(input.query ?? {}), page, perPage } }, options);
      pages.push(capturedExchange(exchange));
      requireValue(exchange.complete && exchange.accepted, 'INVENTORY_PAGE_FAILED', 'The original page response is retained; resume by reviewing this operation.', exchange.status ?? 502);
      const body = exchange.json;
      requireValue(Array.isArray(body?.data) && body.pagination && Number.isSafeInteger(body.pagination.page),
        'PAGINATION_SHAPE_CHANGED', 'The selected server did not return its declared data/pagination page.');
      requireValue(body.pagination.page === page, 'PAGINATION_PAGE_REPEATED');
      const signature = hashJSON(body.data);
      requireValue(!seen.has(signature) || body.data.length === 0, 'PAGINATION_CONTENT_REPEATED');
      seen.add(signature); items.push(...body.data);
      if (firstTotal === null) firstTotal = body.pagination.totalCount;
      finalTotal=body.pagination.totalCount;
      const count = body.pagination.pageCount;
      if (Number.isSafeInteger(count) && count >= 1) finished = page >= count;
      else if (count === 0 && body.data.length === 0) finished = true;
      else finished = body.data.length < perPage;
      requireValue(finished || body.data.length > 0, 'PAGINATION_EMPTY_NONTERMINAL');
      page += 1;
    }
    return { items, pages, terminal: true, complete: true, firstTotal, finalTotal,
      inventoryChanged: firstTotal !== finalTotal };
  }
  async function captureApi(apiId, options = {}) {
    const exchanges = [];
    const capture = async (name, input) => { const result = await call(name, input, options); exchanges.push(capturedExchange(result)); return result; };
    const current = await capture('getApi', { apiId });
    if (!current.complete || !current.accepted || !current.json || typeof current.json !== 'object' || Array.isArray(current.json)) return { apiId, api: null, complete: false, exchanges };
    const exported = await capture('exportApiDefinition', { apiId });
    const collections = {};
    for (const [key, operationId, query] of [
      ['plans', 'listApiPlans', { statuses: ['STAGING', 'PUBLISHED', 'DEPRECATED', 'CLOSED'] }],
      ['members', 'listApiMembers', {}], ['metadata', 'getApiMetadata', {}], ['events', 'getApiEvents', {}],
    ]) {
      try { collections[key] = await all(operationId, { apiId, query }, options); exchanges.push(...collections[key].pages); }
      catch (error) { collections[key] = { complete: false, error: publicError(error) }; }
    }
    const pages = await capture('getApiPages', { apiId });
    const deployment = await capture('getCurrentApiDeployment', { apiId });
    const fullObject = result => result.complete && result.accepted && result.json !== null && typeof result.json === 'object' && !Array.isArray(result.json);
    const deploymentComplete = fullObject(deployment);
    const documentationComplete = fullObject(pages) && Array.isArray(pages.json.pages);
    return { apiId, capturedAt: new Date().toISOString(), api: current.json, apiSha256: hashJSON(current.json),
      export: fullObject(exported) ? exported.json : null, collections, documentation: documentationComplete ? pages.json : null,
      deployment: deploymentComplete ? deployment.json : null,
      deploymentObservation: { complete: deploymentComplete, status: deployment.status, state: deploymentComplete ? 'RECEIVED' : 'INCOMPLETE' },
      complete: fullObject(exported) && ['plans', 'members', 'metadata', 'events'].every(k => collections[k]?.terminal && collections[k]?.complete) && documentationComplete && deploymentComplete,
      exchanges };
  }
  async function probe({ gatewayIndex = 0, path = '/', method = 'GET', expectedStatus, headerEnv = {}, body = null }, { signal, retain = onExchange } = {}) {
    requireValue(['GET', 'HEAD', 'OPTIONS'].includes(method), 'GATEWAY_PROBE_METHOD_INVALID', 'Gateway probes use GET, HEAD or OPTIONS. Use your service client for data-changing workloads.');
    const base = connection.gatewayUrls[gatewayIndex];
    requireValue(base && typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'), 'CONFIGURED_GATEWAY_PATH_REQUIRED');
    const url = new URL(base + path);
    requireValue(url.origin === new URL(base).origin, 'GATEWAY_ORIGIN_CHANGED');
    const headers = {};
    for (const [key, env] of Object.entries(headerEnv)) {
      requireValue(/^[A-Za-z0-9-]+$/.test(key) && !['host','connection','content-length'].includes(key.toLowerCase()), 'GATEWAY_HEADER_INVALID');
      requireValue(/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) && typeof environment[env] === 'string', 'GATEWAY_CREDENTIAL_VARIABLE_REQUIRED');
      headers[key] = environment[env];
    }
    const record = { schema: 'gravitee.gateway-request.v1', id: randomUUID(), gatewayIndex, url: url.href, method,
      expectedStatus: expectedStatus ?? null, credentialVariables: headerEnv, startedAt: new Date().toISOString() };
    try {
      const response = await fetch(url, { method, headers, redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(connection.requestTimeoutMs)]) : AbortSignal.timeout(connection.requestTimeoutMs) });
      const reader = response.body?.getReader(), chunks = []; let bytes = 0;
      if (reader) try { while (true) { const p = await reader.read(); if (p.done) break; bytes += p.value.byteLength; chunks.push(Buffer.from(p.value)); requireValue(bytes <= connection.maximumResponseBytes, 'PROBE_RESPONSE_LIMIT'); } }
      catch(error){await reader.cancel(error).catch(()=>{});const partial=Buffer.concat(chunks);Object.assign(record,{status:response.status,bodyBase64:partial.toString('base64'),bodyBytes:partial.length,bodySha256:sha256(partial)});throw error;}
      finally { reader.releaseLock(); }
      const value = Buffer.concat(chunks);
      Object.assign(record, { status: response.status, bodyBase64: value.toString('base64'), bodyBytes: value.length, bodySha256: sha256(value),
        matchesExpectedStatus: expectedStatus === undefined ? null : response.status === expectedStatus, complete: true });
    } catch (error) { record.error = publicError(error); record.complete = false; }
    record.completedAt = new Date().toISOString(); if (retain) record.retained = await retain(record); return record;
  }
  return { connection, contract, plan: (id, input) => planRequest(connection, contract, id, input), perform, call, all, captureApi, probe };
}
