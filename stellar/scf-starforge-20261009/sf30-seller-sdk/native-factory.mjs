// MIT. Native x402 2.28.0 integration; no keys, default facilitator or scheme fork.
// Reference: x402-foundation/x402 HTTP server blob 776995dca892660dad6644bd0c05d0ed8c769552,
// exact Stellar server blob b7bf2adcfb48cbf355e401c50ff1eafdee9792a6.

export const NATIVE_SDK_VERSION = '2.28.0';

export async function createNativeSellerServer(compiled, { facilitatorClient } = {}) {
  if (!compiled?.routes?.length || !compiled.nativeRoutes) throw new TypeError('Compiled seller routes required');
  if (!facilitatorClient || ['getSupported', 'verify', 'settle']
      .some(method => typeof facilitatorClient[method] !== 'function')) {
    throw new TypeError('Explicit operator-configured native facilitator client required');
  }
  const [{ x402ResourceServer, x402HTTPResourceServer }, { ExactStellarScheme },
    { bazaarResourceServerExtension, validateBazaarRouteExtensions }] = await Promise.all([
    import('@x402/core/server'), import('@x402/stellar/exact/server'), import('@x402/extensions/bazaar'),
  ]);
  const routes = structuredClone(compiled.nativeRoutes);
  validateBazaarRouteExtensions(routes);
  const resourceServer = new x402ResourceServer(facilitatorClient);
  for (const network of new Set(compiled.routes.flatMap(route =>
    route.offer.accepts.map(option => option.network)))) {
    resourceServer.register(network, new ExactStellarScheme());
  }
  resourceServer.registerExtension(bazaarResourceServerExtension);
  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  await httpServer.initialize();
  return httpServer;
}
