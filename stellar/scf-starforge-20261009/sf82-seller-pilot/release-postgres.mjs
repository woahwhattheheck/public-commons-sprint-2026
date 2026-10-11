// MIT. Retain original PostgreSQL merchant declarations in the SF82 lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readPostgresSourceFile } from '../sf30-seller-sdk/postgres/config.mjs';
import { compilePostgresQueries, describePostgresQueries } from '../sf30-seller-sdk/postgres/declaration.mjs';
import { bindPostgresSeller } from '../sf30-seller-sdk/postgres/bindings.mjs';
import { startPostgresSeller } from '../sf30-seller-sdk/postgres/launch.mjs';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { startSellerOperations } from '../sf30-seller-sdk/operations/server.mjs';

export const POSTGRES_SOURCE_SCHEMA = 'stellar-forge.postgres-seller-release-manifest.v1';
const INPUT_SCHEMA = 'stellar-forge.postgres-release-input.v1';
const PACKAGE = 'postgres/package', ORIGINAL = 'postgres/original';
const INPUT_MANIFEST = 'postgres/input-manifest.json';
const MiB = 1024 * 1024;
const SOURCE_SEMANTICS = 'live-named-read-queries';
const OPTIONAL_INPUTS = [['bindings.json', 262144], ['query.sql', 65540], ['START.md', MiB]];
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const descriptor = (file, value) => ({ file, bytes: value.length, sha256: hash(value) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message, code = 'POSTGRES_PACKAGE_INVALID') => {
  throw Object.assign(new Error(message), { code,
    ...(['POSTGRES_PACKAGE_CHANGED', 'POSTGRES_PACKAGE_REVIEW_REQUIRED'].includes(code) ? { status: 409 } : {}) });
};
function aborted(signal) {
  if (signal === undefined) return;
  if (typeof signal.throwIfAborted !== 'function') throw new TypeError('An AbortSignal is required.');
  signal.throwIfAborted();
}
function sourceError(error, retained = false) {
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return error;
  if (typeof error?.code === 'string' && error.code.startsWith('POSTGRES_PACKAGE_')) return error;
  if (error?.code === 'POSTGRES_RELEASE_CHANGED') return error;
  const code = retained ? 'POSTGRES_RELEASE_CHANGED' : 'POSTGRES_PACKAGE_INVALID';
  const message = retained
    ? 'The retained PostgreSQL release changed or is unavailable. Restore its exact files or stage a new release.'
    : 'The PostgreSQL package is unavailable or does not satisfy the original source, binding and seller contracts. Re-export the selected merchant.';
  return Object.assign(new Error(message, { cause: error }), { code });
}
async function canonicalDirectory(path) {
  const absolute = resolve(path);
  if (await realpath(absolute) !== absolute || !(await lstat(absolute)).isDirectory())
    fail('Select a canonical PostgreSQL package directory without symlinks.');
  return absolute;
}
async function bytes(path, maximum, signal) {
  aborted(signal);
  if (await realpath(path) !== resolve(path)) fail('Use canonical PostgreSQL input files without symlinks.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum))
      fail('A PostgreSQL input exceeds its original file size limit.');
    const buffer = Buffer.alloc(Number(before.size) + 1); let total = 0;
    while (total < buffer.length) {
      aborted(signal);
      const result = await file.read(buffer, total, buffer.length - total, null);
      if (!result.bytesRead) break;
      total += result.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (BigInt(total) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
      fail('A PostgreSQL input changed while it was being retained.');
    return buffer.subarray(0, total);
  } finally { await file.close(); }
}
async function optionalBytes(path, maximum, signal) {
  try { return await bytes(path, maximum, signal); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeNew(path, value, signal) {
  aborted(signal);
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

function caFields(config) {
  return [...(config.caFile === undefined ? [] : ['caFile']),
    ...(config.connection?.caFile === undefined ? [] : ['connection.caFile'])];
}
function relocatedSource(config) {
  const source = structuredClone(config);
  if (own(source, 'caFile')) source.caFile = 'ca.pem';
  if (source.connection && own(source.connection, 'caFile')) source.connection.caFile = 'ca.pem';
  return source;
}
function publicQueries(compiled) {
  const described = describePostgresQueries(compiled);
  for (const query of Object.values(described)) {
    for (const [name, parameter] of Object.entries(query.parameters)) {
      const contract = Object.fromEntries(['type', 'nullable', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength']
        .filter(key => own(parameter, key)).map(key => [key, parameter[key]]));
      query.parameters[name] = { ...contract, hasDefault: own(parameter, 'default') };
    }
  }
  return described;
}
function sourcePolicy(config) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !['queries', 'bindings'].includes(key)));
}
function canonicalSql(value) { return value.trim().replace(/;\s*$/, ''); }

/** Use the original compilers for both authoring formats, without opening PostgreSQL. */
async function deriveInput(directory, originals, ca, signal) {
  aborted(signal);
  const sourceBytes = originals.get('source.json'), serviceBytes = originals.get('service.json');
  const declaration = await readPostgresSourceFile(join(directory, 'source.json'));
  const originalService = await readSellerConfig(join(directory, 'service.json'));
  const source = parse(sourceBytes);
  if (!isDeepStrictEqual(source, declaration.config) || !isDeepStrictEqual(parse(serviceBytes), originalService))
    fail('The original PostgreSQL source or service changed during inspection.');
  if (typeof originalService.publicOrigin !== 'string')
    fail('Set the merchant public HTTPS origin in the original PostgreSQL workspace or plan before retaining a release.',
      'POSTGRES_PACKAGE_PUBLIC_ORIGIN_REQUIRED');
  const origin = new URL(originalService.publicOrigin).origin;
  const compiledQueries = compilePostgresQueries(source.queries);
  if (!object(source.bindings) || !Object.keys(source.bindings).length ||
      originalService.routes.some(route => !own(source.bindings, route.id) || !route.handler))
    fail('Every PostgreSQL merchant route needs its original named-query binding.');
  const service = structuredClone(originalService);
  for (const route of service.routes)
    route.admit ??= '__postgres_admit_' + route.id.replaceAll('-', '_');
  const noOperation = () => {};
  // The native binder retains handler/admission collision and method authority.
  bindPostgresSeller(service, { route(name) {
    if (!own(compiledQueries, name)) fail('A merchant route references an unavailable named query.');
    return { handler: noOperation, admit: noOperation };
  } }, source.bindings);
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id,
    ...(route.offer ? { offer: route.offer } : { definition: { ...route.definition, url: origin + route.path } }),
    maxRequestBytes: route.maxRequestBytes, handler: noOperation, admit: noOperation })));
  const offersById = new Map(compiled.routes.map(route => [route.id, route.offer]));
  service.publicOrigin = origin;
  service.routes = service.routes.map(({ definition, ...route }) => ({ ...route, offer: offersById.get(route.id) }));
  const normalizedServiceBytes = formatted(service);
  if (normalizedServiceBytes.length > MiB) fail('Compiled PostgreSQL service exceeds the original 1 MiB limit.');
  if (originals.has('bindings.json') && stable(parse(originals.get('bindings.json'))) !== stable(source.bindings))
    fail('The prepared bindings file differs from the original source bindings. Re-prepare the merchant.');
  if (originals.has('query.sql')) {
    const sql = new TextDecoder('utf-8', { fatal: true }).decode(originals.get('query.sql'));
    if (Object.keys(compiledQueries).length !== 1 || canonicalSql(sql) !== Object.values(compiledQueries)[0].sql)
      fail('The workspace query.sql differs from its original named query. Re-export the merchant.');
  }
  if (originals.has('START.md')) new TextDecoder('utf-8', { fatal: true }).decode(originals.get('START.md'));
  const fields = caFields(source);
  if (Boolean(fields.length) !== Boolean(ca)) fail('Retain the selected original database CA with its source.');
  const runtimeSource = relocatedSource(source), runtimeSourceBytes = formatted(runtimeSource);
  if (runtimeSourceBytes.length > 262144) fail('Relocated PostgreSQL source exceeds the original 256 KiB limit.');
  const inputKind = originals.has('query.sql') ? 'POSTGRES_WORKSPACE_EXPORT'
    : originals.has('bindings.json') ? 'POSTGRES_PREPARED_MERCHANT' : 'POSTGRES_CONFIGURED_MERCHANT';
  const inputFiles = ordered([...originals].map(([file, value]) => descriptor(ORIGINAL + '/' + file, value)));
  if (ca) inputFiles.push(descriptor(ORIGINAL + '/database-ca.pem', ca));
  ordered(inputFiles);
  const inputManifest = { schema: INPUT_SCHEMA, inputKind, sourceSemantics: SOURCE_SEMANTICS,
    files: inputFiles, caFields: fields };
  const inputManifestBytes = formatted(inputManifest);
  const content = { inputKind, inputManifestSha256: hash(inputManifestBytes),
    originalSourceConfigSha256: hash(sourceBytes), originalServiceConfigSha256: hash(serviceBytes),
    sourceConfigSha256: hash(runtimeSourceBytes), queryDefinitionSha256: hash(stable(source.queries)),
    bindingsSha256: hash(stable(source.bindings)), connectionPolicySha256: hash(stable(sourcePolicy(runtimeSource))),
    databaseCaSha256: ca ? hash(ca) : null,
    credentialReferences: [...new Set([source.connectionEnv, source.connection?.passwordEnv].filter(value => value !== undefined))],
    sourceSemantics: SOURCE_SEMANTICS, queries: publicQueries(compiledQueries) };
  const postgres = { ...content, executionSha256: hash(stable(content)) };
  const offers = { schema: 'stellar-forge.postgres-seller-offers.v1',
    offers: service.routes.map(route => ({ id: route.id, seller: route.offer })) };
  const files = ordered([...inputFiles, descriptor(INPUT_MANIFEST, inputManifestBytes),
    descriptor(PACKAGE + '/source.json', runtimeSourceBytes),
    ...(ca ? [descriptor(PACKAGE + '/ca.pem', ca)] : [])]);
  aborted(signal);
  return { directory, originals, ca, inputManifest, inputManifestBytes, runtimeSourceBytes,
    service, serviceBytes: normalizedServiceBytes, offers, offersBytes: formatted(offers), postgres, files };
}
async function readOriginals(directory, signal) {
  const originals = new Map([
    ['source.json', await bytes(join(directory, 'source.json'), 262144, signal)],
    ['service.json', await bytes(join(directory, 'service.json'), MiB, signal)],
  ]);
  for (const [name, maximum] of OPTIONAL_INPUTS) {
    const value = await optionalBytes(join(directory, name), maximum, signal);
    if (value !== null) originals.set(name, value);
  }
  return originals;
}

/** Capture approved configuration and selected CA bytes; never read credential environment values. */
export async function preparePostgresRelease(packageDirectory, { signal } = {}) {
  try {
    const directory = await canonicalDirectory(packageDirectory), originals = await readOriginals(directory, signal);
    const source = parse(originals.get('source.json'));
    // The original reader validates conflicting top-level/profile CA and TLS choices.
    const declaration = await readPostgresSourceFile(join(directory, 'source.json'));
    if (!isDeepStrictEqual(source, declaration.config)) fail('The selected PostgreSQL source changed during capture.');
    const selected = source.connection?.caFile ?? source.caFile;
    const caPath = selected === undefined ? null : resolve(directory, selected);
    const ca = caPath === null ? null : await bytes(caPath, MiB, signal);
    const prepared = await deriveInput(directory, originals, ca, signal);
    // Re-read all captured inputs before completing an offline coherent capture.
    for (const [name, value] of originals) {
      const maximum = name === 'source.json' ? 262144 : name === 'service.json' ? MiB
        : OPTIONAL_INPUTS.find(entry => entry[0] === name)[1];
      if (!(await bytes(join(directory, name), maximum, signal)).equals(value))
        fail('The selected PostgreSQL package changed during capture.');
    }
    if (caPath && !(await bytes(caPath, MiB, signal)).equals(ca)) fail('The selected database CA changed during capture.');
    return prepared;
  } catch (error) { throw sourceError(error); }
}

/** Write a private relocatable release, retaining exact originals alongside derived runtime files. */
export async function stagePostgresRelease(directory, packageDirectory, { signal, expectedInputManifestSha256 } = {}) {
  if (expectedInputManifestSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedInputManifestSha256))
    fail('Supply the exact reviewed PostgreSQL input manifest hash.', 'POSTGRES_PACKAGE_REVIEW_REQUIRED');
  const target = resolve(directory), prepared = await preparePostgresRelease(packageDirectory, { signal });
  if (expectedInputManifestSha256 !== undefined && prepared.postgres.inputManifestSha256 !== expectedInputManifestSha256)
    fail('The PostgreSQL package changed after review. Review the current input before staging it.', 'POSTGRES_PACKAGE_CHANGED');
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the PostgreSQL release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    fail('Keep the release store outside the selected original PostgreSQL package.');
  let created = false;
  try {
    aborted(signal); await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, 'postgres'), { mode: 0o700 });
    await mkdir(join(target, ORIGINAL), { mode: 0o700 });
    await mkdir(join(target, PACKAGE), { mode: 0o700 });
    for (const [name, value] of prepared.originals) await writeNew(join(target, ORIGINAL, name), value, signal);
    if (prepared.ca) {
      await writeNew(join(target, ORIGINAL, 'database-ca.pem'), prepared.ca, signal);
      await writeNew(join(target, PACKAGE, 'ca.pem'), prepared.ca, signal);
    }
    await writeNew(join(target, INPUT_MANIFEST), prepared.inputManifestBytes, signal);
    await writeNew(join(target, PACKAGE, 'source.json'), prepared.runtimeSourceBytes, signal);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes, signal);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes, signal);
    const manifest = { schema: POSTGRES_SOURCE_SCHEMA, packagePath: PACKAGE,
      inputManifestSha256: prepared.postgres.inputManifestSha256, postgres: prepared.postgres,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest), signal);
    for (const path of [join(target, ORIGINAL), join(target, PACKAGE), join(target, 'postgres'), target]) await syncDirectory(path);
    const snapshot = await inspectPostgresRelease(target);
    aborted(signal);
    return snapshot;
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw sourceError(error); }
}

/** Verify from retained originals, without resolving their former external CA path or database credentials. */
export async function inspectPostgresRelease(directory) {
  try {
    const root = await canonicalDirectory(directory), manifestBytes = await bytes(join(root, 'manifest.json'), 2 * MiB);
    const manifest = parse(manifestBytes);
    if (manifest.schema !== POSTGRES_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE ||
        !object(manifest.postgres) || !Array.isArray(manifest.files))
      fail('Expected a retained original PostgreSQL merchant release.', 'POSTGRES_RELEASE_CHANGED');
    const originalDirectory = await canonicalDirectory(join(root, ORIGINAL));
    const originals = await readOriginals(originalDirectory), source = parse(originals.get('source.json'));
    const ca = caFields(source).length ? await bytes(join(originalDirectory, 'database-ca.pem'), MiB) : null;
    const prepared = await deriveInput(originalDirectory, originals, ca);
    const inputManifestBytes = await bytes(join(root, INPUT_MANIFEST), 2 * MiB);
    const sourceBytes = await bytes(join(root, PACKAGE, 'source.json'), 262144);
    const serviceBytes = await bytes(join(root, 'seller-service.json'), MiB);
    const offersBytes = await bytes(join(root, 'offers.json'), 2 * MiB);
    if (!inputManifestBytes.equals(prepared.inputManifestBytes) ||
        manifest.inputManifestSha256 !== hash(inputManifestBytes) ||
        !sourceBytes.equals(prepared.runtimeSourceBytes) || !serviceBytes.equals(prepared.serviceBytes) ||
        !offersBytes.equals(prepared.offersBytes) ||
        hash(serviceBytes) !== manifest.serviceConfigSha256 || hash(offersBytes) !== manifest.offersSha256 ||
        !isDeepStrictEqual(prepared.files, manifest.files) || !isDeepStrictEqual(prepared.postgres, manifest.postgres) ||
        ca && !(await bytes(join(root, PACKAGE, 'ca.pem'), MiB)).equals(ca))
      fail('The retained PostgreSQL query, source policy, CA, binding or public service changed.', 'POSTGRES_RELEASE_CHANGED');
    // The same original loaders validate relocated launch files too.
    await readPostgresSourceFile(join(root, PACKAGE, 'source.json'));
    await readSellerConfig(join(root, 'seller-service.json'));
    return { manifest, postgres: prepared.postgres, inputManifest: prepared.inputManifest,
      offers: prepared.offers, service: prepared.service, hasApplication: true,
      files: ordered([descriptor('manifest.json', manifestBytes), descriptor('seller-service.json', serviceBytes),
        descriptor('offers.json', offersBytes), ...prepared.files]) };
  } catch (error) { throw sourceError(error, true); }
}

function runtimeOptions(runtime) {
  if (!object(runtime) || Object.keys(runtime).some(key =>
      !['port', 'facilitator', 'allowLocalFacilitator', 'operationsNavigationOrigin'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained PostgreSQL runtime options.');
  if (runtime.operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.operationsNavigationOrigin) ||
        Number(new URL(runtime.operationsNavigationOrigin).port) > 65535))
    throw new TypeError('Use the explicit loopback console origin for PostgreSQL operations navigation.');
  let facilitator;
  if (runtime.facilitator !== undefined) {
    const endpoint = new URL(runtime.facilitator);
    const local = runtime.allowLocalFacilitator === true && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
    if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new TypeError('Facilitator requires a credential-free HTTPS URL or explicitly selected loopback HTTP.');
    facilitator = endpoint.href.replace(/\/$/, '');
  }
  return { ...runtime, port: Number(runtime.port ?? 0), ...(facilitator ? { facilitator } : {}) };
}

/** Open the original pooled source and seller, then attach its maintained private operations console. */
export async function startPostgresRelease(directory, { runtime = { port: 0 }, environment = process.env } = {}) {
  const root = resolve(directory), snapshot = await inspectPostgresRelease(root), options = runtimeOptions(runtime);
  let nativeFactory = null;
  if (options.facilitator) {
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled,
      { facilitatorClient: new HTTPFacilitatorClient({ url: options.facilitator }) });
  }
  const state = join(root, 'postgres-runtime');
  await mkdir(state, { recursive: true, mode: 0o700 });
  await canonicalDirectory(state);
  const native = await startPostgresSeller({ sourceFile: join(root, PACKAGE, 'source.json'),
    configFile: join(root, 'seller-service.json'), port: options.port, operationsPort: null, environment, nativeFactory,
    availabilityDirectory: join(state, 'availability') });
  let operations, closing;
  try {
    operations = await startSellerOperations(native.seller, { port: 0,
      navigationOrigin: options.operationsNavigationOrigin ?? null });
    return { ...native.seller, source: native.source, operations, snapshot, postgres: snapshot.postgres,
      close() { return closing ??= native.close().finally(() => operations.close()); } };
  } catch (error) { await native.close().catch(() => {}); await operations?.close().catch(() => {}); throw error; }
}

/** The original SF82 child calls this only after its durable process-ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-postgres.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectPostgresRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another PostgreSQL release.', 'POSTGRES_RELEASE_CHANGED');
  const session = await startPostgresRelease(directory, { runtime: saved.options });
  try {
    if (!session.server.listening) throw new Error('Original PostgreSQL seller stopped during startup.');
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256,
      originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      postgres: snapshot.postgres });
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
  launch().catch(() => { process.stderr.write('POSTGRES_RELEASE_START_FAILED\n'); process.exitCode = 1; });
