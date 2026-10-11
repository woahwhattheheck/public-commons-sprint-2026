#!/usr/bin/env node
// MIT. Operator setup and buyer handoff through the original SF61/SF82/SF88 tools.
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run as compileSeller } from '../../sf61-openapi-seller-import/cli.mjs';
import { prepare as prepareBuyer } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { prepareProduct, PLAN_SCHEMA, METHODS, DATA_NETWORK, admitRequest } from './product.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const shell = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const command = args => args.map(shell).join(' ');
const USAGE = `GetBlock Stellar paid reads — Node 22+, complete source checkout

  template
  inspect  --plan PLAN.json
  prepare  --plan PLAN.json --out NEW_PRIVATE_DIRECTORY
  diagnose --plan PLAN.json
  buyer    --package PACKAGE --method getTransaction|getTransactions|getEvents|getLedgerEntries
           --body-file PRIVATE_REQUEST.json --intent-id STABLE_ID --out NEW_REVIEW.json

Preparation creates the actual original SF61 offers/service and a trusted handler
entry for native SF82 releases or merchant-launch. Only diagnose calls GetBlock:
getNetwork followed by getHealth. No command creates or funds a wallet.`;
const options = {
  inspect: ['plan'], prepare: ['plan', 'out'], diagnose: ['plan'],
  buyer: ['package', 'method', 'body-file', 'intent-id', 'out'],
};
async function readJSON(path, limit = 131072) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new TypeError('Expected a bounded regular JSON file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new TypeError('JSON file exceeds its size limit');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function template() {
  return { schema: PLAN_SCHEMA, publicOrigin: 'https://your-merchant.example',
    endpointEnv: 'GETBLOCK_STELLAR_RPC_URL', payment: { network: 'stellar:testnet',
      asset: 'REPLACE_WITH_ACTUAL_STELLAR_ASSET_CONTRACT', payTo: 'REPLACE_WITH_ACTUAL_MERCHANT_RECIPIENT', maxTimeoutSeconds: 60 },
    operations: METHODS.map(method => ({ method, amountAtomic: 'REPLACE_WITH_YOUR_PRICE' })) };
}
function handlerEntry(plan) {
  return '// Generated trusted application entry. Contains public terms and an environment name only.\n' +
    `import { createGetBlockApplication } from ${JSON.stringify(pathToFileURL(join(here, 'application.mjs')).href)};\n` +
    `const app = createGetBlockApplication(${JSON.stringify(plan)});\n` +
    plan.operations.flatMap(({ method }) => [`export const ${method} = app.handlers.${method};`,
      `export const admit${method} = app.handlers.admit${method};`]).join('\n') +
    '\nexport const getBlockSnapshot = app.snapshot;\n';
}
function runbook(folder, plan) {
  const cli = join(here, 'cli.mjs'), pilot = join(project, 'sf82-seller-pilot/pilot.mjs');
  const release = join(project, 'sf82-seller-pilot/release-cli.mjs');
  const handlers = join(folder, 'handlers.mjs'), compiled = join(folder, 'compiled');
  const staged = ['node', release, 'stage', '--store', '/private/getblock-releases', '--id', 'stellar-reads-v1',
    '--spec', join(folder, 'openapi.json'), '--config', join(folder, 'selections.json'),
    '--bindings', join(folder, 'route-bindings.json'), '--handlers', handlers,
    '--facilitator', 'https://YOUR_ACTUAL_FACILITATOR'];
  return ['# Stellar read merchant', '',
    'Data network: ' + DATA_NETWORK + '. Payment network: ' + plan.payment.network + '.',
    'The prepared files contain the merchant routes and explicit prices. No provider credential was read.', '',
    '## Supply the private endpoint and diagnose', '',
    'Set ' + plan.endpointEnv + ' through the operator secret manager or a private service EnvironmentFile.',
    'Its value is the exact Stellar MAINNET JSON-RPC URL copied from the GetBlock dashboard, including the path token and final slash.',
    'Do not paste the value into a command line, issue, offer, OpenAPI document, buyer config or application log.',
    'This command makes up to two provider reads and prints network/retention metadata only:', '', '```sh',
    command(['node', cli, 'diagnose', '--plan', join(folder, 'plan.json')]), '```', '',
    'Use the returned oldestLedger/latestLedger for current requests. A zero hash and ledger 1 in OpenAPI examples are placeholders, not current chain observations.', '',
    '## Start the original seller', '',
    'Install the original SF30 native dependencies through the established source setup and supply the selected facilitator.',
    'The exact command is:', '', '```sh',
    command(['node', pilot, '--resume', compiled, '--handlers', handlers, '--port', '8423', '--facilitator', 'https://YOUR_ACTUAL_FACILITATOR']),
    '```', '',
    'The original listener is loopback. Terminate HTTPS at the merchant gateway while retaining /stellar/* paths.',
    'Open /_seller/docs for the original developer explorer. The generated /_seller/openapi.json and /_seller/offers describe only public merchant routes.',
    'For the original SF98 settlement outbox and operations view, use:', '', '```sh',
    command(['node', join(project, 'sf30-seller-sdk/operations/merchant-launch.mjs'), '--config', join(compiled, 'seller-service.json'),
      '--handlers', handlers, '--facilitator', 'https://YOUR_ACTUAL_FACILITATOR', '--state', '/private/getblock-merchant/outbox']), '```', '',
    'Use one seller launcher for a given listener. Stop and restart after rotating the endpoint variable; running processes retain their launch-time credential.', '',
    '## Version prices and handler selection with original SF82 releases', '', '```sh',
    command(['node', release, 'init', '--store', '/private/getblock-releases']),
    command(staged),
    command(['node', release, 'inspect', '--store', '/private/getblock-releases', '--id', 'stellar-reads-v1']), '```', '',
    'Activate the staged release using the actual generation returned by the original release store. Run and roll back from its original console.',
    'Stage takes these original spec/selections/bindings inputs. This partner package is not a generic --workspace API package.',
    'Keep the full application checkout immutable; SF82 pins its entry module and the saved inputs, while transitive source remains operator managed.', '',
    '## Prepare a real buyer request', '',
    'Put actual request parameters in a private JSON file. For a next page, reuse the returned cursor and omit ledger bounds. Every page is its own purchase.',
    'The buyer command validates these parameters and passes the selected original offer and exact body file into SF88:', '', '```sh',
    command(['node', cli, 'buyer', '--package', folder, '--method', plan.operations[0].method, '--body-file', '/private/stellar-request.json',
      '--intent-id', 'YOUR_STABLE_PURCHASE_ID', '--out', '/private/stellar-review.json']),
    command(['node', join(project, 'sf88-operator-buyer-cli/cli.mjs'), '--review', '--config', '/private/stellar-review.json']), '```', '',
    'Use the original SF88 native workspace or existing approved signer to execute. The prepared offer is merchant source metadata; the buyer still obtains the live challenge and applies its original approval and spend journal.',
    'For payment uncertainty, reconcile that original operation and ledger before another purchase. The adapter does not repeat or paginate paid requests.', '',
    '## Selected routes', '',
    ...plan.operations.map(row => '- POST ' + plan.publicOrigin + '/stellar/' + row.method + ': ' + row.amountAtomic + ' atomic units.'), '',
    'Requests pass through original admission, native payment verification, the fixed RPC read and original response settlement. RPC error envelopes enter original failure/cancellation handling. A transaction lookup status FAILED or NOT_FOUND is valid purchased data.', '',
  ].join('\n');
}
export async function preparePackage(input, output) {
  const prepared = prepareProduct(input), folder = resolve(output);
  const parent = await lstat(dirname(folder));
  if (!isAbsolute(output) || !parent.isDirectory() || process.platform !== 'win32' && (parent.mode & 0o077))
    throw new TypeError('Choose a new absolute package directory under an existing private parent (0700)');
  await mkdir(folder, { mode: 0o700 });
  const files = { 'plan.json': json(prepared.plan), 'openapi.json': json(prepared.spec),
    'selections.json': json(prepared.selections), 'route-bindings.json': json(prepared.bindings),
    'seller-offers.json': json({ resources: prepared.imported.offers.map(row => row.seller) }),
    'handlers.mjs': handlerEntry(prepared.plan), 'RUN.md': runbook(folder, prepared.plan) };
  for (const [name, content] of Object.entries(files))
    await writeFile(join(folder, name), content, { flag: 'wx', mode: 0o600 });
  await compileSeller(['--spec', join(folder, 'openapi.json'), '--config', join(folder, 'selections.json'),
    '--service-bindings', join(folder, 'route-bindings.json'), '--out', join(folder, 'compiled')]);
  return { status: 'PREPARED', folder, operations: prepared.plan.operations.map(row => row.method),
    dataNetwork: DATA_NETWORK, paymentNetwork: prepared.plan.payment.network,
    requiredEnvironment: prepared.plan.endpointEnv, providerReads: 0 };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return; }
  if (args.length === 1 && args[0] === 'template') { process.stdout.write(json(template())); return; }
  const [action, ...rest] = args, allowed = options[action], supplied = {};
  if (!allowed) throw new TypeError('Unknown command');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2), value = rest[i + 1];
    if (!rest[i].startsWith('--') || !allowed.includes(key) || own(supplied, key) || !value || value.startsWith('--'))
      throw new TypeError('Invalid command options');
    supplied[key] = value;
  }
  if (allowed.some(key => !own(supplied, key))) throw new TypeError('Missing command option');
  let result;
  if (action === 'buyer') {
    const folder = resolve(supplied.package), { plan } = prepareProduct(await readJSON(join(folder, 'plan.json')));
    const index = plan.operations.findIndex(row => row.method === supplied.method);
    if (index < 0) throw new TypeError('Choose a method from this merchant package');
    const body = await readJSON(supplied['body-file'], 1048576);
    const url = plan.publicOrigin + '/stellar/' + supplied.method;
    if (admitRequest(supplied.method, { method: 'POST', body, url: new URL(url), query: {} }, plan.limits) !== true)
      throw new TypeError('Request does not match the selected Stellar read contract');
    result = await prepareBuyer(['--discovery', join(folder, 'seller-offers.json'), '--row', String(index), '--accept', '0',
      '--intent-id', supplied['intent-id'], '--url', url, '--method', 'POST', '--out', supplied.out,
      '--body-file', resolve(supplied['body-file']), '--content-type', 'application/json']);
  } else {
    const prepared = prepareProduct(await readJSON(supplied.plan));
    if (action === 'prepare') result = await preparePackage(prepared.plan, supplied.out);
    else if (action === 'inspect') result = { dataNetwork: DATA_NETWORK, payment: prepared.plan.payment,
      requiredEnvironment: prepared.plan.endpointEnv, limits: prepared.plan.limits,
      routes: prepared.imported.offers.map(row => ({ method: row.method, url: row.seller.resource.url, accepts: row.seller.accepts })) };
    else {
      const { createGetBlockApplication } = await import('./application.mjs');
      result = await createGetBlockApplication(prepared.plan).diagnose({ signal: AbortSignal.timeout(prepared.plan.limits.timeoutMs * 2 + 1000) });
      if (result.status !== 'PROVIDER_MAINNET_READY') process.exitCode = 1;
    }
  }
  process.stdout.write(json(result)); return result;
}
const own = (o, key) => Object.hasOwn(o, key);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  process.stderr.write('GETBLOCK_COMMAND_FAILED: check command options, public plan and private endpoint setup; see --help.\n');
  process.exitCode = 1;
});
