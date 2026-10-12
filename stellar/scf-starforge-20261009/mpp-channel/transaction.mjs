// MIT. Original signed Stellar calls, exact authorization and same-envelope recovery.
import { requireValue as need, stable, now } from '../mpp-charge/storage.mjs';
import { publicURL } from './config.mjs';
import { channelRpc, networkPassphrase, settlingKey } from './runtime.mjs';
const sameXdr=(a,b)=>Buffer.from(a.toXDR()).equals(Buffer.from(b.toXDR()));
export function assertChannelCall(native,transaction,spec,{signed=false}={}) {
  const sdk=native.sdk,{channel,account,method,args,maximumFeeStroops}=spec;
  need(transaction instanceof sdk.Transaction && transaction.source===account &&
    transaction.operations.length===1 && transaction.operations[0].type==='invokeHostFunction' &&
    (!transaction.operations[0].source || transaction.operations[0].source===account) &&
    BigInt(transaction.fee)>0n && BigInt(transaction.fee)<=BigInt(maximumFeeStroops) &&
    transaction.memo.type==='none','MPP_CHANNEL_TRANSACTION_SCOPE_CHANGED');
  const operation=transaction.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp();
  const host=operation.hostFunction();
  need(host.switch().value===sdk.xdr.HostFunctionType.hostFunctionTypeInvokeContract().value,
    'MPP_CHANNEL_CONTRACT_CALL_REQUIRED');
  const call=host.invokeContract(),actual=call.args();
  need(sdk.Address.fromScAddress(call.contractAddress()).toString()===channel.address &&
    call.functionName().toString()===method && actual.length===args.length &&
    actual.every((arg,index)=>sameXdr(arg,args[index])),'MPP_CHANNEL_TRANSACTION_CALL_CHANGED');
  for(const authorization of operation.auth()) {
    need(authorization.credentials().switch().value===
      sdk.xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount().value,
      'MPP_CHANNEL_TRANSACTION_UNEXPECTED_SIGNER');
    const root=authorization.rootInvocation();
    need(sameXdr(root.function().contractFn(),call),'MPP_CHANNEL_TRANSACTION_AUTHORIZATION_CHANGED');
    const children=root.subInvocations();
    if(method==='top_up') {
      // The funder's authorization may include only the exact intended token transfer.
      need(children.length<=1,'MPP_CHANNEL_TOP_UP_AUTHORIZATION_CHANGED');
      for(const child of children) {
        const transfer=child.function().contractFn(),values=transfer.args();
        need(child.subInvocations().length===0 &&
          sdk.Address.fromScAddress(transfer.contractAddress()).toString()===channel.token &&
          transfer.functionName().toString()==='transfer' && values.length===3 &&
          sdk.Address.fromScVal(values[0]).toString()===channel.funder &&
          sdk.Address.fromScVal(values[1]).toString()===channel.address &&
          sameXdr(values[2],args[0]),'MPP_CHANNEL_TOP_UP_TRANSFER_CHANGED');
      }
    } else need(children.length===0,'MPP_CHANNEL_TRANSACTION_UNEXPECTED_SUBINVOCATION');
  }
  need(transaction.timeBounds && BigInt(transaction.timeBounds.minTime)===0n &&
    BigInt(transaction.timeBounds.maxTime)>0n,'MPP_CHANNEL_TRANSACTION_TIMEBOUND_REQUIRED');
  if(signed) need(transaction.signatures.length===1 && sdk.Keypair.fromPublicKey(account).verify(
    transaction.hash(),transaction.signatures[0].signature()),'MPP_CHANNEL_ORIGINAL_TRANSACTION_SIGNATURE_REQUIRED');
  else need(transaction.signatures.length===0,'MPP_CHANNEL_UNSIGNED_TRANSACTION_REQUIRED');
}
export async function prepareChannelCall(native,spec,key) {
  need(key.publicKey()===spec.account,'MPP_CHANNEL_TRANSACTION_SIGNER_MISMATCH');
  const rpc=await channelRpc(native,spec.channel),account=await rpc.getAccount(spec.account);
  const unsigned=new native.sdk.TransactionBuilder(account,{fee:'100',
    networkPassphrase:networkPassphrase(native,spec.channel.network)})
    .addOperation(new native.sdk.Contract(spec.channel.address).call(spec.method,...spec.args))
    .setTimeout(180).build();
  const prepared=await rpc.prepareTransaction(unsigned);
  assertChannelCall(native,prepared,spec);
  need(prepared.sequence===unsigned.sequence && stable(prepared.timeBounds)===stable(unsigned.timeBounds),
    'MPP_CHANNEL_PREPARED_ENVELOPE_CHANGED');
  prepared.sign(key);assertChannelCall(native,prepared,spec,{signed:true});
  return prepared;
}
export function retainedTransaction(native,row,spec) {
  need(typeof row.signedXdr==='string' && /^[a-f0-9]{64}$/.test(row.transaction),
    'MPP_CHANNEL_ORIGINAL_SIGNED_TRANSACTION_REQUIRED');
  const transaction=native.sdk.TransactionBuilder.fromXDR(row.signedXdr,
    networkPassphrase(native,row.config.channel.network));
  assertChannelCall(native,transaction,spec,{signed:true});
  need(transaction.hash().toString('hex')===row.transaction,'MPP_CHANNEL_RETAINED_TRANSACTION_CHANGED');
  return transaction;
}
function integer(value) {
  if(typeof value==='number' && Number.isSafeInteger(value) && value>=0)return BigInt(value);
  if(typeof value==='string' && /^(0|[1-9][0-9]*)$/.test(value))return BigInt(value);
  return null;
}
const encoded=value=>typeof value==='string'?value:value?.toXDR('base64') ?? null;
export async function transactionFinality(native,row,spec,rpcUrl=row.config.channel.rpcUrl) {
  const envelope=retainedTransaction(native,row,spec),selected=publicURL(rpcUrl).href;
  const rpc=await channelRpc(native,row.config.channel,selected),result=await rpc.getTransaction(row.transaction);
  const finality={status:result.status,network:row.config.channel.network,observedAt:now(),
    ledger:result.ledger ?? null,createdAt:result.createdAt ?? null,
    latestLedger:result.latestLedger ?? null,oldestLedger:result.oldestLedger ?? null,
    latestLedgerCloseTime:result.latestLedgerCloseTime ?? null,oldestLedgerCloseTime:result.oldestLedgerCloseTime ?? null,
    rpcUrl:selected,envelopeXdr:encoded(result.envelopeXdr),resultXdr:encoded(result.resultXdr),
    resultMetaXdr:encoded(result.resultMetaXdr)};
  need(!result.txHash || result.txHash===row.transaction,'MPP_CHANNEL_FINALITY_IDENTITY_CHANGED');
  if(['SUCCESS','FAILED'].includes(result.status)) {
    const confirmed=native.sdk.TransactionBuilder.fromXDR(finality.envelopeXdr,
      networkPassphrase(native,row.config.channel.network));
    assertChannelCall(native,confirmed,spec,{signed:true});
    need(confirmed.hash().toString('hex')===row.transaction,'MPP_CHANNEL_FINALITY_ENVELOPE_CHANGED');
    return {phase:result.status,finality};
  }
  need(result.status==='NOT_FOUND','MPP_CHANNEL_RPC_STATUS_UNSUPPORTED');
  const latest=integer(result.latestLedger),oldest=integer(result.oldestLedger);
  const closedAt=integer(result.latestLedgerCloseTime),beforeSigning=integer(row.observation?.instanceLedger);
  const expires=BigInt(envelope.timeBounds.maxTime);
  const ledgerExpired=closedAt!==null && closedAt>expires;
  const completeWindow=oldest!==null && latest!==null && beforeSigning!==null &&
    oldest<=beforeSigning && latest>beforeSigning;
  return {phase:ledgerExpired?(completeWindow?'EXPIRED':'HISTORY_REQUIRED'):'PENDING',finality,
    ...(ledgerExpired?{expiry:{maximumTime:expires.toString(),signedAfterLedger:row.observation?.instanceLedger ?? null,
      completeWindow,observedAt:now()}}:{})};
}
export async function broadcastRetained(native,row,spec,save) {
  const transaction=retainedTransaction(native,row,spec),rpc=await channelRpc(native,row.config.channel);
  const before=await rpc.getTransaction(row.transaction);
  need(['SUCCESS','FAILED','NOT_FOUND'].includes(before.status),'MPP_CHANNEL_RPC_STATUS_UNSUPPORTED');
  if(before.status!=='NOT_FOUND' || BigInt(transaction.timeBounds.maxTime)*1000n<=BigInt(Date.now()))return row;
  row=await save(row,{phase:'SUBMITTING',submissionAttempts:(row.submissionAttempts ?? 0)+1});
  const submitted=await rpc.sendTransaction(transaction);
  need(!submitted.hash || submitted.hash===row.transaction,'MPP_CHANNEL_SUBMISSION_IDENTITY_CHANGED');
  return save(row,{phase:'PENDING',submission:{status:submitted.status,hash:submitted.hash ?? row.transaction,
    errorResultXdr:submitted.errorResult?.toXDR('base64') ?? null,observedAt:now()}});
}
export async function acquireFinancialMarker(store,terms,owner,details={}) {
  return store.update(settlingKey(terms),current=>{
    const matches=owner.kind==='funding'?current?.fundingId===owner.id:current?.settlementId===owner.id;
    need(!current || matches,'MPP_CHANNEL_RESUME_ORIGINAL_FINANCIAL_OPERATION',409);
    return {op:'set',value:{...details,
      ...(owner.kind==='funding'?{fundingId:owner.id}:{settlementId:owner.id}),updatedAt:now()},result:undefined};
  });
}
export async function clearFinancialMarker(store,terms,owner) {
  return store.update(settlingKey(terms),current=>{
    const matches=owner.kind==='funding'?current?.fundingId===owner.id:current?.settlementId===owner.id;
    return matches?{op:'delete',result:undefined}:{op:'noop',result:undefined};
  });
}
