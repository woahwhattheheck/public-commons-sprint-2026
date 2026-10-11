// MIT. Original versioned CSV datasets in the existing SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadDatasetConfig } from '../sf30-seller-sdk/dataset-handler.mjs';
import { datasetQueryParameters } from '../sf30-seller-sdk/dataset-cli.mjs';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../sf30-seller-sdk/dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller } from '../sf30-seller-sdk/dataset-refresh/service.mjs';

export const DATASET_SOURCE_SCHEMA = 'stellar-forge.dataset-seller-release-manifest.v1';
export const DATASET_BINDING_SCHEMA = 'stellar-forge.dataset-release-binding.v1';
const SOURCE_FILES = ['dataset.csv', 'dataset.json', 'seller.json', 'source.json', 'binding.json'];
const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'DATASET_RELEASE_CHANGED' }); };
export function datasetContractSha256(description) {
  const { snapshot, rowCount, ...contract } = description;
  return hash(stable(contract));
}
async function bytes(path, maximum = MiB) {
  if (await realpath(path) !== resolve(path)) fail('Use canonical dataset package files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('The retained dataset file exceeds its supported size.');
    const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < buffer.length) {
      const result = await file.read(buffer, used, buffer.length - used, null);
      if (!result.bytesRead) break; used += result.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      fail('The retained dataset package changed during capture.');
    return buffer.subarray(0, used);
  } finally { await file.close(); }
}
async function writeNew(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const file = await open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { await writeNew(temporary, formatted(value)); await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function bindService(service, description) {
  if (service.routes.length !== 1 || Object.keys(service).some(key => !['schema', 'publicOrigin', 'routes'].includes(key)))
    fail('Use one original dataset seller route for this release.');
  const route = service.routes[0], input = route.offer?.extensions?.bazaar?.info?.input;
  const schema = route.offer?.extensions?.bazaar?.schema?.properties?.input?.properties?.queryParams;
  const names = [...datasetQueryParameters(description), DATASET_SNAPSHOT_PARAMETER].map(parameter => parameter.name).sort();
  if (Object.keys(route).some(key => !['id', 'path', 'offer', 'handler', 'admit'].includes(key)) ||
      route.handler !== 'queryDataset' || route.admit !== 'admitDataset' || input?.method !== 'GET' ||
      !isDeepStrictEqual(Object.keys(input.queryParams ?? {}).sort(), names) ||
      !isDeepStrictEqual(Object.keys(schema?.properties ?? {}).sort(), names) ||
      schema.properties.snapshot?.type !== 'string' || schema.required?.includes('snapshot') ||
      Object.hasOwn(schema.properties.snapshot, 'default'))
    fail('Dataset capabilities and the original versioned seller route differ.');
  compileSellerRoutes([{ id: route.id, offer: route.offer,
    handler: async () => { throw new Error('Dataset release inspection does not execute a query.'); } }]);
}
/** Inspect the selected original CSV, generated seller and controller binding. */
export async function prepareDatasetRelease(packageDirectory) {
  const directory = resolve(packageDirectory);
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
    fail('Choose the canonical directory containing the prepared dataset release.');
  const retained = {};
  for (const file of SOURCE_FILES) retained[file] = await bytes(join(directory, file), file.endsWith('.csv') ? 256 * MiB : MiB);
  const config = parse(retained['dataset.json']), binding = parse(retained['binding.json']);
  if (config.file !== 'dataset.csv' || binding.schema !== DATASET_BINDING_SCHEMA ||
      typeof binding.datasetDirectory !== 'string' || !isAbsolute(binding.datasetDirectory) ||
      resolve(binding.datasetDirectory) !== binding.datasetDirectory || binding.datasetDirectory === '/' ||
      !/^[a-f0-9]{64}$/.test(binding.contractSha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(binding.baselineSnapshot ?? '') ||
      Object.keys(binding).some(key => !['schema','datasetDirectory','contractSha256','baselineSnapshot','sourceSha256'].includes(key)))
    fail('The dataset release needs its original private version-store binding.');
  const native = await loadDatasetConfig(join(directory, 'dataset.json')), description = native.describe();
  // Recheck both original byte inputs after the loader reads its own source.
  if (!retained['dataset.json'].equals(await bytes(join(directory, 'dataset.json'))) ||
      !retained['dataset.csv'].equals(await bytes(join(directory, 'dataset.csv'), 256 * MiB)) ||
      binding.contractSha256 !== datasetContractSha256(description) || binding.baselineSnapshot !== description.snapshot ||
      binding.sourceSha256 !== hash(retained['source.json']))
    fail('The dataset edition or its provenance differs from the reviewed release.');
  parse(retained['source.json']);
  const original = await readSellerConfig(join(directory, 'seller.json'));
  if (original.routes.length !== 1 || Object.keys(original).some(key => !['schema','publicOrigin','routes'].includes(key)) ||
      original.routes.some(route => Object.keys(route).some(key => !['id','path','definition','offer','handler','admit'].includes(key))))
    fail('Use the original configured dataset service and its query bindings.');
  const service = { ...original, routes: original.routes.map(route => {
    const { definition, ...selected } = route;
    return { ...selected, offer: definition
      ? compileHttpSellerOffer({ ...definition, url: original.publicOrigin + route.path }) : route.offer };
  }) };
  if (!retained['seller.json'].equals(await bytes(join(directory, 'seller.json'))))
    fail('Seller terms changed during dataset release preparation.');
  bindService(service, description);
  const serviceBytes = formatted(service);
  const offers = { schema: 'stellar-forge.dataset-seller-offers.v1',
    offers: service.routes.map(route => ({ id: route.id, seller: route.offer })) };
  const offersBytes = formatted(offers);
  const dataset = { schema: 'stellar-forge.dataset-release-source.v1',
    datasetDirectory: binding.datasetDirectory, baselineSnapshot: description.snapshot,
    contractSha256: binding.contractSha256, rowCount: description.rowCount,
    sourceConfigSha256: hash(retained['dataset.json']), csvSha256: hash(retained['dataset.csv']),
    sourceSha256: hash(retained['source.json']), bindingSha256: hash(retained['binding.json']),
    executionSha256: hash(stable({ binding, service, config })), description };
  return { directory, config, binding, description, service, serviceBytes, offers, offersBytes, dataset, retained,
    files: ordered(SOURCE_FILES.map(file => descriptor('dataset/' + file, retained[file]))) };
}
export async function stageDatasetRelease(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareDatasetRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the dataset release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its prepared source package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, 'dataset'), { mode: 0o700 });
    for (const file of SOURCE_FILES) await writeNew(join(target, 'dataset', file), prepared.retained[file]);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifest = { schema: DATASET_SOURCE_SCHEMA, packagePath: 'dataset', dataset: prepared.dataset,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    await syncDirectory(join(target, 'dataset')); await syncDirectory(target);
    return inspectDatasetRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}
export async function inspectDatasetRelease(directory) {
  const root = resolve(directory), manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB);
  const manifest = parse(manifestBytes);
  if (manifest.schema !== DATASET_SOURCE_SCHEMA || manifest.packagePath !== 'dataset' || !Array.isArray(manifest.files))
    fail('Expected an original dataset seller release.');
  const prepared = await prepareDatasetRelease(join(root, 'dataset'));
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.dataset, prepared.dataset))
    fail('The retained dataset source, controller binding or query contract changed.');
  const offersBytes = await bytes(join(root, 'offers.json'), 2 * MiB), serviceBytes = await bytes(join(root, 'seller-service.json'));
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained dataset offer differs from its original source package.');
  return { manifest, dataset: prepared.dataset, offers: prepared.offers, service: prepared.service,
    config: prepared.config, description: prepared.description, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}
function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained dataset runtime options.');
  if (runtime.facilitator) {
    const url = new URL(runtime.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(runtime.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw new TypeError('Use the original seller facilitator URL requirements.');
  }
  return { ...runtime, port: Number(runtime.port ?? 0) };
}
/** One original version writer owns admission, response pinning and refresh IPC. */
export async function startDatasetRelease(directory, { runtime = { port: 0 }, nativeFactory: suppliedFactory } = {}) {
  const snapshot = await inspectDatasetRelease(directory), options = selectedRuntime(runtime);
  const versions = await openDatasetVersions({ directory: snapshot.dataset.datasetDirectory });
  let session;
  try {
    if (datasetContractSha256(versions.describe()) !== snapshot.dataset.contractSha256)
      fail('The current dataset contract differs from the staged seller. Select its original version store.');
    let nativeFactory = suppliedFactory ?? null;
    if (!nativeFactory && options.facilitator) {
      const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
        import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs')]);
      nativeFactory = compiled => createNativeSellerServer(compiled, {
        facilitatorClient: new HTTPFacilitatorClient({ url: options.facilitator.replace(/\/$/, '') }) });
    }
    session = await startVersionedDatasetSeller({ versions, config: snapshot.service,
      port: options.port, nativeFactory, control: true });
    return { ...session, dataset: snapshot.dataset, snapshot };
  } catch (error) { await session?.close().catch(() => {}); await versions.close().catch(() => {}); throw error; }
}
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume')
    throw new TypeError('Usage: node release-dataset.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectDatasetRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another dataset release.');
  const session = await startDatasetRelease(directory, { runtime: saved.options });
  try {
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256,
      originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      dataset: { ...snapshot.dataset, current: session.versions.status().current,
        revision: session.versions.status().revision } });
    const onSignal = () => { void session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
    const close = session.close;
    session.close = async () => { try { return await close(); }
      finally { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal); } };
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
