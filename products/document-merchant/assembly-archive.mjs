// MIT. Complete immutable customer bundle; the original Collection archive is retained as a member.
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {absolute,ownedDirectory}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {documentError} from './contracts.mjs';
const BLOCK=512,CHUNK=1048576,MAX=2147483648;
function need(value,code){if(!value)throw documentError(code);}
function header(name,size){
  need(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name)&&
    name.split('/').every(part=>part!=='.'&&part!=='..'&&part.length>0),'DOCUMENT_ASSEMBLY_ARCHIVE_NAME_INVALID');
  need(Number.isSafeInteger(size)&&size>=0&&size<=MAX,'DOCUMENT_ASSEMBLY_ARCHIVE_SIZE_INVALID');
  const value=Buffer.alloc(BLOCK);
  const text=(content,offset,length)=>{need(Buffer.byteLength(content)<=length,'DOCUMENT_ASSEMBLY_ARCHIVE_FIELD_INVALID');
    value.write(content,offset,length,'ascii');};
  const octal=(number,offset,length)=>text(number.toString(8).padStart(length-1,'0')+'\0',offset,length);
  text(name,0,100);octal(0o600,100,8);octal(0,108,8);octal(0,116,8);octal(size,124,12);octal(0,136,12);
  value.fill(32,148,156);text('0',156,1);text('ustar\0',257,6);text('00',263,2);
  let sum=0;for(const byte of value)sum+=byte;text(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return value;
}
async function streamFile(path,expected,consume,signal){
  const file=await open(absolute(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const first=await file.stat();
    need(first.isFile()&&first.nlink>=1&&first.size===expected.bytes,'DOCUMENT_ASSEMBLY_ARCHIVE_MEMBER_CHANGED');
    const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let position=0;
    while(position<first.size){
      signal?.throwIfAborted();
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,first.size-position),position);
      need(bytesRead>0,'DOCUMENT_ASSEMBLY_ARCHIVE_MEMBER_INCOMPLETE');
      const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);await consume(chunk);position+=bytesRead;
    }
    const after=await file.stat(),sha256=hash.digest('hex');
    need(after.dev===first.dev&&after.ino===first.ino&&after.size===first.size&&
      after.mtimeMs===first.mtimeMs&&after.ctimeMs===first.ctimeMs&&
      (expected.sha256===undefined||expected.sha256===sha256),'DOCUMENT_ASSEMBLY_ARCHIVE_MEMBER_CHANGED');
    return {bytes:position,sha256};
  }finally{await file.close();}
}
/** POSIX ustar with deterministic headers and whole source/volume/native Collection bytes. */
export async function writeDocumentAssemblyArchive({destination,members,maxBytes=MAX,signal}={}){
  destination=absolute(destination);
  need(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=MAX,'DOCUMENT_ASSEMBLY_ARCHIVE_LIMIT_INVALID');
  need(Array.isArray(members)&&members.length>0&&new Set(members.map(file=>file.name)).size===members.length,
    'DOCUMENT_ASSEMBLY_ARCHIVE_MEMBERS_REQUIRED');
  const planned=members.reduce((sum,file)=>sum+BLOCK+Math.ceil(file.bytes/BLOCK)*BLOCK,2*BLOCK);
  need(Number.isSafeInteger(planned)&&planned<=maxBytes,'DOCUMENT_ASSEMBLY_ARCHIVE_LIMIT_EXCEEDED');
  const directory=await ownedDirectory(dirname(destination)),temporary=join(directory,'.assembly-'+randomUUID()+'.tar');
  let output,position=0;const hash=createHash('sha256');
  try{
    output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    async function write(bytes){
      signal?.throwIfAborted();let offset=0;
      while(offset<bytes.length){const result=await output.write(bytes,offset,bytes.length-offset,position+offset);
        need(result.bytesWritten>0,'DOCUMENT_ASSEMBLY_ARCHIVE_WRITE_INCOMPLETE');offset+=result.bytesWritten;}
      hash.update(bytes);position+=bytes.length;
    }
    for(const file of members){
      need(/^[a-f0-9]{64}$/.test(file.sha256??''),'DOCUMENT_ASSEMBLY_ARCHIVE_MEMBER_CHANGED');
      await write(header(file.name,file.bytes));await streamFile(file.path,file,write,signal);
      if(file.bytes%BLOCK)await write(Buffer.alloc(BLOCK-file.bytes%BLOCK));
    }
    await write(Buffer.alloc(2*BLOCK));need(position===planned,'DOCUMENT_ASSEMBLY_ARCHIVE_WRITE_INCOMPLETE');
    await output.sync();await output.close();output=null;
    const sha256=hash.digest('hex');
    try{await link(temporary,destination);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      await streamFile(destination,{bytes:position,sha256},async()=>{},signal);
    }
    await unlink(temporary);
    const folder=await open(directory,constants.O_RDONLY);
    try{await folder.sync();}finally{await folder.close();}
    return {path:destination,bytes:position,sha256,members:members.length};
  }finally{
    await output?.close().catch(()=>{});
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
