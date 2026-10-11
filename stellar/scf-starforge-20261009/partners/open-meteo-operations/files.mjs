// MIT. Private canonical inputs and create-only durable outputs.
import {readFile,open,lstat,realpath,mkdir,link,unlink,chmod} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {need,sha,encoded} from './contract.mjs';
export function absolute(path){need(typeof path==='string'&&resolve(path)===path,'CANONICAL_ABSOLUTE_PATH_REQUIRED');return path;}
export async function privateDirectory(path,{create=false}={}){
 absolute(path);if(create){try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const st=await lstat(path);need(st.isDirectory()&&(st.mode&0o077)===0&&await realpath(path)===path,'PRIVATE_CANONICAL_DIRECTORY_REQUIRED');return path;
}
export async function readPrivate(path,limit=1048576){
 absolute(path);const st=await lstat(path);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&st.size<=limit&&await realpath(path)===path,'PRIVATE_CANONICAL_FILE_REQUIRED');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=await file.stat();
  need(before.isFile()&&(before.mode&0o077)===0&&before.dev===st.dev&&before.ino===st.ino&&before.size===st.size&&before.mtimeMs===st.mtimeMs&&before.ctimeMs===st.ctimeMs,'PRIVATE_FILE_CHANGED');
  const bytes=await file.readFile(),after=await file.stat();
  need(bytes.length<=limit&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'PRIVATE_FILE_CHANGED');return bytes;
 }finally{await file.close();}
}
export async function readJson(path,limit=65536){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(path,limit)));}
export async function publish(path,input){
 absolute(path);await privateDirectory(dirname(path));const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
 const temporary=join(dirname(path),'.weather-publish-'+randomUUID());let file,published=false;
 const result={path,bytes:bytes.length,sha256:sha(bytes),status:'PUBLISHED'};
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
  await link(temporary,path);published=true;const parent=await open(dirname(path),'r');
  try{await parent.sync();}finally{await parent.close();}return result;
 }catch(error){if(published)return {...result,status:'PUBLISHED_DURABILITY_UNCONFIRMED',diagnostic:error.code??'DIRECTORY_SYNC_FAILED'};throw error;
 }finally{if(file)await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
export const publishJson=(path,value)=>publish(path,encoded(value));
export async function privateSqliteFile(path){
 absolute(path);try{const fd=await open(path,'wx',0o600);await fd.sync();await fd.close();}catch(e){if(e.code!=='EEXIST')throw e;}
 const st=await lstat(path);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&await realpath(path)===path,'PRIVATE_SQLITE_REQUIRED');
}
