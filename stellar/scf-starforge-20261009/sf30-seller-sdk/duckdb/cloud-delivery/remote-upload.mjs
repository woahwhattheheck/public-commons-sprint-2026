// MIT. Stream one selected local file through the original Cloud retained upload.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {MAX_RETAINED_CHUNK_BYTES} from './catalog.mjs';
const MAX_BYTES=8*1024*1024*1024,SHA=/^[a-f0-9]{64}$/;
const stamp=value=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(value[key])]));
const same=(a,b)=>JSON.stringify(stamp(a))===JSON.stringify(stamp(b));
const fail=(code,message,details)=>Object.assign(new Error(message),{code:'CLOUD_REMOTE_'+code,...details});
function checkedStatus(value,input,bytes){
 const result=value?.result;
 if(!result||result.editionId!==input.editionId||result.fileId!==input.fileId||result.bytes!==String(bytes)||
   !/^(0|[1-9][0-9]*)$/.test(result.offset??'')||Number(result.offset)>bytes||!SHA.test(result.prefixSha256??'')||
   !SHA.test(result.requestSha256??'')||!['UPLOADING','COMPLETE'].includes(result.state))
  throw fail('UPLOAD_REPLY_INVALID','The original upload reply does not bind its file, size and committed prefix.');
 if(result.state==='COMPLETE'&&(result.offset!==String(bytes)||result.sha256!==result.prefixSha256))
  throw fail('UPLOAD_REPLY_INVALID','The completed original file must bind its whole SHA-256.');
 return result;
}
async function selected(path){
 const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await handle.stat({bigint:true});
  if(!stat.isFile()||stat.size<0n||stat.size>BigInt(MAX_BYTES))
   throw fail('UPLOAD_FILE_INVALID','Select one original regular file within the 8 GiB archive or source intake limit.');
  return {handle,stat,bytes:Number(stat.size),path:resolve(path)};
 }catch(error){await handle.close();throw error;}
}
async function scan(file,prefix,signal){
 const full=createHash('sha256'),part=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=0;
 while(position<file.bytes){
  signal?.throwIfAborted();
  const length=Math.min(buffer.length,file.bytes-position),read=await file.handle.read(buffer,0,length,position);
  if(read.bytesRead!==length)throw fail('UPLOAD_FILE_CHANGED','The selected original file changed during hashing.');
  const chunk=buffer.subarray(0,length);full.update(chunk);
  if(position<prefix)part.update(chunk.subarray(0,Math.min(length,prefix-position)));
  position+=length;
 }
 if(!same(file.stat,await file.handle.stat({bigint:true})))throw fail('UPLOAD_FILE_CHANGED','The selected file changed while it was pinned.');
 return {sha256:full.digest('hex'),prefixSha256:part.digest('hex')};
}
/** This local inspection performs no remote call and retains number values as bytes. */
export async function inspectCloudUpload(path,{signal}={}){
 const file=await selected(path);
 try{return {path:file.path,bytes:String(file.bytes),sha256:(await scan(file,0,signal)).sha256};}
 finally{await file.handle.close();}
}
/**
 * A lost chunk reply is reconciled by the next call's original upload status and
 * full local-prefix digest. No intake, commit, comparison or receive is created.
 * Only remaining bytes are transferred after the retained prefix is verified.
 */
export async function uploadCloudFile({client,workspace,workspaceInstanceId,editionId,fileId,path,
 expectedSha256,expectedBytes,signal,chunkSize=MAX_RETAINED_CHUNK_BYTES,onProgress}={}){
 if(!client||typeof client.call!=='function'||!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>MAX_RETAINED_CHUNK_BYTES||
  expectedSha256!==undefined&&!SHA.test(expectedSha256))
  throw fail('UPLOAD_CONFIGURATION','Use the original Cloud client, selected file/hash and a bounded transfer chunk.');
 const file=await selected(path),input={workspace,workspaceInstanceId,editionId,fileId};
 try{
  if(expectedBytes!==undefined&&String(expectedBytes)!==String(file.bytes))
   throw fail('UPLOAD_FILE_CHANGED','The reviewed original file size changed.');
  let state=checkedStatus(await client.call('merchant_cloud_upload_status',input,{signal}),input,file.bytes);
  const pinned=await scan(file,Number(state.offset),signal);
  if(expectedSha256&&pinned.sha256!==expectedSha256||pinned.prefixSha256!==state.prefixSha256)
   throw fail('UPLOAD_FILE_CHANGED','The reviewed file or original committed prefix differs; do not replace this intake.');
  if(state.sha256&&state.sha256!==pinned.sha256)
   throw fail('UPLOAD_FILE_CHANGED','This native intake selects a different whole-file SHA-256.');
  if(state.state==='COMPLETE')return {...state,workspace,workspaceId:(await client.status(workspace,{signal})).workspaceId,
   localSha256:pinned.sha256,resumed:true};
  let offset=Number(state.offset),sent=0;
  do{
   signal?.throwIfAborted();
   if(!same(file.stat,await file.handle.stat({bigint:true})))throw fail('UPLOAD_FILE_CHANGED','The original upload file changed.');
   const length=Math.min(chunkSize,file.bytes-offset),buffer=Buffer.alloc(length);
   const read=await file.handle.read(buffer,0,length,offset);
   if(read.bytesRead!==length)throw fail('UPLOAD_FILE_CHANGED','The original upload file became shorter.');
   const sha256=createHash('sha256').update(buffer).digest('hex');
   state=checkedStatus(await client.call('merchant_cloud_upload_chunk',{...input,offset:String(offset),
    sha256,data:buffer.toString('base64')},{signal}),input,file.bytes);
   if(Number(state.offset)!==offset+length)throw fail('UPLOAD_OFFSET_CHANGED','Another accepted upload advanced this same original file; inspect and resume its current prefix.');
   offset+=length;sent+=length;
   onProgress?.({editionId,fileId,offset:String(offset),bytes:String(file.bytes),sentBytes:String(sent),state:state.state});
  }while(offset<file.bytes);
  if(!same(file.stat,await file.handle.stat({bigint:true}))||state.state!=='COMPLETE'||state.sha256!==pinned.sha256)
   throw fail('UPLOAD_FILE_CHANGED','The completed native file does not match the original selected bytes.');
  return {...state,workspace,localSha256:pinned.sha256,sentBytes:String(sent)};
 }catch(error){
  if(error&&typeof error==='object')error.cloudUpload={workspace,editionId,fileId,
   next:'Resume this exact file against merchant_cloud_upload_status; no new intake or provider request.'};
  throw error;
 }finally{await file.handle.close();}
}
