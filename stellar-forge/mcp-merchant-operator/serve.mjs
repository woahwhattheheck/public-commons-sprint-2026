#!/usr/bin/env node
import { merchantInstructions } from './instructions.mjs';
// MIT. Original authenticated MCP transport with the original merchant lifecycle.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpToolHandler } from '../mcp-paid-agent/http-tools.mjs';
import { loadOAuthResourceHost } from '../mcp-paid-agent/oauth-host.mjs';
import { openMerchantOperator } from './operator.mjs';
import { initializeStellarExpertWorkspaceMerchant, initializeMerchant, initializeFleetMerchant, initializeAccountingMerchant, initializeReceivingMerchant, initializePythonWorkspaceMerchant, initializeGraphqlWorkspaceMerchant, initializePublisherMerchant, initializeArcgisWorkspaceMerchant, initializeS3WorkspaceMerchant, initializeOpenSearchWorkspaceMerchant, initializeSocrataWorkspaceMerchant, initializeODataWorkspaceMerchant, initializeFiscalDataWorkspaceMerchant, initializeGeocodioWorkspaceMerchant, initializeCensusGeocoderWorkspaceMerchant, initializeWorldBankWorkspaceMerchant, initializeWebDavWorkspaceMerchant, initializeEdgarWorkspaceMerchant, initializeSheetsWorkspaceMerchant, initializeNocoDBWorkspaceMerchant, initializeCkanWorkspaceMerchant, initializeTenderlyWorkspaceMerchant, initializeOpenCageWorkspaceMerchant, initializeCoinGeckoWorkspaceMerchant, initializeRedisWorkspaceMerchant, initializeUSASpendingWorkspaceMerchant, initializeResearchWorkspaceMerchant, initializeGrantsWorkspaceMerchant, initializeSourceWorkspaceMerchant, initializeBaserowWorkspaceMerchant, initializeUSGSWorkspaceMerchant, initializeFeedsWorkspaceMerchant, initializeGrpcWorkspaceMerchant, initializeOpenApiWorkspaceMerchant, initializeHarWorkspaceMerchant, initializePricingMerchant, initializeWooCommerceMerchant, initializeCocartWorkspaceMerchant, initializeMppMerchant, initializeBuyerExpenseMerchant, failure } from './config.mjs';

const HELP = `Starforge merchant MCP

  init-buyer-expenses --dir NEW_DIRECTORY --connection PRIVATE_CONNECTION_JSON [--name NAME]
  expenses tools|call|inspect|download|receive ...    (see expenses --help)

  init-mpp --dir NEW_DIRECTORY --connection MPP_CONNECTION_JSON [--name NAME]
  inspect-mpp --url MCP_URL --export-id ID [--token-env ENV]
  download-mpp --url MCP_URL --export-id ID --out PRIVATE_DIRECTORY
       [--token-env ENV] [--chunk-bytes BYTES] [--manifest-sha256 SHA256]
  init-woocommerce --dir NEW_DIRECTORY --connection WOO_CONNECTION_JSON [--name NAME]
  init-cocart-workspaces --dir NEW_DIRECTORY --connection COCART_CONNECTION_JSON [--name NAME]
  inspect-cocart --url MCP_URL --workspace ALIAS --export-id ID [--token-env ENV]
  download-cocart --url MCP_URL --workspace ALIAS --export-id ID --out PRIVATE_DIRECTORY
       [--token-env ENV] [--chunk-bytes BYTES] [--manifest-sha256 SHA256]
  reopen-cocart --workspace ALIAS --export-id ID --input COMPLETE_DOWNLOAD --root CUSTOMER_WORKSPACE
       [--manifest-sha256 SHA256]
  init-pricing --dir NEW_DIRECTORY --pricing PRICING_CONNECTION_JSON [--release-store EXISTING_STORE] [--name NAME]
  init-accounting --dir NEW_DIRECTORY --accounting ACCOUNTING_JSON [--name NAME]
  init-fleet --dir NEW_DIRECTORY --plan ORIGINAL_FLEET_PLAN.json [--fleet-directory RETAINED_DIRECTORY] [--name NAME]
       [--accounting ACCOUNTING_JSON]
  init-receiving --dir NEW_DIRECTORY --receiving RECEIVING_CONNECTION_JSON [--name NAME]
  init-python-workspaces --dir NEW_DIRECTORY --python-workspaces CONNECTION_JSON [--name NAME]
  init-graphql-workspaces --dir NEW_DIRECTORY --connection GRAPHQL_WORKSPACE_CONNECTION.json [--name NAME]
  init-publishers --dir NEW_DIRECTORY --connection PUBLISHER_CONNECTION.json [--name NAME]
       [--arcgis-workspaces ARCGIS_CONNECTION.json] [--release-store EXISTING_STORE]
  init-arcgis-workspaces --dir NEW_DIRECTORY --publishers PUBLISHER_CONNECTION.json
       --connection ARCGIS_CONNECTION.json [--release-store EXISTING_STORE] [--name NAME]
  init-s3-workspaces --dir NEW_DIRECTORY --connection S3_WORKSPACE_CONNECTION.json [--name NAME]
  init-worldbank-workspaces --dir NEW_DIRECTORY --connection WORLDBANK_WORKSPACE_CONNECTION.json [--name NAME]
  inspect-worldbank --url MCP_ENDPOINT --workspace ALIAS --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-worldbank --url MCP_ENDPOINT --workspace ALIAS --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 SHA256]
  init-opensearch-workspaces --dir NEW_DIRECTORY --connection OPENSEARCH_WORKSPACE_CONNECTION.json
       [--release-store ORIGINAL_SF82_STORE] [--name NAME]
  init-socrata-workspaces --dir NEW_DIRECTORY --connection SOCRATA_WORKSPACE_CONNECTION.json [--name NAME]
  init-odata-workspaces --dir NEW_DIRECTORY --connection ODATA_WORKSPACE_CONNECTION.json [--name NAME]
  init-fiscaldata-workspaces --dir NEW_DIRECTORY --connection FISCALDATA_WORKSPACE_CONNECTION.json [--name NAME]
  init-geocodio-workspaces --dir NEW_DIRECTORY --connection GEOCODIO_WORKSPACE_CONNECTION.json [--name NAME]
  init-census-geocoder-workspaces --dir NEW_DIRECTORY --connection CENSUS_GEOCODER_CONNECTION.json [--name NAME]
  init-webdav-workspaces --dir NEW_DIRECTORY --connection WEBDAV_WORKSPACE_CONNECTION.json [--name NAME]
  init-edgar-workspaces --dir NEW_DIRECTORY --connection EDGAR_WORKSPACE_CONNECTION.json [--name NAME]
  init-sheets-workspaces --dir NEW_DIRECTORY --connection SHEETS_WORKSPACE_CONNECTION.json [--name NAME]
  init-nocodb-workspaces --dir NEW_DIRECTORY --connection NOCODB_WORKSPACE_CONNECTION.json [--name NAME]
  init-ckan-workspaces --dir NEW_DIRECTORY --connection CKAN_WORKSPACE_CONNECTION.json [--workspace ALIAS] [--name NAME]
  init-stellar-expert-workspaces --dir NEW_DIRECTORY --connection STELLAR_EXPERT_CONNECTION.json [--name NAME]
  init-coingecko-workspaces --dir NEW_DIRECTORY --connection COINGECKO_WORKSPACE_CONNECTION.json [--name NAME]
  init-tenderly-workspaces --dir NEW_DIRECTORY --connection TENDERLY_WORKSPACE_CONNECTION.json [--name NAME]
  init-opencage-workspaces --dir NEW_DIRECTORY --connection OPENCAGE_WORKSPACE_CONNECTION.json [--name NAME]
  init-redis-workspaces --dir NEW_DIRECTORY --connection REDIS_WORKSPACE_CONNECTION.json [--workspace ALIAS] [--name NAME]
  init-usaspending-workspaces --dir NEW_DIRECTORY --connection USASPENDING_WORKSPACE_CONNECTION.json [--name NAME]
  init-research-workspaces --dir NEW_DIRECTORY --connection RESEARCH_WORKSPACE_CONNECTION.json [--name NAME]
  init-grants-workspaces --dir NEW_DIRECTORY --connection GRANTS_WORKSPACE_CONNECTION.json [--name NAME]
  grants-download inspect|download|receive ...       (see grants-download --help)
  init-feeds-workspaces --dir NEW_DIRECTORY --connection FEEDS_WORKSPACE_CONNECTION.json [--name NAME]
  download-feeds --url MCP_ENDPOINT --workspace ALIAS --export-id ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 SHA256]
  inspect-feeds --url MCP_ENDPOINT --workspace ALIAS --export-id ID [--token-env ENVIRONMENT_NAME]
  init-source-workspaces --dir NEW_DIRECTORY --connection SOURCE_WORKSPACE_CONNECTION.json [--name NAME]
  init-baserow-workspaces --dir NEW_DIRECTORY --connection BASEROW_CONNECTION.json [--name NAME]
  inspect-baserow|download-baserow|reopen-baserow|receive-baserow ... (see BASEROW_WORKSPACE.md)
  init-usgs-workspaces --dir NEW_DIRECTORY --connection USGS_WORKSPACE_CONNECTION.json [--name NAME]
  usgs tools|call|inspect|download|receive|serve ...    (see usgs --help)
  init-grpc-workspaces --dir NEW_DIRECTORY --connection GRPC_WORKSPACE_CONNECTION.json [--name NAME]
  inspect-grpc --url MCP_ENDPOINT --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-grpc --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST]
  init-openapi-workspaces --dir NEW_DIRECTORY --connection SF61_CONNECTION.json [--release-store EXISTING_STORE] [--name NAME]
  download-openapi --url MCP_URL --workspace ALIAS --export-id SHA256 --out DIRECTORY [--token-env ENV] [--manifest-sha256 SHA256] [--chunk-bytes 196608]
  inspect-openapi --url MCP_URL --workspace ALIAS --export-id SHA256 [--token-env ENV]
  reopen-openapi --dir DOWNLOADED_DIRECTORY [--manifest-sha256 SHA256]
  init-har-workspaces --dir NEW_DIRECTORY --connection HAR_WORKSPACE_CONNECTION.json [--name NAME]
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
  init --dir NEW_DIRECTORY --dataset-package PREPARED_SF82_DATASET_DIRECTORY
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
  inspect-har --url MCP_ENDPOINT --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-har --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST]
  inspect-graphql --url MCP_ENDPOINT --export-id EXPORT_ID [--token-env ENVIRONMENT_NAME]
  download-graphql --url MCP_ENDPOINT --export-id EXPORT_ID --out PRIVATE_DIRECTORY
       [--token-env ENVIRONMENT_NAME] [--chunk-bytes BYTES] [--manifest-sha256 REVIEWED_DIGEST]
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
Ordinary init also accepts --mpp MPP_CONNECTION_JSON. MPP.md describes original
customer receiving, exact review, native payment jobs and resumable file delivery.
Ordinary init also accepts --woocommerce WOO_CONNECTION_JSON. init-woocommerce
connects existing Woo stores directly. WOO_COMMERCE.md describes native order
review, selected-order completion, verified refunds and original-file delivery.

ArcGIS connects an existing publisher alias and its source editions through
init-arcgis-workspaces. Supply --release-store to retain the existing workbench's
original merchant releases; omitting it creates this operator's native store.
ARCGIS_WORKSPACE.md covers host input profiles, shared browser/agent operations,
complete source publication, original release controls and resumable receiving.
Use --oauth-config ABSOLUTE_OAUTH_RESOURCE.json (or MCP_OAUTH_CONFIG) for incoming\nOAuth with explicit issuer subjects; clear the fixed token setting in this mode.\nThe original mcp-paid-agent/OAUTH_RESOURCE.md guide covers provider setup and clients.\nSupply the bearer token through MCP_ACCESS_TOKEN (or --token-env). It is never
stored in the merchant configuration or printed. MCP_CLIENT_ORIGINS is an
optional comma-separated allowlist. The listener binds only to 127.0.0.1.
BUYER_EXPENSES.md covers original buyer ledger capture, exact allocations, named
review/close/reopen, transactional request recovery, customer SDK and receiving.
An existing merchant can attach --buyer-expenses PRIVATE_CONNECTION_JSON.
Every ordinary init form also accepts --receiving RECEIVING_CONNECTION_JSON
and --python-workspaces CONNECTION_JSON. Add --graphql-workspaces CONNECTION_JSON
for the original saved GraphQL authoring, retained preview, merchant/revision,
deployment and host workflow. GRAPHQL_WORKSPACES.md covers browser handover,
native release ownership and resumable original files. Attach original XML/NDJSON
Stellar asset sessions with --stellar-expert-workspaces CONNECTION_JSON; see STELLAR_EXPERT.md.
Connect other source consoles with --source-workspaces CONNECTION_JSON; --usgs-workspaces CONNECTION_JSON attaches original Water projects.
USGS_WORKSPACE.md covers source review, native DSS and complete receiving. SOURCE_WORKSPACES.md covers
shared browser/agent operations and complete resumable exports.
--grpc-workspaces CONNECTION_JSON attaches the original gRPC operator; GRPC_WORKSPACE.md
covers captured services, exact requests, retained calls, native release and complete SDK receiving. Attach original HAR consoles with
--har-workspaces CONNECTION_JSON; HAR_WORKSPACE.md covers source review, capture editions,
exact merchant packages, complete receiving adoption and resumable native files.
Attach original RSS/Atom/OPML collections with --feeds-workspaces CONNECTION_JSON;
FEEDS_WORKSPACE.md covers original capture/review, publisher/customer control and
complete resumable receiving through the managed source binding.
Attach CKAN with --ckan-workspaces CONNECTION_JSON
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
  environment = process.env, stellarExpertFetchImpl, woocommerceFetchImpl, mppFetchImpl, oauthConfigPath, oauthFetchImpl, accounting } = {}) {
  if (!configPath || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw failure('CONFIGURATION_ERROR', 'Supply a merchant configuration and token environment-variable name.');
  port = portNumber(port, 3211);
  const operator = await openMerchantOperator(configPath,
    { stellarExpert: { environment, fetchImpl: stellarExpertFetchImpl }, woocommerce: { environment, fetchImpl: woocommerceFetchImpl }, mpp: { environment, fetchImpl: mppFetchImpl }, opensearch: { environment }, opencage: { env: environment }, grpc: { environment }, openapi: { environment }, arcgis: { environment }, accounting: { ...accounting, environment } });
  let server, access;
  try {
    access = await loadOAuthResourceHost({configPath:oauthConfigPath ?? environment.MCP_OAUTH_CONFIG,
      bearerToken:environment[tokenEnv],fetchImpl:oauthFetchImpl});
    const handler = createMcpToolHandler(operator, { ...access.transportOptions, maxRequestBytes: operator.maxRequestBytes,
      allowedClientOrigins: String(environment.MCP_CLIENT_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
      serverName: 'starforge-merchant-operator', serverVersion: '0.1.0',
      instructions: merchantInstructions(operator.tools) });
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
    const disposing = (async () => {
      const stopped = new Promise((done, reject) => server.close(error =>
        error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done()));
      // Finish an accepted change before draining the owned original seller.
      // New calls now receive OPERATOR_CLOSING, and new sockets are refused.
      try { await access.close(); }
      finally {
        try { await operator.close(); }
        finally { server.closeAllConnections(); await stopped; }
      }
    })();
    closing = disposing;
    void disposing.catch(() => { if (closing === disposing) closing = null; });
    return disposing;
  };
  return { operator, server, url: 'http://127.0.0.1:' + server.address().port, maxRequestBytes: operator.maxRequestBytes, authorization:access.describe(), close };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = args;
  if (['inspect-baserow','download-baserow','reopen-baserow','receive-baserow'].includes(command))
    return (await import('./baserow-workspace-download.mjs')).main([command.replace('-baserow',''), ...rest]);
  if (command === 'pricing') return (await import('./pricing-cli.mjs')).main(rest);
  if (command === 'expenses') return (await import('./buyer-expense-cli.mjs')).main(rest);
  if (command === 'usgs') return (await import('./usgs-workspace-download.mjs')).main(rest);
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
  if (command === 'init-har-workspaces') {
    const options=pairs(rest,['--dir','--connection','--name']);
    if(!options.has('--dir')||!options.has('--connection'))throw failure('CONFIGURATION_ERROR','Supply --dir and --connection.');
    const result=await initializeHarWorkspaceMerchant({directory:options.get('--dir'),connection:options.get('--connection'),name:options.get('--name')});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  if(command==='inspect-har'||command==='download-har'){
    const {inspectHarExport,downloadHarExport}=await import('./har-download.mjs');
    const download=command==='download-har';
    const options=pairs(rest,['--url','--export-id','--token-env',...(download?['--out','--chunk-bytes','--manifest-sha256']:[])]);
    for(const key of ['--url','--export-id',...(download?['--out']:[])])
      if(!options.has(key))throw failure('CONFIGURATION_ERROR','Missing '+key);
    const rawChunk=options.get('--chunk-bytes');
    if(rawChunk!==undefined&&!/^[1-9][0-9]*$/.test(rawChunk))throw failure('CONFIGURATION_ERROR','Use an integer chunk size.');
    const controller=new AbortController(),stop=()=>controller.abort(failure('HAR_DOWNLOAD_INTERRUPTED','Resume the same original download and output directory.'));
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
      const args={url:options.get('--url'),exportId:options.get('--export-id'),tokenEnv:options.get('--token-env')??'MCP_ACCESS_TOKEN',signal:controller.signal};
      const result=download?await downloadHarExport({...args,directory:options.get('--out'),
        ...(rawChunk===undefined?{}:{chunkSize:Number(rawChunk)}),
        ...(options.has('--manifest-sha256')?{expectedManifestSha256:options.get('--manifest-sha256')}:{}),
        onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')}):await inspectHarExport(args);
      process.stdout.write(JSON.stringify(result)+'\n');return result;
    }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
  if (command === 'init-openapi-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name', '--release-store']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeOpenApiWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      name: options.get('--name'), releaseStore: options.get('--release-store') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (['download-openapi', 'inspect-openapi', 'reopen-openapi'].includes(command)) {
    const { downloadOpenApiPackage, inspectOpenApiPackageDownload, reopenOpenApiPackageDownload } = await import('./openapi-workspace-client.mjs');
    if (command === 'reopen-openapi') {
      const options = pairs(rest, ['--dir', '--manifest-sha256']);
      if (!options.has('--dir')) throw failure('CONFIGURATION_ERROR', 'Supply --dir.');
      const result = await reopenOpenApiPackageDownload({ directory: options.get('--dir'), expectedManifestSha256: options.get('--manifest-sha256') });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    }
    const download = command === 'download-openapi';
    const options = pairs(rest, ['--url', '--workspace', '--export-id', '--token-env', '--manifest-sha256', ...(download ? ['--out', '--chunk-bytes'] : [])]);
    for (const key of ['--url', '--workspace', '--export-id', ...(download ? ['--out'] : [])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && (!/^[1-9][0-9]{0,5}$/.test(rawChunk) || Number(rawChunk) > 196608))
      throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const controller = new AbortController(), stop = () => controller.abort(failure('OPENAPI_DOWNLOAD_INTERRUPTED',
      'Download interrupted. Run the same command to continue the retained original files.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const selected = { url: options.get('--url'), workspace: options.get('--workspace'), exportId: options.get('--export-id'),
        tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal,
        expectedManifestSha256: options.get('--manifest-sha256') };
      const result = download ? await downloadOpenApiPackage({ ...selected, directory: options.get('--out'),
        ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }),
        onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') }) : await inspectOpenApiPackageDownload(selected);
      controller.signal.throwIfAborted(); process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (command === 'init-worldbank-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeWorldBankWorkspaceMerchant({ directory: options.get('--dir'),
      connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'inspect-worldbank' || command === 'download-worldbank') {
    const download = command === 'download-worldbank';
    const options = pairs(rest, ['--url','--workspace','--export-id','--token-env',
      ...(download ? ['--out','--chunk-bytes','--manifest-sha256'] : [])]);
    for (const key of ['--url','--workspace','--export-id',...(download ? ['--out'] : [])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && (!/^[1-9][0-9]{0,5}$/.test(rawChunk) || Number(rawChunk) > 196608))
      throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const { inspectWorldBankDownload, downloadWorldBankWorkspace } = await import('./worldbank-workspace-download.mjs');
    const controller = new AbortController();
    const stop = () => controller.abort(failure('WORLDBANK_DOWNLOAD_INTERRUPTED',
      'Download interrupted. Resume with the same export and output directory.'));
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    try {
      const selected = { url:options.get('--url'), workspace:options.get('--workspace'),
        exportId:options.get('--export-id'), tokenEnv:options.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
        signal:controller.signal };
      const result = download ? await downloadWorldBankWorkspace({ ...selected, directory:options.get('--out'),
        expectedManifestSha256:options.get('--manifest-sha256'),
        ...(rawChunk === undefined ? {} : {chunkSize:Number(rawChunk)}),
        onProgress:progress => process.stderr.write(JSON.stringify(progress) + '\n') })
        : await inspectWorldBankDownload(selected);
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    } finally { process.off('SIGINT',stop); process.off('SIGTERM',stop); }
  }
  if (command === 'init-grpc-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeGrpcWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'inspect-grpc' || command === 'download-grpc') {
    const inspect = command === 'inspect-grpc';
    const options = pairs(rest, ['--url', '--export-id', '--token-env', ...(inspect ? [] : ['--out', '--chunk-bytes', '--manifest-sha256'])]);
    for (const key of ['--url', '--export-id', ...(inspect ? [] : ['--out'])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const { inspectGrpcExport, downloadGrpcExport } = await import('./grpc-workspace-download.mjs');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && !/^[1-9][0-9]{0,5}$/.test(rawChunk))
      throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const controller = new AbortController();
    const stop = () => controller.abort(failure('GRPC_EXPORT_DOWNLOAD_INTERRUPTED', 'Run the same command and receiving directory to continue the original files.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const common = { url: options.get('--url'), exportId: options.get('--export-id'),
        tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal };
      const result = inspect ? await inspectGrpcExport(common) : await downloadGrpcExport({ ...common, directory: options.get('--out'),
        ...(options.has('--manifest-sha256') ? { expectedManifestSha256: options.get('--manifest-sha256') } : {}),
        ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }),
        onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') });
      controller.signal.throwIfAborted();
      process.stdout.write(JSON.stringify(result) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (command === 'init-usgs-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeUSGSWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-baserow-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeBaserowWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-source-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeSourceWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'grants-download') {
    const { main } = await import('./grantsgov-download.mjs');
    return main(rest);
  }
  if (command === 'init-grants-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeGrantsWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-research-workspaces') {
    const options = pairs(rest, ['--dir','--connection','--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR','Supply --dir and --connection.');
    const result = await initializeResearchWorkspaceMerchant({directory:options.get('--dir'),
      connection:options.get('--connection'),name:options.get('--name')});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
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
  if (command === 'init-stellar-expert-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeStellarExpertWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-coingecko-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeCoinGeckoWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-opencage-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeOpenCageWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
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
  if (command === 'init-nocodb-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeNocoDBWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-mpp') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeMppMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'inspect-mpp' || command === 'download-mpp') {
    const download = command === 'download-mpp';
    const options = pairs(rest, ['--url', '--export-id', '--token-env', ...(download ? ['--out', '--chunk-bytes', '--manifest-sha256'] : [])]);
    if (!options.has('--url') || !options.has('--export-id') || download && !options.has('--out'))
      throw failure('CONFIGURATION_ERROR', 'Supply the MCP URL, original export ID, and download directory when downloading.');
    const { inspectMppDownload, downloadMppExport } = await import('./mpp-download.mjs');
    const selected = { url: options.get('--url'), exportId: options.get('--export-id'), tokenEnv: options.get('--token-env') };
    const result = download ? await downloadMppExport({ ...selected, directory: options.get('--out'),
      ...(options.has('--chunk-bytes') ? { chunkSize: Number(options.get('--chunk-bytes')) } : {}),
      ...(options.has('--manifest-sha256') ? { expectedManifestSha256: options.get('--manifest-sha256') } : {}) })
      : await inspectMppDownload(selected);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (['inspect-cocart', 'download-cocart', 'reopen-cocart'].includes(command)) {
    const options = pairs(rest, ['--url', '--workspace', '--export-id', '--out', '--input', '--root', '--token-env', '--chunk-bytes', '--manifest-sha256']);
    if (!options.has('--workspace') || !options.has('--export-id')) throw failure('CONFIGURATION_ERROR', 'Supply --workspace and --export-id.');
    const { inspectCocartExport, downloadCocartExport, reopenCocartExport } = await import('./cocart-download.mjs');
    const common = { workspace: options.get('--workspace'), exportId: options.get('--export-id'),
      ...(options.has('--manifest-sha256') ? { expectedManifestSha256: options.get('--manifest-sha256') } : {}) };
    let result;
    if (command === 'reopen-cocart') {
      if (!options.has('--input') || !options.has('--root')) throw failure('CONFIGURATION_ERROR', 'Supply --input completed-download-directory and --root receiving-workspace.');
      result = await reopenCocartExport({ ...common, directory: options.get('--input'), destination: options.get('--root') });
    } else {
      if (!options.has('--url')) throw failure('CONFIGURATION_ERROR', 'Supply --url for the original merchant listener.');
      const selected = { ...common, url: options.get('--url'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN' };
      if (command === 'download-cocart' && !options.has('--out')) throw failure('CONFIGURATION_ERROR', 'Supply --out for the complete original download.');
      result = command === 'download-cocart' ? await downloadCocartExport({ ...selected, directory: options.get('--out'),
        ...(options.has('--chunk-bytes') ? { chunkSize: Number(options.get('--chunk-bytes')) } : {}) }) : await inspectCocartExport(selected);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-cocart-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeCocartWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-woocommerce') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeWooCommerceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-census-geocoder-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeCensusGeocoderWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-geocodio-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeGeocodioWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-odata-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeODataWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-socrata-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeSocrataWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-fiscaldata-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeFiscalDataWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-opensearch-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--release-store', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeOpenSearchWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      releaseStore: options.get('--release-store'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-edgar-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeEdgarWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'init-feeds-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeFeedsWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), name: options.get('--name') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (command === 'download-feeds' || command === 'inspect-feeds') {
    const options = pairs(rest, ['--url', '--workspace', '--export-id', '--out', '--token-env', '--chunk-bytes', '--manifest-sha256']);
    for (const key of ['--url','--workspace','--export-id', ...(command === 'download-feeds' ? ['--out'] : [])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const { downloadFeedsDelivery, inspectFeedsDelivery } = await import('./feeds-download.mjs');
    const controller = new AbortController(), stop = () => controller.abort(failure('FEEDS_DOWNLOAD_INTERRUPTED', 'Resume the same original retained delivery directory.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const result = await (command === 'download-feeds' ? downloadFeedsDelivery : inspectFeedsDelivery)({
        url: options.get('--url'), workspace: options.get('--workspace'), exportId: options.get('--export-id'),
        directory: options.get('--out'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN',
        ...(options.has('--chunk-bytes') ? {chunkSize: Number(options.get('--chunk-bytes'))} : {}),
        ...(options.has('--manifest-sha256') ? {expectedManifestSha256: options.get('--manifest-sha256')} : {}),
        signal: controller.signal, onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n')
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
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
  if (command === 'init-graphql-workspaces') {
    const options = pairs(rest, ['--dir', '--connection', '--name']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializeGraphqlWorkspaceMerchant({ directory: options.get('--dir'), connection: options.get('--connection'),
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'inspect-graphql' || command === 'download-graphql') {
    const downloading = command === 'download-graphql';
    const options = pairs(rest, ['--url', '--export-id', '--token-env',
      ...(downloading ? ['--out', '--chunk-bytes', '--manifest-sha256'] : [])]);
    for (const key of ['--url', '--export-id', ...(downloading ? ['--out'] : [])])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Supply ' + key + '.');
    const rawChunk = options.get('--chunk-bytes');
    if (rawChunk !== undefined && !/^[1-9][0-9]{0,5}$/.test(rawChunk))
      throw failure('CONFIGURATION_ERROR', 'Use a whole chunk byte count from 1 to 196608.');
    const { inspectGraphqlWorkspaceFiles, downloadGraphqlWorkspaceFiles } = await import('./graphql-workspace-download.mjs');
    const controller = new AbortController();
    const stop = () => controller.abort(failure('GRAPHQL_DOWNLOAD_INTERRUPTED', 'Run the same download command to continue its verified original files.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const common = { url: options.get('--url'), exportId: options.get('--export-id'),
        tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal };
      const result = downloading ? await downloadGraphqlWorkspaceFiles({ ...common, directory: options.get('--out'),
        ...(rawChunk === undefined ? {} : { chunkSize: Number(rawChunk) }),
        ...(options.has('--manifest-sha256') ? { expectedManifestSha256: options.get('--manifest-sha256') } : {}),
        onProgress: value => process.stderr.write(JSON.stringify(value) + '\n') })
        : await inspectGraphqlWorkspaceFiles(common);
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
  if (command === 'init-arcgis-workspaces') {
    const options = pairs(rest, ['--dir','--publishers','--connection','--release-store','--name']);
    for (const key of ['--dir','--publishers','--connection'])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Missing ' + key);
    const result = await initializeArcgisWorkspaceMerchant({ directory: options.get('--dir'),
      publishers: options.get('--publishers'), connection: options.get('--connection'),
      releaseStore: options.get('--release-store'), ...(options.has('--name') ? {name:options.get('--name')} : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command === 'init-publishers') {
    const options = pairs(rest, ['--dir', '--connection', '--name', '--arcgis-workspaces', '--release-store']);
    if (!options.has('--dir') || !options.has('--connection')) throw failure('CONFIGURATION_ERROR', 'Supply --dir and --connection.');
    const result = await initializePublisherMerchant({ directory: options.get('--dir'), connection: options.get('--connection'), arcgisWorkspaces: options.get('--arcgis-workspaces'), releaseStore: options.get('--release-store'),
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
    const options = pairs(rest, ['--dir', '--workspace', '--python', '--python-root', '--duckdb-package', '--duckdb-python', '--dataset-package', '--s3-package', '--postgres-package', '--mysql-package', '--clickhouse-package', '--jsonrpc-package', '--sqlite-package', '--sqlite-snapshot-max-bytes', '--sqlite-snapshot-timeout-ms', '--spec', '--selections', '--bindings', '--upstreams', '--name', '--seller-port', '--handlers', '--facilitator', '--catalog', '--facilitators', '--fleet-plan', '--accounting', '--support', '--receiving', '--python-workspaces', '--graphql-workspaces', '--stellar-expert-workspaces', '--source-workspaces', '--baserow-workspaces', '--usgs-workspaces', '--feeds-workspaces', '--grpc-workspaces', '--openapi-workspaces', '--har-workspaces', '--ckan-workspaces', '--pricing', '--woocommerce', '--cocart-workspaces', '--mpp', '--buyer-expenses', '--release-store'], ['--allow-local-facilitator', '--allow-loopback-upstream']);
    for (const key of options.has('--workspace') || options.has('--python') || options.has('--duckdb-package') || options.has('--dataset-package') || options.has('--s3-package') || options.has('--postgres-package') || options.has('--mysql-package') || options.has('--jsonrpc-package') || options.has('--sqlite-package') || options.has('--clickhouse-package') ? ['--dir'] : ['--dir', '--spec', '--selections', '--bindings'])
      if (!options.has(key)) throw failure('CONFIGURATION_ERROR', 'Missing ' + key);
    const runtime = { port: portNumber(options.get('--seller-port'), 0) };
    if (options.has('--handlers')) runtime.handlers = options.get('--handlers');
    if (options.has('--facilitator')) runtime.facilitator = options.get('--facilitator');
    if (options.has('--allow-local-facilitator')) runtime.allowLocalFacilitator = true;
    if (options.has('--allow-loopback-upstream')) runtime.allowLoopbackUpstream = true;
    const result = await initializeMerchant({ directory: options.get('--dir'), spec: options.get('--spec'),
      selections: options.get('--selections'), bindings: options.get('--bindings'),
      workspace: options.get('--workspace'), upstreams: options.get('--upstreams'), runtime, catalog: options.get('--catalog'), facilitators: options.get('--facilitators'), fleetPlan: options.get('--fleet-plan'), accounting: options.get('--accounting'), support: options.get('--support'), receiving: options.get('--receiving'), pythonWorkspaces: options.get('--python-workspaces'), graphqlWorkspaces: options.get('--graphql-workspaces'), stellarExpertWorkspaces: options.get('--stellar-expert-workspaces'), sourceWorkspaces: options.get('--source-workspaces'), baserowWorkspaces: options.get('--baserow-workspaces'), usgsWorkspaces: options.get('--usgs-workspaces'), feedsWorkspaces: options.get('--feeds-workspaces'), grpcWorkspaces: options.get('--grpc-workspaces'), openapiWorkspaces: options.get('--openapi-workspaces'), harWorkspaces: options.get('--har-workspaces'), ckanWorkspaces: options.get('--ckan-workspaces'), pricing: options.get('--pricing'), woocommerce: options.get('--woocommerce'), cocartWorkspaces: options.get('--cocart-workspaces'), mpp: options.get('--mpp'), buyerExpenses: options.get('--buyer-expenses'), releaseStore: options.get('--release-store'),
      python: options.get('--python'), pythonRoot: options.get('--python-root'),
      duckdbPackage: options.get('--duckdb-package'), duckdbPython: options.get('--duckdb-python'),
      datasetPackage: options.get('--dataset-package'),
      s3Package: options.get('--s3-package'), postgresPackage: options.get('--postgres-package'), mysqlPackage: options.get('--mysql-package'),
      jsonrpcPackage: options.get('--jsonrpc-package'),
      clickhousePackage: options.get('--clickhouse-package'),
      sqlitePackage: options.get('--sqlite-package'),
      sqliteSnapshotMaxBytes: options.has('--sqlite-snapshot-max-bytes') ? Number(options.get('--sqlite-snapshot-max-bytes')) : undefined,
      sqliteSnapshotTimeoutMs: options.has('--sqlite-snapshot-timeout-ms') ? Number(options.get('--sqlite-snapshot-timeout-ms')) : undefined,
      ...(options.has('--name') ? { name: options.get('--name') } : {}) });
    process.stdout.write(JSON.stringify(result) + '\n'); return result;
  }
  if (command !== 'serve') throw failure('CONFIGURATION_ERROR', 'Choose init, init-mpp, inspect-mpp, download-mpp, init-buyer-expenses, expenses, init-woocommerce, init-cocart-workspaces, inspect-cocart, download-cocart, reopen-cocart, init-fleet, init-pricing, init-accounting, init-receiving, init-python-workspaces, init-graphql-workspaces, init-sheets-workspaces, init-nocodb-workspaces, init-ckan-workspaces, init-tenderly-workspaces, init-opencage-workspaces, init-stellar-expert-workspaces, init-coingecko-workspaces, init-redis-workspaces, init-usaspending-workspaces, init-research-workspaces, init-grants-workspaces, grants-download, init-source-workspaces, init-baserow-workspaces, inspect-baserow, download-baserow, reopen-baserow, receive-baserow, init-usgs-workspaces, usgs, init-feeds-workspaces, download-feeds, inspect-feeds, init-grpc-workspaces, inspect-grpc, download-grpc, init-openapi-workspaces, download-openapi, inspect-openapi, reopen-openapi, init-har-workspaces, inspect-har, download-har, init-s3-workspaces, init-opensearch-workspaces, init-publishers, init-arcgis-workspaces, serve, maintenance, adjustments, platforms, statements, inspect-support, inspect-client, inspect-graphql, inspect-s3, download-support, download-client, download-graphql, download-s3, reopen-support, download-python or reopen-python.');
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
