// MIT. Exact native workspace ZIP receiving in the existing merchant export directory.
import {constants} from 'node:fs';
import {open,lstat,mkdir,link,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='stellar-forge.openfema-retained-workspace-archive.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^workspace-[a-f0-9]{24}$/,SHA=/^[a-f0-9]{64}$/;
const OP=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX=1024*1024*1024;
const fail=(code,message)=>Object.assign(new Error(message),{code:'OPENFEMA_MCP_ARCHIVE_'+code});
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function workspaceArchiveId(workspaceId,operationId){
  if(!UUID.test(workspaceId??'')||!OP.test(operationId??''))throw fail('IDENTITY','Retain the original workspace and operation identity.');
  return 'workspace-'+hash(workspaceId+'\0'+operationId).slice(0,24);
}
async function directory(root){
  const selected=join(root,'workspace-archives');
  await mkdir(selected,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await lstat(selected);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&((stat.mode&0o077)||stat.uid!==process.getuid()))
    throw fail('DIRECTORY','Use this merchant’s original owned private archive receiving directory.');
  return selected;
}
async function owned(path,max){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat({bigint:true});
    if(!stat.isFile()||stat.size>BigInt(max)||process.platform!=='win32'&&((Number(stat.mode)&0o077)||Number(stat.uid)!==process.getuid()))
      throw fail('FILE','Use the complete owned private archive file.');
    return {handle,stat};
  }catch(error){await handle.close();throw error;}
}
async function json(path){
  const {handle,stat}=await owned(path,65536);
  try{
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    if(BigInt(bytes.length)!==stat.size||stat.size!==after.size||stat.mtimeNs!==after.mtimeNs||stat.ctimeNs!==after.ctimeNs)
      throw fail('CHANGED','The retained archive identity changed during receiving.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{await handle.close();}
}
async function optional(path){try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function writeOnce(path,value){
  const temporary=path+'.'+randomUUID()+'.partial';let handle,complete=false;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();await handle.close();handle=null;complete=true;
    try{await link(temporary,path);}catch(error){if(error.code==='EEXIST')return false;throw error;}
    await syncDirectory(dirname(path));return true;
  }finally{await handle?.close().catch(()=>{});if(complete)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function checked(record,{workspaceId,id},state){
  if(!plain(record)||record.schema!==SCHEMA||record.state!==state||record.id!==id||record.workspaceId!==workspaceId||
    workspaceArchiveId(workspaceId,record.operationId)!==id||!Number.isSafeInteger(record.revision)||record.revision<0||
    !plain(record.file)||record.file.name!=='OpenFEMA_Complete_Workspace.zip'||record.file.type!=='application/zip'||
    !SHA.test(record.file.sha256??'')||!Number.isSafeInteger(record.file.bytes)||record.file.bytes<22||record.file.bytes>MAX)
    throw fail('IDENTITY','Keep the exact retained original workspace archive and receiving operation.');
  return record;
}
function sameFile(a,b){return a.sha256===b.sha256&&a.bytes===b.bytes&&a.name===b.name&&a.type===b.type;}
async function verifiedHandle(path,file){
  const {handle,stat}=await owned(path,MAX);
  try{
    if(stat.size!==BigInt(file.bytes))throw fail('CHANGED','The archive differs from its complete original byte count.');
    const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<file.bytes){
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,file.bytes-offset),offset);
      if(!bytesRead)throw fail('CHANGED','The retained original archive ended early.');
      digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    const after=await handle.stat({bigint:true});
    if(stat.size!==after.size||stat.mtimeNs!==after.mtimeNs||stat.ctimeNs!==after.ctimeNs||digest.digest('hex')!==file.sha256)
      throw fail('CHANGED','The complete original archive changed after receiving.');
    return handle;
  }catch(error){await handle.close();throw error;}
}
async function syncDirectory(path){const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await handle.sync();}finally{await handle.close();}}
export async function readRetainedWorkspaceArchive({directory:root,workspaceId,id}){
  if(!ID.test(id??'')||!UUID.test(workspaceId??''))throw fail('IDENTITY','Choose an original retained workspace archive.');
  const dir=await directory(root),record=await optional(join(dir,id+'.json'));
  if(!record)throw fail('MISSING','Select a completed archive from the original workspace.export result.');
  return checked(record,{workspaceId,id},'COMPLETE');
}
export async function openRetainedWorkspaceArchive(options){
  const record=await readRetainedWorkspaceArchive(options);
  if(options.expectedSha256!==undefined&&record.file.sha256!==options.expectedSha256)throw fail('CHANGED','Keep the selected original archive SHA256.');
  const dir=await directory(options.directory),handle=await verifiedHandle(join(dir,record.id+'.zip'),record.file);
  return {readonlyFileHandle:handle,...record.file};
}
/** prepare and fetchArchive use the already UUID-checked original local service. */
export async function retainWorkspaceArchive({directory:root,workspaceId,operationId,revision,prepare,fetchArchive}){
  const id=workspaceArchiveId(workspaceId,operationId),dir=await directory(root),identity={workspaceId,id};
  const recordPath=join(dir,id+'.json'),pendingPath=join(dir,id+'.pending.json'),archivePath=join(dir,id+'.zip');
  const complete=await optional(recordPath);
  if(complete)return checked(complete,identity,'COMPLETE');
  let pending=await optional(pendingPath);
  if(pending)checked(pending,identity,'RECEIVING');
  if(pending){
    try{
      const retained=await verifiedHandle(archivePath,pending.file);await retained.close();
      const recovered={...pending,state:'COMPLETE',receivedAt:new Date().toISOString()};
      await writeOnce(recordPath,recovered);await syncDirectory(dir);
      return checked(await json(recordPath),identity,'COMPLETE');
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const expectedRevision=pending?.revision??revision;
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw fail('REVISION','Choose the original returned workspace revision.');
  const prepared=await prepare(expectedRevision),item=prepared?.item;
  if(!plain(prepared)||typeof prepared.url!=='string'||!/^\/api\/download\/[a-f0-9]{48}$/.test(prepared.url)||!plain(item)||
    item.name!=='OpenFEMA_Complete_Workspace.zip'||item.type!=='application/zip'||item.revision!==expectedRevision||
    !SHA.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<22||item.bytes>MAX)
    throw fail('SOURCE','The original service did not return this complete workspace archive identity.');
  const next={schema:SCHEMA,state:'RECEIVING',id,workspaceId,operationId,revision:expectedRevision,
    file:{name:item.name,type:item.type,bytes:item.bytes,sha256:item.sha256},preparedAt:new Date().toISOString(),
    receiving:'Original native workspace ZIP; use the original openfema restore command after complete-file receiving.'};
  if(pending&&!sameFile(pending.file,next.file))throw fail('CHANGED','The pending archive differs from the current native snapshot. Preserve its receiving identity and request a new archive operation for a changed workspace.');
  if(!pending){
    await writeOnce(pendingPath,next);pending=checked(await json(pendingPath),identity,'RECEIVING');
    if(pending.revision!==next.revision||!sameFile(pending.file,next.file))throw fail('CHANGED','This archive operation already selected another native snapshot.');
  }
  const response=await fetchArchive(prepared.url);
  if(response.status!==200||response.headers.get('x-content-sha256')!==pending.file.sha256||
    response.headers.get('content-length')!==String(pending.file.bytes)){
    await response.body?.cancel().catch(()=>{});
    throw fail('SOURCE','The original archive response differs from its reviewed complete-file manifest.');
  }
  const partial=join(dir,'.'+id+'-'+randomUUID()+'.partial');let writer,verified=false;
  try{
    writer=await open(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const digest=createHash('sha256');let bytes=0;
    for await(const part of response.body??[]){
      const chunk=Buffer.from(part);bytes+=chunk.length;
      if(bytes>pending.file.bytes)throw fail('CHANGED','The original archive exceeds its declared byte count.');
      digest.update(chunk);let offset=0;
      while(offset<chunk.length){const written=await writer.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw fail('WRITE','Archive receiving did not advance.');offset+=written.bytesWritten;}
    }
    if(bytes!==pending.file.bytes||digest.digest('hex')!==pending.file.sha256)throw fail('CHANGED','The original archive is incomplete or changed.');
    await writer.sync();await writer.close();writer=null;verified=true;
    await link(partial,archivePath).catch(async error=>{if(error.code!=='EEXIST')throw error;const retained=await verifiedHandle(archivePath,pending.file);await retained.close();});
    await writeOnce(recordPath,{...pending,state:'COMPLETE',receivedAt:new Date().toISOString()});await syncDirectory(dir);
    return checked(await json(recordPath),identity,'COMPLETE');
  }finally{
    await writer?.close().catch(()=>{});
    if(verified)await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
