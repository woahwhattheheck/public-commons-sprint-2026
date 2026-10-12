// MIT. Merchant MCP control of the existing original API-pass customer workspace.
import {ApiPassWorkspaceHttpClient} from './api-pass-connection.mjs';
import {ApiPassFileExports} from './api-pass-exports.mjs';
import {ApiPassOperationJournal} from './api-pass-operations.mjs';
import {API_PASS_PREFIX,API_PASS_MAX_FILE_BYTES,API_PASS_SHA,API_PASS_UUID,API_PASS_FILE_NAMES,apiPassWorkspaceTools,apiPassArguments,
 apiPassNeed,apiPassFailure,apiPassPlain,apiPassHash,apiPassFingerprint} from './api-pass-protocol.mjs';
export {apiPassWorkspaceTools};
const path=id=>encodeURIComponent(id);
const profilePath=id=>'/api/profiles/'+path(id);
const clone=value=>structuredClone(value);
function revision(value,expected){
 apiPassNeed(Number.isSafeInteger(value)&&value>=1,'The original result has no valid workspace revision.','API_PASS_NATIVE_REVISION_INVALID');
 if(expected!==undefined)apiPassNeed(value===expected,'The original workspace changed between these selected pages. Reopen its current inventory.','API_PASS_OBSERVATION_CHANGED');
 return value;
}
function profileSummary(row){
 return Object.fromEntries(['id','label','archived','mode','createdAt','updatedAt','orderReference','gatewayBaseUrl','manifestSha256','claimEnv','claimAvailable','intentId','purchasePrepared','checkedAt','error','callCount']
  .filter(key=>Object.hasOwn(row,key)).map(key=>[key,clone(row[key])]));
}
function page(items,{offset=0,limit=100}={}){const selected=items.slice(offset,offset+limit);return {items:selected,offset,limit,total:items.length,nextOffset:offset+selected.length<items.length?offset+selected.length:null};}
function nativeError(error,mutation=false){
 const code=/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'API_PASS_OPERATION_FAILED';
 return apiPassFailure(code,error?.apiPassPublic===true?error.message:'The selected API-pass operation returned '+code+'. Check the original host connection and retained state.',
  {...(Number.isInteger(error?.status)?{status:error.status}:{}),...(mutation||typeof error?.outcomeUnknown==='boolean'?{outcomeUnknown:error?.outcomeUnknown??false}:{})});
}
export class MerchantApiPassWorkspaces{
 #clients=new Map();#exports=new Map();#operations=new Map();#pending=new Set();#closing=false;#close;
 constructor(config){
  for(const [alias,definition]of Object.entries(config.apiPassWorkspaces?.workspaces??{})){this.#clients.set(alias,new ApiPassWorkspaceHttpClient(definition));this.#exports.set(alias,new ApiPassFileExports(alias,definition));this.#operations.set(alias,new ApiPassOperationJournal(alias,definition));}
 }
 get summary(){return {configured:this.#clients.size>0,closing:this.#closing,pendingRequests:this.#pending.size,workspaces:[...this.#clients].map(([alias,client])=>({alias,label:client.definition.label,workspaceId:client.definition.workspaceId,
  sourcePinned:Boolean(client.definition.expectedEntrySha256),inputs:Object.entries(client.definition.files).map(([handle,file])=>({handle,label:file.label,kind:file.kind,sha256:file.sha256})),
  purchases:Object.entries(client.definition.purchases).map(([handle,purchase])=>({handle,label:purchase.label,intentId:purchase.intentId,orderReference:purchase.orderReference,customerSha256:purchase.customerSha256})),exports:this.#exports.get(alias).summary}))};}
 #client(alias){const value=this.#clients.get(alias);apiPassNeed(value,'Choose a configured original API-pass workspace alias.','API_PASS_WORKSPACE_NOT_CONFIGURED');return value;}
 async #history(client,profileId){
  const reply=await client.json(profilePath(profileId)+'/export',{},API_PASS_MAX_FILE_BYTES),value=reply.native;
  apiPassNeed(value.schema==='stellar-forge.sf101.api-pass-customer-history.v1'&&value.profile?.id===profileId&&Array.isArray(value.calls)&&Array.isArray(value.tasks)&&value.calls.every(row=>row.profileId===profileId)&&value.tasks.every(row=>row.profileId===profileId),'The complete original history belongs to another pass.','API_PASS_HISTORY_BINDING');
  revision(value.revision);return reply;
 }
 async #task(client,profileId,taskId){
  const reply=await this.#history(client,profileId),task=reply.native.tasks.find(row=>row.id===taskId);
  apiPassNeed(task,'The exact task is absent from this original pass history.','TASK_NOT_FOUND');return {task,revision:reply.native.revision};
 }
 async #capture(client,selection){
  let route,expected,nativeRevision=null;
  if(selection.kind==='response'){
   const detail=(await client.json('/api/calls/'+path(selection.callId))).native;
   apiPassNeed(detail.call?.id===selection.callId&&detail.call.result&&API_PASS_SHA.test(detail.call.result.sha256??''),'The original request has no retained complete response.','ORIGINAL_RESPONSE_REQUIRED');
   route='/api/calls/'+path(selection.callId)+'/result';expected=detail.call.result;nativeRevision=revision(detail.revision);
  }else if(selection.kind==='review'){
   const detail=(await client.json(profilePath(selection.profileId)+'?limit=1')).native;
   apiPassNeed(detail.profile?.id===selection.profileId&&detail.profile.review&&API_PASS_SHA.test(detail.profile.review.sha256??''),'The original purchase has no saved complete review.','ORIGINAL_PURCHASE_REVIEW_REQUIRED');
   route=profilePath(selection.profileId)+'/review';expected=detail.profile.review;nativeRevision=revision(detail.revision);
  }else if(selection.kind==='proof'||selection.kind==='report'){
   const selected=await this.#task(client,selection.profileId,selection.taskId),metadata=selected.task.result?.[selection.kind];
   apiPassNeed(metadata&&API_PASS_SHA.test(metadata.sha256??'')&&Number.isSafeInteger(metadata.bytes),'The original selected task has no complete '+selection.kind+'.','ORIGINAL_TASK_FILE_REQUIRED');
   expected=metadata;nativeRevision=selected.revision;route='/api/tasks/'+path(selection.taskId)+'/'+selection.kind;
  }else route=profilePath(selection.profileId)+'/export';
  const reply=await client.request(route,{},selection.kind==='report'?32*1024*1024:selection.kind==='proof'?65536:selection.kind==='review'?1048576:selection.kind==='response'?4*1024*1024:API_PASS_MAX_FILE_BYTES);
  const hash=apiPassHash(reply.bytes),header=reply.headers.get('x-sf101-result-sha256');
  if(selection.kind==='history'){
   let history;try{history=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reply.bytes));}catch{throw apiPassFailure('API_PASS_HISTORY_INVALID','The complete native history is invalid UTF-8 JSON.');}
   apiPassNeed(history.schema==='stellar-forge.sf101.api-pass-customer-history.v1'&&history.profile?.id===selection.profileId&&Array.isArray(history.calls)&&Array.isArray(history.tasks)&&history.calls.every(row=>row.profileId===selection.profileId)&&history.tasks.every(row=>row.profileId===selection.profileId),'The complete native history changed profile identity.','API_PASS_HISTORY_BINDING');
   nativeRevision=revision(history.revision);
   apiPassNeed(header===null||header===hash,'The native history digest differs from its complete bytes.','API_PASS_ORIGINAL_FILE_CHANGED');
  }else apiPassNeed(API_PASS_SHA.test(header??'')&&header===hash&&expected.sha256===hash&&(expected.bytes===undefined||expected.bytes===reply.bytes.length),'The selected original file, native digest header or exact byte count changed.','API_PASS_ORIGINAL_FILE_CHANGED');
  const contentType=reply.headers.get('content-type')??'application/octet-stream';
  apiPassNeed(contentType.length<=255&&!/[\r\n\0]/.test(contentType),'The original file has invalid media metadata.','API_PASS_ORIGINAL_FILE_CHANGED');
  return {bytes:reply.bytes,contentType,source:{instanceId:reply.connection.instanceId,launchSha256:reply.connection.launchSha256,entrySha256:reply.connection.entrySha256,path:route,
   observedAt:new Date().toISOString(),nativeSha256:header,revision:nativeRevision}};
 }
 async #post(client,route,body,{purchase,profileId}={}){
  let received=false;
  try{
   const reply=await client.json(route,{body}),value=reply.native;received=true;
   if(profileId&&value.result.profileId!==undefined)apiPassNeed(value.result.profileId===profileId,'The original operation returned another profile.','API_PASS_RESULT_BINDING');
   if(purchase){const profile=value.state.profiles?.find(row=>row.id===value.result.profileId);
    apiPassNeed(profile?.intentId===purchase.intentId&&profile?.orderReference===purchase.orderReference,'The adopted original purchase differs from its declared intent or order.','API_PASS_PURCHASE_BINDING');}
   return {result:value.result,revision:revision(value.state.revision)};
  }catch(error){if(received)error.outcomeUnknown=true;throw error;}
 }
 async #resolveMutation(client,kind,args){
  const {workspace,profileId,callId,taskId,...rest}=args;let route,body=rest,binding=profileId?{profileId}:null;
  switch(kind){
   case 'connect':route='/api/passes/connect';break;
   case 'purchase_prepare':{
    const {handoff,expectedHandoffSha256,...original}=rest,source=await client.input(handoff,'handoff',expectedHandoffSha256);
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(source.bytes);}catch{throw apiPassFailure('API_PASS_HANDOFF_INVALID','The complete original handoff must be UTF-8 JSON.');}
    body={...original,handoff:text};route='/api/purchases/prepare';break;
   }
   case 'purchase_attach':{
    const {purchase:name,...original}=rest,purchase=await client.purchase(name);
    body={...original,purchaseDirectory:purchase.directory};route='/api/purchases/attach';
    binding={purchase:{intentId:purchase.intentId,orderReference:purchase.orderReference},purchaseHandle:name};break;
   }
   case 'update':route=profilePath(profileId)+'/update';break;
   case 'prepare_request':{
    const {bodyFile,expectedBodySha256,...original}=rest;
    const bytes=bodyFile===undefined?null:(await client.input(bodyFile,'body',expectedBodySha256)).bytes;
    body={...original,bodyBase64:bytes===null?null:bytes.toString('base64')};route=profilePath(profileId)+'/calls';break;
   }
   case 'adopt_request':route=profilePath(profileId)+'/adopt-request';break;
   case 'enqueue':{
    const {approvedRequestFile,expectedApprovedRequestSha256,...original}=rest;body=original;
    if(callId!==undefined)body.callId=callId;
    if(approvedRequestFile!==undefined){const source=await client.input(approvedRequestFile,'approved-request',expectedApprovedRequestSha256);
     try{body.approvedRequestText=new TextDecoder('utf-8',{fatal:true}).decode(source.bytes);}catch{throw apiPassFailure('API_PASS_APPROVED_REQUEST_INVALID','The complete original approved request must be UTF-8 JSON.');}}
    route=profilePath(profileId)+'/tasks';break;
   }
   case 'cancel':route='/api/tasks/'+path(taskId)+'/cancel';break;
   case 'decide':route=profilePath(profileId)+'/approval';break;
   default:throw apiPassFailure('TOOL_NOT_FOUND','Choose an original API-pass mutation.');
  }
  return {route,body,binding};
 }
 async #mutate(client,kind,args){
  return this.#operations.get(args.workspace).run(kind,args,()=>this.#resolveMutation(client,kind,args),async request=>{
   const result=await this.#post(client,request.route,request.body,request.binding??{});
   if(request.binding?.purchaseHandle)try{await client.purchase(request.binding.purchaseHandle);}catch(error){error.outcomeUnknown=true;throw error;}
   return result;
  });
 }
 async #execute(name,args){
  const kind=name.slice(API_PASS_PREFIX.length);if(kind==='workspaces')return this.summary;
  const client=this.#client(args.workspace),exports=this.#exports.get(args.workspace);
  const {workspace,profileId,callId,taskId,...rest}=args;
  let native;
  switch(kind){
   case 'open':{const reply=await client.json('/api/session');native={session:reply.native,launch:reply.connection};break;}
   case 'status':{
    const state=(await client.json('/api/state')).native;
    apiPassNeed(Array.isArray(state.profiles)&&Array.isArray(state.tasks)&&Array.isArray(state.history),'The original state inventory is invalid.','API_PASS_NATIVE_STATE_INVALID');
    native={schema:state.schema,id:state.id,title:state.title,revision:revision(state.revision),purchaseEnabled:state.purchaseEnabled,approvalMode:state.approvalMode,claimEnvs:state.claimEnvs,
     counts:{passes:state.profiles.length,savedCalls:state.profiles.reduce((n,row)=>n+row.callCount,0)},recentTasks:state.tasks,recentHistory:state.history,
     windows:{tasks:150,history:100},completeProfileHistory:true,exports:exports.summary};break;
   }
   case 'passes':{const state=(await client.json('/api/state')).native;apiPassNeed(Array.isArray(state.profiles),'The native pass inventory is invalid.','API_PASS_NATIVE_STATE_INVALID');native={revision:revision(state.revision,args.expectedRevision),...page(state.profiles.map(profileSummary),args)};break;}
   case 'pass':{
    native=(await client.json(profilePath(profileId)+'?offset='+(args.offset??0)+'&limit='+(args.limit??100))).native;
    apiPassNeed(native.profile?.id===profileId,'The original pass detail belongs to another profile.','API_PASS_RESULT_BINDING');revision(native.revision,args.expectedRevision);break;
   }
   case 'call':native=(await client.json('/api/calls/'+path(callId))).native;apiPassNeed(native.call?.id===callId,'The native request identity changed.','API_PASS_RESULT_BINDING');break;
   case 'call_preview':native=(await client.json('/api/calls/'+path(callId)+'/preview')).native;break;
   case 'body_preview':native=(await client.json('/api/calls/'+path(callId)+'/body')).native;break;
   case 'remote_calls':native=(await client.json(profilePath(profileId)+'/remote-calls?limit='+(args.limit??100)+(args.after===undefined?'':'&after='+encodeURIComponent(args.after)))).native;break;
   case 'history':{const value=(await this.#history(client,profileId)).native;native={profileId,view:args.view,revision:revision(value.revision,args.expectedRevision),...page([...value[args.view]].reverse(),args)};break;}
   case 'task':native=await this.#task(client,profileId,taskId);break;
   case 'operation':native=await this.#operations.get(workspace).read(args.operationId);break;
   case 'approval':native=(await client.json(profilePath(profileId)+'/approval')).native;break;
   case 'input':native=(await client.input(args.file)).source;break;
   case 'connect':case 'purchase_prepare':case 'purchase_attach':case 'update':case 'prepare_request':case 'adopt_request':case 'enqueue':case 'cancel':case 'decide':
    native=await this.#mutate(client,kind,args);break;
   case 'capture':native=await exports.capture(rest,selection=>this.#capture(client,selection));break;
   case 'exports':native=await exports.list(rest);break;
   case 'manifest':native=await exports.manifest(args.exportId);break;
   case 'file':native=await exports.file(rest);break;
   case 'file_release':await exports.release(args.exportId,args.readId);native={exportId:args.exportId,readId:args.readId,released:true};break;
   default:throw apiPassFailure('TOOL_NOT_FOUND','Choose an original API-pass operation.');
  }
  const result={workspace,workspaceId:client.definition.workspaceId,native};
  apiPassNeed(Buffer.byteLength(JSON.stringify(result))<=900000,'Use a smaller original page or capture its complete native history file.','API_PASS_REPLY_REQUIRES_FILE');
  return result;
 }
 call(name,input={}){
  apiPassNeed(!this.#closing,'The API-pass adapter is draining accepted requests.','API_PASS_CLOSING');
  apiPassNeed(this.#pending.size<32,'Finish an existing original operation before opening another request.','API_PASS_REQUEST_CAPACITY');
  if(!name.startsWith(API_PASS_PREFIX))name=API_PASS_PREFIX+name;
  const args=apiPassArguments(name,input),mutation=['connect','purchase_prepare','purchase_attach','update','prepare_request','adopt_request','enqueue','cancel','decide'].includes(name.slice(API_PASS_PREFIX.length));
  const promise=Promise.resolve().then(()=>this.#execute(name,args)).catch(error=>{throw nativeError(error,mutation);});
  this.#pending.add(promise);promise.finally(()=>this.#pending.delete(promise)).catch(()=>{});return promise;
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;
  return this.#close=(async()=>{await Promise.allSettled([...this.#pending]);const results=await Promise.allSettled([...this.#exports.values(),...this.#operations.values()].map(value=>value.close()));if(results.some(row=>row.status==='rejected'))throw apiPassFailure('API_PASS_CLOSE_INCOMPLETE','One retained file reader did not finish closing.');})();
 }
}
