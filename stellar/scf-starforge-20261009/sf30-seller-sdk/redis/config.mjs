// MIT. Resolve an existing host connection; private values never enter descriptions.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compileRedisQueries, describeRedisQueries } from './declaration.mjs';
import { createRedisQuerySource } from './source.mjs';
import { validateUpstashEndpoint } from './upstash-rest.mjs';
import { validateRedisConnectionProfile, resolveRedisConnectionProfile, describeRedisConnectionProfile } from './connection-profile.mjs';
const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
export function validateRedisSourceConfig(config) {
  if (!record(config) || config.schema !== 'stellar-forge.redis-source.v1' || !record(config.connection) ||
      Object.keys(config).some(key => !['schema', 'connection', 'queries', 'bindings', 'maxConnections',
        'maxPending', 'connectTimeoutMs', 'idleTimeoutMs', 'startupTimeoutMs'].includes(key)))
    throw new TypeError('REDIS_SOURCE_CONFIG_INVALID');
  for (const [name, low, high] of [['maxConnections', 1, 32], ['maxPending', 1, 256],
    ['connectTimeoutMs', 100, 30000], ['idleTimeoutMs', 1000, 300000], ['startupTimeoutMs', 100, 60000]])
    if (config[name] !== undefined && (!Number.isInteger(config[name]) || config[name] < low || config[name] > high))
      throw new TypeError('REDIS_SOURCE_LIMIT_INVALID:' + name);
  if ((config.maxPending ?? 32) < (config.maxConnections ?? 4)) throw new TypeError('REDIS_PENDING_BELOW_CONNECTION_LIMIT');
  const c = config.connection;
  if (c.transport === 'upstash-rest') {
    if (Object.keys(c).some(key => !['transport', 'endpoint', 'tokenEnv'].includes(key)) || !ENV.test(c.tokenEnv ?? ''))
      throw new TypeError('REDIS_HTTP_CONNECTION_PROFILE_INVALID');
    validateUpstashEndpoint(c.endpoint);
  } else validateRedisConnectionProfile(c);
  compileRedisQueries(config.queries);
  if (config.bindings !== undefined) {
    if (!record(config.bindings)) throw new TypeError('REDIS_BINDINGS_INVALID');
    for (const [name, binding] of Object.entries(config.bindings)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || !record(binding) ||
          Object.keys(binding).some(key => !['query', 'input'].includes(key)) ||
          !Object.hasOwn(config.queries, binding.query) || !['query', 'body'].includes(binding.input ?? 'query'))
        throw new TypeError('REDIS_BINDING_INVALID');
    }
  }
  return config;
}
async function bytes(filename, maximum) {
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new TypeError('REDIS_SOURCE_FILE_INVALID');
    const output = Buffer.alloc(maximum + 1); let total = 0;
    while (total < output.length) {
      const { bytesRead } = await file.read(output, total, output.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maximum) throw new TypeError('REDIS_SOURCE_FILE_TOO_LARGE');
    return output.subarray(0, total);
  } finally { await file.close(); }
}
export async function readRedisSourceFile(filename) {
  const path = resolve(filename);
  const config = validateRedisSourceConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, 262144))));
  return { path, config, description: describeRedisQueries(compileRedisQueries(config.queries)) };
}
export async function resolveRedisConnection(declaration, environment = process.env) {
  const c = validateRedisSourceConfig(declaration.config).connection;
  if (c.transport === 'upstash-rest') {
    const token = environment[c.tokenEnv];
    if (typeof token !== 'string' || token.length < 1 || token.length > 16384 || /[^\x21-\x7e]/.test(token))
      throw new TypeError('REDIS_HTTP_TOKEN_ENV_UNAVAILABLE');
    return { transport: 'upstash-rest', endpoint: validateUpstashEndpoint(c.endpoint), token };
  }
  return resolveRedisConnectionProfile(c, { environment,
    readCertificate: filename => bytes(resolve(dirname(declaration.path), filename), 1048576) });
}
export async function openRedisSourceFile(filename, { environment = process.env } = {}) {
  const declaration = await readRedisSourceFile(filename), { config } = declaration;
  const connection = await resolveRedisConnection(declaration, environment);
  const source = await createRedisQuerySource({ connection, queries: config.queries,
    maxConnections: config.maxConnections, maxPending: config.maxPending,
    connectTimeoutMs: config.connectTimeoutMs, idleTimeoutMs: config.idleTimeoutMs, startupTimeoutMs: config.startupTimeoutMs });
  return { source, config };
}
export async function describeRedisFile(filename) {
  const { config, description } = await readRedisSourceFile(filename);
  return { schema: config.schema,
    connection: config.connection.transport === 'upstash-rest' ? {transport:'upstash-rest', topology:'standalone'} : describeRedisConnectionProfile(config.connection),
    queries: description, bindings: structuredClone(config.bindings ?? {}) };
}
