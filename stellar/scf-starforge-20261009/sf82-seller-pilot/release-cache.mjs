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
      if (!source?.cachePolicy || !source.cache) throw new Error('Original cache binding is unavailable.');
      return [id, { binding: route.binding, policy: source.cachePolicy, source }];
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
  return startCacheControl({ controlFile, binding: { stats, invalidate },
    ...(session.cacheManagement ? { management: session.cacheManagement } : {}) });
}

async function running(root, expectedInstanceId) {
  const { releaseStatus } = await import('./releases.mjs');
  const status = await releaseStatus(root), observed = status.runtime.observed;
  if (!['RUNNING', 'RESTART_REQUIRED'].includes(status.runtime.state) || !observed?.cacheControlAvailable)
    return { status, available: false };
  if (expectedInstanceId !== undefined && expectedInstanceId !== observed.instanceId)
    throw failure('Running seller changed. Refresh its instance ID before operating its cache.');
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


const cacheOperationId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new TypeError('A stable cache operation ID of 1–128 ASCII characters is required.');
  return value;
};
const cacheBinding = value => {
  if (typeof value !== 'string' || !value || value.length > 128)
    throw new TypeError('Choose a canonical cache binding returned by inspection.');
  return value;
};
function retainedPolicy(value) {
  const names = ['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !names.includes(key)) ||
      names.some(key => !Object.hasOwn(value, key)))
    throw new TypeError('Supply the complete reviewed retention policy.');
  const limits = { ttlMs: 3600000, maxEntries: 100000, maxBytes: 268435456, maxEntryBytes: 16777216 };
  for (const name of names) if (!Number.isSafeInteger(value[name]) || value[name] < 1 || value[name] > limits[name])
    throw new TypeError('Invalid retained cache policy limit.');
  if (value.maxEntryBytes > value.maxBytes) throw new TypeError('An entry cannot exceed the retained byte budget.');
  // The original manager additionally checks the immutable source response cap.
  return Object.fromEntries(names.map(name => [name, value[name]]));
}
async function managedCacheCall(root, instanceId, request) {
  releaseCacheControlPath(root, instanceId);
  const current = await running(root, instanceId);
  if (!current.available) throw failure('No running seller cache is available.', 'RELEASE_CACHE_UNAVAILABLE');
  const result = await callCacheControlFile(current.controlFile, request);
  return { instanceId, releaseId: current.observed.releaseId, result };
}

/** Inspect the SAME upstream manager; canonical binding IDs keep shared routes together. */
export async function inspectReleaseCache(root, { instanceId } = {}) {
  const current = await managedCacheCall(root, instanceId, { op: 'inspect' });
  return { schema: 'stellar-forge.seller-release-cache-inspection.v1',
    instanceId: current.instanceId, releaseId: current.releaseId, inspection: current.result };
}

/** SF82 binds the seller instance; the original manager binds cache instance/revision/replay. */
export async function changeReleaseCache(root, { instanceId, cacheInstanceId, expectedRevision,
  operationId, binding, action, policy } = {}) {
  releaseCacheControlPath(root, cacheInstanceId);
  cacheOperationId(operationId); cacheBinding(binding);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new TypeError('The inspected nonnegative cache revision is required.');
  if (!['configure', 'invalidate'].includes(action) || action === 'invalidate' && policy !== undefined)
    throw new TypeError('Choose configure with a complete policy or invalidate without a policy.');
  const request = { op: 'change', operationId, expectedInstanceId: cacheInstanceId,
    expectedRevision, route: binding, action,
    ...(action === 'configure' ? { policy: retainedPolicy(policy) } : {}) };
  const current = await managedCacheCall(root, instanceId, request);
  return { schema: 'stellar-forge.seller-release-cache-change.v1',
    instanceId: current.instanceId, releaseId: current.releaseId, operation: current.result };
}

/** Readback never changes the original operation ID or performs a new mutation. */
export async function releaseCacheOperation(root, { instanceId, operationId } = {}) {
  cacheOperationId(operationId);
  const current = await managedCacheCall(root, instanceId, { op: 'operation', operationId });
  return { schema: 'stellar-forge.seller-release-cache-operation.v1',
    instanceId: current.instanceId, releaseId: current.releaseId, ...current.result };
}
