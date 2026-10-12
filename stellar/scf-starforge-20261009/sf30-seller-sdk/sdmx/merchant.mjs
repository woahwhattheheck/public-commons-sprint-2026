// MIT. Retained SDMX editions through the ORIGINAL SF30 seller and version store.
import { constants } from 'node:fs';
import { open, mkdir, link, rm, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { DATASET_SNAPSHOT_PARAMETER, openDatasetVersions } from '../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../dataset-refresh/service.mjs';

export const SDMX_MERCHANT_RELEASE_SCHEMA = 'stellar-forge.sdmx-merchant-release.v1';
const BINDING_SCHEMA = 'stellar-forge.sdmx-seller-binding.v1';
const HASH = /^[a-f0-9]{64}$/;
const DATA_FILES = ['data.csv', 'dataset.json', 'sdmx-lineage.json', 'seller.json'];
const limits = { 'data.csv': 256 * 1024 * 1024, 'dataset.json': 65536,
  'sdmx-lineage.json': 8 * 1024 * 1024, 'seller.json': 1048576 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
const count = (value, label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(label + ' must be an integer from ' + minimum + ' to ' + maximum);
  return value;
};
const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw fault('SDMX_DIRECTORY_REQUIRED', 'Select an original regular private directory.');
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function inspectFile(path, maximum, retain = false) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum))
      throw fault('SDMX_FILE_LIMIT', 'An SDMX release file is not regular or exceeds its native limit.');
    const hash = createHash('sha256'), chunks = []; let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maximum) throw fault('SDMX_FILE_LIMIT', 'An SDMX release file exceeds its native limit.');
      hash.update(chunk); if (retain) chunks.push(chunk);
    }
    if (identity(before) !== identity(await handle.stat({ bigint: true })))
      throw fault('SDMX_SOURCE_CHANGED', 'The selected immutable SDMX file changed while being read.', 409);
    return { bytes, sha256: hash.digest('hex'), ...(retain ? { data: Buffer.concat(chunks) } : {}) };
  } finally { await handle.close(); }
}
async function jsonFile(path, maximum) {
  const file = await inspectFile(path, maximum, true);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.data)); }
  catch { throw fault('SDMX_JSON_INVALID', 'The selected SDMX JSON file is not valid UTF-8 JSON.'); }
  return { value, file };
}
function fileIdentity(value, maximum) {
  if (!object(value) || !HASH.test(value.sha256 ?? '') || !Number.isSafeInteger(value.bytes) ||
      value.bytes < 1 || value.bytes > maximum)
    throw fault('SDMX_LINEAGE_INVALID', 'The SDMX lineage must retain exact native file lengths and SHA256 values.');
  return { bytes: value.bytes, sha256: value.sha256 };
}
function projectIdentity(value) {
  if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 256 ||
      /[\x00-\x1f\x7f]/.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      typeof value.title !== 'string' || !value.title)
    throw fault('SDMX_LINEAGE_INVALID', 'The SDMX lineage must identify the saved project revision.');
  return { id: value.id, revision: value.revision, title: value.title };
}
function releaseIdentity(value) {
  return digest(canonical({ schema: value.schema, project: value.project, snapshot: value.snapshot,
    resource: value.resource, files: value.files }));
}
async function readProjection(directory) {
  const root = resolve(directory);
  const lineageFile = await jsonFile(join(root, 'sdmx-lineage.json'), limits['sdmx-lineage.json']);
  const lineage = lineageFile.value;
  if (!object(lineage) || lineage.schema !== 'stellar-forge.sdmx-lineage.v1' ||
      !HASH.test(lineage.snapshot ?? '') || !object(lineage.files) || !Array.isArray(lineage.sources))
    throw fault('SDMX_LINEAGE_INVALID', 'Export an original saved SDMX dataset before preparing a merchant.');
  const project = projectIdentity(lineage.project);
  const expected = Object.fromEntries(['data.csv', 'dataset.json'].map(name =>
    [name, fileIdentity(lineage.files[name], limits[name])]));
  for (const name of Object.keys(expected)) {
    const actual = await inspectFile(join(root, name), limits[name]);
    if (!same(actual, expected[name]))
      throw fault('SDMX_EXPORT_CHANGED', 'The exported ' + name + ' differs from its saved SDMX lineage.', 409);
  }
  const config = (await jsonFile(join(root, 'dataset.json'), limits['dataset.json'])).value;
  if (config.schema !== 'stellar-forge.csv-dataset.v1' || !['data.csv', './data.csv'].includes(config.file))
    throw fault('SDMX_NATIVE_CONFIG_REQUIRED', 'Use the original self-contained SDMX dataset export.');
  return { root, lineage, project, expected, lineageFile };
}
async function writeNew(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function copyExact(source, target, expected, maximum) {
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(expected.bytes) || before.size > BigInt(maximum))
      throw fault('SDMX_EXPORT_CHANGED', 'The selected source file changed before publication.', 409);
    output = await open(target, 'wx', 0o600);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maximum) throw fault('SDMX_FILE_LIMIT', 'The source file exceeds its native limit.');
      hash.update(chunk); await output.writeFile(chunk);
    }
    if (identity(before) !== identity(await input.stat({ bigint: true })) ||
        bytes !== expected.bytes || hash.digest('hex') !== expected.sha256)
      throw fault('SDMX_EXPORT_CHANGED', 'The immutable SDMX source changed during publication.', 409);
    await output.sync();
  } finally { await output?.close(); await input.close(); }
}
async function installExact(source, target, expected, maximum) {
  try { await link(source, target); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!same(await inspectFile(target, maximum), expected))
      throw fault('SDMX_RELEASE_CONFLICT', 'The selected release directory contains different retained bytes.', 409);
  }
}

/** A release contains the reviewed projection, lineage and the original seller
 * configuration. The complete source packet remains the workspace's own export. */
export async function prepareSdmxMerchant({ datasetDirectory, directory, payment, origin, path = '/sdmx' } = {}) {
  if (typeof datasetDirectory !== 'string' || typeof directory !== 'string')
    throw new TypeError('A native dataset export and a release directory are required.');
  const projection = await readProjection(datasetDirectory);
  const dataset = await loadDatasetConfig(join(projection.root, 'dataset.json'));
  const description = dataset.describe();
  if (description.snapshot !== projection.lineage.snapshot)
    throw fault('SDMX_SNAPSHOT_CHANGED', 'The original dataset engine returned a different saved SDMX snapshot.', 409);
  const config = await buildDatasetSellerConfig(dataset, { payment, origin, path });
  const parameters = config.routes[0].definition.queryParameters;
  if (parameters.length >= 32)
    throw fault('SDMX_SNAPSHOT_PARAMETER_REQUIRED', 'Retain one native query-parameter slot for the exact edition selector.');
  parameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
  const sellerBytes = encode(config);
  const files = { ...projection.expected,
    'sdmx-lineage.json': { bytes: projection.lineageFile.file.bytes, sha256: projection.lineageFile.file.sha256 },
    'seller.json': { bytes: sellerBytes.length, sha256: digest(sellerBytes) } };
  const manifest = { schema: SDMX_MERCHANT_RELEASE_SCHEMA, project: projection.project,
    snapshot: description.snapshot, resource: config.publicOrigin + config.routes[0].path,
    dataset: description, files, sources: projection.lineage.sources,
    selection: projection.lineage.selection, created_at: projection.lineage.created_at };
  manifest.id = releaseIdentity(manifest);
  const manifestBytes = encode(manifest), root = resolve(directory);
  await privateDirectory(dirname(root));
  const temporary = join(dirname(root), '.sdmx-release-' + randomUUID());
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const name of ['data.csv', 'dataset.json', 'sdmx-lineage.json'])
      await copyExact(join(projection.root, name), join(temporary, name), files[name], limits[name]);
    await writeNew(join(temporary, 'seller.json'), sellerBytes);
    await writeNew(join(temporary, 'release.json'), manifestBytes);
    try { await mkdir(root, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw fault('SDMX_RELEASE_CONFLICT', 'Select a regular release directory.', 409);
    // The create-only manifest binds an interrupted preparation before the
    // remaining immutable members are linked. A matching retry fills only gaps.
    await installExact(join(temporary, 'release.json'), join(root, 'release.json'),
      { bytes: manifestBytes.length, sha256: digest(manifestBytes) }, 8 * 1024 * 1024);
    for (const name of DATA_FILES)
      await installExact(join(temporary, name), join(root, name), files[name], limits[name]);
    await syncDirectory(root);
    const saved = await readSdmxMerchant(root);
    return { directory: root, manifest: saved.manifest, seller: join(root, 'seller.json'),
      dataset: join(root, 'dataset.json'), lineage: join(root, 'sdmx-lineage.json') };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function readSdmxMerchant(directory) {
  const root = resolve(directory), manifest = (await jsonFile(join(root, 'release.json'), 8 * 1024 * 1024)).value;
  if (!object(manifest) || manifest.schema !== SDMX_MERCHANT_RELEASE_SCHEMA ||
      !HASH.test(manifest.id ?? '') || !HASH.test(manifest.snapshot ?? '') ||
      manifest.id !== releaseIdentity(manifest) || !object(manifest.files) ||
      Object.keys(manifest.files).sort().join('|') !== [...DATA_FILES].sort().join('|'))
    throw fault('SDMX_RELEASE_INVALID', 'The original SDMX merchant release identity is invalid.');
  projectIdentity(manifest.project);
  for (const name of DATA_FILES) {
    const expected = fileIdentity(manifest.files[name], limits[name]);
    if (!same(await inspectFile(join(root, name), limits[name]), expected))
      throw fault('SDMX_RELEASE_CHANGED', 'A retained SDMX merchant file differs from its release.', 409);
  }
  const config = (await jsonFile(join(root, 'seller.json'), limits['seller.json'])).value;
  if (config.publicOrigin + config.routes?.[0]?.path !== manifest.resource)
    throw fault('SDMX_RELEASE_CHANGED', 'The release resource differs from its original seller configuration.', 409);
  const lineage = (await jsonFile(join(root, 'sdmx-lineage.json'), limits['sdmx-lineage.json'])).value;
  if (!object(lineage) || !object(lineage.files) || lineage.schema !== 'stellar-forge.sdmx-lineage.v1' || lineage.snapshot !== manifest.snapshot ||
      !same(projectIdentity(lineage.project), manifest.project) ||
      !same(lineage.files['data.csv'], manifest.files['data.csv']) ||
      !same(lineage.files['dataset.json'], manifest.files['dataset.json']))
    throw fault('SDMX_RELEASE_CHANGED', 'The retained projection lineage differs from this release.', 409);
  return { directory: root, manifest, config, lineage, configPath: join(root, 'dataset.json') };
}
function bindingFor(release) {
  return { schema: BINDING_SCHEMA, project_id: release.manifest.project.id,
    seller_sha256: release.manifest.files['seller.json'].sha256, resource: release.manifest.resource };
}
async function readBinding(directory, release) {
  const value = (await jsonFile(join(resolve(directory), 'sdmx-merchant-binding.json'), 16384)).value;
  if (!same(value, bindingFor(release)))
    throw fault('SDMX_SELLER_BINDING_CHANGED', 'Use the same original project, route and public payment terms for a dataset refresh.', 409);
  return value;
}
async function saveBinding(directory, release) {
  const path = join(directory, 'sdmx-merchant-binding.json'), bytes = encode(bindingFor(release));
  const temporary = join(directory, '.sdmx-binding-' + randomUUID());
  try {
    await writeNew(temporary, bytes);
    await installExact(temporary, path, { bytes: bytes.length, sha256: digest(bytes) }, 16384);
    await syncDirectory(directory);
  } finally { await rm(temporary, { force: true }); }
}
async function nativeFactoryFor(facilitator, allowLocalFacilitator) {
  if (!facilitator) {
    if (allowLocalFacilitator) throw new TypeError('A facilitator URL is required for the explicit local option.');
    return null;
  }
  const url = new URL(facilitator);
  const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    throw new TypeError('Select the original HTTPS facilitator, or explicitly allow its loopback HTTP address.');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
}

/** Start the existing versioned seller. Its one writer lease, request lifetime,
 * control transport, native verification and shutdown remain authoritative. */
export async function startSdmxMerchant({ directory, stateDirectory, port = 8423,
  retentionSeconds = 3600, maxVersions = 4, maxRetainedBytes = 268435456,
  maxCachedVersions = 2, maxResidentRows = 1000000, maxInFlight = 64, drainGraceMs = 60000,
  controlTransport = 'unix', facilitator, allowLocalFacilitator = false, nativeFactory } = {}) {
  if (typeof stateDirectory !== 'string') throw new TypeError('The original private version-state directory is required.');
  const release = await readSdmxMerchant(directory), state = resolve(stateDirectory);
  const initialized = await exists(join(state, 'state.json'));
  const bound = initialized && await exists(join(state, 'sdmx-merchant-binding.json'));
  if (bound) await readBinding(state, release);
  const versions = await openDatasetVersions({ directory: state, maxCachedVersions, maxResidentRows,
    ...(!initialized ? { initialConfig: release.configPath,
      retentionMs: count(retentionSeconds, 'retentionSeconds') * 1000,
      maxVersions, maxRetainedBytes } : {}) });
  try {
    if (!bound && versions.status().current !== release.manifest.snapshot)
      throw fault('SDMX_SELLER_BINDING_CHANGED', 'The existing unbound store has a different selected dataset.', 409);
    const route = release.config.routes[0];
    const expectedConfig = await buildDatasetSellerConfig(versions, {
      payment: route.definition.payment, origin: release.config.publicOrigin, path: route.path });
    expectedConfig.routes[0].definition.queryParameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
    if (!same(expectedConfig, release.config))
      throw fault('SDMX_SELLER_CONTRACT_CHANGED', 'The version store and original seller have different advertised dataset contracts.', 409);
    await saveBinding(state, release);
    const factory = nativeFactory === undefined ? await nativeFactoryFor(facilitator, allowLocalFacilitator) : nativeFactory;
    const service = await startVersionedDatasetSeller({ versions, config: release.config, port,
      nativeFactory: factory, controlTransport, maxInFlight, drainGraceMs });
    return { ...service, release: release.manifest, stateDirectory: state };
  } catch (error) { await versions.close(); throw error; }
}

/** Publication uses the original running seller's serialized CAS, preserving
 * the public price and query contract while changing its retained observations. */
export async function publishSdmxMerchant({ directory, stateDirectory, expectedSnapshot, expectedRevision } = {}) {
  const release = await readSdmxMerchant(directory);
  await readBinding(stateDirectory, release);
  if (!HASH.test(expectedSnapshot ?? '')) throw new TypeError('Select the original current snapshot from status.');
  count(expectedRevision, 'expectedRevision');
  const result = await datasetControl(stateDirectory, 'refresh', {
    configPath: release.configPath, expectedSnapshot, expectedRevision });
  if (result.current !== release.manifest.snapshot)
    throw fault('SDMX_PUBLICATION_MISMATCH', 'Inspect the original version store; its current snapshot differs from the selected release.', 409);
  return { release: release.manifest.id, project: release.manifest.project, ...result };
}

const HELP = [
  'SDMX original merchant release',
  'prepare --dataset EXPORTED_NATIVE_DIR --payment PUBLIC_TERMS.json --origin HTTPS_ORIGIN --out RELEASE_DIR [--path /sdmx]',
  'inspect --release RELEASE_DIR',
  'serve --release RELEASE_DIR --state PRIVATE_STATE [--port 8423] [--facilitator HTTPS_URL]',
  '      [--allow-local-facilitator] [--control-transport unix|loopback]',
  '      [--retention-seconds 3600] [--max-versions 4] [--max-retained-bytes 268435456]',
  '      [--max-cached-versions 2] [--max-resident-rows 1000000] [--max-in-flight 64] [--drain-grace-ms 60000]',
  'status --state PRIVATE_STATE',
  'publish --release RELEASE_DIR --state PRIVATE_STATE --expect CURRENT_SHA --expect-revision REVISION',
  'activate --state PRIVATE_STATE --snapshot RETAINED_SHA --expect CURRENT_SHA --expect-revision REVISION',
  'collect --state PRIVATE_STATE',
  'Preparation retains exact projected CSV, native configuration, SDMX lineage and explicit public terms.',
  'The original dataset seller owns publication, admission, payment processing, retention and recovery.',
].join('\n') + '\n';
function parse(args) {
  const [action, ...tokens] = args;
  const common = ['--state'];
  const allowed = {
    prepare: ['--dataset', '--payment', '--origin', '--out', '--path'],
    inspect: ['--release'],
    serve: ['--release', '--state', '--port', '--facilitator', '--allow-local-facilitator', '--control-transport',
      '--retention-seconds', '--max-versions', '--max-retained-bytes', '--max-cached-versions',
      '--max-resident-rows', '--max-in-flight', '--drain-grace-ms'],
    status: common, publish: [...common, '--release', '--expect', '--expect-revision'],
    activate: [...common, '--snapshot', '--expect', '--expect-revision'], collect: common,
  }[action];
  if (!allowed) throw new TypeError(HELP);
  const flags = {};
  for (let index = 0; index < tokens.length; index++) {
    const key = tokens[index];
    if (!allowed.includes(key) || Object.hasOwn(flags, key)) throw new TypeError('Unknown or duplicate merchant option: ' + key);
    if (key === '--allow-local-facilitator') { flags[key] = true; continue; }
    if (!tokens[index + 1] || tokens[index + 1].startsWith('--')) throw new TypeError('Missing value for ' + key);
    flags[key] = tokens[++index];
  }
  return { action, flags };
}
function required(flags, name) {
  if (!flags[name]) throw new TypeError(name + ' is required.');
  return flags[name];
}
function number(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(flags[name])) throw new TypeError(name + ' must be an integer.');
  return count(Number(flags[name]), name, 0);
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help', '--help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const { action, flags: f } = parse(args);
  if (action === 'prepare') return print(await prepareSdmxMerchant({
    datasetDirectory: required(f, '--dataset'), directory: required(f, '--out'),
    payment: (await jsonFile(required(f, '--payment'), 16384)).value,
    origin: required(f, '--origin'), path: f['--path'] ?? '/sdmx' }));
  if (action === 'inspect') {
    const release = await readSdmxMerchant(required(f, '--release'));
    return print({ directory: release.directory, manifest: release.manifest });
  }
  const stateDirectory = required(f, '--state');
  if (action === 'status' || action === 'collect') return print(await datasetControl(stateDirectory, action));
  if (action === 'publish') return print(await publishSdmxMerchant({
    directory: required(f, '--release'), stateDirectory,
    expectedSnapshot: required(f, '--expect'), expectedRevision: number(f, '--expect-revision') }));
  if (action === 'activate') return print(await datasetControl(stateDirectory, 'activate', {
    snapshot: required(f, '--snapshot'), expectedSnapshot: required(f, '--expect'),
    expectedRevision: count(number(f, '--expect-revision'), '--expect-revision') }));
  const service = await startSdmxMerchant({
    directory: required(f, '--release'), stateDirectory, port: number(f, '--port', 8423),
    retentionSeconds: number(f, '--retention-seconds', 3600), maxVersions: number(f, '--max-versions', 4),
    maxRetainedBytes: number(f, '--max-retained-bytes', 268435456),
    maxCachedVersions: number(f, '--max-cached-versions', 2), maxResidentRows: number(f, '--max-resident-rows', 1000000),
    maxInFlight: number(f, '--max-in-flight', 64), drainGraceMs: number(f, '--drain-grace-ms', 60000),
    controlTransport: f['--control-transport'] ?? 'unix', facilitator: f['--facilitator'],
    allowLocalFacilitator: f['--allow-local-facilitator'] ?? false });
  print({ url: service.url, mode: service.mode, release: service.release.id,
    project: service.release.project, stateDirectory: service.stateDirectory,
    current: service.versions.status().current, health: service.url + '/_seller/health',
    offers: service.url + '/_seller/offers', docs: service.url + '/_seller/docs' });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    service.close().catch(error => { process.stderr.write('SDMX merchant: ' + error.message + '\n'); process.exitCode = 1; });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return service;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'SDMX_MERCHANT', message: error.message }) + '\n'); process.exitCode = 1; });
