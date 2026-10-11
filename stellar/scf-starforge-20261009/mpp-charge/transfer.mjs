// MIT. Native MPP transaction identity and original SF86 observation.
import { parseSep41TransferAmount } from '../sf43-agent-commerce/verify.mjs';
import { reconcilePaymentAttempt } from '../sf86-rpc-transfer-reconcile/verify.mjs';
import { NETWORKS, resolveRpcEndpoint, validStrKey } from '../sf86-rpc-transfer-reconcile/terms.mjs';
import { requireValue } from './storage.mjs';
export function transactionIdentity(native,credential) {
  const network=credential.challenge.request.methodDetails.network;
  const payer=credential.source?.slice(('did:pkh:'+network+':').length);
  requireValue(credential.source === 'did:pkh:'+network+':'+payer && validStrKey(payer,'G'),'MPP_CREDENTIAL_PAYER_INVALID');
  requireValue(credential.payload?.type === 'transaction' && !credential.challenge.request.methodDetails.feePayer,'MPP_UNSPONSORED_PULL_REQUIRED');
  const tx=native.sdk.TransactionBuilder.fromXDR(credential.payload.transaction,NETWORKS[network].passphrase);
  requireValue(tx instanceof native.sdk.Transaction && tx.source === payer && tx.operations.length === 1,'MPP_TRANSACTION_SOURCE_INVALID');
  return {payer,transaction:tx.hash().toString('hex'),feeStroops:String(tx.fee)};
}
export function transferRequirement(challenge) {
  const q=challenge.request;
  return {scheme:'exact',network:q.methodDetails.network,asset:q.currency,payTo:q.recipient,amount:q.amount};
}
export function eventDecoder(native) {
  const decode=value=>native.sdk.scValToNative(native.sdk.xdr.ScVal.fromXDR(value,'base64'));
  return async event=>{
    if(!Array.isArray(event.topic) || event.topic.length < 3 || !event.value) return null;
    const [name,from,to]=event.topic.slice(0,3).map(decode);
    if(name !== 'transfer') return null;
    const amount=parseSep41TransferAmount(decode(event.value));
    return amount === null ? null : {name,from:String(from),to:String(to),amount};
  };
}
export async function observeTransfer({native,challenge,intentId,payer,transaction,rpcEndpoint}) {
  return reconcilePaymentAttempt({intentId,requirement:transferRequirement(challenge),payer,transaction,
    receipt:null,rpcEndpoint:resolveRpcEndpoint(challenge.request.methodDetails.network,rpcEndpoint),
    decodeContractEvent:eventDecoder(native)});
}
