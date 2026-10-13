// MIT. Complete source/response custody for the original borrowed Monitoring client.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONFIG_SCHEMA='stellar-forge.source-monitoring-workspaces.v1';
export const MAX_INPUT=24*1024*1024,MAX_OBJECT=256*1024*1024,MAX_ARCHIVE=1024*1024*1024,MAX_REPLY=128*1024*1024;
export const SHA=/^[a-f0-9]{64}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const CHUNK=1024*1024,UTF8=new TextDecoder('utf-8',{fatal:true});
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function need(test,code,message){if(!test)throw Object.assign(new TypeError(message),{code:'MONITORING_AGENT_'+code});}
export function exact(value,allowed,required=[]){need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'INPUT','Supply all required declared fields only.');}
export function text(value,label,maximum=4096){need(typeof value==='string'&&value.length>0&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),'INPUT',label+' must be complete text without control characters.');return value;}
export function absolute(value){text(value,'Path');need(isAbsolute(value)&&resolve(value)===value,'PATH','Use a canonical absolute host path.');return value;}
const own=info=>process.platform==='win32'||((info.mode&0o077n)===0n&&(typeof process.getuid!=='function'||info.uid===BigInt(process.getuid())));
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].every(k=>a[k]===b[k]);
export async function privateDirectory(path){
 absolute(path);const info=await lstat(path,{bigint:true});
 need(info.isDirectory()&&!info.isSymbolicLink()&&own(info)&&await realpath(path)===path,'DIRECTORY','Use an existing private directory owned by this host.');
 return path;
}
async function createDirectory(path){
 try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 return privateDirectory(path);
}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
async function sourceHandle(path,maximum,privateOnly=false){
 absolute(path);const before=await lstat(path,{bigint:true});
 need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum)&&(!privateOnly||own(before)),'FILE','Select a complete regular host file within its original limit.');
 need(await realpath(dirname(path))===dirname(path),'FILE','The selected file parent must be its actual canonical directory.');
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const actual=await handle.stat({bigint:true});need(actual.isFile()&&same(before,actual),'FILE_CHANGED','The original file changed while opening.');return {handle,before,path,bytes:Number(before.size)};}
 catch(e){await handle.close();throw e;}
}
async function unchanged(selected){
 const [byName,opened]=await Promise.all([lstat(selected.path,{bigint:true}),selected.handle.stat({bigint:true})]);
 need(byName.isFile()&&!byName.isSymbolicLink()&&same(selected.before,opened)&&same(opened,byName),'FILE_CHANGED','The selected complete original changed while reading.');
}
async function* chunks(selected){
 const buffer=Buffer.alloc(Math.min(CHUNK,Math.max(1,selected.bytes)));let at=0;
 while(at<selected.bytes){const {bytesRead}=await selected.handle.read(buffer,0,Math.min(buffer.length,selected.bytes-at),at);need(bytesRead>0,'FILE_CHANGED','The complete original ended early.');at+=bytesRead;yield buffer.subarray(0,bytesRead);}
 const extra=await selected.handle.read(buffer,0,1,at);need(extra.bytesRead===0,'FILE_CHANGED','The selected original grew.');await unchanged(selected);
}
async function writeChunk(handle,chunk,position){
 let offset=0;while(offset<chunk.length){const n=await handle.write(chunk,offset,chunk.length-offset,position+offset);need(n.bytesWritten>0,'STORAGE','Could not retain complete original bytes.');offset+=n.bytesWritten;}
}
async function hashFile(path,maximum,privateOnly=true){
 const f=await sourceHandle(path,maximum,privateOnly);try{const h=createHash('sha256');for await(const chunk of chunks(f))h.update(chunk);return {bytes:f.bytes,sha256:h.digest('hex')};}finally{await f.handle.close();}
}
async function jsonFile(path,maximum){
 const f=await sourceHandle(path,maximum,true);try{const parts=[];for await(const chunk of chunks(f))parts.push(Buffer.from(chunk));
  try{return JSON.parse(UTF8.decode(Buffer.concat(parts,f.bytes)));}catch{need(false,'CONFIGURATION','The private configuration must contain complete UTF-8 JSON.');}
 }finally{await f.handle.close();}
}
export function validateSourceMonitoringConfiguration(value,{baseDirectory}){
 const base=absolute(baseDirectory);value=snapshot(value);
 need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,'CONFIGURATION','The complete private configuration exceeds2MiB.');
 exact(value,['schema','workspaces','files','storageDirectory'],['schema','workspaces','storageDirectory']);
 need(value.schema===CONFIG_SCHEMA&&plain(value.workspaces)&&Object.keys(value.workspaces).length>=1&&Object.keys(value.workspaces).length<=32,'CONFIGURATION','Configure one through32 original Monitoring workspaces.');
 const result={schema:CONFIG_SCHEMA,storageDirectory:resolve(base,text(value.storageDirectory,'Storage directory')),workspaces:Object.create(null),files:Object.create(null)};
 for(const [alias,v]of Object.entries(value.workspaces)){
  need(ALIAS.test(alias),'CONFIGURATION','Use a bounded workspace alias.');exact(v,['label','connectionFile','expectedWorkspace','expectedBindingSha256','timeoutMs'],['connectionFile','expectedWorkspace','expectedBindingSha256']);
  need(SHA.test(v.expectedBindingSha256),'CONFIGURATION','Select the actual installed binding SHA.');
  need(v.timeoutMs===undefined||Number.isSafeInteger(v.timeoutMs)&&v.timeoutMs>=1&&v.timeoutMs<=2147483647,'CONFIGURATION','Use the original positive timeout in milliseconds.');
  result.workspaces[alias]={label:text(v.label??alias,'Workspace label',240),connectionFile:resolve(base,text(v.connectionFile,'Original connection file')),expectedWorkspace:absolute(v.expectedWorkspace),expectedBindingSha256:v.expectedBindingSha256,timeoutMs:v.timeoutMs??120000};
  // Connection contents and actual live identity remain the original client's authority.
 }
 need(value.files===undefined||plain(value.files)&&Object.keys(value.files).length<=1000,'CONFIGURATION','Configure at most1000 explicit original file aliases.');
 for(const [alias,v]of Object.entries(value.files??{})){
  need(ALIAS.test(alias),'CONFIGURATION','Use a bounded file alias.');exact(v,['path','bytes','sha256','name','media','sourceUrl'],['path','bytes','sha256']);
  need(Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=MAX_ARCHIVE&&SHA.test(v.sha256),'CONFIGURATION','Pin the complete original byte count and SHA256.');
  const path=resolve(base,text(v.path,'Original file path')),name=text(v.name??basename(path),'Original file name',240),media=text(v.media??'application/octet-stream','Media type',240);
  need(v.sourceUrl===undefined||typeof v.sourceUrl==='string'&&v.sourceUrl.length<=4096&&!/[\u0000-\u001f\u007f]/.test(v.sourceUrl),'CONFIGURATION','Use the original source URL text.');
  result.files[alias]={path,bytes:v.bytes,sha256:v.sha256,name,media,sourceUrl:v.sourceUrl??''};
 }
 return result;
}
export async function readSourceMonitoringConfiguration(file){
 file=absolute(file);const result=validateSourceMonitoringConfiguration(await jsonFile(file,2*1024*1024),{baseDirectory:dirname(file)});
 await privateDirectory(result.storageDirectory);return result;
}
/** Copy synchronously to one JSON representation, then validate that snapshot. */
export function snapshot(value){
 let raw;try{raw=JSON.stringify(value,(_key,item)=>{
  need(!['bigint','function','symbol','undefined'].includes(typeof item),'INPUT','Arguments contain JSON values only.');
  if(typeof item==='number')need(Number.isFinite(item)&&(!Number.isInteger(item)||Number.isSafeInteger(item)),'INPUT','Use original JSON text for exact native numbers.');
  return item;
 });}catch(e){if(e.code)throw e;need(false,'INPUT','Arguments must be a complete acyclic JSON object.');}
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=2*MAX_INPUT+65536,'INPUT','Agent arguments exceed the complete native input envelope.');
 return JSON.parse(raw);
}
export class MonitoringAgentFiles{
 #root;
 constructor(root){this.#root=absolute(root);}
 async directory(scope){
  await privateDirectory(this.#root);
  return createDirectory(join(this.#root,hash(Buffer.from(JSON.stringify([scope.workspace,scope.expectedWorkspace,scope.expectedBindingSha256])))));
 }
 async #publish(directory,temporary,descriptor){
  const destination=join(directory,descriptor.sha256);
  try{await link(temporary,destination);}
  catch(e){if(e.code!=='EEXIST')throw e;const actual=await hashFile(destination,MAX_ARCHIVE);need(actual.bytes===descriptor.bytes&&actual.sha256===descriptor.sha256,'STORAGE_CHANGED','The retained original file differs from its content identity.');}
  await syncDirectory(directory);
  return {...descriptor,path:destination};
 }
 async retain(scope,bytes){
  need(bytes instanceof Uint8Array&&bytes.length<=MAX_ARCHIVE,'STORAGE','Retain a complete native file within the original limit.');
  const directory=await this.directory(scope),temporary=join(directory,'.incoming-'+randomUUID());let h;
  try{h=await open(temporary,'wx',0o600);await writeChunk(h,bytes,0);await h.sync();await h.close();h=null;return await this.#publish(directory,temporary,{bytes:bytes.length,sha256:hash(bytes)});}
  finally{if(h)await h.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async selected(scope,definition,maximum){
  need(definition.bytes<=maximum,'FILE_LIMIT','The whole selected file exceeds this native operation limit.');
  const directory=await this.directory(scope),temporary=join(directory,'.input-'+randomUUID()),source=await sourceHandle(definition.path,maximum);let h;
  try{
   need(source.bytes===definition.bytes,'FILE_CHANGED','The host-selected original byte count changed.');
   h=await open(temporary,'wx',0o600);const digest=createHash('sha256');let at=0;
   for await(const chunk of chunks(source)){digest.update(chunk);await writeChunk(h,chunk,at);at+=chunk.length;}
   need(digest.digest('hex')===definition.sha256,'FILE_CHANGED','The host-selected original SHA256 changed.');
   await h.sync();await h.close();h=null;
   return await this.#publish(directory,temporary,{bytes:at,sha256:definition.sha256});
  }finally{await source.handle.close();if(h)await h.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async bytes(scope,descriptor,maximum){
  const path=await this.path(scope,descriptor,maximum),source=await sourceHandle(path,maximum,true);
  try{const parts=[],h=createHash('sha256');for await(const part of chunks(source)){parts.push(Buffer.from(part));h.update(part);}
   need(source.bytes===descriptor.bytes&&h.digest('hex')===descriptor.sha256,'STORAGE_CHANGED','The exact retained input changed.');return Buffer.concat(parts,source.bytes);
  }finally{await source.handle.close();}
 }
 async path(scope,descriptor,maximum=MAX_ARCHIVE){
  need(SHA.test(descriptor.sha256)&&Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0&&descriptor.bytes<=maximum,'FILE','Select complete original file identity.');
  const path=join(await this.directory(scope),descriptor.sha256),actual=await hashFile(path,maximum);
  need(actual.bytes===descriptor.bytes&&actual.sha256===descriptor.sha256,'STORAGE_CHANGED','The retained original differs from the selected file.');return path;
 }
 async acquire(scope,client,selection){
  if(selection.kind==='retained')return {path:await this.path(scope,selection),bytes:selection.bytes,sha256:selection.sha256};
  const directory=await this.directory(scope),temporary=join(directory,'.download-'+randomUUID());
  try{
   const value=await client.download(selection.kind,{id:selection.id,role:selection.role,output:temporary,
    expectedSha256:selection.sha256??(['object','source'].includes(selection.kind)?selection.id:undefined)});
   if(selection.bytes!==undefined)need(value.bytes===selection.bytes,'DOWNLOAD_CHANGED','The complete original has a different selected byte count.');
   return await this.#publish(directory,temporary,{bytes:value.bytes,sha256:value.sha256});
  }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async reader(scope,descriptor){
  const path=await this.path(scope,descriptor),opened=await sourceHandle(path,MAX_ARCHIVE,true);
  return {readonlyFileHandle:opened.handle,bytes:descriptor.bytes,sha256:descriptor.sha256,name:'Monitoring_Original_'+descriptor.sha256+'.bin',type:'application/octet-stream'};
 }
}
