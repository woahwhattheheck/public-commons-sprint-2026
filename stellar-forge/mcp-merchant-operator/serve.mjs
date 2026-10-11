#!/usr/bin/env node
// MIT. Original authenticated MCP transport with the original merchant lifecycle.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpToolHandler } from '../mcp-paid-agent/http-tools.mjs';
import { openMerchantOperator } from './operator.mjs';
import { initializeMerchant, initializeFleetMerchant, failure } from './config.mjs';

const HELP = `Starforge merchant MCP

  init-fleet --dir NEW_DIRECTORY --plan ORIGINAL_FLEET_PLAN.json [--name NAME]
  init --dir NEW_DIRECTORY --spec OPENAPI.json --selections SELECTIONS.json
       --bindings BINDINGS.json [--name NAME] [--seller-port PORT]
       [--handlers TRUSTED_MODULE.mjs | --upstreams UPSTREAMS.json]
       [--allow-loopback-upstream] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --workspace SAVED_API_PACKAGE [--name NAME]
       [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --python PYTHON_MERCHANT.json [--python-root SOURCE_DIR]
       [--name NAME] [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --duckdb-package PREPARED_DIRECTORY [--duckdb-python EXECUTABLE]
       [--name NAME] [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  serve --config MERCHANT_MCP.json [--port PORT] [--token-env ENVIRONMENT_NAME]

Supply the bearer token through MCP_ACCESS_TOKEN (or --token-env). It is never
stored in the merchant configuration or printed. MCP_CLIENT_ORIGINS is an
optional comma-separated allowlist. The listener binds only to 127.0.0.1.
`;
function pairs(args, allowed, switches = []) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.includes(key) && !switches.includes(key) || values.has(key)) throw failure('CONFIGURATION_ERROR', 'Unknown or repeated option: ' + key);
    if (switches.includes(key)) { values.set(key, true); continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw failure('CONFIGURATION_ERROR', 'Missing value for ' + key);
    values.set(key, value);
  }
  return values;
}
function portNumber(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d{1,5}$/.test(String(value)) || Number(value) > 65535) throw failure('CONFIGURATION_ERROR', 'Port must be 0–65535.');
  return Number(value);
}
export async function startMerchantMcp({ configPath, port = 3211, tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env } = {}) {
  if (!configPath || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw failure('CONFIGURATION_ERROR', 'Supply a merchant configuration and token environment-variable name.');
  port = portNumber(port, 3211);
  const operator = await openMerchantOperator(configPath);
  let server;
  try {
    const handler = createMcpToolHandler(operator, { bearerToken: environment[tokenEnv],
      allowedClientOrigins: String(environment.MCP_CLIENT_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
      serverName: 'starforge-merchant-operator', serverVersion: '0.1.0',
      instructions: 'Use merchant_sources, stage, inspect and compare to prepare a release. Activate with the current generation and exact digest. Start or restart explicitly. Use merchant_discovery_status and review before applying the returned reviewId to publish or withdraw offers; after an interrupted apply, inspect current discovery instead of replaying it. Cache invalidation requires the current owned instance and an explicit route or all:true. For a configured fleet, inspect merchant_fleet_plan and start with its digest; stage/review/prepare/activate uses the original exact candidate and revision. Keep draining sessions until fleet_status reports canRetire, then retire their exact child instance. Rollback uses a fresh retained-revision review; stop/restart uses this process-owned managerId. After a lost response inspect current status before another change. Only this MCP process can stop its owned runtimes. Customer client export reads original metadata. Payment verification and settlement remain in the original seller and configured facilitator.' });
    server = createServer(handler);
    server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
    });
  } catch (error) { server?.close(); await operator.close(); throw error; }
  let closing;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const stopped = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      // Finish an accepted change before draining the owned original seller.
      // New calls now receive OPERATOR_CLOSING, and new sockets are refused.
      try { await operator.close(); }
      finally { server.closeAllConnections(); await stopped; }
    })();
    return closing;
  };
  return { operator, server, url: 'http://127.0.0.1:' + server.address().port, close };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args;
  if (command === 'init-fleet') {
    const options = pairs(rest, ['--dir', '--plan', '--name']);
    if (!options.has('--dir') || !options.has('--plan')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --plan.');
    const result = await initializeFleetMerchant({ directory: options.get('--dir'), planFile: options.get('--plan'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init') {
    const options = pairs(rest, ['--dir', '--workspace', '--python', '--python-root', '--duckdb-package', '--duckdb-python', '--spec', '--selections', '--bindings', '--upstreams', '--name', '--seller-port', '--handlers', '--facilitator', '--catalog', '--fleet-plan'], ['--allow-local-facilitator', '--allow-loopback-upstream']);
    for (const key of options.has('--workspace') || options.has('--python') || options.has('--duckdb-package') ? ['--dir'] : ['--dir', '--spec', '--selections', '--bindings'])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Missing ' + key);
    const runtime = { port: portNumber(options.get('--seller-port'), 0) };
    if (options.has('--handlers')) runtime.handlers = options.get('--handlers');
    if (options.has('--facilitator')) runtime.facilitator = options.get('--facilitator');
    if (options.has('--allow-local-facilitator')) runtime.allowLocalFacilitator = true;
    if (options.has('--allow-loopback-upstream')) runtime.allowLoopbackUpstream = true;
    const result = await initializeMerchant({ directory: options.get('--dir'), spec: options.get('--spec'),
      selections: options.get('--selections'), bindings: options.get('--bindings'),
      workspace: options.get('--workspace'), upstreams: options.get('--upstreams'), runtime, catalog: options.get('--catalog'), fleetPlan: options.get('--fleet-plan'),
      python: options.get('--python'), pythonRoot: options.get('--python-root'),
      duckdbPackage: options.get('--duckdb-package'), duckdbPython: options.get('--duckdb-python'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command !== 'serve') throw failure('CONFIGURATION_ERROR', 'Choose init, init-fleet or serve.');
  const options = pairs(rest, ['--config', '--port', '--token-env']);
  if (!options.has('--config')) throw failure('CONFIGURATION_ERROR', 'Supply --config.');
  const session = await startMerchantMcp({ configPath: options.get('--config'), port: portNumber(options.get('--port'), 3211),
    tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN' });
  process.stdout.write(JSON.stringify({ schema: 'stellar-forge.merchant-mcp-listener.v1', url: session.url,
    tools: session.operator.tools.map(tool => tool.name), seller: 'STARTED_ONLY_BY_EXPLICIT_TOOL' }) + '\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await session.close(); }
    catch (error) { process.stderr.write('Merchant shutdown failed: ' + (error.code ?? 'OPERATOR_ERROR') + '\n'); process.exitCode = 2; }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write((error.code ?? 'CONFIGURATION_ERROR') + ': ' + error.message + '\n'); process.exitCode = 2; });
}
