'use strict';

const ACCOUNT_PAUSES = new Set([
  "PROVIDER_DEFERRED", "SEND_ACTIVE", "AUTOMATION_DEFERRED",
  "AUTOMATION_USAGE_REQUIRED", "AUTOMATION_USAGE_REFRESHING", "AUTOMATION_ENVELOPE_REQUIRED",
  "AUTOMATION_ENVELOPE_TOO_LARGE", "AUTOMATION_DISPATCH_RECONCILIATION_REQUIRED",
  "ACCOUNT_LEASE_CHANGED"
]);

function retainedAccountPause(observed) {
  if (!ACCOUNT_PAUSES.has(observed?.status)) return null;
  return {status: observed.status, observation: observed,
    retry_after: observed.retry_after || null};
}

function retainedDrainResult(result, results) {
  return {status: result.status, results,
    ...(result.observation ? {account: result.observation} : {}),
    ...(result.retry_after ? {retry_after: result.retry_after} : {}),
    ...(result.head ? {operation: result.head} : {})};
}

function selectConnectedContactTurn(observed) {
  if (!observed || typeof observed !== "object" || typeof observed.status !== "string")
    throw new TypeError("Complete original account inspection required");
  const paused = retainedAccountPause(observed);
  if (paused) return paused;
  if (!["READY", "ACCOUNT_QUEUED"].includes(observed.status))
    return {status: "ACCOUNT_OBSERVATION_REQUIRED", observation: observed,
      retry_after: observed.retry_after || null};
  if (!observed.queue || observed.queue.schema !== "commons.gmail-account-turns/v1")
    throw new TypeError("Complete original account queue inspection required");
  const queue = observed.queue;
  if (queue.active_operation_key)
    return {status: "SEND_ACTIVE", observation: observed, retry_after: observed.retry_after || null};
  const head = queue.next_operation;
  if (!head) {
    if (queue.waiting_count !== 0) throw new TypeError("Original account queue head missing");
    return {status: "ACCOUNT_EMPTY", observation: observed};
  }
  if (!/^[a-f0-9]{64}$/.test(head.operation_key || "") ||
      typeof head.operation_lease !== "string" || !head.operation_lease ||
      !Number.isSafeInteger(head.sequence) || head.sequence < 0)
    throw new TypeError("Original offered operation identity required");
  const first = observed.queue_page?.waiting?.[0];
  if (first && (first.operation_key !== head.operation_key ||
      first.operation_lease !== head.operation_lease || first.sequence !== head.sequence))
    throw new TypeError("Original account inspection contains inconsistent queue identities");
  return {status: "ORIGINAL_READY", head: {...head}, observation: observed};
}

function createConnectedFirstContactDrain(options) {
  const {readAccount, receiveOriginal, openOriginal, continueOriginal,
    reviewRelationship, withdrawCompleted, record = async () => {},
    checkpointSnapshot = async () => {}, onError = async () => {},
    shouldContinue = () => true, now = () => Date.now(),
    refreshAccountUsage} = options || {};
  for (const [name, fn] of Object.entries({readAccount, receiveOriginal,
    openOriginal, continueOriginal, reviewRelationship, withdrawCompleted,
    record, checkpointSnapshot, onError, shouldContinue, now}))
    if (typeof fn !== "function") throw new TypeError("Native drain callback required: " + name);
  if (refreshAccountUsage !== undefined && typeof refreshAccountUsage !== "function")
    throw new TypeError("Original account usage receiver must be a function");
  let running = false, usageReceived = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const emit = async (phase, details) => record({
    schema: "commons.connected-contact-drain-event/v1",
    phase, observed_at: new Date(now()).toISOString(), ...details
  });
  function identity(head, received) {
    const m = received?.metadata, p = received?.payload;
    if (!m || m.operation_key !== head.operation_key ||
        m.operation_lease !== head.operation_lease ||
        typeof m.state_key !== "string" || !m.state_key ||
        !/^[a-f0-9]{64}$/.test(m.input_sha256 || "") ||
        !p?.runtime_input || !p.journal ||
        p.journal.input_sha256 !== m.input_sha256 ||
        p.journal.lease !== m.operation_lease)
      throw new TypeError("Received checkpoint is not the offered original operation");
  }
  async function one() {
    let observed = await readAccount({limit: 1});
    // Reuse the maintained full Sent receiver once per caller-owned drain.
    // A stale snapshot never becomes permission and deferrals never trigger it.
    if (observed.status === "AUTOMATION_USAGE_REQUIRED" &&
        refreshAccountUsage && !usageReceived) {
      usageReceived = true;
      const received = await refreshAccountUsage({observation: observed});
      await emit("account_usage", {observation: observed, result: received});
      observed = await readAccount({limit: 1});
    }
    const selected = selectConnectedContactTurn(observed);
    await emit("account", {status: selected.status, revision: observed.revision,
      commit_sha: observed.commit_sha, next_operation: selected.head || null,
      retry_after: selected.retry_after || null, observation: observed});
    if (selected.status !== "ORIGINAL_READY") return selected;
    const {head} = selected;
    const received = await receiveOriginal(copy(head), observed);
    identity(head, received);
    const active = received.metadata.active;
    if (active && Number.isFinite(Date.parse(active.expires_at)) &&
        Date.parse(active.expires_at) > now())
      return {status: "ORIGINAL_DISPATCH_ACTIVE", head, active: copy(active)};
    const beforeSend = async spec => {
      const review = await reviewRelationship({
        head: copy(head), received, spec, phase: "before_send"
      });
      if (typeof review?.can_contact !== "boolean")
        throw new TypeError("Current original company decision required");
      await emit("relationship", {operation_key: head.operation_key,
        can_contact: review.can_contact});
      return review;
    };
    let opened = null, result, caught = null, closeError = null;
    try {
      opened = await openOriginal({head: copy(head), received, beforeSend});
      if (!opened || typeof opened.location !== "function" ||
          typeof opened.snapshot !== "function" || typeof opened.close !== "function")
        throw new TypeError("Original checkpoint runtime required");
      const location = opened.location();
      if (location.operation_key !== head.operation_key)
        throw new TypeError("Reopened checkpoint changed the original operation");
      await emit("opened", {operation_key: head.operation_key, location});
      result = await continueOriginal({head: copy(head), received, original: opened});
    } catch (error) {
      caught = error;
    } finally {
      if (opened) {
        // Preserve a returned send result even when its final Git write failed.
        try {
          await checkpointSnapshot({
            head: copy(head), location: opened.location(), snapshot: opened.snapshot()
          });
        } catch (error) { caught = caught || error; }
        try { await opened.close(); } catch (error) { closeError = error; }
      }
    }
    if (caught || closeError) {
      const error = caught || closeError;
      await onError({head: copy(head), error, close_error: closeError,
        location: opened?.location(), snapshot: opened?.snapshot()});
      await emit("interrupted", {operation_key: head.operation_key,
        code: error.code || null, message: String(error.message || error),
        location: opened?.location() || null});
      return {status: "ORIGINAL_CONTINUATION_REQUIRED", head,
        error: {code: error.code || null, message: String(error.message || error)},
        location: opened?.location() || null,
        ...(error.contact_outcome ? {contact_outcome: error.contact_outcome} : {})};
    }
    const location = opened.location();
    await emit("result", {operation_key: head.operation_key, result, location});
    // Only an independently verified native terminal result permits removing
    // a leftover passive row. Relationship decisions require their own native
    // completion/reconciliation; this coordinator does not invent one.
    if (result?.status === "SENT_VERIFIED") {
      const withdrawn = await withdrawCompleted({
        operation_key: head.operation_key,
        reason: "ORIGINAL_SENT_VERIFIED"
      }, {head, received, result, location});
      await emit("completed", {operation_key: head.operation_key,
        result, location, withdrawal: withdrawn});
      return {status: "ORIGINAL_COMPLETED", head, result, location, withdrawal: withdrawn};
    }
    if (result?.status === "ACCOUNT_DEFERRED") {
      const paused = retainedAccountPause(result.account);
      if (paused) return {...paused, head, result, location};
      // Only an actual changed ready/queued offer calls for reselection.
      // Envelope, usage or charged-attempt recovery must return to its owner.
      if (!["READY", "ACCOUNT_QUEUED"].includes(result.account?.status))
        return {status: "ACCOUNT_OBSERVATION_REQUIRED", head, result, location,
          observation: result.account || null,
          retry_after: result.account?.retry_after || null};
      return {status: "ORIGINAL_RESELECT", head, result, location};
    }
    return {status: "ORIGINAL_CONTINUATION_REQUIRED", head, result, location};
  }
  async function drain() {
    if (running) throw new TypeError("This original serial consumer is already running");
    running = true;
    usageReceived = false;
    const results = [];
    const unchangedSelections = new Set();
    try {
      while (await shouldContinue()) {
        const result = await one();
        results.push(result);
        if (result.status === "ORIGINAL_COMPLETED") {
          unchangedSelections.clear();
          continue;
        }
        if (result.status === "ORIGINAL_RESELECT") {
          const account = result.result?.account;
          const signature = JSON.stringify({
            operation: result.head.operation_key,
            revision: account?.revision,
            next: account?.queue?.next_operation,
            active: account?.queue?.active_operation_key
          });
          if (!unchangedSelections.has(signature)) {
            unchangedSelections.add(signature);
            continue;
          }
          return {status: "ORIGINAL_ACCOUNT_HANDOFF_REQUIRED", results};
        }
        return retainedDrainResult(result, results);
      }
      return {status: "CALLER_CONTINUATION", results};
    } finally {
      running = false;
    }
  }
  return Object.freeze({drain});
}

function createNativeConnectedFirstContactDrain(options) {
  const {tools, carrier, checkpoints, modules, drafts, storage, account: profile, owner, send_binding = "mcp__codex_apps__gmail_send_email",
    reviewRelationship, organizationQueryFor, selectContinuation,
    record = async () => {}, saveSnapshot = async () => {},
    shouldContinue = () => true, receiveOriginal: customReceiver} = options || {};
  if (!tools || !carrier?.createConnectedFirstContact ||
      !checkpoints?.openConnectedContactCheckpoint ||
      !checkpoints?.readConnectedContactCheckpoint ||
      !modules?.mailboxAdmission?.createConnectedMailboxAdmission ||
      typeof owner !== "string" || !owner ||
      typeof reviewRelationship !== "function" ||
      typeof organizationQueryFor !== "function")
    throw new TypeError("Complete original native account, source and company readers required");
  const accountEvents = [], chunks = new Map();
  const account = modules.mailboxAdmission.createConnectedMailboxAdmission({
    tools, storage, account: profile, send_binding, sha256Utf8: modules.sha256Utf8,
    classifyReturnedGmailRateLimit: carrier.classifyReturnedGmailRateLimit,
    classifyReturnedSendRateLimit: carrier.classifyReturnedSendRateLimit,
    record: async event => {accountEvents.push(event); await record({
      schema:"commons.connected-contact-drain-account-event/v1",event});},
    history: () => accountEvents
  });
  if (account.manual_headroom !== "rolling_usage_v2" ||
      typeof account.refreshAutomationUsage !== "function")
    throw new TypeError("Load the paired current manual-headroom account and sender sources");
  async function receiveOriginal(head, observed) {
    if (customReceiver) return customReceiver(head, observed);
    const received = await checkpoints.readConnectedContactCheckpoint({
      tools, storage, sha256Utf8: modules.sha256Utf8, operationKey: head.operation_key,
      ...(chunks.has(head.operation_key) ? {chunkCache:chunks.get(head.operation_key)} : {})
    });
    chunks.set(head.operation_key, received.chunk_cache);
    return received;
  }
  async function openOriginal({head, received, beforeSend}) {
    const input = received.payload.runtime_input, metadata = received.metadata;
    let factory = carrier;
    if (input.native_draft) {
      if (typeof drafts?.createConnectedExistingFirstContactDraft !== "function")
        throw new TypeError("Original existing-draft receiver required for this saved draft");
      factory = {...carrier, createConnectedFirstContact: context =>
        drafts.createConnectedExistingFirstContactDraft({
          ...context, createConnectedFirstContact: carrier.createConnectedFirstContact
        })};
    }
    return checkpoints.openConnectedContactCheckpoint({
      tools, storage, factory, modules, input,
      lease: metadata.operation_lease, stateKey: metadata.state_key,
      owner, mode:"reopen", beforeSend,
      organizationQuery: await organizationQueryFor({head,received}),
      githubActorAction:"github_get_profile", githubRefAction:"github_fetch",
      ...(received.chunk_cache ? {chunkCache:received.chunk_cache} : {})
    });
  }
  async function continueOriginal(context) {
    const {original, received} = context, journal = received.payload.journal;
    const selected = selectContinuation ? await selectContinuation(context) : null;
    if (selected) {
      if (!["run","resumeRecipient","resumeRateLimited","resumeConsole","reconcile"].includes(selected.method) ||
          !Array.isArray(selected.args ?? []))
        throw new TypeError("Original native continuation method required");
      return original[selected.method](...(selected.args ?? []));
    }
    if (journal.outcome?.status === "SENT_VERIFIED") return original.run();
    if (journal.console_handoff) return original.resumeConsole(journal.console_handoff);
    if (journal.returned_mailbox_revision) return original.resumeRateLimited();
    const invoked = journal.events.some(event =>
      event.phase === "invoking" && /^mcp__codex_apps__gmail_send_(email|draft)$/.test(event.binding || ""));
    if (invoked) {
      // The original reconciler receives an existing result. The consumer never
      // chooses a fresh invocation merely because a local completion is absent.
      if (journal.receipt?.message_id) return original.reconcile(journal.receipt.message_id);
      return {status:"ORIGINAL_RECONCILIATION_REQUIRED", outcome:journal.outcome || null};
    }
    return original.run();
  }
  return createConnectedFirstContactDrain({
    readAccount: args => account.inspect(args),
    refreshAccountUsage: () => account.refreshAutomationUsage(),
    receiveOriginal, openOriginal,
    continueOriginal, reviewRelationship, record, shouldContinue,
    withdrawCompleted: args => account.withdraw(args),
    checkpointSnapshot: saveSnapshot,
    onError: async detail => saveSnapshot({
      head:detail.head,location:detail.location,snapshot:detail.snapshot,
      error:{message:String(detail.error?.message || detail.error),code:detail.error?.code || null}
    })
  });
}

module.exports = {selectConnectedContactTurn, createConnectedFirstContactDrain, createNativeConnectedFirstContactDrain};
