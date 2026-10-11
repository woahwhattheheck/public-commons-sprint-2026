// MIT. Credentials are resolved privately from an operator-selected environment.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compilePostgresQueries, describePostgresQueries } from './declaration.mjs';
import { createPostgresQuerySource } from './source.mjs';

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
  if (!record(config) || config.schema !== 'stellar-forge.postgres-source.v1' ||
      typeof config.connectionEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(config.connectionEnv) ||
      Object.hasOwn(config, 'connection') || Object.hasOwn(config, 'connectionString') || Object.hasOwn(config, 'password'))
    throw new TypeError('POSTGRES_SOURCE_CONFIG_INVALID');
  const queries = compilePostgresQueries(config.queries);
  return { path, config, description: describePostgresQueries(queries) };
}

async function resolveConnection(declaration, env) {
  const { config, path } = declaration;
  const raw = env[config.connectionEnv];
  if (typeof raw !== 'string' || !raw || raw.length > 16384) throw new TypeError('POSTGRES_CONNECTION_ENV_UNAVAILABLE');
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('POSTGRES_CONNECTION_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username ||
      !url.pathname || url.pathname === '/' || url.search || url.hash)
    throw new TypeError('POSTGRES_CONNECTION_URL_INVALID');
  let host, user, password, database;
  try {
    host = url.hostname.replace(/^\[|\]$/g, ''); user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password); database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new TypeError('POSTGRES_CONNECTION_URL_INVALID'); }
  if ([host, user, password, database].some(value => value.includes('\0')) || database.includes('/'))
    throw new TypeError('POSTGRES_CONNECTION_URL_INVALID');
  const tls = config.tls ?? 'verify-full';
  if (!['verify-full', 'local-plaintext'].includes(tls)) throw new TypeError('POSTGRES_TLS_MODE_INVALID');
  if (tls === 'local-plaintext' && !['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new TypeError('POSTGRES_PLAINTEXT_REQUIRES_LOOPBACK');
  let ca;
  if (config.caFile !== undefined) {
    if (tls !== 'verify-full' || typeof config.caFile !== 'string') throw new TypeError('POSTGRES_CA_FILE_INVALID');
    const file = await open(resolve(dirname(path), config.caFile), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1048576) throw new TypeError('POSTGRES_CA_FILE_INVALID');
      ca = await file.readFile('utf8');
      if (Buffer.byteLength(ca) > 1048576) throw new TypeError('POSTGRES_CA_FILE_INVALID');
    } finally { await file.close(); }
  }
  return { host, port: Number(url.port || 5432), user, password, database,
    ssl: tls === 'local-plaintext' ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    enableChannelBinding: true };
}

export async function openPostgresSourceFile(filename, { env = process.env } = {}) {
  const declaration = await readPostgresSourceFile(filename);
  const connection = await resolveConnection(declaration, env);
  const { config } = declaration;
  const source = await createPostgresQuerySource({ connection, queries: config.queries,
    maxConnections: config.maxConnections, maxPending: config.maxPending,
    connectTimeoutMs: config.connectTimeoutMs, idleTimeoutMs: config.idleTimeoutMs,
    lockTimeoutMs: config.lockTimeoutMs, startupTimeoutMs: config.startupTimeoutMs });
  return { source, config };
}
