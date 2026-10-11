// MIT. Connect original imported offers to the existing SF30 seller runtime.
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bind selected routes to operator-supplied application exports or static data. */
export function createSellerServiceConfig(imported, bindings) {
  if (imported?.schema !== 'stellar.open-api-seller-import.v1' ||
      !Array.isArray(imported.offers) || !imported.offers.length || imported.offers.length > 64 ||
      !Array.isArray(bindings) || bindings.length !== imported.offers.length) {
    throw new TypeError('One explicit service binding per imported route required (1–64 routes)');
  }
  const keyed = new Map();
  for (const binding of bindings) {
    if (!plain(binding) || typeof binding.method !== 'string' || typeof binding.path !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(binding.id ?? '') ||
        own(binding, 'handler') === own(binding, 'response') ||
        (own(binding, 'handler') && !/^[A-Za-z_$][\w$]{0,127}$/.test(binding.handler))) {
      throw new TypeError('Each binding requires method, path, id and exactly one handler or response');
    }
    const key = binding.method.toUpperCase() + ' ' + binding.path;
    if (keyed.has(key)) throw new TypeError('Duplicate service binding: ' + key);
    keyed.set(key, binding);
  }
  const routes = imported.offers.map(offer => {
    const key = offer.method + ' ' + offer.path, binding = keyed.get(key);
    if (!binding) throw new TypeError('Missing service binding: ' + key);
    keyed.delete(key);
    const path = new URL(offer.seller.resource.url).pathname;
    if (path.startsWith('/_seller/')) throw new TypeError('Imported path overlaps seller inspection endpoints');
    return { id: binding.id, path, offer: structuredClone(offer.seller),
      ...(own(binding, 'handler') ? { handler: binding.handler } : { response: structuredClone(binding.response) }) };
  });
  // Reuse the actual runtime preflight; do not translate schemas or silently
  // select a payment alternative. No handler is invoked during compilation.
  const compiled = compileSellerRoutes(routes.map(route => ({ ...route, handler: async () => {} })));
  return { schema: 'stellar-forge.seller-service.v1',
    publicOrigin: new URL(compiled.routes[0].offer.resource.url).origin, routes };
}
