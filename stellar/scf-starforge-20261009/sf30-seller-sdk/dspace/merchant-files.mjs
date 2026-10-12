// MIT. Atomic exact private-file receiving for the DSpace adapter.
import {constants} from 'node:fs';
import {open,link,unlink,mkdir,lstat,realpath} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export {absolute,object,bytes,digest,identity,readPrivate,readJson,hashPrivate,
  privateDirectory,syncDirectory,fault,acquireWorkspace} from '../postgres/publisher/files.mjs';
import {bytes,digest,hashPrivate,privateDirectory,syncDirectory,fault} from '../postgres/publisher/files.mjs';
export const MiB=1024*1024;
export async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export function separated(a,b){
  a=resolve(a);b=resolve(b);
  for(const value of [relative(a,b),relative(b,a)])
    if(!value||value!=='..'&&!value.startsWith('..'+sep))
      throw fault('DSPACE_PATH_OVERLAP','Keep the source, package, version store, and receiving directories separate.');
}
export async function saveExact(file,content){
  content=Buffer.isBuffer(content)?content:bytes(content);
  await privateDirectory(dirname(file),true);
  const temporary=file+'.partial-'+randomUUID();let handle;
  try{
    handle=await open(temporary,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
    try{await link(temporary,file);}
    catch(e){if(e.code!=='EEXIST')throw e;const actual=await hashPrivate(file,content.length);
      if(actual.bytes!==content.length||actual.hash!==digest(content))throw fault('DSPACE_FILE_CONFLICT','The destination contains different retained bytes.',409);}
    await syncDirectory(dirname(file));
  }finally{await handle?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return {path:file,bytes:content.length,sha256:digest(content)};
}
export async function copyExact(source,target,expected,{maximum=512*MiB}={}){
  if(!expected||!Number.isSafeInteger(expected.bytes)||expected.bytes<0||expected.bytes>maximum||
      !/^[a-f0-9]{64}$/.test(expected.sha256??''))throw fault('DSPACE_FILE_IDENTITY','An exact original byte identity is required.');
  await privateDirectory(dirname(target),true);
  if(await realpath(source)!==resolve(source))throw fault('DSPACE_SOURCE_PATH','Use canonical original source files.');
  const temporary=target+'.partial-'+randomUUID(),input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
  let output;
  try{
    const before=await input.stat({bigint:true});
    if(!before.isFile()||before.size!==BigInt(expected.bytes))throw fault('DSPACE_SOURCE_CHANGED','The original source file size changed.',409);
    output=await open(temporary,'wx',0o600);const hash=createHash('sha256');let size=0;
    for await(const chunk of input.createReadStream({autoClose:false})){
      size+=chunk.length;if(size>expected.bytes)throw fault('DSPACE_SOURCE_CHANGED','The original source grew during receiving.',409);
      hash.update(chunk);await output.writeFile(chunk);
    }
    const after=await input.stat({bigint:true});
    if(size!==expected.bytes||hash.digest('hex')!==expected.sha256||before.size!==after.size||
        before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
      throw fault('DSPACE_SOURCE_CHANGED','The original bytes changed during receiving.',409);
    await output.sync();await output.close();output=null;
    try{await link(temporary,target);}
    catch(e){if(e.code!=='EEXIST')throw e;const actual=await hashPrivate(target,maximum);
      if(actual.bytes!==expected.bytes||actual.hash!==expected.sha256)
        throw fault('DSPACE_FILE_CONFLICT','The destination contains a different original file.',409);}
    await syncDirectory(dirname(target));
  }finally{await output?.close();await input.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return {path:target,...expected};
}
export async function descriptor(root,name){
  const {hash,bytes}=await hashPrivate(resolve(root,name),512*MiB);
  return {path:name,bytes,sha256:hash};
}
