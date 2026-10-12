// MIT. Streaming private TAR packages and create-only workspace restoration.
import { open, mkdir, lstat, realpath, link, unlink, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { encode, digest, fault, privateDir, syncDir, utf8, readPrivate, writeOnce, checkedFile, MAX_DOCUMENT } from './common.mjs';
export const MAX_BUNDLE=512*1024*1024;
const MAX_FILES=100000,MAX_MEMBER=64*1024*1024,block=512;
function safeName(name){
  if(typeof name!=='string'||name.length>240||!/^[A-Za-z0-9_.\/-]+$/.test(name)||
      name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..'))
    throw fault('BUNDLE_PATH_INVALID','Package contains an unsupported relative file path.');
  return name;
}
function field(bytes,offset,length,value){const source=Buffer.from(value,'ascii');
  if(source.length>length)throw fault('BUNDLE_HEADER_INVALID','Package header field is too long.');source.copy(bytes,offset);}
function octal(n,length){const value=n.toString(8);if(value.length>length-1)throw fault('BUNDLE_TOO_LARGE','Package size exceeds the supported TAR field.');
  return value.padStart(length-1,'0')+'\0';}
function header(name,size){
  safeName(name);let short=name,prefix='';
  if(Buffer.byteLength(name)>100){let at=name.lastIndexOf('/');for(;at>0;at=name.lastIndexOf('/',at-1)){
    if(Buffer.byteLength(name.slice(0,at))<=155&&Buffer.byteLength(name.slice(at+1))<=100){prefix=name.slice(0,at);short=name.slice(at+1);break;}}
    if(!prefix)throw fault('BUNDLE_PATH_INVALID','Package filename exceeds the USTAR path limit.');}
  const h=Buffer.alloc(block);field(h,0,100,short);field(h,100,8,octal(0o600,8));
  field(h,108,8,octal(0,8));field(h,116,8,octal(0,8));field(h,124,12,octal(size,12));field(h,136,12,octal(0,12));
  h.fill(32,148,156);h[156]=48;field(h,257,6,'ustar\0');field(h,263,2,'00');field(h,345,155,prefix);
  let checksum=0;for(const byte of h)checksum+=byte;field(h,148,8,checksum.toString(8).padStart(6,'0')+'\0 ');return h;
}
async function exactRead(handle,length,position){
  const buffer=Buffer.alloc(length);let used=0;
  while(used<length){const result=await handle.read(buffer,used,length-used,position+used);
    if(!result.bytesRead)throw fault('BUNDLE_TRUNCATED','Package ended before its declared file size.');used+=result.bytesRead;}
  return buffer;
}
function cstring(buffer){const end=buffer.indexOf(0);return utf8(end<0?buffer:buffer.subarray(0,end),'Package header');}
function number(buffer){const text=cstring(buffer).trim();if(!/^[0-7]+$/.test(text))throw fault('BUNDLE_HEADER_INVALID','Invalid TAR numeric header.');
  const n=parseInt(text,8);if(!Number.isSafeInteger(n))throw fault('BUNDLE_HEADER_INVALID','Invalid TAR size.');return n;}
function decodedHeader(buffer){
  const copy=Buffer.from(buffer),expected=number(copy.subarray(148,156));copy.fill(32,148,156);
  if(copy.reduce((n,x)=>n+x,0)!==expected)throw fault('BUNDLE_HEADER_INVALID','TAR header checksum does not match.');
  if(![0,48].includes(buffer[156])||cstring(buffer.subarray(257,263))!=='ustar')
    throw fault('BUNDLE_MEMBER_INVALID','Only original USTAR regular files are accepted.');
  const prefix=cstring(buffer.subarray(345,500)),name=safeName((prefix?prefix+'/':'')+cstring(buffer.subarray(0,100)));
  const size=number(buffer.subarray(124,136));if(size>MAX_MEMBER)throw fault('BUNDLE_MEMBER_TOO_LARGE','A package member exceeds 64 MiB.');
  return {name,size};
}
export async function inspectBundle(path,{onFile,onStart,expectedRequestSha256}={}) {
  if(resolve(path)!==path||await realpath(path)!==path)throw fault('BUNDLE_FILE_INVALID','Use an original regular package file.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const observed=[],names=new Set(),archiveHash=createHash('sha256');let offset=0,total=0,descriptor=null,manifest=null;
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BUNDLE)throw fault('BUNDLE_FILE_INVALID','Cost packages are limited to 512 MiB.');
    async function read(n){const result=await exactRead(handle,n,offset);offset+=n;archiveHash.update(result);return result;}
    for(;;){
      const h=await read(block);
      if(h.every(x=>x===0)){
        const end=await read(block);if(!end.every(x=>x===0)||offset!==stat.size)throw fault('BUNDLE_TRAILING_DATA','Package has missing or unexpected trailing data.');
        break;
      }
      const entry=decodedHeader(h);if(names.has(entry.name)||names.size>=MAX_FILES)throw fault('BUNDLE_MEMBER_INVALID','Package has duplicate files or too many members.');
      names.add(entry.name);if(manifest)throw fault('BUNDLE_MANIFEST_ORDER','Manifest must be the final file.');
      if(!descriptor&&entry.name!=='bundle.json')throw fault('BUNDLE_DESCRIPTOR_REQUIRED','Package must begin with its original descriptor.');
      const chunks=[],hash=createHash('sha256');
      const retain=entry.name==='bundle.json'||entry.name==='manifest.json';
      const sink=retain?null:await onFile?.(entry);let remaining=entry.size;
      try{while(remaining){const chunk=await read(Math.min(262144,remaining));remaining-=chunk.length;hash.update(chunk);
        if(retain)chunks.push(chunk);else if(sink)await sink.write(chunk);}
        if(sink)await sink.close();
      }catch(e){await sink?.abort?.();throw e;}
      const padding=(block-entry.size%block)%block;if(padding){const pad=await read(padding);
        if(!pad.every(x=>x===0))throw fault('BUNDLE_PADDING_INVALID','Package contains nonzero TAR padding.');}
      const actual={name:entry.name,bytes:entry.size,sha256:hash.digest('hex')};total+=entry.size;
      if(entry.name==='bundle.json'){descriptor=JSON.parse(utf8(Buffer.concat(chunks)));
        if(expectedRequestSha256&&descriptor.requestSha256!==expectedRequestSha256)throw fault('REQUEST_CHANGED','The existing package belongs to different requested inputs.',409);
        await onStart?.(descriptor);
      }else if(entry.name==='manifest.json')manifest=JSON.parse(utf8(Buffer.concat(chunks)));
      else observed.push(actual);
    }
    if(!descriptor||manifest?.schema!=='stellar-forge.merchant-cost-bundle-manifest.v1'||
        manifest.descriptorSha256!==digest(encode(descriptor))||JSON.stringify(manifest.files)!==JSON.stringify(observed))
      throw fault('BUNDLE_CONTENT_CHANGED','Package files do not match the complete original manifest.');
    return {descriptor,manifest,bytes:stat.size,sha256:archiveHash.digest('hex'),fileCount:observed.length};
  }finally{await handle.close();}
}
export async function writeBundle({path,descriptor,items}) {
  try{return await inspectBundle(path,{expectedRequestSha256:descriptor.requestSha256});}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=path+'.'+randomUUID()+'.pending',handle=await open(temporary,'wx',0o600),hash=createHash('sha256');
  let bytes=0,closed=false,published=false;const files=[],names=new Set();
  async function write(buffer){bytes+=buffer.length;if(bytes>MAX_BUNDLE)throw fault('BUNDLE_TOO_LARGE','The complete private package exceeds 512 MiB.');
    hash.update(buffer);await handle.writeFile(buffer);}
  async function member(name,data){safeName(name);if(names.has(name)||names.size>=MAX_FILES)throw fault('BUNDLE_MEMBER_INVALID','Duplicate or excessive package file.');
    if(!Buffer.isBuffer(data)||data.length>MAX_MEMBER)throw fault('BUNDLE_MEMBER_INVALID','Invalid package file size.');
    names.add(name);await write(header(name,data.length));await write(data);const pad=(block-data.length%block)%block;if(pad)await write(Buffer.alloc(pad));
    return {name,bytes:data.length,sha256:digest(data)};}
  try{
    const descriptorBytes=encode(descriptor);await member('bundle.json',descriptorBytes);
    for await(const item of items){if(['bundle.json','manifest.json'].includes(item.name))throw fault('BUNDLE_MEMBER_INVALID','Reserved package file.');
      const data=item.read?await item.read():item.bytes;files.push(await member(item.name,data));}
    await member('manifest.json',encode({schema:'stellar-forge.merchant-cost-bundle-manifest.v1',
      descriptorSha256:digest(descriptorBytes),files}));
    await write(Buffer.alloc(block*2));await handle.sync();await handle.close();closed=true;
    try{await link(temporary,path);published=true;}catch(e){if(e.code!=='EEXIST')throw e;
      return inspectBundle(path,{expectedRequestSha256:descriptor.requestSha256});}
    await syncDir(dirname(path));return {descriptor,bytes,sha256:hash.digest('hex'),fileCount:files.length};
  }finally{if(!closed)await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
function restorable(name){
  safeName(name);const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',hash='(?:root|[a-f0-9]{64})';
  return new RegExp('^(?:versions|decisions)/'+uuid+'/[A-Za-z0-9_./-]+$').test(name)||
    new RegExp('^(?:successors|decision-successors)/'+hash+'\\.json$').test(name)||
    new RegExp('^staged-releases/'+uuid+'\\.json$').test(name)||
    new RegExp('^scenario-plans/'+uuid+'\\.json$').test(name)||
    new RegExp('^economics/sources/records/'+uuid+'/(?:original|source\\.json)$').test(name)||
    new RegExp('^economics/books/editions/'+uuid+'/[A-Za-z0-9_.-]+$').test(name)||
    new RegExp('^economics/books/successors/'+hash+'\\.json$').test(name)||
    new RegExp('^economics/pricing-links/'+uuid+'\\.json$').test(name);
}
export async function restoreCostWorkspace({archive,directory}) {
  directory=resolve(directory);archive=resolve(archive);
  await privateDir(dirname(directory));
  const temporary=join(dirname(directory),'.cost-restore-'+randomUUID());await privateDir(temporary,true);
  let restored=false;
  try {
    const result=await inspectBundle(archive,{onStart:descriptor=>{
      if(descriptor.schema!=='stellar-forge.merchant-cost-backup.v1'||descriptor.kind!=='WORKSPACE_BACKUP')
        throw fault('WORKSPACE_BACKUP_REQUIRED','Select a complete private workspace backup, not a single cost edition.');
    },onFile:async entry=>{
      if(!restorable(entry.name))throw fault('RESTORE_PATH_INVALID','Package member is outside the original pricing and cost workspace.');
      const parts=entry.name.split('/');let parent=temporary;
      for(const part of parts.slice(0,-1)){parent=join(parent,part);await privateDir(parent,true);}
      const handle=await open(join(parent,parts.at(-1)),'wx',0o600);let closed=false;
      return {write:bytes=>handle.writeFile(bytes),close:async()=>{await handle.sync();await handle.close();closed=true;},
        abort:async()=>{if(!closed)await handle.close().catch(()=>{});}};
    }});
    if(!result.manifest.files.some(x=>x.name.startsWith('successors/')))
      throw fault('PRICING_BACKUP_INCOMPLETE','The backup contains no committed original pricing source.');
    await syncDir(temporary);
    const pendingName='.cost-restore-pending.json',completeName='.cost-restore-complete.json';
    let created=false;
    try{await mkdir(directory,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
    await privateDir(directory);
    const receipt={schema:'stellar-forge.merchant-cost-restore.v1',sourceArchiveSha256:result.sha256,fileCount:result.fileCount};
    if(created)await writeOnce(join(directory,pendingName),encode(receipt));
    else {
      let previous;
      try{previous=JSON.parse((await readPrivate(join(directory,pendingName))).toString('utf8'));}
      catch{throw fault('RESTORE_NEW_DIRECTORY','Choose a new directory, or resume this exact original incomplete restoration.');}
      if(previous.sourceArchiveSha256!==result.sha256)throw fault('RESTORE_SOURCE_CHANGED','This directory belongs to another restoration.',409);
      try{const completed=JSON.parse((await readPrivate(join(directory,completeName))).toString('utf8'));
        if(completed.sourceArchiveSha256!==result.sha256)throw fault('RESTORE_SOURCE_CHANGED','Completed restoration source differs.',409);
        restored=true;return {status:'COST_WORKSPACE_RESTORED',directory,sourceArchiveSha256:result.sha256,fileCount:result.fileCount,replayed:true};
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    const directories=new Set([directory]);
    for(const entry of result.manifest.files){
      const parts=entry.name.split('/');let parent=directory;
      for(const part of parts.slice(0,-1)){parent=join(parent,part);await privateDir(parent,true);directories.add(parent);}
      const target=join(parent,parts.at(-1));
      try{await link(join(temporary,...parts),target);}
      catch(e){if(e.code!=='EEXIST')throw e;await checkedFile(directory,entry.name,{bytes:entry.bytes,sha256:entry.sha256},MAX_MEMBER);}
    }
    for(const dir of [...directories].sort((a,b)=>b.length-a.length))await syncDir(dir);
    try{await writeOnce(join(directory,completeName),encode(receipt));}
    catch(e){if(e.code!=='EEXIST')throw e;
      const previous=JSON.parse((await readPrivate(join(directory,completeName))).toString('utf8'));
      if(previous.sourceArchiveSha256!==result.sha256)throw fault('RESTORE_SOURCE_CHANGED','Restore completion differs from its original source.');}
    await syncDir(directory);restored=true;
    return {status:'COST_WORKSPACE_RESTORED',directory,sourceArchiveSha256:result.sha256,fileCount:result.fileCount,replayed:!created};
  }finally{await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
}

export async function requireCompletedRestore(directory) {
  let pending;try{pending=JSON.parse((await readPrivate(join(directory,'.cost-restore-pending.json'))).toString('utf8'));}
  catch(e){if(e.code==='ENOENT')return;throw e;}
  let completed;try{completed=JSON.parse((await readPrivate(join(directory,'.cost-restore-complete.json'))).toString('utf8'));}
  catch{throw fault('RESTORE_INCOMPLETE','Resume this exact backup with --restore-cost-workspace before opening its partial history.');}
  if(completed.sourceArchiveSha256!==pending.sourceArchiveSha256)throw fault('RESTORE_SOURCE_CHANGED','Restore completion does not match its original archive.');
}

export async function openBundleDownload({path,bytes,sha256}) {
  if(await realpath(path)!==path)throw fault('EXPORT_FILE_CHANGED','Private export path has changed.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await handle.stat();if(!info.isFile()||info.mode&0o077||info.size!==bytes||bytes>MAX_BUNDLE)
      throw fault('EXPORT_FILE_CHANGED','Private export file no longer matches its receipt.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(262144);let offset=0;
    for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;offset+=bytesRead;hash.update(buffer.subarray(0,bytesRead));}
    if(offset!==bytes||hash.digest('hex')!==sha256)throw fault('EXPORT_FILE_CHANGED','Private export content no longer matches its original receipt.');
    return {handle,stream:()=>handle.createReadStream({start:0,autoClose:false}),close:()=>handle.close()};
  }catch(e){await handle.close();throw e;}
}
