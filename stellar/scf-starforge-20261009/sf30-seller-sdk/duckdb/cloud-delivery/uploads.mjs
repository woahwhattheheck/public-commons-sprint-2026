// MIT. Bounded, restartable uploads into the original Cloud edition's retained file.
import {constants} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {issue,identity,byteCount,digest,LIMITS} from './contract.mjs';
import {privateDirectory,atomicJson,readJson,fileDigest,syncDirectory} from './files.mjs';

export const CLOUD_UPLOAD_CHUNK_BYTES=8*1024*1024;
const SCHEMA='stellar-forge.cloud-retained-upload.v1';
const EMPTY=createHash('sha256').digest('hex');
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const hash=()=>createHash('sha256');
function offsetOf(value,maximum){
  const text=byteCount(value,maximum);return Number(text);
}
async function existing(path){try{return await lstat(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function privateFile(stat){
  if(!stat?.isFile()||stat.isSymbolicLink()||stat.mode&0o077n||![1n,2n].includes(stat.nlink))
    throw issue('CLOUD_UPLOAD_PRIVATE_STAGE_REQUIRED',undefined,409);
}
async function heldHash(file,length){
  const before=await file.stat({bigint:true});privateFile(before);
  if(before.size<BigInt(length))throw issue('CLOUD_UPLOAD_STAGE_TRUNCATED',undefined,409);
  const value=hash(),buffer=Buffer.alloc(Math.min(1048576,Math.max(1,length)));let at=0;
  while(at<length){
    const result=await file.read(buffer,0,Math.min(buffer.length,length-at),at);
    if(!result.bytesRead)throw issue('CLOUD_UPLOAD_STAGE_TRUNCATED',undefined,409);
    value.update(buffer.subarray(0,result.bytesRead));at+=result.bytesRead;
  }
  if(!same(before,await file.stat({bigint:true})))throw issue('CLOUD_UPLOAD_STAGE_CHANGED',undefined,409);
  return {value,before};
}

/** Calls are serialized by the one original workspace model. No separate
 * receiver, provider operation, source identity or database is introduced. */
export function createCloudUploads(){
  const cached=new Map();
  function remember(key,value){cached.delete(key);cached.set(key,value);while(cached.size>16)cached.delete(cached.keys().next().value);}
  async function openTransfer({directory,target,selection,expectedSha256}){
    directory=await privateDirectory(directory);
    const request={schema:SCHEMA,...selection};
    const requestSha256=identity(request),requestPath=join(directory,'request.json');
    let retained;
    try{retained=await readJson(requestPath);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      await atomicJson(requestPath,{...request,requestSha256});
      retained=await readJson(requestPath);
    }
    if(retained.requestSha256!==requestSha256||identity(Object.fromEntries(Object.entries(retained).filter(([key])=>key!=='requestSha256')))!==requestSha256)
      throw issue('CLOUD_UPLOAD_SELECTION_CHANGED',undefined,409);
    const part=join(directory,'payload.partial'),progressPath=join(directory,'progress.json');
    let progress;
    try{progress=await readJson(progressPath);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(!progress){
      progress={schema:SCHEMA,requestSha256,offset:'0',prefixSha256:EMPTY,state:'UPLOADING'};
      // A process can die after the first private part is created but before
      // its zero-offset progress is published. Its request remains authoritative.
      await atomicJson(progressPath,progress);
    }
    if(progress.schema!==SCHEMA||progress.requestSha256!==requestSha256||
       !['UPLOADING','COMPLETE'].includes(progress.state))
      throw issue('CLOUD_UPLOAD_PROGRESS_CHANGED',undefined,409);
    offsetOf(progress.offset,Number(selection.bytes));digest(progress.prefixSha256);
    return {directory,target,selection,expectedSha256,requestSha256,part,progressPath,progress};
  }
  async function targetPin(t){
    const stat=await existing(t.target);if(!stat)return null;
    const found=await fileDigest(t.target,LIMITS.totalBytes);
    if(found.bytes!==t.selection.bytes||t.selection.sha256&&found.sha256!==t.selection.sha256||
       t.expectedSha256&&found.sha256!==t.expectedSha256||t.progress.state==='COMPLETE'&&found.sha256!==t.progress.prefixSha256)
      throw issue('CLOUD_IMMUTABLE_FILE_CONFLICT',undefined,409);
    const stage=await existing(t.part);
    if(stage&&stage.dev===stat.dev&&stage.ino===stat.ino){
      privateFile(stage);privateFile(stat);
      if(stage.nlink!==2n||stat.nlink!==2n)throw issue('CLOUD_UPLOAD_STAGE_CHANGED',undefined,409);
      await syncDirectory(dirname(t.target));await unlink(t.part);await syncDirectory(t.directory);
    }
    const complete={schema:SCHEMA,requestSha256:t.requestSha256,offset:found.bytes,prefixSha256:found.sha256,state:'COMPLETE'};
    if(JSON.stringify(t.progress)!==JSON.stringify(complete))await atomicJson(t.progressPath,complete,{replace:true});
    cached.delete(t.part);
    return {...found,offset:found.bytes,prefixSha256:found.sha256,state:'COMPLETE',requestSha256:t.requestSha256};
  }
  async function partState(t){
    let handle;
    try{handle=await open(t.part,constants.O_RDWR|constants.O_NOFOLLOW);}
    catch(error){
      if(error.code!=='ENOENT'||t.progress.offset!=='0')throw error;
      handle=await open(t.part,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
      await handle.sync();await syncDirectory(t.directory);
    }
    try{
      const info=await handle.stat({bigint:true});privateFile(info);
      if(info.nlink!==1n)throw issue('CLOUD_UPLOAD_STAGE_CHANGED',undefined,409);
      const offset=Number(t.progress.offset),previous=cached.get(t.part);
      let value;
      if(previous&&previous.requestSha256===t.requestSha256&&previous.offset===offset&&
         previous.prefixSha256===t.progress.prefixSha256&&same(previous.stat,info))value=previous.hash.copy();
      else{
        const checked=await heldHash(handle,offset);value=checked.value;
        if(value.copy().digest('hex')!==t.progress.prefixSha256)
          throw issue('CLOUD_UPLOAD_PREFIX_CHANGED',undefined,409);
        if(info.size>BigInt(offset)){
          // Only the uncommitted tail of this request-owned part is retired.
          // Every accepted prefix byte was verified above before truncation.
          await handle.truncate(offset);await handle.sync();
        }
      }
      const current=await handle.stat({bigint:true});
      remember(t.part,{requestSha256:t.requestSha256,offset,prefixSha256:t.progress.prefixSha256,stat:current,hash:value.copy()});
      return {handle,hash:value,offset,stat:current};
    }catch(error){await handle.close();throw error;}
  }
  async function finish(t,part){
    const full=part.hash.copy().digest('hex');
    if(String(part.offset)!==t.selection.bytes||t.selection.sha256&&full!==t.selection.sha256||
       t.expectedSha256&&full!==t.expectedSha256)
      throw issue('CLOUD_UPLOAD_DIGEST_MISMATCH',undefined,409);
    await part.handle.sync();
    await privateDirectory(dirname(t.target));
    try{await link(t.part,t.target);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const found=await fileDigest(t.target,LIMITS.totalBytes);
      if(found.bytes!==t.selection.bytes||found.sha256!==full)throw issue('CLOUD_IMMUTABLE_FILE_CONFLICT',undefined,409);
    }
    await syncDirectory(dirname(t.target));
    // Close before unlink, and retain any failed publication for same-ID recovery.
    await part.handle.close();part.handle=null;
    const stage=await existing(t.part),target=await existing(t.target);
    if(stage&&target&&stage.dev===target.dev&&stage.ino===target.ino){
      if(stage.nlink!==2n)throw issue('CLOUD_UPLOAD_STAGE_CHANGED',undefined,409);
      await unlink(t.part);await syncDirectory(t.directory);
    }
    const complete={schema:SCHEMA,requestSha256:t.requestSha256,offset:String(part.offset),prefixSha256:full,state:'COMPLETE'};
    await atomicJson(t.progressPath,complete,{replace:true});cached.delete(t.part);
    return {bytes:String(part.offset),sha256:full,offset:String(part.offset),prefixSha256:full,state:'COMPLETE',
      requestSha256:t.requestSha256,reused:false};
  }
  return {
    async status(input){
      const t=await openTransfer(input),completed=await targetPin(t);if(completed)return completed;
      if(t.progress.state==='COMPLETE')throw issue('CLOUD_UPLOAD_TARGET_MISSING',undefined,409);
      const part=await partState(t);
      try{if(String(part.offset)===t.selection.bytes)return await finish(t,part);
        return {state:'UPLOADING',bytes:t.selection.bytes,sha256:t.selection.sha256??null,
        offset:String(part.offset),prefixSha256:t.progress.prefixSha256,requestSha256:t.requestSha256,
        maximumChunkBytes:CLOUD_UPLOAD_CHUNK_BYTES};}
      finally{await part.handle?.close();}
    },
    async append(input,{offset,data,sha256,signal}={}){
      if(!Buffer.isBuffer(data)||data.length>CLOUD_UPLOAD_CHUNK_BYTES)throw issue('CLOUD_UPLOAD_CHUNK_LIMIT',undefined,413);
      if(signal?.aborted)throw issue('CLOUD_UPLOAD_ABORTED');
      digest(sha256);
      if(hash().update(data).digest('hex')!==sha256)throw issue('CLOUD_UPLOAD_CHUNK_DIGEST_MISMATCH',undefined,409);
      const t=await openTransfer(input),start=offsetOf(offset,Number(t.selection.bytes)),end=start+data.length;
      if(end>Number(t.selection.bytes)||!data.length&&t.selection.bytes!=='0')
        throw issue('CLOUD_UPLOAD_RANGE_INVALID');
      const completed=await targetPin(t);
      if(completed){
        const file=await open(t.target,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const found=Buffer.alloc(data.length);const read=await file.read(found,0,found.length,start);
          if(read.bytesRead!==data.length||!found.equals(data))throw issue('CLOUD_UPLOAD_CHUNK_CONFLICT',undefined,409);}
        finally{await file.close();}
        return {...completed,reused:true};
      }
      const part=await partState(t);
      try{
        if(start<part.offset){
          if(end>part.offset)throw issue('CLOUD_UPLOAD_OFFSET_CHANGED',undefined,409);
          const found=Buffer.alloc(data.length),read=await part.handle.read(found,0,found.length,start);
          if(read.bytesRead!==data.length||!found.equals(data))throw issue('CLOUD_UPLOAD_CHUNK_CONFLICT',undefined,409);
          if(String(part.offset)===t.selection.bytes)return {...await finish(t,part),reused:true};
          return {state:'UPLOADING',bytes:t.selection.bytes,offset:String(part.offset),prefixSha256:t.progress.prefixSha256,
            requestSha256:t.requestSha256,reused:true};
        }
        if(start!==part.offset)throw issue('CLOUD_UPLOAD_OFFSET_CHANGED',undefined,409);
        let written=0;
        while(written<data.length){
          if(signal?.aborted)throw issue('CLOUD_UPLOAD_ABORTED');
          const result=await part.handle.write(data,written,data.length-written,start+written);
          if(!result.bytesWritten)throw issue('CLOUD_UPLOAD_WRITE_INCOMPLETE');
          written+=result.bytesWritten;
        }
        await part.handle.sync();
        const nextHash=part.hash.copy().update(data),prefixSha256=nextHash.copy().digest('hex');
        const progress={schema:SCHEMA,requestSha256:t.requestSha256,offset:String(end),prefixSha256,state:'UPLOADING'};
        await atomicJson(t.progressPath,progress,{replace:true});
        part.hash=nextHash;part.offset=end;
        remember(t.part,{requestSha256:t.requestSha256,offset:end,prefixSha256,stat:await part.handle.stat({bigint:true}),hash:nextHash.copy()});
        if(end===Number(t.selection.bytes))return await finish(t,part);
        return {...progress,bytes:t.selection.bytes,reused:false};
      }finally{await part.handle?.close();}
    },
    close(){cached.clear();}
  };
}
