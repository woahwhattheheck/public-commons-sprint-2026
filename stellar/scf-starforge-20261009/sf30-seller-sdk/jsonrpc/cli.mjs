#!/usr/bin/env node
// MIT. Complete operator and buyer workflow through original SF61/SF30/SF88.
import { lstat, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { run as compileSeller } from '../../sf61-openapi-seller-import/cli.mjs';
import { prepare as prepareBuyer } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { readPlan, prepareProduct, PLAN_SCHEMA, credentialReferences } from './config.mjs';
import { admitRequest } from './stellar.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const own = (o, key) => Object.hasOwn(o, key);
const json = value => JSON.stringify(value, null, 2) + '\n';
const shell = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const command = parts => parts.map(shell).join(' ');
const USAGE = `Stellar RPC merchant — original SF30 payments, provider-owned read endpoint

  template
  workspace --dir PRIVATE_DIRECTORY [--create] [--plan PLAN.json] [--port 8447]
            [--challenge-only | --facilitator HTTPS_URL] (workspace --help for more)
  inspect  --plan PLAN.json
  prepare  --plan PLAN.json --out NEW_PRIVATE_DIRECTORY
  diagnose --plan PLAN.json [--allow-loopback-upstream]
  buyer    --package PACKAGE --method METHOD --body-file REQUEST.json
           --intent-id STABLE_ID --out NEW_REVIEW.json
  serve    --plan PLAN.json (--facilitator HTTPS_URL | --challenge-only)
           [--port 8423] [--operations-port 8424]
           [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
           [--history-dir PRIVATE_ABSOLUTE_DIRECTORY] [--history-days 90]
           [--state PRIVATE_ABSOLUTE_OUTBOX] [--max-in-flight 64]
           [--drain-grace-ms 60000] [--allow-loopback-upstream]
           [--allow-local-facilitator]

Inspect/prepare/buyer use public plan data only. Diagnose makes one getNetwork
and one getHealth read. Serve makes one getNetwork read before opening listeners.
The endpoint is read from the configured environment variable at runtime.
Each purchased request invokes only its selected fixed read method.`;
const definitions = {
  inspect: { required: ['plan'] },
  prepare: { required: ['plan', 'out'] },
  diagnose: { required: ['plan'], switches: ['allow-loopback-upstream'] },
  buyer: { required: ['package', 'method', 'body-file', 'intent-id', 'out'] },
  serve: { required: ['plan'], optional: ['facilitator', 'port', 'operations-port',
    'availability-dir', 'history-dir', 'history-days', 'state', 'max-in-flight', 'drain-grace-ms'],
    switches: ['challenge-only', 'allow-loopback-upstream', 'allow-local-facilitator'] },
};
function parse(args) {
  const [action, ...rest] = args, definition = definitions[action];
  if (!definition) throw new TypeError('Unknown RPC merchant command');
  const allowed = new Set([...(definition.required ?? []), ...(definition.optional ?? [])]);
  const switches = new Set(definition.switches ?? []), options = Object.create(null);
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw new TypeError('Expected a named command option');
    const key = rest[i].slice(2);
    if (own(options, key)) throw new TypeError('Duplicate command option');
    if (switches.has(key)) { options[key] = true; continue; }
    if (!allowed.has(key) || !rest[i + 1] || rest[i + 1].startsWith('--'))
      throw new TypeError('Invalid command options');
    options[key] = rest[++i];
  }
  if (definition.required.some(key => !own(options, key))) throw new TypeError('Missing command option');
  return { action, options };
}
function template() {
  return { schema: PLAN_SCHEMA, publicOrigin: 'https://your-merchant.example',
    dataNetwork: 'stellar:pubnet', endpointEnv: 'STELLAR_RPC_URL',
    payment: { network: 'stellar:testnet', asset: 'REPLACE_WITH_ACTUAL_ASSET_CONTRACT',
      payTo: 'REPLACE_WITH_ACTUAL_MERCHANT_RECIPIENT', maxTimeoutSeconds: 60 },
    operations: ['getTransaction', 'getEvents', 'getLatestLedger'].map(method =>
      ({ method, amountAtomic: 'REPLACE_WITH_YOUR_ATOMIC_PRICE' })) };
}
async function readJSON(path, limit = 1048576) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new TypeError('Expected a bounded regular JSON file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new TypeError('JSON file exceeds its size limit');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function privatePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/')
    throw new TypeError('Canonical absolute private ' + label + ' directory required');
  return value;
}
function integer(value, fallback, min, max, name) {
  const raw = value ?? String(fallback);
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new TypeError('Invalid ' + name);
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new TypeError('Invalid ' + name);
  return result;
}
function handlerEntry(plan) {
  return '// Generated trusted entry; public terms and environment references only.\n' +
    'import { createStellarRpcApplication } from ' +
    JSON.stringify(pathToFileURL(join(here, 'application.mjs')).href) + ';\n' +
    'const app = createStellarRpcApplication(' + JSON.stringify(plan) + ');\n' +
    'try { await app.verifyNetwork(); } catch (error) { await app.close(); throw error; }\n' +
    plan.operations.flatMap(({ method }) => ['export const ' + method + ' = app.handlers.' + method + ';',
      'export const admit' + method + ' = app.handlers.admit' + method + ';']).join('\n') +
    '\nexport const getStellarRpcSnapshot = app.snapshot;\nexport const close = app.close;\n';
}
function runbook(folder, plan) {
  const cli = join(here, 'cli.mjs'), availability = join(here, '../availability/cli.mjs');
  return ['# Prepared Stellar RPC merchant', '',
    'Data network: ' + plan.dataNetwork + '. Payment network: ' + plan.payment.network + '.',
    'Each selected method is one original paid POST product at /stellar/METHOD.', '',
    '## Provider and initial review', '',
    'Set the private environment references in an owner-managed secret source: ' + credentialReferences(plan).join(', ') + '.',
    'The endpoint variable contains the exact provider URL including any path credential. It stays out of these files.',
    'Review the source plan and choose the actual facilitator and merchant payment terms before opening native sales.', '',
    command(['node', cli, 'inspect', '--plan', join(folder, 'plan.json')]),
    command(['node', cli, 'diagnose', '--plan', join(folder, 'plan.json')]), '',
    'Diagnose reports network identity and the provider retention range from two explicit reads.',
    'Use current hashes, ledger windows or returned cursors for actual buyer requests. Discovery examples describe input formats.', '',
    '## Start the original seller and private desk', '',
    command(['node', cli, 'serve', '--plan', join(folder, 'plan.json'), '--facilitator', 'https://YOUR_ACTUAL_FACILITATOR',
      '--port', '8423', '--operations-port', '8424', '--availability-dir', '/private/stellar-rpc/availability',
      '--history-dir', '/private/stellar-rpc/history', '--state', '/private/stellar-rpc/outbox']), '',
    'The two listeners bind to IPv4 loopback. Serve verifies the configured data network with getNetwork before opening either listener.',
    'Retain the existing public HTTPS gateway and /stellar/* paths. Startup prints original docs, offers, operations and private availability control URLs.',
    'Keep the availability capability in the operator session. The plain desk URL is suitable for local read-only viewing.', '',
    '## Pause, resume and restart', '',
    'Put the startup availabilityControl URL into SELLER_AVAILABILITY_URL in the operator environment.',
    command(['node', availability, 'status', '--url-env', 'SELLER_AVAILABILITY_URL']),
    command(['node', availability, 'pause', '--url-env', 'SELLER_AVAILABILITY_URL', '--revision', 'CURRENT_REVISION',
      '--route', plan.operations[0].method, '--reason', 'Provider maintenance']), '',
    'Resume uses the same command with resume and the freshly reviewed revision. Select each affected route explicitly.',
    'Graceful stop drains original native work, checkpoints the original observer/history and closes upstream credentials.',
    'Restart with the same public origin and private directories. Product pauses remain until the operator resumes them.',
    'Rotate a provider secret in its environment source, drain the merchant, then restart to capture the new value.', '',
    '## Buyer review and purchase', '',
    'Write the chosen params object to a private request file. For zero-argument metadata reads write {}.',
    command(['node', cli, 'buyer', '--package', folder, '--method', plan.operations[0].method,
      '--body-file', '/private/stellar-request.json', '--intent-id', 'YOUR_STABLE_PURCHASE_ID', '--out', '/private/stellar-review.json']),
    command(['node', join(project, 'sf88-operator-buyer-cli/cli.mjs'), '--review', '--config', '/private/stellar-review.json']), '',
    'Execute that original review with the existing approved SF88 signer/workspace. Each next page is a new explicitly approved purchase.',
    'The successful body is the original JSON-RPC envelope. Read result, and preserve raw bytes or use a lossless JSON reader for large numeric literals.',
    'A chain transaction status FAILED or NOT_FOUND is valid read data; the native payment receipt is a separate header.', '',
    '## Retained source and release integration', '',
    'compiled/ contains the original SF61 service/offers/manifest. OpenAPI, selections and route bindings can feed the original SF82 release store.',
    'handlers.mjs is a trusted local module tied to this immutable source installation. It verifies network identity on import and exports close.',
    'An embedding host must await that close after its original native seller drains. This CLI owns that complete lifecycle directly.',
    'Use a new prepared directory when changing selected methods, prices or source; the existing release tooling supplies stage/diff/activate/rollback.', '',
    'Full provider configuration, response behavior and limits: ' + join(here, 'README.md'), '',
  ].join('\n');
}

export async function preparePackage(input, output) {
  const prepared = prepareProduct(input), folder = privatePath(output, 'package');
  const parent = dirname(folder), info = await lstat(parent);
  if (!info.isDirectory() || await realpath(parent) !== parent ||
      process.platform !== 'win32' && (info.mode & 0o077))
    throw new TypeError('Create packages under an existing private parent directory (0700)');
  await mkdir(folder, { mode: 0o700 });
  const files = { 'plan.json': json(prepared.plan), 'openapi.json': json(prepared.spec),
    'selections.json': json(prepared.selections), 'route-bindings.json': json(prepared.bindings),
    'seller-offers.json': json({ resources: prepared.imported.offers.map(row => row.seller) }),
    'handlers.mjs': handlerEntry(prepared.plan), 'RUN.md': runbook(folder, prepared.plan) };
  for (const [name, content] of Object.entries(files))
    await writeFile(join(folder, name), content, { flag: 'wx', mode: 0o600 });
  await compileSeller(['--spec', join(folder, 'openapi.json'), '--config', join(folder, 'selections.json'),
    '--service-bindings', join(folder, 'route-bindings.json'), '--out', join(folder, 'compiled')]);
  return { status: 'STELLAR_RPC_PREPARED', folder,
    operations: prepared.plan.operations.map(row => row.method), dataNetwork: prepared.plan.dataNetwork,
    paymentNetwork: prepared.plan.payment.network, requiredEnvironment: credentialReferences(prepared.plan) };
}

export async function prepareBuyerReview(options) {
  const folder = resolve(options.package), prepared = prepareProduct(await readPlan(join(folder, 'plan.json')));
  const method = options.method, index = prepared.plan.operations.findIndex(row => row.method === method);
  if (index < 0) throw new TypeError('Choose a method retained in this merchant package');
  const expected = { resources: prepared.imported.offers.map(row => row.seller) };
  if (!isDeepStrictEqual(await readJSON(join(folder, 'seller-offers.json')), expected))
    throw new TypeError('Prepared offers differ from the retained plan; prepare a new package');
  const bodyPath = resolve(options['body-file']), body = await readJSON(bodyPath);
  const url = prepared.plan.publicOrigin + '/stellar/' + method;
  if (admitRequest(method, { method: 'POST', url: new URL(url), body, query: {} }, prepared.plan.limits) !== true)
    throw new TypeError('Request does not match the selected Stellar read contract');
  return prepareBuyer(['--discovery', join(folder, 'seller-offers.json'), '--row', String(index), '--accept', '0',
    '--intent-id', options['intent-id'], '--url', url, '--method', 'POST', '--out', options.out,
    '--body-file', bodyPath, '--content-type', 'application/json']);
}

export async function startRpcCommand(plan, options, { env, stdout, stderr, navigationOrigin = null }) {
  if (Boolean(options.facilitator) === Boolean(options['challenge-only']))
    throw new TypeError('Choose an explicit facilitator or --challenge-only');
  if (options['allow-local-facilitator'] && !options.facilitator || options.state && !options.facilitator)
    throw new TypeError('Native facilitator required for the selected option');
  if (options['history-days'] && !options['history-dir']) throw new TypeError('--history-days requires --history-dir');
  const port = integer(options.port, 8423, 0, 65535, 'port');
  const operationsPort = integer(options['operations-port'], 8424, 0, 65535, 'operations port');
  if (port && port === operationsPort) throw new TypeError('Choose distinct merchant and operations ports');
  const paths = Object.fromEntries(['availability-dir', 'history-dir', 'state'].filter(key => own(options, key))
    .map(key => [key, privatePath(options[key], key)]));
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length)
    throw new TypeError('Use separate availability, history and outbox directories');
  const historyRetentionDays = integer(options['history-days'], 90, 1, 365, 'history days');
  const maxInFlight = integer(options['max-in-flight'], 64, 1, 1024, 'merchant capacity');
  const drainGraceMs = integer(options['drain-grace-ms'], 60000, 1000, 300000, 'drain grace');
  let nativeFactory = null, deliveryOutbox;
  if (options.facilitator) {
    let facilitator;
    try { facilitator = new URL(options.facilitator); } catch { throw new TypeError('Invalid facilitator URL'); }
    const local = options['allow-local-facilitator'] && facilitator.protocol === 'http:' && facilitator.hostname === '127.0.0.1';
    if ((!local && facilitator.protocol !== 'https:') || facilitator.username || facilitator.password ||
        facilitator.search || facilitator.hash || facilitator.href.replace(/\/$/, '') !== options.facilitator.replace(/\/$/, ''))
      throw new TypeError('Canonical trusted facilitator HTTPS URL required');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }, { openOutbox, instrumentNativeSettlement }] =
      await Promise.all([import('@x402/core/server'), import('../native-factory.mjs'),
        import('../../sf98-merchant-delivery/outbox.mjs')]);
    const client = new HTTPFacilitatorClient({ url: facilitator.href.replace(/\/$/, '') });
    if (paths.state) deliveryOutbox = await openOutbox(paths.state);
    nativeFactory = async compiled => {
      const native = await createNativeSellerServer(compiled, { facilitatorClient: client });
      return deliveryOutbox ? instrumentNativeSettlement(native, { compiled, outbox: deliveryOutbox,
        onWriteFailure: () => stderr.write('NATIVE_SUCCESS_OUTBOX_WARNING\n') }) : native;
    };
  }
  const { startStellarRpcMerchant } = await import('./merchant.mjs');
  const merchant = await startStellarRpcMerchant({ plan, env, port, operationsPort, nativeFactory,
    navigationOrigin,
    allowLoopbackUpstream: Boolean(options['allow-loopback-upstream']),
    availabilityDirectory: paths['availability-dir'], historyDirectory: paths['history-dir'],
    historyRetentionDays, deliveryOutbox, maxInFlight, drainGraceMs });
  let stopping;
  const close = () => stopping ??= merchant.close().finally(() => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, onSignal);
  });
  function onSignal() {
    close().catch(() => { stderr.write('STELLAR_RPC_SHUTDOWN_FAILED\n'); process.exitCode = 1; });
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
  stdout.write(json({ status: 'STELLAR_RPC_SERVING', mode: merchant.mode, seller: merchant.url,
    dataNetwork: plan.dataNetwork, paymentNetwork: plan.payment.network,
    docs: merchant.url + '/_seller/docs', offers: merchant.url + '/_seller/offers',
    ready: merchant.url + '/_seller/ready', operations: merchant.operations.url,
    availability: merchant.operations.availabilityUrl,
    availabilityControl: merchant.operations.availabilityControlUrl,
    history: paths['history-dir'] ? merchant.operations.url + '/api/history' : null,
    fulfillment: paths.state ? merchant.operations.url + '/fulfillment' : null }));
  return { ...merchant, close };
}

export async function main(args = process.argv.slice(2), {
  env = process.env, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  if (!args.length || args.length === 1 && args[0] === '--help') { stdout.write(USAGE + '\n'); return; }
  if (args[0] === 'workspace') {
    const { main: workspace } = await import('./workspace/cli.mjs');
    return workspace(args.slice(1), { env, stdout, stderr });
  }
  if (args.length === 1 && args[0] === 'template') { const value = template(); stdout.write(json(value)); return value; }
  const { action, options } = parse(args);
  if (action === 'buyer') { const result = await prepareBuyerReview(options); stdout.write(json(result)); return result; }
  const plan = await readPlan(options.plan);
  if (action === 'serve') return startRpcCommand(plan, options, { env, stdout, stderr });
  let result;
  if (action === 'prepare') result = await preparePackage(plan, options.out);
  else if (action === 'inspect') {
    const prepared = prepareProduct(plan);
    result = { dataNetwork: plan.dataNetwork, payment: plan.payment,
      requiredEnvironment: credentialReferences(plan), limits: plan.limits,
      routes: prepared.imported.offers.map(row => ({ method: row.method,
        url: row.seller.resource.url, accepts: row.seller.accepts })) };
  } else {
    const { createStellarRpcApplication } = await import('./application.mjs');
    const application = createStellarRpcApplication(plan, { env,
      allowLoopbackUpstream: Boolean(options['allow-loopback-upstream']) });
    try { result = await application.diagnose(); } finally { await application.close(); }
  }
  stdout.write(json(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(cause => {
  const code = typeof cause?.code === 'string' && /^STELLAR_RPC_[A-Z_]+$/.test(cause.code)
    ? cause.code : 'STELLAR_RPC_COMMAND_FAILED';
  process.stderr.write(code + ': review command options, public plan and private environment; see --help.\n');
  process.exitCode = 1;
});
