// MIT. Customer workspace over the original runtime installer and profile authority.
import { constants } from 'node:fs';
import { mkdir, readdir, open, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { prepareRuntimeInstall, installRuntime, inspectRuntimeInstall, upgradeRuntime,
  recoverRuntime, compareRuntimeInstalls, runtimeCommand } from '../runtime-install.mjs';
import { runtimeCatalog, resolveRuntimeProfile } from '../runtime-profile.mjs';
import { plain, now, digest, json, canonical, fail, need, recordId, operationId, absolute,
  privateDirectory, makePrivate, readJSON, saveJSON, workerAlive, processIdentity,
  operationLease, tailFile } from './storage.mjs';

import { imageOperationFields, imageWorkspaceState, reviewWorkspaceImage, attachWorkspaceImage,
  attachWorkspaceImageTransfer, prepareWorkspaceImageTransfer, receiveWorkspaceImageChunk,
  openWorkspaceImageDownload, reviewWorkspaceImageContainer, normalizeImageOperation,
  executeImageOperation } from './image-workspace.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.runtime-workspace.v1';
const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const recordPath = (root, type, id) => join(root, type, recordId(id) + '.json');
const jobPath = (root, id) => join(root, 'operations', operationId(id));
const asError = error => ({ code: error.code ?? 'RUNTIME_WORKSPACE_ERROR', message: String(error.message ?? error).slice(0, 2000) });

async function context(directory) {
  const root = await privateDirectory(absolute(directory));
  const config = await readJSON(join(root, 'workspace.json'));
  need(config.schema === WORKSPACE_SCHEMA && config.directory === root && typeof config.runtimeHome === 'string',
    'RUNTIME_WORKSPACE_CONFIG_INVALID');
  await privateDirectory(config.runtimeHome);
  for (const name of ['archives', 'entries', 'operations', 'observations', 'sources', 'incoming'])
    await privateDirectory(join(root, name));
  return { root, config };
}
export async function createRuntimeWorkspace({ directory, runtimeHome } = {}) {
  const root = await makePrivate(absolute(directory));
  const home = runtimeHome === undefined ? join(root, 'runtimes') : absolute(runtimeHome);
  try { await makePrivate(home); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(home); }
  for (const name of ['archives', 'entries', 'operations', 'observations', 'sources', 'incoming'])
    await mkdir(join(root, name), { mode: 0o700 });
  const config = { schema: WORKSPACE_SCHEMA, workspaceId: randomUUID(), createdAt: now(), directory: root, runtimeHome: home };
  await saveJSON(join(root, 'workspace.json'), config);
  return config;
}
async function records(root, type) {
  const names = (await readdir(join(root, type))).filter(name => /^[a-f0-9]{24}\.json$/.test(name)).sort();
  return Promise.all(names.map(name => readJSON(join(root, type, name))));
}
async function entry(root, id) {
  const value = await readJSON(recordPath(root, 'entries', id));
  need(value.id === id && typeof value.directory === 'string', 'RUNTIME_WORKSPACE_ENTRY_INVALID');
  await privateDirectory(value.directory);
  return value;
}
async function archive(root, id) {
  const value = await readJSON(recordPath(root, 'archives', id));
  need(value.id === id && /^[a-f0-9]{64}$/.test(value.sha256 ?? '') &&
    typeof value.archive === 'string' && typeof value.sourceRoot === 'string', 'RUNTIME_WORKSPACE_ARCHIVE_INVALID');
  return value;
}
async function retainEntry(root, directory, label = basename(directory)) {
  absolute(directory);
  need(typeof label === 'string' && label.trim() && label.length <= 120, 'RUNTIME_WORKSPACE_LABEL_INVALID');
  const id = digest(directory).slice(0, 24), file = recordPath(root, 'entries', id);
  const existing = await readJSON(file, true);
  if (existing) {
    need(existing.directory === directory, 'RUNTIME_WORKSPACE_ENTRY_COLLISION');
    return existing;
  }
  const value = { id, directory, label: label.trim(), createdAt: now() };
  try { await saveJSON(file, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(file);
}
async function retainArchive(root, directory, label) {
  const plan = await readJSON(join(directory, 'runtime-install.json'));
  const catalog = await runtimeCatalog({ sourceRoot: plan.sourceRoot });
  need(catalog.source.sourceCommit === plan.source.sourceCommit, 'RUNTIME_WORKSPACE_ARCHIVE_SOURCE_CHANGED');
  const id = digest(plan.archivePath + '\n' + plan.archiveSha256).slice(0, 24);
  const file = recordPath(root, 'archives', id), existing = await readJSON(file, true);
  if (existing) return existing;
  const value = { id, label: label ?? plan.source.packageVersion, archive: plan.archivePath,
    sha256: plan.archiveSha256, sourceRoot: plan.sourceRoot, sourceCommit: plan.source.sourceCommit,
    packageVersion: plan.source.packageVersion, packageName: plan.source.packageName, createdAt: now() };
  try { await saveJSON(file, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(file);
}
async function retainedView(value) {
  try {
    await privateDirectory(value.directory);
    const [plan, state, preparation, profile, preparationError] = await Promise.all([
      readJSON(join(value.directory, 'runtime-install.json'), true),
      readJSON(join(value.directory, 'install-state.json'), true),
      readJSON(join(value.directory, 'preparation.json'), true),
      readJSON(join(value.directory, 'runtime-profile.json'), true),
      readJSON(join(value.directory, 'prepare-error.json'), true),
    ]);
    return { ...value, phase: state?.phase ?? preparationError?.phase ?? (preparation ? 'PREPARATION' : 'UNAVAILABLE'),
      sourceCommit: plan?.source?.sourceCommit ?? null, packageVersion: plan?.source?.packageVersion ?? null,
      sourceRoot: plan?.sourceRoot ?? null, dependencyRoot: plan?.dependencyRoot ?? null,
      profileId: plan?.profileId ?? null, state, profile, preparation, preparationError,
      archiveSha256: plan?.archiveSha256 ?? preparation?.archiveSha256 ?? null };
  } catch (error) { return { ...value, phase: 'UNAVAILABLE', error: asError(error) }; }
}
async function jobView(root, id) {
  const directory = jobPath(root, id), request = await readJSON(join(directory, 'request.json'), true);
  if (!request) return { id, operation: 'prepare request', phase: 'INITIALIZING', displayPhase: 'INITIALIZING', workerActive: false };
  const state = await readJSON(join(directory, 'state.json'), true) ?? { phase: 'QUEUED' };
  const active = state.phase === 'RUNNING' && await workerAlive(state);
  return { id, operation: request.operation, runtimeId: request.runtimeId ?? request.targetId ?? null,
    targetId: request.targetId ?? null, imageId: request.imageId ?? null, transferId: request.transferId ?? null,
    targetDirectory: request.targetDirectory ?? null, createdAt: request.createdAt,
    contextDirectory: request.contextDirectory ?? null, transferDirectory: request.transferDirectory ?? null,
    containerDirectory: request.containerDirectory ?? null, reviewId: request.reviewId ?? null,
    deploymentReviewId: request.deploymentReviewId ?? null,
    ...state, workerActive: active,
    displayPhase: state.phase === 'RUNNING' && !active ? 'INTERRUPTED' : state.phase };
}
async function spawnWorker(root, id) {
  const log = await open(join(jobPath(root, id), 'worker.log'),
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const child = spawn(process.execPath, [WORKER, '--workspace', root, '--operation', id],
      { detached: true, cwd: root, shell: false, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
}
function selection(value) {
  need(plain(value) && Object.keys(value).every(key => ['native', 'features', 'pins', 'operator'].includes(key)),
    'RUNTIME_WORKSPACE_SELECTION_REQUIRED');
  need(typeof value.native === 'boolean' && typeof value.operator === 'boolean' &&
    Array.isArray(value.features) && value.features.every(x => typeof x === 'string') && plain(value.pins),
    'RUNTIME_WORKSPACE_SELECTION_INVALID');
  return value;
}
function newTarget(config, name) {
  need(typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name),
    'RUNTIME_WORKSPACE_NAME_INVALID', 'Use a new runtime name with letters, digits, dots, underscores or dashes');
  return join(config.runtimeHome, name);
}
const fields = {
  ...imageOperationFields,
  import: ['archive', 'sha256', 'label'],
  prepare: ['archiveId', 'name', 'selection', 'profileId'],
  install: ['runtimeId', 'offline', 'cache', 'nodeHeaders'],
  inspect: ['runtimeId', 'load', 'source'],
  upgrade: ['runtimeId', 'archiveId', 'name', 'selection', 'profileId', 'offline', 'cache', 'nodeHeaders', 'install'],
  recover: ['runtimeId', 'name', 'offline', 'cache', 'nodeHeaders', 'install'],
};

export async function openRuntimeWorkspace({ directory } = {}) {
  const { root, config } = await context(directory);
  const model = {
    directory: root,
    async imagesState() { return imageWorkspaceState(root); },
    async imagesReview(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return reviewWorkspaceImage(root, { ...input, runtimeDirectory: selected.directory });
    },
    async imagesAttach(input) { return attachWorkspaceImage(root, input); },
    async imagesTransferAttach(input) { return attachWorkspaceImageTransfer(root, input); },
    async imagesTransfer(input) { return prepareWorkspaceImageTransfer(root, input); },
    async imagesUpload(input) { return receiveWorkspaceImageChunk(root, input); },
    async imagesDownload(input) { return openWorkspaceImageDownload(root, input); },
    async imagesContainerReview(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return reviewWorkspaceImageContainer(root, { ...input, runtimeDirectory: selected.directory });
    },
    async state({ runtimeId = null } = {}) {
      const [saved, archives, names] = await Promise.all([records(root, 'entries'), records(root, 'archives'), readdir(join(root, 'operations'))]);
      const entries = await Promise.all(saved.map(retainedView));
      const jobs = await Promise.all(names.filter(name => /^[a-f0-9-]{36}$/.test(name)).map(id => jobView(root, id)));
      jobs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      const selected = runtimeId ? entries.find(item => item.id === recordId(runtimeId)) ?? null : entries[0] ?? null;
      const observation = selected ? await readJSON(recordPath(root, 'observations', selected.id), true) : null;
      return { workspaceId: config.workspaceId, directory: root, runtimeHome: config.runtimeHome, archives,
        runtimes: entries.map(({ profile, preparation, ...value }) => value), selected, observation, operations: jobs };
    },
    async attach({ directory: target, label }) {
      const checked = await inspectRuntimeInstall({ directory: absolute(target), load: false });
      const value = await retainEntry(root, checked.directory, label);
      const source = await retainArchive(root, checked.directory, label);
      await saveJSON(recordPath(root, 'observations', value.id), { observedAt: now(), result: checked }, true);
      return { runtimeId: value.id, archiveId: source.id, status: checked.status };
    },
    async catalog(archiveId) {
      const selected = await archive(root, archiveId);
      return { archive: selected, catalog: await runtimeCatalog({ sourceRoot: selected.sourceRoot }) };
    },
    async review({ archiveId, selection: selected }) {
      const source = await archive(root, archiveId);
      return resolveRuntimeProfile({ sourceRoot: source.sourceRoot, ...selection(selected) });
    },
    async receiveArchive({ body, sha256, label, requestId }) {
      operationId(requestId);
      need(/^[a-f0-9]{64}$/.test(sha256 ?? ''), 'RUNTIME_WORKSPACE_ARCHIVE_HASH_REQUIRED');
      need(typeof label === 'string' && label.length > 0 && label.length <= 120, 'RUNTIME_WORKSPACE_LABEL_INVALID');
      const filename = join(root, 'incoming', requestId + '.tgz');
      const output = await open(filename, 'wx', 0o600), hash = createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of body) {
          bytes += chunk.length;
          need(bytes <= 64 * 1024 * 1024, 'RUNTIME_WORKSPACE_UPLOAD_TOO_LARGE', 'Archive exceeds 64 MiB', 413);
          hash.update(chunk); await output.writeFile(chunk);
        }
        need(bytes > 0 && hash.digest('hex') === sha256, 'RUNTIME_WORKSPACE_ARCHIVE_HASH_MISMATCH');
        await output.sync();
      } catch (error) {
        await unlink(filename).catch(() => {});
        throw error;
      } finally { await output.close(); }
      return model.begin({ requestId, operation: 'import', archive: filename, sha256, label });
    },
    async begin(input) {
      need(plain(input) && typeof input.operation === 'string' && Object.hasOwn(fields, input.operation),
        'RUNTIME_WORKSPACE_ACTION_INVALID');
      need(Object.keys(input).every(key => ['requestId', 'operation', ...fields[input.operation]].includes(key)),
        'RUNTIME_WORKSPACE_ACTION_FIELDS_INVALID');
      const id = operationId(input.requestId), request = { ...input };
      delete request.requestId;
      for (const key of ['offline', 'load', 'source', 'install']) if (request[key] !== undefined)
        need(typeof request[key] === 'boolean', 'RUNTIME_WORKSPACE_BOOLEAN_REQUIRED');
      if (request.cache) absolute(request.cache);
      if (request.nodeHeaders !== undefined) absolute(request.nodeHeaders);
      if (request.runtimeId) request.runtimeDirectory = (await entry(root, request.runtimeId)).directory;
      if (['install', 'inspect', 'upgrade', 'recover'].includes(request.operation))
        need(request.runtimeDirectory, 'RUNTIME_WORKSPACE_RUNTIME_REQUIRED');
      if (request.runtimeId && request.operation !== 'inspect') {
        const names = (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
        for (const existingId of names) {
          if (existingId === id) continue;
          const active = await jobView(root, existingId);
          need(!(active.runtimeId === request.runtimeId || active.targetId === request.runtimeId) ||
            !(active.workerActive || active.phase === 'QUEUED'), 'RUNTIME_WORKSPACE_RUNTIME_BUSY',
          'An existing workspace operation is using this runtime; its retained progress is below', 409);
        }
      }
      if (['prepare', 'upgrade'].includes(request.operation)) {
        const source = await archive(root, recordId(request.archiveId));
        const profile = await resolveRuntimeProfile({ sourceRoot: source.sourceRoot, ...selection(request.selection) });
        need(profile.profileId === request.profileId, 'RUNTIME_WORKSPACE_PROFILE_REVIEW_CHANGED',
          'Review the exact archive and profile again before preparation');
        request.archive = source.archive; request.sha256 = source.sha256;
        request.selection = profile.selection;
      }
      if (['prepare', 'upgrade', 'recover'].includes(request.operation)) {
        request.targetDirectory = newTarget(config, request.name);
        request.targetId = digest(request.targetDirectory).slice(0, 24);
      }
      if (request.operation === 'import') {
        absolute(request.archive);
        need(/^[a-f0-9]{64}$/.test(request.sha256 ?? ''), 'RUNTIME_WORKSPACE_ARCHIVE_HASH_REQUIRED');
        need(request.label === undefined || typeof request.label === 'string' && request.label.length <= 120,
          'RUNTIME_WORKSPACE_LABEL_INVALID');
        request.targetDirectory = join(root, 'sources', id);
      }
      if (Object.hasOwn(imageOperationFields, request.operation))
        Object.assign(request, await normalizeImageOperation(root, request, id));
      const operationDirectory = jobPath(root, id), body = canonical(request), requestHash = digest(json(body));
      const previous = await readJSON(join(operationDirectory, 'request.json'), true);
      if (previous) {
        need(previous.requestHash === requestHash, 'RUNTIME_WORKSPACE_REQUEST_ID_REUSED');
        return { operationId: id, runtimeId: previous.targetId ?? previous.runtimeId ?? null,
          imageId: previous.imageId ?? null, transferId: previous.transferId ?? null, reopened: true };
      }
      await makePrivate(operationDirectory);
      await saveJSON(join(operationDirectory, 'request.json'), { ...body, requestHash, createdAt: now() });
      await saveJSON(join(operationDirectory, 'state.json'), { phase: 'QUEUED', updatedAt: now() });
      if (request.targetId) await retainEntry(root, request.targetDirectory, request.name);
      try { await spawnWorker(root, id); }
      catch (error) {
        await saveJSON(join(operationDirectory, 'state.json'), {
          phase: 'QUEUED', updatedAt: now(), error: asError(error), launchPending: true }, true);
        throw error;
      }
      return { operationId: id, runtimeId: request.targetId ?? request.runtimeId ?? null,
        imageId: request.imageId ?? null, transferId: request.transferId ?? null };
    },
    async resumeQueued(operation) {
      const current = await jobView(root, operation);
      need(current.phase === 'QUEUED', 'RUNTIME_WORKSPACE_QUEUED_REQUEST_REQUIRED');
      await spawnWorker(root, operation);
      return { operationId: operation };
    },
    async compare({ before, after }) {
      const [left, right] = await Promise.all([entry(root, before), entry(root, after)]);
      return compareRuntimeInstalls({ before: left.directory, after: right.directory });
    },
    async handoff(runtimeId) {
      const selected = await entry(root, runtimeId);
      const observed = await inspectRuntimeInstall({ directory: selected.directory, load: false });
      need(observed.ready && observed.status === 'READY', 'RUNTIME_WORKSPACE_READY_HANDOFF_REQUIRED');
      const plan = await readJSON(join(selected.directory, 'runtime-install.json'));
      const command = await runtimeCommand({ directory: selected.directory, args: ['source'] });
      return { schema: 'stellar-forge.runtime-deployment-handoff.v1', createdAt: now(),
        installationId: observed.installationId, directory: observed.directory, sourceCommit: observed.sourceCommit,
        packageVersion: observed.packageVersion, profileId: observed.profileId, lockSha256: observed.lockSha256,
        sourceRoot: observed.sourceRoot, dependencyRoot: observed.dependencyRoot, originalCommand: command,
        sourceManifestSha256: plan.source.manifestSha256,
        managedRelease: { packageExport: '@tokenjunkielabs/starforge-merchant/installation/runtime',
          operation: 'adoptMerchantRuntime',
          arguments: { directory: observed.directory, expectedManifest: plan.source.manifestSha256 },
          requiredArgument: 'home',
          commandArguments: ['installation', 'adopt-runtime', observed.directory,
            '--expect-manifest', plan.source.manifestSha256] },
        deployment: { selection: 'existing-host-or-sf46-release-workflow',
          sourceRoot: observed.sourceRoot, dependencyRoot: observed.dependencyRoot,
          runtimeDirectory: observed.directory, preserveAbsoluteDirectory: true } };
    },
    async logs({ runtimeId, operationId: operation } = {}) {
      if (operation) return { name: 'worker.log', ...await tailFile(join(jobPath(root, operation), 'worker.log')) };
      const selected = await entry(root, runtimeId), state = await readJSON(join(selected.directory, 'install-state.json'));
      need(typeof state.logFile === 'string' && /^install-\d+(?:-[a-f0-9-]{36})?\.log$/.test(state.logFile),
        'RUNTIME_WORKSPACE_INSTALL_LOG_UNAVAILABLE', 'This runtime has no npm attempt log yet');
      return { name: state.logFile, ...await tailFile(join(selected.directory, state.logFile)) };
    },
    async close() {},
  };
  return model;
}

/** A detached operator worker keeps the original install alive across browser/server restarts. */
export async function executeRuntimeWorkspaceOperation({ directory, operation: id }) {
  const { root } = await context(directory), operationDirectory = jobPath(root, id);
  await privateDirectory(operationDirectory);
  const lease = await operationLease(join(operationDirectory, 'worker.lock'));
  try {
    const request = await readJSON(join(operationDirectory, 'request.json'));
    const { requestHash, createdAt, ...originalRequest } = request;
    need(digest(json(canonical(originalRequest))) === requestHash, 'RUNTIME_WORKSPACE_REQUEST_CHANGED');
    const previous = await readJSON(join(operationDirectory, 'state.json'));
    if (['SUCCEEDED', 'FAILED'].includes(previous.phase)) return previous;
    need(previous.phase === 'QUEUED', 'RUNTIME_WORKSPACE_INTERRUPTED_REQUEST',
      'Open the retained target runtime and use its original install or recovery operation');
    const started = { phase: 'RUNNING', startedAt: now(), updatedAt: now(), pid: process.pid,
      processStart: await processIdentity() };
    await saveJSON(join(operationDirectory, 'state.json'), started, true);
    try {
      let result;
      const installOptions = { offline: request.offline ?? false, cache: request.cache ?? null,
        ...(request.nodeHeaders ? { nodeHeaders: request.nodeHeaders } : {}) };
      if (Object.hasOwn(imageOperationFields, request.operation)) {
        result = await executeImageOperation(root, request, id);
      } else if (request.operation === 'import') {
        result = await prepareRuntimeInstall({ directory: request.targetDirectory, archive: request.archive, sha256: request.sha256 });
        result = { ...result, archive: await retainArchive(root, request.targetDirectory, request.label) };
      } else if (request.operation === 'prepare') {
        result = await prepareRuntimeInstall({ directory: request.targetDirectory, archive: request.archive,
          sha256: request.sha256, ...request.selection });
        need(result.profileId === request.profileId, 'RUNTIME_WORKSPACE_PREPARED_PROFILE_CHANGED');
      } else if (request.operation === 'install') {
        result = await installRuntime({ directory: request.runtimeDirectory, ...installOptions });
      } else if (request.operation === 'inspect') {
        result = await inspectRuntimeInstall({ directory: request.runtimeDirectory,
          load: request.load ?? false, source: request.source ?? false });
        await saveJSON(recordPath(root, 'observations', request.runtimeId), { observedAt: now(), result }, true);
      } else if (request.operation === 'upgrade') {
        result = await upgradeRuntime({ from: request.runtimeDirectory, directory: request.targetDirectory,
          archive: request.archive, sha256: request.sha256, ...request.selection,
          ...installOptions, install: false });
        need(result.profileId === request.profileId, 'RUNTIME_WORKSPACE_PREPARED_PROFILE_CHANGED');
        if (request.install ?? true) result = { ...result,
          ...await installRuntime({ directory: request.targetDirectory, ...installOptions }) };
      } else if (request.operation === 'recover') {
        result = await recoverRuntime({ from: request.runtimeDirectory, directory: request.targetDirectory,
          ...installOptions, install: request.install ?? true });
      } else fail('RUNTIME_WORKSPACE_ACTION_INVALID');
      if (request.targetId) {
        await retainEntry(root, request.targetDirectory, request.name);
        const plan = await readJSON(join(request.targetDirectory, 'runtime-install.json'), true);
        if (plan) await retainArchive(root, request.targetDirectory, request.name);
      }
      const state = { ...started, phase: 'SUCCEEDED', updatedAt: now(), completedAt: now(), result };
      await saveJSON(join(operationDirectory, 'state.json'), state, true);
      return state;
    } catch (error) {
      const state = { ...started, phase: 'FAILED', updatedAt: now(), completedAt: now(), error: asError(error) };
      await saveJSON(join(operationDirectory, 'state.json'), state, true);
      process.stderr.write(state.error.code + ': ' + state.error.message + '\n');
      return state;
    }
  } finally { await lease.close(); }
}
