// MIT. Private full-file storage for the original FHIR connection and transfers.
import {constants} from 'node:fs';
import {open,mkdir,realpath,link,unlink} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {privateSupportDirectory,writePrivate} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {MAX_PACKET_BYTES,need,digest} from './contracts.mjs';
export async function directory(path){
  path=resolve(path);
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateSupportDirectory(path);
  need(await realpath(path)===path,'FHIR_BULK_DIRECTORY_ALIAS','Select a real private directory without symlink components.');
  return path;
}
export async function regular(path,{privateFile=false,maxBytes=MAX_PACKET_BYTES}={}){
  path=resolve(path);
  need(await realpath(path)===path,'FHIR_BULK_FILE_ALIAS');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await handle.stat({bigint:true});
    need(info.isFile() && info.size>=0n && info.size<=BigInt(maxBytes) &&
      (!privateFile || process.platform==='win32' || (info.mode&0o077n)===0n &&
        (typeof process.getuid!=='function' || info.uid===BigInt(process.getuid()))),
      'FHIR_BULK_FILE_INVALID','Select a complete regular original file within its declared byte limit.');
    return {handle,info,path};
  }catch(error){await handle.close();throw error;}
}
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
export async function readSourceFile(path,options={}){
  const original=await regular(path,options);
  try{
    const bytes=await original.handle.readFile();
    need(BigInt(bytes.length)===original.info.size && same(original.info,await original.handle.stat({bigint:true})),
      'FHIR_BULK_FILE_CHANGED','The original file changed during its complete read.');
    return bytes;
  }finally{await original.handle.close();}
}
export async function fileIdentity(path,options={}){
  const original=await regular(path,options);
  try{
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<Number(original.info.size)){
      const {bytesRead}=await original.handle.read(buffer,0,Math.min(buffer.length,Number(original.info.size)-offset),offset);
      need(bytesRead>0,'FHIR_BULK_FILE_CHANGED');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    need(same(original.info,await original.handle.stat({bigint:true})),'FHIR_BULK_FILE_CHANGED');
    return {bytes:offset,sha256:hash.digest('hex')};
  }finally{await original.handle.close();}
}
export async function immutable(path,bytes){
  try{await writePrivate(path,bytes);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const identity=await fileIdentity(path,{privateFile:true,maxBytes:bytes.length});
    need(identity.bytes===bytes.length && identity.sha256===digest(bytes),'FHIR_BULK_RETAINED_CHANGED');
  }
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
export async function retainFile(original,destination){
  try{await link(original.path,destination);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const identity=await fileIdentity(destination,{privateFile:true,maxBytes:original.bytes});
    need(identity.bytes===original.bytes && identity.sha256===original.sha256,'FHIR_BULK_RETAINED_CHANGED');
  }
  const dir=await open(dirname(destination),constants.O_RDONLY);
  try{await dir.sync();}finally{await dir.close();}
  await unlink(original.path);
}
async function writeAll(handle,bytes){
  let offset=0;
  while(offset<bytes.length){
    const {bytesWritten}=await handle.write(bytes,offset,bytes.length-offset,null);
    need(bytesWritten>0,'FHIR_BULK_STORAGE_UNAVAILABLE');offset+=bytesWritten;
  }
}
export async function responseFile(response,root,maximum=MAX_PACKET_BYTES){
  const path=join(await directory(root),'.native-'+randomUUID()),handle=await open(path,'wx',0o600),
    hash=createHash('sha256');let size=0,complete=false;
  try{
    for await(const block of response.body??[]){
      size+=block.length;need(size<=maximum,'FHIR_BULK_RESPONSE_LIMIT','The complete original file exceeds its native byte limit.');
      await writeAll(handle,block);hash.update(block);
    }
    const declared=response.headers.get('content-length');
    need(declared===null || /^\d+$/.test(declared) && Number(declared)===size,'FHIR_BULK_RESPONSE_INCOMPLETE');
    await handle.sync();complete=true;
    return {path,bytes:size,sha256:hash.digest('hex')};
  }finally{
    await handle.close();
    if(!complete){await response.body?.cancel().catch(()=>{});await unlink(path).catch(()=>{});}
  }
}
export async function responseBytes(response,maximum){
  const chunks=[];let size=0;
  try{
    for await(const block of response.body??[]){
      size+=block.length;need(size<=maximum,'FHIR_BULK_RESPONSE_LIMIT');chunks.push(block);
    }
    const declared=response.headers.get('content-length');
    need(declared===null || /^\d+$/.test(declared) && Number(declared)===size,'FHIR_BULK_RESPONSE_INCOMPLETE');
    return Buffer.concat(chunks,size);
  }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
}
/** Freeze a declared input before sending any mutation; this is the same complete file, not a tool-sized sample. */
export async function inputSnapshot(selected,root){
  const path=join(await directory(root),'.input-'+randomUUID()),input=await regular(selected.file,{maxBytes:MAX_PACKET_BYTES}),
    hash=createHash('sha256');let output,size=0,complete=false;
  try{
    output=await open(path,'wx',0o600);
    const buffer=Buffer.alloc(65536);
    while(size<Number(input.info.size)){
      const {bytesRead}=await input.handle.read(buffer,0,Math.min(buffer.length,Number(input.info.size)-size),size);
      need(bytesRead>0,'FHIR_BULK_INPUT_CHANGED');
      const block=buffer.subarray(0,bytesRead);await writeAll(output,block);hash.update(block);size+=bytesRead;
    }
    const sha256=hash.digest('hex');
    need(same(input.info,await input.handle.stat({bigint:true})) &&
      size===selected.bytes && sha256===selected.sha256,'FHIR_BULK_INPUT_CHANGED',
      'The complete host input differs from the file selected in the private connection.');
    await output.sync();complete=true;return {path,bytes:size,sha256};
  }finally{
    await Promise.allSettled([input.handle.close(),output?.close()]);
    if(!complete)await unlink(path).catch(()=>{});
  }
}
export async function streamFile(file){
  const {handle,info}=await regular(file.path,{privateFile:true,maxBytes:file.bytes});
  try{need(Number(info.size)===file.bytes,'FHIR_BULK_INPUT_CHANGED');}
  catch(error){await handle.close();throw error;}
  let closed=false;
  const close=async()=>{if(!closed){closed=true;await handle.close();}};
  const body=Readable.from((async function*(){
    let position=0;
    while(position<file.bytes){
      const buffer=Buffer.alloc(Math.min(65536,file.bytes-position));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,position);
      need(bytesRead>0,'FHIR_BULK_INPUT_CHANGED');position+=bytesRead;yield buffer.subarray(0,bytesRead);
    }
    need(same(info,await handle.stat({bigint:true})),'FHIR_BULK_INPUT_CHANGED');
  })());
  return {body,close};
}
