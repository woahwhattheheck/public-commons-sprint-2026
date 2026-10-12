// MIT. Managed home operations over the original SF46 installer and runtime attachment.
import { mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applicationEnvironment } from './application-command.mjs';
import { validatePythonManagedCommand, pythonManagedLaunch } from '../python-runtime/application-lifecycle.mjs';
import { activate, rollback, doctor } from '../../sf46-release/product.mjs';
import { inspectMerchantRuntime, adoptMerchantRuntime, inspectInstalledRuntime } from '../../sf46-release/runtime-package.mjs';
import { HOME_SCHEMA, MANIFEST, releaseId, validateId, verifyRelease, atomicFile, withHomeLock } from '../../sf46-release/release-core.mjs';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, recordId, operationId,
  plain, need, digest, json, canonical, now, workerAlive, processIdentity, operationLease } from './storage.mjs';

export const managedOperationFields = Object.freeze({
  'managed-adopt': ['homeId', 'reviewId'],
  'managed-activate': ['homeId', 'releaseId', 'expectedRevision'],
  'managed-rollback': ['homeId', 'expectedRevision'],
  'managed-inspect': ['homeId', 'releaseId', 'load'],
  'managed-doctor': ['homeId', 'releaseId', 'requireNative', 'requiredFeatures'],
  'managed-config-save': ['homeId', 'path', 'content', 'expectedSha256'],
  'managed-run': ['homeId', 'releaseId', 'command', 'args', 'expectedRevision', 'applicationId', 'terminal', 'terminalPython', 'environmentFile', 'environmentSha256', 'pythonCommand'],
});
const TYPES = ['managed-homes', 'managed-reviews', 'managed-observations'];
const pathFor = (root, type, id) => join(root, type, recordId(id) + '.json');
const operationPath = (root, id) => join(root, 'operations', operationId(id));
const hashValue = value => digest(json(canonical(value)));
const asError = error => ({ code: error.code ?? 'MANAGED_HOME_ERROR', message: String(error.message ?? error).slice(0, 2000) });
const same = (left, right) => hashValue(left) === hashValue(right);
const binding = value => Object.fromEntries(['directory', 'installationId', 'profileId', 'profileSha256',
  'lockSha256', 'sourceCommit', 'sourceManifestSha256'].map(key => [key, value[key]]));

export async function initializeManagedWorkspace(root) {
  for (const type of TYPES) {
    try { await makePrivate(join(root, type)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(join(root, type)); }
  }
}
async function homeRecord(root, homeId) {
  await initializeManagedWorkspace(root);
  const record = await readJSON(pathFor(root, 'managed-homes', homeId));
  need(record.id === homeId && absolute(record.directory), 'MANAGED_HOME_RECORD_INVALID');
  return record;
}
async function homeTarget(directory) {
  const target = absolute(directory);
  await realpath(dirname(target)).then(parent => need(parent === dirname(target), 'MANAGED_HOME_REAL_PARENT_REQUIRED'));
  try { await privateDirectory(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return target; }
  const metadata = await readJSON(join(target, 'installation.json'), true);
  const pending = await readJSON(join(target, 'initializing.json'), true);
  need(metadata?.schema === HOME_SCHEMA || pending?.schema === HOME_SCHEMA || !(await readdir(target)).length,
    'MANAGED_HOME_REQUIRED', 'Choose an original managed home or a new empty directory');
  return target;
}
async function releaseMetadata(directory, id, active) {
  validateId(id);
  const root = join(directory, 'releases', id);
  const info = await lstat(root);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(root) === root, 'MANAGED_RELEASE_DIRECTORY_CHANGED');
  const manifest = await readJSON(join(root, MANIFEST));
  need(releaseId(manifest) === id && /^[a-f0-9]{64}$/.test(manifest.digest ?? ''), 'MANAGED_RELEASE_MANIFEST_INVALID');
  return { id, directory: root, digest: manifest.digest, version: manifest.version,
    sourceCommit: manifest.source?.commit, active: active?.releaseId === id,
    runtime: manifest.origin?.runtimeInstallation ?? null, origin: manifest.origin ?? null,
    commands: manifest.commands ?? {}, commandCatalog: manifest.commandCatalog ?? null };
}
async function homeView(record) {
  let metadata = null, active = null, pending = null, releases = [];
  try {
    await privateDirectory(record.directory);
    metadata = await readJSON(join(record.directory, 'installation.json'), true);
    pending = await readJSON(join(record.directory, 'initializing.json'), true);
    if (metadata) {
      need(metadata.schema === HOME_SCHEMA, 'MANAGED_HOME_SCHEMA_CHANGED');
      for (const name of ['config', 'state', 'releases']) {
        const path = join(record.directory, name), stat = await lstat(path);
        need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'MANAGED_HOME_DIRECTORY_CHANGED');
      }
      active = await readJSON(join(record.directory, 'active.json'), true);
      if (active) {
        need(active.schema === 'stellar-forge.active-release.v1' && /^[a-f0-9]{64}$/.test(active.digest ?? ''),
          'MANAGED_HOME_SELECTION_INVALID');
        validateId(active.releaseId);
        if (active.previousReleaseId !== null) validateId(active.previousReleaseId);
      }
      const names = (await readdir(join(record.directory, 'releases'))).filter(name => !name.startsWith('.install-')).sort();
      releases = await Promise.all(names.map(id => releaseMetadata(record.directory, id, active)));
      need(!active || releases.some(item => item.id === active.releaseId && item.digest === active.digest),
        'MANAGED_HOME_SELECTION_CHANGED');
    } else need(pending?.schema === HOME_SCHEMA || !(await readdir(record.directory)).length, 'MANAGED_HOME_REQUIRED');
  } catch (error) { if (error.code !== 'ENOENT' || metadata) throw error; }
  const revision = hashValue({ metadata, active, releases: releases.map(({ id, digest }) => ({ id, digest })) });
  return { ...record, phase: metadata ? (active ? 'MANAGED' : 'STAGED') : pending ? 'INITIALIZING' : 'NEW',
    revision, active, releases, selected: releases.find(item => item.active) ?? null,
    configDirectory: join(record.directory, 'config'), stateDirectory: join(record.directory, 'state') };
}
export async function openManagedHome(root, { directory, label } = {}) {
  await initializeManagedWorkspace(root);
  const target = await homeTarget(directory), name = label?.trim() || basename(target);
  need(typeof name === 'string' && name.length <= 120, 'MANAGED_HOME_LABEL_INVALID');
  const id = digest(target).slice(0, 24), path = pathFor(root, 'managed-homes', id);
  const existing = await readJSON(path, true);
  need(!existing || existing.directory === target, 'MANAGED_HOME_ID_COLLISION');
  if (!existing) {
    try { await saveJSON(path, { id, directory: target, label: name, createdAt: now() }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return { homeId: id, reopened: Boolean(existing), home: await homeView(await homeRecord(root, id)) };
}
export async function managedState(root, { homeId = null } = {}) {
  await initializeManagedWorkspace(root);
  const names = (await readdir(join(root, 'managed-homes'))).filter(name => /^[a-f0-9]{24}\.json$/.test(name)).sort();
  const homes = await Promise.all(names.map(async name => {
    const record = await readJSON(join(root, 'managed-homes', name));
    try { return await homeView(record); }
    catch (error) { return { ...record, phase: 'UNAVAILABLE', error: asError(error), releases: [], active: null }; }
  }));
  const selected = homeId ? homes.find(item => item.id === recordId(homeId)) ?? null : homes[0] ?? null;
  const reviews = [];
  if (selected) {
    const names = (await readdir(join(root, 'managed-reviews'))).filter(name => /^[a-f0-9]{24}\.json$/.test(name));
    for (const name of names) {
      const review = await readJSON(join(root, 'managed-reviews', name));
      if (review.homeId === selected.id) reviews.push({ ...review, current: review.homeRevision === selected.revision });
    }
    reviews.sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || a.id.localeCompare(b.id));
  }
  return { homes, selected, reviews: reviews.slice(0, 100),
    observation: selected ? await readJSON(pathFor(root, 'managed-observations', selected.id), true) : null };
}
export async function reviewManagedAdoption(root, { homeId, runtimeId, runtimeDirectory } = {}) {
  const home = await homeView(await homeRecord(root, homeId));
  recordId(runtimeId);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  need(home.directory !== runtime.directory && !home.directory.startsWith(runtime.directory + '/'), 'MANAGED_HOME_OUTSIDE_RUNTIME_REQUIRED');
  const review = { schema: 'stellar-forge.managed-runtime-review.v1', homeId, homeDirectory: home.directory,
    homeRevision: home.revision, runtimeId, runtimeDirectory, runtime: binding(runtime), summary: runtime,
    behavior: home.active ? 'STAGE' : 'FIRST_ACTIVE' };
  const id = hashValue(review).slice(0, 24), file = pathFor(root, 'managed-reviews', id);
  if (!await readJSON(file, true)) {
    try { await saveJSON(file, { ...review, id, reviewedAt: now() }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return readJSON(file);
}
async function configPath(home, relative, { create = false } = {}) {
  need(typeof relative === 'string' && relative.length <= 400 && relative.split('/').every(part =>
    part && part !== '.' && part !== '..' && /^[A-Za-z0-9_. -]+$/.test(part)),
  'MANAGED_CONFIG_PATH_INVALID', 'Choose a relative configuration file inside this managed home');
  const base = join(home, 'config');
  await privateDirectory(home);
  const parent = dirname(join(base, relative));
  const stat = await lstat(base);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(base) === base, 'MANAGED_CONFIG_DIRECTORY_CHANGED');
  need(await realpath(parent) === parent, 'MANAGED_CONFIG_DIRECTORY_CHANGED');
  const path = join(base, relative);
  try {
    const file = await lstat(path);
    need(file.isFile() && !file.isSymbolicLink() && file.nlink === 1, 'MANAGED_CONFIG_FILE_INVALID');
  } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
  return path;
}
export async function managedConfig(root, { homeId, path: relative } = {}) {
  const home = await homeView(await homeRecord(root, homeId));
  need(home.phase === 'MANAGED' || home.phase === 'STAGED', 'MANAGED_HOME_INSTALL_REQUIRED');
  if (relative !== undefined) {
    const path = await configPath(home.directory, relative, { create: true });
    let bytes = null;
    try { bytes = await regular(path, 20000); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { homeId, path: relative, exists: Boolean(bytes), sha256: bytes ? digest(bytes) : null,
      content: bytes ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : '', bytes: bytes?.length ?? 0 };
  }
  const files = [];
  async function walk(directory, prefix, depth) {
    if (depth > 5 || files.length >= 200) return;
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const name = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), name, depth + 1);
      else if (item.isFile()) {
        const stat = await lstat(join(directory, item.name));
        files.push({ path: name, bytes: stat.size, editable: stat.size <= 20000 });
      }
      if (files.length >= 200) break;
    }
  }
  await walk(home.configDirectory, '', 0);
  return { homeId, directory: home.configDirectory, files, limit: 200 };
}
export async function normalizeManagedOperation(root, request) {
  const home = await homeView(await homeRecord(root, recordId(request.homeId)));
  need(home.phase !== 'UNAVAILABLE', 'MANAGED_HOME_UNAVAILABLE');
  request.homeDirectory = home.directory;
  if (request.operation === 'managed-adopt') {
    const review = await readJSON(pathFor(root, 'managed-reviews', request.reviewId));
    need(review.homeId === home.id && review.homeDirectory === home.directory && review.homeRevision === home.revision,
      'MANAGED_REVIEW_CHANGED', 'Review this ready runtime against the current managed home again', 409);
    request.runtimeId = review.runtimeId; request.runtimeDirectory = review.runtimeDirectory;
    request.runtimeBinding = review.runtime; request.expectedManifest = review.runtime.sourceManifestSha256;
    request.expectedActive = home.active;
    return request;
  }
  need(home.phase === 'MANAGED' || home.phase === 'STAGED', 'MANAGED_HOME_INSTALL_REQUIRED');
  if (['managed-activate', 'managed-rollback', 'managed-run'].includes(request.operation)) {
    need(request.expectedRevision === home.revision, 'MANAGED_HOME_REVIEW_CHANGED',
      'Refresh the managed home and review its current release selection', 409);
    request.expectedActive = home.active;
  }
  if (request.operation === 'managed-config-save') {
    need(typeof request.content === 'string' && Buffer.byteLength(request.content) <= 20000 &&
      (request.expectedSha256 === null || /^[a-f0-9]{64}$/.test(request.expectedSha256 ?? '')), 'MANAGED_CONFIG_REVIEW_REQUIRED');
    await configPath(home.directory, request.path, { create: true });
    if (request.path.endsWith('.json')) {
      try { JSON.parse(request.content); } catch { need(false, 'MANAGED_CONFIG_JSON_INVALID'); }
    }
    request.contentSha256 = digest(Buffer.from(request.content));
    return request;
  }
  if (request.operation === 'managed-rollback') {
    need(home.active?.previousReleaseId, 'MANAGED_PREVIOUS_RELEASE_REQUIRED');
    request.releaseId = home.active.previousReleaseId;
  }
  const selected = home.releases.find(item => item.id === (request.releaseId ?? home.active?.releaseId));
  need(selected, 'MANAGED_RELEASE_REQUIRED', 'Choose an installed release');
  request.releaseId = selected.id; request.releaseDirectory = selected.directory; request.releaseDigest = selected.digest;
  if (request.operation === 'managed-inspect')
    need(request.load === undefined || typeof request.load === 'boolean', 'MANAGED_LOAD_BOOLEAN_REQUIRED');
  if (request.operation === 'managed-doctor') {
    need(request.requireNative === undefined || typeof request.requireNative === 'boolean', 'MANAGED_NATIVE_BOOLEAN_REQUIRED');
    request.requiredFeatures ??= [];
    need(Array.isArray(request.requiredFeatures) && request.requiredFeatures.length <= 100 &&
      request.requiredFeatures.every(item => typeof item === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(item)),
    'MANAGED_FEATURE_LIST_INVALID');
  }
  if (request.operation === 'managed-run') {
    need(request.terminal === undefined || typeof request.terminal === 'boolean', 'MANAGED_TERMINAL_BOOLEAN_REQUIRED');
    if (request.applicationId !== undefined) recordId(request.applicationId);
    if (request.terminalPython !== undefined) { need(request.terminal === true, 'MANAGED_TERMINAL_REQUIRED'); absolute(request.terminalPython); }
    if (request.environmentFile !== undefined) {
      absolute(request.environmentFile);
      const environment = await applicationEnvironment(request.environmentFile, request.environmentSha256);
      request.environmentSha256 = environment.sha256;
    } else need(request.environmentSha256 === undefined, 'MANAGED_ENVIRONMENT_FILE_REQUIRED');
    if (request.pythonCommand) await validatePythonManagedCommand(root, request, selected);
    else need(typeof request.command === 'string' && Object.hasOwn(selected.commands, request.command), 'MANAGED_ORIGINAL_COMMAND_REQUIRED');
    need(Array.isArray(request.args) && request.args.length <= 100 && request.args.every(arg =>
      typeof arg === 'string' && !arg.includes('\0') && Buffer.byteLength(arg) <= 8000) &&
      Buffer.byteLength(json(request.args)) <= 20000, 'MANAGED_COMMAND_ARGUMENTS_INVALID');
  }
  return request;
}
export async function managedCommandAlive(state) {
  return state?.commandProcess ? workerAlive(state.commandProcess) : false;
}
async function checkedRelease(request) {
  const release = await verifyRelease(request.releaseDirectory, request.releaseDigest);
  need(release.id === request.releaseId, 'MANAGED_RELEASE_CHANGED');
  return release;
}
async function runOriginalCommand(root, request, operationDirectory, checkpoint, leaseFd) {
  await checkedRelease(request);
  const existingResult = await readJSON(join(operationDirectory, 'command-result.json'), true);
  if (existingResult) return existingResult;
  const argv = [join(request.releaseDirectory, 'forge.mjs'), 'run', request.command, '--', ...request.args];
  const launchFile = join(operationDirectory, 'command-launch.json');
  need(!await readJSON(launchFile, true), 'MANAGED_COMMAND_ALREADY_LAUNCHED',
    'Reopen the retained command process and output for this operation');
  const launch = request.pythonCommand ? await pythonManagedLaunch(root, request, { leaseFd }) : {
    schema: 'stellar-forge.managed-command-launch.v1', createdAt: now(),
    releaseId: request.releaseId, digest: request.releaseDigest, executable: process.execPath, args: argv,
    cwd: request.homeDirectory,
  };
  await saveJSON(launchFile, launch);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./managed-command.mjs', import.meta.url)),
    '--operation', operationDirectory], { cwd: request.homeDirectory, shell: false,
      stdio: ['ignore', 'inherit', 'inherit', leaseFd] });
  const outcome = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  outcome.catch(() => {});
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const commandProcess = { pid: child.pid, processStart: await processIdentity(child.pid), role: 'original-command-runner',
    executable: process.execPath, args: launch.args, cwd: launch.cwd };
  try { await checkpoint({ commandProcess }); }
  catch (error) { child.kill('SIGTERM'); await outcome.catch(() => {}); throw error; }
  await outcome;
  const result = await readJSON(join(operationDirectory, 'command-result.json'), true);
  need(result, 'MANAGED_COMMAND_RESULT_UNAVAILABLE', 'Reopen the original command and retained output');
  return result;
}
export async function executeManagedOperation({ root, request, operationDirectory, checkpoint, leaseFd }) {
  await homeRecord(root, request.homeId);
  let result;
  if (request.operation === 'managed-adopt') {
    const runtime = await inspectMerchantRuntime(request.runtimeDirectory, { expectedManifest: request.expectedManifest, load: false });
    need(same(binding(runtime), request.runtimeBinding), 'MANAGED_RUNTIME_REVIEW_CHANGED');
    // Original adoption stages later releases, reuses original files, and attaches under the original home lock.
    result = await adoptMerchantRuntime({ directory: request.runtimeDirectory, home: request.homeDirectory,
      expectedManifest: request.expectedManifest });
  } else if (request.operation === 'managed-activate') {
    await checkedRelease(request);
    result = await activate(request.homeDirectory, request.releaseId, { expectedActive: request.expectedActive });
  } else if (request.operation === 'managed-rollback') {
    await checkedRelease(request);
    result = await rollback(request.homeDirectory, { expectedActive: request.expectedActive });
    need(result.releaseId === request.releaseId, 'MANAGED_ROLLBACK_TARGET_CHANGED');
  } else if (request.operation === 'managed-inspect') {
    const release = await checkedRelease(request);
    const runtime = release.manifest.origin?.runtimeInstallation ?
      await inspectInstalledRuntime({ home: request.homeDirectory, releaseId: request.releaseId, load: request.load ?? false }) : null;
    result = { releaseId: release.id, digest: release.manifest.digest, sourceCommit: release.manifest.source.commit,
      files: release.files.length, bytes: release.totalBytes, sourceVerified: true,
      runtime, commands: release.manifest.commands, commandCatalog: release.manifest.commandCatalog ?? null };
  } else if (request.operation === 'managed-doctor') {
    await checkedRelease(request);
    result = await doctor(request.releaseDirectory, { requireNative: request.requireNative ?? false,
      requiredFeatures: request.requiredFeatures });
  } else if (request.operation === 'managed-config-save') {
    result = await withHomeLock(request.homeDirectory, async home => {
      const path = await configPath(home, request.path, { create: true });
      let before = null;
      try { before = digest(await regular(path, 20000)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (before === request.contentSha256)
        return { path: request.path, sha256: before, bytes: Buffer.byteLength(request.content), reopened: true };
      need(before === request.expectedSha256, 'MANAGED_CONFIG_CHANGED', 'Open the current file before saving another edit', 409);
      await atomicFile(path, Buffer.from(request.content), 0o600);
      return { path: request.path, previousSha256: before, sha256: request.contentSha256, bytes: Buffer.byteLength(request.content) };
    });
  } else if (request.operation === 'managed-run') result = await runOriginalCommand(root, request, operationDirectory, checkpoint, leaseFd);
  else need(false, 'MANAGED_OPERATION_INVALID');
  await saveJSON(pathFor(root, 'managed-observations', request.homeId),
    { operationId: basename(operationDirectory), operation: request.operation, observedAt: now(), result }, true);
  return result;
}
export async function stopManagedCommand(root, id) {
  const directory = operationPath(root, id), request = await readJSON(join(directory, 'request.json'));
  need(request.operation === 'managed-run', 'MANAGED_COMMAND_REQUIRED');
  const state = await readJSON(join(directory, 'state.json'));
  if (!['QUEUED', 'RUNNING'].includes(state.phase)) return { operationId: id, phase: state.phase, stopped: false, reopened: true };
  if (state.phase === 'QUEUED') {
    let lease;
    try {
      lease = await operationLease(join(directory, 'worker.lock'));
      const latest = await readJSON(join(directory, 'state.json'));
      if (latest.phase === 'QUEUED') {
        const result = { operation: 'original-command', releaseId: request.releaseId, digest: request.releaseDigest,
          command: request.command, args: request.args, cwd: request.homeDirectory,
          state: 'STOPPED', stopped: true, launched: false, exitCode: null, signal: null, completedAt: now() };
        await saveJSON(join(directory, 'command-result.json'), result);
        await saveJSON(join(directory, 'state.json'), { ...latest, phase: 'SUCCEEDED', updatedAt: now(),
          completedAt: result.completedAt, result }, true);
        return { operationId: id, phase: 'SUCCEEDED', stopped: true, result };
      }
    } catch (error) { if (error.code !== 'RUNTIME_WORKSPACE_OPERATION_RUNNING') throw error; }
    finally { if (lease) await lease.close(); }
  }
  const path = join(directory, 'stop.json');
  if (!await readJSON(path, true)) {
    try { await saveJSON(path, { requestedAt: now(), signal: 'SIGTERM' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (await managedCommandAlive(state)) {
    try { process.kill(state.commandProcess.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return { operationId: id, phase: state.phase, stopRequested: true };
}
export async function recoverManagedOperation(root, id) {
  const directory = operationPath(root, id), lease = await operationLease(join(directory, 'worker.lock'));
  try {
    const request = await readJSON(join(directory, 'request.json'));
    need(Object.hasOwn(managedOperationFields, request.operation), 'MANAGED_OPERATION_REQUIRED');
    const state = await readJSON(join(directory, 'state.json'));
    const commandResult = request.operation === 'managed-run' ? await readJSON(join(directory, 'command-result.json'), true) : null;
    if (commandResult && state.phase !== 'SUCCEEDED') {
      await saveJSON(join(directory, 'state.json'), { ...state, phase: 'SUCCEEDED', completedAt: commandResult.completedAt,
        updatedAt: now(), result: commandResult, recoveredFrom: state.phase }, true);
      return { operationId: id, phase: 'SUCCEEDED', result: commandResult, reopened: true };
    }
    if (state.phase === 'SUCCEEDED') return { operationId: id, phase: state.phase, reopened: true };
    need(!await workerAlive(state), 'RUNTIME_WORKSPACE_OPERATION_RUNNING');
    if (request.operation === 'managed-run' && await readJSON(join(directory, 'command-launch.json'), true)) {
      if (await managedCommandAlive(state))
        return { operationId: id, phase: 'RUNNING', commandActive: true, reopened: true };
      const result = { operation: 'original-command', releaseId: request.releaseId,
        command: request.command, args: request.args, state: state.commandProcess ? 'RECONCILED' : 'OUTCOME_UNAVAILABLE', exitCode: null,
        stopRequested: Boolean(await readJSON(join(directory, 'stop.json'), true)),
        message: state.commandProcess ? 'The recorded process has ended. Its original output is retained in worker.log.' :
          'The launch record has no retained process identity. Original output and host status supply its operating outcome.' };
      await saveJSON(join(directory, 'state.json'), { ...state, phase: 'SUCCEEDED', completedAt: now(),
        updatedAt: now(), result, recoveredFrom: state.phase }, true);
      return { operationId: id, phase: 'SUCCEEDED', reconciled: true, result };
    }
    // These original operations are idempotent or use a retained source/selection/file guard.
    const attempt = (state.attempt ?? 1) + 1;
    await saveJSON(join(directory, 'state.json'), { phase: 'QUEUED', updatedAt: now(), attempt,
      previousAttempt: { phase: state.phase, startedAt: state.startedAt ?? null, completedAt: state.completedAt ?? null,
        error: state.error ?? null } }, true);
    return { operationId: id, phase: 'QUEUED', resume: true };
  } finally { await lease.close(); }
}
