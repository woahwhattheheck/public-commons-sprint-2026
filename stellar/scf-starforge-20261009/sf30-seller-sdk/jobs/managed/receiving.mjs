#!/usr/bin/env node
// MIT. One retained Applications receiving operation over the original completed merchant.
import { constants } from 'node:fs';
import { open, mkdir, realpath, mkdtemp, link, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openRuntimeWorkspace } from '../../../distribution/runtime-workspace/model.mjs';
import { operationLease, privateDirectory, readJSON, saveJSON } from '../../../distribution/runtime-workspace/storage.mjs';
import { canonical, digest, plain, JOB_ID, jobError } from '../config.mjs';
import { jobServiceLaunchPath, jobServiceExitPath, readJobServiceLaunch } from './launch.mjs';
import { JOB_MERCHANT_APPLICATION_ID } from './application.mjs';
import { serviceAbsolute, readServiceFile } from './selection.mjs';

export const RECEIVING_SCHEMA = 'stellar-forge.job-merchant-applications-receiving.v1';
const RESULT_SCHEMA = 'stellar-forge.job-merchant-applications-received.v1';
const fail = code => { throw jobError(code, 409); };
const requireValue = (value, code) => { if (!value) fail(code); };
const same = (a, b) => canonical(a) === canonical(b);
const now = () => new Date().toISOString();
const safeError = error => ({ code: String(error.code ?? error.name ?? 'JOB_SERVICE_RECEIVING_FAILED'),
  message: String(error.message ?? error).slice(0, 1000) });

function configuration(input) {
  requireValue(plain(input) && input.schema === RECEIVING_SCHEMA &&
    Object.keys(input).every(name => ['schema', 'runtimeWorkspace', 'runtimeId', 'settings', 'jobIds',
      'recordDirectory', 'label', 'timeoutMs'].includes(name)), 'JOB_SERVICE_RECEIVING_INPUT_INVALID');
  for (const name of ['runtimeWorkspace', 'recordDirectory']) serviceAbsolute(input[name]);
  requireValue(/^[a-f0-9]{24}$/.test(input.runtimeId ?? '') && plain(input.settings) &&
    typeof input.label === 'string' && input.label.trim() && input.label.length <= 120,
  'JOB_SERVICE_RECEIVING_SELECTION_REQUIRED');
  requireValue(Array.isArray(input.jobIds) && input.jobIds.length > 0 && input.jobIds.length <= 100 &&
    new Set(input.jobIds).size === input.jobIds.length && input.jobIds.every(id => typeof id === 'string' && JOB_ID.test(id)),
  'JOB_SERVICE_RECEIVING_ORIGINAL_JOBS_REQUIRED');
  // This receiving stage follows completed original work; source execution has its existing native stage.
  requireValue(input.settings.startWorker !== true && input.settings.startDelivery !== true,
    'JOB_SERVICE_RECEIVING_COMPLETED_SELECTION_REQUIRED');
  const timeoutMs = input.timeoutMs ?? 180000;
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000,
    'JOB_SERVICE_RECEIVING_DEADLINE_INVALID');
  return { ...structuredClone(input), timeoutMs, jobIds: [...input.jobIds].sort() };
}
async function bytesAt(path, bytes) {
  const parent = dirname(path), temporary = await mkdtemp(join(parent, '.receiving-'));
  try {
    const staged = join(temporary, 'bytes'), file = await open(staged, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(staged, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = await readServiceFile(path, 67108864, { privateFile: true });
      requireValue(prior.bytes.equals(bytes), 'JOB_SERVICE_RECEIVING_ARTIFACT_CHANGED');
    }
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
function launchSummary(launch) {
  return { instanceId: launch.instanceId, pid: launch.pid, directory: launch.directory,
    configPath: launch.configPath, runtimeDirectory: launch.runtimeDirectory, source: launch.source,
    selectionSha256: launch.selectionSha256, mode: launch.mode,
    origin: launch.workspaceIdentity.origin, landing: launch.landing,
    capabilities: launch.workspaceIdentity.capabilities };
}
async function originalGet(launch, path, signal, maximum = 4194304) {
  const address = new URL(launch.operator);
  const response = await fetch(new URL(path, address.origin), {
    method: 'GET', redirect: 'error', signal,
    headers: { authorization: 'Bearer ' + address.hash.slice(1), accept: '*/*' },
  });
  requireValue(response.status === 200, 'JOB_SERVICE_RECEIVING_HTTP_' + response.status);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    requireValue(length <= maximum, 'JOB_SERVICE_RECEIVING_BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), headers: response.headers };
}
async function originalJson(launch, path, signal) {
  const result = await originalGet(launch, path, signal);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)); }
  catch { fail('JOB_SERVICE_RECEIVING_JSON_INVALID'); }
  return { ...result, value };
}
async function observeMerchant(launch, input, directory, signal) {
  const state = await originalJson(launch, '/api/state', signal);
  requireValue(state.value.directory === input.settings.stateDirectory &&
    same(state.value.source, launch.source), 'JOB_SERVICE_RECEIVING_MERCHANT_CHANGED');
  const jobs = [];
  for (const id of input.jobIds) {
    const detail = await originalJson(launch, '/api/jobs/' + encodeURIComponent(id), signal);
    const job = detail.value;
    requireValue(job.id === id && job.state === 'COMPLETED' && job.result &&
      job.nativeSettlement?.id, 'JOB_SERVICE_RECEIVING_COMPLETED_JOB_REQUIRED');
    const output = await originalGet(launch, '/api/jobs/' + encodeURIComponent(id) + '/result', signal, 67108864);
    const sha256 = digest(output.bytes);
    requireValue(sha256 === job.result.sha256 && output.bytes.length === job.result.bytes &&
      output.headers.get('x-sfjobs-sha256') === sha256, 'JOB_SERVICE_RECEIVING_RESULT_CHANGED');
    const prefix = 'job-' + digest(id).slice(0, 24);
    const resultFile = await bytesAt(join(directory, prefix + '.result'), output.bytes);
    const rowFile = await bytesAt(join(directory, prefix + '.json'), detail.bytes);
    jobs.push({ id, functionId: job.functionId, inputSha256: job.inputSha256,
      nativeSettlement: job.nativeSettlement, result: { bytes: output.bytes.length, sha256,
        contentType: job.result.contentType, filename: job.result.filename }, resultFile, rowFile });
  }
  const pages = [];
  for (const path of ['/', '/inputs/', '/resolutions/', ...(launch.deliveries ? ['/deliveries'] : [])]) {
    const result = await originalGet(launch, path, signal);
    requireValue(result.headers.get('content-type')?.startsWith('text/html'), 'JOB_SERVICE_RECEIVING_PAGE_INVALID');
    pages.push({ path, bytes: result.bytes.length, sha256: digest(result.bytes) });
  }
  const ledgerPath = join(directory, 'paid-jobs-ledger.json');
  let retained;
  try { retained = await readServiceFile(ledgerPath, 4194304, { privateFile: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const exported = retained ? { bytes: retained.bytes, value: JSON.parse(retained.bytes) } :
    await originalJson(launch, '/api/export', signal);
  requireValue(exported.value.schema === 'stellar-forge.paid-jobs.operator-export.v1' &&
    same(exported.value.snapshot.source, launch.source), 'JOB_SERVICE_RECEIVING_LEDGER_CHANGED');
  const ledger = await bytesAt(ledgerPath, exported.bytes);
  return { launch: launchSummary(launch), jobs, pages, ledger, observedAt: now() };
}
function originalJobs(observation) {
  return observation.jobs.map(({ id, functionId, inputSha256, nativeSettlement, result }) =>
    ({ id, functionId, inputSha256, nativeSettlement, result }));
}
async function currentApplication(model, id) {
  const state = await model.applicationsState({ historyLimit: 10 });
  const app = state.applications.find(value => value.id === id);
  requireValue(app && app.phase !== 'UNAVAILABLE', 'JOB_SERVICE_RECEIVING_APPLICATION_UNAVAILABLE');
  return app;
}
async function waitFor(read, accept, signal) {
  for (;;) {
    signal.throwIfAborted();
    const value = await read();
    if (accept(value)) return value;
    if (['FAILED', 'INTERRUPTED', 'UNAVAILABLE', 'CANCELLED'].includes(value.phase))
      throw Object.assign(jobError('JOB_SERVICE_RECEIVING_ORIGINAL_OPERATION_FAILED', 409), { original: value });
    await delay(500, undefined, { signal });
  }
}

/** Continues its original retained plan, application IDs and two deliberate service lifetimes. */
export async function receiveJobMerchantApplication(rawInput, { signal } = {}) {
  const input = configuration(rawInput), inputSha256 = digest(canonical(input));
  await privateDirectory(input.runtimeWorkspace);
  try { await mkdir(input.recordDirectory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(input.recordDirectory);
  requireValue(await realpath(input.recordDirectory) === input.recordDirectory,
    'JOB_SERVICE_RECEIVING_REAL_DIRECTORY_REQUIRED');
  const lease = await operationLease(join(input.recordDirectory, 'receiving.lock'));
  const planPath = join(input.recordDirectory, 'receiving.json');
  const resultPath = join(input.recordDirectory, 'result.json');
  let model, plan;
  const deadline = AbortSignal.timeout(input.timeoutMs);
  const selected = signal ? AbortSignal.any([deadline, signal]) : deadline;
  try {
    plan = await readJSON(planPath, true);
    if (!plan) {
      plan = { schema: RECEIVING_SCHEMA, inputSha256, input, createdAt: now(),
        saveRequestId: randomUUID(), applicationId: null, reviewId: null, revision: null,
        starts: [0, 1].map(index => ({ index, requestId: randomUUID(), reviewId: null,
          dispatched: false, observation: null, stopped: false })), completed: false };
      await saveJSON(planPath, plan);
    }
    requireValue(plan.schema === RECEIVING_SCHEMA && plan.inputSha256 === inputSha256,
      'JOB_SERVICE_RECEIVING_INPUT_CHANGED');
    const existing = await readJSON(resultPath, true);
    if (existing) {
      requireValue(existing.schema === RESULT_SCHEMA && existing.inputSha256 === inputSha256,
        'JOB_SERVICE_RECEIVING_RESULT_CHANGED');
      return existing;
    }
    const save = () => saveJSON(planPath, plan, true);
    model = await openRuntimeWorkspace({ directory: input.runtimeWorkspace });
    if (!plan.reviewId) {
      const review = await model.applicationsReview({ runtimeId: input.runtimeId,
        kind: JOB_MERCHANT_APPLICATION_ID, label: input.label, settings: input.settings });
      plan.reviewId = review.id;
      plan.review = { source: review.command.jobMerchant, runtime: review.runtime,
        homeId: review.homeId, resourceKey: review.resourceKey };
      await save();
    }
    if (!plan.applicationId) {
      const saved = await model.applicationsSave({ requestId: plan.saveRequestId, reviewId: plan.reviewId });
      requireValue(saved.saved && saved.applicationId, 'JOB_SERVICE_RECEIVING_SAVE_FAILED');
      plan.applicationId = saved.applicationId; plan.revision = saved.revision;
      plan.connection = saved.connection; plan.connectionError = saved.connectionError; await save();
      if (saved.connectionError) fail('JOB_SERVICE_RECEIVING_CONNECTION_FAILED');
    }
    let app = await currentApplication(model, plan.applicationId);
    if (!app.release) {
      // Connect follows the same retained original adoption if Save lost its return.
      plan.connection = await model.applicationsConnect({ applicationId: plan.applicationId }); await save();
      app = await waitFor(() => currentApplication(model, plan.applicationId), value => Boolean(value.release), selected);
    }
    requireValue(app.revision === plan.revision, 'JOB_SERVICE_RECEIVING_APPLICATION_CHANGED');
    for (const phase of plan.starts) {
      if (phase.stopped) continue;
      let currentRun = (await model.applicationsHistory({ applicationId: plan.applicationId, limit: 100 }))
        .runs.find(run => run.id === phase.requestId);
      if (currentRun && !currentRun.active && !['PENDING', 'QUEUED'].includes(currentRun.phase)) {
        const priorExit = phase.observation ?
          await readJSON(jobServiceExitPath(join(input.runtimeWorkspace, 'operations', phase.requestId)), true) : null;
        const drained = priorExit?.schema === 'stellar-forge.job-service-exit.v1' &&
          priorExit.state === 'STOPPED' && priorExit.instanceId === phase.observation?.launch.instanceId &&
          Array.isArray(priorExit.closeErrors) && priorExit.closeErrors.length === 0;
        if (!drained) {
          const recovered = await model.applicationsRecover({ applicationId: plan.applicationId, operationId: phase.requestId });
          if (recovered.resume || recovered.running || recovered.commandActive) {
            currentRun = null;
          } else {
            // A completed original start is never replayed. Preserve its observed results and
            // failed or missing exit before reviewing a later lifetime of this same merchant.
            requireValue(recovered.phase === 'SUCCEEDED', 'JOB_SERVICE_RECEIVING_ORIGINAL_START_RECOVERY_REQUIRED');
            phase.attempts ??= [];
            phase.attempts.push({ requestId: phase.requestId, reviewId: phase.reviewId,
              selectionSha256: phase.selectionSha256 ?? null, dispatched: phase.dispatched,
              observation: phase.observation, exit: priorExit, recovered,
              endedAt: now(), failure: plan.lastFailure ?? null });
            phase.requestId = randomUUID(); phase.reviewId = null; phase.dispatched = false;
            phase.selectionSha256 = null; phase.observation = null; phase.exit = null; await save();
          }
        }
      }
      const operationDirectory = join(input.runtimeWorkspace, 'operations', phase.requestId);
      if (!phase.reviewId) {
        const reviewed = await model.applicationsStartReview({ applicationId: plan.applicationId });
        phase.reviewId = reviewed.id; phase.selectionSha256 = reviewed.command.jobMerchant.selectionSha256; await save();
      }
      if (!phase.dispatched) {
        const dispatched = await model.applicationsStart({ applicationId: plan.applicationId,
          requestId: phase.requestId, reviewId: phase.reviewId });
        requireValue(dispatched.operationId === phase.requestId, 'JOB_SERVICE_RECEIVING_START_CHANGED');
        phase.dispatched = true; await save();
      }
      if (!phase.observation) {
        app = await waitFor(() => currentApplication(model, plan.applicationId), value =>
          value.current?.id === phase.requestId && value.current.active &&
          value.current.privateUrl && value.current.privateLinks.length >= 3, selected);
        const ready = await readJobServiceLaunch({ file: jobServiceLaunchPath(operationDirectory),
          expected: { directory: input.settings.stateDirectory, configPath: input.settings.configurationFile,
            selectionSha256: phase.selectionSha256 }, signal: selected });
        requireValue(ready.entryUrl === app.current.privateUrl &&
          app.current.privateLinks.every(link => link.url.startsWith(ready.workspaceIdentity.origin + '/')),
        'JOB_SERVICE_RECEIVING_OPEN_CHANGED');
        const replay = await model.applicationsStart({ applicationId: plan.applicationId,
          requestId: phase.requestId, reviewId: phase.reviewId });
        requireValue(replay.operationId === phase.requestId && replay.reopened === true,
          'JOB_SERVICE_RECEIVING_START_REPLAY_CHANGED');
        const phaseDirectory = join(input.recordDirectory, 'start-' + (phase.index + 1) + '-' + phase.requestId);
        try { await mkdir(phaseDirectory, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await privateDirectory(phaseDirectory);
        phase.observation = await observeMerchant(ready, input, phaseDirectory, selected);
        await save();
      }
      app = await currentApplication(model, plan.applicationId);
      const run = app.runs.find(value => value.id === phase.requestId);
      if (run?.active) await model.applicationsStop({ applicationId: plan.applicationId, operationId: phase.requestId });
      await waitFor(() => model.applicationsOutput({ applicationId: plan.applicationId, operationId: phase.requestId }),
        value => !value.active && ['SUCCEEDED', 'CANCELLED'].includes(value.phase), selected);
      const exit = await readJSON(jobServiceExitPath(operationDirectory));
      requireValue(exit.schema === 'stellar-forge.job-service-exit.v1' && exit.state === 'STOPPED' &&
        exit.instanceId === phase.observation.launch.instanceId && exit.closeErrors.length === 0,
      'JOB_SERVICE_RECEIVING_DRAIN_FAILED');
      phase.exit = exit; phase.stopped = true; await save();
      // Reopen the original Applications model between starts; its native state/operation remains durable.
      await model.close(); model = await openRuntimeWorkspace({ directory: input.runtimeWorkspace });
    }
    const [first, second] = plan.starts.map(value => value.observation);
    requireValue(first.launch.instanceId !== second.launch.instanceId &&
      first.launch.directory === second.launch.directory && same(first.launch.source, second.launch.source) &&
      same(originalJobs(first), originalJobs(second)), 'JOB_SERVICE_RECEIVING_REOPEN_CHANGED');
    const history = await model.applicationsHistory({ applicationId: plan.applicationId, limit: 100 });
    requireValue(plan.starts.every(value => history.runs.filter(run => run.id === value.requestId).length === 1),
      'JOB_SERVICE_RECEIVING_HISTORY_CHANGED');
    const result = { schema: RESULT_SCHEMA, state: 'COMPLETE', inputSha256,
      applicationId: plan.applicationId, applicationRevision: plan.revision,
      runtimeWorkspace: input.runtimeWorkspace, runtimeId: input.runtimeId,
      merchant: { directory: first.launch.directory, configPath: first.launch.configPath, source: first.launch.source },
      completedJobs: originalJobs(first), starts: plan.starts.map(value => ({
        operationId: value.requestId, selectionSha256: value.selectionSha256, launch: value.observation.launch,
        pages: value.observation.pages, ledger: value.observation.ledger, exit: value.exit,
      })), receiving: { directory: input.recordDirectory, plan: planPath, result: resultPath },
      completedAt: now() };
    await saveJSON(resultPath, result);
    plan.completed = true; await save();
    return result;
  } catch (error) {
    if (plan && model && plan.applicationId) {
      const cleanup = [];
      for (const phase of plan.starts.filter(value => value.reviewId && !value.stopped)) {
        try {
          const original = await model.applicationsOutput({ applicationId: plan.applicationId, operationId: phase.requestId });
          if (original.active || original.phase === 'QUEUED') {
            await model.applicationsStop({ applicationId: plan.applicationId, operationId: phase.requestId });
            const drained = await waitFor(() => model.applicationsOutput({
              applicationId: plan.applicationId, operationId: phase.requestId,
            }), value => !value.active, AbortSignal.timeout(75000));
            cleanup.push({ operationId: phase.requestId, phase: drained.phase, active: drained.active });
          } else cleanup.push({ operationId: phase.requestId, phase: original.phase, active: original.active });
        } catch (failure) {
          if (failure.code !== 'ENOENT') cleanup.push({ operationId: phase.requestId, error: safeError(failure) });
        }
      }
      plan.cleanup = cleanup;
    }
    if (plan) {
      plan.lastFailure = { at: now(), ...safeError(error) };
      await saveJSON(planPath, plan, true).catch(() => {});
    }
    throw error;
  } finally { try { await model?.close(); } finally { await lease.close(); } }
}
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('jobs merchant Applications receiving\n\nnode managed/receiving.mjs --input ORIGINAL_RECEIVING_JSON\nContinues that retained receiving record, existing runtime and original completed merchant.');
    return;
  }
  requireValue(args.length === 2 && args[0] === '--input', 'JOB_SERVICE_RECEIVING_INPUT_REQUIRED');
  const source = await readServiceFile(resolve(args[1]), 65536, { privateFile: true });
  const stop = new AbortController(), interrupt = () => stop.abort(jobError('JOB_SERVICE_RECEIVING_INTERRUPTED', 409));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const result = await receiveJobMerchantApplication(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes)), { signal: stop.signal });
    console.log(JSON.stringify({ schema: result.schema, state: result.state, applicationId: result.applicationId,
      jobs: result.completedJobs.length, starts: result.starts.map(value => value.operationId), result: result.receiving.result }));
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
