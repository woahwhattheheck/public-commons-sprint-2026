// MIT. Use the original private SF82 cache controls; never expose their token.
import { releaseCacheStatus, invalidateReleaseCache }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-cache.mjs';

export function cacheControlTools(tool) {
  return [
    tool('merchant_cache_status', 'Read the original running seller’s per-route shared-cache policy, occupancy, upstream and OAuth counters. Includes the current instance ID. No credential values, cached response bodies or paid request.',
      {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_cache_invalidate', 'Invalidate one original cached route or all cached routes on the seller instance owned by this MCP process. Pass its current instanceId and either routeId or all:true. Buyers still verify and settle through the original native lifecycle.',
      { instanceId: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' },
        routeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, all: { type: 'boolean', const: true } },
      ['instanceId'], { destructive: true }),
  ];
}
function publicFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.code)
    ? error.code : error instanceof TypeError ? 'INVALID_PARAMS' : 'MERCHANT_CACHE_UNAVAILABLE';
  return Object.assign(new Error(`Original cache control returned ${code}. Refresh merchant_cache_status and use its current instance and route IDs.`), { code });
}
export async function merchantCacheStatus(root) {
  try { return await releaseCacheStatus(root); }
  catch (error) { throw publicFailure(error); }
}
export async function merchantCacheInvalidate(root, args) {
  if ((args.routeId === undefined) === (args.all !== true) ||
      (args.all !== undefined && args.all !== true))
    throw Object.assign(new TypeError('Choose a routeId or all:true, exclusively.'), { code: 'INVALID_PARAMS' });
  try { return await invalidateReleaseCache(root, { instanceId: args.instanceId, routeId: args.routeId }); }
  catch (error) { throw publicFailure(error); }
}
