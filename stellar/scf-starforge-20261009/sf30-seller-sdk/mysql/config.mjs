// MIT. Host-selected private credentials; public descriptions omit connection/SQL.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compileMysqlQueries, describeMysqlQueries } from './declaration.mjs';
import { createMysqlQuerySource } from './source.mjs';

const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host);
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
function validate(config) {
  if (!record(config) || config.schema !== 'stellar-forge.mysql-source.v1' || !record(config.connection))
    throw new TypeError('MYSQL_SOURCE_CONFIG_INVALID');
  const fields = ['schema', 'connection', 'queries', 'bindings', 'maxConnections', 'maxPending',
    'connectTimeoutMs', 'idleTimeoutMs', 'startupTimeoutMs'];
  if (Object.keys(config).some(key => !fields.includes(key))) throw new TypeError('MYSQL_SOURCE_FIELD_UNKNOWN');
  for (const [name, minimum, maximum] of [['maxConnections', 1, 32], ['maxPending', 1, 256],
    ['connectTimeoutMs', 100, 30000], ['idleTimeoutMs', 1000, 300000], ['startupTimeoutMs', 100, 60000]])
    if (config[name] !== undefined && (!Number.isInteger(config[name]) || config[name] < minimum || config[name] > maximum))
      throw new TypeError('MYSQL_SOURCE_LIMIT_INVALID:' + name);
  if ((config.maxPending ?? 32) < (config.maxConnections ?? 4)) throw new TypeError('MYSQL_PENDING_BELOW_CONNECTION_LIMIT');
  const c = config.connection;
  const allowed = ['host', 'port', 'database', 'user', 'passwordEnv', 'tls', 'caFile'];
  if (Object.keys(c).some(key => !allowed.includes(key)) ||
      !validText(c.host) || /[\s/\\]/.test(c.host) || !validText(c.database) || !validText(c.user) ||
      c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) ||
      c.passwordEnv !== undefined && !ENV.test(c.passwordEnv)) throw new TypeError('MYSQL_CONNECTION_PROFILE_INVALID');
  if (!['verify-full', 'local-plaintext'].includes(c.tls ?? 'verify-full')) throw new TypeError('MYSQL_TLS_MODE_INVALID');
  if (c.tls === 'local-plaintext' && !loopback(c.host)) throw new TypeError('MYSQL_PLAINTEXT_REQUIRES_LOOPBACK');
  if (c.caFile !== undefined && (!validText(c.caFile) || c.tls === 'local-plaintext')) throw new TypeError('MYSQL_CA_FILE_INVALID');
  compileMysqlQueries(config.queries);
}

export async function readMysqlSourceFile(filename) {
  const path = resolve(filename), handle = await open(path, 'r');
  let config;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) throw new TypeError('MYSQL_SOURCE_FILE_INVALID');
    const buffer = Buffer.alloc(262145); let length = 0;
    while (length < buffer.length) {
      const part = await handle.read(buffer, length, buffer.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > 262144) throw new TypeError('MYSQL_SOURCE_FILE_TOO_LARGE');
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await handle.close(); }
  validate(config);
  return { path, config, description: describeMysqlQueries(compileMysqlQueries(config.queries)) };
}

export async function resolveMysqlConnection(declaration, environment = process.env) {
  validate(declaration.config);
  const c = declaration.config.connection;
  let password = '';
  if (c.passwordEnv !== undefined) {
    password = environment[c.passwordEnv];
    if (typeof password !== 'string' || password.length > 16384 || password.includes('\0'))
      throw new TypeError('MYSQL_PASSWORD_ENV_UNAVAILABLE');
  }
  let ca;
  if (c.caFile) {
    const file = await open(resolve(dirname(declaration.path), c.caFile), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1048576) throw new TypeError('MYSQL_CA_FILE_INVALID');
      ca = await file.readFile('utf8');
      if (Buffer.byteLength(ca) > 1048576) throw new TypeError('MYSQL_CA_FILE_INVALID');
    } finally { await file.close(); }
  }
  return { host: c.host, port: c.port ?? 3306, database: c.database, user: c.user, password,
    ssl: c.tls === 'local-plaintext' ? undefined : { rejectUnauthorized: true, verifyIdentity: true, ...(ca ? { ca } : {}) } };
}

export async function openMysqlSourceFile(filename, { environment = process.env } = {}) {
  const declaration = await readMysqlSourceFile(filename);
  const connection = await resolveMysqlConnection(declaration, environment);
  const { config } = declaration;
  const source = await createMysqlQuerySource({ connection, queries: config.queries,
    maxConnections: config.maxConnections, maxPending: config.maxPending,
    connectTimeoutMs: config.connectTimeoutMs, idleTimeoutMs: config.idleTimeoutMs,
    startupTimeoutMs: config.startupTimeoutMs });
  return { source, config };
}

export async function describeMysqlFile(filename) {
  const { config, description } = await readMysqlSourceFile(filename);
  return { schema: config.schema, queries: description, bindings: structuredClone(config.bindings ?? {}) };
}
