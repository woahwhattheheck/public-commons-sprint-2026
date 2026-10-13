// SPDX-License-Identifier: MIT
/** Original-file custody and native invocation shared by this Installation join. */
import {open,link,unlink,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {regular,operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {sha} from './municipal-installation-core.mjs';
export {regular,operationLease};
export const need=(value,message)=>{if(!value)throw new Error(message);};
export const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const parse=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
export const identity=raw=>({bytes:raw.length,sha256:sha(raw)});
export async function privateDirectory(path){
 const output=resolve(path);await mkdir(output,{recursive:true,mode:0o700});const stat=await lstat(output);
 need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&await realpath(output)===output,'Use the original private 0700 output directory without symlink ancestors.');
 return output;
}
export async function retain(path,bytes){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 let prior;try{prior=await regular(path,128*1024*1024);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior){need(prior.equals(bytes),'Preserve the differing original output: '+path);return{path, ...identity(bytes)};}
 const temporary=path+'.pending-'+randomUUID();let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await regular(path,128*1024*1024)).equals(bytes),'Concurrent original output differs: '+path);}
 }finally{
  if(handle)await handle.close();try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }
 return{path,...identity(bytes)};
}
export async function originalInput(output,name,path,maximum=8*1024*1024){
 const retained=join(output,name);let saved;
 try{saved=await regular(retained,maximum);}catch(error){if(error.code!=='ENOENT')throw error;}
 let supplied;try{supplied=await regular(resolve(path),maximum);}catch(error){if(error.code!=='ENOENT'||!saved)throw error;}
 if(saved){if(supplied)need(saved.equals(supplied),'The original selected input changed: '+path);return{raw:saved,identity:identity(saved),retained};}
 await retain(retained,supplied);return{raw:supplied,identity:identity(supplied),retained};
}
export async function originalUnchanged(path,bytes,maximum=8*1024*1024){
 let current;try{current=await regular(resolve(path),maximum);}catch(error){if(error.code==='ENOENT')return;throw error;}
 need(current.equals(bytes),'The original input changed during this operation: '+path);
}
export function nativeMunicipal(python,command,archive,destination=null){
 const helper=fileURLToPath(new URL('./municipal-installation-native.py',import.meta.url));
 const args=[helper,command,'--archive',archive,...(destination?['--destination',destination]:[])];
 const result=spawnSync(python,args,{encoding:'utf8',maxBuffer:128*1024*1024,env:process.env,cwd:dirname(helper)});
 if(result.error)throw result.error;
 need(result.status===0,'Original municipal '+command+' failed: '+String(result.stderr||result.stdout).slice(0,16000));
 return JSON.parse(result.stdout);
}
export function nativeOperations(python,cli,workspace,args){
 const result=spawnSync(python,[cli,'operations','--workspace',workspace,...args],{encoding:'utf8',maxBuffer:128*1024*1024,env:process.env,cwd:dirname(cli)});
 if(result.error)throw result.error;
 need(result.status===0,'Original Operations '+args[0]+' failed: '+String(result.stdout||result.stderr).slice(0,16000));
 return JSON.parse(result.stdout);
}

export function inspectInstallationArchive(python,archive,selection){
 const helper=fileURLToPath(new URL('./municipal-installation-operations.py',import.meta.url));
 const result=spawnSync(python,[helper,'--archive',archive,'--selection',selection],{encoding:'utf8',maxBuffer:128*1024*1024,env:process.env,cwd:dirname(helper)});
 if(result.error)throw result.error;
 need(result.status===0,'Original Installation archive selection failed: '+String(result.stderr||result.stdout).slice(0,16000));
 return JSON.parse(result.stdout);
}
