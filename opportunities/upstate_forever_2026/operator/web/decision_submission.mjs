/* Retained identities for the original Decisions task queue. */
import {operationId,submissionIdentity} from './decision_transfer.mjs';

const SCHEMA='upstate.decision-submissions/v1';
const ACTIONS=new Set(['decision.view.save','run.compare']);
const STATES=new Set(['prepared','submitting','uncertain','queued','running','complete','failed','cancelled','interrupted']);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const FIELDS=['workspace','action','operation_id','native_operation_id','payload_sha256','draft_sha256',
  'state','id','result_id','created_at','updated_at'];
const compact=value=>Object.fromEntries(FIELDS.filter(key=>own(value,key)).map(key=>[key,value[key]]));
const clone=value=>JSON.parse(JSON.stringify(value));
const keyFor=workspace=>'upstate-scenario-decision-operations:'+encodeURIComponent(workspace);

function validEntry(value,workspace){
  return value&&value.workspace===workspace&&ACTIONS.has(value.action)&&
    typeof value.operation_id==='string'&&value.operation_id.length>0&&value.operation_id.length<=512&&
    /^[0-9a-f]{64}$/.test(value.payload_sha256||'')&&STATES.has(value.state)&&
    Number.isFinite(value.created_at)&&Number.isFinite(value.updated_at)&&
    (!own(value,'id')||typeof value.id==='string')&&
    (!own(value,'result_id')||typeof value.result_id==='string')&&
    (!own(value,'draft_sha256')||/^[0-9a-f]{64}$/.test(value.draft_sha256))&&
    (!own(value,'native_operation_id')||typeof value.native_operation_id==='string');
}

export function sameSubmissionTask(task,entry){
  if(!task||!entry)return false;
  if(task.workspace&&task.workspace!==entry.workspace)return false;
  if(task.action&&task.action!==entry.action)return false;
  if(entry.id)return task.id===entry.id;
  return !!(task.operation_id&&task.operation_id===(entry.native_operation_id||entry.operation_id));
}

export function createDecisionSubmissionJournal({storage=()=>globalThis.localStorage}={}){
  const memory=new Map(),unavailable=new Set(),originals=new Map(),durableOriginals=new Set(),finished=new Set();
  let databasePromise=null;
  function read(workspace){
    let entries=memory.get(workspace)||[];
    if(unavailable.has(workspace))return clone(entries);
    try{
      const raw=storage()?.getItem(keyFor(workspace));
      if(raw){
        const value=JSON.parse(raw);
        if(value.schema===SCHEMA&&value.workspace===workspace&&Array.isArray(value.entries))
          entries=value.entries.filter(entry=>validEntry(entry,workspace)).map(compact);
      }else entries=[];
    }catch(_){unavailable.add(workspace);}
    memory.set(workspace,clone(entries));
    return clone(entries);
  }
  function write(workspace,entries){
    memory.set(workspace,clone(entries));
    try{
      const target=storage();
      if(!target){unavailable.add(workspace);return false;}
      if(entries.length)target.setItem(keyFor(workspace),JSON.stringify({schema:SCHEMA,workspace,entries}));
      else target.removeItem(keyFor(workspace));
      unavailable.delete(workspace);
      return true;
    }catch(_){unavailable.add(workspace);return false;}
  }
  function retain(entry){
    entry=compact(entry);
    if(!validEntry(entry,entry.workspace))throw Error('Retain the original Decisions submission identity.');
    const entries=read(entry.workspace);
    const index=entries.findIndex(row=>row.operation_id===entry.operation_id);
    if(index<0)entries.push(clone(entry));
    else entries[index]=clone(entry);
    return {entry:clone(entry),durable:write(entry.workspace,entries)};
  }
  function database(){
    if(databasePromise)return databasePromise;
    databasePromise=new Promise(resolve=>{
      if(!globalThis.indexedDB){resolve(null);return;}
      let request;
      try{request=globalThis.indexedDB.open('upstate-decision-original-submissions',1);}
      catch(_){resolve(null);return;}
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('requests'))
          db.createObjectStore('requests',{keyPath:['workspace','operation_id']});
      };
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{db.close();databasePromise=null;};
        resolve(db);
      };
    });
    return databasePromise;
  }
  const requestKey=entry=>JSON.stringify([entry.workspace,entry.operation_id]);
  async function retainOriginal(entry,payload){
    const body={workspace:entry.workspace,action:entry.action,payload:clone(payload),
      operation_id:entry.operation_id};
    const value={workspace:entry.workspace,operation_id:entry.operation_id,
      payload_sha256:entry.payload_sha256,body};
    originals.set(requestKey(entry),value);
    const db=await database();
    if(!db)return false;
    return new Promise(resolve=>{
      let transaction;
      try{
        transaction=db.transaction('requests','readwrite');
        transaction.objectStore('requests').put(value);
      }catch(_){resolve(false);return;}
      transaction.oncomplete=()=>{durableOriginals.add(requestKey(entry));resolve(true);};
      transaction.onerror=()=>resolve(false);
      transaction.onabort=()=>resolve(false);
    });
  }
  async function original(entry){
    let value=originals.get(requestKey(entry));
    if(!value){
      const db=await database();
      if(db)value=await new Promise(resolve=>{
        let request;
        try{request=db.transaction('requests','readonly').objectStore('requests').get([entry.workspace,entry.operation_id]);}
        catch(_){resolve(null);return;}
        request.onsuccess=()=>{if(request.result)durableOriginals.add(requestKey(entry));resolve(request.result||null);};
        request.onerror=()=>resolve(null);
      });
    }
    if(!value)return null;
    originals.set(requestKey(entry),value);
    const body=value.body;
    if(value.workspace!==entry.workspace||value.operation_id!==entry.operation_id||
       value.payload_sha256!==entry.payload_sha256||body?.workspace!==entry.workspace||
       body?.action!==entry.action||body?.operation_id!==entry.operation_id||
       await submissionIdentity(body.action,body.payload)!==entry.payload_sha256)
      throw Error('The retained original Decisions request changed. Open its original task before continuing.');
    return {...clone(body),operation_id:entry.native_operation_id||entry.operation_id};
  }
  async function removeOriginal(entry){
    originals.delete(requestKey(entry));durableOriginals.delete(requestKey(entry));
    const db=await database();
    if(!db)return false;
    return new Promise(resolve=>{
      let transaction;
      try{
        transaction=db.transaction('requests','readwrite');
        transaction.objectStore('requests').delete([entry.workspace,entry.operation_id]);
      }catch(_){resolve(false);return;}
      transaction.oncomplete=()=>resolve(true);
      transaction.onerror=()=>resolve(false);
      transaction.onabort=()=>resolve(false);
    });
  }
  async function prepare(workspace,action,payload,{draft_sha256}={}){
    if(typeof workspace!=='string'||!workspace||!ACTIONS.has(action))
      throw Error('Choose an existing Decisions workspace operation.');
    const payload_sha256=await submissionIdentity(action,payload);
    const existing=read(workspace).find(row=>row.action===action&&row.payload_sha256===payload_sha256);
    if(existing){
      const previous=await original(existing);
      const bodyStored=previous?durableOriginals.has(requestKey(existing)):await retainOriginal(existing,payload);
      return {entry:existing,reused:true,durable:write(workspace,read(workspace))&&bodyStored};
    }
    const time=Date.now();
    const saved=retain({workspace,action,payload_sha256,operation_id:operationId(),
      state:'prepared',created_at:time,updated_at:time,
      ...(draft_sha256?{draft_sha256}:{}),});
    const bodyStored=await retainOriginal(saved.entry,payload);
    return {...saved,durable:saved.durable&&bodyStored,reused:false};
  }
  function update(original,patch={}){
    const current=read(original.workspace).find(row=>row.operation_id===original.operation_id)||original;
    if(current.action!==original.action||current.payload_sha256!==original.payload_sha256)
      throw Error('The original Decisions request identity changed.');
    const entry={...current,updated_at:Date.now()};
    for(const name of ['state','id','result_id','native_operation_id'])if(own(patch,name))entry[name]=patch[name];
    return retain(entry);
  }
  function accepted(original,task,{canonical=false}={}){
    if(!task||typeof task.id!=='string'||!task.id||
       (original.id&&task.id!==original.id)||
       (task.workspace&&task.workspace!==original.workspace)||
       (task.action&&task.action!==original.action)||
       (task.operation_id&&task.operation_id!==(original.native_operation_id||original.operation_id)&&!canonical))
      throw Error('The operator returned a different Decisions task. Continue the original workspace submission.');
    const patch={id:task.id,state:STATES.has(task.state)?task.state:'queued'};
    if(typeof task.operation_id==='string')patch.native_operation_id=task.operation_id;
    if(typeof task.result?.id==='string')patch.result_id=task.result.id;
    return update(original,patch);
  }
  function acknowledge(entry){
    finished.add(requestKey(entry));
    const entries=read(entry.workspace).filter(row=>row.operation_id!==entry.operation_id);
    const retained=write(entry.workspace,entries);
    void removeOriginal(entry);
    return retained;
  }
  return {
    prepare,update,accepted,acknowledge,original,
    isAcknowledged(entry){return finished.has(requestKey(entry));},
    entries(workspace){return read(workspace).sort((a,b)=>a.created_at-b.created_at);},
  };
}
