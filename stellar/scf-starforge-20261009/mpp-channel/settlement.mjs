import { dependencyRootFor } from './runtime.mjs';
import { assertOperating } from './receiving.mjs';
// MIT. Collect or close the retained native commitment with one persisted signed Stellar transaction.
import { requireValue as need, hash, stable, now, id } from '../mpp-charge/storage.mjs';
import { merchantConfig, profileKey, streamKey } from './config.mjs';
import { groups, serialChannel, rememberObservation } from './state.mjs';
import { loadChannelNative, observeChannel, nativeStore, merchantCumulativeKey, settlingKey, closedKey,
  outstandingAtomic } from './runtime.mjs';
import { terminalConsent } from './authority.mjs';
import { prepareChannelCall, transactionFinality, broadcastRetained,
  acquireFinancialMarker, clearFinancialMarker } from './transaction.mjs';
const actionOf=row=>row.action ?? 'close';
const terminal=new Set(['SETTLED','COLLECTED','FAILED','EXPIRED']);
const owner=row=>({kind:'merchant',id:row.id});
async function highest(workspace,config,store) {
  const cumulative=await store.get(merchantCumulativeKey(config.channel));
  need(cumulative?.merchantDeliveryId && BigInt(cumulative.amount)>0n, 'MPP_CHANNEL_ACCEPTED_COMMITMENT_REQUIRED',409);
  const delivery=await workspace.read(groups.deliveries,cumulative.merchantDeliveryId);
  need(delivery && delivery.amountAtomic===cumulative.amount &&
    hash(delivery.credentialHeader)===cumulative.credentialSha256 &&
    streamKey(delivery.channel)===streamKey(config.channel),
    'MPP_CHANNEL_ORIGINAL_COMMITMENT_REQUIRED');
  return delivery;
}
async function prepareMerchantTransaction({workspace,profile,settlementId},action) {
  id(settlementId); const config=merchantConfig(profile);
  need(config.settlement, 'MPP_CHANNEL_SETTLEMENT_ACCOUNT_REQUIRED');
  return serialChannel(workspace,config.channel,async()=>{
    await assertOperating(workspace,config.channel);
    const previous=await workspace.read(groups.settlements,settlementId);
    need(!previous || previous.streamKey===streamKey(config.channel) && actionOf(previous)===action, 'MPP_CHANNEL_CLOSE_ID_ALREADY_USED',409);
    if(previous?.signedXdr) return closeView(previous);
    need(!previous || ['DRAFT','CANCELLED'].includes(previous.phase), 'MPP_CHANNEL_RESUME_ORIGINAL_CLOSE',409);
    const native=await loadChannelNative(await dependencyRootFor(workspace,config)), store=nativeStore(workspace,config.channel);
    const closed=await store.get(closedKey(config.channel));
    need(!closed, 'MPP_CHANNEL_ALREADY_CLOSED',409);
    const other=await store.get(settlingKey(config.channel));
    need(!other || other.settlementId===settlementId, 'MPP_CHANNEL_RESUME_ORIGINAL_CLOSE',409);
    const delivery=await highest(workspace,config,store), observation=await observeChannel(native,config.channel);
    if(action==='settle') need(BigInt(outstandingAtomic(observation,delivery.amountAtomic))>0n,
      'MPP_CHANNEL_NO_UNCOLLECTED_COMMITMENT',409);
    const row={schema:action==='close'?'stellar-forge.mpp-channel-close.v1':'stellar-forge.mpp-channel-collection.v1',
      id:settlementId,action,phase:'DRAFT',
      streamKey:streamKey(config.channel),config,profileId:profileKey(config),deliveryId:delivery.id,
      cumulativeAtomic:delivery.amountAtomic,signature:delivery.signature,credentialSha256:hash(delivery.credentialHeader),
      observation,expectedCollectionAtomic:outstandingAtomic(observation,delivery.amountAtomic),createdAt:previous?.createdAt ?? now(),updatedAt:now(),
      unsignedHistory:[...(previous?.unsignedHistory ?? []),...(previous?[{phase:previous.phase,
        cumulativeAtomic:previous.cumulativeAtomic,profileId:previous.profileId,updatedAt:previous.updatedAt}]:[])]};
    await workspace.put('profiles',row.profileId,config);
    await workspace.put(groups.settlements,settlementId,row); return closeView(row);
  });
}
function specification(native,row) {
  const config=merchantConfig(row.config);
  need(config.settlement && profileKey(config)===row.profileId,'MPP_CHANNEL_ORIGINAL_CLOSE_PROFILE_CHANGED');
  need(['close','settle'].includes(actionOf(row)),'MPP_CHANNEL_SETTLEMENT_ACTION_CHANGED');
  return {channel:config.channel,account:config.settlement.account,method:actionOf(row),
    maximumFeeStroops:config.settlement.maximumFeeStroops,
    args:[native.sdk.nativeToScVal(BigInt(row.cumulativeAtomic),{type:'i128'}),
      native.sdk.nativeToScVal(Buffer.from(row.signature,'hex'),{type:'bytes'})]};
}
async function updateClose(workspace,row,change) {
  const next={...row,...change,updatedAt:now()};
  await workspace.put(groups.settlements,row.id,next); return next;
}
async function finishTerminal(workspace,row,store) {
  if(row.phase==='SETTLED') {
    await store.update(closedKey(row.config.channel),current=>{
      if(current) {
        need(current.settlementId===row.id || BigInt(current.amount)>=BigInt(row.cumulativeAtomic),
          'MPP_CHANNEL_CLOSE_OWNER_CHANGED');
        return {op:'noop',result:undefined};
      }
      return {op:'set',value:{closedAt:row.settledAt,txHash:row.transaction,
        amount:row.cumulativeAtomic,settlementId:row.id},result:undefined};
    });
  }
  if(terminal.has(row.phase)) {
    if(row.settlementObservation)await rememberObservation(workspace,row.config.channel,row.settlementObservation,
      {settlementId:row.id,transaction:row.transaction,action:actionOf(row)});
    await clearFinancialMarker(store,row.config.channel,owner(row));
    if(!row.finalizedAt) row=await updateClose(workspace,row,{finalizedAt:now()});
  }
  return row;
}
async function reconcile(workspace,row,native,store,rpcUrl) {
  const spec=specification(native,row);
  if(terminal.has(row.phase))return finishTerminal(workspace,row,store);
  const result=await transactionFinality(native,row,spec,rpcUrl);
  if(result.phase==='SUCCESS') {
    const observation=await observeChannel(native,row.config.channel);
    need((actionOf(row)==='settle' || observation.closeEffectiveAtLedger!==null) &&
      BigInt(observation.withdrawnAtomic)>=BigInt(row.cumulativeAtomic),
      'MPP_CHANNEL_SETTLEMENT_STATE_NOT_RECEIVED',409);
    row=await updateClose(workspace,row,{phase:actionOf(row)==='settle'?'COLLECTED':'SETTLED',
      finality:result.finality,settlementObservation:observation,settledAt:now(),
      receipt:{model:actionOf(row)==='settle'?'channel-collection':'channel-close',
        network:row.config.channel.network,transaction:row.transaction,cumulativeAtomic:row.cumulativeAtomic,
        recipient:row.config.channel.recipient,token:row.config.channel.token}});
  } else row=await updateClose(workspace,row,result);
  return finishTerminal(workspace,row,store);
}
async function executeMerchantTransaction({workspace,settlementId,environment=process.env},action) {
  const original=await workspace.read(groups.settlements,id(settlementId));
  need(original && actionOf(original)===action, 'MPP_CHANNEL_SETTLEMENT_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await workspace.read(groups.settlements,settlementId);
    await assertOperating(workspace,row.config.channel);
    const config=merchantConfig(row.config);
    need(profileKey(config)===row.profileId, 'MPP_CHANNEL_ORIGINAL_CLOSE_PROFILE_CHANGED');
    const native=await loadChannelNative(await dependencyRootFor(workspace,config)), store=nativeStore(workspace,config.channel);
    if(terminal.has(row.phase)) return closeView(await finishTerminal(workspace,row,store));
    need(row.phase!=='CANCELLED', 'MPP_CHANNEL_CLOSE_CANCELLED',409);
    if(!row.signedXdr) {
      const delivery=await highest(workspace,config,store);
      need(delivery.id===row.deliveryId && delivery.amountAtomic===row.cumulativeAtomic &&
        hash(delivery.credentialHeader)===row.credentialSha256,
        'MPP_CHANNEL_PREPARE_CURRENT_COMMITMENT',409);
      if(row.phase==='DRAFT') {
        const pending=(await workspace.list(groups.deliveries)).filter(item=>
          item.streamKey===row.streamKey && item.state!=='COMPLETE').map(item=>({id:item.id,state:item.state}));
        const observation=await observeChannel(native,config.channel);
        const expectedCollectionAtomic=outstandingAtomic(observation,row.cumulativeAtomic);
        if(action==='settle')need(BigInt(expectedCollectionAtomic)>0n,'MPP_CHANNEL_NO_UNCOLLECTED_COMMITMENT',409);
        const review={schema:'stellar-forge.mpp-channel-close-authority.v1',settlementId,action,observation,expectedCollectionAtomic,
          profileId:row.profileId,operator:config.settlement.operator,channel:config.channel,
          deliveryId:row.deliveryId,cumulativeAtomic:row.cumulativeAtomic,credentialSha256:row.credentialSha256,
          feeAccount:config.settlement.account,maximumFeeStroops:config.settlement.maximumFeeStroops,
          pendingDeliveries:pending};
        const authority=await terminalConsent(action==='settle'?'Collect the earned channel commitment':'Close the selected channel commitment',
          review,(action==='settle'?'COLLECT':'CLOSE')+' '+settlementId+' '+row.cumulativeAtomic);
        row=await updateClose(workspace,row,{phase:'AUTHORIZED',authority:{...authority,review}});
      }
      need(row.authority?.reviewSha256===hash(stable(row.authority.review)) &&
        row.authority.review.profileId===row.profileId && row.authority.review.cumulativeAtomic===row.cumulativeAtomic &&
        (row.authority.review.action ?? 'close')===action,
        'MPP_CHANNEL_ORIGINAL_CLOSE_AUTHORITY_REQUIRED');
      await acquireFinancialMarker(store,config.channel,owner(row),{settlingAmount:row.cumulativeAtomic,
        action,authoritySha256:row.authority.reviewSha256});
      const observation=await observeChannel(native,config.channel);
      const remaining=BigInt(outstandingAtomic(observation,row.cumulativeAtomic));
      need(remaining<=BigInt(observation.balanceAtomic),'MPP_CHANNEL_CLOSE_BALANCE_CHANGED',409);
      if(action==='settle')need(remaining>0n,'MPP_CHANNEL_NO_UNCOLLECTED_COMMITMENT',409);
      const key=native.sdk.Keypair.fromSecret(environment[config.settlement.keyEnv] ?? '');
      const prepared=await prepareChannelCall(native,specification(native,row),key);
      row=await updateClose(workspace,row,{phase:'SIGNED',signedXdr:prepared.toXDR(),
        transaction:prepared.hash().toString('hex'),feeStroops:prepared.fee,
        expiresAt:new Date(Number(prepared.timeBounds.maxTime)*1000).toISOString(),observation,
        expectedCollectionAtomic:remaining.toString()});
    }
    row=await broadcastRetained(native,row,specification(native,row),
      (current,change)=>updateClose(workspace,current,change));
    return closeView(await reconcile(workspace,row,native,store));
  });
}
async function reconcileMerchantTransaction({workspace,settlementId,rpcUrl},action) {
  const original=await workspace.read(groups.settlements,id(settlementId));
  need(original && actionOf(original)===action, 'MPP_CHANNEL_SETTLEMENT_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    const row=await workspace.read(groups.settlements,settlementId);
    await assertOperating(workspace,row.config.channel);
    const native=await loadChannelNative(await dependencyRootFor(workspace,row.config)), store=nativeStore(workspace,row.config.channel);
    return closeView(await reconcile(workspace,row,native,store,rpcUrl));
  });
}
async function cancelUnsignedMerchantTransaction({workspace,settlementId},action) {
  const row=await workspace.read(groups.settlements,id(settlementId));
  need(row && actionOf(row)===action, 'MPP_CHANNEL_SETTLEMENT_NOT_FOUND',404);
  return serialChannel(workspace,row.config.channel,async()=>{
    const current=await workspace.read(groups.settlements,settlementId);
    await assertOperating(workspace,current.config.channel);
    need(!current.signedXdr && ['DRAFT','AUTHORIZED','CANCELLED'].includes(current.phase),
      'MPP_CHANNEL_SIGNED_CLOSE_REQUIRES_RECONCILIATION',409);
    await clearFinancialMarker(nativeStore(workspace,row.config.channel),row.config.channel,owner(row));
    return closeView(await updateClose(workspace,current,{phase:'CANCELLED'}));
  });
}
export function closeView(row) {
  const {signedXdr,signature,...rest}=row; return {...rest,action:actionOf(row)};
}

export const prepareClose=input=>prepareMerchantTransaction(input,'close');
export const executeClose=input=>executeMerchantTransaction(input,'close');
export const reconcileClose=input=>reconcileMerchantTransaction(input,'close');
export const cancelUnsignedClose=input=>cancelUnsignedMerchantTransaction(input,'close');
export const prepareCollection=input=>prepareMerchantTransaction(input,'settle');
export const executeCollection=input=>executeMerchantTransaction(input,'settle');
export const reconcileCollection=input=>reconcileMerchantTransaction(input,'settle');
export const cancelUnsignedCollection=input=>cancelUnsignedMerchantTransaction(input,'settle');
