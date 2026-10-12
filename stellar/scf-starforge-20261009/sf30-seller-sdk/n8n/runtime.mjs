// MIT. Preserve the native n8n execution across original SF30 worker retries.
import { randomUUID } from 'node:crypto';
import { canonical, digest, JOB_ID } from '../jobs/config.mjs';
import { fault, fail } from './config.mjs';
import { activeDispatch, withDispatch, readDispatchResult } from './store.mjs';
import { startExecution, getExecution, inspectExecution, validateDispatchEnvironment } from './client.mjs';

function binding(configuration, functionId, input, jobId) {
  if (!JOB_ID.test(jobId ?? '') || !Object.hasOwn(configuration.automations, functionId))
    fail('BINDING', 'Select the original configured automation and job.');
  return { jobId, functionId, inputSha256: digest(canonical(input)),
    workflowId: configuration.automations[functionId].workflowId,
    configurationSha256: digest(canonical(configuration)) };
}
function verify(row, expected) {
  if (Object.entries(expected).some(([key, value]) => row[key] !== value))
    fail('BINDING', 'This job already belongs to different input, source, or workflow.', 409);
}
function checkRevision(row, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || row?.revision !== expectedRevision)
    fail('REVISION', 'Refresh the original dispatch before applying this decision.', 409);
}
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\x00-\x1f\x7f]/.test(value))
    fail('REASON', 'Enter a reason of 1–500 characters.');
  return value;
}
function newDispatch(attemptId) {
  return { id: randomUUID(), attemptId, state: 'READY', createdAt: new Date().toISOString(),
    executionId: null, observation: null, error: null, result: null, nextPollAt: null };
}
async function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  if (milliseconds <= 0) return;
  await new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, Math.min(milliseconds, 2147483647));
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? fault('MONITOR_CANCELLED', 'Local monitoring stopped.', 409)); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function originalExecution(store, row, configuration, executionId, options) {
  const dispatch = activeDispatch(row), remaining = Date.parse(dispatch.nextPollAt ?? '') - Date.now();
  if (Number.isFinite(remaining) && remaining > 0)
    fail('READ_COOLDOWN', 'Wait for the retained next-read time.', 429);
  try { return await getExecution(configuration, executionId, options); }
  catch (error) {
    if (error.nextPollAt) {
      dispatch.nextPollAt = error.nextPollAt;
      dispatch.error = { code: error.code, httpStatus: 429, at: new Date().toISOString() };
      await store.save(row, { action: 'read-rate-limited', dispatchId: dispatch.id, nextPollAt: error.nextPollAt });
    }
    throw error;
  }
}
async function observe(store, row, configuration, input, options = {}, requireBinding = false) {
  const dispatch = activeDispatch(row), automation = configuration.automations[row.functionId];
  const response = await originalExecution(store, row, configuration, dispatch.executionId, options);
  const result = inspectExecution(response, automation, row, dispatch, input, {
    requireBinding, maxOutputBytes: configuration.jobConfiguration.functions[row.functionId].maxOutputBytes ?? 8388608,
  });
  const previousState = dispatch.state;
  dispatch.state = result.state; dispatch.observation = result.observation; dispatch.error = result.error ?? null;
  dispatch.nextPollAt = new Date(Date.now() + configuration.connection.pollIntervalMs).toISOString();
  if (result.body) dispatch.result = await store.result(result.body);
  await store.save(row, previousState !== dispatch.state ? { action: 'execution-observed', dispatchId: dispatch.id,
    executionId: dispatch.executionId, state: dispatch.state } : null);
  return result;
}

/** Called only by the original paid-job Worker after its original native settlement. */
export async function executeN8nJob(configuration, directory, functionId, input, { jobId, attemptId, signal } = {}, options = {}) {
  const expected = binding(configuration, functionId, input, jobId);
  const final = await withDispatch(directory, jobId, async store => {
    let row = await store.read();
    if (!row) {
      row = { ...expected, dispatches: [newDispatch(attemptId)] };
      await store.save(row, { action: 'prepared', attemptId });
    } else verify(row, expected);
    const dispatch = activeDispatch(row);
    if (dispatch.state === 'SUCCEEDED') return true;
    if (['FAILED', 'REJECTED'].includes(dispatch.state))
      fail('RETRY_DECISION_REQUIRED', 'Review the original failed execution before authorizing another workflow run.', 409);
    if (dispatch.state === 'READY') {
      signal?.throwIfAborted();
      validateDispatchEnvironment(configuration, configuration.automations[functionId], options.env ?? process.env);
      // Persist intent before crossing the webhook side-effect boundary.
      dispatch.attemptId ??= attemptId;
      dispatch.state = 'DISPATCHING'; dispatch.startedAt = new Date().toISOString();
      await store.save(row, { action: 'dispatch-started', dispatchId: dispatch.id, attemptId: dispatch.attemptId });
      try {
        const accepted = await startExecution(configuration, configuration.automations[functionId], row, dispatch, input, { ...options, signal });
        dispatch.executionId = accepted.executionId; dispatch.state = 'PENDING';
        dispatch.acknowledgment = accepted.observation; dispatch.error = null;
        await store.save(row, { action: 'acknowledged', dispatchId: dispatch.id, executionId: dispatch.executionId });
      } catch (error) {
        dispatch.state = [401, 403, 404].includes(error.httpStatus) ? 'REJECTED' : 'UNRESOLVED';
        dispatch.error = { code: (typeof error.code === 'string' && error.code.startsWith('JOB_AUTOMATION_')) ? error.code : 'JOB_AUTOMATION_DISPATCH_INTERRUPTED',
          httpStatus: error.httpStatus ?? null, at: new Date().toISOString() };
        if (error.nextPollAt) dispatch.nextPollAt = error.nextPollAt;
        await store.save(row, { action: 'dispatch-response-unavailable', dispatchId: dispatch.id, state: dispatch.state });
        throw error;
      }
    }
    if (!dispatch.executionId)
      fail('EXECUTION_REQUIRED', 'Associate the original n8n execution to recover this dispatch.', 409);
    for (;;) {
      signal?.throwIfAborted();
      const remaining = Date.parse(dispatch.nextPollAt ?? '') - Date.now();
      if (Number.isFinite(remaining) && remaining > 0) { await pause(remaining, signal); continue; }
      try {
        const result = await observe(store, row, configuration, input, { ...options, signal });
        if (result.state === 'SUCCEEDED') return true;
        if (result.state === 'FAILED') throw fault('WORKFLOW_FAILED', 'The original n8n execution failed. Its history is retained.', 409);
      } catch (error) {
        if (error.nextPollAt) continue;
        dispatch.error = { code: (typeof error.code === 'string' && error.code.startsWith('JOB_AUTOMATION_')) ? error.code : 'JOB_AUTOMATION_MONITOR_INTERRUPTED',
          httpStatus: error.httpStatus ?? null, at: new Date().toISOString() };
        await store.save(row, { action: 'monitor-stopped', dispatchId: dispatch.id, code: dispatch.error.code });
        throw error;
      }
    }
  });
  if (final) return JSON.parse((await readDispatchResult(directory, jobId)).body);
}

/** Recover a lost acknowledgment by verifying the provider's original Webhook input. */
export async function reconcileN8nJob(configuration, directory, job, { executionId, expectedRevision, reason: why } = {}, options = {}) {
  return withDispatch(directory, job.id, async store => {
    const row = await store.read();
    if (!row) fail('NOT_DISPATCHED', 'The original job has not dispatched a workflow.', 409);
    verify(row, binding(configuration, job.functionId, job.input, job.id)); checkRevision(row, expectedRevision);
    const dispatch = activeDispatch(row);
    if (dispatch.state === 'SUCCEEDED') return row;
    if (executionId !== undefined) {
      reason(why);
      if (dispatch.executionId && dispatch.executionId !== executionId)
        fail('EXECUTION_CHANGED', 'This dispatch already has its original execution ID.', 409);
      const candidate = { ...dispatch, executionId };
      const response = await originalExecution(store, row, configuration, executionId, options);
      const result = inspectExecution(response, configuration.automations[job.functionId], row, candidate, job.input, {
        requireBinding: true, maxOutputBytes: configuration.jobConfiguration.functions[job.functionId].maxOutputBytes ?? 8388608,
      });
      dispatch.executionId = executionId; dispatch.state = result.state; dispatch.observation = result.observation;
      dispatch.error = result.error ?? null;
      dispatch.nextPollAt = new Date(Date.now() + configuration.connection.pollIntervalMs).toISOString();
      if (result.body) dispatch.result = await store.result(result.body);
      await store.save(row, { action: 'execution-associated', executionId, dispatchId: dispatch.id, reason: why });
    } else {
      if (!dispatch.executionId) fail('EXECUTION_REQUIRED', 'Supply the original execution ID from n8n.', 409);
      await observe(store, row, configuration, job.input, options);
    }
    return row;
  });
}

/** Authorize a new remote run only after the old run is terminal or was rejected. */
export async function authorizeN8nRerun(configuration, directory, job, { expectedRevision, reason: why } = {}, options = {}) {
  reason(why);
  if (!['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.state))
    fail('JOB_STATE', 'Pause or finish the original local attempt before another workflow run.', 409);
  return withDispatch(directory, job.id, async store => {
    const row = await store.read();
    if (!row) fail('NOT_DISPATCHED', 'This job has no previous workflow dispatch.', 409);
    verify(row, binding(configuration, job.functionId, job.input, job.id)); checkRevision(row, expectedRevision);
    const dispatch = activeDispatch(row);
    if (dispatch.state === 'FAILED') {
      const result = await observe(store, row, configuration, job.input, options, true);
      if (result.state !== 'FAILED') fail('EXECUTION_STATE', 'The original remote execution is not failed.', 409);
    } else if (dispatch.state !== 'REJECTED')
      fail('EXECUTION_STATE', 'Reconcile the original execution before authorizing another workflow run.', 409);
    if (row.dispatches.length >= 128) fail('DISPATCH_LIMIT', 'The job reached its retained dispatch limit.', 409);
    row.dispatches.push(newDispatch(null));
    await store.save(row, { action: 'rerun-authorized', previousDispatchId: dispatch.id,
      dispatchId: activeDispatch(row).id, reason: why });
    return row;
  });
}
