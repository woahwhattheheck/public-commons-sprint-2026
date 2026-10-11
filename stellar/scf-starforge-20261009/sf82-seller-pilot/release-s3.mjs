// MIT. Retain original S3 products in the existing SF82 seller release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateS3Config } from '../sf30-seller-sdk/s3/config.mjs';
import { describePinnedS3Config, createS3ObjectSource } from '../sf30-seller-sdk/s3/source.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';

export const S3_SOURCE_SCHEMA = 'stellar-forge.s3-seller-release-manifest.v1';
const SOURCE_FILES = ['source.json', 'service.json', 'objects.json'];
const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = value => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch (cause) { throw Object.assign(new Error('S3 package JSON must be valid UTF-8.', { cause }), { code: 'S3_PACKAGE_INVALID' }); }
};
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'S3_RELEASE_CHANGED' }); };
function sourceError(error) {
  if (typeof error?.syscall === 'string')
    return Object.assign(new Error('The configured S3 package is unavailable. Restore its local files or select an available source.',
      { cause: error }), { code: 'S3_PACKAGE_UNAVAILABLE' });
  if (error instanceof SyntaxError || error?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
    return Object.assign(new Error('S3 package JSON must be valid UTF-8.', { cause: error }), { code: 'S3_PACKAGE_INVALID' });
  return error;
}

async function bytes(path, maximum = MiB) {
  try { return await sourceBytes(path, maximum); } catch (error) { throw sourceError(error); }
}
async function sourceBytes(path, maximum) {
  if (await realpath(path) !== resolve(path)) fail('Use canonical S3 package files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('S3 release file exceeds its supported size.');
    const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      fail('S3 package changed during capture.');
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

function bindOriginalService(service, description) {
  if (Object.keys(service).some(key => !['schema', 'publicOrigin', 'routes'].includes(key)) ||
      service.routes.length !== description.objects.length)
    fail('Use the original S3 configure output with one route per selected object.');
  for (const [index, item] of description.objects.entries()) {
    const route = service.routes[index], input = route?.offer?.extensions?.bazaar?.info?.input;
    if (!route || Object.keys(route).some(key => !['id', 'path', 'offer', 'handler', 'admit'].includes(key)) ||
        route.id !== item.id || route.path !== item.path || route.handler !== `object${index}` || route.admit !== `admit${index}` ||
        input?.method !== 'GET' || route.offer.resource.mimeType !== item.contentType ||
        route.offer.resource.description !== `${item.description} Object snapshot: ${item.snapshot}.`)
      fail('S3 source, public object description and original seller route differ.');
    const query = Object.keys(input.queryParams ?? {}).sort();
    if (!isDeepStrictEqual(query, item.mode === 'chunks' ? ['length', 'offset'] : []))
      fail('The S3 route query differs from its whole-file or chunk delivery contract.');
  }
  // Original compiler validates payment options, resource URLs and input schemas.
  // These functions are placeholders for compilation only and are never executed.
  compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler: async () => { throw new Error('S3 release inspection does not execute an object.'); } })));
}
function sourceMetadata(config, description, retained) {
  const sourceConfigSha256 = hash(retained['source.json']);
  const objectsSha256 = hash(retained['objects.json']);
  const objects = description.objects.map(item => ({ ...item }));
  return { schema: 'stellar-forge.s3-release-source.v1', sourceConfigSha256, objectsSha256,
    executionSha256: hash(stable({ config, objects })), credentialProvider: config.credentialProvider,
    objectCount: objects.length, wholeObjects: objects.filter(item => item.mode === 'whole').length,
    chunkedObjects: objects.filter(item => item.mode === 'chunks').length,
    totalObjectBytes: String(objects.reduce((sum, item) => sum + BigInt(item.bytes), 0n)), objects };
}

/** Read the original configure output. No SDK, credentials, handler import or network call. */
export async function prepareS3Release(packageDirectory) {
  try { return await readPreparedS3Release(packageDirectory); } catch (error) { throw sourceError(error); }
}
async function readPreparedS3Release(packageDirectory) {
  const directory = resolve(packageDirectory);
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
    fail('Choose the canonical directory containing the original S3 configure output.');
  const retained = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, await bytes(join(directory, file))])));
  const config = validateS3Config(parse(retained['source.json']));
  const description = describePinnedS3Config(config);
  if (!isDeepStrictEqual(description, parse(retained['objects.json'])))
    fail('The public object description differs from its retained S3 pins.');
  const service = await readSellerConfig(join(directory, 'service.json'));
  if (!isDeepStrictEqual(service, parse(retained['service.json']))) fail('S3 service changed during inspection.');
  bindOriginalService(service, description);
  const offers = { schema: 'stellar-forge.s3-seller-offers.v1', offers: service.routes.map(route => ({ id: route.id, seller: route.offer })) };
  const offersBytes = formatted(offers), s3 = sourceMetadata(config, description, retained);
  return { directory, config, description, service, offers, offersBytes, s3, retained,
    serviceBytes: retained['service.json'],
    files: ordered(SOURCE_FILES.map(file => descriptor('s3/' + file, retained[file]))) };
}

/** Keep the selected object locations and pins private; public outputs contain aliases and hashes. */
export async function stageS3Release(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareS3Release(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the S3 release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original S3 package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, 's3'), { mode: 0o700 });
    for (const file of SOURCE_FILES) await writeNew(join(target, 's3', file), prepared.retained[file]);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifest = { schema: S3_SOURCE_SCHEMA, packagePath: 's3', s3: prepared.s3,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    await syncDirectory(join(target, 's3')); await syncDirectory(target);
    return await inspectS3Release(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Reopen from the retained files even after the initial generated package has moved. */
export async function inspectS3Release(directory) {
  const root = resolve(directory);
  const manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB), manifest = parse(manifestBytes);
  if (manifest.schema !== S3_SOURCE_SCHEMA || manifest.packagePath !== 's3' || !manifest.s3 || !Array.isArray(manifest.files))
    fail('Expected an original S3 seller release.');
  const prepared = await prepareS3Release(join(root, 's3'));
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.s3, prepared.s3))
    fail('The retained S3 locations, pins, public terms or object contracts changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json'), 2 * MiB), serviceBytes = await bytes(join(root, 'seller-service.json'));
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained S3 offers or service differ from the original package.');
  return { manifest, s3: prepared.s3, offers: prepared.offers, service: prepared.service,
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
    throw new TypeError('Invalid retained S3 runtime options.');
  if (runtime.facilitator) {
    const url = new URL(runtime.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(runtime.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw new TypeError('Use the original seller facilitator URL requirements.');
  }
  return { ...runtime, port: Number(runtime.port ?? 0) };
}

/** Embedding seam: use the original SDK source and seller lifecycle with the retained package. */
export async function startS3Release(directory, { runtime = { port: 0 }, sourceOptions, nativeFactory: suppliedFactory } = {}) {
  const snapshot = await inspectS3Release(directory), options = selectedRuntime(runtime);
  const source = await createS3ObjectSource(snapshot.config, sourceOptions);
  let session;
  try {
    if (!isDeepStrictEqual(source.describe(), snapshot.description)) fail('The running S3 selection differs from the staged object contract.');
    const handlers = Object.create(null);
    for (const route of snapshot.service.routes) {
      const original = source.route(route.id);
      handlers[route.handler] = original.handler; handlers[route.admit] = original.admit;
    }
    let nativeFactory = suppliedFactory ?? null;
    if (!nativeFactory && options.facilitator) {
      const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
        import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs'),
      ]);
      nativeFactory = compiled => createNativeSellerServer(compiled, {
        facilitatorClient: new HTTPFacilitatorClient({ url: options.facilitator.replace(/\/$/, '') }),
      });
    }
    session = await startSellerService({ config: snapshot.service, port: options.port, handlers, nativeFactory });
    let closing;
    const close = () => closing ??= (async () => { try { return await session.close(); } finally { source.close(); } })();
    return { ...session, source, s3: snapshot.s3, snapshot, close };
  } catch (error) { await session?.close().catch(() => {}); source.close(); throw error; }
}

/** The existing SF82 child calls this entry after its ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-s3.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectS3Release(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another S3 release.');
  const session = await startS3Release(directory, { runtime: saved.options });
  try {
    const receipt = { schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length, s3: snapshot.s3 };
    await atomic(join(directory, 'runtime-readiness.json'), receipt);
    const onSignal = () => { void session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
    const originalClose = session.close;
    session.close = async () => {
      try { return await originalClose(); }
      finally { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal); }
    };
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
