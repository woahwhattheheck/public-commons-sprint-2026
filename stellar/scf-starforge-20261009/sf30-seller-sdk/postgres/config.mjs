// MIT. Credentials are resolved privately from an operator-selected environment.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compilePostgresQueries, describePostgresQueries } from './declaration.mjs';
import { createPostgresQuerySource } from './source.mjs';
export { bindPostgresSeller } from './bindings.mjs';

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const TLS_MODES = new Set(['verify-full', 'local-plaintext', 'disable-loopback']);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const text = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 1024 && !value.includes('\0');

function validateConnectionConfig(config) {
  const uri = Object.hasOwn(config, 'connectionEnv');
  const profile = Object.hasOwn(config, 'connection');
  if (uri === profile || Object.hasOwn(config, 'connectionString') || Object.hasOwn(config, 'password'))
    throw new TypeError('POSTGRES_SOURCE_CONFIG_INVALID');
  if (uri) {
    if (typeof config.connectionEnv !== 'string' || !ENV_NAME.test(config.connectionEnv))
      throw new TypeError('POSTGRES_SOURCE_CONFIG_INVALID');
  } else {
    const value = config.connection;
    if (!record(value) || Object.hasOwn(value, 'password') || Object.hasOwn(value, 'connectionString') ||
        !text(value.host) || /[\s/\\]/.test(value.host) || !text(value.database) || !text(value.user) ||
        value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) ||
        value.passwordEnv !== undefined && (typeof value.passwordEnv !== 'string' || !ENV_NAME.test(value.passwordEnv)))
      throw new TypeError('POSTGRES_CONNECTION_PROFILE_INVALID');
    if (config.tls !== undefined && value.tls !== undefined && config.tls !== value.tls ||
        config.caFile !== undefined && value.caFile !== undefined && config.caFile !== value.caFile)
      throw new TypeError('POSTGRES_CONNECTION_PROFILE_CONFLICT');
  }
  const value = profile ? config.connection : config;
  const tls = value.tls ?? config.tls ?? 'verify-full';
  if (!TLS_MODES.has(tls)) throw new TypeError('POSTGRES_TLS_MODE_INVALID');
  if (profile && tls !== 'verify-full' && !LOOPBACK.has(value.host.replace(/^\[|\]$/g, '')))
    throw new TypeError('POSTGRES_PLAINTEXT_REQUIRES_LOOPBACK');
  const caFile = value.caFile ?? config.caFile;
  if (caFile !== undefined && (tls !== 'verify-full' || !text(caFile)))
    throw new TypeError('POSTGRES_CA_FILE_INVALID');
  if (config.maxConnections !== undefined && config.poolSize !== undefined && config.maxConnections !== config.poolSize)
    throw new TypeError('POSTGRES_POOL_SIZE_CONFLICT');
  for (const name of ['maxConnections', 'poolSize']) if (config[name] !== undefined &&
      (!Number.isInteger(config[name]) || config[name] < 1 || config[name] > 32))
    throw new TypeError('POSTGRES_POOL_SIZE_INVALID');
}

export async function readPostgresSourceFile(filename) {
  const path = resolve(filename), handle = await open(path, 'r');
  let config;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('POSTGRES_SOURCE_FILE_INVALID');
    const bytes = Buffer.alloc(262145); let total = 0;
    while (total < bytes.length) {
      const next = await handle.read(bytes, total, bytes.length - total, null);
      if (!next.bytesRead) break;
      total += next.bytesRead;
    }
    if (total > 262144) throw new RangeError('POSTGRES_SOURCE_FILE_TOO_LARGE');
    try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))); }
    catch { throw new TypeError('POSTGRES_SOURCE_JSON_INVALID'); }
  } finally { await handle.close(); }
  if (!record(config) || config.schema !== 'stellar-forge.postgres-source.v1')
    throw new TypeError('POSTGRES_SOURCE_CONFIG_INVALID');
  validateConnectionConfig(config);
  const queries = compilePostgresQueries(config.queries);
  // Keep the existing envelope and expose declaration fields for workspace callers.
  return { ...config, path, config, description: describePostgresQueries(queries) };
}

export async function resolvePostgresConnection(declaration, env = process.env) {
  if (!record(declaration) || !record(declaration.config) || typeof declaration.path !== 'string')
    throw new TypeError('POSTGRES_SOURCE_DECLARATION_INVALID');
  const { config, path } = declaration;
  validateConnectionConfig(config);
  let host, port, user, password, database;
  const profile = config.connection;
  if (profile) {
    host = profile.host.replace(/^\[|\]$/g, ''); port = profile.port ?? 5432;
    user = profile.user; database = profile.database;
    if (profile.passwordEnv !== undefined) {
      password = env[profile.passwordEnv];
      if (typeof password !== 'string' || password.length > 16384 || password.includes('\0'))
        throw new TypeError('POSTGRES_PASSWORD_ENV_UNAVAILABLE');
    }
  } else {
    const raw = env[config.connectionEnv];
    if (typeof raw !== 'string' || !raw || raw.length > 16384) throw new TypeError('POSTGRES_CONNECTION_ENV_UNAVAILABLE');
    let url;
    try { url = new URL(raw); } catch { throw new TypeError('POSTGRES_CONNECTION_URL_INVALID'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username ||
        !url.pathname || url.pathname === '/' || url.search || url.hash)
      throw new TypeError('POSTGRES_CONNECTION_URL_INVALID');
    try {
      host = url.hostname.replace(/^\[|\]$/g, ''); user = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password); database = decodeURIComponent(url.pathname.slice(1));
    } catch { throw new TypeError('POSTGRES_CONNECTION_URL_INVALID'); }
    if ([host, user, password, database].some(value => value.includes('\0')) || database.includes('/'))
      throw new TypeError('POSTGRES_CONNECTION_URL_INVALID');
    port = Number(url.port || 5432);
  }
  const tls = profile?.tls ?? config.tls ?? 'verify-full';
  if (tls !== 'verify-full' && !LOOPBACK.has(host))
    throw new TypeError('POSTGRES_PLAINTEXT_REQUIRES_LOOPBACK');
  const caFile = profile?.caFile ?? config.caFile;
  let ca;
  if (caFile !== undefined) {
    const file = await open(resolve(dirname(path), caFile), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1048576) throw new TypeError('POSTGRES_CA_FILE_INVALID');
      ca = await file.readFile('utf8');
      if (Buffer.byteLength(ca) > 1048576) throw new TypeError('POSTGRES_CA_FILE_INVALID');
    } finally { await file.close(); }
  }
  // pg otherwise falls back to ambient PGPASSWORD for an empty/omitted value.
  // A callback keeps authentication tied to the operator-selected environment.
  return { host, port, user, password: () => password ?? '', database,
    ssl: tls === 'verify-full' ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
    enableChannelBinding: true };
}

export async function openPostgresSourceFile(filename, { env = process.env } = {}) {
  const declaration = await readPostgresSourceFile(filename);
  const connection = await resolvePostgresConnection(declaration, env);
  const { config } = declaration;
  const source = await createPostgresQuerySource({ connection, queries: config.queries,
    maxConnections: config.maxConnections ?? config.poolSize, maxPending: config.maxPending,
    connectTimeoutMs: config.connectTimeoutMs, idleTimeoutMs: config.idleTimeoutMs,
    lockTimeoutMs: config.lockTimeoutMs, startupTimeoutMs: config.startupTimeoutMs });
  return { source, config };
}

// Compatibility names used by the operator workspace: one maintained source.
export async function describePostgresFile(filename) {
  const { config, description } = await readPostgresSourceFile(filename);
  return { schema: config.schema, queries: description, bindings: structuredClone(config.bindings ?? {}) };
}

export async function openPostgresQueryFile(filename, { environment = process.env } = {}) {
  const { source, config } = await openPostgresSourceFile(filename, { env: environment });
  return { source, bindings: config.bindings, config };
}
