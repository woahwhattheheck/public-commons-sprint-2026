#!/usr/bin/env node
/** MIT. Launch original SQLite/PostgreSQL/DuckDB/ClickHouse paid MCP queries. */
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
const HELP = `Usage: node data-serve.mjs --config /private/operator/data-mcp.json

Serve the ORIGINAL prepared SQLite, PostgreSQL, DuckDB or ClickHouse queries as
native paid MCP tools. Configuration names existing source, service, bindings and
native facilitator files. Credentials stay in the original environment bindings.
Guide: DATA_TOOLS.md. The original HTTP seller and prepared files are unchanged.`;

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
  fields(config, ['schema','provider','sourceFile','serviceFile','bindingsFile','facilitatorFile','python','tools','server'],
    'DATA_MCP_CONFIG_FIELDS_INVALID');
  requireValue(config.schema === 'stellar-forge.data-mcp.v1' &&
    ['sqlite','postgres','duckdb','clickhouse'].includes(config.provider), 'DATA_MCP_CONFIG_SCHEMA_INVALID');
  const files = {};
  for (const key of ['sourceFile','serviceFile','bindingsFile','facilitatorFile']) {
    requireValue(typeof config[key] === 'string' && config[key].length > 0 && config[key].length <= 4096 &&
      !/[\0\r\n]/.test(config[key]), 'DATA_MCP_SOURCE_FILE_REQUIRED');
    files[key] = resolve(dirname(path), config[key]);
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
    return openSqliteQueryFile(config.sourceFile);
  }
  if (config.provider === 'postgres') {
    const {openPostgresSourceFile} = await import(prefix + 'postgres/config.mjs');
    return (await openPostgresSourceFile(config.sourceFile, {env:environment})).source;
  }
  if (config.provider === 'duckdb') {
    const {openDuckdbSourceFile} = await import(prefix + 'duckdb/source.mjs');
    return (await openDuckdbSourceFile(config.sourceFile, {python:config.python ?? 'python3', environment})).source;
  }
  const {openClickHouseSourceFile} = await import(prefix + 'clickhouse/source.mjs');
  return (await openClickHouseSourceFile(config.sourceFile, {env:environment})).source;
}

/** Opening and closing use the existing source lifecycle; only transport changes. */
export async function startDataMcpFile(filename, {environment = process.env} = {}) {
  const config = await readDataMcpConfig(filename);
  const [serviceConfig, bindings, facilitatorConfig] = await Promise.all([
    readSellerConfig(config.serviceFile), readJson(config.bindingsFile), readFacilitatorConfig(config.facilitatorFile),
  ]);
  const source = await openSource(config, environment);
  return startDataToolServer({source, serviceConfig, bindings, selections:config.tools,
    facilitatorConfig, environment, ...config.server});
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  requireValue(args.length === 2 && args[0] === '--config', 'DATA_MCP_CONFIG_OPTION_REQUIRED');
  const server = await startDataMcpFile(args[1]);
  process.stdout.write(JSON.stringify({mode:'NATIVE_PAID_DATA_MCP', endpoint:server.endpoint,
    discoveryUrl:server.discoveryUrl, tools:server.tools().map(tool => tool.name), source:server.sourceStatus()}) + '\n');
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
