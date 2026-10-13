// Complete Contributor working records in the browser's original IndexedDB.
// Native operation identities and business decisions remain owned by the desk.
const DATABASE='sf47-engagement-working';
const VERSION=1;
const SESSIONS='sessions';
const COPIES='checkpoints';
const SCHEMA='sf47.engagement-working-store.v1';
const COPY_REFERENCE='sf47.engagement-working-checkpoint-ref.v1';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function problem(message,code,cause){
  const error=new Error(message);error.code=code;if(cause!==undefined)error.cause=cause;return error;
}
function clone(value){return structuredClone(value);}
function errorOf(value,fallback){return value instanceof Error?value:new Error(value?.message||fallback);}
function checkpointKey(key,id){return [key,id];}
function freezeJSON(value){
  if(value===null||typeof value!=='object')return value;
  if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw problem('Keep a checkpoint as complete original JSON data.','ENGAGEMENT_STORAGE_RECORD');
  for(const part of Object.values(value))freezeJSON(part);
  return Object.freeze(value);
}
function checkRecord(record){
  if(!object(record)||!Array.isArray(record.copies))throw problem('Retain the complete Contributor working record and checkpoint inventory.','ENGAGEMENT_STORAGE_RECORD');
  const seen=new Set();
  for(const row of record.copies){
    if(!object(row)||typeof row.id!=='string'||!/^[a-f0-9]{64}$/.test(row.id)||row.id!==row.sha256||
      !Number.isSafeInteger(row.bytes)||row.bytes<0||!object(row.document)||seen.has(row.id))
      throw problem('Retain each complete checkpoint once with its original identity.','ENGAGEMENT_STORAGE_RECORD');
    seen.add(row.id);
  }
}
export function createEngagementWorkingStore({key}){
  if(typeof key!=='string'||!key||key.length>4096)throw new TypeError('The complete original case and staff storage key is required.');
  let database=null,opening=null,openState='idle',initialized=false,revision=0;
  let sequence=0,lastSuccess=0,lastFailure=null,runner=null,closing=null,closed=false,admitting=true;
  const queue=[],transactions=new Set(),checkpointCache=new WeakMap();
  let committedCopies=new Map();
  function immutableCheckpoint(row){
    const known=checkpointCache.get(row);if(known)return known;
    checkRecord({copies:[row]});
    const retained=freezeJSON(clone(row));
    // Named checkpoints are immutable by contract. Freeze the caller's row
    // once so reusing its identity cannot conceal a later nested mutation.
    freezeJSON(row);
    const value={row:retained,encoded:JSON.stringify(retained)};
    checkpointCache.set(row,value);checkpointCache.set(retained,value);return value;
  }
  function capture(record){
    checkRecord(record);
    const copies=record.copies.map(row=>immutableCheckpoint(row).row);
    const snapshot=clone({...record,copies:[]});snapshot.copies=copies;return snapshot;
  }
  function admitted(){
    if(!admitting||closed)throw problem('The original working-copy store is closing. Reopen its retained desk to continue.','ENGAGEMENT_STORAGE_CLOSED');
  }
  function open(){
    if(database)return Promise.resolve(database);
    if(opening)return opening;
    if(typeof indexedDB==='undefined')return Promise.reject(problem('IndexedDB is unavailable. Keep the complete preparation in memory and download it.','ENGAGEMENT_STORAGE_UNAVAILABLE'));
    openState='opening';
    const request=indexedDB.open(DATABASE,VERSION);
    const attempt=new Promise((resolve,reject)=>{
      request.onupgradeneeded=()=>{
        try{
          const db=request.result;
          if(!db.objectStoreNames.contains(SESSIONS))db.createObjectStore(SESSIONS);
          if(!db.objectStoreNames.contains(COPIES))db.createObjectStore(COPIES);
        }catch(error){try{request.transaction.abort();}catch{}reject(errorOf(error,'The original working store could not be created.'));}
      };
      // Keep ownership of this exact request until success/error. An onblocked
      // notification must not orphan a later successful database connection.
      request.onblocked=()=>{openState='blocked';};
      request.onerror=()=>{openState='failed';reject(errorOf(request.error,'The complete working store could not be opened.'));};
      request.onsuccess=()=>{
        const db=request.result;database=db;openState='open';
        db.onversionchange=()=>{if(database===db){database=null;openState='version-change';}db.close();};
        db.onclose=()=>{if(database===db){database=null;openState='closed';}};
        resolve(db);
      };
    });
    opening=attempt;
    attempt.then(()=>{if(opening===attempt)opening=null;},()=>{if(opening===attempt)opening=null;});
    return attempt;
  }
  function validateEnvelope(value){
    if(!object(value)||value.schema!==SCHEMA||value.key!==key||!Number.isSafeInteger(value.revision)||value.revision<1||
      !object(value.record)||!Array.isArray(value.record.copies))
      throw problem('The retained whole working record has an unsupported storage identity. Keep its original database for recovery.','ENGAGEMENT_STORAGE_CHANGED');
    const seen=new Set();
    for(const ref of value.record.copies){
      if(!object(ref)||ref.schema!==COPY_REFERENCE||typeof ref.id!=='string'||!/^[a-f0-9]{64}$/.test(ref.id)||seen.has(ref.id))
        throw problem('The original complete checkpoint inventory changed. Keep the retained database for recovery.','ENGAGEMENT_STORAGE_CHANGED');
      seen.add(ref.id);
    }
  }
  async function readWhole(){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx,result=null,observed=0,failure=null;
      const abort=error=>{failure=errorOf(error,'The whole working record could not be read.');try{tx.abort();}catch{}};
      try{tx=db.transaction([SESSIONS,COPIES],'readonly');}catch(error){reject(error);return;}
      transactions.add(tx);
      tx.oncomplete=()=>{transactions.delete(tx);initialized=true;revision=observed;
        committedCopies=new Map((result?.copies||[]).map(row=>[row.id,immutableCheckpoint(row)]));resolve(result);};
      tx.onabort=()=>{transactions.delete(tx);reject(failure||errorOf(tx.error,'The complete working read was interrupted.'));};
      tx.onerror=()=>{if(!failure)failure=errorOf(tx.error,'The complete working read failed.');};
      const request=tx.objectStore(SESSIONS).get(key);
      request.onerror=()=>{failure=errorOf(request.error,'The retained working record could not be read.');};
      request.onsuccess=()=>{
        try{
          const envelope=request.result;if(envelope===undefined)return;
          validateEnvelope(envelope);observed=envelope.revision;result=clone(envelope.record);
          const refs=result.copies.slice();result.copies=new Array(refs.length);
          for(let index=0;index<refs.length;index++){
            const ref=refs[index],read=tx.objectStore(COPIES).get(checkpointKey(key,ref.id));
            read.onerror=()=>{failure=errorOf(read.error,'A complete named checkpoint could not be read.');};
            read.onsuccess=()=>{
              try{
                const row=read.result;
                if(!row||row.id!==ref.id)throw problem('A retained named checkpoint is missing its complete original body.','ENGAGEMENT_STORAGE_CHANGED');
                checkRecord({copies:[row]});const retained=clone(row);immutableCheckpoint(retained);result.copies[index]=retained;
              }catch(error){abort(error);}
            };
          }
        }catch(error){abort(error);}
      };
    });
  }
  async function commitWhole(record,expected=revision){
    if(!initialized)throw problem('Read the original complete working record before changing it.','ENGAGEMENT_STORAGE_NOT_READ');
    checkRecord(record);
    const db=await open();
    // All serialization occurs before the live IDB transaction. Its callbacks
    // contain only requests and synchronous comparisons, never an async gap.
    const encoded=new Map(record.copies.map(row=>[row.id,immutableCheckpoint(row).encoded]));
    const retained=clone({...record,copies:record.copies.map(row=>({schema:COPY_REFERENCE,id:row.id}))});
    return new Promise((resolve,reject)=>{
      let tx,failure=null,nextRevision=null;
      const abort=error=>{failure=errorOf(error,'The complete preparation could not be retained.');try{tx.abort();}catch{}};
      try{tx=db.transaction([SESSIONS,COPIES],'readwrite');}catch(error){reject(error);return;}
      transactions.add(tx);
      tx.oncomplete=()=>{transactions.delete(tx);revision=nextRevision;
        committedCopies=new Map(record.copies.map(row=>[row.id,immutableCheckpoint(row)]));resolve();};
      tx.onabort=()=>{transactions.delete(tx);reject(failure||errorOf(tx.error,'The complete preparation was not committed. Keep it open and download it.'));};
      tx.onerror=()=>{if(!failure)failure=errorOf(tx.error,'The browser could not retain the complete working preparation.');};
      const sessions=tx.objectStore(SESSIONS),copies=tx.objectStore(COPIES),read=sessions.get(key);
      read.onerror=()=>{failure=errorOf(read.error,'The original working revision could not be read.');};
      read.onsuccess=()=>{
        try{
          const prior=read.result;
          if(prior!==undefined)validateEnvelope(prior);
          const actual=prior?.revision??0;
          if(actual!==expected)throw problem('Another window retained a different complete preparation. Download this window’s current work, then reopen the stored edition before choosing what to receive.','ENGAGEMENT_STORAGE_CONFLICT');
          nextRevision=actual+1;
          if(!Number.isSafeInteger(nextRevision))throw problem('The complete working history has reached its revision limit.','ENGAGEMENT_STORAGE_REVISION');
          const keep=new Set(record.copies.map(row=>row.id));
          const finish=()=>{
            try{
              for(const ref of prior?.record.copies||[])if(!keep.has(ref.id))copies.delete(checkpointKey(key,ref.id));
              sessions.put({schema:SCHEMA,key,revision:nextRevision,record:retained},key);
            }catch(error){abort(error);}
          };
          let remaining=record.copies.length;
          if(!remaining){finish();return;}
          for(const row of record.copies){
            const known=committedCopies.get(row.id);
            if(known){
              if(known.encoded!==encoded.get(row.id))throw problem('The same checkpoint identity has different complete content. Keep both preparations for explicit recovery.','ENGAGEMENT_CHECKPOINT_CONFLICT');
              if(--remaining===0)finish();
              continue;
            }
            const request=copies.get(checkpointKey(key,row.id));
            request.onerror=()=>{failure=errorOf(request.error,'The original named checkpoint could not be compared.');};
            request.onsuccess=()=>{
              try{
                if(request.result===undefined)copies.put(row,checkpointKey(key,row.id));
                else if(JSON.stringify(request.result)!==encoded.get(row.id))
                  throw problem('The same checkpoint identity has different complete content. Keep both preparations for explicit recovery.','ENGAGEMENT_CHECKPOINT_CONFLICT');
                if(--remaining===0)finish();
              }catch(error){abort(error);}
            };
          }
        }catch(error){abort(error);}
      };
    });
  }
  function makeEntry(kind,record){
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    // Autosaves remain observed even when a caller only awaits flush/close.
    // Awaiting the original promise still receives its actual rejection.
    promise.catch(()=>{});
    return {kind,record,sequence:++sequence,started:false,promise,resolve,reject};
  }
  function start(){
    if(runner)return;
    const attempt=Promise.resolve().then(async()=>{
      while(queue.length){
        const entry=queue.shift();entry.started=true;
        const expectedRevision=revision;
        try{
          const result=entry.kind==='read'?await readWhole():await commitWhole(entry.record,expectedRevision);
          if(entry.kind!=='read'){
            lastSuccess=entry.sequence;
            if(lastFailure&&lastFailure.sequence<=lastSuccess)lastFailure=null;
          }
          entry.resolve(result===undefined?undefined:clone(result));
        }catch(error){
          if(entry.kind!=='read')lastFailure={sequence:entry.sequence,record:entry.record,expectedRevision,error:errorOf(error,'The complete working save failed.')};
          entry.reject(error);
        }
      }
    });
    runner=attempt;
    attempt.then(()=>{if(runner===attempt)runner=null;if(queue.length)start();},
      error=>{if(runner===attempt)runner=null;while(queue.length)queue.shift().reject(error);});
  }
  function enqueue(kind,value){
    admitted();
    const record=kind==='read'?null:capture(value);
    if(record!==null)checkRecord(record);
    if(kind==='schedule'){
      const tail=queue[queue.length-1];
      if(tail?.kind==='schedule'&&!tail.started){tail.record=record;tail.sequence=++sequence;return tail.promise;}
    }
    const entry=makeEntry(kind,record);queue.push(entry);start();return entry.promise;
  }
  function read(){return enqueue('read');}
  function write(record){return enqueue('write',record);}
  function schedule(record){return enqueue('schedule',record);}
  async function drain(){
    while(runner||queue.length){if(!runner)start();await runner;}
  }
  async function flush(){
    await drain();
    if(lastFailure)throw lastFailure.error;
  }
  function close(){
    if(closed)return closing||Promise.resolve();
    if(closing)return closing;
    admitting=false;
    const attempt=(async()=>{
      await drain();
      // A previous failed complete write remains owned. Each explicit close
      // retry makes one attempt at those exact retained bytes; it never reads
      // a new revision to bypass a concurrent-window conflict.
      if(lastFailure){
        const pending=lastFailure;
        await commitWhole(pending.record,pending.expectedRevision);
        lastSuccess=pending.sequence;
        if(lastFailure===pending)lastFailure=null;
      }
      if(opening)await opening;
      if(transactions.size)throw problem('The original working transaction is still retained. Retry closing this same owner.','ENGAGEMENT_STORAGE_BUSY');
      if(database){database.close();database=null;}
      openState='closed';closed=true;
    })();
    closing=attempt;
    attempt.then(()=>{},()=>{if(closing===attempt)closing=null;admitting=true;});
    return attempt;
  }
  function inspect(){
    return {key,revision,initialized,openState,pending:queue.length,transactions:transactions.size,
      closing:!!closing&&!closed,closed,lastSuccess,
      failure:lastFailure?{sequence:lastFailure.sequence,expectedRevision:lastFailure.expectedRevision,code:lastFailure.error.code||null,message:lastFailure.error.message}:null};
  }
  return {read,write,schedule,flush,close,inspect};
}
