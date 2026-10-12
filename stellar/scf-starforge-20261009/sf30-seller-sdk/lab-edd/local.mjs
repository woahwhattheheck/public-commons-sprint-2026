// MIT. Held local original files for direct operation of the same application function.
import { open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { labError } from './table.mjs';
function mediaType(name){
  return /\.xlsx$/i.test(name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    /\.xls$/i.test(name)?'application/vnd.ms-excel':/\.zip$/i.test(name)?'application/zip':
    /\.csv$/i.test(name)?'text/csv':/\.tsv$/i.test(name)?'text/tab-separated-values':
    /\.json$/i.test(name)?'application/json':'application/octet-stream';
}
export async function openLocalInputs(paths,{signal}={}){
  const entries=new Map();
  async function* streamEntry(entry,verify=true){
    const digest=createHash('sha256');let position=0;
    while(position<entry.meta.bytes){
      signal?.throwIfAborted();
      const bytes=Buffer.alloc(Math.min(65536,entry.meta.bytes-position));
      const {bytesRead}=await entry.file.read(bytes,0,bytes.length,position);
      if(!bytesRead)labError('FILE_CHANGED','An original input ended before its retained byte count.');
      const part=bytes.subarray(0,bytesRead);position+=bytesRead;digest.update(part);yield part;
    }
    const stat=await entry.file.stat(),actual=digest.digest('hex');
    if(stat.size!==entry.meta.bytes||verify&&actual!==entry.meta.sha256)
      labError('FILE_CHANGED','The held original input changed while being read.',{slot:entry.meta.slot});
    if(!verify)entry.meta.sha256=actual;
  }
  try{
    for(const [slot,path]of Object.entries(paths)){
      if(!['source','baseline','decisions','baseline_decisions','reconciliation'].includes(slot))labError('FILE_SLOT','Unknown input slot.');
      const file=await open(resolve(path),'r');
      try{
        const stat=await file.stat(),maximum=['decisions','baseline_decisions'].includes(slot)?4194304:16777216;
        if(!stat.isFile()||stat.size>maximum)labError('LOCAL_INPUT','Select an original regular file within the declared slot limit.');
        const filename=basename(path),entry={file,meta:{slot,filename,bytes:stat.size,sha256:'',mediaType:mediaType(filename)}};
        entries.set(slot,entry);for await(const part of streamEntry(entry,false)){void part;}
      }catch(error){if(!entries.has(slot))await file.close();throw error;}
    }
    const get=slot=>{const entry=entries.get(slot);if(!entry)labError('FILE_SLOT','The selected original file slot is absent.',{slot});return entry;};
    return {files:Object.freeze({
      list(){return [...entries.values()].map(entry=>({...entry.meta}));},
      metadata(slot){return {...get(slot).meta};},
      stream(slot){return streamEntry(get(slot));},
      async read(slot,{maxBytes=8388608}={}){
        const entry=get(slot);if(entry.meta.bytes>maxBytes)labError('FILE_SIZE','The source exceeds the requested bounded read.');
        const chunks=[];for await(const part of streamEntry(entry))chunks.push(part);return Buffer.concat(chunks,entry.meta.bytes);
      },
    }),async close(){const held=[...entries.values()];entries.clear();await Promise.all(held.map(entry=>entry.file.close()));}};
  }catch(error){await Promise.all([...entries.values()].map(entry=>entry.file.close().catch(()=>{})));throw error;}
}
