// MIT. Fund and recover the original selected channel with its accountable funder.
import { requireValue as need, hash, stable, now, id } from '../mpp-charge/storage.mjs';
import { funderConfig, profileKey, streamKey, amount } from './config.mjs';
import { groups, serialChannel, rememberObservation } from './state.mjs';
import { assertOperating } from './receiving.mjs';
import { terminalConsent } from './authority.mjs';
import { loadChannelNative, dependencyRootFor, observeChannel, nativeStore, settlingKey } from './runtime.mjs';
import { prepareChannelCall, transactionFinality, broadcastRetained,
  acquireFinancialMarker, clearFinancialMarker } from './transaction.mjs';
export const fundingActions=Object.freeze(['top_up','close_start','refund']);
const terminal=new Set(['FUNDED','CLOSING','REFUNDED','FAILED','EXPIRED']);
const owner=row=>({kind:'funding',id:row.id});
function selectedAction(action) {
  need(fundingActions.includes(action),'MPP_CHANNEL_FUNDING_ACTION_REQUIRED');return action;
}
function specification(native,row) {
  const config=funderConfig(row.config);
  need(profileKey(config)===row.profileId,'MPP_CHANNEL_ORIGINAL_FUNDER_PROFILE_CHANGED');
  selectedAction(row.action);
  return {channel:config.channel,account:config.funding.account,method:row.action,
    maximumFeeStroops:config.funding.maximumFeeStroops,
    args:row.action==='top_up'?[native.sdk.nativeToScVal(BigInt(amount(row.amountAtomic)),{type:'i128'})]:[]};
}
function usableObservation(action,observation) {
  if(action==='top_up' || action==='close_start')
    need(observation.closeEffectiveAtLedger===null,'MPP_CHANNEL_FUNDING_CHANNEL_CLOSING',409);
  if(action==='refund') {
    need(observation.closeEffectiveAtLedger!==null,'MPP_CHANNEL_REFUND_NOT_STARTED',409);
    need(observation.currentLedger>=observation.closeEffectiveAtLedger,'MPP_CHANNEL_REFUND_LEDGER_NOT_REACHED',409);
    need(BigInt(observation.balanceAtomic)>0n,'MPP_CHANNEL_NO_REMAINING_FUNDS',409);
  }
}
async function save(workspace,row,change) {
  const next={...row,...change,updatedAt:now()};await workspace.put(groups.funding,row.id,next);return next;
}
async function finish(workspace,row,store) {
  if(!terminal.has(row.phase))return row;
  if(row.fundingObservation)await rememberObservation(workspace,row.config.channel,row.fundingObservation,
    {fundingId:row.id,transaction:row.transaction,action:row.action});
  await clearFinancialMarker(store,row.config.channel,owner(row));
  if(!row.finalizedAt)row=await save(workspace,row,{finalizedAt:now()});
  return row;
}
export async function prepareFunding({workspace,profile,fundingId,action,amountAtomic}) {
  id(fundingId);selectedAction(action);
  const config=funderConfig(profile),selectedAmount=action==='top_up'?amount(amountAtomic):null;
  need(action==='top_up' || amountAtomic===undefined || amountAtomic===null,
    'MPP_CHANNEL_FUNDING_ACTION_HAS_NO_AMOUNT');
  return serialChannel(workspace,config.channel,async()=>{
    await assertOperating(workspace,config.channel);
    const previous=await workspace.read(groups.funding,fundingId);
    need(!previous || previous.streamKey===streamKey(config.channel) && previous.action===action,
      'MPP_CHANNEL_FUNDING_ID_ALREADY_USED',409);
    if(previous?.signedXdr) {
      need(previous.amountAtomic===selectedAmount,'MPP_CHANNEL_RESUME_ORIGINAL_FUNDING',409);
      return fundingView(previous);
    }
    need(!previous || ['DRAFT','CANCELLED'].includes(previous.phase),
      'MPP_CHANNEL_RESUME_ORIGINAL_FUNDING',409);
    const native=await loadChannelNative(await dependencyRootFor(workspace,config)),store=nativeStore(workspace,config.channel);
    const other=await store.get(settlingKey(config.channel));
    need(!other || other.fundingId===fundingId,'MPP_CHANNEL_RESUME_ORIGINAL_FINANCIAL_OPERATION',409);
    const observation=await observeChannel(native,config.channel);usableObservation(action,observation);
    const row={schema:'stellar-forge.mpp-channel-funding.v1',id:fundingId,action,phase:'DRAFT',
      streamKey:streamKey(config.channel),config,profileId:profileKey(config),amountAtomic:selectedAmount,observation,
      createdAt:previous?.createdAt ?? now(),updatedAt:now(),
      unsignedHistory:[...(previous?.unsignedHistory ?? []),...(previous?[{phase:previous.phase,action:previous.action,
        amountAtomic:previous.amountAtomic,profileId:previous.profileId,updatedAt:previous.updatedAt}]:[])]};
    await workspace.put('profiles',row.profileId,config);
    await workspace.put(groups.funding,row.id,row);
    await rememberObservation(workspace,config.channel,observation,{fundingId:row.id,action});
    return fundingView(row);
  });
}
async function reconcile(workspace,row,native,store,rpcUrl) {
  const spec=specification(native,row);
  if(terminal.has(row.phase))return finish(workspace,row,store);
  const result=await transactionFinality(native,row,spec,rpcUrl);
  if(result.phase==='SUCCESS') {
    const observation=await observeChannel(native,row.config.channel);
    if(row.action==='close_start')need(observation.closeEffectiveAtLedger!==null,
      'MPP_CHANNEL_REFUND_START_STATE_NOT_RECEIVED',409);
    const phase={top_up:'FUNDED',close_start:'CLOSING',refund:'REFUNDED'}[row.action];
    row=await save(workspace,row,{phase,finality:result.finality,fundingObservation:observation,completedAt:now(),
      receipt:{model:'channel-funding',action:row.action,network:row.config.channel.network,
        channel:row.config.channel.address,transaction:row.transaction,token:row.config.channel.token,
        funder:row.config.channel.funder,
        ...(row.action==='top_up'?{amountAtomic:row.amountAtomic}:{}),
        ...(row.action==='refund'?{amountMode:'remaining-balance-at-execution'}:{}),
        ...(row.action==='close_start'?{observedCloseEffectiveAtLedger:observation.closeEffectiveAtLedger}:{}),
        observedBalanceAtomic:observation.balanceAtomic,observedWithdrawnAtomic:observation.withdrawnAtomic}});
  } else row=await save(workspace,row,result);
  return finish(workspace,row,store);
}
export async function executeFunding({workspace,fundingId,environment=process.env}) {
  const original=await workspace.read(groups.funding,id(fundingId));
  need(original,'MPP_CHANNEL_FUNDING_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await workspace.read(groups.funding,fundingId);
    await assertOperating(workspace,row.config.channel);
    const config=funderConfig(row.config),native=await loadChannelNative(await dependencyRootFor(workspace,config));
    const spec=specification(native,row),store=nativeStore(workspace,config.channel);
    if(terminal.has(row.phase))return fundingView(await finish(workspace,row,store));
    need(row.phase!=='CANCELLED','MPP_CHANNEL_FUNDING_CANCELLED',409);
    if(!row.signedXdr) {
      if(row.phase==='DRAFT') {
        const observation=await observeChannel(native,config.channel);usableObservation(row.action,observation);
        const review={schema:'stellar-forge.mpp-channel-funding-authority.v1',
          fundingId:row.id,action:row.action,profileId:row.profileId,operator:config.funding.operator,
          channel:config.channel,amountAtomic:row.amountAtomic,feeAccount:config.funding.account,
          maximumFeeStroops:config.funding.maximumFeeStroops,observation,
          taskAuthority:'Existing task budgets, purchase limits and expiry stay separately selected.',
          ...(row.action==='refund'?{amountMode:'Transfer the balance remaining when this transaction executes to the selected funder.'}:{}),
          ...(row.action==='close_start'?{effect:'Begin the contract refund waiting period; stop new commitments.'}:{})};
        const label={top_up:'Add funds to the selected channel',close_start:'Start the selected channel refund period',
          refund:'Return the selected channel remaining balance'}[row.action];
        const confirmation=row.action.toUpperCase()+' '+row.id+(row.amountAtomic?' '+row.amountAtomic:'');
        const authority=await terminalConsent(label,review,confirmation);
        row=await save(workspace,row,{phase:'AUTHORIZED',authority:{...authority,review}});
      }
      need(row.phase==='AUTHORIZED' && row.authority?.reviewSha256===hash(stable(row.authority.review)) &&
        row.authority.review.fundingId===row.id && row.authority.review.action===row.action &&
        row.authority.review.profileId===row.profileId && row.authority.review.amountAtomic===row.amountAtomic,
        'MPP_CHANNEL_ORIGINAL_FUNDING_AUTHORITY_REQUIRED');
      await acquireFinancialMarker(store,config.channel,owner(row),
        {action:row.action,authoritySha256:row.authority.reviewSha256});
      const observation=await observeChannel(native,config.channel);usableObservation(row.action,observation);
      const key=native.sdk.Keypair.fromSecret(environment[config.funding.keyEnv] ?? '');
      const transaction=await prepareChannelCall(native,spec,key);
      row=await save(workspace,row,{phase:'SIGNED',signedXdr:transaction.toXDR(),
        transaction:transaction.hash().toString('hex'),feeStroops:transaction.fee,
        expiresAt:new Date(Number(transaction.timeBounds.maxTime)*1000).toISOString(),observation});
    }
    row=await broadcastRetained(native,row,spec,(current,change)=>save(workspace,current,change));
    return fundingView(await reconcile(workspace,row,native,store));
  });
}
export async function reconcileFunding({workspace,fundingId,rpcUrl}) {
  const original=await workspace.read(groups.funding,id(fundingId));
  need(original,'MPP_CHANNEL_FUNDING_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    const row=await workspace.read(groups.funding,fundingId);await assertOperating(workspace,row.config.channel);
    const native=await loadChannelNative(await dependencyRootFor(workspace,row.config));
    return fundingView(await reconcile(workspace,row,native,nativeStore(workspace,row.config.channel),rpcUrl));
  });
}
export async function cancelUnsignedFunding({workspace,fundingId}) {
  const original=await workspace.read(groups.funding,id(fundingId));
  need(original,'MPP_CHANNEL_FUNDING_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await workspace.read(groups.funding,fundingId);await assertOperating(workspace,row.config.channel);
    need(!row.signedXdr && ['DRAFT','AUTHORIZED','CANCELLED'].includes(row.phase),
      'MPP_CHANNEL_SIGNED_FUNDING_REQUIRES_RECONCILIATION',409);
    await clearFinancialMarker(nativeStore(workspace,row.config.channel),row.config.channel,owner(row));
    if(row.phase!=='CANCELLED')row=await save(workspace,row,{phase:'CANCELLED'});
    return fundingView(row);
  });
}
export function fundingView(row) {
  const {signedXdr,...view}=row;return view;
}
