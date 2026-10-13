// SPDX-License-Identifier: MIT
import {open,link,unlink,lstat,realpath,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,relative,resolve,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {need,hash,absolute,integer,privateDirectory,MAX_FILE} from './connection.mjs';
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
  '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function exact(v,allowed,required=[]){need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
  'HIVE_INPUT','Use the complete declared fields only.');}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'HIVE_SHA256','Select the full SHA-256.');return v;}
export function alias(v){need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'HIVE_ALIAS','Choose a host-declared alias.');return v;}
export function text(v,name='text',max=20000){need(typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00]/.test(v),'HIVE_TEXT','Use complete '+name+' within its declared size.');return v;}
export function requestId(v){need(typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v),'HIVE_REQUEST_ID','Use a stable host request ID.');return v;}
export function relativeName(v){need(typeof v==='string'&&v.length>0&&v.length<=2000&&!v.startsWith('/')&&!v.includes('\\')&&!/[\x00-\x1f\x7f]/.test(v)&&
  v.split('/').every(p=>p&&p!=='.'&&p!=='..'),'HIVE_RELATIVE_PATH','Choose an original safe relative file path.');return v;}
export function filename(v){need(typeof v==='string'&&v.length>0&&v.length<=240&&v===basename(v)&&!/[\\\x00-\x1f\x7f]/.test(v),'HIVE_FILENAME','Use a plain original filename.');return v;}
export const sameStamp=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
export async function writePrivate(path,bytes){
  await privateDirectory(dirname(path));const tmp=join(dirname(path),'.closed-'+randomUUID()),fd=await open(tmp,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await link(tmp,path);const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}}
  finally{await unlink(tmp).catch(()=>{});}
}
export async function identity(path,max=MAX_FILE){
  path=absolute(path);need(await realpath(path)===path,'HIVE_FILE_PATH','Use the original ordinary canonical file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=await fd.stat();need(before.isFile()&&before.size<=max,'HIVE_FILE_SIZE','The original file exceeds its selected limit.');
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let size=0;
    while(size<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-size),size);need(r.bytesRead>0,'HIVE_FILE_CHANGED','The original file ended early.',409);h.update(buffer.subarray(0,r.bytesRead));size+=r.bytesRead;}
    need(sameStamp(before,await fd.stat()),'HIVE_FILE_CHANGED','The original file changed while being read.',409);
    return{bytes:size,sha256:h.digest('hex'),mode:before.mode&0o777};
  }finally{await fd.close();}
}
export async function verifyFile(v){
  digest(v.sha256);integer(v.bytes,'original bytes',MAX_FILE);const found=await identity(v.file);
  need(found.bytes===v.bytes&&found.sha256===v.sha256,'HIVE_INPUT_CHANGED','The declared complete original file changed.',409);return found;
}
export async function verifyEdition(v){
  need(plain(v)&&Array.isArray(v.files)&&v.files.length>0&&v.files.length<=10000,'HIVE_EDITION_INPUT','Declare the complete edition file inventory.');
  need(await realpath(v.directory)===v.directory&&(await lstat(v.directory)).isDirectory(),'HIVE_EDITION_PATH','Select the original ordinary edition directory.');
  const selected=new Set();
  for(const row of v.files){relativeName(row.path);need(!selected.has(row.path),'HIVE_EDITION_FILES','Retain every original edition member once.');selected.add(row.path);
    await verifyFile({file:join(v.directory,row.path),bytes:row.bytes,sha256:row.sha256});}
  const actual=[];
  const walk=async(dir,prefix='')=>{for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;relativeName(name);
    need(!entry.isSymbolicLink(),'HIVE_EDITION_SYMLINK','Select complete ordinary edition files.');if(entry.isDirectory())await walk(join(dir,entry.name),name+'/');
    else{need(entry.isFile(),'HIVE_EDITION_FILE','Select ordinary edition files.');actual.push(name);}}};
  await walk(v.directory);
  need(selected.has('edition.json')&&canonical([...selected].sort())===canonical(actual.sort()),'HIVE_EDITION_FILES','The declared edition must include every original file.',409);
  return{files:v.files.length,bytes:v.files.reduce((n,r)=>n+r.bytes,0),sha256:hash(canonical(v.files))};
}
