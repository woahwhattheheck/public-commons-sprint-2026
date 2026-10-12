// SPDX-License-Identifier: MIT
// One borrowed original publisher/scheduler; native source semantics remain unchanged.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {exact,failure,identifier} from './host-files.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from './retained-file-reads.mjs';
import {bytes} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import {FRICTIONLESS_DOWNLOAD_MANIFEST,FRICTIONLESS_DOWNLOAD_SCHEMA,FRICTIONLESS_FILE_BYTES,UUID,HASH,parseFrictionlessDownloadManifest} from './frictionless-download-contract.mjs';
export {frictionlessWorkspaceTools} from './catalog/frictionless-workspace.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>{if(typeof x!=='string'||!UUID.test(x))throw failure('INVALID_PARAMS','Use the exact original UUID.');return x;};
const hash=x=>{if(typeof x!=='string'||!HASH.test(x))throw failure('INVALID_PARAMS','Use the exact original SHA-256.');return x;};
const count=(x,max=Number.MAX_SAFE_INTEGER,min=0)=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw failure('INVALID_PARAMS','Use an integer within the original bound.');return x;};
function fields(args,keys=[],required=[]){exact(args,['workspace','workspaceId',...keys],['workspace','workspaceId',...required]);}
async function descriptor(file){
 const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||info.mode&0o077||info.size!==file.bytes||file.bytes>FRICTIONLESS_FILE_BYTES)
   throw failure('FRICTIONLESS_FILE_CHANGED','The original private file differs from its retained declaration.');
  return{readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:'application/octet-stream'};
 }catch(e){await handle.close();throw e;}
}
export class MerchantFrictionlessWorkspaces{
 #config;#publishers;#environment;#entries=new Map();#pending=new Set();#closing=false;#close;
 constructor(config,publishers,{environment=process.env}={}){this.#config=config;this.#publishers=publishers;this.#environment=environment;}
 get summary(){return{configured:Boolean(this.#config.frictionlessWorkspaces),opened:[...this.#entries.keys()],closing:this.#closing,pending:this.#pending.size};}
 #declared(name){identifier(name,'Frictionless source workspace');const value=this.#config.frictionlessWorkspaces?.workspaces?.[name];
  if(!value)throw failure('FRICTIONLESS_NOT_CONFIGURED','Choose a host-declared original Frictionless source workspace.');return value;}
 #view(name,r){const c=this.#declared(name);return{workspace:name,instanceId:r.instanceId,publisherInstanceId:r.publisherInstanceId,
  workspaceId:r.model.workspaceId,publisher:c.publisher,directory:r.model.directory};}
 async #resource(name,entry,c,owned){
  const {openFrictionlessSourceWorkbench}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/workbench/model.mjs');
  const model=await openFrictionlessSourceWorkbench({publisher:owned.publisher,inputs:c.inputs,environment:this.#environment});
  const r={model,publisher:owned.publisher,schedule:owned.schedule,instanceId:randomUUID(),publisherInstanceId:owned.instanceId,
   reads:new RetainedFileReads({errorPrefix:'FRICTIONLESS'}),browser:null,browserTail:Promise.resolve(),exports:new Map(),closing:false,closePromise:null};
  r.close=()=>{
   if(r.closePromise)return r.closePromise;r.closing=true;
   r.closePromise=(async()=>{
    const errors=[];await r.browserTail.catch(()=>{});
    if(r.browser)try{await r.browser.close();r.browser=null;}catch(e){errors.push(e);}
    try{await r.reads.close();}catch(e){errors.push(e);}
    try{await model.close();}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,'The original Frictionless source resources did not all close.');
    r.exports.clear();if(this.#entries.get(name)===entry)this.#entries.delete(name);
   })().catch(e=>{r.closePromise=null;throw e;});return r.closePromise;
  };entry.resource=r;return r;
 }
 async #open(name){
  const c=this.#declared(name);let entry=this.#entries.get(name);
  if(entry?.closing||entry?.resource?.closing)throw failure('FRICTIONLESS_CLOSING','Complete the original close before reopening.');
  if(!entry){
   entry={opening:null,lease:null,resource:null,closing:null};this.#entries.set(name,entry);
   entry.opening=this.#publishers.borrow(c.publisher,{kind:'frictionless',key:'frictionless-source:'+name,open:owned=>this.#resource(name,entry,c,owned)})
    .then(lease=>{entry.lease=lease;return lease;});
   try{await entry.opening;}catch(e){if(this.#entries.get(name)===entry)this.#entries.delete(name);throw e;}
  }else await entry.opening;
  return this.#status(name);
 }
 async #status(name,args={}){
  if(name===undefined)return{...this.summary,workspaces:Object.entries(this.#config.frictionlessWorkspaces?.workspaces??{}).map(([workspace,c])=>{
   const entry=this.#entries.get(workspace);return{workspace,label:c.label,publisher:c.publisher,inputs:Object.keys(c.inputs),
    state:!entry?'CLOSED':entry.closing||entry.resource?.closing?'CLOSING':entry.resource?'OPEN':'OPENING'};})};
  const c=this.#declared(name),entry=this.#entries.get(name);
  if(!entry)return{workspace:name,publisher:c.publisher,state:'CLOSED'};
  const lease=await entry.opening,r=lease.resource;
  if(args.workspaceId!==undefined&&args.workspaceId!==r.model.workspaceId)throw failure('FRICTIONLESS_WORKSPACE_CHANGED','Use the persistent original source workspace ID.');
  if(entry.closing||r.closing||lease.closed)return{...this.#view(name,r),state:'CLOSING'};
  return lease.run(async resource=>({...this.#view(name,resource),state:'OPEN',
   native:await resource.model.status({capturesOffset:count(args.capturesOffset??0),editionsOffset:count(args.editionsOffset??0),
    operationsOffset:count(args.operationsOffset??0),limit:count(args.limit??25,100,1)}),
   browser:{open:Boolean(resource.browser)},fileReads:resource.reads.status(name)}));
 }
 async #stop(name,entry){
  if(entry.closing)return entry.closing;
  entry.closing=(async()=>{const lease=await entry.opening,view=this.#view(name,lease.resource);await lease.release();
   if(this.#entries.get(name)===entry)this.#entries.delete(name);return{...view,state:'CLOSED',publisherState:'OWNED_BY_MERCHANT_PUBLISHER'};})()
   .catch(e=>{entry.closing=null;throw e;});return entry.closing;
 }
 async #export(r,exportId){
  uuid(exportId);const op=r.model.operation(exportId);
  if(op.kind!=='export'||op.state!=='COMPLETE'||op.result?.exportId!==exportId)throw failure('FRICTIONLESS_EXPORT_NOT_COMPLETE','Choose an original completed source export request.');
  const result=op.result,original=await r.model.file('export',exportId,'manifest.json');
  if(original.sha256!==result.manifestFile.sha256)throw failure('FRICTIONLESS_EXPORT_CHANGED','The original complete source manifest changed.');
  const prior=r.exports.get(exportId);if(prior&&prior.nativeManifestSha256===original.sha256)return prior;
  const files=[{name:'manifest.json',bytes:original.bytes,sha256:original.sha256},...result.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))];
  const manifest={schema:FRICTIONLESS_DOWNLOAD_SCHEMA,exportId,workspaceId:r.model.workspaceId,editionId:result.editionId,
   sourceHash:result.sourceHash,captureSha256:result.captureSha256,nativeManifestSha256:original.sha256,files,totalBytes:files.reduce((n,x)=>n+x.bytes,0)};
  const raw=bytes(manifest);if(raw.length>64*1024*1024)throw failure('FRICTIONLESS_MANIFEST_TOO_LARGE','The complete declared source manifest exceeds 64 MiB.');
  parseFrictionlessDownloadManifest(raw,exportId);
  const value={manifest,raw,nativeManifestSha256:original.sha256,manifestSha256:sha(raw),
   manifestFile:{name:FRICTIONLESS_DOWNLOAD_MANIFEST,bytes:raw.length,sha256:sha(raw)}};
  r.exports.set(exportId,value);return value;
 }
 async #execute(name,r,tool,args){
  const model=r.model,input=()=>{const {workspace,action,...body}=args;return body;};
  if(tool==='current'){fields(args);return model.current();}
  if(tool==='input'){fields(args,['input'],['input']);return model.input(args.input);}
  if(tool==='capture'){fields(args,['captureId','section','resource','offset','limit'],['captureId']);
   return model.capture(uuid(args.captureId),{section:args.section??'overview',resource:args.resource,offset:count(args.offset??0),limit:count(args.limit??25,100,1)});}
  if(tool==='intake'){fields(args,['requestId','expectedVersion','input','expectedSha256','label'],['requestId','expectedVersion','input','label']);return model.start('intake',input());}
  if(tool==='edition'){
   if(args.action==='inspect'){fields(args,['action','editionId'],['action','editionId']);return model.edition(uuid(args.editionId));}
   if(args.action==='create'){fields(args,['action','requestId','expectedVersion','captureId','label','queries','queriesText'],['action','requestId','expectedVersion','captureId','label']);return model.start('edition',input());}
  }
  if(tool==='review'){
   if(args.action==='inspect'){fields(args,['action','reviewId'],['action','reviewId']);return model.review(uuid(args.reviewId));}
   if(args.action==='run'){fields(args,['action','requestId','expectedVersion','editionId','reviewer','note'],['action','requestId','expectedVersion','editionId','reviewer','note']);return model.start('review',input());}
  }
  if(tool==='plan_input'){fields(args,['editionId','query'],['editionId','query']);return model.planInput(uuid(args.editionId),args.query);}
  if(tool==='select'){fields(args,['requestId','expectedVersion','editionId','reviewId','expectedSourceHash'],['requestId','expectedVersion','editionId','reviewId','expectedSourceHash']);return model.start('select',input());}
  if(tool==='plan'){fields(args,['requestId','expectedVersion','editionId','reviewId','plan'],['requestId','expectedVersion','editionId','reviewId','plan']);return model.start('plan',input());}
  if(tool==='compare'){
   if(args.action==='inspect'){fields(args,['action','comparisonId'],['action','comparisonId']);return model.comparison(uuid(args.comparisonId));}
   if(args.action==='create'){fields(args,['action','requestId','expectedVersion','before','after','label'],['action','requestId','expectedVersion','before','after','label']);return model.start('compare',input());}
  }
  if(tool==='export'){
   if(args.action==='inspect'){fields(args,['action','requestId'],['action','requestId']);return model.operation(uuid(args.requestId));}
   if(args.action==='create'){fields(args,['action','requestId','expectedVersion','editionId','reviewId','label'],['action','requestId','expectedVersion','editionId','label']);return model.start('export',input());}
  }
  if(tool==='request'){
   fields(args,['action','requestId'],['action','requestId']);uuid(args.requestId);
   if(args.action==='inspect')return model.operation(args.requestId);
   if(args.action==='resume')return model.resume({workspaceId:args.workspaceId,requestId:args.requestId});
  }
  if(tool==='cancel'){fields(args,['requestId','operationId'],['requestId','operationId']);return model.cancel(input());}
  if(tool==='file'){
   fields(args,['kind','id','file','expectedSha256','offset','limit','readId'],['kind','id','file','expectedSha256']);uuid(args.id);hash(args.expectedSha256);
   return r.reads.read({scope:name,key:args.kind+':'+args.id+':'+args.file,kind:'FRICTIONLESS_SOURCE',directory:this.#config.exportsDirectory,
    expectedSha256:args.expectedSha256,offset:count(args.offset??0,FRICTIONLESS_FILE_BYTES),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
    load:async()=>{const file=await model.file(args.kind,args.id,args.file);if(file.sha256!==args.expectedSha256)throw failure('FRICTIONLESS_FILE_CHANGED','Use the exact declared original file digest.');return descriptor(file);}});
  }
  if(tool==='file_release'){fields(args,['readId'],['readId']);await r.reads.release(name,uuid(args.readId));return{state:'RELEASED',readId:args.readId};}
  if(tool==='export_manifest'){fields(args,['exportId'],['exportId']);const selected=await this.#export(r,args.exportId);return{state:'MANIFEST_RETAINED',exportId:args.exportId,manifestFile:selected.manifestFile};}
  if(tool==='export_file'){
   fields(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],['exportId','file','expectedManifestSha256','expectedSha256']);
   const selected=await this.#export(r,args.exportId);hash(args.expectedSha256);
   if(args.expectedManifestSha256!==selected.manifestSha256)throw failure('FRICTIONLESS_FILE_CHANGED','The original source-export download manifest changed.');
   const file=args.file===FRICTIONLESS_DOWNLOAD_MANIFEST?selected.manifestFile:selected.manifest.files.find(x=>x.name===args.file);
   if(!file||file.sha256!==args.expectedSha256)throw failure('FRICTIONLESS_FILE_CHANGED','Choose an exact declared source-export file and digest.');
   const result=await r.reads.read({scope:name,key:'export:'+args.exportId+':'+args.file,kind:'FRICTIONLESS_EXPORT',directory:this.#config.exportsDirectory,
    expectedSha256:args.expectedSha256,offset:count(args.offset??0,file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
    load:async()=>args.file===FRICTIONLESS_DOWNLOAD_MANIFEST?{bytes:selected.raw,name:FRICTIONLESS_DOWNLOAD_MANIFEST,type:'application/json'}:
     descriptor(await model.file('export',args.exportId,args.file))});
   return{exportId:args.exportId,manifestSha256:selected.manifestSha256,...result};
  }
  if(tool==='export_file_release'){fields(args,['exportId','readId'],['exportId','readId']);uuid(args.exportId);await r.reads.release(name,uuid(args.readId));return{state:'RELEASED',exportId:args.exportId,readId:args.readId};}
  if(tool==='browser'){
   fields(args,['action','port'],['action']);if(!['open','close'].includes(args.action))throw failure('INVALID_PARAMS','Open or close this borrowed listener.');
   const pending=r.browserTail.then(async()=>{
    if(args.action==='close'){await r.browser?.close();r.browser=null;return{browser:{open:false}};}
    if(!r.browser){const {startFrictionlessSourceServer}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/workbench/server.mjs');
     r.browser=await startFrictionlessSourceServer({workspace:model,port:count(args.port??0,65535),schedule:r.schedule,ownsWorkspace:false});}
    return{url:r.browser.url,browser:{open:true}};
   });r.browserTail=pending.catch(()=>{});return pending;
  }
  throw failure('INVALID_PARAMS','Choose the documented action and fields for this original source operation.');
 }
 async #dispatch(name,args){
  const tool=name.replace(/^merchant_frictionless_/,'');
  if(tool==='status'){exact(args,['workspace','workspaceId','capturesOffset','editionsOffset','operationsOffset','limit']);return this.#status(args.workspace,args);}
  if(tool==='open'){exact(args,['workspace'],['workspace']);return this.#open(args.workspace);}
  this.#declared(args.workspace);const entry=this.#entries.get(args.workspace);
  if(!entry)throw failure('FRICTIONLESS_NOT_OPEN','Open the declared source workspace first.');
  const lease=await entry.opening,r=lease.resource;
  if(args.workspaceId!==r.model.workspaceId)throw failure('FRICTIONLESS_WORKSPACE_CHANGED','Use the persistent source workspace ID from the original open result.');
  if(tool==='close'){
   fields(args,['instanceId','publisherInstanceId'],['instanceId','publisherInstanceId']);
   if(args.instanceId!==r.instanceId||args.publisherInstanceId!==lease.instanceId)throw failure('FRICTIONLESS_INSTANCE_CHANGED','Close only the exact inspected owner instances.');
   return this.#stop(args.workspace,entry);
  }
  if(entry.closing||r.closing||lease.closed)throw failure('FRICTIONLESS_CLOSING','The original source workspace is closing.');
  return lease.run(async resource=>{const value=await this.#execute(args.workspace,resource,tool,args);return tool==='browser'?{...this.#view(args.workspace,resource),...value}:value;});
 }
 async call(tool,args={}){
  if(this.#closing)throw failure('OPERATOR_CLOSING','The original Frictionless source adapter is closing.');
  const work=this.#dispatch(tool,structuredClone(args));this.#pending.add(work);
  try{return await work;}catch(e){if(e.path||e.syscall)throw failure('FRICTIONLESS_STORAGE_UNAVAILABLE','Inspect the retained request before retrying original storage.');throw e;}
  finally{this.#pending.delete(work);}
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;
  this.#close=(async()=>{await Promise.allSettled([...this.#pending]);
   const done=await Promise.allSettled([...this.#entries].map(([name,entry])=>this.#stop(name,entry)));
   const errors=done.filter(x=>x.status==='rejected');if(errors.length)throw new AggregateError(errors.map(x=>x.reason),'Original Frictionless resource closure is incomplete.');})();
  return this.#close;
 }
}
