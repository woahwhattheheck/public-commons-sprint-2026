// MIT. Private checkout state composes the original SF88 operation and original paid-job buyer.
import { lstat, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readBytes, readJson, writeBytes, writeJson,
  parseJson, jsonBytes, digest, exists, object, syncDirectory } from '../../node/store.mjs';
import { canonicalDirectory, HASH, requireValue, failure, now } from '../state.mjs';
import { SCHEMA, PHASES, MAX_TICKET_BYTES, readJobCheckoutTicket, validateProfile,
  reviewSummary, resultSummary, matchesOriginalRequest } from './contract.mjs';

const RUNNING = new Set(['RUNNING', 'CANCELLING']);
const NATIVE_SCHEMA = 'stellar-forge.node-buyer.v1';
const labelValue = value => requireValue(typeof value === 'string' && value.length <= 512 &&
  !/[\x00-\x1f\x7f]/.test(value), 'JOB_LABEL_INVALID');
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => digest(jsonBytes(canonical(left))) === digest(jsonBytes(canonical(right)));

async function privateFile(path, limit = MAX_TICKET_BYTES) {
  path = absolute(path);
  const stat = await lstat(path);
  requireValue(stat.isFile() && !stat.isSymbolicLink() &&
    (process.platform === 'win32' || !(stat.mode & 0o077) && (!process.getuid || stat.uid === process.getuid())),
    'PRIVATE_CLAIM_FILE_REQUIRED');
  return readBytes(path, limit);
}
async function immutable(path, raw) {
  try { await writeBytes(path, raw, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireValue((await readBytes(path, Math.max(MAX_TICKET_BYTES, raw.length))).equals(raw),
      'JOB_CHECKOUT_FILE_CHANGED', 409);
  }
}

/** Borrows the already acquired customer workspace lease; never creates a second payment journal. */
export async function openJobCheckout({ directory, lease, adopt, operatorWorkspace, operatorProfile,
  runtimeDirectory = fileURLToPath(new URL('../../', import.meta.url)),
  environment = process.env, timeoutMs = 360000 } = {}) {
  directory = await canonicalDirectory(directory, { privateState: true, create: true });
  requireValue(lease && typeof lease.assertHeld === 'function' && typeof adopt === 'function',
    'JOB_CHECKOUT_WORKSPACE_REQUIRED');
  lease.assertHeld();
  requireValue(!(operatorWorkspace !== undefined && operatorProfile !== undefined),
    'JOB_CHECKOUT_OPERATOR_SELECTION_CONFLICT');
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000,
    'JOB_CHECKOUT_TIMEOUT_INVALID');
  runtimeDirectory = absolute(runtimeDirectory);
  const selected = operatorWorkspace !== undefined
    ? { kind: 'workspace', directory: absolute(operatorWorkspace), runtimeDirectory }
    : operatorProfile !== undefined
      ? { kind: 'profile', path: absolute(operatorProfile), runtimeDirectory } : null;
  for (const name of ['records', 'native']) await privateDirectory(join(directory, name));
  const nativeRoot = join(directory, 'native'), rows = new Map();
  let tail = Promise.resolve(), activeTask = null, closing = false, closePromise = null;
  let approvals = null;
  const serial = action => {
    const promise = tail.then(() => { lease.assertHeld(); return action(); });
    tail = promise.catch(() => {}); return promise;
  };
  const open = () => requireValue(!closing, 'JOB_CHECKOUT_CLOSING', 503);
  const rowPath = id => join(directory, 'records', id);
  const recordPath = id => join(rowPath(id), 'record.json');
  const ticketPath = (id, sha) => join(rowPath(id), 'tickets', sha + '.json');
  const row = id => {
    requireValue(typeof id === 'string' && HASH.test(id), 'JOB_CHECKOUT_ID_INVALID');
    const value = rows.get(id);
    requireValue(value, 'JOB_CHECKOUT_NOT_FOUND', 404); return value;
  };
  function validate(value) {
    requireValue(object(value) && value.schema === SCHEMA && HASH.test(value.id ?? '') &&
      value.intentId === 'job-checkout:' + value.id && HASH.test(value.handoffSha256 ?? '') &&
      HASH.test(value.bindingSha256 ?? '') && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      PHASES.includes(value.phase) && typeof value.label === 'string' && value.label.length <= 512 &&
      typeof value.attempted === 'boolean' && object(value.ticket) && object(value.operator) &&
      ['workspace', 'profile'].includes(value.operator.kind) &&
      absolute(value.runtimeDirectory) === value.runtimeDirectory &&
      value.nativeDirectory === join(nativeRoot, digest(value.intentId)) &&
      (value.jobEntryId === null || HASH.test(value.jobEntryId ?? '')) &&
      (value.reviewSha256 === null || HASH.test(value.reviewSha256 ?? '')) &&
      Array.isArray(value.history) && value.history.length <= 128,
      'JOB_CHECKOUT_STATE_INVALID');
    if (value.operator.kind === 'workspace')
      requireValue(absolute(value.operator.directory) === value.operator.directory, 'JOB_CHECKOUT_STATE_INVALID');
    else requireValue(HASH.test(value.operator.profileSha256 ?? '') &&
      absolute(value.operator.sourcePath) === value.operator.sourcePath, 'JOB_CHECKOUT_STATE_INVALID');
    return value;
  }
  async function save(before, changes, action, detail = {}) {
    lease.assertHeld();
    requireValue(!(before.attempted && changes.attempted === false),
      'JOB_CHECKOUT_ATTEMPT_FACT_IMMUTABLE', 409);
    const value = validate({ ...structuredClone(before), ...structuredClone(changes),
      revision: before.revision + 1, updatedAt: now(),
      history: [...before.history, { at: now(), action, previousRevision: before.revision,
        revision: before.revision + 1, ...detail }].slice(-128) });
    requireValue(jsonBytes(value).length <= 262144, 'JOB_CHECKOUT_STATE_TOO_LARGE');
    await writeJson(recordPath(value.id), value);
    rows.set(value.id, value);
    return value;
  }
  async function ticketFor(value, sha = value.handoffSha256) {
    const ticket = readJobCheckoutTicket(await privateFile(ticketPath(value.id, sha)));
    requireValue(ticket.id === value.id && ticket.intentId === value.intentId &&
      ticket.handoffSha256 === sha && ticket.bindingSha256 === value.bindingSha256,
      'JOB_CHECKOUT_TICKET_CHANGED', 409);
    return ticket;
  }
  async function buyerFor(value) {
    let profile;
    if (value.operator.kind === 'profile') {
      const path = join(rowPath(value.id), 'operator-profile.json');
      const raw = await privateFile(path);
      requireValue(digest(raw) === value.operator.profileSha256, 'JOB_CHECKOUT_PROFILE_CHANGED', 409);
      // Only configuration references are retained; the original signer owns its keys.
      profile = validateProfile(raw);
    }
    const { Buyer } = await import('../../node/client.mjs');
    return new Buyer({ runtimeDirectory: value.runtimeDirectory, stateDirectory: nativeRoot,
      ...(profile === undefined ? {} : { operatorProfile: profile }),
      environment: approvals ? { ...environment, ...approvals.environment } : environment, timeoutMs });
  }
  async function checkBrowserRuntime(value, operation, signal) {
    if (!approvals) return;
    // Import the bridge beside this record's retained SF88 runtime. A current
    // host must not probe or execute a different saved accounting implementation.
    const bridgePath = join(value.runtimeDirectory, '../sf81-buyer-operator-bridge/bridge.mjs');
    const bridge = await import(pathToFileURL(bridgePath).href);
    requireValue(typeof bridge.probeOperatorApprovalCapabilities === 'function',
      'JOB_CHECKOUT_BROWSER_RUNTIME_UNSUPPORTED', 409);
    const configuration = await readJson(operation.configPath, 65536);
    const capability = await bridge.probeOperatorApprovalCapabilities(
      { python: configuration.operator?.python }, { timeoutMs: 3000, signal });
    requireValue(capability.supported === true,
      capability.code === 'OPERATOR_CAPABILITIES_UNSUPPORTED'
        ? 'JOB_CHECKOUT_BROWSER_RUNTIME_UNSUPPORTED' : capability.code ?? 'OPERATOR_CAPABILITIES_INVALID', 409);
  }
  async function original(value, ticket, { partial = false } = {}) {
    const buyer = await buyerFor(value), operation = buyer.operation(value.intentId);
    requireValue(operation.directory === value.nativeDirectory, 'JOB_CHECKOUT_NATIVE_DIRECTORY_CHANGED', 409);
    if (!await exists(operation.directory)) {
      requireValue(!value.attempted && value.native === null && value.jobEntryId === null,
        'JOB_CHECKOUT_ORIGINAL_ATTEMPT_DIRECTORY_REQUIRED', 409);
      return { buyer, operation, present: false, incomplete: false, attempted: false };
    }
    await privateDirectory(operation.directory, { create: false });
    const hasResult = await exists(join(operation.directory, 'result.json'));
    const attempted = value.attempted || hasResult || await exists(join(operation.directory, 'attempt.json'));
    const metaPath = join(operation.directory, 'operation.json');
    const meta = await exists(metaPath) ? await readJson(metaPath) : null;
    if (!meta || meta.state === 'PREPARING') {
      requireValue(partial && !attempted && !hasResult &&
        (!meta || meta.schema === NATIVE_SCHEMA && meta.intentId === value.intentId),
        'JOB_CHECKOUT_NATIVE_PREPARATION_INCOMPLETE', 409);
      return { buyer, operation, present: true, incomplete: true, attempted: false };
    }
    requireValue(meta.schema === NATIVE_SCHEMA && meta.intentId === value.intentId && meta.state === 'PREPARED' &&
      meta.runtimeDirectory === value.runtimeDirectory &&
      (meta.nativeWorkspace ?? null) === (value.operator.kind === 'workspace' ? value.operator.directory : null),
      'JOB_CHECKOUT_NATIVE_BINDING_CHANGED', 409);
    const configRaw = await readBytes(operation.configPath), config = parseJson(configRaw);
    const request = matchesOriginalRequest(config, ticket);
    requireValue(request.bodyFile === join(operation.directory, 'request.body') &&
      config.responseFile.destination === join(operation.directory, 'response.bin') &&
      digest(configRaw) === meta.configSha256, 'JOB_CHECKOUT_NATIVE_BINDING_CHANGED', 409);
    const body = await readBytes(request.bodyFile);
    requireValue(body.equals(Buffer.from(ticket.body)) && digest(body) === meta.bodySha256,
      'JOB_CHECKOUT_NATIVE_BODY_CHANGED', 409);
    // inspect reuses the original binding/attempt/result implementation.
    const inspected = await operation.inspect();
    return { buyer, operation, present: true, incomplete: false, attempted, inspected };
  }
  function item(value) {
    const ownTask = activeTask?.id === value.id ? activeTask.public : value.lastTask;
    const busy = Boolean(activeTask);
    const pending = value.pendingTicket !== null;
    return { id: value.id, intentId: value.intentId, label: value.label, revision: value.revision,
      phase: value.phase, createdAt: value.createdAt, updatedAt: value.updatedAt,
      ticket: structuredClone(value.ticket), handoffSha256: value.handoffSha256,
      operator: structuredClone(value.operator), runtimeDirectory: value.runtimeDirectory,
      nativeDirectory: value.nativeDirectory, attempted: value.attempted,
      review: structuredClone(value.review), native: structuredClone(value.native),
      jobEntryId: value.jobEntryId, lastError: value.lastError, task: structuredClone(ownTask),
      pendingTicket: pending, history: structuredClone(value.history),
      actions: {
        review: !busy && !pending && !value.attempted && value.phase !== 'ACCEPTED',
        execute: !busy && !pending && !value.attempted && value.phase === 'REVIEWED' && value.reviewSha256 !== null,
        recover: !busy,
        replace: !busy && !pending && !value.attempted && value.phase !== 'ACCEPTED',
        stop: activeTask?.id === value.id && activeTask.public.state === 'RUNNING',
      } };
  }

  // The owning private HTTP host enables this before listening. A browser body
  // cannot select a socket, token, operator profile or broker directory.
  async function enableBrowserApproval() {
    return serial(async () => {
      open();
      if (approvals) return { mode: 'BROWSER' };
      requireValue(!activeTask, 'JOB_CHECKOUT_OPERATION_ACTIVE', 409);
      const { createBrowserApprovalBroker } = await import('../../../sf81-buyer-operator-bridge/browser-approval.mjs');
      // The original broker creates its own private, short-lived socket directory.
      // Retained checkout paths can exceed the platform's Unix socket path limit.
      approvals = await createBrowserApprovalBroker();
      return { mode: 'BROWSER' };
    });
  }
  function approval(id) {
    const value = row(id), task = activeTask?.id === id ? activeTask.public : null;
    return { checkoutId: id, intentId: value.intentId, mode: approvals ? 'BROWSER' : 'TERMINAL',
      taskId: task?.id ?? null, executing: task?.kind === 'execute' && task.state === 'RUNNING',
      snapshot: approvals ? approvals.snapshot(value.intentId) : null };
  }
  async function decideApproval(id, { intent, approvalId, requestSha256, decision, taskId } = {}) {
    return serial(async () => {
      open(); const value = row(id), task = activeTask?.id === id ? activeTask : null;
      requireValue(approvals, 'JOB_CHECKOUT_BROWSER_APPROVAL_REQUIRED', 409);
      requireValue(intent === value.intentId, 'JOB_CHECKOUT_APPROVAL_INTENT_CHANGED', 409);
      requireValue(task && taskId === task.public.id && task.public.kind === 'execute' &&
        task.public.state === 'RUNNING', 'JOB_CHECKOUT_APPROVAL_TASK_CHANGED', 409);
      requireValue(typeof approvalId === 'string' && approvalId.length > 0 && approvalId.length <= 256 &&
        HASH.test(requestSha256 ?? '') && ['approve', 'reject'].includes(decision),
        'JOB_CHECKOUT_APPROVAL_DECISION_INVALID');
      await approvals.decide({ intent: value.intentId, approvalId, requestSha256, decision });
      await save(row(id), {}, 'browser-approval-decided',
        { taskId, approvalId, requestSha256, decision });
      return { checkout: item(row(id)), approval: approval(id) };
    });
  }

  async function archivePreparation(value, ticket, archiveId, { incompleteOnly = false } = {}) {
    const current = await original(value, ticket, { partial: true });
    if (!current.present) return null;
    requireValue(!current.attempted && (!incompleteOnly || current.incomplete),
      'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
    const parent = await privateDirectory(join(rowPath(value.id), 'preparations'));
    const destination = join(parent, archiveId);
    requireValue(!await exists(destination), 'JOB_CHECKOUT_ARCHIVE_EXISTS', 409);
    // These directories belong to this leased application. An original attempt
    // marker is never removed, expired or archived to obtain another execution.
    requireValue(!await exists(join(current.operation.directory, 'attempt.json')) &&
      !await exists(join(current.operation.directory, 'result.json')),
      'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
    await rename(current.operation.directory, destination);
    await syncDirectory(nativeRoot); await syncDirectory(parent);
    return destination;
  }
  async function finishReplacement(value) {
    const pending = value.pendingTicket;
    requireValue(object(pending) && HASH.test(pending.handoffSha256 ?? '') &&
      typeof pending.reason === 'string' && /^[a-f0-9-]{36}$/.test(pending.archiveId ?? ''),
      'JOB_CHECKOUT_REPLACEMENT_INVALID');
    const previous = await ticketFor(value), next = await ticketFor(value, pending.handoffSha256);
    requireValue(next.summary.merchantRevision > previous.summary.merchantRevision,
      'JOB_CHECKOUT_NEWER_MERCHANT_TICKET_REQUIRED', 409);
    const destination = join(rowPath(value.id), 'preparations', pending.archiveId);
    if (await exists(destination)) {
      await privateDirectory(destination, { create: false });
      requireValue(!await exists(join(destination, 'attempt.json')) &&
        !await exists(join(destination, 'result.json')) && !await exists(value.nativeDirectory),
        'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
    } else await archivePreparation(value, previous, pending.archiveId);
    return save(row(value.id), { handoffSha256: next.handoffSha256, ticket: next.summary,
      phase: 'IMPORTED', attempted: false, review: null, reviewSha256: null, native: null,
      lastError: null, pendingTicket: null, lastTask: null }, 'ticket-replaced', {
        reason: pending.reason, previousHandoffSha256: value.handoffSha256,
        handoffSha256: next.handoffSha256, merchantRevision: next.summary.merchantRevision,
        preparationArchive: destination,
      });
  }
  async function importTicket({ handoffBytes, label } = {}) {
    open(); const ticket = readJobCheckoutTicket(handoffBytes);
    if (label !== undefined) labelValue(label);
    return serial(async () => {
      open();
      const existing = rows.get(ticket.id);
      if (existing) {
        requireValue(existing.handoffSha256 === ticket.handoffSha256,
          'JOB_CHECKOUT_TICKET_EXISTS_USE_REPLACE', 409);
        return { checkout: item(existing), reused: true };
      }
      requireValue(selected, 'JOB_CHECKOUT_OPERATOR_REQUIRED', 409);
      requireValue(rows.size < 10000, 'JOB_CHECKOUT_CAPACITY_REACHED', 409);
      const root = await privateDirectory(rowPath(ticket.id));
      await privateDirectory(join(root, 'tickets'));
      await immutable(ticketPath(ticket.id, ticket.handoffSha256), ticket.raw);
      let operator;
      if (selected.kind === 'workspace') {
        operator = { kind: 'workspace', directory: await canonicalDirectory(selected.directory, { privateState: true }) };
      } else {
        const raw = await privateFile(selected.path);
        validateProfile(raw);
        await immutable(join(root, 'operator-profile.json'), raw);
        operator = { kind: 'profile', sourcePath: selected.path, profileSha256: digest(raw) };
      }
      const timestamp = now();
      const value = validate({ schema: SCHEMA, id: ticket.id, intentId: ticket.intentId,
        label: label ?? ticket.summary.label ?? ticket.summary.jobId, revision: 0,
        phase: 'IMPORTED', createdAt: timestamp, updatedAt: timestamp, handoffSha256: ticket.handoffSha256,
        bindingSha256: ticket.bindingSha256, ticket: ticket.summary, operator,
        runtimeDirectory: selected.runtimeDirectory, nativeDirectory: join(nativeRoot, digest(ticket.intentId)),
        attempted: false, review: null, reviewSha256: null, native: null, jobEntryId: null,
        lastError: null, lastTask: null, pendingTicket: null,
        history: [{ at: timestamp, action: 'ticket-imported', revision: 0, handoffSha256: ticket.handoffSha256 }] });
      await writeJson(recordPath(value.id), value, { exclusive: true });
      rows.set(value.id, value);
      return { checkout: item(value), reused: false };
    });
  }
  async function replaceTicket(id, { handoffBytes, expectedRevision, reason } = {}) {
    open(); const next = readJobCheckoutTicket(handoffBytes);
    requireValue(typeof reason === 'string' && reason.trim() && reason.length <= 500 &&
      !/[\x00-\x1f\x7f]/.test(reason), 'JOB_CHECKOUT_REASON_REQUIRED');
    return serial(async () => {
      open(); const value = row(id);
      requireValue(expectedRevision === value.revision, 'JOB_CHECKOUT_REVISION_CONFLICT', 409);
      requireValue(!activeTask && !value.attempted && value.phase !== 'ACCEPTED' && value.pendingTicket === null,
        'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
      requireValue(next.id === id && next.bindingSha256 === value.bindingSha256 &&
        next.summary.merchantRevision > value.ticket.merchantRevision,
        'JOB_CHECKOUT_NEWER_MATCHING_TICKET_REQUIRED', 409);
      const before = await ticketFor(value), native = await original(value, before, { partial: true });
      requireValue(!native.attempted, 'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
      await immutable(ticketPath(id, next.handoffSha256), next.raw);
      const staged = await save(value, { pendingTicket: { handoffSha256: next.handoffSha256,
        reason, archiveId: randomUUID() } }, 'ticket-replacement-staged',
      { handoffSha256: next.handoffSha256, reason });
      try { return item(await finishReplacement(staged)); }
      catch (error) { await save(row(id), { lastError: failure(error) }, 'ticket-replacement-interrupted'); throw error; }
    });
  }
  async function prepared(value, ticket, signal) {
    let native = await original(value, ticket, { partial: true });
    requireValue(!native.attempted, 'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
    if (native.incomplete) {
      const destination = await archivePreparation(value, ticket, randomUUID(), { incompleteOnly: true });
      await serial(() => save(row(value.id), { review: null, reviewSha256: null, phase: 'IMPORTED' },
        'incomplete-preparation-retained', { preparationArchive: destination }));
      native = await original(value, ticket, { partial: true });
    }
    signal.throwIfAborted();
    let created = false;
    if (!native.present) {
      const options = { body: ticket.body, responseFile: { maxBytes: 65536, timeoutMs: 30000,
        expectedContentType: 'application/json' } };
      if (value.operator.kind === 'workspace')
        await native.buyer.fromWorkspace(value.operator.directory,
          { configuration: { operation: ticket.operation }, ...options, signal });
      else await native.buyer.fromRequest({ ...ticket.operation, body: ticket.body }, {
        responseFile: options.responseFile, signal });
      created = true;
      native = await original(value, ticket);
    }
    signal.throwIfAborted();
    return { ...native, created };
  }
  async function adoptResult(value, ticket, result) {
    requireValue(result.record?.intentId === value.intentId, 'JOB_CHECKOUT_RESULT_INTENT_CHANGED', 409);
    const summary = resultSummary(result);
    await serial(() => save(row(value.id), { attempted: true, native: summary,
      phase: 'FINISHED', lastError: null }, 'native-result-recorded'));
    if (result.native?.httpStatus !== 202 || result.native?.status !== 'DELIVERED_REPORTED_SETTLED') return;
    // The original job buyer verifies the response bytes and exact anticipated
    // acceptance, then retains its original SF88_NATIVE_RESULT purchase record.
    const accepted = await adopt({ result, handoff: ticket.handoff, label: value.label });
    requireValue(HASH.test(accepted?.entry?.id ?? ''), 'JOB_CHECKOUT_ADOPTION_INVALID');
    await serial(() => save(row(value.id), { jobEntryId: accepted.entry.id,
      phase: 'ACCEPTED', lastError: null }, 'accepted-job-retained', { jobEntryId: accepted.entry.id }));
  }
  async function setStage(task, stage) {
    task.public = { ...task.public, stage };
    await serial(() => save(row(task.id), { lastTask: task.public }, 'checkout-stage', { stage }));
  }
  async function run(task) {
    let error = null;
    try {
      let value = row(task.id);
      if (value.pendingTicket !== null) {
        requireValue(task.public.kind === 'recover', 'JOB_CHECKOUT_REPLACEMENT_RECOVERY_REQUIRED', 409);
        await serial(async () => { value = await finishReplacement(row(task.id)); });
      }
      const ticket = await ticketFor(value), signal = task.controller.signal;
      signal.throwIfAborted();
      if (task.public.kind === 'review') {
        const native = await prepared(value, ticket, signal);
        await setStage(task, 'REVIEWING');
        const review = native.created ? await readJson(join(native.operation.directory, 'review.json')) :
          await native.operation.review({ signal });
        signal.throwIfAborted();
        await original(row(task.id), ticket);
        const summary = reviewSummary(review);
        requireValue(summary.intentId === value.intentId && summary.sellerUrl === ticket.operation.url &&
          summary.bodySha256 === ticket.summary.bodySha256 && summary.method === 'POST' &&
          same(summary.acceptedTerms, ticket.operation.expect), 'JOB_CHECKOUT_REVIEW_BINDING_CHANGED', 409);
        await serial(() => save(row(task.id), { review: summary, reviewSha256: digest(jsonBytes(review)),
          phase: 'REVIEWED', attempted: false, lastError: null }, 'request-reviewed'));
      } else if (task.public.kind === 'execute') {
        const native = await original(value, ticket);
        requireValue(native.present && !native.attempted && value.phase === 'REVIEWED' &&
          value.reviewSha256 !== null, 'JOB_CHECKOUT_MATCHING_REVIEW_REQUIRED', 409);
        const review = await readJson(join(native.operation.directory, 'review.json'));
        requireValue(digest(jsonBytes(review)) === value.reviewSha256,
          'JOB_CHECKOUT_REVIEW_CHANGED', 409);
        signal.throwIfAborted();
        await checkBrowserRuntime(value, native.operation, signal);
        signal.throwIfAborted();
        const result = await native.operation.execute({ review, signal });
        await setStage(task, 'RETAINING_RESULT');
        await adoptResult(row(task.id), ticket, result);
      } else {
        const native = await original(value, ticket, { partial: true });
        if (native.incomplete) {
          const destination = await archivePreparation(value, ticket, randomUUID(), { incompleteOnly: true });
          await serial(() => save(row(task.id), { phase: 'IMPORTED', review: null,
            reviewSha256: null, attempted: false, lastError: null }, 'incomplete-preparation-retained',
          { preparationArchive: destination }));
        } else if (native.present) {
          const result = await native.operation.recover();
          if (result) await adoptResult(row(task.id), ticket, result);
          else await serial(() => save(row(task.id), {
            attempted: native.attempted, phase: native.attempted ? 'RECOVERABLE' : row(task.id).phase,
            lastError: native.attempted ? 'JOB_CHECKOUT_NATIVE_RESULT_PENDING' : null,
          }, 'native-operation-reopened'));
        } else await serial(() => save(row(task.id), { phase: 'IMPORTED',
          attempted: false, review: null, reviewSha256: null, lastError: null }, 'retained-ticket-reopened'));
      }
    } catch (caught) {
      error = task.controller.signal.aborted ? 'JOB_CHECKOUT_OPERATION_CANCELLED' : failure(caught);
      // Reconcile only original files after an exception. Never replay execute.
      const value = row(task.id);
      try {
        const ticket = await ticketFor(value), native = await original(value, ticket, { partial: true });
        if (native.attempted) {
          await serial(() => save(row(task.id), { attempted: true,
            phase: row(task.id).phase === 'ACCEPTED' ? 'ACCEPTED' : 'RECOVERABLE' }, 'original-attempt-observed'));
          const result = native.present && !native.incomplete ? await native.operation.recover() : null;
          if (result) await adoptResult(row(task.id), ticket, result);
        }
      } catch { /* Original files and the action error remain available for explicit recovery. */ }
    } finally {
      if (approvals && task.public.kind === 'execute') {
        try { await approvals.revoke(row(task.id).intentId); }
        catch (caught) { error ??= failure(caught); }
      }
      const accepted = row(task.id).phase === 'ACCEPTED';
      const completed = { ...task.public, state: error && !accepted
        ? task.controller.signal.aborted ? 'CANCELLED' : 'FAILED' : 'COMPLETE',
        completedAt: now(), error: accepted ? null : error };
      task.public = completed;
      try {
        await serial(() => save(row(task.id), { lastTask: completed,
          lastError: accepted ? null : error ?? row(task.id).lastError }, 'checkout-operation-finished',
        { kind: completed.kind, taskId: completed.id, state: completed.state }));
      } finally { if (activeTask === task) activeTask = null; }
    }
  }
  function start(id, { kind = 'review', expectedRevision } = {}) {
    return serial(async () => {
      open(); const value = row(id);
      requireValue(['review', 'execute', 'recover'].includes(kind), 'JOB_CHECKOUT_ACTION_INVALID');
      requireValue(expectedRevision === value.revision, 'JOB_CHECKOUT_REVISION_CONFLICT', 409);
      requireValue(!activeTask, 'JOB_CHECKOUT_OPERATION_ACTIVE', 409);
      requireValue(kind === 'recover' || !value.attempted && value.phase !== 'ACCEPTED' &&
        value.pendingTicket === null, 'JOB_CHECKOUT_ATTEMPT_REQUIRES_RECOVERY', 409);
      requireValue(kind !== 'execute' || value.phase === 'REVIEWED' && value.reviewSha256 !== null,
        'JOB_CHECKOUT_MATCHING_REVIEW_REQUIRED', 409);
      const task = { id, controller: new AbortController(), public: {
        id: randomUUID(), kind, state: 'RUNNING', stage: kind === 'review' ? 'PREPARING' :
          kind === 'execute' ? 'EXECUTING' : 'RECOVERING', startedAt: now(), completedAt: null, error: null } };
      await save(value, { lastTask: task.public, lastError: null }, 'checkout-operation-started',
        { kind, taskId: task.public.id });
      activeTask = task;
      task.promise = run(task);
      task.promise.catch(() => {});
      return item(row(id));
    });
  }
  async function cancel(id, { taskId } = {}) {
    return serial(async () => {
      open(); const value = row(id), task = activeTask?.id === id ? activeTask : null;
      if (!task) return item(value);
      requireValue(taskId === undefined || taskId === task.public.id, 'JOB_CHECKOUT_TASK_CHANGED', 409);
      task.public = { ...task.public, state: 'CANCELLING' };
      const failures = [];
      try {
        await save(value, { lastTask: task.public }, 'checkout-stop-requested', { taskId: task.public.id });
      } catch (error) { failures.push(error); }
      try { if (approvals) await approvals.revoke(value.intentId); }
      catch (error) { failures.push(error); }
      finally {
        task.controller.abort(Object.assign(new Error('JOB_CHECKOUT_OPERATION_CANCELLED'),
          { code: 'JOB_CHECKOUT_OPERATION_CANCELLED' }));
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'JOB_CHECKOUT_STOP_FAILED');
      return item(row(id));
    });
  }
  function list({ q = '', phase = '', offset = 0, limit = 50 } = {}) {
    requireValue(typeof q === 'string' && q.length <= 1000 && ['', ...PHASES].includes(phase) &&
      Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200,
      'JOB_CHECKOUT_FILTER_INVALID');
    const needle = q.toLocaleLowerCase();
    const found = [...rows.values()].filter(value => (!phase || value.phase === phase) &&
      [value.label, value.ticket.jobId, value.ticket.functionId, value.ticket.sellerUrl, value.intentId]
        .join(' ').toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { total: found.length, offset, limit, items: found.slice(offset, offset + limit).map(item) };
  }
  function status() {
    const counts = {};
    for (const value of rows.values()) counts[value.phase] = (counts[value.phase] ?? 0) + 1;
    return { schema: SCHEMA, directory, runtimeDirectory, entries: rows.size, counts, capacity: 1, closing,
      approvalMode: approvals ? 'BROWSER' : 'TERMINAL',
      selection: selected ? structuredClone(selected) : null,
      active: activeTask ? { checkoutId: activeTask.id, ...activeTask.public } : null };
  }

  const names = (await readdir(join(directory, 'records'))).filter(name => HASH.test(name)).sort();
  requireValue(names.length <= 10000, 'JOB_CHECKOUT_CAPACITY_REACHED');
  for (const id of names) {
    await privateDirectory(rowPath(id), { create: false });
    if (!await exists(recordPath(id))) continue; // Interrupted intake can reuse the immutable ticket.
    const value = validate(await readJson(recordPath(id), 262144));
    requireValue(value.id === id, 'JOB_CHECKOUT_STATE_INVALID');
    const ticket = await ticketFor(value);
    requireValue(same(value.ticket, ticket.summary), 'JOB_CHECKOUT_TICKET_CHANGED', 409);
    rows.set(id, value);
    if (RUNNING.has(value.lastTask?.state)) {
      await save(value, { lastTask: { ...value.lastTask, state: 'INTERRUPTED',
        completedAt: now(), error: 'JOB_CHECKOUT_PROCESS_REOPENED' },
        lastError: 'JOB_CHECKOUT_PROCESS_REOPENED' }, 'customer-process-reopened');
    }
    if (await exists(join(value.nativeDirectory, 'attempt.json'))) {
      const current = row(id);
      if (!current.attempted) await save(current, { attempted: true,
        phase: current.phase === 'ACCEPTED' ? 'ACCEPTED' : 'RECOVERABLE' }, 'original-attempt-observed');
    }
  }
  return Object.freeze({
    directory, import: importTicket, replace: replaceTicket, start, cancel, list, status,
    enableBrowserApproval, approval, decideApproval,
    get(id) { return item(row(id)); },
    async wait(id) {
      row(id); const task = activeTask?.id === id ? activeTask : null;
      if (task) await task.promise;
      return item(row(id));
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        const failures = [];
        await tail;
        if (activeTask) {
          const task = activeTask;
          try { if (approvals) await approvals.revoke(row(task.id).intentId); }
          catch (error) { failures.push(error); }
          task.controller.abort(new Error('JOB_CHECKOUT_CLOSED'));
          try { await task.promise; } catch (error) { failures.push(error); }
        }
        await tail;
        try { if (approvals) await approvals.close(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, 'JOB_CHECKOUT_CLOSE_FAILED');
      })();
      return closePromise;
    },
  });
}
