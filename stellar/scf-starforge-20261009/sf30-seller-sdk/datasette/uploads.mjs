// MIT. Bounded archive intake owned by the original Datasette retained-file authority.
import {constants} from 'node:fs';
import {open, mkdir, readdir, lstat, link, unlink} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {absolute, privateDirectory, readPrivate, atomicJson, bytes, fault, stamp} from '../postgres/publisher/files.mjs';

export const DATASETTE_UPLOAD_SCHEMA='stellar-forge.datasette-upload.v1';
export const DATASETTE_UPLOAD_MAX_BYTES=2*1024*1024*1024;
export const DATASETTE_UPLOAD_MAX_CHUNK_BYTES=8*1024*1024;
const MAX_RECORD_BYTES=8*1024*1024,MAX_CHUNKS=32768;
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const emptyHash=digest(Buffer.alloc(0));
const same=(a,b)=>['uploadId','name','bytes','sha256'].every(key=>a[key]===b[key])&&Object.keys(a).length===4&&Object.keys(b).length===4;
function fail(code,message,details,status=409){
  const error=fault('DATASETTE_UPLOAD_'+code,message,status);
  if(details)error.details=details;
  throw error;
}
function decimal(value,label,maximum=DATASETTE_UPLOAD_MAX_BYTES){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>maximum)
    fail('INPUT_INVALID','Use canonical decimal text for '+label+'.',null,400);
  return Number(value);
}
function uploadId(value){
  if(typeof value!=='string'||!UUID.test(value))fail('INPUT_INVALID','Use the original lower-case upload UUID.',null,400);
  return value;
}
function originalName(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>240||value==='.'||value==='..'||
    /[\\/\u0000-\u001f\u007f]/.test(value)||value.endsWith('.lock')||value.endsWith('.sock')||
    value.endsWith('.pid')||value.endsWith('-shm')||value.endsWith('-wal')||value.startsWith('.source-archive-stage-'))
    fail('INPUT_INVALID','Use the original retained file basename.',null,400);
  return value;
}
function declaration(input){
  if(!plain(input)||Object.keys(input).some(key=>!['uploadId','name','bytes','sha256','offset','length'].includes(key)))
    fail('INPUT_INVALID','Use the complete declared upload and byte range.',null,400);
  const request={uploadId:uploadId(input.uploadId),name:originalName(input.name),bytes:input.bytes,sha256:input.sha256};
  decimal(request.bytes,'the complete original file size');
  if(!HASH.test(request.sha256??''))fail('INPUT_INVALID','Use the reviewed complete file SHA-256.',null,400);
  const offset=decimal(input.offset,'the original byte offset'),length=decimal(input.length,'the request byte length',DATASETTE_UPLOAD_MAX_CHUNK_BYTES);
  if(offset+length>Number(request.bytes))fail('INPUT_INVALID','The original byte range must fit the declared file.',null,400);
  return {request,offset,length};
}
const signature=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs,info.mode,info.nlink].join(':');
function privateFile(info,links=1){
  if(!info.isFile()||(info.mode&0o077n)!==0n||info.nlink!==BigInt(links)||info.size>BigInt(DATASETTE_UPLOAD_MAX_BYTES))
    fail('PRIVATE_FILE_REQUIRED','The original upload must remain a private regular file.');
}
async function exists(path){try{return await lstat(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}
}
async function hashPrefix(handle,count){
  const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;
  while(offset<count){const part=await handle.read(buffer,0,Math.min(buffer.length,count-offset),offset);
    if(!part.bytesRead)fail('SOURCE_CHANGED','The durable upload prefix is missing.');
    hash.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;}
  return hash;
}
function validRecord(value,workspaceId,id){
  if(!plain(value)||value.schema!==DATASETTE_UPLOAD_SCHEMA||value.workspaceId!==workspaceId||
    !plain(value.request)||value.request.uploadId!==id||!['RECEIVING','COMPLETE','REJECTED'].includes(value.state)||
    !Array.isArray(value.chunks)||value.chunks.length>MAX_CHUNKS)
    fail('RECORD_INVALID','Read the original upload declaration and complete prefix checkpoint.');
  declaration({...value.request,offset:value.receivedBytes,length:'0'});
  if(!HASH.test(value.prefixSha256??''))fail('RECORD_INVALID','The original prefix must retain its exact hash.');
  let offset=0;
  for(const chunk of value.chunks){
    const at=decimal(chunk.offset,'a retained chunk offset'),length=decimal(chunk.length,'a retained chunk length',DATASETTE_UPLOAD_MAX_CHUNK_BYTES);
    if(at!==offset||length===0||!HASH.test(chunk.sha256??''))fail('RECORD_INVALID','The original chunk history must be complete and ordered.');
    offset+=length;
  }
  if(offset!==Number(value.receivedBytes)||offset>Number(value.request.bytes)||
    offset===0&&value.prefixSha256!==emptyHash||
    value.state==='COMPLETE'&&(offset!==Number(value.request.bytes)||value.prefixSha256!==value.request.sha256))
    fail('RECORD_INVALID','The saved byte prefix differs from the complete original chunk history.');
  return value;
}

/**
 * This helper has no workspace lease and opens no alternate archive engine.
 * The original workspace must include receive() in its existing active-operation
 * gate and abort/drain it before close. status() is an ordinary original read.
 */
export function retainedDatasetteUploads({directory,workspaceId,inspect}){
  directory=absolute(directory,'Datasette workspace directory');
  if(typeof workspaceId!=='string'||!workspaceId||typeof inspect!=='function')
    throw new TypeError('Use the original retained-file owner and its inspector.');
  let closed=false,tail=Promise.resolve();
  const hashes=new Map();
  function paths(id,name){
    const root=join(directory,'imports','uploads',uploadId(id));
    return {root,record:join(root,'upload.json'),partial:join(root,'payload.part'),
      fileDirectory:join(root,'file'),file:name?join(root,'file',originalName(name)):null};
  }
  async function ensure(paths){
    await privateDirectory(directory,false);
    let current=directory;
    for(const part of ['imports','uploads',paths.root.split(sep).at(-1),'file']){
      current=join(current,part);await mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await privateDirectory(current,false);
    }
  }
  async function load(id){
    const path=paths(id);
    let raw;try{
      await privateDirectory(directory,false);
      for(const ancestor of [join(directory,'imports'),join(directory,'imports','uploads'),path.root])
        await privateDirectory(ancestor,false);
      raw=await readPrivate(path.record,MAX_RECORD_BYTES);
    }catch(error){
      if(error.code==='ENOENT')fail('NOT_FOUND','This original upload ID has no retained declaration.',{uploadId:id},404);
      throw error;
    }
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{fail('RECORD_INVALID','Read the complete original upload record.');}
    const record=validRecord(value,workspaceId,id);
    try{await privateDirectory(paths(id,record.request.name).fileDirectory,false);}
    catch(error){if(error.code==='ENOENT')fail('SOURCE_CHANGED','The original upload file directory is missing.');throw error;}
    return record;
  }
  async function save(paths,record){
    validRecord(record,workspaceId,record.request.uploadId);
    if(bytes(record).length>MAX_RECORD_BYTES)fail('RECORD_LIMIT','The complete upload checkpoint exceeds 8 MiB.');
    await atomicJson(paths.root,'upload.json',record);
  }
  async function payload(paths,record,{write=false,create=false}={}){
    const partial=await exists(paths.partial),final=await exists(paths.file);
    let path=partial?paths.partial:final?paths.file:null,links=1;
    if(partial&&final){
      if(partial.dev!==final.dev||partial.ino!==final.ino||record.state==='COMPLETE'||
        record.receivedBytes!==record.request.bytes||record.prefixSha256!==record.request.sha256)
        fail('DESTINATION_CONFLICT','The completed upload destination has unrelated bytes.');
      links=2;
    }
    if(!path&&create){
      const handle=await open(paths.partial,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      return {handle,path:paths.partial,info:await handle.stat({bigint:true}),links:1};
    }
    if(!path){
      if(record.receivedBytes==='0'&&record.state==='RECEIVING')return null;
      fail('SOURCE_CHANGED','The retained upload bytes are missing.');
    }
    if(final&&!partial&&record.state!=='COMPLETE'&&
      (record.receivedBytes!==record.request.bytes||record.prefixSha256!==record.request.sha256))
      fail('DESTINATION_CONFLICT','An incomplete upload cannot already own a complete destination.');
    const handle=await open(path,(write?constants.O_RDWR:constants.O_RDONLY)|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const info=await handle.stat({bigint:true});privateFile(info,links);
      const named=path===paths.partial?partial:final;
      if(named&&(named.dev!==info.dev||named.ino!==info.ino))fail('SOURCE_CHANGED','The original upload inode changed.');
      if(info.size<BigInt(record.receivedBytes))fail('SOURCE_CHANGED','The durable uploaded byte prefix is missing.');
      return {handle,path,info,links};
    }catch(error){await handle.close();throw error;}
  }
  async function prefix(opened,record){
    if(!opened){
      if(record.receivedBytes!=='0')fail('SOURCE_CHANGED','The saved upload prefix is missing.');
      return createHash('sha256');
    }
    const cached=hashes.get(record.request.uploadId);
    let hash=cached&&cached.signature===signature(opened.info)&&cached.bytes===record.receivedBytes&&
      cached.sha256===record.prefixSha256?cached.hash.copy():await hashPrefix(opened.handle,Number(record.receivedBytes));
    if(hash.copy().digest('hex')!==record.prefixSha256)fail('SOURCE_CHANGED','The durable upload prefix differs from its checkpoint.');
    const after=await opened.handle.stat({bigint:true});
    if(signature(after)!==signature(opened.info))fail('SOURCE_CHANGED','The original upload changed during prefix verification.');
    return hash;
  }
  async function view(record,{verify=true}={}){
    const path=paths(record.request.uploadId,record.request.name);let opened;
    try{
      opened=await payload(path,record);
      if(verify)await prefix(opened,record);
      const extra=opened?opened.info.size-BigInt(record.receivedBytes):0n;
      const finalizable=record.state==='RECEIVING'&&record.receivedBytes===record.request.bytes&&record.prefixSha256===record.request.sha256;
      const result={schema:DATASETTE_UPLOAD_SCHEMA,workspaceId,uploadId:record.request.uploadId,
        state:finalizable?'FINALIZABLE':record.state,name:record.request.name,bytes:record.request.bytes,sha256:record.request.sha256,
        receivedBytes:record.receivedBytes,prefixSha256:record.prefixSha256,uncheckpointedBytes:extra.toString(),
        chunks:record.chunks.length,maximumChunkBytes:String(DATASETTE_UPLOAD_MAX_CHUNK_BYTES),
        createdAt:record.createdAt,updatedAt:record.updatedAt,
        ...(record.error?{error:record.error}:{})};
      if(record.state==='COMPLETE'){
        if(extra!==0n||!opened||opened.path!==path.file)fail('SOURCE_CHANGED','The completed original upload changed.');
        const relativeName=path.file.slice(directory.length+1).split(sep).join('/');
        const file=await inspect({path:relativeName,sha256:record.request.sha256});
        if(file.bytes!==record.request.bytes)fail('SOURCE_CHANGED','The original uploaded file size changed.');
        result.archiveFile=path.file;result.retainedFile=file;result.completedAt=record.completedAt;
      }
      return result;
    }finally{if(opened)await opened.handle.close();}
  }
  async function consume(stream,length,{signal,onChunk}={}){
    if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
      fail('INPUT_INVALID','Supply the original raw request byte stream.',null,400);
    let count=0;const hash=createHash('sha256');
    for await(const value of stream){
      signal?.throwIfAborted();
      if(!(value instanceof Uint8Array))fail('INPUT_INVALID','The original upload stream must contain raw bytes.',null,400);
      const part=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
      if(part.length>DATASETTE_UPLOAD_MAX_CHUNK_BYTES||count+part.length>length)
        fail('RANGE_LENGTH','The request body exceeds the declared original chunk length.',null,400);
      await onChunk?.(part,count);hash.update(part);count+=part.length;
    }
    signal?.throwIfAborted();
    if(count!==length)fail('RANGE_LENGTH','The full original chunk was not received.',{receivedBytes:String(count),expectedBytes:String(length)},400);
    return hash.digest('hex');
  }
  async function finish(path,record){
    if(record.receivedBytes!==record.request.bytes||record.prefixSha256!==record.request.sha256)
      fail('COMPLETE_HASH','The complete original upload hash must match before publication.');
    const opened=await payload(path,record);
    if(!opened)fail('SOURCE_CHANGED','The complete upload bytes are missing.');
    try{
      await prefix(opened,record);
      if(opened.info.size!==BigInt(record.request.bytes))fail('SOURCE_CHANGED','The complete original upload has an uncheckpointed suffix.');
    }finally{await opened.handle.close();}
    if(await exists(path.partial)){
      try{await link(path.partial,path.file);}catch(error){
        if(error.code!=='EEXIST')throw error;
        const a=await lstat(path.partial,{bigint:true}),b=await lstat(path.file,{bigint:true});
        if(a.dev!==b.dev||a.ino!==b.ino)fail('DESTINATION_CONFLICT','The uploaded file destination already has unrelated bytes.');
      }
      await syncDirectory(path.fileDirectory);
      const a=await lstat(path.partial,{bigint:true}),b=await lstat(path.file,{bigint:true});
      if(a.dev!==b.dev||a.ino!==b.ino)fail('DESTINATION_CONFLICT','The original staged upload changed before publication.');
      await unlink(path.partial);await syncDirectory(path.root);
    }
    const file=await inspect({path:path.file.slice(directory.length+1).split(sep).join('/'),sha256:record.request.sha256});
    if(file.bytes!==record.request.bytes)fail('SOURCE_CHANGED','The published upload has an unexpected size.');
    record.state='COMPLETE';record.completedAt=record.completedAt??stamp();record.updatedAt=record.completedAt;
    await save(path,record);hashes.delete(record.request.uploadId);
    return view(record);
  }
  async function receive(input,stream,{signal}={}){
    signal?.throwIfAborted();
    const selected=declaration(input),path=paths(selected.request.uploadId,selected.request.name);
    let record;
    try{record=await load(selected.request.uploadId);}catch(error){
      if(error.code!=='DATASETTE_UPLOAD_NOT_FOUND')throw error;
      await ensure(path);
      if(await exists(path.partial)||(await readdir(path.fileDirectory)).length)
        fail('DECLARATION_MISSING','Retain the original upload declaration before receiving its existing bytes.');
      record={schema:DATASETTE_UPLOAD_SCHEMA,workspaceId,request:selected.request,state:'RECEIVING',
        receivedBytes:'0',prefixSha256:emptyHash,chunks:[],createdAt:stamp(),updatedAt:stamp()};
      await save(path,record);
    }
    if(!same(record.request,selected.request))fail('REQUEST_CONFLICT','This original upload ID already binds a different file.',{uploadId:selected.request.uploadId});
    if(record.state==='REJECTED')return {...await view(record),replayed:true};
    const prior=record.chunks.find(chunk=>Number(chunk.offset)===selected.offset&&Number(chunk.length)===selected.length);
    if(selected.offset<Number(record.receivedBytes)){
      if(!prior)fail('OFFSET','Use the original committed prefix or an exact saved chunk.',{uploadId:selected.request.uploadId,receivedBytes:record.receivedBytes});
      const hash=await consume(stream,selected.length,{signal});
      if(hash!==prior.sha256)fail('REQUEST_CONFLICT','The repeated original chunk has different bytes.',{uploadId:selected.request.uploadId,offset:input.offset});
      return {...await view(record),replayed:true};
    }
    if(record.state==='COMPLETE'){
      if(selected.offset!==Number(record.receivedBytes)||selected.length!==0)
        fail('OFFSET','The original upload is already complete.',{uploadId:selected.request.uploadId,receivedBytes:record.receivedBytes});
      await consume(stream,0,{signal});return {...await view(record),replayed:true};
    }
    if(selected.offset!==Number(record.receivedBytes))
      fail('OFFSET','Continue from the durable original byte prefix.',{uploadId:selected.request.uploadId,receivedBytes:record.receivedBytes});
    if(selected.length===0&&selected.offset!==Number(record.request.bytes))
      fail('RANGE_LENGTH','A zero-byte finalization is available only after the complete original file.',null,400);
    if(selected.length>0&&record.chunks.length>=MAX_CHUNKS)
      fail('CHUNK_LIMIT','The original upload has reached its 32,768-chunk checkpoint limit.');
    let opened;
    try{
      opened=await payload(path,record,{write:true,create:true});
      const hash=await prefix(opened,record);
      if(opened.info.size>BigInt(record.receivedBytes)){
        if(opened.path!==path.partial||opened.links!==1)fail('SOURCE_CHANGED','Only the original uncheckpointed partial suffix can be removed.');
        await opened.handle.truncate(Number(record.receivedBytes));await opened.handle.sync();
      }
      const partHash=await consume(stream,selected.length,{signal,onChunk:async(part,offset)=>{
        let written=0;
        while(written<part.length){
          const value=await opened.handle.write(part,written,part.length-written,selected.offset+offset+written);
          if(!value.bytesWritten)fail('WRITE_FAILED','The original upload byte range could not advance.');
          written+=value.bytesWritten;
        }
        hash.update(part);
      }});
      await opened.handle.sync();
      record.receivedBytes=String(selected.offset+selected.length);record.prefixSha256=hash.copy().digest('hex');record.updatedAt=stamp();
      if(selected.length>0)record.chunks.push({offset:String(selected.offset),length:String(selected.length),sha256:partHash});
      if(record.receivedBytes===record.request.bytes&&record.prefixSha256!==record.request.sha256){
        record.state='REJECTED';record.error={code:'DATASETTE_UPLOAD_COMPLETE_HASH',
          reason:'The complete received bytes do not match the reviewed original file SHA-256.',actualSha256:record.prefixSha256};
      }
      await save(path,record);
      const after=await opened.handle.stat({bigint:true});
      if(hashes.size>=4&&!hashes.has(record.request.uploadId))hashes.delete(hashes.keys().next().value);
      hashes.set(record.request.uploadId,{hash:hash.copy(),signature:signature(after),bytes:record.receivedBytes,sha256:record.prefixSha256});
      await opened.handle.close();opened=null;
      if(record.state==='REJECTED')return view(record);
      if(record.receivedBytes===record.request.bytes)return finish(path,record);
      return view(record);
    }catch(error){hashes.delete(record.request.uploadId);throw error;}
    finally{if(opened)await opened.handle.close();}
  }
  function queued(action){
    if(closed)throw fault('DATASETTE_UPLOADS_CLOSING','The original file authority is closing.',409);
    const pending=tail.then(action);tail=pending.catch(()=>{});return pending;
  }
  return Object.freeze({
    status(input={}){
      if(!plain(input)||Object.keys(input).some(key=>key!=='uploadId'))fail('INPUT_INVALID','Select the original upload UUID.',null,400);
      const id=uploadId(input.uploadId);return queued(async()=>view(await load(id)));
    },
    receive(input,stream,options={}){return queued(()=>receive(input,stream,options));},
    async close(){closed=true;await tail;hashes.clear();},
  });
}
