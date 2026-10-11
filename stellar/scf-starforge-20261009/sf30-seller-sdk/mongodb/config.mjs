// MIT. A retained profile contains environment references, never a MongoDB URI.
import { resolve, dirname, isAbsolute } from 'node:path';
import { fields, fail, integer, readJson, limited } from './common.mjs';
import { compileMongoQueries, describeMongoQueries } from './declaration.mjs';
import { createMongoQuerySource } from './source.mjs';

export function validateMongoSource(config) {
  fields(config, ['schema', 'connection', 'queries', 'bindings', 'maxConnections', 'maxPending',
    'connectTimeoutMs', 'startupTimeoutMs'], 'MONGODB_SOURCE_FIELD_UNKNOWN');
  if (config.schema !== 'stellar-forge.mongodb-source.v1') fail('MONGODB_SOURCE_SCHEMA_INVALID');
  fields(config.connection, ['uriEnv', 'database', 'tls', 'caFile'], 'MONGODB_CONNECTION_FIELD_UNKNOWN');
  const c = config.connection;
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(c.uriEnv ?? '') || typeof c.database !== 'string' ||
      !c.database.length || c.database.length > 63 || /[\x00-\x20\x7f/\\."$]/.test(c.database))
    fail('MONGODB_CONNECTION_PROFILE_INVALID');
  if (!['required', 'local-plaintext'].includes(c.tls ?? 'required')) fail('MONGODB_TLS_MODE_INVALID');
  if (c.caFile !== undefined && (typeof c.caFile !== 'string' || !c.caFile.length || c.caFile.length > 4096 ||
      /[\x00-\x1f]/.test(c.caFile) || c.tls === 'local-plaintext')) fail('MONGODB_CA_FILE_INVALID');
  for (const [key, low, high, fallback] of [['maxConnections', 1, 32, 4], ['maxPending', 1, 256, 32],
    ['connectTimeoutMs', 100, 30000, 5000], ['startupTimeoutMs', 100, 60000, 10000]])
    integer(config[key] ?? fallback, low, high, 'MONGODB_LIMIT_INVALID:' + key);
  if ((config.maxPending ?? 32) < (config.maxConnections ?? 4)) fail('MONGODB_PENDING_BELOW_CONNECTIONS');
  compileMongoQueries(config.queries);
  if (config.bindings !== undefined) {
    fields(config.bindings, Object.keys(config.bindings), 'MONGODB_BINDINGS_INVALID');
    for (const value of Object.values(config.bindings)) {
      fields(value, ['query', 'input'], 'MONGODB_BINDING_INVALID');
      if (!Object.hasOwn(config.queries, value.query) || !['query', 'body'].includes(value.input ?? 'query')) fail('MONGODB_BINDING_INVALID');
    }
  }
  return config;
}
export async function readMongoSourceFile(filename) {
  const path = resolve(filename), config = validateMongoSource(await readJson(path));
  return { path, config, description: describeMongoQueries(compileMongoQueries(config.queries)) };
}
export async function resolveMongoConnection(declaration, environment = process.env) {
  const config = validateMongoSource(declaration.config), c = config.connection;
  const uri = environment[c.uriEnv];
  if (typeof uri !== 'string' || uri.length > 16384 || /[\x00-\x20]/.test(uri) || !/^mongodb(?:\+srv)?:\/\//.test(uri))
    fail('MONGODB_URI_ENV_UNAVAILABLE');
  const local = c.tls === 'local-plaintext';
  if (local) {
    let url;
    try { url = new URL(uri); } catch { fail('MONGODB_LOCAL_URI_INVALID'); }
    if (url.protocol !== 'mongodb:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      fail('MONGODB_PLAINTEXT_REQUIRES_LOOPBACK');
  }
  let ca;
  if (c.caFile) ca = await limited(resolve(dirname(declaration.path), c.caFile), 1048576);
  return { uri, database: c.database, options: { tls: !local,
    ...(local ? {} : { tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false, ...(ca ? { ca } : {}) }) } };
}
export async function openMongoSourceFile(filename, { environment = process.env } = {}) {
  const declaration = await readMongoSourceFile(filename);
  const source = await createMongoQuerySource({ connection: await resolveMongoConnection(declaration, environment),
    queries: declaration.config.queries, ...Object.fromEntries(['maxConnections', 'maxPending', 'connectTimeoutMs', 'startupTimeoutMs']
      .filter(key => declaration.config[key] !== undefined).map(key => [key, declaration.config[key]])) });
  return { source, config: declaration.config };
}
export async function describeMongoFile(filename) {
  const { config, description } = await readMongoSourceFile(filename);
  return { schema: config.schema, queries: description, requiredEnvironment: [config.connection.uriEnv],
    bindings: structuredClone(config.bindings ?? {}) };
}
