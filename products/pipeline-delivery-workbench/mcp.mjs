// SPDX-License-Identifier: MIT
// One attachment to the original private Staff controller; no substitute native engine.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pipelineDeliveryTools,READ_ACTIONS,MUTATIONS} from './tools.mjs';
import {PipelineDeliveryFiles,present} from './files.mjs';
import {PipelineDeliveryRequests,canonical} from './requests.mjs';
import {PipelineDeliveryClient,need,plain,exact,absolute,identifier,digest,integer,hash,readJson,readFile,privateDirectory,ownedDirectory,inside,MAX_JSON,MAX_FILE}
 from './connection.mjs';
export const PIPELINE_DELIVERY_HOST_SCHEMA='stellar-forge.pipeline-delivery-workbench-host.v1';
const schemas=new Map(pipelineDeliveryTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
const alias=v=>{need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'PIPELINE_DELIVERY_ALIAS','Choose a host-declared alias.');return v;};
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const label=(v,fallback)=>{v=v??fallback;need(typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=240&&!/[\x00-\x1f\x7f]/.test(v),
 'PIPELINE_DELIVERY_LABEL','Use a readable host label.');return v;};
export async function readPipelineDeliveryConfiguration(path){
 const source=await readJson(path,1024*1024),raw=source.value,base=dirname(source.path);
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===PIPELINE_DELIVERY_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,
  'PIPELINE_DELIVERY_HOST_CONFIGURATION','Declare one to32 original private Staff installations.');
 const workspaces=Object.create(null),connections=new Map(),bindings=new Set();
 for(const [name,v]of Object.entries(raw.workspaces)){
  alias(name);exact(v,['label','directory','connectionFile','inputs'],['directory','connectionFile']);
  const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile));
  await ownedDirectory(dirname(directory));await privateDirectory(dirname(connectionFile));
  try{await ownedDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(!inside(directory,connectionFile)&&connectionFile!==source.path&&(!connections.has(connectionFile)||connections.get(connectionFile)===directory),
   'PIPELINE_DELIVERY_HOST_LAYOUT','Keep each connection outside its one original workspace.');
  const binding=canonical([directory,connectionFile]);need(!bindings.has(binding),'PIPELINE_DELIVERY_HOST_LAYOUT','Give each original Staff attachment one alias.');
  connections.set(connectionFile,directory);bindings.add(binding);
  need(v.inputs===undefined||plain(v.inputs)&&Object.keys(v.inputs).length<=256,'PIPELINE_DELIVERY_INPUTS','Declare at most256 complete original input files.');
  const inputs=Object.create(null);
  for(const [key,input]of Object.entries(v.inputs??{})){
   alias(key);exact(input,['label','file','sha256','bytes','filename','mediaType'],['file','sha256','bytes','filename','mediaType']);
   digest(input.sha256);integer(input.bytes,'complete input bytes',MAX_FILE,1);
   const file=absolute(resolve(base,input.file));need(file!==connectionFile&&file!==source.path,'PIPELINE_DELIVERY_HOST_LAYOUT','Keep full input files separate from private host/connection configuration.');
   need(await realpath(file)===file,'PIPELINE_DELIVERY_INPUT_PATH','Select a canonical original regular file.');
   const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const st=await fd.stat();need(st.isFile()&&st.size===input.bytes,'PIPELINE_DELIVERY_INPUT_CHANGED','The complete declared input size changed.',409);}finally{await fd.close();}
   need(typeof input.filename==='string'&&input.filename===basename(input.filename)&&input.filename.length>0&&input.filename.length<=240&&!/[\x00-\x1f\x7f\\]/.test(input.filename),
    'PIPELINE_DELIVERY_FILENAME','Use a plain original filename.');
   need(typeof input.mediaType==='string'&&input.mediaType.length>0&&input.mediaType.length<=200&&!/[\r\n]/.test(input.mediaType),'PIPELINE_DELIVERY_MEDIA_TYPE','Use the original input media type.');
   inputs[key]={label:label(input.label,key),file,sha256:input.sha256,bytes:input.bytes,filename:input.filename,mediaType:input.mediaType};
  }
  workspaces[name]={label:label(v.label,name),directory,connectionFile,inputs};
 }
 return{configuration:source.path,sha256:source.sha256,workspaces};
}
function bodyEnvelope(body,operation){
 const required=operation==='invoke'?['action','payload','workspace_id','expected_revision','request_id']:
  operation==='open'?['receiving_id','workspace_id','expected_revision','request_id']:['workspace_id','expected_revision','request_id'];
 exact(body,[...required,'selection'],required);identifier(body.workspace_id,'original workspace ID');identifier(body.request_id,'original request ID');
 integer(body.expected_revision,'original global revision');
 if(body.selection!==undefined){
  exact(body.selection,['root','receiving_id','workspace_id'],['root','receiving_id','workspace_id']);
  need(typeof body.selection.root==='string'&&body.selection.root.length>0&&typeof body.selection.receiving_id==='string'&&body.selection.receiving_id.length>0&&
   body.selection.workspace_id===body.workspace_id,'PIPELINE_DELIVERY_SELECTION','Preserve the exact original snapshot selection.');
 }
 if(operation==='invoke')need(MUTATIONS.includes(body.action)&&plain(body.payload),'PIPELINE_DELIVERY_ACTION','Use a documented original mutation and complete object payload.');
 if(operation==='open')need(typeof body.receiving_id==='string'&&body.receiving_id.length>0&&body.receiving_id.length<=200,'PIPELINE_DELIVERY_RECEIVING_ID','Select original or an actual retained receiving ID.');
 return body;
}
export class MerchantPipelineDeliveryWorkspaces{
 #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
 constructor(config){this.#config=config;this.#files=new PipelineDeliveryFiles(config.exportsDirectory,{authorize:(alias,selection)=>this.#authorize(alias,selection)});
  this.#requests=new PipelineDeliveryRequests(this.#files);}
 get summary(){return{configured:Boolean(this.#config.pipelineDelivery),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,retainedReads:this.#files.summary};}
 #scope(name){const v=this.#config.pipelineDelivery?.workspaces?.[alias(name)];need(v,'PIPELINE_DELIVERY_NOT_CONFIGURED','Choose a declared original Staff installation.',404);return{...v,alias:name};}
 #client(scope){const c=this.#clients.get(scope.alias);need(c,'PIPELINE_DELIVERY_DISCONNECTED','Connect the original managed Staff listener.',409);return c;}
 #view(scope){const client=this.#clients.get(scope.alias);return{workspace:scope.alias,label:scope.label,state:client?'CONNECTED':'DISCONNECTED',...(client?client.connection:{}),
  inputs:Object.entries(scope.inputs).map(([sourceInput,v])=>({sourceInput,label:v.label,sha256:v.sha256,bytes:v.bytes,filename:v.filename,mediaType:v.mediaType}))};}
 #authority(scope){const c=this.#client(scope).connection;
  need(c.directory===scope.directory&&typeof c.controlDirectory==='string'&&typeof c.applicationDirectory==='string'&&typeof c.sourceManifestSha256==='string',
   'PIPELINE_DELIVERY_AUTHORITY','Use the exact original managed Staff authority.',409);
  return{directory:c.directory,controlDirectory:c.controlDirectory,applicationDirectory:c.applicationDirectory,sourceManifestSha256:c.sourceManifestSha256};}
 async #access(scope){await this.#client(scope).info();return this.#authority(scope);}
 async #authorize(name,selection){
  const scope=this.#scope(name);need(selection?.access&&canonical(selection.access)===canonical(this.#authority(scope)),
   'PIPELINE_DELIVERY_RETAINED_AUTHORITY','This retained original belongs to another Staff control directory or application source.',403);
  // The original private capability authorizes the whole Staff receiving catalogue.
  // Current writer selection may change without revoking that original authority.
  await this.#client(scope).info();
 }
 async #retain(scope,response,selection,request=null){
  selection={...selection,access:request?.access??await this.#access(scope)};
  let retained,retentionFailure=null,confirmationFailure=null;
  try{retained=await this.#files.retain(scope.alias,response,selection);}catch(e){
   if(!request)throw e;retentionFailure={code:e.code??'PIPELINE_DELIVERY_RETAIN_FAILED',message:'The original HTTP response arrived. Preserve this exact request and recover its complete native response.'};}
  if(request)try{await this.#requests.confirm(request,response,retained);}catch(e){confirmationFailure={code:e.code??'PIPELINE_DELIVERY_OBSERVATION_FAILED',message:'The native response arrived; the original selected request remains retained.'};}
  return{workspace:scope.alias,...(retained??{sha256:response.sha256,bytes:response.bytes.length,value:present(response.value)}),
   originalStatus:response.status,ok:response.ok??response.status<400,
   ...(request?{requestId:request.requestId,originalOutcome:'HTTP_OBSERVED',originalRequest:request.originalRequest,originalInput:request.source}:{}),
   ...(retentionFailure?{retentionFailure}:{}),...(confirmationFailure?{confirmationFailure}:{})};
 }
 async #mutation(scope,operation,body,dispatch,source=null,intent=body){
  const access=await this.#access(scope),record=await this.#requests.prepare(scope.alias,access,operation,body.request_id,intent,source);
  let response;try{response=await dispatch();}catch(e){
   e.details={...e.details,requestId:record.requestId,originalRequest:record.originalRequest,originalInput:record.source,
    recovery:'Read original pending/request.get and resume this identical endpoint/body against the same Staff authority. Do not mint another native run.'};throw e;}
  return this.#retain(scope,response,{operation,requestId:record.requestId},record);
 }
 async #input(scope,args){
  const input=scope.inputs[alias(args.sourceInput)];digest(args.expectedSourceSha256);
  need(input&&input.sha256===args.expectedSourceSha256,'PIPELINE_DELIVERY_INPUT_SELECTION','Choose the complete declared source and exact SHA-256.',409);
  const access=await this.#access(scope);
  const retained=await this.#files.capture(scope.alias,{operation:'host-input',sourceInput:args.sourceInput,access},async sink=>{
   need(await realpath(input.file)===input.file,'PIPELINE_DELIVERY_INPUT_CHANGED','The original input path changed.',409);
   const fd=await open(input.file,constants.O_RDONLY|constants.O_NOFOLLOW),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');let at=0;
   try{const before=await fd.stat();need(before.isFile()&&before.size===input.bytes,'PIPELINE_DELIVERY_INPUT_CHANGED','The declared full input size changed.',409);
    while(at<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-at),at);need(r.bytesRead>0,'PIPELINE_DELIVERY_INPUT_CHANGED','The original input ended early.',409);
     const bytes=buffer.subarray(0,r.bytesRead);h.update(bytes);await sink(bytes);at+=r.bytesRead;}
    const sha256=h.digest('hex');need(same(before,await fd.stat())&&sha256===input.sha256,'PIPELINE_DELIVERY_INPUT_CHANGED','The original complete source changed.',409);
    return{sha256,bytes:at,filename:input.filename,contentType:input.mediaType};
   }finally{await fd.close();}
  },{sha256:input.sha256,bytes:input.bytes,filename:input.filename});
  return{retained,path:join(await this.#files.directory(scope.alias),retained.sha256+'.content'),identity:{sha256:input.sha256,bytes:input.bytes}};
 }
 async #dispatch(name,args){
  const schema=schemas.get(name);need(schema,'PIPELINE_DELIVERY_TOOL','Choose a declared pipeline tool.');exact(args,Object.keys(schema.properties),schema.required);
  if(name==='merchant_pipeline_status'&&args.workspace===undefined)return{...this.summary,workspaces:Object.entries(this.#config.pipelineDelivery?.workspaces??{}).map(([alias,v])=>this.#view({...v,alias}))};
  const scope=this.#scope(args.workspace);
  if(name==='merchant_pipeline_status')return this.#view(scope);
  if(name==='merchant_pipeline_connect'){
   const client=await PipelineDeliveryClient.connect(scope.connectionFile,{directory:scope.directory,expectedLaunchId:args.expectedLaunchId}),old=this.#clients.get(scope.alias);
   try{if(old){await old.close();await this.#files.disconnect(scope.alias);}}catch(e){await client.close();throw e;}
   this.#clients.set(scope.alias,client);return{...this.#view(scope),native:await this.#retain(scope,await client.info(),{operation:'info'})};
  }
  if(name==='merchant_pipeline_disconnect'){
   const client=this.#clients.get(scope.alias);need(!client||client.connection.launchId===args.launchId,'PIPELINE_DELIVERY_LAUNCH_CHANGED','Disconnect the exact original launch.',409);
   await client?.close();await this.#files.disconnect(scope.alias);this.#clients.delete(scope.alias);return{workspace:scope.alias,launchId:args.launchId,state:'DISCONNECTED'};
  }
  const{workspace,...input}=args,client=this.#client(scope);
  if(name==='merchant_pipeline_files')return this.#files.list(scope.alias,input);
  if(name==='merchant_pipeline_file')return this.#files.read(scope.alias,input);
  if(name==='merchant_pipeline_file_release'){await this.#files.release(scope.alias,args.readId);return{workspace:scope.alias,readId:args.readId,released:true};}
  if(name==='merchant_pipeline_inspect')return this.#files.inspect(scope.alias,input);
  if(name==='merchant_pipeline_requests'){
   const access=await this.#access(scope),result=await this.#requests.list(scope.alias,input);
   need(result.requests.every(r=>canonical(r.access)===canonical(access)),'PIPELINE_DELIVERY_RETAINED_AUTHORITY','The original request page belongs to another Staff authority.',403);return result;
  }
  switch(name){
   case'merchant_pipeline_info':return this.#retain(scope,await client.info(),{operation:'info'});
   case'merchant_pipeline_state':return this.#retain(scope,await client.state(),{operation:'state'});
   case'merchant_pipeline_read':need(READ_ACTIONS.includes(args.action)&&plain(args.payload),'PIPELINE_DELIVERY_READ','Choose an original read and complete payload.');
    return this.#retain(scope,await client.read(args.action,args.payload),{operation:'read',action:args.action,payload:args.payload});
   case'merchant_pipeline_pending':return this.#retain(scope,await client.pending(),{operation:'pending'});
   case'merchant_pipeline_received':return this.#retain(scope,await client.received(),{operation:'received'});
   case'merchant_pipeline_browser':await client.info();return{workspace:scope.alias,...await client.browser()};
   case'merchant_pipeline_invoke':{
    const body=bodyEnvelope(args.body,'invoke');need(Buffer.byteLength(JSON.stringify(body))<=32*1024*1024,'PIPELINE_DELIVERY_INLINE_SIZE','Use invoke_input for a larger complete original request.',413);
    return this.#mutation(scope,'invoke',body,()=>client.invoke(body));
   }
   case'merchant_pipeline_open':{const body=bodyEnvelope(args.body,'open');return this.#mutation(scope,'open',body,()=>client.open(body));}
   case'merchant_pipeline_invoke_input':{
    const selected=await this.#input(scope,args);need(selected.identity.bytes<=MAX_JSON,'PIPELINE_DELIVERY_REQUEST_SIZE','The full original JSON request exceeds the native bound.',413);
    const raw=await readFile(selected.path,MAX_JSON);need(raw.sha256===selected.identity.sha256,'PIPELINE_DELIVERY_INPUT_CHANGED','The retained full request changed.',409);
    const body=bodyEnvelope(JSON.parse(raw.bytes.toString('utf8')),'invoke');
    return this.#mutation(scope,'invoke_input',body,()=>client.invokeInput(selected.path,selected.identity),selected.retained,
     {endpoint:'/api/invoke',sourceInput:args.sourceInput,sha256:selected.identity.sha256,bytes:selected.identity.bytes,request_id:body.request_id,
      workspace_id:body.workspace_id,expected_revision:body.expected_revision,selection:body.selection??null,action:body.action});
   }
   case'merchant_pipeline_source_import':{
    const selected=await this.#input(scope,args);need(selected.identity.bytes<=512*1024*1024,'PIPELINE_DELIVERY_ARCHIVE_SIZE','Original source ZIP limit is512MiB.',413);
    return this.#retain(scope,await client.sourceImport(selected.path,selected.identity,{...(args.root===undefined?{}:{root:args.root})}),
     {operation:'source_import',sourceInput:args.sourceInput,sha256:selected.identity.sha256});
   }
   case'merchant_pipeline_receive':{
    const body=bodyEnvelope(args.envelope,'receive'),selected=await this.#input(scope,args);
    need(selected.identity.bytes<=512*1024*1024,'PIPELINE_DELIVERY_ARCHIVE_SIZE','Original receiving ZIP limit is512MiB.',413);
    return this.#mutation(scope,'receive',body,()=>client.receive(selected.path,selected.identity,body),selected.retained,
     {endpoint:'/api/receive',envelope:body,sourceInput:args.sourceInput,sha256:selected.identity.sha256,bytes:selected.identity.bytes});
   }
   case'merchant_pipeline_input':return{workspace:scope.alias,...(await this.#input(scope,args)).retained};
   case'merchant_pipeline_archive':{
    need(['backup','release'].includes(args.kind),'PIPELINE_DELIVERY_ARCHIVE_KIND','Choose complete backup or approved release.');
    identifier(args.requestId,'original export request ID');if(args.kind==='release')identifier(args.releaseId,'original release ID');
    else need(args.releaseId===undefined,'PIPELINE_DELIVERY_ARCHIVE_SELECTION','A complete workspace backup has no release ID.');
    const original={kind:args.kind,requestId:args.requestId,...(args.releaseId===undefined?{}:{releaseId:args.releaseId})},
     access=await this.#access(scope),record=await this.#requests.prepare(scope.alias,access,'archive',args.requestId,original);
    let observed,retained;
    try{retained=await this.#files.capture(scope.alias,{operation:'archive',...original,access},async sink=>{
      observed=await client.archive(original,sink);if(observed.ok===false){const error=new Error('Original archive endpoint returned an HTTP error.');error.originalArchiveResponse=observed;throw error;}
      return{...observed,original:{workspaceId:observed.workspaceId,revision:observed.revision,receivingId:observed.receivingId,headers:observed.headers}};
     },{...(args.expectedSha256===undefined?{}:{sha256:args.expectedSha256}),...(args.expectedBytes===undefined?{}:{bytes:args.expectedBytes}),
       ...(args.filename===undefined?{}:{filename:args.filename})});}
    catch(e){if(e.originalArchiveResponse)return this.#retain(scope,e.originalArchiveResponse,{operation:'archive',...original},record);e.details={...e.details,requestId:record.requestId,originalRequest:record.originalRequest,recovery:'Reopen the same original export request. Preserve any native completed archive; do not select a new export ID.'};throw e;}
    let confirmationFailure;try{await this.#requests.confirm(record,{...observed,status:observed.status??200,ok:true},retained);}
    catch(e){confirmationFailure={code:e.code??'PIPELINE_DELIVERY_OBSERVATION_FAILED'};}
    return{workspace:scope.alias,...retained,requestId:record.requestId,originalOutcome:'HTTP_OBSERVED',...(confirmationFailure?{confirmationFailure}:{})};
   }
   default:need(false,'PIPELINE_DELIVERY_TOOL','Choose a declared pipeline tool.');
  }
 }
 async call(name,args={}){need(!this.#closing,'PIPELINE_DELIVERY_CLOSING','The original Staff attachment is closing.',409);
  const operation=this.#tail.then(()=>this.#dispatch(name,args));this.#tail=operation.catch(()=>{});this.#pending.add(operation);
  try{return await operation;}finally{this.#pending.delete(operation);}}
 close(){if(this.#closed)return this.#closed;this.#closing=true;
  return this.#closed=(async()=>{await Promise.allSettled([...this.#pending]);await Promise.all([...this.#clients.values()].map(c=>c.close()));
   await this.#files.close();this.#clients.clear();})().catch(e=>{this.#closed=null;throw e;});}
}
export {pipelineDeliveryTools} from './tools.mjs';
