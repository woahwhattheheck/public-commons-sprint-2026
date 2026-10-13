// MIT. Complete original directories enter the same Runtime companion-set upload protocol.
import {constants} from 'node:fs';
import {open,readdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {need} from './storage.mjs';
import {APPLICATION_INPUT_SET_SCHEMA,APPLICATION_INPUT_SET_LIMITS as LIMITS,
  normalizeApplicationInputSet,applicationInputSetPath} from './public/application-input-set-format.mjs';
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readApplicationInputSetDirectory({directory,name}={}) {
  const root=resolve(directory);need(await realpath(root)===root,'APPLICATION_INPUT_SET_REAL_SOURCE_REQUIRED');
  const directories=[],paths=[],observations=[];let total=0;
  async function walk(path,prefix='') {
    const before=await lstat(path);need(before.isDirectory()&&!before.isSymbolicLink(),'APPLICATION_INPUT_SET_REAL_SOURCE_REQUIRED');
    const entries=(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries) {
      const relative=prefix+entry.name;applicationInputSetPath(relative);
      need(!entry.isSymbolicLink(),'APPLICATION_INPUT_SET_SOURCE_SYMLINK');
      if(entry.isDirectory()) {
        directories.push(relative);need(directories.length<=LIMITS.directories,'APPLICATION_INPUT_SET_SIZE_INVALID');
        await walk(join(path,entry.name),relative+'/');
      } else {
        need(entry.isFile(),'APPLICATION_INPUT_SET_SOURCE_REGULAR_REQUIRED');
        paths.push(relative);need(paths.length<=LIMITS.files,'APPLICATION_INPUT_SET_SIZE_INVALID');
      }
    }
    need(same(before,await lstat(path)),'APPLICATION_INPUT_SET_SOURCE_CHANGED');observations.push({path,info:before});
  }
  await walk(root);const files=[];
  for(const path of paths) {
    const handle=await open(join(root,path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const before=await handle.stat();need(before.isFile()&&before.size<=LIMITS.fileBytes,'APPLICATION_INPUT_SET_SIZE_INVALID');
      total+=before.size;need(total<=LIMITS.bytes,'APPLICATION_INPUT_SET_SIZE_INVALID');
      const digest=createHash('sha256'),buffer=Buffer.alloc(LIMITS.chunkBytes),chunks=[];let offset=0;
      while(offset<before.size) {
        const size=Math.min(buffer.length,before.size-offset);let count=0;
        while(count<size){const got=await handle.read(buffer,count,size-count,offset+count);need(got.bytesRead>0,'APPLICATION_INPUT_SET_SOURCE_CHANGED');count+=got.bytesRead;}
        const bytes=buffer.subarray(0,size);chunks.push(hash(bytes));digest.update(bytes);offset+=size;
      }
      need(same(before,await handle.stat()),'APPLICATION_INPUT_SET_SOURCE_CHANGED');
      files.push({path,bytes:before.size,sha256:digest.digest('hex'),chunkSha256:chunks});
      observations.push({path:join(root,path),info:before});
    } finally {await handle.close();}
  }
  // The entire source manifest is validated before the first original upload.
  const manifest=normalizeApplicationInputSet({schema:APPLICATION_INPUT_SET_SCHEMA,name:name??basename(root),directories,files});
  for(const original of observations)need(same(original.info,await lstat(original.path)),'APPLICATION_INPUT_SET_SOURCE_CHANGED');
  return {directory:root,manifest,observations};
}
export async function retainApplicationInputSetDirectory(model,options) {
  const source=await readApplicationInputSetDirectory(options);
  if(options.expectedManifest)need(JSON.stringify(source.manifest)===JSON.stringify(normalizeApplicationInputSet(options.expectedManifest)),
    'APPLICATION_INPUT_SET_SOURCE_CHANGED','The complete source differs from the selected manifest.',409);
  let retained=await model.applicationInputSetBegin({manifest:source.manifest});
  for(const file of retained.files) {
    if(file.phase==='READY')continue;
    const handle=await open(join(source.directory,file.path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const before=await handle.stat();need(before.isFile()&&before.size===file.bytes,'APPLICATION_INPUT_SET_SOURCE_CHANGED');
      const buffer=Buffer.alloc(LIMITS.chunkBytes),received=new Set(file.receivedChunks);
      for(let index=0;index<file.chunkSha256.length;index++) {
        if(received.has(index))continue;
        const size=Math.min(buffer.length,file.bytes-index*LIMITS.chunkBytes);let count=0;
        while(count<size){const got=await handle.read(buffer,count,size-count,index*LIMITS.chunkBytes+count);need(got.bytesRead>0,'APPLICATION_INPUT_SET_SOURCE_CHANGED');count+=got.bytesRead;}
        const body=buffer.subarray(0,size);need(hash(body)===file.chunkSha256[index],'APPLICATION_INPUT_SET_SOURCE_CHANGED');
        await model.applicationInputChunk({uploadId:file.uploadId,index,body});
      }
      need(same(before,await handle.stat()),'APPLICATION_INPUT_SET_SOURCE_CHANGED');
      await model.applicationInputComplete({uploadId:file.uploadId});
    } finally {await handle.close();}
  }
  for(const original of source.observations)need(same(original.info,await lstat(original.path)),'APPLICATION_INPUT_SET_SOURCE_CHANGED');
  return model.applicationInputSetComplete({setId:retained.setId});
}
