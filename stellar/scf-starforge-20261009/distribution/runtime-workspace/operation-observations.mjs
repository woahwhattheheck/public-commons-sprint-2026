// MIT. Read-only operation observations over the existing worker and kernel lease.
// Mutation paths continue to use their original strict checks and exclusive leases.
/**
 * @typedef {{code: string, message: string}} ObservationError
 * @typedef {{status: 'CURRENT'|'UNAVAILABLE', source: 'RETAINED'|'PROCESS'|'LEASE'|'RECORD',
 * checkedAt: string, error?: ObservationError}} OperationObservation
 * @typedef {{workerActive: boolean|null, commandActive: boolean|null,
 * observation: OperationObservation}} OperationActivity
 */
const errorView = error => ({
  code: error?.code ?? 'RUNTIME_WORKSPACE_OBSERVATION_UNAVAILABLE',
  message: String(error?.message ?? error).slice(0, 2000),
});

/**
 * Share in-flight reads of the same operation. A refresh starts fresh observations
 * after the previous read settles; retained results are never cached as liveness.
 * A failed native probe stops further flock launches in that batch, while process
 * identities and retained records remain readable.
 *
 * @param {{readJob: (id: string, observe: (state: object, lockPath: string) => Promise<OperationActivity>, context?: unknown) => Promise<object>,
 * createBatchContext?: () => unknown,
 * workerAlive: (state: object) => Promise<boolean>,
 * managedCommandAlive: (state: object) => Promise<boolean>,
 * operationRunning: (path: string) => Promise<boolean>,
 * projectError?: (error: unknown) => ObservationError}} dependencies
 */
export function createOperationReader({ readJob, workerAlive, managedCommandAlive, operationRunning, projectError = errorView, createBatchContext = null }) {
  const pending = new Map(), waiting = [];
  let active = 0;
  async function withSlot(run) {
    if (active < 4) active++;
    else await new Promise(resolve => waiting.push(resolve));
    try { return await run(); }
    finally {
      // Hand the occupied slot directly to the next reader. A new arrival
      // cannot take it before that queued reader resumes.
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  }
  async function activity(state, lockPath, batch) {
    const observation = { status: 'CURRENT', source: 'RETAINED', checkedAt: new Date().toISOString() };
    if (state.phase !== 'RUNNING') return { workerActive: false, commandActive: false, observation };
    let workerActive = null, commandActive = state.commandProcess ? null : false;
    try {
      if (await workerAlive(state)) {
        workerActive = true; observation.source = 'PROCESS';
      } else {
        observation.source = 'LEASE';
        if (batch.probeError) throw Object.assign(new Error(
          'This refresh could not check the original lease after another native probe failed. Refresh this operation to try again.'
        ), { code: 'RUNTIME_WORKSPACE_OBSERVATION_DEFERRED' });
        try { workerActive = await operationRunning(lockPath); }
        catch (error) {
          if (error?.code === 'RUNTIME_WORKSPACE_FLOCK_UNAVAILABLE') batch.probeError = projectError(error);
          throw error;
        }
      }
    } catch (error) {
      observation.status = 'UNAVAILABLE'; observation.error = projectError(error);
    }
    // A visible original command remains useful even if its worker probe failed.
    if (state.commandProcess) {
      if (workerActive === true) commandActive = true;
      else {
        try { commandActive = await managedCommandAlive(state) ? true : workerActive; }
        catch (error) {
          observation.status = 'UNAVAILABLE'; observation.error ??= projectError(error);
        }
      }
    }
    observation.checkedAt = new Date().toISOString();
    return { workerActive, commandActive, observation };
  }
  async function one(id, batch) {
    if (pending.has(id)) return pending.get(id);
    const work = Promise.resolve().then(() => withSlot(() => readJob(id, (state, path) => activity(state, path, batch), batch.context)))
      .catch(error => ({ id, operation: 'Retained operation', phase: 'UNAVAILABLE',
        displayPhase: 'OBSERVATION_UNAVAILABLE', workerActive: null, commandActive: null,
        observation: { status: 'UNAVAILABLE', source: 'RECORD',
          checkedAt: new Date().toISOString(), error: projectError(error) } }));
    pending.set(id, work);
    try { return await work; } finally { if (pending.get(id) === work) pending.delete(id); }
  }
  return {
    async read(ids, context = undefined) {
      const batch = { probeError: null, context: context === undefined && ids.length ?
        createBatchContext?.() : context }, results = new Array(ids.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length) {
          const index = next++;
          results[index] = await one(ids[index], batch);
        }
      }));
      return results;
    },
  };
}
export function summarizeOperationObservations(operations) {
  const unavailable = operations.filter(job => job.observation?.status === 'UNAVAILABLE').map(job => job.id);
  return { status: unavailable.length ? 'PARTIAL' : 'CURRENT', total: operations.length,
    unavailable: unavailable.length, unavailableOperationIds: unavailable };
}
