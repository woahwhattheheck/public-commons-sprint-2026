// MIT. Agent attachment borrows one original HTTP owner; no SQLite/server launch.
import {open,mkdtemp,unlink,rmdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {RetainedFileReads} from '../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {createHighwayFieldClient} from './client.mjs';
import {highwayFieldTools} from './catalog.mjs';
import {plain,need,HASH,UUID,MAX_ARCHIVE,canonical,absolute,jsonFile,realDirectory,branch} from './contract.mjs';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
function exact(value,keys,required=[]){need(plain(value)&&Object.keys(value).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'PARAMS');}
const definitions=new Map(highwayFieldTools((name,_description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
export async function readHighwayFieldConfiguration(file){
 file=absolute(file);const value=await jsonFile(file,2*1024*1024,{privateOnly:true});
 exact(value,['schema','workspaces','files','storageDirectory'],['schema','workspaces','storageDirectory']);
 need(value.schema==='stellar-forge.highway-field-operations-workspaces.v1'&&plain(value.workspaces)&&Object.keys(value.workspaces).length>=1&&Object.keys(value.workspaces).length<=32,'CONFIGURATION');
 const configuration={schema:value.schema,storageDirectory:resolve(dirname(file),value.storageDirectory),workspaces:Object.create(null),files:Object.create(null)};
 await realDirectory(configuration.storageDirectory,{privateOnly:true});
 for(const [alias,v]of Object.entries(value.workspaces)){
  need(ALIAS.test(alias),'ALIAS');exact(v,['label','connectionFile','workspaceId','workspaceDirectory','timeoutMs'],['connectionFile','workspaceId','workspaceDirectory']);
  need(UUID.test(v.workspaceId)&&typeof v.connectionFile==='string'&&typeof v.workspaceDirectory==='string','CONFIGURATION');
  need(v.timeoutMs===undefined||Number.isSafeInteger(v.timeoutMs)&&v.timeoutMs>=1&&v.timeoutMs<=3600000,'TIMEOUT');
  configuration.workspaces[alias]={label:v.label??alias,connectionFile:resolve(dirname(file),v.connectionFile),workspaceId:v.workspaceId,
   workspaceDirectory:resolve(dirname(file),v.workspaceDirectory),timeoutMs:v.timeoutMs??300000};
 }
 need(value.files===undefined||plain(value.files)&&Object.keys(value.files).length<=1000,'CONFIGURATION');
 for(const [alias,v]of Object.entries(value.files??{})){
  need(ALIAS.test(alias),'ALIAS');exact(v,['path','bytes','sha256','label'],['path','bytes','sha256']);
  need(typeof v.path==='string'&&HASH.test(v.sha256)&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=MAX_ARCHIVE,'FILE');
  configuration.files[alias]={path:resolve(dirname(file),v.path),bytes:v.bytes,sha256:v.sha256,label:v.label??alias};
 }
 return configuration;
}
export class MerchantHighwayField{
 #configuration;#reads=new RetainedFileReads({errorPrefix:'HIGHWAY_FIELD',maxImmutableFileBytes:MAX_ARCHIVE});
 #pending=new Set();#closing=false;#closePromise;
 constructor(config){this.#configuration=config.highwayField;}
 get summary(){const c=this.#configuration;return {configured:Boolean(c),closing:this.#closing,
  workspaces:Object.entries(c?.workspaces??{}).map(([alias,v])=>({alias,label:v.label,workspaceId:v.workspaceId,workspaceDirectory:v.workspaceDirectory,connection:'ORIGINAL_PRIVATE_FILE'})),
  files:Object.entries(c?.files??{}).map(([alias,v])=>({alias,label:v.label,bytes:v.bytes,sha256:v.sha256})),...this.#reads.summary};}
 #scope(args){return canonical({alias:args.workspace,...branch({id:args.workspaceId,directory:args.workspaceDirectory})});}
 async #streamFile(client,selection){
  const dir=await mkdtemp(join(this.#configuration.storageDirectory,'highway-field-operations-read-')),path=join(dir,'content');
  let writer,reader;
  try{
   writer=await open(path,'wx',0o600);let position=0;
   const result=await client.download(selection,async chunk=>{
    let offset=0;while(offset<chunk.length){const r=await writer.write(chunk,offset,chunk.length-offset,position+offset);need(r.bytesWritten>0,'FILE_WRITE');offset+=r.bytesWritten;}position+=chunk.length;
   });
   await writer.sync();await writer.close();writer=null;
   reader=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);await unlink(path);await rmdir(dir);
   const handle=reader;reader=null;
   return {readonlyFileHandle:handle,bytes:result.bytes,sha256:result.sha256,
    name:selection.kind==='archive'?'Highway_Field_Workspace.zip':selection.kind==='blob'?'Original_Source.bin':
     selection.kind.startsWith('field-')?'Highway_Field_'+selection.id+(result.mediaType.startsWith('text/html')?'.html':'.json'):'Highway_Operating_Report.html',type:result.mediaType};
  }finally{
   const errors=[];
   for(const close of [()=>writer?.close(),()=>reader?.close(),()=>unlink(path),()=>rmdir(dir)]){
    try{await close();}catch(error){if(error.code!=='ENOENT')errors.push(error);}
   }
   if(errors.length)throw new AggregateError(errors,'Original file cleanup incomplete.');
  }
 }
 async #run(name,args){
  if(name==='merchant_highway_workspaces')return this.summary;
  const c=this.#configuration,selected=c?.workspaces?.[args.workspace];need(selected,'WORKSPACE_NOT_CONFIGURED');
  const action=name.slice('merchant_highway_'.length),scope=this.#scope(args);
  need(args.workspaceId===selected.workspaceId&&absolute(args.workspaceDirectory)===selected.workspaceDirectory,'BRANCH_CHANGED','Choose the configured original or received physical directory.');
  if(action==='file_release'){await this.#reads.release(scope,args.readId);return {released:true,readId:args.readId};}
  const client=createHighwayFieldClient(selected);
  try{
   if(action==='state')return await client.state();
   if(action==='history')return await client.history(args);
   if(action==='request')return await client.request(args.requestId);
   if(action==='records')return await client.records(args.captureId,args.layerId,args);
   if(action==='field_issue')return await client.fieldIssue(args.request,args.expectedRevision);
   if(action==='field_compare')return await client.fieldComparison(args.returnId,args.editionId,args.adoptionId);
   if(action==='field_document')return await client.fieldDocument(args.kind,args.recordId);
   if(action==='inspection')return await client.inspection(args.inspectionId);
   if(action==='prepare_dataset')return await client.prepareDataset(args.operationId,args.selection);
   if(action==='native')return await client.native(args.operationId,args.operation,args.body);
   if(action==='native_request')return await client.nativeRequest(args.operationId);
   if(action==='restore_native')return await client.restoreNative(args.recordId,args.operationId);
   if(action==='command')return await client.command(args.command,args.expectedRevision);
   if(action==='export')return await client.exportWorkspace(args.publicationId,args.revision);
   if(action==='receive')return await client.receive(args);
   if(action==='upload'){
    const file=c.files[args.fileAlias];need(file&&file.bytes===args.bytes&&file.sha256===args.sha256,'FILE_CHANGED');
    return await client.uploadFile(args.kind,file.path,{bytes:file.bytes,sha256:file.sha256});
   }
   if(action==='file_read'){
    const selection=args.selection;exact(selection,['kind','id','expectedSha256','expectedBytes'],['kind','id']);
    const key=canonical(selection);
    return await this.#reads.read({scope,key,kind:'HIGHWAY_FIELD',directory:c.storageDirectory,
     expectedSha256:args.expectedSha256,offset:args.offset??0,limit:args.limit??65536,readId:args.readId,
     load:()=>this.#streamFile(client,selection)});
   }
   need(false,'TOOL');
  }finally{await client.close();}
 }
 call(name,args={}){
  need(!this.#closing,'CLOSING');const definition=definitions.get(name);need(definition,'TOOL');exact(args,Object.keys(definition.properties),definition.required);
  const frozen=JSON.parse(canonical(args)),promise=Promise.resolve().then(()=>this.#run(name,frozen));
  this.#pending.add(promise);promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;
 }
 close(){this.#closing=true;return this.#closePromise??=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})().catch(error=>{this.#closePromise=null;throw error;});}
}
