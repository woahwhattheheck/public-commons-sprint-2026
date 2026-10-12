// MIT. Private immutable files and revision chains for merchant cost editions.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, link, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_SOURCE = 16 * 1024 * 1024;
export const MAX_DOCUMENT = 32 * 1024 * 1024;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
export const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
export const canonical = x => JSON.stringify(x,(_,v) => plain(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export const encode = x => Buffer.from(JSON.stringify(x,null,2)+'\n');
export const digest = x => createHash('sha256').update(x).digest('hex');
export const fault = (code,message,status=422) => Object.assign(new Error(message),{code,status});
export function requireObject(value,label) {
  if (!plain(value)) throw fault('OBJECT_REQUIRED',label+' must be an object.');
  return value;
}
export function string(value,label,max=500,{empty=false}={}) {
  if (typeof value !== 'string' || value.length>max || (!empty && !value.trim()) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw fault('TEXT_INVALID',label+' must be valid text of at most '+max+' characters.');
  return value;
}
export function choice(value,choices,label) {
  if (!choices.includes(value)) throw fault('CHOICE_INVALID','Choose a supported '+label+'.');
  return value;
}
export function day(value,label='Date') {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
      !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
      new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw fault('DATE_INVALID',label+' must be an actual YYYY-MM-DD date.');
  return value;
}
export function period(value) {
  requireObject(value,'Period'); const from=day(value.from,'From day'),through=day(value.through,'Through day');
  if(from>through)throw fault('PERIOD_INVALID','Through day must be on or after from day.');
  return {from,through};
}
export function id(value,label='Identifier') {
  if(!UUID.test(value??''))throw fault('ID_INVALID',label+' must be a saved identifier.');
  return value;
}
export function request(value) {
  requireObject(value,'Request');id(value.requestId,'Request ID');
  if(value.expectedRevision!==null&&!SHA.test(value.expectedRevision??''))
    throw fault('REVISION_REQUIRED','Use the current revision or null for an empty workspace.');
}
export function page(items,{after=null,limit=50}={}) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw fault('PAGE_INVALID','Page size must be 1–100.');
  const start=after===null?0:Number(after);
  if(!Number.isSafeInteger(start)||start<0)throw fault('PAGE_INVALID','Use the returned nextAfter value.');
  return {items:items.slice(start,start+limit),total:items.length,nextAfter:start+limit<items.length?String(start+limit):null};
}
export async function privateDir(path,create=false) {
  if(resolve(path)!==path)throw fault('PRIVATE_DIRECTORY_REQUIRED','Use an absolute normalized directory.');
  if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const info=await lstat(path);
  if(!info.isDirectory()||info.mode&0o077||await realpath(path)!==path)
    throw fault('PRIVATE_DIRECTORY_REQUIRED','Use a real private directory with mode 0700.');
  return path;
}
export async function syncDir(path) {
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
export async function writeOnce(path,bytes) {
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
export async function readPrivate(path,max=MAX_DOCUMENT) {
  if(await realpath(path)!==path)throw fault('SAVED_PATH_CHANGED','A retained path no longer identifies its original file.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const info=await handle.stat();
    if(!info.isFile()||info.mode&0o077||info.size>max)throw fault('SAVED_FILE_INVALID','Retained file type, permissions or size is invalid.');
    const bytes=await handle.readFile();
    if(bytes.length>max)throw fault('SAVED_FILE_TOO_LARGE','Retained file exceeds its documented limit.');
    return bytes;
  } finally {await handle.close();}
}
export async function hashPrivate(path,max=MAX_SOURCE) {
  if(await realpath(path)!==path)throw fault('SAVED_PATH_CHANGED','A retained path has changed.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.mode&0o077||info.size>max)throw fault('SAVED_FILE_INVALID','Retained source is not a private regular file.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(262144);let bytes=0;
    for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      bytes+=bytesRead;if(bytes>max)throw fault('SAVED_FILE_TOO_LARGE','Retained file exceeds its limit.');
      hash.update(buffer.subarray(0,bytesRead));}
    return {bytes,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
export async function checkedFile(root,name,descriptor,max=MAX_DOCUMENT) {
  if(!descriptor||typeof name!=='string'||name.split('/').some(p=>!p||p==='.'||p==='..')||name.includes('\\'))
    throw fault('FILE_NOT_FOUND','The file is not part of this saved edition.',404);
  const path=join(root,...name.split('/')),bytes=await readPrivate(path,max);
  if(bytes.length!==descriptor.bytes||digest(bytes)!==descriptor.sha256)
    throw fault('SAVED_FILE_CHANGED','Retained file differs from its committed identity.');
  return bytes;
}
export async function openChain(root,kind) {
  await privateDir(root,true);
  for(const folder of ['editions','successors','pending'])await privateDir(join(root,folder),true);
  async function history() {
    const rows=[],seen=new Set();let previous=null;
    for(;;){
      let bytes;try{bytes=await readPrivate(join(root,'successors',(previous??'root')+'.json'));}
      catch(e){if(e.code==='ENOENT')return rows;throw e;}
      const revision=digest(bytes),value=JSON.parse(bytes.toString('utf8'));
      if(seen.has(revision)||rows.length>=100000||value.schema!==kind||value.previousRevision!==previous||
          !UUID.test(value.edition??'')||!plain(value.files))throw fault('CHAIN_INVALID','A saved edition chain is invalid.');
      const original=await readPrivate(join(root,'editions',value.edition,'manifest.json'));
      if(!original.equals(bytes))throw fault('CHAIN_CHANGED','Edition index differs from its original manifest.');
      seen.add(revision);rows.push({revision,value});previous=revision;
    }
  }
  async function find(edition){id(edition,'Edition');const found=(await history()).find(x=>x.value.edition===edition);
    if(!found)throw fault('EDITION_NOT_FOUND','Saved cost edition was not found.',404);return found;}
  async function file(entry,name){return checkedFile(join(root,'editions',entry.value.edition),name,entry.value.files[name]);}
  async function publish(input,build) {
    request(input);const requestSha256=digest(canonical(input)),entries=await history();
    const replay=entries.find(x=>x.value.requestId===input.requestId);
    if(replay){if(replay.value.requestSha256!==requestSha256)throw fault('REQUEST_CHANGED','This request ID already identifies different inputs.',409);
      return {...replay,replayed:true};}
    if((entries.at(-1)?.revision??null)!==input.expectedRevision)throw fault('REVISION_CHANGED','A newer cost edition was saved. Reload it and review your retained draft.',409);
    const edition=randomUUID(),pending=join(root,'pending',edition),final=join(root,'editions',edition);
    await privateDir(pending,true);let moved=false,published=false;
    try {
      const result=await build({edition,pending}),files={};
      for(const [name,bytes]of Object.entries(result.files)){
        if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(name)||!Buffer.isBuffer(bytes)||bytes.length>MAX_DOCUMENT)
          throw fault('EDITION_FILE_INVALID','Invalid cost edition file.');
        await writeOnce(join(pending,name),bytes);files[name]={bytes:bytes.length,sha256:digest(bytes)};
      }
      const value={...result.metadata,schema:kind,edition,previousRevision:input.expectedRevision,
        requestId:input.requestId,requestSha256,savedAt:new Date().toISOString(),files};
      const bytes=encode(value),revision=digest(bytes);await writeOnce(join(pending,'manifest.json'),bytes);await syncDir(pending);
      await rename(pending,final);moved=true;await syncDir(join(root,'editions'));
      try{await link(join(final,'manifest.json'),join(root,'successors',(input.expectedRevision??'root')+'.json'));published=true;}
      catch(e){if(e.code!=='EEXIST')throw e;const winner=(await history()).find(x=>x.value.requestId===input.requestId);
        if(winner?.value.requestSha256===requestSha256)return {...winner,replayed:true};
        throw fault('REVISION_CHANGED','Another cost edition saved first. Reload its revision and review your draft.',409);}
      await syncDir(join(root,'successors'));return {revision,value,replayed:false};
    }finally{if(!published)await rm(moved?final:pending,{recursive:true,force:true}).catch(()=>{});}
  }
  return {root,history,find,file,publish};
}
export function utf8(bytes,label='Source') {
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw fault('UTF8_REQUIRED',label+' must contain valid UTF-8. The retained original bytes remain available.');}
}
export function csvCell(value) {
  let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csv(rows,columns){return Buffer.from([columns.map(([label])=>csvCell(label)).join(','),
  ...rows.map(row=>columns.map(([,key])=>csvCell(typeof key==='function'?key(row):row[key])).join(','))].join('\r\n')+'\r\n');}
