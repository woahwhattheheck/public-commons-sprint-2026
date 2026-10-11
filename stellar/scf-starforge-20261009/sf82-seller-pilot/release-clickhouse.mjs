// MIT. Retain original ClickHouse packages in the existing SF82 release lifecycle.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertPrepared, compileClickHouseMerchantPlan } from '../sf30-seller-sdk/clickhouse/prepare.mjs';
import { readClickHouseSourceFile } from '../sf30-seller-sdk/clickhouse/source.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../sf30-seller-sdk/developer-portal.mjs';
import { generateSellerClient } from '../sf30-seller-sdk/developer/client-generator.mjs';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';

export const CLICKHOUSE_SOURCE_SCHEMA = 'stellar-forge.clickhouse-seller-release-manifest.v1';
const PACKAGE = 'clickhouse/package';
const CAPS = {
  'source.json': 262144, 'merchant-plan.json': 262144, 'bindings.json': 262144,
  'service.json': 1048576, 'openapi.json': 16777216,
  'client/seller-client.mjs': 1048576, 'client/seller-client.d.mts': 1048576,
  'client/seller-openapi.json': 16777216, 'client/package.json': 65536, 'client/README.md': 1048576,
};
const hash = value => createHash('sha256').update(value).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const fail = message => { throw Object.assign(new Error(message), { code: 'CLICKHOUSE_RELEASE_CHANGED' }); };
function parse(value) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch (cause) { throw Object.assign(new Error('ClickHouse package JSON must be valid UTF-8.', { cause }), { code: 'CLICKHOUSE_PACKAGE_INVALID' }); }
}
function sourceError(error) {
  return typeof error?.syscall === 'string'
    ? Object.assign(new Error('The retained ClickHouse package is unavailable. Select its complete private prepared directory.',
      { cause: error }), { code: 'CLICKHOUSE_PACKAGE_UNAVAILABLE' }) : error;
}
async function bytes(path, maximum = 4 * 1024 * 1024) {
  try {
    if (await realpath(path) !== resolve(path)) fail('Use canonical ClickHouse package files without symlinks.');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(maximum)) fail('ClickHouse release file exceeds its original size limit.');
      const buffer = Buffer.alloc(Number(before.size) + 1); let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        fail('ClickHouse package changed during capture.');
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
function reviewedColumns(value, description) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      stable(Object.keys(value).sort()) !== stable(Object.keys(description).sort()))
    throw new TypeError('The reviewed ClickHouse column types must cover every original named query.');
  for (const [name, contract] of Object.entries(description)) {
    const columns = value[name];
    if (!Array.isArray(columns) || columns.length !== contract.columns.length || columns.some((column, index) =>
      !column || typeof column !== 'object' || Array.isArray(column) || Object.keys(column).some(key => !['name', 'type'].includes(key)) ||
      column.name !== contract.columns[index] || typeof column.type !== 'string' || !column.type || column.type.length > 2048 || /[\x00-\x1f\x7f]/.test(column.type)))
      throw new TypeError('The reviewed ClickHouse column types must match the original ordered columns.');
  }
  return structuredClone(value);
}

/** Static original compiler/client verification. No credentials, database or listener are opened. */
export async function prepareClickHouseRelease(packageDirectory, { columnTypes } = {}) {
  try {
    const directory = resolve(packageDirectory);
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory)
      fail('Choose the canonical directory containing the original ClickHouse prepare output.');
    await assertPrepared(directory);
    const retained = {}; let total = 0;
    for (const [file, cap] of Object.entries(CAPS)) {
      retained[file] = await bytes(join(directory, file), cap);
      if ((total += retained[file].length) > 33554432) fail('The original ClickHouse package exceeds 32 MiB.');
    }
    const original = await readClickHouseSourceFile(join(directory, 'source.json'));
    const config = parse(retained['source.json']), plan = parse(retained['merchant-plan.json']);
    if (!isDeepStrictEqual(config, original.config)) fail('ClickHouse source changed during original validation.');
    const bundle = compileClickHouseMerchantPlan(config.queries, plan);
    // The original compiler intentionally uses null-prototype binding maps;
    // compare their JSON contract with retained JSON, not JS object prototypes.
    if (stable(config.bindings) !== stable(bundle.bindings) ||
        stable(parse(retained['bindings.json'])) !== stable(bundle.bindings) ||
        stable(parse(retained['service.json'])) !== stable(bundle.service) ||
        stable(await readSellerConfig(join(directory, 'service.json'))) !== stable(bundle.service))
      fail('The retained source, typed inputs, payment choices and original compiled service differ. Prepare a new package.');
    const routes = compileSellerRoutes(bundle.service.routes.map(route => ({ id: route.id, offer: route.offer,
      handler() { throw new Error('Release inspection never executes a query.'); }, admit() { return true; } })));
    if (stable(parse(retained['openapi.json'])) !== stable(compileSellerOpenApi(routes, { mode: 'CHALLENGE_ONLY' })))
      fail('The prepared OpenAPI differs from this installed original compiler. Prepare a new directory from the retained source and plan with this installation.');
    const client = generateSellerClient(retained['openapi.json']);
    for (const [file, expected] of [['seller-client.mjs', client.javascript], ['seller-client.d.mts', client.declarations],
      ['seller-openapi.json', retained['openapi.json']], ['package.json', client.packageJson], ['README.md', client.readme]])
      if (!retained['client/' + file].equals(Buffer.from(expected)))
        fail('The customer files differ from this installed original generator. Prepare a new directory from the retained source and plan with this installation.');
    const files = ordered(Object.keys(CAPS).map(file => descriptor(PACKAGE + '/' + file, retained[file])));
    const content = { schema: 'stellar-forge.clickhouse-release-source.v1', packageSha256: hash(stable(files)),
      sourceConfigSha256: hash(retained['source.json']), planSha256: hash(retained['merchant-plan.json']),
      bindingsSha256: hash(retained['bindings.json']), querySha256: hash(stable(config.queries)),
      queryCount: Object.keys(config.queries).length, routeCount: bundle.service.routes.length,
      queries: Object.entries(original.description).map(([name, contract]) => ({ name, ...contract,
        sqlSha256: hash(config.queries[name].sql) })),
      limits: { maxInFlight: config.maxInFlight ?? 8, maxThreads: config.maxThreads ?? 2,
        maxMemoryBytes: config.maxMemoryBytes ?? 268435456, maxRowsToRead: config.maxRowsToRead ?? 1000000,
        maxBytesToRead: config.maxBytesToRead ?? 67108864 },
      ...(columnTypes === undefined ? {} : { columnTypes: reviewedColumns(columnTypes, original.description) }),
    };
    const clickhouse = { ...content, executionSha256: hash(stable(content)) };
    const offers = { schema: 'stellar-forge.clickhouse-seller-offers.v1',
      offers: bundle.service.routes.map(route => ({ id: route.id, seller: route.offer })) };
    return { directory, retained, files, clickhouse, service: bundle.service, offers, offersBytes: formatted(offers),
      serviceBytes: retained['service.json'], environment: { endpoint: config.endpointEnv, user: config.userEnv, password: config.passwordEnv } };
  } catch (error) { throw sourceError(error); }
}

/** Capture exactly the original ten files; later runs no longer depend on their former directory. */
export async function stageClickHouseRelease(directory, packageDirectory, options = {}) {
  const target = resolve(directory), prepared = await prepareClickHouseRelease(packageDirectory, options);
  if (join(await realpath(dirname(target)), basename(target)) !== target)
    fail('Use a canonical parent directory for the ClickHouse release store.');
  const within = relative(prepared.directory, target);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    throw new TypeError('Keep the release store outside its original ClickHouse package.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(join(target, PACKAGE, 'client'), { recursive: true, mode: 0o700 });
    for (const file of Object.keys(CAPS)) await writeNew(join(target, PACKAGE, file), prepared.retained[file]);
    await writeNew(join(target, 'offers.json'), prepared.offersBytes);
    await writeNew(join(target, 'seller-service.json'), prepared.serviceBytes);
    const manifest = { schema: CLICKHOUSE_SOURCE_SCHEMA, packagePath: PACKAGE, clickhouse: prepared.clickhouse,
      offersSha256: hash(prepared.offersBytes), serviceConfigSha256: hash(prepared.serviceBytes), files: prepared.files };
    await writeNew(join(target, 'manifest.json'), formatted(manifest));
    for (const folder of [PACKAGE + '/client', PACKAGE, 'clickhouse', '']) await syncDirectory(join(target, folder));
    return await inspectClickHouseRelease(target);
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
}

export async function inspectClickHouseRelease(directory) {
  const root = resolve(directory);
  const manifestBytes = await bytes(join(root, 'manifest.json'), 2 * 1024 * 1024), manifest = parse(manifestBytes);
  if (manifest.schema !== CLICKHOUSE_SOURCE_SCHEMA || manifest.packagePath !== PACKAGE || !manifest.clickhouse || !Array.isArray(manifest.files))
    fail('Expected an original retained ClickHouse merchant release.');
  const prepared = await prepareClickHouseRelease(join(root, PACKAGE), { columnTypes: manifest.clickhouse.columnTypes });
  if (!isDeepStrictEqual(manifest.files, prepared.files) || !isDeepStrictEqual(manifest.clickhouse, prepared.clickhouse))
    fail('The retained ClickHouse source, parameters, limits, client or payment plan changed. Stage a new release.');
  const offersBytes = await bytes(join(root, 'offers.json')), serviceBytes = await bytes(join(root, 'seller-service.json'), 1048576);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(prepared.offersBytes) || !serviceBytes.equals(prepared.serviceBytes))
    fail('The retained ClickHouse offers or service differ from their original package.');
  return { manifest, clickhouse: prepared.clickhouse, offers: prepared.offers, service: prepared.service,
    environment: prepared.environment, packageDirectory: prepared.directory, hasApplication: true,
    files: ordered([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...prepared.files]) };
}

function selectedRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator', 'operationsNavigationOrigin'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port ?? 0)) || Number(runtime.port ?? 0) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean')
    throw new TypeError('Invalid retained ClickHouse runtime options.');
  if (runtime.allowLocalFacilitator && !runtime.facilitator) throw new TypeError('A local facilitator option requires its selected URL.');
  if (runtime.operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.operationsNavigationOrigin) ||
        Number(new URL(runtime.operationsNavigationOrigin).port) > 65535))
    throw new TypeError('The operations navigation origin must be the original loopback console.');
  return { ...runtime, port: String(runtime.port ?? 0) };
}

/** Delegate preflight, facilitator, seller, operations and signals to the original ClickHouse command. */
export async function startClickHouseRelease(directory, { runtime = { port: 0 }, env = process.env } = {}) {
  const root = resolve(directory), snapshot = await inspectClickHouseRelease(root), options = selectedRuntime(runtime);
  const state = join(root, 'clickhouse-runtime');
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (await realpath(state) !== state) fail('Use the original private ClickHouse runtime directory without symlinks.');
  const { main } = await import('../sf30-seller-sdk/clickhouse/start.mjs');
  const session = await main(['--directory', join(root, PACKAGE), '--port', options.port, '--operations-port', '0',
    '--availability-dir', join(state, 'availability'),
    ...(options.facilitator ? ['--facilitator', options.facilitator] : []),
    ...(options.allowLocalFacilitator ? ['--allow-local-facilitator'] : [])],
  { env, stdout: { write() {} }, navigationOrigin: options.operationsNavigationOrigin ?? null,
    expectedColumnTypes: snapshot.clickhouse.columnTypes });
  return { ...session, clickhouse: snapshot.clickhouse, snapshot };
}

/** The original SF82 child starts this entry only after its manager ownership handshake. */
export async function launch(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-clickhouse.mjs --resume RELEASE_DIRECTORY');
  const directory = resolve(args[1]), snapshot = await inspectClickHouseRelease(directory);
  const saved = parse(await bytes(join(directory, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    fail('Runtime settings belong to another ClickHouse release.');
  const session = await startClickHouseRelease(directory, { runtime: saved.options });
  try {
    await atomic(join(directory, 'runtime-readiness.json'), {
      schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      runtimeMode: session.mode, listener: session.url, routeCount: snapshot.service.routes.length,
      operations: session.operations.url, clickhouse: snapshot.clickhouse,
    });
    return session;
  } catch (error) { await session.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
