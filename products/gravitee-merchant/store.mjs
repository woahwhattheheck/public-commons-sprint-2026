// SPDX-License-Identifier: MIT
import { mkdir, readdir, open, link, unlink, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, operationLease, saveJSON, regular } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { SCHEMA, sha256, hashJSON, requireValue, copy } from './contract.mjs';
export const KINDS = ['connection','source','draft','capture','operation','commissioning','request','handover','note'];
const ID = /^[a-f0-9]{24}$/;
export const idFor = value => sha256(String(value)).slice(0,24);
export const freshId = () => idFor(randomUUID());
export const validRequestId = value => requireValue(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), 'REQUEST_ID_REQUIRED', 'Use one UUID for the original request, including reconnects.');
const validId = value => requireValue(typeof value === 'string' && ID.test(value), 'RECORD_ID_INVALID');
async function readValue(path) { return JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(await regular(path,512*1024*1024))); }
async function privateChild(path) { try { await mkdir(path,{ mode:0o700 }); } catch(error) { if(error.code !== 'EEXIST')throw error; } await privateDirectory(path); return path; }
export async function writeImmutableBytes(path, bytes) {
  const temp = path + '.pending-' + randomUUID(), handle = await open(temp,'wx',0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp,path); } catch(error) {
    if(error.code !== 'EEXIST')throw error;
    requireValue(sha256(await regular(path,512*1024*1024)) === sha256(bytes),'IMMUTABLE_OBJECT_COLLISION','The saved file differs from its original immutable bytes: '+path);
  } finally { await unlink(temp); }
  const parent = await open(dirname(path),'r'); try { await parent.sync(); } finally { await parent.close(); }
}
export async function openGraviteeStore(directory) {
  requireValue(typeof directory === 'string' && directory === resolve(directory),'ABSOLUTE_WORKSPACE_REQUIRED');
  await privateChild(directory);
  for(const path of ['objects','records','journals','exports'])await privateChild(join(directory,path));
  const leasePath = join(directory,'writer.lock');
  let locked = false, closed = false;
  async function exclusive(fn) {
    requireValue(!closed,'WORKSPACE_CLOSED');
    const lease = await operationLease(leasePath);
    requireValue(!locked,'WORKSPACE_WRITE_REENTRY');
    locked = true;
    try { return await fn(); } finally { locked=false; await lease.close(); }
  }
  let identity;
  await exclusive(async()=>{
    const identityPath=join(directory,'workspace.json');
    try { identity=await readValue(identityPath); }
    catch(error){ if(error.code !== 'ENOENT')throw error; identity={ schema:SCHEMA,workspaceId:randomUUID(),createdAt:new Date().toISOString() };await saveJSON(identityPath,identity); }
    requireValue(identity.schema===SCHEMA && typeof identity.workspaceId==='string','WORKSPACE_FORMAT_INVALID');
    try { await readValue(join(directory,'heads.json')); }
    catch(error) { if(error.code !== 'ENOENT')throw error;await saveJSON(join(directory,'heads.json'),{ schema:SCHEMA,heads:[] }); }
  });
  const assertWriter=()=>requireValue(locked,'ORIGINAL_WORKSPACE_WRITER_REQUIRED');
  const heads=async()=>{const value=await readValue(join(directory,'heads.json'));requireValue(value.schema===SCHEMA&&Array.isArray(value.heads),'WORKSPACE_HEADS_INVALID');return value.heads;};
  async function putBytes(bytes) {
    assertWriter(); requireValue(Buffer.isBuffer(bytes)&&bytes.length<=512*1024*1024,'OBJECT_SIZE_INVALID');
    const sha=sha256(bytes);await writeImmutableBytes(join(directory,'objects',sha),bytes);return{sha256:sha,bytes:bytes.length};
  }
  const putJSON=value=>putBytes(Buffer.from(JSON.stringify(value)));
  async function putExport(bytes){assertWriter();requireValue(Buffer.isBuffer(bytes)&&bytes.length<=512*1024*1024,'HANDOVER_SIZE_INVALID','This receiving file exceeds the 512 MiB complete-file limit. The original workspace and history remain available in its directory.');const sha=sha256(bytes);await writeImmutableBytes(join(directory,'exports',sha),bytes);return{sha256:sha,bytes:bytes.length};}
  async function getBytes(reference) {
    requireValue(reference&&/^[a-f0-9]{64}$/.test(reference.sha256)&&Number.isSafeInteger(reference.bytes),'OBJECT_REFERENCE_INVALID');
    let bytes;try{bytes=await regular(join(directory,'objects',reference.sha256),512*1024*1024);}catch(error){if(error.code!=='ENOENT')throw error;bytes=await regular(join(directory,'exports',reference.sha256),512*1024*1024);}
    requireValue(bytes.length===reference.bytes&&sha256(bytes)===reference.sha256,'RETAINED_OBJECT_CHANGED');
    return bytes;
  }
  const getJSON=async reference=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await getBytes(reference)));
  async function get(kind,id,revision) {
    requireValue(KINDS.includes(kind),'RECORD_KIND_INVALID');validId(id);
    const head=(await heads()).find(x=>x.kind===kind&&x.id===id);
    requireValue(head,'RECORD_NOT_FOUND',kind+' '+id+' is absent.',404);
    const selected=revision??head.revision;requireValue(Number.isSafeInteger(selected)&&selected>0&&selected<=head.revision,'RECORD_REVISION_INVALID');
    const record=await readValue(join(directory,'records',kind,id,String(selected).padStart(8,'0')+'.json'));
    const {sha256:saved,...unsigned}=record;requireValue(hashJSON(unsigned)===saved,'RECORD_CHANGED');
    return record;
  }
  async function maybe(kind,id) {try{return await get(kind,id);}catch(error){if(error.code==='RECORD_NOT_FOUND')return null;throw error;}}
  async function save(kind,value,{id=freshId(),expectedRevision=0}={}) {
    assertWriter();requireValue(KINDS.includes(kind),'RECORD_KIND_INVALID');validId(id);
    const current=await heads(),previous=current.find(x=>x.kind===kind&&x.id===id);
    requireValue((previous?.revision??0)===expectedRevision,'RECORD_REVISION_CHANGED','This record has a newer revision; reopen it before saving.',409);
    const folder=join(directory,'records',kind,id);
    await privateChild(join(directory,'records',kind));await privateChild(folder);
    const stamp=new Date().toISOString(),unsigned={schema:SCHEMA,kind,id,revision:expectedRevision+1,
      createdAt:previous?.createdAt??stamp,updatedAt:stamp,previousSha256:previous?.sha256??null,value:copy(value)},record={...unsigned,sha256:hashJSON(unsigned)};
    await saveJSON(join(folder,String(record.revision).padStart(8,'0')+'.json'),record);
    const head={kind,id,revision:record.revision,sha256:record.sha256,createdAt:record.createdAt,updatedAt:record.updatedAt};
    await saveJSON(join(directory,'heads.json'),{schema:SCHEMA,heads:[...current.filter(x=>x.kind!==kind||x.id!==id),head]},true);
    return record;
  }
  const revise=(record,value)=>save(record.kind,value,{id:record.id,expectedRevision:record.revision});
  async function append(operationId,event) {
    assertWriter();validId(operationId);
    const folder=join(directory,'journals',operationId);await privateChild(folder);
    const names=(await readdir(folder)).filter(x=>/^\d{8}\.json$/.test(x)).sort();
    const sequence=names.length+1, prior=names.length?await readValue(join(folder,names.at(-1))):null;
    const unsigned={sequence,at:new Date().toISOString(),previousSha256:prior?.sha256??null,event:copy(event)};
    const value={...unsigned,sha256:hashJSON(unsigned)};
    await saveJSON(join(folder,String(sequence).padStart(8,'0')+'.json'),value);return value;
  }
  async function journal(id) {
    validId(id);const folder=join(directory,'journals',id);let names;
    try{names=(await readdir(folder)).filter(x=>/^\d{8}\.json$/.test(x)).sort();}catch(error){if(error.code==='ENOENT')return[];throw error;}
    const records=[];let prior=null;
    for(const name of names){const value=await readValue(join(folder,name)),{sha256:saved,...unsigned}=value;
      requireValue(hashJSON(unsigned)===saved&&value.previousSha256===prior&&value.sequence===records.length+1,'JOURNAL_CHANGED');
      records.push(value);prior=saved;}
    return records;
  }
  async function list({kind,offset=0,limit=100}={}) {
    requireValue(!kind||KINDS.includes(kind),'RECORD_KIND_INVALID');requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=500,'RECORD_PAGE_INVALID');
    const all=(await heads()).filter(x=>!kind||x.kind===kind).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const selected=all.slice(offset,offset+limit),items=[];
    for(const item of selected)items.push(await get(item.kind,item.id,item.revision));
    return{items,total:all.length,offset,limit,nextOffset:offset+items.length<all.length?offset+items.length:null};
  }
  async function snapshot() {
    assertWriter();const files=[];
    const walk=async relative=>{
      const full=join(directory,relative);
      for(const name of(await readdir(full)).sort()){
        if(name==='writer.lock'||name==='server.lock'||(relative===''&&name==='exports')||name.includes('.pending-'))continue;
        const path=relative?relative+'/'+name:name,absolute=join(directory,path),info=await lstat(absolute);
        requireValue(!info.isSymbolicLink(),'WORKSPACE_SYMLINK_INVALID');
        if(info.isDirectory())await walk(path);
        else {requireValue(info.isFile(),'WORKSPACE_FILE_INVALID');const bytes=await regular(absolute,512*1024*1024);files.push({path,bytes:bytes.length,sha256:sha256(bytes),base64:bytes.toString('base64')});}
      }
    };
    await walk('');return files;
  }
  await exclusive(async()=>{
    const existing=await heads(),recovered=[];
    for(const kind of KINDS){
      let ids;try{ids=await readdir(join(directory,'records',kind));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      for(const id of ids.filter(value=>ID.test(value))){
        const folder=join(directory,'records',kind,id);await privateDirectory(folder);
        const names=(await readdir(folder)).filter(name=>/^\d{8}\.json$/.test(name)).sort();let previous=null;const history=[];
        for(const name of names){
          const record=await readValue(join(folder,name)),{sha256:saved,...unsigned}=record;
          requireValue(record.schema===SCHEMA&&record.kind===kind&&record.id===id&&record.revision===history.length+1&&
            record.previousSha256===(previous?.sha256??null)&&hashJSON(unsigned)===saved,'RECORD_HISTORY_CHANGED');
          previous=record;history.push(record);
        }
        const head=existing.find(value=>value.kind===kind&&value.id===id);
        if(head)requireValue(history[head.revision-1]?.sha256===head.sha256,'RECORD_HEAD_CHANGED');
        if(previous)recovered.push({kind,id,revision:previous.revision,sha256:previous.sha256,createdAt:previous.createdAt,updatedAt:previous.updatedAt});
      }
    }
    requireValue(existing.every(head=>recovered.some(value=>value.kind===head.kind&&value.id===head.id)),'RECORD_HEAD_SOURCE_MISSING');
    const sorted=value=>[...value].sort((a,b)=>(a.kind+'/'+a.id).localeCompare(b.kind+'/'+b.id));
    if(hashJSON(sorted(existing))!==hashJSON(sorted(recovered)))await saveJSON(join(directory,'heads.json'),{schema:SCHEMA,heads:recovered},true);
  });
  return {directory,identity,exclusive,heads,get,maybe,save,revise,list,putBytes,putJSON,putExport,getBytes,getJSON,append,journal,snapshot,close:()=>{closed=true;}};

}
