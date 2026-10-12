// SPDX-License-Identifier: MIT
// One original publisher lease; no new SQL engine, customer server or payment path.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {exact,failure,identifier} from './host-files.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from './retained-file-reads.mjs';
import {bytes} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import {LOCAL_DATASET_DOWNLOAD_MANIFEST,LOCAL_DATASET_DOWNLOAD_SCHEMA,LOCAL_DATASET_FILE_BYTES,UUID,HASH,parseLocalDatasetDownloadManifest} from './local-dataset-download-contract.mjs';
export {localDatasetWorkspaceTools} from './catalog/local-dataset-workspace.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>{if(typeof x!=='string'||!UUID.test(x))throw failure('INVALID_PARAMS','Use the exact lowercase original UUID.');return x;};
const hash=x=>{if(typeof x!=='string'||!HASH.test(x))throw failure('INVALID_PARAMS','Use the exact original SHA-256.');return x;};
const count=(x,max,min=0)=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw failure('INVALID_PARAMS','Use an integer within the original bound.');return x;};
function fields(args,keys=[],required=[]){exact(args,['workspace','workspaceId',...keys],['workspace','workspaceId',...required]);}
async function descriptor(file){
 const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||info.mode&0o077||info.size!==file.bytes||file.bytes>LOCAL_DATASET_FILE_BYTES)
   throw failure('LOCAL_DATASET_FILE_CHANGED','The original private file differs from its retained declaration.');
  return{readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:'application/octet-stream'};
 }catch(e){await handle.close();throw e;}
}
export class MerchantLocalDatasetWorkspaces{
 #config;#publishers;#entries=new Map();#pending=new Set();#closing=false;#close;
 constructor(config,publishers){this.#config=config;this.#publishers=publishers;}
 get summary(){return{configured:Boolean(this.#config.localDatasetWorkspaces),opened:[...this.#entries.keys()],closing:this.#closing,pending:this.#pending.size};}
 #declared(name){identifier(name,'Local dataset workspace');const value=this.#config.localDatasetWorkspaces?.workspaces?.[name];if(!value)throw failure('LOCAL_DATASET_NOT_CONFIGURED','Choose a host-declared original local dataset workspace.');return value;}
 #view(name,resource){const c=this.#declared(name);return{workspace:name,instanceId:resource.instanceId,publisherInstanceId:resource.publisherInstanceId,
  workspaceId:resource.model.workspaceId,publisher:c.publisher,customer:{name:c.customer.name,workspaceId:c.customer.workspaceId},directory:resource.model.directory};}
 async #resource(name,entry,configured,owned){
  const {openLocalDatasetReceiving}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/local-dataset-receiving/model.mjs');
  const model=await openLocalDatasetReceiving({publisher:owned.publisher,customer:configured.customer});
  const resource={model,publisher:owned.publisher,schedule:owned.schedule,instanceId:randomUUID(),publisherInstanceId:owned.instanceId,
   reads:new RetainedFileReads({errorPrefix:'LOCAL_DATASET'}),browser:null,browserTail:Promise.resolve(),packages:new Map(),closing:false,closePromise:null};
  resource.close=()=>{
   if(resource.closePromise)return resource.closePromise;resource.closing=true;
   resource.closePromise=(async()=>{
    const errors=[];await resource.browserTail.catch(()=>{});
    if(resource.browser)try{await resource.browser.close();resource.browser=null;}catch(e){errors.push(e);}
    try{await model.close();}catch(e){errors.push(e);}
    try{await resource.reads.close();}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,'The original local customer resources did not all close.');
    resource.packages.clear();if(this.#entries.get(name)===entry)this.#entries.delete(name);
   })().catch(e=>{resource.closePromise=null;throw e;});return resource.closePromise;
  };entry.resource=resource;return resource;
 }
 async #open(name){
  const c=this.#declared(name);let entry=this.#entries.get(name);
  if(entry?.closing||entry?.resource?.closing)throw failure('LOCAL_DATASET_CLOSING','Continue this original close before reopening.');
  if(!entry){
   entry={opening:null,lease:null,resource:null,closing:null};this.#entries.set(name,entry);
   entry.opening=this.#publishers.borrow(c.publisher,{kind:'frictionless',key:'local-dataset:'+name,open:owned=>this.#resource(name,entry,c,owned)})
    .then(lease=>{entry.lease=lease;return lease;});
   try{await entry.opening;}catch(e){if(this.#entries.get(name)===entry)this.#entries.delete(name);throw e;}
  }else await entry.opening;
  return this.#status(name);
 }
 async #status(name,args={}){
  if(name===undefined)return{...this.summary,workspaces:Object.entries(this.#config.localDatasetWorkspaces?.workspaces??{}).map(([workspace,c])=>{
   const entry=this.#entries.get(workspace);return{workspace,label:c.label,publisher:c.publisher,customer:{name:c.customer.name,workspaceId:c.customer.workspaceId},
    state:!entry?'CLOSED':entry.closing||entry.resource?.closing?'CLOSING':entry.resource?'OPEN':'OPENING'};})};
  const c=this.#declared(name),entry=this.#entries.get(name);
  if(!entry)return{workspace:name,publisher:c.publisher,customer:{name:c.customer.name,workspaceId:c.customer.workspaceId},state:'CLOSED'};
  const lease=await entry.opening,r=lease.resource;
  if(entry.closing||r.closing||lease.closed)return{...this.#view(name,r),state:'CLOSING'};
  return lease.run(async resource=>({...this.#view(name,resource),state:'OPEN',native:await resource.model.status({offset:count(args.offset??0,Number.MAX_SAFE_INTEGER),limit:count(args.limit??25,100,1)}),browser:{open:Boolean(resource.browser)},fileReads:resource.reads.status(name)}));
 }
 async #stop(name,entry){
  if(entry.closing)return entry.closing;
  entry.closing=(async()=>{const lease=await entry.opening,view=this.#view(name,lease.resource);await lease.release();if(this.#entries.get(name)===entry)this.#entries.delete(name);return{...view,state:'CLOSED',publisherState:'OWNED_BY_MERCHANT_PUBLISHER',customerState:'INDEPENDENT_NATIVE_OWNER'};})().catch(e=>{entry.closing=null;throw e;});return entry.closing;
 }
 async #package(resource,exportId){
  uuid(exportId);const operation=await resource.model.operation(exportId);
  if(operation.kind!=='package'||operation.state!=='COMPLETE'||operation.result?.requestId!==exportId)throw failure('LOCAL_DATASET_PACKAGE_NOT_COMPLETE','Choose this original completed package request.');
  const result=operation.result;
  const old=resource.packages.get(exportId);if(old&&old.nativeManifestSha256===result.manifestSha256)return old;
  const manifest={schema:LOCAL_DATASET_DOWNLOAD_SCHEMA,exportId,workspaceId:resource.model.workspaceId,deliveryId:result.deliveryId,
   nativeManifestSha256:result.manifestSha256,files:result.files.map(({name,bytes,sha256})=>({name,bytes,sha256})),totalBytes:result.files.reduce((n,x)=>n+x.bytes,0)};
  const raw=bytes(manifest);parseLocalDatasetDownloadManifest(raw,exportId);
  const value={manifest,raw,nativeManifestSha256:result.manifestSha256,manifestSha256:sha(raw),
   manifestFile:{name:LOCAL_DATASET_DOWNLOAD_MANIFEST,bytes:raw.length,sha256:sha(raw)}};
  resource.packages.set(exportId,value);return value;
 }
 async #execute(name,resource,tool,args){
  const model=resource.model;
  const input=()=>{const {workspace,...body}=args;return body;};
  if(tool==='record'){fields(args,['deliveryId'],['deliveryId']);return model.record(uuid(args.deliveryId));}
  if(tool==='prepare'){fields(args,['requestId','runId','reviewId','candidateDigest','query','reviewer','note'],['requestId','runId','reviewId','candidateDigest','query','reviewer','note']);return model.start('prepare',input());}
  if(tool==='continue'){fields(args,['requestId','deliveryId'],['requestId','deliveryId']);return model.start('continue',input());}
  if(tool==='cancel'){fields(args,['requestId','operationId'],['requestId','operationId']);return model.cancel(input());}
  if(tool==='request'){
   fields(args,['action','requestId'],['action','requestId']);uuid(args.requestId);
   if(args.action==='inspect')return model.operation(args.requestId);
   if(args.action==='resume')return model.resume({workspaceId:args.workspaceId,requestId:args.requestId});
   throw failure('INVALID_PARAMS','Inspect or explicitly resume the original request.');
  }
  if(tool==='customer'){
   fields(args,['action','requestId','deliveryId','operation','arguments'],['action','deliveryId','operation','arguments']);
   if(args.action==='read'){if(args.requestId!==undefined)throw failure('INVALID_PARAMS','Read operations do not use a mutation request ID.');return model.customerRead(uuid(args.deliveryId),args.operation,args.arguments);}
   if(args.action==='write'){uuid(args.requestId);const {action,...body}=input();return model.start('customer',body);}
   throw failure('INVALID_PARAMS','Choose an original read or write operation.');
  }
  if(tool==='package'){
   fields(args,['action','requestId','deliveryId','warehouseExportId','exports'],['action','requestId']);uuid(args.requestId);
   if(args.action==='inspect')return model.operation(args.requestId);
   if(args.action==='create'){uuid(args.deliveryId);const {action,...body}=input();return model.start('package',body);}
   throw failure('INVALID_PARAMS','Create or inspect the original complete package request.');
  }
  if(tool==='file'){
   fields(args,['deliveryId','file','expectedSha256','offset','limit','readId'],['deliveryId','file','expectedSha256']);uuid(args.deliveryId);hash(args.expectedSha256);
   return resource.reads.read({scope:name,key:'delivery:'+args.deliveryId+':'+args.file,kind:'LOCAL_DATASET_ORIGINAL',directory:this.#config.exportsDirectory,
    expectedSha256:args.expectedSha256,offset:count(args.offset??0,LOCAL_DATASET_FILE_BYTES),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
    load:async()=>{const file=await model.file(args.deliveryId,args.file);if(file.sha256!==args.expectedSha256)throw failure('LOCAL_DATASET_FILE_CHANGED','Use the exact declared original file digest.');return descriptor(file);}});
  }
  if(tool==='file_release'){fields(args,['readId'],['readId']);await resource.reads.release(name,uuid(args.readId));return{state:'RELEASED',readId:args.readId};}
  if(tool==='package_manifest'){fields(args,['exportId'],['exportId']);const selected=await this.#package(resource,args.exportId);return{state:'MANIFEST_RETAINED',exportId:args.exportId,manifestFile:selected.manifestFile};}
  if(tool==='package_file'){
   fields(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],['exportId','file','expectedManifestSha256','expectedSha256']);
   const selected=await this.#package(resource,args.exportId);hash(args.expectedSha256);
   if(args.expectedManifestSha256!==selected.manifestSha256)throw failure('LOCAL_DATASET_FILE_CHANGED','The original complete package manifest changed.');
   const file=args.file===LOCAL_DATASET_DOWNLOAD_MANIFEST?selected.manifestFile:selected.manifest.files.find(x=>x.name===args.file);
   if(!file||file.sha256!==args.expectedSha256)throw failure('LOCAL_DATASET_FILE_CHANGED','Choose an exact declared package file and digest.');
   const result=await resource.reads.read({scope:name,key:'package:'+args.exportId+':'+args.file,kind:'LOCAL_DATASET_PACKAGE',directory:this.#config.exportsDirectory,
    expectedSha256:args.expectedSha256,offset:count(args.offset??0,file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
    load:async()=>args.file===LOCAL_DATASET_DOWNLOAD_MANIFEST?{bytes:selected.raw,name:LOCAL_DATASET_DOWNLOAD_MANIFEST,type:'application/json'}:descriptor(await model.packageFile(args.exportId,args.file))});
   return{exportId:args.exportId,manifestSha256:selected.manifestSha256,...result};
  }
  if(tool==='package_file_release'){fields(args,['exportId','readId'],['exportId','readId']);uuid(args.exportId);await resource.reads.release(name,uuid(args.readId));return{state:'RELEASED',exportId:args.exportId,readId:args.readId};}
  if(tool==='browser'){
   fields(args,['action','port'],['action']);if(!['open','close'].includes(args.action))throw failure('INVALID_PARAMS','Open or close this borrowed browser listener.');
   const pending=resource.browserTail.then(async()=>{
    if(args.action==='close'){await resource.browser?.close();resource.browser=null;return{browser:{open:false}};}
    if(!resource.browser){const {startLocalDatasetReceivingServer}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/local-dataset-receiving/server.mjs');
     resource.browser=await startLocalDatasetReceivingServer({workspace:model,port:count(args.port??0,65535),schedule:resource.schedule,ownsWorkspace:false});}
    return{url:resource.browser.url,browser:{open:true}};
   });resource.browserTail=pending.catch(()=>{});return pending;
  }
  throw failure('METHOD_NOT_FOUND','Unknown original local dataset operation.');
 }
 async #dispatch(name,args){
  const tool=name.replace(/^merchant_local_dataset_/,'');
  if(tool==='status'){exact(args,['workspace','workspaceId','offset','limit']);return this.#status(args.workspace,args);}
  if(tool==='open'){exact(args,['workspace'],['workspace']);return this.#open(args.workspace);}
  this.#declared(args.workspace);const entry=this.#entries.get(args.workspace);if(!entry)throw failure('LOCAL_DATASET_NOT_OPEN','Open the declared original workspace first.');
  const lease=await entry.opening,resource=lease.resource;
  if(args.workspaceId!==resource.model.workspaceId)throw failure('LOCAL_DATASET_WORKSPACE_CHANGED','Use the persistent delivery workspace ID from the original open result.');
  if(tool==='close'){
   fields(args,['instanceId','publisherInstanceId'],['instanceId','publisherInstanceId']);
   if(args.instanceId!==resource.instanceId||args.publisherInstanceId!==lease.instanceId)throw failure('LOCAL_DATASET_INSTANCE_CHANGED','Close only the exact inspected owner instances.');
   return this.#stop(args.workspace,entry);
  }
  if(entry.closing||resource.closing||lease.closed)throw failure('LOCAL_DATASET_CLOSING','The original workspace owner is closing.');
  return lease.run(async current=>{
   const value=await this.#execute(args.workspace,current,tool,args);
   return tool==='browser'?{...this.#view(args.workspace,current),...value}:value;
  });
 }
 async call(tool,args={}){
  if(this.#closing)throw failure('OPERATOR_CLOSING','The original local dataset adapter is closing.');
  const work=this.#dispatch(tool,structuredClone(args));this.#pending.add(work);
  try{return await work;}catch(e){if(e.path||e.syscall)throw failure('LOCAL_DATASET_STORAGE_UNAVAILABLE','Inspect the retained original request before retrying its storage operation.');throw e;}
  finally{this.#pending.delete(work);}
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;
  this.#close=(async()=>{await Promise.allSettled([...this.#pending]);const done=await Promise.allSettled([...this.#entries].map(([name,entry])=>this.#stop(name,entry)));
   const errors=done.filter(x=>x.status==='rejected');if(errors.length)throw new AggregateError(errors.map(x=>x.reason),'Original local dataset resource closure is incomplete.');})();
  return this.#close;
 }
}
