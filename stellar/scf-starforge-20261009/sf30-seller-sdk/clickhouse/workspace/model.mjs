// MIT. Retained operator work over the original ClickHouse source and SF30 seller.
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, readdir, open, rename, rm, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { atomicFile, atomicJson, boundedFile, canonical, sha256 } from '../../../sf46-release/release-core.mjs';
import { readClickHouseSourceFile, readJSONFile, openClickHouseSourceFile } from '../source.mjs';
import { compileClickHouseMerchantPlan, prepareClickHouseSeller, assertPrepared } from '../prepare.mjs';
import { startClickHouseMerchant } from '../start.mjs';
import { readSellerConfig } from '../../serve.mjs';
import { fields } from '../declaration.mjs';
import { initReleaseStore, readReleaseState, stageRelease, inspectRelease, releaseStatus } from '../../../sf82-seller-pilot/releases.mjs';
import { prepareClickHouseRelease, inspectClickHouseRelease } from '../../../sf82-seller-pilot/release-clickhouse.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';

const REVISION = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RELEASE = /^[a-f0-9]{64}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CAPS = {
  'source.json': 262144, 'merchant-plan.json': 262144, 'bindings.json': 262144,
  'service.json': 1048576, 'openapi.json': 16777216,
  'client/seller-client.mjs': 1048576, 'client/seller-client.d.mts': 1048576,
  'client/seller-openapi.json': 16777216, 'client/package.json': 65536, 'client/README.md': 1048576,
};
const CUSTOMER_FILES = ['openapi.json', 'client/seller-client.mjs', 'client/seller-client.d.mts',
  'client/seller-openapi.json', 'client/package.json', 'client/README.md'];
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const jsonBytes = (value, cap = 262144) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > cap) fail('WORKSPACE_DOCUMENT_TOO_LARGE', 413);
  return bytes;
};
const time = () => new Date().toISOString();
const checkId = (value, pattern) => {
  if (typeof value !== 'string' || !pattern.test(value)) fail('WORKSPACE_IDENTIFIER_INVALID', 422);
  return value;
};
async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    fail('WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 422);
  return realpath(path);
}
async function directorySync(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function optionalJSON(root, name, cap) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(root, name, cap))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function routesOf(bundle) {
  return bundle.service.routes.map(route => ({
    id: route.id, query: bundle.bindings[route.id].query, input: bundle.bindings[route.id].input,
    method: route.offer.extensions.bazaar.info.input.method, url: route.offer.resource.url,
    description: route.offer.resource.description,
    paymentOptions: structuredClone(route.offer.accepts),
    publicInput: structuredClone(route.offer.extensions.bazaar.info.input),
    inputSchema: structuredClone(route.offer.extensions.bazaar.schema.properties.input),
  }));
}
function customerArchive(directory) {
  return new Promise((done, reject) => {
    const child = spawn('tar', ['-czf', '-', '-C', directory, '--', ...CUSTOMER_FILES],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = []; let total = 0, failure;
    const timer = setTimeout(() => { failure = new Error('WORKSPACE_EXPORT_TIMEOUT'); child.kill('SIGKILL'); }, 15000);
    child.stdout.on('data', chunk => {
      total += chunk.length;
      if (total > 33554432) { failure = new Error('WORKSPACE_EXPORT_TOO_LARGE'); child.kill('SIGKILL'); }
      else chunks.push(chunk);
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure ?? new Error('WORKSPACE_EXPORT_FAILED'));
      else done(Buffer.concat(chunks, total));
    });
  });
}

export async function createClickHouseWorkspace({ stateDirectory, sourceFile, planFile,
  sellerPort = 0, operationsPort = 0, maxInFlight = 64, drainGraceMs = 60000,
  nativeFactory = null, releaseRuntime, env = process.env } = {}) {
  if (typeof stateDirectory !== 'string' || !isAbsolute(stateDirectory) || stateDirectory.length > 4096)
    throw new TypeError('WORKSPACE_ABSOLUTE_STATE_DIRECTORY_REQUIRED');
  if (Boolean(sourceFile) !== Boolean(planFile)) throw new TypeError('WORKSPACE_SOURCE_AND_PLAN_REQUIRED_TOGETHER');
  for (const port of [sellerPort, operationsPort])
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('WORKSPACE_PORT_INVALID');
  let retainedRuntime = releaseRuntime === undefined ? (nativeFactory ? null : { port: sellerPort }) : structuredClone(releaseRuntime);
  if (retainedRuntime !== null) {
    fields(retainedRuntime, ['port', 'facilitator', 'allowLocalFacilitator'], 'WORKSPACE_RELEASE_RUNTIME_INVALID');
    retainedRuntime.port ??= sellerPort;
    if (!Number.isInteger(retainedRuntime.port) || retainedRuntime.port < 0 || retainedRuntime.port > 65535 ||
        retainedRuntime.allowLocalFacilitator !== undefined && typeof retainedRuntime.allowLocalFacilitator !== 'boolean')
      throw new TypeError('WORKSPACE_RELEASE_RUNTIME_INVALID');
    if (retainedRuntime.facilitator !== undefined) {
      const endpoint = new URL(retainedRuntime.facilitator);
      const local = retainedRuntime.allowLocalFacilitator === true && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
      if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new TypeError('WORKSPACE_RELEASE_RUNTIME_INVALID');
      retainedRuntime.facilitator = endpoint.href.replace(/\/$/, '');
    }
    if (retainedRuntime.allowLocalFacilitator && !retainedRuntime.facilitator || Boolean(nativeFactory) !== Boolean(retainedRuntime.facilitator))
      throw new TypeError('WORKSPACE_RELEASE_RUNTIME_MODE_MISMATCH');
    if (!retainedRuntime.allowLocalFacilitator) delete retainedRuntime.allowLocalFacilitator;
  }
  const root = await privateDirectory(resolve(stateDirectory), true), lease = await acquireStateLease(root);
  const environment = { ...env };
  let current = null, active = null, pending = null, closing = false, closePromise, previousRun, navigationOrigin = null;
  let releaseConsole = null;
  const releaseRoot = join(root, 'merchant-releases');
  const paths = Object.fromEntries(['revisions', 'prepared', 'staging'].map(name => [name, join(root, name)]));
  const task = operation => {
    if (closing) return Promise.reject(Object.assign(new Error('WORKSPACE_CLOSING'), { status: 503 }));
    if (pending) return Promise.reject(Object.assign(new Error('WORKSPACE_BUSY'), { status: 409 }));
    lease.assertHeld();
    pending = Promise.resolve().then(operation).finally(() => { pending = null; });
    return pending;
  };
  const currentRuntime = () => active ? {
    runId: active.runId, releaseId: active.releaseId, revision: active.revision,
    state: active.state, startedAt: active.startedAt,
    ...(active.session ? { mode: active.session.mode, url: active.session.url,
      docs: active.session.url + '/_seller/docs', openapi: active.session.url + '/_seller/openapi.json',
      health: active.session.url + '/_seller/health', ready: active.session.url + '/_seller/ready',
      operations: active.session.operations?.url, availability: active.session.operations?.availabilityUrl,
      availabilityControl: active.session.operations?.availabilityControlUrl } : {}),
  } : null;
  const revisionDirectory = id => join(paths.revisions, checkId(id, REVISION));
  async function originalStore(create = false) {
    try { await privateDirectory(releaseRoot); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return null;
      await initReleaseStore(releaseRoot);
    }
    await readReleaseState(releaseRoot);
    return releaseRoot;
  }
  async function releaseInventory() {
    const store = await originalStore();
    return { directory: releaseRoot, runtime: retainedRuntime, configured: retainedRuntime !== null,
      status: store ? await releaseStatus(store) : null,
      console: releaseConsole ? { url: releaseConsole.operatorUrl } : null };
  }
  async function closeReleaseConsole() {
    const owned = releaseConsole;
    if (owned) { await owned.close(); if (releaseConsole === owned) releaseConsole = null; }
    return releaseInventory();
  }
  async function revisionMeta(id) {
    const directory = await privateDirectory(revisionDirectory(id));
    const meta = await optionalJSON(directory, 'revision.json', 8192);
    if (!meta || meta.schema !== 'stellar-forge.clickhouse-workspace-revision.v1' || meta.id !== id ||
        !REVISION.test(meta.sourceSha256 ?? '') || !REVISION.test(meta.planSha256 ?? '') ||
        typeof meta.label !== 'string' || typeof meta.createdAt !== 'string')
      fail('WORKSPACE_REVISION_INVALID');
    return { directory, meta };
  }
  async function readRevision(id) {
    const value = await revisionMeta(id);
    const sourceBytes = await boundedFile(value.directory, 'source.json', 262144);
    const planBytes = await boundedFile(value.directory, 'merchant-plan.json', 262144);
    if (sha256(sourceBytes) !== value.meta.sourceSha256 || sha256(planBytes) !== value.meta.planSha256)
      fail('WORKSPACE_REVISION_CHANGED');
    const { config: source } = await readClickHouseSourceFile(join(value.directory, 'source.json'));
    const plan = await readJSONFile(join(value.directory, 'merchant-plan.json'));
    if (sha256(canonical({ source, plan })) !== id) fail('WORKSPACE_REVISION_CHANGED');
    return { ...value, source, plan, bundle: compileClickHouseMerchantPlan(source.queries, plan) };
  }
  async function readReview(revision, id) {
    const directory = revisionDirectory(revision);
    const bytes = await boundedFile(directory, 'review-' + checkId(id, UUID) + '.json', 16777216);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value.schema !== 'stellar-forge.clickhouse-workspace-review.v1' || value.revision !== revision ||
        value.id !== id || value.inspection?.schema !== 'stellar-forge.clickhouse-inspection.v1')
      fail('WORKSPACE_REVIEW_INVALID');
    return { value, bytes };
  }
  async function openRevision(id) {
    const value = await readRevision(id);
    const pointer = await optionalJSON(value.directory, 'latest-review.json', 8192);
    const review = pointer ? (await readReview(id, pointer.id)).value : null;
    return { ...value.meta, source: value.source, plan: value.plan, routes: routesOf(value.bundle), review };
  }
  async function selectCurrent(id, expected) {
    if (expected !== current) fail('WORKSPACE_REVISION_CONFLICT');
    await readRevision(id);
    await atomicJson(join(root, 'current.json'), { schema: 'stellar-forge.clickhouse-workspace-current.v1', revision: id });
    current = id;
  }
  async function saveRevision(input) {
    fields(input, ['baseRevision', 'source', 'plan', 'label'], 'WORKSPACE_SAVE_FIELDS_INVALID');
    if (input.baseRevision !== current) fail('WORKSPACE_REVISION_CONFLICT');
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label || label.length > 160 || /[\x00-\x1f\x7f]/.test(label)) throw new TypeError('WORKSPACE_REVISION_LABEL_REQUIRED');
    const sourceBytes = jsonBytes(input.source), planBytes = jsonBytes(input.plan);
    const id = sha256(canonical({ source: input.source, plan: input.plan }));
    const stage = join(paths.staging, 'draft-' + randomUUID());
    await mkdir(stage, { mode: 0o700 });
    try {
      await atomicFile(join(stage, 'source.json'), sourceBytes, 0o600, { exclusive: true });
      await atomicFile(join(stage, 'merchant-plan.json'), planBytes, 0o600, { exclusive: true });
      const { config: source } = await readClickHouseSourceFile(join(stage, 'source.json'));
      const bundle = compileClickHouseMerchantPlan(source.queries, input.plan);
      const existing = await optionalJSON(paths.revisions, id + '/revision.json', 8192);
      if (existing) await readRevision(id);
      else {
        const meta = { schema: 'stellar-forge.clickhouse-workspace-revision.v1', id, label,
          parent: current, createdAt: time(), sourceSha256: sha256(sourceBytes), planSha256: sha256(planBytes),
          queryCount: Object.keys(source.queries).length, routeCount: bundle.service.routes.length };
        await atomicJson(join(stage, 'revision.json'), meta, { exclusive: true });
        await rename(stage, revisionDirectory(id)); await directorySync(paths.revisions); await directorySync(paths.staging);
      }
      await selectCurrent(id, input.baseRevision);
      return { currentRevision: current, revision: await openRevision(id), reused: Boolean(existing) };
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async function releaseMeta(id) {
    const directory = await privateDirectory(join(paths.prepared, checkId(id, RELEASE)));
    const meta = await optionalJSON(directory, 'release.json', 16384);
    if (!meta || meta.schema !== 'stellar-forge.clickhouse-workspace-release.v1' || meta.id !== id ||
        id !== meta.revision + '-' + meta.reviewId || !REVISION.test(meta.reviewSha256 ?? '') ||
        !Array.isArray(meta.files) || meta.files.length !== Object.keys(CAPS).length ||
        meta.files.some((file, index) => file.path !== Object.keys(CAPS).sort()[index] ||
          !REVISION.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > CAPS[file.path]))
      fail('WORKSPACE_PREPARED_RECORD_INVALID');
    return { directory, merchant: join(directory, 'merchant'), meta };
  }
  async function readRelease(id) {
    const value = await releaseMeta(id); await privateDirectory(value.merchant); await assertPrepared(value.merchant);
    let total = 0;
    for (const file of value.meta.files) {
      const bytes = await boundedFile(value.merchant, file.path, CAPS[file.path]);
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail('WORKSPACE_PREPARED_FILES_CHANGED');
      if ((total += bytes.length) > 33554432) fail('WORKSPACE_PREPARED_FILES_TOO_LARGE');
    }
    const revision = await readRevision(value.meta.revision);
    const review = await readReview(value.meta.revision, value.meta.reviewId);
    if (sha256(review.bytes) !== value.meta.reviewSha256) fail('WORKSPACE_PREPARED_REVIEW_CHANGED');
    for (const [name, expected] of Object.entries({ 'source.json': { ...revision.source, bindings: revision.bundle.bindings },
      'merchant-plan.json': revision.plan, 'bindings.json': revision.bundle.bindings, 'service.json': revision.bundle.service })) {
      if (canonical(await readJSONFile(join(value.merchant, name), CAPS[name])) !== canonical(expected))
        fail('WORKSPACE_PREPARED_INPUT_CHANGED');
    }
    return { ...value, revision, review: review.value };
  }
  const releaseView = value => ({ ...value.meta, directory: value.merchant,
    routes: routesOf(value.revision.bundle), review: value.review,
    command: ['node', fileURLToPath(new URL('../start.mjs', import.meta.url)), '--directory', value.merchant] });
  async function stopActive(runId) {
    if (!active) {
      if (previousRun?.runId === runId && previousRun.state === 'STOPPED') return { runtime: null, previousRun };
      fail('WORKSPACE_RUN_NOT_CURRENT');
    }
    if (active.runId !== runId) fail('WORKSPACE_RUN_NOT_CURRENT');
    const owned = active; owned.state = 'STOPPING';
    await owned.session.close();
    previousRun = { runId: owned.runId, releaseId: owned.releaseId, revision: owned.revision,
      startedAt: owned.startedAt, stoppedAt: time(), state: 'STOPPED' };
    active = null; await atomicJson(join(root, 'last-run.json'), previousRun);
    return { runtime: null, previousRun };
  }
  const model = {
    stateDirectory: root,
    bindOperationsNavigationOrigin(origin) {
      lease.assertHeld();
      if (closing || pending || active || releaseConsole) fail('WORKSPACE_NAVIGATION_BINDING_BUSY');
      if (typeof origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin) ||
          Number(new URL(origin).port) > 65535) throw new TypeError('WORKSPACE_LOOPBACK_ORIGIN_REQUIRED');
      if (navigationOrigin !== null && navigationOrigin !== origin) fail('WORKSPACE_ORIGIN_ALREADY_BOUND');
      navigationOrigin = origin;
    },
    async state() {
      lease.assertHeld();
      const revisions = [], prepared = [], unfinished = [];
      for (const entry of await readdir(paths.revisions, { withFileTypes: true }))
        if (REVISION.test(entry.name)) revisions.push((await revisionMeta(entry.name)).meta);
      for (const entry of await readdir(paths.prepared, { withFileTypes: true }))
        if (RELEASE.test(entry.name)) {
          try { prepared.push((await releaseMeta(entry.name)).meta); }
          catch { prepared.push({ id: entry.name, error: 'WORKSPACE_PREPARED_RECORD_INVALID' }); }
        }
      for (const entry of await readdir(paths.staging, { withFileTypes: true }))
        if (entry.name.endsWith('.json') && RELEASE.test(entry.name.slice(0, -5))) unfinished.push(entry.name.slice(0, -5));
      revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      prepared.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      return { schema: 'stellar-forge.clickhouse-workspace.v1', stateDirectory: root, currentRevision: current,
        revisions, prepared, unfinished, runtime: currentRuntime(), previousRun,
        releases: await releaseInventory(),
        busy: Boolean(pending), configuredMode: nativeFactory ? 'NATIVE_FACILITATOR' : 'CHALLENGE_ONLY' };
    },
    runtime() { return { runtime: currentRuntime(), busy: Boolean(pending), previousRun }; },
    open(input) { return task(() => {
      fields(input, ['revision'], 'WORKSPACE_OPEN_FIELDS_INVALID'); return openRevision(input.revision);
    }); },
    save(input) { return task(() => saveRevision(input)); },
    checkout(input) { return task(async () => {
      fields(input, ['revision', 'baseRevision'], 'WORKSPACE_CHECKOUT_FIELDS_INVALID');
      await selectCurrent(input.revision, input.baseRevision);
      return { currentRevision: current, revision: await openRevision(current) };
    }); },
    review(input) { return task(async () => {
      fields(input, ['revision'], 'WORKSPACE_REVIEW_FIELDS_INVALID');
      const revision = await readRevision(input.revision);
      const { source } = await openClickHouseSourceFile(join(revision.directory, 'source.json'), { env: environment });
      let inspection; try { inspection = source.inspect(); } finally { await source.close(); }
      const review = { schema: 'stellar-forge.clickhouse-workspace-review.v1', id: randomUUID(),
        revision: input.revision, checkedAt: time(), inspection };
      await atomicFile(join(revision.directory, 'review-' + review.id + '.json'), jsonBytes(review, 16777216), 0o600, { exclusive: true });
      await atomicJson(join(revision.directory, 'latest-review.json'), { id: review.id });
      return { review, routes: routesOf(revision.bundle) };
    }); },
    preview(input) { return task(async () => {
      fields(input, ['revision', 'reviewId', 'query', 'parameters'], 'WORKSPACE_PREVIEW_FIELDS_INVALID');
      const revision = await readRevision(input.revision), review = await readReview(input.revision, input.reviewId);
      const { source } = await openClickHouseSourceFile(join(revision.directory, 'source.json'), { env: environment });
      try {
        if (canonical(source.inspect().columnTypes) !== canonical(review.value.inspection.columnTypes))
          fail('WORKSPACE_SCHEMA_CHANGED_REVIEW_AGAIN');
        return await source.query(input.query, input.parameters);
      } finally { await source.close(); }
    }); },
    prepare(input) { return task(async () => {
      fields(input, ['revision', 'reviewId', 'acknowledged'], 'WORKSPACE_PREPARE_FIELDS_INVALID');
      if (input.acknowledged !== true) fail('WORKSPACE_REVIEW_ACKNOWLEDGMENT_REQUIRED', 422);
      const revision = await readRevision(input.revision), review = await readReview(input.revision, input.reviewId);
      const id = input.revision + '-' + input.reviewId, target = join(paths.prepared, id);
      const intent = { schema: 'stellar-forge.clickhouse-workspace-preparation.v1', id,
        revision: input.revision, reviewId: input.reviewId, reviewSha256: sha256(review.bytes) };
      const old = await optionalJSON(paths.staging, id + '.json', 8192);
      if (old && canonical(old) !== canonical(intent)) fail('WORKSPACE_PREPARATION_INTENT_CHANGED');
      if (await optionalJSON(paths.prepared, id + '/release.json', 16384)) {
        const retained = await readRelease(id);
        if (old) { await unlink(join(paths.staging, id + '.json')); await directorySync(paths.staging); }
        return releaseView(retained);
      }
      if (!old) await atomicJson(join(paths.staging, id + '.json'), intent, { exclusive: true });
      const stage = join(paths.staging, id);
      try { await privateDirectory(stage); await rm(stage, { recursive: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(stage, { mode: 0o700 });
      const result = await prepareClickHouseSeller({ sourceFile: join(revision.directory, 'source.json'),
        planFile: join(revision.directory, 'merchant-plan.json'), directory: join(stage, 'merchant') });
      const files = []; let total = 0;
      for (const path of Object.keys(CAPS).sort()) {
        const bytes = await boundedFile(result.directory, path, CAPS[path]);
        if ((total += bytes.length) > 33554432) fail('WORKSPACE_PREPARED_FILES_TOO_LARGE');
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      }
      const meta = { schema: 'stellar-forge.clickhouse-workspace-release.v1', id, revision: input.revision,
        reviewId: input.reviewId, reviewSha256: intent.reviewSha256, label: revision.meta.label,
        createdAt: time(), routeCount: result.routes.length, files };
      await atomicJson(join(stage, 'release.json'), meta, { exclusive: true });
      await rename(stage, target); await directorySync(paths.prepared); await directorySync(paths.staging);
      await unlink(join(paths.staging, id + '.json')); await directorySync(paths.staging);
      return releaseView(await readRelease(id));
    }); },
    release(input) { return task(async () => {
      fields(input, ['releaseId'], 'WORKSPACE_RELEASE_FIELDS_INVALID');
      return releaseView(await readRelease(input.releaseId));
    }); },
    run(input) { return task(async () => {
      fields(input, ['releaseId', 'acknowledged'], 'WORKSPACE_RUN_FIELDS_INVALID');
      if (input.acknowledged !== true) fail('WORKSPACE_START_ACKNOWLEDGMENT_REQUIRED', 422);
      if (releaseConsole) fail('WORKSPACE_CLOSE_RELEASE_CONSOLE_FIRST');
      const store = await originalStore();
      if (store && (await releaseStatus(store)).runtime.state !== 'STOPPED') fail('WORKSPACE_RELEASE_MANAGER_RUNNING');
      if (active) {
        if (active.releaseId === input.releaseId && active.state === 'RUNNING') return { runtime: currentRuntime() };
        fail('WORKSPACE_STOP_CURRENT_MERCHANT_FIRST');
      }
      const value = await readRelease(input.releaseId);
      active = { runId: randomUUID(), releaseId: input.releaseId, revision: value.meta.revision, state: 'STARTING', startedAt: time() };
      let source;
      try {
        const opened = await openClickHouseSourceFile(join(value.merchant, 'source.json'), { env: environment }); source = opened.source;
        if (canonical(source.inspect().columnTypes) !== canonical(value.review.inspection.columnTypes))
          fail('WORKSPACE_SCHEMA_CHANGED_REVIEW_AGAIN');
        const availabilityDirectory = await privateDirectory(join(value.directory, 'availability'), true);
        active.session = await startClickHouseMerchant({ source,
          config: await readSellerConfig(join(value.merchant, 'service.json')), bindings: opened.config.bindings,
          port: sellerPort, operationsPort, nativeFactory, maxInFlight, drainGraceMs, availabilityDirectory, navigationOrigin });
        active.state = 'RUNNING';
        previousRun = { ...currentRuntime() }; await atomicJson(join(root, 'last-run.json'), previousRun);
        return { runtime: currentRuntime() };
      } catch (error) {
        if (active?.session) await active.session.close().catch(() => {});
        else await source?.close();
        active = null; throw error;
      }
    }); },
    stop(input) { return task(() => {
      fields(input, ['runId'], 'WORKSPACE_STOP_FIELDS_INVALID'); checkId(input.runId, UUID); return stopActive(input.runId);
    }); },
    stageMerchantRelease(input) { return task(async () => {
      fields(input, ['preparedId', 'id', 'label'], 'WORKSPACE_STAGE_RELEASE_FIELDS_INVALID');
      if (!retainedRuntime) fail('WORKSPACE_RELEASE_FACILITATOR_REQUIRED', 422);
      const id = checkId(input.id, /^[a-z0-9][a-z0-9_-]{0,63}$/);
      const value = await readRelease(input.preparedId), columnTypes = value.review.inspection.columnTypes;
      const prepared = await prepareClickHouseRelease(value.merchant, { columnTypes });
      const label = input.label ?? value.meta.label;
      if (typeof label !== 'string' || !label.trim() || label.length > 240 || /[\x00-\x1f\x7f]/.test(label))
        fail('WORKSPACE_RELEASE_LABEL_INVALID', 422);
      const store = await originalStore(true);
      let existing;
      try { existing = await inspectRelease(store, id); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) {
        if (existing.source.packageSha256 !== prepared.clickhouse.packageSha256 ||
            existing.source.executionSha256 !== prepared.clickhouse.executionSha256 ||
            canonical(existing.runtime) !== canonical(retainedRuntime) || existing.label !== label.trim())
          fail('WORKSPACE_RELEASE_ID_ALREADY_USED');
        return { release: existing, reused: true, releases: await releaseInventory() };
      }
      const staged = await stageRelease(store, { id, label: label.trim(), clickhousePackage: value.merchant,
        clickhouseColumnTypes: columnTypes, runtime: retainedRuntime });
      return { release: staged, reused: false, releases: await releaseInventory() };
    }); },
    openReleaseConsole(input) { return task(async () => {
      fields(input, [], 'WORKSPACE_RELEASE_CONSOLE_FIELDS_INVALID');
      if (active) fail('WORKSPACE_STOP_CURRENT_MERCHANT_FIRST');
      const store = await originalStore(true);
      if (!releaseConsole) {
        const owned = await startReleaseConsole(store, { port: 0, env: environment }); releaseConsole = owned;
        owned.closed.then(() => { if (releaseConsole === owned) releaseConsole = null; }, () => {});
      }
      return releaseInventory();
    }); },
    closeReleaseConsole(input) { return task(() => {
      fields(input, [], 'WORKSPACE_RELEASE_CONSOLE_FIELDS_INVALID'); return closeReleaseConsole();
    }); },
    exportFleetSource(input) { return task(async () => {
      fields(input, ['releaseId', 'merchantReleaseId'], 'WORKSPACE_FLEET_SOURCE_FIELDS_INVALID');
      if (Boolean(input.releaseId) === Boolean(input.merchantReleaseId)) throw new TypeError('WORKSPACE_EXPORT_RELEASE_REQUIRED');
      let merchant, columnTypes, runtime, name;
      if (input.merchantReleaseId) {
        const id = checkId(input.merchantReleaseId, /^[a-z0-9][a-z0-9_-]{0,63}$/);
        await originalStore();
        const release = await inspectRelease(releaseRoot, id);
        const snapshot = await inspectClickHouseRelease(join(releaseRoot, 'releases', id));
        merchant = snapshot.packageDirectory; columnTypes = snapshot.clickhouse.columnTypes;
        runtime = release.runtime; name = id;
      } else {
        const value = await readRelease(input.releaseId);
        const prepared = await prepareClickHouseRelease(value.merchant, { columnTypes: value.review.inspection.columnTypes });
        merchant = prepared.directory; columnTypes = prepared.clickhouse.columnTypes;
        runtime = retainedRuntime; name = value.meta.revision.slice(0, 12);
      }
      const selectedRuntime = {};
      for (const key of ['facilitator', 'allowLocalFacilitator'])
        if (runtime?.[key] !== undefined) selectedRuntime[key] = runtime[key];
      const definition = { clickhousePackage: merchant,
        ...(columnTypes === undefined ? {} : { clickhouseColumnTypes: columnTypes }), runtime: selectedRuntime };
      const bytes = Buffer.from(JSON.stringify(definition, null, 2) + '\n');
      return { bytes, sha256: sha256(bytes), contentType: 'application/json', filename: 'clickhouse-' + name + '-fleet-source.json' };
    }); },
    exportClient(input) { return task(async () => {
      fields(input, ['releaseId', 'merchantReleaseId', 'kind'], 'WORKSPACE_EXPORT_FIELDS_INVALID');
      if (!['client', 'openapi'].includes(input.kind)) throw new TypeError('WORKSPACE_EXPORT_KIND_INVALID');
      if (Boolean(input.releaseId) === Boolean(input.merchantReleaseId)) throw new TypeError('WORKSPACE_EXPORT_RELEASE_REQUIRED');
      let merchant, name;
      if (input.merchantReleaseId) {
        const id = checkId(input.merchantReleaseId, /^[a-z0-9][a-z0-9_-]{0,63}$/);
        await originalStore(); await inspectRelease(releaseRoot, id);
        merchant = (await inspectClickHouseRelease(join(releaseRoot, 'releases', id))).packageDirectory;
        name = id;
      } else {
        const value = await readRelease(input.releaseId); merchant = value.merchant; name = value.meta.revision.slice(0, 12);
      }
      const bytes = input.kind === 'client' ? await customerArchive(merchant)
        : await boundedFile(merchant, 'openapi.json', CAPS['openapi.json']);
      return { bytes, sha256: sha256(bytes), contentType: input.kind === 'client' ? 'application/gzip' : 'application/json',
        filename: 'clickhouse-' + name + (input.kind === 'client' ? '-customer.tar.gz' : '-openapi.json') };
    }); },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        try {
          await pending?.catch(() => {});
          try { await closeReleaseConsole(); } finally { if (active) await stopActive(active.runId); }
        }
        finally { await lease.close(); }
      })();
      return closePromise;
    },
  };
  try {
    for (const directory of Object.values(paths)) await privateDirectory(directory, true);
    const pointer = await optionalJSON(root, 'current.json', 8192);
    if (pointer) {
      if (pointer.schema !== 'stellar-forge.clickhouse-workspace-current.v1') fail('WORKSPACE_CURRENT_RECORD_INVALID');
      current = checkId(pointer.revision, REVISION); await readRevision(current);
    }
    previousRun = await optionalJSON(root, 'last-run.json', 16384);
    if (sourceFile) {
      const source = (await readClickHouseSourceFile(sourceFile)).config, plan = await readJSONFile(planFile);
      const supplied = sha256(canonical({ source, plan }));
      if (current && supplied !== current) fail('WORKSPACE_ALREADY_HAS_SAVED_WORK_IMPORT_IN_BROWSER');
      if (!current) await saveRevision({ baseRevision: null, source, plan, label: 'Imported merchant' });
    }
    return model;
  } catch (error) { await lease.close(); throw error; }
}
