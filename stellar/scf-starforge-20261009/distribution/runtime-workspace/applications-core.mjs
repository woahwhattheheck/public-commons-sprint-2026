// MIT. Application lifecycle over the original READY runtime and managed-command worker.
import { readDistributionSpecification } from '../specification.mjs';
import { readdir, lstat, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { managedState, managedHome, openManagedHome, reviewManagedAdoption } from './managed-workspace.mjs';
import { applicationRunPage, applicationHistoryLimit } from './application-history.mjs';
import { readApplicationTerminal, sendApplicationTerminal } from './application-command.mjs';
import { applicationEnvironment } from './application-environment.mjs';
import { defaultApplicationProviders, applicationProviderForKind } from './application-providers.mjs';
import { prepareProviderApplication, retainedApplicationArguments } from './application-provider.mjs';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, recordId, operationId,
  operationLease, operationRunning, tailFile, plain, need, digest, json, canonical, now } from './storage.mjs';


const SCHEMA = 'stellar-forge.runtime-application.v1';
const TYPES = ['applications', 'application-reviews', 'application-homes', 'application-resource-locks'];
const bindingKeys = ['directory', 'installationId', 'profileId', 'profileSha256', 'lockSha256', 'sourceCommit', 'sourceManifestSha256'];
const binding = value => Object.fromEntries(bindingKeys.map(key => [key, value[key]]));
const hash = value => digest(json(canonical(value)));
const errorView = error => ({ code: error.code ?? 'APPLICATION_ERROR', message: String(error.message ?? error).slice(0, 2000) });
const directoryFor = (root, id) => join(root, 'applications', recordId(id));
const reviewPath = (root, id) => join(root, 'application-reviews', recordId(id) + '.json');
const operationPath = (root, id) => join(root, 'operations', operationId(id));
const uuidFrom = value => {
  const id = digest(value);
  return id.slice(0, 8) + '-' + id.slice(8, 12) + '-4' + id.slice(13, 16) + '-a' + id.slice(17, 20) + '-' + id.slice(20, 32);
};

export async function initializeApplications(root) {
  for (const name of TYPES) {
    try { await makePrivate(join(root, name)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(join(root, name)); }
  }
}
async function applicationSelection(kind, providerId = null, expected = null) {
  return applicationProviderForKind(kind, { id: providerId, expected });
}
async function inputPath(value, type = 'directory', missing = false, privateOnly = false) {
  const path = absolute(value);
  need(await realpath(dirname(path)) === dirname(path), 'APPLICATION_REAL_PARENT_REQUIRED');
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !missing) throw error;
    if (privateOnly) await privateDirectory(dirname(path));
    return { path, kind: type, exists: false, parent: await realpath(dirname(path)) };
  }
  need(!info.isSymbolicLink() && await realpath(path) === path &&
    (type === 'file' ? info.isFile() : info.isDirectory()), 'APPLICATION_INPUT_PATH_INVALID');
  if (privateOnly && type === 'directory') await privateDirectory(path);
  const valueInfo = { path, kind: type, exists: true, dev: info.dev, ino: info.ino };
  if (type === 'file') {
    Object.assign(valueInfo, { bytes: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
    if (info.size <= 4 * 1024 * 1024) valueInfo.sha256 = digest(await regular(path, 4 * 1024 * 1024));
  }
  return valueInfo;
}
async function selectedExecutable(value) {
  const executable = absolute(value);
  need(await realpath(dirname(executable)) === dirname(executable), 'APPLICATION_REAL_PARENT_REQUIRED');
  const info = await lstat(executable);
  need(info.isFile() || info.isSymbolicLink(), 'APPLICATION_EXECUTABLE_REQUIRED');
  const target = await realpath(executable), inputs = [await inputPath(target, 'file')];
  if (info.isSymbolicLink()) inputs.push({ path: executable, kind: 'executable-link', exists: true,
    target, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  const configuration = join(dirname(dirname(executable)), 'pyvenv.cfg');
  try { inputs.push(await inputPath(configuration, 'file')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await access(executable, constants.X_OK);
  return { executable, inputs };
}
function normalizeSettings(type, input, provider) {
  need(plain(input) && Object.keys(input).every(name => type.fields.some(field => field.name === name)), 'APPLICATION_SETTINGS_INVALID');
  const settings = {};
  for (const item of type.fields) {
    let value = input[item.name];
    if (item.type === 'boolean') { need(value === undefined || typeof value === 'boolean', 'APPLICATION_BOOLEAN_REQUIRED'); if (value) settings[item.name] = true; continue; }
    if (item.type === 'port') {
      value = value === undefined || value === '' ? 0 : typeof value === 'number' ? value : Number(value);
      need(Number.isInteger(value) && value >= 0 && value <= 65535, 'APPLICATION_PORT_INVALID');
      settings[item.name] = value; continue;
    }
    if (value === undefined || value === '') { need(!item.required, 'APPLICATION_SETTING_REQUIRED', item.label + ' is required'); continue; }
    need(typeof value === 'string' && value.length <= 4096 && value.trim() === value && !value.includes('\0'), 'APPLICATION_SETTING_INVALID');
    if (item.type === 'path') absolute(value);
    settings[item.name] = value;
  }
  provider.validateSettings?.(type, settings);
  return settings;
}
async function applicationCommand(selected, settings, runtimeDirectory, context = {}) {
  return prepareProviderApplication(selected.provider, selected.entry, settings, {
    ...context, runtimeDirectory, inputPath, selectedExecutable, applicationEnvironment,
  });
}
function resourceKey(selection, settings) {
  const type = selection.entry;
  const selected = selection.provider.resourceKey?.(type, settings, { hash });
  if (selected !== undefined) return selected;
  const value = settings.outputParent ?? settings.workspaceDirectory ?? settings.directory ??
    settings.outputDirectory ?? settings.stateDirectory ?? settings.datasetFile;
  return hash({ family: type.id, directory: value });
}
function applicationResourceKeys(value) {
  const keys = value.resourceKeys ?? [value.resourceKey];
  need(Array.isArray(keys) && keys.length >= 1 && keys.length <= 16 &&
    keys.every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)) &&
    keys.includes(value.resourceKey) && new Set(keys).size === keys.length,
    'APPLICATION_RESOURCES_CHANGED', 'Keep the complete reviewed original workspace selection.');
  return [...keys].sort();
}
async function withApplicationResources(root, selected, work) {
  const leases = []; let failure;
  try {
    for (const key of applicationResourceKeys(selected))
      leases.push(await operationLease(join(root, 'application-resource-locks', key + '.lock')));
    return await work();
  } catch (error) { failure = error; throw error; }
  finally {
    const results = await Promise.allSettled(leases.reverse().map(lease => lease.close()));
    const rejected = results.find(result => result.status === 'rejected');
    if (!failure && rejected) throw rejected.reason;
  }
}
async function application(root, id) {
  const value = await readJSON(join(directoryFor(root, id), 'application.json'));
  need(value.schema === SCHEMA && value.id === id && /^[a-f0-9]{64}$/.test(value.revision), 'APPLICATION_RECORD_CHANGED');
  return value;
}
async function runCancellation(root, appId, id) {
  return readJSON(join(directoryFor(root, appId), 'runs', operationId(id) + '.cancel.json'), true);
}
async function operationView(root, id) {
  const directory = operationPath(root, id);
  const request = await readJSON(join(directory, 'request.json'), true);
  const state = await readJSON(join(directory, 'state.json'), true);
  const active = Boolean(state) && await operationRunning(join(directory, 'worker.lock'));
  const result = await readJSON(join(directory, 'command-result.json'), true);
  const stop = await readJSON(join(directory, 'stop.json'), true);
  const url = await readJSON(join(directory, 'application-url.json'), true);
  return { id, request, state, result, active, stop,
    phase: !request ? 'PENDING' : !state ? 'QUEUED' : state.phase === 'RUNNING' && !active ? 'INTERRUPTED' : state.phase,
    url: url?.operationId === id ? url : null };
}
async function runs(root, id) {
  const directory = join(directoryFor(root, id), 'runs');
  const names = (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  const saved = await Promise.all(names.map(name => readJSON(join(directory, name))));
  saved.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return saved;
}
const unfinished = value => value.active || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(value.phase);
async function busyApplication(root, id) {
  const saved = await runs(root, id);
  for (const run of saved) {
    if (await runCancellation(root, id, run.id)) continue;
    const value = await operationView(root, run.id);
    if (unfinished(value)) return value;
  }
  return null;
}
async function selectedRelease(root, saved, homes = null) {
  // This map belongs to one overview request, never to a lifecycle action.
  if (homes && !homes.has(saved.homeId)) homes.set(saved.homeId, managedHome(root, saved.homeId));
  const home = await (homes ? homes.get(saved.homeId) : managedHome(root, saved.homeId));
  const release = home?.releases.find(item => item.runtime &&
    bindingKeys.every(key => item.runtime[key] === saved.runtime[key]));
  return { home, release };
}
async function runViews(root, applicationId, history) {
  return Promise.all(history.map(async run => {
    const cancelled = await runCancellation(root, applicationId, run.id);
    const observed = cancelled ? { id: run.id, phase: 'CANCELLED', active: false, result: cancelled } : await operationView(root, run.id);
    return { id: run.id, createdAt: run.createdAt, revision: run.revision, command: run.request.command,
      args: run.request.args, terminal: run.request.terminal === true,
      applicationProvider: run.request.applicationProvider ?? null, ...observed,
      request: undefined, privateUrl: observed.active && !observed.stop ? observed.url?.url ?? null : null,
      privateLinks: observed.active && !observed.stop && Array.isArray(observed.url?.links) ? observed.url.links : [] };
  }));
}
async function view(root, saved, { homes = null, historyLimit = 30 } = {}) {
  const [{ home, release }, page] = await Promise.all([
    selectedRelease(root, saved, homes),
    applicationRunPage(root, { applicationId: saved.id, limit: historyLimit }),
  ]);
  const rows = await runViews(root, saved.id, page.runs);
  const current = rows[0] ?? null;
  const adoption = !release && saved.adoption ? await operationView(root, saved.adoption.requestId) : null;
  const phase = !release ? 'CONNECTING' : !current ? 'READY' :
    current.active ? current.stop ? 'STOPPING' : current.url ? 'RUNNING' : 'STARTING' :
      ['SUCCEEDED', 'CANCELLED'].includes(current.phase) ? current.result?.state === 'EXITED' || current.result?.state === 'LAUNCH_FAILED' ? 'FAILED' : 'STOPPED' :
        current.phase;
  return { ...saved, phase, release: release ? { id: release.id, digest: release.digest, sourceCommit: release.sourceCommit } : null,
    home: home ? { id: home.id, directory: home.directory, revision: home.revision, phase: home.phase } : null,
    adoption, current, runs: rows, totalRuns: page.totalRuns,
    history: { limit: page.limit, nextCursor: page.nextCursor } };
}
export async function applicationsState(root, { historyLimit = 30 } = {}) {
  historyLimit = applicationHistoryLimit(historyLimit);
  await initializeApplications(root);
  const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
  const homes = new Map();
  const items = await Promise.all(names.map(async id => {
    try { return await view(root, await application(root, id), { homes, historyLimit }); }
    catch (error) { return { id, label: id, phase: 'UNAVAILABLE', error: errorView(error) }; }
  }));
  items.sort((a, b) => String(a.label).localeCompare(String(b.label)) || a.id.localeCompare(b.id));
  let providers, catalogError = null;
  try { providers = await defaultApplicationProviders({ allowUnavailable: true }); }
  catch (error) { catalogError = errorView(error); }
  return { schema: 'stellar-forge.runtime-applications.v1',
    catalog: providers ? providers.catalog.map(entry => ({ ...entry, providerId: providers.forKind(entry.id).id })) : [],
    providers: providers?.sources ?? [], unavailableProviders: providers?.unavailable ?? [],
    catalogError, applications: items };
}
export async function applicationsHistory(root, input = {}) {
  await application(root, recordId(input.applicationId));
  const page = await applicationRunPage(root, input);
  return { schema: 'stellar-forge.application-history.v1', ...page,
    runs: await runViews(root, input.applicationId, page.runs) };
}
export async function reviewApplication(root, { runtimeId, runtimeDirectory, kind, settings: input,
  label, applicationId = null, expectedRevision = null, homeId = null, providerId = null } = {}) {
  await initializeApplications(root);
  recordId(runtimeId);
  const previous = applicationId ? await application(root, recordId(applicationId)) : null;
  if (previous) {
    need(previous.revision === expectedRevision, 'APPLICATION_REVIEW_CHANGED', 'Reopen the current application before editing it', 409);
    need(!await busyApplication(root, previous.id), 'APPLICATION_RUNNING', 'Stop or reconcile the original application before changing its settings', 409);
  }
  const selection = await applicationSelection(kind, providerId);
  const type = selection.entry, settings = normalizeSettings(type, input, selection.provider);
  need(typeof label === 'string' && label.trim() && label.length <= 120, 'APPLICATION_LABEL_REQUIRED');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const { spec } = await readDistributionSpecification({ sourceRoot: runtime.sourceRoot });
  need(type.python || Object.hasOwn(spec.commands ?? {}, type.command), 'APPLICATION_NOT_IN_RUNTIME',
    'This selected runtime does not include ' + type.command + '. Choose a runtime containing that original command.');
  if (type.requiredSource) await regular(join(runtime.sourceRoot, type.requiredSource), 4 * 1024 * 1024).catch(() =>
    need(false, 'APPLICATION_NOT_IN_RUNTIME', 'Choose a runtime containing the original ' + type.title + ' source'));
  await selection.provider.checkRuntime?.(type, settings, runtime, { root, runtimeId });
  const command = await applicationCommand(selection, settings, runtime.directory, { root, runtimeId });
  const homes = (await managedState(root)).homes;
  let home = homeId ? homes.find(item => item.id === recordId(homeId)) : homes.find(item => item.releases.some(release =>
    release.runtime && bindingKeys.every(key => release.runtime[key] === runtime[key])));
  if (!home) {
    need(!homeId, 'APPLICATION_MANAGED_HOME_REQUIRED');
    const opened = await openManagedHome(root, { directory: join(root, 'application-homes', runtimeId), label: label.trim() + ' runtime' });
    home = opened.home;
  }
  const release = home.releases.find(item => item.runtime && bindingKeys.every(key => item.runtime[key] === runtime[key]));
  const adoptionReview = release ? null : await reviewManagedAdoption(root, { homeId: home.id, runtimeId, runtimeDirectory });
  const value = { schema: 'stellar-forge.application-review.v1', applicationId, previousRevision: previous?.revision ?? null,
    runtimeId, runtime: binding(runtime), kind, settings, label: label.trim(), command,
    applicationProvider: selection.binding,
    homeId: home.id, homeDirectory: home.directory, releaseId: release?.id ?? null,
    resourceKey: command.resourceKey ?? resourceKey(selection, settings),
    ...(command.resourceKeys ? { resourceKeys: applicationResourceKeys(command) } : {}),
    adoption: adoptionReview ? { requestId: uuidFrom('application-adopt:' + home.id + ':' + adoptionReview.id),
      operation: 'managed-adopt', homeId: home.id, reviewId: adoptionReview.id } : null };
  const id = hash(value).slice(0, 24), path = reviewPath(root, id);
  try { await saveJSON(path, { ...value, id, reviewedAt: now() }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(path);
}
export async function saveApplication(root, { requestId, reviewId, applicationId = null } = {}) {
  operationId(requestId);
  const reviewed = await readJSON(reviewPath(root, reviewId));
  need(reviewed.applicationId === applicationId, 'APPLICATION_REVIEW_CHANGED');
  const id = applicationId ? recordId(applicationId) : digest(requestId).slice(0, 24), directory = directoryFor(root, id);
  try { await makePrivate(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(directory); }
  for (const name of ['runs', 'revisions']) {
    try { await makePrivate(join(directory, name)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const lease = await operationLease(join(directory, 'application.lock'));
  try {
    const previous = await readJSON(join(directory, 'application.json'), true), requestHash = hash({ requestId, reviewId, applicationId });
    if (previous?.saveRequestId === requestId) {
      need(previous.saveRequestHash === requestHash, 'APPLICATION_SAVE_ID_REUSED');
      return previous;
    }
    need((previous?.revision ?? null) === reviewed.previousRevision, 'APPLICATION_REVIEW_CHANGED');
    if (previous) need(!await busyApplication(root, id), 'APPLICATION_RUNNING');
    const selection = await applicationSelection(reviewed.kind, reviewed.applicationProvider?.id ?? null,
      reviewed.applicationProvider ?? null);
    const current = await applicationCommand(selection, reviewed.settings, reviewed.runtime.directory, {
      root, runtimeId: reviewed.runtimeId,
    });
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the current application files before saving', 409);
    for (const path of reviewed.command.createDirectories) {
      try { await makePrivate(path); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
    }
    const body = { kind: reviewed.kind, label: reviewed.label, runtimeId: reviewed.runtimeId, runtime: reviewed.runtime,
      ...(reviewed.applicationProvider ? { providerId: reviewed.applicationProvider.id } : {}),
      settings: reviewed.settings, homeId: reviewed.homeId, homeDirectory: reviewed.homeDirectory,
      adoption: reviewed.adoption, resourceKey: reviewed.resourceKey,
      ...(reviewed.resourceKeys ? { resourceKeys: applicationResourceKeys(reviewed) } : {}) };
    const revision = hash(body);
    const value = { schema: SCHEMA, id, ...body, revision, createdAt: previous?.createdAt ?? now(), updatedAt: now(),
      saveRequestId: requestId, saveRequestHash: requestHash, reviewId };
    try { await saveJSON(join(directory, 'revisions', revision + '.json'), value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await saveJSON(join(directory, 'application.json'), value, true);
    return value;
  } finally { await lease.close(); }
}
export async function applicationBindingOperation(root, id) {
  const saved = await application(root, id), { release } = await selectedRelease(root, saved);
  return release ? null : saved.adoption;
}
export async function reviewApplicationStart(root, id, { navigationOrigin = null } = {}) {
  const saved = await application(root, id);
  need(!await busyApplication(root, id), 'APPLICATION_RUNNING', 'Reopen the retained application operation', 409);
  const runtime = await inspectMerchantRuntime(saved.runtime.directory, { expectedManifest: saved.runtime.sourceManifestSha256, load: false });
  need(hash(binding(runtime)) === hash(saved.runtime), 'APPLICATION_RUNTIME_CHANGED');
  const { home, release } = await selectedRelease(root, saved);
  const selection = await applicationSelection(saved.kind, saved.providerId ?? null);
  need(release && (selection.entry.python || Object.hasOwn(release.commands, selection.entry.command)), 'APPLICATION_CONNECTION_REQUIRED');
  const command = await applicationCommand(selection, saved.settings, saved.runtime.directory, {
    root, runtimeId: saved.runtimeId, navigationOrigin,
  });
  need((command.resourceKey === undefined || command.resourceKey === saved.resourceKey) &&
    hash(applicationResourceKeys({ ...command, resourceKey: command.resourceKey ?? saved.resourceKey })) === hash(applicationResourceKeys(saved)),
    'APPLICATION_STATE_CHANGED', 'Review and save this application with its current original workspace selection before starting', 409);
  const value = { schema: 'stellar-forge.application-start-review.v1', applicationId: id,
    applicationRevision: saved.revision, runtime: saved.runtime, homeId: home.id, homeRevision: home.revision,
    releaseId: release.id, releaseDigest: release.digest, resourceKey: saved.resourceKey, command,
    ...(saved.resourceKeys ? { resourceKeys: applicationResourceKeys(saved) } : {}),
    applicationProvider: selection.binding,
    ...(navigationOrigin !== null ? { navigationOrigin } : {}) };
  const reviewId = hash(value).slice(0, 24);
  try { await saveJSON(reviewPath(root, reviewId), { ...value, id: reviewId, reviewedAt: now() }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(reviewPath(root, reviewId));
}
export async function prepareApplicationStart(root, { applicationId, requestId, reviewId } = {}) {
  const id = recordId(applicationId); operationId(requestId);
  const saved = await application(root, id), directory = directoryFor(root, id), file = join(directory, 'runs', requestId + '.json');
  const requestHash = hash({ applicationId, requestId, reviewId });
  const original = await readJSON(file, true);
  if (original) { need(original.requestHash === requestHash, 'APPLICATION_RUN_ID_REUSED'); return original; }
  return withApplicationResources(root, saved, async () => {
    const resources = new Set(applicationResourceKeys(saved));
    const again = await readJSON(file, true);
    if (again) { need(again.requestHash === requestHash, 'APPLICATION_RUN_ID_REUSED'); return again; }
    const currentSaved = await application(root, id);
    need(currentSaved.revision === saved.revision &&
      hash(applicationResourceKeys(currentSaved)) === hash(applicationResourceKeys(saved)),
      'APPLICATION_START_REVIEW_CHANGED', 'Review the current application and its complete original workspace selection.', 409);
    const reviewed = await readJSON(reviewPath(root, reviewId));
    need(reviewed.schema === 'stellar-forge.application-start-review.v1' && reviewed.applicationId === id &&
      reviewed.applicationRevision === currentSaved.revision, 'APPLICATION_START_REVIEW_CHANGED');
    const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
    for (const other of names) {
      const candidate = await readJSON(join(directoryFor(root, other), 'application.json'), true);
      if (candidate && applicationResourceKeys(candidate).some(key => resources.has(key)))
        need(!await busyApplication(root, other), 'APPLICATION_WORKSPACE_BUSY',
          'An original application for a selected client or coordinator workspace already has a retained operation. Reopen or stop that operation.', 409);
    }
    const selection = await applicationSelection(saved.kind, saved.providerId ?? null,
      reviewed.applicationProvider ?? null);
    const current = await applicationCommand(selection, saved.settings, saved.runtime.directory, {
      root, runtimeId: saved.runtimeId, navigationOrigin: reviewed.navigationOrigin ?? null,
    });
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the original current inputs again', 409);
    const { home, release } = await selectedRelease(root, saved);
    need(home?.revision === reviewed.homeRevision && release?.id === reviewed.releaseId &&
      release?.digest === reviewed.releaseDigest, 'APPLICATION_RELEASE_CHANGED');
    const request = { requestId, operation: 'managed-run', homeId: home.id, releaseId: release.id,
      expectedRevision: home.revision, applicationId: id, command: current.command,
      applicationProvider: selection.binding,
      args: retainedApplicationArguments(selection.provider, current, requestId),
      terminal: current.terminal, ...(current.terminalPython ? { terminalPython: current.terminalPython } : {}),
      ...(current.pythonCommand ? { pythonCommand: current.pythonCommand } : {}),
      ...(current.jobResultReceiver ? { jobResultReceiver: current.jobResultReceiver } : {}),
      ...(current.buyerRunbook ? { buyerRunbook: current.buyerRunbook } : {}),
      ...(current.stellarApplication ? { stellarApplication: current.stellarApplication } : {}),
      ...(current.environmentFile ? { environmentFile: current.environmentFile, environmentSha256: current.environmentSha256 } : {}) };
    const value = { schema: 'stellar-forge.application-run.v1', id: requestId, applicationId: id,
      createdAt: now(), revision: saved.revision, reviewId, requestHash, request };
    await saveJSON(file, value);
    return value;
  });
}
export async function dispatchApplicationStart(root, input, dispatch) {
  const lease = await operationLease(join(directoryFor(root, input.applicationId), 'application.lock'));
  try {
    need(!await runCancellation(root, input.applicationId, input.requestId), 'APPLICATION_START_CANCELLED');
    const run = await prepareApplicationStart(root, input);
    return { applicationId: input.applicationId, ...await dispatch(run.request) };
  } finally { await lease.close(); }
}
export async function cancelApplicationRun(root, input, stop) {
  const { applicationId, operationId: id } = input;
  const lease = await operationLease(join(directoryFor(root, applicationId), 'application.lock'));
  try {
    await applicationOperation(root, input);
    if (await readJSON(join(operationPath(root, id), 'request.json'), true)) return stop(id);
    const path = join(directoryFor(root, applicationId), 'runs', operationId(id) + '.cancel.json');
    let result = await readJSON(path, true);
    if (!result) {
      result = { schema: 'stellar-forge.application-run-cancellation.v1', applicationId, operationId: id,
        state: 'CANCELLED', completedAt: now(), launched: false };
      try { await saveJSON(path, result); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return result;
  } finally { await lease.close(); }
}
export async function applicationOperation(root, { applicationId, operationId: id } = {}) {
  const saved = await readJSON(join(directoryFor(root, applicationId), 'runs', operationId(id) + '.json'));
  need(saved.applicationId === applicationId && saved.id === id, 'APPLICATION_OPERATION_CHANGED');
  return saved.request;
}
export async function applicationOutput(root, { applicationId, operationId: id } = {}) {
  await applicationOperation(root, { applicationId, operationId: id });
  const value = await operationView(root, id);
  let output = { text: '', totalBytes: 0, offset: 0 };
  try { output = await tailFile(join(operationPath(root, id), 'worker.log')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { operationId: id, phase: value.phase, active: value.active, result: value.result, output };
}
export { readApplicationTerminal, sendApplicationTerminal };
