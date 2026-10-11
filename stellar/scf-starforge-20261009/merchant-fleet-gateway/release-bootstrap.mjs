// MIT. First-use setup over the original SF82 stores and fleet release plan.
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { initReleaseStore, readReleaseState, inspectRelease, stageRelease, activateRelease }
  from '../sf82-seller-pilot/releases.mjs';
import { describeFleetPackages, normalizeFleetPackageSource, readFleetReleasePlan } from './release-operator.mjs';
import { acquireStateLease } from './state-lease.mjs';

const INPUT = 'stellar-forge.fleet-bootstrap.v1';
const JOURNAL = 'stellar-forge.fleet-bootstrap-journal.v1';
const PLAN = 'stellar-forge.fleet-release-plan.v1';
const LIMIT = 1024 * 1024;
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const TENANT = /^[a-z][a-z0-9-]{1,39}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RELEASE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ATOMIC_TEMP = /^\.bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, detail) => Object.assign(new Error(code + (detail ? ': ' + detail : '')), { code });
const stable = value => JSON.stringify(value, function (_, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function keys(value, allowed, code = 'FLEET_BOOTSTRAP_INPUT_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw failure(code);
}
function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', name);
  return value;
}
async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function readJSON(path, { optional = false, privateFile = false } = {}) {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMIT || privateFile && (info.mode & 0o077))
      throw failure('FLEET_BOOTSTRAP_FILE_INVALID', path);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.readFile()));
  } finally { await file.close(); }
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
async function atomicJSON(path, value, { createOnly = false } = {}) {
  const body = bytes(value);
  if (body.length > LIMIT) throw failure('FLEET_BOOTSTRAP_FILE_TOO_LARGE');
  const temporary = join(dirname(path), '.bootstrap-' + randomUUID());
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    try { await file.writeFile(body); await file.sync(); }
    finally { await file.close(); }
    if (createOnly) {
      try { await link(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const current = await readJSON(path, { privateFile: true });
        if (stable(current) !== stable(value)) throw failure('FLEET_BOOTSTRAP_PLAN_CONFLICT', path);
      }
    } else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function privateDirectory(path, { acceptEmpty = false } = {}) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw failure('FLEET_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED', path);
  if (info.mode & 0o077) {
    if (acceptEmpty && (await readdir(path)).length === 0) await chmod(path, 0o700);
    else throw failure('FLEET_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED', path);
  }
  return realpath(path);
}

/** Resolve the declared aliases once; the original source selector owns types and paths. */
function declaredIntent(input, base, directory, planFile) {
  keys(input, ['schema', 'gateway', 'merchantPortStart', 'slots', 'tenants']);
  if (input.schema !== INPUT || !Array.isArray(input.tenants) || input.tenants.length < 2 || input.tenants.length > 32)
    throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Declare 2–32 tenants.');
  const gatewayInput = input.gateway ?? {};
  keys(gatewayInput, ['port', 'adminPort']);
  const gateway = { port: integer(gatewayInput.port ?? 8400, 1, 65535, 'gateway.port'),
    adminPort: integer(gatewayInput.adminPort ?? 8401, 1, 65535, 'gateway.adminPort') };
  const slots = input.slots ?? ['blue', 'green'];
  if (!Array.isArray(slots) || slots.length < 2 || slots.length > 4 ||
      slots.some(name => typeof name !== 'string' || !NAME.test(name)) || new Set(slots).size !== slots.length)
    throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Declare 2–4 distinct slot names.');
  let port = integer(input.merchantPortStart ?? 8521, 1, 65535, 'merchantPortStart');
  const ports = new Set([gateway.port, gateway.adminPort]), ids = new Set(), hosts = new Set(), initials = [];
  if (ports.size !== 2) throw failure('FLEET_BOOTSTRAP_PORT_CONFLICT');
  const tenants = input.tenants.map(row => {
    keys(row, ['id', 'host', 'packages', 'initial', 'limits']);
    if (typeof row.id !== 'string' || !TENANT.test(row.id) || ids.has(row.id) ||
        typeof row.host !== 'string' || row.host.length > 253 || !HOST.test(row.host) || hosts.has(row.host))
      throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Tenant IDs and public DNS hosts must be distinct.');
    ids.add(row.id); hosts.add(row.host);
    if (!object(row.packages) || !Object.keys(row.packages).length || Object.keys(row.packages).length > 32)
      throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Register 1–32 packages per tenant.');
    const packages = Object.fromEntries(Object.entries(row.packages).map(([name, source]) => {
      if (!NAME.test(name)) throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Package alias');
      return [name, normalizeFleetPackageSource(source, base)];
    }));
    keys(row.initial, ['package', 'releaseId', 'label']);
    if (typeof row.initial.package !== 'string' || !Object.hasOwn(packages, row.initial.package) ||
        typeof row.initial.releaseId !== 'string' || !RELEASE.test(row.initial.releaseId) ||
        row.initial.label !== undefined && (typeof row.initial.label !== 'string' || !row.initial.label.trim() ||
          row.initial.label.length > 240 || /[\x00-\x1f\x7f]/.test(row.initial.label)))
      throw failure('FLEET_BOOTSTRAP_INPUT_INVALID', 'Choose a registered initial package and release ID.');
    const nativeSlots = Object.fromEntries(slots.map(name => {
      integer(port, 1, 65535, 'merchant slot port');
      if (ports.has(port)) throw failure('FLEET_BOOTSTRAP_PORT_CONFLICT', String(port));
      ports.add(port);
      return [name, { store: join(directory, 'stores', row.id, name), port: port++ }];
    }));
    const limits = row.limits ?? {};
    keys(limits, ['maxInFlight', 'maxRequestBytes', 'maxResponseBytes', 'timeoutMs']);
    const ranges = { maxInFlight: [1, 512], maxRequestBytes: [1024, 4 * 1024 * 1024],
      maxResponseBytes: [1024, 16 * 1024 * 1024], timeoutMs: [1000, 60000] };
    for (const [name, value] of Object.entries(limits)) integer(value, ...ranges[name], name);
    initials.push({ tenant: row.id, slot: slots[0], ...row.initial,
      ...(row.initial.label !== undefined ? { label: row.initial.label.trim() } : {}) });
    return { id: row.id, host: row.host, startupSlot: slots[0], slots: nativeSlots, packages, limits };
  });
  return { schema: INPUT, directory, planFile, plan: { schema: PLAN, gateway, tenants }, initials };
}
function allStores(intent) {
  return intent.plan.tenants.flatMap(tenant => Object.entries(tenant.slots)
    .map(([slot, value]) => ({ tenant: tenant.id, slot, ...value, key: tenant.id + '/' + slot })));
}
function statusView(journal) {
  return { schema: 'stellar-forge.fleet-bootstrap-status.v1', status: journal.status,
    directory: journal.intent.directory, planFile: journal.intent.planFile, planDigest: journal.planDigest ?? null,
    intentSha256: journal.intentSha256, createdAt: journal.createdAt, updatedAt: journal.updatedAt,
    mcpFleet: { planFile: journal.intent.planFile, directory: journal.intent.directory },
    gateway: journal.intent.plan.gateway,
    stores: allStores(journal.intent).map(row => ({ ...row, ...journal.stores[row.key] })),
    ...(journal.lastError ? { lastError: journal.lastError } : {}) };
}
function validateJournal(journal, directory) {
  if (journal?.schema !== JOURNAL || journal.intent?.directory !== directory ||
      journal.intentSha256 !== digest(journal.intent) || !['PREPARING', 'COMPLETE'].includes(journal.status) ||
      !object(journal.stores) || allStores(journal.intent).some(row => !object(journal.stores[row.key])))
    throw failure('FLEET_BOOTSTRAP_JOURNAL_INVALID');
  return journal;
}
/** Read retained setup progress without starting sellers or changing selections. */
export async function readFleetBootstrapStatus({ directory } = {}) {
  const root = await realpath(resolve(directory));
  const journal = validateJournal(await readJSON(join(root, 'bootstrap.json'), { privateFile: true }), root);
  return statusView(journal);
}
async function reservePorts(intent) {
  const servers = [];
  try {
    for (const port of [intent.plan.gateway.port, intent.plan.gateway.adminPort, ...allStores(intent).map(row => row.port)]) {
      const server = createServer(socket => socket.destroy());
      await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { server.off('error', fail); done(); });
      }).catch(cause => { throw Object.assign(failure('FLEET_BOOTSTRAP_PORT_UNAVAILABLE', String(port)), { cause }); });
      servers.push(server);
    }
    return async () => { await Promise.all(servers.map(server => new Promise(done => server.close(done)))); };
  } catch (error) {
    await Promise.all(servers.map(server => new Promise(done => server.close(done)))); throw error;
  }
}
/** Preserve only a proven setup-owned, incomplete init; never rewrite native state. */
async function preservePartialInit(row, journal, checkpoint) {
  const info = await lstat(row.store);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
  const entries = await readdir(row.store);
  if (entries.some(name => !['releases', 'state.json'].includes(name))) throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
  for (const name of entries) {
    const path = join(row.store, name), item = await lstat(path);
    if (item.isSymbolicLink() || item.mode & 0o077 || (name === 'releases' ? !item.isDirectory() ||
        (await readdir(path)).length !== 0 : !item.isFile() || item.size > 4 * 1024 * 1024))
      throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', path);
  }
  const recovery = join(journal.intent.directory, 'recovery'); await privateDirectory(recovery);
  const retained = join(recovery, row.tenant + '-' + row.slot + '-' + randomUUID());
  // The journal already records INITIALIZING before initReleaseStore can mkdir.
  await rename(row.store, retained); await syncDirectory(dirname(row.store)); await syncDirectory(recovery);
  journal.stores[row.key].partialInitializations ??= [];
  journal.stores[row.key].partialInitializations.push(retained); await checkpoint();
}
function verifyInitialRelease(release, tenant, row, initial, source, retained) {
  const expectedKind = describeFleetPackages({ initial: source })[0].kind;
  const workspace = expectedKind === 'OPENAPI_WORKSPACE';
  const runtime = source.runtime ?? {}, actual = release.runtime;
  const facilitator = runtime.facilitator === undefined ? undefined : new URL(runtime.facilitator).href.replace(/\/$/, '');
  if (release.id !== initial.releaseId || release.label !== (initial.label ?? initial.releaseId) ||
      release.publicOrigin !== 'https://' + tenant.host || actual.port !== row.port ||
      actual.facilitator !== facilitator || Boolean(actual.allowLocalFacilitator) !== Boolean(runtime.allowLocalFacilitator) ||
      !workspace && release.source.kind !== expectedKind || workspace && (release.source.kind || !release.inputPackage) ||
      retained.releaseDigest && release.digest !== retained.releaseDigest)
    throw failure('FLEET_BOOTSTRAP_RELEASE_CONFLICT', row.key);
}

/**
 * Initialize and select native releases, then publish the original fleet plan.
 * The existing fleet lease spans setup; native stores remain the mutation authority.
 * Awaited progress callbacks can connect a foreground CLI or another host UI.
 */
export async function bootstrapFleet({ declarationFile, directory, planFile, signal, onProgress } = {}) {
  if (typeof declarationFile !== 'string' || !declarationFile.trim() || typeof directory !== 'string' || !directory.trim())
    throw failure('FLEET_BOOTSTRAP_PATHS_REQUIRED');
  declarationFile = resolve(declarationFile);
  const input = await readJSON(declarationFile);
  directory = await privateDirectory(resolve(directory), { acceptEmpty: true });
  planFile = resolve(planFile ?? join(directory, 'fleet-plan.json'));
  const journalFile = join(directory, 'bootstrap.json'), pendingPlan = join(directory, 'bootstrap-plan.pending.json');
  const reserved = ['bootstrap.json', 'bootstrap-plan.pending.json', 'lease.lock', 'links.json',
    'prepared-fleet.json', 'stores', 'recovery', 'gateway', 'clients', 'discovery'].map(name => join(directory, name));
  if ([...reserved, declarationFile].includes(planFile) || ['stores', 'recovery', 'gateway', 'clients', 'discovery']
      .some(name => planFile.startsWith(join(directory, name) + sep)))
    throw failure('FLEET_BOOTSTRAP_PLAN_PATH_INVALID');
  const intent = declaredIntent(input, dirname(declarationFile), directory, planFile);
  const lease = await acquireStateLease(directory);
  let journal, releasePorts, phase = 'starting';
  const checkpoint = async () => { lease.assertHeld(); journal.updatedAt = new Date().toISOString(); await atomicJSON(journalFile, journal); };
  const progress = async (name, row, extra = {}) => {
    phase = name; lease.assertHeld(); signal?.throwIfAborted();
    await onProgress?.({ phase: name, ...(row ? { tenant: row.tenant, slot: row.slot, store: row.store } : {}), ...extra });
    signal?.throwIfAborted();
  };
  try {
    journal = await readJSON(journalFile, { optional: true, privateFile: true });
    if (journal) {
      validateJournal(journal, directory);
      if (journal.intentSha256 !== digest(intent)) throw failure('FLEET_BOOTSTRAP_DECLARATION_CHANGED');
    } else {
      for (const name of await readdir(directory)) {
        if (name === 'lease.lock') continue;
        const info = await lstat(join(directory, name));
        // A crash during the first atomic journal write precedes all native
        // mutations. Preserve its private temporary and retry the declaration.
        if (!ATOMIC_TEMP.test(name) || !info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > LIMIT)
          throw failure('FLEET_BOOTSTRAP_DIRECTORY_NOT_EMPTY');
      }
      if (await stat(planFile)) throw failure('FLEET_BOOTSTRAP_PLAN_EXISTS', planFile);
      const now = new Date().toISOString();
      journal = { schema: JOURNAL, status: 'PREPARING', createdAt: now, updatedAt: now,
        intent, intentSha256: digest(intent), stores: Object.fromEntries(allStores(intent).map(row => [row.key, { status: 'PLANNED' }])) };
      await checkpoint();
    }
    if (journal.status === 'COMPLETE') {
      const current = await readJSON(planFile, { privateFile: true });
      if (stable(current) !== stable(intent.plan)) throw failure('FLEET_BOOTSTRAP_PLAN_CONFLICT', planFile);
      // A completed setup never replays initial selections over later fleet work.
      return statusView(journal);
    }
    // Publishing the exact plan is the commit boundary. Another original owner
    // may already have used it after a crash before the final setup checkpoint.
    if (await stat(planFile)) {
      const published = await readJSON(planFile, { privateFile: true });
      if (stable(published) !== stable(intent.plan) || !journal.planDigest ||
          intent.initials.some(initial => journal.stores[initial.tenant + '/' + initial.slot].status !== 'ACTIVE'))
        throw failure('FLEET_BOOTSTRAP_PLAN_CONFLICT', planFile);
      const plan = await readFleetReleasePlan(planFile);
      if (plan.digest !== journal.planDigest) throw failure('FLEET_BOOTSTRAP_PLAN_CONFLICT', planFile);
      journal.status = 'COMPLETE'; delete journal.lastError; await checkpoint();
      return statusView(journal);
    }
    delete journal.lastError;
    releasePorts = await reservePorts(intent); await progress('ports-reserved');
    await privateDirectory(join(directory, 'stores'));
    for (const row of allStores(intent)) {
      const retained = journal.stores[row.key];
      await privateDirectory(dirname(row.store));
      if (retained.status === 'PLANNED') {
        if (await stat(row.store)) throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
        retained.status = 'INITIALIZING'; await checkpoint();
      }
      if (retained.status === 'INITIALIZING') {
        let state;
        if (await stat(row.store)) {
          try { state = await readReleaseState(row.store); }
          catch { await preservePartialInit(row, journal, checkpoint); }
        }
        if (!state) {
          await progress('store-initializing', row); state = await initReleaseStore(row.store);
          await progress('store-initialized', row);
        }
        if (state.generation !== 0 || state.active !== null || state.previous !== null || state.history.length)
          throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
        retained.status = 'INITIALIZED'; retained.createdAt = state.createdAt; await checkpoint();
      }
      const state = await readReleaseState(row.store);
      if (state.createdAt !== retained.createdAt) throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
    }
    await atomicJSON(pendingPlan, intent.plan);
    await readFleetReleasePlan(pendingPlan); // Original plan validation now sees real initialized stores.
    for (const initial of intent.initials) {
      const tenant = intent.plan.tenants.find(row => row.id === initial.tenant);
      const row = allStores(intent).find(row => row.tenant === initial.tenant && row.slot === initial.slot);
      const retained = journal.stores[row.key], source = tenant.packages[initial.package];
      if (retained.status === 'INITIALIZED') {
        if ((await readdir(join(row.store, 'releases'))).length) throw failure('FLEET_BOOTSTRAP_STORE_CONFLICT', row.store);
        retained.status = 'STAGING'; retained.releaseId = initial.releaseId; await checkpoint();
      }
      let release;
      if (await stat(join(row.store, 'releases', initial.releaseId))) release = await inspectRelease(row.store, initial.releaseId);
      else {
        if (retained.status !== 'STAGING') throw failure('FLEET_BOOTSTRAP_RELEASE_MISSING', row.key);
        await progress('release-staging', row, { releaseId: initial.releaseId });
          release = await stageRelease(row.store, { ...source, id: initial.releaseId, label: initial.label,
            ...(source.sqlitePackage !== undefined || source.postgresPackage !== undefined ? { signal } : {}),
          runtime: { ...source.runtime, port: row.port } });
        await progress('release-staged', row, { releaseId: release.id, releaseDigest: release.digest });
        release = await inspectRelease(row.store, initial.releaseId);
      }
      verifyInitialRelease(release, tenant, row, initial, source, retained);
      retained.releaseDigest = release.digest; retained.source = release.source;
      let state = await readReleaseState(row.store);
      if (state.active !== initial.releaseId || state.generation !== 1 || state.previous !== null ||
          state.history.length !== 1 || state.history[0].from !== null || state.history[0].to !== initial.releaseId) {
        if (state.generation !== 0 || state.active !== null || state.previous !== null || state.history.length)
          throw failure('FLEET_BOOTSTRAP_SELECTION_CONFLICT', row.key);
        retained.status = 'ACTIVATING'; await checkpoint();
        await progress('release-activating', row, { releaseId: initial.releaseId });
        await activateRelease(row.store, initial.releaseId, { expectedGeneration: 0, reason: 'Initial managed fleet setup' });
        await progress('release-activated', row, { releaseId: initial.releaseId, releaseDigest: release.digest });
        state = await readReleaseState(row.store);
      }
      if (state.generation !== 1 || state.active !== initial.releaseId) throw failure('FLEET_BOOTSTRAP_SELECTION_CONFLICT', row.key);
      retained.status = 'ACTIVE'; retained.generation = state.generation; await checkpoint();
    }
    const plan = await readFleetReleasePlan(pendingPlan);
    journal.planDigest = plan.digest; await checkpoint();
    await mkdir(dirname(planFile), { recursive: true, mode: 0o700 });
    await atomicJSON(planFile, intent.plan, { createOnly: true });
    await progress('plan-published', null, { planFile, planDigest: plan.digest });
    journal.status = 'COMPLETE'; await checkpoint();
    await progress('complete', null, { planFile, planDigest: plan.digest });
    return statusView(journal);
  } catch (error) {
    if (journal && journal.intentSha256 === digest(intent)) {
      journal.lastError = { phase, code: error.code ?? error.name, message: error.message, at: new Date().toISOString() };
      await checkpoint().catch(() => {});
    }
    throw error;
  } finally { await releasePorts?.(); await lease.close(); }
}
