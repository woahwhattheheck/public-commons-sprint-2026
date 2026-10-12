// MIT. Retain prepared OpenSearch merchants in the original SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertPrepared, compileOpenSearchMerchantPlan } from '../sf30-seller-sdk/opensearch/prepare.mjs';
import { validateOpenSearchSource, compileOpenSearchQueries, describeOpenSearchQueries } from '../sf30-seller-sdk/opensearch/declaration.mjs';
import { startOpenSearchSeller, createOpenSearchNativeFactory } from '../sf30-seller-sdk/opensearch/start.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../sf30-seller-sdk/developer-portal.mjs';
import { CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST, inspectSellerClientExport } from '../sf30-seller-sdk/developer/client-export.mjs';

export const OPENSEARCH_SOURCE_SCHEMA = 'stellar-forge.opensearch-seller-release-manifest.v1';
const PACKAGE = 'opensearch/package';
const MiB = 1024 * 1024;
const FILES = ['source.json', 'merchant-plan.json', 'service.json', 'bindings.json', 'openapi.json',
  ...[...CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST].map(name => 'client/' + name)];
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const descriptor = (file, value) => ({ file, bytes: value.length, sha256: hash(value) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'OPENSEARCH_RELEASE_CHANGED' }); };
function sourceError(error) {
  if (typeof error?.syscall === 'string') return Object.assign(new Error(
    'The prepared OpenSearch package is unavailable. Restore its retained files or select an available package.',
    { cause: error }), { code: 'OPENSEARCH_PACKAGE_UNAVAILABLE' });
  if (error instanceof SyntaxError || error?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
    return Object.assign(new Error('The OpenSearch package requires valid UTF-8 JSON.', { cause: error }),
      { code: 'OPENSEARCH_PACKAGE_INVALID' });
  return error;
}
function limit(file) {
  if (['source.json', 'merchant-plan.json', 'bindings.json'].includes(file)) return 262144;
  if (file === 'service.json') return MiB;
  return 16 * MiB;
}
async function bytes(path, maximum = 16 * MiB) {
  if (await realpath(path) !== resolve(path)) fail('Use canonical OpenSearch package files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail('OpenSearch release file exceeds its original size limit.');
    const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs || before.ino !== after.ino || before.dev !== after.dev)
      fail('OpenSearch package changed during inspection.');
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

/** Compile the retained declaration, plan and public contract without accessing the source or credentials. */
export async function prepareOpenSearchRelease(packageDirectory) {
  try {
    const directory = resolve(packageDirectory);
    if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory())
      fail('Choose the canonical directory containing the prepared OpenSearch merchant.');
    await assertPrepared(directory);
    const retained = Object.fromEntries(await Promise.all(FILES.map(async file => [file, await bytes(join(directory, file), limit(file))])));
    if (Object.values(retained).reduce((sum, value) => sum + value.length, 0) > 64 * MiB)
      fail('OpenSearch package exceeds its 64 MiB retained release limit.');
    const source = validateOpenSearchSource(parse(retained['source.json']));
    const plan = parse(retained['merchant-plan.json']);
    const compiled = compileOpenSearchMerchantPlan(source.queries, plan);
    const service = parse(retained['service.json']);
    if (!isDeepStrictEqual(service, compiled.service) ||
        stable(source.bindings) !== stable(compiled.bindings) ||
        stable(parse(retained['bindings.json'])) !== stable(compiled.bindings))
      fail('The retained OpenSearch plan, service and typed query bindings differ. Prepare a new package.');
    const routes = compileSellerRoutes(compiled.service.routes.map(route => ({
      id: route.id, offer: route.offer, handler() { throw new Error('Release inspection only'); }, admit() { return true; },
    })));
    const openapi = compileSellerOpenApi(routes, { mode: 'CHALLENGE_ONLY' });
    if (!isDeepStrictEqual(parse(retained['openapi.json']), openapi) ||
        !retained['openapi.json'].equals(retained['client/seller-openapi.json']))
      fail('The prepared OpenSearch OpenAPI or generated customer contract differs from its source.');
    const client = await inspectSellerClientExport({ directory: join(directory, 'client') });
    if (client.state !== 'COMPLETE' || client.sourceSha256 !== hash(retained['openapi.json']) ||
        client.manifestFile.sha256 !== hash(retained['client/' + CLIENT_EXPORT_MANIFEST]) ||
        client.files.some(file => file.sha256 !== hash(retained['client/' + file.name]) ||
          file.bytes !== retained['client/' + file.name].length))
      fail('The original OpenSearch customer files differ from their completed export.');
    const metadata = { sourceConfigSha256: hash(retained['source.json']), planSha256: hash(retained['merchant-plan.json']),
      bindingsSha256: hash(retained['bindings.json']), openapiSha256: hash(retained['openapi.json']),
      clientManifestSha256: client.manifestFile.sha256,
      queryDefinitionSha256: hash(stable(source.queries)),
      connectionProfileSha256: hash(stable({ endpointEnv: source.endpointEnv, auth: source.auth,
        allowLocal: source.allowLocal ?? false, maxInFlight: source.maxInFlight })),
      environment: [source.endpointEnv, ...Object.entries(source.auth).filter(([key]) => key.endsWith('Env')).map(([, value]) => value)],
      sourceSemantics: 'live-named-point-in-time-searches',
      queries: describeOpenSearchQueries(compileOpenSearchQueries(source.queries)) };
    const opensearch = { ...metadata, executionSha256: hash(stable(metadata)) };
    const offers = { schema: 'stellar-forge.opensearch-seller-offers.v1',
      offers: service.routes.map(route => ({ id: route.id, seller: route.offer })) };
    return { directory, source, plan, service, serviceBytes: retained['service.json'], retained, opensearch,
      offers, offersBytes: formatted(offers), files: ordered(FILES.map(file => descriptor(PACKAGE + '/' + file, retained[file]))) };
  } catch (error) { throw sourceError(error); }
}

/** Retain every original prepared file; no search or seller process starts during staging. */
export async function stageOpenSearchRelease(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareOpenSearchRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the OpenSearch release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original prepared OpenSearch package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, PACKAGE, 'client'), { recursive: true, mode: 0o700 });
    for (const file of FILES) await writeNew(join(target, PACKAGE, file), prepared.retained[file]);
    const manifest = { schema: OPENSEARCH_SOURCE_SCHEMA, packagePath: PACKAGE, opensearch: prepared.opensearch,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const folder of [PACKAGE + '/client', PACKAGE, 'opensearch', '']) await syncDirectory(join(target, folder));
    return await inspectOpenSearchRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Reopen the retained source after the original workspace or its package has moved. */
export async function inspectOpenSearchRelease(directory) {
  const root = resolve(directory);
  const manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB), manifest = parse(manifestBytes);
  if (manifest.schema !== OPENSEARCH_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.opensearch || !Array.isArray(manifest.files))
    fail('Expected an original OpenSearch merchant release.');
  const prepared = await prepareOpenSearchRelease(join(root, PACKAGE));
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.opensearch, prepared.opensearch))
    fail('The retained OpenSearch queries, limits, connection profile or customer files changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json'), 2 * MiB), serviceBytes = await bytes(join(root, 'seller-service.json'), MiB);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained OpenSearch offers or service differ from the original package.');
  return { manifest, opensearch: prepared.opensearch, offers: prepared.offers, service: prepared.service,
    environment: prepared.opensearch.environment, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}
function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator', 'operationsNavigationOrigin'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained OpenSearch runtime options.');
  if (runtime.operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.operationsNavigationOrigin) ||
        Number(new URL(runtime.operationsNavigationOrigin).port) > 65535))
    throw new TypeError('The operations navigation origin must be the original loopback release console.');
  return { ...runtime, port: Number(runtime.port ?? 0) };
}

/** The maintained source, original merchant and SF82 process own query admission, payment and drain. */
export async function startOpenSearchRelease(directory, { runtime = { port: 0 }, env = process.env } = {}) {
  const root = resolve(directory), snapshot = await inspectOpenSearchRelease(root), options = selectedRuntime(runtime);
  const nativeFactory = await createOpenSearchNativeFactory(options);
  const session = await startOpenSearchSeller({ directory: join(root, PACKAGE), env, nativeFactory,
    port: options.port, operationsPort: 0, availabilityDirectory: join(root, 'opensearch-availability'),
    navigationOrigin: options.operationsNavigationOrigin ?? null });
  return { ...session, snapshot, opensearch: snapshot.opensearch };
}

/** The unchanged SF82 child invokes this entry after its original ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-opensearch.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectOpenSearchRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256 ||
      saved.source?.executionSha256 !== snapshot.opensearch.executionSha256)
    fail('Runtime settings belong to another OpenSearch release.');
  const session = await startOpenSearchRelease(directory, { runtime: saved.options });
  try {
    if (!session.server.listening) throw new Error('Original OpenSearch seller stopped during startup.');
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      operations: session.operations.url, opensearch: snapshot.opensearch });
    const onSignal = () => { void session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
    const originalClose = session.close.bind(session);
    let closing;
    session.close = () => closing ??= originalClose().finally(() => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
    });
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
