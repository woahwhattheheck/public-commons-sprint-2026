#!/usr/bin/env node
// MIT. Source intake and original SF61/SF30 composition, no new seller runtime.
import { readFile, rename, rm, mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPERATIONS, DISCOVERY_URL, readCatalog, buildContract } from './contracts.mjs';
import { sourceRoot, nativePath, nativeImport, readJson, createJson, createBytes, jsonBytes,
  sha256, argumentsMap, required } from './runtime.mjs';

const HELP = `GoldRush provider-owned Stellar pilot (Node 22+)
  discover --out NEW_DIRECTORY [--proxy-env ENV_NAME] [--source-root CHECKOUT]
  prepare --plan PLAN.json --catalog CATALOG.json --out NEW_DIRECTORY [--source-root CHECKOUT]
  inspect --release DIRECTORY [--source-root CHECKOUT]

discover performs ONE free, unsigned GET to GoldRush's fixed discovery endpoint.
prepare composes retained provider sources through original SF61; no credential,
signer, backend, facilitator, subscription or payment is accessed.
Run the original SF30 upstream/operations commands printed by inspect.
Existing files/directories are never overwritten.`;

function nativeCommands(root, directory) {
  const merchant = join(directory, 'merchant');
  return {
    check: [process.execPath, nativePath(root, 'sf30-seller-sdk/upstream-serve.mjs'), '--config', join(merchant, 'seller-service.json'), '--upstreams', join(merchant, 'upstreams.json'), '--check'],
    serve: [process.execPath, nativePath(root, 'sf30-seller-sdk/operations/launch.mjs'), '--upstream', '--operations-port', '0', '--', '--config', join(merchant, 'seller-service.json'), '--upstreams', join(merchant, 'upstreams.json'), '--port', '0'],
  };
}

async function discover(options) {
  const root = sourceRoot(options.get('--source-root'));
  const { createPublicHttpsFetch } = await nativeImport(root, 'sf31-buyer-client/public-transport.mjs');
  const proxyEnv = options.get('--proxy-env');
  const fetch = createPublicHttpsFetch({ timeoutMs: 30000, ...(proxyEnv ? {
    trustedProxy: { mode: 'explicit-connect', origin: new URL(DISCOVERY_URL).origin, proxyEnv },
  } : {}) });
  const response = await fetch(DISCOVERY_URL, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' } });
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); throw new TypeError('GoldRush free discovery did not return HTTP 200 JSON');
  }
  const chunks = []; let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > 1048576) throw new TypeError('GoldRush discovery exceeds 1 MiB');
    chunks.push(part);
  }
  const raw = Buffer.concat(chunks), parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  const catalog = readCatalog(parsed), out = resolve(required(options, '--out'));
  await mkdir(out, { mode: 0o700 });
  await createBytes(join(out, 'catalog.json'), raw);
  const receipt = { schema: 'stellar-forge.goldrush-discovery.v1', url: DISCOVERY_URL,
    status: response.status, receivedAt: new Date().toISOString(), serverDate: response.headers.get('date'),
    contentType: response.headers.get('content-type'), sha256: sha256(raw), bytes: raw.length,
    endpoints: catalog.endpoints.length, selectedOperations: OPERATIONS.map(({ slug }) => slug),
    advertisedPaymentNetwork: catalog.x402.network, requests: 1, payments: 0 };
  await createJson(join(out, 'receipt.json'), receipt);
  return { ...receipt, catalog: join(out, 'catalog.json') };
}

async function prepare(options) {
  const root = sourceRoot(options.get('--source-root'));
  const [plan, catalog] = await Promise.all([readJson(required(options, '--plan'), 65536), readJson(required(options, '--catalog'))]);
  const contract = await buildContract(plan.value, catalog.value);
  const out = resolve(required(options, '--out'));
  // Compile before committing the final directory. All staging is this call's
  // new private directory; no customer workspace, ledger or older release moves.
  const stage = await mkdtemp(join(dirname(out), '.goldrush-prepare-'));
  try {
    const inputs = join(stage, 'inputs'); await mkdir(inputs, { mode: 0o700 });
    await Promise.all([
      createJson(join(inputs, 'provider-plan.json'), contract.plan),
      createJson(join(inputs, 'merchant.openapi.json'), contract.specification),
      createJson(join(inputs, 'selections.json'), contract.selections),
      createJson(join(inputs, 'service-bindings.json'), contract.bindings),
      createJson(join(inputs, 'upstream-bindings.json'), contract.upstreams),
      createBytes(join(inputs, 'goldrush-catalog.json'), catalog.bytes),
    ]);
    const compiled = join(stage, 'merchant');
    const { run } = await nativeImport(root, 'sf61-openapi-seller-import/cli.mjs');
    await run(['--spec', join(inputs, 'merchant.openapi.json'), '--config', join(inputs, 'selections.json'),
      '--service-bindings', join(inputs, 'service-bindings.json'),
      '--upstream-bindings', join(inputs, 'upstream-bindings.json'), '--out', compiled]);
    const { readSellerConfig } = await nativeImport(root, 'sf30-seller-sdk/serve.mjs');
    const { compileSellerRoutes } = await nativeImport(root, 'sf30-seller-sdk/resource-server.mjs');
    const { createConfiguredAdmission } = await nativeImport(root, 'sf30-seller-sdk/configured-admission.mjs');
    const config = await readSellerConfig(join(compiled, 'seller-service.json'));
    const original = compileSellerRoutes(config.routes.map(route => ({ id: route.id, offer: route.offer,
      admit: createConfiguredAdmission(route),
      handler: () => { throw new Error('Offline preparation has no backend'); } })));
    const routes = original.routes;
    const { compileSellerOpenApi } = await nativeImport(root, 'sf30-seller-sdk/developer-portal.mjs');
    const { generateSellerClient } = await nativeImport(root, 'sf30-seller-sdk/developer/client-generator.mjs');
    const openapiBytes = jsonBytes(compileSellerOpenApi(original, { mode: 'CHALLENGE_ONLY' }));
    const client = generateSellerClient(openapiBytes), customer = join(stage, 'customer');
    await mkdir(customer, { mode: 0o700 });
    await Promise.all([
      createBytes(join(customer, 'openapi.json'), openapiBytes),
      createBytes(join(customer, 'seller-client.mjs'), client.javascript),
      createBytes(join(customer, 'seller-client.d.mts'), client.declarations),
      createBytes(join(customer, 'README.md'), client.readme),
      createJson(join(customer, 'package.json'), client.packageJson),
    ]);
    const merchant = join(out, 'merchant');
    const manifest = { schema: 'stellar-forge.goldrush-release.v1', createdAt: new Date().toISOString(),
      publicOrigin: contract.plan.publicOrigin, credentialEnv: contract.plan.credentialEnv,
      sourceCatalog: { sha256: sha256(catalog.bytes), bytes: catalog.bytes.length,
        sourceUrl: DISCOVERY_URL, observedPayment: contract.sourcePayment, observedPricing: contract.sourcePricing },
      selectedCatalog: contract.selectedCatalog, providerSources: contract.sources,
      policyChanges: contract.policyChanges,
      operations: routes.map(route => ({ id: route.id, path: route.path, samplePath: route.binding.samplePath,
        method: route.method, accepts: route.offer.accepts, inputValidation: true })),
      nativeImporterManifestSha256: sha256(await readFile(join(compiled, 'manifest.json'))),
      customer: { openapi: 'customer/openapi.json', openapiSha256: sha256(openapiBytes),
        client: 'customer/seller-client.mjs', clientSha256: sha256(client.javascript),
        buyer: 'Original SF88 native Node/Python Buyer and operator; Base Sepolia client compatibility is not claimed.' },
      build: { nodeVersion: process.version },
      nativeEntries: { check: 'sf30-seller-sdk/upstream-serve.mjs', serve: 'sf30-seller-sdk/operations/launch.mjs' },
      paymentsInitiated: 0, upstreamCalls: 0 };
    await createJson(join(stage, 'release.json'), manifest);
    // mkdir establishes create-only destination; a failing final install never
    // replaces an existing release. The final path is not a live state root.
    await mkdir(out, { mode: 0o700 });
    try {
      await rename(join(stage, 'inputs'), join(out, 'inputs'));
      await rename(compiled, merchant);
      await rename(customer, join(out, 'customer'));
      await rename(join(stage, 'release.json'), join(out, 'release.json'));
    } catch (error) { await rm(out, { recursive: true, force: true }); throw error; }
    return { status: 'GOLDRUSH_NATIVE_RELEASE_PREPARED', directory: out, operations: routes.length,
      catalogSha256: manifest.sourceCatalog.sha256, paymentsInitiated: 0, upstreamCalls: 0 };
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const action = args[0];
  const options = argumentsMap(args.slice(1), action === 'discover' ? ['--out','--proxy-env','--source-root'] :
    action === 'prepare' ? ['--plan','--catalog','--out','--source-root'] : action === 'inspect' ? ['--release','--source-root'] : []);
  let result;
  if (action === 'discover') result = await discover(options);
  else if (action === 'prepare') result = await prepare(options);
  else if (action === 'inspect') {
    const directory = resolve(required(options, '--release'));
    result = { ...(await readJson(join(directory, 'release.json'))).value,
      commands: nativeCommands(sourceRoot(options.get('--source-root')), directory) };
  }
  else throw new TypeError(HELP);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write((error instanceof TypeError ? error.message : 'GOLDRUSH_PILOT_FAILED') + '\n'); process.exitCode = 1; });
