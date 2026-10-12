// MIT. Original Applications Review/Save/adopt/Start/Open/Stop/reopen receiving.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openRuntimeWorkspace } from '../../../distribution/runtime-workspace/model.mjs';
import { absolute, need, privateDirectory, operationLease, readJSON, saveJSON, json } from '../../../distribution/runtime-workspace/storage.mjs';
import { restoreIntrinioCustomer, receiveIntrinioCustomerSession } from './native.mjs';
import { inspectIntrinioWorkspace } from '../workspace.mjs';

const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
async function waitFor(model, applicationId, predicate, description, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const state = await model.applicationsState({ historyLimit: 30 });
    const application = state.applications.find(item => item.id === applicationId);
    need(application, 'INTRINIO_RECEIVING_APPLICATION_MISSING');
    if (predicate(application)) return application;
    need(Date.now() - started < timeoutMs, 'INTRINIO_RECEIVING_WAIT_EXPIRED',
      description + ' remains in its original application ' + applicationId + ' (' + application.phase + ').');
    await pause(250);
  }
}
function selected(run) {
  const positions = run.args.flatMap((arg, index) => arg === '--managed-selection' ? [index] : []);
  need(positions.length === 1, 'INTRINIO_RECEIVING_SELECTION_MISSING');
  return JSON.parse(run.args[positions[0] + 1]);
}

/**
 * Reuse an existing READY runtime and runtime operator workspace. The original
 * operation IDs are retained before dispatch so a continuation rejoins them.
 */
export async function receiveIntrinioApplication({
  runtimeWorkspaceDirectory, runtimeId, bundleFile, workspaceDirectory, outputDirectory,
  port = 0, timeoutMs = 120000,
}) {
  for (const path of [runtimeWorkspaceDirectory, bundleFile, workspaceDirectory, outputDirectory]) absolute(path);
  need(/^[a-f0-9]{24}$/.test(runtimeId ?? ''), 'INTRINIO_RECEIVING_RUNTIME_REQUIRED');
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INTRINIO_RECEIVING_PORT_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000, 'INTRINIO_RECEIVING_TIMEOUT_INVALID');
  try { await mkdir(outputDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(outputDirectory);
  const lease = await operationLease(join(outputDirectory, 'applications-receiving.lock'));
  const recordPath = join(outputDirectory, 'applications-receiving.json');
  let model;
  try {
    const restored = await restoreIntrinioCustomer({ bundleFile, workspaceDirectory });
    const input = { runtimeWorkspaceDirectory, runtimeId, bundleFile, bundleSha256: restored.bundle.sha256,
      workspaceDirectory, outputDirectory, port };
    let record = await readJSON(recordPath, true);
    if (record) need(JSON.stringify(record.input) === JSON.stringify(input), 'INTRINIO_RECEIVING_INPUT_CHANGED');
    else {
      record = { schema: 'stellar-forge.intrinio-application-receiving.v1', input,
        saveRequestId: randomUUID(), createdAt: new Date().toISOString(), cycles: [] };
      await saveJSON(recordPath, record);
    }
    const persist = async () => { await saveJSON(recordPath, record, true); };
    model = await openRuntimeWorkspace({ directory: runtimeWorkspaceDirectory });
    if (!record.reviewId) {
      const review = await model.applicationsReview({
        runtimeId, kind: 'intrinio-review', label: 'Intrinio retained statement review',
        settings: { workspaceDirectory, port },
      });
      record.reviewId = review.id; await persist();
    }
    if (!record.applicationId) {
      const saved = await model.applicationsSave({ requestId: record.saveRequestId, reviewId: record.reviewId });
      need(saved.saved === true && saved.applicationId, 'INTRINIO_RECEIVING_SAVE_FAILED');
      record.applicationId = saved.applicationId; record.applicationRevision = saved.revision; await persist();
      if (saved.connectionError) throw Object.assign(new Error(saved.connectionError.message), saved.connectionError);
    }
    await model.applicationsConnect({ applicationId: record.applicationId });
    await waitFor(model, record.applicationId, app => Boolean(app.release), 'Original runtime adoption', timeoutMs);
    for (let index = 0; index < 2; index++) {
      let cycle = record.cycles[index];
      if (!cycle) {
        const review = await model.applicationsStartReview({ applicationId: record.applicationId });
        cycle = { requestId: randomUUID(), reviewId: review.id };
        record.cycles.push(cycle); await persist();
      }
      if (cycle.stopped) continue;
      if (!cycle.received) {
        const current = (await model.applicationsState({ historyLimit: 30 })).applications
          .find(item => item.id === record.applicationId);
        const prior = current?.runs.find(run => run.id === cycle.requestId);
        if (prior) {
          if (!prior.active) {
            need(!['SUCCEEDED', 'CANCELLED'].includes(prior.phase), 'INTRINIO_RECEIVING_OPERATION_ENDED',
              'The retained run ended before customer receiving completed: ' + cycle.requestId);
            await model.applicationsRecover({ applicationId: record.applicationId, operationId: cycle.requestId });
          }
        } else {
          await model.applicationsStart({
            applicationId: record.applicationId, requestId: cycle.requestId, reviewId: cycle.reviewId,
          });
        }
        const opened = await waitFor(model, record.applicationId, app => {
          const run = app.runs.find(item => item.id === cycle.requestId);
          if (run && !run.active && ['FAILED', 'CANCELLED', 'SUCCEEDED'].includes(run.phase))
            need(false, 'INTRINIO_RECEIVING_START_FAILED', 'Original run ended before Open: ' + cycle.requestId);
          return Boolean(run?.active && run.privateUrl && run.url?.original);
        }, 'Original Intrinio startup', timeoutMs);
        const run = opened.runs.find(item => item.id === cycle.requestId);
        need(run.command === 'intrinio' && run.url.original.binding, 'INTRINIO_RECEIVING_WRONG_COMMAND');
        cycle.received = await receiveIntrinioCustomerSession({
          startup: run.url.original, selection: selected(run), original: restored.original, outputDirectory,
        });
        record.release = opened.release; await persist();
      }
      if (!cycle.stopRequested) {
        cycle.stopRequested = true; await persist();
      }
      await model.applicationsStop({ applicationId: record.applicationId, operationId: cycle.requestId });
      const stopped = await waitFor(model, record.applicationId, app => {
        const run = app.runs.find(item => item.id === cycle.requestId);
        return Boolean(run && !run.active && ['SUCCEEDED', 'CANCELLED', 'FAILED'].includes(run.phase));
      }, 'Original Intrinio Stop', timeoutMs);
      const run = stopped.runs.find(item => item.id === cycle.requestId);
      need(run.phase === 'SUCCEEDED' && run.result?.state !== 'LAUNCH_FAILED',
        'INTRINIO_RECEIVING_STOP_FAILED');
      const reopened = await inspectIntrinioWorkspace(workspaceDirectory);
      need(reopened.workspace.id === restored.original.workspace.metadata.id,
        'INTRINIO_RECEIVING_REOPEN_CHANGED');
      cycle.stopped = { at: new Date().toISOString(), phase: run.phase, state: run.result?.state,
        workspaceId: reopened.workspace.id, head: reopened.revision.id };
      await persist();
    }
    need(record.cycles[0].received.instanceId !== record.cycles[1].received.instanceId,
      'INTRINIO_RECEIVING_INSTANCE_REUSED');
    record.completedAt ??= new Date().toISOString(); await persist();
    return { ...record, recordPath };
  } finally { await model?.close(); await lease.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length < 5 || args.length > 6) {
    process.stdout.write('Usage: starforge intrinio-application-receive RUNTIME_WORKSPACE RUNTIME_ID BUNDLE_JSON PRIVATE_WORKSPACE PRIVATE_OUTPUT [PORT]\n');
    if (!args.includes('--help')) process.exitCode = 2;
  } else {
  const [runtimeWorkspaceDirectory, runtimeId, bundleFile, workspaceDirectory, outputDirectory, port = '0'] = args;
  receiveIntrinioApplication({ runtimeWorkspaceDirectory, runtimeId, bundleFile, workspaceDirectory, outputDirectory, port: Number(port) })
    .then(result => process.stdout.write(json(result)))
    .catch(error => { process.stderr.write(json({ error: error.code ?? 'INTRINIO_RECEIVING', message: error.message })); process.exitCode = 1; });
  }
}
