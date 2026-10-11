#!/usr/bin/env node
/** MIT. Launch original prepared database products through native paid MCP. */
import {open} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readSellerConfig} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs';
import {readConfig as readFacilitatorConfig} from '../../stellar/scf-starforge-20261009/native-facilitator/config.mjs';
import {startDataToolServer} from './data-tools.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (value, code) => { if (!value) throw Object.assign(new TypeError(code), {code}); };
const fields = (value, allowed, code) => requireValue(object(value) && Object.keys(value).every(key => allowed.includes(key)), code);
const SERVER_FIELDS = ['host','port','path','publicEndpoint','name','version','maxSessions','sessionIdleMs',
  'maxInFlight','maxRequestBytes','maxResultBytes','enableJsonResponse'];
const PREPARED_PROVIDERS = new Set(['mysql', 'mongodb']);
const HELP = `Usage: node data-serve.mjs --config /private/operator/data-mcp.json

Serve ORIGINAL SQLite, PostgreSQL, DuckDB, ClickHouse, MySQL or MongoDB products
as native paid MCP tools. MySQL/MongoDB use their verified preparedDirectory and
its embedded bindings. Other providers use sourceFile/serviceFile/bindingsFile.
facilitatorFile selects the existing native facilitator; credentials stay in the
original environment bindings. The original data source and result encodings apply.
Guide: DATA_TOOLS.md. The original HTTP seller and prepared files are unchanged.

Portable MySQL product: starforge mcp-data mysql --help
Review original query declarations and native terms, retain the complete private
package, and hand its public customer tools to the buyer. Guide: MYSQL_PACKAGES.md.`;

async function readJson(filename, limit = 262144) {
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    requireValue(stat.isFile() && stat.size <= limit, 'DATA_MCP_CONFIG_FILE_INVALID');
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    requireValue(length <= limit, 'DATA_MCP_CONFIG_FILE_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(0, length)));
  } finally { await file.close(); }
}

export async function readDataMcpConfig(filename) {
  requireValue(typeof filename === 'string' && filename.length > 0 && filename.length <= 4096,
    'DATA_MCP_CONFIG_PATH_REQUIRED');
  const path = resolve(filename), config = await readJson(path);
  fields(config, ['schema','provider','preparedDirectory','sourceFile','serviceFile','bindingsFile','facilitatorFile','python','tools','server'],
    'DATA_MCP_CONFIG_FIELDS_INVALID');
  requireValue(config.schema === 'stellar-forge.data-mcp.v1' &&
    ['sqlite','postgres','duckdb','clickhouse','mysql','mongodb'].includes(config.provider), 'DATA_MCP_CONFIG_SCHEMA_INVALID');
  const files = {};
  const prepared = PREPARED_PROVIDERS.has(config.provider);
  requireValue(prepared ? !['sourceFile','serviceFile','bindingsFile'].some(key => Object.hasOwn(config, key))
    : !Object.hasOwn(config, 'preparedDirectory'), 'DATA_MCP_PREPARED_FIELDS_INVALID');
  for (const key of prepared ? ['preparedDirectory','facilitatorFile'] : ['sourceFile','serviceFile','bindingsFile','facilitatorFile']) {
    requireValue(typeof config[key] === 'string' && config[key].length > 0 && config[key].length <= 4096 &&
      !/[\0\r\n]/.test(config[key]), 'DATA_MCP_SOURCE_FILE_REQUIRED');
    files[key] = resolve(dirname(path), config[key]);
  }
  if (prepared) {
    files.sourceFile = resolve(files.preparedDirectory, 'source.json');
    files.serviceFile = resolve(files.preparedDirectory, 'service.json');
  }
  requireValue(config.python === undefined || config.provider === 'duckdb' && typeof config.python === 'string' &&
    config.python.length > 0 && config.python.length <= 4096 && !/[\0\r\n]/.test(config.python), 'DATA_MCP_PYTHON_INVALID');
  requireValue(Array.isArray(config.tools) && config.tools.length > 0 && config.tools.length <= 32,
    'DATA_MCP_TOOLS_REQUIRED');
  fields(config.server ?? {}, SERVER_FIELDS, 'DATA_MCP_SERVER_OPTIONS_INVALID');
  return {...config, ...files, path};
}

async function openSource(config, environment) {
  const prefix = '../../stellar/scf-starforge-20261009/sf30-seller-sdk/';
  if (config.provider === 'sqlite') {
    const {openSqliteQueryFile} = await import(prefix + 'sqlite/config.mjs');
    return {source:await openSqliteQueryFile(config.sourceFile)};
  }
  if (config.provider === 'postgres') {
    const {openPostgresSourceFile} = await import(prefix + 'postgres/config.mjs');
    return openPostgresSourceFile(config.sourceFile, {env:environment});
  }
  if (config.provider === 'duckdb') {
    const {openDuckdbSourceFile} = await import(prefix + 'duckdb/source.mjs');
    return openDuckdbSourceFile(config.sourceFile, {python:config.python ?? 'python3', environment});
  }
  if (config.provider === 'mysql') {
    const {openMysqlSourceFile} = await import(prefix + 'mysql/config.mjs');
    return openMysqlSourceFile(config.sourceFile, {environment});
  }
  if (config.provider === 'mongodb') {
    const {openMongoSourceFile} = await import(prefix + 'mongodb/config.mjs');
    return openMongoSourceFile(config.sourceFile, {environment});
  }
  const {openClickHouseSourceFile} = await import(prefix + 'clickhouse/source.mjs');
  return openClickHouseSourceFile(config.sourceFile, {env:environment});
}

async function verifyPreparedSource(config) {
  if (config.provider === 'mysql') {
    const {verifyPreparedMysqlSeller} = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/prepare.mjs');
    return verifyPreparedMysqlSeller(config.preparedDirectory);
  }
  if (config.provider === 'mongodb') {
    const {verifyPreparedMongoSeller} = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/prepare.mjs');
    return verifyPreparedMongoSeller(config.preparedDirectory);
  }
  return null;
}

/** Opening and closing use the existing source lifecycle; only transport changes. */
export async function startDataMcpFile(filename, {environment = process.env} = {}) {
  const config = await readDataMcpConfig(filename);
  // Use the provider's own complete prepared-package verification before opening
  // its database or facilitator. The source, plan, public contract and generated
  // customer remain in that package; no parallel bindings or query engine exist.
  const prepared = await verifyPreparedSource(config);
  const [serviceConfig, bindings, facilitatorConfig] = await Promise.all([
    readSellerConfig(config.serviceFile), prepared ? null : readJson(config.bindingsFile), readFacilitatorConfig(config.facilitatorFile),
  ]);
  const opened = await openSource(config, environment);
  const server = await startDataToolServer({source:opened.source, serviceConfig,
    bindings:prepared ? opened.config.bindings : bindings, selections:config.tools,
    facilitatorConfig, environment, ...config.server});
  return Object.freeze({...server, provider:config.provider,
    prepared:prepared ? Object.freeze({schema:prepared.schema, manifestSha256:prepared.manifestSha256}) : null});
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'mysql') return (await import('./mysql-package.mjs')).main(args.slice(1));
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  requireValue(args.length === 2 && args[0] === '--config', 'DATA_MCP_CONFIG_OPTION_REQUIRED');
  const server = await startDataMcpFile(args[1]);
  process.stdout.write(JSON.stringify({mode:'NATIVE_PAID_DATA_MCP', endpoint:server.endpoint,
    discoveryUrl:server.discoveryUrl, tools:server.tools().map(tool => tool.name), source:server.sourceStatus(),
    provider:server.provider, prepared:server.prepared}) + '\n');
  const stop = async () => {
    try { const result = await server.close(); process.stdout.write(JSON.stringify({state:'CLOSED', drained:result.drained}) + '\n'); }
    catch { process.stderr.write('DATA_MCP_DRAIN_FAILED\n'); process.exitCode = 1; }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(issue?.code ?? '') ? issue.code : 'DATA_MCP_START_FAILED';
    process.stderr.write(code + '\n'); process.exitCode = 1;
  });
