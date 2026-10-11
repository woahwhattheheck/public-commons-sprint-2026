// MIT. Retain the original MySQL merchant package in the SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyPreparedMysqlSeller, compileMysqlMerchantPlan } from '../sf30-seller-sdk/mysql/prepare.mjs';
import { readMysqlSourceFile } from '../sf30-seller-sdk/mysql/config.mjs';
import { startMysqlSeller, createMysqlNativeFactory } from '../sf30-seller-sdk/mysql/merchant.mjs';

export const MYSQL_SOURCE_SCHEMA = 'stellar-forge.mysql-seller-release-manifest.v1';
const PACKAGE = 'mysql/package';
const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const descriptor = (file, value) => ({ file, bytes: value.length, sha256: hash(value) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'MYSQL_RELEASE_CHANGED' }); };

function sourceError(error) {
  if (typeof error?.syscall === 'string') return Object.assign(new Error(
    'The configured MySQL package is unavailable. Restore its original files or select an available package.',
    { cause: error }), { code: 'MYSQL_PACKAGE_UNAVAILABLE' });
  if (error instanceof SyntaxError || error?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
    return Object.assign(new Error('The MySQL package must contain valid UTF-8 JSON.', { cause: error }),
      { code: 'MYSQL_PACKAGE_INVALID' });
  return error;
}
async function regular(path, maximum = 16 * MiB) {
  if (await realpath(path) !== resolve(path)) fail('Use canonical MySQL package files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(maximum)) fail('MySQL package file exceeds its original size limit.');
    return { file, info };
  } catch (error) { await file.close(); throw error; }
}
async function bytes(path, maximum) {
  const { file, info } = await regular(path, maximum);
  try {
    const buffer = Buffer.alloc(Number(info.size) + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs)
      fail('MySQL package changed during inspection.');
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
async function copyEntry(source, target, entry) {
  const { file: input, info } = await regular(source); let output, copied = 0n;
  try {
    if (info.size !== BigInt(entry.bytes)) fail('Prepared MySQL file changed before release capture.');
    output = await open(target, 'wx', 0o600);
    const digest = createHash('sha256');
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      digest.update(chunk); copied += BigInt(chunk.length);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) fail('MySQL release copy stopped before completing.');
        offset += bytesWritten;
      }
    }
    const after = await input.stat({ bigint: true });
    if (copied !== info.size || after.size !== info.size || after.mtimeNs !== info.mtimeNs || digest.digest('hex') !== entry.sha256)
      fail('Prepared MySQL file changed during release capture.');
    await output.sync();
  } finally { await output?.close(); await input.close(); }
}

/** Inspect original contracts and every declared byte without resolving credentials or opening a database. */
export async function prepareMysqlRelease(packageDirectory) {
  try { return await readPreparedMysqlRelease(packageDirectory); } catch (error) { throw sourceError(error); }
}
async function readPreparedMysqlRelease(packageDirectory) {
  const directory = resolve(packageDirectory);
  if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory())
    fail('Choose the canonical directory containing the original prepared MySQL merchant.');
  const bundle = await verifyPreparedMysqlSeller(directory);
  const manifestBytes = await bytes(join(directory, 'manifest.json'), 262144), manifest = parse(manifestBytes);
  if (hash(manifestBytes) !== bundle.manifestSha256) fail('Prepared MySQL manifest changed during inspection.');
  const sourceBytes = await bytes(join(directory, 'source.json'), 262144);
  const serviceBytes = await bytes(join(directory, 'service.json'), 262144);
  const planBytes = await bytes(join(directory, 'merchant-plan.json'), 262144);
  for (const [name, value] of [['source.json', sourceBytes], ['service.json', serviceBytes], ['merchant-plan.json', planBytes]])
    if (hash(value) !== manifest.files[name].sha256 || value.length !== manifest.files[name].bytes)
      fail('Prepared MySQL source, service or plan changed during inspection.');
  const declaration = await readMysqlSourceFile(join(directory, 'source.json'));
  if (!isDeepStrictEqual(declaration.config, parse(sourceBytes))) fail('Prepared MySQL source changed during inspection.');
  const source = declaration.config, plan = parse(planBytes), service = parse(serviceBytes);
  const compiled = compileMysqlMerchantPlan(source.queries, plan);
  // The original compiler uses a null-prototype bindings map; prepared files retain its JSON values.
  if (!isDeepStrictEqual(service, compiled.service) || stable(source.bindings) !== stable(compiled.bindings))
    fail('The retained MySQL plan, public terms and original query bindings differ. Prepare the merchant again.');
  const hasCa = Object.hasOwn(manifest.files, 'database-ca.pem');
  if (hasCa !== Boolean(source.connection.caFile) || hasCa && source.connection.caFile !== 'database-ca.pem')
    fail('Retain the original package-local database CA alongside the MySQL source.');
  const routes = service.routes.map(route => ({ id: route.id, method: route.offer.extensions.bazaar.info.input.method,
    url: route.offer.resource.url, paymentOptions: route.offer.accepts.length }));
  if (manifest.sourceSemantics !== 'live-named-read-queries' || manifest.client !== 'original-sf30' ||
      !isDeepStrictEqual(manifest.routes, routes)) fail('Expected the original prepared MySQL merchant contract.');
  const content = { packageManifestSha256: bundle.manifestSha256,
    sourceConfigSha256: manifest.files['source.json'].sha256, planSha256: manifest.files['merchant-plan.json'].sha256,
    queryDefinitionSha256: hash(stable(source.queries)), connectionProfileSha256: hash(stable(source.connection)),
    databaseCaSha256: hasCa ? manifest.files['database-ca.pem'].sha256 : null,
    credentialReferences: source.connection.passwordEnv ? [source.connection.passwordEnv] : [],
    sourceSemantics: manifest.sourceSemantics, queries: declaration.description };
  const mysql = { ...content, executionSha256: hash(stable(content)) };
  const offers = { schema: 'stellar-forge.mysql-seller-offers.v1',
    offers: service.routes.map(route => ({ id: route.id, seller: route.offer })) };
  const files = ordered([descriptor(PACKAGE + '/manifest.json', manifestBytes),
    ...Object.entries(manifest.files).map(([file, entry]) => ({ file: PACKAGE + '/' + file,
      bytes: entry.bytes, sha256: entry.sha256 }))]);
  return { directory, bundle, manifest, mysql, service, serviceBytes, offers, offersBytes: formatted(offers), files };
}

/** Copy only the original package's declared files into the existing release staging directory. */
export async function stageMysqlRelease(directory, packageDirectory) {
  const target = resolve(directory), prepared = await prepareMysqlRelease(packageDirectory);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the MySQL release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original prepared MySQL package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    const directories = new Set([target]);
    for (const entry of prepared.files) {
      const destination = join(target, entry.file);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      let parent = dirname(destination);
      while (parent !== target) { directories.add(parent); parent = dirname(parent); }
      await copyEntry(join(prepared.directory, entry.file.slice(PACKAGE.length + 1)), destination, entry);
    }
    const manifest = { schema: MYSQL_SOURCE_SCHEMA, packagePath: PACKAGE, mysql: prepared.mysql,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const path of [...directories].sort((a, b) => b.length - a.length)) await syncDirectory(path);
    return await inspectMysqlRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

/** Reopen the same package after the authoring directory has moved or disappeared. */
export async function inspectMysqlRelease(directory) {
  const root = resolve(directory);
  const manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB), manifest = parse(manifestBytes);
  if (manifest.schema !== MYSQL_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.mysql || !Array.isArray(manifest.files))
    fail('Expected a retained original MySQL merchant release.');
  const prepared = await prepareMysqlRelease(join(root, PACKAGE));
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.mysql, prepared.mysql))
    fail('The retained MySQL query, connection, plan or client changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json'), 2 * MiB), serviceBytes = await bytes(join(root, 'seller-service.json'), 262144);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained MySQL offers or service differ from the original package.');
  return { manifest, mysql: prepared.mysql, offers: prepared.offers, service: prepared.service,
    package: prepared.bundle, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}

function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained MySQL runtime options.');
  return { ...runtime, port: Number(runtime.port ?? 0) };
}

/** The original MySQL source and SF30 seller own query admission, payment and drain. */
export async function startMysqlRelease(directory, { runtime = { port: 0 }, environment = process.env } = {}) {
  const root = resolve(directory), snapshot = await inspectMysqlRelease(root), options = selectedRuntime(runtime);
  const nativeFactory = await createMysqlNativeFactory(options);
  const session = await startMysqlSeller({ sourceFile: join(root, PACKAGE, 'source.json'),
    configFile: join(root, PACKAGE, 'service.json'), environment, port: options.port, operationsPort: null, nativeFactory });
  return { ...session, snapshot, mysql: snapshot.mysql };
}

/** The original SF82 child invokes this after its ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-mysql.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectMysqlRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another MySQL release.');
  const session = await startMysqlRelease(directory, { runtime: saved.options });
  try {
    if (!session.server.listening) throw new Error('Original MySQL seller stopped during startup.');
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length, mysql: snapshot.mysql });
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
