// MIT. Provider application composed into the existing SF30 seller and Operations.
import { startSellerService } from '../serve.mjs';
import { createRoutescanSource } from './source.mjs';
import { fail } from './config.mjs';

export async function routescanNativeFactory(facilitator, { allowLocalFacilitator = false } = {}) {
  if (!facilitator) return null;
  let url;
  try { url = new URL(facilitator); } catch { fail('Use the configured facilitator URL.'); }
  const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    fail('Use HTTPS for the facilitator; an explicit local option permits 127.0.0.1 HTTP.');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  return routes => createNativeSellerServer(routes, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
  });
}

export async function startRoutescanMerchant(compiled, { quotaDirectory, nativeFactory = null,
  port = 8423, operationsPort, maxInFlight = 64, drainGraceMs = 60000,
  availabilityDirectory, historyDirectory, navigationOrigin, env = process.env } = {}) {
  let source = null, seller = null, operations = null, closing;
  async function close() {
    return closing ??= (async () => {
      let failure, result;
      try { result = await seller?.close(); } catch (error) { failure = error; }
      try { await operations?.close(); } catch (error) { failure ??= error; }
      try { await source?.close(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
      return { seller: result ?? null, sourceClosed: true };
    })();
  }
  try {
    const handlers = Object.create(null);
    // Original challenge-only startup reads no provider key and consumes no quota.
    if (nativeFactory) source = await createRoutescanSource(compiled, { quotaDirectory, env });
    for (const product of compiled.products) {
      handlers[product.id] = source?.handlers[product.id] ?? (() => { throw new Error('CHALLENGE_ONLY'); });
      handlers[product.id + 'Admission'] = source?.handlers[product.id + 'Admission'] ?? (() => true);
    }
    seller = await startSellerService({ config: compiled.service, handlers, nativeFactory, port, maxInFlight, drainGraceMs, availabilityDirectory });
    if (operationsPort !== undefined) {
      const { startSellerOperations } = await import('../operations/server.mjs');
      operations = await startSellerOperations(seller, { port: operationsPort, historyDirectory,
        ...(navigationOrigin ? { navigationOrigin } : {}) });
    }
    return { seller, source, operations, close, inputSha256: compiled.inputSha256,
      async snapshot() { return { inputSha256: compiled.inputSha256,
        merchantUrl: seller.url, mode: seller.mode, operationsUrl: operations?.url ?? null,
        lifecycle: seller.lifecycle.snapshot(), source: source ? await source.snapshot() : null }; } };
  } catch (error) { await close().catch(() => {}); throw error; }
}
