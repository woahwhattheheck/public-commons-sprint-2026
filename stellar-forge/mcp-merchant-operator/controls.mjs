// MIT. Use the original private SF82 cache controls; never expose their token.
import { releaseCacheStatus, invalidateReleaseCache, inspectReleaseCache,
  changeReleaseCache, releaseCacheOperation }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-cache.mjs';

const instance = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const operation = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const route = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' };
const binding = { type: 'string', minLength: 1, maxLength: 128 };
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const policy = { type: 'object', additionalProperties: false,
  properties: {
    ttlMs: { type: 'integer', minimum: 1, maximum: 3600000 },
    maxEntries: { type: 'integer', minimum: 1, maximum: 100000 },
    maxBytes: { type: 'integer', minimum: 1, maximum: 268435456 },
    maxEntryBytes: { type: 'integer', minimum: 1, maximum: 16777216 },
  }, required: ['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes'] };
const reviewed = { instanceId: instance, cacheInstanceId: instance, expectedRevision: revision,
  operationId: operation, binding };
const requiredReview = ['instanceId', 'cacheInstanceId', 'expectedRevision', 'operationId', 'binding'];

export function cacheControlTools(tool) {
  return [
    tool('merchant_cache_status', 'Read the original running seller’s per-route shared-cache policy, occupancy, upstream and OAuth counters. Includes the current instance ID. No credential values, cached response bodies or paid request.',
      {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_cache_invalidate', 'Invalidate one original cached route or all cached routes on the seller instance owned by this MCP process. Pass its current instanceId and either routeId or all:true. Buyers still verify and settle through the original native lifecycle.',
      { instanceId: instance, routeId: route, all: { type: 'boolean', const: true } },
      ['instanceId'], { destructive: true }),
    tool('merchant_cache_inspect', 'Inspect the original process-owned seller’s canonical cache bindings, route aliases, live retention policies, immutable limits, counters and cache management revision. Use the returned inspection.instanceId as cacheInstanceId when reviewing a change.',
      { instanceId: instance }, ['instanceId'], { readOnly: true, idempotent: true }),
    tool('merchant_cache_configure', 'Apply a complete reviewed retention policy to one canonical cache binding on the same owned seller. Requires its cache instance and revision plus a caller-retained operationId. Clears the old retained epoch while existing source work finishes through the same runtime. Replaying the exact same operationId and payload returns its original result.',
      { ...reviewed, policy }, [...requiredReview, 'policy'], { destructive: true, idempotent: true }),
    tool('merchant_cache_purge', 'Clear one inspected canonical cache binding using the original manager’s instance, revision and operationId. Routes sharing that binding share the purge. Exact same-operation recovery uses merchant_cache_operation or the unchanged request.',
      reviewed, requiredReview, { destructive: true, idempotent: true }),
    tool('merchant_cache_operation', 'Read an original cache change result by its retained operationId on the same process-owned seller after an interrupted response. Returns found:false when that running manager has no result; it never starts or repeats a change.',
      { instanceId: instance, operationId: operation }, ['instanceId', 'operationId'], { readOnly: true, idempotent: true }),
  ];
}
function publicFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.code)
    ? error.code : error instanceof TypeError ? 'INVALID_PARAMS' : 'MERCHANT_CACHE_UNAVAILABLE';
  return Object.assign(new Error('Original cache control returned ' + code +
    '. Read merchant_cache_operation with the same instance and operationId to reconcile a change, or merchant_cache_inspect for its current policy.'), { code });
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
export async function merchantCacheInspect(root, args) {
  try { return await inspectReleaseCache(root, { instanceId: args.instanceId }); }
  catch (error) { throw publicFailure(error); }
}
export async function merchantCacheConfigure(root, args) {
  try { return await changeReleaseCache(root, { ...args, action: 'configure' }); }
  catch (error) { throw publicFailure(error); }
}
export async function merchantCachePurge(root, args) {
  try { return await changeReleaseCache(root, { ...args, action: 'invalidate' }); }
  catch (error) { throw publicFailure(error); }
}
export async function merchantCacheOperation(root, args) {
  try { return await releaseCacheOperation(root, { instanceId: args.instanceId, operationId: args.operationId }); }
  catch (error) { throw publicFailure(error); }
}
