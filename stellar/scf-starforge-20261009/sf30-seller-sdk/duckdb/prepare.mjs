// MIT. Create-only merchant packages around the original DuckDB/SF30 runtime.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readDuckdbSourceFile } from './config.mjs';
import { openDuckdbSourceFile } from './source.mjs';
import { compileDuckdbMerchantPlan } from './merchant-plan.mjs';
import { readSellerConfig } from '../serve.mjs';
export { compileDuckdbMerchantPlan, DUCKDB_MERCHANT_PLAN_SCHEMA } from './merchant-plan.mjs';

const FORMAT = 'stellar-forge.duckdb-merchant-package.v1';
const SDK = fileURLToPath(new URL('../', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = code => Object.assign(new Error(code), { code });
const GENERATED = ['data/source.json', 'plan.json', 'service.json', 'bindings.json', 'review.json', 'openapi.json',
  'client/seller-openapi.json', 'client/seller-client.mjs', 'client/seller-client.d.mts', 'client/package.json',
  'client/README.md', 'launch.mjs', 'README.md'];
const fingerprint = stat => ({ size: String(stat.size), modifiedNs: String(stat.mtimeNs), inode: String(stat.ino) });
const sameFile = (left, right) => ['size', 'modifiedNs', 'inode'].every(key => left[key] === right[key]);
function relativeName(name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') || name.includes('\0') ||
      name.split('/').some(piece => !piece || piece === '.' || piece === '..')) throw fault('DUCKDB_PACKAGE_PATH_INVALID');
  return name;
}
async function regularHandle(path, maximum = null) {
  const canonical = await realpath(path);
  if (canonical !== resolve(path)) throw fault('DUCKDB_PACKAGE_SYMLINK');
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || maximum !== null && stat.size > BigInt(maximum)) throw fault('DUCKDB_PACKAGE_FILE_INVALID');
    return { handle, stat, path: canonical };
  } catch (issue) { await handle.close(); throw issue; }
}
export async function readDuckdbMerchantPlan(filename) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readSmall(resolve(filename), 262144)));
}
async function readSmall(path, maximum) {
  const { handle, stat } = await regularHandle(path, maximum);
  try {
    const bytes = Buffer.alloc(Number(stat.size) + 1); let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!next.bytesRead) break;
      offset += next.bytesRead;
    }
    if (offset > maximum || !sameFile(fingerprint(stat), fingerprint(await handle.stat({ bigint: true }))))
      throw fault('DUCKDB_PACKAGE_FILE_CHANGED');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function createFile(directory, name, value, entries) {
  const bytes = Buffer.from(typeof value === 'string' ? value : json(value));
  const path = resolve(directory, relativeName(name));
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  entries.push({ path: name, bytes: String(bytes.length), sha256: digest(bytes), kind: 'generated' });
}
async function copyDataset(file, base, target) {
  const name = relative(base, file.path).split(sep).join('/');
  relativeName(name);
  if (name === 'source.json' || name.startsWith('source.json/')) throw fault('DUCKDB_PACKAGE_SOURCE_NAME_COLLISION');
  const destination = resolve(target, name);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const { handle: input, stat } = await regularHandle(file.path);
  let output, count = 0n;
  try {
    if (!sameFile(fingerprint(stat), file)) throw fault('DATASET_CHANGED');
    output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      hash.update(chunk); count += BigInt(chunk.length);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw fault('DUCKDB_PACKAGE_WRITE_FAILED');
        offset += bytesWritten;
      }
    }
    if (count !== stat.size || !sameFile(fingerprint(stat), fingerprint(await input.stat({ bigint: true }))))
      throw fault('DATASET_CHANGED');
    await output.sync();
    return { path: 'data/' + name, bytes: String(count), sha256: hash.digest('hex'), kind: 'dataset' };
  } finally { await output?.close(); await input.close(); }
}
function launcherText() {
  return '// Generated by the original SF30 DuckDB merchant preparation workflow.\n' +
    "import { resolve } from 'node:path';\nimport { fileURLToPath, pathToFileURL } from 'node:url';\n" +
    `const sdk = resolve(process.env.SF30_DUCKDB_SDK || ${JSON.stringify(SDK)});\n` +
    "const { runPreparedDuckdbSeller } = await import(pathToFileURL(resolve(sdk, 'duckdb/prepare.mjs')).href);\n" +
    "await runPreparedDuckdbSeller({ directory: fileURLToPath(new URL('./', import.meta.url)), args: process.argv.slice(2) });\n";
}
function packageGuide() {
  return `# Prepared DuckDB merchant

This private directory contains copied declared data, the original source configuration,
your public merchant plan, native SF30 service and bindings, API/client exports and launcher.
Keep the complete directory private: data/source.json contains SQL, data/ contains actual
merchant data, and manifest.json records the original local source location.

From this directory, start the original seller:

\`\`\`sh
node launch.mjs --python /private/duckdb-venv/bin/python --port 8423 --operations-port 8424
\`\`\`

The launcher verifies every saved file and dataset before starting the original reader.
This reads the selected datasets once at startup. Their original native metadata checks
remain active around every query. Changing data, source, plan or service requires a new
package; an existing output is never replaced. After moving this directory, point
SF30_DUCKDB_SDK to the installed original sf30-seller-sdk directory if needed.

Without a facilitator the native service returns HTTP 402 and performs no paid query.
Use the existing --facilitator HTTPS_URL option for the merchant's configured native
runtime. Payment SDK, ownership, trustline and facilitator setup remain with the original
seller instructions. SIGINT/SIGTERM use its existing drain and close lifecycle.

Review review.json and openapi.json before sharing public metadata. They contain only
declared public examples and query/column/parameter metadata, never sampled result rows.
Parameter enums/bounds are public constraints; actual configured defaults are omitted.
client/ is generated by the original developer workspace and includes exact TypeScript
declarations. Importing its client or building a request does not call a payment endpoint.
The saved API snapshot is CHALLENGE_ONLY; the running seller reports its actual mode.
`;
}

/** Inspect the exact plan and expected copy size without SQL or filesystem writes. */
export async function inspectDuckdbMerchantPlan({ sourceFile, planFile } = {}) {
  const declaration = await readDuckdbSourceFile(resolve(sourceFile));
  const plan = await readDuckdbMerchantPlan(planFile);
  const bundle = compileDuckdbMerchantPlan(declaration.queries, plan);
  const files = [...new Map(declaration.snapshot.files.map(file => [file.path, file])).values()];
  return { review: bundle.review, sourceSha256: declaration.sourceSha256,
    datasetFiles: files.length, datasetBytes: String(files.reduce((sum, file) => sum + BigInt(file.size), 0n)) };
}

/** Copy only the declared files, preflight with real DuckDB, export original SDK. */
export async function prepareDuckdbSeller({ sourceFile, planFile, directory, python = 'python3', environment = process.env } = {}) {
  const declaration = await readDuckdbSourceFile(resolve(sourceFile));
  const plan = await readDuckdbMerchantPlan(planFile), bundle = compileDuckdbMerchantPlan(declaration.queries, plan);
  const requested = resolve(directory), parent = await realpath(dirname(requested));
  if (parent !== dirname(requested) || !(await lstat(parent)).isDirectory()) throw fault('DUCKDB_PACKAGE_PARENT_INVALID');
  await mkdir(requested, { mode: 0o700 });
  const target = await realpath(requested), data = resolve(target, 'data');
  await mkdir(data, { mode: 0o700 }); await mkdir(resolve(target, 'client'), { mode: 0o700 });
  const entries = [], datasets = [...new Map(declaration.snapshot.files.map(file => [file.path, file])).values()];
  // Existing source and destinations stay intact on any failure. An incomplete
  // new package has no manifest and cannot be launched through this workflow.
  for (const file of datasets) entries.push(await copyDataset(file, declaration.snapshot.baseDirectory, data));
  const dataDirectories = new Set([data]);
  for (const entry of entries) {
    let parent = dirname(resolve(target, entry.path));
    while (parent !== data) { dataDirectories.add(parent); parent = dirname(parent); }
  }
  for (const path of [...dataDirectories].sort((left, right) => right.length - left.length)) await syncDirectory(path);
  if ((await readDuckdbSourceFile(declaration.path)).sourceSha256 !== declaration.sourceSha256) throw fault('DATASET_CHANGED');
  const sourceConfig = { ...structuredClone(declaration.config), bindings: bundle.bindings };
  if (Buffer.byteLength(json(sourceConfig)) > 262144) throw fault('DUCKDB_CONFIG_TOO_LARGE');
  await createFile(target, 'data/source.json', sourceConfig, entries);
  const opened = await openDuckdbSourceFile(resolve(data, 'source.json'), { python, environment });
  let inspection;
  try { inspection = opened.source.inspect(); }
  finally { await opened.source.close(); }
  const review = { ...bundle.review, nativePreflight: { engineVersion: inspection.engineVersion,
    queries: Object.fromEntries([...new Set(plan.routes.map(route => route.query))].map(name => [name, inspection.columnTypes[name]])) } };
  const openapi = json(bundle.openapi);
  for (const [name, value] of [
    ['plan.json', plan], ['service.json', bundle.service], ['bindings.json', bundle.bindings], ['review.json', review],
    ['openapi.json', openapi], ['client/seller-openapi.json', openapi],
    ['client/seller-client.mjs', bundle.client.javascript], ['client/seller-client.d.mts', bundle.client.declarations],
    ['client/package.json', bundle.client.packageJson], ['client/README.md', bundle.client.readme],
    ['launch.mjs', launcherText()], ['README.md', packageGuide()],
  ]) await createFile(target, name, value, entries);
  await readSellerConfig(resolve(target, 'service.json'));
  const manifest = { schema: FORMAT, createdAt: new Date().toISOString(),
    originalSource: { file: declaration.path, sourceSha256: declaration.sourceSha256 },
    nativePreflight: { engineVersion: inspection.engineVersion },
    files: entries, datasetBytes: String(datasets.reduce((sum, file) => sum + BigInt(file.size), 0n)),
    publicOrigin: bundle.service.publicOrigin, routes: bundle.review.routes.map(({ id, method, url }) => ({ id, method, url })) };
  await createFile(target, 'manifest.json', manifest, []);
  await syncDirectory(data); await syncDirectory(resolve(target, 'client')); await syncDirectory(target);
  return { schema: FORMAT, directory: target, source: resolve(data, 'source.json'), service: resolve(target, 'service.json'),
    plan: resolve(target, 'plan.json'), review: resolve(target, 'review.json'), openapi: resolve(target, 'openapi.json'),
    client: resolve(target, 'client'), launcher: resolve(target, 'launch.mjs'), manifest: resolve(target, 'manifest.json'),
    datasetFiles: datasets.length, datasetBytes: manifest.datasetBytes, nativePreflight: manifest.nativePreflight, routes: manifest.routes };
}

/** Reopen and verify a complete package, including actual dataset bytes. */
export async function verifyPreparedDuckdbSeller({ directory } = {}) {
  const target = await realpath(resolve(directory));
  if (!(await lstat(target)).isDirectory()) throw fault('DUCKDB_PACKAGE_DIRECTORY_INVALID');
  const manifest = JSON.parse((await readSmall(resolve(target, 'manifest.json'), 262144)).toString('utf8'));
  if (manifest.schema !== FORMAT || !Array.isArray(manifest.files) || manifest.files.length > 64)
    throw fault('DUCKDB_PACKAGE_MANIFEST_INVALID');
  const names = new Set(), generated = new Map(), datasetStats = new Map();
  for (const entry of manifest.files) {
    relativeName(entry?.path);
    if (names.has(entry.path) || !['generated', 'dataset'].includes(entry.kind) ||
        typeof entry.bytes !== 'string' || !/^(0|[1-9][0-9]*)$/.test(entry.bytes) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        entry.kind === 'generated' && !GENERATED.includes(entry.path) ||
        entry.kind === 'dataset' && (!entry.path.startsWith('data/') || entry.path === 'data/source.json'))
      throw fault('DUCKDB_PACKAGE_MANIFEST_INVALID');
    names.add(entry.path);
    const path = resolve(target, entry.path);
    if (entry.kind === 'generated') {
      const bytes = await readSmall(path, 16777216);
      if (String(bytes.length) !== entry.bytes || digest(bytes) !== entry.sha256) throw fault('DUCKDB_PACKAGE_ARTIFACT_CHANGED');
      generated.set(entry.path, bytes);
    } else {
      const { handle, stat } = await regularHandle(path);
      try {
        if (String(stat.size) !== entry.bytes) throw fault('DUCKDB_PACKAGE_DATA_CHANGED');
        const hash = createHash('sha256'); let bytes = 0n;
        for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += BigInt(chunk.length); }
        const after = fingerprint(await handle.stat({ bigint: true }));
        if (bytes !== stat.size || !sameFile(fingerprint(stat), after) || hash.digest('hex') !== entry.sha256)
          throw fault('DUCKDB_PACKAGE_DATA_CHANGED');
        datasetStats.set(path, after);
      } finally { await handle.close(); }
    }
  }
  if (GENERATED.some(name => !generated.has(name))) throw fault('DUCKDB_PACKAGE_INCOMPLETE');
  const parsed = name => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(generated.get(name)));
  const sourceConfig = parsed('data/source.json'), plan = parsed('plan.json'), service = parsed('service.json');
  const declaration = await readDuckdbSourceFile(resolve(target, 'data/source.json'));
  if (!isDeepStrictEqual(sourceConfig, declaration.config)) throw fault('DUCKDB_PACKAGE_ARTIFACT_CHANGED');
  const declared = new Set(declaration.snapshot.files.map(file => file.path));
  if (declared.size !== datasetStats.size || [...declared].some(path => !datasetStats.has(path)) ||
      declaration.snapshot.files.some(file => !sameFile(file, datasetStats.get(file.path)))) throw fault('DUCKDB_PACKAGE_DATA_CHANGED');
  const compiled = compileDuckdbMerchantPlan(declaration.queries, plan);
  if (!isDeepStrictEqual(compiled.service, service) || !isDeepStrictEqual({ ...compiled.bindings }, parsed('bindings.json')) ||
      !isDeepStrictEqual({ ...compiled.bindings }, sourceConfig.bindings)) throw fault('DUCKDB_PACKAGE_COMPILED_SOURCE_CHANGED');
  return { schema: FORMAT, directory: target, manifest, sourceConfig, service, review: parsed('review.json'),
    sourceSha256: declaration.sourceSha256, source: resolve(target, 'data/source.json'), config: resolve(target, 'service.json') };
}

/** Reuse the original CLI, facilitator options, listener and shutdown lifecycle. */
export async function runPreparedDuckdbSeller({ directory, args = [] } = {}) {
  const bundle = await verifyPreparedDuckdbSeller({ directory });
  const { main } = await import('./start.mjs');
  return main(['--source', bundle.source, '--config', bundle.config, ...args], {
    expectedSourceSha256: bundle.sourceSha256, expectedSourceConfig: bundle.sourceConfig, expectedServiceConfig: bundle.service,
  });
}
