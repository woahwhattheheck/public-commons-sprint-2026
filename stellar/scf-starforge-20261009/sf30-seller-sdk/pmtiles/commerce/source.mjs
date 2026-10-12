// MIT. Bounded original SF30 handlers over captured map files; no payment implementation.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {need,hash,clone} from '../model.mjs';
import {readOutputPackage} from './package.mjs';
import {selectOutputRange,outputCount} from './model.mjs';

const failure=(code,status=503)=>Object.assign(new Error(code),{code,status});
const response=error=>({status:error.status??503,body:{error:error.code??'PMTILES_OUTPUT_UNAVAILABLE'}});
function sameStat(a,b){
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
async function readExactly(file,size,offset,signal){
  const bytes=Buffer.alloc(size);let used=0;
  while(used<size){
    signal?.throwIfAborted();const next=await file.read(bytes,used,size-used,offset+used);
    if(!next.bytesRead)throw failure('PMTILES_OUTPUT_FILE_TRUNCATED',409);used+=next.bytesRead;
  }
  signal?.throwIfAborted();return bytes;
}
async function openRetainedFile(path,row,signal){
  need(await realpath(path)===path,'PMTILES_OUTPUT_CANONICAL_FILE_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size===BigInt(row.bytes),'PMTILES_OUTPUT_FILE_CHANGED');
    const all=createHash('sha256');
    for(let i=0;i<row.chunks.length;i++){
      const offset=i*row.chunkBytes,size=Math.min(row.chunkBytes,row.bytes-offset);
      const part=await readExactly(file,size,offset,signal);
      need(hash(part)===row.chunks[i],'PMTILES_OUTPUT_CHUNK_INDEX_CHANGED');all.update(part);
    }
    need(all.digest('hex')===row.sha256&&sameStat(before,await file.stat({bigint:true})),
      'PMTILES_OUTPUT_FILE_CHANGED');
    return {file,stat:before};
  }catch(error){await file.close();throw error;}
}
export async function openOutputSource(directory,{expectedManifestSha256,maxInFlight=4,signal}={}){
  outputCount(maxInFlight,'Concurrent output requests',1,32);
  const prepared=await readOutputPackage(directory,{expectedManifestSha256,verify:false,signal});
  const handles=new Map(),routes=new Map(),active=new Set();let closed=false,closing=null;
  async function close(){
    if(closing)return closing;
    closed=true;
    closing=(async()=>{
      for(const task of active)task.controller.abort(failure('PMTILES_OUTPUT_CLOSING'));
      await Promise.allSettled([...active].map(task=>task.promise));
      const results=await Promise.allSettled([...handles.values()].map(value=>value.file.close()));handles.clear();
      const error=results.find(value=>value.status==='rejected');if(error)throw error.reason;
    })();return closing;
  }
  try{
    for(const row of prepared.source.objects){
      signal?.throwIfAborted();
      if(!handles.has(row.sha256))handles.set(row.sha256,await openRetainedFile(join(prepared.directory,row.file),row,signal));
    }
    for(const row of prepared.source.objects){
      const selected=handles.get(row.sha256);
      const admit=context=>{
        try{
          selectOutputRange(context,row);
          if(closed)throw failure('PMTILES_OUTPUT_CLOSED');
          if(active.size>=maxInFlight)return {status:429,headers:{'retry-after':'1'},body:{error:'PMTILES_OUTPUT_BUSY'}};
          return true;
        }catch(error){if(error.status>=400&&error.status<500)return response(error);throw error;}
      };
      const handler=async context=>{
        let range;
        try{
          range=selectOutputRange(context,row);
          if(closed)throw failure('PMTILES_OUTPUT_CLOSED');
          if(active.size>=maxInFlight)throw failure('PMTILES_OUTPUT_BUSY');
        }catch(error){return response(error);}
        const controller=new AbortController(),relay=()=>controller.abort(context.signal?.reason??failure('PMTILES_OUTPUT_CANCELLED'));
        const task={controller,promise:null};active.add(task);
        if(context.signal?.aborted)relay();else context.signal?.addEventListener('abort',relay,{once:true});
        task.promise=(async()=>{
          controller.signal.throwIfAborted();
          const before=await selected.file.stat({bigint:true});
          if(!sameStat(before,selected.stat))throw failure('PMTILES_OUTPUT_FILE_CHANGED',409);
          const body=await readExactly(selected.file,range.bytes,range.offset,controller.signal);
          const bodySha256=hash(body);
          if(bodySha256!==row.chunks[range.index]||!sameStat(before,await selected.file.stat({bigint:true})))
            throw failure('PMTILES_OUTPUT_FILE_CHANGED',409);
          return {status:range.status,headers:{'content-type':row.contentType,
            'content-disposition':'attachment; filename="'+row.filename+'"','accept-ranges':'none',
            'x-content-sha256':bodySha256,'x-sf30-object-snapshot':row.snapshot,
            'x-sf30-object-bytes':String(row.bytes),
            ...(range.contentRange?{'content-range':range.contentRange}:{})},body};
        })();
        try{return await task.promise;}
        catch(error){return response(error);}
        finally{active.delete(task);context.signal?.removeEventListener('abort',relay);}
      };
      routes.set(row.id,Object.freeze({admit,handler}));
    }
  }catch(error){await close().catch(()=>{});throw error;}
  return Object.freeze({prepared,
    route(id){const result=routes.get(id);need(result,'PMTILES_OUTPUT_OBJECT_NOT_FOUND');return result;},
    describe(){return {...clone(prepared.documents.description),closed,inFlight:active.size,maxInFlight};},
    close});
}
