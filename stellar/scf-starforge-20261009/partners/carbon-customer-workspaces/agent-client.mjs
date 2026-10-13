// MIT. Native API ownership, complete source retention and exact-operation replay.
import {lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {localURL} from './configuration.mjs';
import {viewRoute,mutation,importRequest,exportRoute,captureRoute} from './routes.mjs';
import {need,plain,same,hash,identity,privateDirectory,readJSON,optionalJSON,writeOnce,retainChunks,retainOriginal,
 regularHandle,fileDigest,jsonBody,retainedHandle,childPath,operationId,MAX_JSON_BYTES,MAX_FILE_BYTES} from './files.mjs';
const SCHEMAS={stellarcarbon:'stellar-forge.stellarcarbon-startup.v1',givecredit:'stellar-forge.givecredit-startup.v1'};
const HEADER={stellarcarbon:'X-Stellarcarbon-Workspace',givecredit:'X-GiveCredit-Workspace'};
const RESULT_LIMIT=512*1024;
export async function originalBinding(kind,directory){
 const module=kind==='stellarcarbon'?await import('../stellarcarbon-statements/store.mjs'):await import('../cfce-givecredit-statements/store.mjs');
 return module.inspectBinding(directory);
}
export async function attachCarbonWorkspace(definition,{exportDirectory,fetchImpl=globalThis.fetch}={}){
 await privateDirectory(exportDirectory);let service;
 const binding=await originalBinding(definition.kind,definition.directory);
 need(binding.workspaceId===definition.workspaceId,'CARBON_WORKSPACE_CHANGED','The selected original workspace identity changed.');
 try{
  let origin=definition.url;
  if(definition.mode==='owned'){
   if(definition.kind==='stellarcarbon'){
    const {createStellarcarbonServer}=await import('../stellarcarbon-statements/server.mjs');
    service=await createStellarcarbonServer({directory:definition.directory,expectedWorkspaceId:definition.workspaceId,
     accountingDirectory:definition.accounting?.directory,expectedAccountingWorkspaceId:definition.accounting?.workspaceId,
     expectedAccountingSourcesSha256:definition.accounting?.sourcesSha256,port:0});
   }else{const {createGiveCreditServer}=await import('../cfce-givecredit-statements/server.mjs');service=await createGiveCreditServer({directory:definition.directory,expectedWorkspaceId:definition.workspaceId,port:0});}
   origin=service.url;
  }
  const client=new CarbonAgentClient({...definition,url:localURL(origin),exportDirectory,fetchImpl,service});
  await client.verify();return client;
 }catch(error){await service?.close();throw error;}
}
export class CarbonAgentClient{
 #c;#closed=false;#closing=false;#pending=new Set();#close;#abort=new AbortController();
 constructor(context){this.#c=context;this.instanceId=randomBytes(16).toString('hex');}
 get summary(){return {kind:this.#c.kind,ownership:this.#c.mode,workspaceId:this.#c.workspaceId,instanceId:this.instanceId,url:this.#c.url};}
 get directory(){return this.#c.directory;}
 get kind(){return this.#c.kind;}
 async verify(){
  const c=this.#c;need(!this.#closed,'CARBON_CLOSED','Reopen this original workspace.');
  await privateDirectory(c.directory);need(same(c.identity,identity(await lstat(c.directory))),'CARBON_DIRECTORY_CHANGED','The selected original workspace directory changed.');
  const response=await c.fetchImpl(c.url+'/api/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
  need(response.ok,'CARBON_LISTENER_UNAVAILABLE','The selected original listener is unavailable; reopen its current startup.');
  const value=await response.json();need(value.schema===SCHEMAS[c.kind]&&value.workspaceId===c.workspaceId&&value.directory===c.directory,
   'CARBON_LISTENER_CHANGED','The listener no longer selects this original private workspace.');
  need(value.capabilities?.customerAgent==='v1','CARBON_SOURCE_VERSION','Run the complete Carbon customer-agent source edition before attaching.');
  return value;
 }
 async #tracked(work){need(!this.#closing,'CARBON_CLOSING','This original attachment is closing.');const task=Promise.resolve().then(work);this.#pending.add(task);try{return await task;}finally{this.#pending.delete(task);}}
 #path(id,suffix){return childPath(this.#c.exportDirectory,id,suffix);}
 async #source(input,id,foreignSource){
  need(!(input.sourceFile&&input.sourceExport),'CARBON_SOURCE_SELECTION','Choose one original configured file or retained export.');
  if(!input.sourceFile&&!input.sourceExport)return null;
  const target=this.#path(id,'.input.json');
  const previous=await optionalJSON(this.#path(id,'.input-receipt.json'));
  if(previous){need(same(previous.selection,{sourceFile:input.sourceFile??null,sourceExport:input.sourceExport??null,sourceWorkspace:input.sourceWorkspace??null}),'CARBON_SOURCE_CHANGED','This original request has another retained source selection.');return previous;}
  let selected;
  if(input.sourceFile){const file=this.#c.files[input.sourceFile];need(file,'CARBON_SOURCE_NOT_CONFIGURED','Choose a configured original source file.');selected=await retainOriginal(file.path,target,file.identity);}
  else{const receipt=foreignSource??await this.exportReceipt(input.sourceExport);need(receipt.exportId===input.sourceExport,'CARBON_EXPORT_CHANGED','The selected original export identity differs.');selected=await retainOriginal(receipt.path,target);need(selected.bytes===receipt.bytes&&selected.sha256===receipt.sha256,'CARBON_EXPORT_CHANGED','The received complete export differs from its original byte identity.');}
  const receipt={path:target,bytes:selected.bytes,sha256:selected.sha256,selection:{sourceFile:input.sourceFile??null,sourceExport:input.sourceExport??null,sourceWorkspace:input.sourceWorkspace??null}};await writeOnce(this.#path(id,'.input-receipt.json'),receipt);return receipt;
 }
 async #response(route,{fields,member,source,exportId,name='response.json'}={}){
  await this.verify();const c=this.#c,method=fields===undefined?'GET':'POST',headers={Accept:'application/json'};
  if(fields!==undefined){headers['Content-Type']='application/json';headers[HEADER[c.kind]]=c.workspaceId;}
  const response=await c.fetchImpl(c.url+'/api/'+route,{method,headers,redirect:'error',signal:AbortSignal.any([this.#abort.signal,AbortSignal.timeout(120000)]),
   ...(fields===undefined?{}:{body:Readable.from(jsonBody(fields,member,source)),duplex:'half'})});
  const id=exportId??'response-'+randomUUID(),attempt=randomUUID(),path=this.#path(id,'.'+attempt+'.bin');
  // Original response metadata precedes body reception. A complete body is
  // linked only after fsync; a lost final receipt is reconstructed from that
  // exact completed response instead of fetching a newly dated handover.
  const header={schema:'stellar-forge.carbon-agent-response.v1',exportId:id,workspaceId:c.workspaceId,kind:c.kind,
   name,type:response.headers.get('content-type')||'application/octet-stream',status:response.status,route,method,path};
  await writeOnce(this.#path(id,'.'+attempt+'.response.json'),header);
  const retained=await retainChunks(path,response.body??[],{maximum:MAX_FILE_BYTES});
  const receipt={...header,schema:'stellar-forge.carbon-agent-export.v1',...retained};
  await writeOnce(this.#path(id,'.export.json'),receipt);
  let value=null;if(retained.bytes<=RESULT_LIMIT){const opened=await regularHandle(path,{maximum:RESULT_LIMIT,privateFile:true});
   try{const bytes=await opened.handle.readFile();if(receipt.type.includes('json'))value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
   finally{await opened.handle.close();}}
  if(!response.ok)throw Object.assign(new Error(value?.error?.message||'The original workspace returned HTTP '+response.status+'.'),
   {code:value?.error?.code||'CARBON_HTTP_'+response.status,status:response.status,retained:this.publicReceipt(receipt)});
  return {value,receipt:this.publicReceipt(receipt)};
 }
 publicReceipt({path,...receipt}){return receipt;}
 async exportReceipt(id){
  operationId(id);const receipt=await readJSON(this.#path(id,'.export.json'));
  need(receipt.exportId===id&&receipt.workspaceId===this.#c.workspaceId&&receipt.kind===this.kind&&receipt.path.startsWith(this.#path(id,'.'))&&/\.[a-f0-9-]{36}\.bin$/.test(receipt.path)&&
   /^[a-f0-9]{64}$/.test(receipt.sha256),'CARBON_EXPORT_CHANGED','Select the original complete export identity.');
  return receipt;
 }
 async retained(id){return retainedHandle(await this.exportReceipt(id));}
 view(view,query){return this.#tracked(()=>this.#response(viewRoute(this.kind,view,query)));}
 preview(kind,value){return this.#tracked(()=>{need(plain(value)&&(kind==='statement'||this.kind==='givecredit'&&['allocation','bridge'].includes(kind)),
  'CARBON_PREVIEW','Choose an original statement, allocation or bridge preview.');return this.#response('preview'+(this.kind==='givecredit'?'/'+kind:''),{fields:{value}});});}
 async #observe(requestId){
  const saved=await optionalJSON(this.#path(requestId,'.intent.json')),completed=await optionalJSON(this.#path(requestId,'.result.json'));
  const native=await this.#response('operations/'+encodeURIComponent(requestId));
  return {saved,completed,native:native.value,receipt:native.receipt};
 }
 operation(requestId){return this.#tracked(async()=>{operationId(requestId);const status=await this.#observe(requestId);return {...status,saved:status.saved?{
  schema:status.saved.schema,requestId,kind:status.saved.kind,workspaceId:status.saved.workspaceId,category:status.saved.category,
  logical:status.saved.logical,source:status.saved.source?{bytes:status.saved.source.bytes,sha256:status.saved.source.sha256}:null}:null};});}
 async #perform(intent){
  const {requestId,category,logical,source}=intent;
  if(source){const actual=await fileDigest(source.path);need(actual.bytes===source.bytes&&actual.sha256===source.sha256,'CARBON_SOURCE_CHANGED','The complete retained operation input changed. Restore its original bytes before continuing.');}
  const completed=await optionalJSON(this.#path(requestId,'.result.json'));if(completed)return completed;
  let request;
  if(category==='checkpoint'||category==='save'&&logical.action==='invoice'){const observed=await this.#response('operations/'+encodeURIComponent(requestId));if(observed.value?.found){const result={state:'COMPLETE',native:observed.value,receipt:observed.receipt};await writeOnce(this.#path(requestId,'.result.json'),result);return result;}}
  if(category==='save')request=mutation(this.kind,logical.action,logical.value,logical);
  else if(category==='import')request=importRequest(this.kind,logical);
  else if(category==='checkpoint')request={route:'capture/'+logical.kind+'/checkpoint',fields:{revision:logical.revision,requestId,actor:logical.actor},member:'source'};
  else if(category==='capture'){
   const route=captureRoute(this.kind,logical.kind,'start'),observed=await this.#response(route);
   const native=await this.#response('operations/'+encodeURIComponent(requestId));
   if(native.value?.found){const result={state:'COMPLETE',native:native.value,receipt:native.receipt};await writeOnce(this.#path(requestId,'.result.json'),result);return result;}
   if(observed.value?.status==='RUNNING'){
    need(observed.value.requestId===requestId,'CARBON_CAPTURE_RUNNING','Another original capture is active; inspect it before starting this acquisition.');
    return {state:'RUNNING',native:observed.value,receipt:observed.receipt};
   }
   const submitted=await optionalJSON(this.#path(requestId,'.submitted.json'));
   const current=submitted?await this.#response('state'):null;
   request={route,fields:{label:logical.label,requestId,revision:submitted?current.value.revision:logical.revision,actor:logical.actor,...(submitted?{resume:true}:{})},member:source?'value':undefined};
   if(!source)request.fields.value=logical.value??{};
  }else throw Object.assign(new Error('Unknown retained operation category.'),{code:'CARBON_OPERATION_KIND'});
  if(request.member)need(source,'CARBON_SOURCE_REQUIRED','Receive the complete original input file before this operation.');
  if(category==='capture')await writeOnce(this.#path(requestId,'.submitted.json'),{requestId,workspaceId:this.#c.workspaceId});
  const response=await this.#response(request.route,{...request,source:source?.path});
  const result={state:category==='capture'?(response.value?.status||'RUNNING'):'COMPLETE',native:response.value,receipt:response.receipt};
  if(category!=='capture')await writeOnce(this.#path(requestId,'.result.json'),result);
  return result;
 }
 async #save(category,input,foreignSource){
  const logical=structuredClone(input);operationId(logical.requestId);
  const requestId=logical.requestId,old=await optionalJSON(this.#path(requestId,'.intent.json'));
  if(old){need(old.category===category&&old.workspaceId===this.#c.workspaceId&&same(old.logical,logical),'CARBON_INTENT_CHANGED','Continue this original request with its exact retained input.');return this.#perform(old);}
  // Source is physically retained before native side effects; originals remain separate.
  const native=await this.#response('operations/'+encodeURIComponent(requestId));need(!native.value?.found,'CARBON_REQUEST_OWNED','This native request ID already belongs to an operation. Inspect it and choose a new original ID.');
  const source=await this.#source(logical,requestId,foreignSource);
  const intent={schema:'stellar-forge.carbon-agent-intent.v1',kind:this.kind,workspaceId:this.#c.workspaceId,directory:this.directory,requestId,category,logical,source};
  await writeOnce(this.#path(requestId,'.intent.json'),intent);return this.#perform(intent);
 }
 save(input){return this.#tracked(()=>this.#save('save',input));}
 import(input,foreignSource){return this.#tracked(async()=>{const spec=importRequest(this.kind,input);need(Boolean(spec.member)===Boolean(input.sourceFile||input.sourceExport),'CARBON_SOURCE_SELECTION','Select exactly one complete source for this original import format.');return this.#save('import',input,foreignSource);});}
 checkpoint(input,foreignSource){return this.#tracked(async()=>{need(this.kind==='givecredit'&&['registry','ledger'].includes(input.kind),'CARBON_CHECKPOINT_KIND','Select the original registry or ledger checkpoint.');
  if(input.command==='export')return this.#download(input.exportId,'capture/'+input.kind+'/checkpoint',{kind:'checkpoint',sourceKind:input.kind},'givecredit-'+input.kind+'-checkpoint.json');
  need(input.sourceFile||input.sourceExport,'CARBON_SOURCE_REQUIRED','Choose the complete original checkpoint.');return this.#save('checkpoint',input,foreignSource);
 });}
 capture(input){return this.#tracked(async()=>{const route=captureRoute(this.kind,input.kind,input.command);
  if(input.command==='status')return this.#response(route);
  if(input.command==='stop')return this.#response(route,{fields:{}});
  need(!(input.value&&input.sourceFile),'CARBON_CAPTURE_OPTIONS','Choose inline original options or one complete configured options file.');
  need(!input.value?.apiKey,'CARBON_CAPTURE_CREDENTIAL','Keep the existing registry key in its configured private options file.');
  mutation(this.kind,'settings',{name:'capture options'},input);
  return this.#save('capture',input);
 });}
 resume(requestId){return this.#tracked(async()=>{operationId(requestId);const intent=await readJSON(this.#path(requestId,'.intent.json'));
  need(intent.workspaceId===this.#c.workspaceId&&intent.kind===this.kind,'CARBON_WORKSPACE_CHANGED','Continue this request in its original workspace.');
  return this.#perform(intent);
 });}
 async #recoverExport(exportId,route){
  const published=await optionalJSON(this.#path(exportId,'.export.json'));if(published)return this.exportReceipt(exportId);
  const prefix=hash(exportId)+'.';
  const names=(await readdir(this.#c.exportDirectory)).filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{64}\.[a-f0-9-]{36}\.response\.json$/.test(name)).sort();
  for(const name of names){
   const header=await readJSON(join(this.#c.exportDirectory,name));
   need(header.exportId===exportId&&header.workspaceId===this.#c.workspaceId&&header.kind===this.kind&&header.route===route&&header.method==='GET'&&
    header.path===join(this.#c.exportDirectory,name.replace(/\.response\.json$/,'.bin')),
    'CARBON_EXPORT_CHANGED','The staged original export differs from its exact selection.');
   let original;try{original=await fileDigest(header.path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const receipt={...header,schema:'stellar-forge.carbon-agent-export.v1',path:original.path,bytes:original.bytes,sha256:original.sha256};
   await writeOnce(this.#path(exportId,'.export.json'),receipt);return receipt;
  }
  return null;
 }
 async #download(exportId,route,selection,name){
  operationId(exportId);const intent={schema:'stellar-forge.carbon-agent-export-intent.v1',workspaceId:this.#c.workspaceId,kind:this.kind,selection};
  await writeOnce(this.#path(exportId,'.export-intent.json'),intent);
  const existing=await this.#recoverExport(exportId,route);if(existing){need(existing.status>=200&&existing.status<300,'CARBON_EXPORT_HTTP','This retained ID contains the original failed HTTP response; inspect it and select a new export ID for a new request.');return {receipt:this.publicReceipt(await this.exportReceipt(exportId))};}
  return this.#response(route,{exportId,name});
 }
 download(input){return this.#tracked(()=>this.#download(input.exportId,exportRoute(this.kind,input),input,input.name??(input.kind==='handover'?'workspace.json':input.kind==='source'?'source.json':'comparison.csv')));}
 async sourceForReceive(input,foreignSource){return this.#tracked(()=>this.#source(input,'receive-'+input.requestId,foreignSource));}
 requestClose(){this.#closing=true;this.#abort.abort();}
 close(){if(!this.#close)this.#close=(async()=>{this.requestClose();await Promise.allSettled([...this.#pending]);await this.#c.service?.close();this.#closed=true;return {instanceId:this.instanceId,ownership:this.#c.mode,state:this.#c.mode==='owned'?'CLOSED':'DETACHED'};})();return this.#close;}
}
