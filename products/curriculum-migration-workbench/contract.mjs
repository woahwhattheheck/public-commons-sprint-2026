// MIT. The maintained curriculum-migration-workbench application's integration contract.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath,mkdir} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,join} from 'node:path';
export const PREFIX='products/curriculum-migration-workbench/';
export const SOURCE_SCHEMA='stellar-forge.curriculum-migration-source.v1';
export const BINDING_SCHEMA='stellar-forge.curriculum-migration-workbench-binding.v1';
export const CONNECTION_SCHEMA='stellar-forge.curriculum-migration-workbench-connection.v1';
export const STARTUP_SCHEMA='stellar-forge.curriculum-migration-workbench-startup.v1';
export const SOURCE_SHA256='0d327292684c56e52b45913e9acb5bb2efc6d7feb2a19f4ece489706fb432579';
export const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const MAX_BLOB=160*1024*1024,MAX_ARCHIVE=256*1024*1024;
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function need(ok,code,message=code){if(!ok)throw Object.assign(new Error(message),{code:'CURRICULUM_MIGRATION_'+code});}
export function canonical(value){
 if(value===null||typeof value!=='object'){need(value!==undefined&&!['function','symbol','bigint'].includes(typeof value)&&!(typeof value==='number'&&!Number.isFinite(value)),'JSON');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 need(plain(value),'JSON');return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const copy=value=>JSON.parse(canonical(value));
export function expected(value){need(plain(value)&&typeof value.workspaceId==='string'&&Number.isSafeInteger(value.revision)&&value.revision>=0&&HASH.test(value.snapshotSha256??''),'EXPECTED');return {workspaceId:value.workspaceId,revision:value.revision,snapshotSha256:value.snapshotSha256};}
export function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0')&&resolve(value)===value,'PATH','Use a canonical absolute original path.');return value;}
export async function bytes(file,max=MAX_BLOB,{privateOnly=false}={}){
 absolute(file);const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const a=await h.stat({bigint:true}),sig=s=>[s.dev,s.ino,s.size,s.mode,s.mtimeNs,s.ctimeNs].join(':');
  need(a.isFile()&&a.size<=BigInt(max),'FILE','Select a bounded original regular file.');
  if(privateOnly)need((a.mode&0o077n)===0n&&(!process.getuid||a.uid===BigInt(process.getuid())),'PRIVATE_FILE','Use an owned private connection/configuration file.');
  const raw=await h.readFile();need(raw.length<=max&&sig(a)===sig(await h.stat({bigint:true})),'FILE_CHANGED');
  return raw;
 }finally{await h.close();}
}
export async function jsonFile(file,max=1024*1024,options={}){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(file,max,options)));}
export async function realDirectory(path,{missing=false,privateOnly=false}={}){
 absolute(path);
 let real;try{real=await realpath(path);}catch(e){if(e.code!=='ENOENT'||!missing)throw e;need(await realpath(dirname(path))===dirname(path),'PATH');return {path,exists:false};}
 need(real===path,'PATH','Keep the exact selected real directory.');
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await h.stat();need(s.isDirectory(),'DIRECTORY');if(privateOnly)need((s.mode&0o077)===0&&(!process.getuid||s.uid===process.getuid()),'PRIVATE_DIRECTORY');}finally{await h.close();}
 return {path,exists:true};
}
export function branch(value){need(plain(value)&&UUID.test(value.storeId??'')&&typeof value.branchId==='string'&&value.branchId.length>0&&value.branchId.length<180,'BRANCH');return{storeId:value.storeId,storeDirectory:absolute(value.storeDirectory),branchId:value.branchId};}
export async function privateParent(file){await realDirectory(dirname(absolute(file)),{privateOnly:true});return file;}
export function localUrl(value){
 let u;try{u=new URL(value);}catch{}
 need(u&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port&&!u.username&&!u.password&&u.pathname==='/'&&u.searchParams.size===0&&u.hash.length>=33,'CONNECTION_URL');
 return u;
}
