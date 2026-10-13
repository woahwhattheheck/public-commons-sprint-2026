/** Durable unfinished comparison choices; scientific editions remain in the original Workspace. */
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,message)=>{if(!value)throw Error(message);};
const schema='upstate.independent-comparison-draft/v1';
export function draftScope(state){
  const value={origin:location.origin,workspace:state?.workspace_key,project:state?.data?.project?.id,person:state?.person?.id};
  need(Object.values(value).every(x=>typeof x==='string'&&x),'Open an authenticated original Workspace before retaining this draft.');
  return value;
}
export function openComparisonDraftStore(scope){
  need(scope&&Object.values(scope).every(x=>typeof x==='string'&&x),'A complete original Workspace and person binding is required.');
  const prefix=JSON.stringify([scope.origin,scope.workspace,scope.project,scope.person]);
  let database=null;
  const db=()=>database||(database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('upstate-independent-comparison-drafts',1);
    request.onupgradeneeded=()=>{const d=request.result;if(!d.objectStoreNames.contains('records'))d.createObjectStore('records');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=null;reject(request.error||Error('Draft storage is unavailable.'));};
    request.onblocked=()=>{database=null;reject(Error('Close an older tab that is blocking draft storage.'));};
  }));
  async function read(){
    const d=await db();return new Promise((resolve,reject)=>{
      const tx=d.transaction('records','readonly'),r=tx.objectStore('records').get(prefix);let value;
      r.onsuccess=()=>{value=r.result;};tx.oncomplete=()=>{
        if(value){try{validate(value);resolve(copy(value));}catch(e){reject(e);}}else resolve(null);
      };tx.onerror=()=>reject(tx.error||r.error||Error('Unable to read the retained draft.'));
    });
  }
  function validate(value){
    need(value?.schema===schema&&same(value.scope,scope)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&value.state&&typeof value.state==='object','This draft belongs to a different original Workspace/person or has incomplete contents.');
    return value;
  }
  async function save(state,expectedRevision){
    need(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'Retain the original draft revision.');
    const frozen=copy(state),d=await db(),conflictId=crypto.randomUUID();return new Promise((resolve,reject)=>{
      const tx=d.transaction('records','readwrite'),store=tx.objectStore('records'),r=store.get(prefix);let outcome;
      r.onsuccess=()=>{
        const current=r.result;
        try{
          if(current)validate(current);
          const revision=current?.revision||0;
          if(revision!==expectedRevision){
            const conflict={schema,scope:copy(scope),revision:expectedRevision,state:frozen,conflict:{id:conflictId,at:new Date().toISOString(),expectedRevision,currentRevision:revision}};
            store.add(conflict,prefix+':conflict:'+conflictId);
            outcome={state:'conflict',snapshot:conflict,currentRevision:revision};
          }else{
            const next={schema,scope:copy(scope),revision:revision+1,state:frozen};
            store.put(next,prefix);outcome={state:'saved',record:next};
          }
        }catch(error){tx.abort();reject(error);}
      };
      tx.oncomplete=()=>resolve(outcome);tx.onerror=()=>reject(tx.error||r.error||Error('The complete draft could not be saved.'));
      tx.onabort=()=>reject(tx.error||Error('Draft storage was interrupted; keep the current full draft.'));
    });
  }
  async function conflicts(){
    const d=await db();return new Promise((resolve,reject)=>{
      const rows=[],tx=d.transaction('records','readonly'),r=tx.objectStore('records').openCursor();
      r.onsuccess=()=>{const c=r.result;if(!c)return;const k=String(c.key);if(k.startsWith(prefix+':conflict:')){try{validate(c.value);rows.push(copy(c.value));}catch(error){tx.abort();reject(error);return;}}c.continue();};
      tx.oncomplete=()=>resolve(rows.sort((a,b)=>String(b.conflict.at).localeCompare(String(a.conflict.at))));
      tx.onerror=()=>reject(tx.error||Error('Unable to read retained conflicting drafts.'));
    });
  }
  async function preserve(state,reason){
    const d=await db(),id=crypto.randomUUID(),value={schema,scope:copy(scope),revision:0,state:copy(state),conflict:{id,at:new Date().toISOString(),reason:String(reason)}};
    return new Promise((resolve,reject)=>{const tx=d.transaction('records','readwrite');tx.objectStore('records').add(value,prefix+':conflict:'+id);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||Error('The full recovery draft could not be retained.'));});
  }
  return {read,save,conflicts,preserve,scope:copy(scope),validate};
}
