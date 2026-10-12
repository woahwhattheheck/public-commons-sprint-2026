// MIT. Private SQL Server profile. Secrets stay in the selected host environment.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { record } from '../sqlite/parameters.mjs';
import { compileMssqlQueries, describeMssqlQueries } from './declaration.mjs';
import { createMssqlQuerySource } from './source.mjs';

const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const local = host => ['localhost', '127.0.0.1', '::1'].includes(host);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
export function validateMssqlConfig(config) {
  if (!record(config) || config.schema !== 'stellar-forge.mssql-source.v1' || !record(config.connection))
    throw new TypeError('MSSQL_SOURCE_CONFIG_INVALID');
  const allowed = ['schema','connection','queries','bindings','maxConnections','maxPending',
    'connectTimeoutMs','idleTimeoutMs','startupTimeoutMs'];
  if (Object.keys(config).some(key => !allowed.includes(key))) throw new TypeError('MSSQL_SOURCE_FIELD_UNKNOWN');
  for (const [key, low, high] of [['maxConnections',1,32],['maxPending',1,256],
    ['connectTimeoutMs',100,30000],['idleTimeoutMs',1000,300000],['startupTimeoutMs',100,60000]])
    if (config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] < low || config[key] > high))
      throw new TypeError('MSSQL_SOURCE_LIMIT_INVALID:' + key);
  if ((config.maxPending ?? 32) < (config.maxConnections ?? 4)) throw new TypeError('MSSQL_PENDING_BELOW_CONNECTION_LIMIT');
  const c = config.connection;
  if (Object.keys(c).some(key => !['host','port','database','user','passwordEnv','tls','caFile'].includes(key)) ||
      !text(c.host) || /[\s/\\]/.test(c.host) || !text(c.database) || !text(c.user) ||
      !ENV.test(c.passwordEnv ?? '') || c.port !== undefined &&
      (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
    throw new TypeError('MSSQL_CONNECTION_PROFILE_INVALID');
  if (!['verify-full','local-plaintext'].includes(c.tls ?? 'verify-full')) throw new TypeError('MSSQL_TLS_MODE_INVALID');
  if (c.tls === 'local-plaintext' && !local(c.host)) throw new TypeError('MSSQL_PLAINTEXT_REQUIRES_LOOPBACK');
  if (c.caFile !== undefined && (!text(c.caFile) || c.tls === 'local-plaintext')) throw new TypeError('MSSQL_CA_FILE_INVALID');
  compileMssqlQueries(config.queries);
}
async function bytes(path, maximum) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new TypeError('MSSQL_INPUT_FILE_INVALID');
    const data = await file.readFile();
    if (data.length > maximum) throw new TypeError('MSSQL_INPUT_FILE_TOO_LARGE');
    return data;
  } finally { await file.close(); }
}
export async function readMssqlSourceFile(filename) {
  const path = resolve(filename);
  const config = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(await bytes(path,262144)));
  validateMssqlConfig(config);
  return { path, config, description:describeMssqlQueries(compileMssqlQueries(config.queries)) };
}
export async function resolveMssqlConnection(declaration, environment = process.env) {
  validateMssqlConfig(declaration.config);
  const c = declaration.config.connection, password = environment[c.passwordEnv];
  if (typeof password !== 'string' || !password.length || password.length > 16384 || password.includes('\0'))
    throw new TypeError('MSSQL_PASSWORD_ENV_UNAVAILABLE');
  const ca = c.caFile ? new TextDecoder('utf-8',{fatal:true}).decode(
    await bytes(resolve(dirname(declaration.path),c.caFile),1048576)) : null;
  return { server:c.host, port:c.port ?? 1433, database:c.database, user:c.user, password,
    options:{ encrypt:c.tls !== 'local-plaintext', trustServerCertificate:false, useUTC:true,
      enableArithAbort:true, readOnlyIntent:true, appName:'Starforge SQL Server merchant',
      ...(ca ? { cryptoCredentialsDetails:{ca} } : {}) } };
}
export async function openMssqlSourceFile(filename,{environment=process.env}={}) {
  const declaration=await readMssqlSourceFile(filename), {config}=declaration;
  const connection=await resolveMssqlConnection(declaration,environment);
  const source=await createMssqlQuerySource({connection,queries:config.queries,
    maxConnections:config.maxConnections,maxPending:config.maxPending,
    connectTimeoutMs:config.connectTimeoutMs,idleTimeoutMs:config.idleTimeoutMs,
    startupTimeoutMs:config.startupTimeoutMs});
  return {source,config};
}
export async function describeMssqlFile(filename) {
  const {config,description}=await readMssqlSourceFile(filename);
  return {schema:config.schema,queries:description,bindings:structuredClone(config.bindings??{})};
}
