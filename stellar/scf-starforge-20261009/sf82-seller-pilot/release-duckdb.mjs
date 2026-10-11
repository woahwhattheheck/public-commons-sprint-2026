// MIT. Retain an original DuckDB package in the existing SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyPreparedDuckdbSeller, runPreparedDuckdbSeller } from '../sf30-seller-sdk/duckdb/prepare.mjs';

export const DUCKDB_SOURCE_SCHEMA = 'stellar-forge.duckdb-seller-release-manifest.v1';
const PACKAGE = 'duckdb/package';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const order = files => files.sort((a, b) => a.file.localeCompare(b.file));
const descriptor = (file, bytes) => ({ file, bytes: String(bytes.length), sha256: hash(bytes) });
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const fail = message => { throw Object.assign(new Error(message), { code: 'DUCKDB_RELEASE_CHANGED' }); };

export function selectDuckdbInterpreter(value = 'python3', base = process.cwd()) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || value.startsWith('-'))
    throw new TypeError('Choose a Python executable with the original DuckDB dependency.');
  return isAbsolute(value) || !value.includes('/') && !value.includes('\\') ? value : resolve(base, value);
}
async function regular(path, limit = null) {
  if (await realpath(path) !== resolve(path)) fail('DuckDB releases require regular source files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || limit !== null && info.size > BigInt(limit)) fail('DuckDB release file exceeds its original size limit.');
    return { file, info };
  } catch (error) { await file.close(); throw error; }
}
async function bytes(path, limit) {
  const { file, info } = await regular(path, limit);
  try {
    const value = Buffer.alloc(Number(info.size) + 1); let used = 0;
    while (used < value.length) {
      const { bytesRead } = await file.read(value, used, value.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs)
      fail('DuckDB release file changed during inspection.');
    return value.subarray(0, used);
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
function filesOf(bundle, manifestBytes) {
  return order([
    descriptor(PACKAGE + '/manifest.json', manifestBytes),
    ...bundle.manifest.files.map(entry => ({ file: PACKAGE + '/' + entry.path, bytes: entry.bytes, sha256: entry.sha256 })),
  ]);
}
function metadata(bundle, manifestBytes, interpreter) {
  const entries = new Map(bundle.manifest.files.map(entry => [entry.path, entry]));
  const datasets = bundle.manifest.files.filter(entry => entry.kind === 'dataset')
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
  const content = { packageManifestSha256: hash(manifestBytes), originalSourceSha256: bundle.manifest.originalSource.sourceSha256,
    sourceConfigSha256: entries.get('data/source.json').sha256, planSha256: entries.get('plan.json').sha256,
    datasetSha256: hash(stable(datasets)), datasetFiles: datasets.length,
    datasetBytes: String(datasets.reduce((sum, entry) => sum + BigInt(entry.bytes), 0n)),
    engineVersion: bundle.manifest.nativePreflight.engineVersion, interpreter: selectDuckdbInterpreter(interpreter) };
  return { ...content, executionSha256: hash(stable(content)) };
}
function producedFiles(bundle) {
  const offers = { schema: 'stellar-forge.duckdb-seller-offers.v1',
    offers: bundle.service.routes.map(route => ({ id: route.id, seller: route.offer })) };
  return { offers, offersBytes: formatted(offers) };
}

/** Read the original package and dataset bytes. Inspection starts no Python process. */
export async function prepareDuckdbRelease(packageDirectory, { python = 'python3' } = {}) {
  const interpreter = selectDuckdbInterpreter(python);
  const bundle = await verifyPreparedDuckdbSeller({ directory: packageDirectory });
  const manifestBytes = await bytes(join(bundle.directory, 'manifest.json'), 262144);
  if (!isDeepStrictEqual(parse(manifestBytes), bundle.manifest)) fail('Prepared DuckDB manifest changed during inspection.');
  const serviceBytes = await bytes(join(bundle.directory, 'service.json'), 16 * 1024 * 1024);
  const serviceEntry = bundle.manifest.files.find(entry => entry.path === 'service.json');
  if (hash(serviceBytes) !== serviceEntry.sha256) fail('Prepared DuckDB service changed during inspection.');
  return { bundle, manifestBytes, serviceBytes, duckdb: metadata(bundle, manifestBytes, interpreter),
    files: filesOf(bundle, manifestBytes), ...producedFiles(bundle) };
}

async function copyEntry(source, target, entry) {
  const { file: input, info } = await regular(source);
  let output, copied = 0n;
  try {
    if (String(info.size) !== entry.bytes) fail('Prepared DuckDB file changed before release capture.');
    output = await open(target, 'wx', 0o600);
    const digest = createHash('sha256');
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      digest.update(chunk); copied += BigInt(chunk.length);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) fail('DuckDB release copy stopped before completing.');
        offset += bytesWritten;
      }
    }
    const after = await input.stat({ bigint: true });
    if (copied !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs || digest.digest('hex') !== entry.sha256)
      fail('Prepared DuckDB file changed during release capture.');
    await output.sync();
  } finally { await output?.close(); await input.close(); }
}

/** Retain the exact original generated package and copy its declared data only. */
export async function stageDuckdbRelease(directory, packageDirectory, options = {}) {
  const target = resolve(directory), prepared = await prepareDuckdbRelease(packageDirectory, options);
  const canonicalTarget = join(await realpath(dirname(target)), basename(target));
  if (canonicalTarget !== target) fail('DuckDB release destination must use a canonical parent directory.');
  const within = relative(prepared.bundle.directory, canonicalTarget);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside the original prepared DuckDB package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    const directories = new Set([target]);
    for (const entry of prepared.files) {
      const destination = join(target, entry.file);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      let parent = dirname(destination);
      while (parent !== target) { directories.add(parent); parent = dirname(parent); }
      await copyEntry(join(prepared.bundle.directory, entry.file.slice(PACKAGE.length + 1)), destination, entry);
    }
    const manifest = { schema: DUCKDB_SOURCE_SCHEMA, packagePath: PACKAGE, duckdb: prepared.duckdb,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const path of [...directories].sort((a, b) => b.length - a.length)) await syncDirectory(path);
    return await inspectDuckdbRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Reopen through the original package verifier and bind every retained native file. */
export async function inspectDuckdbRelease(directory) {
  const target = resolve(directory);
  if (!(await lstat(target)).isDirectory() || await realpath(target) !== target) fail('Expected a retained DuckDB release directory.');
  const manifestBytes = await bytes(join(target, 'manifest.json'), 2 * 1024 * 1024), manifest = parse(manifestBytes);
  if (manifest.schema !== DUCKDB_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.duckdb || !Array.isArray(manifest.files))
    throw new TypeError('Expected a retained original DuckDB release.');
  const prepared = await prepareDuckdbRelease(join(target, PACKAGE), { python: manifest.duckdb.interpreter });
  if (!isDeepStrictEqual(prepared.duckdb, manifest.duckdb) || !isDeepStrictEqual(prepared.files, manifest.files))
    fail('Retained DuckDB package, data or execution selection changed. Stage a new release.');
  const offersBytes = await bytes(join(target, 'offers.json'), 16 * 1024 * 1024);
  const serviceBytes = await bytes(join(target, 'seller-service.json'), 16 * 1024 * 1024);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('Retained DuckDB offers or service differ from the original package.');
  return { manifest, offers: prepared.offers, service: prepared.bundle.service, duckdb: prepared.duckdb,
    package: prepared.bundle, hasApplication: true,
    files: order([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}

/** Existing SF82 child entry, using the ORIGINAL prepared launcher and payment path. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-duckdb.mjs --resume RELEASE_DIRECTORY');
  const path = resolve(args[1]), snapshot = await inspectDuckdbRelease(path);
  const saved = parse(await bytes(join(path, 'pilot-runtime.json'), 65536)), runtime = saved.options;
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('DuckDB runtime options belong to another release.');
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port)) || Number(runtime.port) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained DuckDB release runtime options.');
  const originalArgs = ['--python', snapshot.duckdb.interpreter, '--port', String(runtime.port), '--no-operations'];
  if (runtime.facilitator) originalArgs.push('--facilitator', runtime.facilitator);
  if (runtime.allowLocalFacilitator) originalArgs.push('--allow-local-facilitator');
  const session = await runPreparedDuckdbSeller({ directory: join(path, PACKAGE), args: originalArgs });
  try {
    if (!session.seller.server.listening) throw new Error('Original DuckDB seller stopped during startup.');
    const receipt = { schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.seller.mode, listener: session.seller.url, routeCount: snapshot.service.routes.length,
      duckdb: snapshot.duckdb };
    await atomic(join(path, 'runtime-readiness.json'), receipt);
    return { ...session.seller, source: session.source, duckdb: snapshot.duckdb, close: () => session.close() };
  } catch (error) { await session.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
