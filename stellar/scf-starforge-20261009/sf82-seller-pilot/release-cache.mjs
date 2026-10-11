// MIT. Existing private cache controls bound to the actual SF82 seller instance.
import { join, resolve } from 'node:path';
import { startCacheControl, callCacheControlFile } from '../sf30-seller-sdk/response-cache/control.mjs';

const failure = (message, code = 'RELEASE_CONFLICT') => Object.assign(new Error(message), { code });
export function releaseCacheControlPath(root, instanceId) {
  if (typeof instanceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(instanceId))
    throw new TypeError('Original running seller instance ID required.');
  return join(resolve(root), 'cache-control', instanceId + '.json');
}

/** Run in the existing seller child, without another cache or HTTP seller. */
export async function attachReleaseCacheControls(session, { controlFile, routes } = {}) {
  if (!routes?.length) return null;
  if (typeof session.upstreamSnapshot !== 'function' || typeof session.invalidateUpstreamCache !== 'function')
    throw new Error('The original upstream runtime does not expose cache operations. Update the product source together.');
  const selected = new Map(routes.map(route => [route.id, route]));
  const stats = () => {
    const original = session.upstreamSnapshot();
    const bindings = new Map(original.bindings.map(row => [row.name, row]));
    return Object.fromEntries([...selected].map(([id, route]) => {
      const source = bindings.get(route.binding);
      if (!source) throw new Error('Original cache binding is unavailable.');
      return [id, { binding: route.binding, policy: route.policy, source }];
    }));
  };
  const invalidate = routeId => {
    if (routeId !== undefined && !selected.has(routeId)) throw new TypeError('Choose a cached route from this running release.');
    const chosen = routeId === undefined ? [...selected.values()] : [selected.get(routeId)];
    const bindings = [...new Set(chosen.map(route => route.binding))];
    for (const name of bindings) session.invalidateUpstreamCache(name);
    return { invalidatedRoutes: [...selected.values()].filter(route => bindings.includes(route.binding)).map(route => route.id),
      bindings, routes: stats() };
  };
  return startCacheControl({ controlFile, binding: { stats, invalidate } });
}

async function running(root, expectedInstanceId) {
  const { releaseStatus } = await import('./releases.mjs');
  const status = await releaseStatus(root), observed = status.runtime.observed;
  if (!['RUNNING', 'RESTART_REQUIRED'].includes(status.runtime.state) || !observed?.cacheControlAvailable)
    return { status, available: false };
  if (expectedInstanceId !== undefined && expectedInstanceId !== observed.instanceId)
    throw failure('Running seller changed. Refresh its instance ID before invalidating.');
  return { status, observed, available: true,
    controlFile: releaseCacheControlPath(root, observed.instanceId) };
}
export async function releaseCacheStatus(root) {
  const current = await running(root);
  const base = { schema: 'stellar-forge.seller-release-cache.v1', available: current.available,
    runtimeState: current.status.runtime.state };
  if (!current.available) return { ...base, routes: {} };
  const routes = await callCacheControlFile(current.controlFile, { op: 'status' });
  return { ...base, instanceId: current.observed.instanceId, releaseId: current.observed.releaseId, routes };
}
export async function invalidateReleaseCache(root, { instanceId, routeId } = {}) {
  releaseCacheControlPath(root, instanceId);
  const current = await running(root, instanceId);
  if (!current.available) throw failure('No running seller cache is available.', 'RELEASE_CACHE_UNAVAILABLE');
  if (routeId !== undefined && (typeof routeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(routeId)))
    throw new TypeError('Original cached route ID required.');
  const result = await callCacheControlFile(current.controlFile, { op: 'invalidate', ...(routeId === undefined ? {} : { route: routeId }) });
  return { schema: 'stellar-forge.seller-release-cache-invalidation.v1',
    instanceId, releaseId: current.observed.releaseId, ...result };
}
