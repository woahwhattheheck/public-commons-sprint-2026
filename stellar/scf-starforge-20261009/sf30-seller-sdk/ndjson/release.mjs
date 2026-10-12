// MIT. A retained NDJSON merchant in the original SF82 dataset release lifecycle.
import { constants } from 'node:fs';
import { open, lstat, readFile, writeFile, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inspectNdjsonMerchant } from './merchant.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease }
  from '../../sf82-seller-pilot/release-dataset.mjs';

export const NDJSON_RELEASE_SOURCE_SCHEMA = 'stellar-forge.ndjson-release-source.v1';
const HASH = /^[a-f0-9]{64}$/;
const MiB = 1024 * 1024;
const RAW = [
  ['source.ndjson', 'source/source.ndjson'],
  ['plan.json', 'source/plan.json'],
  ['ndjson-lineage.json', 'source/ndjson-lineage.json'],
];
const CLIENT = ['seller-client.mjs', 'seller-client.d.mts', 'seller-openapi.json',
  'package.json', 'README.md', 'client-export.json'];
const CLOSURE = [...RAW.map(([, path]) => path), 'openapi.json',
  ...CLIENT.map(name => 'customer/' + name)].sort();
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (condition, message) => {
  if (!condition) throw Object.assign(new Error(message), { code: 'NDJSON_RELEASE_CHANGED' });
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function canonicalDirectory(input) {
  need(typeof input === 'string' && isAbsolute(input) && resolve(input) === input,
    'Use a canonical absolute directory.');
  const info = await lstat(input);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(input) === input,
    'Use an original directory without symlinks.');
  return input;
}
async function privateParent(input) {
  const parent = await canonicalDirectory(dirname(input)), info = await lstat(parent);
  need(process.platform === 'win32' || !(info.mode & 0o077),
    'Create the package in an existing private parent directory (0700).');
  return parent;
}
async function readJson(path, maximum = MiB) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() && info.size <= maximum && await realpath(path) === path,
    'Use a bounded retained JSON file.');
  const raw = await readFile(path);
  need(raw.length === info.size && raw.length <= maximum, 'Retained JSON changed while reading.');
  return { raw, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) };
}
async function retain(from, to, expected) {
  need(object(expected) && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 &&
    expected.bytes <= 256 * MiB && HASH.test(expected.sha256 ?? ''), 'Invalid original file identity.');
  need(await realpath(from) === from, 'Retained source paths cannot contain symlinks.');
  const input = await open(from, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output;
  try {
    const before = await input.stat({ bigint: true });
    need(before.isFile() && before.size === BigInt(expected.bytes), 'Original file size changed.');
    if (to) output = await open(to, 'wx', 0o600);
    const digest = createHash('sha256'); let used = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      used += chunk.length;
      need(used <= expected.bytes, 'Original file grew during preparation.');
      digest.update(chunk);
      if (output) await output.writeFile(chunk);
    }
    const after = await input.stat({ bigint: true });
    need(used === expected.bytes && digest.digest('hex') === expected.sha256 &&
      before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
      'Original file bytes changed during preparation.');
    if (output) await output.sync();
  } finally { await output?.close(); await input.close(); }
  return expected;
}
async function identity(path) {
  const input = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await input.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(256 * MiB), 'Invalid release file.');
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      bytes += chunk.length; need(bytes <= 256 * MiB, 'Release file exceeds its size limit.'); digest.update(chunk);
    }
    const after = await input.stat({ bigint: true });
    need(BigInt(bytes) === before.size && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'Release file changed while reading.');
    return { bytes, sha256: digest.digest('hex') };
  } finally { await input.close(); }
}
async function save(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(Buffer.isBuffer(value) ? value : json(value)); await file.sync(); }
  finally { await file.close(); }
}
async function sync(path) {
  if (process.platform === 'win32') return;
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
function lineage(review, source, plan, dataset, csv) {
  need(object(review) && review.schema === 'stellar-forge.ndjson-build.v1' &&
    HASH.test(review.source ?? '') && HASH.test(review.plan ?? '') && HASH.test(review.id ?? '') &&
    review.source === source.sha256 && review.plan === plan.sha256 &&
    review.native?.snapshot === dataset.snapshot && isDeepStrictEqual(review.files?.['data.csv'], csv),
    'The raw source, mapping, dataset and lineage must be one completed original build.');
  const expectedBuild = hash(Buffer.from(JSON.stringify({
    plan: review.plan, schema: 'stellar-forge.ndjson-build.v1', source: review.source,
  }) + '\n'));
  need(review.id === expectedBuild, 'The lineage build identity changed.');
}
function summary(prepared, source, review, directory) {
  return { schema: NDJSON_RELEASE_SOURCE_SCHEMA, directory, datasetDirectory: prepared.binding.datasetDirectory,
    source: source.source, plan: source.plan, build: source.build, snapshot: prepared.description.snapshot,
    merchantSha256: source.merchantSha256, description: prepared.description,
    sourceFiles: prepared.sourceFiles, files: prepared.files, dataset: prepared.dataset,
    customer: source.customer, lineage: review };
}

/** Inspect source provenance through the original static SF82 preparer. This does
 * not open, initialize or acquire the live version-store lease. */
export async function inspectNdjsonRelease({ directory } = {}) {
  directory = await canonicalDirectory(directory);
  const prepared = await prepareDatasetRelease(directory);
  const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(prepared.retained['source.json']));
  need(source?.schema === NDJSON_RELEASE_SOURCE_SCHEMA &&
    ['source', 'plan', 'build', 'snapshot', 'merchantSha256'].every(key => HASH.test(source[key] ?? '')) &&
    source.snapshot === prepared.description.snapshot &&
    isDeepStrictEqual(prepared.sourceFiles.map(file => file.path).sort(), CLOSURE),
    'Use a complete original NDJSON release package.');
  const descriptors = Object.fromEntries(prepared.sourceFiles.map(file => [file.path, file]));
  const { value: review } = await readJson(join(directory, 'source/ndjson-lineage.json'), 131072);
  lineage(review, descriptors['source/source.ndjson'], descriptors['source/plan.json'],
    prepared.description, { bytes: prepared.retained['dataset.csv'].length, sha256: hash(prepared.retained['dataset.csv']) });
  need(source.source === review.source && source.plan === review.plan && source.build === review.id,
    'Source provenance differs from its original lineage.');
  const { value: mapping } = await readJson(join(directory, 'source/plan.json'), 65536);
  need(object(mapping), 'The original mapping must be an object.');
  need(source.customer?.manifest === 'customer/client-export.json' &&
    HASH.test(source.customer?.filesSha256 ?? ''), 'The original versioned customer SDK is missing.');
  return summary(prepared, source, review, directory);
}

/** Prepare the same original SF82 package and its complete source closure.
 * Initialization and publication belong to the original version controller. */
export async function prepareNdjsonRelease({ prepared, datasetDirectory, outputDirectory } = {}) {
  const merchant = await inspectNdjsonMerchant({ prepared });
  const root = await canonicalDirectory(merchant.directory);
  need(typeof datasetDirectory === 'string' && isAbsolute(datasetDirectory) &&
    resolve(datasetDirectory) === datasetDirectory && datasetDirectory !== '/',
    'Select the original absolute dataset version-store directory.');
  need(typeof outputDirectory === 'string' && isAbsolute(outputDirectory) &&
    resolve(outputDirectory) === outputDirectory && outputDirectory !== root &&
    !outputDirectory.startsWith(root + '/'), 'Choose a separate absolute release package directory.');
  const parent = await privateParent(outputDirectory);
  const { raw: merchantBytes } = await readJson(join(root, 'merchant.json'));
  const merchantSha256 = hash(merchantBytes);
  let present = true;
  try { await lstat(outputDirectory); }
  catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
  if (present) {
    const existing = await inspectNdjsonRelease({ directory: outputDirectory });
    need(existing.merchantSha256 === merchantSha256 && existing.datasetDirectory === datasetDirectory &&
      existing.source === merchant.source && existing.plan === merchant.plan &&
      existing.build === merchant.build && existing.snapshot === merchant.snapshot,
      'An existing release package belongs to a different reviewed merchant or version store.');
    return { ...existing, reused: true };
  }
  const { value: review } = await readJson(join(root, 'ndjson-lineage.json'), 131072);
  const { value: config } = await readJson(join(root, 'dataset.json'), 65536);
  const { value: seller } = await readJson(join(root, 'seller.json'));
  lineage(review, merchant.files['source.ndjson'], merchant.files['plan.json'],
    merchant.dataset, merchant.files['data.csv']);
  need(review.source === merchant.source && review.plan === merchant.plan &&
    review.id === merchant.build && isDeepStrictEqual(review.files?.['dataset.json'], merchant.files['dataset.json']),
    'The merchant and native source review changed.');
  need(seller.routes?.length === 1 && object(seller.routes[0].definition) &&
    Array.isArray(seller.routes[0].definition.queryParameters) &&
    !seller.routes[0].definition.queryParameters.some(parameter => parameter.name === 'snapshot'),
    'Use the original prepared merchant query definition.');
  seller.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
  const temporary = await mkdtemp(join(parent, '.ndjson-release-'));
  try {
    await mkdir(join(temporary, 'source'), { mode: 0o700 });
    await retain(join(root, 'data.csv'), join(temporary, 'dataset.csv'), merchant.files['data.csv']);
    await save(join(temporary, 'dataset.json'), { ...config, file: 'dataset.csv' });
    await save(join(temporary, 'seller.json'), seller);
    for (const [original, path] of RAW)
      await retain(join(root, original), join(temporary, path), merchant.files[original]);
    const native = await loadDatasetConfig(join(temporary, 'dataset.json'));
    need(native.describe().snapshot === merchant.snapshot, 'Renamed native package changed the dataset snapshot.');
    const compiled = compileSellerRoutes(seller.routes.map(route => ({
      id: route.id, definition: { ...route.definition, url: seller.publicOrigin + route.path },
      handler: native.handle, admit: native.admit,
    })));
    await save(join(temporary, 'openapi.json'), compileSellerOpenApi(compiled));
    const customer = await exportSellerClient({ openapi: join(temporary, 'openapi.json'),
      out: join(temporary, 'customer') });
    const sourceFiles = [];
    for (const path of CLOSURE) sourceFiles.push({ path, ...await identity(join(temporary, path)) });
    const source = { schema: NDJSON_RELEASE_SOURCE_SCHEMA,
      source: merchant.source, plan: merchant.plan, build: merchant.build, snapshot: merchant.snapshot,
      merchantSha256, sourceFiles,
      customer: { manifest: 'customer/client-export.json', filesSha256: customer.filesSha256 } };
    const sourceBytes = json(source);
    await save(join(temporary, 'source.json'), sourceBytes);
    await save(join(temporary, 'binding.json'), {
      schema: DATASET_BINDING_SCHEMA, datasetDirectory,
      contractSha256: datasetContractSha256(native.describe()),
      baselineSnapshot: native.describe().snapshot, sourceSha256: hash(sourceBytes),
    });
    await inspectNdjsonRelease({ directory: temporary });
    await sync(join(temporary, 'source')); await sync(join(temporary, 'customer')); await sync(temporary);
    // A concurrent prepare may have published this exact destination. Its original
    // package is reopened and compared; a different destination is never replaced.
    try { await rename(temporary, outputDirectory); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const existing = await inspectNdjsonRelease({ directory: outputDirectory });
      need(existing.merchantSha256 === merchantSha256 && existing.datasetDirectory === datasetDirectory,
        'The destination was published for another merchant.');
      return { ...existing, reused: true };
    }
    await sync(parent);
    return { ...await inspectNdjsonRelease({ directory: outputDirectory }), reused: false };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
