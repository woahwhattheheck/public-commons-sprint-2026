// SPDX-License-Identifier: MIT
// Durable, workspace-scoped browser drafts and original analyst requests.
export const clone = value => structuredClone(value);
export const same = (a,b) => JSON.stringify(order(a)) === JSON.stringify(order(b));
function order(v) { return Array.isArray(v) ? v.map(order) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])) : v; }
const database = new Promise((resolve,reject)=>{
  const open=indexedDB.open('starforge-parcel-evidence-v1',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('records',{keyPath:'key'});
  open.onsuccess=()=>resolve(open.result); open.onerror=()=>reject(open.error);
});
export function createEvidenceStore(workspaceId) {
  if(typeof workspaceId!=='string'||!workspaceId) throw new Error('Choose the original workspace.');
  const prefix=workspaceId+':';
  async function transaction(mode,callback) {
    const db=await database;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records',mode), records=tx.objectStore('records'); let answer, failure;
      tx.oncomplete=()=>resolve(clone(answer)); tx.onerror=()=>reject(failure||tx.error); tx.onabort=()=>reject(failure||tx.error||new Error('Browser storage transaction was interrupted.'));
      const done=value=>{answer=value;};
      const fail=error=>{failure=error;tx.abort();};
      try { callback(records,done,fail); } catch(error){fail(error);}
    });
  }
  const read=key=>transaction('readonly',(s,done,fail)=>{const q=s.get(prefix+key);q.onsuccess=()=>done(q.result?.value??null);q.onerror=()=>fail(q.error);});
  const update=(key,fn)=>transaction('readwrite',(s,done,fail)=>{
    const q=s.get(prefix+key);q.onerror=()=>fail(q.error);q.onsuccess=()=>{
      try {const value=fn(clone(q.result?.value??null));s.put({key:prefix+key,value:clone(value)});done(value);}catch(e){fail(e);}
    };
  });
  async function draft(key,body,basis) {
    return update('draft:'+key,prior=>prior||{version:1,body:clone(body),basis:clone(basis),updatedAt:new Date().toISOString()});
  }
  async function saveDraft(key,expected,body,basis) {
    return update('draft:'+key,prior=>{
      if((prior?.version??0)!==expected) throw new Error('This draft changed in another tab. Export your current work, then inspect the saved draft before adopting it.');
      return {version:expected+1,body:clone(body),basis:clone(basis),updatedAt:new Date().toISOString()};
    });
  }
  async function claim(request,context) {
    return update('pending',prior=>{
      if(prior) {if(same(prior.request,request))return prior;throw new Error('Receive or explicitly resolve the existing original request before another action.');}
      return {request:clone(request),context:clone(context),createdAt:new Date().toISOString(),attempts:[],operation:null};
    });
  }
  const pending=()=>read('pending');
  const changePending=(requestId,fn)=>update('pending',p=>{
    if(!p||p.request.requestId!==requestId)throw new Error('The original request changed in another tab. Receive the current saved request.');
    return fn(p);
  });
  async function attempt(requestId,kind='POST') {
    return changePending(requestId,p=>{
      const id=crypto.randomUUID();p.attempts.push({id,kind,state:'DISPATCHING',startedAt:new Date().toISOString()});p.activeAttempt=id;return p;
    });
  }
  async function attemptResult(requestId,attemptId,state,detail) {
    return changePending(requestId,p=>{
      const a=p.attempts.find(x=>x.id===attemptId);if(!a)throw new Error('The original dispatch attempt is missing.');
      a.state=state;a.detail=clone(detail);a.endedAt=new Date().toISOString();return p;
    });
  }
  async function observe(requestId,operation) {
    return changePending(requestId,p=>{
      const input=operation.input;
      if(operation.requestId!==requestId||!input||input.workspaceId!==workspaceId||
        input.workspaceDirectory!==p.context.workspaceDirectory||input.action!==p.request.action||
        !same(input.payload,p.request.payload)||input.actor!==p.request.actor||
        input.revision!==p.request.revision||typeof operation.inputSha256!=='string'||!/^[a-f0-9]{64}$/.test(operation.inputSha256))
        throw new Error('The listener returned a different original workspace, action, payload, actor or revision. The pending request remains retained.');
      if(p.verifiedInputSha256&&(p.verifiedInputSha256!==operation.inputSha256||!same(p.verifiedInput,input)))
        throw new Error('The original operation input changed after its first verified receipt.');
      p.verifiedInputSha256=operation.inputSha256;p.verifiedInput=clone(input);
      p.operation=clone(operation);p.observedAt=new Date().toISOString();return p;
    });
  }
  async function received(requestId,receipt) {
    return transaction('readwrite',(s,done,fail)=>{
      const q=s.get(prefix+'pending');q.onerror=()=>fail(q.error);q.onsuccess=()=>{
        try {const p=q.result?.value;if(!p||p.request.requestId!==requestId)throw new Error('The pending request changed; its receipt was not cleared.');
          const value={...clone(p),receipt:clone(receipt),completedAt:new Date().toISOString()};
          s.put({key:prefix+'receipt:'+requestId,value});s.delete(prefix+'pending');done(value);
        }catch(e){fail(e);}
      };
    });
  }
  async function archiveNotFound(requestId) {
    const p=await pending();
    if(!p||p.request.requestId!==requestId||!p.notFoundAt)throw new Error('Read the original request outcome before archiving.');
    return transaction('readwrite',(s,done,fail)=>{
      const q=s.get(prefix+'pending');q.onerror=()=>fail(q.error);q.onsuccess=()=>{
        try {const current=q.result?.value;
          if(!same(current,p))throw new Error('The original request changed while it was reviewed.');
          if(current.attempts.some(a=>a.state!=='REJECTED'))throw new Error('An earlier dispatch remains uncertain. Keep receiving its original outcome.');
          const value={...current,archivedAt:new Date().toISOString(),reason:'NOT_FOUND; all dispatches definitely rejected or no dispatch'};
          s.put({key:prefix+'receipt:'+requestId,value});s.delete(prefix+'pending');done(value);
        }catch(e){fail(e);}
      };
    });
  }
  async function all() {
    return transaction('readonly',(s,done,fail)=>{const q=s.getAll();q.onsuccess=()=>done(q.result.filter(r=>r.key.startsWith(prefix)).map(r=>({key:r.key.slice(prefix.length),value:r.value})));q.onerror=()=>fail(q.error);});
  }
  async function exportRecovery() {return {schema:'starforge.parcel-evidence-browser.v1',workspaceId,exportedAt:new Date().toISOString(),records:await all()};}
  async function importRecovery(value) {
    if(value?.schema!=='starforge.parcel-evidence-browser.v1'||value.workspaceId!==workspaceId||!Array.isArray(value.records)||value.records.length>10000)throw new Error('Choose the complete browser recovery file for this exact workspace.');
    const seen=new Set();
    for(const r of value.records) {
      if(!r||typeof r.key!=='string'||!(/^(draft:|receipt:|upload:)/.test(r.key)||r.key==='pending')||seen.has(r.key))throw new Error('The recovery file contains an invalid or repeated record.');
      seen.add(r.key);
      if(r.key==='pending'&&(!r.value?.request?.requestId||!Array.isArray(r.value.attempts)))throw new Error('Keep the complete original request and dispatch history.');
      if(r.key.startsWith('draft:')&&(!Number.isSafeInteger(r.value?.version)||r.value.version<1||!Object.hasOwn(r.value,'basis')))throw new Error('Keep each draft and its original reviewed basis.');
    }
    return transaction('readwrite',(s,done,fail)=>{
      const q=s.getAll();q.onerror=()=>fail(q.error);q.onsuccess=()=>{
        const existing=new Map(q.result.filter(r=>r.key.startsWith(prefix)).map(r=>[r.key.slice(prefix.length),r.value]));
        const added=[],conflicts=[];
        for(const r of value.records) {
          if(existing.has(r.key)){if(!same(existing.get(r.key),r.value))conflicts.push(r.key);continue;}
          const v=clone(r.value);
          if(r.key==='pending'&&v.attempts.some(a=>a.state==='DISPATCHING'))v.recoveredUncertain=true;
          s.put({key:prefix+r.key,value:v});added.push(r.key);
        }done({added,conflicts});
      };
    });
  }
  async function lock(fn) {
    if(!navigator.locks?.request)throw new Error('This browser cannot safely coordinate operation dispatch. Use a browser with Web Locks; your saved drafts remain downloadable.');
    return navigator.locks.request('parcel-evidence:'+workspaceId,fn);
  }
  return {workspaceId,read,update,draft,saveDraft,pending,claim,attempt,attemptResult,observe,received,archiveNotFound,changePending,all,exportRecovery,importRecovery,lock};
}
