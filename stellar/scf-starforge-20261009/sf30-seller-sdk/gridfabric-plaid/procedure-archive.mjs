// MIT. Complete streaming transfer of an already verified Grid procedure capture.
import {createHash,randomUUID} from 'node:crypto';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import {open,mkdir,link,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {readGridFabricProcedureCapture} from '../../distribution/discovery/gridfabric-procedure-native.mjs';
import {need,memberPath,originalFile,privateDirectory,makeParents,fileIdentity,syncDirectory} from './procedure-files.mjs';

export const GRID_PROCEDURE_ARCHIVE_SCHEMA='stellar-forge.gridfabric-procedure-archive.v1';
const CHUNK=49152,MAX_LINE=1048576;
const line=value=>Buffer.from(JSON.stringify(value)+'\n');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function identity(value){
  need(value&&typeof value.path==='string'&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256||''),
    'GRID_PROCEDURE_ARCHIVE_MEMBER','Keep every complete member identity.');
  memberPath(value.path);return {path:value.path,bytes:value.bytes,sha256:value.sha256};
}
async function* archiveRecords(directory,received){
  const members=[...received.capture.members,{path:'capture.json',bytes:received.receipt.bytes,sha256:received.receipt.sha256}];
  yield line({type:'header',schema:GRID_PROCEDURE_ARCHIVE_SCHEMA,members:members.length,capture_sha256:received.receipt.sha256});
  const roster=[];let total=0;
  for(const declared of members){
    const item=identity(declared),original=await originalFile(join(directory,item.path));
    try{
      need(original.stat.size===item.bytes,'GRID_PROCEDURE_ARCHIVE_CHANGED','The selected capture member changed.',409);
      yield line({type:'file',...item});
      let offset=0;const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);
      while(offset<item.bytes){
        const {bytesRead}=await original.handle.read(buffer,0,Math.min(buffer.length,item.bytes-offset),offset);
        need(bytesRead>0,'GRID_PROCEDURE_ARCHIVE_CHANGED','The original member ended before its complete length.',409);
        const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);
        yield line({type:'chunk',offset,base64:bytes.toString('base64')});offset+=bytesRead;
      }
      await original.unchanged();
      need(hash.digest('hex')===item.sha256,'GRID_PROCEDURE_ARCHIVE_CHANGED','The original member SHA256 changed.',409);
      yield line({type:'end-file',path:item.path,bytes:offset,sha256:item.sha256});
      roster.push(item);total+=offset;
    }finally{await original.handle.close();}
  }
  yield line({type:'footer',members:roster.length,bytes:total,
    roster_sha256:createHash('sha256').update(JSON.stringify(roster)).digest('hex')});
}
export async function exportGridProcedureArchive({directory,outputFile}){
  const received=await readGridFabricProcedureCapture(directory);
  await privateDirectory(dirname(outputFile));
  const temporary=join(dirname(outputFile),'.archive-'+randomUUID());
  let written=false;
  try{
    await pipeline(Readable.from(archiveRecords(directory,received)),createGzip({level:6}),
      createWriteStream(temporary,{flags:'wx',mode:0o600}));
    const h=await open(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}
    const result=await fileIdentity(temporary);
    await link(temporary,outputFile);written=true;await syncDirectory(dirname(outputFile));
    return {...result,path:outputFile,name:'Grid_Procedure_'+received.plan.id+'.gridprocedure.jsonl.gz',
      content_type:'application/gzip',capture_sha256:received.receipt.sha256,members:received.capture.members.length+1};
  }finally{try{await unlink(temporary);}catch(e){if(e.code!=='ENOENT'&&!written)throw e;}}
}
async function* lines(readable,maximumExpanded){
  let buffered=Buffer.alloc(0),total=0;
  for await(const part of readable){
    total+=part.length;need(total<=maximumExpanded,'GRID_PROCEDURE_ARCHIVE_LIMIT','The complete archive exceeds the configured expanded allowance.',413);
    buffered=Buffer.concat([buffered,part]);let position;
    while((position=buffered.indexOf(10))>=0){
      need(position>0&&position<=MAX_LINE,'GRID_PROCEDURE_ARCHIVE_LINE','The complete archive has an invalid record.');
      const raw=buffered.subarray(0,position);buffered=buffered.subarray(position+1);
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
      catch{throw Object.assign(new Error('The complete archive has invalid UTF-8 JSON.'),{code:'GRID_PROCEDURE_ARCHIVE_JSON'});}
      yield value;
    }
    need(buffered.length<=MAX_LINE,'GRID_PROCEDURE_ARCHIVE_LINE','The complete archive has an oversized record.',413);
  }
  need(buffered.length===0,'GRID_PROCEDURE_ARCHIVE_INCOMPLETE','The complete archive ended inside a record.');
}
export async function receiveGridProcedureArchive({file,outputDirectory,expectedSha256,expectedBytes,
  maximumExpanded=16*1024*1024*1024,maximumMembers=1000000}){
  const observed=await fileIdentity(file);
  need(observed.sha256===expectedSha256&&observed.bytes===expectedBytes,'GRID_PROCEDURE_ARCHIVE_IDENTITY','The complete selected archive differs.',409);
  await privateDirectory(dirname(outputDirectory));await mkdir(outputDirectory,{mode:0o700});
  const original=await originalFile(file),input=original.handle.createReadStream({autoClose:false}),gunzip=createGunzip();
  const compressedHash=createHash('sha256');let compressedBytes=0;
  input.on('data',chunk=>{compressedBytes+=chunk.length;compressedHash.update(chunk);});
  input.on('error',error=>gunzip.destroy(error));input.pipe(gunzip);
  let header=null,footer=null,current=null,handle=null,count=0,total=0;const roster=[],seen=new Set();
  try{
    for await(const record of lines(gunzip,maximumExpanded)){
      need(record&&typeof record==='object'&&!Array.isArray(record)&&!footer,'GRID_PROCEDURE_ARCHIVE_ORDER','The complete archive order is invalid.');
      if(!header){
        need(record.type==='header'&&record.schema===GRID_PROCEDURE_ARCHIVE_SCHEMA&&
          Number.isSafeInteger(record.members)&&record.members>=1&&record.members<=maximumMembers&&
          /^[a-f0-9]{64}$/.test(record.capture_sha256||''),'GRID_PROCEDURE_ARCHIVE_HEADER','Select an original complete procedure archive.');
        header=record;continue;
      }
      if(record.type==='file'){
        need(!current&&count<header.members,'GRID_PROCEDURE_ARCHIVE_ORDER','A file interrupted an original member.');
        const item=identity(record);
        need(!seen.has(item.path)&&!seen.has('capture.json')&&
          (item.path!=='capture.json'||count===header.members-1&&item.sha256===header.capture_sha256),
          'GRID_PROCEDURE_ARCHIVE_ROSTER','Keep each original member once and the complete marker last.');
        seen.add(item.path);await makeParents(outputDirectory,item.path);
        handle=await open(join(outputDirectory,item.path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        current={item,offset:0,hash:createHash('sha256')};continue;
      }
      if(record.type==='chunk'){
        need(current&&record.offset===current.offset&&typeof record.base64==='string'&&record.base64.length>0&&
          record.base64.length<=Math.ceil(CHUNK/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.base64),
          'GRID_PROCEDURE_ARCHIVE_CHUNK','Retain each original complete byte range in order.');
        const bytes=Buffer.from(record.base64,'base64');
        need(bytes.toString('base64')===record.base64&&current.offset+bytes.length<=current.item.bytes,
          'GRID_PROCEDURE_ARCHIVE_CHUNK','The original byte range exceeds its declared member.');
        await handle.writeFile(bytes);current.hash.update(bytes);current.offset+=bytes.length;continue;
      }
      if(record.type==='end-file'){
        need(current&&record.path===current.item.path&&record.bytes===current.item.bytes&&
          record.sha256===current.item.sha256&&current.offset===current.item.bytes&&current.hash.digest('hex')===current.item.sha256,
          'GRID_PROCEDURE_ARCHIVE_MEMBER','The complete original member identity differs.');
        await handle.sync();await handle.close();handle=null;
        roster.push(current.item);total+=current.item.bytes;count++;current=null;continue;
      }
      need(record.type==='footer'&&!current&&count===header.members&&seen.has('capture.json')&&
        record.members===count&&record.bytes===total&&
        record.roster_sha256===createHash('sha256').update(JSON.stringify(roster)).digest('hex'),
        'GRID_PROCEDURE_ARCHIVE_FOOTER','The complete original archive footer differs.');
      footer=record;
    }
    need(header&&footer&&!current,'GRID_PROCEDURE_ARCHIVE_INCOMPLETE','The whole original archive was not received.');
    await original.unchanged();
    need(compressedBytes===expectedBytes&&compressedHash.digest('hex')===expectedSha256,
      'GRID_PROCEDURE_ARCHIVE_IDENTITY','The selected archive changed during reception.',409);
    await syncDirectory(outputDirectory);
    const received=await readGridFabricProcedureCapture(outputDirectory);
    need(received.receipt.sha256===header.capture_sha256&&
      same([...received.capture.members,{path:'capture.json',bytes:received.receipt.bytes,sha256:received.receipt.sha256}],roster),
      'GRID_PROCEDURE_ARCHIVE_ROSTER','The complete archive differs from the original native capture roster.');
    return {...received,archive:{schema:GRID_PROCEDURE_ARCHIVE_SCHEMA,...observed,members:count,expanded_bytes:total}};
  }finally{
    input.destroy();gunzip.destroy();
    try{if(handle)await handle.close();}finally{await original.handle.close();}
  }
}
