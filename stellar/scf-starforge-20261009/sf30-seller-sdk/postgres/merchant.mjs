// MIT. Bind named queries into the existing SF30 seller; no payment implementation.
import { startSellerService } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';

export async function startPostgresMerchant({ source, config, bindings, port = 8423,
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000, operationsPort = null } = {}) {
  if (!source || typeof source.route !== 'function' || !config || !bindings ||
      typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).length)
    throw new TypeError('POSTGRES_MERCHANT_BINDINGS_REQUIRED');
  const service = structuredClone(config), handlers = Object.create(null);
  const seen = new Set();
  for (const [routeId, binding] of Object.entries(bindings)) {
    const route = service.routes.find(item => item.id === routeId);
    if (!route || !binding || typeof binding !== 'object' || !route.handler ||
        Object.hasOwn(route, 'response') || Object.hasOwn(route, 'responseFile') ||
        typeof binding.query !== 'string' || !['query', 'body'].includes(binding.input ?? 'query'))
      throw new TypeError('POSTGRES_MERCHANT_BINDING_INVALID');
    const input = binding.input ?? 'query';
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(method))
      throw new TypeError('POSTGRES_BODY_BINDING_METHOD_INVALID');
    const query = source.route(binding.query, { input });
    route.admit ??= '__postgres_admit_' + route.id.replaceAll('-', '_');
    if (seen.has(route.handler) || seen.has(route.admit) || route.handler === route.admit)
      throw new TypeError('POSTGRES_HANDLER_NAME_COLLISION');
    seen.add(route.handler); seen.add(route.admit);
    handlers[route.handler] = query.handler; handlers[route.admit] = query.admit;
  }
  if (service.routes.some(route => route.handler && !Object.hasOwn(handlers, route.handler)))
    throw new TypeError('POSTGRES_UNBOUND_APPLICATION_HANDLER');
  const session = await startSellerService({ config: service, handlers, port, nativeFactory, maxInFlight, drainGraceMs });
  let operations;
  try { if (operationsPort !== null) operations = await startSellerOperations(session, { port: operationsPort }); }
  catch (issue) { await session.close().finally(() => source.close()); throw issue; }
  let closing;
  return { ...session, source, operations, close() {
    closing ??= session.close().finally(() => Promise.all([operations?.close(), source.close()]));
    return closing;
  } };
}
