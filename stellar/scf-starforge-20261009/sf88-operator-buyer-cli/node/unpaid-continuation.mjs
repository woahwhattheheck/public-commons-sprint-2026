// MIT — Explicit continuation of one definitively unpaid original SF88 attempt.
import { constants } from 'node:fs';
import { open, lstat, readdir, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readBytes, readJson, writeJson, jsonBytes, parseJson, digest,
  exists, intent, need, object, now, syncDirectory, BuyerError } from './store.mjs';

const SCHEMA = 'stellar-forge.node-unpaid-continuation.v1';
const OP_SCHEMA = 'stellar-forge.node-buyer.v1';
const MODE = 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT';
const CHOICE = 'unpaid-continuation.json';
const READY = 'unpaid-continuation-ready.json';
const copy = value => parseJson(jsonBytes(value));
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left, right) => canonical(left) === canonical(right);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function signalCheck(signal) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
}

// This is the original research workspace's private descriptor/flock pattern.
// A stopped preparer releases its kernel lock; the chosen successor never expires.
async function locked(operation, work) {
  const path = join(operation.directory, 'unpaid-continuation.lock');
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const stat = await handle.stat(), named = await lstat(path);
    need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) &&
      stat.dev === named.dev && stat.ino === named.ino && !named.isSymbolicLink() &&
      (!process.getuid || stat.uid === process.getuid()), 'UNPAID_CONTINUATION_LOCK_CHANGED');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', handle.fd], timeout: 10000 });
    need(!result.error && result.status === 0,
      result.status === 73 ? 'UNPAID_CONTINUATION_BUSY' : 'FLOCK_REQUIRED');
    return await work();
  } finally { await handle.close(); }
}

// Only SDK-owned file destinations and the explicitly selected successor ID move.
// URL, method, headers, terms, operator, ledger, signer and timeout settings stay.
function requestIdentity(config) {
  const value = copy(config);
  delete value.operation.intentId;
  delete value.operation.bodyFile;
  delete value.operation.ticketFile;
  delete value.evidenceDir;
  if (value.responseFile) delete value.responseFile.destination;
  return digest(canonical(value));
}

async function own(operation) {
  await privateDirectory(operation.directory, { create: false });
  const metaRaw = await readBytes(join(operation.directory, 'operation.json'));
  const meta = parseJson(metaRaw);
  need(meta.schema === OP_SCHEMA && meta.intentId === operation.intentId && meta.state === 'PREPARED',
    'UNPAID_CONTINUATION_OPERATION_NOT_PREPARED');
  const configRaw = await readBytes(operation.configPath), config = parseJson(configRaw);
  need(object(config.operation) && config.operation.intentId === operation.intentId, 'OPERATION_ID_MISMATCH');
  const body = config.operation.bodyFile
    ? await (await operation.buyer._requestFiles()).readRequestFile(config.operation.bodyFile) : Buffer.alloc(0);
  const ticketSha256 = config.operation.ticketFile
    ? digest(await readBytes(config.operation.ticketFile, 16384)) : null;
  need(digest(configRaw) === meta.configSha256 && digest(body) === meta.bodySha256 &&
    ticketSha256 === (meta.ticketSha256 ?? null), 'OPERATION_INPUT_CHANGED');
  need(meta.runtimeDirectory === operation.buyer.runtime.directory, 'UNPAID_CONTINUATION_RUNTIME_CHANGED');
  return { meta, config, body, operationSha256: digest(metaRaw),
    configSha256: digest(configRaw), bodySha256: digest(body), ticketSha256 };
}

async function originalFailure(operation) {
  const bound = await own(operation);
  const resultPath = join(operation.directory, 'result.json');
  const attemptPath = join(operation.directory, 'attempt.json');
  if (!await exists(resultPath) || !await exists(attemptPath))
    return { ...bound, eligible: false, reason: 'RECORDED_FINAL_RESULT_REQUIRED', resultSha256: null };
  const resultRaw = await readBytes(resultPath, operation.buyer.runtime.outputLimit);
  const attemptRaw = await readBytes(attemptPath);
  const record = parseJson(resultRaw), attempt = parseJson(attemptRaw), native = record.native;
  need(record.schema === OP_SCHEMA && record.intentId === operation.intentId &&
    record.configSha256 === bound.configSha256 &&
    attempt.schema === OP_SCHEMA && attempt.intentId === operation.intentId &&
    attempt.configSha256 === bound.configSha256 && attempt.bodySha256 === bound.bodySha256,
    'UNPAID_CONTINUATION_RESULT_BINDING_MISMATCH');
  const basic = attempt.state === 'RECORDED' && Number.isInteger(attempt.exitCode) &&
    attempt.exitCode === record.exitCode && typeof attempt.endedAt === 'string' &&
    record.exitSignal === null && record.runtimeError === null && record.recovered === false &&
    native?.mode === MODE && native.intentId === operation.intentId &&
    native.error?.code === 'INITIAL_TRANSPORT_FAILED' && native.error.paymentSent === false &&
    native.operatorReservation === null && native.interrupted === false &&
    native.httpStatus === null && native.status === null && native.sellerReportedSettlement === null &&
    native.responseFile?.status === 'NOT_STARTED' && native.responseFile.reason === 'NO_BUYER_RESPONSE' &&
    !await exists(join(operation.directory, 'response.bin'));
  const resultSha256 = digest(resultRaw);
  if (!basic) return { ...bound, eligible: false, reason: 'DEFINITIVE_INITIAL_TRANSPORT_FAILURE_REQUIRED', resultSha256 };
  const stdoutRaw = await readBytes(join(operation.directory, 'stdout.json'), operation.buyer.runtime.outputLimit);
  need(same(parseJson(stdoutRaw), native), 'UNPAID_CONTINUATION_NATIVE_RESULT_CHANGED');
  const evidencePath = join(bound.config.evidenceDir, digest(operation.intentId) + '.json');
  need(native.evidencePath === evidencePath, 'UNPAID_CONTINUATION_EVIDENCE_BINDING_MISMATCH');
  const evidenceRaw = await readBytes(evidencePath, operation.buyer.runtime.outputLimit);
  const evidence = parseJson(evidenceRaw), report = native.originalOutcomeReport, counts = report?.counts;
  const outcome = report?.outcomes?.[0], buyer = evidence.observation?.buyer;
  const empty = ['unpaidHttpFailures', 'signedAttempts', 'sellerReportedSuccess', 'verifiedTransfers',
    'transferAndBodyObserved', 'proofConflicts', 'uncertainOrPending'];
  const definitive = evidence.schema === 'scf82.checkout-evidence.v1' &&
    evidence.intentId === operation.intentId && evidence.observation?.intentId === operation.intentId &&
    evidence.operatorReservation === null && buyer?.status === 'BLOCKED_BEFORE_SIGNATURE' &&
    buyer.attempts === 0 && buyer.reason === 'INITIAL_TRANSPORT_FAILED' &&
    buyer.httpStatus === null && buyer.requirement === null && buyer.receipt === null &&
    report?.schema === 'scf52.buyer-outcome.v1' && counts?.total === 1 &&
    empty.every(key => counts[key] === 0) && Array.isArray(report.observedTransferAtomicByAsset) &&
    report.observedTransferAtomicByAsset.length === 0 && Array.isArray(report.outcomes) &&
    report.outcomes.length === 1 && outcome.intentId === operation.intentId &&
    outcome.status === 'BLOCKED_BEFORE_SIGNATURE' && outcome.signedAttempt === false &&
    outcome.sellerReportedSuccess === false && outcome.independentlyVerifiedTransfer === false &&
    outcome.observedHttpBody === false && same(evidence.report, report);
  if (!definitive) return { ...bound, eligible: false, reason: 'ORIGINAL_UNPAID_OUTCOME_REQUIRED', resultSha256 };
  const source = { intentId: operation.intentId, operationSha256: bound.operationSha256,
    configSha256: bound.configSha256, bodySha256: bound.bodySha256, ticketSha256: bound.ticketSha256,
    requestSha256: requestIdentity(bound.config), attemptSha256: digest(attemptRaw),
    resultSha256, stdoutSha256: digest(stdoutRaw), evidenceSha256: digest(evidenceRaw),
    nativeWorkspace: bound.meta.nativeWorkspace ?? null };
  return { ...bound, eligible: true, reason: 'INITIAL_TRANSPORT_FAILED_BEFORE_SIGNATURE', resultSha256, source };
}

async function choice(operation) {
  const path = join(operation.directory, CHOICE);
  if (!await exists(path)) return null;
  const raw = await readBytes(path), value = parseJson(raw);
  need(value.schema === SCHEMA && value.parentIntentId === operation.intentId &&
    intent(value.intentId) !== operation.intentId && object(value.source) &&
    value.source.intentId === operation.intentId && sha(value.source.resultSha256) &&
    typeof value.reason === 'string' && value.reason.length > 0, 'UNPAID_CONTINUATION_CHOICE_INVALID');
  return { raw, value, sha256: digest(raw) };
}

function marker(selected) {
  return { parentIntentId: selected.value.parentIntentId, choiceSha256: selected.sha256 };
}

async function childBinding(parent, selected, failure, child, { ready = true } = {}) {
  need(failure.eligible && same(failure.source, selected.value.source), 'UNPAID_CONTINUATION_PARENT_CHANGED');
  const bound = await own(child);
  need(same(bound.meta.unpaidContinuation, marker(selected)) &&
    child.intentId === selected.value.intentId &&
    bound.bodySha256 === failure.bodySha256 && bound.ticketSha256 === failure.ticketSha256 &&
    (bound.meta.nativeWorkspace ?? null) === (failure.meta.nativeWorkspace ?? null) &&
    requestIdentity(bound.config) === failure.source.requestSha256 &&
    (failure.meta.nativeWorkspace === undefined || bound.config.evidenceDir === failure.config.evidenceDir),
    'UNPAID_CONTINUATION_CHILD_CHANGED');
  const hashes = { operationSha256: bound.operationSha256, configSha256: bound.configSha256,
    bodySha256: bound.bodySha256, ticketSha256: bound.ticketSha256 };
  if (ready) {
    need(await exists(join(parent.directory, READY)), 'UNPAID_CONTINUATION_PREPARATION_INCOMPLETE');
    const completed = await readJson(join(parent.directory, READY));
    need(completed.schema === SCHEMA && completed.parentIntentId === parent.intentId &&
      completed.intentId === child.intentId && completed.choiceSha256 === selected.sha256 &&
      same(completed.child, hashes), 'UNPAID_CONTINUATION_PREPARATION_INCOMPLETE');
  }
  return { bound, hashes };
}

export async function assertUnpaidContinuationBinding(operation, { meta }) {
  let current = operation, currentMeta = meta;
  const seen = new Set([current.intentId]);
  for (let count = 0; currentMeta.unpaidContinuation !== undefined; count++) {
    need(count < 64 && object(currentMeta.unpaidContinuation), 'UNPAID_CONTINUATION_LINEAGE_INVALID');
    const parentId = intent(currentMeta.unpaidContinuation.parentIntentId);
    need(!seen.has(parentId), 'UNPAID_CONTINUATION_LINEAGE_INVALID');
    seen.add(parentId);
    const parent = current.buyer.operation(parentId), selected = await choice(parent);
    need(selected && selected.sha256 === currentMeta.unpaidContinuation.choiceSha256 &&
      selected.value.intentId === current.intentId, 'UNPAID_CONTINUATION_CHOICE_CHANGED');
    const failure = await originalFailure(parent);
    await childBinding(parent, selected, failure, current);
    current = parent; currentMeta = failure.meta;
  }
}

export async function inspectUnpaidContinuation(operation) {
  await operation._bound();
  const failure = await originalFailure(operation), selected = await choice(operation);
  let continuation = null;
  if (selected) {
    need(failure.eligible && same(failure.source, selected.value.source), 'UNPAID_CONTINUATION_PARENT_CHANGED');
    const ready = await exists(join(operation.directory, READY));
    if (ready) await childBinding(operation, selected, failure, operation.buyer.operation(selected.value.intentId));
    continuation = { intentId: selected.value.intentId, reason: selected.value.reason,
      createdAt: selected.value.createdAt, state: ready ? 'PREPARED' : 'PREPARING',
      choiceSha256: selected.sha256 };
  }
  return { intentId: operation.intentId, eligible: failure.eligible, reason: failure.reason,
    resultSha256: failure.resultSha256, source: failure.source ?? null, continuation };
}

export async function prepareUnpaidContinuation(operation, options = {}) {
  const { intentId, expectedResultSha256, reason, signal, ...extra } = options;
  need(Object.keys(extra).length === 0, 'UNPAID_CONTINUATION_FIELDS_INVALID');
  intent(intentId);
  need(intentId !== operation.intentId && sha(expectedResultSha256), 'UNPAID_CONTINUATION_SELECTION_REQUIRED');
  need(typeof reason === 'string' && reason === reason.trim() && reason.length > 0 &&
    reason.length <= 1000 && !/[\x00-\x1f\x7f]/.test(reason), 'UNPAID_CONTINUATION_REMEDIATION_REQUIRED');
  signalCheck(signal);
  await operation._bound();
  return locked(operation, async () => {
    signalCheck(signal);
    await operation._bound();
    let failure = await originalFailure(operation);
    need(failure.eligible, 'UNPAID_CONTINUATION_REQUIRES_DEFINITIVE_UNPAID_FAILURE');
    need(failure.resultSha256 === expectedResultSha256, 'UNPAID_CONTINUATION_RESULT_CHANGED');
    let selected = await choice(operation);
    const child = operation.buyer.operation(intentId);
    if (selected) {
      need(selected.value.intentId === intentId && selected.value.reason === reason &&
        same(selected.value.source, failure.source), 'UNPAID_CONTINUATION_ALREADY_SELECTED');
    } else {
      need(!await exists(child.directory), 'UNPAID_CONTINUATION_INTENT_ALREADY_EXISTS');
      const value = { schema: SCHEMA, parentIntentId: operation.intentId, intentId,
        reason, createdAt: now(), source: failure.source };
      await writeJson(join(operation.directory, CHOICE), value, { exclusive: true });
      selected = await choice(operation);
    }
    signalCheck(signal);
    if (await exists(join(operation.directory, READY))) {
      await childBinding(operation, selected, failure, child);
      return child;
    }
    if (await exists(child.directory)) {
      await privateDirectory(child.directory, { create: false });
      need(!await exists(join(child.directory, 'attempt.json')) &&
        !await exists(join(child.directory, 'stdout.json')) && !await exists(join(child.directory, 'result.json')),
        'UNPAID_CONTINUATION_ATTEMPT_WITHOUT_BINDING');
      const metaPath = join(child.directory, 'operation.json');
      const existing = await exists(metaPath) ? await readJson(metaPath) : null;
      if (existing?.state === 'PREPARED') {
        await childBinding(operation, selected, failure, child, { ready: false });
      } else {
        const names = await readdir(child.directory);
        need(existing ? existing.schema === OP_SCHEMA && existing.intentId === intentId &&
          existing.state === 'PREPARING' && same(existing.unpaidContinuation, marker(selected))
          : names.every(name => /^\.write-[a-f0-9-]{36}$/.test(name)),
          'UNPAID_CONTINUATION_PREPARATION_CONFLICT');
        // Retain interrupted preparation bytes. Its chosen ID is reused only after
        // confirming there was no native attempt; every completed parent stays put.
        await rename(child.directory, join(operation.buyer.stateDirectory,
          '.unpaid-preparation-' + digest(intentId) + '-' + randomUUID()));
        await syncDirectory(operation.buyer.stateDirectory);
      }
    }
    if (!await exists(child.directory)) {
      signalCheck(signal);
      const config = copy(failure.config); config.operation.intentId = intentId;
      await operation.buyer._create(config, {
        ...(failure.meta.nativeWorkspace === undefined ? {} : { nativeWorkspace: failure.meta.nativeWorkspace }),
        unpaidContinuation: marker(selected), signal });
    }
    signalCheck(signal);
    failure = await originalFailure(operation);
    const validated = await childBinding(operation, selected, failure, child, { ready: false });
    await writeJson(join(operation.directory, READY), { schema: SCHEMA, parentIntentId: operation.intentId,
      intentId, choiceSha256: selected.sha256, child: validated.hashes, preparedAt: now() }, { exclusive: true });
    await child._bound();
    return child;
  });
}

// Read-only: a caller may follow a previously explicit choice, never create one.
export async function followUnpaidContinuation(operation) {
  let current = operation;
  const seen = new Set();
  for (let count = 0; count < 65; count++) {
    need(!seen.has(current.intentId), 'UNPAID_CONTINUATION_LINEAGE_INVALID'); seen.add(current.intentId);
    await current._bound();
    const selected = await choice(current);
    if (!selected) return current;
    need(await exists(join(current.directory, READY)), 'UNPAID_CONTINUATION_PREPARATION_INCOMPLETE');
    const child = current.buyer.operation(selected.value.intentId), failure = await originalFailure(current);
    await childBinding(current, selected, failure, child);
    current = child;
  }
  throw new BuyerError('UNPAID_CONTINUATION_LINEAGE_INVALID');
}
