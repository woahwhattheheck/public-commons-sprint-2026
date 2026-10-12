// MIT. Explicit successor for an original attempt with a reviewed expiry bound.
import {readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readBytes,readJson,writeJson,jsonBytes,parseJson,digest,
  exists,intent,need,object,now,syncDirectory,absolute,BuyerError} from './store.mjs';
import {inspectNodeLostOutput} from './lost-output.mjs';
import {readAuthorizationExpiryEvidence} from './expiry-evidence.mjs';
import {readContinuationOperation,continuationRequestIdentity,withContinuationLock,
  readUnpaidContinuationEdge} from './unpaid-continuation.mjs';

const SCHEMA='stellar-forge.node-expired-continuation.v1';
const CHOICE='expired-continuation.json',READY='expired-continuation-ready.json';
const OP_SCHEMA='stellar-forge.node-buyer.v1';
const copy=value=>parseJson(jsonBytes(value));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(left,right)=>canonical(left)===canonical(right);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function checkSignal(signal){
  need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted,'OPERATION_ABORTED_BEFORE_START');
}
const runtimeImport=(operation,name)=>import(pathToFileURL(join(operation.buyer.runtime.directory,name)).href);

async function immutable(path,value){
  try{await writeJson(path,value,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const raw=await readBytes(path),saved=parseJson(raw);
  need(same(saved,value),'EXPIRED_CONTINUATION_SOURCE_CONFLICT');
  return{raw,value:saved,sha256:digest(raw)};
}
async function selected(operation){
  const path=join(operation.directory,CHOICE);
  if(!await exists(path))return null;
  const raw=await readBytes(path),value=parseJson(raw);
  need(value.schema===SCHEMA&&value.parentIntentId===operation.intentId&&
    intent(value.intentId)!==operation.intentId&&object(value.source)&&
    value.source.intentId===operation.intentId&&sha(value.source.expectedRequestSha256)&&
    sha(value.expiry?.sha256)&&object(value.expiryInputs)&&object(value.reservation)&&
    typeof value.reason==='string'&&value.reason.length>0,
    'EXPIRED_CONTINUATION_CHOICE_INVALID');
  return{raw,value,sha256:digest(raw)};
}
const marker=choice=>({parentIntentId:choice.value.parentIntentId,choiceSha256:choice.sha256});

async function originalFiles(operation,source){
  const bound=await readContinuationOperation(operation);
  need(bound.operationSha256===source.sourceHashes.operation&&
    bound.configSha256===source.configSha256&&bound.bodySha256===source.bodySha256&&
    bound.ticketSha256===source.ticketSha256&&
    (bound.meta.nativeWorkspace??null)===source.nativeWorkspace&&
    continuationRequestIdentity(bound.config)===source.requestIdentity,
    'EXPIRED_CONTINUATION_PARENT_CHANGED');
  const known={attempt:join(operation.directory,'attempt.json'),
    stdout:join(operation.directory,'stdout.json'),stderr:join(operation.directory,'stderr.log'),
    result:join(operation.directory,'result.json'),response:join(operation.directory,'response.bin'),
    evidence:join(bound.config.evidenceDir,digest(operation.intentId)+'.json'),
    workspaceConfig:join(source.workspace,'operator.json'),workspaceManifest:join(source.workspace,'workspace.json')};
  for(const [key,path]of Object.entries(known)){
    const expected=source.sourceHashes[key];
    if(expected===undefined)continue;
    if(expected===null){need(!await exists(path),'EXPIRED_CONTINUATION_PARENT_OUTPUT_CHANGED');continue;}
    need(sha(expected),'EXPIRED_CONTINUATION_SOURCE_INVALID');
    const limit=key==='stdout'||key==='stderr'?33_554_432:key==='result'?16_777_216:4_000_000;
    need(digest(await readBytes(path,limit))===expected,'EXPIRED_CONTINUATION_PARENT_OUTPUT_CHANGED');
  }
  return bound;
}
async function recheckExpiry(choice){
  const evidence=await readAuthorizationExpiryEvidence(choice.value.expiryInputs);
  need(evidence.sha256===choice.value.expiry.sha256&&same(evidence,choice.value.expiry),
    'EXPIRED_CONTINUATION_EXPIRY_SOURCE_CHANGED');
  return evidence;
}
async function childBinding(parent,choice,child,{ready=true}={}){
  const bound=await originalFiles(parent,choice.value.source);
  await recheckExpiry(choice);
  const next=await readContinuationOperation(child);
  need(child.intentId===choice.value.intentId&&same(next.meta.expiredContinuation,marker(choice))&&
    next.meta.unpaidContinuation===undefined&&
    next.bodySha256===bound.bodySha256&&next.ticketSha256===bound.ticketSha256&&
    (next.meta.nativeWorkspace??null)===(bound.meta.nativeWorkspace??null)&&
    continuationRequestIdentity(next.config)===choice.value.source.requestIdentity&&
    (bound.meta.nativeWorkspace===undefined||next.config.evidenceDir===bound.config.evidenceDir),
    'EXPIRED_CONTINUATION_CHILD_CHANGED');
  const hashes={operationSha256:next.operationSha256,configSha256:next.configSha256,
    bodySha256:next.bodySha256,ticketSha256:next.ticketSha256};
  if(ready){
    need(await exists(join(parent.directory,READY)),'EXPIRED_CONTINUATION_PREPARATION_INCOMPLETE');
    const completed=await readJson(join(parent.directory,READY));
    need(completed.schema===SCHEMA&&completed.parentIntentId===parent.intentId&&
      completed.intentId===child.intentId&&completed.choiceSha256===choice.sha256&&
      same(completed.child,hashes),'EXPIRED_CONTINUATION_PREPARATION_INCOMPLETE');
  }
  return{bound,next,hashes};
}
async function expiredEdge(operation,meta){
  need(object(meta.expiredContinuation),'EXPIRED_CONTINUATION_LINEAGE_INVALID');
  const parent=operation.buyer.operation(intent(meta.expiredContinuation.parentIntentId));
  const choice=await selected(parent);
  need(choice&&choice.sha256===meta.expiredContinuation.choiceSha256&&
    choice.value.intentId===operation.intentId,'EXPIRED_CONTINUATION_CHOICE_CHANGED');
  const {bound}=await childBinding(parent,choice,operation);
  return{operation:parent,meta:bound.meta};
}

// Validate mixed explicit lineages iteratively. Every edge keeps its own
// original source-family predicate; neither parent inspection executes a job.
export async function assertOperationContinuationBinding(operation,{meta}){
  let current=operation,currentMeta=meta;const seen=new Set();
  for(let count=0;count<65;count++){
    need(!seen.has(current.intentId),'CONTINUATION_LINEAGE_INVALID');seen.add(current.intentId);
    const unpaid=currentMeta.unpaidContinuation!==undefined,expired=currentMeta.expiredContinuation!==undefined;
    need(!(unpaid&&expired),'CONTINUATION_LINEAGE_INVALID');
    if(!unpaid&&!expired)return;
    const edge=expired?await expiredEdge(current,currentMeta):await readUnpaidContinuationEdge(current,currentMeta);
    current=edge.operation;currentMeta=edge.meta;
  }
  throw new BuyerError('CONTINUATION_LINEAGE_INVALID');
}

async function auditedReservation(operation,snapshot,approvedRequest,{signal,environment,node}){
  const descriptor={schema:'stellar-forge.sf88.node-reservation-source.v1',sourceKind:'node-operation',
    stateDirectory:snapshot.stateDirectory,operationDirectory:snapshot.operationDirectory,
    runtimeDirectory:snapshot.runtimeDirectory,workspace:snapshot.workspace,intentId:snapshot.intentId,
    attemptId:snapshot.attemptId,configSha256:snapshot.configSha256,requestSha256:snapshot.expectedRequestSha256,
    sourceHashes:snapshot.sourceHashes,evidenceState:snapshot.evidenceState,localOutcome:snapshot.localOutcome,
    transportCheckpointSha256:snapshot.transportCheckpointSha256,approvedRequest};
  const source=await immutable(join(operation.directory,'expired-reservation-source.json'),descriptor);
  const [{openWorkspace},{runOriginalFinalityWorker}]=await Promise.all([
    runtimeImport(operation,'workspace.mjs'),runtimeImport(operation,'finalization.mjs')]);
  const active=await openWorkspace(['--dir',snapshot.workspace],{accounting:true,environment});
  const owner=active.config.operator;
  need(active.config.trustedPayer===snapshot.expected.payer,'EXPIRED_CONTINUATION_PAYER_CHANGED');
  const result=await runOriginalFinalityWorker(owner.python,[
    '--node-reservation-source',join(operation.directory,'expired-reservation-source.json'),
    '--ledger',owner.ledger,'--policy',owner.policy,'--payer',snapshot.expected.payer,
    '--node',node,'--reports',operation.directory,'--expected-request-sha',snapshot.expectedRequestSha256,
    '--verify-only'],active.operatorEnvironment,signal,undefined,environment);
  const row=result.reservation,binding=result.binding;
  need(result.outcome==='RESERVATION_VERIFIED'&&binding?.intentId===operation.intentId&&
    binding.requestSha256===snapshot.expectedRequestSha256&&binding.attemptId===snapshot.attemptId&&
    binding.configSha256===snapshot.configSha256&&same(binding.sourceHashes,snapshot.sourceHashes)&&
    row?.request_id===operation.intentId&&row.request_digest===snapshot.expectedRequestSha256&&
    row.state==='reserved'&&row.actual==='0'&&row.receipt_ref===''&&row.proof_sha256===''&&
    row.amount===approvedRequest.max_amount&&row.actor===approvedRequest.actor&&
    row.service===approvedRequest.service&&row.network===approvedRequest.network&&row.asset===approvedRequest.asset,
    'EXPIRED_CONTINUATION_ORIGINAL_RESERVED_ROW_REQUIRED');
  return{...row,sourceSha256:source.sha256,recordAuthority:result.recordAuthority};
}

export async function prepareExpiredContinuation(operation,options={}){
  const {intentId,expectedRequestSha256,expectedAttemptId,expectedConfigSha256,reason,
    workspace,approvedRequest:inputRequest,approvedRequestFile,expiryEvidence,
    signal,node=process.execPath,environment=process.env,...extra}=options;
  need(Object.keys(extra).length===0,'EXPIRED_CONTINUATION_FIELDS_INVALID');
  intent(intentId);
  need(intentId!==operation.intentId&&sha(expectedRequestSha256)&&sha(expectedAttemptId),
    'EXPIRED_CONTINUATION_SELECTION_REQUIRED');
  need(typeof reason==='string'&&reason===reason.trim()&&reason.length>0&&reason.length<=1000&&
    !/[\x00-\x1f\x7f]/.test(reason),'EXPIRED_CONTINUATION_REMEDIATION_REQUIRED');
  need(object(expiryEvidence)&&Object.keys(expiryEvidence).every(key=>
    ['boundFile','observationFile','expectedFeeAccount','providerSourceFile','sdkSourceIndexFile'].includes(key)),
    'EXPIRED_CONTINUATION_EXPIRY_INPUT_REQUIRED');
  need((inputRequest!==undefined)!==(approvedRequestFile!==undefined),
    'EXPIRED_CONTINUATION_ONE_APPROVED_REQUEST_REQUIRED');
  const approvedRequest=inputRequest===undefined?null:copy(inputRequest);
  const inputs=copy(expiryEvidence),workerEnvironment={...environment};
  for(const key of ['boundFile','observationFile','providerSourceFile','sdkSourceIndexFile'])
    if(inputs[key]!==undefined)inputs[key]=absolute(inputs[key]);
  checkSignal(signal);
  const request=approvedRequest??parseJson(await readBytes(absolute(approvedRequestFile),65536));
  await operation._bound();
  return withContinuationLock(operation,async()=>{
    checkSignal(signal);await operation._bound();
    need(!await exists(join(operation.directory,'unpaid-continuation.json')),'CONTINUATION_ALREADY_SELECTED');
    const snapshot=await inspectNodeLostOutput(operation,{workspace,approvedRequest:request,
      expectedRequestSha256,expectedAttemptId,expectedConfigSha256,signal});
    need(['STARTING','STARTED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(snapshot.attemptState)&&
      snapshot.localOutcome.result.condition!=='JSON'&&snapshot.localOutcome.response?.condition==='ABSENT',
      'EXPIRED_CONTINUATION_UNRESOLVED_ORIGINAL_ATTEMPT_REQUIRED');
    const bound=await readContinuationOperation(operation);
    snapshot.requestIdentity=continuationRequestIdentity(bound.config);
    const expiryInputs={...inputs,expectedIntentId:operation.intentId,expectedRequestSha256,
      acceptedMaxTimeoutSeconds:request.max_timeout_seconds,expectedAttemptStartedAt:snapshot.attemptStartedAt};
    const expiry=await readAuthorizationExpiryEvidence({...expiryInputs,signal});
    let choice=await selected(operation);
    const child=operation.buyer.operation(intentId);
    if(choice){
      need(choice.value.intentId===intentId&&choice.value.reason===reason&&
        same(choice.value.source,snapshot)&&same(choice.value.expiryInputs,expiryInputs)&&
        same(choice.value.expiry,expiry),'EXPIRED_CONTINUATION_ALREADY_SELECTED');
      if(await exists(join(operation.directory,READY))){
        await childBinding(operation,choice,child);return child;
      }
    }else{
      need(!await exists(child.directory),'EXPIRED_CONTINUATION_INTENT_ALREADY_EXISTS');
      need(!await exists(join(operation.directory,'lost-output','recovery.json')),
        'EXPIRED_CONTINUATION_ORIGINAL_RECOVERY_PRESENT');
    }
    const reservation=await auditedReservation(operation,snapshot,request,
      {signal,environment:workerEnvironment,node});
    checkSignal(signal);
    await originalFiles(operation,snapshot);
    if(!choice){
      await writeJson(join(operation.directory,CHOICE),{schema:SCHEMA,parentIntentId:operation.intentId,
        intentId,reason,createdAt:now(),source:snapshot,expiryInputs,expiry,reservation,
        accounting:'ORIGINAL_RESERVATION_RETAINED; SUCCESSOR_REQUIRES_ORIGINAL_APPROVAL'},
        {exclusive:true});
      choice=await selected(operation);
    }else need(same(choice.value.reservation,reservation),'EXPIRED_CONTINUATION_RESERVATION_CHANGED');
    if(await exists(child.directory)){
      await privateDirectory(child.directory,{create:false});
      need(!await exists(join(child.directory,'attempt.json'))&&
        !await exists(join(child.directory,'stdout.json'))&&!await exists(join(child.directory,'result.json')),
        'EXPIRED_CONTINUATION_ATTEMPT_WITHOUT_BINDING');
      const metaPath=join(child.directory,'operation.json');
      const existing=await exists(metaPath)?await readJson(metaPath):null;
      if(existing?.state==='PREPARED'){
        await childBinding(operation,choice,child,{ready:false});
      }else{
        const names=await readdir(child.directory);
        need(existing?existing.schema===OP_SCHEMA&&existing.intentId===intentId&&
          existing.state==='PREPARING'&&same(existing.expiredContinuation,marker(choice)):
          names.every(name=>/^\.write-[a-f0-9-]{36}$/.test(name)),
          'EXPIRED_CONTINUATION_PREPARATION_CONFLICT');
        await rename(child.directory,join(operation.buyer.stateDirectory,
          '.expired-preparation-'+digest(intentId)+'-'+randomUUID()));
        await syncDirectory(operation.buyer.stateDirectory);
      }
    }
    if(!await exists(child.directory)){
      checkSignal(signal);const config=copy(bound.config);config.operation.intentId=intentId;
      await operation.buyer._create(config,{
        ...(bound.meta.nativeWorkspace===undefined?{}:{nativeWorkspace:bound.meta.nativeWorkspace}),
        expiredContinuation:marker(choice),signal});
    }
    checkSignal(signal);
    const verified=await childBinding(operation,choice,child,{ready:false});
    await writeJson(join(operation.directory,READY),{schema:SCHEMA,parentIntentId:operation.intentId,
      intentId,choiceSha256:choice.sha256,child:verified.hashes,preparedAt:now()},{exclusive:true});
    await child._bound();return child;
  });
}
export async function inspectExpiredContinuation(operation){
  await operation._bound();const choice=await selected(operation);
  if(!choice)return{intentId:operation.intentId,continuation:null};
  const prepared=await exists(join(operation.directory,READY));
  await originalFiles(operation,choice.value.source);await recheckExpiry(choice);
  if(prepared)await childBinding(operation,choice,operation.buyer.operation(choice.value.intentId));
  return{intentId:operation.intentId,continuation:{intentId:choice.value.intentId,
    reason:choice.value.reason,state:prepared?'PREPARED':'PREPARING',createdAt:choice.value.createdAt,
    choiceSha256:choice.sha256,source:choice.value.source,expiry:choice.value.expiry,
    reservation:choice.value.reservation,accounting:choice.value.accounting}};
}
// A saved explicit choice is followed; inspection never creates or pays a successor.
export async function followContinuation(operation){
  let current=operation;const seen=new Set();
  for(let count=0;count<65;count++){
    need(!seen.has(current.intentId),'CONTINUATION_LINEAGE_INVALID');seen.add(current.intentId);
    await current._bound();
    const choice=await selected(current),unpaidPath=join(current.directory,'unpaid-continuation.json');
    const unpaid=await exists(unpaidPath)?await readJson(unpaidPath):null;
    need(!(choice&&unpaid),'CONTINUATION_CHOICES_CONFLICT');
    if(!choice&&!unpaid)return current;
    const next=current.buyer.operation(intent(choice?choice.value.intentId:unpaid.intentId));
    if(choice)await childBinding(current,choice,next);
    await next._bound();current=next;
  }
  throw new BuyerError('CONTINUATION_LINEAGE_INVALID');
}
