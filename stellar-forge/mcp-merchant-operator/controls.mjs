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
export const merchantCacheStatus = root => releaseCacheStatus(root);
export async function merchantCacheInvalidate(root, args) {
  if ((args.routeId === undefined) === (args.all !== true) ||
      (args.all !== undefined && args.all !== true))
    throw Object.assign(new TypeError('Choose a routeId or all:true, exclusively.'), { code: 'INVALID_PARAMS' });
  return invalidateReleaseCache(root, { instanceId: args.instanceId, routeId: args.routeId });
}
