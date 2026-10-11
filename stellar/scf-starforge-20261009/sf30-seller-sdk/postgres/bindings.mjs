// MIT. Shared binding for the original seller and the private operator workspace.
export function bindPostgresSeller(serviceConfig, source, bindings) {
  if (!source || typeof source.route !== 'function' || !Array.isArray(serviceConfig?.routes) || !bindings ||
      typeof bindings !== 'object' || Array.isArray(bindings) || !Object.keys(bindings).length)
    throw new TypeError('POSTGRES_MERCHANT_BINDINGS_REQUIRED');
  const handlers = Object.create(null), seen = new Set();
  for (const [routeId, binding] of Object.entries(bindings)) {
    const route = serviceConfig.routes.find(item => item.id === routeId);
    if (!route || !binding || typeof binding !== 'object' || !route.handler || !route.admit ||
        Object.hasOwn(route, 'response') || Object.hasOwn(route, 'responseFile') ||
        typeof binding.query !== 'string' || !['query', 'body'].includes(binding.input ?? 'query'))
      throw new TypeError('POSTGRES_MERCHANT_BINDING_INVALID');
    const input = binding.input ?? 'query';
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (input === 'body' && !['POST', 'PUT', 'PATCH'].includes(method))
      throw new TypeError('POSTGRES_BODY_BINDING_METHOD_INVALID');
    const query = source.route(binding.query, { input });
    if (seen.has(route.handler) || seen.has(route.admit) || route.handler === route.admit)
      throw new TypeError('POSTGRES_HANDLER_NAME_COLLISION');
    seen.add(route.handler); seen.add(route.admit);
    handlers[route.handler] = query.handler; handlers[route.admit] = query.admit;
  }
  if (serviceConfig.routes.some(route => route.handler && !Object.hasOwn(handlers, route.handler)))
    throw new TypeError('POSTGRES_UNBOUND_APPLICATION_HANDLER');
  return handlers;
}
