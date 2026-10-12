// MIT. Explicit continuation of the same original intent before any reservation.
// The original execute marker is retained. SF36/SF62/SF81 still own approval,
// reservation, signing and payment; this module owns only linked local attempts.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, mkdtemp, rm, rename } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { absolute, privateDirectory, readJson, readBytes, parseJson, writeJson, writeBytes,
  syncDirectory, jsonBytes, digest, now, object, need, BuyerError, exists, prepareWriteReservations } from './store.mjs';
import { checkWorkspace, workspaceCommand } from './workspace.mjs';
import { unstartedAttempt, resultRecordLimit, attemptRecordLimit } from './runtime.mjs';

const SCHEMA = 'stellar-forge.node-preapproval-recovery.v1';
const NODE_SCHEMA = 'stellar-forge.node-buyer.v1';
const NATIVE_RESULT = 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT';
const PROOF_SCHEMA = 'stellar-forge.node-preapproval-process-proof.v1';
const PROOF = fileURLToPath(new URL('./preapproval-native-record.py', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 1048576;
const copy = value => JSON.parse(jsonBytes(value));
const checkSignal = signal => {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
};
const details = ({ raw, ...value }) => value;

async function snapshot(name, path, { limit = LIMIT, optional = false } = {}) {
  path = absolute(path);
  let fd;
  try { fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return { name, path, exists: false };
    throw error;
  }
  try {
    const before = await fd.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= limit &&
      (process.platform === 'win32' || (before.mode & 0o077) === 0 &&
        before.uid === process.getuid()), 'PREAPPROVAL_PRIVATE_SOURCE_REQUIRED');
    const raw = await fd.readFile();
    const after = await fd.stat(), current = await lstat(path);
    need(raw.length === before.size && before.dev === after.dev && before.ino === after.ino &&
      after.size === before.size && current.dev === after.dev && current.ino === after.ino &&
      !current.isSymbolicLink(), 'PREAPPROVAL_SOURCE_CHANGED');
    return { name, path, exists: true, bytes: raw.length, sha256: digest(raw),
      device: before.dev, inode: before.ino, raw };
  } finally { await fd.close(); }
}

function validPlan(plan, operation, directory) {
  need(plan?.schema === SCHEMA && plan.intentId === operation.intentId &&
    plan.operationDirectory === operation.directory && plan.directory === directory &&
    HASH.test(plan.sourceAttemptSha256 ?? '') && HASH.test(plan.configSha256 ?? '') &&
    HASH.test(plan.reviewSha256 ?? '') && Array.isArray(plan.sources) &&
    plan.sources.length >= 7 && plan.sources.length <= 12 &&
    plan.directory === join(operation.directory, 'preapproval-history', plan.sourceAttemptSha256) &&
    (plan.sourceDirectory === operation.directory ||
      dirname(plan.sourceDirectory) === join(operation.directory, 'preapproval-history') &&
      HASH.test(basename(plan.sourceDirectory))) &&
    new Set(plan.sources.map(value => value.name)).size === plan.sources.length &&
    plan.sources.every(value => object(value) &&
      ['operation.json', 'config.json', 'review.json', 'attempt.json', 'stdout.json',
        'stderr.log', 'download-reservation.json', 'partial.bin'].includes(value.name) &&
      typeof value.path === 'string' && typeof value.exists === 'boolean' &&
      (!value.exists || HASH.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) && value.bytes >= 0)),
  'PREAPPROVAL_HISTORY_INVALID');
  return plan;
}

async function chain(operation) {
  const { meta, config } = await operation._bound();
  let directory = operation.directory;
  const history = [], seen = new Set();
  for (let depth = 0; depth < 64; depth++) {
    const attemptPath = join(directory, 'attempt.json');
    const attempt = await exists(attemptPath) ? await readJson(attemptPath, attemptRecordLimit) : null;
    if (attempt) {
      need(attempt.schema === NODE_SCHEMA && attempt.intentId === operation.intentId &&
        attempt.configSha256 === meta.configSha256 && attempt.bodySha256 === meta.bodySha256,
      'PREAPPROVAL_ATTEMPT_BINDING_CHANGED');
      if (history.length) need(attempt.preapprovalRecovery?.planSha256 === history.at(-1).planSha256 &&
        attempt.preapprovalRecovery?.sourceAttemptSha256 === history.at(-1).sourceAttemptSha256,
      'PREAPPROVAL_ATTEMPT_LINEAGE_CHANGED');
    }
    const linkPath = join(directory, 'preapproval-continuation.json');
    if (!await exists(linkPath)) return { meta, config, directory, attempt, history,
      pending: history.length && !attempt ? history.at(-1) : null };
    need(attempt && attempt.intentId === operation.intentId &&
      attempt.configSha256 === meta.configSha256, 'PREAPPROVAL_ATTEMPT_BINDING_CHANGED');
    const link = await readJson(linkPath, 16384);
    const raw = await readBytes(attemptPath, attemptRecordLimit);
    need(link.schema === SCHEMA && link.intentId === operation.intentId &&
      link.sourceAttemptSha256 === digest(raw) && HASH.test(link.planSha256 ?? '') &&
      link.directory === join(operation.directory, 'preapproval-history', link.sourceAttemptSha256) &&
      !seen.has(link.directory), 'PREAPPROVAL_LINEAGE_CHANGED');
    seen.add(link.directory);
    const planRaw = await readBytes(join(link.directory, 'plan.json'), 262144);
    need(digest(planRaw) === link.planSha256, 'PREAPPROVAL_PLAN_CHANGED');
    const plan = validPlan(parseJson(planRaw), operation, link.directory);
    need(plan.sourceDirectory === directory && plan.sourceAttemptSha256 === link.sourceAttemptSha256 &&
      plan.configSha256 === meta.configSha256 && plan.bodySha256 === meta.bodySha256 &&
      (plan.ticketSha256 ?? null) === (meta.ticketSha256 ?? null),
    'PREAPPROVAL_CONFIGURATION_CHANGED');
    await verifyArchive(plan);
    history.push({ ...link, plan });
    directory = link.directory;
    await privateDirectory(directory, { create: false });
  }
  throw new BuyerError('PREAPPROVAL_HISTORY_LIMIT');
}

async function readSources(operation, current, retainedPlan = null) {
  const { meta, config, directory, attempt } = current;
  need(typeof meta.nativeWorkspace === 'string', 'PREAPPROVAL_ORIGINAL_WORKSPACE_REQUIRED');
  need(attempt?.schema === NODE_SCHEMA && attempt.intentId === operation.intentId &&
    attempt.configSha256 === meta.configSha256 && attempt.bodySha256 === meta.bodySha256 &&
    attempt.kind !== 'INBOX_DELEGATED', 'PREAPPROVAL_ORIGINAL_ATTEMPT_REQUIRED');
  need(!await exists(join(directory, 'result.json')), 'PREAPPROVAL_RESULT_ALREADY_RECORDED');
  const destination = absolute(config.responseFile?.destination);
  const evidencePath = join(absolute(config.evidenceDir), digest(operation.intentId) + '.json');
  need(!await exists(destination) && !await exists(evidencePath),
    'PREAPPROVAL_ORIGINAL_OUTPUT_EXISTS');
  const reviewPath = join(directory, 'review.json');
  const reservationPath = join(dirname(destination), '.' + basename(destination) + '.x402-download.lock');
  const released = retainedPlan ? join(retainedPlan.directory, 'released-download-reservation.json') : null;
  const originalReservation = released && await exists(released) ? released : reservationPath;
  if (originalReservation !== reservationPath)
    need(!await exists(reservationPath), 'PREAPPROVAL_NEW_OUTPUT_WRITER_EXISTS');
  const sources = await Promise.all([
    snapshot('operation.json', join(operation.directory, 'operation.json'), { limit: 65536 }),
    snapshot('config.json', operation.configPath, { limit: 65536 }),
    snapshot('review.json', reviewPath, { limit: 262144 }),
    snapshot('attempt.json', join(directory, 'attempt.json'), { limit: attemptRecordLimit }),
    snapshot('stdout.json', join(directory, 'stdout.json'), { optional: true }),
    snapshot('stderr.log', join(directory, 'stderr.log'), { optional: true }),
    snapshot('download-reservation.json', originalReservation, { optional: true, limit: 16384 }),
  ]);
  need(sources[1].sha256 === meta.configSha256, 'PREAPPROVAL_CONFIGURATION_CHANGED');
  need(!sources[4].exists || sources[4].bytes === 0, 'PREAPPROVAL_NATIVE_OUTPUT_EXISTS');
  need(!sources[5].exists || sources[5].bytes === 0, 'PREAPPROVAL_NATIVE_OUTPUT_EXISTS');
  const reviewed = parseJson(sources[2].raw);
  need(reviewed.intentId === operation.intentId && reviewed.configSha256 === meta.configSha256 &&
    reviewed.bodySha256 === meta.bodySha256 &&
    (reviewed.nativeWorkspace ?? null) === (meta.nativeWorkspace ?? null),
  'PREAPPROVAL_REVIEW_BINDING_CHANGED');
  const reservation = sources[6];
  if (reservation.exists) {
    const held = parseJson(reservation.raw);
    need(held.destination === destination && held.pid === attempt.pid &&
      typeof held.partialPath === 'string' && dirname(absolute(held.partialPath)) === dirname(destination) &&
      /^\.x402-response-[a-f0-9-]+\.partial$/.test(basename(held.partialPath)),
    'PREAPPROVAL_DOWNLOAD_RESERVATION_CHANGED');
    const partial = await snapshot('partial.bin', held.partialPath, { limit: 0 });
    need(partial.bytes === 0, 'PREAPPROVAL_PARTIAL_RESPONSE_EXISTS');
    sources.push(partial);
  }
  return sources;
}

async function verifySources(plan) {
  for (const pin of plan.sources) {
    const archived = typeof plan.directory === 'string' && pin.name === 'download-reservation.json'
      ? join(plan.directory, 'released-download-reservation.json') : null;
    const moved = archived && await exists(archived);
    if (moved) need(!await exists(pin.path), 'PREAPPROVAL_NEW_OUTPUT_WRITER_EXISTS');
    const actual = await snapshot(pin.name, moved ? archived : pin.path,
      { optional: !pin.exists, limit: Math.max(pin.bytes ?? 0, 16384) });
    need(actual.exists === pin.exists && (!pin.exists ||
      actual.sha256 === pin.sha256 && actual.bytes === pin.bytes &&
      actual.device === pin.device && actual.inode === pin.inode), 'PREAPPROVAL_SOURCE_CHANGED');
  }
}

async function verifyArchive(plan) {
  for (const pin of plan.sources) {
    if (!pin.exists) continue;
    const raw = await readBytes(join(plan.directory, 'original', pin.name), Math.max(pin.bytes, 1));
    need(raw.length === pin.bytes && digest(raw) === pin.sha256, 'PREAPPROVAL_ARCHIVE_CHANGED');
  }
  const reviewRaw = await readBytes(join(plan.directory, 'review.json'), 262144);
  need(digest(reviewRaw) === plan.reviewSha256 &&
    digest(jsonBytes(plan.review)) === plan.reviewSha256, 'PREAPPROVAL_REVIEW_CHANGED');
  const requestRaw = await readBytes(join(plan.directory, 'process-request.json'), 262144);
  need(digest(requestRaw) === digest(jsonBytes(plan.processRequest)), 'PREAPPROVAL_PROCESS_REQUEST_CHANGED');
}

async function processProof(operation, current, sources, nativeRecord, signal) {
  checkSignal(signal);
  const byName = Object.fromEntries(sources.map(value => [value.name, value]));
  const request = {
    schema: 'stellar-forge.node-preapproval-process-proof-request.v1',
    intentId: operation.intentId, operationDirectory: operation.directory,
    operationPath: byName['operation.json'].path, configPath: operation.configPath,
    reviewPath: byName['review.json'].path, attemptPath: byName['attempt.json'].path,
    nativeWorkspace: current.meta.nativeWorkspace ?? null,
    expected: Object.fromEntries(['operation', 'config', 'review', 'attempt'].map(name =>
      [name + 'Sha256', byName[name + '.json'].sha256])),
    ...(nativeRecord === undefined ? {} : { nativeRecord: copy(nativeRecord) }),
    ...(current.attempt?.processIdentity ? { processIdentity: copy(current.attempt.processIdentity) } : {}),
  };
  const temporary = await mkdtemp(join(operation.buyer.stateDirectory, '.preapproval-inspect-'));
  const path = join(temporary, 'request.json');
  try {
    await writeJson(path, request, { exclusive: true });
    const proof = await new Promise((resolveProof, reject) => {
      let child, done = false, size = 0, timer, cancel;
      const chunks = [];
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer);
        if (cancel) signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolveProof(value);
      };
      const abort = () => { child?.kill('SIGKILL'); };
      try {
        child = spawn(absolute(current.config.operator.python), ['-I', '-B', PROOF, '--request', path], {
          env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch { return finish(new BuyerError('PREAPPROVAL_PROCESS_INSPECTION_START_FAILED')); }
      let interrupted = false;
      cancel = () => { interrupted = true; abort(); };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      timer = setTimeout(() => { interrupted = true; abort(); }, 30000);
      child.once('error', () => finish(new BuyerError('PREAPPROVAL_PROCESS_INSPECTION_START_FAILED')));
      child.stdout.on('data', raw => {
        size += raw.length;
        if (size > 65536) { interrupted = true; abort(); }
        else chunks.push(raw);
      });
      child.once('close', code => {
        signal?.removeEventListener('abort', cancel);
        if (done) return;
        if (interrupted) return finish(new BuyerError(signal?.aborted
          ? 'OPERATION_ABORTED_BEFORE_START' : 'PREAPPROVAL_PROCESS_INSPECTION_LIMIT'));
        try {
          const value = parseJson(Buffer.concat(chunks));
          if (code !== 0) throw new BuyerError(/^[A-Z0-9_]{1,120}$/.test(value.code ?? '')
            ? value.code : 'PREAPPROVAL_PROCESS_NOT_PROVEN_ABSENT');
          need(value.schema === PROOF_SCHEMA &&
            value.outcome === 'ORIGINAL_ATTEMPT_PROCESS_ABSENT' &&
            value.intentId === operation.intentId && value.configSha256 === current.meta.configSha256 &&
            value.attemptSha256 === byName['attempt.json'].sha256, 'PREAPPROVAL_PROCESS_NOT_PROVEN_ABSENT');
          finish(null, value);
        } catch (error) { finish(error instanceof BuyerError ? error : new BuyerError('PREAPPROVAL_PROCESS_PROOF_INVALID')); }
      });
    });
    return { request, proof };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function ledgerProof(operation, current, signal) {
  const { meta, config } = current;
  let environment = operation.buyer.runtime.environment;
  if (meta.nativeWorkspace) {
    const context = { directory: meta.nativeWorkspace, configPath: operation.configPath,
      ticketSha256: meta.ticketSha256 ?? null };
    await checkWorkspace(operation.buyer, context, { intentId: operation.intentId, signal });
    const original = await import(pathToFileURL(join(operation.buyer.runtime.directory, 'workspace.mjs')).href);
    const opened = await original.openWorkspace(['--dir', meta.nativeWorkspace], { accounting: true, environment });
    need(opened.config.operator.ledger === config.operator.ledger &&
      opened.config.operator.policy === config.operator.policy &&
      opened.config.operator.actor === config.operator.actor &&
      opened.config.operator.service === config.operator.service, 'PREAPPROVAL_ORIGINAL_OPERATOR_CHANGED');
    environment = opened.operatorEnvironment;
  }
  const original = await import(pathToFileURL(join(operation.buyer.runtime.directory, 'dataset-unpaid.mjs')).href);
  need(typeof original.inspectOriginalUnpaidLedger === 'function', 'PREAPPROVAL_ORIGINAL_LEDGER_INSPECTOR_REQUIRED');
  return original.inspectOriginalUnpaidLedger(config, operation.configPath, meta.configSha256, environment, signal);
}

function preparedView(entry) {
  const { plan } = entry;
  return { schema: SCHEMA, intentId: plan.intentId, status: 'PREPARED',
    directory: plan.directory, attemptSha256: plan.sourceAttemptSha256,
    planSha256: entry.planSha256, review: copy(plan.review),
    originalLedgerCheck: copy(plan.originalLedgerCheck), processProof: copy(plan.processProof) };
}

export async function readPreapprovalRecovery(operation) {
  const current = await chain(operation);
  return { schema: SCHEMA, intentId: operation.intentId,
    state: current.attempt?.state ?? (current.pending ? 'PREAPPROVAL_RECOVERY_PREPARED' : current.meta.state),
    directory: current.directory, history: current.history.map(entry => ({
      directory: entry.directory, planSha256: entry.planSha256,
      attemptSha256: entry.sourceAttemptSha256, reason: entry.plan.reason, createdAt: entry.plan.createdAt,
    })), pending: current.pending ? preparedView(current.pending) : null };
}

/** Ordinary review follows the selected immutable continuation instead of rewriting its source. */
export async function readSelectedPreapprovalReview(operation) {
  const current = await chain(operation), selected = current.history.at(-1);
  need(selected, 'PREAPPROVAL_PREPARED_PLAN_REQUIRED');
  return copy(selected.plan.review);
}

export async function inspectPreapprovalRecovery(operation, { nativeRecord, signal } = {}) {
  checkSignal(signal);
  const current = await chain(operation);
  if (current.pending) return preparedView(current.pending);
  const sources = await readSources(operation, current);
  const checked = await processProof(operation, current, sources, nativeRecord, signal);
  const originalLedgerCheck = await ledgerProof(operation, current, signal);
  const provisional = { sources: sources.map(details) };
  await verifySources(provisional);
  return { schema: SCHEMA, intentId: operation.intentId, status: 'AVAILABLE',
    attemptSha256: sources.find(value => value.name === 'attempt.json').sha256,
    configSha256: current.meta.configSha256, directory: current.directory,
    sources: provisional.sources, processProof: checked.proof, originalLedgerCheck };
}

export async function preparePreapprovalRecovery(operation,
  { expectedAttemptSha256, nativeRecord, reason, signal } = {}) {
  checkSignal(signal);
  need(HASH.test(expectedAttemptSha256 ?? ''), 'PREAPPROVAL_ATTEMPT_REVIEW_REQUIRED');
  need(typeof reason === 'string' && reason.normalize('NFC').trim().length >= 1 &&
    reason.normalize('NFC').trim().length <= 240 && !/[\x00-\x1f\x7f]/.test(reason),
  'PREAPPROVAL_REASON_REQUIRED');
  const current = await chain(operation);
  if (current.pending) {
    need(current.pending.sourceAttemptSha256 === expectedAttemptSha256, 'PREAPPROVAL_ATTEMPT_CHANGED');
    await verifySources(current.pending.plan);
    return preparedView(current.pending);
  }
  const sources = await readSources(operation, current);
  need(sources.find(value => value.name === 'attempt.json').sha256 === expectedAttemptSha256,
    'PREAPPROVAL_ATTEMPT_CHANGED');
  const checked = await processProof(operation, current, sources, nativeRecord, signal);
  const originalLedgerCheck = await ledgerProof(operation, current, signal);
  const native = await operation.buyer.runtime.checked(['--review', '--config', operation.configPath],
    { stateDirectory: operation.buyer.stateDirectory, mode: 'OFFLINE_REVIEW', signal });
  const { meta } = current;
  need(native.intentId === operation.intentId && native.bodySha256 === meta.bodySha256 &&
    (native.operationTicket?.sha256 ?? null) === (meta.ticketSha256 ?? null), 'NATIVE_REVIEW_MISMATCH');
  const review = { intentId: operation.intentId, configSha256: meta.configSha256,
    bodySha256: meta.bodySha256, ticketSha256: meta.ticketSha256 ?? null,
    ...(meta.nativeWorkspace ? { nativeWorkspace: meta.nativeWorkspace } : {}),
    native, reviewedAt: now() };
  const directory = join(operation.directory, 'preapproval-history', expectedAttemptSha256);
  const plan = {
    schema: SCHEMA, intentId: operation.intentId, operationDirectory: operation.directory, directory,
    sourceDirectory: current.directory, sourceAttemptSha256: expectedAttemptSha256,
    configSha256: meta.configSha256, bodySha256: meta.bodySha256, ticketSha256: meta.ticketSha256 ?? null,
    nativeWorkspace: meta.nativeWorkspace ?? null, reason: reason.normalize('NFC').trim(), createdAt: now(),
    sources: sources.map(details), processProof: checked.proof, processRequest: checked.request,
    originalLedgerCheck, review, reviewSha256: digest(jsonBytes(review)),
  };
  await verifySources(plan);
  checkSignal(signal);
  await privateDirectory(join(operation.directory, 'preapproval-history'));
  await privateDirectory(directory);
  const planPath = join(directory, 'plan.json');
  if (await exists(planPath)) {
    const existingRaw = await readBytes(planPath, 262144);
    const existing = validPlan(parseJson(existingRaw), operation, directory);
    need(existing.sourceAttemptSha256 === expectedAttemptSha256 &&
      existing.configSha256 === plan.configSha256 && existing.reason === plan.reason,
    'PREAPPROVAL_DIFFERENT_PLAN_ALREADY_RETAINED');
    await verifySources(existing);
    await verifyArchive(existing);
    const link = { schema: SCHEMA, intentId: operation.intentId, directory,
      sourceAttemptSha256: expectedAttemptSha256, planSha256: digest(existingRaw) };
    if (!await exists(join(current.directory, 'preapproval-continuation.json')))
      await writeJson(join(current.directory, 'preapproval-continuation.json'), link, { exclusive: true });
    return preparedView({ ...link, plan: existing });
  }
  await privateDirectory(join(directory, 'original'));
  for (const value of sources) {
    if (!value.exists) continue;
    const archive = join(directory, 'original', value.name);
    if (await exists(archive))
      need(digest(await readBytes(archive, Math.max(value.bytes, 1))) === value.sha256,
        'PREAPPROVAL_ARCHIVE_CHANGED');
    else await writeBytes(archive, value.raw, { exclusive: true });
  }
  const retainedReviewPath = join(directory, 'review.json');
  if (await exists(retainedReviewPath)) {
    const retainedReview = await readJson(retainedReviewPath, 262144);
    need(retainedReview.intentId === operation.intentId &&
      retainedReview.configSha256 === meta.configSha256 && retainedReview.bodySha256 === meta.bodySha256 &&
      (retainedReview.ticketSha256 ?? null) === (meta.ticketSha256 ?? null) &&
      (retainedReview.nativeWorkspace ?? null) === (meta.nativeWorkspace ?? null) &&
      retainedReview.native?.intentId === operation.intentId &&
      retainedReview.native?.bodySha256 === meta.bodySha256, 'PREAPPROVAL_REVIEW_BINDING_CHANGED');
    plan.review = retainedReview;
    plan.reviewSha256 = digest(jsonBytes(retainedReview));
  } else await writeJson(retainedReviewPath, review, { exclusive: true });
  const processRequestPath = join(directory, 'process-request.json');
  if (await exists(processRequestPath))
    need(digest(await readBytes(processRequestPath, 262144)) === digest(jsonBytes(plan.processRequest)),
      'PREAPPROVAL_PROCESS_REQUEST_CHANGED');
  else await writeJson(processRequestPath, plan.processRequest, { exclusive: true });
  await verifyArchive(plan);
  await writeJson(planPath, plan, { exclusive: true });
  const planSha256 = digest(await readBytes(planPath, 262144));
  await verifySources(plan);
  const link = { schema: SCHEMA, intentId: operation.intentId, directory,
    sourceAttemptSha256: expectedAttemptSha256, planSha256 };
  await writeJson(join(current.directory, 'preapproval-continuation.json'), link, { exclusive: true });
  return preparedView({ ...link, plan });
}

export async function executePreapprovalRecovery(operation,
  { expectedPlanSha256, review, signal } = {}) {
  checkSignal(signal);
  need(HASH.test(expectedPlanSha256 ?? ''), 'PREAPPROVAL_PLAN_REVIEW_REQUIRED');
  const current = await chain(operation), selected = current.pending;
  need(selected && selected.planSha256 === expectedPlanSha256, 'PREAPPROVAL_PREPARED_PLAN_REQUIRED');
  const plan = selected.plan;
  need(object(review) && digest(jsonBytes(review)) === plan.reviewSha256, 'MATCHING_REVIEW_REQUIRED');
  await verifySources(plan);
  const sourceAttempt = parseJson(await readBytes(join(plan.sourceDirectory, 'attempt.json'), attemptRecordLimit));
  const originalCurrent = { ...current, directory: plan.sourceDirectory, attempt: sourceAttempt };
  const sources = await readSources(operation, originalCurrent, plan);
  const checked = await processProof(operation, originalCurrent, sources, plan.processRequest.nativeRecord, signal);
  const originalLedgerCheck = await ledgerProof(operation, current, signal);
  await verifySources(plan);
  checkSignal(signal);
  const { meta, config } = current;
  let command = { args: ['--execute', '--config', operation.configPath], entryFile: operation.buyer.runtime.cli };
  if (meta.nativeWorkspace) command = workspaceCommand(operation.buyer, {
    directory: meta.nativeWorkspace, configPath: operation.configPath, ticketSha256: meta.ticketSha256 ?? null });
  const executionCheck = {
    schema: SCHEMA, intentId: operation.intentId, planSha256: expectedPlanSha256, checkedAt: now(),
    processProof: checked.proof, originalLedgerCheck,
  };
  const checkSha256 = digest(jsonBytes(executionCheck));
  const checksDirectory = join(current.directory, 'checks');
  await privateDirectory(checksDirectory);
  await writeJson(join(checksDirectory, checkSha256 + '.json'), executionCheck, { exclusive: true });
  const reservation = plan.sources.find(value => value.name === 'download-reservation.json');
  if (reservation?.exists) {
    const released = join(current.directory, 'released-download-reservation.json');
    if (await exists(released)) {
      const observed = await snapshot(reservation.name, released, { limit: 16384 });
      need(observed.sha256 === reservation.sha256 && observed.device === reservation.device &&
        observed.inode === reservation.inode && !await exists(reservation.path),
      'PREAPPROVAL_DOWNLOAD_RESERVATION_CHANGED');
    } else {
      const observed = await snapshot(reservation.name, reservation.path, { limit: 16384 });
      need(observed.sha256 === reservation.sha256 && observed.device === reservation.device &&
        observed.inode === reservation.inode, 'PREAPPROVAL_DOWNLOAD_RESERVATION_CHANGED');
      try { await rename(reservation.path, released); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const moved = await snapshot(reservation.name, released, { limit: 16384 });
        need(moved.sha256 === reservation.sha256 && moved.device === reservation.device &&
          moved.inode === reservation.inode, 'PREAPPROVAL_DOWNLOAD_RESERVATION_CHANGED');
      }
      await syncDirectory(dirname(reservation.path)); await syncDirectory(current.directory);
    }
  }
  await verifySources(plan);
  checkSignal(signal);
  const createdAt = now();
  let attempt = { schema: NODE_SCHEMA, intentId: operation.intentId, state: 'STARTING',
    createdAt, startedAt: createdAt, executionCheckSha256: checkSha256,
    configSha256: meta.configSha256, bodySha256: meta.bodySha256, retry: 'NO_AUTOMATIC_RETRY',
    preapprovalRecovery: { planSha256: expectedPlanSha256, sourceAttemptSha256: plan.sourceAttemptSha256 },
  };
  const attemptPath = join(current.directory, 'attempt.json');
  const reserveFile = await operation.buyer.runtime.fileReservation();
  const reservations = await prepareWriteReservations([
    { path: attemptPath, bytes: attemptRecordLimit, exclusive: true },
    { path: attemptPath, bytes: attemptRecordLimit },
    { path: attemptPath, bytes: attemptRecordLimit },
    { path: attemptPath, bytes: attemptRecordLimit },
    { path: join(current.directory, 'result.json'),
      bytes: resultRecordLimit(operation.buyer.runtime), exclusive: true },
  ], { reserveFile, signal });
  const recordAttempt = async () => {
    try { await writeJson(attemptPath, attempt, { exclusive: true }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new BuyerError('ATTEMPT_ALREADY_RECORDED_USE_RECOVER', { operation });
      throw error;
    }
    let run;
    try {
      run = await operation.buyer.runtime.run(command.args, {
        directory: current.directory, signal, entryFile: command.entryFile,
        beforeSpawn: async nativeCommand => {
          await verifySources(plan);
          attempt = { ...attempt, nativeCommand };
          await writeJson(attemptPath, attempt);
        },
        started: async (pid, processIdentity) => {
          attempt = { ...attempt, state: 'STARTED', pid, startedAt: now(),
            ...(processIdentity ? { processIdentity } : {}) };
          await writeJson(attemptPath, attempt);
        },
      });
    } catch (error) {
      await writeJson(attemptPath, unstartedAttempt(attempt, error) ??
        { ...attempt, state: 'INTERRUPTED_OR_START_FAILED', endedAt: now() });
      throw error;
    }
    if (run.output?.mode !== NATIVE_RESULT || run.output.intentId !== operation.intentId) {
      await writeJson(attemptPath, unstartedAttempt(attempt, run) ??
        { ...attempt, state: 'NATIVE_RESULT_UNAVAILABLE', endedAt: now(),
          exitCode: run.exitCode, errorCode: run.errorCode ?? 'NATIVE_RESULT_INVALID' });
      throw new BuyerError(run.errorCode ?? 'NATIVE_RESULT_INVALID', { operation, exitCode: run.exitCode });
    }
    const record = { schema: NODE_SCHEMA, intentId: operation.intentId, configSha256: meta.configSha256,
      native: run.output, exitCode: run.exitCode, exitSignal: run.exitSignal,
      runtimeError: run.errorCode, recovered: false, recordedAt: now(),
      preapprovalRecovery: { directory: current.directory, planSha256: expectedPlanSha256,
        sourceAttemptSha256: plan.sourceAttemptSha256 },
    };
    await writeJson(join(current.directory, 'result.json'), record, { exclusive: true });
    await writeJson(attemptPath, { ...attempt, state: 'RECORDED', exitCode: run.exitCode, endedAt: now() });
    return operation._result(record);
  };
  try { return reservations ? await reservations.run(recordAttempt) : await recordAttempt(); }
  finally { await reservations?.close(); }
}

export async function recoverPreapprovalResult(operation) {
  const current = await chain(operation);
  if (!current.history.length || !current.attempt) return null;
  if (await exists(join(current.directory, 'result.json')))
    return operation._result(await readJson(join(current.directory, 'result.json'), resultRecordLimit(operation.buyer.runtime)));
  let native;
  try { native = await readJson(join(current.directory, 'stdout.json'), operation.buyer.runtime.outputLimit); }
  catch (error) { if (['ENOENT', 'JSON_INVALID'].includes(error.code)) return null; throw error; }
  if (native.mode !== NATIVE_RESULT || native.intentId !== operation.intentId) return null;
  return operation._result({ schema: NODE_SCHEMA, intentId: operation.intentId,
    configSha256: current.meta.configSha256, native, exitCode: null, exitSignal: null,
    runtimeError: 'PROCESS_EXIT_NOT_RECORDED', recovered: true, recordedAt: now(),
    preapprovalRecovery: { directory: current.directory, planSha256: current.history.at(-1).planSha256 },
  });
}

