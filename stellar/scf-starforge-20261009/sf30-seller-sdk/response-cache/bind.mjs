// MIT. Compose existing seller route declarations and trusted application exports.
import { createResponseCache } from './cache.mjs';

const OPTIONS = new Set(['shareAcrossBuyers', 'ttlMs', 'maxEntries', 'maxBytes',
  'maxEntryBytes', 'maxResponseBytes', 'maxSourceInFlight', 'maxWaiters', 'sourceTimeoutMs', 'varyHeaders']);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function bindResponseCaches({ config, handlers, policy } = {}) {
  if (!plain(config) || config.schema !== 'stellar-forge.seller-service.v1' ||
      !Array.isArray(config.routes) || !plain(handlers) || !plain(policy) ||
      policy.schema !== 'stellar-forge.response-cache.v1' || !plain(policy.routes) ||
      !Object.keys(policy.routes).length || Object.keys(policy.routes).length > 64 ||
      Object.keys(policy).some(key => !['schema', 'routes'].includes(key))) throw new TypeError('Seller config, handler exports and response-cache.v1 policy required');
  const boundConfig = structuredClone(config), boundHandlers = Object.assign(Object.create(null), handlers);
  const caches = new Map(), ids = new Set();
  for (const route of boundConfig.routes) {
    if (ids.has(route.id)) throw new TypeError('Duplicate seller route id');
    ids.add(route.id);
    if (!Object.hasOwn(policy.routes, route.id)) continue;
    const options = policy.routes[route.id];
    if (!plain(options) || Object.keys(options).some(key => !OPTIONS.has(key))) throw new TypeError('Unknown response cache option');
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (!['GET', 'HEAD'].includes(method) || typeof route.handler !== 'string' ||
        !Object.hasOwn(handlers, route.handler) || typeof handlers[route.handler] !== 'function' ||
        route.admit !== undefined && (!Object.hasOwn(handlers, route.admit) || typeof handlers[route.admit] !== 'function'))
      throw new TypeError('Cached routes require an original read-only handler and valid admission export');
    const cached = createResponseCache({ ...options, handler: handlers[route.handler],
      ...(route.admit === undefined ? {} : { admit: handlers[route.admit] }) });
    const handlerName = `__sf30Cached${caches.size}`, admissionName = `__sf30CachedAdmission${caches.size}`;
    if (Object.hasOwn(boundHandlers, handlerName) || Object.hasOwn(boundHandlers, admissionName))
      throw new TypeError('Reserved generated response cache export');
    boundHandlers[handlerName] = cached.handler; boundHandlers[admissionName] = cached.admit;
    route.handler = handlerName; route.admit = admissionName; caches.set(route.id, cached);
  }
  for (const id of Object.keys(policy.routes)) if (!caches.has(id)) throw new TypeError('Cache policy references an absent route');
  return Object.freeze({ config: boundConfig, handlers: boundHandlers,
    stats: () => Object.fromEntries([...caches].map(([id, cache]) => [id, cache.stats()])),
    invalidate: id => {
      if (id !== undefined) {
        if (!caches.has(id)) throw new TypeError('Unknown cached route');
        return { [id]: caches.get(id).invalidate() };
      }
      return Object.fromEntries([...caches].map(([name, cache]) => [name, cache.invalidate()]));
    },
    close: options => Promise.all([...caches.values()].map(cache => cache.close(options))),
  });
}
