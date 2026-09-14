import { createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import {
  WorkSealError,
  assertAtomic,
  assertNonEmptyString,
  assertRfc3339,
  assertSha256,
  canonicalJson,
  sha256Hex,
} from './canonical.mjs';

const TASK_SCHEMA = 'workseal-task/v1';
const RESULT_SCHEMA = 'workseal-result/v1';
const RECEIPT_SCHEMA = 'workseal-acceptance/v1';
const STATE_SCHEMA = 'workseal-state/v1';
const SETTLEMENT_SCHEMA = 'workseal-settlement-intent/v1';

function fail(code, message) {
  throw new WorkSealError(code, message);
}

function assertExactKeys(object, allowed, name) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail('BAD_OBJECT', `${name} must be an object`);
  const extras = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNKNOWN_FIELD', `${name} has unknown field(s): ${extras.sort().join(', ')}`);
}

function normalizeParty(party, name) {
  assertExactKeys(party, ['id', 'settlementAddress'], name);
  return {
    id: assertNonEmptyString(party.id, `${name}.id`, 200),
    settlementAddress: assertNonEmptyString(party.settlementAddress, `${name}.settlementAddress`, 200),
  };
}

function normalizePolicy(policy) {
  assertExactKeys(policy, ['verifierId', 'verifierVersion', 'requirements'], 'acceptancePolicy');
  if (!Array.isArray(policy.requirements) || policy.requirements.length === 0 || policy.requirements.length > 64) {
    fail('BAD_REQUIREMENTS', 'acceptancePolicy.requirements must contain 1..64 entries');
  }
  const seen = new Set();
  const requirements = policy.requirements.map((entry, index) => {
    assertExactKeys(entry, ['id', 'description'], `acceptancePolicy.requirements[${index}]`);
    const id = assertNonEmptyString(entry.id, `requirements[${index}].id`, 100);
    if (seen.has(id)) fail('DUPLICATE_REQUIREMENT', `duplicate requirement id: ${id}`);
    seen.add(id);
    return { id, description: assertNonEmptyString(entry.description, `requirements[${index}].description`, 500) };
  });
  return {
    verifierId: assertNonEmptyString(policy.verifierId, 'acceptancePolicy.verifierId', 200),
    verifierVersion: assertNonEmptyString(policy.verifierVersion, 'acceptancePolicy.verifierVersion', 100),
    requirements,
  };
}

export function normalizeTask(task) {
  assertExactKeys(task, ['schema', 'taskId', 'buyer', 'worker', 'currency', 'amountAtomic', 'deadline', 'acceptancePolicy'], 'task');
  if (task.schema !== TASK_SCHEMA) fail('BAD_SCHEMA', `task.schema must be ${TASK_SCHEMA}`);
  const normalized = {
    schema: TASK_SCHEMA,
    taskId: assertNonEmptyString(task.taskId, 'taskId', 200),
    buyer: normalizeParty(task.buyer, 'buyer'),
    worker: normalizeParty(task.worker, 'worker'),
    currency: assertNonEmptyString(task.currency, 'currency', 64),
    amountAtomic: assertAtomic(task.amountAtomic),
    deadline: assertRfc3339(task.deadline, 'deadline'),
    acceptancePolicy: normalizePolicy(task.acceptancePolicy),
  };
  if (normalized.buyer.id === normalized.worker.id) fail('SAME_PARTY', 'buyer and worker must differ');
  return normalized;
}

export function taskDigest(task) {
  return sha256Hex(normalizeTask(task));
}

export function normalizeResult(result, task) {
  const normalizedTask = normalizeTask(task);
  const expectedTaskDigest = sha256Hex(normalizedTask);
  assertExactKeys(result, ['schema', 'taskDigest', 'workerId', 'generation', 'artifactDigest', 'evidence'], 'result');
  if (result.schema !== RESULT_SCHEMA) fail('BAD_SCHEMA', `result.schema must be ${RESULT_SCHEMA}`);
  if (result.taskDigest !== expectedTaskDigest) fail('TASK_DIGEST_MISMATCH', 'result is not bound to this task');
  if (result.workerId !== normalizedTask.worker.id) fail('WORKER_MISMATCH', 'result worker does not match task worker');
  if (!Number.isSafeInteger(result.generation) || result.generation < 1) fail('BAD_GENERATION', 'generation must be a positive safe integer');
  assertSha256(result.artifactDigest, 'artifactDigest');
  if (!Array.isArray(result.evidence) || result.evidence.length === 0 || result.evidence.length > 128) {
    fail('BAD_EVIDENCE', 'evidence must contain 1..128 entries');
  }
  const seen = new Set();
  const evidence = result.evidence.map((entry, index) => {
    assertExactKeys(entry, ['id', 'digest'], `evidence[${index}]`);
    const id = assertNonEmptyString(entry.id, `evidence[${index}].id`, 100);
    if (seen.has(id)) fail('DUPLICATE_EVIDENCE', `duplicate evidence id: ${id}`);
    seen.add(id);
    return { id, digest: assertSha256(entry.digest, `evidence[${index}].digest`) };
  });
  return {
    schema: RESULT_SCHEMA,
    taskDigest: expectedTaskDigest,
    workerId: normalizedTask.worker.id,
    generation: result.generation,
    artifactDigest: result.artifactDigest,
    evidence,
  };
}

export function resultDigest(result, task) {
  return sha256Hex(normalizeResult(result, task));
}

export function makeAcceptanceReceipt({ task, result, checks, acceptedAt }) {
  const normalizedTask = normalizeTask(task);
  const normalizedResult = normalizeResult(result, normalizedTask);
  const policyIds = normalizedTask.acceptancePolicy.requirements.map((r) => r.id).sort();
  if (!Array.isArray(checks) || checks.length !== policyIds.length) fail('CHECK_SET_MISMATCH', 'checks must cover every policy requirement exactly once');
  const seen = new Set();
  const normalizedChecks = checks.map((check, index) => {
    assertExactKeys(check, ['id', 'ok', 'evidenceDigest'], `checks[${index}]`);
    const id = assertNonEmptyString(check.id, `checks[${index}].id`, 100);
    if (seen.has(id)) fail('DUPLICATE_CHECK', `duplicate check id: ${id}`);
    seen.add(id);
    if (typeof check.ok !== 'boolean') fail('BAD_CHECK', `checks[${index}].ok must be boolean`);
    return { id, ok: check.ok, evidenceDigest: assertSha256(check.evidenceDigest, `checks[${index}].evidenceDigest`) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (normalizedChecks.map((c) => c.id).join('\0') !== policyIds.join('\0')) fail('CHECK_SET_MISMATCH', 'check ids do not match policy requirement ids');
  if (normalizedChecks.some((c) => !c.ok)) fail('REQUIREMENT_FAILED', 'cannot mint ACCEPT receipt while a requirement is false');
  return {
    schema: RECEIPT_SCHEMA,
    taskDigest: sha256Hex(normalizedTask),
    resultDigest: sha256Hex(normalizedResult),
    generation: normalizedResult.generation,
    verifierId: normalizedTask.acceptancePolicy.verifierId,
    verifierVersion: normalizedTask.acceptancePolicy.verifierVersion,
    acceptedAt: assertRfc3339(acceptedAt, 'acceptedAt'),
    verdict: 'ACCEPT',
    checksDigest: sha256Hex(normalizedChecks),
  };
}

export function receiptDigest(receipt) {
  return sha256Hex(receipt);
}

export function signAcceptanceReceipt(receipt, privateKeyPem) {
  const signature = nodeSign(null, Buffer.from(canonicalJson(receipt)), privateKeyPem);
  return signature.toString('base64');
}

export function publicKeyFingerprint(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return sha256Hex(der);
}

export function verifyAcceptanceSignature(receipt, signatureBase64, publicKeyPem) {
  if (typeof signatureBase64 !== 'string' || signatureBase64.length === 0) return false;
  try {
    return nodeVerify(null, Buffer.from(canonicalJson(receipt)), publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

function eventDigest(event) {
  return sha256Hex(event);
}

export function createState(task, receiptAuthorityFingerprint) {
  const normalizedTask = normalizeTask(task);
  assertSha256(receiptAuthorityFingerprint, 'receiptAuthorityFingerprint');
  return {
    schema: STATE_SCHEMA,
    task: normalizedTask,
    taskDigest: sha256Hex(normalizedTask),
    receiptAuthorityFingerprint,
    phase: 'CREATED',
    sequence: 0,
    generation: 0,
    result: null,
    resultDigest: null,
    acceptance: null,
    acceptanceDigest: null,
    fundingRef: null,
    previousEventDigest: null,
  };
}

export function fundState(state, funding) {
  if (state.phase !== 'CREATED') fail('BAD_PHASE', `cannot fund from ${state.phase}`);
  assertExactKeys(funding, ['chain', 'reference', 'currency', 'amountAtomic'], 'funding');
  if (funding.currency !== state.task.currency || funding.amountAtomic !== state.task.amountAtomic) fail('FUNDING_MISMATCH', 'funding amount/currency must exactly match task');
  const normalizedFunding = {
    chain: assertNonEmptyString(funding.chain, 'funding.chain', 100),
    reference: assertNonEmptyString(funding.reference, 'funding.reference', 300),
    currency: funding.currency,
    amountAtomic: funding.amountAtomic,
  };
  const event = {
    type: 'FUNDED', taskDigest: state.taskDigest, sequence: state.sequence + 1,
    funding: normalizedFunding, previousEventDigest: state.previousEventDigest,
  };
  return { ...state, phase: 'FUNDED', sequence: event.sequence, fundingRef: normalizedFunding, previousEventDigest: eventDigest(event) };
}

export function commitResult(state, result) {
  if (state.phase !== 'FUNDED' && state.phase !== 'COMMITTED') fail('BAD_PHASE', `cannot commit result from ${state.phase}`);
  const normalized = normalizeResult(result, state.task);
  if (normalized.generation !== state.generation + 1) fail('GENERATION_MISMATCH', `expected generation ${state.generation + 1}`);
  const digest = sha256Hex(normalized);
  const event = {
    type: 'RESULT_COMMITTED', taskDigest: state.taskDigest, resultDigest: digest,
    generation: normalized.generation, sequence: state.sequence + 1,
    previousEventDigest: state.previousEventDigest,
  };
  return {
    ...state,
    phase: 'COMMITTED',
    sequence: event.sequence,
    generation: normalized.generation,
    result: normalized,
    resultDigest: digest,
    acceptance: null,
    acceptanceDigest: null,
    previousEventDigest: eventDigest(event),
  };
}

export function acceptState(state, { receipt, signatureBase64, publicKeyPem }) {
  if (state.phase !== 'COMMITTED') fail('BAD_PHASE', `cannot accept from ${state.phase}`);
  if (publicKeyFingerprint(publicKeyPem) !== state.receiptAuthorityFingerprint) fail('AUTHORITY_MISMATCH', 'receipt key does not match pinned authority');
  if (!verifyAcceptanceSignature(receipt, signatureBase64, publicKeyPem)) fail('BAD_SIGNATURE', 'invalid acceptance signature');
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.verdict !== 'ACCEPT') fail('BAD_RECEIPT', 'receipt must be an ACCEPT receipt');
  if (receipt.taskDigest !== state.taskDigest) fail('TASK_DIGEST_MISMATCH', 'receipt task digest mismatch');
  if (receipt.resultDigest !== state.resultDigest) fail('RESULT_DIGEST_MISMATCH', 'receipt result digest mismatch');
  if (receipt.generation !== state.generation) fail('GENERATION_MISMATCH', 'receipt generation mismatch');
  if (receipt.verifierId !== state.task.acceptancePolicy.verifierId || receipt.verifierVersion !== state.task.acceptancePolicy.verifierVersion) {
    fail('VERIFIER_MISMATCH', 'receipt verifier does not match pinned policy');
  }
  assertRfc3339(receipt.acceptedAt, 'receipt.acceptedAt');
  assertSha256(receipt.checksDigest, 'receipt.checksDigest');
  const receiptOnlyDigest = sha256Hex(receipt);
  const digest = sha256Hex({
    schema: 'workseal-signed-acceptance/v1',
    receiptDigest: receiptOnlyDigest,
    receiptAuthorityFingerprint: state.receiptAuthorityFingerprint,
    signatureBase64,
  });
  const event = {
    type: 'ACCEPTED', taskDigest: state.taskDigest, resultDigest: state.resultDigest,
    acceptanceDigest: digest, receiptDigest: receiptOnlyDigest,
    receiptAuthorityFingerprint: state.receiptAuthorityFingerprint,
    generation: state.generation, sequence: state.sequence + 1,
    previousEventDigest: state.previousEventDigest,
  };
  return {
    ...state,
    phase: 'ACCEPTED',
    sequence: event.sequence,
    acceptance: { receipt, signatureBase64, receiptDigest: receiptOnlyDigest },
    acceptanceDigest: digest,
    previousEventDigest: eventDigest(event),
  };
}

export function createSettlementIntent(state) {
  if (state.phase !== 'ACCEPTED') fail('BAD_PHASE', `cannot settle from ${state.phase}`);
  return {
    schema: SETTLEMENT_SCHEMA,
    taskDigest: state.taskDigest,
    resultDigest: state.resultDigest,
    acceptanceDigest: state.acceptanceDigest,
    receiptAuthorityFingerprint: state.receiptAuthorityFingerprint,
    generation: state.generation,
    currency: state.task.currency,
    amountAtomic: state.task.amountAtomic,
    payer: state.task.buyer.settlementAddress,
    payee: state.task.worker.settlementAddress,
    funding: state.fundingRef,
    eventHead: state.previousEventDigest,
  };
}

export function settleState(state, settlementReference) {
  const intent = createSettlementIntent(state);
  const reference = assertNonEmptyString(settlementReference, 'settlementReference', 300);
  const intentDigest = sha256Hex(intent);
  const event = {
    type: 'SETTLED', taskDigest: state.taskDigest, settlementIntentDigest: intentDigest,
    settlementReference: reference, sequence: state.sequence + 1,
    previousEventDigest: state.previousEventDigest,
  };
  return {
    ...state,
    phase: 'SETTLED',
    sequence: event.sequence,
    settlementReference: reference,
    settlementIntentDigest: intentDigest,
    previousEventDigest: eventDigest(event),
  };
}

export const schemas = Object.freeze({ TASK_SCHEMA, RESULT_SCHEMA, RECEIPT_SCHEMA, STATE_SCHEMA, SETTLEMENT_SCHEMA });
