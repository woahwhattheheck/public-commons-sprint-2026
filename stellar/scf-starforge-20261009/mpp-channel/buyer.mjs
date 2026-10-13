import { dependencyRootFor } from './runtime.mjs';
import { assertOperating } from './receiving.mjs';
// MIT. One task reservation, one cumulative commitment and the original response across retries.
import { channelFetch } from './transport.mjs';
import { requestBytes, bindingFacts } from '../mpp-charge/config.mjs';
import { responseRecord, storedResponse } from '../mpp-charge/merchant.mjs';
import { requireValue as need, hash, stable, now, id } from '../mpp-charge/storage.mjs';
import { taskConfig, taskRequest, reviewChallenge, amount, profileKey } from './config.mjs';
import { loadChannelNative, observeChannel, assertFreshCommitment, nativeStore, clientCumulativeKey } from './runtime.mjs';
import { groups, readTask, serialChannel, reservePurchase, markSigned, completePurchase, purchaseView } from './state.mjs';
function options(request,credential) {
  const body=requestBytes(request), headers={};
  if(body !== null) headers['content-type']='application/json';
  if(credential) headers.authorization=credential;
  return {method:request.method,headers,...(body===null?{}:{body}),redirect:'manual'};
}
async function challengeFor(native,config,request,workspace) {
  const response=await channelFetch(workspace,config,request.url,options(request));
  need(response.status===402, 'MPP_CHANNEL_NATIVE_CHALLENGE_REQUIRED',409);
  const candidates=native.Challenge.fromResponseList(response).filter(item=>{
    try { reviewChallenge(item,config); return true; } catch { return false; }
  });
  need(candidates.length===1, 'MPP_CHANNEL_ONE_SELECTED_CHALLENGE_REQUIRED',409);
  const challenge=reviewChallenge(candidates[0],config);
  const meta=challenge.opaque ? JSON.parse(Buffer.from(challenge.opaque,'base64url').toString('utf8')) : challenge.meta;
  const expectedScope=hash(stable({schema:'stellar-forge.mpp-channel-scope.v1',
    profileId:config.merchantProfileSha256,route:config.offerId,sourceSha256:config.source.sha256,
    ...bindingFacts(request)}));
  need(meta?._mppx_scope===expectedScope && challenge.request.externalId===expectedScope,
    'MPP_CHANNEL_SELECTED_SOURCE_OR_REQUEST_CHANGED');
  return {challenge,challengeResponse:await responseRecord(response)};
}
export async function preparePurchase({workspace,taskId,purchaseId,request}) {
  id(purchaseId); const task=await readTask(workspace,taskId);
  return serialChannel(workspace,task.config.channel,async()=>{
    await assertOperating(workspace,task.config.channel);
    const current=await readTask(workspace,taskId), selected=taskRequest(current.config,request);
    const existing=await workspace.read(groups.purchases,purchaseId);
    if(existing) {
      need(existing.taskId===taskId && stable(existing.request)===stable(selected),
        'MPP_CHANNEL_PURCHASE_ID_ALREADY_USED',409);
      return purchaseView(existing);
    }
    const native=await loadChannelNative(await dependencyRootFor(workspace,current.config));
    const captured=await challengeFor(native,current.config,selected,workspace);
    const facts=bindingFacts(selected);
    const row={schema:'stellar-forge.mpp-channel-purchase.v1',id:purchaseId,taskId,
      phase:'READY',profileId:current.profileId,config:current.config,request:selected,
      requestFacts:facts,requestSha256:hash(stable(facts)),...captured,
      createdAt:now(),updatedAt:now(),challengeHistory:[]};
    await workspace.put(groups.purchases,purchaseId,row);
    return purchaseView(row);
  });
}
export async function executePurchase({workspace,purchaseId,environment=process.env,resume=false}) {
  id(purchaseId); const original=await workspace.read(groups.purchases,purchaseId);
  need(original, 'MPP_CHANNEL_PURCHASE_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await workspace.read(groups.purchases,purchaseId);
    const config=taskConfig(row.config);
    need(profileKey(config)===row.profileId &&
      hash(stable(bindingFacts(row.request)))===row.requestSha256, 'MPP_CHANNEL_FROZEN_PURCHASE_CHANGED');
    const native=await loadChannelNative(await dependencyRootFor(workspace,config)), store=nativeStore(workspace,config.channel);
    const save=async change=>{row={...row,...change,updatedAt:now()};await workspace.put(groups.purchases,row.id,row);};
    await assertOperating(workspace,config.channel);
    if(row.phase==='COMPLETE') { await completePurchase(workspace,config.channel,row); return purchaseView(row); }
    need(!['CANCELLING','CANCELLED'].includes(row.phase), 'MPP_CHANNEL_PURCHASE_CANCELLED',409);
    need(!row.credentialHeader || resume, 'MPP_CHANNEL_USE_ORIGINAL_RESUME',409);
    try {
      if(!row.reservation) {
        const task=await readTask(workspace,row.taskId);
        need(task.profileId===row.profileId, 'MPP_CHANNEL_PREPARE_CURRENT_TASK_EDITION',409);
        reviewChallenge(row.challenge,config);
        const reservation=await reservePurchase(workspace,task,row);
        await save({phase:'RESERVED',reservation,authority:task.authority});
      }
      if(!row.credentialHeader) {
        reviewChallenge(row.challenge,config,{fresh:row.phase!=='SIGNING'});
        const observation=await observeChannel(native,config.channel);
        assertFreshCommitment(observation,row.reservation.cumulativeAtomic,row.reservation.amountAtomic);
        const key=native.sdk.Keypair.fromSecret(environment[config.signer.keyEnv] ?? '');
        need(key.publicKey()===config.channel.commitmentKey, 'MPP_CHANNEL_COMMITMENT_SIGNER_MISMATCH');
        const stored=await store.get(clientCumulativeKey(config.channel));
        need([row.reservation.previousAtomic,row.reservation.cumulativeAtomic].includes(stored?.amount ?? '0'),
          'MPP_CHANNEL_SIGNED_BASELINE_NEEDS_RECOVERY',409);
        await save({phase:'SIGNING',observation});
        const method=native.channelClient.stellar.channel({
          commitmentKey:key,allowedChannels:[config.channel.address],network:config.channel.network,
          rpcUrl:config.channel.rpcUrl,store
        });
        // The explicit original target also recovers a crash after the SDK's durable put.
        const header=await method.createCredential({challenge:row.challenge,
          context:{action:'voucher',cumulativeAmount:row.reservation.cumulativeAtomic}});
        const credential=native.Credential.deserialize(header);
        need(stable(credential.challenge)===stable(row.challenge) &&
          credential.payload.action==='voucher' &&
          amount(credential.payload.amount)===row.reservation.cumulativeAtomic,
          'MPP_CHANNEL_NATIVE_CREDENTIAL_MISMATCH');
        await save({phase:'SIGNED',credentialHeader:header,credentialSha256:hash(header),
          signature:credential.payload.signature});
      }
      const retained=native.Credential.deserialize(row.credentialHeader);
      need(hash(row.credentialHeader)===row.credentialSha256 &&
        stable(retained.challenge)===stable(row.challenge) &&
        retained.payload.amount===row.reservation.cumulativeAtomic, 'MPP_CHANNEL_RETAINED_CREDENTIAL_CHANGED');
      await markSigned(workspace,config.channel,row.reservation);
      await save({phase:'SENDING',attempts:(row.attempts ?? 0)+1});
      const response=await channelFetch(workspace,config,row.request.url,options(row.request,row.credentialHeader));
      const saved=await responseRecord(response);
      let receipt=null;
      try { receipt=native.Receipt.fromResponse(storedResponse(saved)); } catch {}
      const reference=row.challenge.request.methodDetails?.reference ?? row.challenge.id;
      const accepted=receipt?.method==='stellar' && receipt.status==='success' && receipt.reference===reference;
      if(response.status===402) {
        await save({phase:'CHALLENGE_REJECTED',lastResponse:saved,receiptError:null});
        return purchaseView(row);
      }
      if(!accepted) {
        await save({phase:'AWAITING_ORIGINAL_RESPONSE',lastResponse:saved,
          receiptError:'MPP_CHANNEL_ORIGINAL_COMMITMENT_RECEIPT_REQUIRED'});
        return purchaseView(row);
      }
      if(response.status<200 || response.status>=300 || response.status===202) {
        await save({phase:'AWAITING_DELIVERY',lastResponse:saved,receipt});
        return purchaseView(row);
      }
      await save({phase:'COMPLETE',response:saved,receipt,receiptError:null,completedAt:now()});
      await completePurchase(workspace,config.channel,row);
      return purchaseView(row);
    } catch(error) {
      await save({lastError:error.code ?? 'MPP_CHANNEL_PURCHASE_FAILED'});
      throw error;
    }
  });
}
export async function refreshChallenge({workspace,purchaseId}) {
  const original=await workspace.read(groups.purchases,id(purchaseId));
  need(original, 'MPP_CHANNEL_PURCHASE_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    const row=await workspace.read(groups.purchases,purchaseId);
    await assertOperating(workspace,row.config.channel);
    need(!['CANCELLING','CANCELLED','COMPLETE'].includes(row.phase) && (row.phase==='CHALLENGE_REJECTED' || !row.credentialHeader), 'MPP_CHANNEL_RESUME_ORIGINAL_RESPONSE',409);
    const native=await loadChannelNative(await dependencyRootFor(workspace,row.config));
    const captured=await challengeFor(native,row.config,row.request,workspace);
    need(captured.challenge.request.amount===row.challenge.request.amount,
      'MPP_CHANNEL_ORIGINAL_RESERVED_UNIT_CHANGED',409);
    if(row.reservation) {
      need(BigInt(captured.challenge.request.methodDetails?.cumulativeAmount ?? '0')===
        BigInt(row.reservation.previousAtomic), 'MPP_CHANNEL_MERCHANT_ALREADY_ADVANCED_USE_ORIGINAL_RECOVERY',409);
    }
    const next={...row,...captured,phase:row.reservation?'RESERVED':'READY',credentialHeader:null,
      credentialSha256:null,signature:null,updatedAt:now(),
      challengeHistory:[...row.challengeHistory,{challenge:row.challenge,
        credentialHeader:row.credentialHeader ?? null,credentialSha256:row.credentialSha256 ?? null,
        lastResponse:row.lastResponse ?? null}]};
    await workspace.put(groups.purchases,purchaseId,next); return purchaseView(next);
  });
}
export async function responseFor({workspace,purchaseId}) {
  const row=await workspace.read(groups.purchases,id(purchaseId));
  need(row?.response, 'MPP_CHANNEL_RESPONSE_UNAVAILABLE',404); return storedResponse(row.response);
}

export async function cancelPurchase({workspace,purchaseId}) {
  const original=await workspace.read(groups.purchases,id(purchaseId));
  need(original, 'MPP_CHANNEL_PURCHASE_NOT_FOUND',404);
  return serialChannel(workspace,original.config.channel,async()=>{
    let row=await workspace.read(groups.purchases,purchaseId);
    await assertOperating(workspace,row.config.channel);
    if(row.phase==='CANCELLED') return purchaseView(row);
    need(!row.credentialHeader && !row.challengeHistory.some(item=>item.credentialHeader),
      'MPP_CHANNEL_SIGNED_PURCHASE_REQUIRES_ORIGINAL_RECOVERY',409);
    if(row.reservation) {
      const store=nativeStore(workspace,row.config.channel), signed=await store.get(clientCumulativeKey(row.config.channel));
      const signedAmount=signed?.amount ?? '0';
      const {streamKey}=await import('./config.mjs');
      const originalStream=await workspace.read(groups.streams,streamKey(row.config.channel));
      const alreadyCancelled=Object.hasOwn(originalStream?.cancelledPurchases ?? {},row.id);
      need(alreadyCancelled || (signedAmount===row.reservation.previousAtomic &&
        originalStream?.activePurchase?.purchaseId===row.id && originalStream.highestSignedAtomic===row.reservation.previousAtomic),
        'MPP_CHANNEL_SIGNED_PURCHASE_REQUIRES_ORIGINAL_RECOVERY',409);
      row={...row,phase:'CANCELLING',updatedAt:now()}; await workspace.put(groups.purchases,row.id,row);
      await workspace.update(groups.streams,streamKey(row.config.channel),stream=>{
        if(Object.hasOwn(stream?.cancelledPurchases ?? {},row.id)) return {op:'noop',result:undefined};
        need(signedAmount===row.reservation.previousAtomic && stream?.activePurchase?.purchaseId===row.id &&
          stream.highestSignedAtomic===row.reservation.previousAtomic, 'MPP_CHANNEL_SIGNED_PURCHASE_REQUIRES_ORIGINAL_RECOVERY',409);
        const budget=stream.budgets[row.taskId];
        const next={...stream,activePurchase:null,revision:stream.revision+1,updatedAt:now(),
          cancelledPurchases:{...stream.cancelledPurchases,[row.id]:{taskId:row.taskId,amountAtomic:row.reservation.amountAtomic,cancelledAt:now()}},
          budgets:{...stream.budgets,[row.taskId]:{...budget,
            committedAtomic:(BigInt(budget.committedAtomic)-BigInt(row.reservation.amountAtomic)).toString(),
            purchases:budget.purchases-1}}};
        return {op:'set',value:next,result:undefined};
      });
    }
    row={...row,phase:'CANCELLED',cancelledAt:now(),updatedAt:now()};
    await workspace.put(groups.purchases,row.id,row);return purchaseView(row);
  });
}
