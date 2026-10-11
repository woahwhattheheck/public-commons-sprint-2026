// MIT. Private retained weather work with an exclusive process lease and atomic state.
import {open,mkdir,lstat,realpath,readFile,rename,unlink,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {digest,stable,fail,identifier,plain} from './contract.mjs';

const STATE='stellar-forge.openweather-store.v1';
const MAX_STATE=32*1024*1024,MAX_FILE=64*1024*1024,MAX_RETAINED=256*1024*1024;
async function syncDir(path){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function readPrivate(path,limit=MAX_FILE){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||s.size>limit||(s.mode&0o077))fail('PRIVATE_FILE','Use a private regular file within its size limit');
    const b=await f.readFile();if(b.length>limit)fail('PRIVATE_FILE','Retained file exceeds its limit');return b;
  }finally{await f.close();}
}
async function writeNew(path,bytes){
  const f=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}await syncDir(dirname(path));
}
async function atomic(path,bytes){
  const temp=path+'.pending-'+randomUUID();await writeNew(temp,bytes);
  try{await rename(temp,path);await syncDir(dirname(path));}catch(e){await unlink(temp).catch(()=>{});throw e;}
}
function statIdentity(value){
  const pid=Number(value.slice(0,value.indexOf(' '))),start=value.slice(value.lastIndexOf(')')+2).split(' ')[19];
  if(!Number.isSafeInteger(pid)||pid<=0||!/^\d+$/.test(start))throw new Error('Unsupported process identity');
  return {pid,start};
}
async function selfIdentity(){
  try{
    const own=statIdentity(await readFile('/proc/self/stat','utf8')),
      view=await lstat('/proc/1'),init=statIdentity(await readFile('/proc/1/stat','utf8'));
    return {procPid:own.pid,procStart:own.start,procView:[view.dev,view.ino,init.start].join(':'),
      bootId:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};
  }catch{return {};}
}
async function ownerMayBeAlive(old,current){
  if(Number.isSafeInteger(old.procPid)&&old.procPid>0&&typeof old.procStart==='string'){
    if(!current.procView||old.procView!==current.procView)return true;
    if(old.bootId&&current.bootId&&old.bootId!==current.bootId)return false;
    try{return statIdentity(await readFile('/proc/'+old.procPid+'/stat','utf8')).start===old.procStart;}
    catch(e){return e.code!=='ENOENT'&&e.code!=='ESRCH';}
  }
  // Legacy and non-Linux leases use the local PID; uncertain ownership stays with its operator.
  try{process.kill(old.pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}
async function lease(root){
  const path=join(root,'writer.lock'),owner={host:hostname(),pid:process.pid,...await selfIdentity(),nonce:randomUUID()};
  try{await writeNew(path,stable(owner));}catch(e){
    if(e.code!=='EEXIST')throw e;
    const oldBytes=await readPrivate(path,4096),old=JSON.parse(oldBytes);
    if(old.host!==hostname()||!Number.isSafeInteger(old.pid)||old.pid<=0||await ownerMayBeAlive(old,owner))
      fail('STORE_IN_USE','This workspace is open in another process. Use its console or stop that exact process first',409);
    const before=await lstat(path);
    if(digest(await readPrivate(path,4096))!==digest(oldBytes))fail('STORE_IN_USE','Workspace ownership changed',409);
    const after=await lstat(path);if(before.ino!==after.ino||before.dev!==after.dev)fail('STORE_IN_USE','Workspace ownership changed',409);
    await unlink(path);await writeNew(path,stable(owner));
  }
  const check=async()=>{const current=JSON.parse(await readPrivate(path,4096));if(current.nonce!==owner.nonce)fail('STORE_LEASE_LOST','Workspace ownership changed',409);};
  return {check,close:async()=>{await check();await unlink(path);await syncDir(root);}};
}
function validateState(s){
  if(s?.schema!==STATE||!Number.isSafeInteger(s.generation)||!plain(s.projects)||!plain(s.jobs)||!plain(s.budgets)||!Array.isArray(s.history))
    fail('STORE_INVALID','Unsupported retained weather workspace');
}
export async function openStore(path){
  const root=resolve(path);await mkdir(root,{recursive:true,mode:0o700});
  const st=await lstat(root);if(!st.isDirectory()||(st.mode&0o077)||await realpath(root)!==root)fail('PRIVATE_DIRECTORY','Use an unaliased private workspace directory (0700)');
  for(const name of ['records','sources','reviews','packages']){await mkdir(join(root,name),{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const s=await lstat(join(root,name));if(!s.isDirectory()||(s.mode&0o077))fail('PRIVATE_DIRECTORY','Retained subdirectory is not private');}
  const held=await lease(root),statePath=join(root,'store.json');
  let state,closed=false,queue=Promise.resolve();
  try{try{state=JSON.parse(await readPrivate(statePath,MAX_STATE));}catch(e){if(e.code!=='ENOENT')throw e;
    state={schema:STATE,createdAt:new Date().toISOString(),generation:0,account:null,budgets:{},projects:{},jobs:{},history:[],retainedBytes:0};
    await writeNew(statePath,stable(state)+'\n');}validateState(state);
  }catch(e){await held.close().catch(()=>{});throw e;}
  const transaction=fn=>{
    const task=queue.then(async()=>{
      if(closed)fail('STORE_CLOSED','Workspace has closed',409);await held.check();
      const next=structuredClone(state),result=await fn(next);next.generation=state.generation+1;validateState(next);
      const bytes=stable(next)+'\n';if(Buffer.byteLength(bytes)>MAX_STATE)fail('STORE_CAPACITY','Workspace metadata is full; retain it and start a new workspace',409);
      await held.check();await atomic(statePath,bytes);state=next;return structuredClone(result);
    });queue=task.catch(()=>{});return task;
  };
  const read=async(kind,id)=>{
    if(!['records','sources','reviews'].includes(kind))fail('INVALID_INPUT','Unknown retained file kind');
    identifier(id);const bytes=await readPrivate(join(root,kind,id+'.json'));return {bytes,sha256:digest(bytes),value:JSON.parse(bytes)};
  };
  const write=async(kind,id,value)=>{
    if(!['records','sources','reviews'].includes(kind))fail('INVALID_INPUT','Unknown retained file kind');
    identifier(id);const bytes=stable(value)+'\n';
    const limit=kind==='reviews'?MAX_FILE:kind==='sources'?4*1024*1024:2*1024*1024;
    if(Buffer.byteLength(bytes)>limit)fail('RETAINED_LIMIT','Retained '+kind+' record exceeds its byte allowance');
    if(state.retainedBytes+Buffer.byteLength(bytes)>MAX_RETAINED)fail('STORE_CAPACITY','Workspace response allowance is full',409);
    const path=join(root,kind,id+'.json');
    try{await writeNew(path,bytes);}catch(e){if(e.code!=='EEXIST')throw e;const old=await readPrivate(path);if(digest(old)!==digest(bytes))fail('RECORD_CONFLICT','An existing retained record differs',409);}
    return {id,bytes:Buffer.byteLength(bytes),sha256:digest(bytes)};
  };
  return {root,transaction,read,write,
    snapshot:()=>structuredClone(state),
    close:async()=>{await queue;if(!closed){closed=true;await held.close();}},
    backup:async()=>{
      await queue;await held.check();const snapshot=structuredClone(state),files=[];
      for(const kind of ['records','sources','reviews'])for(const name of (await readdir(join(root,kind))).sort()){
        if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(name))continue;
        const bytes=await readPrivate(join(root,kind,name));files.push({kind,id:name.slice(0,-5),sha256:digest(bytes),bytes:bytes.length,text:bytes.toString('utf8')});
      }
      return {schema:'stellar-forge.openweather-backup.v1',createdAt:new Date().toISOString(),state:snapshot,files,
        packageRoot:join(root,'packages'),releaseRoot:join(root,'releases'),
        note:'Weather projects, source documents, provider records and accepted data editions. Retain original merchant packages and release store alongside this file.'};
    }
  };
}
export async function restoreStore(path,backup){
  if(backup?.schema!=='stellar-forge.openweather-backup.v1'||!Array.isArray(backup.files)||backup.files.length>50000)fail('BACKUP_INVALID','Unsupported weather backup');
  validateState(backup.state);const root=resolve(path);
  try{await lstat(root);fail('RESTORE_EXISTS','Restore into a new workspace directory',409);}catch(e){if(e.code!=='ENOENT')throw e;}
  const seen=new Set();let total=0;
  for(const row of backup.files){
    if(!['records','sources','reviews'].includes(row.kind))fail('BACKUP_INVALID','Unexpected backup file kind');identifier(row.id);
    const key=row.kind+'/'+row.id;if(seen.has(key))fail('BACKUP_INVALID','Repeated backup file');seen.add(key);
    if(typeof row.text!=='string'||Buffer.byteLength(row.text)!==row.bytes||digest(row.text)!==row.sha256||row.bytes>MAX_FILE)fail('BACKUP_INVALID','Backup file identity differs');
    JSON.parse(row.text);total+=row.bytes;
  }
  if(total>MAX_RETAINED||Buffer.byteLength(stable(backup.state))>MAX_STATE)fail('BACKUP_INVALID','Backup exceeds workspace limits');
  for(const project of Object.values(backup.state.projects)){
    for(const ref of [...(project.sources??[]),...(project.integrations??[])])if(!seen.has('sources/'+ref.id))fail('BACKUP_INVALID','Source or integration member is absent');
    for(const ref of project.reviews??[])if(!seen.has('reviews/'+ref.id))fail('BACKUP_INVALID','Review member is absent');
  }
  for(const job of Object.values(backup.state.jobs))for(const attempt of job.attempts??[])if(attempt.response&&!seen.has('records/'+attempt.id))fail('BACKUP_INVALID','Provider response member is absent');
  await mkdir(root,{recursive:false,mode:0o700});for(const name of ['records','sources','reviews','packages'])await mkdir(join(root,name),{mode:0o700});
  for(const row of backup.files)await writeNew(join(root,row.kind,row.id+'.json'),row.text);
  const restored=structuredClone(backup.state);restored.history.push({at:new Date().toISOString(),action:'RESTORED',from:backup.createdAt});
  await writeNew(join(root,'store.json'),stable(restored)+'\n');return {root,projects:Object.keys(restored.projects).length,files:backup.files.length};
}
