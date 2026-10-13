// MIT. Host invocation of due DataStore plans through the existing locked workbench.
import { openWorkbenchOwner } from './workbench-owner.mjs';
import { fault } from '../postgres/publisher/files.mjs';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export async function runDueCapturePlans({project, startupFile, directory, waitMs = 900000}) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 1000 || waitMs > 21600000)
    throw fault('CKAN_CAPTURE_WAIT_INVALID', 'Use a listener wait from 1,000 to 21,600,000 milliseconds.');
  const owner = startupFile ? await openWorkbenchOwner(startupFile, directory) : null;
  if (!owner && !project) throw fault('CKAN_CAPTURE_OWNER_REQUIRED');
  const status = () => owner ? owner.api('status') : project.status();
  const due = () => owner ? owner.api('capture-plans/due') : project.dueCapturePlans();
  const inspect = id => owner ? owner.api('capture-plan-runs/' + id) : project.capturePlanRun(id);
  const result = {checkedAt: new Date().toISOString(), runs: [],
    ...(owner ? {listener: {instanceId: owner.listener.instanceId, pid: owner.listener.pid, directory},
      startupSha256: owner.startupSha256} : {})};
  if ((await status()).active) return {...result, deferred: true, reason: 'PROJECT_BUSY'};
  const selection = await due();
  result.checkedAt = selection.checkedAt;
  for (const selected of selection.runs) {
    const request = {id: selected.id, planId: selected.planId, expectedPlanSha256: selected.expectedPlanSha256,
      scheduledFor: selected.scheduledFor, kind: 'scheduled'};
    try {
      if ((await status()).active) {
        result.deferred = true; result.reason = 'PROJECT_BUSY'; break;
      }
      const started = owner ? await owner.api('capture-plans/run', request) : project.runCapturePlan(request);
      if (!UUID.test(started.runId ?? '') || started.runId !== request.id)
        throw fault('CKAN_CAPTURE_RUN_IDENTITY_CHANGED', 'The owner returned another run. Inspect its original operation before continuing.');
      const operationId = owner ? started.operationId : started.id;
      let run;
      if (!owner) { await started.completion; run = await inspect(started.runId); }
      else {
        const deadline = Date.now() + waitMs;
        for (;;) {
          let missing;
          try { run = await inspect(started.runId); }
          catch (error) { if (error.status !== 404) throw error; missing = error; }
          const state = await status(), running = state.active === operationId;
          if (missing && !running) {
            if (state.operation?.id === operationId && state.operation.error)
              throw fault(state.operation.error.code, state.operation.error.message);
            throw missing;
          }
          // The first saved run is INTERRUPTED until execute() starts it.
          // Observe the accepted owner through its terminal save before
          // treating that intermediate record as a completed invocation.
          if (!running && run?.state !== 'COLLECTING') break;
          if (Date.now() >= deadline) {
            result.runs.push({planId: selected.planId, operationId, runId: started.runId, pending: true, run: run ?? null});
            result.pending = true; return result;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      result.runs.push({planId: selected.planId, operationId, runId: started.runId, run});
    } catch (error) {
      if (error.code === 'CKAN_PROJECT_BUSY') {
        result.runs.push({planId: selected.planId, runId: request.id, deferred: true, reason: 'PROJECT_BUSY'});
        result.deferred = true; result.reason = 'PROJECT_BUSY'; break;
      }
      result.runs.push({planId: selected.planId, runId: request.id,
        error: {code: error.code ?? 'CKAN_CAPTURE_DUE_FAILED', message: error.message}});
      // A lost dispatch response can already belong to this exact original run.
      // Keep its ID, stop this invocation, and inspect it before another due pass.
      break;
    }
  }
  return result;
}
export function captureDueFailed(result) {
  return result.pending === true || result.runs.some(item => item.error || item.pending ||
    item.run && item.run.state !== 'COMPLETE');
}
