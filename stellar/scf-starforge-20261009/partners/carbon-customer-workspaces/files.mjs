// MIT. Exact private request and export retention for the original Carbon applications.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const MAX_FILE_BYTES=512*1024*1024;
export const MAX_JSON_BYTES=8*1024*1024;
export const failure=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
export const need=(yes,code,message)=>{if(!yes)throw failure(code,message);};
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const canonical=value=>JSON.stringify(value,(_,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const same=(a,b)=>canonical(a)===canonical(b);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function identifier(value,label='identifier'){
 need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'CARBON_IDENTIFIER','Use a configured '+label+' of 1–64 lowercase letters, digits, underscores or hyphens.');return value;
}
export function operationId(value){need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value),'CARBON_OPERATION_ID','Use the original stable operation ID.');return value;}
export function exact(value,keys,required=[]){need(plain(value)&&Object.keys(value).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'CARBON_INPUT','Supply only the declared complete fields.');}
export function pathValue(value,base=process.cwd()){need(typeof value==='string'&&value.length>0&&!/[\x00-\x1f\x7f]/.test(value),'CARBON_PATH','Configure a complete native path.');return resolve(base,value);}
export const identity=info=>({device:String(info.dev),inode:String(info.ino)});
export const fileIdentity=info=>({...identity(info),bytes:String(info.size),modified:String(info.mtimeNs),changed:String(info.ctimeNs)});
export async function privateDirectory(path,{create=false}={}){
 path=resolve(path);if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
  (process.platform==='win32'||!(info.mode&0o077))&&(typeof process.getuid!=='function'||info.uid===process.getuid()),
  'CARBON_PRIVATE_DIRECTORY','Select an existing canonical operator-owned private directory (0700).');return path;
}
export async function regularHandle(path,{maximum=MAX_FILE_BYTES,privateFile=false}={}){
 const before=await lstat(path,{bigint:true});
 need(before.isFile()&&!before.isSymbolicLink()&&await realpath(path)===path&&before.size<=BigInt(maximum),
  'CARBON_ORIGINAL_FILE','Select a complete canonical regular file within the original byte limit.');
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{const info=await handle.stat({bigint:true});
  need(same(fileIdentity(before),fileIdentity(info))&&(!privateFile||process.platform==='win32'||!(Number(info.mode)&0o077))&&
   (typeof process.getuid!=='function'||info.uid===BigInt(process.getuid())),'CARBON_ORIGINAL_FILE','The selected original file changed or is not operator-owned/private.');
  return {handle,identity:fileIdentity(info)};
 }catch(error){await handle.close();throw error;}
}
export async function readJSON(path,maximum=MAX_JSON_BYTES){
 const opened=await regularHandle(path,{maximum,privateFile:true});
 try{const bytes=await opened.handle.readFile();need(bytes.length<=maximum&&same(opened.identity,fileIdentity(await opened.handle.stat({bigint:true}))),
  'CARBON_SOURCE_CHANGED','The complete original JSON file changed while reading.');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 finally{await opened.handle.close();}
}
export async function optionalJSON(path,maximum){try{return await readJSON(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(path){if(process.platform!=='win32'){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}}
export async function writeOnce(path,value){
 const prior=await optionalJSON(path);if(prior){need(same(prior,value),'CARBON_INTENT_CHANGED','This original identity already has different saved input.');return prior;}
 const stage=path+'.'+randomUUID()+'.partial',handle=await open(stage,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 try{try{await link(stage,path);await syncDirectory(dirname(path));}
  catch(error){if(error.code!=='EEXIST')throw error;need(same(await readJSON(path),value),'CARBON_INTENT_CHANGED','A different original operation already owns this identity.');}}
 finally{await unlink(stage);}return value;
}
export async function retainChunks(path,chunks,{maximum=MAX_FILE_BYTES}={}){
 const stage=path+'.'+randomUUID()+'.partial',handle=await open(stage,'wx',0o600),digest=createHash('sha256');let bytes=0;
 try{for await(const value of chunks){const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);bytes+=chunk.length;
   need(bytes<=maximum,'CARBON_FILE_TOO_LARGE','The complete original exceeds the declared receiving limit.');digest.update(chunk);await handle.writeFile(chunk);}
  await handle.sync();
 }catch(error){await handle.close();await unlink(stage).catch(()=>{});throw error;}
 await handle.close();const sha256=digest.digest('hex');
 try{try{await link(stage,path);await syncDirectory(dirname(path));}catch(error){if(error.code!=='EEXIST')throw error;
   const retained=await fileDigest(path,maximum);need(retained.bytes===bytes&&retained.sha256===sha256,'CARBON_FILE_CHANGED','A different complete original already owns this file.');}}
 finally{await unlink(stage);}return {path,bytes,sha256};
}
export async function fileDigest(path,maximum=MAX_FILE_BYTES){
 const opened=await regularHandle(path,{maximum}),digest=createHash('sha256');let bytes=0;
 try{for await(const chunk of opened.handle.createReadStream({autoClose:false})){bytes+=chunk.length;need(bytes<=maximum,'CARBON_FILE_TOO_LARGE','Original file grew beyond its limit.');digest.update(chunk);}
  need(same(opened.identity,fileIdentity(await opened.handle.stat({bigint:true})))&&same(opened.identity,fileIdentity(await lstat(path,{bigint:true}))),
   'CARBON_SOURCE_CHANGED','The complete original file changed while reading.');return {path,bytes,sha256:digest.digest('hex'),identity:opened.identity};
 }finally{await opened.handle.close();}
}
export async function retainOriginal(source,target,pin){
 const opened=await regularHandle(source);
 try{if(pin)need(same(pin,opened.identity),'CARBON_SOURCE_CHANGED','The configured original file changed; reopen the reviewed connection.');
  const result=await retainChunks(target,opened.handle.createReadStream({autoClose:false}));
  need(same(opened.identity,fileIdentity(await opened.handle.stat({bigint:true})))&&same(opened.identity,fileIdentity(await lstat(source,{bigint:true}))),
   'CARBON_SOURCE_CHANGED','The original source changed during receiving.');return result;
 }finally{await opened.handle.close();}
}
export async function* jsonBody(fields,member,source){
 const header=JSON.stringify(fields);if(!source){yield header;return;}
 yield header.slice(0,-1)+(Object.keys(fields).length?',':'')+JSON.stringify(member)+':';
 const opened=await regularHandle(source,{privateFile:true});
 try{yield* opened.handle.createReadStream({autoClose:false});need(same(opened.identity,fileIdentity(await opened.handle.stat({bigint:true}))),
  'CARBON_SOURCE_CHANGED','The retained request input changed during delivery.');}
 finally{await opened.handle.close();}
 yield '}';
}
export async function retainedHandle(receipt){
 const opened=await regularHandle(receipt.path,{privateFile:true});
 if(Number(opened.identity.bytes)!==receipt.bytes){await opened.handle.close();throw failure('CARBON_EXPORT_CHANGED','The retained original size changed.');}
 return {readonlyFileHandle:opened.handle,bytes:receipt.bytes,sha256:receipt.sha256,name:receipt.name,type:receipt.type};
}
export const childPath=(directory,key,suffix)=>join(directory,hash(key)+suffix);
