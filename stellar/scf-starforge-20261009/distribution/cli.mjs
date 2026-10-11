#!/usr/bin/env node
// MIT. Product command surface; original command processes own their lifecycle.
import { readFile, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants } from 'node:os';
import { createRequire } from 'node:module';
import { createWorkspace, workspaceCommand } from './workspace.mjs';

const specification = JSON.parse(await readFile(new URL('./distribution.json', import.meta.url), 'utf8'));
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const help = `Starforge merchant toolkit

  starforge init --dir DIRECTORY [--template dataset|application|upstream]
  starforge run --workspace DIRECTORY [--operations-port PORT] [-- NATIVE_SELLER_OPTIONS]
  starforge doctor [--native] [--feature NAME]
  starforge source
  starforge installation                     Inspect, install, stage and select a maintained package
  starforge runtime-profile --help
  starforge runtime-install --help
  starforge runtime-workspace --help

Native commands (arguments pass unchanged to the maintained implementation):
  mpp                                       Native Stellar MPP merchant, governed buyer and recovery workspace
  valyu-merchant                            Configure and operate the native research search merchant
  valyu-research                            Save queries, operate purchases, compare research and export editions
  sftp                                      Inspect, capture and resume pinned private report files
  sftp-publisher                            Publish retained file datasets with original refresh and buyer handoff
  sftp-workspace                            Author SFTP reports, exact merchant terms and native publications
  provider-operator                          Original external-provider capture, case and terminal workflow
  provider-workspace                         Retained provider desk, host profiles and complete case recovery
  runtime-profile                            Select exact dependencies for an original release
  runtime-install                            Install, resume, run, upgrade and recover a customer runtime
  runtime-workspace                          Review, install and recover runtimes in a private browser workspace
  seller      JSON/application seller         upstream    Existing API seller
  jsonrpc     Prepare, diagnose and operate selected Stellar RPC read products
  getblock-stellar  Prepare selected GetBlock Stellar reads and original release/buyer handoff
  chainstack-stellar  Install, observe and operate the original Chainstack merchant and buyer handoff
  chainstack-buyer    Review, execute and recover its exact requests using installed Node/Python runtimes
  operations  Seller + live dashboard         dataset     Dataset API compiler
  supplier-quotas                            Review supplier account configuration and inspect retained call allowances
  openapi     OpenAPI seller import            pilot       OpenAPI pilot + operations
  buyer       Discover, review, approved call  capture     One HTTP 402 capture
  import-headers  Import original operator HTTP headers
  handoff     Captured challenge -> review    support     Private seller support case
  support-watch                             Observe, acknowledge and export merchant incidents
  support-console                           Retained merchant cases and runtime follow-up
  commerce    Merchant + buyer session        inbox       Durable selected requests
  merchant-mcp                               Operate native merchant releases from an MCP client
  mcp-native                                Prepare and operate the original native buyer MCP workspace
  mcp-buyer                                 Run the existing private HTTP buyer and operator console
  mcp-results                               Read, export and recover original saved MCP results
  mcp-data                                  Serve prepared SQLite/PostgreSQL/DuckDB/ClickHouse queries over MCP
  mcp-stdio / mcp-client-config              Run and register that buyer with a local MCP host
  merchant-mcp-stdio / merchant-mcp-client-config  Run and register original merchant MCP tools locally
  native-signer  Native buyer configuration   facilitator Native fee-sponsoring backend
  client      Export a JS/TypeScript client   releases    Review and operate seller releases
  merchant-host                             Install, observe and recover the original Linux merchant group
  merchant-recovery                         Create, verify and cold-restore original encrypted merchant snapshots
  merchant-recovery-remote                  Upload, list, retrieve and restore retained off-host snapshots
  buyer-inbox Prepare and run buyer jobs     postgres    PostgreSQL merchant + dashboard
  buyer-node  Review, execute and recover generated-client purchases in a Node application
  routescan-merchant  Configure, preview and operate the original Routescan gas-data merchant
  routescan-workspace Operate its saved project through the original local workspace
  buyer-n8n-workflows Generate six original customer workflows for the selected n8n credential
  buyer-agent Operate the original buyer through LangGraph checkpoints and LangChain tools
  tomorrow                                  Plan weather work, review forecasts, recover resources and deliver licensed files
  tenderly / tenderly-workspace              Prepare and operate the Tenderly simulation merchant
  tenderly-customer                          Receive, recover and export the original simulation purchase
  tenderly-analysis                          Receive, compare and review completed Tenderly simulations
  dataset-delivery Export a saved buyer dataset
  merchant    Seller + fulfillment journal   delivery    Deliver original merchant events
  delivery-workspace                         Configure receivers and operate retained delivery recovery
  delivery-destinations                      Route original events to independently operated receivers
  merchant-desk Order, file and access desk   paid-file-checkout Original file checkout
  paid-file-purchase Prepare and retrieve an approved customer order
  api-pass                                  Sell and operate purchased API allowances on original orders
  api-pass-client                           Use an allowance, inspect usage and recover an original response
  postgres-init / postgres-inspect            Prepare or inspect a PostgreSQL source
  postgres-workspace                         Build a merchant API from database fields
  postgres-publisher                         Publish reviewed query snapshots and keep datasets current
  mysql                                      Inspect, prepare and operate a MySQL/MariaDB merchant
  mysql-workspace                            Build, review and run a database merchant in the browser
  mysql-publisher                            Publish reviewed MySQL snapshots and retained buyer datasets
  sheets-source                              Capture, inspect and prepare selected Google Sheets columns
  sheets-publisher                           Review and publish retained Sheet observations as datasets
  mongodb                                    Inspect, author and operate fixed native BSON reports
  mongodb-workspace                          Build a MongoDB merchant and prepare original buyer requests
  mongodb-publisher                          Publish complete reviewed BSON snapshots and retained refreshes
  redis                                      Inspect, prepare and operate Redis/Valkey read products
  clickhouse                                 Preflight and run a retained ClickHouse merchant
  clickhouse-prepare                         Prepare approved analytical queries and the original customer client
  clickhouse-workspace                       Author, review and operate retained ClickHouse merchants
  cube-workspace / cube-onboard              Author, review and export paid Cube reports
  openapi-workspace                          Import an API contract or Postman collection and operate its merchant
  openapi postman                            Review collections, retain source and create merchant packages
  openapi weather                            Operate the original OpenWeather customer application
  duckdb / duckdb-inspect                     Run or inspect an approved DuckDB/Parquet source
  duckdb-prepare                             Prepare, verify and reopen native data packages
  duckdb-workspace / duckdb-workbench         Author and operate a retained data merchant
  sqlite-init / sqlite-inspect                Prepare or inspect a SQLite source
  sqlite-workbench                           Author and export the original SQLite merchant
  sqlite-publisher                           Review and publish retained SQLite data products
  commerce-console                           Browser workspace for a prepared commerce session
  dataset-refresh                            Publish and select retained dataset versions
  dataset-publisher                          Publish CSV versions and prepare original buyer acquisition
  buyer-dataset                              Acquire, resume and deliver a complete selected dataset
  buyer-dataset-workspace                    Review and operate original datasets in the browser
  catalog-serve / catalog                     Host and operate live seller discovery
  catalog-withdrawal                         Prepare, sign and apply seller withdrawals
  catalog-workspace                          Review signed declarations and retained catalog operations
  checkout / purchase                        Enroll, purchase and retrieve a merchant file
  buyer-object                               Acquire, resume and assemble an existing object
  buyer-runbook                              Plan, run and recover multi-resource acquisitions
  buyer-object-workspace                     Review and operate original file acquisitions in the browser
  assets                                     Inspect, package and catalog immutable file products
  commerce-setup                             Prepare shared operator budgets and merchant requests
  upstream-operation                         Issue, inspect and reconcile merchant operation tickets
  dataset-workspace                          Inspect, preview and operate the retained dataset
  allium-explorer / allium-workspace          Acquire, review and operate retained Allium data products
  merchant-fleet / merchant-fleet-control     Host, prepare, activate and roll back a merchant fleet
  merchant-fleet-workspace                    Review fleet changes in the private operator browser
  fleet-release                              Stage, compare and operate original releases across a fleet
  revenue-workspace / revenue-report         Plan pricing from original merchant activity
  merchant-accounting / merchant-accounting-workspace  Reconcile original settlement records and review retained ledgers
  merchant-accounting-pricing                Import a saved original pricing report as accounting terms
  merchant-accounting-recovery               Review, import and reopen an original completed purchase
  merchant-accounting-maintenance            Back up, recover and reopen the same merchant MCP accounting workspace
  merchant-accounting-adjustments            Review, retain and reconcile original merchant cancellations and refunds
  s3                                         Inspect and configure selected object-store resources
  python-merchant                            Inspect, diagnose and serve a Python application
  python-workspace                           Author Python sources, run private previews and operate native releases
  merchant-readiness                         Review every configured Stellar receiving account
  availability                              Review, pause and resume a running seller's selected routes
  cube-onboarding                            Capture and prepare reviewed Cube reports as a merchant
  graphql-onboarding / graphql-merchant      Prepare approved queries and run the original GraphQL seller
  graphql-workspace                          Review schemas, query packages and merchant lifecycle
  graphql-deployment                         Prepare original GraphQL release and Linux host handoffs
  woo-seller / woo-buyer                     Connect existing WooCommerce orders to native checkout
  grant-workspace                           Revise, export and receive the original SF47 grant delivery plans
  woo-operator                              Review original Stellar transfers and complete selected Woo orders

Optional feature groups: ${[...new Set([
  ...Object.keys(specification.featurePeers ?? {}),
  ...Object.keys(specification.runtimePackageManifests ?? {}),
])].sort().join(', ')}.

Use starforge COMMAND --help for the original command's usage.
Default workspace launch uses challenge-only mode. Add the original facilitator
and operator configuration when you want the native payment runtime.`;

async function release() {
  try {
    const data = JSON.parse(await readFile(new URL('../../../../manifest.json', import.meta.url), 'utf8'));
    return data?.schema === 'stellar-forge.merchant-distribution-manifest.v1' &&
      data.packageName === specification.name ? data : null;
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function pairs(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(result, key) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError('Invalid or repeated option: ' + key);
    result[key] = args[i + 1];
  }
  return result;
}
export async function doctor({ requireNative = false, requiredFeatures = [] } = {}) {
  const featurePeers = { ...specification.featurePeers }, featureResolvers = {};
  for (const [group, path] of Object.entries(specification.runtimePackageManifests ?? {})) {
    const filename = resolve(sourceRoot, path), manifest = JSON.parse(await readFile(filename, 'utf8'));
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies) ||
        !Object.keys(manifest.dependencies).length) throw new TypeError('Runtime dependencies missing: ' + path);
    featurePeers[group] = Object.fromEntries(Object.entries(manifest.dependencies ?? {}).map(([name, version]) =>
      [name, { version, probe: specification.featurePeers?.[group]?.[name]?.probe ?? name }]));
    // Match the original adapter's location, including a checkout that installed
    // drivers in its postgres directory rather than at the distribution root.
    featureResolvers[group] = createRequire(filename).resolve;
  }
  if (!Array.isArray(requiredFeatures) || requiredFeatures.some(name => !Object.hasOwn(featurePeers, name)))
    throw new TypeError('Unknown optional feature. Available: ' + Object.keys(featurePeers).join(', '));
  const original = await release();
  const inspectPeers = (definitions, resolveModule = value => import.meta.resolve(value)) => Object.entries(definitions).map(([name, value]) => {
    let available = false;
    try { resolveModule(value.probe); available = true; } catch {}
    return { name, requestedVersion: value.version, available };
  });
  const peers = inspectPeers(specification.nativePeers);
  const features = Object.entries(featurePeers).map(([name, definitions]) => {
    const dependencies = inspectPeers(definitions, featureResolvers[name]);
    return { name, available: dependencies.every(peer => peer.available), dependencies };
  });
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
  const nativeDependenciesPresent = peers.every(peer => peer.available);
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const result = { package: specification.name, packageVersion: original?.packageVersion ?? 'source-checkout',
    sourceCommit: original?.sourceCommit ?? null, node: process.version,
    localSellerReady: nodeMajor > 22 || nodeMajor === 22 && nodeMinor >= 16,
    nativeDependenciesPresent, nativeDependencies: peers,
    optionalFeatures: features,
    operatorPython: python.status === 0 ? python.stdout.trim() || python.stderr.trim() : null,
    operatorPlatform: process.platform === 'win32' ? 'POSIX_HOST_REQUIRED_FOR_ORIGINAL_OPERATOR' : 'POSIX',
    nativeRuntimeConfigured: false };
  if (!result.localSellerReady || requireNative && !nativeDependenciesPresent ||
      features.some(feature => requiredFeatures.includes(feature.name) && !feature.available)) process.exitCode = 1;
  return result;
}
function forward(command, args) {
  const entry = specification.commands[command];
  if (!entry) throw new TypeError('Unknown command: ' + command);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(sourceRoot, entry), ...args], {
      stdio: 'inherit', shell: false, windowsHide: true,
    });
    const forwardInterrupt = () => child.kill('SIGINT');
    const forwardTerminate = () => child.kill('SIGTERM');
    const detach = () => {
      process.off('SIGINT', forwardInterrupt);
      process.off('SIGTERM', forwardTerminate);
    };
    process.on('SIGINT', forwardInterrupt);
    process.on('SIGTERM', forwardTerminate);
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, signal) => {
      detach(); process.exitCode = code ?? 128 + (constants.signals[signal] ?? 1); resolveRun();
    });
  });
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return; }
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (command === 'source') {
    if (rest.length) throw new TypeError('source takes no options');
    return print(await release() ?? { package: specification.name, mode: 'SOURCE_CHECKOUT', components: specification.components });
  }
  if (command === 'doctor') {
    let requireNative = false;
    const requiredFeatures = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--native' && !requireNative) requireNative = true;
      else if (rest[i] === '--feature' && rest[i + 1] && !requiredFeatures.includes(rest[i + 1]))
        requiredFeatures.push(rest[++i]);
      else throw new TypeError('doctor [--native] [--feature NAME]');
    }
    return print(await doctor({ requireNative, requiredFeatures }));
  }
  if (command === 'init') {
    const options = pairs(rest, ['--dir', '--template']);
    if (!options['--dir']) throw new TypeError('init --dir DIRECTORY [--template TEMPLATE]');
    return print(await createWorkspace({ directory: options['--dir'], template: options['--template'], release: await release() }));
  }
  if (command === 'run') {
    const separator = rest.indexOf('--');
    const options = pairs(separator < 0 ? rest : rest.slice(0, separator), ['--workspace', '--operations-port']);
    if (!options['--workspace']) throw new TypeError('run --workspace DIRECTORY [-- NATIVE_SELLER_OPTIONS]');
    const native = await workspaceCommand(options['--workspace'], separator < 0 ? [] : rest.slice(separator + 1));
    const port = options['--operations-port'] ?? '0';
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new TypeError('operations port must be 0–65535');
    return forward('operations', ['--operations-port', port, ...(native.upstream ? ['--upstream'] : []), '--', ...native.args]);
  }
  return forward(command, rest);
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
