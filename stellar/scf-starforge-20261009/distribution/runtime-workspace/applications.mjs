// MIT. Application lifecycle over the original READY runtime and managed-command worker.
import { readdir, lstat, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { managedState, openManagedHome, reviewManagedAdoption } from './managed-workspace.mjs';
import { applicationEnvironment, readApplicationTerminal, sendApplicationTerminal } from './application-command.mjs';
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
const field = (name, label, type = 'path', required = false, description = '') => ({ name, label, type, required, description });
const common = [
  field('port', 'Local port', 'port', false, 'Use 0 to let the original application choose an available port.'),
  field('environmentFile', 'Private environment JSON', 'path', false, 'Optional private file containing environment names and string values. Values stay on this host.'),
];
export const APPLICATION_CATALOG = Object.freeze([
  { id: 'xml', command: 'dataset', requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/xml/cli.mjs',
    title: 'XML dataset onboarding', terminal: false,
    description: 'Reopen an initialized XML workspace with its original sources, mappings, native datasets, comparison and portable editions.',
    fields: [field('workspaceDirectory', 'Initialized XML workspace', 'path', true), ...common] },
  { id: 'openapi', command: 'openapi-workspace', title: 'API merchant authoring', terminal: false,
    description: 'Import the original API source, configure paid routes, save a merchant package and operate its original preview.',
    fields: [field('outputParent', 'Private merchant projects directory', 'path', true, 'An existing private folder or a new folder in an existing private parent.'), ...common] },
  { id: 'dataset', command: 'dataset-workspace', title: 'Dataset preview', terminal: false,
    description: 'Open an original dataset file or retained dataset state with its native query and preview controls.',
    fields: [field('datasetFile', 'Dataset file'), field('stateDirectory', 'Retained dataset state'), field('catalogDirectory', 'Catalog directory'),
      field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'postgres-publisher', command: 'postgres-publisher', title: 'PostgreSQL dataset publisher', terminal: false,
    description: 'Use the original plans, extraction, review, publication, schedules and buyer handoff.',
    fields: [field('workspaceDirectory', 'Publisher workspace', 'path', true), field('create', 'Initialize a new publisher', 'boolean'),
      field('sourceFile', 'Original source configuration'), field('stateDirectory', 'Target dataset state'),
      field('seller', 'Seller origin', 'text'), field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'sheets-publisher', command: 'sheets-publisher', title: 'Google Sheets dataset publisher', terminal: false,
    description: 'Open the original Sheets source, authorization, range plans, extraction, review and recurring publication.',
    fields: [field('workspaceDirectory', 'Publisher workspace', 'path', true), field('create', 'Initialize a new publisher', 'boolean'),
      field('sourceFile', 'Original Sheets source configuration'), field('stateDirectory', 'Target dataset state'),
      field('seller', 'Seller origin', 'text'), field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'postgres', command: 'postgres-workspace', title: 'PostgreSQL merchant authoring', terminal: false,
    description: 'Inspect the original database source, review its paid query contract and prepare the original merchant release.',
    fields: [field('sourceFile', 'Original PostgreSQL source', 'path', true), field('outputDirectory', 'Private merchant output directory', 'path', true),
      field('releaseStore', 'Existing release store'), ...common] },
  { id: 'object-buyer', command: 'buyer-object-workspace', requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs',
    title: 'Object buyer workspace', terminal: true,
    description: 'Reopen original object sessions, received products, verified downloads and analysis. Every new acquisition retains its original explicit terminal approval.',
    fields: [field('stateDirectory', 'Original private object buyer state', 'path', true), field('profileFile', 'Original product profile'),
      field('operatorSettings', 'Original operator settings file'), field('analysisPython', 'Analysis Python executable'),
      field('terminalPython', 'Terminal Python executable', 'path', false, 'Defaults to /usr/bin/python3; the original managed worker supplies the terminal.'), ...common] },
  { id: 'commerce', command: 'commerce-console', title: 'Commerce session', terminal: true,
    description: 'Reopen an initialized original commerce session. Its buyer approval remains in the connected original terminal.',
    fields: [field('directory', 'Initialized commerce session', 'path', true), field('finalityNode', 'Finality Node executable'),
      field('recoveryConfig', 'Private recovery configuration'), field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; the same managed worker uses the Python standard library PTY.'), ...common] },
]);

export async function initializeApplications(root) {
  for (const name of TYPES) {
    try { await makePrivate(join(root, name)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(join(root, name)); }
  }
}
function applicationType(kind) {
  const found = APPLICATION_CATALOG.find(item => item.id === kind);
  need(found, 'APPLICATION_KIND_INVALID', 'Choose an original application from this installation');
  return found;
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
function normalizeSettings(type, input) {
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
  if (type.id === 'dataset') need(Boolean(settings.datasetFile) !== Boolean(settings.stateDirectory),
    'APPLICATION_DATASET_SELECTION_REQUIRED', 'Choose exactly one original dataset file or retained state');
  if (type.id.endsWith('-publisher')) {
    need(!settings.create || settings.sourceFile && settings.stateDirectory, 'APPLICATION_PUBLISHER_SOURCE_REQUIRED');
    need(Boolean(settings.seller) === Boolean(settings.resource), 'APPLICATION_BUYER_ENDPOINT_PAIR_REQUIRED');
  }
  return settings;
}
async function applicationCommand(type, settings) {
  const inputs = [], createDirectories = [], args = [];
  let terminalPython;
  const path = async (name, kind = 'directory', missing = false, privateOnly = false) => {
    if (!settings[name]) return;
    const value = await inputPath(settings[name], kind, missing, privateOnly); inputs.push(value); return value;
  };
  const option = (name, value) => { if (value !== undefined && value !== '') args.push(name, String(value)); };
  if (type.id === 'xml') {
    await path('workspaceDirectory', 'directory', false, true);
    args.push('xml', '--workspace', settings.workspaceDirectory, 'serve');
  } else if (type.id === 'openapi') {
    const folder = await path('outputParent', 'directory', true, true);
    if (!folder.exists) createDirectories.push(folder.path);
    option('--out-parent', settings.outputParent);
  } else if (type.id === 'dataset') {
    await path('datasetFile', 'file'); await path('stateDirectory', 'directory', false, true);
    await path('catalogDirectory', 'directory', false, true);
    option('--dataset', settings.datasetFile); option('--state', settings.stateDirectory);
    option('--catalog', settings.catalogDirectory); option('--resource', settings.resource);
  } else if (type.id.endsWith('-publisher')) {
    const workspace = await path('workspaceDirectory', 'directory', Boolean(settings.create), true);
    args.push('serve'); option('--workspace', settings.workspaceDirectory);
    if (settings.create && !workspace.exists) {
      args.push('--create'); await path('sourceFile', 'file'); await path('stateDirectory', 'directory', true, true);
      option('--source', settings.sourceFile); option('--state', settings.stateDirectory);
    } else {
      const original = await readJSON(join(settings.workspaceDirectory, 'workspace.json'));
      need(typeof original.sourceFile === 'string' && typeof original.targetDirectory === 'string' &&
        (!settings.sourceFile || settings.sourceFile === original.sourceFile) &&
        (!settings.stateDirectory || settings.stateDirectory === original.targetDirectory),
      'APPLICATION_PUBLISHER_BINDING_CHANGED', 'Open this publisher with its original source and target state');
      inputs.push(await inputPath(original.sourceFile, 'file'));
      inputs.push(await inputPath(join(settings.workspaceDirectory, 'workspace.json'), 'file'));
    }
    option('--seller', settings.seller); option('--resource', settings.resource);
  } else if (type.id === 'postgres') {
    await path('sourceFile', 'file'); await path('outputDirectory', 'directory', true, true);
    await path('releaseStore', 'directory', false, true);
    option('--source', settings.sourceFile); option('--output', settings.outputDirectory); option('--release-store', settings.releaseStore);
  } else if (type.id === 'object-buyer') {
    await path('stateDirectory', 'directory', false, true);
    await path('profileFile', 'file'); await path('operatorSettings', 'file');
    const savedSettings = join(settings.stateDirectory, 'received', 'operator-settings.json');
    const original = await readJSON(savedSettings, true);
    if (original) {
      need(typeof original.path === 'string' && (!settings.operatorSettings || settings.operatorSettings === original.path),
        'APPLICATION_OBJECT_OPERATOR_CHANGED', 'Reopen this object workspace with its original operator settings path');
      absolute(original.path); inputs.push(await inputPath(savedSettings, 'file'));
    }
    let analysisPython;
    if (settings.analysisPython) {
      analysisPython = await realpath(settings.analysisPython);
      inputs.push(await inputPath(analysisPython, 'file')); await access(analysisPython, constants.X_OK);
    }
    option('--state', settings.stateDirectory); option('--profile', settings.profileFile);
    option('--operator-settings', settings.operatorSettings); option('--analysis-python', analysisPython);
  } else if (type.id === 'commerce') {
    await path('directory', 'directory', false, true); await path('recoveryConfig', 'file');
    const finalityNode = settings.finalityNode ? await realpath(settings.finalityNode) : null;
    if (finalityNode) { inputs.push(await inputPath(finalityNode, 'file')); await access(finalityNode, constants.X_OK); }
    args.push('start'); option('--directory', settings.directory);
    option('--finality-node', finalityNode ?? undefined); option('--recovery-config', settings.recoveryConfig);
  }
  if (type.terminal) {
    terminalPython = await realpath(settings.terminalPython ?? '/usr/bin/python3');
    inputs.push(await inputPath(terminalPython, 'file')); await access(terminalPython, constants.X_OK);
  }
  option('--port', settings.port);
  if (settings.environmentFile) inputs.push(await inputPath(settings.environmentFile, 'file'));
  const environment = await applicationEnvironment(settings.environmentFile);
  return { command: type.command, args, inputs, createDirectories, terminal: type.terminal,
    ...(type.terminal ? { terminalPython } : {}),
    ...(settings.environmentFile ? { environmentFile: settings.environmentFile, environmentSha256: environment.sha256 } : {}) };
}
function resourceKey(type, settings) {
  const value = settings.outputParent ?? settings.workspaceDirectory ?? settings.directory ??
    settings.outputDirectory ?? settings.stateDirectory ?? settings.datasetFile;
  return hash({ family: type.id.endsWith('-publisher') ? 'publisher' : type.id, directory: value });
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
async function selectedRelease(root, saved) {
  const homes = await managedState(root, { homeId: saved.homeId });
  const home = homes.homes.find(item => item.id === saved.homeId);
  const release = home?.releases.find(item => item.runtime &&
    bindingKeys.every(key => item.runtime[key] === saved.runtime[key]));
  return { home, release };
}
async function view(root, saved) {
  const { home, release } = await selectedRelease(root, saved);
  const history = await runs(root, saved.id);
  const rows = await Promise.all(history.slice(0, 30).map(async run => {
    const cancelled = await runCancellation(root, saved.id, run.id);
    const observed = cancelled ? { id: run.id, phase: 'CANCELLED', active: false, result: cancelled } : await operationView(root, run.id);
    return { id: run.id, createdAt: run.createdAt, revision: run.revision, command: run.request.command,
      args: run.request.args, terminal: run.request.terminal === true, ...observed,
      request: undefined, privateUrl: observed.active && !observed.stop ? observed.url?.url ?? null : null };
  }));
  const current = rows[0] ?? null;
  const adoption = !release && saved.adoption ? await operationView(root, saved.adoption.requestId) : null;
  const phase = !release ? 'CONNECTING' : !current ? 'READY' :
    current.active ? current.stop ? 'STOPPING' : current.url ? 'RUNNING' : 'STARTING' :
      ['SUCCEEDED', 'CANCELLED'].includes(current.phase) ? current.result?.state === 'EXITED' || current.result?.state === 'LAUNCH_FAILED' ? 'FAILED' : 'STOPPED' :
        current.phase;
  return { ...saved, phase, release: release ? { id: release.id, digest: release.digest, sourceCommit: release.sourceCommit } : null,
    home: home ? { id: home.id, directory: home.directory, revision: home.revision, phase: home.phase } : null,
    adoption, current, runs: rows, totalRuns: history.length };
}
export async function applicationsState(root) {
  await initializeApplications(root);
  const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
  const items = await Promise.all(names.map(async id => {
    try { return await view(root, await application(root, id)); }
    catch (error) { return { id, label: id, phase: 'UNAVAILABLE', error: errorView(error) }; }
  }));
  items.sort((a, b) => String(a.label).localeCompare(String(b.label)) || a.id.localeCompare(b.id));
  return { schema: 'stellar-forge.runtime-applications.v1', catalog: APPLICATION_CATALOG, applications: items };
}
export async function reviewApplication(root, { runtimeId, runtimeDirectory, kind, settings: input,
  label, applicationId = null, expectedRevision = null, homeId = null } = {}) {
  await initializeApplications(root);
  recordId(runtimeId);
  const previous = applicationId ? await application(root, recordId(applicationId)) : null;
  if (previous) {
    need(previous.revision === expectedRevision, 'APPLICATION_REVIEW_CHANGED', 'Reopen the current application before editing it', 409);
    need(!await busyApplication(root, previous.id), 'APPLICATION_RUNNING', 'Stop or reconcile the original application before changing its settings', 409);
  }
  const type = applicationType(kind), settings = normalizeSettings(type, input);
  need(typeof label === 'string' && label.trim() && label.length <= 120, 'APPLICATION_LABEL_REQUIRED');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const spec = await readJSON(join(runtime.sourceRoot, 'stellar/scf-starforge-20261009/distribution/distribution.json'));
  need(Object.hasOwn(spec.commands ?? {}, type.command), 'APPLICATION_NOT_IN_RUNTIME',
    'This selected runtime does not include ' + type.command + '. Choose a runtime containing that original command.');
  if (type.requiredSource) await regular(join(runtime.sourceRoot, type.requiredSource), 4 * 1024 * 1024).catch(() =>
    need(false, 'APPLICATION_NOT_IN_RUNTIME', 'Choose a runtime containing the original ' + type.title + ' source'));
  const command = await applicationCommand(type, settings);
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
    homeId: home.id, homeDirectory: home.directory, releaseId: release?.id ?? null,
    resourceKey: resourceKey(type, settings),
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
    const current = await applicationCommand(applicationType(reviewed.kind), reviewed.settings);
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the current application files before saving', 409);
    for (const path of reviewed.command.createDirectories) {
      try { await makePrivate(path); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
    }
    const body = { kind: reviewed.kind, label: reviewed.label, runtimeId: reviewed.runtimeId, runtime: reviewed.runtime,
      settings: reviewed.settings, homeId: reviewed.homeId, homeDirectory: reviewed.homeDirectory,
      adoption: reviewed.adoption, resourceKey: reviewed.resourceKey };
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
export async function reviewApplicationStart(root, id) {
  const saved = await application(root, id);
  need(!await busyApplication(root, id), 'APPLICATION_RUNNING', 'Reopen the retained application operation', 409);
  const runtime = await inspectMerchantRuntime(saved.runtime.directory, { expectedManifest: saved.runtime.sourceManifestSha256, load: false });
  need(hash(binding(runtime)) === hash(saved.runtime), 'APPLICATION_RUNTIME_CHANGED');
  const { home, release } = await selectedRelease(root, saved);
  need(release && Object.hasOwn(release.commands, applicationType(saved.kind).command), 'APPLICATION_CONNECTION_REQUIRED');
  const command = await applicationCommand(applicationType(saved.kind), saved.settings);
  const value = { schema: 'stellar-forge.application-start-review.v1', applicationId: id,
    applicationRevision: saved.revision, runtime: saved.runtime, homeId: home.id, homeRevision: home.revision,
    releaseId: release.id, releaseDigest: release.digest, resourceKey: saved.resourceKey, command };
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
  const lease = await operationLease(join(root, 'application-resource-locks', saved.resourceKey + '.lock'));
  try {
    const again = await readJSON(file, true);
    if (again) { need(again.requestHash === requestHash, 'APPLICATION_RUN_ID_REUSED'); return again; }
    const reviewed = await readJSON(reviewPath(root, reviewId));
    need(reviewed.schema === 'stellar-forge.application-start-review.v1' && reviewed.applicationId === id &&
      reviewed.applicationRevision === (await application(root, id)).revision, 'APPLICATION_START_REVIEW_CHANGED');
    const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
    for (const other of names) {
      const candidate = await readJSON(join(directoryFor(root, other), 'application.json'), true);
      if (candidate?.resourceKey === saved.resourceKey)
        need(!await busyApplication(root, other), 'APPLICATION_WORKSPACE_BUSY',
          'The original application for this data directory already has a retained operation. Reopen or stop that operation.', 409);
    }
    const current = await applicationCommand(applicationType(saved.kind), saved.settings);
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the original current inputs again', 409);
    const { home, release } = await selectedRelease(root, saved);
    need(home?.revision === reviewed.homeRevision && release?.id === reviewed.releaseId &&
      release?.digest === reviewed.releaseDigest, 'APPLICATION_RELEASE_CHANGED');
    const request = { requestId, operation: 'managed-run', homeId: home.id, releaseId: release.id,
      expectedRevision: home.revision, applicationId: id, command: current.command, args: current.args,
      terminal: current.terminal, ...(current.terminalPython ? { terminalPython: current.terminalPython } : {}),
      ...(current.environmentFile ? { environmentFile: current.environmentFile, environmentSha256: current.environmentSha256 } : {}) };
    const value = { schema: 'stellar-forge.application-run.v1', id: requestId, applicationId: id,
      createdAt: now(), revision: saved.revision, reviewId, requestHash, request };
    await saveJSON(file, value);
    return value;
  } finally { await lease.close(); }
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
