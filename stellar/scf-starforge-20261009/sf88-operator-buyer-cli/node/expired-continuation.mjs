// MIT. Explicit original reserved-attempt successors, with separate source predicates.
import {readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readBytes,readJson,writeJson,jsonBytes,parseJson,digest,
  exists,intent,need,object,now,syncDirectory,absolute,BuyerError} from './store.mjs';
import {inspectNodeLostOutput} from './lost-output.mjs';
import {readAuthorizationExpiryEvidence} from './expiry-evidence.mjs';
import {readSuccessorRuntimeSource,verifySuccessorRuntimeSource,successorOperation,
  originalRuntimeParent} from './runtime-source.mjs';
import {readUndispatchedAuthorizationEvidence} from './authorization-dispatch.mjs';
import {readContinuationOperation,continuationRequestIdentity,withContinuationLock,
  readUnpaidContinuationEdge} from './unpaid-continuation.mjs';

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

function reservedFamily(mode){
  const isExpired=mode==='expired';
  const SCHEMA='stellar-forge.node-'+mode+'-continuation.v1';
  const CHOICE=mode+'-continuation.json',READY=mode+'-continuation-ready.json';
  const markerKey=mode+'Continuation',evidenceKey=isExpired?'expiry':'authorization';
  const inputsKey=isExpired?'expiryInputs':'authorizationInputs';
  const descriptorFile=mode+'-reservation-source.json';
  const code=suffix=>mode.toUpperCase()+'_CONTINUATION_'+suffix;
  const readEvidence=(operation,inputs,signal)=>isExpired?
    readAuthorizationExpiryEvidence({...inputs,signal}):
    readUndispatchedAuthorizationEvidence(operation,{...inputs,signal});
async function immutable(path,value){
  try{await writeJson(path,value,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const raw=await readBytes(path),saved=parseJson(raw);
  need(same(saved,value),code('SOURCE_CONFLICT'));
  return{raw,value:saved,sha256:digest(raw)};
}
async function selected(operation){
  const path=join(operation.directory,CHOICE);
  if(!await exists(path))return null;
  const raw=await readBytes(path),value=parseJson(raw);
  need(value.schema===SCHEMA&&value.parentIntentId===operation.intentId&&
    intent(value.intentId)!==operation.intentId&&object(value.source)&&
    value.source.intentId===operation.intentId&&sha(value.source.expectedRequestSha256)&&
    sha(value[evidenceKey]?.sha256)&&object(value[inputsKey])&&object(value.reservation)&&
    typeof value.reason==='string'&&value.reason.length>0,
    code('CHOICE_INVALID'));
  if(value.successorRuntime!==undefined)
    need(!isExpired&&object(value.successorRuntime)&&sha(value.successorRuntime.sha256)&&
      value.source.runtimeDirectory===operation.buyer.runtime.directory&&
      value.source.stateDirectory===operation.buyer.stateDirectory&&
      value.successorRuntime.directory!==operation.buyer.runtime.directory,code('RUNTIME_CHOICE_INVALID'));
  return{raw,value,sha256:digest(raw)};
}
const marker=choice=>({parentIntentId:choice.value.parentIntentId,choiceSha256:choice.sha256,
  ...(choice.value.successorRuntime===undefined?{}:{
    parentRuntimeDirectory:choice.value.source.runtimeDirectory,
    successorRuntimeSha256:choice.value.successorRuntime.sha256})});

async function originalFiles(operation,source){
  const bound=await readContinuationOperation(operation);
  need(bound.operationSha256===source.sourceHashes.operation&&
    bound.configSha256===source.configSha256&&bound.bodySha256===source.bodySha256&&
    bound.ticketSha256===source.ticketSha256&&
    (bound.meta.nativeWorkspace??null)===source.nativeWorkspace&&
    continuationRequestIdentity(bound.config)===source.requestIdentity,
    code('PARENT_CHANGED'));
  const known={attempt:join(operation.directory,'attempt.json'),
    stdout:join(operation.directory,'stdout.json'),stderr:join(operation.directory,'stderr.log'),
    result:join(operation.directory,'result.json'),response:join(operation.directory,'response.bin'),
    evidence:join(bound.config.evidenceDir,digest(operation.intentId)+'.json'),
    workspaceConfig:join(source.workspace,'operator.json'),workspaceManifest:join(source.workspace,'workspace.json')};
  for(const [key,path]of Object.entries(known)){
    const expected=source.sourceHashes[key];
    if(expected===undefined)continue;
    if(expected===null){need(!await exists(path),code('PARENT_OUTPUT_CHANGED'));continue;}
    need(sha(expected),code('SOURCE_INVALID'));
    const limit=key==='stdout'||key==='stderr'?33_554_432:key==='result'?16_777_216:4_000_000;
    need(digest(await readBytes(path,limit))===expected,code('PARENT_OUTPUT_CHANGED'));
  }
  return bound;
}
async function recheckEvidence(operation,choice){
  const evidence=await readEvidence(operation,choice.value[inputsKey]);
  need(evidence.sha256===choice.value[evidenceKey].sha256&&same(evidence,choice.value[evidenceKey]),
    code(isExpired?'EXPIRY_SOURCE_CHANGED':'AUTHORIZATION_SOURCE_CHANGED'));
  return evidence;
}
async function childBinding(parent,choice,child,{ready=true,signal}={}){
  if(choice.value.successorRuntime!==undefined){
    await verifySuccessorRuntimeSource(choice.value.successorRuntime,{signal});
    need(child.buyer.runtime.directory===choice.value.successorRuntime.directory&&
      child.buyer.stateDirectory===parent.buyer.stateDirectory,code('RUNTIME_CHANGED'));
  }
  const bound=await originalFiles(parent,choice.value.source);
  await recheckEvidence(parent,choice);
  const next=await readContinuationOperation(child);
  need(child.intentId===choice.value.intentId&&same(next.meta[markerKey],marker(choice))&&
    ['unpaidContinuation','expiredContinuation','undispatchedContinuation'].every(key=>key===markerKey||next.meta[key]===undefined)&&
    next.bodySha256===bound.bodySha256&&next.ticketSha256===bound.ticketSha256&&
    (next.meta.nativeWorkspace??null)===(bound.meta.nativeWorkspace??null)&&
    continuationRequestIdentity(next.config)===choice.value.source.requestIdentity&&
    (bound.meta.nativeWorkspace===undefined||next.config.evidenceDir===bound.config.evidenceDir),
    code('CHILD_CHANGED'));
  const hashes={operationSha256:next.operationSha256,configSha256:next.configSha256,
    bodySha256:next.bodySha256,ticketSha256:next.ticketSha256};
  if(ready){
    need(await exists(join(parent.directory,READY)),code('PREPARATION_INCOMPLETE'));
    const completed=await readJson(join(parent.directory,READY));
    need(completed.schema===SCHEMA&&completed.parentIntentId===parent.intentId&&
      completed.intentId===child.intentId&&completed.choiceSha256===choice.sha256&&
      same(completed.child,hashes),code('PREPARATION_INCOMPLETE'));
  }
  return{bound,next,hashes};
}
async function edge(operation,meta){
  need(object(meta[markerKey]),code('LINEAGE_INVALID'));
  intent(meta[markerKey].parentIntentId);
  const parent=originalRuntimeParent(operation,meta[markerKey]);
  const choice=await selected(parent);
  need(choice&&choice.sha256===meta[markerKey].choiceSha256&&
    choice.value.intentId===operation.intentId,code('CHOICE_CHANGED'));
  const {bound}=await childBinding(parent,choice,operation);
  return{operation:parent,meta:bound.meta};
}

async function auditedReservation(operation,snapshot,approvedRequest,{signal,environment,node}){
  const descriptor={schema:'stellar-forge.sf88.node-reservation-source.v1',sourceKind:'node-operation',
    stateDirectory:snapshot.stateDirectory,operationDirectory:snapshot.operationDirectory,
    runtimeDirectory:snapshot.runtimeDirectory,workspace:snapshot.workspace,intentId:snapshot.intentId,
    attemptId:snapshot.attemptId,configSha256:snapshot.configSha256,requestSha256:snapshot.expectedRequestSha256,
    sourceHashes:snapshot.sourceHashes,evidenceState:snapshot.evidenceState,localOutcome:snapshot.localOutcome,
    transportCheckpointSha256:snapshot.transportCheckpointSha256,approvedRequest};
  const source=await immutable(join(operation.directory,descriptorFile),descriptor);
  const [{openWorkspace},{runOriginalFinalityWorker}]=await Promise.all([
    runtimeImport(operation,'workspace.mjs'),runtimeImport(operation,'finalization.mjs')]);
  const active=await openWorkspace(['--dir',snapshot.workspace],{accounting:true,environment});
  const owner=active.config.operator;
  need(active.config.trustedPayer===snapshot.expected.payer,code('PAYER_CHANGED'));
  const result=await runOriginalFinalityWorker(owner.python,[
    '--node-reservation-source',join(operation.directory,descriptorFile),
    '--ledger',owner.ledger,'--policy',owner.policy,'--payer',snapshot.expected.payer,
    '--node',node,'--reports',operation.directory,'--expected-request-sha',snapshot.expectedRequestSha256,
    '--verify-only'],active.operatorEnvironment,signal,undefined,environment);
  need(result?.outcome==='RESERVATION_VERIFIED',
    typeof result?.reason==='string'&&/^[A-Z][A-Z0-9_]{1,119}$/.test(result.reason)?
      result.reason:code('ORIGINAL_RESERVATION_AUDIT_FAILED'));
  const row=result.reservation,binding=result.binding;
  need(binding?.intentId===operation.intentId&&
    binding.requestSha256===snapshot.expectedRequestSha256&&binding.attemptId===snapshot.attemptId&&
    binding.configSha256===snapshot.configSha256&&same(binding.sourceHashes,snapshot.sourceHashes)&&
    row?.request_id===operation.intentId&&row.request_digest===snapshot.expectedRequestSha256&&
    row.state==='reserved'&&row.actual==='0'&&row.receipt_ref===''&&row.proof_sha256===''&&
    row.amount===approvedRequest.max_amount&&row.actor===approvedRequest.actor&&
    row.service===approvedRequest.service&&row.network===approvedRequest.network&&row.asset===approvedRequest.asset,
    code('ORIGINAL_RESERVED_ROW_REQUIRED'));
  return{...row,sourceSha256:source.sha256,recordAuthority:result.recordAuthority};
}

async function prepare(operation,options={}){
  const {intentId,expectedRequestSha256,expectedAttemptId,expectedConfigSha256,reason,
    workspace,approvedRequest:inputRequest,approvedRequestFile,expiryEvidence,successorRuntime,
    signal,node=process.execPath,environment=process.env,...extra}=options;
  need(Object.keys(extra).length===0,code('FIELDS_INVALID'));
  intent(intentId);
  need(intentId!==operation.intentId&&sha(expectedRequestSha256)&&sha(expectedAttemptId),
    code('SELECTION_REQUIRED'));
  need(typeof reason==='string'&&reason===reason.trim()&&reason.length>0&&reason.length<=1000&&
    !/[\x00-\x1f\x7f]/.test(reason),code('REMEDIATION_REQUIRED'));
  need(isExpired?object(expiryEvidence)&&Object.keys(expiryEvidence).every(key=>
    ['boundFile','observationFile','expectedFeeAccount','providerSourceFile','sdkSourceIndexFile'].includes(key)):
    expiryEvidence===undefined,code('EVIDENCE_INPUT_REQUIRED'));
  need((inputRequest!==undefined)!==(approvedRequestFile!==undefined),
    code('ONE_APPROVED_REQUEST_REQUIRED'));
  need(successorRuntime===undefined||!isExpired&&object(successorRuntime),code('RUNTIME_SELECTION_INVALID'));
  const selectedRuntime=successorRuntime===undefined?undefined:copy(successorRuntime);
  const approvedRequest=inputRequest===undefined?null:copy(inputRequest);
  const inputs=isExpired?copy(expiryEvidence):{},workerEnvironment={...environment};
  for(const key of ['boundFile','observationFile','providerSourceFile','sdkSourceIndexFile'])
    if(inputs[key]!==undefined)inputs[key]=absolute(inputs[key]);
  checkSignal(signal);
  const request=approvedRequest??parseJson(await readBytes(absolute(approvedRequestFile),65536));
  await operation._bound();
  return withContinuationLock(operation,async()=>{
    checkSignal(signal);await operation._bound();
    for(const file of ['unpaid-continuation.json','expired-continuation.json','undispatched-continuation.json'])
      if(file!==CHOICE)need(!await exists(join(operation.directory,file)),'CONTINUATION_ALREADY_SELECTED');
    const snapshot=await inspectNodeLostOutput(operation,{workspace,approvedRequest:request,
      expectedRequestSha256,expectedAttemptId,expectedConfigSha256,signal});
    need(['STARTING','STARTED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(snapshot.attemptState)&&
      snapshot.localOutcome.result.condition!=='JSON'&&snapshot.localOutcome.response?.condition==='ABSENT',
      code('UNRESOLVED_ORIGINAL_ATTEMPT_REQUIRED'));
    const bound=await readContinuationOperation(operation);
    // A native-workspace import may pin its own original sourceCli. Moving
    // that command needs the workspace's existing explicit adoption contract.
    need(selectedRuntime===undefined||bound.meta.nativeWorkspace===undefined,
      code('RUNTIME_WORKSPACE_ADOPTION_REQUIRED'));
    const runtimeBinding=selectedRuntime===undefined?undefined:
      await readSuccessorRuntimeSource(selectedRuntime,{signal});
    need(runtimeBinding===undefined||runtimeBinding.directory!==operation.buyer.runtime.directory,
      code('RUNTIME_MUST_BE_DISTINCT'));
    snapshot.requestIdentity=continuationRequestIdentity(bound.config);
    const evidenceInputs=isExpired?{...inputs,expectedIntentId:operation.intentId,expectedRequestSha256,
      acceptedMaxTimeoutSeconds:request.max_timeout_seconds,expectedAttemptStartedAt:snapshot.attemptStartedAt}:
      {workspace:snapshot.workspace,approvedRequest:request,expectedRequestSha256,
        expectedAttemptId:snapshot.attemptId,expectedConfigSha256:snapshot.configSha256};
    const evidence=await readEvidence(operation,evidenceInputs,signal);
    let choice=await selected(operation);
    const child=await successorOperation(operation,intentId,runtimeBinding,{signal});
    if(choice){
      need(choice.value.intentId===intentId&&choice.value.reason===reason&&
        same(choice.value.source,snapshot)&&same(choice.value[inputsKey],evidenceInputs)&&
        same(choice.value[evidenceKey],evidence)&&
        same(choice.value.successorRuntime??null,runtimeBinding??null),code('ALREADY_SELECTED'));
      if(await exists(join(operation.directory,READY))){
        await childBinding(operation,choice,child,{signal});return child;
      }
    }else{
      need(!await exists(child.directory),code('INTENT_ALREADY_EXISTS'));
      need(!await exists(join(operation.directory,'lost-output','recovery.json')),
        code('ORIGINAL_RECOVERY_PRESENT'));
    }
    const reservation=await auditedReservation(operation,snapshot,request,
      {signal,environment:workerEnvironment,node});
    checkSignal(signal);
    await originalFiles(operation,snapshot);
    if(!choice){
      await writeJson(join(operation.directory,CHOICE),{schema:SCHEMA,parentIntentId:operation.intentId,
        intentId,reason,createdAt:now(),source:snapshot,[inputsKey]:evidenceInputs,[evidenceKey]:evidence,reservation,
        ...(runtimeBinding===undefined?{}:{successorRuntime:runtimeBinding}),
        accounting:'ORIGINAL_RESERVATION_RETAINED; SUCCESSOR_REQUIRES_ORIGINAL_APPROVAL'},
        {exclusive:true});
      choice=await selected(operation);
    }else need(same(choice.value.reservation,reservation),code('RESERVATION_CHANGED'));
    if(await exists(child.directory)){
      await privateDirectory(child.directory,{create:false});
      need(!await exists(join(child.directory,'attempt.json'))&&
        !await exists(join(child.directory,'stdout.json'))&&!await exists(join(child.directory,'result.json')),
        code('ATTEMPT_WITHOUT_BINDING'));
      const metaPath=join(child.directory,'operation.json');
      const existing=await exists(metaPath)?await readJson(metaPath):null;
      if(existing?.state==='PREPARED'){
        await childBinding(operation,choice,child,{ready:false,signal});
      }else{
        const names=await readdir(child.directory);
        need(existing?existing.schema===OP_SCHEMA&&existing.intentId===intentId&&
          existing.state==='PREPARING'&&same(existing[markerKey],marker(choice)):
          names.every(name=>/^\.write-[a-f0-9-]{36}$/.test(name)),
          code('PREPARATION_CONFLICT'));
        await rename(child.directory,join(operation.buyer.stateDirectory,
          '.'+mode+'-preparation-'+digest(intentId)+'-'+randomUUID()));
        await syncDirectory(operation.buyer.stateDirectory);
      }
    }
    if(!await exists(child.directory)){
      checkSignal(signal);const config=copy(bound.config);config.operation.intentId=intentId;
      await child.buyer._create(config,{
        ...(bound.meta.nativeWorkspace===undefined?{}:{nativeWorkspace:bound.meta.nativeWorkspace}),
        [markerKey]:marker(choice),signal});
    }
    checkSignal(signal);
    const verified=await childBinding(operation,choice,child,{ready:false});
    await writeJson(join(operation.directory,READY),{schema:SCHEMA,parentIntentId:operation.intentId,
      intentId,choiceSha256:choice.sha256,child:verified.hashes,preparedAt:now()},{exclusive:true});
    await child._bound();return child;
  });
}
async function inspect(operation){
  await operation._bound();const choice=await selected(operation);
  if(!choice)return{intentId:operation.intentId,continuation:null};
  const prepared=await exists(join(operation.directory,READY));
  await originalFiles(operation,choice.value.source);await recheckEvidence(operation,choice);
  if(prepared)await childBinding(operation,choice,
    await successorOperation(operation,choice.value.intentId,choice.value.successorRuntime));
  return{intentId:operation.intentId,continuation:{intentId:choice.value.intentId,
    reason:choice.value.reason,state:prepared?'PREPARED':'PREPARING',createdAt:choice.value.createdAt,
    choiceSha256:choice.sha256,source:choice.value.source,[evidenceKey]:choice.value[evidenceKey],
    reservation:choice.value.reservation,accounting:choice.value.accounting,
    ...(choice.value.successorRuntime===undefined?{}:{successorRuntime:choice.value.successorRuntime})}};
}

return {prepare,inspect,selected,childBinding,edge};
}
const expired=reservedFamily('expired'),undispatched=reservedFamily('undispatched');
export const prepareExpiredContinuation=(operation,options)=>expired.prepare(operation,options);
export const inspectExpiredContinuation=operation=>expired.inspect(operation);
export const prepareUndispatchedContinuation=(operation,options)=>undispatched.prepare(operation,options);
export const inspectUndispatchedContinuation=operation=>undispatched.inspect(operation);

// Open one recorded operation in the runtime explicitly bound to its parent choice.
// This is distinct from following later children: the requested intent ID stays exact.
export async function openOperationRuntime(operation,{signal}={}){
  checkSignal(signal);
  await privateDirectory(operation.directory,{create:false});
  const meta=await readJson(join(operation.directory,'operation.json'));
  need(meta.schema===OP_SCHEMA&&meta.intentId===operation.intentId&&meta.state==='PREPARED',
    'OPERATION_PREPARATION_INCOMPLETE');
  if(meta.runtimeDirectory===operation.buyer.runtime.directory){
    await operation._bound();checkSignal(signal);return operation;
  }
  need(object(meta.undispatchedContinuation)&&
    meta.undispatchedContinuation.parentRuntimeDirectory!==undefined&&
    meta.unpaidContinuation===undefined&&meta.expiredContinuation===undefined,
    'CONTINUATION_RUNTIME_SELECTION_REQUIRED');
  intent(meta.undispatchedContinuation.parentIntentId);
  const parent=originalRuntimeParent(operation,meta.undispatchedContinuation);
  await parent._bound();
  const choice=await undispatched.selected(parent);
  need(choice&&choice.sha256===meta.undispatchedContinuation.choiceSha256&&
    choice.value.intentId===operation.intentId&&
    choice.value.successorRuntime?.directory===meta.runtimeDirectory&&
    choice.value.successorRuntime.sha256===meta.undispatchedContinuation.successorRuntimeSha256,
    'CONTINUATION_RUNTIME_CHOICE_CHANGED');
  const child=await successorOperation(parent,operation.intentId,choice.value.successorRuntime,{signal});
  await undispatched.childBinding(parent,choice,child,{signal});
  checkSignal(signal);return child;
}

// Validate existing choices without creating a successor or entering a signer.
export async function assertOperationContinuationBinding(operation,{meta}){
  let current=operation,currentMeta=meta;const seen=new Set();
  for(let count=0;count<65;count++){
    need(!seen.has(current.intentId),'CONTINUATION_LINEAGE_INVALID');seen.add(current.intentId);
    const keys=['unpaidContinuation','expiredContinuation','undispatchedContinuation']
      .filter(key=>currentMeta[key]!==undefined);
    need(keys.length<=1,'CONTINUATION_LINEAGE_INVALID');
    if(keys.length===0)return;
    const edge=keys[0]==='unpaidContinuation'?await readUnpaidContinuationEdge(current,currentMeta):
      await (keys[0]==='expiredContinuation'?expired:undispatched).edge(current,currentMeta);
    current=edge.operation;currentMeta=edge.meta;
  }
  throw new BuyerError('CONTINUATION_LINEAGE_INVALID');
}
export async function followContinuation(operation){
  let current=operation;const seen=new Set();
  for(let count=0;count<65;count++){
    need(!seen.has(current.intentId),'CONTINUATION_LINEAGE_INVALID');seen.add(current.intentId);
    await current._bound();
    const old=await expired.selected(current),held=await undispatched.selected(current);
    const unpaidPath=join(current.directory,'unpaid-continuation.json');
    const unpaid=await exists(unpaidPath)?await readJson(unpaidPath):null;
    need([old,held,unpaid].filter(Boolean).length<=1,'CONTINUATION_CHOICES_CONFLICT');
    if(!old&&!held&&!unpaid)return current;
    const selected=old??held;
    const next=selected?await successorOperation(current,intent(selected.value.intentId),selected.value.successorRuntime):
      current.buyer.operation(intent(unpaid.intentId));
    if(selected)await (old?expired:undispatched).childBinding(current,selected,next);
    await next._bound();current=next;
  }
  throw new BuyerError('CONTINUATION_LINEAGE_INVALID');
}
