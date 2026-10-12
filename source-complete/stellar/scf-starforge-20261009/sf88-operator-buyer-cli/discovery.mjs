// SPDX-License-Identifier: MIT
// Original SF31 discovery + SF85 CONNECT; unsigned catalogs only, never payments.
import { request as httpsRequest } from 'node:https';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { parseExplicitProxy, oneShotConnectAgent } from '../sf85-live-402-capture/proxy-connect.mjs';
import { catalog, need, abs, InputError } from './config.mjs';
import { acquireCatalog } from './catalog-session.mjs';

export function discoveryOptions(raw) {
  need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_CATALOG');
  const { proxy = null, timeoutMs = 30000, captureDir = null, allPages = false,
    maxPages = 1000, ...original } = raw;
  catalog(original);
  need(typeof allPages === 'boolean', 'CATALOG_ALL_PAGES_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 300000,
    'CATALOG_TIMEOUT_INVALID');
  need(Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= 10000,
    'CATALOG_PAGE_BUDGET_INVALID');
  if (captureDir !== null) abs(captureDir, 'CATALOG_CAPTURE_PATH_NOT_ABSOLUTE');
  need(!allPages || captureDir !== null, 'CATALOG_ALL_PAGES_REQUIRES_CAPTURE_DIRECTORY');
  const { sandboxGatewayIPv4 = null, ...request } = original;
  return { request, sandboxGatewayIPv4, proxy: proxy === null ? null : parseExplicitProxy(proxy),
    timeoutMs, captureDir, allPages, maxPages };
}

/** The original transport validates DNS before invoking this trusted seam. */
function connectRequest(proxy, overlay) {
  return (options, callback) => {
    need(options.method === 'GET' && !Object.keys(options.headers).some(name =>
      /^(payment-signature|x-payment|authorization|cookie|proxy-authorization)$/i.test(name)),
    'CATALOG_TRANSPORT_UNSIGNED_GET_ONLY');
    let pinned, failure;
    options.lookup(options.hostname, { all: false }, (error, address, family) => {
      failure = error; pinned = { address, family };
    });
    if (failure) throw failure;
    need(pinned?.address && [4, 6].includes(pinned.family), 'CATALOG_PIN_UNAVAILABLE');
    const target = new URL(`https://${options.hostname}`);
    const lease = oneShotConnectAgent({ target, proxy,
      pinnedIP: pinned.family === 6 ? `[${pinned.address}]` : pinned.address,
      sandboxOverlay: overlay !== null, signal: options.signal });
    try {
      const request = httpsRequest({ ...options, agent: lease.agent }, response => {
        response.once('close', lease.stop);
        callback(response);
      });
      request.once('error', lease.stop);
      return request;
    } catch (error) { lease.stop(); throw error; }
  };
}

/** Trusted resolver injection is for native loopback integration, not JSON config. */
export function createCatalogReader(options, { lookup } = {}) {
  const { sandboxGatewayIPv4, proxy, timeoutMs } = options;
  const fetchImpl = createPublicHttpsFetch({ timeoutMs, sandboxGatewayIPv4,
    ...(lookup ? { lookup } : {}),
    ...(proxy ? { requestImpl: connectRequest(proxy, sandboxGatewayIPv4) } : {}) });
  const buyer = new X402BuyerClient({ fetchImpl });
  return async request => {
    try {
      const result = await buyer.discover(request);
      return { mode: 'ORIGINAL_UNSIGNED_CATALOG', source: result.source,
        sourceEnvelope: result.sourceEnvelope, pagination: result.pagination,
        originalListings: result.resources };
    } catch (error) {
      // Preserve useful native failure identity without serializing URLs or messages.
      let native = error, seen = new Set();
      while (native?.cause && !seen.has(native.cause) && seen.size < 8) {
        seen.add(native); native = native.cause;
      }
      if (error?.code === 'DISCOVERY_TRANSPORT_FAILED' &&
          typeof native?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(native.code))
        throw new InputError(`CATALOG_NETWORK_${native.code}`);
      throw error;
    }
  };
}

export async function discoverCatalog(raw, dependencies = {}) {
  const options = discoveryOptions(raw);
  const readPage = createCatalogReader(options, dependencies);
  if (options.captureDir === null) return readPage(options.request);
  return acquireCatalog(options, readPage);
}
