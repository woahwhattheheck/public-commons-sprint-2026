// MIT. Original seller and operations service; gRPC owns only application calls.
import { startSellerService } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';
import { createGrpcSource } from './source.mjs';
import { readGrpcPrepared } from './prepare.mjs';
import { fail } from './common.mjs';

export function bindGrpcSeller(config, source, bindings) {
  const handlers = Object.create(null), names = new Set();
  if (!Array.isArray(config?.routes) || !bindings || Object.keys(bindings).length !== config.routes.length)
    fail('GRPC_MERCHANT_BINDINGS_REQUIRED');
  for (const route of config.routes) {
    const method = bindings[route.id]?.method;
    if (!method || !route.handler || !route.admit || names.has(route.handler) || names.has(route.admit) ||
        route.handler === route.admit || Object.hasOwn(route, 'response') || Object.hasOwn(route, 'responseFile') ||
        Object.hasOwn(route, 'responseAsset')) fail('GRPC_MERCHANT_BINDING_INVALID');
    names.add(route.handler); names.add(route.admit);
    const implementation = source.route(method);
    handlers[route.handler] = implementation.handler; handlers[route.admit] = implementation.admit;
  }
  return handlers;
}
export async function startGrpcMerchant({ directory, prepared, env = process.env, nativeFactory = null,
  port = 8423, operationsPort = 8424, maxInFlight = 64, drainGraceMs = 60000,
  availabilityDirectory, navigationOrigin = null } = {}) {
  const retained = prepared ?? await readGrpcPrepared(directory);
  const source = await createGrpcSource(retained.source, retained.protoSource, { env, contract: retained.contract });
  let session, operations;
  try {
    await source.ready();
    const handlers = bindGrpcSeller(retained.service, source, retained.bindings);
    session = await startSellerService({ config: retained.service, handlers, port, nativeFactory,
      maxInFlight: Math.min(maxInFlight, retained.source.limits.maxInFlight), drainGraceMs, availabilityDirectory });
    if (operationsPort !== null) operations = await startSellerOperations(session, { port: operationsPort, navigationOrigin });
  } catch (issue) {
    if (session) await session.close().catch(() => {});
    await source.close(); throw issue;
  }
  let closing;
  return { ...session, operations, source, prepared: retained,
    close() {
      closing ??= session.close().finally(() => Promise.all([operations?.close(), source.close()]));
      return closing;
    } };
}
