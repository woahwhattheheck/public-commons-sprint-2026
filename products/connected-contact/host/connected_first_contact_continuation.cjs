"use strict";

async function continueOriginalContact(options) {
  const {
    invoke, inspectAccount, load, store, stateKey, operationKey, operationLease,
    now = () => Date.now(),
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    onProgress = () => {},
    signal
  } = options || {};
  for (const [name, fn] of Object.entries({invoke, load, store, now, wait, onProgress}))
    if (typeof fn !== "function") throw new TypeError(name + " must be a function");
  for (const [name, value] of Object.entries({stateKey, operationKey, operationLease}))
    if (typeof value !== "string" || !value.trim()) throw new TypeError(name + " is required");
  if (!/^[a-f0-9]{64}$/.test(operationKey)) throw new TypeError("Use the original 64-character operation key");
  if (inspectAccount !== undefined && typeof inspectAccount !== "function")
    throw new TypeError("inspectAccount must read the same original receiver account");
  const schema = "commons.original-contact-continuation/v1";
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError("The continuation clock must return milliseconds");
    return value;
  };
  const iso = () => new Date(timestamp()).toISOString();
  const previous = load(stateKey);
  if (previous && (previous.schema !== schema || previous.operation_key !== operationKey ||
      previous.operation_lease !== operationLease))
    throw new TypeError("Continue the same original operation and lease");
  const state = previous ? JSON.parse(JSON.stringify(previous)) : {
    schema, operation_key:operationKey, operation_lease:operationLease,
    created_at:iso(), runs:0, calls:0, waits:0, waited_ms:0,
    queue_changes:0, queue_reenqueues:0, status:"STARTING",
    next_retry_at:null, last_outcome:null
  };
  state.runs += 1;
  state.account_inspections = state.account_inspections || 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  let returnedAccountDecision = null;
  const save = () => {
    state.updated_at = iso();
    store(stateKey, JSON.parse(JSON.stringify(state)));
  };
  const emit = async event => {
    save();
    try {
      await onProgress({
        event, at:state.updated_at, operation_key:operationKey,
        operation_lease:operationLease, status:state.status,
        calls:state.calls, account_inspections:state.account_inspections,
        waits:state.waits, waited_ms:state.waited_ms,
        queue_reenqueues:state.queue_reenqueues,
        next_retry_at:state.next_retry_at,
        outcome:state.last_outcome,
        account:state.last_account_observation || null
      });
    } catch (error) {
      state.progress_error_name = String(error?.name || "Error");
      save();
    }
  };
  const deadline = value => {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value)))
      throw new TypeError("A deferred original operation must return an absolute retry_after");
    return Date.parse(value);
  };
  const describe = result => {
    const account = result?.account;
    const request = account?.queue?.request;
    if (request && (request.operation_key !== operationKey ||
        request.operation_lease !== operationLease))
      throw new TypeError("The returned queue request belongs to another operation");
    return {
      status:typeof result?.status === "string" ? result.status : null,
      account_status:typeof account?.status === "string" ? account.status : null,
      account_key:typeof account?.account_key === "string" ? account.account_key : null,
      account_revision:Number.isSafeInteger(account?.revision) ? account.revision : null,
      queue_sequence:Number.isSafeInteger(request?.sequence) ? request.sequence : null,
      queue_position:Number.isSafeInteger(account?.queue?.position) ? account.queue.position : null,
      queued_at:typeof request?.queued_at === "string" ? request.queued_at : null,
      waiting_expires_at:typeof request?.expires_at === "string" ? request.expires_at : null,
      offered_at:typeof account?.queue?.turn?.offered_at === "string" ? account.queue.turn.offered_at : null,
      turn_expires_at:typeof account?.queue?.turn?.expires_at === "string" ? account.queue.turn.expires_at : null,
      retry_after:typeof (account?.retry_after ?? result?.retry_after) === "string"
        ? (account?.retry_after ?? result?.retry_after) : null,
      message_id:typeof result?.message_id === "string" ? result.message_id : null
    };
  };
  const waitFor = result => {
    if (result?.status === "RATE_LIMIT_WAIT")
      return {kind:"PROVIDER", value:result.retry_after};
    if (result?.status === "ACCOUNT_DEFERRED" &&
        ["ACCOUNT_QUEUED","PROVIDER_DEFERRED","SEND_ACTIVE"].includes(result.account?.status))
      return {kind:result.account.status === "PROVIDER_DEFERRED" ? "PROVIDER" : "ACCOUNT",
        value:result.account.retry_after};
    return null;
  };
  const automaticWait = status =>
    ["ACCOUNT_QUEUED","SEND_ACTIVE","PROVIDER_DEFERRED"].includes(status);
  const readAccount = async () => {
    try {
      state.account_inspections += 1;
      const observed = await inspectAccount();
      if (!observed || typeof observed.status !== "string" || !observed.status ||
          typeof observed.account_key !== "string" || !observed.account_key ||
          state.last_outcome?.account_key && observed.account_key !== state.last_outcome.account_key)
        throw new TypeError("Inspect the same original account");
      const description = describe({status:"ACCOUNT_DEFERRED",account:observed});
      if (observed.status === "READY" || automaticWait(observed.status)) {
        if (observed.queue?.schema !== "commons.gmail-account-turns/v1")
          throw new TypeError("Receive the complete original account queue");
        if (observed.status !== "READY") deadline(observed.retry_after);
      }
      state.last_account_inspection = description;
      state.last_account_observation = copy(observed);
      return {observed, description};
    } catch (error) {
      state.status = "THREW";
      state.last_error = {name:String(error?.name || "Error"),at:iso(),phase:"ACCOUNT_INSPECTION"};
      await emit("THREW");
      throw error;
    }
  };
  const returnAccountDecision = async (observed, description) => {
    // A rolling allowance, active usage receiver, envelope or charged-attempt
    // result belongs to the original caller. It is not a new provider wait.
    returnedAccountDecision = {status:"ACCOUNT_DEFERRED",account:copy(observed),
      operation_key:operationKey,operation_lease:operationLease};
    state.status = "RETURNED";
    state.last_outcome = description;
    state.last_account_observation = copy(observed);
    state.next_retry_at = null;
    state.next_wait_kind = null;
    state.return_reason = "ACCOUNT_DECISION";
    await emit("ACCOUNT_DECISION");
    return returnedAccountDecision;
  };
  const stopDuringWait = async () => {
    state.status = "INTERRUPTED";
    await emit("INTERRUPTED");
    return {status:"CONTINUATION_INTERRUPTED", operation_key:operationKey,
      operation_lease:operationLease, retry_after:state.next_retry_at,
      previous_outcome:state.last_outcome};
  };
  const sleepTo = async (value, kind) => {
    let target = deadline(value);
    let inspect = kind === "ACCOUNT" && typeof inspectAccount === "function";
    state.status = "WAITING";
    state.next_retry_at = value;
    state.next_wait_kind = kind;
    state.waits += 1;
    await emit("WAITING");
    let announced = timestamp();
    while (timestamp() < target) {
      if (signal?.aborted) return false;
      const start = timestamp();
      await wait(Math.min(30000, Math.max(1, target - start)));
      const end = timestamp();
      state.waited_ms += Math.max(0, end - start);
      save();
      if (signal?.aborted) return false;
      // An active send lease is a maximum lifetime; its owner may release it
      // earlier. Receive the original account with the same cached controller
      // before waiting through a later advisory turn. No sender preflight or
      // acquisition is repeated until READY or this request needs renewal.
      if (inspect) {
        const {observed, description} = await readAccount();
        if (observed.status !== "READY" && !automaticWait(observed.status)) {
          await returnAccountDecision(observed, description);
          return false;
        }
        let continueReceiver = observed.status === "READY";
        if (continueReceiver) {
          state.next_retry_at = null;
          state.next_wait_kind = null;
        } else {
          target = deadline(observed.retry_after);
          state.next_retry_at = observed.retry_after;
          // Persist a newly observed provider floor before yielding to progress
          // callbacks, so interruption cannot restore an earlier account wait.
          if (observed.status === "PROVIDER_DEFERRED") {
            inspect = false;
            state.next_wait_kind = "PROVIDER";
          } else {
            const request = observed.queue.request;
            const expires = request ? deadline(request.expires_at) : null;
            // The original receiver renews or re-enters its original request.
            // Inspection itself remains read-only and never changes queue order.
            continueReceiver = !request || expires <= timestamp() + 30000;
          }
        }
        await emit("ACCOUNT_INSPECTED");
        if (continueReceiver) return true;
      }
      if (end - announced >= 60000 && timestamp() < target) {
        await emit("WAITING");
        announced = end;
      }
    }
    return !signal?.aborted;
  };
  // The original receiver owns all provider calls, journals, leases and send
  // reconciliation. This driver only keeps that same receiver present for
  // returned account turns and provider deadlines.
  // A resumed paced operation first receives current admission through the
  // already loaded account. This avoids reopening its full sender checkpoint
  // just to rediscover the same allowance or active usage-receiving decision.
  if (!state.next_retry_at && state.last_outcome?.status === "ACCOUNT_DEFERRED" &&
      state.last_outcome.account_status !== "READY" &&
      !automaticWait(state.last_outcome.account_status) &&
      typeof inspectAccount === "function") {
    const {observed, description} = await readAccount();
    if (observed.status !== "READY" && !automaticWait(observed.status))
      return returnAccountDecision(observed, description);
    if (automaticWait(observed.status)) {
      state.next_retry_at = observed.retry_after;
      state.next_wait_kind = observed.status === "PROVIDER_DEFERRED" ? "PROVIDER" : "ACCOUNT";
    }
    await emit("ACCOUNT_INSPECTED");
  }
  if (state.next_retry_at) {
    const savedKind = state.next_wait_kind ||
      (state.last_outcome?.status === "ACCOUNT_DEFERRED" &&
       ["ACCOUNT_QUEUED","SEND_ACTIVE"].includes(state.last_outcome.account_status)
        ? "ACCOUNT" : "PROVIDER");
    if (!(await sleepTo(state.next_retry_at,savedKind)))
      return returnedAccountDecision || stopDuringWait();
    state.next_retry_at = null;
  }
  let repeatedPastWait = null;
  while (true) {
    if (signal?.aborted) return stopDuringWait();
    state.status = "CALLING";
    delete state.return_reason;
    state.calls += 1;
    state.next_retry_at = null;
    await emit("CALLING");
    let result;
    try {
      result = await invoke();
    } catch (error) {
      state.status = "THREW";
      state.last_error = {name:String(error?.name || "Error"), at:iso()};
      // Preserve the receiver's exact thrown error and its original journal.
      // In particular, a Git403 without a returned retry deadline does not
      // become a timed retry and does not select a different provider route.
      await emit("THREW");
      throw error;
    }
    const prior = state.last_outcome;
    let description;
    let instruction;
    try {
      description = describe(result);
      instruction = waitFor(result);
      if (instruction) deadline(instruction.value);
    } catch (error) {
      state.status = "RETURNED";
      state.last_error = {name:String(error?.name || "Error"), at:iso(),
        reason:"INVALID_DEFERRED_RESULT"};
      await emit("RETURNED");
      return result;
    }
    state.last_outcome = description;
    if (result?.status === "ACCOUNT_DEFERRED" && result.account)
      state.last_account_observation = copy(result.account);
    if (description.queue_sequence !== null &&
        (description.queue_sequence !== prior?.queue_sequence ||
         description.queue_position !== prior?.queue_position))
      state.queue_changes += 1;
    if (description.queue_sequence !== null && prior?.queue_sequence !== null &&
        prior?.queue_sequence !== undefined &&
        description.queue_sequence !== prior.queue_sequence)
      state.queue_reenqueues += 1;
    if (!instruction) {
      state.status = "RETURNED";
      state.next_retry_at = null;
      await emit("RETURNED");
      return result;
    }
    state.next_retry_at = instruction.value;
    const target = deadline(instruction.value);
    if (target <= timestamp()) {
      const signature = JSON.stringify(description);
      if (signature === repeatedPastWait) {
        state.status = "RETURNED";
        state.return_reason = "WAIT_DEADLINE_NOT_ADVANCING";
        await emit("RETURNED");
        return result;
      }
      repeatedPastWait = signature;
    } else {
      repeatedPastWait = null;
    }
    if (!(await sleepTo(instruction.value,instruction.kind)))
      return returnedAccountDecision || stopDuringWait();
    state.next_retry_at = null;
  }
}

module.exports = {continueOriginalContact};
