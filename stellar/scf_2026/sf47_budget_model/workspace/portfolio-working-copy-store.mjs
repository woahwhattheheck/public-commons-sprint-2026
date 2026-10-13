// Complete browser working copies for the existing Portfolio desk.
// No method in this module invokes or changes a native Portfolio record.
export const PORTFOLIO_WORKING_COPIES_SCHEMA='stellar-forge.portfolio-working-copies.v1';
export const PORTFOLIO_WORKING_COPY_SCHEMA='stellar-forge.portfolio-working-copy.v1';
const STORAGE_SCHEMA='stellar-forge.portfolio-working-copy-storage.v1';
const DATABASE='sf47-portfolio-working-copies';
const TABLES=['collections','copies','checkpoints','lineage'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function problem(message,code='PORTFOLIO_WORKING_COPY_INVALID'){const e=new Error(message);e.code=code;return e;}
function need(value,message){if(!value)throw problem(message);}
function keys(value,names,message){need(object(value)&&Object.keys(value).length===names.length&&names.every(k=>own(value,k)),message);}
function jsonCopy(value,seen=new Set(),depth=0){
  need(depth<=256,'The working copy contains an excessively nested value.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){need(Number.isFinite(value),'Working copy numbers must be finite.');return value;}
  need(value&&typeof value==='object'&&(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),'Retain ordinary JSON values in a working copy.');
  need(!seen.has(value),'The working copy contains a circular reference.');
  seen.add(value);let result;
  if(Array.isArray(value)){result=[];for(let i=0;i<value.length;i++){need(own(value,i),'Retain complete arrays in a working copy.');result.push(jsonCopy(value[i],seen,depth+1));}}
  else{result={};for(const key of Object.keys(value)){Object.defineProperty(result,key,{value:jsonCopy(value[key],seen,depth+1),enumerable:true,writable:true,configurable:true});}}
  seen.delete(value);return result;
}
function same(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>own(b,k)&&same(a[k],b[k]));
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
function identifier(value){need(typeof value==='string'&&/^pwc-[a-f0-9]{32}$/.test(value),'Retain the complete working-copy identity.');return value;}
function timestamp(value){need(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'Retain an exact UTC working-copy timestamp.');return value;}
function label(value,kind='name'){need(typeof value==='string'&&value.trim().length>0&&value.length<=240,'Enter a '+kind+' of 1–240 characters.');return value;}
function rowForCopy(namespace,copy){
  return {namespace,copy:{id:copy.id,name:copy.name,createdAt:copy.createdAt,updatedAt:copy.updatedAt,archived:copy.archived,
    head:copy.head,checkpoints:copy.checkpoints.map(c=>({id:c.id,createdAt:c.createdAt,label:c.label})),
    lineage:copy.lineage.map(l=>({id:l.id,kind:l.kind,createdAt:l.createdAt,sourceCopyId:l.sourceCopy.id,sourceCheckpointId:l.sourceCheckpointId}))}};
}
function metadata(collection){return {schema:collection.schema,revision:collection.revision,selectedCopyId:collection.selectedCopyId,copyIds:collection.copies.map(c=>c.id)};}
function empty(){return {schema:PORTFOLIO_WORKING_COPIES_SCHEMA,revision:0,selectedCopyId:null,copies:[]};}

/**
 * All returned collections/copies are immutable snapshots. A successful mutation
 * returns {collection,copy}; read/open return the collection. Mutations serialize
 * within this instance and compare the namespace-wide revision in one IndexedDB
 * transaction. A conflicting window retains its complete in-memory snapshot.
 *
 * validateSession is the existing Portfolio session validator. It may be async,
 * must return the complete checked JSON without normalization or field removal,
 * and runs before a write transaction starts. native pending requests are opaque
 * preserved session content; this store never dispatches one.
 */
export function createPortfolioWorkingCopyStore(key,{validateSession,indexedDB=globalThis.indexedDB,
    makeId=()=> 'pwc-'+globalThis.crypto.randomUUID().replaceAll('-',''),now=()=>new Date().toISOString()}={}){
  need(typeof key==='string'&&key.length>0&&key.length<=2000,'Choose the original staff and case working-copy namespace.');
  need(typeof validateSession==='function','Supply the complete Portfolio working-session validator.');
  let database=null,opening=null,queue=Promise.resolve(),collection=null,readFailure=null,closed=false,closing=false;
  function enqueue(fn){
    if(closed||closing)return Promise.reject(problem('This Portfolio working-copy store is closed.','PORTFOLIO_WORKING_COPY_CLOSED'));
    const task=queue.catch(()=>{}).then(fn);queue=task;return task;
  }
  function openDatabase(){
    if(closed)return Promise.reject(problem('This Portfolio working-copy store is closed.','PORTFOLIO_WORKING_COPY_CLOSED'));
    if(database)return Promise.resolve(database);
    if(opening)return opening;
    if(!indexedDB)return Promise.reject(problem('This browser cannot retain complete Portfolio working copies. Reopen the exported working file in a browser with IndexedDB.','PORTFOLIO_WORKING_COPY_STORAGE'));
    opening=new Promise((resolve,reject)=>{
      let settled=false;
      const request=indexedDB.open(DATABASE,1);
      const fail=error=>{if(settled)return;settled=true;opening=null;reject(error||problem('The Portfolio working-copy store could not open.','PORTFOLIO_WORKING_COPY_STORAGE'));};
      request.onupgradeneeded=()=>{
        const db=request.result;
        for(const name of TABLES)if(!db.objectStoreNames.contains(name)){
          const table=db.createObjectStore(name);
          if(name!=='collections')table.createIndex('namespace','namespace',{unique:false});
        }
      };
      request.onerror=()=>fail(request.error);
      request.onblocked=()=>fail(problem('Close the older Portfolio storage connection and reopen this desk.','PORTFOLIO_WORKING_COPY_STORAGE'));
      request.onsuccess=()=>{
        if(settled||closed){request.result.close();if(!settled)fail(problem('The Portfolio desk closed while storage was opening.','PORTFOLIO_WORKING_COPY_CLOSED'));return;}
        settled=true;database=request.result;
        database.onversionchange=()=>{database.close();database=null;opening=null;};
        resolve(database);
      };
    });
    return opening;
  }
  async function rawStorage(){
    const db=await openDatabase();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(TABLES,'readonly');
      const raw={schema:STORAGE_SCHEMA,namespace:key,collection:null,copies:[],checkpoints:[],lineage:[]};
      tx.oncomplete=()=>resolve(raw);
      tx.onabort=tx.onerror=()=>reject(tx.error||problem('The complete Portfolio copies could not be read.','PORTFOLIO_WORKING_COPY_STORAGE'));
      const manifest=tx.objectStore('collections').get(key);manifest.onsuccess=()=>{raw.collection=manifest.result??null;};
      for(const name of TABLES.slice(1)){const request=tx.objectStore(name).index('namespace').getAll(key);request.onsuccess=()=>{raw[name]=request.result;};}
    });
  }
  async function checkedSession(value){
    const original=jsonCopy(value),checked=await validateSession(jsonCopy(original));
    need(same(original,checked),'The Portfolio validator must preserve every original field and value.');
    return freeze(original);
  }
  async function checkedCopy(input,depth=0){
    need(depth<=64,'The complete copy lineage is too deeply nested to receive.');
    const copy=jsonCopy(input);
    keys(copy,['id','name','createdAt','updatedAt','archived','head','checkpoints','lineage'],'Retain the complete named copy, source, checkpoints and lineage.');
    identifier(copy.id);label(copy.name);timestamp(copy.createdAt);timestamp(copy.updatedAt);
    need(typeof copy.archived==='boolean','Retain the working-copy archive state.');
    copy.head=await checkedSession(copy.head);
    need(Array.isArray(copy.checkpoints)&&Array.isArray(copy.lineage),'Retain complete checkpoint and lineage arrays.');
    const checkpointIds=new Set(),lineageIds=new Set();
    for(const checkpoint of copy.checkpoints){
      keys(checkpoint,['id','createdAt','label','session'],'Retain each whole immutable checkpoint.');
      identifier(checkpoint.id);timestamp(checkpoint.createdAt);label(checkpoint.label,'checkpoint label');
      need(!checkpointIds.has(checkpoint.id),'Checkpoint identities must be distinct.');checkpointIds.add(checkpoint.id);
      checkpoint.session=await checkedSession(checkpoint.session);
    }
    for(const origin of copy.lineage){
      keys(origin,['id','kind','createdAt','sourceCheckpointId','sourceCopy'],'Retain complete source-copy lineage.');
      identifier(origin.id);timestamp(origin.createdAt);
      need(['import','copy-fork','checkpoint-fork'].includes(origin.kind)&&!lineageIds.has(origin.id),'Retain the original kind and distinct identity of this lineage.');lineageIds.add(origin.id);
      origin.sourceCopy=await checkedCopy(origin.sourceCopy,depth+1);
      if(origin.sourceCheckpointId!==null){identifier(origin.sourceCheckpointId);need(origin.sourceCopy.checkpoints.some(c=>c.id===origin.sourceCheckpointId),'The source checkpoint is absent from its original copy.');}
      need((origin.kind==='checkpoint-fork')===(origin.sourceCheckpointId!==null),'Retain the exact checkpoint-fork selection.');
    }
    return freeze(copy);
  }
  async function decodeStorage(raw){
    if(raw.collection===null){need(!raw.copies.length&&!raw.checkpoints.length&&!raw.lineage.length,'The saved copy index is missing. Download the complete retained storage to recover its original copies.');return freeze(empty());}
    const meta=raw.collection;
    keys(meta,['schema','revision','selectedCopyId','copyIds'],'Retain the complete original copy index.');
    need(meta.schema===PORTFOLIO_WORKING_COPIES_SCHEMA&&Number.isSafeInteger(meta.revision)&&meta.revision>=1&&Array.isArray(meta.copyIds),'Retain the saved copy index schema and revision.');
    need(new Set(meta.copyIds).size===meta.copyIds.length,'The saved copy index contains repeated identities.');
    meta.copyIds.forEach(identifier);
    const rows=new Map(),checkpoints=new Map(),origins=new Map();
    for(const row of raw.copies){keys(row,['namespace','copy'],'Retain each complete stored copy.');need(row.namespace===key&&object(row.copy),'The copy namespace changed.');identifier(row.copy.id);need(!rows.has(row.copy.id),'A stored copy identity repeats.');rows.set(row.copy.id,row.copy);}
    for(const row of raw.checkpoints){keys(row,['namespace','copyId','checkpoint'],'Retain each complete stored checkpoint.');need(row.namespace===key&&object(row.checkpoint),'The checkpoint namespace changed.');identifier(row.copyId);identifier(row.checkpoint.id);const k=row.copyId+':'+row.checkpoint.id;need(!checkpoints.has(k),'A stored checkpoint identity repeats.');checkpoints.set(k,row.checkpoint);}
    for(const row of raw.lineage){keys(row,['namespace','copyId','lineage'],'Retain each complete stored lineage.');need(row.namespace===key&&object(row.lineage),'The lineage namespace changed.');identifier(row.copyId);identifier(row.lineage.id);const k=row.copyId+':'+row.lineage.id;need(!origins.has(k),'A stored lineage identity repeats.');origins.set(k,row.lineage);}
    need(rows.size===meta.copyIds.length&&meta.copyIds.every(id=>rows.has(id)),'The saved copy index and complete copies differ. Download their complete retained storage.');
    const copies=[];
    for(const id of meta.copyIds){
      const stored=rows.get(id),copy=jsonCopy(stored);
      need(Array.isArray(copy.checkpoints)&&Array.isArray(copy.lineage),'The stored copy is missing its checkpoint or lineage index.');
      copy.checkpoints=copy.checkpoints.map(short=>{
        keys(short,['id','createdAt','label'],'Retain the checkpoint index.');const k=id+':'+short.id,full=checkpoints.get(k);
        need(full&&full.createdAt===short.createdAt&&full.label===short.label,'A whole checkpoint differs from its retained index.');checkpoints.delete(k);return full;
      });
      copy.lineage=copy.lineage.map(short=>{
        keys(short,['id','kind','createdAt','sourceCopyId','sourceCheckpointId'],'Retain the lineage index.');const k=id+':'+short.id,full=origins.get(k);
        need(full&&full.kind===short.kind&&full.createdAt===short.createdAt&&full.sourceCopy?.id===short.sourceCopyId&&full.sourceCheckpointId===short.sourceCheckpointId,'A complete lineage differs from its retained index.');origins.delete(k);return full;
      });
      copies.push(await checkedCopy(copy));
    }
    need(!checkpoints.size&&!origins.size,'Saved checkpoints or lineage are absent from the copy index. Download complete retained storage.');
    need(meta.selectedCopyId===null||copies.some(c=>c.id===meta.selectedCopyId&&!c.archived),'The selected copy is absent or archived.');
    return freeze({schema:PORTFOLIO_WORKING_COPIES_SCHEMA,revision:meta.revision,selectedCopyId:meta.selectedCopyId,copies});
  }
  async function loadCurrent(){
    let raw;
    try{raw=await rawStorage();const decoded=await decodeStorage(raw);collection=decoded;readFailure=null;return decoded;}
    catch(error){readFailure=error;if(raw)error.recovery=freeze(raw);throw error;}
  }
  function ready(){if(readFailure)throw problem('The retained Portfolio copies need recovery. Download complete storage or reload a repaired copy before saving.','PORTFOLIO_WORKING_COPY_RECOVERY');need(collection,'Open the original Portfolio working-copy collection before saving.');return collection;}
  function selected(id,basis=ready()){identifier(id);const copy=basis.copies.find(c=>c.id===id);need(copy,'The selected working copy is absent.');return copy;}
  function nextId(){
    const id=identifier(makeId()),all=ready().copies;
    need(!all.some(c=>c.id===id||c.checkpoints.some(p=>p.id===id)||c.lineage.some(p=>p.id===id)),'The generated working-copy identity already exists.');
    return id;
  }
  function currentTime(){return timestamp(now());}
  async function commit(basis,next,{copies=[],checkpoints=[],lineage=[]}={}){
    need(Number.isSafeInteger(basis.revision+1),'The working-copy revision exceeds the supported integer range.');
    next={...next,revision:basis.revision+1};freeze(next);
    const db=await openDatabase();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(TABLES,'readwrite');let failure=null;
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(failure||tx.error||problem('The complete Portfolio working copy could not be saved.','PORTFOLIO_WORKING_COPY_STORAGE'));
      const request=tx.objectStore('collections').get(key);
      request.onsuccess=()=>{
        try{
          const actual=request.result;
          if((actual?.revision??0)!==basis.revision||(actual&&actual.schema!==PORTFOLIO_WORKING_COPIES_SCHEMA)){
            failure=problem('Another page changed these Portfolio working copies. Download the current working file, then reload the stored collection before continuing.','PORTFOLIO_WORKING_COPY_CONFLICT');
            failure.expectedRevision=basis.revision;failure.actualRevision=actual?.revision??0;tx.abort();return;
          }
          for(const copy of copies)tx.objectStore('copies').put(rowForCopy(key,copy),[key,copy.id]);
          for(const {copyId,checkpoint} of checkpoints)tx.objectStore('checkpoints').add({namespace:key,copyId,checkpoint},[key,copyId,checkpoint.id]);
          for(const {copyId,lineage:origin} of lineage)tx.objectStore('lineage').add({namespace:key,copyId,lineage:origin},[key,copyId,origin.id]);
          tx.objectStore('collections').put(metadata(next),key);
        }catch(error){failure=error;tx.abort();}
      };
    });
    collection=next;return next;
  }
  function result(next,id){return freeze({collection:next,copy:id===null?null:next.copies.find(c=>c.id===id)});}
  async function replaceCopy(basis,copy,{checkpoints=[],lineage=[],selectedCopyId=basis.selectedCopyId}={}){
    const next=await commit(basis,{...basis,selectedCopyId,copies:basis.copies.map(c=>c.id===copy.id?copy:c)},
      {copies:[copy],checkpoints:checkpoints.map(checkpoint=>({copyId:copy.id,checkpoint})),lineage:lineage.map(origin=>({copyId:copy.id,lineage:origin}))});
    return result(next,copy.id);
  }
  async function createInternal({name,session,sourceCopy=null,sourceCheckpointId=null,kind='copy-fork'}){
    const basis=ready(),head=await checkedSession(session);label(name);
    const createdAt=currentTime(),id=nextId(),lineage=[];
    if(sourceCopy){
      const origin={id:nextId(),kind,createdAt,sourceCheckpointId,sourceCopy};
      need(origin.id!==id,'Generate separate copy and lineage identities.');lineage.push(freeze(origin));
    }
    const copy=freeze({id,name,createdAt,updatedAt:createdAt,archived:false,head,checkpoints:[],lineage});
    const next=await commit(basis,{...basis,selectedCopyId:id,copies:[...basis.copies,copy]},
      {copies:[copy],lineage:lineage.map(origin=>({copyId:id,lineage:origin}))});
    return result(next,id);
  }
  return {
    open(){return enqueue(()=>collection&&!readFailure?collection:loadCurrent());},
    read(){return enqueue(loadCurrent);},
    readRaw(){return enqueue(async()=>freeze(await rawStorage()));},
    snapshot(){return ready();},
    create(value){
      const input=jsonCopy(value);
      return enqueue(async()=>{
        need(object(input),'Choose a named complete working session.');
        const sourceCopy=input.fromCopyId?selected(input.fromCopyId):null;
        let session=input.session,sourceCheckpointId=input.fromCheckpointId??null;
        if(sourceCheckpointId!==null){
          need(sourceCopy,'Choose the original copy for this checkpoint.');
          const cp=sourceCopy.checkpoints.find(c=>c.id===sourceCheckpointId);need(cp,'The original checkpoint is absent.');
          need(same(session,cp.session),'A checkpoint fork must keep its exact original session.');
        }
        return createInternal({name:input.name,session,sourceCopy,sourceCheckpointId,kind:sourceCheckpointId===null?'copy-fork':'checkpoint-fork'});
      });
    },
    updateHead(copyId,session){
      const input=jsonCopy(session);
      return enqueue(async()=>{const basis=ready(),copy=selected(copyId,basis);need(!copy.archived,'Restore this archived working copy before editing.');
        const head=await checkedSession(input);return replaceCopy(basis,freeze({...copy,updatedAt:currentTime(),head}));
      });
    },
    checkpoint(copyId,value){
      const input=jsonCopy(value);
      return enqueue(async()=>{const basis=ready(),copy=selected(copyId,basis);need(!copy.archived,'Restore this archived working copy before saving a checkpoint.');
        label(input.label,'checkpoint label');const session=await checkedSession(input.session),createdAt=currentTime();
        const checkpoint=freeze({id:nextId(),createdAt,label:input.label,session});
        return replaceCopy(basis,freeze({...copy,updatedAt:createdAt,head:session,checkpoints:[...copy.checkpoints,checkpoint]}),{checkpoints:[checkpoint]});
      });
    },
    rename(copyId,name){
      return enqueue(async()=>{label(name);const basis=ready(),copy=selected(copyId,basis);return replaceCopy(basis,freeze({...copy,name,updatedAt:currentTime()}));});
    },
    setArchived(copyId,archived){
      return enqueue(async()=>{need(typeof archived==='boolean','Choose the explicit archive state.');const basis=ready(),copy=selected(copyId,basis);
        const selectedCopyId=archived&&basis.selectedCopyId===copyId?(basis.copies.find(c=>c.id!==copyId&&!c.archived)?.id??null):basis.selectedCopyId;
        return replaceCopy(basis,freeze({...copy,archived,updatedAt:currentTime()}),{selectedCopyId});
      });
    },
    select(copyId){
      return enqueue(async()=>{const basis=ready(),copy=selected(copyId,basis);need(!copy.archived,'Restore this archived working copy before selecting it.');
        const next=await commit(basis,{...basis,selectedCopyId:copyId});return result(next,copyId);
      });
    },
    forkCheckpoint(copyId,checkpointId,{name}={}){
      return enqueue(async()=>{const copy=selected(copyId),checkpoint=copy.checkpoints.find(c=>c.id===checkpointId);need(checkpoint,'The original checkpoint is absent.');
        return createInternal({name,session:checkpoint.session,sourceCopy:copy,sourceCheckpointId:checkpointId,kind:'checkpoint-fork'});
      });
    },
    exportCopy(copyId){
      return enqueue(()=>{const copy=selected(copyId);return freeze({schema:PORTFOLIO_WORKING_COPY_SCHEMA,exportedAt:currentTime(),copy});});
    },
    importCopy(portable,{name}={}){
      const input=jsonCopy(portable);
      return enqueue(async()=>{
        keys(input,['schema','exportedAt','copy'],'Open one complete exported Portfolio working copy.');
        need(input.schema===PORTFOLIO_WORKING_COPY_SCHEMA,'Open a Portfolio working-copy file.');timestamp(input.exportedAt);
        const original=await checkedCopy(input.copy);
        return createInternal({name:name??original.name,session:original.head,sourceCopy:original,kind:'import'});
      });
    },
    flush(){return queue;},
    async close(){if(closed)return;closing=true;await queue.catch(()=>{});closed=true;if(database)database.close();database=null;opening=null;}
  };
}
