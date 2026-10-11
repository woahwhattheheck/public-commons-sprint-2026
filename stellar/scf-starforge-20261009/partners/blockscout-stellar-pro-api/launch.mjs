// MIT. One native SF30 merchant, its original SF98 journal and operator controls.
import { join } from 'node:path';
import { prepareProduct, error } from './product.mjs';
import { privateDirectory } from './accounting.mjs';
import { createBlockscoutApplication } from './application.mjs';
import { startBlockscoutDesk } from './desk.mjs';
import { startSellerService } from '../../sf30-seller-sdk/serve.mjs';
import { createNativeSellerServer } from '../../sf30-seller-sdk/native-factory.mjs';
import { openOutbox, instrumentNativeSettlement } from '../../sf98-merchant-delivery/outbox.mjs';
import { startSellerOperations } from '../../sf30-seller-sdk/operations/server.mjs';

export async function startBlockscoutMerchant({ plan: input, directory, facilitator,
  port = 8423, operationsPort = 8424, deskPort = 8425, drainGraceMs = 60000,
  allowLocalFacilitator = false, nativeFactory, env = process.env, lookup, developmentProviderOrigin } = {}) {
  const { plan, service } = prepareProduct(input);
  for (const value of [port, operationsPort, deskPort])
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw error('BLOCKSCOUT_LISTENER_PORT_INVALID');
  const assigned = [port, operationsPort, deskPort].filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw error('BLOCKSCOUT_LISTENER_PORT_CONFLICT');
  if (!Number.isInteger(drainGraceMs) || drainGraceMs < 1000 || drainGraceMs > 300000)
    throw error('BLOCKSCOUT_DRAIN_GRACE_INVALID');
  let url;
  if (nativeFactory === undefined) {
    try { url = new URL(facilitator); } catch { throw error('BLOCKSCOUT_FACILITATOR_REQUIRED'); }
    const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw error('BLOCKSCOUT_FACILITATOR_INVALID');
  } else if (typeof nativeFactory !== 'function') throw error('BLOCKSCOUT_NATIVE_FACTORY_INVALID');
  await privateDirectory(directory);
  let app, seller, operations, desk, outbox;
  const finish = async () => {
    let first;
    for (const fn of [() => seller?.close(), () => desk?.close(), () => operations?.close(), () => app?.close()])
      try { await fn(); } catch (e) { first ??= e; }
    if (first) throw first;
  };
  try {
    app = await createBlockscoutApplication(plan, { directory: join(directory, 'provider'), env,
      ...(lookup === undefined ? {} : { lookup }), ...(developmentProviderOrigin === undefined ? {} : { developmentProviderOrigin }) });
    outbox = await openOutbox(join(directory, 'delivery'));
    let factory = nativeFactory;
    if (factory === undefined) {
      const { HTTPFacilitatorClient } = await import('@x402/core/server');
      const client = new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') });
      factory = compiled => createNativeSellerServer(compiled, { facilitatorClient: client });
    }
    const originalFactory = async compiled => instrumentNativeSettlement(await factory(compiled), {
      compiled, outbox, onWriteFailure: () => process.stderr.write('BLOCKSCOUT_NATIVE_OUTBOX_WRITE_FAILED\n') });
    seller = await startSellerService({ config: service, port, handlers: app.handlers, nativeFactory: originalFactory,
      maxInFlight: Math.max(16, plan.limits.maxInFlight * 2), drainGraceMs,
      availabilityDirectory: join(directory, 'availability') });
    operations = await startSellerOperations({ ...seller, upstreamSnapshot: app.snapshot }, {
      port: operationsPort, deliveryOutbox: outbox, historyDirectory: join(directory, 'usage') });
    desk = await startBlockscoutDesk({ application: app, seller, operations, directory, port: deskPort });
  } catch (e) { await finish().catch(() => {}); throw e; }
  let closing;
  return Object.freeze({ application: app, seller, operations, outbox, desk,
    endpoints: { seller: seller.url, offers: seller.url + '/_seller/offers', providerDesk: desk.controlUrl,
      operations: operations.url, availability: operations.availabilityControlUrl,
      fulfillment: operations.deliveryControlUrl },
    close() { closing ??= finish(); return closing; } });
}
