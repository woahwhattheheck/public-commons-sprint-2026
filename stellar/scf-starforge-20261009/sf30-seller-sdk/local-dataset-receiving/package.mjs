// SPDX-License-Identifier: MIT
// Complete original source/customer files, received through the existing native reader.
import {constants} from 'node:fs';
import {open,lstat,readdir,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {privateDirectory,readJson,readPrivate,hashPrivate,atomicJson,identity,bytes,fault,syncDirectory} from '../postgres/publisher/files.mjs';
import {publishDeliveryFile,retainDeliveryFile,reconcileDeliveryFile} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
const MAX_FILE=8*1024**3,MAX_TOTAL=16*1024**3,HASH=/^[a-f0-9]{64}$/;
const need=(ok,code)=>{if(!ok)throw fault(code);};
const safe=x=>{need(typeof x==='string'&&x.length<=1024&&x.split('/').every(v=>v&&v!=='.'&&v!=='..')&&!/[\\\0]/.test(x),'LOCAL_PACKAGE_FILE_INVALID');return x;};
async function present(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function python(args,environment=process.env){
 const child=spawn(environment.SF_FRICTIONLESS_PYTHON||'python3',['-B',fileURLToPath(new URL('./package.py',import.meta.url)),...args],{env:{...environment,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe'],shell:false});
 let output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',x=>{output+=x;if(output.length>1048576)child.kill('SIGTERM');});child.stderr.on('data',x=>{errors=(errors+x).slice(-65536);});
 return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{if(code!==0)return reject(fault('LOCAL_PACKAGE_PROCESS_FAILED',errors.trim()||'The original package operation did not complete.'));try{resolve(JSON.parse(output));}catch{reject(fault('LOCAL_PACKAGE_RESPONSE_INVALID'));}});});
}
async function writeAt(handle,chunk,position){
 let count=0;while(count<chunk.length){const result=await handle.write(chunk,count,chunk.length-count,position+count);need(result.bytesWritten>0,'LOCAL_PACKAGE_WRITE_INCOMPLETE');count+=result.bytesWritten;}
}
async function copyExact(source,destination,expected){
 await privateDirectory(dirname(destination),true);
 await reconcileDeliveryFile(dirname(destination),destination);
 const existing=await present(destination);
 if(existing){const d=await hashPrivate(destination,MAX_FILE);need(d.hash===expected.sha256&&d.bytes===expected.bytes,'LOCAL_PACKAGE_EXISTING_FILE_CHANGED');return;}
 await privateDirectory(dirname(source));
 const temporary=join(dirname(destination),'.sf100-'+basename(destination)+'-copy');let input,out;
 try{
  input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);out=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
  const initial=await input.stat();need(initial.isFile()&&initial.nlink===1&&!(initial.mode&0o077)&&initial.size===expected.bytes,'LOCAL_PACKAGE_SOURCE_CHANGED');
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=0;
  for(;;){const {bytesRead}=await input.read(buffer,0,buffer.length,position);if(!bytesRead)break;const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);
   if(chunk.some(value=>value!==0))await writeAt(out,chunk,position);position+=chunk.length;need(position<=expected.bytes,'LOCAL_PACKAGE_SOURCE_CHANGED');}
  const final=await input.stat();need(position===expected.bytes&&hash.digest('hex')===expected.sha256&&initial.size===final.size&&initial.mtimeMs===final.mtimeMs&&initial.ctimeMs===final.ctimeMs,'LOCAL_PACKAGE_SOURCE_CHANGED');
  await out.truncate(position);await out.sync();
 }finally{await input?.close();await out?.close();}
 await publishDeliveryFile(dirname(destination),temporary,destination);
}
/** Resume the original manifest-bound reader at its retained offset; no query/export rerun. */
async function receiveFile(destination,expected,binding,read,signal){
 await privateDirectory(dirname(destination),true);
 await reconcileDeliveryFile(dirname(destination),destination);
 if(await present(destination)){const d=await hashPrivate(destination,MAX_FILE);need(d.hash===expected.sha256&&d.bytes===expected.bytes,'LOCAL_PACKAGE_EXISTING_FILE_CHANGED');return;}
 const parent=dirname(destination),part=join(parent,'.sf100-'+basename(destination)+'-receive'),name=basename(destination)+'.receiving.json';
 let state=await readJson(join(parent,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 const original={...binding,...expected};
 if(!state){state={schema:'stellar-forge.local-customer-file-receiving.v1',binding:original,offset:0,prefixSha256:createHash('sha256').digest('hex')};await atomicJson(parent,name,state);}
 need(identity(state.binding)===identity(original),'LOCAL_PACKAGE_DOWNLOAD_BINDING_CHANGED');
 const info=await present(part),handle=await open(part,constants.O_RDWR|constants.O_NOFOLLOW|(info?0:constants.O_CREAT|constants.O_EXCL),0o600),hash=createHash('sha256');
 let offset=0,lastSaved=state.offset;
 try{
  const stat=await handle.stat();need(stat.isFile()&&stat.nlink===1&&!(stat.mode&0o077)&&stat.size>=state.offset&&stat.size<=expected.bytes,'LOCAL_PACKAGE_PARTIAL_CHANGED');
  const buffer=Buffer.alloc(1024*1024);
  while(offset<state.offset){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,state.offset-offset),offset);need(bytesRead>0,'LOCAL_PACKAGE_PARTIAL_CHANGED');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  need(hash.copy().digest('hex')===state.prefixSha256,'LOCAL_PACKAGE_PREFIX_CHANGED');
  // Only a tail written after the last durable checkpoint needs a native comparison.
  while(offset<stat.size){
   const response=await read(offset),partBytes=Buffer.from(response.data,'base64'),take=Math.min(partBytes.length,stat.size-offset),local=Buffer.alloc(take);
   need(response.verifiedSavedFile===true&&response.encoding==='base64'&&response.returnedBytes===partBytes.length&&partBytes.length<=65536&&offset+partBytes.length<=expected.bytes&&response.sha256===expected.sha256&&response.bytes===expected.bytes&&response.byteOffset===offset&&take>0,'LOCAL_PACKAGE_NATIVE_RANGE_CHANGED');
   const got=await handle.read(local,0,take,offset);need(got.bytesRead===take&&local.equals(partBytes.subarray(0,take)),'LOCAL_PACKAGE_UNCOMMITTED_TAIL_CHANGED');
   hash.update(local);offset+=take;
  }
  async function checkpoint(){await handle.truncate(offset);await handle.sync();state={...state,offset,prefixSha256:hash.copy().digest('hex')};await atomicJson(parent,name,state);lastSaved=offset;}
  while(offset<expected.bytes){
   if(signal?.aborted){await checkpoint();throw fault('LOCAL_PACKAGE_PAUSED','The original file offset is retained.');}
   const response=await read(offset),chunk=Buffer.from(response.data,'base64');
   need(response.verifiedSavedFile===true&&response.encoding==='base64'&&response.sha256===expected.sha256&&response.bytes===expected.bytes&&response.byteOffset===offset&&response.returnedBytes===chunk.length&&chunk.length>0&&chunk.length<=65536&&offset+chunk.length<=expected.bytes,'LOCAL_PACKAGE_NATIVE_RANGE_CHANGED');
   if(chunk.some(x=>x!==0))await writeAt(handle,chunk,offset);
   hash.update(chunk);offset+=chunk.length;if(offset-lastSaved>=4*1024*1024)await checkpoint();
  }
  await checkpoint();need(hash.digest('hex')===expected.sha256,'LOCAL_PACKAGE_DOWNLOAD_DIGEST_CHANGED');
 }finally{await handle.close();}
 await publishDeliveryFile(parent,part,destination);
}
export async function exportLocalDatasetPackage({directory,record,requestId,input,customerRead,signal,environment=process.env}){
 need(record.delivery&&record.customer?.edition,'LOCAL_PACKAGE_IMPORTED_EDITION_REQUIRED');
 need(typeof input.warehouseExportId==='string'&&input.warehouseExportId.startsWith('handoff-')&&Array.isArray(input.exports)&&input.exports.length<=1024,'LOCAL_PACKAGE_ORIGINAL_EXPORTS_REQUIRED');
 const root=join(directory,'packages',requestId),payload=join(root,'payload');await privateDirectory(payload,true);
 const selectedIds=[...new Set([input.warehouseExportId,...input.exports])].sort();
 need(selectedIds.every(x=>record.exports.includes(x)),'LOCAL_PACKAGE_EXPORT_NOT_FROM_THIS_WORKFLOW');
 const receipt=join(root,'package-result.json');
 if(await present(receipt)){const result=await readJson(receipt,64*1024*1024);need(result.deliveryId===record.id&&identity(result.input)===identity(input),'LOCAL_PACKAGE_REQUEST_CHANGED');
  for(const f of result.files){const actual=await hashPrivate(join(root,f.name),MAX_TOTAL);need(actual.bytes===f.bytes&&actual.hash===f.sha256,'LOCAL_PACKAGE_CHANGED');}return result;}
 let selection=await readJson(join(root,'selection.json'),64*1024*1024).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!selection){
  const exports=[];for(const id of selectedIds){const original=await customerRead('export-read',{export_id:id});need(original.export_id===id&&Array.isArray(original.files),'LOCAL_PACKAGE_NATIVE_EXPORT_INVALID');exports.push(original);}
  const warehouse=exports.find(x=>x.export_id===input.warehouseExportId);
  need(warehouse.kind==='source-handoff'&&warehouse.files.some(x=>x.name==='warehouse.duckdb')&&warehouse.files.some(x=>x.name==='handoff.json'),'LOCAL_PACKAGE_WHOLE_WAREHOUSE_REQUIRED');
  const supportFiles=[];
  for(const [name,url]of [
   ['receiving/LOCAL_DATASET_WORKSPACE.md',new URL('../../../../stellar-forge/mcp-merchant-operator/LOCAL_DATASET_WORKSPACE.md',import.meta.url)],
   ['receiving/package.py',new URL('./package.py',import.meta.url)]]){
   const raw=await readFile(url);need(raw.length<=1048576,'LOCAL_PACKAGE_GUIDE_BOUND');
   supportFiles.push({name,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),base64:raw.toString('base64')});
  }
  selection={schema:'stellar-forge.local-customer-package-selection.v1',workspaceId:record.workspaceId,deliveryId:record.id,requestId,input:structuredClone(input),record:structuredClone(record),exports,supportFiles};
  await atomicJson(root,'selection.json',selection);
 }
 need(identity(selection.input)===identity(input)&&selection.deliveryId===record.id,'LOCAL_PACKAGE_SELECTION_CHANGED');
 record=selection.record;
 const files=[];let total=0;
 function declare(name,descriptor){safe(name);need(HASH.test(descriptor.sha256??'')&&Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0&&descriptor.bytes<=MAX_FILE,'LOCAL_PACKAGE_FILE_BOUND');
  total+=descriptor.bytes;need(total<=MAX_TOTAL&&files.length<25000,'LOCAL_PACKAGE_TOTAL_BOUND');const value={name,bytes:descriptor.bytes,sha256:descriptor.sha256};files.push(value);return value;}
 for(const file of record.delivery.files){if(signal?.aborted)throw fault('LOCAL_PACKAGE_PAUSED');const declared=declare('operator/'+safe(file.name),file);await copyExact(join(directory,file.name),join(payload,declared.name),declared);}
 for(const original of selection.exports){
  for(const file of original.files){
   const expected={bytes:file.bytes??file.size,sha256:file.sha256},name='customer/'+original.export_id+'/'+safe(file.name),declared=declare(name,expected);
   await receiveFile(join(payload,name),expected,{workspaceId:record.customer.workspaceId,exportId:original.export_id,filename:file.name},
    async offset=>(await customerRead('file',{export_id:original.export_id,filename:file.name,sha256:file.sha256,byteOffset:offset,maxBytes:65536})).file,signal);
  }
 }
 for(const support of selection.supportFiles){
  const raw=Buffer.from(support.base64,'base64');need(raw.length===support.bytes&&createHash('sha256').update(raw).digest('hex')===support.sha256,'LOCAL_PACKAGE_GUIDE_CHANGED');
  await privateDirectory(dirname(join(payload,support.name)),true);await retainDeliveryFile(dirname(join(payload,support.name)),join(payload,support.name),raw);declare(support.name,support);
 }
 const snapshot=bytes(record);await retainDeliveryFile(payload,join(payload,'operator-record.json'),snapshot);declare('operator-record.json',{bytes:snapshot.length,sha256:createHash('sha256').update(snapshot).digest('hex')});
 const manifest={schema:'stellar-forge.local-dataset-customer-package.v1',requestId,workspaceId:record.workspaceId,customerWorkspaceId:record.customer.workspaceId,deliveryId:record.id,
  binding:record.binding,scope:{...record.scope,preview:undefined},authorization:record.authorization,
  warehouse:'customer/'+input.warehouseExportId,upstreamSource:'operator/Frictionless-Source.tgz',files,totalBytes:total,
  reopen:{customer:'Use the original DuckDBWorkspace(directory) or duckdb_cli --workspace DIRECTORY status/serve on a distinct working copy of the warehouse folder.',
   source:'Use the original Frictionless source-receive on the exact bundled source archive.',
   history:'Original export/source paths in native history remain provenance. The complete files are available under the package manifest paths; no database history is rewritten.'}};
 const raw=bytes(manifest);await retainDeliveryFile(payload,join(payload,'manifest.json'),raw);
 await copyExact(join(payload,'manifest.json'),join(root,'manifest.json'),{bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
 const result=await python(['build','--directory',payload,'--output',join(root,'Local_Dataset_Customer.zip')],environment);
 const mf=await hashPrivate(join(root,'manifest.json'),64*1024*1024);
 const complete={schema:'stellar-forge.local-customer-package-result.v1',deliveryId:record.id,requestId,input:structuredClone(input),manifestSha256:mf.hash,
  files:[{name:'manifest.json',bytes:mf.bytes,sha256:mf.hash},{name:'Local_Dataset_Customer.zip',bytes:result.bytes,sha256:result.sha256}],
  originalFiles:files.length,totalBytes:total,warehouse:manifest.warehouse,complete:true};
 await atomicJson(root,'package-result.json',complete);return complete;
}
export async function receiveLocalDatasetPackage(options={}){
 return python(['receive','--archive',options.archive,'--sha256',options.sha256,'--output',options.directory,'--request-id',options.requestId],options.environment);
}
