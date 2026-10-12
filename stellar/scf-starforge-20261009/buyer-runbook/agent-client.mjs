// MIT. Complete agent workflow over the original running Buyer application.
import {resolve,dirname,isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {BuyerWorkspaceConnection,readBuyerAgentConfiguration,hash,encode,parse} from './agent-connection.mjs';
import {BuyerAgentStorage,originalFilePath,BUYER_AGENT_MANIFEST} from './agent-storage.mjs';
import {createRetainedDownload,openMerchantFileClient} from '../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {BUYER_AGENT_SCHEMA,BUYER_AGENT_CONFIGURATION,BUYER_AGENT_PREFIX,BUYER_AGENT_EXPORT,BUYER_AGENT_ACTIONS,
 buyerAgentArguments,buyerRunbookWorkspaceTools,SHA,plain,need,fail} from './agent-contract.mjs';
export {buyerRunbookWorkspaceTools,readBuyerAgentConfiguration};
const clone=value=>structuredClone(value);
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const publicError=error=>fail(/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'BUYER_AGENT_OPERATION_FAILED',
 error?.buyerAgentPublic?error.message:'The original Buyer operation returned an error. Read its retained native state.',
 {...(Number.isInteger(error?.status)?{status:error.status}:{}),...(typeof error?.outcomeUnknown==='boolean'?{outcomeUnknown:error.outcomeUnknown}:{}),
 ...(error?.requestId?{requestId:error.requestId}:{}),...(error?.journalWriteUncertain?{journalWriteUncertain:true}:{})});
function inventory(state,collection){
 const items={drafts:state.drafts,acquisitions:state.acquisitions,configurations:state.configurations,
  requests:state.intake?.requests,clients:state.intake?.clients?.clients,paidFiles:state.paidFiles?.requests,recovery:state.recovery?.history}[collection];
 need(Array.isArray(items),'BUYER_AGENT_NATIVE_STATE_INVALID','The original workspace returned an invalid selected inventory.');
 return items;
}
function page(items,{offset=0,limit=100,expectedStateSha256}={}){
 const stateSha256=hash(encode(items));
 need(expectedStateSha256===undefined||stateSha256===expectedStateSha256,'BUYER_AGENT_OBSERVATION_CHANGED','The original selected inventory changed. Read its current first page.');
 const selected=items.slice(offset,offset+limit);
 return {items:selected,offset,limit,total:items.length,nextOffset:offset+selected.length<items.length?offset+selected.length:null,stateSha256};
}
function status(state){
 const counts=Object.fromEntries(['drafts','acquisitions','configurations','requests','clients','paidFiles','recovery'].map(name=>[name,inventory(state,name).length]));
 return {directory:state.directory,configsDirectory:state.configsDirectory,active:state.active,
  terminalAvailable:state.terminalAvailable,approvalMode:state.approvalMode,approvalAvailable:state.approvalAvailable,
  recoveryActive:state.recovery?.active,counts,errors:state.errors,
  requestErrors:state.intake?.errors,paidFileErrors:state.paidFiles?.errors,
  operatorSettingsSha256:state.intake?.operatorSettingsSha256,operatorError:state.intake?.presetError};
}
function nativePath(spec,args){return typeof spec.path==='function'?spec.path(args):spec.path;}
async function beforeAction(client,name,body){
 if(name==='review_request'||name==='review_paid_file')
  return (await client.json('/api/'+(name==='review_request'?'requests':'paid-files')+'/'+body.id)).native;
 if(['execute','finalize','cancel','unlock','retrieve_file','reset_file'].includes(name))return (await client.json('/api/runs/'+body.id)).native;
 if(name==='backup_start'||name==='backup_cancel')return (await client.json('/api/state')).native.recovery;
 return null;
}
async function bodyFor(client,spec,args){
 const name=spec.name;
 let body=without(args,['workspace','requestId']);
 if(spec.sourceKind){
  const settings=spec.sourceKind==='settings',profile=spec.sourceKind==='backup-profile';
  const handle=settings?args.settings:profile?args.profile:args.file;
  const expected=settings?args.expectedSettingsSha256:profile?args.expectedProfileSha256:args.expectedSha256;
  const input=await client.input(handle,spec.sourceKind,expected);
  if(settings)body={...without(body,['settings','expectedSettingsSha256']),settings:parse(input.bytes)};
  else if(profile){
   const value=parse(input.bytes);
   need(!['kind','expectedReviewSha256','quiesced','requestId','workspace'].some(key=>Object.hasOwn(value,key)),
    'BUYER_AGENT_PROFILE_CONFLICT','Keep action and review selection in the original request, separate from host backup paths.');
   body={...value,...without(body,['profile','expectedProfileSha256'])};
   if(name==='backup_start'&&body.kind==='SNAPSHOT')
    need(body.quiesced===true&&SHA.test(body.expectedReviewSha256??''),'INVALID_PARAMS','Review the original complete snapshot and confirm its quiesced selection.');
  }else{
   body=name==='receive_client'?{base64:input.bytes.toString('base64')}:
    name==='client_file'?{id:args.id,file:args.name,base64:input.bytes.toString('base64')}:
    {filename:args.filename,base64:input.bytes.toString('base64')};
  }
 }
 if(name==='client_request'&&args.ticket){
  const input=await client.input(args.ticket.file,'ticket',args.ticket.expectedSha256);
  body.ticket={base64:input.bytes.toString('base64'),...(args.ticket.header?{header:args.ticket.header}:{})};
 }
 if(name==='bind_accounting'){
  const workspace=client.definition.operators[args.operator];
  need(workspace,'BUYER_AGENT_OPERATOR_NOT_CONFIGURED','Select a host-declared original accounting operator.');
  body={...without(body,['operator']),workspace};
 }
 if(name==='save_draft'){
  const launch=await client.selected(),root=launch.selection.configsDirectory;
  body.manifest={...body.manifest,operations:body.manifest.operations.map(operation=>{
   const path=resolve(root,operation.config);
   need(dirname(path)===root,'INVALID_PARAMS','Use original configurations directly inside the selected native directory.');
   return {...operation,config:path};
  })};
 }
 return {body,path:nativePath(spec,args),before:await beforeAction(client,name,body)};
}
async function reconcileNative(client,record,selectedId){
 const name=record.action,body=record.body;let result,matched=false;
 if(name==='save_draft'){
  const id=body.id??selectedId;
  need(typeof id==='string'&&/^draft-[a-f0-9-]{36}$/.test(id),'INVALID_PARAMS','Select the saved original draft from the native draft inventory.');
  result=await client.json('/api/drafts/'+id+'/'+(body.expectedRevision+1));
  matched=result.native.id===id&&result.native.revision===body.expectedRevision+1&&isDeepStrictEqual(result.native.manifest,body.manifest);
 }else if(name==='review_request'||name==='review_paid_file'){
  result=await client.json('/api/'+(name==='review_request'?'requests':'paid-files')+'/'+body.id);
  const review=result.native.review;
  const expected=name==='review_request'?(record.before?.review?.revision??0)+1:body.expectedRevision+1;
  const keys=name==='review_request'?['id','acceptIndex','totalAtomic','dailyAtomic']:['id','totalAtomic','dailyAtomic','filename','claimEnv'];
  matched=review?.revision===expected&&keys.every(key=>review[key]===body[key])&&
   result.native.handoffSha256===record.before?.handoffSha256;
 }else if(['execute','finalize','retrieve_file','reset_file','cancel','unlock'].includes(name)){
  result=await client.json('/api/runs/'+body.id);const current=result.native.active;
  if(name==='cancel')matched=current?.runId===body.id&&current.executionId===body.executionId&&(current.cancelRequested===true||Boolean(current.finishedAt));
  else if(name==='unlock')matched=result.native.state?.executionLock===null;
  else{
   const kind={execute:'BUYER',finalize:'ACCOUNTING',retrieve_file:'PAID_FILE_RETRIEVE',reset_file:'PAID_FILE_RESET'}[name];
   const began=Date.parse(record.attempts[0]?.startedAt??record.createdAt);
   matched=current?.runId===body.id&&current.kind===kind&&current.only===(body.only??null)&&
    Date.parse(current.startedAt)>=began&&current.executionId!==record.before?.active?.executionId;
   if(!matched&&name==='execute'){
    // A completed original intent may survive a host reopen after its transient
    // launch response is gone. This is a native postimage, never a forged reply.
    const rows=result.native.state?.operations??[],old=record.before?.state?.operations??[];
    const chosen=body.only?rows.filter(row=>row.id===body.only):rows;
    matched=isDeepStrictEqual(result.native.state?.plan,record.before?.state?.plan)&&chosen.length>0&&chosen.every(row=>{
     const previous=old.find(item=>item.id===row.id);
     return row.state!=='UNATTEMPTED'&&row.started&&previous?.state==='UNATTEMPTED'&&
      Date.parse(row.started.at)>=began&&row.intentId===previous.intentId;
    });
   }
  }
 }else if(name==='backup_start'||name==='backup_cancel'){
  result=await client.json('/api/state');const current=result.native.recovery?.active;
  if(name==='backup_cancel')matched=current?.id===body.id&&(current.cancelRequested===true||Boolean(current.finishedAt));
  else if(body.kind==='SNAPSHOT'){
   const previous=new Set((record.before?.history??[]).map(item=>item.recordSha256));
   const selected=(result.native.recovery?.history??[]).filter(item=>!item.error&&
    item.directory===client.definition.directory&&item.reviewSha256===body.expectedReviewSha256&&
    typeof body.output==='string'&&item.bundle===resolve(body.output)&&
    (body.stateRoot===undefined||item.stateRoot===resolve(body.stateRoot))&&
    SHA.test(item.recordSha256??'')&&!previous.has(item.recordSha256));
   matched=selected.length===1;
   result={...result,native:{...result.native.recovery,selectedSnapshot:selected.length===1?selected[0]:null}};
  }else{
   matched=current?.kind==='VERIFY'&&current.status==='FINISHED'&&typeof body.bundle==='string'&&
    current.result?.bundle===resolve(body.bundle)&&current.id!==record.before?.active?.id&&
    Date.parse(current.startedAt)>=Date.parse(record.attempts[0]?.startedAt??record.createdAt);
  }
  if(result.native.recovery)result={...result,native:result.native.recovery};
 }else{
  throw fail('BUYER_AGENT_RECONCILIATION_NOT_NEEDED','Resume this original native idempotent preparation with its saved request ID.');
 }
 return {matched,basis:'NATIVE_POSTIMAGE',native:result.native,connection:result.connection};
}
function parseExport(bytes,exportId){
 const value=parse(bytes,'BUYER_AGENT_EXPORT_INVALID');
 need(value.schema===BUYER_AGENT_EXPORT&&value.exportId===exportId&&SHA.test(value.selectionSha256??'')&&
  typeof value.directory==='string'&&isAbsolute(value.directory)&&Array.isArray(value.files)&&value.files.length>=1&&value.files.length<=64,
  'BUYER_AGENT_EXPORT_INVALID','Read the complete original Buyer file manifest.');
 const names=new Set();
 for(const file of value.files){
  need(typeof file.name==='string'&&/^[0-9]{3}-[A-Za-z0-9_.-]{1,250}$/.test(file.name)&&!names.has(file.name)&&
   Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=8*1024*1024*1024&&SHA.test(file.sha256??''),
   'BUYER_AGENT_EXPORT_INVALID','The original manifest contains an invalid or duplicate retained file.');
  names.add(file.name);
 }
 need(value.files.reduce((n,file)=>n+file.bytes,0)<=32*1024*1024*1024,'BUYER_AGENT_EXPORT_INVALID','The original export exceeds supported receiving capacity.');
 return value;
}
const retainedDownload=createRetainedDownload({
 manifestName:BUYER_AGENT_MANIFEST,parseManifest:parseExport,maximumBytes:8*1024*1024*1024,
 stateSchema:'stellar-forge.buyer-runbook.agent-download.v1',resultSchema:'stellar-forge.buyer-runbook.agent-download-result.v1',
 toolPrefix:BUYER_AGENT_PREFIX.slice(0,-1),errorPrefix:'BUYER_AGENT',clientName:'stellar-forge-buyer-runbook',
 describe:manifest=>({workspaceDirectory:manifest.directory,selectionSha256:manifest.selectionSha256}),
 validateExportId:value=>need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'INVALID_PARAMS','Select the original export identifier.')
});
export class BuyerRunbookAgent{
 #clients=new Map();#stores=new Map();#pending=new Set();#downloads=new Set();#closing=false;#close;
 constructor(configuration){
  need(configuration?.schema===BUYER_AGENT_CONFIGURATION&&plain(configuration.workspaces),'BUYER_AGENT_CONFIGURATION','Load the original normalized Buyer agent configuration.');
  for(const [alias,definition]of Object.entries(configuration.workspaces)){
   this.#clients.set(alias,new BuyerWorkspaceConnection(definition));this.#stores.set(alias,new BuyerAgentStorage(definition));
  }
 }
 static async fromFile(path){return new BuyerRunbookAgent(await readBuyerAgentConfiguration(path));}
 get summary(){
  return {configured:this.#clients.size>0,closing:this.#closing,pendingRequests:this.#pending.size,
   workspaces:[...this.#clients].map(([alias,client])=>({alias,label:client.definition.label,
    directory:client.definition.directory,selectionSha256:client.definition.expectedSelectionSha256,
    inputs:Object.entries(client.definition.files).map(([handle,file])=>({handle,label:file.label,kind:file.kind,sha256:file.sha256})),
    operators:Object.keys(client.definition.operators),receiving:this.#stores.get(alias).summary}))};
 }
 #client(alias){const client=this.#clients.get(alias);need(client,'BUYER_AGENT_WORKSPACE_NOT_CONFIGURED','Choose a configured original Buyer workspace alias.');return client;}
 async #execute(name,input,options){
  if(name===BUYER_AGENT_PREFIX+'workspaces'||name==='workspaces'){
   need(plain(input)&&Object.keys(input).length===0,'INVALID_PARAMS','The workspace inventory takes no arguments.');
   return {schema:BUYER_AGENT_SCHEMA,...this.summary};
  }
  const {definition:spec,args}=buyerAgentArguments(name,input),client=this.#client(args.workspace),storage=this.#stores.get(args.workspace);
  const envelope=result=>({schema:BUYER_AGENT_SCHEMA,workspace:args.workspace,...result});
  const send=record=>client.json(record.path,{body:record.body,...options});
  if(spec.mutating)return envelope(await storage.mutate(spec.name,args,()=>bodyFor(client,spec,args),send));
  let result;
  switch(spec.name){
   case 'status':{const read=await client.json('/api/state',options);result={...read,native:status(read.native)};break;}
   case 'list':{const read=await client.json('/api/state',options);result={connection:read.connection,native:page(inventory(read.native,args.collection),args),collection:args.collection};break;}
   case 'operation':result={native:await storage.operation(args.requestId)};break;
   case 'resume':result=await storage.resume(args.requestId,send);break;
   case 'reconcile':result={native:await storage.reconcile(args.requestId,record=>reconcileNative(client,record,args.id))};break;
   case 'capture':result={native:await storage.capture(args.exportId,args.files,
    (selection,receive,context)=>client.request(originalFilePath(selection),{...options,...context,receive}),options)};break;
   case 'exports':result={native:await storage.exports(args)};break;
   case 'manifest':{const {bytes,...view}=await storage.manifest(args.exportId);result={native:view};break;}
   case 'file':result={native:await storage.file(args)};break;
   case 'file_release':result={native:await storage.release(args.exportId,args.readId)};break;
   default:{
    if(spec.method==='POST'){const request=await bodyFor(client,spec,args);result=await client.json(request.path,{body:request.body,...options});}
    else result=await client.json(nativePath(spec,args),options);
   }
  }
  return envelope(result);
 }
 call(name,input={},options={}){
  need(!this.#closing,'BUYER_AGENT_CLOSING','The agent is draining its accepted requests.');
  need(this.#pending.size<32,'BUYER_AGENT_REQUEST_CAPACITY','Finish an existing original request before opening another.');
  need(plain(options)&&Object.keys(options).every(k=>['signal','timeoutMs'].includes(k)),'INVALID_PARAMS','Use only the original request signal and timeout.');
  const pending=Promise.resolve().then(()=>this.#execute(name,input,options)).then(result=>{
   need(Buffer.byteLength(JSON.stringify(result))<=900000,'BUYER_AGENT_REPLY_REQUIRES_FILE',
    'Use the original inventory page or capture its complete native SDK, report and customer files.');return result;
  }).catch(error=>{throw publicError(error);});
  this.#pending.add(pending);pending.finally(()=>this.#pending.delete(pending)).catch(()=>{});return pending;
 }
 fileClient(workspace){
  const client=this.#client(workspace);
  return {endpoint:'buyer-runbook:'+client.definition.directory+'#'+client.definition.expectedSelectionSha256,
   call:async(name,args)=>{need([BUYER_AGENT_PREFIX+'manifest',BUYER_AGENT_PREFIX+'file',BUYER_AGENT_PREFIX+'file_release'].includes(name),
    'TOOL_NOT_FOUND','Select an original retained-file operation.');return (await this.call(name,{...args,workspace})).native;}};
 }
 download({workspace,...options}){
  need(!this.#closing,'BUYER_AGENT_CLOSING','The agent is draining its accepted requests.');
  need(this.#pending.size<32,'BUYER_AGENT_REQUEST_CAPACITY','Finish an existing original request before receiving another export.');
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[])]);
  const pending=Promise.resolve().then(()=>retainedDownload.download({...options,signal,client:this.fileClient(workspace)}));
  this.#downloads.add(controller);this.#pending.add(pending);
  pending.finally(()=>{this.#downloads.delete(controller);this.#pending.delete(pending);}).catch(()=>{});return pending;
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;
  return this.#close=(async()=>{
   for(const controller of this.#downloads)controller.abort();
   const closing=[...this.#clients.values()].map(client=>client.close());
   await Promise.allSettled([...this.#pending]);const results=await Promise.allSettled([...closing,...[...this.#stores.values()].map(store=>store.close())]);
   need(results.every(row=>row.status==='fulfilled'),'BUYER_AGENT_CLOSE_INCOMPLETE','An original request or retained reader did not finish closing.');
  })().catch(error=>{this.#close=null;throw error;});
 }
}
export class MerchantBuyerRunbookWorkspaces extends BuyerRunbookAgent{
 constructor(config){super(config.buyerRunbookWorkspaces??{schema:BUYER_AGENT_CONFIGURATION,workspaces:{}});}
}
export async function connectBuyerRunbookFileClient({url,workspace,tokenEnv,environment,signal}={}){
 need(typeof workspace==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace),'INVALID_PARAMS','Select the original host-declared workspace alias.');
 const original=await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'BUYER_AGENT',clientName:'stellar-forge-buyer-runbook'});
 return {endpoint:original.endpoint+'#buyer-workspace='+workspace,call:async(name,args,options)=>{
  need([BUYER_AGENT_PREFIX+'manifest',BUYER_AGENT_PREFIX+'file',BUYER_AGENT_PREFIX+'file_release'].includes(name),
   'TOOL_NOT_FOUND','Select an original Buyer retained-file tool.');
  const reply=await original.call(name,{...args,workspace},options);
  need(reply.schema===BUYER_AGENT_SCHEMA&&reply.workspace===workspace&&plain(reply.native),
   'BUYER_AGENT_FILE_REPLY_INVALID','The original MCP result belongs to a different Buyer workspace.');
  return reply.native;
 }};
}
export async function downloadBuyerRunbookExport({url,workspace,tokenEnv,environment,client,...options}={}){
 need(!(client&&url),'INVALID_PARAMS','Select one original file client or its original MCP endpoint.');
 if(!client)client=await connectBuyerRunbookFileClient({url,workspace,tokenEnv,environment,signal:options.signal});
 return retainedDownload.download({...options,client});
}

