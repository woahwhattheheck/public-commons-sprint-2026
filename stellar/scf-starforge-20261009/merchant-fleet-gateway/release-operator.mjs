// MIT. Compose original SF82 release sessions and the original durable fleet.
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { activateRelease, compareReleases, inspectRelease, listReleases,
  readReleaseState, runActiveRelease, stageRelease } from '../sf82-seller-pilot/releases.mjs';
import { selectDuckdbInterpreter } from '../sf82-seller-pilot/release-duckdb.mjs';
import { sqliteSnapshotOptions } from '../sf82-seller-pilot/release-sqlite.mjs';
import { startMerchantFleet, loadMerchantFleet } from './gateway.mjs';
import { fleetControl } from './control.mjs';
import { acquireStateLease } from './state-lease.mjs';
import { openRolloutState } from './rollout-state.mjs';
import { describeFleetOperations, readFleetOperations, validateFleetNavigationOrigin } from './release-operations.mjs';
import { createFleetClientDesk } from './release-clients.mjs';

const SCHEMA = 'stellar-forge.fleet-release-plan.v1';
const JOURNAL = 'stellar-forge.fleet-release-links.v1';
const MAX = 1024 * 1024;
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^[a-f0-9]{64}$/;
const PACKAGE_KINDS = Object.freeze({ workspace: 'OPENAPI_WORKSPACE', python: 'PYTHON_APPLICATION',
  duckdbPackage: 'DUCKDB_PACKAGE', s3Package: 'S3_OBJECT_PACKAGE', jsonrpcPackage: 'JSONRPC_MERCHANT_PACKAGE',
  sqlitePackage: 'SQLITE_MERCHANT_PACKAGE', mysqlPackage: 'MYSQL_MERCHANT_PACKAGE',
  postgresPackage: 'POSTGRES_MERCHANT_PACKAGE', clickhousePackage: 'CLICKHOUSE_MERCHANT_PACKAGE' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, status = 409) => Object.assign(new Error(code), { status });
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail('FLEET_RELEASE_INPUT_INVALID', 400);
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('FLEET_RELEASE_NUMBER_INVALID', 400);
  return value;
}
function pathValue(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f]/.test(value))
    throw fail('FLEET_RELEASE_PATH_INVALID', 400);
  return resolve(base, value);
}
/** Share original source selectors and path rules with retained fleet setup. */
export function normalizeFleetPackageSource(source, base) {
  keys(source, [...Object.keys(PACKAGE_KINDS), 'pythonRoot', 'duckdbPython',
    'sqliteSnapshotMaxBytes', 'sqliteSnapshotTimeoutMs', 'postgresInputManifestSha256', 'clickhouseColumnTypes', 'runtime']);
  const selected = Object.keys(PACKAGE_KINDS).filter(key => source[key] !== undefined);
  if (selected.length !== 1 || source.pythonRoot !== undefined && selected[0] !== 'python' ||
      source.duckdbPython !== undefined && selected[0] !== 'duckdbPackage' ||
      selected[0] !== 'sqlitePackage' && (source.sqliteSnapshotMaxBytes !== undefined || source.sqliteSnapshotTimeoutMs !== undefined) ||
      source.postgresInputManifestSha256 !== undefined && selected[0] !== 'postgresPackage' ||
      source.clickhouseColumnTypes !== undefined && selected[0] !== 'clickhousePackage')
    throw fail('FLEET_RELEASE_PACKAGE_SOURCE_REQUIRED', 400);
  const runtime = source.runtime ?? {};
  keys(runtime, ['facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream']);
  if (!['workspace', 'jsonrpcPackage'].includes(selected[0]) && runtime.allowLoopbackUpstream)
    throw fail('FLEET_RELEASE_PACKAGE_BINDINGS_OWNED', 400);
  const value = { [selected[0]]: pathValue(source[selected[0]], base) };
  if (source.pythonRoot !== undefined) value.pythonRoot = pathValue(source.pythonRoot, base);
  if (source.duckdbPython !== undefined) value.duckdbPython = selectDuckdbInterpreter(source.duckdbPython, base);
  if (source.postgresInputManifestSha256 !== undefined) {
    if (typeof source.postgresInputManifestSha256 !== 'string' || !HEX.test(source.postgresInputManifestSha256))
      throw fail('FLEET_RELEASE_POSTGRES_REVIEW_INVALID', 400);
    value.postgresInputManifestSha256 = source.postgresInputManifestSha256;
  }
  if (source.clickhouseColumnTypes !== undefined) {
    if (!object(source.clickhouseColumnTypes)) throw fail('FLEET_RELEASE_CLICKHOUSE_REVIEW_INVALID', 400);
    // The original ClickHouse stage validates this review against every named
    // query. Preserve its exact ordered map in the host-selected source.
    value.clickhouseColumnTypes = structuredClone(source.clickhouseColumnTypes);
  }
  if (selected[0] === 'sqlitePackage') {
    const limits = sqliteSnapshotOptions({ maxBytes: source.sqliteSnapshotMaxBytes, timeoutMs: source.sqliteSnapshotTimeoutMs });
    value.sqliteSnapshotMaxBytes = limits.maxBytes; value.sqliteSnapshotTimeoutMs = limits.timeoutMs;
  }
  return { ...value, runtime: structuredClone(runtime) };
}
/** Public aliases retain source type while all configured paths stay with the host. */
export function describeFleetPackages(packages) {
  return Object.entries(packages).map(([name, source]) => ({ name,
    kind: Object.entries(PACKAGE_KINDS).find(([key]) => source[key] !== undefined)?.[1] ?? 'OPENAPI_WORKSPACE' }));
}
function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw fail('FLEET_RELEASE_PRIVATE_DIRECTORY_REQUIRED');
}
function readJson(path, { optional = false, privateFile = true } = {}) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX || (privateFile && (info.mode & 0o077)))
      throw fail('FLEET_RELEASE_FILE_INVALID');
    const bytes = readFileSync(fd);
    if (bytes.length > MAX) throw fail('FLEET_RELEASE_FILE_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function saveJson(path, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > MAX) throw fail('FLEET_RELEASE_LINKS_TOO_LARGE');
  const temporary = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Read only operator-declared paths. Browser/API actions use these aliases. */
export async function readFleetReleasePlan(planFile) {
  const path = resolve(planFile), base = dirname(path), input = readJson(path, { privateFile: false });
  keys(input, ['schema', 'gateway', 'tenants']);
  if (input.schema !== SCHEMA || !Array.isArray(input.tenants) || input.tenants.length < 2 || input.tenants.length > 32)
    throw fail('FLEET_RELEASE_PLAN_REQUIRED', 400);
  const gateway = input.gateway ?? {};
  keys(gateway, ['port', 'adminPort']);
  const ports = new Set(), stores = new Set(), ids = new Set(), hosts = new Set();
  const publicPort = integer(gateway.port ?? 8400, 1, 65535), adminPort = integer(gateway.adminPort ?? 8401, 1, 65535);
  if (publicPort === adminPort) throw fail('FLEET_RELEASE_PORT_COLLISION', 400);
  ports.add(publicPort); ports.add(adminPort);
  const tenants = [];
  for (const raw of input.tenants) {
    keys(raw, ['id', 'host', 'startupSlot', 'slots', 'packages', 'limits']);
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(raw.id ?? '') || ids.has(raw.id) ||
        typeof raw.host !== 'string' || raw.host.length > 253 || hosts.has(raw.host) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw.host))
      throw fail('FLEET_RELEASE_TENANT_INVALID', 400);
    if (!object(raw.slots) || Object.keys(raw.slots).length < 2 || Object.keys(raw.slots).length > 4 ||
        !Object.hasOwn(raw.slots, raw.startupSlot)) throw fail('FLEET_RELEASE_SLOTS_REQUIRED', 400);
    const slots = Object.create(null);
    for (const [name, slot] of Object.entries(raw.slots)) {
      if (!NAME.test(name)) throw fail('FLEET_RELEASE_SLOT_INVALID', 400);
      keys(slot, ['store', 'port']);
      const store = await realpath(pathValue(slot.store, base)), port = integer(slot.port, 1, 65535);
      if (ports.has(port) || stores.has(store)) throw fail('FLEET_RELEASE_STORE_OR_PORT_REUSED', 400);
      await readReleaseState(store);
      ports.add(port); stores.add(store); slots[name] = { store, port };
    }
    const packages = Object.create(null);
    if (raw.packages !== undefined && (!object(raw.packages) || Object.keys(raw.packages).length > 32))
      throw fail('FLEET_RELEASE_PACKAGES_INVALID', 400);
    for (const [name, source] of Object.entries(raw.packages ?? {})) {
      if (!NAME.test(name)) throw fail('FLEET_RELEASE_PACKAGE_INVALID', 400);
      packages[name] = normalizeFleetPackageSource(source, base);
    }
    const limits = raw.limits ?? {};
    keys(limits, ['maxInFlight', 'maxRequestBytes', 'maxResponseBytes', 'timeoutMs']);
    const normalizedLimits = {
      maxInFlight: integer(limits.maxInFlight ?? 12, 1, 512),
      maxRequestBytes: integer(limits.maxRequestBytes ?? 1024 * 1024, 1024, 4 * 1024 * 1024),
      maxResponseBytes: integer(limits.maxResponseBytes ?? 8 * 1024 * 1024, 1024, 16 * 1024 * 1024),
      timeoutMs: integer(limits.timeoutMs ?? 15000, 1000, 60000),
    };
    ids.add(raw.id); hosts.add(raw.host);
    tenants.push({ id: raw.id, host: raw.host, startupSlot: raw.startupSlot, slots, packages, limits: normalizedLimits });
  }
  const plan = { schema: SCHEMA, gateway: { port: publicPort, adminPort }, tenants };
  return { ...plan, digest: hash(plan) };
}

const slotKey = (tenant, slot) => tenant + '/' + slot;
function shortRelease(release) {
  return { id: release.id, label: release.label, digest: release.digest,
    publicOrigin: release.publicOrigin, mode: release.mode, port: release.runtime.port,
    routes: release.routes.length, sourceKind: release.source.kind ?? 'OPENAPI_SELLER', source: structuredClone(release.source) };
}
function reviewedRelease(release) {
  if (!release) return null;
  return { ...shortRelease(release), routes: structuredClone(release.routes),
    runtime: { ...release.runtime, handlers: release.handlerEntry ? '[registered original handler]' : undefined },
    handlerEntry: release.handlerEntry ? { sha256: release.handlerEntry.sha256, bytes: release.handlerEntry.bytes } : null,
    inputPackage: release.inputPackage ? { ...release.inputPackage, directory: undefined } : undefined };
}
function privateView(value) {
  if (Array.isArray(value)) return value.map(privateView);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'stateDir' || key === 'directory' ? (item ? '[private original state directory]' : item) :
      key === 'interpreter' && typeof item === 'string' ? { configured: Boolean(item), selectionSha256: hash(item) } : privateView(item)]));
}
function publicComparison(comparison) {
  return privateView({ ...comparison, before: reviewedRelease(comparison.before), after: reviewedRelease(comparison.after),
    runtimeChanges: comparison.runtimeChanges.map(row => row.field === 'handlers' ?
      { ...row, before: row.before ? '[registered original handler]' : null,
        after: row.after ? '[registered original handler]' : null } : row) });
}
function sameDescriptor(left, right) {
  return left?.tenant === right?.tenant && left.slot === right.slot && left.releaseId === right.releaseId &&
    left.releaseDigest === right.releaseDigest && left.port === right.port;
}
function portUse(native, port) {
  return { current: native.merchants.some(row => row.upstreamPort === port),
    candidate: native.candidate?.merchants.some(row => row.upstreamPort === port) ?? false,
    active: native.retired.flatMap(row => row.merchants).filter(row => row.upstreamPort === port)
      .reduce((total, row) => total + row.active, 0) };
}

/** Same-process lifecycle object. Native modules retain their source and process ownership. */
export async function openFleetReleaseOperator({ planFile, directory, gatewayStateDirectory, expectedPlanDigest,
  operationsNavigationOrigin } = {}) {
  validateFleetNavigationOrigin(operationsNavigationOrigin);
  const plan = await readFleetReleasePlan(planFile);
  if (expectedPlanDigest !== undefined && (typeof expectedPlanDigest !== 'string' ||
      !HEX.test(expectedPlanDigest) || plan.digest !== expectedPlanDigest))
    throw fail('FLEET_RELEASE_PLAN_CHANGED');
  if (typeof directory !== 'string' || !directory.trim()) throw fail('FLEET_RELEASE_DIRECTORY_REQUIRED', 400);
  directory = resolve(directory); privateDirectory(directory);
  const stateDirectory = gatewayStateDirectory ? resolve(gatewayStateDirectory) : join(directory, 'gateway');
  if (directory === stateDirectory) throw fail('FLEET_RELEASE_SEPARATE_STATE_REQUIRED', 400);
  const lease = await acquireStateLease(directory), journalPath = join(directory, 'links.json');
  const manifestPath = join(directory, 'prepared-fleet.json');
  let journal, gateway, operation = null, stagingController, closing = false, closed = false, closingPromise, clientClosePromise;
  const owned = new Map(), reviews = new Map(), tenants = new Map(plan.tenants.map(row => [row.id, row]));
  function locate(tenantId, slotName) {
    const tenant = tenants.get(tenantId), slot = tenant?.slots[slotName];
    if (!slot) throw fail('FLEET_RELEASE_ALIAS_UNKNOWN', 404);
    return { tenant, slot, key: slotKey(tenantId, slotName) };
  }
  const persist = () => { lease.assertHeld(); saveJson(journalPath, journal); };
  const assertOpen = () => { lease.assertHeld(); if (closing || closed) throw fail('FLEET_RELEASE_CLOSING', 503); };
  async function exclusive(action, work) {
    assertOpen();
    if (operation) throw fail('FLEET_RELEASE_OPERATION_IN_PROGRESS');
    const marker = { action, promise: null }; operation = marker;
    marker.promise = Promise.resolve().then(work);
    try { return await marker.promise; } finally { if (operation === marker) operation = null; }
  }
  function validateMapping(mapping) {
    if (!Array.isArray(mapping) || mapping.length !== plan.tenants.length) throw fail('FLEET_RELEASE_LINKS_INVALID');
    const names = new Set();
    for (const row of mapping) {
      const { tenant, slot } = locate(row.tenant, row.slot);
      if (names.has(row.tenant) || !ID.test(row.releaseId ?? '') || !HEX.test(row.releaseDigest ?? '') ||
          row.port !== slot.port || row.host !== tenant.host) throw fail('FLEET_RELEASE_LINKS_INVALID');
      names.add(row.tenant);
    }
    return mapping;
  }
  function linked(native) {
    const record = journal.revisions.find(row => row.revision === native.revision && row.digest === native.digest);
    if (!record || record.snapshotId !== native.snapshotId) throw fail('FLEET_RELEASE_REVISION_NOT_LINKED');
    validateMapping(record.mapping);
    if (native.merchants.length !== record.mapping.length || native.merchants.some(row =>
      !record.mapping.some(item => item.tenant === row.id && item.host === row.host && item.port === row.upstreamPort)))
      throw fail('FLEET_RELEASE_RUNTIME_MAPPING_CHANGED');
    return record;
  }
  function recordRevision(native, mapping) {
    validateMapping(mapping);
    if (native.merchants.length !== mapping.length || native.merchants.some(row =>
      !mapping.some(item => item.tenant === row.id && item.host === row.host && item.port === row.upstreamPort)))
      throw fail('FLEET_RELEASE_RUNTIME_MAPPING_CHANGED');
    const saved = { revision: native.revision, digest: native.digest, snapshotId: native.snapshotId,
      mapping: structuredClone(mapping) };
    journal.revisions = [saved, ...journal.revisions.filter(row => row.revision !== saved.revision)];
    const retained = new Set([native.revision, ...native.history.map(row => row.revision),
      ...native.retired.filter(row => row.state === 'DRAINING').map(row => row.revision)]);
    journal.revisions = journal.revisions.filter(row => retained.has(row.revision));
    journal.pending = null; persist(); return saved;
  }
  function reconcile(native) {
    const pending = journal.pending;
    const historical = pending?.digest && native.history.find(row =>
      row.revision === pending.baseRevision + 1 && row.digest === pending.digest);
    if (historical && !journal.revisions.some(row => row.revision === historical.revision && row.digest === historical.digest)) {
      journal.revisions.unshift({ revision: historical.revision, digest: historical.digest,
        snapshotId: historical.snapshotId, mapping: structuredClone(pending.mapping) });
      journal.pending = null; persist();
    }
    if (pending?.digest && native.revision === pending.baseRevision + 1 && native.digest === pending.digest)
      recordRevision(native, pending.mapping);
    else if (!journal.revisions.some(row => row.revision === native.revision && row.digest === native.digest)) {
      // A different native control client may roll back to source already linked
      // here. Its exact immutable snapshot identity, not its port alone, binds it.
      const saved = journal.revisions.find(row => row.digest === native.digest && row.snapshotId === native.snapshotId);
      if (saved) recordRevision(native, saved.mapping);
    }
    return native;
  }
  async function nativeStatus() { return reconcile(await fleetControl(stateDirectory, 'status')); }
  async function descriptor(tenantId, slotName, releaseId) {
    const { tenant, slot } = locate(tenantId, slotName), release = await inspectRelease(slot.store, releaseId);
    if (release.publicOrigin !== 'https://' + tenant.host || release.runtime.port !== slot.port)
      throw fail('FLEET_RELEASE_ORIGIN_OR_PORT_MISMATCH');
    return { tenant: tenantId, host: tenant.host, slot: slotName, releaseId: release.id,
      releaseDigest: release.digest, port: slot.port };
  }
  async function verifyDescriptor(row) {
    const actual = await descriptor(row.tenant, row.slot, row.releaseId);
    if (!sameDescriptor(actual, row)) throw fail('FLEET_RELEASE_SOURCE_CHANGED');
    return locate(row.tenant, row.slot);
  }
  async function ensureStarted(row, expectedGeneration) {
    const { slot, key } = await verifyDescriptor(row), running = owned.get(key);
    let selected = await readReleaseState(slot.store);
    if (expectedGeneration !== undefined && selected.generation !== expectedGeneration)
      throw fail('FLEET_RELEASE_SELECTION_CHANGED');
    if (running && !running.ended && !sameDescriptor(running.descriptor, row)) throw fail('FLEET_RELEASE_SLOT_IN_USE');
    if (selected.active !== row.releaseId)
      selected = (await activateRelease(slot.store, row.releaseId, { expectedGeneration: selected.generation,
        reason: 'Run the reviewed original merchant fleet release' })).state;
    if (running && !running.ended) {
      running.selectionGeneration = selected.generation; return running;
    }
    const session = await runActiveRelease(slot.store, { expectedGeneration: selected.generation, handleSignals: false,
      ...(operationsNavigationOrigin ? { operationsNavigationOrigin } : {}) });
    const runtime = { descriptor: structuredClone(row), session, selectionGeneration: selected.generation, ended: false };
    owned.set(key, runtime);
    void session.completion.then(() => { runtime.ended = true; }, () => { runtime.ended = true; });
    if (session.release.digest !== row.releaseDigest || new URL(session.url).hostname !== '127.0.0.1' ||
        Number(new URL(session.url).port) !== row.port) {
      await session.close(); throw fail('FLEET_RELEASE_STARTED_IDENTITY_CHANGED');
    }
    return runtime;
  }
  function manifest(mapping) {
    return { schema: 'stellar-forge.merchant-fleet.v1', tenants: mapping.map(row => {
      const { tenant, slot } = locate(row.tenant, row.slot);
      return { id: row.tenant, host: tenant.host, upstreamPort: row.port,
        sellerConfig: join(slot.store, 'releases', row.releaseId, 'seller-service.json'), ...tenant.limits };
    }) };
  }
  async function verifyRetainedMapping(record, mapping) {
    // Use the ORIGINAL snapshot reader and original compiled fingerprints. This
    // covers the first gateway commit before a successful link-journal write.
    const store = await openRolloutState(stateDirectory);
    try {
      const current = store.read();
      if (current?.revision !== record.revision || current.digest !== record.digest || current.snapshotId !== record.snapshotId)
        throw fail('FLEET_RELEASE_REVISION_CHANGED');
      saveJson(manifestPath, manifest(mapping));
      const [retained, expected] = await Promise.all([
        loadMerchantFleet(store.manifest(record)), loadMerchantFleet(manifestPath),
      ]);
      const identities = fleet => fleet.tenants.map(row => [row.id, row.fingerprint]).sort((a, b) => a[0].localeCompare(b[0]));
      if (stable(identities(retained)) !== stable(identities(expected))) throw fail('FLEET_RELEASE_RETAINED_SOURCE_CHANGED');
    } finally { await store.close(); }
  }
  function retainReview(value) {
    for (const [id, review] of reviews) if (review.expiresAt <= Date.now()) reviews.delete(id);
    if (reviews.size >= 16) reviews.delete(reviews.keys().next().value);
    const reviewId = randomUUID(), expiresAt = Date.now() + 10 * 60 * 1000;
    reviews.set(reviewId, { ...value, reviewId, expiresAt });
    return { reviewId, expiresAt: new Date(expiresAt).toISOString() };
  }
  function takeReview(reviewId, kind) {
    const review = reviews.get(reviewId);
    if (!review || review.kind !== kind || review.expiresAt <= Date.now()) throw fail('FLEET_RELEASE_REVIEW_EXPIRED');
    reviews.delete(reviewId); return review;
  }
  async function checkReview(review) {
    const native = await nativeStatus(); linked(native);
    if (native.revision !== review.baseRevision || native.digest !== review.baseDigest) throw fail('FLEET_RELEASE_REVISION_CHANGED');
    for (const [key, generation] of Object.entries(review.generations)) {
      const [tenant, slot] = key.split('/');
      if ((await readReleaseState(locate(tenant, slot).slot.store)).generation !== generation)
        throw fail('FLEET_RELEASE_SELECTION_CHANGED');
    }
    return native;
  }
  async function generations(mapping) {
    const values = {};
    for (const row of mapping) values[slotKey(row.tenant, row.slot)] =
      (await readReleaseState(locate(row.tenant, row.slot).slot.store)).generation;
    return values;
  }
  function outcomeUnknown(error) {
    if (!error.status || error.status >= 500) return Object.assign(fail('FLEET_RELEASE_OUTCOME_UNKNOWN', 502), { cause: error });
    return error;
  }
  async function status() {
    if (closed) return { schema: 'stellar-forge.fleet-release-status.v1', closing: true, closed: true };
    const native = await nativeStatus();
    let relationship = 'LINKED';
    try { linked(native); } catch (error) { relationship = error.message; }
    const view = [];
    for (const tenant of plan.tenants) {
      const slots = [];
      for (const [name, slot] of Object.entries(tenant.slots)) {
        const selected = await readReleaseState(slot.store), runtime = owned.get(slotKey(tenant.id, name));
        const use = portUse(native, slot.port);
        slots.push({ name, port: slot.port, selectedReleaseId: selected.active, generation: selected.generation,
          owned: Boolean(runtime && !runtime.ended), instanceId: runtime && !runtime.ended ? runtime.session.observation.instanceId : null,
          runningReleaseId: runtime && !runtime.ended ? runtime.descriptor.releaseId : null,
          runningDigest: runtime && !runtime.ended ? runtime.descriptor.releaseDigest : null,
          operations: describeFleetOperations(closing ? null : runtime),
          state: runtime ? runtime.ended ? 'STOPPED' : 'RUNNING' : 'NOT_OWNED',
          serving: use.current, candidate: use.candidate, drainingRequests: use.active,
          canRetire: Boolean(runtime && !runtime.ended && !use.current && !use.candidate && use.active === 0 && !native.busy) });
      }
      view.push({ id: tenant.id, host: tenant.host, slots, packages: Object.keys(tenant.packages),
        packageSources: describeFleetPackages(tenant.packages), limits: tenant.limits });
    }
    return { schema: 'stellar-forge.fleet-release-status.v1', closing, closed, busy: operation?.action ?? null,
      relationship, native, tenants: view, clientExports: clients.summary, pending: journal.pending ? {
        phase: journal.pending.phase, baseRevision: journal.pending.baseRevision,
        candidateId: journal.pending.candidateId ?? null, targetRevision: journal.pending.targetRevision ?? null,
      } : null, retained: journal.revisions.map(row => ({ revision: row.revision, digest: row.digest,
        releases: row.mapping.map(item => ({ tenant: item.tenant, slot: item.slot, releaseId: item.releaseId,
          digest: item.releaseDigest, port: item.port })) })) };
  }
  const clients = createFleetClientDesk({ directory, planDigest: plan.digest,
    locate: (tenant, slot) => { assertOpen(); return locate(tenant, slot); },
    getManaged(tenant, slot) {
      if (closing || closed) return null;
      lease.assertHeld(); const runtime = owned.get(slotKey(tenant, slot));
      return runtime && !runtime.ended ? runtime.session : null;
    } });
  const api = {
    planDigest: plan.digest, stateDirectory, gatewayStateDirectory: stateDirectory, get publicURL() { return gateway?.publicURL; }, status,
    operations(input) {
      assertOpen(); keys(input, ['tenant', 'slot', 'instanceId']);
      const { key } = locate(input.tenant, input.slot);
      return readFleetOperations(owned.get(key), input);
    },
    async catalog({ tenant, slot }) {
      assertOpen(); const source = locate(tenant, slot).slot;
      const [selected, catalog] = await Promise.all([readReleaseState(source.store), listReleases(source.store)]);
      return { tenant, slot, generation: selected.generation, selectedReleaseId: selected.active,
        releases: catalog.releases.map(shortRelease), errors: catalog.errors.map(row => ({ id: row.id, error: 'ORIGINAL_RELEASE_UNREADABLE' })) };
    },
    clientList(input) { assertOpen(); return clients.list(input); },
    clientInspect(input) { assertOpen(); return clients.inspect(input); },
    clientGenerate(input) { return exclusive('client-generate', () => clients.generate(input)); },
    clientAdopt(input) { return exclusive('client-adopt', () => clients.adopt(input)); },
    clientManifest(input) { assertOpen(); return clients.manifest(input); },
    clientFile(input) { assertOpen(); return clients.file(input); },
    clientFileRelease(input) { assertOpen(); return clients.releaseFile(input); },
    downloadClient(input) { assertOpen(); return clients.download(input); },
    sendClientDownload(req, res, input) { assertOpen(); return clients.sendDownload(req, res, input); },
    stage(input) { return exclusive('stage', async () => {
      keys(input, ['tenant', 'slot', 'package', 'releaseId']);
      const { tenant, slot } = locate(input.tenant, input.slot), source = tenant.packages[input.package];
      if (!source || !ID.test(input.releaseId ?? '')) throw fail('FLEET_RELEASE_PACKAGE_OR_ID_INVALID', 400);
      const controller = source.sqlitePackage !== undefined || source.postgresPackage !== undefined ? new AbortController() : null;
      stagingController = controller;
      try {
        const release = await stageRelease(slot.store, { ...source, id: input.releaseId,
          ...(controller ? { signal: controller.signal } : {}),
          runtime: { ...source.runtime, port: slot.port } });
        return { tenant: input.tenant, slot: input.slot, package: input.package, release: shortRelease(release) };
      } finally { if (stagingController === controller) stagingController = null; }
    }); },
    review(input) { return exclusive('review', async () => {
      keys(input, ['tenant', 'slot', 'releaseId']);
      const native = await nativeStatus(), current = linked(native), target = await descriptor(input.tenant, input.slot, input.releaseId);
      const before = current.mapping.find(row => row.tenant === input.tenant);
      if (before.slot === target.slot) throw fail('FLEET_RELEASE_REPLACEMENT_SLOT_REQUIRED');
      const beforeSlot = locate(before.tenant, before.slot).slot, afterSlot = locate(target.tenant, target.slot).slot;
      const comparison = await compareReleases(afterSlot.store, before.releaseId, target.releaseId, { beforeRoot: beforeSlot.store });
      if (comparison.before.digest !== before.releaseDigest || comparison.after.digest !== target.releaseDigest)
        throw fail('FLEET_RELEASE_SOURCE_CHANGED');
      const held = owned.get(slotKey(target.tenant, target.slot));
      if (held && !held.ended && !sameDescriptor(held.descriptor, target)) throw fail('FLEET_RELEASE_SLOT_IN_USE');
      const mapping = current.mapping.map(row => row.tenant === target.tenant ? target : row);
      const review = { kind: 'replace', baseRevision: native.revision, baseDigest: native.digest,
        target, mapping, generations: await generations([...current.mapping, target]) };
      return { ...retainReview(review), kind: review.kind, baseRevision: native.revision,
        tenant: target.tenant, slot: target.slot, releaseId: target.releaseId,
        comparison: publicComparison(comparison), limits: tenants.get(target.tenant).limits };
    }); },
    prepare({ reviewId }) { return exclusive('prepare', async () => {
      const review = takeReview(reviewId, 'replace'); await checkReview(review);
      const targetKey = slotKey(review.target.tenant, review.target.slot);
      const started = await ensureStarted(review.target, review.generations[targetKey]);
      review.generations[targetKey] = started.selectionGeneration;
      for (const row of review.mapping) await verifyDescriptor(row);
      await checkReview(review);
      saveJson(manifestPath, manifest(review.mapping));
      journal.pending = { phase: 'PREPARING', baseRevision: review.baseRevision, mapping: review.mapping,
        generations: review.generations }; persist();
      let native;
      try { native = await fleetControl(stateDirectory, 'prepare', { manifestPath, expectedRevision: review.baseRevision }); }
      catch (error) { throw outcomeUnknown(error); }
      if (!native.candidate || native.candidate.baseRevision !== review.baseRevision) throw fail('FLEET_RELEASE_PREPARE_RESPONSE_INVALID', 502);
      journal.pending = { ...journal.pending, phase: 'PREPARED', candidateId: native.candidate.id, digest: native.candidate.digest };
      persist(); return { candidateId: native.candidate.id, expectedRevision: review.baseRevision,
        expiresAt: native.candidate.expiresAt, native };
    }); },
    activate({ candidateId, expectedRevision }) { return exclusive('activate', async () => {
      const native = await nativeStatus(); linked(native);
      const pending = journal.pending;
      if (!pending || pending.phase !== 'PREPARED' || candidateId !== pending.candidateId ||
          expectedRevision !== pending.baseRevision || native.revision !== expectedRevision ||
          native.candidate?.id !== candidateId || native.candidate.digest !== pending.digest)
        throw fail('FLEET_RELEASE_CANDIDATE_CHANGED');
      for (const row of pending.mapping) {
        const held = owned.get(slotKey(row.tenant, row.slot));
        if (!held || held.ended || !sameDescriptor(held.descriptor, row)) throw fail('FLEET_RELEASE_SESSION_UNAVAILABLE');
        await verifyDescriptor(row);
      }
      for (const [key, generation] of Object.entries(pending.generations)) {
        const [tenant, slot] = key.split('/');
        if ((await readReleaseState(locate(tenant, slot).slot.store)).generation !== generation)
          throw fail('FLEET_RELEASE_SELECTION_CHANGED');
      }
      pending.phase = 'ACTIVATING'; persist();
      let result;
      try { result = await fleetControl(stateDirectory, 'activate', { candidateId, expectedRevision }); }
      catch (error) { throw outcomeUnknown(error); }
      recordRevision(result, pending.mapping); return { native: result };
    }); },
    reviewRollback({ targetRevision }) { return exclusive('review-rollback', async () => {
      const native = await nativeStatus(), current = linked(native);
      const target = journal.revisions.find(row => row.revision === targetRevision &&
        native.history.some(saved => saved.revision === row.revision && saved.digest === row.digest && saved.snapshotId === row.snapshotId));
      if (!target) throw fail('FLEET_RELEASE_ROLLBACK_NOT_LINKED', 404);
      const comparisons = [];
      for (const row of target.mapping) {
        await verifyDescriptor(row);
        const held = owned.get(slotKey(row.tenant, row.slot));
        if (held && !held.ended && !sameDescriptor(held.descriptor, row)) throw fail('FLEET_RELEASE_SLOT_IN_USE');
        const before = current.mapping.find(item => item.tenant === row.tenant);
        const comparison = await compareReleases(locate(row.tenant, row.slot).slot.store, before.releaseId, row.releaseId,
          { beforeRoot: locate(before.tenant, before.slot).slot.store });
        if (comparison.before.digest !== before.releaseDigest || comparison.after.digest !== row.releaseDigest)
          throw fail('FLEET_RELEASE_SOURCE_CHANGED');
        comparisons.push({ tenant: row.tenant, comparison: publicComparison(comparison) });
      }
      const review = { kind: 'rollback', baseRevision: native.revision, baseDigest: native.digest,
        targetRevision, digest: target.digest, mapping: structuredClone(target.mapping),
        generations: await generations([...current.mapping, ...target.mapping]) };
      return { ...retainReview(review), kind: review.kind, baseRevision: native.revision, targetRevision, comparisons };
    }); },
    rollback({ reviewId }) { return exclusive('rollback', async () => {
      const review = takeReview(reviewId, 'rollback'); await checkReview(review);
      for (const row of review.mapping) {
        const key = slotKey(row.tenant, row.slot), started = await ensureStarted(row, review.generations[key]);
        review.generations[key] = started.selectionGeneration;
      }
      await checkReview(review);
      journal.pending = { phase: 'ROLLING_BACK', baseRevision: review.baseRevision, targetRevision: review.targetRevision,
        digest: review.digest, mapping: review.mapping }; persist();
      let native;
      try { native = await fleetControl(stateDirectory, 'rollback', {
        expectedRevision: review.baseRevision, targetRevision: review.targetRevision }); }
      catch (error) { throw outcomeUnknown(error); }
      recordRevision(native, review.mapping); return { native };
    }); },
    retire({ tenant, slot, instanceId, expectedRevision }) { return exclusive('retire', async () => {
      const { key } = locate(tenant, slot), held = owned.get(key);
      if (!held || held.ended || held.session.observation.instanceId !== instanceId) throw fail('FLEET_RELEASE_SESSION_NOT_OWNED');
      // The original routing mutex spans the original child close. Another
      // control client cannot activate this port after checking its drain.
      const result = await gateway.withRetiredPort(held.descriptor.port, expectedRevision, () => held.session.close());
      held.ended = true;
      return { tenant, slot, instanceId, stopped: true, native: result };
    }); },
    // Provider shutdown can cancel native source capture before awaiting its
    // serialized call. The original stage API removes its uncommitted output.
    cancelStaging() {
      if (!stagingController || stagingController.signal.aborted) return false;
      stagingController.abort(fail('FLEET_RELEASE_STAGE_CANCELLED')); return true;
    },
    cancelClientTransfers() {
      if (clientClosePromise) return false;
      clientClosePromise = clients.close(); clientClosePromise.catch(() => {}); return true;
    },
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      api.cancelStaging();
      api.cancelClientTransfers();
      closingPromise = (async () => {
        await operation?.promise.catch(() => {});
        const errors = [];
        // Observe original listener completion before invoking native close: its
        // final state-file cleanup can fail AFTER its HTTP drain succeeded.
        const drained = Promise.all([gateway?.publicServer, gateway?.adminServer]
          .filter(server => server?.listening).map(server => new Promise(done => server.once('close', done))));
        try { await gateway?.close(); } catch (error) { errors.push(error); }
        await drained;
        const results = await Promise.allSettled([...owned.values()].map(row => row.session.close()));
        errors.push(...results.filter(row => row.status === 'rejected').map(row => row.reason));
        try { await clientClosePromise; } catch (error) { errors.push(error); }
        try { await lease.close(); } catch (error) { errors.push(error); }
        closed = true;
        if (errors.length) throw Object.assign(fail('FLEET_RELEASE_SHUTDOWN_INCOMPLETE', 500),
          { cause: new AggregateError(errors, 'Original owned shutdown reported errors') });
      })();
      return closingPromise;
    },
  };
  try {
    journal = readJson(journalPath, { optional: true }) ?? { schema: JOURNAL, planDigest: plan.digest, revisions: [], pending: null };
    if (journal.schema !== JOURNAL || journal.planDigest !== plan.digest || !Array.isArray(journal.revisions) ||
        journal.revisions.length > 256) throw fail('FLEET_RELEASE_PLAN_OR_LINKS_CHANGED');
    for (const row of journal.revisions) validateMapping(row.mapping);
    const retained = readJson(join(stateDirectory, 'active.json'), { optional: true });
    let mapping;
    if (retained) {
      if (retained.schema !== 'stellar-forge.fleet-rollout-state.v1') throw fail('FLEET_RELEASE_GATEWAY_STATE_INVALID');
      const pending = journal.pending;
      const historical = pending?.digest && retained.history.find(row =>
        row.revision === pending.baseRevision + 1 && row.digest === pending.digest);
      if (historical && !journal.revisions.some(row => row.revision === historical.revision && row.digest === historical.digest))
        journal.revisions.unshift({ revision: historical.revision, digest: historical.digest,
          snapshotId: historical.snapshotId, mapping: structuredClone(pending.mapping) });
      const saved = journal.revisions.find(row => row.digest === retained.digest && row.snapshotId === retained.snapshotId);
      mapping = saved?.mapping ?? (pending?.digest === retained.digest && pending.baseRevision + 1 === retained.revision ? pending.mapping : null);
      if (!mapping && pending?.phase === 'BOOTSTRAPPING' && retained.revision === 1) mapping = pending.mapping;
      if (!mapping) throw fail('FLEET_RELEASE_RESTART_REVISION_NOT_LINKED');
      validateMapping(mapping);
      await verifyRetainedMapping(retained, mapping);
    } else {
      mapping = [];
      for (const tenant of plan.tenants) {
        const selected = await readReleaseState(tenant.slots[tenant.startupSlot].store);
        if (!selected.active) throw fail('FLEET_RELEASE_STARTUP_SELECTION_REQUIRED');
        mapping.push(await descriptor(tenant.id, tenant.startupSlot, selected.active));
      }
      journal.pending = { phase: 'BOOTSTRAPPING', baseRevision: 0, mapping };
    }
    persist();
    for (const row of mapping) await ensureStarted(row);
    saveJson(manifestPath, manifest(mapping));
    gateway = await startMerchantFleet(await loadMerchantFleet(manifestPath), {
      port: plan.gateway.port, adminPort: plan.gateway.adminPort, stateDirectory, initialManifest: manifestPath });
    if (typeof gateway.withRetiredPort !== 'function') throw fail('FLEET_RELEASE_ROUTING_LIFECYCLE_REQUIRED');
    const native = await fleetControl(stateDirectory, 'status'); recordRevision(native, mapping);
    return api;
  } catch (error) {
    try { await api.close(); } catch (cleanup) { error.cleanupError = cleanup.message; }
    throw error;
  }
}
