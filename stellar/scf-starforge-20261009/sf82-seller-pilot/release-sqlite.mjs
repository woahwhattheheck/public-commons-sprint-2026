// MIT. Original SQLite workbench and query runtime in the retained SF82 lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { compileQueries } from '../sf30-seller-sdk/sqlite/parameters.mjs';
import { openSqliteQueryFile } from '../sf30-seller-sdk/sqlite/config.mjs';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../sf30-seller-sdk/seller.mjs';

export const SQLITE_SOURCE_SCHEMA = 'stellar-forge.sqlite-seller-release-manifest.v1';
const ORIGINAL = 'sqlite/original', DATABASE = 'sqlite/snapshot.sqlite', SOURCE = 'sqlite/source.json';
const PACKAGE_FILES = ['source.json', 'service.json', 'handlers.mjs', 'launch.mjs', 'RUN.md'];
const SNAPSHOT_WORKER = fileURLToPath(new URL('./release-sqlite-snapshot.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const order = files => files.sort((a, b) => a.file.localeCompare(b.file));
const descriptor = (file, bytes) => ({ file, bytes: String(bytes.length), sha256: hash(bytes) });
const fail = message => { throw Object.assign(new Error(message), { code: 'SQLITE_RELEASE_CHANGED' }); };
const fault = (code, message) => Object.assign(new Error(message), { code });

async function regular(path, limit = null) {
  if (await realpath(path) !== resolve(path)) fail('SQLite releases require canonical regular files.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || limit !== null && info.size > BigInt(limit)) fail('SQLite release file exceeds its source limit.');
    return { file, info };
  } catch (error) { await file.close(); throw error; }
}
async function bytes(path, limit) {
  const { file, info } = await regular(path, limit);
  try {
    const buffer = Buffer.alloc(Number(info.size) + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs)
      fail('SQLite release file changed during inspection.');
    return buffer.subarray(0, used);
  } finally { await file.close(); }
}
async function fileDescriptor(path, fileName, maxBytes) {
  const { file, info } = await regular(path, maxBytes);
  try {
    const digest = createHash('sha256'); let size = 0n;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      digest.update(chunk); size += BigInt(chunk.length);
      if (size > BigInt(maxBytes)) fail('Retained SQLite snapshot grew beyond its declared size.');
    }
    const after = await file.stat({ bigint: true });
    if (size !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs)
      fail('Retained SQLite snapshot changed during inspection.');
    return { file: fileName, bytes: String(size), sha256: digest.digest('hex') };
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
export function sqliteSnapshotOptions({ maxBytes = 1073741824, timeoutMs = 120000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 1099511627776)
    throw new RangeError('SQLite snapshot maxBytes must be 4096–1099511627776.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000)
    throw new RangeError('SQLite snapshot timeoutMs must be 100–3600000.');
  return { maxBytes, timeoutMs };
}

/** Read and compile the ORIGINAL six-file workbench export without executing it. */
export async function prepareSqliteRelease(packageDirectory) {
  const directory = resolve(packageDirectory);
  if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
    throw new TypeError('Choose the original SQLite workbench export directory.');
  const manifestBytes = await bytes(join(directory, 'manifest.json'), 262144), manifest = parse(manifestBytes);
  if (manifest.schema !== 'stellar-forge.sqlite-workbench-release.v1' || !/^[0-9a-f]{64}$/.test(manifest.draftRevision) || manifest.databaseCopied !== false ||
      manifest.previewRowsIncluded !== false || !manifest.files ||
      !isDeepStrictEqual(Object.keys(manifest.files).sort(), [...PACKAGE_FILES].sort()))
    throw new TypeError('Expected the original six-file SQLite workbench export.');
  const originals = new Map([['manifest.json', manifestBytes]]);
  for (const name of PACKAGE_FILES) {
    const content = await bytes(join(directory, name), name === 'source.json' ? 262144 : 1048576);
    if (hash(content) !== manifest.files[name]) fail('Original SQLite workbench file differs from its export manifest.');
    originals.set(name, content);
  }
  const source = parse(originals.get('source.json'));
  if (source.schema !== 'stellar-forge.sqlite-source.v1' || typeof source.database !== 'string' ||
      !source.database || source.database === ':memory:') throw new TypeError('Expected the original file-based SQLite source.');
  compileQueries(source.queries);
  const declaredService = await readSellerConfig(join(directory, 'service.json'));
  if (!isDeepStrictEqual(declaredService, parse(originals.get('service.json'))))
    fail('Original SQLite service changed while its native configuration was read.');
  if (!isDeepStrictEqual(Object.keys(source.queries).sort(), declaredService.routes.map(route => route.id).sort()))
    throw new TypeError('SQLite workbench routes must bind exactly the original declared query names.');
  const offers = [];
  const service = { ...declaredService, routes: declaredService.routes.map((route, index) => {
    if (!['GET', 'POST'].includes(route.definition?.method) || route.handler !== `query_${index}` || route.admit !== `admit_${index}`)
      throw new TypeError('Retain the original SQLite workbench query/admission bindings.');
    const offer = compileHttpSellerOffer({ ...route.definition, url: declaredService.publicOrigin + route.path });
    paymentRequiredResponse(offer);
    offers.push({ id: route.id, seller: offer });
    const { definition, ...binding } = route;
    return { ...binding, offer };
  }) };
  const offered = { schema: 'stellar-forge.sqlite-seller-offers.v1', offers };
  const sourceBytes = formatted({ ...source, database: 'snapshot.sqlite' });
  const serviceBytes = formatted(service), offersBytes = formatted(offered);
  if (sourceBytes.length > 262144 || serviceBytes.length > 1048576 || offersBytes.length > 1048576)
    throw new RangeError('The retained SQLite source or compiled service exceeds its original file limit.');
  return { directory, manifest, originals, source, sourceBytes, service,
    serviceBytes, offers: offered, offersBytes };
}

/** One native backup process; cancellation/deadline drains it before discarding output. */
export async function captureSqliteReleaseSnapshot(database, target, options = {}) {
  const limits = sqliteSnapshotOptions(options), path = await realpath(resolve(database));
  if (options.signal !== undefined && (typeof options.signal?.addEventListener !== 'function' ||
      typeof options.signal?.removeEventListener !== 'function' || typeof options.signal?.aborted !== 'boolean'))
    throw new TypeError('SQLite snapshot signal must be an AbortSignal.');
  const info = await lstat(path, { bigint: true });
  if (!info.isFile()) throw new TypeError('SQLite source must be an existing regular database.');
  if (options.signal?.aborted) throw fault('SQLITE_SNAPSHOT_ABORTED', 'SQLite snapshot was cancelled.');
  await writeNew(target, Buffer.alloc(0));
  return new Promise((resolveResult, reject) => {
    let result, failure, timer, child;
    const abort = () => { failure ??= fault('SQLITE_SNAPSHOT_ABORTED', 'SQLite snapshot was cancelled.'); child?.kill('SIGKILL'); };
    try {
      child = fork(SNAPSHOT_WORKER, [], { env: {}, execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      timer = setTimeout(() => { failure ??= fault('SQLITE_SNAPSHOT_TIMEOUT', 'SQLite snapshot exceeded its selected deadline.'); child.kill('SIGKILL'); }, limits.timeoutMs);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.on('error', error => { failure ??= error; });
      child.on('message', message => {
        if (message?.type === 'complete') result = message.snapshot;
        else if (message?.type === 'failed') failure ??= fault(message.code, message.message);
      });
      child.once('close', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (!failure && code === 0 && result) resolveResult(result);
        else reject(failure ?? fault('SQLITE_SNAPSHOT_FAILED', 'The native SQLite snapshot did not complete.'));
      });
      child.send({ type: 'sqlite-release-snapshot', database: path, target: resolve(target), maxBytes: limits.maxBytes,
        sourceIdentity: { device: String(info.dev), inode: String(info.ino) } }, error => {
        if (error) { failure ??= error; child.kill('SIGKILL'); }
      });
    } catch (error) {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (child) { failure ??= error; child.kill('SIGKILL'); } else reject(error);
    }
  });
}

function metadata(prepared, database) {
  const content = { packageManifestSha256: hash(prepared.originals.get('manifest.json')),
    originalSourceSha256: hash(prepared.originals.get('source.json')),
    sourceConfigSha256: hash(prepared.sourceBytes), querySha256: hash(stable(prepared.source.queries)),
    databaseSha256: database.sha256, databaseBytes: database.bytes };
  return { ...content, executionSha256: hash(stable(content)) };
}
function sourceFiles(prepared, database) {
  return order([...prepared.originals].map(([name, content]) => descriptor(ORIGINAL + '/' + name, content))
    .concat(descriptor(SOURCE, prepared.sourceBytes), database));
}
async function unchangedWal(path) {
  try { if ((await lstat(path + '-wal')).size !== 0) fail('Retained SQLite snapshot has changed WAL data. Stage a new release.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** Freeze committed native DB contents beside original source and reviewed terms. */
export async function stageSqliteRelease(directory, packageDirectory, options = {}) {
  const limits = sqliteSnapshotOptions(options), target = resolve(directory), prepared = await prepareSqliteRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    throw new TypeError('Use a canonical release destination parent.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside the original SQLite workbench package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, ORIGINAL), { recursive: true, mode: 0o700 });
    for (const [name, content] of prepared.originals) await writeNew(join(target, ORIGINAL, name), content);
    await writeNew(join(target, SOURCE), prepared.sourceBytes);
    const snapshot = await captureSqliteReleaseSnapshot(resolve(prepared.directory, prepared.source.database), join(target, DATABASE),
      { ...limits, signal: options.signal });
    await unchangedWal(join(target, DATABASE));
    const database = await fileDescriptor(join(target, DATABASE), DATABASE, limits.maxBytes);
    const sqlite = metadata(prepared, database), files = sourceFiles(prepared, database);
    const manifest = { schema: SQLITE_SOURCE_SCHEMA, packagePath: ORIGINAL, sqlite, snapshot,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files };
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifestBytes = formatted(manifest);
    await writeNew(join(target, 'manifest.json'), manifestBytes);
    for (const path of [join(target, ORIGINAL), join(target, 'sqlite'), target]) await syncDirectory(path);
    return { manifest, offers: prepared.offers, service: prepared.service, sqlite, hasApplication: true,
      files: order([descriptor('manifest.json', manifestBytes), descriptor('offers.json', prepared.offersBytes),
        descriptor('seller-service.json', prepared.serviceBytes), ...files]) };
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Inspect exact retained sources/data without touching the original DB or starting it. */
export async function inspectSqliteRelease(directory) {
  const target = resolve(directory);
  if (!(await lstat(target)).isDirectory() || await realpath(target) !== target)
    throw new TypeError('Choose a retained SQLite release directory.');
  const manifestBytes = await bytes(join(target, 'manifest.json'), 2097152), manifest = parse(manifestBytes);
  if (manifest.schema !== SQLITE_SOURCE_SCHEMA || manifest.packagePath !== ORIGINAL || !manifest.sqlite ||
      !Array.isArray(manifest.files) || manifest.snapshot?.schema !== 'stellar-forge.sqlite-release-capture.v1' ||
      manifest.snapshot.readOnly !== true || manifest.snapshot.queryOnly !== 1 || manifest.snapshot.readUncommitted !== 0 ||
      manifest.snapshot.isolation !== 'single-connection-read-transaction')
    throw new TypeError('Expected a retained original SQLite merchant snapshot.');
  const prepared = await prepareSqliteRelease(join(target, ORIGINAL));
  const sourceBytes = await bytes(join(target, SOURCE), 262144);
  if (!sourceBytes.equals(prepared.sourceBytes)) fail('Retained SQLite query/runtime source changed.');
  const declaredSize = manifest.sqlite.databaseBytes;
  if (typeof declaredSize !== 'string' || !/^[1-9]\d{0,12}$/.test(declaredSize) || BigInt(declaredSize) > 1099511627776n)
    fail('Retained SQLite snapshot has an invalid size declaration.');
  await unchangedWal(join(target, DATABASE));
  const database = await fileDescriptor(join(target, DATABASE), DATABASE, Number(declaredSize));
  const sqlite = metadata(prepared, database), files = sourceFiles(prepared, database);
  if (!isDeepStrictEqual(sqlite, manifest.sqlite) || !isDeepStrictEqual(files, manifest.files))
    fail('Retained SQLite source, query or native snapshot changed. Stage a new release.');
  const offersBytes = await bytes(join(target, 'offers.json'), 1048576), serviceBytes = await bytes(join(target, 'seller-service.json'), 1048576);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('Retained SQLite offers or service differ from the original workbench.');
  return { manifest, offers: prepared.offers, service: prepared.service, sqlite, hasApplication: true,
    files: order([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...files]) };
}

/** Original query admission/worker and SF30 seller, with original native x402 factory. */
export async function startSqliteRelease(directory, runtime = {}, { nativeFactory = null } = {}) {
  const path = resolve(directory), snapshot = await inspectSqliteRelease(path);
  return startSqliteSnapshot(path, snapshot, runtime, nativeFactory);
}
async function startSqliteSnapshot(path, snapshot, runtime, nativeFactory = null) {
  if (Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)) ||
      !Number.isInteger(runtime.port ?? 8423) || (runtime.port ?? 8423) < 0 || (runtime.port ?? 8423) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained SQLite release runtime options.');
  if (runtime.facilitator) {
    if (nativeFactory) throw new TypeError('Choose the original facilitator URL or one embedding native factory.');
    const url = new URL(runtime.facilitator);
    const local = runtime.allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Use a credential-free HTTPS facilitator or explicitly selected loopback HTTP.');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const source = await openSqliteQueryFile(join(path, SOURCE)); let seller, closing;
  try {
    const handlers = Object.create(null);
    for (const route of snapshot.service.routes) {
      const binding = source.route(route.id, { input: route.offer.extensions.bazaar.info.input.method === 'POST' ? 'body' : 'query' });
      handlers[route.handler] = binding.handler; handlers[route.admit] = binding.admit;
    }
    seller = await startSellerService({ config: snapshot.service, port: runtime.port ?? 8423, handlers, nativeFactory });
    const close = () => closing ??= (async () => { try { return await seller.close(); } finally { await source.close(); } })();
    return { ...seller, source, sqlite: snapshot.sqlite, close };
  } catch (error) { await seller?.close().catch(() => {}); await source.close(); throw error; }
}

/** Same SF82 owned child boundary and readiness contract as original source adapters. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-sqlite.mjs --resume RELEASE_DIRECTORY');
  const path = resolve(args[1]), snapshot = await inspectSqliteRelease(path);
  const saved = parse(await bytes(join(path, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 || saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('SQLite runtime options belong to another release.');
  if (!saved.options || typeof saved.options !== 'object' || Array.isArray(saved.options) ||
      !/^\d{1,5}$/.test(String(saved.options.port))) throw new TypeError('Invalid retained SQLite port.');
  const session = await startSqliteSnapshot(path, snapshot, { ...saved.options, port: Number(saved.options.port) });
  let closing;
  const stop = () => { closing ??= session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
  try {
    await atomic(join(path, 'runtime-readiness.json'), { schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length, sqlite: snapshot.sqlite });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const originalClose = session.close;
    session.close = () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); return originalClose(); };
    return session;
  } catch (error) { await session.close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
