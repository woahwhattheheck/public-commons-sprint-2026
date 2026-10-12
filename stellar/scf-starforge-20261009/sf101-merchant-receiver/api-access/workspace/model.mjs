// MIT. Durable customer work over original ApiAccessClient and Buyer/Inbox.
import {mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ApiAccessClient,createApiAccessPurchase,openApiAccessPurchase} from '../purchase.mjs';
import {validateHandoff} from '../../checkout-config.mjs';
import {Buyer} from '../../../sf88-operator-buyer-cli/node/index.mjs';
import {privateDirectory,readBytes,readJson,writeBytes,writeJson,exists,parseJson} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {compileConfig,authority,STATE_SCHEMA,MAX_BODY_BYTES,MAX_RESULT_BYTES,MAX_PROFILES,MAX_CALLS,MAX_TASKS,
 clone,canonical,fingerprint,digest,now,check,fail,absolute,label,gatewayOrigin,allowedClaim,inputBytes,queryPairs,requestId,uuid,contentType,HASH,UUID} from './configuration.mjs';

const ACTIVE=new Set(['QUEUED','RUNNING','CANCELLING']);
const PURCHASE=new Set(['prepare-purchase','review-purchase','execute-purchase','recover-purchase','finalize-purchase','report-purchase',
 'inspect-lost-output','recover-lost-output','read-lost-output','export-lost-output']);
const KINDS=new Set(['refresh','call','recover',...PURCHASE]);
const MERGEABLE=new Set(['pass-connected','purchase-connected','purchase-adopted','request-prepared','task-queued','task-cancel-requested','original-request-adopted']);
const rowError=error=>({code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,140}$/.test(error.code)?error.code:'ORIGINAL_OPERATION_FAILED',at:now()});
const equal=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const publicNative=native=>{
 const value=native?.native??native??{};
 return {authority:'ORIGINAL_BUYER_INBOX',intentId:value.operation?.intentId??value.intentId??null,
  state:value.state??value.outcome?.status??value.status??null,configSha256:value.configSha256??null,
  bodySha256:value.bodySha256??null,attemptId:value.attempt?.id??value.attemptId??null,
  outcome:value.outcome?{mode:value.outcome.mode??null,status:value.outcome.status??null,intentId:value.outcome.intentId??null}:null,
  ...(Object.hasOwn(value,'lostOutputFinalization')?{lostOutput:value.lostOutputFinalization?publicRecovery(value.lostOutputFinalization):null}:{})};
};
function publicRecovery(value){
 return {schema:value.schema,intentId:value.intentId,attemptId:value.attemptId,configSha256:value.configSha256,
  requestSha256:value.requestSha256,transaction:value.transaction,evidenceState:clone(value.evidenceState),
  completedAt:value.completedAt,observedAt:value.observedAt,attemptStartedAt:value.attemptStartedAt,
  association:value.association,recordAuthority:value.recordAuthority,
  outcome:value.result?.outcome??null,verifiedFacts:clone(value.result?.verifiedFacts??null)};
}
function safeDetail(value){
 return {schema:value.schema,orderRef:value.orderRef,manifestSha256:value.manifestSha256,planSha256:value.planSha256,
  createdAt:value.createdAt,plan:clone(value.plan),usage:clone(value.usage),manifest:clone(value.manifest??null),
  native:Object.fromEntries(['orderRef','routeId','method','network','amountAtomic','assetDigest','recipientDigest','eventId',
   'state','entitledAt','fileSha256','fileBytes','access'].filter(key=>value.native?.[key]!==undefined).map(key=>[key,clone(value.native[key])]))};
}
function safeCall(value,order){
 check(value&&value.orderRef===order&&typeof value.requestId==='string','ORIGINAL_CALL_BINDING_CHANGED',409);
 return clone(Object.fromEntries(['orderRef','requestId','routeId','method','path','requestSha256','units','status','storedStatus',
  'revision','startedAt','deadlineAt','updatedAt','errorCode','result'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])));
}
function validateState(state,config){
 check(state&&state.schema===STATE_SCHEMA&&UUID.test(state.id??'')&&Number.isSafeInteger(state.revision)&&state.revision>=1&&equal(state.authority,authority(config)),'WORKSPACE_BINDING_CHANGED',409);
 for(const [key,limit]of [['profiles',MAX_PROFILES],['calls',MAX_CALLS],['tasks',MAX_TASKS],['mutations',MAX_TASKS],['history',512]])
  check(Array.isArray(state[key])&&state[key].length<=limit,'INVALID_WORKSPACE_STATE',409);
 for(const key of ['profiles','calls','tasks']){
  const seen=new Set();for(const row of state[key]){check(row&&UUID.test(row.id??'')&&!seen.has(row.id),'INVALID_WORKSPACE_RECORD',409);seen.add(row.id);}
 }
 return state;
}
async function exactFile(path,bytes){
 if(await exists(path)){check(digest(await readBytes(path,Math.max(bytes.length,65536)))===digest(bytes),'RETAINED_INPUT_CHANGED',409);return;}
 try{await writeBytes(path,bytes,{exclusive:true});}catch(error){
  if(error.code!=='EEXIST')throw error;
  check(digest(await readBytes(path,Math.max(bytes.length,65536)))===digest(bytes),'RETAINED_INPUT_CHANGED',409);
 }
}
export async function openApiPassWorkspace({config:rawConfig,environment=process.env,approvals=null,expectedWorkspaceSha256}){
 const config=compileConfig(rawConfig);await privateDirectory(config.directory);
 const lease=await acquireStateLease(config.directory);
 try{
  for(const name of ['inputs','bodies','results','reviews','reports','purchases'])await privateDirectory(join(config.directory,name));
  const path=join(config.directory,'workspace.json');
  let state;
  check(expectedWorkspaceSha256===undefined||expectedWorkspaceSha256==='new'||HASH.test(expectedWorkspaceSha256),'INVALID_EXPECTED_WORKSPACE_SHA256');
  if(await exists(path)){
   const bytes=await readBytes(path,32*1024*1024);
   check(expectedWorkspaceSha256===undefined||expectedWorkspaceSha256===digest(bytes),'REVIEWED_WORKSPACE_CHANGED',409);
   state=validateState(parseJson(bytes),config);
  }else{
   check(expectedWorkspaceSha256===undefined||expectedWorkspaceSha256==='new','REVIEWED_WORKSPACE_CHANGED',409);
   state={schema:STATE_SCHEMA,id:randomUUID(),revision:1,authority:authority(config),createdAt:now(),updatedAt:now(),profiles:[],calls:[],tasks:[],mutations:[],history:[]};
   await writeJson(path,state,{exclusive:true});
  }
  const nativeEnvironment={...environment};
  delete nativeEnvironment.SF81_APPROVAL_SOCKET;delete nativeEnvironment.SF81_APPROVAL_TOKEN;
  const buyer=new Buyer({runtimeDirectory:config.runtimeDirectory,stateDirectory:config.buyerStateDirectory,
   environment:{...nativeEnvironment,...(approvals?.environment??{})}});
  const model=new ApiPassWorkspace(config,state,lease,buyer,nativeEnvironment,approvals);
  const interrupted=state.tasks.filter(row=>ACTIVE.has(row.status));
  if(interrupted.length)await model.serial(async()=>{
   const next=clone(model.state);
   for(const task of next.tasks.filter(row=>ACTIVE.has(row.status))){
    task.status='INTERRUPTED';task.error={code:'CUSTOMER_WORKSPACE_PROCESS_INTERRUPTED',at:now()};task.finishedAt=now();
    if(task.callId){const call=next.calls.find(row=>row.id===task.callId);if(call){call.status='ATTENTION';call.error=task.error;}}
   }
   model.history(next,'startup-recovered',{tasks:interrupted.length});await model.commit(next);
  });
  return model;
 }catch(error){await lease.close();throw error;}
}
export class ApiPassWorkspace extends EventEmitter{
 constructor(config,state,lease,buyer,environment,approvals){
  super();Object.assign(this,{config,state,lease,buyer,approvals});
  Object.defineProperty(this,'environment',{value:environment});
  this.tail=Promise.resolve();this.active=new Map();this.reads=new Map();this.pumping=null;this.closed=false;this.closing=false;this.reloadRequired=false;this.identity=state.id;
 }
 assertOpen(){check(!this.closed,'WORKSPACE_CLOSED',503);this.lease.assertHeld();}
 assertAccepting(){this.assertOpen();check(!this.closing,'WORKSPACE_CLOSING',503);}
 async reload(){
  const retained=validateState(await readJson(join(this.config.directory,'workspace.json'),32*1024*1024),this.config);
  check(retained.id===this.identity,'WORKSPACE_IDENTITY_CHANGED',409);this.state=retained;this.reloadRequired=false;
 }
 serial(operation){
  const result=this.tail.then(async()=>{this.assertOpen();if(this.reloadRequired)await this.reload();return operation();});this.tail=result.catch(()=>{});return result;
 }
 history(next,action,detail={}){next.history.push({at:now(),action,...detail});next.history=next.history.slice(-512);}
 async commit(next){
  validateState(next,this.config);check(next.id===this.identity,'WORKSPACE_IDENTITY_CHANGED',409);next.revision=this.state.revision+1;check(Number.isSafeInteger(next.revision),'WORKSPACE_REVISION_EXHAUSTED',503);next.updatedAt=now();
  check(Buffer.byteLength(JSON.stringify(next))<=32*1024*1024,'WORKSPACE_STATE_LIMIT',413);
  try{await writeJson(join(this.config.directory,'workspace.json'),next);this.state=next;}
  catch(error){
   this.reloadRequired=true;try{await this.reload();}catch{}
   throw error;
  }
  this.emit('change',{revision:this.state.revision});return this.state.revision;
 }
 profile(id,state=this.state){uuid(id);const row=state.profiles.find(row=>row.id===id);check(row,'PASS_NOT_FOUND',404);return row;}
 call(id,state=this.state){uuid(id);const row=state.calls.find(row=>row.id===id);check(row,'REQUEST_NOT_FOUND',404);return row;}
 task(id,state=this.state){uuid(id);const row=state.tasks.find(row=>row.id===id);check(row,'TASK_NOT_FOUND',404);return row;}
 profileView(row){
  return {id:row.id,label:row.label,archived:row.archived,mode:row.mode,createdAt:row.createdAt,updatedAt:row.updatedAt,
   orderReference:row.binding.orderReference,gatewayBaseUrl:row.binding.gatewayBaseUrl,manifestSha256:row.binding.manifestSha256,
   claimEnv:row.binding.claimEnv,claimAvailable:typeof this.environment[row.binding.claimEnv]==='string'&&this.environment[row.binding.claimEnv].length>0,
   intentId:row.binding.intentId??null,purchasePrepared:!!row.purchaseBinding,
   handoff:row.handoff?{purchaseUrl:row.handoff.purchaseUrl,payment:clone(row.handoff.payment),file:clone(row.handoff.file)}:null,
   detail:clone(row.detail??null),checkedAt:row.checkedAt??null,error:clone(row.error??null),native:clone(row.native??null),
   review:row.review?{id:row.review.id,sha256:row.review.sha256,reviewedAt:row.review.reviewedAt,downloadUrl:'/api/profiles/'+row.id+'/review'}:null,
   lostOutputAttempt:row.lostOutputAttempt?{id:row.lostOutputAttempt.id,snapshot:clone(row.lostOutputAttempt.snapshot)}:null,
   callCount:this.state.calls.filter(call=>call.profileId===row.id).length,
   activeTasks:this.state.tasks.filter(task=>task.profileId===row.id&&ACTIVE.has(task.status)).map(task=>this.taskView(task))};
 }
 callView(row){const result=row.result?clone(row.result):null;if(result)delete result.file;return {...clone(row),body:row.body?{bytes:row.body.bytes,sha256:row.body.sha256}:null,
  result:result?{...result,downloadUrl:'/api/calls/'+row.id+'/result',previewUrl:'/api/calls/'+row.id+'/preview'}:null};}
 taskView(row){
  return Object.fromEntries(['id','profileId','callId','kind','status','createdAt','startedAt','finishedAt','error','result','reviewId']
   .filter(key=>row[key]!==undefined).map(key=>[key,clone(row[key])]));
 }
 async snapshot(){
  return this.serial(()=>({schema:STATE_SCHEMA,id:this.state.id,title:this.config.title,revision:this.state.revision,
   purchaseEnabled:this.config.buyerWorkspace!==null,approvalMode:this.approvals?'ORIGINAL_BROWSER_BROKER':'ORIGINAL_TERMINAL',
   claimEnvs:[...this.config.claimEnvs],profiles:this.state.profiles.map(row=>this.profileView(row)),
   tasks:this.state.tasks.slice(-150).reverse().map(row=>this.taskView(row)),history:clone(this.state.history.slice(-100).reverse())}));
 }
 async detail(id,{offset=0,limit=100}={}){
  check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_REQUEST_PAGE');
  return this.serial(()=>{const profile=this.profile(id),calls=this.state.calls.filter(row=>row.profileId===id).reverse();return {revision:this.state.revision,profile:this.profileView(profile),
   calls:calls.slice(offset,offset+limit).map(row=>this.callView(row)),callPagination:{offset,limit,total:calls.length,nextOffset:offset+limit<calls.length?offset+limit:null},
   tasks:this.state.tasks.filter(row=>row.profileId===id).slice(-100).reverse().map(row=>this.taskView(row))};});
 }
 async callDetail(id){return this.serial(()=>({revision:this.state.revision,call:this.callView(this.call(id))}));}
 async mutate(kind,{operationId,expectedRevision},input,change){
  this.assertAccepting();requestId(operationId);const pin=fingerprint({kind,input});
  return this.serial(async()=>{
   const previous=this.state.mutations.find(row=>row.id===operationId);
   if(previous){check(previous.fingerprint===pin,'WORKSPACE_OPERATION_ID_REUSED',409);return {...clone(previous.result),reused:true,revision:this.state.revision};}
   check(Number.isSafeInteger(expectedRevision)&&expectedRevision>=1&&expectedRevision<=this.state.revision&&
    (expectedRevision===this.state.revision||MERGEABLE.has(kind)),'WORKSPACE_REVISION_CHANGED',409);
   check(this.state.mutations.length<MAX_TASKS,'WORKSPACE_MUTATION_LIMIT',429);
   const next=clone(this.state),result=await change(next);
   next.mutations.push({id:operationId,kind,fingerprint:pin,at:now(),result:clone(result)});
   this.history(next,kind,{operationId,...(result.profileId?{profileId:result.profileId}:{}),...(result.callId?{callId:result.callId}:{}),...(result.taskId?{taskId:result.taskId}:{})});
   await this.commit(next);return {...result,reused:false,revision:this.state.revision};
  });
 }
 async connectPass(value){
  const input={label:label(value.label),gatewayBaseUrl:gatewayOrigin(value.gatewayBaseUrl),orderReference:value.orderReference,
   manifestSha256:value.manifestSha256,claimEnv:allowedClaim(this.config,value.claimEnv)};
  new ApiAccessClient({baseUrl:input.gatewayBaseUrl,orderReference:input.orderReference,manifestSha256:input.manifestSha256,
   claimEnv:input.claimEnv,python:this.config.python,environment:this.environment});
  return this.mutate('pass-connected',value,input,async next=>{
   const duplicate=next.profiles.find(row=>row.binding.gatewayBaseUrl===input.gatewayBaseUrl&&row.binding.orderReference===input.orderReference);
   if(duplicate){check(duplicate.binding.manifestSha256===input.manifestSha256&&duplicate.binding.claimEnv===input.claimEnv,'CONNECTED_PASS_BINDING_DIFFERS',409);return {profileId:duplicate.id,alreadyConnected:true};}
   check(next.profiles.length<MAX_PROFILES,'PASS_LIMIT',429);
   const id=randomUUID(),{label:caption,...binding}=input;
   next.profiles.push({id,label:caption,mode:'access',binding,archived:false,createdAt:now(),updatedAt:now()});
   return {profileId:id};
  });
 }
 async preparePurchase(value){
  check(this.config.buyerWorkspace!==null,'ORIGINAL_BUYER_WORKSPACE_REQUIRED',409);
  check(typeof value.handoff==='string'&&Buffer.byteLength(value.handoff)<=65536,'ORIGINAL_HANDOFF_JSON_REQUIRED');
  const handoffBytes=Buffer.from(value.handoff),handoff=validateHandoff(parseJson(handoffBytes));
  const input={label:label(value.label),handoffSha256:digest(handoffBytes),intentId:requestId(value.intentId),
   gatewayBaseUrl:gatewayOrigin(value.gatewayBaseUrl),claimEnv:allowedClaim(this.config,value.claimEnv)};
  const result=await this.mutate('purchase-connected',value,input,async next=>{
   const duplicate=next.profiles.find(row=>row.binding.gatewayBaseUrl===input.gatewayBaseUrl&&row.binding.orderReference===handoff.orderReference);
   check(!duplicate,'PURCHASE_ORDER_ALREADY_CONNECTED',409);check(next.profiles.length<MAX_PROFILES,'PASS_LIMIT',429);
   const id=randomUUID(),handoffFile=join(this.config.directory,'inputs',id+'.handoff.json');
   await exactFile(handoffFile,handoffBytes);
   next.profiles.push({id,label:input.label,mode:'purchase',archived:false,createdAt:now(),updatedAt:now(),handoff:clone(handoff),
    binding:{gatewayBaseUrl:input.gatewayBaseUrl,orderReference:handoff.orderReference,manifestSha256:handoff.file.sha256,claimEnv:input.claimEnv,
     intentId:input.intentId,purchaseDirectory:join(this.config.directory,'purchases',id),handoffFile,handoffSha256:input.handoffSha256}});
   return {profileId:id};
  });
  return result;
 }
 async attachPurchase(value){
  check(this.config.buyerWorkspace!==null,'ORIGINAL_BUYER_WORKSPACE_REQUIRED',409);
  const directory=absolute(value.purchaseDirectory),purchase=await openApiAccessPurchase({directory,buyer:this.buyer,python:this.config.python,environment:this.environment});
  check(purchase.metadata.workspaceDirectory===this.config.buyerWorkspace,'ORIGINAL_BUYER_WORKSPACE_DIFFERS',409);
  allowedClaim(this.config,purchase.metadata.claimEnv);
  const input={label:label(value.label),directory,metadataSha256:purchase.metadataSha256};
  return this.mutate('purchase-adopted',value,input,async next=>{
   const duplicate=next.profiles.find(row=>row.binding.gatewayBaseUrl===purchase.metadata.gatewayBaseUrl&&row.binding.orderReference===purchase.orderReference);
   if(duplicate){check(duplicate.binding.purchaseDirectory===directory&&duplicate.purchaseBinding===purchase.metadataSha256,'PURCHASE_ORDER_ALREADY_CONNECTED',409);return {profileId:duplicate.id,alreadyConnected:true};}
   check(next.profiles.length<MAX_PROFILES,'PASS_LIMIT',429);
   const id=randomUUID();next.profiles.push({id,label:input.label,mode:'purchase',archived:false,createdAt:now(),updatedAt:now(),
    handoff:clone(purchase.handoff),purchaseBinding:purchase.metadataSha256,
    binding:{gatewayBaseUrl:purchase.metadata.gatewayBaseUrl,orderReference:purchase.orderReference,manifestSha256:purchase.handoff.file.sha256,
     claimEnv:purchase.metadata.claimEnv,intentId:purchase.intentId,purchaseDirectory:directory,
     handoffFile:join(directory,'handoff.json'),handoffSha256:purchase.metadata.handoffSha256}});
   return {profileId:id};
  });
 }
 async editPass(id,value){
  const input={profileId:uuid(id),label:label(value.label),archived:value.archived};
  check(typeof input.archived==='boolean','ARCHIVE_CHOICE_REQUIRED');
  return this.mutate('pass-updated',value,input,async next=>{
   const profile=this.profile(id,next);profile.label=input.label;profile.archived=input.archived;profile.updatedAt=now();return {profileId:id};
  });
 }
 async prepareCall(id,value){
  const profile=this.profile(id),selected=profile.detail?.plan?.routes?.find(row=>row.id===value.routeId);
  check(selected,'REFRESH_PASS_AND_SELECT_PURCHASED_ROUTE',409);
  const body=inputBytes(value.bodyBase64??null),input={profileId:uuid(id),requestId:requestId(value.requestId),label:label(value.label??value.requestId),
   routeId:selected.id,method:selected.method,path:selected.path,units:selected.units,query:queryPairs(value.query),
   contentType:contentType(value.contentType),body:body===null?null:{bytes:body.length,sha256:digest(body)}};
  return this.mutate('request-prepared',value,input,async next=>{
   const current=this.profile(id,next);check(current.binding.manifestSha256===profile.binding.manifestSha256,'PURCHASED_PLAN_BINDING_CHANGED',409);
   const prior=next.calls.find(row=>row.profileId===id&&row.requestId===input.requestId);
   if(prior){check(prior.fingerprint===fingerprint(input),'PREPARED_REQUEST_ID_REUSED',409);return {profileId:id,callId:prior.id,alreadyPrepared:true};}
   check(next.calls.length<MAX_CALLS,'SAVED_REQUEST_LIMIT',429);
   if(body!==null)await exactFile(join(this.config.directory,'bodies',input.body.sha256+'.bin'),body);
   const callId=randomUUID();next.calls.push({id:callId,...input,fingerprint:fingerprint(input),createdAt:now(),updatedAt:now(),status:'PREPARED',remote:null,result:null,error:null,history:[]});
   return {profileId:id,callId};
  });
 }
 client(profile){
  return new ApiAccessClient({baseUrl:profile.binding.gatewayBaseUrl,orderReference:profile.binding.orderReference,
   manifestSha256:profile.binding.manifestSha256,claimEnv:allowedClaim(this.config,profile.binding.claimEnv),python:this.config.python,environment:this.environment});
 }
 async purchase(profile,{create=false,signal}={}){
  check(profile.mode==='purchase','ORIGINAL_PURCHASE_REQUIRED',409);
  let purchase;
  if(create)purchase=await createApiAccessPurchase({directory:profile.binding.purchaseDirectory,buyer:this.buyer,
   workspaceDirectory:this.config.buyerWorkspace,inboxDirectory:this.config.inboxDirectory,handoffFile:profile.binding.handoffFile,
   intentId:profile.binding.intentId,gatewayBaseUrl:profile.binding.gatewayBaseUrl,claimEnv:profile.binding.claimEnv,
   python:this.config.python,environment:this.environment,signal});
  else purchase=await openApiAccessPurchase({directory:profile.binding.purchaseDirectory,buyer:this.buyer,python:this.config.python,environment:this.environment});
  check(purchase.orderReference===profile.binding.orderReference&&purchase.handoff.file.sha256===profile.binding.manifestSha256&&
   purchase.metadata.handoffSha256===profile.binding.handoffSha256&&purchase.metadata.workspaceDirectory===this.config.buyerWorkspace,'ORIGINAL_PURCHASE_BINDING_CHANGED',409);
  if(profile.purchaseBinding)check(profile.purchaseBinding===purchase.metadataSha256,'ORIGINAL_PURCHASE_BINDING_CHANGED',409);
  return purchase;
 }
 async enqueue(id,value){
  const kind=value.kind;check(KINDS.has(kind),'WORKSPACE_TASK_KIND_REQUIRED');
  const input={profileId:uuid(id),kind,...(value.callId===undefined?{}:{callId:uuid(value.callId)}),...(value.reviewId===undefined?{}:{reviewId:uuid(value.reviewId)})};
  let approvedBytes=null;
  if(kind==='inspect-lost-output'){
   check(typeof value.approvedRequestText==='string'&&Buffer.byteLength(value.approvedRequestText)<=32768,'ORIGINAL_APPROVED_REQUEST_JSON_REQUIRED');
   approvedBytes=Buffer.from(value.approvedRequestText);const original=parseJson(approvedBytes);
   check(original&&typeof original==='object'&&!Array.isArray(original),'ORIGINAL_APPROVED_REQUEST_JSON_REQUIRED');
   input.approvedRequestSha256=digest(approvedBytes);
  }
  if(kind==='recover-lost-output'){
   check(typeof value.transaction==='string'&&HASH.test(value.transaction),'ORIGINAL_TRANSACTION_HASH_REQUIRED');
   check(input.reviewId,'REVIEW_ORIGINAL_LOST_OUTPUT_FIRST',409);input.transaction=value.transaction;
  }
  const result=await this.mutate('task-queued',value,input,async next=>{
   const profile=this.profile(id,next);check(!profile.archived,'PASS_IS_ARCHIVED',409);check(next.tasks.length<MAX_TASKS,'WORKSPACE_TASK_LIMIT',429);
   check(next.tasks.filter(row=>ACTIVE.has(row.status)).length<256,'WORKSPACE_QUEUE_FULL',429);
   if(PURCHASE.has(kind)){
    check(profile.mode==='purchase'&&this.config.buyerWorkspace!==null,'ORIGINAL_PURCHASE_REQUIRED',409);
    check(!next.tasks.some(row=>row.profileId===id&&PURCHASE.has(row.kind)&&ACTIVE.has(row.status)),'PURCHASE_OPERATION_ACTIVE',409);
    if(kind==='execute-purchase')check(profile.review&&profile.review.id===input.reviewId,'REVIEW_ORIGINAL_PURCHASE_FIRST',409);
    if(kind==='recover-lost-output')check(profile.lostOutputAttempt?.id===input.reviewId,'REVIEW_ORIGINAL_LOST_OUTPUT_FIRST',409);
   }
   if(kind==='call'||kind==='recover'){
    const call=this.call(input.callId,next);check(call.profileId===id,'REQUEST_PASS_BINDING_CHANGED',409);
    check(kind!=='call'||!call.recoveryOnly,'ORIGINAL_REQUEST_INPUTS_NOT_RETAINED_USE_RECOVER',409);
    check(!next.tasks.some(row=>row.callId===call.id&&ACTIVE.has(row.status)),'REQUEST_OPERATION_ACTIVE',409);
   }else check(input.callId===undefined,'TASK_CALL_NOT_APPLICABLE');
   const taskId=randomUUID();
   if(approvedBytes!==null)await exactFile(join(this.config.directory,'inputs',taskId+'.approved-request.json'),approvedBytes);
   next.tasks.push({id:taskId,...input,status:'QUEUED',createdAt:now(),error:null,result:null});
   return {profileId:id,taskId,...(input.callId?{callId:input.callId}:{})};
  });
  this.pump();return result;
 }
 pump(){
  if(this.closed||this.closing||this.pumping)return;
  this.pumping=this.serial(()=>{
   while(!this.closing&&this.active.size<4){
    const nativeBusy=[...this.active.values()].some(slot=>PURCHASE.has(slot.kind));
    const candidate=this.state.tasks.find(row=>row.status==='QUEUED'&&!this.active.has(row.id)&&(!PURCHASE.has(row.kind)||!nativeBusy));
    if(!candidate)break;this.launch(candidate.id);
   }
  }).catch(()=>{}).finally(()=>{this.pumping=null;});
 }
 launch(id){
  const controller=new AbortController(),slot={controller,kind:this.task(id).kind,promise:null};this.active.set(id,slot);
  slot.promise=(async()=>{
   let task;
   try{
    task=await this.serial(async()=>{
     const next=clone(this.state),row=this.task(id,next);check(row.status==='QUEUED','TASK_IS_NOT_QUEUED',409);
     row.status='RUNNING';row.startedAt=now();row.observationSequence=next.revision+1;
     if(row.callId){const call=this.call(row.callId,next);call.status=row.kind==='recover'?'RECOVERING':'RUNNING';call.updatedAt=now();call.lastTaskId=id;}
     await this.commit(next);return clone(row);
    });
    const value=await this.dispatch(task,controller.signal);await this.finish(id,value,null);
   }catch(error){await this.finish(id,null,error).catch(()=>{});}
  })().finally(()=>{this.active.delete(id);this.pump();});
 }
 async dispatch(task,signal){
  const profile=clone(this.profile(task.profileId)),client=this.client(profile);
  if(task.kind==='refresh'){
   const detail=await client.inspect({signal});return {detail:safeDetail(detail),checkedAt:now()};
  }
  if(task.kind==='call'||task.kind==='recover'){
   const call=clone(this.call(task.callId)),output=join(this.config.directory,'results',task.id+'.bin');
   let result;
   if(task.kind==='call'){
    let bodyFile;
    if(call.body){bodyFile=join(this.config.directory,'bodies',call.body.sha256+'.bin');const bytes=await readBytes(bodyFile,MAX_BODY_BYTES);check(bytes.length===call.body.bytes&&digest(bytes)===call.body.sha256,'SAVED_REQUEST_BODY_CHANGED',409);}
    result=await client.call({route:call.routeId,requestId:call.requestId,method:call.method,query:call.query,
     ...(bodyFile===undefined?{}:{bodyFile}),contentType:call.contentType,output,signal});
   }else result=await client.recover(call.requestId,{output,signal});
   const metadata=clone(result.metadata);check(metadata.file===output,'ORIGINAL_RESULT_DESTINATION_CHANGED',409);
   let detail=null;try{detail=safeDetail(await client.inspect({signal}));}catch{}
   return {metadata,detail,checkedAt:detail?now():null};
  }
  const purchase=await this.purchase(profile,{create:task.kind==='prepare-purchase',signal});
  if(task.kind==='prepare-purchase')return {purchaseBinding:purchase.metadataSha256,native:publicNative(await purchase.inspect({signal}))};
  if(task.kind==='inspect-lost-output'){
   const inputFile=join(this.config.directory,'inputs',task.id+'.approved-request.json'),bytes=await readBytes(inputFile,32768);
   check(digest(bytes)===task.approvedRequestSha256,'ORIGINAL_APPROVED_REQUEST_CHANGED',409);
   const result=await purchase.inbox.inspectLostOutput(purchase.intentId,{workspaceDirectory:this.config.buyerWorkspace,approvedRequest:parseJson(bytes),signal});
   const snapshot=result.native.lostOutputAttempt;
   check(snapshot?.schema==='stellar-forge.sf88.lost-output-attempt.v1'&&snapshot.intentId===purchase.intentId&&
    snapshot.workspace===this.config.buyerWorkspace&&snapshot.queueRoot===purchase.metadata.inboxDirectory,'ORIGINAL_LOST_OUTPUT_REVIEW_BINDING_CHANGED',409);
   return {native:publicNative(result),lostOutputAttempt:{id:task.id,snapshot:clone(snapshot),approvedRequestSha256:task.approvedRequestSha256}};
  }
  if(task.kind==='recover-lost-output'){
   const review=profile.lostOutputAttempt;check(review?.id===task.reviewId,'ORIGINAL_LOST_OUTPUT_REVIEW_CHANGED',409);
   const bytes=await readBytes(join(this.config.directory,'inputs',review.id+'.approved-request.json'),32768);
   check(digest(bytes)===review.approvedRequestSha256,'ORIGINAL_APPROVED_REQUEST_CHANGED',409);
   const original=await purchase.inbox.recoverLostOutput(purchase.intentId,{workspaceDirectory:this.config.buyerWorkspace,
    transaction:task.transaction,approvedRequest:parseJson(bytes),expectedRequestSha256:review.snapshot.expectedRequestSha256,
    expectedAttemptId:review.snapshot.attemptId,expectedConfigSha256:review.snapshot.configSha256,signal});
   return {native:publicNative(original)};
  }
  if(task.kind==='read-lost-output'){
   const original=await purchase.inbox.readLostOutputRecovery(purchase.intentId,{workspaceDirectory:this.config.buyerWorkspace,signal});
   return {native:publicNative(original)};
  }
  if(task.kind==='export-lost-output'){
   const path=join(this.config.directory,'reports',task.id+'.proof.json');
   const original=await purchase.inbox.exportLostOutputProof(purchase.intentId,path,{workspaceDirectory:this.config.buyerWorkspace,signal});
   const file=original.native.lostOutputProof;
   check(file?.path===path&&HASH.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=65536,
    'ORIGINAL_LOST_OUTPUT_PROOF_METADATA_CHANGED',409);
   const bytes=await readBytes(path,65536);check(bytes.length===file.bytes&&digest(bytes)===file.sha256,'ORIGINAL_LOST_OUTPUT_PROOF_BYTES_CHANGED',409);
   check(file.proof?.intentId===purchase.intentId,'ORIGINAL_LOST_OUTPUT_PROOF_BINDING_CHANGED',409);
   return {native:publicNative(original),proof:{file:path,sha256:file.sha256,bytes:file.bytes,taskId:task.id}};
  }

  if(task.kind==='review-purchase'){
   const review=await purchase.review({signal}),path=join(this.config.directory,'reviews',task.id+'.json');
   const bytes=Buffer.from(JSON.stringify(review,null,2)+'\n');await exactFile(path,bytes);
   return {review:{id:task.id,sha256:digest(bytes),reviewedAt:review.reviewedAt},purchaseBinding:purchase.metadataSha256};
  }
  if(task.kind==='execute-purchase'){
   check(profile.review?.id===task.reviewId,'RETAINED_PURCHASE_REVIEW_CHANGED',409);
   const bytes=await readBytes(join(this.config.directory,'reviews',task.reviewId+'.json'),1048576);
   check(digest(bytes)===profile.review.sha256,'RETAINED_PURCHASE_REVIEW_CHANGED',409);
   const review=parseJson(bytes),value=await purchase.execute({review,signal});return {native:publicNative(value),purchaseBinding:purchase.metadataSha256};
  }
  if(task.kind==='recover-purchase')return {native:publicNative(await purchase.recover({signal})),purchaseBinding:purchase.metadataSha256};
  if(task.kind==='finalize-purchase')return {native:publicNative(await purchase.finalize({signal})),purchaseBinding:purchase.metadataSha256};
  if(task.kind==='report-purchase'){
   const path=join(this.config.directory,'reports',task.id+'.html');
   const value=await purchase.exportReport(path,{signal}),metadata=value.native;
   check(metadata?.path===path&&HASH.test(metadata.sha256??'')&&Number.isSafeInteger(metadata.bytes)&&metadata.bytes>=0&&metadata.bytes<=32*1024*1024,'ORIGINAL_REPORT_METADATA_CHANGED',409);
   const bytes=await readBytes(path,32*1024*1024);check(bytes.length===metadata.bytes&&digest(bytes)===metadata.sha256,'ORIGINAL_REPORT_BYTES_CHANGED',409);
   return {report:{taskId:task.id,file:path,bytes:metadata.bytes,sha256:metadata.sha256}};
  }
  fail('WORKSPACE_TASK_KIND_REQUIRED');
 }
 async finish(id,value,error){
  await this.serial(async()=>{
   const next=clone(this.state),task=this.task(id,next),profile=this.profile(task.profileId,next);
   if(!ACTIVE.has(task.status))return;
   task.finishedAt=now();task.status=error?'ATTENTION':'COMPLETED';task.error=error?rowError(error):null;
   profile.updatedAt=now();profile.error=error?task.error:null;
   if(error){task.result=null;}
   else{
    if(value.detail&&(task.observationSequence??0)>=(profile.detailSequence??0)){profile.detail=value.detail;profile.checkedAt=value.checkedAt;profile.detailSequence=task.observationSequence??0;}
    if(value.native)profile.native={...(profile.native??{}),...value.native};
    if(value.lostOutputAttempt)profile.lostOutputAttempt=value.lostOutputAttempt;
    if(value.purchaseBinding)profile.purchaseBinding=value.purchaseBinding;
    if(value.review)profile.review=value.review;
    task.result={...(value.metadata?{status:value.metadata.status,bytes:value.metadata.bytes,sha256:value.metadata.sha256,replayed:value.metadata.replayed}:{}),
     ...(value.native?{native:value.native}:{}),...(value.review?{review:value.review}:{}),...(value.detail?{refreshed:true}:{}),
     ...(value.report?{report:{bytes:value.report.bytes,sha256:value.report.sha256,downloadUrl:'/api/tasks/'+id+'/report'}}:{}),
     ...(value.proof?{proof:{bytes:value.proof.bytes,sha256:value.proof.sha256,downloadUrl:'/api/tasks/'+id+'/proof'}}:{}),
     ...(value.lostOutputAttempt?{lostOutputReview:{id:value.lostOutputAttempt.id}}:{})};
    if(value.report)task.report=value.report;
    if(value.proof)task.proof=value.proof;
   }
   if(task.callId){
    const call=this.call(task.callId,next);call.updatedAt=now();call.error=task.error;
    if(value?.metadata){
     call.result={...value.metadata,taskId:id};call.status='COMPLETED';
     call.history.push({at:now(),taskId:id,action:task.kind,status:value.metadata.status,sha256:value.metadata.sha256,replayed:value.metadata.replayed});
    }else{call.status='ATTENTION';call.history.push({at:now(),taskId:id,action:task.kind,error:task.error});}
    call.history=call.history.slice(-100);
   }
   this.history(next,'task-finished',{taskId:id,profileId:profile.id,status:task.status});await this.commit(next);
  });
 }
 async cancelTask(id,value){
  const result=await this.mutate('task-cancel-requested',value,{taskId:uuid(id)},async next=>{
   const task=this.task(id,next);
   if(task.status==='QUEUED'){task.status='CANCELLED';task.finishedAt=now();task.error={code:'CANCELLED_BEFORE_DISPATCH',at:now()};}
   else if(task.status==='RUNNING'||task.status==='CANCELLING')task.status='CANCELLING';
   return {taskId:id,profileId:task.profileId};
  });
  const slot=this.active.get(id);slot?.controller.abort();
  if(slot&&PURCHASE.has(slot.kind))await this.approvals?.revoke(this.profile(this.task(id).profileId).binding.intentId);
  return result;
 }
 async readTask(operation){
  this.assertAccepting();check(this.reads.size<16,'WORKSPACE_READ_LIMIT',429);const id=randomUUID(),controller=new AbortController();
  const promise=Promise.resolve().then(()=>operation(controller.signal));this.reads.set(id,{controller,promise});
  try{return await promise;}finally{this.reads.delete(id);}
 }
 async remoteCalls(id,{after,limit=100}={}){
  return this.readTask(async signal=>{const profile=clone(this.profile(id));
  const page=await this.client(profile).calls({after,limit,signal});
  check(page.schema==='stellar-forge.sf101.api-call-list.v1'&&page.orderRef===profile.binding.orderReference&&Array.isArray(page.calls),'ORIGINAL_CALL_PAGE_CHANGED',409);
  return {schema:page.schema,orderRef:page.orderRef,calls:page.calls.map(row=>safeCall(row,profile.binding.orderReference)),nextAfter:page.nextAfter??null,usage:clone(page.usage)};});
 }
 async recoverRemote(id,value){
  requestId(value.requestId);
  const profile=clone(this.profile(id));let selected=await this.readTask(async signal=>{let after,selected;
  do{
   const page=await this.client(profile).calls({after,limit:500,signal});
   check(page.orderRef===profile.binding.orderReference&&Array.isArray(page.calls),'ORIGINAL_CALL_PAGE_CHANGED',409);
   selected=page.calls.find(row=>row.requestId===value.requestId);
   if(selected||!page.nextAfter)break;
   check(typeof page.nextAfter==='string'&&(after===undefined||page.nextAfter>after),'ORIGINAL_CALL_CURSOR_DID_NOT_ADVANCE',409);after=page.nextAfter;
  }while(true);return selected;});
  check(selected,'ORIGINAL_REQUEST_NOT_FOUND',404);selected=safeCall(selected,profile.binding.orderReference);
  return this.mutate('original-request-adopted',value,{profileId:id,requestId:value.requestId,requestSha256:selected.requestSha256},async next=>{
   const prior=next.calls.find(row=>row.profileId===id&&row.requestId===selected.requestId);if(prior)return {profileId:id,callId:prior.id};
   check(next.calls.length<MAX_CALLS,'SAVED_REQUEST_LIMIT',429);
   const callId=randomUUID();next.calls.push({id:callId,profileId:id,requestId:selected.requestId,label:selected.requestId,
    routeId:selected.routeId,method:selected.method,path:selected.path,units:selected.units,query:[],contentType:'application/octet-stream',body:null,
    recoveryOnly:true,fingerprint:selected.requestSha256,createdAt:now(),updatedAt:now(),status:'RECOVERY_READY',remote:selected,result:null,error:null,history:[]});
   return {profileId:id,callId};
  });
 }
 async result(id){
  this.assertAccepting();const row=clone(this.call(id));check(row.result,'SAVED_RESULT_REQUIRED',404);
  uuid(row.result.taskId);const path=join(this.config.directory,'results',row.result.taskId+'.bin');
  check(path===row.result.file,'SAVED_RESULT_PATH_CHANGED',409);
  const bytes=await readBytes(path,MAX_RESULT_BYTES);check(bytes.length===row.result.bytes&&digest(bytes)===row.result.sha256,'SAVED_RESULT_BYTES_CHANGED',409);
  return {bytes,metadata:{status:row.result.status,bytes:row.result.bytes,sha256:row.result.sha256,requestId:row.requestId,routeId:row.routeId,
   contentType:row.remote?.result?.contentType??'application/octet-stream'},name:row.routeId+'-'+row.requestId+'.bin'};
 }
 async body(id){
  this.assertAccepting();const row=clone(this.call(id));if(!row.body)return {bytes:Buffer.alloc(0),present:false};
  const bytes=await readBytes(join(this.config.directory,'bodies',row.body.sha256+'.bin'),MAX_BODY_BYTES);
  check(bytes.length===row.body.bytes&&digest(bytes)===row.body.sha256,'SAVED_REQUEST_BODY_CHANGED',409);
  return {bytes,present:true};
 }
 async approval(id){
  this.assertAccepting();const profile=this.profile(id);check(profile.mode==='purchase','ORIGINAL_PURCHASE_REQUIRED',409);
  return {intentId:profile.binding.intentId,approval:this.approvals?await this.approvals.snapshot(profile.binding.intentId):null,
   pending:false,fresh:true,mode:this.approvals?'ORIGINAL_BROWSER_BROKER':'ORIGINAL_TERMINAL'};
 }
 async decide(id,value){
  this.assertAccepting();const profile=this.profile(id);check(this.approvals,'ORIGINAL_BROWSER_APPROVAL_UNAVAILABLE',409);
  check(value.intent===profile.binding.intentId,'APPROVAL_INTENT_CHANGED',409);
  check(['approve','reject'].includes(value.decision),'ORIGINAL_APPROVAL_DECISION_REQUIRED');
  return this.approvals.decide({intent:value.intent,approvalId:value.approvalId,requestSha256:value.requestSha256,decision:value.decision});
 }
 async reviewDocument(id){
  this.assertAccepting();const profile=clone(this.profile(id));check(profile.review,'ORIGINAL_PURCHASE_REVIEW_REQUIRED',404);
  const bytes=await readBytes(join(this.config.directory,'reviews',uuid(profile.review.id)+'.json'),1048576);
  check(digest(bytes)===profile.review.sha256,'RETAINED_PURCHASE_REVIEW_CHANGED',409);
  return {bytes,metadata:{sha256:profile.review.sha256,bytes:bytes.length},name:'api-pass-original-purchase-review.json'};
 }
 async proof(id){
  this.assertAccepting();const task=clone(this.task(id));check(task.proof,'ORIGINAL_PAYMENT_PROOF_REQUIRED',404);
  const path=join(this.config.directory,'reports',uuid(id)+'.proof.json');check(task.proof.file===path,'ORIGINAL_PAYMENT_PROOF_PATH_CHANGED',409);
  const bytes=await readBytes(path,65536);check(bytes.length===task.proof.bytes&&digest(bytes)===task.proof.sha256,'ORIGINAL_PAYMENT_PROOF_BYTES_CHANGED',409);
  return {bytes,metadata:{sha256:task.proof.sha256,bytes:task.proof.bytes},name:'api-pass-original-payment-proof.json'};
 }
 async report(id){
  this.assertAccepting();const task=clone(this.task(id));check(task.report,'ORIGINAL_REPORT_REQUIRED',404);
  const path=join(this.config.directory,'reports',uuid(id)+'.html');check(task.report.file===path,'ORIGINAL_REPORT_PATH_CHANGED',409);
  const bytes=await readBytes(path,32*1024*1024);check(bytes.length===task.report.bytes&&digest(bytes)===task.report.sha256,'ORIGINAL_REPORT_BYTES_CHANGED',409);
  return {bytes,metadata:{sha256:task.report.sha256,bytes:task.report.bytes},name:'api-pass-purchase-report.html'};
 }
 async exportMetadata(id){
  return this.serial(()=>({schema:'stellar-forge.sf101.api-pass-customer-history.v1',exportedAt:now(),
   profile:this.profileView(this.profile(id)),calls:this.state.calls.filter(row=>row.profileId===id).map(row=>this.callView(row)),
   tasks:this.state.tasks.filter(row=>row.profileId===id).map(row=>this.taskView(row)),revision:this.state.revision}));
 }
 async close(){
  if(this.closed)return;if(this.closing)return this.closingPromise;
  this.closing=true;
  return this.closingPromise=(async()=>{
   await this.pumping;
   for(const slot of this.reads.values())slot.controller.abort();
   for(const [id,slot]of this.active){slot.controller.abort();if(PURCHASE.has(slot.kind))await Promise.resolve(this.approvals?.revoke(this.profile(this.task(id).profileId).binding.intentId)).catch(()=>{});}
   await Promise.allSettled([...this.active.values(),...this.reads.values()].map(slot=>slot.promise));await this.tail;
   this.closed=true;await this.approvals?.close();await this.lease.close();this.removeAllListeners();
  })();
 }
}
