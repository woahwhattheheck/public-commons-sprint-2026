import { WorkSealError, assertAtomic, assertNonEmptyString, assertSha256, sha256Hex } from './canonical.mjs';

export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ESCROW_MODEL_SCHEMA = 'workseal-solana-escrow-model/v1';
export const INSTRUCTION_PLAN_SCHEMA = 'workseal-solana-instruction-plan/v1';
const U64_MAX = 18_446_744_073_709_551_615n;

function fail(code, message) { throw new WorkSealError(code, message); }
function u64Atomic(value, name = 'amountAtomic') {
  const raw = assertAtomic(value, name);
  if (BigInt(raw) > U64_MAX) fail('AMOUNT_OVERFLOW', `${name} exceeds u64`);
  return raw;
}
function address(value, name) { return assertNonEmptyString(value, name, 128); }
function unix(value, name) { if (!Number.isSafeInteger(value) || value < 0) fail('BAD_UNIX_TIME', `${name} must be a non-negative safe integer`); return value; }
function phase(state, ...allowed) { if (!allowed.includes(state.phase)) fail('BAD_PHASE', `cannot transition ${state.phase}`); }
function same(value, expected, code, message) { if (value !== expected) fail(code, message); }
function requireDigest(value, name) { return assertSha256(value, name); }

export function deriveEscrowModelAddresses(spec) {
  const escrowSeedDigest = sha256Hex({
    namespace: 'workseal',
    buyer: spec.buyerAuthority,
    worker: spec.workerAuthority,
    mint: spec.mint,
    taskDigest: spec.taskDigest,
  });
  const vaultSeedDigest = sha256Hex({ namespace: 'vault', escrowSeedDigest });
  return {
    escrowSeedDigest,
    vaultSeedDigest,
    escrowModelAddress: `pda-model:${escrowSeedDigest}`,
    vaultModelAddress: `pda-model:${vaultSeedDigest}`,
  };
}

export function makeEscrowSpec({
  taskDigest,
  policyDigest,
  receiptAuthorityFingerprint,
  buyerAuthority,
  workerAuthority,
  verifierAuthority,
  mint,
  tokenProgram = SPL_TOKEN_PROGRAM,
  buyerTokenAccount,
  workerTokenAccount,
  amountAtomic,
  deadlineUnix,
}) {
  const spec = {
    schema: ESCROW_MODEL_SCHEMA,
    taskDigest: requireDigest(taskDigest, 'taskDigest'),
    policyDigest: requireDigest(policyDigest, 'policyDigest'),
    receiptAuthorityFingerprint: requireDigest(receiptAuthorityFingerprint, 'receiptAuthorityFingerprint'),
    buyerAuthority: address(buyerAuthority, 'buyerAuthority'),
    workerAuthority: address(workerAuthority, 'workerAuthority'),
    verifierAuthority: address(verifierAuthority, 'verifierAuthority'),
    mint: address(mint, 'mint'),
    tokenProgram: address(tokenProgram, 'tokenProgram'),
    buyerTokenAccount: address(buyerTokenAccount, 'buyerTokenAccount'),
    workerTokenAccount: address(workerTokenAccount, 'workerTokenAccount'),
    amountAtomic: u64Atomic(amountAtomic),
    deadlineUnix: unix(deadlineUnix, 'deadlineUnix'),
  };
  if (spec.buyerAuthority === spec.workerAuthority) fail('SAME_PARTY', 'buyer and worker authority must differ');
  if (spec.buyerTokenAccount === spec.workerTokenAccount) fail('SAME_TOKEN_ACCOUNT', 'buyer and worker token accounts must differ');
  return Object.freeze({ ...spec, ...deriveEscrowModelAddresses(spec) });
}

export function createEscrowModel(spec) {
  if (!spec || spec.schema !== ESCROW_MODEL_SCHEMA) fail('BAD_SCHEMA', 'expected WorkSeal escrow spec');
  return {
    ...spec,
    phase: 'CREATED',
    generation: 0,
    resultDigest: null,
    acceptanceDigest: null,
    vaultBalanceAtomic: '0',
    settledAmountAtomic: '0',
    disputeDigest: null,
    sequence: 0,
    previousEventDigest: null,
  };
}

function next(state, event, patch) {
  const normalizedEvent = {
    schema: 'workseal-solana-escrow-event/v1',
    taskDigest: state.taskDigest,
    sequence: state.sequence + 1,
    previousEventDigest: state.previousEventDigest,
    ...event,
  };
  return { ...state, ...patch, sequence: normalizedEvent.sequence, previousEventDigest: sha256Hex(normalizedEvent) };
}

function verifyEscrowIdentity(state, input = {}) {
  if (input.escrowModelAddress !== undefined) same(input.escrowModelAddress, state.escrowModelAddress, 'ESCROW_MISMATCH', 'escrow identity does not match task PDA seeds');
  if (input.vaultModelAddress !== undefined) same(input.vaultModelAddress, state.vaultModelAddress, 'VAULT_MISMATCH', 'vault identity does not match escrow PDA');
  if (input.mint !== undefined) same(input.mint, state.mint, 'MINT_MISMATCH', 'token mint does not match pinned escrow mint');
  if (input.tokenProgram !== undefined) same(input.tokenProgram, state.tokenProgram, 'TOKEN_PROGRAM_MISMATCH', 'token program does not match pinned escrow token program');
}

export function fundEscrowModel(state, input) {
  phase(state, 'CREATED'); verifyEscrowIdentity(state, input);
  same(input.buyerAuthority, state.buyerAuthority, 'BUYER_MISMATCH', 'funding authority is not the buyer');
  same(input.sourceTokenAccount, state.buyerTokenAccount, 'SOURCE_TOKEN_MISMATCH', 'funding source is not the pinned buyer token account');
  same(u64Atomic(input.amountAtomic), state.amountAtomic, 'AMOUNT_MISMATCH', 'funding must equal escrow amount');
  return next(state, { type: 'FUNDED', amountAtomic: state.amountAtomic, sourceTokenAccount: state.buyerTokenAccount }, { phase: 'FUNDED', vaultBalanceAtomic: state.amountAtomic });
}

export function commitEscrowResult(state, input) {
  phase(state, 'FUNDED', 'COMMITTED'); verifyEscrowIdentity(state, input);
  same(input.workerAuthority, state.workerAuthority, 'WORKER_MISMATCH', 'only the pinned worker may commit results');
  same(input.taskDigest, state.taskDigest, 'TASK_DIGEST_MISMATCH', 'result commit targets another task');
  const resultDigest = requireDigest(input.resultDigest, 'resultDigest');
  if (!Number.isSafeInteger(input.generation) || input.generation !== state.generation + 1) fail('GENERATION_MISMATCH', `expected generation ${state.generation + 1}`);
  return next(state, { type: 'RESULT_COMMITTED', generation: input.generation, resultDigest }, { phase: 'COMMITTED', generation: input.generation, resultDigest, acceptanceDigest: null });
}

export function acceptEscrowResult(state, input) {
  phase(state, 'COMMITTED'); verifyEscrowIdentity(state, input);
  same(input.verifierAuthority, state.verifierAuthority, 'VERIFIER_MISMATCH', 'acceptance signer is not the pinned verifier');
  same(input.taskDigest, state.taskDigest, 'TASK_DIGEST_MISMATCH', 'acceptance targets another task');
  same(input.resultDigest, state.resultDigest, 'RESULT_DIGEST_MISMATCH', 'acceptance targets another result');
  same(input.receiptAuthorityFingerprint, state.receiptAuthorityFingerprint, 'RECEIPT_AUTHORITY_MISMATCH', 'signed receipt authority fingerprint is not pinned');
  if (input.generation !== state.generation) fail('GENERATION_MISMATCH', 'acceptance generation is stale');
  const acceptanceDigest = requireDigest(input.acceptanceDigest, 'acceptanceDigest');
  return next(state, { type: 'ACCEPTED', generation: state.generation, resultDigest: state.resultDigest, acceptanceDigest, receiptAuthorityFingerprint: state.receiptAuthorityFingerprint, verifierAuthority: state.verifierAuthority }, { phase: 'ACCEPTED', acceptanceDigest });
}

function exactFullSettlement(state, input) {
  verifyEscrowIdentity(state, input);
  same(input.destinationTokenAccount, state.workerTokenAccount, 'DESTINATION_TOKEN_MISMATCH', 'release destination is not the pinned worker token account');
  same(u64Atomic(input.amountAtomic), state.amountAtomic, 'AMOUNT_MISMATCH', 'release/refund must transfer the exact escrow amount');
  if (BigInt(state.vaultBalanceAtomic) < BigInt(state.amountAtomic)) fail('INSUFFICIENT_VAULT_BALANCE', 'vault does not contain the escrow amount');
  if (state.settledAmountAtomic !== '0') fail('ALREADY_SETTLED', 'escrow already settled');
}

export function releaseEscrowModel(state, input) {
  phase(state, 'ACCEPTED'); exactFullSettlement(state, input);
  return next(state, { type: 'RELEASED', amountAtomic: state.amountAtomic, resultDigest: state.resultDigest, acceptanceDigest: state.acceptanceDigest }, { phase: 'RELEASED', vaultBalanceAtomic: String(BigInt(state.vaultBalanceAtomic) - BigInt(state.amountAtomic)), settledAmountAtomic: state.amountAtomic });
}

export function refundExpiredEscrowModel(state, input) {
  phase(state, 'FUNDED', 'COMMITTED'); verifyEscrowIdentity(state, input);
  same(input.buyerAuthority, state.buyerAuthority, 'BUYER_MISMATCH', 'only the buyer may request expiry refund');
  same(input.destinationTokenAccount, state.buyerTokenAccount, 'DESTINATION_TOKEN_MISMATCH', 'refund destination is not the pinned buyer token account');
  const nowUnix = unix(input.nowUnix, 'nowUnix');
  if (nowUnix <= state.deadlineUnix) fail('NOT_EXPIRED', 'escrow deadline has not passed');
  same(u64Atomic(input.amountAtomic), state.amountAtomic, 'AMOUNT_MISMATCH', 'release/refund must transfer the exact escrow amount');
  if (BigInt(state.vaultBalanceAtomic) < BigInt(state.amountAtomic)) fail('INSUFFICIENT_VAULT_BALANCE', 'vault does not contain the escrow amount');
  return next(state, { type: 'REFUNDED', amountAtomic: state.amountAtomic, nowUnix }, { phase: 'REFUNDED', vaultBalanceAtomic: String(BigInt(state.vaultBalanceAtomic) - BigInt(state.amountAtomic)), settledAmountAtomic: state.amountAtomic });
}

export function disputeEscrowModel(state, input) {
  phase(state, 'FUNDED', 'COMMITTED'); verifyEscrowIdentity(state, input);
  if (![state.buyerAuthority, state.workerAuthority].includes(input.actorAuthority)) fail('DISPUTE_AUTHORITY_MISMATCH', 'only buyer or worker may freeze the escrow');
  const disputeDigest = requireDigest(input.disputeDigest, 'disputeDigest');
  return next(state, { type: 'DISPUTED', actorAuthority: input.actorAuthority, disputeDigest }, { phase: 'DISPUTED', disputeDigest });
}

export function makeEscrowInstructionPlan(state, action) {
  if (!state || state.schema !== ESCROW_MODEL_SCHEMA) fail('BAD_SCHEMA', 'expected WorkSeal escrow model');
  const baseAccounts = { escrow: state.escrowModelAddress, vault: state.vaultModelAddress, mint: state.mint, tokenProgram: state.tokenProgram };
  let requiredSigners = [];
  let accounts = baseAccounts;
  switch (action.kind) {
    case 'fund': requiredSigners = [state.buyerAuthority]; accounts = { ...baseAccounts, source: state.buyerTokenAccount }; break;
    case 'commit': requiredSigners = [state.workerAuthority]; break;
    case 'accept': requiredSigners = [state.verifierAuthority]; break;
    case 'release': accounts = { ...baseAccounts, destination: state.workerTokenAccount }; break;
    case 'refund': requiredSigners = [state.buyerAuthority]; accounts = { ...baseAccounts, destination: state.buyerTokenAccount }; break;
    case 'dispute': requiredSigners = [action.actorAuthority]; break;
    default: fail('BAD_ACTION', 'unknown WorkSeal escrow instruction');
  }
  const data = { ...action, taskDigest: state.taskDigest, amountAtomic: ['fund', 'release', 'refund'].includes(action.kind) ? state.amountAtomic : undefined };
  const cleanedData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  const instructionDigest = sha256Hex({ program: 'workseal_escrow', accounts, requiredSigners, data: cleanedData });
  return {
    schema: INSTRUCTION_PLAN_SCHEMA,
    action: action.kind,
    accounts,
    requiredSigners,
    pdaAuthority: state.escrowModelAddress,
    pdaSeedCommitments: { escrowSeedDigest: state.escrowSeedDigest, vaultSeedDigest: state.vaultSeedDigest },
    data: cleanedData,
    instructionDigest,
    writePerformed: false,
  };
}
