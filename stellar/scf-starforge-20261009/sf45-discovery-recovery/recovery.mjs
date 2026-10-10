// MIT. Actual GET-only recovery client for the public PR451 Bazaar HTTP contract.
// No x402 payment retries, signer, settlement or account keys.
import { setTimeout as delay } from 'node:timers/promises';

const TRANSIENT = new Set([429, 502, 503, 504]);
const MAX_PAGES = 100_000;

export class DiscoveryError extends Error {
  constructor(code, status = null, detail = '') {
    super(code + (status ? ' (' + status + ')' : '') + (detail ? ': ' + detail : ''));
    this.name = 'DiscoveryError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function stableResourceIdentity(resource) {
  const input = resource?.extensions?.bazaar?.info?.input;
  if (!['http', 'mcp'].includes(input?.type) || typeof resource?.resource?.url !== 'string')
    throw new DiscoveryError('MALFORMED_RESOURCE');
  const uri = new URL(resource.resource.url);
  if (input.type === 'mcp') {
    if (typeof input.toolName !== 'string' || !input.toolName) throw new DiscoveryError('MALFORMED_MCP');
    return 'mcp|' + uri.href + '|' + input.toolName;
  }
  if (typeof input.method !== 'string') throw new DiscoveryError('MALFORMED_HTTP');
  const template = resource.extensions.bazaar.routeTemplate;
  const path = typeof template === 'string' && template.startsWith('/') ? template : uri.pathname;
  return 'http|' + uri.origin + '|' + path + '|' + uri.search + '|' + input.method;
}

export async function fetchDiscoveryCatalog({
  baseUrl,
  query,
  network = 'stellar:testnet',
  scheme = 'exact',
  pageLimit = 20,
  maxRetries = 3,
  maxRestarts = 2,
  timeoutMs = 1500,
  backoffMs = 50,
  signal,
  onPage
}) {
  if (!baseUrl || typeof query !== 'string' || !query.trim() || query.length > 1024)
    throw new TypeError('baseUrl and nonempty discovery query are required');
  if (!['stellar:testnet', 'stellar:pubnet'].includes(network) || typeof scheme !== 'string' || !scheme)
    throw new TypeError('Explicit Stellar network and scheme required');
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100 ||
      !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20 ||
      !Number.isInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 20 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      !Number.isInteger(backoffMs) || backoffMs < 0 || backoffMs > 60_000)
    throw new TypeError('Invalid bounded retry/pagination configuration');
  const root = new URL(baseUrl);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || root.pathname !== '/')
    throw new TypeError('Absolute discovery root URL without userinfo/path required');
  const started = performance.now();
  let attempts = 0, retries = 0, restarts = 0, pages = 0;
  let results = [], seen = new Set(), cursor = null;
  while (pages < MAX_PAGES) {
    signal?.throwIfAborted();
    const url = new URL('/discovery/search', root);
    url.searchParams.set('query', query);
    url.searchParams.set('network', network);
    url.searchParams.set('scheme', scheme);
    url.searchParams.set('limit', String(pageLimit));
    if (cursor) url.searchParams.set('cursor', cursor);
    let response, body;
    for (let attempt = 0;; attempt++) {
      attempts++;
      try {
        // Independently stop each exact-source HTTP request. No charged operation retried.
        response = await fetch(url, { method: 'GET', signal: AbortSignal.any([
          AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])
        ]), redirect: 'error' });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (attempt >= maxRetries) throw new DiscoveryError('DISCOVERY_NETWORK_EXHAUSTED', null, error.name);
        retries++;
        await delay(backoffMs * Math.min(2 ** attempt, 8), undefined, signal ? { signal } : {});
        continue;
      }
      if (TRANSIENT.has(response.status)) {
        // Even if the remote service supplies Retry-After, cap by our local policy.
        await response.body?.cancel();
        if (attempt >= maxRetries) throw new DiscoveryError('DISCOVERY_HTTP_EXHAUSTED', response.status);
        retries++;
        await delay(backoffMs * Math.min(2 ** attempt, 8), undefined, signal ? { signal } : {});
        continue;
      }
      try { body = await response.json(); }
      catch { throw new DiscoveryError('DISCOVERY_INVALID_JSON', response.status); }
      break;
    }
    if (response.status === 400 && cursor && typeof body?.reason === 'string' &&
        body.reason === 'Stale or invalid cursor') {
      if (restarts >= maxRestarts) throw new DiscoveryError('DISCOVERY_STALE_EXHAUSTED', 400);
      restarts++; cursor = null; results = []; seen = new Set(); pages = 0;
      continue;
    }
    if (!response.ok) throw new DiscoveryError('DISCOVERY_HTTP_REJECTED', response.status, body?.reason);
    if (!Array.isArray(body?.resources) || typeof body.pagination !== 'object' || body.pagination === null)
      throw new DiscoveryError('DISCOVERY_INVALID_SHAPE', response.status);
    const priorCursor = cursor;
    for (const row of body.resources) {
      const key = stableResourceIdentity(row);
      if (!seen.has(key)) { seen.add(key); results.push(row); }
    }
    pages++;
    if (onPage) await onPage({ pages, total: results.length, cursor: priorCursor, nextCursor: body.pagination.cursor });
    cursor = body.pagination.cursor;
    if (cursor === null || cursor === undefined) {
      return {
        network, scheme, query, resources: results, attempts, retries, restarts, pages,
        elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
        paymentCalls: 0, settlementReceipts: 0
      };
    }
    if (typeof cursor !== 'string' || cursor.length > 4096 || cursor === priorCursor)
      throw new DiscoveryError('DISCOVERY_CURSOR_LOOP');
  }
  throw new DiscoveryError('DISCOVERY_PAGE_BOUND_EXHAUSTED');
}
