#!/usr/bin/env node
// MIT. Build a relocatable product from one Git commit, never from local state.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_SCHEMA, MANIFEST, MAX_BYTES, canonical, sha256, relativePath,
  putFile, verifyRelease } from './release-core.mjs';

const exec = promisify(execFile);
const BASE = 'stellar/scf-starforge-20261009/';
const SCOPES = ['scf46-stellar-bazaar', 'stellar-forge', BASE.slice(0, -1), 'LICENSE'];
const COMMANDS = {
  seller: ['sf30-seller-sdk/serve.mjs', 'Serve a configured native seller'],
  operations: ['sf30-seller-sdk/operations/launch.mjs', 'Run seller and its operations console together'],
  upstream: ['sf30-seller-sdk/upstream-serve.mjs', 'Protect an existing authorized API'],
  openapi: ['sf61-openapi-seller-import/cli.mjs', 'Compile original OpenAPI routes and bindings'],
  pilot: ['sf82-seller-pilot/pilot.mjs', 'Create or resume an OpenAPI seller pilot'],
  'pilot-ops': ['sf96-seller-pilot-ops/pilot-ops.mjs', 'Run the same pilot with operations and support capture'],
  buyer: ['sf88-operator-buyer-cli/cli.mjs', 'Review, discover, or explicitly execute an original buyer operation'],
  capture: ['sf85-live-402-capture/capture.mjs', 'Capture a real merchant payment challenge'],
  handoff: ['sf96-merchant-challenge-handoff/handoff.mjs', 'Prepare a captured challenge for original buyer review'],
  support: ['sf93-seller-support-bundle/bundle.mjs', 'Export private support data from a running seller'],
  'seller-check': ['sf96-seller-acceptance/audit.mjs', 'Inspect configured seller challenge routes'],
};
const USAGE = 'node distribution.mjs pack --source REPOSITORY --out NEW_DIRECTORY [--ref COMMIT] [--version 0.1.0]';

async function git(root, args) {
  return (await exec('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: MAX_BYTES })).stdout;
}
async function objects(root, entries) {
  const child = spawn('git', ['-C', root, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = []; let length = 0, stderr = '';
  const finished = new Promise((accept, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > MAX_BYTES + entries.length * 100) { child.kill(); reject(new Error('Release exceeds size limit')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 2000); });
    child.on('close', code => code === 0 ? accept(Buffer.concat(chunks)) : reject(new Error('Git object read failed: ' + stderr)));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(entries.map(entry => entry.oid + '\n').join(''));
  const bytes = await finished, result = new Map(); let offset = 0;
  for (const entry of entries) {
    const end = bytes.indexOf(10, offset);
    const [oid, type, sizeText] = bytes.subarray(offset, end).toString('ascii').split(' ');
    const size = Number(sizeText), start = end + 1;
    if (end < 0 || oid !== entry.oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 ||
        start + size >= bytes.length || bytes[start + size] !== 10) throw new Error('Invalid Git object stream');
    result.set(entry.path, bytes.subarray(start, start + size)); offset = start + size + 1;
  }
  if (offset !== bytes.length) throw new Error('Unexpected Git object stream tail');
  return result;
}

export async function pack({ source, out, ref = 'HEAD', version = '0.1.0' }) {
  if (!source || !out || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
      (ref !== 'HEAD' && !/^[0-9a-f]{40}$/.test(ref))) throw new Error(USAGE);
  source = resolve(source); out = resolve(out);
  if (out === source || out.startsWith(source + '/')) throw new Error('Build the release outside its source checkout');
  const commit = (await git(source, ['rev-parse', '--verify', ref + '^{commit}'])).toString().trim();
  const listing = (await git(source, ['ls-tree', '-r', '-z', commit, '--', ...SCOPES])).toString('utf8');
  const entries = listing.split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error('Release sources must be ordinary tracked files');
    return { mode: match[1] === '100755' ? 0o755 : 0o644, oid: match[2], path: relativePath(match[3]) };
  }).filter(entry => !entry.path.split('/').some(part => ['test', 'tests', 'node_modules', '.git'].includes(part)) &&
    !/\.test\.[^.]+$/.test(entry.path)).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const sourceBytes = await objects(source, entries);
  const nativeSource = sourceBytes.get(BASE + 'sf30-seller-sdk/native-factory.mjs')?.toString('utf8') ?? '';
  const nativeVersion = /NATIVE_SDK_VERSION\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'/.exec(nativeSource)?.[1];
  if (!nativeVersion) throw new Error('Native seller has no explicit SDK version');
  const commands = {};
  for (const [name, [path, summary]] of Object.entries(COMMANDS)) {
    if (!sourceBytes.has(BASE + path)) throw new Error('Original native command missing: ' + path);
    commands[name] = { path: BASE + path, summary };
  }
  // New modules can participate once they actually exist at the selected commit.
  const optional = [
    ['dataset', 'sf30-seller-sdk/dataset-cli.mjs', 'Inspect an original CSV dataset or compile its seller configuration'],
    ['dataset-refresh', 'sf30-seller-sdk/dataset-refresh/cli.mjs', 'Initialize, serve, refresh and activate retained native dataset versions'],
    ['dataset-workspace', 'sf30-seller-sdk/dataset-workspace.mjs', 'Inspect, preview and activate retained native dataset versions'],
    ['dataset-publisher', 'sf30-seller-sdk/dataset-refresh/workspace.mjs', 'Publish CSV revisions and prepare original buyer acquisition from a selected offer'],
    ['catalog', 'sf60-durable-catalog-transaction/operator-cli.mjs', 'Inspect or update the original live catalog through private control'],
    ['catalog-operator', 'sf60-durable-catalog-transaction/operator-cli.mjs', 'Alias of catalog for the original live operator commands'],
    ['catalog-serve', 'sf60-durable-catalog-transaction/operator.mjs', 'Serve live discovery and the original private catalog writer'],
    ['catalog-withdrawal', 'sf95-signed-seller-withdrawal/cli.mjs', 'Prepare or sign an original seller withdrawal request'],
    ['buyer-dataset', 'sf88-operator-buyer-cli/dataset-cli.mjs', 'Acquire, resume and deliver native dataset pages with the original buyer'],
    ['dataset-delivery', 'sf88-operator-buyer-cli/queue-dataset-cli.mjs', 'Assemble saved original inbox pages through native dataset delivery'],
    ['buyer-inbox', 'sf88-operator-buyer-cli/queue-cli.mjs', 'Inspect the original inbox and execute one selected intent'],
    ['buyer-runbook', 'buyer-runbook/cli.mjs', 'Plan and resume an original multi-resource buying run'],
    ['buyer-node', 'sf88-operator-buyer-cli/node/examples/customer.mjs', 'Review, execute and recover a durable generated-client application request'],
    ['merchant-fleet', 'merchant-fleet-gateway/cli.mjs', 'Run the original merchant gateway with retained rollout state'],
    ['merchant-fleet-control', 'merchant-fleet-gateway/control.mjs', 'Prepare, activate, inspect or roll back native merchant configuration'],
    ['merchant-fleet-workspace', 'merchant-fleet-gateway/workspace/server.mjs', 'Inspect and manage the original retained merchant fleet'],
    ['fleet-release', 'merchant-fleet-gateway/release-cli.mjs', 'Stage and manage original seller releases, draining and restart rollback'],
    ['revenue-workspace', 'sf97-merchant-revenue-ops/workspace/cli.mjs', 'Review merchant pricing and save original operational reports'],
    ['revenue-report', 'sf97-merchant-revenue-ops/analyze.mjs', 'Create the original merchant revenue and native settlement report'],
    ['merchant-accounting', 'merchant-settlement-accounting/cli.mjs', 'Reconcile original settlement sources against reviewed merchant terms'],
    ['merchant-accounting-workspace', 'merchant-settlement-accounting/workspace/server.mjs', 'Retain, reconcile, compare and review original merchant accounting sources'],
    ['merchant-accounting-pricing', 'merchant-settlement-accounting/pricing-cli.mjs', 'Import a saved original pricing report as merchant accounting terms'],
    ['merchant-accounting-recovery', 'merchant-settlement-accounting/recovery-cli.mjs', 'Review and retain an original completed purchase for merchant accounting'],
    ['deploy', 'sf99-merchant-deploy/cli.mjs', 'Generate the original HTTPS host deployment'],
    ['postgres', 'sf30-seller-sdk/postgres/start.mjs', 'Run the original PostgreSQL merchant seller'],
    ['postgres-init', 'sf30-seller-sdk/postgres/create-example.mjs', 'Create a PostgreSQL source and seller starter'],
    ['postgres-inspect', 'sf30-seller-sdk/postgres/inspect.mjs', 'Inspect or preflight an original PostgreSQL source'],
    ['postgres-workspace', 'sf30-seller-sdk/postgres/workspace/server.mjs', 'Build a merchant API from selected database fields'],
  ];
  for (const [name, path, summary] of optional) if (sourceBytes.has(BASE + path)) commands[name] = { path: BASE + path, summary };
  const launcher = sourceBytes.get(BASE + 'sf46-release/product.mjs');
  const core = sourceBytes.get(BASE + 'sf46-release/release-core.mjs');
  if (!launcher || !core) throw new Error('Commit the product release source before packaging');
  const nativePackages = Object.fromEntries(['@x402/core', '@x402/stellar', '@x402/extensions', '@x402/fetch'].map(name => [name, nativeVersion]));
  const adapterPackages = Object.create(null), adapterPackageSources = {};
  const postgresManifest = BASE + 'sf30-seller-sdk/postgres/package.json';
  if (commands.postgres) {
    const bytes = sourceBytes.get(postgresManifest);
    if (!bytes) throw new Error('Original PostgreSQL dependency manifest missing');
    const dependencies = JSON.parse(bytes).dependencies;
    if (!dependencies?.pg) throw new Error('Original PostgreSQL production driver missing');
    for (const [name, version] of Object.entries(dependencies)) {
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
          !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || Object.hasOwn(nativePackages, name))
        throw new Error('Invalid original PostgreSQL dependency');
      adapterPackages[name] = version;
    }
    adapterPackageSources.postgres = postgresManifest;
  }
  const additions = new Map([
    ['forge.mjs', launcher], ['release-core.mjs', core],
    ['package.json', Buffer.from(JSON.stringify({ name: 'stellar-forge-portable', version, private: true,
      type: 'module', license: 'MIT', engines: { node: '>=22' },
      optionalDependencies: { ...nativePackages, ...adapterPackages } }, null, 2) + '\n')],
    ['START_HERE.md', Buffer.from(`# Stellar Forge ${version}\n\nSource commit: ${commit}\n\nRun \`node forge.mjs help\` for the product commands.\n\nA cold start, installation, upgrade and rollback guide is included at\n\`${BASE}sf46-release/DISTRIBUTION.md\`.\n\nConfiguration and merchant data belong outside the release. All native command\narguments retain their original meanings and are resolved from your working directory.\nChallenge-only seller, compiler, review and local operations need Node 22+ only.\nOptional native payments use the original configured facilitator and signer.\nTo install the optional native SDK and database drivers explicitly, run \`npm install --ignore-scripts --omit=dev\`\nin this release directory, then \`node forge.mjs doctor\`. Dependency installation\ndoes not configure a facilitator, supply a signer or authorize a payment.\n\nOriginal source and licenses are included. No tests or hosted CI entrypoints are run by this launcher.\n`)],
  ]);
  const files = [...entries.map(entry => ({ path: entry.path, mode: entry.mode, gitBlob: entry.oid,
    bytes: sourceBytes.get(entry.path).length, sha256: sha256(sourceBytes.get(entry.path)) })),
    ...[...additions].map(([path, bytes]) => ({ path, mode: path === 'forge.mjs' ? 0o755 : 0o644, bytes: bytes.length, sha256: sha256(bytes) }))]
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (files.reduce((sum, item) => sum + item.bytes, 0) > MAX_BYTES) throw new Error('Release exceeds size limit');
  const body = { schema: RELEASE_SCHEMA, product: 'Stellar Forge', version,
    source: { repository: 'woahwhattheheck/public-commons-sprint-2026', commit },
    runtime: { minimumNodeMajor: 22, nativePackages, nativePackageSource: BASE + 'sf30-seller-sdk/native-factory.mjs',
      adapterPackages, adapterPackageSources },
    commands, files };
  const manifest = { ...body, digest: sha256(canonical(body)) };
  await mkdir(out, { mode: 0o755 });
  try {
    for (const file of files) await putFile(join(out, file.path), additions.get(file.path) ?? sourceBytes.get(file.path), file.mode);
    await putFile(join(out, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
    const verified = await verifyRelease(out, manifest.digest);
    return { release: out, id: verified.id, digest: manifest.digest, commit,
      files: files.length, bytes: verified.totalBytes, commands: Object.keys(commands) };
  } catch (error) { await rm(out, { recursive: true, force: true }); throw error; }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) { console.log(USAGE); return; }
  if (args[0] !== 'pack') throw new Error(USAGE);
  const values = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    if (!['--source', '--out', '--ref', '--version'].includes(key) || values[key] || !args[index + 1]) throw new Error(USAGE);
    values[key] = args[index + 1];
  }
  console.log(JSON.stringify(await pack({ source: values['--source'], out: values['--out'], ref: values['--ref'], version: values['--version'] }), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
