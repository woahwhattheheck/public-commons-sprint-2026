// Trusted local application module; existing service JSON selects these exports.
import { createCachedUpstreamHandler } from '../upstream.mjs';

export const weather = createCachedUpstreamHandler({
  baseUrl: process.env.WEATHER_API_ORIGIN,
  path: '/v1/forecast', method: 'GET', query: { city: 'q' },
  requestHeaders: ['accept-language'],
  headers: () => {
    const key = process.env.WEATHER_API_KEY;
    if (!key) throw new Error('Upstream credential unavailable');
    return { authorization: `Bearer ${key}` };
  },
  timeoutMs: 8000, maxInFlight: 8, maxResponseBytes: 1048576,
}, {
  shareAcrossBuyers: true, ttlMs: 30000,
  maxEntries: 256, maxBytes: 8 * 1048576, maxEntryBytes: 1048576,
  maxSourceInFlight: 8, maxWaiters: 64, sourceTimeoutMs: 10000,
});

export const weatherAdmission = weather.admit;
// Private embedding code can call weather.cache.stats(), invalidate(), or close().
