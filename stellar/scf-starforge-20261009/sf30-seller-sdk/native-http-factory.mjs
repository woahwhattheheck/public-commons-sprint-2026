// MIT. Shared original SF30 native facilitator construction.
// Keep native SDK loading deferred until an operator selects the facilitator.
const need = (condition, message) => { if (!condition) throw new TypeError(message); };

export async function createNativeHttpFactory({ facilitator, allowLocalFacilitator = false } = {}) {
  const url = new URL(facilitator);
  const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  need((local || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash,
    'Use a credential-free HTTPS facilitator URL, or explicitly enable a loopback HTTP facilitator.');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('./native-factory.mjs'),
  ]);
  const facilitatorClient = new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') });
  return compiled => createNativeSellerServer(compiled, { facilitatorClient });
}
