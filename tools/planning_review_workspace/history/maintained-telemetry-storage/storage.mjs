/* MIT. Immutable compact workspace objects and atomic browser head/proposal storage.
   Adapted from the maintained catalog IndexedDB transaction/branch pattern.
   Every proposal is retained in the same transaction that compares the head;
   a conflicting proposal never overwrites the other tab's active head. */
export function createTelemetryStore(S,A,runtime,options={}){
 const factory=options.indexedDB??globalThis.indexedDB,dbName=options.dbName||"commons-telemetry-operator-v2";
 const id=options.id||(()=>crypto.randomUUID()),now=options.now||(()=>new Date().toISOString());
 const hash=t=>runtime.sha256(runtime.encode(t)),clone=x=>JSON.parse(JSON.stringify(x));
 const objectCache=new WeakMap(),openedObjects=new Map();
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 function describe(session){
  S.validate(session);
  const objects=new Map();
  function ref(w){w=S.checkedWorkspace(w);let object=objectCache.get(w);if(!object){const archive=A.serialize(w);object={id:w.rootSha256,content:archive.content,sha256:archive.sha256,bytes:archive.bytes,workspaceBytes:archive.workspace.bytes,workspaceSha256:archive.workspace.sha256};objectCache.set(w,object);}
   const previous=objects.get(object.id);need(!previous||previous.sha256===object.sha256,"Workspace root has conflicting complete content");objects.set(object.id,object);return {$workspace:object.id};}
  const body=clone({...session,workspace:ref(session.workspace),backups:session.backups.map(b=>({...b,snapshot:{...b.snapshot,workspace:ref(b.snapshot.workspace)}}))});
  const text=JSON.stringify(body);return {body,sha256:hash(text),bytes:runtime.encode(text).length,objects:[...objects.values()]};
 }
 function validateRecord(record){need(record&&record.schema==="commons.telemetry-browser-revision.v1"&&typeof record.id==="string"&&typeof record.copyId==="string"&&typeof record.at==="string"&&record.body&&Array.isArray(record.objects),"Complete browser revision required");need(hash(JSON.stringify(record.body))===record.sha256,"Browser revision metadata differs");return record;}
 function restore(record,objects){
  validateRecord(record);const map=new Map(objects.map(o=>[o.id,o]));
  function workspace(ref){need(ref&&typeof ref.$workspace==="string"&&Object.keys(ref).length===1,"Invalid stored workspace reference");const o=map.get(ref.$workspace),binding=record.objects.find(x=>x.id===ref.$workspace);need(o&&binding&&o.sha256===binding.sha256&&o.bytes===binding.bytes&&o.workspaceSha256===binding.workspaceSha256,"Stored workspace object is missing or has a conflicting binding");need(runtime.encode(o.content).length===o.bytes&&hash(o.content)===o.sha256,"Complete stored workspace bytes changed");let cached=openedObjects.get(o.id);if(cached?.sha256===o.sha256)return cached.workspace;const w=A.receive(o.content);need(w.rootSha256===o.id,"Stored workspace has a different root");openedObjects.set(o.id,{sha256:o.sha256,workspace:w});objectCache.set(w,o);while(openedObjects.size>8)openedObjects.delete(openedObjects.keys().next().value);return w;}
  const result=clone(record.body);result.workspace=workspace(result.workspace);for(const b of result.backups)b.snapshot.workspace=workspace(b.snapshot.workspace);return S.validate(result);
 }
 function open(){return new Promise((resolve,reject)=>{if(!factory){reject(Error("IndexedDB is unavailable. Your complete working copy remains open for download."));return;}const q=factory.open(dbName,1);q.onupgradeneeded=()=>{for(const name of ["objects","identities","revisions","copies","settings"])if(!q.result.objectStoreNames.contains(name))q.result.createObjectStore(name,{keyPath:"id"});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error||Error("Browser storage could not open"));q.onblocked=()=>reject(Error("Close older telemetry tabs to upgrade browser storage"));});}
 function transaction(db,names,mode,body){return new Promise((resolve,reject)=>{let tx,answer,failure;try{tx=db.transaction(names,mode);body(tx,v=>{answer=v;},e=>{failure=e;try{tx.abort();}catch{}});}catch(e){db.close();reject(e);return;}tx.oncomplete=()=>{db.close();resolve(answer);};tx.onerror=tx.onabort=()=>{db.close();reject(failure||tx.error||Error("Browser storage did not commit; keep this tab open and download the complete copy."));};});}
 async function save(session,{copyId,expectedHead=null,owner,kind="save",setActive=true}={}){
  need(typeof copyId==="string"&&copyId&&typeof owner==="string"&&owner,"Copy and browser instance identity required");
  const prepared=describe(session),title=session.workspace.initial.title,revision={schema:"commons.telemetry-browser-revision.v1",id:id(),copyId,parent:expectedHead,owner,kind,at:now(),body:prepared.body,sha256:prepared.sha256,metadataBytes:prepared.bytes,objects:prepared.objects.map(({content,...meta})=>meta)};
  const db=await open();return transaction(db,["objects","identities","revisions","copies","settings"],"readwrite",(tx,done,fail)=>{
   let pending=prepared.objects.length+1,head=null;
   const proceed=()=>{if(--pending)return;try{
    const conflict=(head?.head??null)!==expectedHead;
    tx.objectStore("revisions").add({...revision,publication:conflict?"conflict":"head"});
    if(!conflict){const next={id:copyId,head:revision.id,title,updatedAt:revision.at,owner};tx.objectStore("copies").put(next);if(setActive)tx.objectStore("settings").put({id:"active",copyId});head=next;}
    done({conflict,copyId,head:head?.head??null,revisionId:revision.id,metadataBytes:prepared.bytes,storedObjects:prepared.objects.length});
   }catch(e){fail(e);}};
   const h=tx.objectStore("copies").get(copyId);h.onsuccess=()=>{head=h.result||null;proceed();};
   for(const object of prepared.objects){const q=tx.objectStore("identities").get(object.id);q.onsuccess=()=>{try{const prior=q.result;if(prior)need(prior.sha256===object.sha256&&prior.workspaceSha256===object.workspaceSha256&&prior.bytes===object.bytes,"A complete workspace identity already has different content");else{tx.objectStore("objects").add(object);const {content,...identity}=object;tx.objectStore("identities").add(identity);}proceed();}catch(e){fail(e);}};}
  });
 }
 async function loadRevision(revisionId){const db=await open();const result=await transaction(db,["revisions","objects"],"readonly",(tx,done,fail)=>{const q=tx.objectStore("revisions").get(revisionId);q.onsuccess=()=>{try{const record=q.result;need(record,"Selected browser revision is missing");validateRecord(record);const objects=[];let pending=record.objects.length;if(!pending){done({record,objects});return;}for(const ref of record.objects){const get=tx.objectStore("objects").get(ref.id);get.onsuccess=()=>{objects.push(get.result);if(--pending===0)done({record,objects});};}}catch(e){fail(e);}};});return {...result,session:restore(result.record,result.objects)};}
 async function readCopy(copyId){const db=await open();const record=await transaction(db,["copies","settings"],"readonly",(tx,done)=>{function get(id){if(!id){done(null);return;}const q=tx.objectStore("copies").get(id);q.onsuccess=()=>done(q.result||null);}if(copyId)get(copyId);else{const q=tx.objectStore("settings").get("active");q.onsuccess=()=>get(q.result?.copyId);}});if(!record)return null;return {...record,...await loadRevision(record.head)};}
 async function list(){const db=await open();return transaction(db,["copies","revisions"],"readonly",(tx,done)=>{const copies=[],revisions=[];let pending=2;const finish=()=>{if(--pending===0)done({copies,revisions:revisions.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0)});};for(const [name,out]of [["copies",copies],["revisions",revisions]]){const q=tx.objectStore(name).openCursor();q.onsuccess=()=>{const cursor=q.result;if(!cursor){finish();return;}const r=cursor.value;out.push(name==="revisions"?{id:r.id,copyId:r.copyId,parent:r.parent,owner:r.owner,kind:r.kind,at:r.at,publication:r.publication,title:r.body?.workspace?.$workspace,metadataBytes:r.metadataBytes}:r);cursor.continue();};}});}
 return {describe,restore,save,readCopy,loadRevision,list,dbName};
}
