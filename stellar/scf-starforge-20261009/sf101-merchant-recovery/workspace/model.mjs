// MIT. Operator navigation over the original SF101 recovery and transfer engines.
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, readdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runRemote } from '../remote.mjs';
import { openS3Store } from '../remote-s3.mjs';
import { acquireDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';

export const HOST_SCHEMA = 'stellar-forge.recovery-workspace.v1';
const STATE_SCHEMA = 'stellar-forge.recovery-workspace-state.v1';
const REQUEST_SCHEMA = 'stellar-forge.recovery-workspace-request.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const HEX = /^[a-f0-9]{64}$/;
const PASS_ENV = /^[A-Z][A-Z0-9_]{4,63}$/;
const MAX_JSON = 2 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const inside = (parent, child) => parent === child || child.startsWith(parent + sep);

function need(ok, code, message = code, status = 400) {
  if (!ok) { const error = new Error(message); error.code = code; error.status = status; throw error; }
}
function exact(value, fields, label) {
  need(object(value), 'WORKSPACE_INPUT_INVALID', label + ' must be an object');
  need(Object.keys(value).every(key => fields.includes(key)), 'WORKSPACE_INPUT_INVALID', 'Unknown ' + label + ' field');
  return value;
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'WORKSPACE_PATH_INVALID', label + ' must be a normalized absolute path');
  return value;
}
function identifier(value, label) {
  need(typeof value === 'string' && ID.test(value), 'WORKSPACE_ID_INVALID', 'Invalid ' + label);
  return value;
}
function label(value, fallback) {
  const text = value ?? fallback;
  need(typeof text === 'string' && text.trim().length > 0 && text.length <= 160 &&
    !/[\u0000-\u001f]/.test(text), 'WORKSPACE_LABEL_INVALID');
  return text;
}
function segment(value) {
  need(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 255 &&
    value !== '.' && value !== '..' && !/[\/\\\u0000-\u001f]/.test(value), 'WORKSPACE_BUNDLE_INVALID');
  return value;
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateDirectory(path, create = false) {
  absolute(path, 'Directory');
  if (create && !await exists(path)) await mkdir(path, { mode: 0o700 });
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) &&
    await realpath(path) === path, 'WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'A private real directory is required: ' + path);
  return path;
}
async function privateBytes(path, maximum = MAX_JSON) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= maximum,
      'WORKSPACE_PRIVATE_FILE_REQUIRED', 'A private regular file within its size limit is required: ' + path);
    const value = await fd.readFile();
    need(value.length === stat.size && value.length <= maximum, 'WORKSPACE_FILE_CHANGED');
    return value;
  } finally { await fd.close(); }
}
async function privateJSON(path, maximum) {
  try { return JSON.parse((await privateBytes(path, maximum)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) { error.code = 'WORKSPACE_JSON_INVALID'; error.status = 400; } throw error; }
}
async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomicJSON(path, value) {
  await privateDirectory(dirname(path));
  if (await exists(path)) await privateBytes(path);
  const temporary = join(dirname(path), '.recovery-workspace-' + randomUUID());
  const fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const data = JSON.stringify(value, null, 2) + '\n';
    need(Buffer.byteLength(data) <= MAX_JSON, 'WORKSPACE_RECORD_TOO_LARGE');
    await fd.writeFile(data); await fd.sync();
  } finally { await fd.close(); }
  try { await rename(temporary, path); await syncDirectory(dirname(path)); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function compileHost(value) {
  exact(value, ['schema', 'title', 'profiles'], 'host configuration');
  need(value.schema === HOST_SCHEMA && Array.isArray(value.profiles) &&
    value.profiles.length > 0 && value.profiles.length <= 32, 'WORKSPACE_HOST_CONFIG_INVALID');
  const seen = new Set();
  const profiles = value.profiles.map(input => {
    exact(input, ['id', 'label', 'storeConfig', 'operations', 'passEnv', 'bundleRoots', 'downloadRoot', 'restoreRoot'], 'profile');
    const id = identifier(input.id, 'profile ID');
    need(!seen.has(id), 'WORKSPACE_DUPLICATE_PROFILE'); seen.add(id);
    need(PASS_ENV.test(input.passEnv ?? ''), 'WORKSPACE_PASSPHRASE_NAME_INVALID');
    need(Array.isArray(input.bundleRoots) && input.bundleRoots.length > 0 &&
      input.bundleRoots.length <= 32, 'WORKSPACE_BUNDLE_ROOTS_REQUIRED');
    const roots = new Set();
    const bundleRoots = input.bundleRoots.map(root => {
      exact(root, ['id', 'label', 'directory'], 'bundle root');
      const rootId = identifier(root.id, 'bundle-root ID');
      need(!roots.has(rootId), 'WORKSPACE_DUPLICATE_BUNDLE_ROOT'); roots.add(rootId);
      return { id: rootId, label: label(root.label, rootId), directory: absolute(root.directory, 'Bundle root') };
    });
    return { id, label: label(input.label, id), storeConfig: absolute(input.storeConfig, 'S3 configuration'),
      operations: absolute(input.operations, 'Original operations directory'), passEnv: input.passEnv, bundleRoots,
      downloadRoot: absolute(input.downloadRoot, 'Download root'), restoreRoot: absolute(input.restoreRoot, 'Restore root') };
  });
  return { schema: HOST_SCHEMA, title: label(value.title, 'Merchant recovery'), profiles };
}
function publicError(error) {
  const result = { code: String(error.code ?? 'RECOVERY_WORKSPACE_FAILED').slice(0, 100),
    message: String(error.message ?? 'Recovery operation failed').slice(0, 500) };
  for (const key of ['status', 'providerCode', 'requestId', 'putRequestId', 'retryAfter', 'retryable', 'mayHaveCommitted'])
    if (['string', 'number', 'boolean'].includes(typeof error[key])) result[key] = error[key];
  return result;
}
function cursorPage(names, cursor, limit) {
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'WORKSPACE_PAGE_LIMIT_INVALID');
  if (cursor !== undefined && cursor !== null && cursor !== '') identifier(cursor, 'page cursor');
  const selected = names.sort().filter(name => !cursor || name > cursor);
  return { names: selected.slice(0, limit), nextCursor: selected.length > limit ? selected[limit - 1] : null };
}

// Read the exact host selection without opening a workspace, provider or lease.
// Launchers retain only these path bindings and the original file digests.
export async function readRecoveryConfiguration(configFile) {
  absolute(configFile, 'Host configuration');
  const bytes = await privateBytes(configFile);
  return { configFile, sha256: hash(bytes), host: compileHost(JSON.parse(bytes.toString('utf8'))) };
}

export async function openRecoveryWorkspace({ configFile, directory, readOnly = false } = {}) {
  absolute(directory, 'Workspace');
  const { sha256: configHash, host } = await readRecoveryConfiguration(configFile);
  await privateDirectory(directory, !readOnly);
  const requestRoot = join(directory, 'requests');
  if (!readOnly) await privateDirectory(requestRoot, true);
  else if (await exists(requestRoot)) await privateDirectory(requestRoot);
  for (const profile of host.profiles) {
    need(!inside(directory, profile.operations) && !inside(profile.operations, directory),
      'WORKSPACE_OPERATION_DIRECTORY_OVERLAP');
    for (const root of [...profile.bundleRoots.map(item => item.directory), profile.downloadRoot, profile.restoreRoot]) {
      need(!inside(directory, root) && !inside(root, directory), 'WORKSPACE_SOURCE_DIRECTORY_OVERLAP');
      await privateDirectory(root);
    }
    await privateBytes(profile.storeConfig);
    if (await exists(profile.operations)) await privateDirectory(profile.operations);
  }
  let lease;
  if (!readOnly) lease = await acquireDeliveryLease(directory, { purpose: 'drain' });
  let workspaceState, active = null, closed = false, closing = false;
  let mutations = Promise.resolve();
  const transition = action => {
    const next = mutations.then(action, action);
    mutations = next.catch(() => {});
    return next;
  };
  try {
    const statePath = join(directory, 'workspace.json');
    if (await exists(statePath)) {
      workspaceState = await privateJSON(statePath);
      need(workspaceState.schema === STATE_SCHEMA && workspaceState.configFile === configFile,
        'WORKSPACE_IDENTITY_CHANGED', 'Reopen this workspace with its original host configuration path');
    } else {
      need(!readOnly, 'WORKSPACE_NOT_CREATED', 'Start the workspace once before reading its saved state', 404);
      workspaceState = { schema: STATE_SCHEMA, id: randomUUID(), configFile, createdAt: stamp() };
      await atomicJSON(statePath, workspaceState);
    }
  } catch (error) { await lease?.release(); throw error; }

  function selectedProfile(id) {
    need(!closed, 'WORKSPACE_CLOSED', 'The recovery workspace is closed', 409);
    const profile = host.profiles.find(item => item.id === id);
    need(profile, 'WORKSPACE_PROFILE_NOT_FOUND', 'Unknown host recovery profile', 404);
    return profile;
  }
  async function currentHost() {
    need(hash(await privateBytes(configFile)) === configHash, 'WORKSPACE_HOST_CONFIG_CHANGED',
      'Restart the workspace to load the changed host configuration', 409);
  }
  async function storeHint(profile) {
    const cfg = await privateJSON(profile.storeConfig);
    need(cfg.schema === 'stellar-forge.merchant-recovery-s3.v1', 'WORKSPACE_S3_CONFIG_INVALID');
    return { region: cfg.region, bucket: cfg.bucket, prefix: cfg.prefix ?? '',
      endpoint: cfg.endpoint ?? null, proxyEnvironment: cfg.proxyEnvironment === true };
  }
  async function bundleAt(profile, bundleId) {
    need(typeof bundleId === 'string', 'WORKSPACE_BUNDLE_REQUIRED');
    const slash = bundleId.indexOf('/');
    need(slash > 0, 'WORKSPACE_BUNDLE_INVALID');
    const root = profile.bundleRoots.find(item => item.id === bundleId.slice(0, slash));
    need(root, 'WORKSPACE_BUNDLE_ROOT_NOT_FOUND', 'Unknown host bundle root', 404);
    const name = segment(bundleId.slice(slash + 1));
    const path = join(root.directory, name);
    await privateDirectory(root.directory); await privateDirectory(path);
    const raw = await privateBytes(join(path, 'manifest.json'), MAX_MANIFEST);
    const manifest = JSON.parse(raw.toString('utf8'));
    need(manifest.schema === BUNDLE_SCHEMA && Number.isSafeInteger(manifest.fileCount) &&
      manifest.fileCount >= 0 && Number.isSafeInteger(manifest.totalPlainBytes) &&
      manifest.totalPlainBytes >= 0 && Array.isArray(manifest.roots), 'WORKSPACE_ORIGINAL_BUNDLE_REQUIRED');
    return { bundleId, name, rootId: root.id, rootLabel: root.label, directory: path,
      snapshotId: hash(raw), createdAt: manifest.createdAt, files: manifest.fileCount,
      plainBytes: manifest.totalPlainBytes, roots: manifest.roots.map(item => item.name),
      verification: 'AUTHENTICATED_BY_ORIGINAL_ENGINE_WHEN_USED' };
  }
  async function localBundles(profileId) {
    const profile = selectedProfile(profileId); const bundles = [], errors = [];
    for (const root of profile.bundleRoots) {
      const entries = await readdir(root.directory, { withFileTypes: true });
      need(entries.length <= 10000, 'WORKSPACE_BUNDLE_ROOT_TOO_LARGE', 'Select a more specific host bundle root');
      for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const bundleId = root.id + '/' + entry.name;
        if (!await exists(join(root.directory, entry.name, 'manifest.json'))) continue;
        try { bundles.push(await bundleAt(profile, bundleId)); }
        catch (error) { errors.push({ bundleId, ...publicError(error) }); }
      }
    }
    return { bundles, errors };
  }
  async function operation(profileId, id) {
    const profile = selectedProfile(profileId); identifier(id, 'operation ID');
    return runRemote({ command: 'status', operations: profile.operations, id });
  }
  async function operations(profileId, { cursor, limit = 50 } = {}) {
    const profile = selectedProfile(profileId);
    if (!await exists(profile.operations)) return { operations: [], errors: [], nextCursor: null };
    await privateDirectory(profile.operations);
    const entries = await readdir(profile.operations, { withFileTypes: true });
    const page = cursorPage(entries.filter(item => item.isDirectory() && ID.test(item.name)).map(item => item.name), cursor, limit);
    const rows = [], errors = [];
    for (const id of page.names) {
      try { rows.push(await operation(profileId, id)); }
      catch (error) { errors.push({ operationId: id, ...publicError(error) }); }
    }
    return { operations: rows, errors, nextCursor: page.nextCursor };
  }
  async function inventory(profileId, { cursor, limit = 20 } = {}) {
    const profile = selectedProfile(profileId); await currentHost();
    const store = await openS3Store(profile.storeConfig);
    try { return { ...(await runRemote({ command: 'list', limit, ...(cursor ? { cursor } : {}) }, { store })), observedAt: stamp() }; }
    finally { store.close(); }
  }
  function allowedBundle(profile, path) {
    return profile.bundleRoots.some(root => path !== root.directory && inside(root.directory, path)) ||
      path !== profile.downloadRoot && inside(profile.downloadRoot, path);
  }
  async function selection(input) {
    exact(input, ['profileId', 'action', 'id', 'bundleId', 'snapshotId', 'destinationName'], 'recovery selection');
    const profile = selectedProfile(input.profileId);
    identifier(input.id, 'original operation ID');
    need(['push', 'pull', 'restore', 'resume'].includes(input.action), 'WORKSPACE_ACTION_INVALID');
    await currentHost();
    let options = { command: input.action, config: profile.storeConfig, operations: profile.operations,
      id: input.id, passEnv: profile.passEnv };
    let local = null, original = null;
    if (input.action === 'resume') {
      need(input.bundleId === undefined && input.snapshotId === undefined && input.destinationName === undefined,
        'WORKSPACE_RESUME_SELECTION_CHANGED', 'An original operation resumes its retained selection');
      original = await operation(profile.id, input.id);
      options.command = original.command;
      if (original.command === 'push') options.bundle = original.bundle;
      else {
        options.snapshot = original.snapshotId;
        options.out = original.command === 'restore' ? original.destination : original.bundle;
        if (original.command === 'restore') options.bundleOut = original.bundle;
      }
    } else if (input.action === 'push') {
      need(input.snapshotId === undefined && input.destinationName === undefined, 'WORKSPACE_PUSH_SELECTION_INVALID');
      local = await bundleAt(profile, input.bundleId); options.bundle = local.directory;
    } else {
      need(HEX.test(input.snapshotId ?? ''), 'WORKSPACE_SNAPSHOT_ID_REQUIRED', 'Select an exact remote snapshot');
      options.snapshot = input.snapshotId;
      const name = input.destinationName === undefined || input.destinationName === '' ? input.id :
        identifier(input.destinationName, 'destination name');
      if (input.action === 'pull') {
        need(input.bundleId === undefined, 'WORKSPACE_PULL_SELECTION_INVALID');
        options.out = join(profile.downloadRoot, name);
      } else {
        options.out = join(profile.restoreRoot, name);
        if (input.bundleId !== undefined && input.bundleId !== '') {
          local = await bundleAt(profile, input.bundleId);
          need(local.snapshotId === input.snapshotId, 'WORKSPACE_BUNDLE_SNAPSHOT_MISMATCH');
          options.bundleOut = local.directory;
        } else options.bundleOut = join(profile.downloadRoot, 'restore-' + input.id);
      }
    }
    need(['push', 'pull', 'restore'].includes(options.command), 'WORKSPACE_ORIGINAL_COMMAND_INVALID');
    if (options.bundle) need(allowedBundle(profile, options.bundle), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
    if (options.bundleOut) need(allowedBundle(profile, options.bundleOut), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
    if (options.out) {
      const root = options.command === 'restore' ? profile.restoreRoot : profile.downloadRoot;
      need(options.out !== root && inside(root, options.out), 'WORKSPACE_DESTINATION_OUTSIDE_HOST_ROOT');
    }
    for (const path of [options.bundle, options.bundleOut, options.out].filter(Boolean))
      need(!inside(profile.operations, path) && !inside(path, profile.operations) &&
        !inside(directory, path) && !inside(path, directory), 'WORKSPACE_OPERATION_PATH_OVERLAP');
    if (options.bundleOut) need(!inside(options.bundleOut, options.out) && !inside(options.out, options.bundleOut),
      'WORKSPACE_RESTORE_PATH_OVERLAP');
    const store = await openS3Store(profile.storeConfig);
    let identity;
    try { identity = clone(store.identity); } finally { store.close(); }
    if (original) need(JSON.stringify(original.store) === JSON.stringify(identity), 'WORKSPACE_ORIGINAL_STORE_CHANGED',
      'Select the original store for this retained operation', 409);
    const snapshotId = local?.snapshotId ?? options.snapshot ?? (original?.status === 'COMPLETE' ? original.snapshotId : null) ?? (options.bundle ?
      hash(await privateBytes(join(options.bundle, 'manifest.json'), MAX_MANIFEST)) : original?.snapshotId ?? null);
    if (original?.snapshotId) need(original.snapshotId === snapshotId, 'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED');
    const review = { profileId: profile.id, command: options.command, operationId: options.id,
      store: identity, snapshotId, source: options.bundle ?? options.bundleOut ?? null,
      destination: options.out ?? null, originalStatus: original?.status ?? null,
      files: local?.files ?? original?.files ?? null, plainBytes: local?.plainBytes ?? original?.plainBytes ?? null,
      options };
    const selected = { profileId: review.profileId, command: review.command, operationId: review.operationId,
      store: review.store, snapshotId: review.snapshotId, options: review.options };
    return { ...review, reviewHash: hash(JSON.stringify(selected)), intent: clone(input) };
  }
  const requestPath = (profileId, id) => join(requestRoot, hash(profileId + '\n' + id) + '.json');
  async function readRequest(profileId, id) {
    const path = requestPath(profileId, id);
    if (!await exists(path)) return null;
    const request = await privateJSON(path);
    need(request.schema === REQUEST_SCHEMA && request.review.profileId === profileId &&
      request.review.operationId === id, 'WORKSPACE_REQUEST_IDENTITY_INVALID');
    return request;
  }
  async function requestView(request) {
    let original = null, error = null;
    try { original = await operation(request.review.profileId, request.review.operationId); }
    catch (caught) { if (caught.code !== 'ENOENT') error = publicError(caught); }
    const running = active?.key === requestPath(request.review.profileId, request.review.operationId);
    return { profileId: request.review.profileId, operationId: request.review.operationId,
      review: clone(request.review), createdAt: request.createdAt, updatedAt: request.updatedAt,
      phase: original?.status === 'COMPLETE' ? 'COMPLETE' : running ? 'RUNNING' :
        request.phase === 'RUNNING' ? 'INTERRUPTED' : request.phase,
      running, cancelRequested: running && active.cancelRequested, attempts: request.attempts,
      operation: original, error: error ?? request.error ?? null };
  }
  async function requests({ cursor, limit = 50 } = {}) {
    if (!await exists(requestRoot)) return { requests: [], nextCursor: null };
    const entries = (await readdir(requestRoot)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const page = cursorPage(entries, cursor, limit);
    const rows = [];
    for (const name of page.names) rows.push(await requestView(await privateJSON(join(requestRoot, name))));
    return { requests: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), nextCursor: page.nextCursor };
  }
  async function execute(request, job) {
    let store;
    try {
      let retained = null;
      try { retained = await operation(request.review.profileId, request.review.operationId); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (retained?.status === 'COMPLETE') {
        request.phase = 'COMPLETE'; request.result = retained; request.updatedAt = stamp(); delete request.error;
        await atomicJSON(job.key, request); return;
      }
      request.phase = 'RUNNING'; request.attempts++; request.updatedAt = stamp(); delete request.error;
      await atomicJSON(job.key, request);
      await currentHost();
      const profile = selectedProfile(request.review.profileId);
      if (request.review.command === 'push') need(
        hash(await privateBytes(join(request.review.options.bundle, 'manifest.json'), MAX_MANIFEST)) === request.review.snapshotId,
        'WORKSPACE_ORIGINAL_SNAPSHOT_CHANGED', 'The local bundle changed after this operation was reviewed', 409);
      store = await openS3Store(profile.storeConfig); job.store = store;
      need(JSON.stringify(store.identity) === JSON.stringify(request.review.store), 'WORKSPACE_REVIEW_STORE_CHANGED',
        'The selected store changed after review', 409);
      if (job.cancelRequested) { store.close(); need(false, 'WORKSPACE_CANCELLED', 'Recovery execution was cancelled'); }
      const result = await runRemote(request.review.options, { store });
      request.phase = result.status === 'COMPLETE' ? 'COMPLETE' : 'INTERRUPTED';
      request.result = result; request.updatedAt = stamp(); delete request.error;
      await atomicJSON(job.key, request);
    } catch (error) {
      request.phase = job.cancelRequested ? 'INTERRUPTED' : 'FAILED';
      request.error = publicError(error); request.updatedAt = stamp();
      await atomicJSON(job.key, request).catch(() => {});
    } finally {
      store?.close();
      if (active === job) active = null;
    }
  }
  async function start({ selection: input, expectedReviewHash } = {}) {
    need(!readOnly && !closing, 'WORKSPACE_READ_ONLY', 'This workspace is closing or was opened for reading', 409);
    need(HEX.test(expectedReviewHash ?? ''), 'WORKSPACE_REVIEW_REQUIRED', 'Review the exact selection before starting');
    const reviewed = await selection(input);
    need(!closing, 'WORKSPACE_CLOSING', 'The workspace is closing', 409);
    need(reviewed.reviewHash === expectedReviewHash, 'WORKSPACE_REVIEW_CHANGED',
      'The selection changed. Review it again before starting.', 409);
    const key = requestPath(reviewed.profileId, reviewed.operationId);
    let request = await readRequest(reviewed.profileId, reviewed.operationId);
    if (active) need(active.key === key, 'WORKSPACE_EXECUTION_ACTIVE', 'Finish or cancel the active recovery execution first', 409);
    if (request) {
      need(request.review.snapshotId === reviewed.snapshotId &&
        JSON.stringify(request.review.options) === JSON.stringify(reviewed.options) &&
        JSON.stringify(request.review.store) === JSON.stringify(reviewed.store),
        'WORKSPACE_REQUEST_SELECTION_CHANGED', 'Keep the original operation ID with its original selection', 409);
    } else {
      request = { schema: REQUEST_SCHEMA, review: reviewed, phase: 'PREPARED', attempts: 0,
        createdAt: stamp(), updatedAt: stamp() };
      await atomicJSON(key, request);
    }
    if (active) {
      need(active.key === key, 'WORKSPACE_EXECUTION_ACTIVE', 'Finish or cancel the active recovery execution first', 409);
      return requestView(request);
    }
    const job = { key, profileId: reviewed.profileId, operationId: reviewed.operationId,
      store: null, cancelRequested: false, promise: null };
    active = job; job.promise = execute(request, job);
    return requestView(request);
  }
  async function resume(profileId, id) {
    need(!readOnly && !closing, 'WORKSPACE_READ_ONLY'); selectedProfile(profileId); identifier(id, 'operation ID');
    const request = await readRequest(profileId, id);
    need(request, 'WORKSPACE_REQUEST_NOT_FOUND', 'Review this original operation before adopting it into the workspace', 404);
    if (active) {
      need(active.key === requestPath(profileId, id), 'WORKSPACE_EXECUTION_ACTIVE',
        'Finish or cancel the active recovery execution first', 409);
      return requestView(request);
    }
    await currentHost();
    const profile = selectedProfile(profileId);
    for (const path of [request.review.options.bundle, request.review.options.bundleOut].filter(Boolean))
      need(allowedBundle(profile, path), 'WORKSPACE_BUNDLE_OUTSIDE_HOST_ROOTS');
    const root = request.review.command === 'restore' ? profile.restoreRoot : profile.downloadRoot;
    if (request.review.options.out) need(request.review.options.out !== root &&
      inside(root, request.review.options.out), 'WORKSPACE_DESTINATION_OUTSIDE_HOST_ROOT');
    need(request.review.options.operations === profile.operations && request.review.options.config === profile.storeConfig &&
      request.review.options.passEnv === profile.passEnv, 'WORKSPACE_PROFILE_SELECTION_CHANGED');
    const job = { key: requestPath(profileId, id), profileId, operationId: id, store: null, cancelRequested: false, promise: null };
    active = job; job.promise = execute(request, job);
    return requestView(request);
  }
  async function cancel(profileId, id) {
    selectedProfile(profileId); identifier(id, 'operation ID');
    need(!readOnly, 'WORKSPACE_READ_ONLY');
    const request = await readRequest(profileId, id);
    need(request, 'WORKSPACE_REQUEST_NOT_FOUND', 'Unknown workspace recovery request', 404);
    if (active?.key === requestPath(profileId, id)) {
      active.cancelRequested = true; active.store?.close();
    }
    return requestView(request);
  }
  async function state() {
    const profiles = [];
    for (const profile of host.profiles) profiles.push({ id: profile.id, label: profile.label,
      store: await storeHint(profile), operations: profile.operations,
      bundleRoots: clone(profile.bundleRoots), downloadRoot: profile.downloadRoot, restoreRoot: profile.restoreRoot,
      passEnv: profile.passEnv, passphraseAvailable: typeof process.env[profile.passEnv] === 'string' && process.env[profile.passEnv].length > 0 });
    const page = await requests();
    if (active && !page.requests.some(row => row.profileId === active.profileId && row.operationId === active.operationId)) {
      const request = await readRequest(active.profileId, active.operationId);
      if (request) page.requests.unshift(await requestView(request));
    }
    return { schema: STATE_SCHEMA, id: workspaceState.id, title: host.title, createdAt: workspaceState.createdAt,
      directory, readOnly, profiles, active: active ? { profileId: active.profileId,
        operationId: active.operationId, cancelRequested: active.cancelRequested } : null,
      requests: page.requests, nextRequestsCursor: page.nextCursor };
  }
  async function close({ cancelActive = false } = {}) {
    if (closed) return;
    closing = true;
    await mutations;
    if (cancelActive && active) { active.cancelRequested = true; active.store?.close(); }
    await active?.promise;
    closed = true; await lease?.release();
  }
  return { state, localBundles, operations, operation, inventory, requests, review: selection,
    start: input => transition(() => start(input)),
    resume: (profileId, id) => transition(() => resume(profileId, id)),
    cancel: (profileId, id) => transition(() => cancel(profileId, id)), close };
}
