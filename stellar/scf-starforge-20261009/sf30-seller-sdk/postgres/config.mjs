// MIT. Private PostgreSQL configuration; describe never loads credentials.
import { open, readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compilePostgresQueries, describeQueries } from './declaration.mjs';
import { createPostgresQuerySource } from './source.mjs';

export async function readPrivateJson(filename, maxBytes = 262144) {
  const handle = await open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new TypeError('Regular bounded JSON file required');
    const buffer = Buffer.alloc(maxBytes + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break; total += bytesRead;
    }
    if (total > maxBytes) throw new RangeError('JSON file exceeds size limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)));
  } finally { await handle.close(); }
}

export async function readPostgresSourceFile(filename) {
  const path = resolve(filename), config = await readPrivateJson(path);
  if (!record(config) || config.schema !== 'stellar-forge.postgres-source.v1' || !record(config.connection))
    throw new TypeError('Expected stellar-forge.postgres-source.v1');
  const compiled = compilePostgresQueries(config.queries);
  if (!record(config.bindings) || !Object.keys(config.bindings).length) throw new TypeError('Explicit seller route bindings required');
  for (const [id, binding] of Object.entries(config.bindings)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !record(binding) || !Object.hasOwn(compiled, binding.query) ||
        !['query', 'body'].includes(binding.input)) throw new TypeError('Each binding needs existing query name and query/body input');
  }
  return { config, compiled, path };
}

export function describePostgresFile(loaded) {
  return { schema: 'stellar-forge.postgres-source-description.v1', queries: describeQueries(loaded.compiled),
    bindings: structuredClone(loaded.config.bindings) };
}

async function connectionConfig(raw, directory, environment) {
  const printable = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\x00-\x20\x7f]/.test(value);
  if (!printable(raw.host) || !printable(raw.database) || !printable(raw.user) ||
      !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535 ||
      Object.hasOwn(raw, 'password') || Object.hasOwn(raw, 'connectionString')) throw new TypeError('Explicit host/port/database/user and environment-held password required');
  let password = '';
  if (raw.passwordEnv !== undefined) {
    if (typeof raw.passwordEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw.passwordEnv)) throw new TypeError('Invalid password environment reference');
    password = environment[raw.passwordEnv];
    if (typeof password !== 'string' || !password.length) throw new TypeError('POSTGRES_PASSWORD_UNAVAILABLE');
  }
  const local = ['127.0.0.1', '::1'].includes(raw.host) || isAbsolute(raw.host);
  const mode = raw.tls ?? 'verify-full';
  if (!['verify-full', 'disable-loopback'].includes(mode) || mode === 'disable-loopback' && !local || isAbsolute(raw.host) && mode !== 'disable-loopback')
    throw new TypeError('Use verified TLS; disable-loopback is only for a literal loopback or local Unix socket directory');
  let ssl = false;
  if (mode === 'verify-full') {
    ssl = { rejectUnauthorized: true };
    if (raw.caFile !== undefined) {
      if (typeof raw.caFile !== 'string' || !raw.caFile.length) throw new TypeError('Invalid CA file');
      const ca = await readFile(resolve(directory, raw.caFile));
      if (ca.length > 262144) throw new RangeError('CA file too large');
      ssl.ca = ca.toString('utf8');
    }
  } else if (raw.caFile !== undefined) throw new TypeError('CA file requires verified TLS');
  return { host: raw.host, port: raw.port, database: raw.database, user: raw.user, password, ssl };
}

export async function openPostgresQueryFile(filename, { environment = process.env } = {}) {
  const loaded = await readPostgresSourceFile(filename);
  const connection = await connectionConfig(loaded.config.connection, dirname(loaded.path), environment);
  const source = await createPostgresQuerySource({ connection, queries: loaded.config.queries,
    poolSize: loaded.config.poolSize, maxPending: loaded.config.maxPending,
    connectTimeoutMs: loaded.config.connectTimeoutMs, idleTimeoutMs: loaded.config.idleTimeoutMs });
  return { source, bindings: structuredClone(loaded.config.bindings) };
}

export function bindPostgresSeller(serviceConfig, source, bindings) {
  const handlers = Object.create(null), used = new Set();
  for (const route of serviceConfig.routes ?? []) {
    if (!Object.hasOwn(bindings, route.id)) continue;
    const binding = bindings[route.id], method = route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method;
    if (typeof route.handler !== 'string' || typeof route.admit !== 'string' ||
        Object.hasOwn(handlers, route.handler) || Object.hasOwn(handlers, route.admit) || route.handler === route.admit)
      throw new TypeError('Database routes require unique existing handler and admission export names');
    const bodyMethod = ['POST', 'PUT', 'PATCH'].includes(method);
    if (bodyMethod !== (binding.input === 'body')) throw new TypeError('Database binding must match the original HTTP method input');
    const pair = source.route(binding.query, { input: binding.input });
    handlers[route.handler] = pair.handler; handlers[route.admit] = pair.admit; used.add(route.id);
  }
  if (used.size !== Object.keys(bindings).length) throw new TypeError('Every database binding must match an original seller route');
  return handlers;
}
