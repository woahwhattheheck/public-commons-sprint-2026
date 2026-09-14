import { createHash } from 'node:crypto';

export class OnchainModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OnchainModelError';
    this.code = code;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const MAX_U64 = (1n << 64n) - 1n;

function fail(code, message) { throw new OnchainModelError(code, message); }
function text(v, n) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 128) fail('BAD_TEXT', `${n} must be bounded text`);
  return v;
}
function digest(v, n) {
  if (typeof v !== 'string' || !HEX64.test(v)) fail('BAD_DIGEST', `${n} must be lowercase sha256 hex`);
  return v;
}
function pubkey(v, n) {
  if (typeof v !== 'string' || !KEY.test(v)) fail('BAD_PUBKEY', `${n} must be base58-shaped public key text`);
  return v;
}
function u64(v, n, {positive = false} = {}) {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) fail('BAD_U64', `${n} must be canonical unsigned integer string`);
  const x = BigInt(v);
  if (x > MAX_U64 || (positive && x === 0n)) fail('BAD_U64', `${n} outside u64 range`);
  return x;
}
function unix(v, n) {
  if (!Number.isSafeInteger(v) || v < 0) fail('BAD_TIME', `${n} must be non-negative safe integer unix seconds`);
  return v;
}
function exact(obj, keys, n) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('BAD_OBJECT', `${n} must be object`);
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  if (actual.join('\0') !== expected.join('\0')) fail('UNKNOWN_FIELD', `${n} keys mismatch`);
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  fail('BAD_CANONICAL_VALUE', 'unsupported canonical value');
}
function sha(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function assertSigner(actual, expected, role) {
  if (actual !== expected) fail('WRONG_SIGNER', `${role} signer mismatch`);
}
function live(state) {
  if (state.phase === 'SETTLED' || state.phase === 'CANCELLED') fail('TERMINAL', `escrow is ${state.phase}`);
}

export function escrowSeedDigest({ programId, taskDigest, buyer }) {
  return sha({ domain: 'WORKSEAL_ESCROW_V1', programId: pubkey(programId, 'programId'), taskDigest: digest(taskDigest, 'taskDigest'), buyer: pubkey(buyer, 'buyer') });
}

export function createEscrow(config) {
  exact(config, ['programId','taskDigest','buyer','worker','verifierPubkey','amountAtomic','deadlineUnix','asset'], 'config');
  exact(config.asset, ['kind','mint','decimals','tokenProgram'], 'asset');
  const kind = config.asset.kind;
  if (!['SOL','SPL'].includes(kind)) fail('BAD_ASSET', 'asset.kind must be SOL or SPL');
  const amount = u64(config.amountAtomic, 'amountAtomic', {positive:true});
  const deadline = unix(config.deadlineUnix, 'deadlineUnix');
  let asset;
  if (kind === 'SOL') {
    if (config.asset.mint !== null || config.asset.tokenProgram !== null || config.asset.decimals !== 9) fail('BAD_ASSET', 'SOL uses null mint/program and decimals=9');
    asset = {kind:'SOL', mint:null, decimals:9, tokenProgram:null};
  } else {
    if (!Number.isSafeInteger(config.asset.decimals) || config.asset.decimals < 0 || config.asset.decimals > 18) fail('BAD_DECIMALS', 'SPL decimals out of range');
    asset = {kind:'SPL', mint:pubkey(config.asset.mint,'asset.mint'), decimals:config.asset.decimals, tokenProgram:pubkey(config.asset.tokenProgram,'asset.tokenProgram')};
  }
  const state = {
    schema:'workseal-onchain-state/v1',
    seedDigest:escrowSeedDigest(config),
    programId:pubkey(config.programId,'programId'),
    taskDigest:digest(config.taskDigest,'taskDigest'),
    buyer:pubkey(config.buyer,'buyer'),
    worker:pubkey(config.worker,'worker'),
    verifierPubkey:pubkey(config.verifierPubkey,'verifierPubkey'),
    amountAtomic:amount.toString(),
    deadlineUnix:deadline,
    asset,
    phase:'CREATED', generation:0, resultDigest:null, acceptanceDigest:null,
    fundedAtomic:'0', settlementRef:null,
  };
  if (state.buyer === state.worker) fail('SAME_PARTY','buyer and worker must differ');
  return state;
}

export function fundEscrow(state, op) {
  live(state); if (state.phase !== 'CREATED') fail('BAD_PHASE', `cannot fund from ${state.phase}`);
  exact(op, ['signer','amountAtomic','assetProof'], 'fund');
  assertSigner(op.signer, state.buyer, 'buyer');
  const amount = u64(op.amountAtomic, 'fund.amountAtomic', {positive:true});
  if (amount.toString() !== state.amountAtomic) fail('FUNDING_MISMATCH','funding amount must exactly equal escrow amount');
  if (state.asset.kind === 'SOL') {
    if (op.assetProof !== null) fail('BAD_ASSET_PROOF','SOL funding takes null assetProof');
  } else {
    exact(op.assetProof, ['mint','tokenProgram','sourceOwner','destinationOwner'], 'assetProof');
    if (op.assetProof.mint !== state.asset.mint || op.assetProof.tokenProgram !== state.asset.tokenProgram) fail('ASSET_MISMATCH','mint/token program mismatch');
    if (op.assetProof.sourceOwner !== state.buyer) fail('TOKEN_OWNER_MISMATCH','funding token account must be buyer-owned');
    if (op.assetProof.destinationOwner !== state.seedDigest) fail('VAULT_OWNER_MISMATCH','vault authority must bind this escrow seed');
  }
  return {...state, phase:'FUNDED', fundedAtomic:amount.toString()};
}

export function commitDelivery(state, op) {
  live(state); if (!['FUNDED','COMMITTED'].includes(state.phase)) fail('BAD_PHASE', `cannot commit from ${state.phase}`);
  exact(op, ['signer','generation','resultDigest'], 'commit');
  assertSigner(op.signer, state.worker, 'worker');
  if (!Number.isSafeInteger(op.generation) || op.generation !== state.generation + 1) fail('GENERATION_MISMATCH', `expected generation ${state.generation + 1}`);
  return {...state, phase:'COMMITTED', generation:op.generation, resultDigest:digest(op.resultDigest,'resultDigest'), acceptanceDigest:null};
}

export function acceptDelivery(state, op) {
  live(state); if (state.phase !== 'COMMITTED') fail('BAD_PHASE', `cannot accept from ${state.phase}`);
  exact(op, ['verifiedSignerPubkey','generation','resultDigest','acceptanceDigest'], 'accept');
  if (op.verifiedSignerPubkey !== state.verifierPubkey) fail('VERIFIER_MISMATCH','ed25519 verified signer must equal pinned verifier');
  if (op.generation !== state.generation) fail('GENERATION_MISMATCH','acceptance generation mismatch');
  if (op.resultDigest !== state.resultDigest) fail('RESULT_DIGEST_MISMATCH','acceptance result mismatch');
  return {...state, phase:'ACCEPTED', acceptanceDigest:digest(op.acceptanceDigest,'acceptanceDigest')};
}

export function settleEscrow(state, op) {
  live(state); if (state.phase !== 'ACCEPTED') fail('BAD_PHASE', `cannot settle from ${state.phase}`);
  exact(op, ['payee','amountAtomic','assetProof','settlementRef'], 'settle');
  if (op.payee !== state.worker) fail('PAYEE_MISMATCH','settlement cannot redirect worker payment');
  if (u64(op.amountAtomic,'settle.amountAtomic',{positive:true}).toString() !== state.amountAtomic) fail('AMOUNT_MISMATCH','settlement amount mismatch');
  if (state.asset.kind === 'SOL') {
    if (op.assetProof !== null) fail('BAD_ASSET_PROOF','SOL settlement takes null assetProof');
  } else {
    exact(op.assetProof, ['mint','tokenProgram','sourceOwner','destinationOwner'], 'assetProof');
    if (op.assetProof.mint !== state.asset.mint || op.assetProof.tokenProgram !== state.asset.tokenProgram) fail('ASSET_MISMATCH','mint/token program mismatch');
    if (op.assetProof.sourceOwner !== state.seedDigest) fail('VAULT_OWNER_MISMATCH','settlement source must be this escrow vault');
    if (op.assetProof.destinationOwner !== state.worker) fail('TOKEN_OWNER_MISMATCH','destination token account must be worker-owned');
  }
  return {...state, phase:'SETTLED', settlementRef:text(op.settlementRef,'settlementRef')};
}

export function cancelEscrow(state, op) {
  live(state); if (!['CREATED','FUNDED','COMMITTED'].includes(state.phase)) fail('BAD_PHASE', `cannot cancel from ${state.phase}`);
  exact(op, ['signer','nowUnix','refundPayee'], 'cancel');
  assertSigner(op.signer,state.buyer,'buyer');
  if (unix(op.nowUnix,'nowUnix') <= state.deadlineUnix) fail('DEADLINE_NOT_REACHED','cancellation requires now > deadline');
  if (op.refundPayee !== state.buyer) fail('REFUND_REDIRECT','refund cannot redirect from buyer');
  return {...state, phase:'CANCELLED', settlementRef:`refund:${state.buyer}`};
}

export function settlementMessage(state) {
  if (state.phase !== 'ACCEPTED') fail('BAD_PHASE','settlement message requires ACCEPTED state');
  return sha({domain:'WORKSEAL_SETTLE_V1', seedDigest:state.seedDigest, taskDigest:state.taskDigest, resultDigest:state.resultDigest, acceptanceDigest:state.acceptanceDigest, generation:state.generation, amountAtomic:state.amountAtomic, worker:state.worker, asset:state.asset});
}
