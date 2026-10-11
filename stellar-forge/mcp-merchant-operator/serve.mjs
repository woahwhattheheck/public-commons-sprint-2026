#!/usr/bin/env node
// MIT. Original authenticated MCP transport with the original merchant lifecycle.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpToolHandler } from '../mcp-paid-agent/http-tools.mjs';
import { openMerchantOperator } from './operator.mjs';
import { initializeMerchant, initializeFleetMerchant, initializeAccountingMerchant, initializeReceivingMerchant, failure } from './config.mjs';

const HELP = `Starforge merchant MCP

  init-accounting --dir NEW_DIRECTORY --accounting ACCOUNTING_JSON [--name NAME]
  init-fleet --dir NEW_DIRECTORY --plan ORIGINAL_FLEET_PLAN.json [--fleet-directory RETAINED_DIRECTORY] [--name NAME]
       [--accounting ACCOUNTING_JSON]
  init-receiving --dir NEW_DIRECTORY --receiving RECEIVING_CONNECTION_JSON [--name NAME]
  init --dir NEW_DIRECTORY --spec OPENAPI.json --selections SELECTIONS.json
       --bindings BINDINGS.json [--name NAME] [--seller-port PORT]
       [--handlers TRUSTED_MODULE.mjs | --upstreams UPSTREAMS.json]
       [--allow-loopback-upstream] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--support SUPPORT_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --workspace SAVED_API_PACKAGE [--name NAME]
       [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--support SUPPORT_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --python PYTHON_MERCHANT.json [--python-root SOURCE_DIR]
       [--name NAME] [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--support SUPPORT_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  init --dir NEW_DIRECTORY --duckdb-package PREPARED_DIRECTORY [--duckdb-python EXECUTABLE]
  init --dir NEW_DIRECTORY --s3-package CONFIGURED_DIRECTORY
  init --dir NEW_DIRECTORY --postgres-package PREPARED_DIRECTORY
  init --dir NEW_DIRECTORY --mysql-package PREPARED_DIRECTORY
  init --dir NEW_DIRECTORY --jsonrpc-package PREPARED_RPC_DIRECTORY [--allow-loopback-upstream]
  init --dir NEW_DIRECTORY --sqlite-package ORIGINAL_WORKBENCH_EXPORT
       [--name NAME] [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--support SUPPORT_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  serve --config MERCHANT_MCP.json [--port PORT] [--token-env ENVIRONMENT_NAME]
  inspect-support|inspect-client --url MCP_ENDPOINT --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-support --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST] [--cases-dir PRIVATE_CASES]
  download-client --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST]
  reopen-support --dir DOWNLOADED_DIRECTORY --cases-dir PRIVATE_CASES

Every init source form also accepts --accounting ACCOUNTING_JSON to attach the
original accounting workspaces and host-selected source aliases. See ACCOUNTING.md.

Supply the bearer token through MCP_ACCESS_TOKEN (or --token-env). It is never
stored in the merchant configuration or printed. MCP_CLIENT_ORIGINS is an
optional comma-separated allowlist. The listener binds only to 127.0.0.1.
Every ordinary init form also accepts --receiving RECEIVING_CONNECTION_JSON.
Open receiving work explicitly with merchant_receiving_open. RECEIVING.md
describes saved profiles, live reviews, captured replay and private exports.
Download resumes its original verified files on another invocation. Reopen uses
the original SF74 case store offline. See SUPPORT.md for private handoff recovery
and CLIENT_EXPORTS.md for original customer SDK inspection, adoption and delivery.
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
      instructions: 'Use merchant_sources, stage, inspect and compare to prepare a release. Activate with the current generation and exact digest. Start or restart explicitly. Use merchant_discovery_status and review before applying the returned reviewId to publish or withdraw offers; after an interrupted apply, inspect current discovery instead of replaying it. Cache invalidation requires the current owned instance and an explicit route or all:true. For a configured fleet, inspect merchant_fleet_plan and start with its digest; stage/review/prepare/activate uses the original exact candidate and revision. Keep draining sessions until fleet_status reports canRetire, then retire their exact child instance. Rollback uses a fresh retained-revision review; stop/restart uses this process-owned managerId. After a lost response inspect current status before another change. Only this MCP process can stop its owned runtimes. For support observation, inspect host profiles and the current configuration revision, start explicitly and retain the owned watcher instance. Recover notifications using their original event IDs and attempt counts. With a configured support connection, inspect source aliases or incidents, import exact original captures, and reopen the original case before changing owner terms. Case writes use its current revision; workorder and export use that exact saved revision. Inspect support export status after an interrupted reply. For receiving, inspect host source aliases, open the original saved workspace, and retain prepare/import/review IDs with exact source and plan digests. Read saved review status before retrying; replay uses the original capture. Close receiving to hand the same directory to its browser. Customer client export reads original metadata and retains its completion receipt. After a lost response, inspect merchant_client_export_status; legacy exports require explicit adoption of the inspected complete files digest. File delivery reads the original five payloads and receipt without running the seller or generated code. For accounting, list declared sources and explicitly open their original workspace. Review a recovery request before importing its retained preview, follow jobs and refresh the current revision, then capture and inspect the original report. File retrieval returns SHA-pinned chunks of the saved response or original report/archive; it never purchases again. Close the accounting workspace to release its original lease. Payment verification and settlement remain in the original seller and configured facilitator.' });
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
  if (command === 'init-receiving') {
    const options = pairs(rest, ['--dir', '--receiving', '--name']);
    if (!options.has('--dir') || !options.has('--receiving')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --receiving.');
    const result = await initializeReceivingMerchant({ directory: options.get('--dir'), receiving: options.get('--receiving'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'inspect-support' || command === 'inspect-client') {
    const options = pairs(rest, ['--url', '--export-id', '--token-env']);
    for (const key of ['--url', '--export-id']) if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const inspect = command === 'inspect-support' ? (await import('./support-download.mjs')).inspectSupportExport
      : (await import('./client-download.mjs')).inspectSellerClientDownload;
    const result = await inspect({ url: options.get('--url'), exportId: options.get('--export-id'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN' });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'download-support' || command === 'download-client' || command === 'reopen-support') {
    const { downloadSupportExport, reopenDownloadedSupportExport } = await import('./support-download.mjs');
    const customer = command === 'download-client';
    const download = customer ? (await import('./client-download.mjs')).downloadSellerClientExport : downloadSupportExport;
    if (command === 'reopen-support') {
      const options = pairs(rest, ['--dir', '--cases-dir']);
      if (!options.has('--dir') || !options.has('--cases-dir')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --cases-dir.');
      const result = await reopenDownloadedSupportExport({ directory: options.get('--dir'), casesDirectory: options.get('--cases-dir') });
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    }
    const options = pairs(rest, ['--url', '--export-id', '--out', '--token-env', '--chunk-bytes', '--manifest-sha256', ...(customer ? [] : ['--cases-dir'])]);
    for (const key of ['--url', '--export-id', '--out']) if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && !/^[1-9][0-9]{0,5}$/.test(rawChunk)) throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const controller = new AbortController();
    const stop = () => controller.abort(failure((customer ? 'CLIENT' : 'SUPPORT') + '_DOWNLOAD_INTERRUPTED', 'Download interrupted. Run the same command to continue its saved original files.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const result = await download({ url: options.get('--url'), exportId: options.get('--export-id'),
        directory: options.get('--out'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal,
        ...(options.has('--manifest-sha256') ? { expectedManifestSha256: options.get('--manifest-sha256') } : {}),
        ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }),
        onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n') });
      controller.signal.throwIfAborted();
      if (options.has('--cases-dir')) result.localCase = (await reopenDownloadedSupportExport({ directory: options.get('--out'), casesDirectory: options.get('--cases-dir') })).case;
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (command === 'init-accounting') {
    const options = pairs(rest, ['--dir', '--accounting', '--name']);
    if (!options.has('--dir') || !options.has('--accounting')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --accounting.');
    const result = await initializeAccountingMerchant({ directory: options.get('--dir'), accounting: options.get('--accounting'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init-fleet') {
    const options = pairs(rest, ['--dir', '--plan', '--fleet-directory', '--name', '--accounting']);
    if (!options.has('--dir') || !options.has('--plan')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --plan.');
    const result = await initializeFleetMerchant({ directory: options.get('--dir'), planFile: options.get('--plan'), accounting: options.get('--accounting'),
      ...(options.has('--fleet-directory') ? { fleetDirectory: options.get('--fleet-directory') } : {}),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init') {
    const options = pairs(rest, ['--dir', '--workspace', '--python', '--python-root', '--duckdb-package', '--duckdb-python', '--s3-package', '--postgres-package', '--mysql-package', '--jsonrpc-package', '--sqlite-package', '--sqlite-snapshot-max-bytes', '--sqlite-snapshot-timeout-ms', '--spec', '--selections', '--bindings', '--upstreams', '--name', '--seller-port', '--handlers', '--facilitator', '--catalog', '--fleet-plan', '--accounting', '--support', '--receiving'], ['--allow-local-facilitator', '--allow-loopback-upstream']);
    for (const key of options.has('--workspace') || options.has('--python') || options.has('--duckdb-package') || options.has('--s3-package') || options.has('--postgres-package') || options.has('--mysql-package') || options.has('--jsonrpc-package') || options.has('--sqlite-package') ? ['--dir'] : ['--dir', '--spec', '--selections', '--bindings'])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Missing ' + key);
    const runtime = { port: portNumber(options.get('--seller-port'), 0) };
    if (options.has('--handlers')) runtime.handlers = options.get('--handlers');
    if (options.has('--facilitator')) runtime.facilitator = options.get('--facilitator');
    if (options.has('--allow-local-facilitator')) runtime.allowLocalFacilitator = true;
    if (options.has('--allow-loopback-upstream')) runtime.allowLoopbackUpstream = true;
    const result = await initializeMerchant({ directory: options.get('--dir'), spec: options.get('--spec'),
      selections: options.get('--selections'), bindings: options.get('--bindings'),
      workspace: options.get('--workspace'), upstreams: options.get('--upstreams'), runtime, catalog: options.get('--catalog'), fleetPlan: options.get('--fleet-plan'), accounting: options.get('--accounting'), support: options.get('--support'), receiving: options.get('--receiving'),
      python: options.get('--python'), pythonRoot: options.get('--python-root'),
      duckdbPackage: options.get('--duckdb-package'), duckdbPython: options.get('--duckdb-python'),
      s3Package: options.get('--s3-package'), postgresPackage: options.get('--postgres-package'), mysqlPackage: options.get('--mysql-package'),
      jsonrpcPackage: options.get('--jsonrpc-package'),
      sqlitePackage: options.get('--sqlite-package'),
      sqliteSnapshotMaxBytes: options.has('--sqlite-snapshot-max-bytes') ? Number(options.get('--sqlite-snapshot-max-bytes')) : undefined,
      sqliteSnapshotTimeoutMs: options.has('--sqlite-snapshot-timeout-ms') ? Number(options.get('--sqlite-snapshot-timeout-ms')) : undefined,
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command !== 'serve') throw failure('CONFIGURATION_ERROR', 'Choose init, init-fleet, init-accounting, init-receiving, serve, inspect-support, inspect-client, download-support, download-client or reopen-support.');
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
