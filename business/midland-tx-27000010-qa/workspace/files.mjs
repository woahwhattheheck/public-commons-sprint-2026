// MIT. Private, immutable source custody for the original delivery application.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open,rename,stat,unlink,readFile,lstat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {join,basename,resolve} from 'node:path';
import {fault} from './contract.mjs';

export const DEFAULT_LIMIT=512*1024*1024;
export function fileLabel(name){
  if(typeof name!=='string'||!name.length||name.length>240||name!==basename(name)||/[\\/\0\r\n]/.test(name))
    throw fault(422,'Use a plain source filename.');
  return name;
}
export async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});return path;}
export async function syncDirectory(directory){const h=await open(directory,'r');try{await h.sync();}finally{await h.close();}}
export async function atomicJson(path,value){
  const temp=path+'.'+randomUUID()+'.tmp';
  const h=await open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
  await rename(temp,path);
}
export async function regularFile(path,limit=DEFAULT_LIMIT){
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>limit)throw fault(422,'Select a regular source file within the configured size limit.');
  return s;
}
export async function hashFile(path,limit=Number.MAX_SAFE_INTEGER){
  await regularFile(path,limit);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of createReadStream(path)){size+=chunk.length;if(size>limit)throw fault(413,'Source exceeds the size limit.');hash.update(chunk);}
  return {sha256:hash.digest('hex'),size};
}
export async function retainStream(root,stream,{limit=DEFAULT_LIMIT,signal}={}){
  await privateDirectory(join(root,'objects'));await privateDirectory(join(root,'staging'));
  const temp=join(root,'staging',randomUUID()+'.part'),hash=createHash('sha256');let size=0;
  const measure=new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>limit)return done(fault(413,'Source exceeds the configured upload limit.'));hash.update(chunk);done(null,chunk);}});
  try{
    await pipeline(stream,measure,createWriteStream(temp,{flags:'wx',mode:0o600}),{signal});
    const sha256=hash.digest('hex'),destination=join(root,'objects',sha256);
    const file=await open(temp,'r+');try{await file.sync();}finally{await file.close();}
    try{
      const prior=await hashFile(destination,limit);
      if(prior.sha256!==sha256||prior.size!==size)throw fault(409,'An immutable object differs from its name.');
      await unlink(temp);
    }catch(e){if(e.code!=='ENOENT')throw e;await rename(temp,destination);await syncDirectory(join(root,'objects'));}
    return {sha256,size,path:destination};
  }catch(e){await unlink(temp).catch(()=>{});throw e;}
}
export async function retainFile(root,path,options={}){
  await regularFile(path,options.limit??DEFAULT_LIMIT);
  return retainStream(root,createReadStream(path),options);
}
export async function readObject(root,sha256,limit=2*1024*1024){
  if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw fault(422,'Invalid source identity.');
  const path=join(root,'objects',sha256);await regularFile(path,limit);
  const bytes=await readFile(path);
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw fault(409,'Stored source bytes changed.');
  return bytes;
}
export function objectPath(root,sha256){
  if(!/^[a-f0-9]{64}$/.test(sha256))throw fault(422,'Invalid source identity.');
  return join(resolve(root),'objects',sha256);
}
