// MIT. Private operator config; connection values stay out of source and reports.
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPostgresQuerySource } from './source.mjs';
import { compilePostgresQueries, record } from './parameters.mjs';

export async function readPrivateFile(filename, maxBytes = 262144) {
  const handle = await open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new TypeError('Expected a regular configuration file within size limit');
    const bytes = Buffer.alloc(maxBytes + 1); let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break; total += bytesRead;
    }
    if (total > maxBytes) throw new TypeError('Configuration file exceeds size limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total));
  } finally { await handle.close(); }
}
export async function readPostgresSourceConfig(filename) {
  const config = JSON.parse(await readPrivateFile(resolve(filename)));
  if (!record(config) || config.schema !== 'stellar-forge.postgres-source.v1' ||
      typeof config.connectionStringEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(config.connectionStringEnv))
    throw new TypeError('Expected postgres-source.v1 with connectionStringEnv');
  if (Object.hasOwn(config, 'connectionString') || Object.hasOwn(config, 'password'))
    throw new TypeError('Use connectionStringEnv instead of credential values in configuration');
  if (!['verify-full', 'disable'].includes(config.tls ?? 'verify-full')) throw new TypeError('tls must be verify-full or disable');
  if (config.caFile !== undefined && (typeof config.caFile !== 'string' || !config.caFile)) throw new TypeError('caFile must be a path');
  compilePostgresQueries(config.queries);
  return config;
}
export async function openPostgresQueryFile(filename, { env = process.env } = {}) {
  const path = resolve(filename), config = await readPostgresSourceConfig(path);
  const raw = env[config.connectionStringEnv];
  if (typeof raw !== 'string' || !raw) throw new TypeError('Configured database connection environment variable is missing');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('Database connection environment value must be a PostgreSQL URI'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username ||
      !url.pathname || url.pathname === '/' || url.search || url.hash)
    throw new TypeError('PostgreSQL URI requires host, user and database, without URI query options');
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (config.tls === 'disable' && (!local || config.allowLocalDatabase !== true))
    throw new TypeError('Disabled TLS requires explicit allowLocalDatabase and a loopback database');
  let identity;
  try { identity = { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) }; }
  catch { throw new TypeError('Database URI contains an invalid encoded identity'); }
  if (Object.values(identity).some(value => value.includes('\0')) || identity.database.includes('/'))
    throw new TypeError('Database URI identity is invalid');
  const ssl = config.tls === 'disable' ? false : { rejectUnauthorized: true,
    ...(config.caFile ? { ca: await readPrivateFile(resolve(dirname(path), config.caFile), 131072) } : {}) };
  return createPostgresQuerySource({ connection: { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432), ...identity, ssl },
    queries: config.queries, maxConnections: config.maxConnections, maxPending: config.maxPending,
    connectTimeoutMs: config.connectTimeoutMs, idleTimeoutMs: config.idleTimeoutMs });
}

export async function describePostgresSourceFile(filename) {
  const config = await readPostgresSourceConfig(filename);
  return { schema: config.schema, queries: Object.fromEntries(Object.entries(compilePostgresQueries(config.queries)).map(([name, spec]) =>
    [name, { parameters: spec.parameters, columns: spec.columns, maxRows: spec.maxRows,
      maxBytes: spec.maxBytes, timeoutMs: spec.timeoutMs, encoding: 'postgres-text' }])) };
}
