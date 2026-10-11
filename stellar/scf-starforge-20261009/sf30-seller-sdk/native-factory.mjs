// MIT. Native x402 2.28.0 integration; no keys, default facilitator or scheme fork.
// Reference: x402-foundation/x402 HTTP server blob 776995dca892660dad6644bd0c05d0ed8c769552,
// exact Stellar server blob b7bf2adcfb48cbf355e401c50ff1eafdee9792a6.
import { AsyncLocalStorage } from 'node:async_hooks';

export const NATIVE_SDK_VERSION = '2.28.0';
const reviewContext = new AsyncLocalStorage();
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const changedReview = () => Object.assign(new Error(
  'Native payment requirements differ from the retained facilitator review. Review the current provider and stage a new release.'),
  { code: 'FACILITATOR_REVIEW_CHANGED' });

/** Read every alternative using the public original SDK requirements builder. */
export async function inspectNativePaymentRequirements(compiled, native) {
  if (typeof native?.server?.buildPaymentRequirements !== 'function')
    throw new TypeError('Initialized original native seller required.');
  const result = [];
  for (const route of compiled.routes) {
    const options = compiled.nativeRoutes[route.method + ' ' + route.path].accepts;
    const nativePayment = [];
    for (const option of options) nativePayment.push(...await native.server.buildPaymentRequirements(option));
    for (const requirements of nativePayment) {
      const flows = native.server.getSupportedKind(2, requirements.network, requirements.scheme)?.extra?.paymentFlows;
      // The original native facilitator publishes this optional operator
      // profile. Resolve the flow through the SDK, including its default.
      if (flows !== undefined && (!Array.isArray(flows) || !flows.every(value => typeof value === 'string') ||
          !flows.includes(native.server.getPaymentFlow(undefined, requirements))))
        throw Object.assign(new Error('The configured facilitator does not advertise this merchant payment flow.'),
          { code: 'SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY' });
    }
    result.push({ routeId: route.id, method: route.method, path: route.path,
      url: route.offer.resource.url, nativePayment });
  }
  return result;
}

/** Scope the retained release review to its original native launcher. The native
 * SDK still reads the provider and constructs the real requirements. Each server
 * must match the reviewed arrays before its resource handler can become ready. */
export async function withNativePaymentReview(review, launch) {
  if (review === null || review === undefined) return launch();
  if (review.nativeSdk !== NATIVE_SDK_VERSION || !Array.isArray(review.nativePayments) ||
      !review.nativePayments.length) throw changedReview();
  const expected = review.nativePayments.map(({ routeId, method, path, url, nativePayment }) => {
    if ([routeId, method, path, url].some(value => typeof value !== 'string') ||
        !Array.isArray(nativePayment) || !nativePayment.length) throw changedReview();
    return { routeId, method, path, url, nativePayment };
  });
  const context = { expected: structuredClone(expected), applied: false, active: true };
  try {
    const session = await reviewContext.run(context, launch);
    if (!context.applied) {
      // An original family must consume the same native factory. Close its owned
      // session if a future launcher returns without applying this review.
      try { await session?.close(); } finally { throw changedReview(); }
    }
    return session;
  } finally { context.active = false; }
}

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
  const review = reviewContext.getStore();
  const declaresFlows = compiled.routes.some(route => route.offer.accepts.some(option =>
    resourceServer.getSupportedKind(2, option.network, option.scheme)?.extra?.paymentFlows !== undefined));
  if (review?.active || declaresFlows) {
    const requirements = await inspectNativePaymentRequirements(compiled, httpServer);
    if (review?.active && stable(requirements) !== stable(review.expected))
      throw changedReview();
    if (review?.active) review.applied = true;
  }
  return httpServer;
}
