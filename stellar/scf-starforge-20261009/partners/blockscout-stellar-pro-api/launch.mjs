// MIT. One merchant mode, original provider account and delivery journal across deployment.
import { join } from 'node:path';
import { prepareProduct, error } from './product.mjs';
import { privateDirectory } from './accounting.mjs';
import { normalizeBlockscoutDeployment } from './deployment.mjs';
import { createBlockscoutApplication } from './application.mjs';
import { startBlockscoutDesk } from './desk.mjs';
import { startSellerService } from '../../sf30-seller-sdk/serve.mjs';
import { openOutbox, instrumentNativeSettlement } from '../../sf98-merchant-delivery/outbox.mjs';
import { startSellerOperations } from '../../sf30-seller-sdk/operations/server.mjs';

export async function startBlockscoutMerchant({ plan: input, directory, facilitator, mode = 'paid',
  port = 8423, operationsPort = 8424, deskPort = 8425, drainGraceMs = 60000,
  allowLocalFacilitator = false, nativeFactory, env = process.env, lookup, developmentProviderOrigin,
  signal } = {}) {
  const { plan, service } = prepareProduct(input);
  const deployment = normalizeBlockscoutDeployment({ mode, facilitator, allowLocalFacilitator, nativeFactory });
  for (const value of [port, operationsPort, deskPort])
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw error('BLOCKSCOUT_LISTENER_PORT_INVALID');
  const assigned = [port, operationsPort, deskPort].filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw error('BLOCKSCOUT_LISTENER_PORT_CONFLICT');
  if (!Number.isInteger(drainGraceMs) || drainGraceMs < 1000 || drainGraceMs > 300000)
    throw error('BLOCKSCOUT_DRAIN_GRACE_INVALID');
  if (signal !== undefined && (typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
    throw error('BLOCKSCOUT_START_SIGNAL_INVALID');
  let app, seller, operations, desk, outbox, ready = false, closing;
  let stopRequested = signal?.aborted ?? false;
  const checkpoint = () => { if (stopRequested) throw error('BLOCKSCOUT_START_INTERRUPTED'); };
  const finish = async () => {
    let first;
    try { await seller?.close(); } catch (e) { first = e; }
    // Forced socket closure does not release a native dispatch or its account.
    // Keep operator visibility until the original seller reports actual idleness.
    try { await seller?.lifecycle.whenIdle(); } catch (e) { first ??= e; }
    for (const fn of [() => desk?.close(), () => operations?.close(), () => app?.close()])
      try { await fn(); } catch (e) { first ??= e; }
    signal?.removeEventListener('abort', stop);
    if (first) throw first;
  };
  const close = () => { stopRequested = true; closing ??= finish(); return closing; };
  const stop = () => {
    stopRequested = true;
    if (ready) close().catch(() => { process.exitCode = 1; });
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    checkpoint();
    await privateDirectory(directory); checkpoint();
    app = await createBlockscoutApplication(plan, { directory: join(directory, 'provider'), env,
      deferCredentials: mode === 'challenge-only',
      ...(lookup === undefined ? {} : { lookup }),
      ...(developmentProviderOrigin === undefined ? {} : { developmentProviderOrigin }) });
    checkpoint();
    outbox = await openOutbox(join(directory, 'delivery')); checkpoint();
    let originalFactory = null;
    if (mode === 'paid') {
      let factory = nativeFactory;
      if (factory === undefined) {
        const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
          import('@x402/core/server'), import('../../sf30-seller-sdk/native-factory.mjs'),
        ]);
        checkpoint();
        const client = new HTTPFacilitatorClient({ url: deployment.facilitator });
        factory = compiled => createNativeSellerServer(compiled, { facilitatorClient: client });
      }
      originalFactory = async compiled => instrumentNativeSettlement(await factory(compiled), {
        compiled, outbox, onWriteFailure: () => process.stderr.write('BLOCKSCOUT_NATIVE_OUTBOX_WRITE_FAILED\n') });
    }
    seller = await startSellerService({ config: service, port, handlers: app.handlers, nativeFactory: originalFactory,
      maxInFlight: Math.max(16, plan.limits.maxInFlight * 2), drainGraceMs,
      availabilityDirectory: join(directory, 'availability') });
    checkpoint();
    operations = await startSellerOperations({ ...seller, upstreamSnapshot: app.snapshot }, {
      port: operationsPort, deliveryOutbox: outbox, historyDirectory: join(directory, 'usage') });
    checkpoint();
    desk = await startBlockscoutDesk({ application: app, seller, operations, directory, port: deskPort });
    checkpoint();
    ready = true;
    return Object.freeze({ application: app, seller, operations, outbox, desk, deployment,
      endpoints: { seller: seller.url, offers: seller.url + '/_seller/offers', providerDesk: desk.controlUrl,
        operations: operations.url, availability: operations.availabilityControlUrl,
        fulfillment: operations.deliveryControlUrl },
      close });
  } catch (e) { await close().catch(() => {}); throw e; }
}
