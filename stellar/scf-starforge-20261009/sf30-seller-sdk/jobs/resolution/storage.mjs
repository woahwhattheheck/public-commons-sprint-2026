// MIT. Small private resolution documents owned by the original merchant lease.
import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,json,need,object,RESOLUTION_DOCUMENT_BYTES} from './contract.mjs';

export async function privateDirectory(path){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'JOB_RESOLUTION_DIRECTORY_REQUIRED');
  try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'JOB_RESOLUTION_DIRECTORY_UNSAFE',409);
  return path;
}
export async function readPrivate(path,max=RESOLUTION_DOCUMENT_BYTES,{optional=false}={}){
  let file;try{file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));}
  catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
  try{const info=await file.stat();need(info.isFile()&&!(info.mode&0o077)&&info.size<=max,'JOB_RESOLUTION_FILE_UNSAFE',409);
    const bytes=await file.readFile();need(bytes.length<=max,'JOB_RESOLUTION_FILE_TOO_LARGE',413);
    return bytes;
  }finally{await file.close();}
}
export async function readDocument(path,{optional=false,max}={}){
  const bytes=await readPrivate(path,max,{optional});if(bytes===null)return null;
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'JOB_RESOLUTION_FILE_INVALID',409);}
  need(object(value),'JOB_RESOLUTION_FILE_INVALID',409);return value;
}
export async function writeDocument(path,value,{createOnly=false,max=RESOLUTION_DOCUMENT_BYTES}={}){
  const bytes=json(value);need(bytes.length<=max,'JOB_RESOLUTION_FILE_TOO_LARGE',413);
  const stage=path+'.'+randomUUID()+'.pending';
  try{
    if(createOnly)need(await readPrivate(path,max,{optional:true})===null,'JOB_RESOLUTION_FILE_EXISTS',409);
    else await readPrivate(path,max,{optional:true});
    const file=await open(stage,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    // One original owner serializes this pathname. Complete bytes precede the
    // state revision; the private original store lease outlives this write.
    await rename(stage,path);const dir=await open(dirname(path),'r');
    try{await dir.sync();}finally{await dir.close();}
    return {bytes:bytes.length,sha256:hash(bytes)};
  }finally{await rm(stage,{force:true});}
}
export const casePath=(directory,jobId)=>join(directory,hash(jobId)+'.json');
