// MIT. Version and operate original SF61 exports through the original SF82 launcher.
import { open, readFile, lstat, mkdir, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { upstreamReleaseSnapshot, stageReleaseUpstreams, inspectReleaseUpstreams, readReleaseWorkspace } from './release-upstreams.mjs';

const STORE = 'stellar-forge.seller-release-store.v1';
const RELEASE = 'stellar-forge.seller-release.v1';
const RUN = 'stellar-forge.seller-release-process.v1';
const PILOT = fileURLToPath(new URL('./pilot.mjs', import.meta.url));
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
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
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
        owner.childPid !== undefined && (!Number.isSafeInteger(owner.childPid) || owner.childPid < 1))
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
  const owner = { pid: process.pid, host: hostname(), token, createdAt: new Date().toISOString() };
  const file = 'owner-' + token + '.json';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await lockOwner(root, name);
      if (!current.present) continue;
      if (current.owner?.host === hostname() && !alive(current.owner.pid) && !alive(current.owner.childPid)) {
        await removeOwner(path, current.file);
        continue;
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
    const release = () => removeOwner(path, file);
    release.owner = owner;
    release.update = async fields => {
      Object.assign(owner, fields);
      await atomic(join(path, file), owner);
    };
    return release;
  }
  throw Object.assign(new Error('Release store lock changed; refresh and retry.'), { code: 'RELEASE_BUSY' });
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
async function sourceSnapshot(path, upstreams, allowLoopback = false) {
  const manifestBytes = await regular(join(path, 'manifest.json'), 65536);
  const manifest = JSON.parse(manifestBytes);
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
  const routes = service.routes.map(route => {
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
        responseSha256: route.responseFile ? snapshots.get(route.responseFile) :
          Object.hasOwn(route, 'response') ? hash(stable(route.response)) : null } };
  });
  const hasApplication = service.routes.some(route => route.handler || route.admit);
  return { manifest, offers, service, files: files.sort((a, b) => a.file.localeCompare(b.file)), routes, hasApplication };
}
function publicRelease(record) {
  return { id: record.id, label: record.label, createdAt: record.createdAt,
    digest: record.digest, publicOrigin: record.publicOrigin, routes: record.routes,
    runtime: record.runtime, handlerEntry: record.handlerEntry,
    mode: record.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
    source: record.source, ...(record.inputPackage ? { inputPackage: record.inputPackage } : {}) };
}
async function releaseRecord(root, releaseId, verify = false) {
  const path = join(resolve(root), 'releases', id(releaseId)); await directory(path);
  const record = await json(join(path, 'release.json'));
  const { digest, ...content } = record;
  if (record.schema !== RELEASE || record.id !== releaseId || hash(stable(content)) !== digest)
    throw new Error('Release metadata changed or belongs to a different release.');
  if (verify) {
    const snapshot = await sourceSnapshot(path, record.runtime.upstreams, record.runtime.allowLoopbackUpstream === true);
    if (stable(snapshot.files) !== stable(record.files) || stable(snapshot.routes) !== stable(record.routes))
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
  if (options.workspace && (['spec', 'config', 'bindings', 'upstreams'].some(key => options[key] !== undefined) || options.runtime?.handlers))
    throw new TypeError('Choose --workspace or explicit source inputs for this release.');
  const workspace = options.workspace ? await readReleaseWorkspace(options.workspace) : null;
  const inputs = workspace?.inputs ?? options;
  const runtime = runtimeOptions(options.runtime);
  if (workspace?.allowLoopbackUpstream) runtime.allowLoopbackUpstream = true;
  if (runtime.upstreams) throw new TypeError('Stage takes --upstreams FILE, not an existing release snapshot.');
  if (inputs.upstreams && runtime.handlers) throw new TypeError('Choose --upstreams or --handlers for this release.');
  if (runtime.allowLoopbackUpstream && !inputs.upstreams) throw new TypeError('Loopback upstream permission requires --upstreams.');
  const temp = join(root, 'releases', '.stage-' + randomUUID());
  let committed = false;
  try {
    const compile = (await import('../sf61-openapi-seller-import/cli.mjs')).run;
    await compile(['--spec', resolve(inputs.spec), '--config', resolve(inputs.config),
      '--service-bindings', resolve(inputs.bindings), '--out', temp]);
    let source = await sourceSnapshot(temp);
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
    if (source.hasApplication && !runtime.handlers && !runtime.upstreams)
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
      source: { offersSha256: source.manifest.offersSha256, serviceConfigSha256: source.manifest.serviceConfigSha256,
        specSha256: source.manifest.specSha256, selectionsSha256: source.manifest.selectionsSha256,
        serviceBindingsSha256: source.manifest.serviceBindingsSha256 } };
    const record = { ...content, digest: hash(stable(content)) };
    await writeNew(join(temp, 'release.json'), record);
    await mutate(root, async () => {
      const target = join(root, 'releases', releaseId);
      try { await lstat(target); throw Object.assign(new Error('Release ID already exists; choose a new ID.'), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temp, target); committed = true; await syncDirectory(join(root, 'releases'));
    });
    return publicRelease(record);
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
export async function compareReleases(root, beforeId, afterId) {
  const before = beforeId === null ? null : await inspectRelease(root, beforeId);
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
  return { schema: 'stellar-forge.seller-release-diff.v1', before, after, changes, runtimeChanges,
    summary: { added: changes.filter(c => c.state === 'ADDED').length,
      removed: changes.filter(c => c.state === 'REMOVED').length,
      changed: changes.filter(c => c.state === 'CHANGED').length,
      paymentChanged: changes.filter(c => c.fields.some(f => f.field === 'payment')).length,
      unchanged: [...current.keys()].filter(k => previous.has(k) && !changes.some(c => c.route === k)).length } };
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
    await releaseRecord(root, selected, true);
    if (state.active === selected) return { changed: false, state };
    const event = { generation: state.generation + 1, operation, from: state.active, to: selected,
      at: new Date().toISOString(), reason };
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
  let runtime = { state: 'STOPPED', observed };
  if (claim.present && !owner) {
    runtime = { state: 'STARTING', observed, message: 'A manager is establishing its release-store ownership.' };
  } else if (owner?.host && owner.host !== hostname()) {
    runtime = { state: 'OTHER_HOST', observed, message: 'The release-store owner is on another host.' };
  } else if (owner) {
    const managerAlive = alive(owner.pid), childAlive = alive(owner.childPid);
    const current = observed?.schema === RUN && observed.lockToken === owner.token &&
      observed.instanceId === owner.instanceId && observed.pid === owner.childPid && !observed.endedAt;
    runtime = { state: managerAlive ? 'STARTING' : 'STOPPED', observed, managerAlive, childAlive };
    if (!managerAlive && childAlive) {
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
      (observed.host === undefined || observed.host === hostname()) && alive(observed.pid)) {
    runtime = { state: 'ORPHANED', observed,
      message: 'The recorded seller process is still present without its owner file. This console does not own that process.' };
  }
  return { schema: 'stellar-forge.seller-release-status.v1', root, state, ...catalog, runtime };
}

// The child cannot import handlers or open a listener until its PID is durably
// registered. If the parent dies before granting startup, IPC disconnect ends
// this waiting child. After the grant, the unchanged original pilot owns serving.
const CHILD_LAUNCH = `
import { pathToFileURL } from 'node:url';
const [pilot, directory, instanceId] = process.argv.slice(1);
let started = false;
process.once('disconnect', () => { if (!started) process.exit(0); });
process.once('message', message => {
  if (message?.type !== 'sf82-start' || message.instanceId !== instanceId) process.exit(1);
  started = true;
  process.disconnect();
  process.argv = [process.execPath, pilot, '--resume', directory];
  import(pathToFileURL(pilot).href).catch(error => {
    process.stderr.write(String(error?.message ?? error) + '\\n'); process.exitCode = 1;
  });
});
`;

/** Spawn the ORIGINAL foreground launcher so each run gets fresh application imports. */
export async function runActiveRelease(root, { startupTimeoutMs = 45000, shutdownGraceMs = 70000, expectedGeneration } = {}) {
  root = resolve(root); await readReleaseState(root);
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000 || startupTimeoutMs > 120000 ||
      !Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1000 || shutdownGraceMs > 120000)
    throw new TypeError('Startup and shutdown timeouts must be 1000–120000 ms.');
  if (expectedGeneration !== undefined && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0))
    throw new TypeError('expectedGeneration must be the nonnegative integer shown by release status.');
  const releaseLock = await lock(root, 'run.lock');
  let child, observation, closing, finishing, stopping, completion, startupTimer, failure;
  let exited = Promise.resolve(), exitSettled = true, shutdownRequested = null, rejectReady = () => {};
  let exitCode = null, exitSignal = null;
  const stopChild = (signal = 'SIGTERM') => {
    if (stopping) return stopping;
    stopping = (async () => {
      let forced = false, forceTimer;
      if (child?.pid && !exitSettled) {
        child.kill(signal);
        forceTimer = setTimeout(() => {
          if (!exitSettled) { forced = true; child.kill('SIGKILL'); }
        }, shutdownGraceMs);
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
        (previous.host === undefined || previous.host === hostname()) && alive(previous.pid))
      throw Object.assign(new Error('The previously recorded seller process is still present. This manager cannot start a duplicate or stop a process it does not own.'), { code: 'RELEASE_BUSY' });
    const { record, path } = await releaseRecord(root, state.active, true);
    // Replace only original mutable runtime settings, never compiled source. This
    // prevents a previous manual resume override from leaking into the release.
    const originalOptions = { ...record.runtime, port: String(record.runtime.port) };
    await atomic(join(path, 'pilot-runtime.json'), { schema: 'stellar-forge.seller-pilot-runtime.v1',
      source: { offersSha256: record.source.offersSha256, serviceConfigSha256: record.source.serviceConfigSha256 },
      options: originalOptions });
    const instanceId = randomUUID(), mode = record.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY';
    await releaseLock.update({ instanceId, releaseId: record.id, releaseDigest: record.digest, selectionGeneration: state.generation });
    child = spawn(process.execPath, ['--input-type=module', '--eval', CHILD_LAUNCH, PILOT, path, instanceId],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, detached: process.platform !== 'win32' });
    let readyResolve, readyReject, stdout = '', stderr = '';
    const ready = new Promise((done, fail) => { readyResolve = done; readyReject = fail; });
    // A spawn error can arrive during the durable owner write, before await ready.
    // Observe rejection now and retain one exit promise for all cleanup paths.
    void ready.catch(() => {}); rejectReady = readyReject; exitSettled = false;
    exited = new Promise(done => {
      const settle = () => { if (!exitSettled) { exitSettled = true; done(); } };
      child.on('error', error => { failure ??= error.message; readyReject(error); if (!child.pid) settle(); });
      child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal;
        readyReject(new Error('Original seller exited before startup (code ' + code + ', signal ' + signal + '). ' + stderr.slice(-2000))); settle(); });
    });
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
    child.stderr.setEncoding('utf8'); child.stdout.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { readyReject(new Error('Original seller startup output exceeded its limit.')); stdout = ''; return; }
      while (stdout.includes('\n')) {
        const newline = stdout.indexOf('\n'), line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
        try { const value = JSON.parse(line); if (value.pilotReady === true) readyResolve(value); } catch {}
      }
    });
    startupTimer = setTimeout(() => readyReject(new Error('Original seller startup timed out.')), startupTimeoutMs);
    if (Number.isSafeInteger(child.pid)) await releaseLock.update({ childPid: child.pid });
    observation = { schema: RUN, instanceId, lockToken: releaseLock.owner.token, host: hostname(),
      managerPid: process.pid, pid: child.pid ?? null, releaseId: record.id, releaseDigest: record.digest,
      selectionGeneration: state.generation, listener: null, mode, phase: 'STARTING', startedAt: new Date().toISOString() };
    await atomic(join(root, 'runtime.json'), observation);
    if (exitSettled || shutdownRequested) throw new Error(failure ?? 'Original seller stopped before launch.');
    await new Promise((done, fail) => child.send({ type: 'sf82-start', instanceId }, error => error ? fail(error) : done()));
    let report;
    try { report = await ready; } finally { clearTimeout(startupTimer); }
    if (report.originalOffersSha256 !== record.source.offersSha256 ||
        report.originalServiceConfigSha256 !== record.source.serviceConfigSha256)
      throw new Error('Original pilot reported a different release source.');
    await originalReadback(report.listener, record, mode);
    if (exitSettled || shutdownRequested) throw new Error('Original seller stopped during startup.');
    Object.assign(observation, { listener: report.listener, phase: 'RUNNING', readyAt: new Date().toISOString() });
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
    return { release: publicRelease(record), url: report.listener, mode, child, observation, close, completion };
  } catch (error) {
    failure ??= error.message;
    await stopChild();
    await finish(); throw error;
  }
}
