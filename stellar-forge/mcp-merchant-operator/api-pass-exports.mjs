// MIT. Durable one-file exports of the original authenticated API-pass workspace.
import {mkdir,readdir,lstat,rename,unlink,open} from 'node:fs/promises';
import {join} from 'node:path';
import {constants} from 'node:fs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from './host-files.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {apiPassPrivateDirectory,readApiPassPrivateFile} from './api-pass-connection.mjs';
import {API_PASS_ALIAS,API_PASS_UUID,API_PASS_SHA,API_PASS_EXPORT_SCHEMA,API_PASS_EXPORT_MANIFEST,API_PASS_MAX_FILE_BYTES,API_PASS_FILE_NAMES,
 apiPassNeed,apiPassExact,apiPassChecked,apiPassFingerprint,apiPassHash,apiPassFailure,apiPassSelection,parseApiPassExport} from './api-pass-protocol.mjs';
const REQUEST_SCHEMA='stellar-forge.sf101.api-pass-mcp-export-request.v1';
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const readJson=async(path,max)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readApiPassPrivateFile(path,max)));
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(path,name,bytes){
 const temporary=join(path,'.'+name+'.next');
 await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await writePrivate(temporary,bytes);await rename(temporary,join(path,name));await syncDirectory(path);
}
export class ApiPassFileExports{
 #alias;#definition;#reads;#tail=Promise.resolve();
 constructor(alias,definition){this.#alias=alias;this.#definition=definition;this.#reads=new RetainedFileReads({errorPrefix:'API_PASS'});}
 get summary(){return {...this.#reads.summary,maxExports:this.#definition.maxExports,maxExportBytes:this.#definition.maxExportBytes};}
 #scope(id){return JSON.stringify([this.#alias,this.#definition.workspaceId,id]);}
 async #locked(work){
  const current=this.#tail.catch(()=>{}).then(async()=>{
   const root=await apiPassPrivateDirectory(this.#definition.exportDirectory);let lease;
   try{lease=await acquireStateLease(root);}catch(error){throw apiPassFailure(error.message==='FLEET_STATE_ALREADY_OWNED'?'API_PASS_EXPORT_BUSY':'API_PASS_EXPORT_LEASE_UNAVAILABLE','Use the original export directory after its current owner finishes.');}
   try{return await work(root,lease);}finally{await lease.close();}
  });this.#tail=current;return current;
 }
 async #entry(root,id,{create=false}={}){
  apiPassChecked(id,API_PASS_ALIAS,'export ID');const directory=join(root,id);
  if(create){try{await mkdir(directory,{mode:0o700});await syncDirectory(root);}catch(error){if(error.code!=='EEXIST')throw error;}}
  await apiPassPrivateDirectory(directory);return directory;
 }
 async #manifest(root,id){
  const directory=await this.#entry(root,id),bytes=await readApiPassPrivateFile(join(directory,API_PASS_EXPORT_MANIFEST),65000),manifest=parseApiPassExport(bytes,id);
  apiPassNeed(manifest.workspace.alias===this.#alias&&manifest.workspace.id===this.#definition.workspaceId,'The original file export belongs to another configured workspace.','API_PASS_EXPORT_BINDING');
  const request=await readJson(join(directory,'request.json'),65536);
  apiPassExact(request,['schema','workspace','workspaceId','exportId','selection','expectedSha256','requestSha256'],['schema','workspace','workspaceId','exportId','selection','expectedSha256','requestSha256']);
  const {requestSha256,...content}=request;
  apiPassNeed(request.schema===REQUEST_SCHEMA&&request.workspace===this.#alias&&request.workspaceId===this.#definition.workspaceId&&request.exportId===id&&apiPassFingerprint(content)===requestSha256&&requestSha256===manifest.requestSha256&&apiPassFingerprint(request.selection)===apiPassFingerprint(manifest.selection)&&
   (request.expectedSha256===null||request.expectedSha256===manifest.files[0].sha256),'The saved export request and completed source differ.','API_PASS_EXPORT_BINDING');
  return {directory,manifest,bytes,request};
 }
 async #inventory(root){
  const names=await readdir(root,{withFileTypes:true}),entries=[];let bytes=0,count=0;
  for(const item of names){
   if(item.name==='lease.lock')continue;
   apiPassNeed(item.isDirectory()&&API_PASS_ALIAS.test(item.name),'The export directory contains an unrelated file or directory.','API_PASS_EXPORT_DIRECTORY_IN_USE');
   count++;const directory=await this.#entry(root,item.name),complete=await exists(join(directory,API_PASS_EXPORT_MANIFEST));
   if(complete){
    const saved=await this.#manifest(root,item.name);bytes+=saved.manifest.files[0].bytes;
    entries.push({exportId:item.name,createdAt:saved.manifest.createdAt,selection:saved.manifest.selection,manifestSha256:apiPassHash(saved.bytes),file:saved.manifest.files[0]});
   }else{
    for(const file of await readdir(directory,{withFileTypes:true})){
     if(API_PASS_FILE_NAMES.response===file.name||Object.values(API_PASS_FILE_NAMES).includes(file.name)||file.name.startsWith('.')){const info=await lstat(join(directory,file.name));if(info.isFile())bytes+=info.size;}
    }
   }
  }
  entries.sort((a,b)=>a.exportId.localeCompare(b.exportId));return {entries,bytes,count};
 }
 #description(saved){return {state:'MANIFEST_RETAINED',exportId:saved.manifest.exportId,workspaceId:this.#definition.workspaceId,selection:saved.manifest.selection,
  manifestFile:{name:API_PASS_EXPORT_MANIFEST,bytes:saved.bytes.length,sha256:apiPassHash(saved.bytes),contentType:'application/json'},file:saved.manifest.files[0]};}
 async capture({exportId,selection,expectedSha256},load){
  selection=apiPassSelection(selection);
  const content={schema:REQUEST_SCHEMA,workspace:this.#alias,workspaceId:this.#definition.workspaceId,exportId:apiPassChecked(exportId,API_PASS_ALIAS,'export ID'),selection,expectedSha256:expectedSha256??null};
  if(expectedSha256!==undefined)apiPassChecked(expectedSha256,API_PASS_SHA,'selected original file SHA');
  const request={...content,requestSha256:apiPassFingerprint(content)};
  return this.#locked(async(root,lease)=>{
   const inventory=await this.#inventory(root),existing=await exists(join(root,exportId));
   apiPassNeed(existing||inventory.count<this.#definition.maxExports,'This host’s retained export count is full. Preserve or move completed exports using the operator’s storage procedure.','API_PASS_EXPORT_CAPACITY');
   const directory=await this.#entry(root,exportId,{create:true}),requestPath=join(directory,'request.json');
   if(await exists(requestPath)){
    const old=await readApiPassPrivateFile(requestPath,65536);
    apiPassNeed(old.equals(json(request)),'The original export ID is already bound to another exact selection.','API_PASS_EXPORT_ID_REUSED');
   }else await atomic(directory,'request.json',json(request));
   if(await exists(join(directory,API_PASS_EXPORT_MANIFEST)))return this.#description(await this.#manifest(root,exportId));
   // A complete file and its retained capture descriptor recover an interrupted
   // final manifest write without another original HTTP read.
   const capturePath=join(directory,'capture.json');
   if(await exists(capturePath)){
    const captureBytes=await readApiPassPrivateFile(capturePath,65000),manifest=parseApiPassExport(captureBytes,exportId);
    apiPassNeed(manifest.requestSha256===request.requestSha256&&manifest.workspace.id===this.#definition.workspaceId&&manifest.workspace.alias===this.#alias&&apiPassFingerprint(manifest.selection)===apiPassFingerprint(selection),'The retained capture belongs to a different operation.','API_PASS_EXPORT_BINDING');
    await readApiPassPrivateFile(join(directory,manifest.files[0].name),API_PASS_MAX_FILE_BYTES,{sha256:manifest.files[0].sha256});
    lease.assertHeld();await atomic(directory,API_PASS_EXPORT_MANIFEST,captureBytes);
    return this.#description(await this.#manifest(root,exportId));
   }
   const original=await load(selection),bytes=original.bytes;
   apiPassNeed(Buffer.isBuffer(bytes)&&bytes.length<=API_PASS_MAX_FILE_BYTES,'The original complete export exceeds its file limit.','API_PASS_EXPORT_TOO_LARGE');
   const sha256=apiPassHash(bytes);
   if(expectedSha256!==undefined)apiPassNeed(sha256===expectedSha256,'The current original file differs from the selected SHA256.','API_PASS_EXPORT_SOURCE_CHANGED');
   let priorBytes=0;for(const name of Object.values(API_PASS_FILE_NAMES)){const info=await exists(join(directory,name));if(info?.isFile())priorBytes+=info.size;}
   apiPassNeed(inventory.bytes-priorBytes+bytes.length<=this.#definition.maxExportBytes,'This complete original file exceeds the host’s remaining declared export capacity.','API_PASS_EXPORT_CAPACITY');
   const manifest={schema:API_PASS_EXPORT_SCHEMA,exportId,createdAt:new Date().toISOString(),workspace:{alias:this.#alias,id:this.#definition.workspaceId},
    selection,source:original.source,requestSha256:request.requestSha256,files:[{name:API_PASS_FILE_NAMES[selection.kind],bytes:bytes.length,sha256,contentType:original.contentType}]};
   const manifestBytes=json(manifest);parseApiPassExport(manifestBytes,exportId);
   lease.assertHeld();await atomic(directory,manifest.files[0].name,bytes);
   lease.assertHeld();await atomic(directory,'capture.json',manifestBytes);
   lease.assertHeld();await atomic(directory,API_PASS_EXPORT_MANIFEST,manifestBytes);
   return this.#description(await this.#manifest(root,exportId));
  });
 }
 async manifest(exportId){return this.#locked(async root=>this.#description(await this.#manifest(root,exportId)));}
 async list({offset=0,limit=100,expectedInventorySha256}={}){
  return this.#locked(async root=>{
   const inventory=await this.#inventory(root),identity=apiPassFingerprint(inventory.entries);
   if(expectedInventorySha256!==undefined)apiPassNeed(identity===expectedInventorySha256,'The retained export inventory changed between pages.','API_PASS_EXPORT_INVENTORY_CHANGED');
   const items=inventory.entries.slice(offset,offset+limit);
   return {items,total:inventory.entries.length,offset,limit,nextOffset:offset+items.length<inventory.entries.length?offset+items.length:null,inventorySha256:identity,retainedBytes:inventory.bytes,maxExportBytes:this.#definition.maxExportBytes};
  });
 }
 async file({exportId,file,expectedManifestSha256,expectedSha256,readId,offset=0,limit=65536}){
  apiPassChecked(expectedManifestSha256,API_PASS_SHA,'original manifest SHA');apiPassChecked(expectedSha256,API_PASS_SHA,'original file SHA');
  const loaded=await this.#locked(async root=>{
   const saved=await this.#manifest(root,exportId);
   apiPassNeed(apiPassHash(saved.bytes)===expectedManifestSha256,'The selected original completion manifest changed.','API_PASS_EXPORT_CHANGED');
   const metadata=file===API_PASS_EXPORT_MANIFEST?{name:file,bytes:saved.bytes.length,sha256:apiPassHash(saved.bytes),contentType:'application/json'}:saved.manifest.files.find(row=>row.name===file);
   apiPassNeed(metadata&&metadata.sha256===expectedSha256,'Select the exact original file and SHA from its retained manifest.','API_PASS_EXPORT_FILE_CHANGED');
   return {metadata,manifestBytes:file===API_PASS_EXPORT_MANIFEST?saved.bytes:null,path:join(saved.directory,file)};
  });
  const result=await this.#reads.read({scope:this.#scope(exportId),key:JSON.stringify([exportId,expectedManifestSha256,file]),kind:'api-pass-export',directory:this.#definition.snapshotDirectory,expectedSha256,readId,offset,limit,
   load:async()=>{
    const bytes=loaded.manifestBytes??await readApiPassPrivateFile(loaded.path,API_PASS_MAX_FILE_BYTES,{sha256:expectedSha256});
    apiPassNeed(bytes.length===loaded.metadata.bytes,'The complete original file has a different byte count.','API_PASS_EXPORT_FILE_CHANGED');
    return {bytes,name:file,type:loaded.metadata.contentType};
   }});
  return {exportId,manifestSha256:expectedManifestSha256,...result};
 }
 async release(exportId,readId){apiPassChecked(exportId,API_PASS_ALIAS,'export ID');apiPassChecked(readId,API_PASS_UUID,'retained read ID');return this.#reads.release(this.#scope(exportId),readId);}
 async close(){await this.#tail.catch(()=>{});await this.#reads.close();}
}
