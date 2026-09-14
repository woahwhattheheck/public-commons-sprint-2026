import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  OnchainModelError, escrowSeedDigest, createEscrow, fundEscrow, commitDelivery,
  acceptDelivery, settleEscrow, cancelEscrow, settlementMessage,
} from '../onchain/reference.mjs';
import { makeSettlementInstructionPlan, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../onchain/solana_plan.mjs';

const D = (s) => createHash('sha256').update(s).digest('hex');
const BUYER='Buyr111111111111111111111111111111111111111';
const WORKER='Workr11111111111111111111111111111111111111';
const VERIFIER='Verif1111111111111111111111111111111111111';
const PROGRAM='Prog11111111111111111111111111111111111111';
const MINT='Mint11111111111111111111111111111111111111';
const key=(x)=>x.padEnd(44,'1');

function config(kind='SOL', tokenProgram=null) {
  return {programId:PROGRAM,taskDigest:D('task'),buyer:BUYER,worker:WORKER,verifierPubkey:VERIFIER,amountAtomic:'25000000',deadlineUnix:200,
    asset: kind==='SOL'?{kind:'SOL',mint:null,decimals:9,tokenProgram:null}:{kind:'SPL',mint:MINT,decimals:6,tokenProgram}};
}
function accepted(kind='SOL', tokenProgram=null) {
  let s=createEscrow(config(kind,tokenProgram));
  const proof=kind==='SOL'?null:{mint:MINT,tokenProgram,sourceOwner:BUYER,destinationOwner:s.seedDigest};
  s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:proof});
  s=commitDelivery(s,{signer:WORKER,generation:1,resultDigest:D('result1')});
  s=acceptDelivery(s,{verifiedSignerPubkey:VERIFIER,generation:1,resultDigest:D('result1'),acceptanceDigest:D('signed-acceptance')});
  return s;
}
function err(code, fn){ assert.throws(fn,(e)=>e instanceof OnchainModelError && e.code===code); }

test('seed identity binds program task and buyer',()=>{
  const a=escrowSeedDigest(config());
  assert.notEqual(a,escrowSeedDigest({...config(),taskDigest:D('other')}));
  assert.notEqual(a,escrowSeedDigest({...config(),buyer:key('ByerAxt')}));
});

test('SOL happy path is one-way and exact-payee',()=>{
  let s=accepted(); const msg=settlementMessage(s);
  assert.equal(msg.length,64);
  s=settleEscrow(s,{payee:WORKER,amountAtomic:'25000000',assetProof:null,settlementRef:'sig:abc'});
  assert.equal(s.phase,'SETTLED');
  err('TERMINAL',()=>settleEscrow(s,{payee:WORKER,amountAtomic:'25000000',assetProof:null,settlementRef:'sig:again'}));
});

test('wrong signer cannot fund or commit; accepted settlement is permissionless but non-redirectable',()=>{
  let s=createEscrow(config());
  err('WRONG_SIGNER',()=>fundEscrow(s,{signer:WORKER,amountAtomic:'25000000',assetProof:null}));
  s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:null});
  err('WRONG_SIGNER',()=>commitDelivery(s,{signer:BUYER,generation:1,resultDigest:D('r')}));
  let a=commitDelivery(s,{signer:WORKER,generation:1,resultDigest:D('r')});
  a=acceptDelivery(a,{verifiedSignerPubkey:VERIFIER,generation:1,resultDigest:D('r'),acceptanceDigest:D('a')});
  const done=settleEscrow(a,{payee:WORKER,amountAtomic:'25000000',assetProof:null,settlementRef:'permissionless:ok'});
  assert.equal(done.phase,'SETTLED');
});

test('new committed generation invalidates old acceptance',()=>{
  let s=createEscrow(config()); s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:null});
  s=commitDelivery(s,{signer:WORKER,generation:1,resultDigest:D('r1')});
  s=commitDelivery(s,{signer:WORKER,generation:2,resultDigest:D('r2')});
  err('GENERATION_MISMATCH',()=>acceptDelivery(s,{verifiedSignerPubkey:VERIFIER,generation:1,resultDigest:D('r1'),acceptanceDigest:D('old')}));
  err('RESULT_DIGEST_MISMATCH',()=>acceptDelivery(s,{verifiedSignerPubkey:VERIFIER,generation:2,resultDigest:D('r1'),acceptanceDigest:D('old')}));
});

test('only pinned verifier can accept',()=>{
  let s=createEscrow(config()); s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:null}); s=commitDelivery(s,{signer:WORKER,generation:1,resultDigest:D('r')});
  err('VERIFIER_MISMATCH',()=>acceptDelivery(s,{verifiedSignerPubkey:key('WrongVerifier'),generation:1,resultDigest:D('r'),acceptanceDigest:D('a')}));
});

test('accepted state cannot cancel and pre-accept cancel is deadline gated',()=>{
  let s=createEscrow(config()); s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:null});
  err('DEADLINE_NOT_REACHED',()=>cancelEscrow(s,{signer:BUYER,nowUnix:200,refundPayee:BUYER}));
  err('REFUND_REDIRECT',()=>cancelEscrow(s,{signer:BUYER,nowUnix:201,refundPayee:WORKER}));
  const cancelled=cancelEscrow(s,{signer:BUYER,nowUnix:201,refundPayee:BUYER}); assert.equal(cancelled.phase,'CANCELLED');
  let a=accepted(); err('BAD_PHASE',()=>cancelEscrow(a,{signer:BUYER,nowUnix:999,refundPayee:BUYER}));
});

test('SPL funding and settlement bind mint program and owners',()=>{
  let s=createEscrow(config('SPL',TOKEN_PROGRAM));
  err('ASSET_MISMATCH',()=>fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:{mint:key('BadMint'),tokenProgram:TOKEN_PROGRAM,sourceOwner:BUYER,destinationOwner:s.seedDigest}}));
  s=fundEscrow(s,{signer:BUYER,amountAtomic:'25000000',assetProof:{mint:MINT,tokenProgram:TOKEN_PROGRAM,sourceOwner:BUYER,destinationOwner:s.seedDigest}});
  s=commitDelivery(s,{signer:WORKER,generation:1,resultDigest:D('r')}); s=acceptDelivery(s,{verifiedSignerPubkey:VERIFIER,generation:1,resultDigest:D('r'),acceptanceDigest:D('a')});
  err('TOKEN_OWNER_MISMATCH',()=>settleEscrow(s,{payee:WORKER,amountAtomic:'25000000',assetProof:{mint:MINT,tokenProgram:TOKEN_PROGRAM,sourceOwner:s.seedDigest,destinationOwner:BUYER},settlementRef:'x'}));
  const done=settleEscrow(s,{payee:WORKER,amountAtomic:'25000000',assetProof:{mint:MINT,tokenProgram:TOKEN_PROGRAM,sourceOwner:s.seedDigest,destinationOwner:WORKER},settlementRef:'sig:spl'});
  assert.equal(done.phase,'SETTLED');
});

test('Token-2022 plan is explicit and performs no write',()=>{
  const s=accepted('SPL',TOKEN_2022_PROGRAM);
  const plan=makeSettlementInstructionPlan(s,{escrowPda:key('EscrowPda'),vault:key('Vault'),workerToken:key('WorkerToken')});
  assert.equal(plan.writePerformed,false); assert.equal(plan.instruction,'SETTLE_SPL_CHECKED'); assert.equal(plan.accounts.tokenProgram,TOKEN_2022_PROGRAM);
  assert.equal(plan.data.decimals,6);
});

test('payee redirect, amount mismatch and u64 overflow fail closed',()=>{
  const s=accepted();
  err('PAYEE_MISMATCH',()=>settleEscrow(s,{payee:BUYER,amountAtomic:'25000000',assetProof:null,settlementRef:'x'}));
  err('AMOUNT_MISMATCH',()=>settleEscrow(s,{payee:WORKER,amountAtomic:'1',assetProof:null,settlementRef:'x'}));
  assert.throws(()=>createEscrow({...config(),amountAtomic:(1n<<64n).toString()}),/u64/);
});

test('unknown fields fail closed',()=>{
  assert.throws(()=>createEscrow({...config(),surprise:true}),e=>e.code==='UNKNOWN_FIELD');
});

test('client lifecycle plans remain write-free and expose required authority accounts',async()=>{
  const p=await import('../onchain/solana_plan.mjs');
  const c=config(); const init=p.makeInitializePlan(c,{escrowPda:key('EscrowPda')}); assert.equal(init.writePerformed,false); assert.equal(init.instruction,'INITIALIZE');
  const created=createEscrow(c); const fund=p.makeFundPlan(created,{escrowPda:key('EscrowPda')}); assert.equal(fund.instruction,'FUND_SOL');
  const funded=fundEscrow(created,{signer:BUYER,amountAtomic:'25000000',assetProof:null}); const commit=p.makeCommitPlan(funded,{escrowPda:key('EscrowPda')},{generation:1,resultDigest:D('r')}); assert.equal(commit.accounts.worker,WORKER);
  const committed=commitDelivery(funded,{signer:WORKER,generation:1,resultDigest:D('r')}); const accept=p.makeAcceptPlan(committed,{escrowPda:key('EscrowPda'),instructionsSysvar:key('IxSysvar')},{acceptanceDigest:D('a')}); assert.equal(accept.predecessor.publicKey,VERIFIER); assert.equal(accept.writePerformed,false);
  const acceptedState=acceptDelivery(committed,{verifiedSignerPubkey:VERIFIER,generation:1,resultDigest:D('r'),acceptanceDigest:D('a')}); const settle=p.makeSettlementInstructionPlan(acceptedState,{escrowPda:key('EscrowPda')}); assert.equal(settle.instruction,'SETTLE_SOL'); assert.equal(settle.writePerformed,false);
});
