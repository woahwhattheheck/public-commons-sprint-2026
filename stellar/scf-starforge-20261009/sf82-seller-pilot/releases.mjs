// MIT. Version original SF61 exports and SF30 native merchant sources through SF82.
import { open, readFile, lstat, mkdir, readdir, rename, rm, rmdir, unlink, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { upstreamReleaseSnapshot, stageReleaseUpstreams, inspectReleaseUpstreams, readReleaseWorkspace } from './release-upstreams.mjs';
import { releaseCacheControlPath } from './release-cache.mjs';
import { PYTHON_SOURCE_SCHEMA, stagePythonRelease, inspectPythonRelease } from './release-python.mjs';
import { DUCKDB_SOURCE_SCHEMA, stageDuckdbRelease, inspectDuckdbRelease } from './release-duckdb.mjs';
import { S3_SOURCE_SCHEMA, stageS3Release, inspectS3Release } from './release-s3.mjs';
import { MYSQL_SOURCE_SCHEMA, stageMysqlRelease, inspectMysqlRelease } from './release-mysql.mjs';
import { POSTGRES_SOURCE_SCHEMA, stagePostgresRelease, inspectPostgresRelease } from './release-postgres.mjs';
import { REDIS_SOURCE_SCHEMA, stageRedisRelease, inspectRedisRelease } from './release-redis.mjs';
import { JSONRPC_SOURCE_SCHEMA, stageJsonrpcRelease, inspectJsonrpcRelease } from './release-jsonrpc.mjs';
import { SQLITE_SOURCE_SCHEMA, stageSqliteRelease, inspectSqliteRelease } from './release-sqlite.mjs';
import { DATASET_SOURCE_SCHEMA, stageDatasetRelease, inspectDatasetRelease } from './release-dataset.mjs';
import { CLICKHOUSE_SOURCE_SCHEMA, stageClickHouseRelease, inspectClickHouseRelease } from './release-clickhouse.mjs';
import { acquireReleaseLease, releaseProcessOwner, releaseOwnerLiveness, recordedSellerAlive,
  validProcessIdentity, validReleaseLease, sameReleaseLease } from './release-process.mjs';
import { NATIVE_SDK_VERSION } from '../sf30-seller-sdk/native-factory.mjs';

const STORE = 'stellar-forge.seller-release-store.v1';
const RELEASE = 'stellar-forge.seller-release.v1';
const RUN = 'stellar-forge.seller-release-process.v1';
const PILOT = fileURLToPath(new URL('./pilot.mjs', import.meta.url));
const PYTHON_PILOT = fileURLToPath(new URL('./release-python.mjs', import.meta.url));
const DUCKDB_PILOT = fileURLToPath(new URL('./release-duckdb.mjs', import.meta.url));
const S3_PILOT = fileURLToPath(new URL('./release-s3.mjs', import.meta.url));
const MYSQL_PILOT = fileURLToPath(new URL('./release-mysql.mjs', import.meta.url));
const POSTGRES_PILOT = fileURLToPath(new URL('./release-postgres.mjs', import.meta.url));
const REDIS_PILOT = fileURLToPath(new URL('./release-redis.mjs', import.meta.url));
const JSONRPC_PILOT = fileURLToPath(new URL('./release-jsonrpc.mjs', import.meta.url));
const SQLITE_PILOT = fileURLToPath(new URL('./release-sqlite.mjs', import.meta.url));
const DATASET_PILOT = fileURLToPath(new URL('./release-dataset.mjs', import.meta.url));
const CLICKHOUSE_PILOT = fileURLToPath(new URL('./release-clickhouse.mjs', import.meta.url));
const CHILD = fileURLToPath(new URL('./release-child.mjs', import.meta.url));
const LIMIT = 4 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])]));
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw new TypeError('Release ID must be 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
function text(value, name, maximum = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw new TypeError(name + ' must be nonempty single-line text up to ' + maximum + ' characters.');
  return value.trim();
}
async function regular(path, maximum = LIMIT) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw new TypeError('Expected a regular file up to ' + maximum + ' bytes: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw new RangeError('File grew beyond its size limit: ' + path);
  return bytes;
}
async function json(path, maximum = LIMIT) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(path, maximum)));
}
async function optional(path) {
  try { return await json(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(path) {
  if (!(await lstat(path)).isDirectory()) throw new TypeError('Expected a real directory: ' + path);
}
async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
async function writeNew(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
async function atomic(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try { await writeNew(temp, value); await rename(temp, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const OWNER_FILE = /^owner-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
async function lockOwner(root, name) {
  const path = join(root, name);
  try {
    await directory(path);
    const owners = (await readdir(path)).filter(file => OWNER_FILE.test(file));
    if (owners.length !== 1) return { present: true, path, owner: null };
    const file = owners[0], owner = await optional(join(path, file));
    if (!owner || owner.token !== OWNER_FILE.exec(file)[1] || typeof owner.host !== 'string' ||
        !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
        owner.childPid !== undefined && (!Number.isSafeInteger(owner.childPid) || owner.childPid < 1) ||
        !validProcessIdentity(owner.processIdentity) || !validProcessIdentity(owner.childProcessIdentity) ||
        !validReleaseLease(owner.kernelLease))
      return { present: true, path, owner: null };
    return { present: true, path, file, owner };
  } catch (error) {
    if (error.code === 'ENOENT') return { present: false, path, owner: null };
    throw error;
  }
}
async function removeOwner(path, file) {
  // Only the process that actually removed this unique owner's file may remove
  // its directory. A second stale reader must never rmdir a new, empty claim.
  try { await unlink(join(path, file)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const temps = (await readdir(path)).filter(name => name.startsWith(file + '.') && name.endsWith('.tmp'));
  for (const temp of temps) await unlink(join(path, temp)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(path).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
}
async function lock(root, name) {
  const path = join(root, name), token = randomUUID();
  const lifetime = await acquireReleaseLease(root, name);
  const owner = { ...await releaseProcessOwner(), token, createdAt: new Date().toISOString(),
    ...(lifetime ? { kernelLease: lifetime.identity } : {}) };
  const file = 'owner-' + token + '.json';
  try {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await lockOwner(root, name);
      if (!current.present) continue;
      if (current.owner) {
        const { managerAlive, childAlive } = await releaseOwnerLiveness(root, current.owner, owner, lifetime);
        if (!managerAlive && !childAlive) {
          await removeOwner(path, current.file);
          continue;
        }
      }
      const busy = new Error(name === 'run.lock' ? 'A release manager already owns the running seller. Stop it in its own terminal or console.' : 'Another release change is being saved. Refresh and retry.');
      busy.code = 'RELEASE_BUSY'; throw busy;
    }
    try { await atomic(join(path, file), owner); await syncDirectory(root); }
    catch (error) {
      // We created the directory. Nobody may acquire it until this cleanup ends.
      await unlink(join(path, file)).catch(() => {});
      await rmdir(path).catch(() => {});
      throw error;
    }
    const release = async () => {
      try { await removeOwner(path, file); } finally { await lifetime?.close(); }
    };
    release.owner = owner;
    release.lifetime = lifetime;
    release.update = async fields => {
      await lifetime?.assert();
      Object.assign(owner, fields);
      await atomic(join(path, file), owner);
    };
    return release;
  }
  throw Object.assign(new Error('Release store lock changed; refresh and retry.'), { code: 'RELEASE_BUSY' });
  } catch (error) { await lifetime?.close(); throw error; }
}
async function mutate(root, action) {
  const release = await lock(root, 'state.lock');
  try { return await action(); } finally { await release(); }
}
export async function initReleaseStore(root) {
  root = resolve(root);
  await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'releases'), { mode: 0o700 });
  const state = { schema: STORE, createdAt: new Date().toISOString(), generation: 0,
    active: null, previous: null, history: [] };
  await writeNew(join(root, 'state.json'), state); await syncDirectory(root);
  return { root, ...state };
}
export async function readReleaseState(root) {
  root = resolve(root); await directory(root); await directory(join(root, 'releases'));
  const state = await json(join(root, 'state.json'));
  if (state.schema !== STORE || !Number.isSafeInteger(state.generation) || state.generation < 0 || !Array.isArray(state.history))
    throw new TypeError('Invalid seller release store.');
  if (state.active !== null) id(state.active);
  if (state.previous !== null) id(state.previous);
  return state;
}
function runtimeOptions(value = {}) {
  const known = new Set(['port', 'handlers', 'facilitator', 'allowLocalFacilitator', 'upstreams', 'allowLoopbackUpstream']);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !known.has(k)))
    throw new TypeError('Unknown release runtime option.');
  const port = value.port ?? 8423;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be 0–65535.');
  const result = { port };
  if (value.handlers !== undefined) result.handlers = resolve(text(value.handlers, 'Handler entry path', 4096));
  if (value.upstreams !== undefined) result.upstreams = upstreamReleaseSnapshot(value.upstreams);
  if (result.handlers && result.upstreams) throw new TypeError('Choose a trusted handler module or upstream bindings for the release.');
  if (value.allowLoopbackUpstream !== undefined && typeof value.allowLoopbackUpstream !== 'boolean')
    throw new TypeError('allowLoopbackUpstream must be a boolean.');
  if (value.allowLoopbackUpstream) result.allowLoopbackUpstream = true;
  if (value.facilitator !== undefined) {
    const endpoint = new URL(value.facilitator);
    const local = value.allowLocalFacilitator === true && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
    if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new TypeError('Facilitator requires a credential-free HTTPS URL, or explicitly enabled loopback HTTP.');
    result.facilitator = endpoint.href.replace(/\/$/, '');
  }
  if (value.allowLocalFacilitator !== undefined && typeof value.allowLocalFacilitator !== 'boolean')
    throw new TypeError('allowLocalFacilitator must be a boolean.');
  if (value.allowLocalFacilitator) {
    if (!result.facilitator) throw new TypeError('A local facilitator option requires a facilitator URL.');
    result.allowLocalFacilitator = true;
  }
  return result;
}
export { runtimeOptions as normalizeReleaseRuntime };

async function sourceSnapshot(path, upstreams, allowLoopback = false) {
  const manifestBytes = await regular(join(path, 'manifest.json'), 2 * 1024 * 1024);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema === CLICKHOUSE_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A ClickHouse release owns its original typed query bindings.');
    const snapshot = await inspectClickHouseRelease(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, null, null, null, null, null, snapshot.clickhouse) };
  }
  if (manifest.schema === DATASET_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A dataset release owns its original versioned query bindings.');
    const snapshot = await inspectDatasetRelease(path);
    const routes = sourceRoutes(snapshot.service, new Map()).map(route => ({ ...route,
      application: { ...route.application, datasetExecutionSha256: snapshot.dataset.executionSha256 } }));
    return { ...snapshot, routes };
  }
  if (manifest.schema === POSTGRES_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A PostgreSQL package owns its original named-query bindings.');
    const snapshot = await inspectPostgresRelease(path);
    const routes = sourceRoutes(snapshot.service, new Map()).map(route => ({ ...route,
      application: { ...route.application, postgresExecutionSha256: snapshot.postgres.executionSha256 } }));
    return { ...snapshot, routes };
  }
  if (manifest.schema === SQLITE_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A SQLite release owns its original query bindings.');
    const snapshot = await inspectSqliteRelease(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, null, null, null, null, snapshot.sqlite) };
  }
  if (manifest.schema === JSONRPC_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('An RPC package owns its original method and provider bindings.');
    const snapshot = await inspectJsonrpcRelease(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, null, null, null, snapshot.jsonrpc) };
  }
  if (manifest.schema === REDIS_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A Redis package owns its original read command bindings.');
    const snapshot = await inspectRedisRelease(path);
    const routes = sourceRoutes(snapshot.service, new Map()).map(route => ({ ...route,
      application: { ...route.application, redisExecutionSha256: snapshot.redis.executionSha256 } }));
    return { ...snapshot, routes };
  }
  if (manifest.schema === MYSQL_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A MySQL package owns its original query bindings.');
    const snapshot = await inspectMysqlRelease(path);
    const routes = sourceRoutes(snapshot.service, new Map()).map(route => ({ ...route,
      application: { ...route.application, mysqlExecutionSha256: snapshot.mysql.executionSha256 } }));
    return { ...snapshot, routes };
  }
  if (manifest.schema === S3_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('An S3 release owns its original object bindings.');
    const snapshot = await inspectS3Release(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, null, null, snapshot.s3) };
  }
  if (manifest.schema === DUCKDB_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A DuckDB package owns its original query bindings.');
    const snapshot = await inspectDuckdbRelease(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, null, snapshot.duckdb) };
  }
  if (manifest.schema === PYTHON_SOURCE_SCHEMA) {
    if (upstreams) throw new TypeError('A Python release owns its original application bindings.');
    const snapshot = await inspectPythonRelease(path);
    return { ...snapshot, routes: sourceRoutes(snapshot.service, new Map(), null, snapshot.python), hasApplication: true };
  }
  if (manifestBytes.length > 65536) throw new RangeError('Original SF61 manifest exceeds its 65536-byte limit.');
  const offersBytes = await regular(join(path, 'offers.json'));
  const serviceBytes = await regular(join(path, 'seller-service.json'), 1024 * 1024);
  if (manifest.schema !== 'stellar.open-api-seller-manifest.v1' ||
      hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256)
    throw new Error('Original SF61 compiled files no longer match their manifest.');
  const offers = JSON.parse(offersBytes), service = JSON.parse(serviceBytes);
  if (offers.schema !== 'stellar.open-api-seller-import.v1' || !Array.isArray(offers.offers) || !offers.offers.length ||
      service.schema !== 'stellar-forge.seller-service.v1' || !Array.isArray(service.routes) || service.routes.length !== offers.offers.length)
    throw new TypeError('Expected original SF61 service export.');
  const files = [{ file: 'manifest.json', sha256: hash(manifestBytes), bytes: manifestBytes.length },
    { file: 'offers.json', sha256: hash(offersBytes), bytes: offersBytes.length },
    { file: 'seller-service.json', sha256: hash(serviceBytes), bytes: serviceBytes.length }];
  const snapshots = new Map();
  const upstream = upstreams ? await inspectReleaseUpstreams(path, upstreams, service, { allowLoopback }) : null;
  if (upstream) files.push({ file: upstream.file, sha256: upstream.sha256, bytes: upstream.bytes });
  for (const asset of manifest.responseFiles ?? []) {
    if (!/^responses\/[A-Za-z0-9_-]{1,64}\.json$/.test(asset.file) || snapshots.has(asset.file))
      throw new TypeError('Unexpected original response snapshot path.');
    await directory(join(path, 'responses'));
    const bytes = await regular(join(path, asset.file), 1024 * 1024);
    if (hash(bytes) !== asset.sha256) throw new Error('Response snapshot changed: ' + asset.file);
    snapshots.set(asset.file, asset.sha256); files.push({ file: asset.file, sha256: asset.sha256, bytes: bytes.length });
  }
  const routes = sourceRoutes(service, snapshots, upstream);
  const hasApplication = service.routes.some(route => route.handler || route.admit);
  return { manifest, offers, service, files: files.sort((a, b) => a.file.localeCompare(b.file)), routes, hasApplication };
}
function sourceRoutes(service, snapshots, upstream = null, python = null, duckdb = null, s3 = null, jsonrpc = null, sqlite = null, clickhouse = null) {
  return service.routes.map(route => {
    if (route.responseFile && !snapshots.has(route.responseFile)) throw new Error('Unpinned response file: ' + route.id);
    if (!route.offer || typeof route.offer.extensions?.bazaar?.info?.input?.method !== 'string')
      throw new TypeError('Release route must use an original imported SF61 offer.');
    const method = route.offer.extensions.bazaar.info.input.method;
    const origin = new URL(route.offer.resource.url).origin;
    if (origin !== service.publicOrigin) throw new Error('Release route and configured public origin differ.');
    // Keep reviews sensitive to every original execution option, including new
    // importer fields, without copying protected static response values into UI.
    const configuration = Object.fromEntries(Object.entries(route).filter(([key]) => key !== 'offer' && key !== 'response'));
    return { id: route.id, method, path: route.path, url: route.offer.resource.url,
      ...(upstream ? { upstream: upstream.bindings[route.handler] ?? null } : {}),
      payment: structuredClone(route.offer.accepts),
      requestContractSha256: hash(stable(route.offer.extensions.bazaar)),
      application: { handler: route.handler ?? null, admit: route.admit ?? null, validateInput: route.validateInput ?? false,
        configurationSha256: hash(stable(configuration)),
        ...(python ? { pythonExecutionSha256: python.executionSha256 } : {}),
        ...(duckdb ? { duckdbExecutionSha256: duckdb.executionSha256 } : {}),
        ...(s3 ? { s3ExecutionSha256: s3.executionSha256,
          object: s3.objects.find(item => item.id === route.id) } : {}),
        ...(jsonrpc ? { jsonrpcExecutionSha256: jsonrpc.executionSha256, dataNetwork: jsonrpc.dataNetwork,
          rpcMethod: jsonrpc.methods.find(item => item.method === route.id)?.method } : {}),
        ...(sqlite ? { sqliteExecutionSha256: sqlite.executionSha256 } : {}),
        ...(clickhouse ? { clickhouseExecutionSha256: clickhouse.executionSha256 } : {}),
        responseSha256: route.responseFile ? snapshots.get(route.responseFile) :
          Object.hasOwn(route, 'response') ? hash(stable(route.response)) : null } };
  });
}
function publicRelease(record) {
  return { id: record.id, label: record.label, createdAt: record.createdAt,
    digest: record.digest, publicOrigin: record.publicOrigin, routes: record.routes,
    runtime: record.runtime, handlerEntry: record.handlerEntry,
    mode: record.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
    source: record.source, ...(record.inputPackage ? { inputPackage: record.inputPackage } : {}),
    ...(record.derivedFrom ? { derivedFrom: record.derivedFrom } : {}),
    ...(record.facilitatorReview ? { facilitatorReview: record.facilitatorReview } : {}),
    ...(record.python ? { python: record.python } : {}),
    ...(record.duckdb ? { duckdb: record.duckdb } : {}),
    ...(record.mysql ? { mysql: record.mysql } : {}),
    ...(record.postgres ? { postgres: record.postgres } : {}),
    ...(record.redis ? { redis: record.redis } : {}),
    ...(record.s3 ? { s3: record.s3 } : {}),
    ...(record.jsonrpc ? { jsonrpc: record.jsonrpc } : {}),
    ...(record.sqlite ? { sqlite: record.sqlite } : {}),
    ...(record.dataset ? { dataset: record.dataset } : {}),
    ...(record.clickhouse ? { clickhouse: record.clickhouse } : {}) };
}
function checkFacilitatorReview(record) {
  const review = record.facilitatorReview;
  if (!review && record.derivedFrom?.kind !== 'FACILITATOR') return;
  const { id: reviewId, ...content } = review ?? {};
  if (content.schema !== 'stellar-forge.seller-facilitator-review.v1' ||
      reviewId !== hash(stable(content)) || content.compatible !== true || content.error !== null ||
      content.nativeSdk !== NATIVE_SDK_VERSION || Buffer.byteLength(stable(review)) > 1024 * 1024 ||
      content.supportedSha256 !== hash(stable(content.supported)) ||
      record.derivedFrom?.kind !== 'FACILITATOR' || record.derivedFrom.reviewId !== reviewId ||
      record.derivedFrom.supportedSha256 !== content.supportedSha256 ||
      record.derivedFrom.releaseId !== content.source?.releaseId ||
      record.derivedFrom.releaseDigest !== content.source?.releaseDigest ||
      record.id !== content.proposed?.id || record.label !== content.proposed?.label ||
      record.runtime.facilitator !== content.proposed?.provider?.url ||
      (record.runtime.allowLocalFacilitator === true) !== content.proposed?.provider?.allowLocalFacilitator ||
      record.publicOrigin !== content.source?.publicOrigin || stable(record.source) !== stable(content.source?.source) ||
      !Array.isArray(content.nativePayments) || content.nativePayments.length !== record.routes.length)
    throw new Error('Retained facilitator review differs from its release binding.');
  for (const [index, route] of record.routes.entries()) {
    const payment = content.nativePayments[index];
    if (payment?.routeId !== route.id || payment.method !== route.method || payment.path !== route.path ||
        payment.url !== route.url || stable(payment.storedPayment) !== stable(route.payment) ||
        !Array.isArray(payment.nativePayment) || !payment.nativePayment.length)
      throw new Error('Retained native payment review differs from its original merchant route.');
  }
}
async function releaseRecord(root, releaseId, verify = false) {
  const path = join(resolve(root), 'releases', id(releaseId)); await directory(path);
  const record = await json(join(path, 'release.json'));
  const { digest, ...content } = record;
  if (record.schema !== RELEASE || record.id !== releaseId || hash(stable(content)) !== digest)
    throw new Error('Release metadata changed or belongs to a different release.');
  checkFacilitatorReview(record);
  if (verify) {
    const snapshot = await sourceSnapshot(path, record.runtime.upstreams, record.runtime.allowLoopbackUpstream === true);
    if (stable(snapshot.files) !== stable(record.files) || stable(snapshot.routes) !== stable(record.routes) ||
        stable(snapshot.python ?? null) !== stable(record.python ?? null) ||
        stable(snapshot.duckdb ?? null) !== stable(record.duckdb ?? null) ||
        stable(snapshot.mysql ?? null) !== stable(record.mysql ?? null) ||
        stable(snapshot.postgres ?? null) !== stable(record.postgres ?? null) ||
        stable(snapshot.redis ?? null) !== stable(record.redis ?? null) ||
        stable(snapshot.s3 ?? null) !== stable(record.s3 ?? null) ||
        stable(snapshot.jsonrpc ?? null) !== stable(record.jsonrpc ?? null) ||
        stable(snapshot.sqlite ?? null) !== stable(record.sqlite ?? null) ||
        stable(snapshot.dataset ?? null) !== stable(record.dataset ?? null) ||
        stable(snapshot.clickhouse ?? null) !== stable(record.clickhouse ?? null))
      throw new Error('Release files changed after staging. Restore the selected immutable release.');
    if (record.handlerEntry && hash(await regular(record.handlerEntry.path)) !== record.handlerEntry.sha256)
      throw new Error('Trusted handler entry changed after staging. Restore it or stage a new release.');
    runtimeOptions(record.runtime);
  }
  return { path, record };
}
/** Compile with the original importer. No handler imports, listener or payment at staging. */
export async function stageRelease(root, options) {
  root = resolve(root); await readReleaseState(root);
  const releaseId = id(options.id), label = text(options.label ?? releaseId, 'Release label');
  const datasetSource = options.datasetPackage !== undefined;
  if (datasetSource && (Object.keys(options).some(key =>
      !['id','label','alias','runtime','datasetPackage'].includes(key) && options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the prepared dataset package or another source; the dataset owns its original controller and query bindings.');
  const pythonSource = options.python !== undefined;
  const duckdbSource = options.duckdbPackage !== undefined;
  const s3Source = options.s3Package !== undefined;
  const postgresSource = options.postgresPackage !== undefined;
  if (postgresSource && (Object.keys(options).some(key =>
      !['id', 'label', 'alias', 'runtime', 'postgresPackage', 'postgresInputManifestSha256', 'signal'].includes(key) && options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original PostgreSQL merchant package or another source; the package owns its named-query bindings.');
  if (!postgresSource && options.postgresInputManifestSha256 !== undefined)
    throw new TypeError('A reviewed PostgreSQL input hash requires postgresPackage.');
  const mysqlSource = options.mysqlPackage !== undefined;
  const redisSource = options.redisPackage !== undefined;
  if (redisSource && (Object.keys(options).some(key =>
      !['id', 'label', 'alias', 'runtime', 'redisPackage'].includes(key) && options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original prepared Redis package or another source; Redis owns its named read command bindings.');
  if (mysqlSource && (Object.keys(options).some(key =>
      !['id', 'label', 'alias', 'runtime', 'mysqlPackage'].includes(key) && options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original prepared MySQL package or another source; the package owns its original query bindings.');
  const jsonrpcSource = options.jsonrpcPackage !== undefined;
  const sqliteSource = options.sqlitePackage !== undefined;
  const clickhouseSource = options.clickhousePackage !== undefined;
  if (clickhouseSource && (Object.keys(options).some(key => !['id', 'label', 'alias', 'clickhousePackage', 'clickhouseColumnTypes', 'runtime', 'signal'].includes(key) && options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original prepared ClickHouse package or another source; ClickHouse owns its native typed query bindings.');
  if (!clickhouseSource && options.clickhouseColumnTypes !== undefined)
    throw new TypeError('Reviewed ClickHouse column types require the original ClickHouse package.');
  if (sqliteSource && (['workspace', 'spec', 'config', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package', 'jsonrpcPackage'].some(key => options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original SQLite workbench package or another source; SQLite owns its native query bindings.');
  if (!sqliteSource && (options.sqliteSnapshotMaxBytes !== undefined || options.sqliteSnapshotTimeoutMs !== undefined))
    throw new TypeError('SQLite snapshot selections require sqlitePackage.');
  if (jsonrpcSource && (['workspace', 'spec', 'config', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package'].some(key => options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams))
    throw new TypeError('Choose the original prepared RPC package or another source; the package owns its method and provider bindings.');
  if (s3Source && (['workspace', 'spec', 'config', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython'].some(key => options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original S3 configured package or another source; the package owns its pinned object bindings.');
  if (duckdbSource && (['workspace', 'spec', 'config', 'bindings', 'upstreams', 'python', 'pythonRoot'].some(key => options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose the original prepared DuckDB package or another source; the package owns its native query bindings.');
  if (options.duckdbPython !== undefined && !duckdbSource)
    throw new TypeError('duckdbPython requires a prepared DuckDB package.');
  if (pythonSource && (['workspace', 'spec', 'config', 'bindings', 'upstreams'].some(key => options[key] !== undefined) ||
      options.runtime?.handlers || options.runtime?.upstreams || options.runtime?.allowLoopbackUpstream))
    throw new TypeError('Choose a Python merchant declaration or an OpenAPI source; Python owns its original application bindings.');
  if (options.pythonRoot !== undefined && !pythonSource) throw new TypeError('pythonRoot requires a Python merchant declaration.');
  if (options.workspace && (['spec', 'config', 'bindings', 'upstreams'].some(key => options[key] !== undefined) || options.runtime?.handlers))
    throw new TypeError('Choose --workspace or explicit source inputs for this release.');
  const workspace = options.workspace ? await readReleaseWorkspace(options.workspace) : null;
  const inputs = workspace?.inputs ?? options;
  const runtime = runtimeOptions(options.runtime);
  if (workspace?.allowLoopbackUpstream) runtime.allowLoopbackUpstream = true;
  if (runtime.upstreams) throw new TypeError('Stage takes --upstreams FILE, not an existing release snapshot.');
  if (inputs.upstreams && runtime.handlers) throw new TypeError('Choose --upstreams or --handlers for this release.');
  if (runtime.allowLoopbackUpstream && !inputs.upstreams && !jsonrpcSource)
    throw new TypeError('Loopback upstream permission requires --upstreams or the original RPC package.');
  const temp = join(root, 'releases', '.stage-' + randomUUID());
  let committed = false;
  try {
    let stagedDuckdb, stagedSqlite;
    if (datasetSource) await stageDatasetRelease(temp, options.datasetPackage);
    else if (postgresSource) await stagePostgresRelease(temp, options.postgresPackage, {
      signal: options.signal, expectedInputManifestSha256: options.postgresInputManifestSha256 });
    else if (clickhouseSource) await stageClickHouseRelease(temp, options.clickhousePackage, { columnTypes: options.clickhouseColumnTypes });
    else if (redisSource) await stageRedisRelease(temp, options.redisPackage);
    else if (mysqlSource) await stageMysqlRelease(temp, options.mysqlPackage);
    else if (sqliteSource) stagedSqlite = await stageSqliteRelease(temp, options.sqlitePackage,
      { maxBytes: options.sqliteSnapshotMaxBytes, timeoutMs: options.sqliteSnapshotTimeoutMs, signal: options.signal });
    else if (jsonrpcSource) await stageJsonrpcRelease(temp, options.jsonrpcPackage);
    else if (s3Source) await stageS3Release(temp, options.s3Package);
    else if (duckdbSource) stagedDuckdb = await stageDuckdbRelease(temp, options.duckdbPackage, { python: options.duckdbPython });
    else if (pythonSource) await stagePythonRelease(temp, options.python, { sourceRoot: options.pythonRoot });
    else {
      const compile = (await import('../sf61-openapi-seller-import/cli.mjs')).run;
      await compile(['--spec', resolve(inputs.spec), '--config', resolve(inputs.config),
        '--service-bindings', resolve(inputs.bindings), '--out', temp]);
    }
    let source = stagedSqlite
      ? { ...stagedSqlite, routes: sourceRoutes(stagedSqlite.service, new Map(), null, null, null, null, null, stagedSqlite.sqlite) }
      : stagedDuckdb
      ? { ...stagedDuckdb, routes: sourceRoutes(stagedDuckdb.service, new Map(), null, null, stagedDuckdb.duckdb) }
      : await sourceSnapshot(temp);
    if (inputs.upstreams) {
      runtime.upstreams = await stageReleaseUpstreams(temp, resolve(inputs.upstreams), source.service,
        { allowLoopback: runtime.allowLoopbackUpstream === true });
      source = await sourceSnapshot(temp, runtime.upstreams, runtime.allowLoopbackUpstream === true);
    }
    if (workspace && (source.manifest.specSha256 !== workspace.hashes['facade-openapi.json'] ||
        source.manifest.selectionsSha256 !== workspace.hashes['selections.json'] ||
        source.manifest.serviceBindingsSha256 !== workspace.hashes['route-bindings.json'] ||
        runtime.upstreams.sha256 !== workspace.hashes['upstreams.json']))
      throw new Error('Workspace inputs changed during staging. Reopen the original saved package and stage it again.');
    if (source.hasApplication && !source.python && !source.duckdb && !source.mysql && !source.postgres && !source.redis && !source.s3 && !source.jsonrpc && !source.sqlite && !source.dataset && !source.clickhouse && !runtime.handlers && !runtime.upstreams)
      throw new Error('This release uses application/admission exports. Supply --handlers or --upstreams.');
    let handlerEntry = null;
    if (runtime.handlers) {
      const bytes = await regular(runtime.handlers);
      handlerEntry = { path: runtime.handlers, sha256: hash(bytes), bytes: bytes.length,
        scope: 'ENTRY_MODULE_ONLY' };
    }
    const content = { schema: RELEASE, id: releaseId, label, createdAt: new Date().toISOString(),
      publicOrigin: source.service.publicOrigin, runtime, handlerEntry, files: source.files, routes: source.routes,
      ...(workspace ? { inputPackage: workspace.provenance } : {}),
      ...(source.python ? { python: source.python } : {}),
      ...(source.duckdb ? { duckdb: source.duckdb } : {}),
      ...(source.mysql ? { mysql: source.mysql } : {}),
      ...(source.postgres ? { postgres: source.postgres } : {}),
      ...(source.redis ? { redis: source.redis } : {}),
      ...(source.s3 ? { s3: source.s3 } : {}),
      ...(source.jsonrpc ? { jsonrpc: source.jsonrpc } : {}),
      ...(source.sqlite ? { sqlite: source.sqlite } : {}),
      ...(source.dataset ? { dataset: source.dataset } : {}),
      ...(source.clickhouse ? { clickhouse: source.clickhouse } : {}),
      source: { offersSha256: source.manifest.offersSha256, serviceConfigSha256: source.manifest.serviceConfigSha256,
        ...(source.dataset ? { kind: 'VERSIONED_DATASET_PACKAGE', baselineSnapshot: source.dataset.baselineSnapshot,
          contractSha256: source.dataset.contractSha256, sourceConfigSha256: source.dataset.sourceConfigSha256,
          csvSha256: source.dataset.csvSha256, sourceSha256: source.dataset.sourceSha256,
          bindingSha256: source.dataset.bindingSha256, executionSha256: source.dataset.executionSha256 }
          : source.clickhouse ? { kind: 'CLICKHOUSE_MERCHANT_PACKAGE', packageSha256: source.clickhouse.packageSha256,
          sourceConfigSha256: source.clickhouse.sourceConfigSha256, planSha256: source.clickhouse.planSha256,
          querySha256: source.clickhouse.querySha256, executionSha256: source.clickhouse.executionSha256 }
          : source.postgres ? { kind: 'POSTGRES_MERCHANT_PACKAGE', inputManifestSha256: source.postgres.inputManifestSha256,
          originalSourceConfigSha256: source.postgres.originalSourceConfigSha256,
          originalServiceConfigSha256: source.postgres.originalServiceConfigSha256,
          sourceConfigSha256: source.postgres.sourceConfigSha256, executionSha256: source.postgres.executionSha256 }
          : source.redis ? { kind: 'REDIS_MERCHANT_PACKAGE', packageManifestSha256: source.redis.packageManifestSha256,
          sourceConfigSha256: source.redis.sourceConfigSha256, planSha256: source.redis.planSha256,
          executionSha256: source.redis.executionSha256 }
          : source.mysql ? { kind: 'MYSQL_MERCHANT_PACKAGE', packageManifestSha256: source.mysql.packageManifestSha256,
          sourceConfigSha256: source.mysql.sourceConfigSha256, planSha256: source.mysql.planSha256,
          executionSha256: source.mysql.executionSha256 }
          : source.sqlite ? { kind: 'SQLITE_MERCHANT_PACKAGE', packageManifestSha256: source.sqlite.packageManifestSha256,
          sourceConfigSha256: source.sqlite.sourceConfigSha256, querySha256: source.sqlite.querySha256,
          databaseSha256: source.sqlite.databaseSha256, executionSha256: source.sqlite.executionSha256 } : source.jsonrpc ? { kind: 'JSONRPC_MERCHANT_PACKAGE', planSha256: source.jsonrpc.planSha256,
          packageManifestSha256: source.jsonrpc.packageManifestSha256, executionSha256: source.jsonrpc.executionSha256 }
          : source.s3 ? { kind: 'S3_OBJECT_PACKAGE', sourceConfigSha256: source.s3.sourceConfigSha256,
          objectsSha256: source.s3.objectsSha256, executionSha256: source.s3.executionSha256 }
          : source.duckdb ? { kind: 'DUCKDB_PACKAGE', packageManifestSha256: source.duckdb.packageManifestSha256,
          sourceConfigSha256: source.duckdb.sourceConfigSha256, planSha256: source.duckdb.planSha256,
          datasetSha256: source.duckdb.datasetSha256 } : source.python ? { kind: 'PYTHON_APPLICATION', declarationSha256: source.python.configSha256,
          applicationSha256: source.python.applicationSha256, sourceSha256: source.python.sourceSha256 }
          : { specSha256: source.manifest.specSha256, selectionsSha256: source.manifest.selectionsSha256,
            serviceBindingsSha256: source.manifest.serviceBindingsSha256 }) } };
    const record = { ...content, digest: hash(stable(content)) };
    await writeNew(join(temp, 'release.json'), record);
    await mutate(root, async () => {
      if (postgresSource) options.signal?.throwIfAborted();
      const target = join(root, 'releases', releaseId);
      try { await lstat(target); throw Object.assign(new Error('Release ID already exists; choose a new ID.'), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temp, target); committed = true; await syncDirectory(join(root, 'releases'));
    });
    return publicRelease(record);
  } finally { if (!committed) await rm(temp, { recursive: true, force: true }); }
}
/** Retain verified compiled source while changing only its reviewed facilitator.
 * All original native-kind metadata and file identities travel with the source;
 * mutable pilot configuration, process records and controls are never copied. */
export async function stageRetainedRelease(root, options) {
  const allowed = ['from', 'id', 'label', 'expectedDigest', 'expectedGeneration', 'facilitator',
    'allowLocalFacilitator', 'review'];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !allowed.includes(key)))
    throw new TypeError('Supply the reviewed retained release and facilitator fields.');
  root = resolve(root); await readReleaseState(root);
  const from = id(options.from), releaseId = id(options.id), label = text(options.label ?? releaseId, 'Release label');
  if (from === releaseId) throw new TypeError('Use a new release ID for a facilitator change.');
  if (typeof options.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedDigest))
    throw new TypeError('Supply the exact reviewed source digest.');
  if (!Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration < 0)
    throw new TypeError('Supply the reviewed selection generation.');
  const { record: original, path: sourcePath } = await releaseRecord(root, from, true);
  if (original.digest !== options.expectedDigest)
    throw Object.assign(new Error('The retained source differs from the reviewed digest.'), { code: 'RELEASE_CONFLICT' });
  const retainedRuntime = { ...original.runtime };
  delete retainedRuntime.facilitator; delete retainedRuntime.allowLocalFacilitator;
  const runtime = runtimeOptions({ ...retainedRuntime, facilitator: options.facilitator,
    allowLocalFacilitator: options.allowLocalFacilitator ?? false });
  if (!runtime.facilitator) throw new TypeError('Select an explicit facilitator for this retained release.');
  const facilitatorReview = structuredClone(options.review);
  const derivedFrom = { kind: 'FACILITATOR', releaseId: from, releaseDigest: original.digest,
    reviewId: facilitatorReview?.id, supportedSha256: facilitatorReview?.supportedSha256 };
  checkFacilitatorReview({ ...original, id: releaseId, label, runtime, derivedFrom, facilitatorReview });
  if (facilitatorReview.generation !== options.expectedGeneration ||
      facilitatorReview.source.currentFacilitator !== (original.runtime.facilitator ?? null) ||
      facilitatorReview.source.currentAllowLocalFacilitator !== (original.runtime.allowLocalFacilitator === true))
    throw new Error('The retained review differs from its original runtime or selection generation.');
  const target = join(root, 'releases', releaseId);
  const existing = async () => {
    let value;
    try { value = await releaseRecord(root, releaseId, true); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (value.record.label !== label || stable(value.record.derivedFrom) !== stable(derivedFrom) ||
        stable(value.record.facilitatorReview) !== stable(facilitatorReview) ||
        stable(value.record.runtime) !== stable(runtime) || stable(value.record.source) !== stable(original.source) ||
        stable(value.record.files) !== stable(original.files) || stable(value.record.routes) !== stable(original.routes))
      throw Object.assign(new Error('That release ID belongs to a different retained change. Inspect it or choose a new ID.'), { code: 'EEXIST' });
    return { release: publicRelease(value.record), reused: true };
  };
  const retained = await existing();
  if (retained) return retained;
  const checkGeneration = async () => {
    const state = await readReleaseState(root);
    if (state.generation !== options.expectedGeneration)
      throw Object.assign(new Error('Selection changed while preparing this facilitator. Review the current release again.'),
        { code: 'RELEASE_CONFLICT', generation: state.generation });
  };
  await checkGeneration();
  const temp = join(root, 'releases', '.stage-' + randomUUID());
  let committed = false;
  try {
    await mkdir(temp, { mode: 0o700 });
    for (const entry of original.files) {
      if (typeof entry.file !== 'string' || !entry.file || entry.file.includes('\\') || entry.file.includes('\0') ||
          isAbsolute(entry.file) || relative(temp, resolve(temp, entry.file)).split(sep).join('/') !== entry.file ||
          entry.file.split('/').some(part => !part || part === '.' || part === '..') ||
          !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
        throw new TypeError('The original retained source has an invalid file identity.');
      const source = join(sourcePath, entry.file), destination = join(temp, entry.file);
      const parents = entry.file.split('/').slice(0, -1);
      let parent = sourcePath;
      for (const part of parents) { parent = join(parent, part); await directory(parent); }
      const info = await lstat(source);
      if (!info.isFile() || info.size !== entry.bytes) throw new Error('Retained source file changed: ' + entry.file);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
      const handle = await open(destination, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    }
    // Original source inspectors validate the complete copied closure, including
    // native database/package bytes and executable declarations, before commit.
    const { digest: ignoredDigest, ...originalContent } = original;
    const content = { ...originalContent, id: releaseId, label, createdAt: new Date().toISOString(), runtime, derivedFrom, facilitatorReview };
    const record = { ...content, digest: hash(stable(content)) };
    if (Buffer.byteLength(JSON.stringify(record, null, 2) + '\n') > LIMIT)
      throw new RangeError('The retained release reached its original metadata size limit.');
    await writeNew(join(temp, 'release.json'), record);
    const snapshot = await sourceSnapshot(temp, runtime.upstreams, runtime.allowLoopbackUpstream === true);
    if (stable(snapshot.files) !== stable(original.files) || stable(snapshot.routes) !== stable(original.routes))
      throw new Error('Copied source differs from the inspected retained release.');
    return await mutate(root, async () => {
      const concurrent = await existing();
      if (concurrent) return concurrent;
      await checkGeneration();
      await rename(temp, target); committed = true; await syncDirectory(join(root, 'releases'));
      return { release: publicRelease(record), reused: false };
    });
  } finally { if (!committed) await rm(temp, { recursive: true, force: true }); }
}
export async function listReleases(root) {
  await readReleaseState(root);
  const names = await readdir(join(resolve(root), 'releases'), { withFileTypes: true });
  const releases = [], errors = [];
  for (const entry of names) {
    if (entry.name.startsWith('.stage-')) continue;
    try {
      const { record } = await releaseRecord(root, entry.name);
      releases.push(publicRelease(record));
    } catch (error) { errors.push({ id: entry.name, message: error.message }); }
  }
  releases.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { releases, errors };
}
export async function inspectRelease(root, releaseId) {
  await readReleaseState(root);
  return publicRelease((await releaseRecord(root, releaseId, true)).record);
}
/** Exact original atomic strings are displayed as strings, never converted to currency. */
export async function compareReleases(root, beforeId, afterId, { beforeRoot = root } = {}) {
  const before = beforeId === null ? null : await inspectRelease(beforeRoot, beforeId);
  const after = await inspectRelease(root, afterId);
  const previous = new Map((before?.routes ?? []).map(route => [route.method + ' ' + route.path, route]));
  const current = new Map(after.routes.map(route => [route.method + ' ' + route.path, route]));
  const changes = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    const from = previous.get(key), to = current.get(key);
    if (!from || !to) { changes.push({ route: key, state: from ? 'REMOVED' : 'ADDED', before: from ?? null, after: to ?? null, fields: [] }); continue; }
    const fields = [];
    for (const field of ['id', 'url', 'payment', 'requestContractSha256', 'application', 'upstream']) {
      if (stable(from[field]) !== stable(to[field])) fields.push({ field, before: from[field], after: to[field] });
    }
    if (fields.length) changes.push({ route: key, state: 'CHANGED', fields, before: from, after: to });
  }
  const runtimeChanges = [];
  for (const field of ['port', 'handlers', 'facilitator', 'allowLocalFacilitator', 'upstreams', 'allowLoopbackUpstream']) {
    if (stable(before?.runtime[field] ?? null) !== stable(after.runtime[field] ?? null))
      runtimeChanges.push({ field, before: before?.runtime[field] ?? null, after: after.runtime[field] ?? null });
  }
  if (before?.handlerEntry?.sha256 !== after.handlerEntry?.sha256)
    runtimeChanges.push({ field: 'handlerEntrySha256', before: before?.handlerEntry?.sha256 ?? null, after: after.handlerEntry?.sha256 ?? null });
  if (stable(before?.python ?? null) !== stable(after.python ?? null))
    runtimeChanges.push({ field: 'python', before: before?.python ?? null, after: after.python ?? null });
  if (stable(before?.duckdb ?? null) !== stable(after.duckdb ?? null))
    runtimeChanges.push({ field: 'duckdb', before: before?.duckdb ?? null, after: after.duckdb ?? null });
  if (stable(before?.mysql ?? null) !== stable(after.mysql ?? null))
    runtimeChanges.push({ field: 'mysql', before: before?.mysql ?? null, after: after.mysql ?? null });
  if (stable(before?.postgres ?? null) !== stable(after.postgres ?? null))
    runtimeChanges.push({ field: 'postgres', before: before?.postgres ?? null, after: after.postgres ?? null });
  if (stable(before?.redis ?? null) !== stable(after.redis ?? null))
    runtimeChanges.push({ field: 'redis', before: before?.redis ?? null, after: after.redis ?? null });
  if (stable(before?.s3 ?? null) !== stable(after.s3 ?? null))
    runtimeChanges.push({ field: 's3', before: before?.s3 ?? null, after: after.s3 ?? null });
  if (stable(before?.jsonrpc ?? null) !== stable(after.jsonrpc ?? null))
    runtimeChanges.push({ field: 'jsonrpc', before: before?.jsonrpc ?? null, after: after.jsonrpc ?? null });
  if (stable(before?.sqlite ?? null) !== stable(after.sqlite ?? null))
    runtimeChanges.push({ field: 'sqlite', before: before?.sqlite ?? null, after: after.sqlite ?? null });
  if (stable(before?.clickhouse ?? null) !== stable(after.clickhouse ?? null))
    runtimeChanges.push({ field: 'clickhouse', before: before?.clickhouse ?? null, after: after.clickhouse ?? null });
  if (stable(before?.dataset ?? null) !== stable(after.dataset ?? null))
    runtimeChanges.push({ field: 'dataset', before: before?.dataset ?? null, after: after.dataset ?? null });
  if (stable(before?.facilitatorReview ?? null) !== stable(after.facilitatorReview ?? null))
    runtimeChanges.push({ field: 'facilitatorReview', before: before?.facilitatorReview ?? null, after: after.facilitatorReview ?? null });
  return { schema: 'stellar-forge.seller-release-diff.v1', before, after, changes, runtimeChanges,
    summary: { added: changes.filter(c => c.state === 'ADDED').length,
      removed: changes.filter(c => c.state === 'REMOVED').length,
      changed: changes.filter(c => c.state === 'CHANGED').length,
      paymentChanged: changes.filter(c => c.fields.some(f => f.field === 'payment')).length,
      unchanged: [...current.keys()].filter(k => previous.has(k) && !changes.some(c => c.route === k)).length } };
}
// Optional operator review metadata travels in the original selection and run
// records. The console resolves this from the original receiving controller.
function receivingSnapshot(value, record, generation) {
  if (value === undefined || value === null) return null;
  const fail = () => { throw Object.assign(new Error('The receiving review does not match this exact release and selection. Refresh its original review.'),
    { code: 'RECEIVING_RELEASE_MISMATCH', status: 409 }); };
  const fields = ['schema', 'releaseId', 'releaseDigest', 'configurationSha256', 'preparedGeneration',
    'expectedGeneration', 'bindingId', 'profileId', 'reviewId', 'planDigest', 'manifestSha256',
    'completedAt', 'mode', 'status', 'summary'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key)) ||
      value.schema !== 'stellar-forge.release-receiving-context.v1' ||
      value.releaseId !== record.id || value.releaseDigest !== record.digest ||
      value.configurationSha256 !== record.source.serviceConfigSha256 ||
      value.expectedGeneration !== generation ||
      !Number.isSafeInteger(value.preparedGeneration) || value.preparedGeneration < 0 ||
      !['releaseDigest', 'configurationSha256', 'planDigest', 'manifestSha256']
        .every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) ||
      !['bindingId', 'profileId', 'reviewId'].every(key =>
        typeof value[key] === 'string' && /^[a-z0-9]{8,13}-[a-f0-9]{16}$/.test(value[key])) ||
      typeof value.completedAt !== 'string' || value.completedAt.length > 40 || !Number.isFinite(Date.parse(value.completedAt)) ||
      !['mode', 'status'].every(key => typeof value[key] === 'string' &&
        /^[A-Za-z][A-Za-z0-9_ -]{0,79}$/.test(value[key])) ||
      !value.summary || typeof value.summary !== 'object' || Array.isArray(value.summary) ||
      Object.keys(value.summary).length > 16 ||
      !Object.entries(value.summary).every(([key, count]) => /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) &&
        Number.isSafeInteger(count) && count >= 0)) fail();
  const { expectedGeneration, ...snapshot } = value;
  return JSON.parse(JSON.stringify(snapshot));
}
async function selectRelease(root, target, options, operation) {
  root = resolve(root); await readReleaseState(root);
  if (!Number.isSafeInteger(options?.expectedGeneration) || options.expectedGeneration < 0)
    throw new TypeError('Supply the current --expect generation from status/diff to preserve concurrent changes.');
  const reason = text(options.reason ?? operation, 'Change reason');
  return mutate(root, async () => {
    const state = await readReleaseState(root);
    if (state.generation !== options.expectedGeneration) {
      const error = new Error('Active selection changed from generation ' + options.expectedGeneration + ' to ' + state.generation + '. Refresh the comparison.');
      error.code = 'RELEASE_CONFLICT'; error.generation = state.generation; throw error;
    }
    const selected = target ?? state.previous;
    if (!selected) throw new Error('There is no previous release to roll back to.');
    const { record } = await releaseRecord(root, selected, true);
    const receivingReview = receivingSnapshot(options.receivingReview, record, state.generation);
    if (state.active === selected) return { changed: false, state };
    const event = { generation: state.generation + 1, operation, from: state.active, to: selected,
      at: new Date().toISOString(), reason, ...(receivingReview ? { receivingReview } : {}) };
    const next = { ...state, generation: event.generation, active: selected, previous: state.active,
      history: [...state.history, event] };
    if (Buffer.byteLength(JSON.stringify(next)) > LIMIT) throw new Error('Release history reached the store size limit. Retain this store and initialize a new deployment store.');
    await atomic(join(root, 'state.json'), next);
    return { changed: true, state: next };
  });
}
export const activateRelease = (root, releaseId, options) => selectRelease(root, id(releaseId), options, 'activate');
export const rollbackRelease = (root, options) => selectRelease(root, options?.to ? id(options.to) : null, options, 'rollback');

async function originalReadback(listener, record, mode) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(listener)) throw new Error('Seller listener must be original loopback HTTP.');
  const opts = { redirect: 'error', signal: AbortSignal.timeout(2500) };
  const [healthResponse, offerResponse] = await Promise.all([
    fetch(listener + '/_seller/health', opts), fetch(listener + '/_seller/offers', opts),
  ]);
  if (!healthResponse.ok || !offerResponse.ok) throw new Error('Original seller did not answer health and offers.');
  const [health, offers] = await Promise.all([healthResponse.json(), offerResponse.json()]);
  if (health.schema !== 'stellar-forge.seller-service.v1' || health.mode !== mode ||
      !Array.isArray(offers) || offers.length !== record.routes.length) throw new Error('Seller readback differs from selected release.');
  const offered = offers.map(offer => ({ method: offer.extensions?.bazaar?.info?.input?.method,
    url: offer.resource?.url, payment: offer.accepts })).sort((a, b) => stable(a).localeCompare(stable(b)));
  const expected = record.routes.map(route => ({ method: route.method, url: route.url, payment: route.payment }))
    .sort((a, b) => stable(a).localeCompare(stable(b)));
  if (stable(offered) !== stable(expected)) throw new Error('Running seller payment terms differ from original release.');
  return health;
}
export async function releaseStatus(root) {
  root = resolve(root);
  const state = await readReleaseState(root);
  const catalog = await listReleases(root);
  const observed = await optional(join(root, 'runtime.json'));
  const claim = await lockOwner(root, 'run.lock'), owner = claim.owner;
  const processOwner = await releaseProcessOwner();
  let runtime = { state: 'STOPPED', observed };
  if (claim.present && !owner) {
    runtime = { state: 'STARTING', observed, message: 'A manager is establishing its release-store ownership.' };
  } else if (owner) {
    const { managerAlive, childAlive } = await releaseOwnerLiveness(root, owner, processOwner);
    const current = observed?.schema === RUN && observed.lockToken === owner.token &&
      observed.instanceId === owner.instanceId && observed.pid === owner.childPid && !observed.endedAt;
    runtime = { state: managerAlive ? 'STARTING' : 'STOPPED', observed, managerAlive, childAlive };
    if (owner.host !== processOwner.host && (managerAlive || childAlive)) {
      runtime.state = 'OTHER_HOST'; runtime.message = 'The release-store owner is on another host.';
    } else if (!managerAlive && childAlive) {
      runtime.state = 'ORPHANED';
      runtime.message = 'The manager ended while its recorded seller process is still present. Start remains unavailable until that process ends.';
    } else if (managerAlive && owner.childPid && !childAlive) {
      runtime.state = 'UNAVAILABLE'; runtime.message = 'The manager is recording the seller process exit.';
    } else if (managerAlive && childAlive && current && observed.listener) {
      try {
        const { record } = await releaseRecord(root, observed.releaseId, true);
        if (record.digest !== observed.releaseDigest) throw new Error('Running release digest changed.');
        await originalReadback(observed.listener, record, observed.mode);
        runtime.state = observed.releaseId === state.active ? 'RUNNING' : 'RESTART_REQUIRED';
      } catch (error) { runtime.state = 'UNAVAILABLE'; runtime.message = error.message; }
    }
  } else if (observed?.schema === RUN && !observed.endedAt &&
      (observed.host === undefined || observed.host === hostname()) &&
      await recordedSellerAlive(root, observed, processOwner)) {
    runtime = { state: 'ORPHANED', observed,
      message: 'The recorded seller process is still present without its owner file. This console does not own that process.' };
  }
  return { schema: 'stellar-forge.seller-release-status.v1', root, state, ...catalog, runtime };
}

// The child cannot import handlers or open a listener until its process birth
// identity and inherited lifetime are durably registered. IPC disconnect ends
// this waiting child. After the grant, the unchanged original pilot owns serving;
// its private cache controls attach before the release reports readiness.

/** Spawn the ORIGINAL foreground launcher so each run gets fresh application imports. */
export async function runActiveRelease(root, { startupTimeoutMs = 45000, shutdownGraceMs, expectedGeneration, handleSignals = true, operationsNavigationOrigin, receivingReview, env = process.env } = {}) {
  root = resolve(root); await readReleaseState(root);
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000 || startupTimeoutMs > 120000 ||
      shutdownGraceMs !== undefined && (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1000 || shutdownGraceMs > 120000))
    throw new TypeError('Startup and shutdown timeouts must be 1000–120000 ms.');
  if (expectedGeneration !== undefined && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0))
    throw new TypeError('expectedGeneration must be the nonnegative integer shown by release status.');
  if (typeof handleSignals !== 'boolean') throw new TypeError('handleSignals must be a boolean.');
  if (operationsNavigationOrigin !== undefined &&
      (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(operationsNavigationOrigin) ||
        Number(new URL(operationsNavigationOrigin).port) > 65535))
    throw new TypeError('Use the explicit loopback console origin for merchant operations navigation.');
  const releaseLock = await lock(root, 'run.lock');
  let child, observation, closing, finishing, stopping, completion, startupTimer, failure;
  let ownsWorkerGroup = false, effectiveShutdownGraceMs = shutdownGraceMs ?? 70000;
  let exited = Promise.resolve(), exitSettled = true, shutdownRequested = null, rejectReady = () => {};
  let exitCode = null, exitSignal = null;
  const forceOwnedChild = () => {
    if (!child?.pid) return;
    // Python application and DuckDB query workers inherit this owned process group.
    // Keep graceful SIGTERM on its leader so the seller can drain first; a hard
    // deadline or failed leader must not leave those workers serving in limbo.
    if (ownsWorkerGroup && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') failure ??= 'Could not stop the owned merchant worker group.'; }
    } else if (!exitSettled) child.kill('SIGKILL');
  };
  const stopChild = (signal = 'SIGTERM') => {
    if (stopping) return stopping;
    stopping = (async () => {
      let forced = false, forceTimer;
      if (child?.pid && !exitSettled) {
        child.kill(signal);
        forceTimer = setTimeout(() => {
          if (!exitSettled) { forced = true; forceOwnedChild(); }
        }, effectiveShutdownGraceMs);
      }
      try { await exited; } finally { clearTimeout(forceTimer); }
      return { forced, exitCode, exitSignal };
    })();
    return stopping;
  };
  const interrupt = signal => {
    shutdownRequested = signal;
    rejectReady(Object.assign(new Error('Seller startup interrupted by ' + signal + '.'), { code: 'RELEASE_INTERRUPTED' }));
    void stopChild(signal).catch(error => { failure ??= error.message; });
  };
  const onInterrupt = () => interrupt('SIGINT'), onTerminate = () => interrupt('SIGTERM');
  const finish = () => {
    if (finishing) return finishing;
    finishing = (async () => {
      clearTimeout(startupTimer);
      process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
      try {
        if (observation) {
          Object.assign(observation, { phase: 'STOPPED', endedAt: new Date().toISOString(), exitCode, exitSignal,
            ...(failure ? { failure } : {}) });
          await atomic(join(root, 'runtime.json'), observation);
        }
      } finally { await releaseLock(); }
    })();
    return finishing;
  };
  try {
    const state = await readReleaseState(root);
    if (expectedGeneration !== undefined && state.generation !== expectedGeneration) {
      const error = new Error('Active selection changed from generation ' + expectedGeneration + ' to ' + state.generation + '. Refresh before starting.');
      error.code = 'RELEASE_CONFLICT'; error.generation = state.generation; throw error;
    }
    if (!state.active) throw new Error('Activate a staged release before running a seller.');
    const previous = await optional(join(root, 'runtime.json'));
    if (previous?.schema === RUN && !previous.endedAt &&
        (previous.host === undefined || previous.host === hostname()) &&
        await recordedSellerAlive(root, previous, releaseLock.owner, releaseLock.lifetime))
      throw Object.assign(new Error('The previously recorded seller process is still present. This manager cannot start a duplicate or stop a process it does not own.'), { code: 'RELEASE_BUSY' });
    const { record, path } = await releaseRecord(root, state.active, true);
    const selection = state.history.at(-1);
    const retainedReview = receivingReview ?? (selection?.generation === state.generation &&
      selection.to === record.id && selection.receivingReview
      ? { ...selection.receivingReview, expectedGeneration: state.generation } : undefined);
    const receiving = receivingSnapshot(retainedReview, record, state.generation);
    ownsWorkerGroup = Boolean(record.python || record.duckdb || record.sqlite);
    if (record.python && shutdownGraceMs === undefined)
      effectiveShutdownGraceMs = Math.max(70000, 60000 + record.python.shutdownTimeoutMs + 5000);
    // Replace only original mutable runtime settings, never compiled source. This
    // prevents a previous manual resume override from leaking into the release.
    const originalOptions = { ...record.runtime, port: String(record.runtime.port),
      ...((record.jsonrpc || record.postgres || record.clickhouse) && operationsNavigationOrigin ? { operationsNavigationOrigin } : {}) };
    await atomic(join(path, 'pilot-runtime.json'), { schema: 'stellar-forge.seller-pilot-runtime.v1',
      source: { offersSha256: record.source.offersSha256, serviceConfigSha256: record.source.serviceConfigSha256 },
      options: originalOptions });
    const instanceId = randomUUID(), mode = record.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY';
    const cacheRoutes = record.routes.filter(route => route.upstream?.cache).map(route => ({
      id: route.id, binding: route.application.handler, policy: route.upstream.cache }));
    await releaseLock.update({ instanceId, releaseId: record.id, releaseDigest: record.digest, selectionGeneration: state.generation });
    child = spawn(process.execPath, [CHILD, record.dataset ? DATASET_PILOT : record.clickhouse ? CLICKHOUSE_PILOT : record.postgres ? POSTGRES_PILOT : record.redis ? REDIS_PILOT : record.mysql ? MYSQL_PILOT : record.sqlite ? SQLITE_PILOT : record.jsonrpc ? JSONRPC_PILOT : record.s3 ? S3_PILOT : record.duckdb ? DUCKDB_PILOT : record.python ? PYTHON_PILOT : PILOT, path, instanceId, releaseCacheControlPath(root, instanceId), releaseLock.lifetime ? '4' : '-'],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc', ...(releaseLock.lifetime ? [releaseLock.lifetime.fd] : [])],
        windowsHide: true, detached: process.platform !== 'win32', env: { ...env } });
    let readyResolve, readyReject, ownerResolve, ownerReject, stdout = '', stderr = '';
    const ready = new Promise((done, fail) => { readyResolve = done; readyReject = fail; });
    const childOwner = new Promise((done, fail) => { ownerResolve = done; ownerReject = fail; });
    const rejectStartup = error => { readyReject(error); ownerReject(error); };
    // A spawn error can arrive during the durable owner write, before await ready.
    // Observe rejection now and retain one exit promise for all cleanup paths.
    void ready.catch(() => {}); void childOwner.catch(() => {});
    rejectReady = rejectStartup; exitSettled = false;
    child.once('message', message => {
      if (message?.type !== 'sf82-owner' || message.instanceId !== instanceId || message.pid !== child.pid ||
          !validProcessIdentity(message.processIdentity) ||
          !sameReleaseLease(message.kernelLease, releaseLock.owner.kernelLease)) {
        rejectStartup(new Error('Original seller reported a different process owner.')); return;
      }
      ownerResolve(message);
    });
    exited = new Promise(done => {
      const settle = () => { if (!exitSettled) { exitSettled = true; done(); } };
      child.on('error', error => { failure ??= error.message; rejectStartup(error); if (!child.pid) settle(); });
      child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal;
        if (ownsWorkerGroup && (signal || code !== 0)) forceOwnedChild();
        rejectStartup(new Error('Original seller exited before startup (code ' + code + ', signal ' + signal + '). ' + stderr.slice(-2000))); settle(); });
    });
    if (handleSignals) { process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate); }
    child.stderr.setEncoding('utf8'); child.stdout.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { rejectStartup(new Error('Original seller startup output exceeded its limit.')); stdout = ''; return; }
      while (stdout.includes('\n')) {
        const newline = stdout.indexOf('\n'), line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
        try { const value = JSON.parse(line); if (value.releaseReady === true && value.instanceId === instanceId) readyResolve(value); } catch {}
      }
    });
    startupTimer = setTimeout(() => rejectStartup(new Error('Original seller startup timed out.')), startupTimeoutMs);
    const workerOwner = await childOwner;
    await releaseLock.update({ childPid: child.pid, childProcessIdentity: workerOwner.processIdentity });
    observation = { schema: RUN, instanceId, lockToken: releaseLock.owner.token, host: hostname(),
      managerPid: process.pid, managerProcessIdentity: releaseLock.owner.processIdentity,
      pid: child.pid ?? null, processIdentity: workerOwner.processIdentity,
      ...(releaseLock.owner.kernelLease ? { kernelLease: releaseLock.owner.kernelLease } : {}),
      releaseId: record.id, releaseDigest: record.digest,
      selectionGeneration: state.generation, listener: null, mode, phase: 'STARTING', startedAt: new Date().toISOString(),
      ...(receiving ? { receivingReview: receiving } : {}) };
    await atomic(join(root, 'runtime.json'), observation);
    if (exitSettled || shutdownRequested) throw new Error(failure ?? 'Original seller stopped before launch.');
    await new Promise((done, fail) => child.send({ type: 'sf82-start', instanceId, cacheRoutes,
      facilitatorReview: record.facilitatorReview ?? null }, error => error ? fail(error) : done()));
    let report;
    try { report = await ready; } finally { clearTimeout(startupTimer); }
    if (report.originalOffersSha256 !== record.source.offersSha256 ||
        report.originalServiceConfigSha256 !== record.source.serviceConfigSha256 ||
        report.cacheControlAvailable !== Boolean(cacheRoutes.length))
      throw new Error('Original pilot reported a different release source.');
    const operations = report.operations ?? null;
    if (Boolean(record.jsonrpc || record.postgres || record.clickhouse) !== Boolean(operations) || operations && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(operations.url) ||
        operations.availability !== operations.url + '/availability' ||
        operations.availabilityControl !== null && !new RegExp('^' + operations.url.replaceAll('.', '\\.') + '/availability#[0-9a-f]{64}$').test(operations.availabilityControl)))
      throw new Error('Original merchant reported invalid private operations links.');
    await originalReadback(report.listener, record, mode);
    if (exitSettled || shutdownRequested) throw new Error('Original seller stopped during startup.');
    Object.assign(observation, { listener: report.listener, phase: 'RUNNING', readyAt: new Date().toISOString(),
      cacheControlAvailable: report.cacheControlAvailable, ...(operations ? { operations: operations.url } : {}) });
    await atomic(join(root, 'runtime.json'), observation);
    completion = exited.then(finish);
    void completion.catch(() => {});
    const close = () => {
      if (closing) return closing;
      closing = (async () => {
        const result = await stopChild(); await completion; return result;
      })();
      return closing;
    };
    return { release: publicRelease(record), url: report.listener, mode, child, observation, operations, close, completion };
  } catch (error) {
    failure ??= error.message;
    await stopChild();
    await finish(); throw error;
  }
}
