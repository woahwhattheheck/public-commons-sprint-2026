// MIT. Reviewed native MPP pull payment; one durable SF36 reservation and one retained signed credential.
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { checkOperatorTerminal } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { buyerConfig, reviewChallenge, requestBytes, bindingFacts, clone } from './config.mjs';
import { hash, stable, requireValue, now, id } from './storage.mjs';
import { loadNative } from './runtime.mjs';
import { responseRecord } from './merchant.mjs';
import { transactionIdentity } from './transfer.mjs';
import { operatorAction } from './operator.mjs';

export function purchaseView(row) {
  if(!row) return null;
  return {id:row.id,phase:row.phase,createdAt:row.createdAt,updatedAt:row.updatedAt,
    request:row.intent?.request,challenge:row.challenge,approval:row.approval,
    payer:row.payer,transaction:row.transaction,feeStroops:row.feeStroops,
    receipt:row.receipt,receiptError:row.receiptError,finality:row.finality,lastError:row.lastError,
    response:row.response?{status:row.response.status,headers:row.response.headers,bytes:row.response.bytes,sha256:row.response.sha256}:null};
}
function transport(profile) {
  return createPublicHttpsFetch({timeoutMs:300000,paymentAuthorization:true,trustedProxy:profile.transport??null});
}
function fetchOptions(profile,credential) {
  const body=requestBytes(profile.request),headers={};
  if(body!==null) headers['content-type']='application/json';
  if(credential) headers.authorization=credential;
  return {method:profile.request.method,headers,...(body===null?{}:{body}),redirect:'manual'};
}
const busy=new Set();
async function owned(key,fn) {
  requireValue(!busy.has(key),'MPP_PURCHASE_RUNNING',409); busy.add(key);
  try{return await fn();} finally{busy.delete(key);}
}
export async function preparePurchase({workspace,profile,challengeId}) {
  profile=buyerConfig(profile);
  return owned(profile.intentId,async()=>{
    requireValue(!await workspace.read('purchases',profile.intentId),'MPP_PURCHASE_ID_ALREADY_EXISTS',409);
    const native=await loadNative(profile.dependencyRoot);
    const response=await transport(profile)(profile.request.url,fetchOptions(profile));
    requireValue(response.status===402,'MPP_NATIVE_CHALLENGE_REQUIRED',409);
    const challenges=native.Challenge.fromResponseList(response);
    const matching=challenges.filter(challenge=>{
      if(challengeId!==undefined && challenge.id!==challengeId) return false;
      try{reviewChallenge(challenge,profile);return true;}catch{return false;}
    });
    requireValue(matching.length===1,'MPP_ONE_EXACT_REVIEWED_CHALLENGE_REQUIRED',409);
    const challenge=reviewChallenge(matching[0],profile), captured=await responseRecord(response);
    const intent={schema:'stellar-forge.mpp-intent.v1',intentId:profile.intentId,
      request:bindingFacts(profile.request),
      acceptedTerms:{challenge,maxFeeStroops:profile.expect.maxFeeStroops},
      maxTimeoutSeconds:Math.max(1,Math.floor((Date.parse(challenge.expires)-Date.now())/1000))};
    const row={schema:'stellar-forge.mpp-purchase.v1',id:profile.intentId,phase:'REVIEW_READY',
      profile,profileId:hash(stable(profile)),challenge,intent,captured,createdAt:now(),updatedAt:now()};
    await workspace.put('purchases',row.id,row);
    return purchaseView(row);
  });
}
async function finality(workspace,row,environment) {
  requireValue(row.approval && row.transaction,'MPP_APPROVED_TRANSACTION_REQUIRED',409);
  const result=await operatorAction('finalize',{
    operator:row.profile.operator,intent:row.intent,approval:row.approval,payer:row.payer,
    transaction:row.transaction,dependencyRoot:row.profile.dependencyRoot,
    ...(row.profile.rpcUrl?{rpcEndpoint:row.profile.rpcUrl}:{})
  },environment);
  row={...row,finality:result,updatedAt:now()};
  await workspace.put('purchases',row.id,row);
  return row;
}
export async function finalizePurchase({workspace,purchaseId,environment=process.env}) {
  return owned(id(purchaseId),async()=>{
    const row=await workspace.read('purchases',purchaseId);
    requireValue(row,'MPP_PURCHASE_NOT_FOUND',404);
    return purchaseView(await finality(workspace,row,environment));
  });
}
export async function executePurchase({workspace,purchaseId,environment=process.env,resume=false}) {
  return owned(id(purchaseId),async()=>{
    let row=await workspace.read('purchases',purchaseId);
    requireValue(row,'MPP_PURCHASE_NOT_FOUND',404);
    const profile=buyerConfig(row.profile), native=await loadNative(profile.dependencyRoot);
    requireValue(hash(stable(profile))===row.profileId &&
      stable(bindingFacts(profile.request))===stable(row.intent.request),'MPP_FROZEN_PURCHASE_CHANGED',409);
    const save=async change=>{row={...row,...change,updatedAt:now()};await workspace.put('purchases',row.id,row);};
    try {
      if(!row.credentialHeader) {
        requireValue(['REVIEW_READY','RESERVING','RESERVED','SIGNING'].includes(row.phase),
          'MPP_RETAINED_SIGNED_CREDENTIAL_REQUIRED',409);
        reviewChallenge(row.challenge,profile);
        const keypair=native.sdk.Keypair.fromSecret(environment[profile.signer.keyEnv]??'');
        requireValue(keypair.publicKey()===profile.signer.payer,'MPP_CONFIGURED_PAYER_MISMATCH');
        // Check all signer/runtime/transport configuration before a reservation.
        const fetchImpl=transport(profile); void fetchImpl;
        if(row.phase==='RESERVING') {
          const recovered=await operatorAction('inspect',{operator:profile.operator,intent:row.intent},environment);
          if(recovered.outcome!=='UNRESERVED') await save({approval:recovered,phase:'RESERVED'});
          else await save({phase:'REVIEW_READY'});
        }
        if(row.phase==='REVIEW_READY') {
          await checkOperatorTerminal(row.id);
          await save({phase:'RESERVING',lastError:null});
          const approved=await operatorAction('approve',{operator:profile.operator,intent:row.intent},environment);
          requireValue(approved.outcome==='FRESH_RESERVATION_APPROVED','MPP_FRESH_RESERVATION_REQUIRED');
          await save({phase:'RESERVED',approval:approved});
        }
        requireValue(row.approval?.request_id===row.id &&
          row.approval.reserved_atomic_units===row.challenge.request.amount,'MPP_ORIGINAL_RESERVATION_REQUIRED');
        reviewChallenge(row.challenge,profile);
        await save({phase:'SIGNING'});
        const client=native.stellarClient.stellar.charge({keypair,mode:'pull',decimals:profile.expect.decimals,
          ...(profile.rpcUrl?{rpcUrl:profile.rpcUrl}:{})});
        const credentialHeader=await client.createCredential({challenge:clone(row.challenge),context:{mode:'pull'}});
        const credential=native.Credential.deserialize(credentialHeader);
        requireValue(native.Challenge.serialize(credential.challenge)===native.Challenge.serialize(row.challenge),'MPP_SIGNED_CHALLENGE_CHANGED');
        const identity=transactionIdentity(native,credential);
        requireValue(identity.payer===profile.signer.payer && BigInt(identity.feeStroops)<=BigInt(profile.expect.maxFeeStroops),
          'MPP_NETWORK_FEE_OR_PAYER_LIMIT');
        await save({phase:'SIGNED',credentialHeader,...identity});
      } else {
        requireValue(resume,'MPP_USE_RESUME_FOR_RETAINED_CREDENTIAL',409);
        const identity=transactionIdentity(native,native.Credential.deserialize(row.credentialHeader));
        requireValue(identity.transaction===row.transaction && identity.payer===row.payer,'MPP_RETAINED_TRANSACTION_CHANGED');
        if(row.response?.status>=200 && row.response.status<300 && row.response.status!==202 && row.receipt) return purchaseView(row);
      }
      await save({phase:'SENDING',lastError:null,sendAttempts:(row.sendAttempts??0)+1});
      const response=await transport(profile)(profile.request.url,fetchOptions(profile,row.credentialHeader));
      let receipt=null,receiptError=null;
      if(response.headers.has('payment-receipt')) {
        try {
          receipt=native.Receipt.fromResponse(response);
          requireValue(receipt.method==='stellar' && receipt.status==='success' &&
            receipt.reference.toLowerCase()===row.transaction,'MPP_RECEIPT_TRANSACTION_MISMATCH');
        } catch(error){receipt=null;receiptError=error.code??'MPP_INVALID_RECEIPT';}
      }
      const saved=await responseRecord(response);
      await save({phase:'RESPONSE_SAVED',response:saved,receipt,receiptError});
      try {row=await finality(workspace,row,environment);}
      catch(error) {await save({finality:{outcome:'PENDING',reason:error.code??'MPP_FINALITY_OBSERVER_FAILED'}});}
      return purchaseView(row);
    } catch(error) {
      await save({lastError:error.code??'MPP_PURCHASE_EXECUTION_FAILED'});
      throw error;
    }
  });
}
