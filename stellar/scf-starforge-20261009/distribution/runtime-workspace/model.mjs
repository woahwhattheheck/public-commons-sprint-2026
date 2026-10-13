import { managedResult } from './managed-result.mjs';
import { createOperationRecordReader } from './operation-records.mjs';
import { operationHistory, operationSummary } from './public/operation-history-model.mjs';
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
  operationLease, operationRunning, tailFile, runtimeWorkspaceError, withWorkspaceWrite,
  workspaceLeaseDescriptor, workspaceReceivingState, createWorkspaceReceivingReader, currentRuntimeEntry, receivedOperation, requireCurrentOperation,
  requireCurrentApplication, receivedManagedHome } from './storage.mjs';
import { createOperationReader, summarizeOperationObservations } from './operation-observations.mjs';
import { createWorkspaceBackupAPI } from './workspace-backup.mjs';
import { createRuntimeProceduresAPI } from './operating-procedures.mjs';
import { createApplicationInputsAPI } from './application-inputs.mjs';
import { createApplicationInputSetsAPI } from './application-input-sets.mjs';
import { createApplicationInputSetEditionsAPI } from './application-input-set-editions.mjs';

import { managedOperationFields, initializeManagedWorkspace, managedState, openManagedHome, reviewManagedAdoption,
  managedConfig, normalizeManagedOperation, executeManagedOperation, managedCommandAlive,
  stopManagedCommand, recoverManagedOperation } from './managed-workspace.mjs';

import { imageOperationFields, imageWorkspaceState, reviewWorkspaceImage, attachWorkspaceImage,
  attachWorkspaceImageTransfer, prepareWorkspaceImageTransfer, receiveWorkspaceImageChunk,
  openWorkspaceImageDownload, reviewWorkspaceImageContainer, normalizeImageOperation,
  executeImageOperation } from './image-workspace.mjs';

import { initializeApplications, applicationsState, applicationsHistory, reviewApplication, saveApplication, applicationBindingOperation,
  reviewApplicationStart, dispatchApplicationStart, cancelApplicationRun, applicationOperation, applicationOutput,
  readApplicationTerminal, sendApplicationTerminal } from './applications-core.mjs';
import { transferOperationFields, initializeTransferWorkspace, runtimeTransferWorkspaceState,
  reviewWorkspaceRuntimeTransfer, attachWorkspaceRuntimeTransfer, prepareWorkspaceRuntimeTransferReceive,
  uploadWorkspaceRuntimeTransferPart, downloadWorkspaceRuntimeTransfer, normalizeRuntimeTransferOperation,
  executeRuntimeTransferOperation, recoverWorkspaceRuntimeTransferOperation } from './transfer-workspace.mjs';

import { pythonOperationFields, initializePythonWorkspace, reviewPythonRuntime, normalizePythonOperation,
  executePythonOperation, recoverPythonOperation, pythonWorkspaceState, receivePythonArchive,
  openPythonBundle } from '../python-runtime/workspace.mjs';
import { bindPythonApplicationCommand } from '../python-runtime/command-binding.mjs';
import { workbookApplicationResult, workbookApplicationDownload } from '../python-runtime/workbook-results.mjs';
import { openApiConnectionSetupAction } from './openapi-connection-setup.mjs';
import { sourceBuildOperationFields, initializeSourceBuildWorkspace, sourceBuildWorkspaceState,
  sourceBuildCatalog, sourceBuildProduct, reviewSourceBuild, readSourceBuildReview, normalizeSourceBuildOperation, initializeSourceBuildRequest,
  executeSourceBuildOperation, recoverSourceBuildOperation, openSourceBuildArchive, validateSourceBuildOutput } from './source-build-workspace.mjs';

import { sourceProductPlansState, readSourceProductPlan, saveSourceProductPlan, refreshSourceProductPlan,
  exportSourceProductPlan, receiveSourceProductPlan, readProductPlanReceiving,
  continueProductPlanReceiving } from './source-product-plans.mjs';
import { exportProductPlanBriefing } from './product-plan-briefing.mjs';
import { selectedProductPlanBuild, productPlanRuntimes, productPlanHandoff } from './product-plan-runtime.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.runtime-workspace.v1';
const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const recordPath = (root, type, id) => join(root, type, recordId(id) + '.json');
const jobPath = (root, id) => join(root, 'operations', operationId(id));
const asError = error => runtimeWorkspaceError(error);

async function context(directory) {
  const root = await privateDirectory(absolute(directory));
  const receiving = await workspaceReceivingState(root);
  let config = await readJSON(join(root, 'workspace.json'), receiving?.phase === 'RESTORING');
  if (!config) {
    // The receiving marker is the actual identity while the original config is
    // still being streamed. This observer context is never written as config.
    return { root, receiving, config: { schema: WORKSPACE_SCHEMA,
      workspaceId: receiving.workspaceId, directory: root, runtimeHome: null } };
  }
  if (receiving?.mode === 'new-host') config = { ...config, originalDirectory: config.directory,
    directory: root, runtimeHome: receiving.hostBindings?.runtimeHome ?? config.runtimeHome };
  need(config.schema === WORKSPACE_SCHEMA && config.directory === root && typeof config.runtimeHome === 'string',
    'RUNTIME_WORKSPACE_CONFIG_INVALID');
  if (!receiving || receiving.phase === 'BINDINGS_REVIEWED') await privateDirectory(config.runtimeHome);
  if (receiving?.phase !== 'RESTORING')
    for (const name of ['archives', 'entries', 'operations', 'observations', 'sources', 'incoming'])
      await privateDirectory(join(root, name));
  return { root, config, receiving };
}
export async function createRuntimeWorkspace({ directory, runtimeHome } = {}) {
  const root = await makePrivate(absolute(directory));
  return withWorkspaceWrite(root, async () => {
  const home = runtimeHome === undefined ? join(root, 'runtimes') : absolute(runtimeHome);
  try { await makePrivate(home); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(home); }
  for (const name of ['archives', 'entries', 'operations', 'observations', 'sources', 'incoming'])
    await mkdir(join(root, name), { mode: 0o700 });
  const config = { schema: WORKSPACE_SCHEMA, workspaceId: randomUUID(), createdAt: now(), directory: root, runtimeHome: home };
  await saveJSON(join(root, 'workspace.json'), config);
  return config;
  });
}
async function records(root, type) {
  const names = (await readdir(join(root, type))).filter(name => /^[a-f0-9]{24}\.json$/.test(name)).sort();
  return Promise.all(names.map(name => readJSON(join(root, type, name))));
}
async function entry(root, id) {
  const value = await currentRuntimeEntry(root, await readJSON(recordPath(root, 'entries', id)));
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
  if (value.hostBindingRequired) return value;
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
async function jobView(root, id, observe = null, readRecord = readJSON, receivingReader = null) {
  const directory = jobPath(root, id), request = await readRecord(join(directory, 'request.json'), true);
  if (!request) return { id, operation: 'prepare request', phase: 'INITIALIZING', displayPhase: 'INITIALIZING',
    workerActive: false, commandActive: false, ...(observe ? {
      observation: { status: 'CURRENT', source: 'RETAINED', checkedAt: now() } } : {}) };
  let state = await readRecord(join(directory, 'state.json'), true) ?? { phase: 'QUEUED' };
  const receiving = await receivedOperation(root, id, receivingReader);
  if (receiving) return { ...request, id, ...state, originalPhase: state.phase, phase: 'RECEIVED_HISTORY',
    displayPhase: 'RECEIVED_HISTORY', receivedHistory: true, receivingId: receiving.receivingId,
    originalRequest: request, workerActive: false, commandActive: false,
    observation: { status: 'CURRENT', source: 'RETAINED', checkedAt: now() } };
  let activity;
  if (observe) {
    activity = await observe(state, join(directory, 'worker.lock'));
    // A probe may finish after the original worker wrote its terminal result.
    // Reopen that same state before presenting a running/interrupted observation.
    if (state.phase === 'RUNNING') {
      const current = await readRecord(join(directory, 'state.json'), true);
      if (current && json(current) !== json(state)) {
        state = current; activity = await observe(state, join(directory, 'worker.lock'));
      }
    }
  } else {
    const active = state.phase === 'RUNNING' && (await workerAlive(state) || await operationRunning(join(directory, 'worker.lock')));
    activity = { workerActive: active, commandActive: state.phase === 'RUNNING' &&
      Boolean(state.commandProcess) && (await managedCommandAlive(state) || active) };
  }
  const { workerActive: active, commandActive } = activity;
  const outcome = request.operation === 'managed-run' ?
    managedResult(state, await readRecord(join(directory, 'command-result.json'), true)) : {};
  return { id, operation: request.operation, runtimeId: request.runtimeId ?? request.targetId ?? null,
    homeId: request.homeId ?? null, applicationId: request.applicationId ?? null, terminal: request.terminal === true, commandActive,
    ...(Object.hasOwn(pythonOperationFields, request.operation) ? { python: request.python,
      candidateId: request.candidateId ?? null, pythonInstallationId: request.installationId ?? null } : {}),
    targetId: request.targetId ?? null, imageId: request.imageId ?? null, transferId: request.transferId ?? null,
    archiveId: request.archiveId ?? null, archiveSha256: request.sha256 ?? null, profileId: request.profileId ?? null,
    cacheTransferId: request.cacheTransferId ?? null,
    sourceBuildId: request.sourceBuildId ?? null, sourceBuildOutput: request.sourceBuildOutput ?? null,
    targetDirectory: request.targetDirectory ?? null, createdAt: request.createdAt,
    contextDirectory: request.contextDirectory ?? null, transferDirectory: request.transferDirectory ?? null,
    containerDirectory: request.containerDirectory ?? null, reviewId: request.reviewId ?? null,
    deploymentReviewId: request.deploymentReviewId ?? null,
    ...state, ...outcome, ...activity,
    displayPhase: state.phase === 'RUNNING' && active !== true && commandActive !== true
      ? activity.observation?.status === 'UNAVAILABLE' ? 'OBSERVATION_UNAVAILABLE' : 'INTERRUPTED'
      : state.phase };
}
async function spawnWorker(root, id) {
  await requireCurrentOperation(root, id);
  const log = await open(join(jobPath(root, id), 'worker.log'),
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const child = spawn(process.execPath, [WORKER, '--workspace', root, '--operation', id],
      { detached: true, cwd: root, shell: false,
        stdio: ['ignore', log.fd, log.fd, workspaceLeaseDescriptor(root)] });
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
  ...managedOperationFields,
  ...imageOperationFields,
  ...transferOperationFields,
  ...pythonOperationFields,
  ...sourceBuildOperationFields,
  import: ['archive', 'sha256', 'label'],
  prepare: ['archiveId', 'name', 'selection', 'profileId'],
  install: ['runtimeId', 'offline', 'cache', 'nodeHeaders'],
  inspect: ['runtimeId', 'load', 'source'],
  upgrade: ['runtimeId', 'archiveId', 'name', 'selection', 'profileId', 'offline', 'cache', 'nodeHeaders', 'install'],
  recover: ['runtimeId', 'name', 'offline', 'cache', 'nodeHeaders', 'install'],
};

export async function openRuntimeWorkspace({ directory, openApiSetupPolicy = {} } = {}) {
  const setupPolicy = Object.freeze({ ...openApiSetupPolicy });
  const opened = await context(directory), { root, receiving } = opened;
  let config = opened.config;
  const workspaceIdentity = config.workspaceId;
  let initialized = false;
  async function initialize() {
    if (initialized) return;
    await initializeManagedWorkspace(root);
    await initializeApplications(root);
    await initializeTransferWorkspace(root);
    await initializePythonWorkspace(root);
    await initializeSourceBuildWorkspace(root);
    initialized = true;
  }
  // Opening is read-only. The first lifecycle mutation initializes optional
  // feature directories under the shared workspace lease.
  const operationRecords = createOperationRecordReader();
  const originalOperationReader = createOperationReader({
    createBatchContext: () => createWorkspaceReceivingReader(root),
    readJob: (id, observe, receiving) => jobView(root, id, observe, operationRecords.read, receiving),
    workerAlive, managedCommandAlive, operationRunning, projectError: asError,
  });
  const operationReader = {
    // Complete legacy callers receive detached original values. Compact
    // activity never clones/transports a historical result payload.
    async read(ids, receiving) { return structuredClone(await originalOperationReader.read(ids, receiving)); },
    async summaries(ids, receiving) { return (await originalOperationReader.read(ids, receiving)).map(operationSummary); },
  };
  async function observedOperations(ids = null, receiving = undefined) {
    const selected = ids ?? (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
    return new Map((await operationReader.read(selected, receiving)).map(job => [job.id, job]));
  }
  async function inspectPlanHandoff(plan, runtimeId) {
    const id = recordId(runtimeId), build = selectedProductPlanBuild(plan);
    need(build?.archive?.sha256,
      'PRODUCT_PLAN_PACKAGED_BUILD_REQUIRED', 'Build the saved product package before selecting its installed runtime.');
    const runtime = await entry(root, id), installationPath = join(runtime.directory, 'runtime-install.json');
    const installation = await readJSON(installationPath);
    need(installation.archiveSha256 === build.archive.sha256 &&
      installation.source?.sourceCommit === plan.plan.intent.sourceCommit,
    'PRODUCT_PLAN_RUNTIME_SOURCE_MISMATCH', 'Choose the installation of this plan’s exact original archive.');
    const buildState = await readJSON(join(jobPath(root, plan.review.requestId), 'state.json'));
    const receipt = buildState.result?.build ?? buildState.sourceBuildReceipt;
    need(receipt?.sha256 === build.archive.sha256, 'PRODUCT_PLAN_BUILD_ARCHIVE_CHANGED');
    const manifest = await readJSON(join(runtime.directory, 'package', 'manifest.json'));
    validateSourceBuildOutput(plan.review, receipt, manifest);
    const inspection = await inspectRuntimeInstall({ directory: runtime.directory, load: false, source: true });
    const handoff = await model.handoff(id), current = await readJSON(installationPath);
    need(digest(json(canonical(installation))) === digest(json(canonical(current))),
      'PRODUCT_PLAN_RUNTIME_CHANGED', 'Reopen the selected runtime after its current operation.');
    return productPlanHandoff(plan, { runtime, installation, inspection, handoff });
  }
  const applicationInputs = createApplicationInputsAPI(root,workspaceIdentity);
  const model = {
    directory: root,
    ...createWorkspaceBackupAPI(root),
    ...createRuntimeProceduresAPI(root,workspaceIdentity,()=>model),
    ...applicationInputs,
    ...createApplicationInputSetsAPI(root,workspaceIdentity,applicationInputs),
    ...createApplicationInputSetEditionsAPI(root,workspaceIdentity,()=>model),
    async sourcePlansState(input) { return sourceProductPlansState(root, input); },
    async sourcePlanRead(input) { return readSourceProductPlan(root, input); },
    async sourcePlanRuntimes(input) {
      need(plain(input) && Object.keys(input).every(key => ['planId', 'bindingId'].includes(key)),
        'PRODUCT_PLAN_RUNTIMES_FIELDS_INVALID');
      const plan = await readSourceProductPlan(root, input);
      return productPlanRuntimes(plan, await model.state());
    },
    async sourcePlanHandoff(input) {
      need(plain(input) && Object.keys(input).every(key => ['planId', 'bindingId', 'runtimeId'].includes(key)),
        'PRODUCT_PLAN_HANDOFF_FIELDS_INVALID');
      const { runtimeId, ...selected } = input;
      return inspectPlanHandoff(await readSourceProductPlan(root, selected), runtimeId);
    },
    async sourcePlanBriefing(input) {
      need(plain(input) && Object.keys(input).every(key => ['planId', 'bindingId', 'format', 'runtimeId'].includes(key)), 'PRODUCT_PLAN_BRIEFING_FIELDS_INVALID');
      const { format = 'markdown', runtimeId, ...selected } = input;
      need(['json', 'markdown', 'html'].includes(format), 'PRODUCT_PLAN_BRIEFING_FORMAT_INVALID');
      const plan = await readSourceProductPlan(root, selected);
      const installation = runtimeId === undefined ? undefined : await inspectPlanHandoff(plan, runtimeId);
      return exportProductPlanBriefing(plan, { format, installation });
    },
    async sourcePlanSave(input) { return saveSourceProductPlan(root, input); },
    async sourcePlanRefresh(input) { return refreshSourceProductPlan(root, input); },
    async sourcePlanExport(input) { return exportSourceProductPlan(root, input); },
    async sourcePlanReceive(input) { return receiveSourceProductPlan(root, input); },
    async sourcePlanReceiving(input) { return readProductPlanReceiving(root, input); },
    async sourcePlanContinue(input) { return continueProductPlanReceiving(root, input); },
    async sourceBuildsState() { return sourceBuildWorkspaceState(root); },
    async sourceBuildsCatalog(input) { return sourceBuildCatalog(input); },
    async sourceBuildsProduct(input) { return sourceBuildProduct(input); },
    async sourceBuildsReview(input) { return reviewSourceBuild(root, input); },
    async sourceBuildsReadReview(id) { return readSourceBuildReview(root, id); },
    async sourceBuildsDownload(id) { return openSourceBuildArchive(root, id); },
    async recoverSourceBuildOperation(id) {
      await requireCurrentOperation(root, id);
      const result = await recoverSourceBuildOperation(root, id);
      if (result.resume) await spawnWorker(root, id);
      return result;
    },
    async pythonState(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return pythonWorkspaceState(root, { ...input, runtimeDirectory: selected.directory }, await observedOperations());
    },
    async pythonReview(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return reviewPythonRuntime(root, { ...input, runtimeDirectory: selected.directory });
    },
    async pythonUpload(input) { return receivePythonArchive(root, input); },
    async pythonDownload(input) { return openPythonBundle(root, input); },
    async pythonCommand(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return bindPythonApplicationCommand(root, { ...input, runtimeDirectory: selected.directory });
    },
    async recoverPythonOperation(id) {
      await requireCurrentOperation(root, id);
      const result = await recoverPythonOperation(root, id);
      if (result.resume) await spawnWorker(root, id);
      return result;
    },
    async transfersState(input) { return runtimeTransferWorkspaceState(root, input); },
    async transfersReview(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return reviewWorkspaceRuntimeTransfer(root, { ...input, runtimeDirectory: selected.directory });
    },
    async transfersAttach(input) { return attachWorkspaceRuntimeTransfer(root, input); },
    async transfersReceive(input) { return prepareWorkspaceRuntimeTransferReceive(root, input); },
    async transfersUpload(input) { return uploadWorkspaceRuntimeTransferPart(root, input); },
    async transfersDownload(input) { return downloadWorkspaceRuntimeTransfer(root, input); },
    async recoverTransferOperation(id) {
      await requireCurrentOperation(root, id);
      const result = await recoverWorkspaceRuntimeTransferOperation(root, id);
      if (result.resume) await spawnWorker(root, id);
      return result;
    },
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
    async state({ runtimeId = null, operationDetail = 'full' } = {}) {
      need(['full', 'summary'].includes(operationDetail), 'RUNTIME_OPERATION_DETAIL_INVALID');
      const [saved, archives, names] = await Promise.all([records(root, 'entries'), records(root, 'archives'), readdir(join(root, 'operations'))]);
      const receiving = createWorkspaceReceivingReader(root);
      const entries = await Promise.all(saved.map(async value => retainedView(await currentRuntimeEntry(root, value, false, receiving))));
      const jobs = await operationReader[operationDetail === 'summary' ? 'summaries' : 'read'](
        names.filter(name => /^[a-f0-9-]{36}$/.test(name)), receiving);
      jobs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      const selected = runtimeId ? entries.find(item => item.id === recordId(runtimeId)) ?? null : entries[0] ?? null;
      const observation = selected ? await readJSON(recordPath(root, 'observations', selected.id), true) : null;
      return { workspaceId: config.workspaceId, directory: root, originalDirectory: config.originalDirectory ?? root, runtimeHome: config.runtimeHome, archives,
        runtimes: entries.map(({ profile, preparation, ...value }) => value), selected, observation, operations: jobs,
        operationObservation: summarizeOperationObservations(jobs) };
    },
    async operationHistory(input = {}) {
      operationHistory(config.workspaceId, [], input); // Validate selection before native probes.
      const ids = (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
      return operationHistory(config.workspaceId, await operationReader.summaries(ids), input);
    },
    async operationStatus({ operationId: id }) {
      await privateDirectory(jobPath(root, id));
      return (await operationReader.read([id]))[0];
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
      await requireCurrentOperation(root, id);
      delete request.requestId;
      const clientRequestHash = digest(json(canonical(input)));
      const retainedRequest = await readJSON(join(jobPath(root, id), 'request.json'), true);
      if (retainedRequest?.clientRequestHash) {
        need(retainedRequest.clientRequestHash === clientRequestHash, 'RUNTIME_WORKSPACE_REQUEST_ID_REUSED');
        if (input.operation !== 'source-build') return { operationId: id, runtimeId: retainedRequest.targetId ?? retainedRequest.runtimeId ?? null,
          homeId: retainedRequest.homeId ?? null, imageId: retainedRequest.imageId ?? null, transferId: retainedRequest.transferId ?? null, cacheTransferId: retainedRequest.cacheTransferId ?? null, reopened: true };
      }
      if (!retainedRequest || input.operation === 'source-build') request.clientRequestHash = clientRequestHash;
      for (const key of ['offline', 'load', 'source', 'install']) if (request[key] !== undefined)
        need(typeof request[key] === 'boolean', 'RUNTIME_WORKSPACE_BOOLEAN_REQUIRED');
      if (Object.hasOwn(managedOperationFields, request.operation)) await normalizeManagedOperation(root, request);
      if (request.cache) absolute(request.cache);
      if (request.nodeHeaders !== undefined) absolute(request.nodeHeaders);
      if (request.runtimeId) request.runtimeDirectory = (await entry(root, request.runtimeId)).directory;
      if (Object.hasOwn(pythonOperationFields, request.operation)) await normalizePythonOperation(root, request, id);
      if (Object.hasOwn(sourceBuildOperationFields, request.operation)) await normalizeSourceBuildOperation(root, request, id);
      if (['install', 'inspect', 'upgrade', 'recover'].includes(request.operation))
        need(request.runtimeDirectory, 'RUNTIME_WORKSPACE_RUNTIME_REQUIRED');
      if (request.runtimeId && !['inspect', 'transfer-export'].includes(request.operation)) {
        const names = (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
        for (const existingId of names) {
          if (existingId === id) continue;
          const active = await jobView(root, existingId);
          need(!(active.runtimeId === request.runtimeId || active.targetId === request.runtimeId) ||
            !(active.workerActive || active.phase === 'QUEUED'), 'RUNTIME_WORKSPACE_RUNTIME_BUSY',
          'An existing workspace operation is using this runtime; its retained progress is below', 409);
        }
      }
      if (request.homeId && !['managed-run', 'managed-inspect', 'managed-doctor'].includes(request.operation)) {
        const names = (await readdir(join(root, 'operations'))).filter(name => /^[a-f0-9-]{36}$/.test(name));
        for (const existingId of names) {
          if (existingId === id) continue;
          const active = await jobView(root, existingId);
          need(active.homeId !== request.homeId || active.operation === 'managed-run' ||
            !(active.workerActive || active.phase === 'QUEUED'), 'MANAGED_HOME_BUSY',
            'Open the retained managed-home operation before starting another change', 409);
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
      if (Object.hasOwn(transferOperationFields, request.operation))
        await normalizeRuntimeTransferOperation(root, request, id, config);
      const operationDirectory = jobPath(root, id), body = canonical(request), requestHash = digest(json(body));
      if (request.operation === 'source-build') {
        const result = await initializeSourceBuildRequest(root, id, { ...body, requestHash, createdAt: now() });
        if (result.needsSpawn) await spawnWorker(root, id);
        return { operationId: id, sourceBuildId: request.sourceBuildId, reopened: result.reopened };
      }
      const previous = await readJSON(join(operationDirectory, 'request.json'), true);
      if (previous) {
        need(previous.requestHash === requestHash, 'RUNTIME_WORKSPACE_REQUEST_ID_REUSED');
        return { operationId: id, runtimeId: previous.targetId ?? previous.runtimeId ?? null, homeId: previous.homeId ?? null, imageId: previous.imageId ?? null, transferId: previous.transferId ?? null, cacheTransferId: previous.cacheTransferId ?? null, reopened: true };
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
      return { operationId: id, runtimeId: request.targetId ?? request.runtimeId ?? null, homeId: request.homeId ?? null, imageId: request.imageId ?? null, transferId: request.transferId ?? null, cacheTransferId: request.cacheTransferId ?? null };
    },
    async resumeQueued(operation) {
      await requireCurrentOperation(root, operation);
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
      const activePython = await readJSON(join(selected.directory, 'python-runtime', 'active.json'), true);
      const python = activePython ? await pythonWorkspaceState(root, { runtimeId, runtimeDirectory: selected.directory }, await observedOperations()) : null;
      return { schema: 'stellar-forge.runtime-deployment-handoff.v1', createdAt: now(),
        installationId: observed.installationId, directory: observed.directory, sourceCommit: observed.sourceCommit,
        packageVersion: observed.packageVersion, profileId: observed.profileId, lockSha256: observed.lockSha256,
        sourceRoot: observed.sourceRoot, dependencyRoot: observed.dependencyRoot, originalCommand: command,
        sourceManifestSha256: plan.source.manifestSha256,
        pythonRuntime: python ? { binding: python.binding, active: python.active,
          installations: python.installations, originalCommands: 'runtime-workspace python-command' } : null,
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
      if (operation) {
        const directory = jobPath(root, operation);
        await privateDirectory(directory);
        try { return { name: 'worker.log', available: true, ...await tailFile(join(directory, 'worker.log')) }; }
        catch (error) {
          return { name: 'worker.log', available: false,
            state: error.code === 'ENOENT' ? 'NOT_CREATED' : 'UNAVAILABLE',
            text: '', totalBytes: 0, offset: 0, error: asError(error) };
        }
      }
      const selected = await entry(root, runtimeId), state = await readJSON(join(selected.directory, 'install-state.json'));
      need(typeof state.logFile === 'string' && /^install-\d+(?:-[a-f0-9-]{36})?\.log$/.test(state.logFile),
        'RUNTIME_WORKSPACE_INSTALL_LOG_UNAVAILABLE', 'This runtime has no npm attempt log yet');
      return { name: state.logFile, ...await tailFile(join(selected.directory, state.logFile)) };
    },
    async applicationsState(options) {
      const receiving = createWorkspaceReceivingReader(root);
      return applicationsState(root, options, await observedOperations(null, receiving), receiving);
    },
    async applicationsHistory(options) {
      const receiving = createWorkspaceReceivingReader(root);
      return applicationsHistory(root, options, await observedOperations(null, receiving), receiving);
    },
    async applicationsOpenApiSetup(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return openApiConnectionSetupAction(root, { ...input, runtimeDirectory: selected.directory }, { policy: setupPolicy });
    },
    async applicationsReview(input) {
      const selected = await entry(root, recordId(input.runtimeId));
      return reviewApplication(root, { ...input, runtimeDirectory: selected.directory });
    },
    async applicationsSave(input) {
      const saved = await saveApplication(root, input);
      let connection = null, connectionError = null;
      try {
        const request = await applicationBindingOperation(root, saved.id);
        if (request) connection = await model.begin(request);
      } catch (error) { connectionError = asError(error); }
      return { applicationId: saved.id, revision: saved.revision, saved: true, connection, connectionError };
    },
    async applicationsConnect({ applicationId }) {
      await requireCurrentApplication(root, applicationId);
      const request = await applicationBindingOperation(root, applicationId);
      if (!request) return { applicationId, connected: true, reopened: true };
      const begun = await model.begin(request);
      if (!begun.reopened) return { applicationId, ...begun };
      const current = await jobView(root, begun.operationId);
      if (current.workerActive || current.commandActive ||
        await operationRunning(join(jobPath(root, begun.operationId), 'worker.lock')))
        return { applicationId, ...begun, running: true };
      if (current.phase === 'QUEUED')
        return { applicationId, ...begun, ...await model.resumeQueued(begun.operationId) };
      if (current.displayPhase === 'INTERRUPTED' || current.phase === 'FAILED')
        return { applicationId, ...begun, ...await model.recoverManagedOperation(begun.operationId) };
      return { applicationId, ...begun };
    },
    async applicationsStartReview({ applicationId, navigationOrigin = null }) {
      return reviewApplicationStart(root, applicationId, { navigationOrigin });
    },
    async applicationsStart(input) { return dispatchApplicationStart(root, input, request => model.begin(request)); },
    async applicationsStop(input) { await requireCurrentOperation(root, input.operationId); return cancelApplicationRun(root, input, id => model.stopManagedCommand(id)); },
    async applicationsRecover(input) {
      await requireCurrentOperation(root, input.operationId);
      const request = await applicationOperation(root, input);
      const existing = await readJSON(join(jobPath(root, input.operationId), 'request.json'), true);
      if (!existing) return dispatchApplicationStart(root, { applicationId: input.applicationId, requestId: input.operationId,
        reviewId: (await readJSON(join(root, 'applications', input.applicationId, 'runs', input.operationId + '.json'))).reviewId }, value => model.begin(value));
      const current = await jobView(root, input.operationId);
      if (current.workerActive) return { applicationId: input.applicationId, operationId: input.operationId, running: true, reopened: true };
      if (current.phase === 'QUEUED') return model.resumeQueued(input.operationId);
      return model.recoverManagedOperation(input.operationId);
    },
    async applicationsOutput(input) {
      const receiving = createWorkspaceReceivingReader(root);
      return applicationOutput(root, input, await observedOperations([operationId(input.operationId)], receiving), receiving);
    },
    async applicationsWorkbookResult(input) { return workbookApplicationResult(root, input); },
    async applicationsWorkbookDownload(input) { return workbookApplicationDownload(root, input); },
    async applicationsTerminal(input) { return readApplicationTerminal(root, input, await observedOperations([operationId(input.operationId)])); },
    async applicationsInput(input) { await requireCurrentOperation(root, input.operationId); return sendApplicationTerminal(root, input); },
    async managedState(options) { return managedState(root, options); },
    async openManagedHome(options) { return openManagedHome(root, options); },
    async reviewManagedAdoption({ homeId, runtimeId }) {
      return reviewManagedAdoption(root, { homeId, runtimeId, runtimeDirectory: (await entry(root, runtimeId)).directory });
    },
    async managedConfig(options) { return managedConfig(root, options); },
    async stopManagedCommand(id) { await requireCurrentOperation(root, id); return stopManagedCommand(root, id); },
    async recoverManagedOperation(id) {
      await requireCurrentOperation(root, id);
      const result = await recoverManagedOperation(root, id);
      if (result.resume) await spawnWorker(root, id);
      return result;
    },
    async close() { operationRecords.clear(); },
  };
  // Keep retained inspection available during receiving. All existing lifecycle
  // methods, including reviews that persist records, share the backup gate.
  const readMethods = new Set(["applicationInputSetEditionReview","applicationInputSetEditionRead","applicationInputSetEditionReceived","applicationInputSetEditionsState","applicationInputSetsState","applicationInputSetInspect","applicationInputSetSelection","applicationInputsState","applicationInputInspect","applicationInputSelection","applicationInputDownload","runtimeProceduresState","runtimeProcedureRead","runtimeProcedureExport","sourcePlansState","sourcePlanRead","sourcePlanRuntimes","sourcePlanHandoff","sourcePlanBriefing","sourcePlanReceiving","sourceBuildsState","sourceBuildsReadReview","pythonState","pythonDownload","transfersState","transfersDownload","imagesState","imagesDownload","state","operationHistory","operationStatus","catalog","review","compare","handoff","logs","applicationsState","applicationsHistory","applicationsOutput","applicationsTerminal","managedState","close"]);
  for (const [name, method] of Object.entries(model)) {
    if (typeof method !== 'function' || readMethods.has(name) || name.startsWith('workspaceBackup')) continue;
    model[name] = (...args) => withWorkspaceWrite(root, async () => {
      const current = await context(root);
      need(current.config.workspaceId === workspaceIdentity, 'RUNTIME_WORKSPACE_IDENTITY_CHANGED',
        'Reopen the workspace at its current original identity.', 409);
      config = current.config;
      await privateDirectory(config.runtimeHome);
      await initialize();
      return method.apply(model, args);
    });
  }
  return model;
}

/** A detached operator worker keeps the original install alive across browser/server restarts. */
export async function executeRuntimeWorkspaceOperation({ directory, operation: id }) {
  return withWorkspaceWrite(absolute(directory), async () => {
  const { root } = await context(directory), operationDirectory = jobPath(root, id);
  await requireCurrentOperation(root, id);
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
    const started = {
      ...(request.operation === 'source-build' ? Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('sourceBuild'))) : {}),
      phase: 'RUNNING', attempt: previous.attempt ?? 1, startedAt: now(), updatedAt: now(), pid: process.pid,
      processStart: await processIdentity() };
    await saveJSON(join(operationDirectory, 'state.json'), started, true);
    try {
      let result;
      const installOptions = { offline: request.offline ?? false, cache: request.cache ?? null,
        ...(request.nodeHeaders ? { nodeHeaders: request.nodeHeaders } : {}) };
      if (Object.hasOwn(sourceBuildOperationFields, request.operation)) {
        result = await executeSourceBuildOperation({ root, request, state: previous,
          retainArchive: (directory, label) => retainArchive(root, directory, label),
          checkpoint: async value => {
            Object.assign(started, value, { updatedAt: now() });
            await saveJSON(join(operationDirectory, 'state.json'), started, true);
          } });
      } else if (Object.hasOwn(pythonOperationFields, request.operation)) {
        result = await executePythonOperation({ root, request, operationDirectory, leaseFd: lease.fd,
          checkpoint: async value => {
            Object.assign(started, value, { updatedAt: now() });
            await saveJSON(join(operationDirectory, 'state.json'), started, true);
          } });
      } else if (Object.hasOwn(managedOperationFields, request.operation)) {
        result = await executeManagedOperation({ root, request, operationDirectory, leaseFd: lease.fd,
          checkpoint: async value => {
            Object.assign(started, value, { updatedAt: now() });
            await saveJSON(join(operationDirectory, 'state.json'), started, true);
          } });
      } else if (Object.hasOwn(imageOperationFields, request.operation)) {
        result = await executeImageOperation(root, request, id);
      } else if (Object.hasOwn(transferOperationFields, request.operation)) {
        result = await executeRuntimeTransferOperation(root, request, {
          checkpoint: async value => {
            Object.assign(started, value, { updatedAt: now() });
            await saveJSON(join(operationDirectory, 'state.json'), started, true);
          } });
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
      if (state.error.flock) process.stderr.write(json({ error: state.error.code, flock: state.error.flock }));
      return state;
    }
  } finally { await lease.close(); }
  });
}
