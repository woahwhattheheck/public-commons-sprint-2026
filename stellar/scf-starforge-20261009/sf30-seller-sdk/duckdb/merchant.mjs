// MIT. Use the original seller, admission, native payment and operations APIs.
import { startSellerService, readSellerConfig } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';
import { openDuckdbSourceFile } from './source.mjs';
import { isDeepStrictEqual } from 'node:util';

export function bindDuckdbSeller(config, source, bindings) {
  if (!Array.isArray(config?.routes) || !source?.route || !bindings || typeof bindings !== 'object' ||
      Array.isArray(bindings) || !Object.keys(bindings).length) throw new TypeError('DUCKDB_BINDINGS_REQUIRED');
  const service = structuredClone(config), handlers = Object.create(null), names = new Set();
  for (const [id, binding] of Object.entries(bindings)) {
    const route = service.routes.find(item => item.id === id);
    if (!route || !route.handler || !binding || typeof binding.query !== 'string' ||
        ['response', 'responseFile', 'responseAsset'].some(key => Object.hasOwn(route, key)))
      throw new TypeError('DUCKDB_ROUTE_BINDING_INVALID');
    const input = binding.input ?? 'query';
    const method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (!['query', 'body'].includes(input) || input === 'body' && !['POST', 'PUT', 'PATCH'].includes(method))
      throw new TypeError('DUCKDB_INPUT_BINDING_INVALID');
    route.admit ??= '__duckdb_admit_' + id.replaceAll('-', '_');
    if (names.has(route.handler) || names.has(route.admit) || route.handler === route.admit)
      throw new TypeError('DUCKDB_HANDLER_COLLISION');
    names.add(route.handler); names.add(route.admit);
    const query = source.route(binding.query, { input });
    handlers[route.handler] = query.handler; handlers[route.admit] = query.admit;
  }
  if (service.routes.some(route => route.handler && !Object.hasOwn(handlers, route.handler)))
    throw new TypeError('DUCKDB_UNBOUND_HANDLER');
  return { service, handlers };
}

export async function startDuckdbMerchant({ source, config, bindings, port = 8423, operationsPort = 8424,
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  const { service, handlers } = bindDuckdbSeller(config, source, bindings);
  const seller = await startSellerService({ config: service, handlers, port, nativeFactory, maxInFlight, drainGraceMs });
  let operations, closing;
  try { if (operationsPort !== null) operations = await startSellerOperations(seller, { port: operationsPort }); }
  catch (issue) { await seller.close().finally(() => source.close()); throw issue; }
  return { seller, source, operations, close() {
    closing ??= seller.close().finally(() => Promise.all([operations?.close(), source.close()]));
    return closing;
  } };
}

export async function startDuckdbSeller({ sourceFile, configFile, python = 'python3', environment = process.env,
  expectedSourceSha256, expectedSourceConfig, expectedServiceConfig,
  ...options } = {}) {
  const config = await readSellerConfig(configFile);
  const { source, config: declaration } = await openDuckdbSourceFile(sourceFile, { python, environment });
  try {
    if (expectedSourceSha256 !== undefined && source.describe().sourceSha256 !== expectedSourceSha256 ||
        expectedSourceConfig !== undefined && !isDeepStrictEqual(declaration, expectedSourceConfig) ||
        expectedServiceConfig !== undefined && !isDeepStrictEqual(config, expectedServiceConfig))
      throw new TypeError('DUCKDB_PREPARED_SOURCE_CHANGED');
    return await startDuckdbMerchant({ source, config, bindings: declaration.bindings, ...options });
  }
  catch (issue) { await source.close(); throw issue; }
}
