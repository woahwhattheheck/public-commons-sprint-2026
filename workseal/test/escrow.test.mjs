import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex, WorkSealError } from '../src/canonical.mjs';
import {
  SPL_TOKEN_PROGRAM,
  acceptEscrowResult,
  commitEscrowResult,
  createEscrowModel,
  disputeEscrowModel,
  fundEscrowModel,
  makeEscrowInstructionPlan,
  makeEscrowSpec,
  refundExpiredEscrowModel,
  releaseEscrowModel,
} from '../src/escrow.mjs';

const A = {
  buyer: 'BuyerAuth111111111111111111111111111111111',
  worker: 'WorkerAuth11111111111111111111111111111111',
  verifier: 'VerifyAuth1111111111111111111111111111111',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  buyerAta: 'BuyerToken111111111111111111111111111111111',
  workerAta: 'WorkerToken11111111111111111111111111111111',
};
function spec(overrides = {}) {
  return makeEscrowSpec({
    taskDigest: sha256Hex('task-a'),
    policyDigest: sha256Hex('policy-a'),
    receiptAuthorityFingerprint: sha256Hex('receipt-ed25519-authority'),
    buyerAuthority: A.buyer,
    workerAuthority: A.worker,
    verifierAuthority: A.verifier,
    mint: A.mint,
    tokenProgram: SPL_TOKEN_PROGRAM,
    buyerTokenAccount: A.buyerAta,
    workerTokenAccount: A.workerAta,
    amountAtomic: '25000000',
    deadlineUnix: 1791849599,
    ...overrides,
  });
}
function funded() {
  let state = createEscrowModel(spec());
  state = fundEscrowModel(state, { buyerAuthority: A.buyer, sourceTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: '25000000', escrowModelAddress: state.escrowModelAddress, vaultModelAddress: state.vaultModelAddress });
  return state;
}
function committed(generation = 1) {
  const state = funded();
  return commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: state.taskDigest, resultDigest: sha256Hex(`result-${generation}`), generation, mint: A.mint, escrowModelAddress: state.escrowModelAddress });
}
function accepted() {
  const state = committed();
  return acceptEscrowResult(state, { verifierAuthority: A.verifier, taskDigest: state.taskDigest, resultDigest: state.resultDigest, acceptanceDigest: sha256Hex('signed-acceptance-envelope'), receiptAuthorityFingerprint: state.receiptAuthorityFingerprint, generation: state.generation, mint: A.mint });
}

test('PDA model commitments are deterministic and task scoped', () => {
  const a = spec(); const b = spec(); const c = spec({ taskDigest: sha256Hex('task-b') });
  assert.equal(a.escrowSeedDigest, b.escrowSeedDigest);
  assert.equal(a.vaultSeedDigest, b.vaultSeedDigest);
  assert.notEqual(a.escrowSeedDigest, c.escrowSeedDigest);
});

test('SPL funding is exact, mint-bound, account-bound, and buyer-authorized', () => {
  const base = createEscrowModel(spec());
  assert.throws(() => fundEscrowModel(base, { buyerAuthority: 'attacker', sourceTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: base.amountAtomic }), e => e.code === 'BUYER_MISMATCH');
  assert.throws(() => fundEscrowModel(base, { buyerAuthority: A.buyer, sourceTokenAccount: 'wrong', mint: A.mint, amountAtomic: base.amountAtomic }), e => e.code === 'SOURCE_TOKEN_MISMATCH');
  assert.throws(() => fundEscrowModel(base, { buyerAuthority: A.buyer, sourceTokenAccount: A.buyerAta, mint: 'WrongMint', amountAtomic: base.amountAtomic }), e => e.code === 'MINT_MISMATCH');
  assert.throws(() => fundEscrowModel(base, { buyerAuthority: A.buyer, sourceTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: '25000001' }), e => e.code === 'AMOUNT_MISMATCH');
  assert.equal(funded().phase, 'FUNDED');
});

test('worker commit binds exact task and strictly monotonic generation', () => {
  let state = funded();
  assert.throws(() => commitEscrowResult(state, { workerAuthority: 'attacker', taskDigest: state.taskDigest, resultDigest: sha256Hex('r'), generation: 1 }), e => e.code === 'WORKER_MISMATCH');
  assert.throws(() => commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: sha256Hex('other'), resultDigest: sha256Hex('r'), generation: 1 }), e => e.code === 'TASK_DIGEST_MISMATCH');
  state = commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: state.taskDigest, resultDigest: sha256Hex('r1'), generation: 1 });
  assert.throws(() => commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: state.taskDigest, resultDigest: sha256Hex('r1-replay'), generation: 1 }), e => e.code === 'GENERATION_MISMATCH');
  const next = commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: state.taskDigest, resultDigest: sha256Hex('r2'), generation: 2 });
  assert.equal(next.generation, 2);
});

test('verifier acceptance binds current result, generation, task, and signed-receipt authority', () => {
  const state = committed();
  const good = { verifierAuthority: A.verifier, taskDigest: state.taskDigest, resultDigest: state.resultDigest, acceptanceDigest: sha256Hex('accept'), receiptAuthorityFingerprint: state.receiptAuthorityFingerprint, generation: state.generation };
  assert.throws(() => acceptEscrowResult(state, { ...good, verifierAuthority: 'attacker' }), e => e.code === 'VERIFIER_MISMATCH');
  assert.throws(() => acceptEscrowResult(state, { ...good, taskDigest: sha256Hex('other') }), e => e.code === 'TASK_DIGEST_MISMATCH');
  assert.throws(() => acceptEscrowResult(state, { ...good, resultDigest: sha256Hex('stale-result') }), e => e.code === 'RESULT_DIGEST_MISMATCH');
  assert.throws(() => acceptEscrowResult(state, { ...good, generation: state.generation - 1 }), e => e.code === 'GENERATION_MISMATCH');
  assert.throws(() => acceptEscrowResult(state, { ...good, receiptAuthorityFingerprint: sha256Hex('swapped-authority') }), e => e.code === 'RECEIPT_AUTHORITY_MISMATCH');
  assert.equal(acceptEscrowResult(state, good).phase, 'ACCEPTED');
});

test('accepted escrow releases exact amount permissionlessly under PDA authority', () => {
  const state = accepted();
  const plan = makeEscrowInstructionPlan(state, { kind: 'release' });
  assert.deepEqual(plan.requiredSigners, []);
  assert.equal(plan.pdaAuthority, state.escrowModelAddress);
  assert.equal(plan.writePerformed, false);
  assert.throws(() => releaseEscrowModel(state, { destinationTokenAccount: A.workerAta, mint: A.mint, amountAtomic: '25000001' }), e => e.code === 'AMOUNT_MISMATCH');
  assert.throws(() => releaseEscrowModel(state, { destinationTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: state.amountAtomic }), e => e.code === 'DESTINATION_TOKEN_MISMATCH');
  assert.throws(() => releaseEscrowModel(state, { destinationTokenAccount: A.workerAta, mint: 'WrongMint', amountAtomic: state.amountAtomic }), e => e.code === 'MINT_MISMATCH');
  const released = releaseEscrowModel(state, { destinationTokenAccount: A.workerAta, mint: A.mint, amountAtomic: state.amountAtomic });
  assert.equal(released.phase, 'RELEASED'); assert.equal(released.vaultBalanceAtomic, '0');
  assert.throws(() => releaseEscrowModel(released, { destinationTokenAccount: A.workerAta, mint: A.mint, amountAtomic: released.amountAtomic }), e => e.code === 'BAD_PHASE');
});

test('expiry refund is buyer-only, deadline-gated, exact, and impossible after acceptance', () => {
  const state = funded();
  const base = { buyerAuthority: A.buyer, destinationTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: state.amountAtomic };
  assert.throws(() => refundExpiredEscrowModel(state, { ...base, nowUnix: state.deadlineUnix }), e => e.code === 'NOT_EXPIRED');
  assert.throws(() => refundExpiredEscrowModel(state, { ...base, buyerAuthority: 'attacker', nowUnix: state.deadlineUnix + 1 }), e => e.code === 'BUYER_MISMATCH');
  const refunded = refundExpiredEscrowModel(state, { ...base, nowUnix: state.deadlineUnix + 1 });
  assert.equal(refunded.phase, 'REFUNDED');
  const acceptedState = accepted();
  assert.throws(() => refundExpiredEscrowModel(acceptedState, { ...base, nowUnix: state.deadlineUnix + 1 }), e => e.code === 'BAD_PHASE');
});

test('dispute freezes funds and only buyer/worker can enter terminal DISPUTED state', () => {
  const state = committed(); const disputeDigest = sha256Hex('scope mismatch evidence');
  assert.throws(() => disputeEscrowModel(state, { actorAuthority: 'attacker', disputeDigest, mint: A.mint }), e => e.code === 'DISPUTE_AUTHORITY_MISMATCH');
  const disputed = disputeEscrowModel(state, { actorAuthority: A.worker, disputeDigest, mint: A.mint });
  assert.equal(disputed.phase, 'DISPUTED'); assert.equal(disputed.vaultBalanceAtomic, state.amountAtomic);
  assert.throws(() => releaseEscrowModel(disputed, { destinationTokenAccount: A.workerAta, mint: A.mint, amountAtomic: disputed.amountAtomic }), e => e.code === 'BAD_PHASE');
  assert.throws(() => refundExpiredEscrowModel(disputed, { buyerAuthority: A.buyer, destinationTokenAccount: A.buyerAta, mint: A.mint, amountAtomic: disputed.amountAtomic, nowUnix: state.deadlineUnix + 1 }), e => e.code === 'BAD_PHASE');
});

test('cross-task and cross-vault transplant attempts fail closed', () => {
  const state = funded();
  const other = createEscrowModel(spec({ taskDigest: sha256Hex('task-b') }));
  assert.throws(() => commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: other.taskDigest, resultDigest: sha256Hex('r'), generation: 1, escrowModelAddress: other.escrowModelAddress }), e => ['ESCROW_MISMATCH', 'TASK_DIGEST_MISMATCH'].includes(e.code));
  assert.throws(() => commitEscrowResult(state, { workerAuthority: A.worker, taskDigest: state.taskDigest, resultDigest: sha256Hex('r'), generation: 1, vaultModelAddress: other.vaultModelAddress }), e => e.code === 'VAULT_MISMATCH');
});

test('u64 overflow fails before plan construction', () => {
  assert.throws(() => spec({ amountAtomic: '18446744073709551616' }), e => e instanceof WorkSealError && e.code === 'AMOUNT_OVERFLOW');
});

test('instruction plans are deterministic and explicitly non-writing', () => {
  const state = accepted();
  const a = makeEscrowInstructionPlan(state, { kind: 'release' }); const b = makeEscrowInstructionPlan(state, { kind: 'release' });
  assert.deepEqual(a, b); assert.equal(a.writePerformed, false); assert.match(a.instructionDigest, /^[0-9a-f]{64}$/);
});
