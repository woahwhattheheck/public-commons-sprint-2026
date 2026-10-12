// MIT. Host aliases own one original DuckDB model/browser; every tool delegates to it.
import {constants} from 'node:fs';
import {open,realpath,access,readdir,rename,rm} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {exact,failure,identifier,line,plain} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {RetainedFileReads,MAX_RETAINED_IMMUTABLE_FILE_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {privateDirectory as privateHost,acquireWorkspace} from '../../postgres/publisher/files.mjs';
import {atomicJson,readJson,fileDigest,syncDirectory} from './files.mjs';
import {CLOUD_ACTIONS,CLOUD_ARTIFACTS,cloudWorkspaceTools,MAX_RETAINED_CHUNK_BYTES} from './catalog.mjs';
import {inspectCloudWorkspace,inspectCloudLaunchSource,startCloudLaunch} from './launch.mjs';
export {cloudWorkspaceTools};
export const CLOUD_CONNECTION_SCHEMA='stellar-forge.coinmetrics-cloud-connection.v1';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function path(value,base){
 if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x1f\x7f]/.test(value))
  throw failure('CONFIGURATION_ERROR','Declare a canonical host path.');
 return resolve(base,value);
}
async function privateJson(filename){
 const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat({bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.mode&0o077n||before.size<1n||before.size>2097152n)
   throw failure('CONFIGURATION_ERROR','Select a private regular configuration no larger than 2 MiB.');
  const data=await file.readFile(),after=await file.stat({bigint:true});
  if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key])||BigInt(data.length)!==after.size)
   throw failure('CLOUD_CONFIGURATION_CHANGED','The host configuration changed while it was read.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}
  catch{throw failure('CONFIGURATION_ERROR','Use a UTF-8 JSON configuration.');}
  return {value,sha256:createHash('sha256').update(data).digest('hex')};
 }finally{await file.close();}
}
function environment(value){
 if(!plain(value)||Object.keys(value).length>256||Object.entries(value).some(([key,item])=>
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof item!=='string'||item.length>65536||item.includes('\0')))
  throw failure('CONFIGURATION_ERROR','The private host environment must contain bounded environment-name/string pairs.');
 return value;
}
export async function readCloudWorkspaceConfiguration(filename){
 filename=resolve(filename);const raw=(await privateJson(filename)).value;
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 if(raw.schema!==CLOUD_CONNECTION_SCHEMA||!plain(raw.workspaces)||Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
  throw failure('CONFIGURATION_ERROR','Declare one to 32 existing original Cloud/DuckDB workspaces.');
 const base=dirname(filename),workspaces=Object.create(null),directories=new Set();
 const source=await inspectCloudLaunchSource();
 for(const [alias,value]of Object.entries(raw.workspaces)){
  identifier(alias,'Cloud workspace alias');exact(value,['label','directory','workspaceId','python','environmentFile'],['directory','workspaceId']);
  const directory=path(value.directory,base);await privateHost(directory,false);
  if(await realpath(directory)!==directory||directories.has(directory)||!UUID.test(value.workspaceId??''))
   throw failure('CONFIGURATION_ERROR','Bind every canonical workspace once with its existing UUID.');
  const checked=await inspectCloudWorkspace(directory,{workspaceId:value.workspaceId});directories.add(directory);
  const saved={label:value.label===undefined?alias:line(value.label,'Workspace label'),directory,
   workspaceId:checked.workspaceId,sourceSha256:source.sha256};
  if(value.python!==undefined){saved.python=path(value.python,base);await access(saved.python,constants.X_OK);}
  if(value.environmentFile!==undefined){
   saved.environmentFile=path(value.environmentFile,base);const original=await privateJson(saved.environmentFile);
   environment(original.value);saved.environmentSha256=original.sha256;
  }
  workspaces[alias]=saved;
 }
 return {schema:CLOUD_CONNECTION_SCHEMA,workspaces};
}
export async function initializeCloudMerchant(options){
 exact(options,['directory','connection','name'],['directory','connection']);
 const root=path(options.directory,process.cwd()),connection=path(options.connection,process.cwd());
 const configured=await readCloudWorkspaceConfiguration(connection),name=line(options.name??'Starforge Cloud Delivery','Merchant name');
 for(const entry of Object.values(configured.workspaces)){
  const rel=relative(entry.directory,root);
  if(!rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep))throw failure('CONFIGURATION_ERROR','Keep the MCP host outside every selected source workspace.');
 }
 await privateHost(root,true);const release=await acquireWorkspace(root);
 try{
  const configuration=join(root,'merchant-mcp.json'),releaseStore=join(root,'releases');
  const value={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore,exportsDirectory:'./customer-exports',
   sources:{},cloudWorkspaceConnection:connection};
  await atomicJson(join(root,'cloud-host-setup.json'),{schema:'stellar-forge.cloud-host-setup.v1',configuration:value,workspaces:configured.workspaces});
  const {readReleaseState,initReleaseStore}=await import('../../../sf82-seller-pilot/releases.mjs');
  let missing=false;try{await access(releaseStore);}catch(error){if(error.code!=='ENOENT')throw error;missing=true;}
  if(missing){
   const stage=join(root,'.cloud-release-'+randomUUID());let published=false;
   try{
    await initReleaseStore(stage);await readReleaseState(stage);
    try{await access(releaseStore);throw failure('CLOUD_RELEASE_STORE_APPEARED','Inspect the original host release store before continuing.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await rename(stage,releaseStore);published=true;await syncDirectory(root);
   }finally{if(!published)await rm(stage,{recursive:true,force:true});}
  }
  await readReleaseState(releaseStore);await privateHost(join(root,'customer-exports'),true);
  await atomicJson(configuration,value);
  const native=await (await import('../../../../../stellar-forge/mcp-merchant-operator/config.mjs')).readMerchantConfig(configuration);
  if(!native.cloudWorkspaces)throw failure('CLOUD_PROVIDER_NOT_INSTALLED','Select the original Cloud source contribution in this installed merchant host.');
  return {schema:value.schema,state:'READY',configuration,releaseStore,workspaces:Object.entries(configured.workspaces).map(([workspace,v])=>
   ({workspace,label:v.label,workspaceId:v.workspaceId})),ownership:'ORIGINAL_DUCKDB_WORKSPACE'};
 }finally{await release();}
}
function checkedNumber(value,fallback,maximum=Number.MAX_SAFE_INTEGER){
 value??=fallback;if(!Number.isSafeInteger(value)||value<0||value>maximum)throw failure('INVALID_PARAMS','Use a bounded nonnegative integer.');return value;
}
function page(values,input){
 const offset=checkedNumber(input.offset,0),limit=checkedNumber(input.limit,50,200);
 if(limit<1)throw failure('INVALID_PARAMS','Page size must be positive.');
 return {items:values.slice(offset,offset+limit),offset,limit,total:values.length,nextOffset:offset+limit<values.length?offset+limit:null};
}
function clean(value,_root){
 // These are original native records, including typed source cells, requests and
 // editable plan values. A blanket path-looking string replacement would change
 // those values while retaining their original hashes. Credentials stay in the
 // private host configuration, which is never part of this returned record.
 return value===undefined?undefined:JSON.parse(JSON.stringify(value));
}
function safe(error){
 const code=/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'CLOUD_NATIVE_OPERATION_FAILED';
 return failure(code,'Original Cloud/DuckDB operation: '+code+'. Inspect the retained operation and current source before continuation.');
}
export class MerchantCloudWorkspaces{
 #config;#entries=new Map();#opening=new Map();#closing=false;#closePromise;
 #reads=new RetainedFileReads({errorPrefix:'CLOUD_ARTIFACT'});
 constructor(config){this.#config=config;}
 get summary(){
  return {configured:Boolean(this.#config.cloudWorkspaces),closing:this.#closing,...this.#reads.summary,
   workspaces:Object.entries(this.#config.cloudWorkspaces?.workspaces??{}).map(([workspace,value])=>{
    const entry=this.#entries.get(workspace);
    return {workspace,label:value.label,workspaceId:value.workspaceId,open:Boolean(entry),opening:this.#opening.has(workspace),
     closing:Boolean(entry?.closeRequested),instanceId:entry?.instanceId??null,browserUrl:entry?.service.url??null};
   })};
 }
 #definition(alias){
  identifier(alias,'Cloud workspace alias');const found=this.#config.cloudWorkspaces?.workspaces[alias];
  if(!found)throw failure('CLOUD_WORKSPACE_NOT_CONFIGURED','Choose an alias from merchant_cloud_workspaces.');return found;
 }
 #entry(alias,allowClosing=false){
  this.#definition(alias);const entry=this.#entries.get(alias);
  if(!entry)throw failure('CLOUD_WORKSPACE_NOT_OPEN','Open the selected original workspace first.');
  if(entry.closeRequested&&!allowClosing)throw failure('CLOUD_WORKSPACE_CLOSING','This original workspace owner is closing.');return entry;
 }
 #scope(entry){return 'cloud:'+entry.alias+':'+entry.workspaceId;}
 #instance(entry,value){if(value!==entry.instanceId)throw failure('CLOUD_WORKSPACE_INSTANCE_CHANGED','Use the current original workspace instance UUID.');}
 async #status(entry){
  const state=await entry.model.state(),cloud=state.cloud;
  return {workspace:entry.alias,workspaceId:entry.workspaceId,instanceId:entry.instanceId,browserUrl:entry.service.url,
   native:clean({schema:state.schema,workspaceId:state.workspaceId,source:state.source,sourceError:state.sourceError,authoringError:state.authoringError,
    sourceChanged:state.sourceChanged,draft:state.draft,initialPlan:state.initialPlan,drafts:state.drafts,packages:state.packages,runtime:state.runtime,
    cloud:{schema:cloud.schema,revision:cloud.revision,selection:cloud.selection,contracts:cloud.contracts,
     counts:Object.fromEntries(['editions','comparisons','deliveries','receivings','archiveIntakes','events'].map(k=>[k,cloud[k].length]))}},entry.directory),
   artifactReads:this.#reads.status(this.#scope(entry))};
 }
 async #open(alias){
  const definition=this.#definition(alias);
  if(this.#entries.has(alias))return this.#status(this.#entry(alias));
  if(this.#opening.has(alias))return this.#opening.get(alias);
  const pending=(async()=>{
   await inspectCloudWorkspace(definition.directory,{workspaceId:definition.workspaceId});
   let env=process.env;
   if(definition.environmentFile){
    const retained=await privateJson(definition.environmentFile);
    if(retained.sha256!==definition.environmentSha256)throw failure('CLOUD_CONFIGURATION_CHANGED','The private environment file changed.');
    env={...process.env,...environment(retained.value)};
   }
   let service,entry;
   try{
    service=await startCloudLaunch({directory:definition.directory,workspaceId:definition.workspaceId,sourceSha256:definition.sourceSha256,
     python:definition.python??'python3',environment:env,port:0});
    entry={alias,workspaceId:definition.workspaceId,directory:definition.directory,service,model:service.model,
     instanceId:service.instanceId,pending:new Set(),closeRequested:false,closing:null};
    this.#entries.set(alias,entry);
    if(this.#closing)throw failure('CLOUD_WORKSPACE_CLOSING','The merchant operator is closing.');
    return await this.#status(entry);
   }catch(error){
    if(entry)await this.#closeEntry(entry);else if(service)await service.close();throw error;
   }
  })();
  this.#opening.set(alias,pending);try{return await pending;}finally{this.#opening.delete(alias);}
 }
 async #closeEntry(entry){
  entry.closeRequested=true;
  if(!entry.closing){
   const pending=(async()=>{
    const results=await Promise.allSettled([entry.service.close(),this.#reads.closeScope(this.#scope(entry)),Promise.allSettled([...entry.pending])]);
    const failed=results.filter(value=>value.status==='rejected');if(failed.length)throw failed[0].reason;
    if(this.#entries.get(entry.alias)===entry)this.#entries.delete(entry.alias);
    return {workspace:entry.alias,workspaceId:entry.workspaceId,instanceId:entry.instanceId,state:'CLOSED'};
   })();
   entry.closing=pending;void pending.catch(()=>{if(entry.closing===pending)entry.closing=null;});
  }
  return entry.closing;
 }
 async #artifact(entry,input){
  if(!CLOUD_ARTIFACTS.includes(input.artifact))throw failure('INVALID_PARAMS','Choose an original Cloud artifact kind.');
  if(typeof input.id!=='string'||!input.id)throw failure('INVALID_PARAMS','Use the retained artifact identity.');
  const key=JSON.stringify([input.artifact,input.id,input.file??null,input.kind??null]);
  return this.#reads.read({scope:this.#scope(entry),key,kind:'cloud-original-artifact',directory:entry.directory,
   readId:input.readId,expectedSha256:input.expectedSha256,offset:input.offset,limit:input.limit,load:async()=>{
    if(input.artifact==='package'){
     const artifact=await entry.model.artifact({packageId:input.id,name:input.file});
     return {bytes:artifact.bytes,name:input.file.replaceAll('/','-'),type:artifact.type};
    }
    let descriptor;
    if(input.artifact==='source')descriptor=await entry.model.cloud.file({editionId:input.id,fileId:input.file});
    if(input.artifact==='comparison'){
     if(input.kind!==undefined&&!['summary','full'].includes(input.kind))throw failure('INVALID_PARAMS','Choose summary or full comparison.');
     descriptor=input.kind==='summary'?await entry.model.cloud.report({id:input.id,kind:'summary'}):await entry.model.cloud.retainedReport({id:input.id});
    }
    if(input.artifact==='delivery')descriptor=await entry.model.cloud.delivery({id:input.id});
    const sha256=descriptor.sha256??(await fileDigest(descriptor.path,MAX_RETAINED_IMMUTABLE_FILE_BYTES)).sha256;
    const handle=await open(descriptor.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
     const stat=await handle.stat();
     if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size>MAX_RETAINED_IMMUTABLE_FILE_BYTES)
      throw failure('CLOUD_ARTIFACT_CHANGED','The selected native artifact changed.');
     return {readonlyFileHandle:handle,bytes:stat.size,sha256,name:descriptor.filename,type:descriptor.type};
    }catch(error){await handle.close();throw error;}
   }});
 }
 async #execute(entry,name,args){
  const {workspace,...input}=args,suffix=name.slice('merchant_cloud_'.length);
  if(Object.hasOwn(CLOUD_ACTIONS,suffix)){
   const action=CLOUD_ACTIONS[suffix];exact(input,['workspaceInstanceId',...Object.keys(action.properties)],['workspaceInstanceId',...action.required]);
   this.#instance(entry,input.workspaceInstanceId);const {workspaceInstanceId,...native}=input;
   const [owner,method]=action.native.includes('.')?action.native.split('.'):[null,action.native];
   const result=await (owner?entry.model[owner]:entry.model)[method](JSON.parse(JSON.stringify(native)));
   return {workspace,workspaceId:entry.workspaceId,instanceId:entry.instanceId,result:clean(result,entry.directory)};
  }
  switch(suffix){
   case 'status':exact(input,[]);return this.#status(entry);
   case 'operation':exact(input,['operationId','kind'],['operationId']);
    return {workspace,workspaceId:entry.workspaceId,result:clean((input.kind??'cloud')==='cloud'?await entry.model.cloud.operation({operationId:input.operationId}):
     entry.model.operation({operationId:input.operationId,kind:input.kind}),entry.directory)};
   case 'records':{
    exact(input,['kind','offset','limit'],['kind']);
    if(!['editions','comparisons','deliveries','receivings','archiveIntakes','events'].includes(input.kind))throw failure('INVALID_PARAMS','Choose an original record collection.');
    const state=await entry.model.cloud.state(),rows=state[input.kind].map(value=>{
     if(input.kind!=='editions')return value;const {inspection,...summary}=value;
     return {...summary,relations:inspection?.relations?.length??0};
    });
    return {workspace,revision:state.revision,kind:input.kind,...clean(page(rows,input),entry.directory)};
   }
   case 'edition':{
    exact(input,['id','offset','limit'],['id']);const value=await entry.model.cloud.edition(input.id);
    if(value.archive)return {workspace,edition:clean(value,entry.directory)};
    const {files,...manifest}=value.manifest,{relations,...inspection}=value.inspection??{relations:[]};
    return {workspace,edition:clean({...value,manifest:{...manifest,files:page(files,input)},
     inspection:{...inspection,relations:page(relations??[],input)},uploads:page(value.uploads,input)},entry.directory)};
   }
   case 'comparison':exact(input,['id','offset','limit'],['id']);return {workspace,result:clean(await entry.model.cloud.comparison(input),entry.directory)};
   case 'received_draft':exact(input,['receivingId'],['receivingId']);return {workspace,result:clean(await entry.model.cloud.receivedDraft(input),entry.directory)};
   case 'upload_status':
   case 'upload_chunk':{
    const chunk=suffix==='upload_chunk',fields=['workspaceInstanceId','editionId','fileId',...(chunk?['offset','data','sha256']:[])];
    exact(input,fields,fields);this.#instance(entry,input.workspaceInstanceId);
    if(chunk&&(typeof input.data!=='string'||input.data.length>Math.ceil(MAX_RETAINED_CHUNK_BYTES/3)*4))
     throw failure('INVALID_PARAMS','Use one original bounded transfer chunk.');
    const {workspaceInstanceId,...native}=input;
    return {workspace,result:await entry.model.cloud[chunk?'uploadChunk':'uploadStatus'](native)};
   }
   case 'catalog':exact(input,['sourceSha256','cursor'],['sourceSha256']);return {workspace,result:clean(await entry.model.catalog(input),entry.directory)};
   case 'author_review':
   case 'author_reopen':exact(input,['entry','sourceSha256'],['entry','sourceSha256']);
    return {workspace,result:clean(await entry.model[suffix==='author_review'?'authorReview':'reopenAuthor'](input),entry.directory)};
   case 'draft':exact(input,['revision'],['revision']);
    return {workspace,result:clean(input.revision===0?(await entry.model.state()).initialPlan:entry.model.draft(input.revision),entry.directory)};
   case 'plan_review':exact(input,['revision'],['revision']);return {workspace,result:clean(await entry.model.review(input),entry.directory)};
   case 'preview':exact(input,['sourceSha256','authoring','query','input'],['sourceSha256','query']);
    return {workspace,result:clean(await entry.model.preview(input),entry.directory)};
   case 'inspect':exact(input,['packageId'],['packageId']);return {workspace,result:clean(await entry.model.inspect(input),entry.directory)};
   case 'runtime':exact(input,[]);return {workspace,result:entry.model.runtime()};
   case 'artifact_read':exact(input,['artifact','id','file','kind','expectedSha256','readId','offset','limit'],['artifact','id','offset','limit']);return this.#artifact(entry,input);
   default:throw failure('METHOD_NOT_FOUND','Choose a declared Cloud workspace tool.');
  }
 }
 async call(name,args={}){
  if(name==='merchant_cloud_workspaces'){exact(args,[]);return this.summary;}
  if(this.#closing)throw failure('CLOUD_WORKSPACE_CLOSING','The original Cloud provider is closing.');
  if(!plain(args)||typeof args.workspace!=='string')throw failure('INVALID_PARAMS','Choose a configured workspace alias.');
  try{
   if(name==='merchant_cloud_open'){exact(args,['workspace'],['workspace']);return await this.#open(args.workspace);}
   if(name==='merchant_cloud_close'){
    exact(args,['workspace','workspaceInstanceId'],['workspace','workspaceInstanceId']);
    const entry=this.#entry(args.workspace,true);this.#instance(entry,args.workspaceInstanceId);return await this.#closeEntry(entry);
   }
   const entry=this.#entry(args.workspace);
   if(name==='merchant_cloud_artifact_release'){
    exact(args,['workspace','readId'],['workspace','readId']);await this.#reads.release(this.#scope(entry),args.readId);
    return {workspace:args.workspace,readId:args.readId,state:'RELEASED'};
   }
   const pending=this.#execute(entry,name,JSON.parse(JSON.stringify(args)));entry.pending.add(pending);
   try{return await pending;}finally{entry.pending.delete(pending);}
  }catch(error){throw safe(error);}
 }
 close(){
  this.#closing=true;
  if(!this.#closePromise){
   const pending=(async()=>{
    await Promise.allSettled([...this.#opening.values()]);
    const results=await Promise.allSettled([...this.#entries.values()].map(entry=>this.#closeEntry(entry)));
    await this.#reads.close();const failed=results.filter(value=>value.status==='rejected');if(failed.length)throw failed[0].reason;
   })();this.#closePromise=pending;void pending.catch(()=>{if(this.#closePromise===pending)this.#closePromise=null;});
  }return this.#closePromise;
 }
}
