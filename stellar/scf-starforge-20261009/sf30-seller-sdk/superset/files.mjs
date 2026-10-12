// MIT. Reuse the original private-file and kernel-owned workspace contracts.
import {open,link,unlink} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
export {absolute,object,bytes,digest,identity,readPrivate,readJson,hashPrivate,
  privateDirectory,syncDirectory,fault,acquireWorkspace,stamp,atomicJson} from '../postgres/publisher/files.mjs';
import {bytes,digest,hashPrivate,privateDirectory,syncDirectory,fault} from '../postgres/publisher/files.mjs';
export const MiB=1024*1024;
export function separated(a,b) {
  a=resolve(a);b=resolve(b);
  for(const p of [relative(a,b),relative(b,a)])
    if(!p||(p!=='..'&&!p.startsWith('..'+sep)))throw fault('SUPERSET_PATH_OVERLAP','Keep source, receiving and merchant directories separate.');
}
export async function saveExact(file,content) {
  content=Buffer.isBuffer(content)?content:bytes(content);
  await privateDirectory(dirname(file),true);
  const tmp=file+'.partial-'+randomUUID();let handle;
  try{
    handle=await open(tmp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
    try{await link(tmp,file);}catch(e){
      if(e.code!=='EEXIST')throw e;
      const actual=await hashPrivate(file,content.length);
      if(actual.bytes!==content.length||actual.hash!==digest(content))
        throw fault('SUPERSET_FILE_CONFLICT','The destination retains different bytes.',409);
    }
    await syncDirectory(dirname(file));
  }finally{await handle?.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return{path:file,bytes:content.length,sha256:digest(content)};
}
