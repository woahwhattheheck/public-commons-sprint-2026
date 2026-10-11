// MIT. Connect original imported offers to the existing SF30 seller runtime.
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { validateResponseFile } from '../sf30-seller-sdk/response-file.mjs';
import { createConfiguredAdmission } from '../sf30-seller-sdk/configured-admission.mjs';

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
        ['handler', 'response', 'responseFile'].filter(key => own(binding, key)).length !== 1 ||
        (own(binding, 'handler') && (typeof binding.handler !== 'string' ||
          !/^[A-Za-z_$][\w$]{0,127}$/.test(binding.handler)))) {
      throw new TypeError('Each binding requires method, path, id and exactly one handler, response or responseFile');
    }
    if (own(binding, 'validateInput') && typeof binding.validateInput !== 'boolean') {
      throw new TypeError('validateInput must be a boolean');
    }
    if (own(binding, 'responseFile')) validateResponseFile(binding.responseFile);
    if (own(binding, 'admit') && (typeof binding.admit !== 'string' ||
        !/^[A-Za-z_$][\w$]{0,127}$/.test(binding.admit))) {
      throw new TypeError('Optional admission binding must name one trusted export');
    }
    const key = binding.method.toUpperCase() + ' ' + binding.path;
    if (keyed.has(key)) throw new TypeError('Duplicate service binding: ' + key);
    keyed.set(key, binding);
  }
  const routes = imported.offers.map(offer => {
    const key = offer.method + ' ' + offer.path, binding = keyed.get(key);
    if (!binding) throw new TypeError('Missing service binding: ' + key);
    keyed.delete(key);
    const path = offer.seller.extensions?.bazaar?.routeTemplate ?? new URL(offer.seller.resource.url).pathname;
    if (path.startsWith('/_seller/')) throw new TypeError('Imported path overlaps seller inspection endpoints');
    return { id: binding.id, path, offer: structuredClone(offer.seller),
      ...(own(binding, 'admit') ? { admit: binding.admit } : {}),
      ...(own(binding, 'validateInput') ? { validateInput: binding.validateInput } : {}),
      ...(own(binding, 'handler') ? { handler: binding.handler } :
        own(binding, 'responseFile') ? { responseFile: binding.responseFile } :
        { response: structuredClone(binding.response) }) };
  });
  // Reuse the actual runtime preflight; do not translate schemas or silently
  // select a payment alternative. No handler is invoked during compilation.
  const compiled = compileSellerRoutes(routes.map(route => ({ ...route, handler: async () => {},
    // Preflight only checks callback shape. Runtime resolves the named export;
    // never import or invoke application code while exporting a service config.
    admit: createConfiguredAdmission(route, own(route, 'admit') ? { [route.admit]: () => true } : {}),
  })));
  return { schema: 'stellar-forge.seller-service.v1',
    publicOrigin: new URL(compiled.routes[0].offer.resource.url).origin, routes };
}
