import { cacheControlTools, instance, route, reviewed, policy, requiredReview, operation, revision, binding } from './catalog/controls.mjs';
export { cacheControlTools } from './catalog/controls.mjs';
// MIT. Use the original private SF82 cache controls; never expose their token.
import { releaseCacheStatus, invalidateReleaseCache, inspectReleaseCache,
  changeReleaseCache, releaseCacheOperation }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-cache.mjs';











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
