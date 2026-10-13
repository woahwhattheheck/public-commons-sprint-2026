// MIT. Streaming native JSON writes under the original containing-workspace gates.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,link,unlink} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {privateDirectory,regular,withWorkspaceWrite,workspaceReceivingState} from '../../distribution/runtime-workspace/storage.mjs';
import {jsonChunks,jsonDocumentChunks} from './json-stream.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function jsonIdentity(value,{pretty=false,newline=false,canonical=false}={}){
  const hash=createHash('sha256');let bytes=0;
  for(const chunk of newline?jsonDocumentChunks(value,{pretty,canonical}):jsonChunks(value,{pretty,canonical})){
    bytes+=Buffer.byteLength(chunk);hash.update(chunk);
  }
  return {bytes,sha256:hash.digest('hex')};
}
export async function fileIdentity(path,maximum=512*1024*1024){
  const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await handle.stat();if(!first.isFile()||first.size>maximum)fail('CAPTURE_FILE_SIZE','Choose a complete source file within the native receiving limit.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
    for(;;){const read=await handle.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;bytes+=read.bytesRead;hash.update(buffer.subarray(0,read.bytesRead));}
    const last=await handle.stat();
    if(first.size!==bytes||first.size!==last.size||first.mtimeMs!==last.mtimeMs||first.ctimeMs!==last.ctimeMs)
      fail('CAPTURE_FILE_CHANGED','The original file changed during receiving.');
    return {bytes,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
async function runtimeParent(directory){
  const file=join(directory,'workspace.json');let handle;
  try{handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(error.code==='ENOENT')return Boolean(await workspaceReceivingState(directory));throw error;}
  let config;
  try{
    const info=await handle.stat();if(!info.isFile())fail('CAPTURE_WORKSPACE_FILE','A containing workspace identity must be a regular file.');
    if(info.size<=4*1024*1024)config=JSON.parse(await handle.readFile('utf8'));
    else{
      // Maintained large application workspaces put schema first. Inspect that
      // discriminator without loading their complete source edition again.
      const bytes=Buffer.alloc(65536),read=await handle.read(bytes,0,bytes.length,0);
      const prefix=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,read.bytesRead),{stream:true});
      const match=/^\s*\{\s*"schema"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(prefix);
      if(!match)fail('CAPTURE_WORKSPACE_HEADER','Open the original containing workspace identity before writing this checkpoint.');
      const schema=JSON.parse(match[1]);
      if(schema==='stellar-forge.runtime-workspace.v1')
        fail('CAPTURE_RUNTIME_CONFIG_SIZE','The containing runtime configuration exceeds its maintained identity-reader limit.');
      return Boolean(await workspaceReceivingState(directory));
    }
  }finally{await handle.close();}
  return config?.schema==='stellar-forge.runtime-workspace.v1'&&config.directory===directory||Boolean(await workspaceReceivingState(directory));
}
export async function withNativeDocumentWrite(path,work){
  path=resolve(path);const parent=dirname(path);
  const info=await lstat(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(parent)!==parent)fail('CAPTURE_REAL_PARENT','Choose an existing real output directory.');
  const roots=[];
  for(let directory=parent;;directory=dirname(directory)){
    if(await runtimeParent(directory))roots.push(directory);
    if(dirname(directory)===directory)break;
  }
  roots.reverse();
  const enter=index=>index===roots.length?work():withWorkspaceWrite(roots[index],()=>enter(index+1));
  return enter(0);
}
/** Original JSON format, constant serialization buffer, atomic rename or create-only link. */
export async function writeJSONFile(path,value,{replace=false,pretty=true,newline=true}={}){
  path=resolve(path);
  return withNativeDocumentWrite(path,async()=>{
    const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
    const hash=createHash('sha256');let bytes=0,committed=false;
    try{
      try{
        let pending='',pendingBytes=0;
        const flush=async()=>{if(!pending)return;await handle.writeFile(pending);pending='';pendingBytes=0;};
        const chunks=newline?jsonDocumentChunks(value,{pretty}):jsonChunks(value,{pretty});
        for(const chunk of chunks){
          const length=Buffer.byteLength(chunk);hash.update(chunk);bytes+=length;
          pending+=chunk;pendingBytes+=length;if(pendingBytes>=65536)await flush();
        }
        await flush();await handle.sync();
      }finally{await handle.close();}
      if(replace)await rename(temporary,path);
      else{await link(temporary,path);await unlink(temporary);}
      committed=true;
      const directory=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
      try{await directory.sync();}finally{await directory.close();}
      return {path,bytes,sha256:hash.digest('hex')};
    }finally{if(!committed)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  });
}
export async function readJSONDocument(path,maximum=512*1024*1024){
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await regular(resolve(path),maximum)));
}
