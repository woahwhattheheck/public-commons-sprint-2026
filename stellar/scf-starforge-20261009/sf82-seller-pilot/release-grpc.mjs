// MIT. Preserve captured unary gRPC products in the original SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grpcEnvironmentNames } from '../sf30-seller-sdk/grpc/config.mjs';

export const GRPC_SOURCE_SCHEMA = 'stellar-forge.grpc-seller-source.v1';
const PACKAGE = 'grpc/package';
const CAPS = Object.freeze({
  'source.json': 65536, 'proto-source.json': 8388608, 'merchant-plan.json': 262144,
  'service.json': 1048576, 'bindings.json': 262144, 'methods.json': 4194304,
  'openapi.json': 16777216, 'client/seller-client.mjs': 1048576,
  'client/seller-client.d.mts': 1048576, 'client/seller-openapi.json': 16777216,
  'client/package.json': 65536, 'client/README.md': 1048576, 'prepared.json': 65536,
});
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'GRPC_RELEASE_CHANGED' }); };
function parse(value) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch (cause) { throw Object.assign(new Error('gRPC package JSON must be valid UTF-8.', { cause }), { code: 'GRPC_PACKAGE_INVALID' }); }
}
function sourceError(error) {
  return typeof error?.syscall === 'string'
    ? Object.assign(new Error('The retained gRPC package is unavailable. Select its complete private prepared directory.',
      { cause: error }), { code: 'GRPC_PACKAGE_UNAVAILABLE' }) : error;
}
async function bytes(path, maximum = 4 * 1024 * 1024) {
  try {
    if (await realpath(path) !== resolve(path)) fail('Use canonical gRPC package files without symlinks.');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(maximum)) fail('gRPC release file exceeds its original size limit.');
      const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        fail('gRPC package changed during capture.');
      return buffer.subarray(0, used);
    } finally { await file.close(); }
  } catch (error) { throw sourceError(error); }
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

function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator', 'operationsNavigationOrigin'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean')
    throw new TypeError('Invalid retained gRPC runtime options.');
  if (runtime.allowLocalFacilitator && !runtime.facilitator) throw new TypeError('A local facilitator option requires its selected URL.');
  if (runtime.operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.operationsNavigationOrigin) ||
        Number(new URL(runtime.operationsNavigationOrigin).port) > 65535))
    throw new TypeError('The operations navigation origin must be the original loopback console.');
  return { ...runtime, port: String(runtime.port ?? 0) };
}


/** Static source, descriptor, full payment and original client verification. No RPC is sent. */
export async function prepareGrpcRelease(packageDirectory) {
  // Unrelated release families can import this adapter without the optional runtime.
  const { readGrpcPrepared, PREPARED_FILES } = await import('../sf30-seller-sdk/grpc/prepare.mjs');
  try {
    const directory = resolve(packageDirectory);
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
      fail('Choose the canonical directory containing the original gRPC prepare output.');
    const original = await readGrpcPrepared(directory), retained = {}; let total = 0;
    for (const [file, cap] of Object.entries(CAPS)) {
      retained[file] = await bytes(join(directory, file), cap);
      if ((total += retained[file].length) > 67108864) fail('The complete gRPC package exceeds 64 MiB.');
    }
    const manifest = parse(retained['prepared.json']);
    if (stable(manifest) !== stable(original.manifest)) fail('The gRPC manifest changed during capture.');
    for (const file of Object.keys(PREPARED_FILES)) {
      const entry = manifest.files[file];
      if (entry.bytes !== retained[file].length || entry.sha256 !== hash(retained[file]))
        fail('The captured gRPC package changed after original compiler validation.');
    }
    const files = ordered(Object.keys(CAPS).map(file => descriptor(PACKAGE + '/' + file, retained[file])));
    const selected = Object.entries(original.methods.routes).map(([id, method]) => ({
      id, path: method.method, requestType: method.requestType, responseType: method.responseType,
      requestSchemaSha256: hash(stable(method.request)), responseSchemaSha256: hash(stable(method.response)),
    }));
    const content = { schema: 'stellar-forge.grpc-release-source.v1', packageSha256: hash(stable(files)),
      protoSha256: original.protoSource.sha256, sourceConfigSha256: hash(retained['source.json']),
      planSha256: hash(retained['merchant-plan.json']), bindingsSha256: hash(retained['bindings.json']),
      methodCount: new Set(selected.map(method => method.path)).size,
      routeCount: original.service.routes.length, methods: selected,
      transport: original.source.transport.mode, limits: structuredClone(original.source.limits),
    };
    const grpc = { ...content, executionSha256: hash(stable(content)) };
    const offers = { schema: 'stellar-forge.grpc-seller-offers.v1',
      offers: original.service.routes.map(route => ({ id: route.id, seller: route.offer })) };
    return { directory, retained, files, grpc, service: original.service, offers, offersBytes: formatted(offers),
      serviceBytes: retained['service.json'], environment: { names: grpcEnvironmentNames(original.source) } };
  } catch (error) { throw sourceError(error); }
}

/** Retain the twelve prepared files and original digest manifest; no former path is needed. */
export async function stageGrpcRelease(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareGrpcRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the gRPC release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original gRPC package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, PACKAGE, 'client'), { recursive: true, mode: 0o700 });
    for (const file of Object.keys(CAPS)) await writeNew(join(target, PACKAGE, file), prepared.retained[file]);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifest = { schema: GRPC_SOURCE_SCHEMA, packagePath: PACKAGE, grpc: prepared.grpc,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const folder of [PACKAGE + '/client', PACKAGE, 'grpc', '']) await syncDirectory(join(target, folder));
    return await inspectGrpcRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

export async function inspectGrpcRelease(directory) {
  const root = resolve(directory), manifestBytes = await bytes(join(root, 'manifest.json'), 2097152);
  const manifest = parse(manifestBytes);
  if (manifest.schema !== GRPC_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.grpc || !Array.isArray(manifest.files))
    fail('Expected a retained original gRPC merchant release.');
  const prepared = await prepareGrpcRelease(join(root, PACKAGE));
  if (stable(manifest.files) !== stable(prepared.files) || stable(manifest.grpc) !== stable(prepared.grpc))
    fail('The retained gRPC protobuf contract, payment plan or generated client changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json')), serviceBytes = await bytes(join(root, 'seller-service.json'), 1048576);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained gRPC offers or service differ from their original captured package.');
  return { manifest, grpc: prepared.grpc, offers: prepared.offers, service: prepared.service,
    environment: prepared.environment, packageDirectory: prepared.directory, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}

/** Use the original gRPC merchant command for channel readiness, payment, operations and drain. */
export async function startGrpcRelease(directory, { runtime = { port: 0 }, env = process.env } = {}) {
  const root = resolve(directory), snapshot = await inspectGrpcRelease(root), options = selectedRuntime(runtime);
  const state = join(root, 'grpc-runtime');
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (await realpath(state) !== state) fail('Use the original private gRPC runtime directory without symlinks.');
  const { main } = await import('../sf30-seller-sdk/grpc/start.mjs');
  const session = await main(['--directory', join(root, PACKAGE), '--port', options.port, '--operations-port', '0',
    '--availability-dir', join(state, 'availability'),
    ...(options.facilitator ? ['--facilitator', options.facilitator] : []),
    ...(options.allowLocalFacilitator ? ['--allow-local-facilitator'] : [])],
  { env, stdout: { write() {} }, navigationOrigin: options.operationsNavigationOrigin ?? null });
  return { ...session, grpc: snapshot.grpc, snapshot };
}

/** Called only after the original release manager's child-ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-grpc.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectGrpcRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another gRPC release.');
  const session = await startGrpcRelease(directory, { runtime: saved.options });
  try {
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      operations: session.operations.url, grpc: snapshot.grpc,
    });
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
