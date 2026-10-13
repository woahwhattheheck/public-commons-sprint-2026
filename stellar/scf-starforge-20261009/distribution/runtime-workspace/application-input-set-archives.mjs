// MIT. Read-only full ZIP delivery and existing companion-set upload receiving.
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {need,plain} from './storage.mjs';
import {syncInitializationDirectory} from '../../sf88-operator-buyer-cli/initialization.mjs';
import {APPLICATION_INPUT_SET_LIMITS as LIMITS} from './public/application-input-set-format.mjs';
import {APPLICATION_INPUT_SET_ARCHIVE_LIMITS as ARCHIVE,inputSetArchiveJSON,inputSetArchiveLayout,
 inputSetArchiveLocal,inputSetArchiveDescriptor,inputSetArchiveCentral,inputSetArchiveEnd,inputSetArchiveCRC,
 inspectApplicationInputSetArchive} from './public/application-input-set-archive-format.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const finishCRC=value=>(value^0xffffffff)>>>0;
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs','mode'].every(k=>a[k]===b[k]);
export function createApplicationInputSetArchivesAPI(getModel){
 return {async applicationInputSetArchiveDownload(input){
  need(plain(input)&&Object.keys(input).every(k=>k==='setId'),'APPLICATION_INPUT_SET_ARGUMENTS_INVALID');
  const model=getModel(),original=await model.applicationInputSetInspect(input);
  need(original.phase==='READY','APPLICATION_INPUT_SET_UPLOAD_INCOMPLETE',undefined,409);
  const record={schema:'stellar-forge.runtime-application-input-set-export.v1',workspaceId:original.workspaceId,setId:original.setId,manifest:original.manifest};
  const complete={setId:original.setId,manifestSha256:sha(inputSetArchiveJSON(record))},layout=inputSetArchiveLayout(record,complete);
  const byPath=new Map(original.files.map(f=>[f.path,f]));let active=null,closed=false;
  async function closeActive(){const held=active;active=null;if(held){held.stream.destroy();await held.close();}}
  async function* generate(){
   const central=[];let offset=0;
   try{for(const row of layout.rows){
    need(!closed,'APPLICATION_INPUT_SET_ARCHIVE_CLOSED');
    const local=inputSetArchiveLocal(row.name,row.bytes);yield local;
    let crc=0xffffffff,bytes=0;
    if(row.body){crc=inputSetArchiveCRC(row.body,crc);bytes=row.body.length;yield row.body;}
    else{
     const file=byPath.get(row.file.path);active=await model.applicationInputDownload({uploadId:file.uploadId});
     need(active.bytes===file.bytes&&active.sha256===file.sha256,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
     const digest=createHash('sha256');
     try{for await(const chunk of active.stream){
      need(!closed,'APPLICATION_INPUT_SET_ARCHIVE_CLOSED');bytes+=chunk.length;
      need(bytes<=file.bytes,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
      digest.update(chunk);crc=inputSetArchiveCRC(chunk,crc);yield chunk;
     }
     need(bytes===file.bytes&&digest.digest('hex')===file.sha256,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
     }finally{await closeActive();}
    }
    crc=finishCRC(crc);yield inputSetArchiveDescriptor(crc,bytes);
    central.push(inputSetArchiveCentral(row.name,bytes,crc,offset));offset+=local.length+bytes+16;
   }
   const centralBytes=central.reduce((sum,b)=>sum+b.length,0);for(const row of central)yield row;
   yield inputSetArchiveEnd(central.length,centralBytes,offset);
   need(offset+centralBytes+22===layout.bytes,'APPLICATION_INPUT_SET_ARCHIVE_SIZE_CHANGED');
   }finally{await closeActive();}
  }
  const stream=Readable.from(generate(),{objectMode:false});
  return {setId:original.setId,originWorkspaceId:original.workspaceId,manifest:original.manifest,bytes:layout.bytes,
   filename:'application-source-set-'+original.setId+'.zip',type:'application/zip',stream,
   async close(){closed=true;stream.destroy();await closeActive();}};
 }};
}
async function originalArchive(path,callback){
 const filename=resolve(path),handle=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const stat=await handle.stat({bigint:true});
  need(stat.isFile()&&stat.size>=22n&&stat.size<=BigInt(ARCHIVE.bytes),'APPLICATION_INPUT_SET_ARCHIVE_FILE_INVALID');
  async function unchanged(){need(same(stat,await handle.stat({bigint:true})),'APPLICATION_INPUT_SET_ARCHIVE_CHANGED',undefined,409);}
  async function read(offset,length){
   await unchanged();const bytes=Buffer.alloc(length);let used=0;
   while(used<length){const n=await handle.read(bytes,used,length-used,offset+used);need(n.bytesRead>0,'APPLICATION_INPUT_SET_ARCHIVE_CHANGED');used+=n.bytesRead;}
   await unchanged();return bytes;
  }
  const review=await inspectApplicationInputSetArchive({bytes:Number(stat.size),read,sha256:sha});
  await unchanged();return await callback({path:filename,read,unchanged,review});
 }finally{await handle.close();}
}
export async function inspectApplicationInputSetArchiveFile({archive}){
 return originalArchive(archive,async({path,review})=>({path,...review}));
}
export async function receiveApplicationInputSetArchive(model,{archive,expectedSetId}){
 return originalArchive(archive,async({path,read,unchanged,review})=>{
  if(expectedSetId!==undefined)need(review.setId===expectedSetId,'APPLICATION_INPUT_SET_ARCHIVE_SELECTION_CHANGED',undefined,409);
  // Every member, chunk hash and whole manifest has passed before this first mutation.
  let retained=await model.applicationInputSetBegin({manifest:review.manifest});
  need(retained.setId===review.setId,'APPLICATION_INPUT_SET_ARCHIVE_SELECTION_CHANGED');
  const members=new Map(review.files.map(file=>[file.path,file]));
  for(const file of retained.files){
   if(file.phase==='READY')continue;const member=members.get(file.path),received=new Set(file.receivedChunks);
   for(let i=0;i<file.chunkSha256.length;i++){
    if(received.has(i))continue;
    const body=await read(member.offset+i*LIMITS.chunkBytes,Math.min(LIMITS.chunkBytes,file.bytes-i*LIMITS.chunkBytes));
    need(sha(body)===file.chunkSha256[i],'APPLICATION_INPUT_SET_ARCHIVE_CHANGED');
    await model.applicationInputChunk({uploadId:file.uploadId,index:i,body});
   }
   await unchanged();await model.applicationInputComplete({uploadId:file.uploadId});
  }
  await unchanged();const completed=await model.applicationInputSetComplete({setId:retained.setId});
  return {archive:path,originWorkspaceId:review.originWorkspaceId,...completed};
 });
}
export async function exportApplicationInputSetArchive(model,{setId,output}){
 const path=resolve(output),temporary=join(dirname(path),'.source-set-'+randomUUID()+'.pending');
 const source=await model.applicationInputSetArchiveDownload({setId});let handle=null,bytes=0;const digest=createHash('sha256');
 try{
  handle=await open(temporary,'wx',0o600);
  for await(const part of source.stream){bytes+=part.length;need(bytes<=source.bytes,'APPLICATION_INPUT_SET_ARCHIVE_SIZE_CHANGED');digest.update(part);await handle.writeFile(part);}
  need(bytes===source.bytes,'APPLICATION_INPUT_SET_ARCHIVE_SIZE_CHANGED');await handle.sync();await handle.close();handle=null;
  // Only the complete, fsynced archive is published; an existing destination stays intact.
  await link(temporary,path);await syncInitializationDirectory(dirname(path));
  return {path,setId,bytes,sha256:digest.digest('hex')};
 }finally{source.stream.destroy();await source.close();if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
