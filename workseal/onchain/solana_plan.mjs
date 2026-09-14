import { settlementMessage } from './reference.mjs';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';

function plan(instruction, accounts, data = {}) {
  return {schema:'workseal-solana-onchain-plan/v1',writePerformed:false,instruction,accounts,data};
}
function tokenProgram(asset) {
  if (asset.kind !== 'SPL') return null;
  if (![TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(asset.tokenProgram)) throw new Error('unsupported token program');
  return asset.tokenProgram;
}

export function makeInitializePlan(config, accounts) {
  return plan('INITIALIZE',{escrowPda:accounts.escrowPda,buyer:config.buyer,systemProgram:SYSTEM_PROGRAM},{taskDigest:config.taskDigest,worker:config.worker,verifierPubkey:config.verifierPubkey,amountAtomic:config.amountAtomic,deadlineUnix:config.deadlineUnix,asset:config.asset});
}
export function makeFundPlan(state, accounts) {
  if (state.phase !== 'CREATED') throw new Error('fund plan requires CREATED state');
  if (state.asset.kind === 'SOL') return plan('FUND_SOL',{escrowPda:accounts.escrowPda,buyer:state.buyer,systemProgram:SYSTEM_PROGRAM},{amountAtomic:state.amountAtomic});
  return plan('FUND_SPL_CHECKED',{escrowPda:accounts.escrowPda,buyer:state.buyer,sourceToken:accounts.sourceToken,vault:accounts.vault,mint:state.asset.mint,tokenProgram:tokenProgram(state.asset)},{amountAtomic:state.amountAtomic,decimals:state.asset.decimals});
}
export function makeCommitPlan(state, accounts, {generation,resultDigest}) {
  if (!['FUNDED','COMMITTED'].includes(state.phase)) throw new Error('commit plan requires FUNDED/COMMITTED state');
  return plan('COMMIT_RESULT',{escrowPda:accounts.escrowPda,worker:state.worker},{generation,resultDigest});
}
export function makeAcceptPlan(state, accounts, {acceptanceDigest}) {
  if (state.phase !== 'COMMITTED') throw new Error('accept plan requires COMMITTED state');
  const messageDigest = settlementMessage({...state,phase:'ACCEPTED',acceptanceDigest});
  return {schema:'workseal-solana-onchain-plan/v1',writePerformed:false,instruction:'ACCEPT_RESULT',accounts:{escrowPda:accounts.escrowPda,instructionsSysvar:accounts.instructionsSysvar},data:{generation:state.generation,resultDigest:state.resultDigest,acceptanceDigest},predecessor:{programId:ED25519_PROGRAM,publicKey:state.verifierPubkey,messageDigest}};
}
export function makeSettlementInstructionPlan(state, accounts) {
  if (!state || state.phase !== 'ACCEPTED') throw new Error('state must be ACCEPTED');
  const messageDigest=settlementMessage(state);
  if (state.asset.kind === 'SOL') return {...plan('SETTLE_SOL',{escrowPda:accounts.escrowPda,worker:state.worker},{amountAtomic:state.amountAtomic}),messageDigest};
  return {...plan('SETTLE_SPL_CHECKED',{escrowPda:accounts.escrowPda,vault:accounts.vault,workerToken:accounts.workerToken,mint:state.asset.mint,tokenProgram:tokenProgram(state.asset)},{amountAtomic:state.amountAtomic,decimals:state.asset.decimals}),messageDigest};
}
export function makeCancelPlan(state, accounts) {
  if (!['CREATED','FUNDED','COMMITTED'].includes(state.phase)) throw new Error('cancel plan unavailable from this phase');
  const base={escrowPda:accounts.escrowPda,buyer:state.buyer};
  if (state.asset.kind==='SOL') return plan('CANCEL_SOL',base,{deadlineUnix:state.deadlineUnix});
  return plan('CANCEL_SPL_CHECKED',{...base,vault:accounts.vault,buyerToken:accounts.buyerToken,mint:state.asset.mint,tokenProgram:tokenProgram(state.asset)},{deadlineUnix:state.deadlineUnix,amountAtomic:state.amountAtomic,decimals:state.asset.decimals});
}
