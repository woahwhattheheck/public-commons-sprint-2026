// MIT. Bind named queries into the existing SF30 seller; no payment implementation.
import { startSellerService } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';
import { bindPostgresSeller } from './bindings.mjs';

export async function startPostgresMerchant({ source, config, bindings, port = 8423,
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000, operationsPort = null,
  availabilityDirectory, navigationOrigin = null } = {}) {
  if (!source || typeof source.route !== 'function' || !config || !bindings ||
      typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).length)
    throw new TypeError('POSTGRES_MERCHANT_BINDINGS_REQUIRED');
  const service = structuredClone(config);
  if (!Array.isArray(service.routes)) throw new TypeError('POSTGRES_MERCHANT_BINDINGS_REQUIRED');
  for (const route of service.routes) if (Object.hasOwn(bindings, route.id)) {
    route.admit ??= '__postgres_admit_' + route.id.replaceAll('-', '_');
  }
  const handlers = bindPostgresSeller(service, source, bindings);
  const session = await startSellerService({ config: service, handlers, port, nativeFactory, maxInFlight,
    drainGraceMs, availabilityDirectory });
  let operations;
  try { if (operationsPort !== null) operations = await startSellerOperations(session, { port: operationsPort, navigationOrigin }); }
  catch (issue) { await session.close().finally(() => source.close()); throw issue; }
  let closing;
  return { ...session, source, operations, close() {
    closing ??= session.close().finally(() => Promise.all([operations?.close(), source.close()]));
    return closing;
  } };
}
