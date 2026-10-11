// MIT. One local merchant workspace, committed atomically with its report version.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,readFile,mkdir,lstat,realpath,link,unlink,rename,readdir} from 'node:fs/promises';
import {hostname} from 'node:os';
import {join,resolve} from 'node:path';
import {validateSnapshot} from '../longitudinal/analysis.mjs';
import {exportCasebook,reviewFields} from './casebook.mjs';

export const MAX_OBSERVATIONS=128;
export const MAX_SNAPSHOT_BYTES=4*1024*1024;
export const MAX_WORKSPACE_BYTES=64*1024*1024;
export const MAX_AUDIT_EVENTS=1000;
const SCHEMA='disburselens-workspace/v1';
const LOCK_SCHEMA='disburselens-workspace-lock/v1';
const ID=/^[0-9a-f]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stamp=()=>new Date().toISOString();
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function timestamp(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function sha(value){return createHash('sha256').update(value).digest('hex');}
function json(value,limit,label){
  const text=JSON.stringify(value);
  if(typeof text!=='string')fail(label+' must be JSON data');
  if(Buffer.byteLength(text,'utf8')>limit)fail(label+' exceeds its local storage limit; export and remove an older observation before retrying',413);
  return text;
}

/** Capture time participates in identity: repeated observations can establish stalling. */
export function identifyObservation(snapshot){
  json(snapshot,MAX_SNAPSHOT_BYTES,'Source snapshot');
  const {report}=validateSnapshot(snapshot);
  const id=sha(JSON.stringify([snapshot.source,snapshot.capturedAt,report.evidenceHash]));
  return {id,report};
}
export function makeObservation(snapshot,importedAt=stamp()){
  const {id}=identifyObservation(snapshot);
  return {id,importedAt,snapshot:structuredClone(snapshot),cases:{},audit:[],historyDropped:0};
}
export function appendAudit(observation,events){
  observation.audit.push(...events);
  const excess=Math.max(0,observation.audit.length-MAX_AUDIT_EVENTS);
  if(excess){observation.audit.splice(0,excess);observation.historyDropped+=excess;}
}

async function privateFile(path,maxBytes){
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await fd.stat();
    if(!info.isFile()||info.size>maxBytes||(process.platform!=='win32'&&
        ((info.mode&0o077)||(typeof process.getuid==='function'&&info.uid!==process.getuid()))))
      fail('Workspace files must be private regular files owned by this user',503);
    const bytes=await fd.readFile();
    if(bytes.length>maxBytes)fail('Workspace file exceeds its storage limit',503);
    return {bytes,info};
  }finally{await fd.close();}
}
async function syncDirectory(directory){
  if(process.platform==='win32')return;
  const fd=await open(directory,'r');try{await fd.sync();}finally{await fd.close();}
}
async function atomicWrite(directory,text){
  const temporary=join(directory,'.workspace-'+randomUUID()+'.tmp');
  let fd,committed=false;
  try{
    fd=await open(temporary,'wx',0o600);await fd.writeFile(text);await fd.sync();await fd.close();fd=null;
    await rename(temporary,join(directory,'workspace.json'));committed=true;
    await syncDirectory(directory);
  }catch(error){error.committed=committed;throw error;}
  finally{await fd?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}

// The runtime PID may be namespace-local while /proc exposes its parent namespace.
// Compare the addressable procfs identity, including Linux process start ticks.
function processStat(text){
  const pid=Number(/^([1-9]\d*) \(/.exec(text)?.[1]);
  const fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
  if(!Number.isSafeInteger(pid)||pid<1||fields[0]?.length!==1||!/^\d{1,20}$/.test(fields[19]??''))throw new Error('Unrecognized process identity');
  return {pid,state:fields[0],startTicks:fields[19]};
}
async function linuxIdentity(){
  if(process.platform!=='linux')return null;
  try{
    const [selfText,bootText,proc]=await Promise.all([
      readFile('/proc/self/stat','utf8'),readFile('/proc/sys/kernel/random/boot_id','utf8'),lstat('/proc',{bigint:true})
    ]);
    const self=processStat(selfText),bootId=bootText.trim();
    if(!/^[a-f0-9-]{36}$/.test(bootId)||!proc.isDirectory())return null;
    const addressable=processStat(await readFile(`/proc/${self.pid}/stat`,'utf8'));
    if(addressable.pid!==self.pid||addressable.startTicks!==self.startTicks)return null;
    return {procPid:self.pid,startTicks:self.startTicks,bootId,procDevice:String(proc.dev)};
  }catch{return null;}
}
async function liveOwner(owner,current){
  if(owner.host!==current.host)return true;
  const old=owner.processIdentity,local=current.processIdentity;
  if(!old){
    if(process.platform==='linux')return true;
    try{process.kill(owner.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
  }
  if(!local||old.bootId!==local.bootId||old.procDevice!==local.procDevice)return true;
  try{
    const actual=processStat(await readFile(`/proc/${old.procPid}/stat`,'utf8'));
    return actual.pid!==old.procPid||(actual.startTicks===old.startTicks&&!['Z','X','x'].includes(actual.state));
  }catch(error){return !['ENOENT','ESRCH'].includes(error.code);}
}
function lockOwner(bytes){
  let owner;try{owner=JSON.parse(bytes.toString('utf8'));}catch{fail('Unrecognized local workspace lock',503);}
  if(owner?.schema!==LOCK_SCHEMA||typeof owner.host!=='string'||!/^[a-f0-9-]{36}$/.test(owner.token??'')||
      !Number.isSafeInteger(owner.pid)||owner.pid<1)fail('Unrecognized local workspace lock',503);
  const id=owner.processIdentity;
  if(id!=null&&(!Number.isSafeInteger(id.procPid)||id.procPid<1||
      typeof id.startTicks!=='string'||!/^\d{1,20}$/.test(id.startTicks)||
      typeof id.bootId!=='string'||!/^[a-f0-9-]{36}$/.test(id.bootId)||
      typeof id.procDevice!=='string'||!/^\d{1,20}$/.test(id.procDevice)))fail('Unrecognized local workspace process identity',503);
  return owner;
}
async function publishLock(directory,path,owner){
  const temporary=join(directory,'.lock-'+randomUUID()+'.tmp');let fd,published=false;
  try{
    fd=await open(temporary,'wx',0o600);await fd.writeFile(JSON.stringify(owner));await fd.sync();
    const info=await fd.stat();await link(temporary,path);published=true;
    await unlink(temporary);await syncDirectory(directory);return {fd,info};
  }catch(error){
    await fd?.close().catch(()=>{});if(published)await unlink(path).catch(()=>{});
    await unlink(temporary).catch(()=>{});throw error;
  }
}
async function acquireLock(directory){
  const path=join(directory,'.workspace-writer.lock');
  const owner={schema:LOCK_SCHEMA,host:hostname(),pid:process.pid,token:randomUUID(),processIdentity:await linuxIdentity()};
  let recovered=false;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const {fd,info}=await publishLock(directory,path,owner);let released=false;
      return {recovered,async release(){
        if(released)return;released=true;await fd.close();
        const current=await privateFile(path,4096);
        if(current.info.ino!==info.ino||lockOwner(current.bytes).token!==owner.token)fail('Local workspace writer ownership changed',503);
        await unlink(path);await syncDirectory(directory);
      }};
    }catch(error){if(error.code!=='EEXIST')throw error;}
    let previous;try{previous=await privateFile(path,4096);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    const old=lockOwner(previous.bytes);
    if(await liveOwner(old,owner))fail('This workspace is already open in another live or nonlocal process; use that server or a different data directory',409);
    const recoveryPath=join(directory,'.workspace-reclaim-'+old.token+'.lock');let recovery;
    try{recovery=(await publishLock(directory,recoveryPath,owner)).fd;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const pending=await privateFile(recoveryPath,4096),pendingOwner=lockOwner(pending.bytes);
      if(await liveOwner(pendingOwner,owner))fail('Local workspace restart recovery is already running',409);
      const again=await privateFile(recoveryPath,4096);
      if(again.info.ino===pending.info.ino&&lockOwner(again.bytes).token===pendingOwner.token)await unlink(recoveryPath);
      continue;
    }
    try{
      const current=await privateFile(path,4096),currentOwner=lockOwner(current.bytes);
      if(current.info.ino===previous.info.ino&&currentOwner.token===old.token&&!(await liveOwner(currentOwner,owner))){await unlink(path);recovered=true;}
    }catch(error){if(error.code!=='ENOENT')throw error;}
    finally{await recovery.close();await unlink(recoveryPath).catch(()=>{});}
  }
  fail('Workspace ownership changed during startup; retry startup',409);
}

function validateState(value){
  if(!plain(value)||value.schema!==SCHEMA||!Number.isSafeInteger(value.version)||value.version<1||
      !timestamp(value.savedAt)||!ID.test(value.selectedId??'')||!Array.isArray(value.observations)||
      value.observations.length<1||value.observations.length>MAX_OBSERVATIONS)fail('Invalid saved merchant workspace',503);
  const reports=new Map();
  for(const record of value.observations){
    if(!plain(record)||!timestamp(record.importedAt)||!plain(record.cases)||!Array.isArray(record.audit)||
        record.audit.length>MAX_AUDIT_EVENTS||!Number.isSafeInteger(record.historyDropped)||record.historyDropped<0)fail('Invalid saved observation',503);
    const {id,report}=identifyObservation(record.snapshot);
    if(record.id!==id||reports.has(id))fail('Invalid or duplicate saved observation identity',503);
    const cases=new Map(Object.entries(record.cases));
    exportCasebook({result:report,cases,version:value.version});
    for(const review of cases.values())reviewFields(review);
    const ids=new Set(report.items.map(item=>item.caseId));
    for(const event of record.audit){
      if(!plain(event)||!ids.has(event.caseId)||event.evidenceHash!==report.evidenceHash||
          !timestamp(event.at)||!['open','acknowledged','escalated'].includes(event.from)||
          !['open','acknowledged','escalated'].includes(event.to))fail('Invalid saved case history',503);
      reviewFields(event);
    }
    reports.set(id,report);
  }
  if(!reports.has(value.selectedId))fail('Saved selected observation is missing',503);
  return reports;
}

/** All envelopes, triage, audit and selection share a single atomic commit. */
export async function createObservationWorkspace({directory,initialSnapshot}={}){
  let lock=null,state,reports=new Map(),bytes=0,lastError=null,closed=false;
  if(directory!=null){
    if(typeof directory!=='string'||!directory.trim()||directory.includes('\0'))fail('data directory must be a local path');
    directory=resolve(directory);await mkdir(directory,{recursive:true,mode:0o700});
    const info=await lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&
        ((info.mode&0o077)||(typeof process.getuid==='function'&&info.uid!==process.getuid()))))
      fail('Data directory must be a private directory owned by this user (mode 0700)',503);
    directory=await realpath(directory);lock=await acquireLock(directory);
  }
  try{
    if(directory){
      try{
        const loaded=await privateFile(join(directory,'workspace.json'),MAX_WORKSPACE_BYTES);bytes=loaded.bytes.length;
        try{state=JSON.parse(loaded.bytes.toString('utf8'));}catch{fail('Saved workspace is not valid JSON; retain the file for recovery',503);}
        reports=validateState(state);
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(!state){
      const first=makeObservation(initialSnapshot);
      state={schema:SCHEMA,version:1,selectedId:first.id,savedAt:stamp(),observations:[first]};
      reports=validateState(state);const text=json(state,MAX_WORKSPACE_BYTES,'Workspace');bytes=Buffer.byteLength(text);
      if(directory)await atomicWrite(directory,text);
    }
    // A killed writer may leave an unreferenced staged commit. Only remove this
    // module's private temporary files after the committed workspace validates.
    if(directory)for(const name of await readdir(directory)){
      if(!/^\.(workspace|lock)-[a-f0-9-]{36}\.tmp$/.test(name))continue;
      const path=join(directory,name);
      try{await privateFile(path,MAX_WORKSPACE_BYTES);await unlink(path);}catch{/* Preserve anything unfamiliar. */}
    }
  }catch(error){await lock?.release().catch(()=>{});throw error;}
  const status=()=>({mode:directory?'persistent':'memory',savedAt:directory?state.savedAt:null,
    observationCount:state.observations.length,maxObservations:MAX_OBSERVATIONS,bytes,maxBytes:MAX_WORKSPACE_BYTES,
    recoveredWriter:lock?.recovered??false,lastError});
  return {
    get state(){return state;},status,
    report(id=state.selectedId){
      const observation=state.observations.find(row=>row.id===id);
      if(!observation)fail('Observation not found',404);
      if(!reports.has(id))reports.set(id,validateSnapshot(observation.snapshot).report);
      return reports.get(id);
    },
    async commit(next){
      if(closed)fail('Workspace is closing',503);
      if(next.version!==state.version+1||next.observations.length<1||next.observations.length>MAX_OBSERVATIONS||
          !next.observations.some(row=>row.id===next.selectedId))fail('Invalid workspace revision',409);
      next.savedAt=stamp();const text=json(next,MAX_WORKSPACE_BYTES,'Workspace');const size=Buffer.byteLength(text);
      try{if(directory)await atomicWrite(directory,text);}
      catch(error){
        // Rename may have succeeded before a directory fsync error. Keep memory at
        // that committed version so an uncertain response cannot reuse an old CAS.
        if(error.committed){state=next;bytes=size;}
        lastError=error.code==='ENOSPC'?'Local storage is full; free space and retry the save':'Local storage could not confirm this save; refresh before retrying';
        fail(lastError,503);
      }
      state=next;bytes=size;lastError=null;
      for(const id of reports.keys())if(!state.observations.some(row=>row.id===id))reports.delete(id);
    },
    async close(){if(closed)return;closed=true;await lock?.release();}
  };
}
