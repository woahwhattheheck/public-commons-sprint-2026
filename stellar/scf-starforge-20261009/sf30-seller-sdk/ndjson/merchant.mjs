// MIT. Prepare and launch the original seller for a retained NDJSON dataset.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const SCHEMA = 'stellar-forge.ndjson-merchant.v1';
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 256 * 1024 * 1024;
const rootFiles = ['data.csv', 'dataset.json', 'ndjson-lineage.json', 'source.ndjson',
  'plan.json', 'payment.json', 'seller.json', 'openapi.json', 'OPERATING.md'];
const clientFiles = ['seller-client.mjs', 'seller-client.d.mts', 'seller-openapi.json',
  'package.json', 'README.md', 'client-export.json'].map(name => 'customer/' + name);
const files = [...rootFiles, ...clientFiles].sort();
const json = value => JSON.stringify(value, null, 2) + '\n';

async function jsonFile(path, maximum = 256 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error('Invalid retained JSON file');
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw new Error('Retained JSON exceeds its size limit');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function fileIdentity(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Invalid retained merchant file');
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error('Merchant file exceeds 256 MiB');
    hash.update(chunk);
  }
  if (bytes !== info.size) throw new Error('Merchant file changed while being read');
  return { bytes, sha256: hash.digest('hex') };
}
async function write(path, value) {
  await writeFile(path, typeof value === 'string' ? value : json(value), { flag: 'wx', mode: 0o600 });
}
async function directory(input) {
  const path = resolve(input), info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Use a retained real merchant directory');
  return path;
}

export async function prepareNdjsonMerchant({ prepared, origin, path = '/data' } = {}) {
  const root = await directory(prepared);
  const review = await jsonFile(join(root, 'ndjson-lineage.json'));
  if (review.schema !== 'stellar-forge.ndjson-build.v1' ||
      !HASH.test(review.source ?? '') || !HASH.test(review.plan ?? ''))
    throw new Error('Use the completed original NDJSON workspace export');
  for (const [name, expected] of [['source.ndjson', review.source], ['plan.json', review.plan],
      ['data.csv', review.files?.['data.csv']?.sha256], ['dataset.json', review.files?.['dataset.json']?.sha256]]) {
    if ((await fileIdentity(join(root, name))).sha256 !== expected) throw new Error('Retained source or projection changed: ' + name);
  }
  const [{ loadDatasetConfig }, { buildDatasetSellerConfig }, { compileSellerRoutes },
    { compileSellerOpenApi }, { exportSellerClient }] = await Promise.all([
    import('../dataset-handler.mjs'), import('../dataset-cli.mjs'), import('../resource-server.mjs'),
    import('../developer-portal.mjs'), import('../developer/client-export.mjs'),
  ]);
  const dataset = await loadDatasetConfig(join(root, 'dataset.json'));
  if (dataset.describe().snapshot !== review.native?.snapshot)
    throw new Error('Native dataset snapshot differs from its completed source review');
  const payment = await jsonFile(join(root, 'payment.json'), 16384);
  const seller = await buildDatasetSellerConfig(dataset, { payment, origin, path });
  const compiled = compileSellerRoutes(seller.routes.map(route => ({
    id: route.id, definition: { ...route.definition, url: seller.publicOrigin + route.path },
    handler: dataset.handle, admit: dataset.admit,
  })));
  const openapi = compileSellerOpenApi(compiled);
  await write(join(root, 'seller.json'), seller);
  await write(join(root, 'openapi.json'), openapi);
  const customer = await exportSellerClient({ openapi: join(root, 'openapi.json'), out: join(root, 'customer') });
  await write(join(root, 'OPERATING.md'), [
    '# NDJSON merchant and customer handoff', '',
    'This package contains the original JSON Lines export, reviewed mapping, native CSV dataset, seller configuration and generated customer SDK.',
    'Keep this whole directory private. Only the configured dataset route and the original seller metadata belong on the public ingress.', '',
    '## Start the original seller', '',
    'From the installed toolkit, run:',
    '~~~sh',
    'starforge dataset-ndjson-merchant status --prepared /absolute/merchant',
    'starforge dataset-ndjson-merchant serve --prepared /absolute/merchant --port 8423',
    '~~~',
    'The second command opens the original challenge-only seller and developer page. Configure the original native x402 dependencies and add --facilitator with the actual operator-selected URL for native settlement. The original --allow-local-facilitator, --max-in-flight, --drain-grace-ms and --availability-dir controls remain available.',
    'Use the printed health and developer URLs. Customer files are in customer/; begin with its original README.md. This prepared OpenAPI describes the challenge-only configuration. The running seller exposes its actual native mode through /_seller/openapi.json.', '',
    '## Recover or prepare a new edition', '',
    'Reopen this package with status before launch. It checks the complete file manifest and loads the same original dataset engine.',
    'To restore the source workspace, initialize a new NDJSON workspace, import source.ndjson with its source command, save plan.json with its plan command, then build the returned source and mapping IDs. The resulting build ID and native snapshot must equal ndjson-lineage.json.',
    'The original source project ZIP from the NDJSON workspace supports this reconstruction through its single import command.',
    'A new source edition uses the same retained mapping. Inspect its keyed comparison before preparing a new merchant directory. Existing merchant releases and buyer operations keep their original paths, selected terms and intent IDs.', '',
    '## Selected source', '',
    'Source SHA-256: ' + review.source,
    'Mapping SHA-256: ' + review.plan,
    'Build: ' + review.id,
    'Native dataset snapshot: ' + dataset.describe().snapshot,
    'Public origin: ' + seller.publicOrigin,
    'Resource: ' + seller.publicOrigin + path,
    'Rows: ' + dataset.describe().rowCount, '',
    'Native amounts remain exact atomic-unit strings in payment.json. One original paid request retrieves one dataset page; continue the original returned cursor without changing its filters or selected fields.', '',
  ].join('\n'));
  const identities = {};
  for (const name of files) identities[name] = await fileIdentity(join(root, name));
  const manifest = { schema: SCHEMA, state: 'PREPARED', source: review.source, plan: review.plan,
    build: review.id, snapshot: dataset.describe().snapshot, origin: seller.publicOrigin,
    resource: seller.publicOrigin + path, files: identities,
    customer: { manifest: customer.manifest, filesSha256: customer.filesSha256 } };
  await write(join(root, 'merchant.json'), manifest);
  return { directory: root, ...manifest };
}

export async function inspectNdjsonMerchant({ prepared } = {}) {
  const root = await directory(prepared);
  const manifest = await jsonFile(join(root, 'merchant.json'));
  if (manifest.schema !== SCHEMA || manifest.state !== 'PREPARED' ||
      !HASH.test(manifest.snapshot ?? '') || !manifest.files ||
      Object.keys(manifest.files).sort().join('\0') !== files.join('\0'))
    throw new Error('Incomplete or unsupported NDJSON merchant package');
  for (const name of files) {
    const actual = await fileIdentity(join(root, name)), expected = manifest.files[name];
    if (!expected || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error('Retained merchant file changed: ' + name);
  }
  const { loadDatasetConfig } = await import('../dataset-handler.mjs');
  const dataset = await loadDatasetConfig(join(root, 'dataset.json'));
  if (dataset.describe().snapshot !== manifest.snapshot) throw new Error('Native dataset snapshot changed');
  const seller = await jsonFile(join(root, 'seller.json'));
  if (seller.publicOrigin !== manifest.origin || seller.routes?.length !== 1 ||
      seller.publicOrigin + seller.routes[0].path !== manifest.resource)
    throw new Error('Merchant route differs from the original prepared package');
  return { directory: root, ...manifest, dataset: dataset.describe() };
}

async function originalSeller(root, args) {
  if (args.includes('--config') || args.includes('--handlers'))
    throw new Error('The prepared package supplies its original config and dataset handlers');
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../serve.mjs', import.meta.url)),
    '--config', join(root, 'seller.json'),
    '--handlers', fileURLToPath(new URL('../examples/dataset-application.mjs', import.meta.url)), ...args,
  ], { shell: false, stdio: 'inherit',
    env: { ...process.env, SF30_DATASET_CONFIG: join(root, 'dataset.json') } });
  const stop = signal => child.kill(signal);
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((done, fail) => {
      child.once('error', fail);
      child.once('exit', (code, signal) => done(code ?? (signal ? 130 : 1)));
    });
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('NDJSON merchant:\n  status --prepared DIRECTORY\n  serve --prepared DIRECTORY [original seller options]\n  prepare --prepared WORKSPACE_EXPORT --origin HTTPS_ORIGIN [--path /data]');
    return;
  }
  const [command, ...rest] = args;
  if (!['prepare', 'status', 'serve'].includes(command)) throw new Error('Choose prepare, status or serve; use --help');
  const index = rest.indexOf('--prepared');
  if (index < 0 || !rest[index + 1] || rest[index + 1].startsWith('--') || rest.lastIndexOf('--prepared') !== index)
    throw new Error('Supply one --prepared directory');
  const prepared = rest[index + 1]; rest.splice(index, 2);
  if (command === 'serve') {
    const current = await inspectNdjsonMerchant({ prepared });
    return originalSeller(current.directory, rest);
  }
  if (command === 'status') {
    if (rest.length) throw new Error('status accepts only --prepared');
    console.log(json(await inspectNdjsonMerchant({ prepared }))); return;
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!['--origin', '--path'].includes(flag) || options[flag] !== undefined ||
        !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Invalid merchant preparation options');
    options[flag] = rest[i + 1];
  }
  if (!options['--origin']) throw new Error('--origin is required');
  console.log(json(await prepareNdjsonMerchant({ prepared, origin: options['--origin'], path: options['--path'] })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('NDJSON merchant: ' + error.message); process.exitCode = 1; });
