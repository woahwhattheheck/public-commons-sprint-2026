// MIT. Streaming, private-file transport for original SF101 encrypted bundles.
import { constants } from 'node:fs';
import { open, lstat, readdir, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const FORMAT='stellar-forge.sf101.object-recovery-transfer.v1';
export const LIMITS=Object.freeze({files:11000,bytes:4*1024**3+32*1024**2,file:2*1024**3,
  metadata:16*1024**2,archive:4*1024**3+64*1024**2,depth:16});
const BLOCK=512, CHUNK=1024*1024, NOFOLLOW=constants.O_NOFOLLOW;
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const same=(left,right)=>isDeepStrictEqual(left,right);
export const fail=code=>{throw Object.assign(new Error(code),{code});};
export function check(value,code){if(!value)fail(code);}
export function abort(signal){if(signal?.aborted)fail('OBJECT_BUNDLE_CANCELLED');}
export function absolute(path){check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/'&&!path.includes('\0'),
  'OBJECT_BUNDLE_CANONICAL_PATH_REQUIRED');return path;}
export async function present(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function directory(path,create=false){
  absolute(path); if(create)await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  check(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&
    stat.uid===process.getuid()&&await realpath(path)===path,'OBJECT_BUNDLE_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function sync(path){const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}}
function privateStat(stat,maximum){check(stat.isFile()&&stat.nlink===1&&!(stat.mode&0o077)&&
  stat.uid===process.getuid()&&Number.isSafeInteger(stat.size)&&stat.size<=maximum,'OBJECT_BUNDLE_PRIVATE_FILE_REQUIRED');}
function stable(before,after){return before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
  before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs;}
export async function readSmall(path,maximum=LIMITS.metadata){
  const handle=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{privateStat(await handle.stat(),maximum);const before=await handle.stat({bigint:true});
    const bytes=Buffer.alloc(Math.min(maximum+1,Number(before.size)+1));let offset=0;
    while(offset<bytes.length){const part=await handle.read(bytes,offset,bytes.length-offset,null);if(!part.bytesRead)break;offset+=part.bytesRead;}
    check(offset<=maximum&&BigInt(offset)===before.size&&stable(before,await handle.stat({bigint:true})),
      'OBJECT_BUNDLE_FILE_CHANGED');return bytes.subarray(0,offset);
  }finally{await handle.close();}
}
export async function readJson(path){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readSmall(path)));}
  catch(error){if(error.code)throw error;fail('OBJECT_BUNDLE_JSON_INVALID');}}
export async function writeAll(handle,buffer){
  let offset=0;while(offset<buffer.length){const {bytesWritten}=await handle.write(buffer,offset,buffer.length-offset,null);
    check(bytesWritten>0,'OBJECT_BUNDLE_SHORT_WRITE');offset+=bytesWritten;}
}
export async function atomic(path,bytes){
  await directory(dirname(path)); const temporary=join(dirname(path),'.pending-'+randomUUID());
  const handle=await open(temporary,'wx',0o600);
  try{await writeAll(handle,bytes);await handle.sync();}finally{await handle.close();}
  await rename(temporary,path);await sync(dirname(path));
}
export const atomicJson=(path,value)=>atomic(path,jsonBytes(value));
export async function immutableJson(path,value){
  const bytes=jsonBytes(value);
  if(await present(path)){check((await readSmall(path)).equals(bytes),'OBJECT_BUNDLE_RETAINED_RECORD_CONFLICT');return fileIdentity(path);}
  await atomic(path,bytes);return {path,bytes:bytes.length,sha256:sha(bytes)};
}
export async function streamFile(path,consume,{maximum=LIMITS.archive,signal}={}){
  await directory(dirname(path));const handle=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{
    privateStat(await handle.stat(),maximum);const before=await handle.stat({bigint:true});
    const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let bytes=0;
    while(true){abort(signal);const part=await handle.read(buffer,0,buffer.length,null);if(!part.bytesRead)break;
      bytes+=part.bytesRead;check(bytes<=maximum,'OBJECT_BUNDLE_SIZE_LIMIT');
      const chunk=buffer.subarray(0,part.bytesRead);hash.update(chunk);if(consume)await consume(chunk);
    }
    check(BigInt(bytes)===before.size&&stable(before,await handle.stat({bigint:true})),'OBJECT_BUNDLE_FILE_CHANGED');
    return {path,bytes,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
export const fileIdentity=(path,options)=>streamFile(path,null,options);
export function nameParts(name){
  check(typeof name==='string'&&name.length>0&&name.length<=240&&/^[\x21-\x7e]+$/.test(name)&&
    !name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&
    name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')&&name.split('/').length<=LIMITS.depth,
    'OBJECT_BUNDLE_MEMBER_NAME_INVALID');
  if(Buffer.byteLength(name)<=100)return {name,prefix:''};
  let split=name.lastIndexOf('/');
  while(split>0){const prefix=name.slice(0,split),leaf=name.slice(split+1);
    if(prefix.length<=155&&leaf.length<=100)return {name:leaf,prefix};split=name.lastIndexOf('/',split-1);}
  fail('OBJECT_BUNDLE_MEMBER_NAME_TOO_LONG');
}
export async function inventory(root,{signal,hash=false}={}){
  await directory(root);const members=[];let bytes=0,files=0;
  async function walk(current,prefix){
    abort(signal);await directory(current);
    const names=(await readdir(current)).sort();
    for(const name of names){
      const path=join(current,name),relative=prefix?prefix+'/'+name:name;
      nameParts('bundle/'+relative);const stat=await lstat(path);
      if(stat.isDirectory()&&!stat.isSymbolicLink()){
        check(members.length<LIMITS.files,'OBJECT_BUNDLE_ENTRY_LIMIT');
        members.push({path:relative,type:'directory',bytes:0});await walk(path,relative);
      }else{
        const maximum=relative.startsWith('objects/')?LIMITS.file:LIMITS.metadata;
        privateStat(stat,maximum);files++;bytes+=stat.size;
        check(members.length<LIMITS.files&&bytes<=LIMITS.bytes,'OBJECT_BUNDLE_ENTRY_LIMIT');
        const member={path:relative,type:'file',bytes:stat.size};
        if(hash)member.sha256=(await fileIdentity(path,{maximum,signal})).sha256;
        members.push(member);
      }
    }
  }
  await walk(root,'');check(members.some(x=>x.path==='manifest.json'&&x.type==='file'),
    'OBJECT_BUNDLE_NATIVE_MANIFEST_MISSING');
  members.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {members,files,bytes};
}
export async function copyBundle(source,destination,signal){
  const before=await inventory(source,{signal});await directory(destination,true);
  const members=[];
  for(const member of before.members){
    abort(signal);const target=join(destination,member.path);
    if(member.type==='directory'){await directory(target,true);members.push(member);continue;}
    await directory(dirname(target),true);const output=await open(target,'wx',0o600);let identity;
    try{identity=await streamFile(join(source,member.path),chunk=>writeAll(output,chunk),
      {maximum:member.path.startsWith('objects/')?LIMITS.file:LIMITS.metadata,signal});await output.sync();}
    finally{await output.close();}
    check(identity.bytes===member.bytes,'OBJECT_BUNDLE_SOURCE_CHANGED');
    members.push({...member,sha256:identity.sha256});
  }
  check(same(before,await inventory(source,{signal})),'OBJECT_BUNDLE_SOURCE_CHANGED');
  // The native verifier authenticates this complete retained copy, so later changes
  // to the caller's source cannot change the exported edition.
  for(const member of [...members].reverse())if(member.type==='directory')await sync(join(destination,member.path));
  await sync(destination);return {...before,members};
}
export async function verifyInventory(root,expected,signal,{extra=[]}={}){
  const actual=await inventory(root,{signal,hash:true});
  check(same(actual.members,[...expected,...extra].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)),
    'OBJECT_BUNDLE_RETAINED_CONTENT_CHANGED');return actual;
}
function octal(buffer,start,length,value){
  const text=value.toString(8);check(text.length<=length-1,'OBJECT_BUNDLE_TAR_SIZE_INVALID');
  buffer.write(text.padStart(length-1,'0')+'\0',start,length,'ascii');
}
export function tarHeader(path,size,type='file'){
  const parts=nameParts(path),header=Buffer.alloc(BLOCK);
  header.write(parts.name,0,100,'ascii');octal(header,100,8,type==='directory'?0o700:0o600);
  octal(header,108,8,0);octal(header,116,8,0);octal(header,124,12,size);octal(header,136,12,0);
  header.fill(32,148,156);header[156]=type==='directory'?53:48;
  header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');
  header.write(parts.prefix,345,155,'ascii');
  let sum=0;for(const byte of header)sum+=byte;
  header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');return header;
}
export async function createArchive(path,{manifest,verification,bundle},signal){
  const manifestBytes=jsonBytes(manifest),verificationBytes=await readSmall(verification.path);
  check(sha(verificationBytes)===verification.sha256&&verificationBytes.length===verification.bytes,
    'OBJECT_BUNDLE_VERIFICATION_CHANGED');
  const temporary=path+'.partial';
  if(await present(temporary)){await readSmallOrStat(temporary,LIMITS.archive);await rm(temporary);}
  const output=await open(temporary,'wx',0o600),hash=createHash('sha256');let bytes=0;
  const put=async data=>{abort(signal);bytes+=data.length;check(bytes<=LIMITS.archive,'OBJECT_BUNDLE_ARCHIVE_TOO_LARGE');
    hash.update(data);await writeAll(output,data);};
  async function member(name,data){await put(tarHeader(name,data.length));await put(data);
    const padding=(BLOCK-data.length%BLOCK)%BLOCK;if(padding)await put(Buffer.alloc(padding));}
  try{
    await member('recovery-transfer.json',manifestBytes);
    await member('export-verification.json',verificationBytes);
    for(const entry of manifest.members){
      await put(tarHeader('bundle/'+entry.path,entry.bytes,entry.type));
      if(entry.type==='directory')continue;
      const identity=await streamFile(join(bundle,entry.path),put,{maximum:entry.bytes,signal});
      check(identity.bytes===entry.bytes&&identity.sha256===entry.sha256,'OBJECT_BUNDLE_RETAINED_CONTENT_CHANGED');
      const padding=(BLOCK-entry.bytes%BLOCK)%BLOCK;if(padding)await put(Buffer.alloc(padding));
    }
    await put(Buffer.alloc(2*BLOCK));await output.sync();
  }finally{await output.close();}
  await rename(temporary,path);await sync(dirname(path));return {path,bytes,sha256:hash.digest('hex')};
}
async function readSmallOrStat(path,maximum){
  const handle=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{privateStat(await handle.stat(),maximum);}finally{await handle.close();}
}
function parseHeader(header){
  if(header.every(byte=>byte===0))return null;
  function string(start,length){const field=header.subarray(start,start+length),zero=field.indexOf(0);
    const value=field.subarray(0,zero<0?field.length:zero);
    check(value.every(byte=>byte>=32&&byte<=126),'OBJECT_BUNDLE_TAR_HEADER_INVALID');
    if(zero>=0)check(field.subarray(zero).every(byte=>byte===0),'OBJECT_BUNDLE_TAR_HEADER_INVALID');
    return value.toString('ascii');}
  function number(start,length){const value=header.subarray(start,start+length).toString('ascii');
    check(/^[0-7]+[\0 ]+$/.test(value),'OBJECT_BUNDLE_TAR_NUMBER_INVALID');return parseInt(value,8);}
  const checksum=number(148,8);let sum=0;for(let i=0;i<BLOCK;i++)sum+=i>=148&&i<156?32:header[i];
  check(checksum===sum&&header.subarray(257,263).equals(Buffer.from('ustar\0'))&&
    header.subarray(263,265).equals(Buffer.from('00')),'OBJECT_BUNDLE_TAR_HEADER_INVALID');
  const name=string(0,100),prefix=string(345,155),path=prefix?prefix+'/'+name:name;
  nameParts(path);const type=header[156]===48?'file':header[156]===53?'directory':null,size=number(124,12);
  check(type&&Number.isSafeInteger(size)&&size<=LIMITS.metadata+LIMITS.file&&
    (type!=='directory'||size===0)&&string(157,100)==='','OBJECT_BUNDLE_TAR_MEMBER_INVALID');
  // Accept only the canonical portable headers emitted here; no PAX, links,
  // extended numeric fields, timestamps, hidden prefixes or device entries.
  check(header.equals(tarHeader(path,size,type)),'OBJECT_BUNDLE_TAR_NONCANONICAL_HEADER');
  return {path,type,bytes:size};
}
export function validateManifest(manifest){
  check(manifest&&manifest.schema===FORMAT&&hex(manifest.recordSha256)&&
    manifest.objectSession&&typeof manifest.objectSession==='object'&&!Array.isArray(manifest.objectSession)&&
    manifest.lineage&&typeof manifest.lineage==='object'&&Array.isArray(manifest.members)&&
    manifest.members.length>0&&manifest.members.length<=LIMITS.files,
    'OBJECT_BUNDLE_MANIFEST_INVALID');
  check(jsonBytes(manifest.objectSession).length<=262144&&jsonBytes(manifest.lineage).length<=8192,
    'OBJECT_BUNDLE_IDENTITY_TOO_LARGE');
  const seen=new Set(),byPath=new Map(manifest.members.map(entry=>[entry?.path,entry]));let bytes=0,files=0;
  for(const entry of manifest.members){
    check(entry&&typeof entry.path==='string','OBJECT_BUNDLE_MEMBER_INVALID');nameParts('bundle/'+entry.path);
    check(!seen.has(entry.path)&&(entry.type==='file'||entry.type==='directory')&&
      Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&
      (entry.type==='directory'?entry.bytes===0&&entry.sha256===undefined:
        hex(entry.sha256)&&entry.bytes<=(entry.path.startsWith('objects/')?LIMITS.file:LIMITS.metadata)),
      'OBJECT_BUNDLE_MEMBER_INVALID');
    for(let parent=dirname(entry.path);parent!=='.';parent=dirname(parent))
      check(byPath.get(parent)?.type==='directory','OBJECT_BUNDLE_PARENT_MISSING');
    seen.add(entry.path);bytes+=entry.bytes;if(entry.type==='file')files++;
  }
  check(manifest.members.some(x=>x.path==='manifest.json'&&x.type==='file')&&bytes<=LIMITS.bytes&&
    files===manifest.fileCount&&bytes===manifest.bytes&&
    same(manifest.members,[...manifest.members].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))&&
    manifest.exportVerification&&hex(manifest.exportVerification.sha256)&&
    Number.isSafeInteger(manifest.exportVerification.bytes)&&manifest.exportVerification.bytes>0&&
    manifest.exportVerification.bytes<=LIMITS.metadata,'OBJECT_BUNDLE_MANIFEST_TOTALS_INVALID');
  return manifest;
}
export async function parseArchive(path,{expectedArchiveSha256,extract,signal}={}){
  check(hex(expectedArchiveSha256),'OBJECT_BUNDLE_ARCHIVE_DIGEST_REQUIRED');
  await directory(dirname(path));if(extract)await directory(extract,true);
  const input=await open(path,constants.O_RDONLY|NOFOLLOW);
  try{
    privateStat(await input.stat(),LIMITS.archive);const before=await input.stat({bigint:true});
    const archiveHash=createHash('sha256');let consumed=0;
    async function read(size){abort(signal);const data=Buffer.alloc(size);let offset=0;
      while(offset<size){const part=await input.read(data,offset,size-offset,null);
        check(part.bytesRead>0,'OBJECT_BUNDLE_TRUNCATED_ARCHIVE');offset+=part.bytesRead;}
      consumed+=size;check(consumed<=LIMITS.archive,'OBJECT_BUNDLE_ARCHIVE_TOO_LARGE');archiveHash.update(data);return data;}
    async function padding(size){const count=(BLOCK-size%BLOCK)%BLOCK;
      if(count)check((await read(count)).every(byte=>byte===0),'OBJECT_BUNDLE_TAR_PADDING_INVALID');}
    const first=parseHeader(await read(BLOCK));
    check(first?.path==='recovery-transfer.json'&&first.type==='file'&&first.bytes<=LIMITS.metadata,
      'OBJECT_BUNDLE_TRANSPORT_MANIFEST_MISSING');
    const manifestBytes=await read(first.bytes);let manifest;
    try{manifest=validateManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));}
    catch(error){if(error.code)throw error;fail('OBJECT_BUNDLE_MANIFEST_INVALID');}
    check(jsonBytes(manifest).equals(manifestBytes),'OBJECT_BUNDLE_MANIFEST_ENCODING_INVALID');await padding(first.bytes);
    const expected=[{path:'export-verification.json',type:'file',bytes:manifest.exportVerification.bytes,sha256:manifest.exportVerification.sha256},
      ...manifest.members.map(member=>({...member,path:'bundle/'+member.path}))];
    for(const entry of expected){
      abort(signal);const header=parseHeader(await read(BLOCK));
      check(header&&header.path===entry.path&&header.type===entry.type&&header.bytes===entry.bytes,
        'OBJECT_BUNDLE_ARCHIVE_MEMBER_MISMATCH');
      const target=extract&&entry.path.startsWith('bundle/')?join(extract,entry.path.slice(7)):null;
      if(entry.type==='directory'){if(target)await directory(target,true);continue;}
      let output=null;const hash=createHash('sha256');
      if(target){await directory(dirname(target),true);output=await open(target,'wx',0o600);}
      try{let remaining=entry.bytes;while(remaining){const data=await read(Math.min(CHUNK,remaining));hash.update(data);
          if(output)await writeAll(output,data);remaining-=data.length;}
        check(hash.digest('hex')===entry.sha256,'OBJECT_BUNDLE_MEMBER_DIGEST_MISMATCH');
        if(output)await output.sync();
      }finally{if(output)await output.close();}
      await padding(entry.bytes);
    }
    check((await read(2*BLOCK)).every(byte=>byte===0),'OBJECT_BUNDLE_TAR_END_INVALID');
    const extra=Buffer.alloc(1);check((await input.read(extra,0,1,null)).bytesRead===0&&
      BigInt(consumed)===before.size&&stable(before,await input.stat({bigint:true})),
      'OBJECT_BUNDLE_ARCHIVE_CHANGED_OR_TRAILING_BYTES');
    const sha256=archiveHash.digest('hex');check(sha256===expectedArchiveSha256,'OBJECT_BUNDLE_ARCHIVE_DIGEST_MISMATCH');
    if(extract){for(const entry of [...manifest.members].reverse())if(entry.type==='directory')await sync(join(extract,entry.path));
      await sync(extract);}
    return {archive:{path,bytes:consumed,sha256},manifest,manifestSha256:sha(manifestBytes)};
  }finally{await input.close();}
}
export async function retainArchive(source,destination,expected,signal){
  if(await present(destination)){const identity=await fileIdentity(destination,{signal});
    check(identity.sha256===expected,'OBJECT_BUNDLE_RETAINED_ARCHIVE_CHANGED');return identity;}
  const temporary=destination+'.partial';
  if(await present(temporary)){await readSmallOrStat(temporary,LIMITS.archive);await rm(temporary);}
  const output=await open(temporary,'wx',0o600);let identity;
  try{identity=await streamFile(source,chunk=>writeAll(output,chunk),{signal});
    check(identity.sha256===expected,'OBJECT_BUNDLE_ARCHIVE_DIGEST_MISMATCH');await output.sync();}
  finally{await output.close();}
  await rename(temporary,destination);await sync(dirname(destination));return {...identity,path:destination};
}
