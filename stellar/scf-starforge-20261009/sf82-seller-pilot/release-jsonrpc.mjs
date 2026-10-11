// MIT. Retain original Stellar RPC products in the existing SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { prepareProduct, credentialReferences } from '../sf30-seller-sdk/jsonrpc/config.mjs';

export const JSONRPC_SOURCE_SCHEMA = 'stellar-forge.jsonrpc-seller-release-manifest.v1';
const PACKAGE = 'jsonrpc/package';
const SOURCE_FILES = ['plan.json', 'openapi.json', 'selections.json', 'route-bindings.json',
  'seller-offers.json', 'handlers.mjs', 'RUN.md', 'compiled/manifest.json',
  'compiled/offers.json', 'compiled/seller-service.json'];
const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = value => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch (cause) { throw Object.assign(new Error('RPC package JSON must be valid UTF-8.', { cause }), { code: 'JSONRPC_PACKAGE_INVALID' }); }
};
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'JSONRPC_RELEASE_CHANGED' }); };
function sourceError(error) {
  if (typeof error?.syscall === 'string')
    return Object.assign(new Error('The prepared RPC package is unavailable. Restore its local files or select an available package.',
      { cause: error }), { code: 'JSONRPC_PACKAGE_UNAVAILABLE' });
  return error;
}
async function bytes(path, maximum = 4 * MiB) {
  try {
    if (await realpath(path) !== resolve(path)) fail('Use canonical RPC package files without symlinks.');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(maximum)) fail('RPC release file exceeds its original size limit.');
      const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        fail('RPC package changed during capture.');
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

function bindOriginalPackage(prepared, retained) {
  for (const [file, expected] of [['openapi.json', prepared.spec], ['selections.json', prepared.selections],
    ['route-bindings.json', prepared.bindings], ['compiled/offers.json', prepared.imported],
    ['compiled/seller-service.json', prepared.service],
    ['seller-offers.json', { resources: prepared.imported.offers.map(row => row.seller) }]])
    if (!isDeepStrictEqual(parse(retained[file]), expected))
      fail('The RPC plan, public contracts, payment selections and original compiled service differ. Prepare a new package.');
  const manifest = parse(retained['compiled/manifest.json']);
  if (manifest.schema !== 'stellar.open-api-seller-manifest.v1' || manifest.responseFiles?.length || manifest.upstreamBindingsSha256 ||
      !isDeepStrictEqual(manifest.operations, prepared.imported.offers.map(({ method, path, sourcePointer, serverIndex }) =>
        ({ method, path, sourcePointer, serverIndex })))) fail('Expected the original RPC package compiler manifest.');
  for (const [field, file] of [['specSha256', 'openapi.json'], ['selectionsSha256', 'selections.json'],
    ['serviceBindingsSha256', 'route-bindings.json'], ['offersSha256', 'compiled/offers.json'],
    ['serviceConfigSha256', 'compiled/seller-service.json']])
    if (manifest[field] !== hash(retained[file])) fail('The original RPC compiler manifest differs from its retained inputs.');
  return manifest;
}
function sourceMetadata(prepared, retained) {
  const { plan } = prepared;
  return { schema: 'stellar-forge.jsonrpc-release-source.v1', planSha256: hash(retained['plan.json']),
    packageManifestSha256: hash(retained['compiled/manifest.json']),
    executionSha256: hash(stable({ plan, service: prepared.service })),
    dataNetwork: plan.dataNetwork, paymentNetwork: plan.payment.network,
    methodCount: plan.operations.length,
    methods: plan.operations.map(({ method, amountAtomic }) => ({ method, path: '/stellar/' + method, amountAtomic })),
    limits: structuredClone(plan.limits) };
}

/** Compile public declarations in memory; never import the generated handler or read credentials. */
export async function prepareJsonrpcRelease(packageDirectory) {
  try {
    const directory = resolve(packageDirectory);
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
      fail('Choose the canonical directory containing the original RPC prepare output.');
    const retained = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file =>
      [file, await bytes(join(directory, file), file === 'plan.json' ? 131072 : 4 * MiB)])));
    const prepared = prepareProduct(parse(retained['plan.json']));
    const originalManifest = bindOriginalPackage(prepared, retained);
    return { directory, ...prepared, originalManifest, retained,
      offers: prepared.imported, offersBytes: retained['compiled/offers.json'],
      serviceBytes: retained['compiled/seller-service.json'],
      jsonrpc: sourceMetadata(prepared, retained), environment: credentialReferences(prepared.plan),
      files: ordered(SOURCE_FILES.map(file => descriptor(PACKAGE + '/' + file, retained[file]))) };
  } catch (error) { throw sourceError(error); }
}

/** Retain all ten original files. Execution uses the maintained merchant, so packages can move. */
export async function stageJsonrpcRelease(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareJsonrpcRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the RPC release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original RPC package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, PACKAGE, 'compiled'), { recursive: true, mode: 0o700 });
    for (const file of SOURCE_FILES) await writeNew(join(target, PACKAGE, file), prepared.retained[file]);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifest = { schema: JSONRPC_SOURCE_SCHEMA, packagePath: PACKAGE, jsonrpc: prepared.jsonrpc,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const folder of ['jsonrpc/package/compiled', PACKAGE, 'jsonrpc', '']) await syncDirectory(join(target, folder));
    return await inspectJsonrpcRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Reopen the same source even after the prepared package or source installation has moved. */
export async function inspectJsonrpcRelease(directory) {
  const root = resolve(directory);
  const manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB), manifest = parse(manifestBytes);
  if (manifest.schema !== JSONRPC_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.jsonrpc || !Array.isArray(manifest.files))
    fail('Expected an original RPC merchant release.');
  const prepared = await prepareJsonrpcRelease(join(root, PACKAGE));
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.jsonrpc, prepared.jsonrpc))
    fail('The retained RPC source, selected methods, network, limits or payment terms changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json')), serviceBytes = await bytes(join(root, 'seller-service.json'), MiB);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained RPC offers or service differ from the original package.');
  return { manifest, jsonrpc: prepared.jsonrpc, offers: prepared.offers, service: prepared.service,
    plan: prepared.plan, environment: prepared.environment, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}

function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream', 'operationsNavigationOrigin'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      ['allowLocalFacilitator', 'allowLoopbackUpstream'].some(key => runtime[key] !== undefined && typeof runtime[key] !== 'boolean'))
    throw new TypeError('Invalid retained RPC runtime options.');
  if (runtime.allowLocalFacilitator && !runtime.facilitator) throw new TypeError('A local facilitator option requires a facilitator URL.');
  if (runtime.operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.operationsNavigationOrigin) ||
        Number(new URL(runtime.operationsNavigationOrigin).port) > 65535))
    throw new TypeError('The operations navigation origin must be the original loopback console.');
  return { ...runtime, port: String(runtime.port ?? 0) };
}

/** Use the original command's provider verification, seller, operations, history, outbox and drain. */
export async function startJsonrpcRelease(directory, { runtime = { port: 0 }, env = process.env, stderr = process.stderr } = {}) {
  const root = resolve(directory), snapshot = await inspectJsonrpcRelease(root), options = selectedRuntime(runtime);
  const state = join(root, 'rpc-runtime');
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (await realpath(state) !== state) fail('Use the original private RPC runtime directory without symlinks.');
  const { startRpcCommand } = await import('../sf30-seller-sdk/jsonrpc/cli.mjs');
  const session = await startRpcCommand(snapshot.plan, {
    port: options.port, 'operations-port': '0', 'availability-dir': join(state, 'availability'),
    'history-dir': join(state, 'history'),
    ...(options.facilitator ? { facilitator: options.facilitator, state: join(state, 'outbox') } : { 'challenge-only': true }),
    ...(options.allowLocalFacilitator ? { 'allow-local-facilitator': true } : {}),
    ...(options.allowLoopbackUpstream ? { 'allow-loopback-upstream': true } : {}),
  }, { env, stdout: { write() {} }, stderr, navigationOrigin: options.operationsNavigationOrigin ?? null });
  return { ...session, jsonrpc: snapshot.jsonrpc, snapshot };
}

/** The existing SF82 child calls this entry after its ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-jsonrpc.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectJsonrpcRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another RPC release.');
  const session = await startJsonrpcRelease(directory, { runtime: saved.options });
  try {
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      operations: session.operations.url, jsonrpc: snapshot.jsonrpc,
    });
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
