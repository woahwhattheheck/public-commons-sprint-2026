#!/usr/bin/env node
// MIT. Original authenticated MCP transport with the original merchant lifecycle.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpToolHandler } from '../mcp-paid-agent/http-tools.mjs';
import { loadOAuthResourceHost } from '../mcp-paid-agent/oauth-host.mjs';
import { openMerchantOperator } from './operator.mjs';
import { initializeMerchant, initializeFleetMerchant, initializeAccountingMerchant, initializeReceivingMerchant, initializePythonWorkspaceMerchant, initializePublisherMerchant, initializeS3WorkspaceMerchant, initializeOpenSearchWorkspaceMerchant, initializeSocrataWorkspaceMerchant, initializeGeocodioWorkspaceMerchant, initializeWebDavWorkspaceMerchant, initializeSheetsWorkspaceMerchant, initializeCkanWorkspaceMerchant, initializeTenderlyWorkspaceMerchant, initializeRedisWorkspaceMerchant, initializeUSASpendingWorkspaceMerchant, initializeSourceWorkspaceMerchant, initializePricingMerchant, initializeWooCommerceMerchant, initializeBuyerExpenseMerchant, failure } from './config.mjs';

const HELP = `Starforge merchant MCP

  init-buyer-expenses --dir NEW_DIRECTORY --connection PRIVATE_CONNECTION_JSON [--name NAME]
  expenses tools|call|inspect|download|receive ...    (see expenses --help)

  init-woocommerce --dir NEW_DIRECTORY --connection WOO_CONNECTION_JSON [--name NAME]
  init-pricing --dir NEW_DIRECTORY --pricing PRICING_CONNECTION_JSON [--release-store EXISTING_STORE] [--name NAME]
  init-accounting --dir NEW_DIRECTORY --accounting ACCOUNTING_JSON [--name NAME]
  init-fleet --dir NEW_DIRECTORY --plan ORIGINAL_FLEET_PLAN.json [--fleet-directory RETAINED_DIRECTORY] [--name NAME]
       [--accounting ACCOUNTING_JSON]
  init-receiving --dir NEW_DIRECTORY --receiving RECEIVING_CONNECTION_JSON [--name NAME]
  init-python-workspaces --dir NEW_DIRECTORY --python-workspaces CONNECTION_JSON [--name NAME]
  init-publishers --dir NEW_DIRECTORY --connection PUBLISHER_CONNECTION.json [--name NAME]
  init-s3-workspaces --dir NEW_DIRECTORY --connection S3_WORKSPACE_CONNECTION.json [--name NAME]
  init-opensearch-workspaces --dir NEW_DIRECTORY --connection OPENSEARCH_WORKSPACE_CONNECTION.json
       [--release-store ORIGINAL_SF82_STORE] [--name NAME]
  init-socrata-workspaces --dir NEW_DIRECTORY --connection SOCRATA_WORKSPACE_CONNECTION.json [--name NAME]
  init-geocodio-workspaces --dir NEW_DIRECTORY --connection GEOCODIO_WORKSPACE_CONNECTION.json [--name NAME]
  init-webdav-workspaces --dir NEW_DIRECTORY --connection WEBDAV_WORKSPACE_CONNECTION.json [--name NAME]
  init-sheets-workspaces --dir NEW_DIRECTORY --connection SHEETS_WORKSPACE_CONNECTION.json [--name NAME]
  init-ckan-workspaces --dir NEW_DIRECTORY --connection CKAN_WORKSPACE_CONNECTION.json [--workspace ALIAS] [--name NAME]
  init-tenderly-workspaces --dir NEW_DIRECTORY --connection TENDERLY_WORKSPACE_CONNECTION.json [--name NAME]
  init-redis-workspaces --dir NEW_DIRECTORY --connection REDIS_WORKSPACE_CONNECTION.json [--workspace ALIAS] [--name NAME]
  init-usaspending-workspaces --dir NEW_DIRECTORY --connection USASPENDING_WORKSPACE_CONNECTION.json [--name NAME]
  init-source-workspaces --dir NEW_DIRECTORY --connection SOURCE_WORKSPACE_CONNECTION.json [--name NAME]
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
  init --dir NEW_DIRECTORY --clickhouse-package PREPARED_CLICKHOUSE_DIRECTORY
  init --dir NEW_DIRECTORY --sqlite-package ORIGINAL_WORKBENCH_EXPORT
       [--name NAME] [--seller-port PORT] [--facilitator URL] [--allow-local-facilitator]
       [--catalog CATALOG_CONNECTION_JSON] [--support SUPPORT_CONNECTION_JSON] [--fleet-plan ORIGINAL_FLEET_PLAN.json]
  serve --config MERCHANT_MCP.json [--port PORT] [--token-env ENVIRONMENT_NAME | --oauth-config OAUTH_RESOURCE.json]
  pricing status|open|capture|source|preview|save|list|load|selection|apply|manifest|download|close ...
  maintenance open|close|status|job|prepare|execute|reconcile|download ...
  adjustments open|status|events|event|detail|job|preview|prepare|execute|reconcile|download|close ...
  statements open|close|status|bindings|order|statements|detail|lookup|usage-source|preview|prepare|execute|reconcile|download|export|status-snapshot ...
  platforms actions|sources|open|status|plan|read|preview|prepare|execute|reconcile|download|close ...
  inspect-support|inspect-client --url MCP_ENDPOINT --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-support --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST] [--cases-dir PRIVATE_CASES]
  download-client --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST]
  reopen-support --dir DOWNLOADED_DIRECTORY --cases-dir PRIVATE_CASES
  download-python --url MCP_ENDPOINT --workspace ALIAS --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--kind export|customer] [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES]
  reopen-python --dir DOWNLOADED_DIRECTORY --workspace-dir NEW_WORKSPACE
  inspect-s3 --url MCP_ENDPOINT --workspace ALIAS --release-id RELEASE_ID
       [--token-env ENVIRONMENT_NAME] [--release-digest REVIEWED_DIGEST]
  download-s3 --url MCP_ENDPOINT --workspace ALIAS --release-id RELEASE_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--release-digest REVIEWED_DIGEST]

Every init source form also accepts --accounting ACCOUNTING_JSON to attach the
original accounting workspaces and host-selected source aliases. See ACCOUNTING.md.
Ordinary init also accepts --pricing PRICING_CONNECTION_JSON and --release-store
EXISTING_STORE. init-pricing uses the sole common store declared by its pricing
aliases; select --release-store explicitly for multiple or no staging stores.
PRICING.md describes original captures, reviewed atomic prices and retained exports.
Ordinary init also accepts --woocommerce WOO_CONNECTION_JSON. init-woocommerce
connects existing Woo stores directly. WOO_COMMERCE.md describes native order
review, selected-order completion, verified refunds and original-file delivery.

Use --oauth-config ABSOLUTE_OAUTH_RESOURCE.json (or MCP_OAUTH_CONFIG) for incoming\nOAuth with explicit issuer subjects; clear the fixed token setting in this mode.\nThe original mcp-paid-agent/OAUTH_RESOURCE.md guide covers provider setup and clients.\nSupply the bearer token through MCP_ACCESS_TOKEN (or --token-env). It is never
stored in the merchant configuration or printed. MCP_CLIENT_ORIGINS is an
optional comma-separated allowlist. The listener binds only to 127.0.0.1.
BUYER_EXPENSES.md covers original buyer ledger capture, exact allocations, named
review/close/reopen, transactional request recovery, customer SDK and receiving.
An existing merchant can attach --buyer-expenses PRIVATE_CONNECTION_JSON.
Every ordinary init form also accepts --receiving RECEIVING_CONNECTION_JSON
and --python-workspaces CONNECTION_JSON. Attach original XML/NDJSON consoles with
--source-workspaces CONNECTION_JSON; SOURCE_WORKSPACES.md covers shared browser/agent
operations and complete resumable exports. Attach CKAN with --ckan-workspaces CONNECTION_JSON
and --release-store pointing to that CKAN project's existing seller-releases.
The CKAN MCP_WORKFLOW.md guide covers source authoring, native release and customer handover.
Add --facilitators PROVIDERS_JSON for
reviewed provider changes from a retained release; see the SF82 FACILITATORS.md guide.
PYTHON_WORKSPACES.md explains original
saved application editing, native preview/release and complete client handoff.
S3_WORKSPACE.md covers original S3 object authoring, reviewed source pins,
native merchant activation and exact original customer file delivery.
OPENSEARCH_WORKSPACE.md covers native query authoring, relevance judgments,
original captures, customer reports and prepared merchant delivery.
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
export async function startMerchantMcp({ configPath, port = 3211, tokenEnv = 'MCP_ACCESS_TOKEN',
  environment = process.env, woocommerceFetchImpl, oauthConfigPath, oauthFetchImpl, accounting } = {}) {
  if (!configPath || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw failure('CONFIGURATION_ERROR', 'Supply a merchant configuration and token environment-variable name.');
  port = portNumber(port, 3211);
  const operator = await openMerchantOperator(configPath,
    { woocommerce: { environment, fetchImpl: woocommerceFetchImpl }, opensearch: { environment }, accounting: { ...accounting, environment } });
  let server, access;
  try {
    access = await loadOAuthResourceHost({configPath:oauthConfigPath ?? environment.MCP_OAUTH_CONFIG,
      bearerToken:environment[tokenEnv],fetchImpl:oauthFetchImpl});
    const handler = createMcpToolHandler(operator, { ...access.transportOptions, maxRequestBytes: operator.maxRequestBytes,
      allowedClientOrigins: String(environment.MCP_CLIENT_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
      serverName: 'starforge-merchant-operator', serverVersion: '0.1.0',
      instructions: 'For buyer expenses, open only a declared workspace and ledger alias. Inspect the current original revision and retain an exact requestId/payload before each change. Recover merchant_buyer_expense_request after an interrupted reply before retrying that same request. Capture and accept original statement editions, supply exact allocations and explicit outstanding dispositions, then use current period review before close. Reopen preserves issued editions. Export a project at its reviewed revision and use the existing manifest-pinned download and trusted receive commands. For Woo stores, inspect merchant_woo_stores and merchant_woo_store_status, select an actual order from merchant_woo_queue, then read its current original order. Inspect a host-declared native receipt, retain its recordSha256 and a stable reviewId, then review or resume that same native source. Release only with the exact review SHA256 and selected confirmOrder; after interruption use live review_status before another explicit release. For refunds, inspect the original accounting export and current Woo refund snapshot, then prepare the selected verified adjustment UUID with its exact export hash, explicit Woo amount and currency. Apply only the saved prepared review hash with the selected confirmOrder. Refund recovery reads the same original order without a POST; REFUND_SAVED_JOURNAL_PENDING requires explicit same-ID apply to reconcile its existing native child. Preserve all original operation IDs, and use export/status plus SHA-pinned file chunks for complete handoff. Full Woo refund status can affect download access. For a retained facilitator change, use merchant_facilitators and merchant_facilitator_review, inspect every generated native payment alternative, then stage the exact reviewId. Its complete review remains in merchant_inspect/compare and must match at native startup. After a lost stage reply inspect the proposed release ID. Use merchant_sources, stage, inspect and compare to prepare a release. Activate with the current generation and exact digest. Start or restart explicitly. Use merchant_discovery_status and review before applying the returned reviewId to publish or withdraw offers; after an interrupted apply, inspect current discovery instead of replaying it. Cache invalidation requires the current owned instance and an explicit route or all:true. For a configured fleet, inspect merchant_fleet_plan and start with its digest; stage/review/prepare/activate uses the original exact candidate and revision. Keep draining sessions until fleet_status reports canRetire, then retire their exact child instance. Rollback uses a fresh retained-revision review; stop/restart uses this process-owned managerId. After a lost response inspect current status before another change. Only this MCP process can stop its owned runtimes. For support observation, inspect host profiles and the current configuration revision, start explicitly and retain the owned watcher instance. Recover notifications using their original event IDs and attempt counts. With a configured support connection, inspect source aliases or incidents, import exact original captures, and reopen the original case before changing owner terms. Case writes use its current revision; workorder and export use that exact saved revision. Inspect support export status after an interrupted reply. For Tenderly merchants, list declared workspace aliases and open their original browser/model. Review and save a profile, open it, issue the exact request with the original id, subject and expiry in Unix milliseconds, then start its seller explicitly. Browser and MCP share the original profile, operation generation and provider observations. Read a saved simulation with provider_lookup; default reopens retained observations and refresh explicitly reads the provider again. Review a MATCHED observation before provider_recover. Keep the original lookup ID, observation ID and expected generation after a lost response. Merchant and provider responses use exact file-read selection, SHA256 and resumable chunks. Stop the merchant before selecting another profile; close drains only this owned instance. For Sheets authoring, list host-declared workspaces and explicitly open the original source model and its borrowed browser. Browser and agent edits share the same original draft revision, capture and source-version IDs. Inspect declared input hashes or choose an existing Google connection and exact tab/range. Save the explicit projection, preview the same draft revision, then review and save its source version against the current selection. Retain the original request UUID and inspect/resume that same operation after an uncertain reply; never repeat an uncertain Google read under a fresh ID. Open the original publisher explicitly. Only currentPublisher reports its live URL; a historical receipt may contain an expired URL. Private source packets use their original version, verified SHA256 and retained chunk-read identity. Closing drains this owned browser/model/publisher and releases its native lease; reopen the same directory through its alias and reconcile original receipts. For CKAN authoring, list host-declared workspaces and open the original saved project. Read its current operation before every mutation and pass that exact expectedOperationId. Capture, source review, publication, export and staging return the original operation ID immediately; inspect its saved completion before continuing. After a lost reply read the same native state. Stage into the project store bound to this operator, then use the original merchant inspect, compare, activate and start tools. Customer downloads retain the original file hash and byte offset. Close the owned model to release its original lease. For Python authoring, list declared aliases and explicitly open the original saved model. Read revision/declaration/source before editing with the expected head. Retain preview operationId and inspect the same original job after an interrupted reply. Stage a saved revision, review its native digest and current generation, and explicitly activate/start/restart. Only this model handle can cancel its previews or stop its managed seller. Customer exports reuse original saved files; portable exports retain source, native release history and clients. Resume chunk downloads with the same file SHA256 and offset. For receiving, inspect host source aliases, open the original saved workspace, and retain prepare/import/review IDs with exact source and plan digests. Read saved review status before retrying; replay uses the original capture. Close receiving to hand the same directory to its browser. Customer client export reads original metadata and retains its completion receipt. After a lost response, inspect merchant_client_export_status; legacy exports require explicit adoption of the inspected complete files digest. File delivery reads the original five payloads and receipt without running the seller or generated code. For accounting, list declared sources and explicitly open their original workspace. Review a recovery request before importing its retained preview, follow jobs and refresh the current revision, then capture and inspect the original report. File retrieval returns SHA-pinned chunks of the saved response or original report/archive; it never purchases again. Close the accounting workspace to release its original lease. For a publisher connection, list merchant_publishers and explicitly open its declared workspace; saved enabled refreshes resume. Inspect native source, plan, candidate and target before review/publication. Use original run UUIDs, review IDs and schedule revisions; reopen buyer files by the recorded handoff UUID. Close only the exact owned publisher instance. For pricing, inspect declared aliases and open the original SF97 model. Capture seller and native observations through merchant_pricing_source; use captureSha256 to page the same source. Save merchant pricing reviews with the current original revision and a stable requestId. Repricing starts from a saved version and complete ordered options: preview explicit atomic edits, retain its exact reviewSha256, and save with the current price-decision revision. Inspect the saved manifest after an interrupted reply. Stage a retained original API package by its decision and review hash, then use the original release digest/generation controls for activation and startup. Each alias reports whether its staging store is this operator release store. Download original files through SHA-pinned chunks. For OpenSearch, inspect merchant_opensearch_status and open only a host-declared workspace. Read the original draft or relevance-set revision before saving or judging, and retain its original requestId. Capture, preparation and native relevance evaluation use that same operation journal. After an interrupted response inspect merchant_opensearch_operation with the original request ID. Read the saved edition, compare actual query scope and judgments, then promote the selected evaluated variant into an original merchant draft for preparation. Full native results, reports, CSV and customer files use original SHA-pinned retained reads; resume with the same readId, file hash and byte offset. Close releases this process-owned workspace and temporary reads. Payment verification and settlement remain in the original seller and configured facilitator.' });
    server = createServer(access.wrap(handler));
    server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
    });
  } catch (error) {
    server?.close();
    try { await operator.close(); } finally { await access?.close(); }
    throw error;
  }
  let closing;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const stopped = new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      // Finish an accepted change before draining the owned original seller.
      // New calls now receive OPERATOR_CLOSING, and new sockets are refused.
      try { await access.close(); }
      finally {
        try { await operator.close(); }
        finally { server.closeAllConnections(); await stopped; }
      }
    })();
    return closing;
  };
  return { operator, server, url: 'http://127.0.0.1:' + server.address().port, maxRequestBytes: operator.maxRequestBytes, authorization:access.describe(), close };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args;
  if (command === 'pricing') return (await import('./pricing-cli.mjs')).main(rest);
  if (command === 'expenses') return (await import('./buyer-expense-cli.mjs')).main(rest);
  if (command === 'maintenance') return (await import('./accounting-maintenance-cli.mjs')).main(rest);
  if (command === 'adjustments') return (await import('./accounting-adjustment-cli.mjs')).main(rest);
  if (command === 'statements') return (await import('./accounting-statement-cli.mjs')).main(rest);
  if (command === 'platforms') return (await import('./accounting-platform-cli.mjs')).main(rest);
  if (command === 'download-s3' || command === 'inspect-s3') {
    const { downloadS3Customer, inspectS3Customer } = await import('./s3-workspace-download.mjs');
    const download = command === 'download-s3';
    const options = pairs(rest, ['--url', '--workspace', '--release-id', '--token-env', '--release-digest',
      ...(download ? ['--out', '--chunk-bytes'] : [])]);
    for (const key of ['--url', '--workspace', '--release-id', ...(download ? ['--out'] : [])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && (!/^[1-9][0-9]{0,4}$/.test(rawChunk) || Number(rawChunk) > 65536))
      throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 65536.');
    const controller = new AbortController();
    const stop = () => controller.abort(failure('S3_DOWNLOAD_INTERRUPTED',
      'Download interrupted. Run the same command to retain completed files and finish the customer inputs.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const args = { url: options.get('--url'), workspace: options.get('--workspace'), releaseId: options.get('--release-id'),
        tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal,
        ...(options.has('--release-digest') ? { expectedReleaseDigest: options.get('--release-digest') } : {}) };
      const result = download ? await downloadS3Customer({ ...args, directory: options.get('--out'),
        ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }),
        onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n') }) : await inspectS3Customer(args);
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (command === 'init-source-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeSourceWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-usaspending-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeUSASpendingWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-redis-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--workspace', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeRedisWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      workspace: options.get('--workspace'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-tenderly-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeTenderlyWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-ckan-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--workspace', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeCkanWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      workspace: options.get('--workspace'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-sheets-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeSheetsWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-woocommerce') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeWooCommerceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-geocodio-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeGeocodioWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-socrata-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeSocrataWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-opensearch-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--release-store', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeOpenSearchWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      releaseStore: options.get('--release-store'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-webdav-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeWebDavWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-s3-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeS3WorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'download-python' || command === 'reopen-python') {
    const { downloadPythonWorkspace, reopenDownloadedPythonWorkspace } = await import('./python-workspace-download.mjs');
    if (command === 'reopen-python') {
      const options = pairs(rest, ['--dir', '--workspace-dir']);
      if (!options.has('--dir') || !options.has('--workspace-dir')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --workspace-dir.');
      const result = await reopenDownloadedPythonWorkspace({ directory: options.get('--dir'), workspaceDirectory: options.get('--workspace-dir') });
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    }
    const options = pairs(rest, ['--url', '--workspace', '--export-id', '--out', '--kind', '--token-env', '--chunk-bytes']);
    for (const key of ['--url', '--workspace', '--export-id', '--out']) if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && !/^[1-9][0-9]{0,5}$/.test(rawChunk)) throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const controller = new AbortController();
    const stop = () => controller.abort(failure('PYTHON_DOWNLOAD_INTERRUPTED', 'Download interrupted. Run the same command to resume its original bytes.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const result = await downloadPythonWorkspace({ url: options.get('--url'), workspace: options.get('--workspace'), id: options.get('--export-id'), directory: options.get('--out'), kind: options.get('--kind') ?? 'export', tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal, ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }), onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n') });
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (command === 'init-python-workspaces') {
    const options = pairs(rest, ['--dir', '--python-workspaces', '--name']);
    if (!options.has('--dir') || !options.has('--python-workspaces')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --python-workspaces.');
    const result = await initializePythonWorkspaceMerchant({ directory: options.get('--dir'), pythonWorkspaces: options.get('--python-workspaces'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
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
  if (command === 'init-publishers') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializePublisherMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init-pricing') {
    const options = pairs(rest, ['--dir', '--pricing', '--release-store', '--name']);
    if (!options.has('--dir') || !options.has('--pricing')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --pricing.');
    const result = await initializePricingMerchant({ directory: options.get('--dir'), pricing: options.get('--pricing'),
      releaseStore: options.get('--release-store'), ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init-buyer-expenses') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeBuyerExpenseMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
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
    const options = pairs(rest, ['--dir', '--workspace', '--python', '--python-root', '--duckdb-package', '--duckdb-python', '--s3-package', '--postgres-package', '--mysql-package', '--clickhouse-package', '--jsonrpc-package', '--sqlite-package', '--sqlite-snapshot-max-bytes', '--sqlite-snapshot-timeout-ms', '--spec', '--selections', '--bindings', '--upstreams', '--name', '--seller-port', '--handlers', '--facilitator', '--catalog', '--facilitators', '--fleet-plan', '--accounting', '--support', '--receiving', '--python-workspaces', '--source-workspaces', '--ckan-workspaces', '--pricing', '--woocommerce', '--buyer-expenses', '--release-store'], ['--allow-local-facilitator', '--allow-loopback-upstream']);
    for (const key of options.has('--workspace') || options.has('--python') || options.has('--duckdb-package') || options.has('--s3-package') || options.has('--postgres-package') || options.has('--mysql-package') || options.has('--jsonrpc-package') || options.has('--sqlite-package') || options.has('--clickhouse-package') ? ['--dir'] : ['--dir', '--spec', '--selections', '--bindings'])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Missing ' + key);
    const runtime = { port: portNumber(options.get('--seller-port'), 0) };
    if (options.has('--handlers')) runtime.handlers = options.get('--handlers');
    if (options.has('--facilitator')) runtime.facilitator = options.get('--facilitator');
    if (options.has('--allow-local-facilitator')) runtime.allowLocalFacilitator = true;
    if (options.has('--allow-loopback-upstream')) runtime.allowLoopbackUpstream = true;
    const result = await initializeMerchant({ directory: options.get('--dir'), spec: options.get('--spec'),
      selections: options.get('--selections'), bindings: options.get('--bindings'),
      workspace: options.get('--workspace'), upstreams: options.get('--upstreams'), runtime, catalog: options.get('--catalog'), facilitators: options.get('--facilitators'), fleetPlan: options.get('--fleet-plan'), accounting: options.get('--accounting'), support: options.get('--support'), receiving: options.get('--receiving'), pythonWorkspaces: options.get('--python-workspaces'), sourceWorkspaces: options.get('--source-workspaces'), ckanWorkspaces: options.get('--ckan-workspaces'), pricing: options.get('--pricing'), woocommerce: options.get('--woocommerce'), buyerExpenses: options.get('--buyer-expenses'), releaseStore: options.get('--release-store'),
      python: options.get('--python'), pythonRoot: options.get('--python-root'),
      duckdbPackage: options.get('--duckdb-package'), duckdbPython: options.get('--duckdb-python'),
      s3Package: options.get('--s3-package'), postgresPackage: options.get('--postgres-package'), mysqlPackage: options.get('--mysql-package'),
      jsonrpcPackage: options.get('--jsonrpc-package'),
      clickhousePackage: options.get('--clickhouse-package'),
      sqlitePackage: options.get('--sqlite-package'),
      sqliteSnapshotMaxBytes: options.has('--sqlite-snapshot-max-bytes') ? Number(options.get('--sqlite-snapshot-max-bytes')) : undefined,
      sqliteSnapshotTimeoutMs: options.has('--sqlite-snapshot-timeout-ms') ? Number(options.get('--sqlite-snapshot-timeout-ms')) : undefined,
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command !== 'serve') throw failure('CONFIGURATION_ERROR', 'Choose init, init-buyer-expenses, expenses, init-woocommerce, init-fleet, init-pricing, init-accounting, init-receiving, init-python-workspaces, init-sheets-workspaces, init-ckan-workspaces, init-tenderly-workspaces, init-redis-workspaces, init-usaspending-workspaces, init-source-workspaces, init-s3-workspaces, init-opensearch-workspaces, init-publishers, serve, maintenance, adjustments, platforms, statements, inspect-support, inspect-client, inspect-s3, download-support, download-client, download-s3, reopen-support, download-python or reopen-python.');
  const options = pairs(rest, ['--config', '--port', '--token-env', '--oauth-config']);
  if (!options.has('--config')) throw failure('CONFIGURATION_ERROR', 'Supply --config.');
  const session = await startMerchantMcp({ configPath: options.get('--config'), port: portNumber(options.get('--port'), 3211),
    tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', oauthConfigPath:options.get('--oauth-config') });
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
