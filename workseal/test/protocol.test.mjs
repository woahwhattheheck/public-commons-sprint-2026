import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, sha256Hex, WorkSealError } from '../src/canonical.mjs';
import {
  acceptState,
  commitResult,
  createSettlementIntent,
  createState,
  fundState,
  makeAcceptanceReceipt,
  publicKeyFingerprint,
  resultDigest,
  signAcceptanceReceipt,
  taskDigest,
  verifyAcceptanceSignature,
} from '../src/protocol.mjs';
import { makeSolanaSettlementPlan, SOLANA_MEMO_PROGRAM, SOLANA_SYSTEM_PROGRAM } from '../src/solana.mjs';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function task() {
  return {
    schema: 'workseal-task/v1',
    taskId: 'T-1',
    buyer: { id: 'buyer', settlementAddress: 'Buyer1111111111111111111111111111111111111' },
    worker: { id: 'worker', settlementAddress: 'Worker111111111111111111111111111111111111' },
    currency: 'SOL_LAMPORTS',
    amountAtomic: '1000',
    deadline: '2026-10-12T23:59:59Z',
    acceptancePolicy: {
      verifierId: 'verifier-a', verifierVersion: '1',
      requirements: [
        { id: 'artifact', description: 'artifact digest matches' },
        { id: 'tests', description: 'tests pass' },
      ],
    },
  };
}

function result(t, generation = 1) {
  return {
    schema: 'workseal-result/v1',
    taskDigest: taskDigest(t),
    workerId: t.worker.id,
    generation,
    artifactDigest: sha256Hex('artifact'),
    evidence: [
      { id: 'artifact', digest: sha256Hex('artifact') },
      { id: 'tests', digest: sha256Hex('tests pass') },
    ],
  };
}

function receipt(t, r) {
  return makeAcceptanceReceipt({
    task: t,
    result: r,
    acceptedAt: '2026-09-14T23:30:00Z',
    checks: [
      { id: 'tests', ok: true, evidenceDigest: sha256Hex('tests pass') },
      { id: 'artifact', ok: true, evidenceDigest: sha256Hex('artifact') },
    ],
  });
}

function acceptedState() {
  const t = task();
  const k = keys();
  let state = createState(t, publicKeyFingerprint(k.publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'funding-sig', currency: t.currency, amountAtomic: t.amountAtomic });
  const r = result(t);
  state = commitResult(state, r);
  const rcpt = receipt(t, r);
  const sig = signAcceptanceReceipt(rcpt, k.privateKeyPem);
  state = acceptState(state, { receipt: rcpt, signatureBase64: sig, publicKeyPem: k.publicKeyPem });
  return { t, k, r, rcpt, state };
}

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: 'v' } }), canonicalJson({ a: { x: 'v', y: true }, z: 1 }));
});

test('unsafe numbers fail closed', () => {
  assert.throws(() => canonicalJson({ n: Number.MAX_SAFE_INTEGER + 1 }), (e) => e instanceof WorkSealError && e.code === 'UNSAFE_NUMBER');
});

test('task digest is stable across object key order', () => {
  const t = task();
  const reordered = { amountAtomic: t.amountAtomic, worker: t.worker, schema: t.schema, deadline: t.deadline, acceptancePolicy: t.acceptancePolicy, currency: t.currency, buyer: t.buyer, taskId: t.taskId };
  assert.equal(taskDigest(t), taskDigest(reordered));
});

test('unknown task fields are rejected', () => {
  const t = { ...task(), surprise: true };
  assert.throws(() => taskDigest(t), (e) => e.code === 'UNKNOWN_FIELD');
});

test('atomic amount rejects floats and leading zero', () => {
  assert.throws(() => taskDigest({ ...task(), amountAtomic: '01' }), (e) => e.code === 'BAD_ATOMIC_AMOUNT');
  assert.throws(() => taskDigest({ ...task(), amountAtomic: '1.5' }), (e) => e.code === 'BAD_ATOMIC_AMOUNT');
});

test('timestamps require explicit timezone', () => {
  assert.throws(() => taskDigest({ ...task(), deadline: '2026-10-12T23:59:59' }), (e) => e.code === 'BAD_TIMESTAMP');
});

test('result must bind exact task', () => {
  const t = task();
  const r = { ...result(t), taskDigest: sha256Hex('other') };
  assert.throws(() => resultDigest(r, t), (e) => e.code === 'TASK_DIGEST_MISMATCH');
});

test('result must bind exact worker', () => {
  const t = task();
  const r = { ...result(t), workerId: 'other-worker' };
  assert.throws(() => resultDigest(r, t), (e) => e.code === 'WORKER_MISMATCH');
});

test('duplicate evidence ids are rejected', () => {
  const t = task();
  const r = result(t);
  r.evidence.push({ ...r.evidence[0] });
  assert.throws(() => resultDigest(r, t), (e) => e.code === 'DUPLICATE_EVIDENCE');
});

test('acceptance requires every policy check', () => {
  const t = task();
  const r = result(t);
  assert.throws(() => makeAcceptanceReceipt({ task: t, result: r, acceptedAt: '2026-09-14T23:30:00Z', checks: [{ id: 'tests', ok: true, evidenceDigest: sha256Hex('x') }] }), (e) => e.code === 'CHECK_SET_MISMATCH');
});

test('acceptance refuses false checks', () => {
  const t = task();
  const r = result(t);
  assert.throws(() => makeAcceptanceReceipt({ task: t, result: r, acceptedAt: '2026-09-14T23:30:00Z', checks: [
    { id: 'tests', ok: false, evidenceDigest: sha256Hex('x') },
    { id: 'artifact', ok: true, evidenceDigest: sha256Hex('y') },
  ] }), (e) => e.code === 'REQUIREMENT_FAILED');
});

test('acceptance check order does not change receipt digest', () => {
  const t = task(); const r = result(t);
  const a = makeAcceptanceReceipt({ task: t, result: r, acceptedAt: '2026-09-14T23:30:00Z', checks: [
    { id: 'tests', ok: true, evidenceDigest: sha256Hex('tests pass') },
    { id: 'artifact', ok: true, evidenceDigest: sha256Hex('artifact') },
  ] });
  const b = makeAcceptanceReceipt({ task: t, result: r, acceptedAt: '2026-09-14T23:30:00Z', checks: [
    { id: 'artifact', ok: true, evidenceDigest: sha256Hex('artifact') },
    { id: 'tests', ok: true, evidenceDigest: sha256Hex('tests pass') },
  ] });
  assert.equal(sha256Hex(a), sha256Hex(b));
});

test('ed25519 acceptance signature verifies and tampering fails', () => {
  const t = task(); const r = result(t); const rcpt = receipt(t, r); const k = keys();
  const sig = signAcceptanceReceipt(rcpt, k.privateKeyPem);
  assert.equal(verifyAcceptanceSignature(rcpt, sig, k.publicKeyPem), true);
  assert.equal(verifyAcceptanceSignature({ ...rcpt, generation: 2 }, sig, k.publicKeyPem), false);
});

test('funding must exactly match amount and currency', () => {
  const t = task(); const k = keys(); const state = createState(t, publicKeyFingerprint(k.publicKeyPem));
  assert.throws(() => fundState(state, { chain: 'solana-devnet', reference: 'x', currency: t.currency, amountAtomic: '999' }), (e) => e.code === 'FUNDING_MISMATCH');
});

test('state enforces monotonically increasing result generation', () => {
  const t = task(); const k = keys();
  let state = createState(t, publicKeyFingerprint(k.publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'x', currency: t.currency, amountAtomic: t.amountAtomic });
  state = commitResult(state, result(t, 1));
  assert.throws(() => commitResult(state, result(t, 1)), (e) => e.code === 'GENERATION_MISMATCH');
  state = commitResult(state, result(t, 2));
  assert.equal(state.generation, 2);
});

test('old acceptance receipt cannot settle a newer result generation', () => {
  const t = task(); const k = keys();
  let state = createState(t, publicKeyFingerprint(k.publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'x', currency: t.currency, amountAtomic: t.amountAtomic });
  const r1 = result(t, 1); state = commitResult(state, r1); const old = receipt(t, r1); const oldSig = signAcceptanceReceipt(old, k.privateKeyPem);
  state = commitResult(state, result(t, 2));
  assert.throws(() => acceptState(state, { receipt: old, signatureBase64: oldSig, publicKeyPem: k.publicKeyPem }), (e) => ['RESULT_DIGEST_MISMATCH', 'GENERATION_MISMATCH'].includes(e.code));
});

test('pinned receipt authority cannot be swapped', () => {
  const t = task(); const k1 = keys(); const k2 = keys();
  let state = createState(t, publicKeyFingerprint(k1.publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'x', currency: t.currency, amountAtomic: t.amountAtomic });
  const r = result(t); state = commitResult(state, r); const rcpt = receipt(t, r); const sig = signAcceptanceReceipt(rcpt, k2.privateKeyPem);
  assert.throws(() => acceptState(state, { receipt: rcpt, signatureBase64: sig, publicKeyPem: k2.publicKeyPem }), (e) => e.code === 'AUTHORITY_MISMATCH');
});

test('settlement intent binds task, result, acceptance and event head', () => {
  const { state } = acceptedState(); const intent = createSettlementIntent(state);
  assert.equal(intent.taskDigest, state.taskDigest);
  assert.equal(intent.resultDigest, state.resultDigest);
  assert.equal(intent.acceptanceDigest, state.acceptanceDigest);
  assert.equal(intent.eventHead, state.previousEventDigest);
});

test('settlement cannot be created before ACCEPTED', () => {
  const t = task(); const k = keys(); const state = createState(t, publicKeyFingerprint(k.publicKeyPem));
  assert.throws(() => createSettlementIntent(state), (e) => e.code === 'BAD_PHASE');
});

test('Solana plan is deterministic and performs no write', () => {
  const { state } = acceptedState(); const intent = createSettlementIntent(state);
  const a = makeSolanaSettlementPlan(intent, { cluster: 'devnet' });
  const b = makeSolanaSettlementPlan(intent, { cluster: 'devnet' });
  assert.deepEqual(a, b);
  assert.equal(a.writePerformed, false);
  assert.equal(a.instructions[0].programId, SOLANA_MEMO_PROGRAM);
  assert.equal(a.instructions[1].programId, SOLANA_SYSTEM_PROGRAM);
  assert.equal(a.instructions[1].lamports, '1000');
});

test('Solana plan rejects unsupported currency', () => {
  const { state } = acceptedState(); const intent = { ...createSettlementIntent(state), currency: 'USDC' };
  assert.throws(() => makeSolanaSettlementPlan(intent), (e) => e.code === 'UNSUPPORTED_CURRENCY');
});

test('Solana memo binds exact settlement intent digest', () => {
  const { state } = acceptedState(); const intent = createSettlementIntent(state); const plan = makeSolanaSettlementPlan(intent);
  assert.equal(plan.instructions[0].utf8, `WORKSEAL:v1:${sha256Hex(intent)}`);
});
