// MIT. Workspace-scoped complete authoring drafts with atomic concurrent-edit protection.
import {validateProgrammeDraft} from './programme-authoring.mjs';
export async function openProgrammeDraftStore(workspaceId,{indexedDB=globalThis.indexedDB}={}){
 if(typeof workspaceId!=='string'||!workspaceId.trim())throw new Error('Open the original workspace before saving a source draft.');
 if(!indexedDB)throw new Error('Browser draft storage is unavailable. Download the complete source draft to retain your edits.');
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('flowable-programme-source-drafts',1);
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'key'});store.createIndex('workspaceId','workspaceId');};
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close another tab that is upgrading the source draft store.'));
  request.onsuccess=()=>resolve(request.result);
 });
 db.onversionchange=()=>db.close();
 const key=id=>JSON.stringify([workspaceId,id]);
 function transaction(mode,perform){
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('drafts',mode),store=tx.objectStore('drafts');let result,error;
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error??tx.error);tx.onabort=()=>reject(error??tx.error??new Error('Source draft transaction stopped.'));
   const fail=value=>{error=value;tx.abort();};
   try{perform(store,value=>{result=value;},fail);}catch(value){fail(value);}
  });
 }
 return{
  async list(){return transaction('readonly',(store,result)=>{const request=store.index('workspaceId').getAll(workspaceId);request.onsuccess=()=>result(request.result.map(row=>({
   id:row.draft.id,title:row.draft.title,kind:row.draft.kind,revision:row.revision,updatedAt:row.updatedAt})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));});},
  async read(id){return transaction('readonly',(store,result)=>{const request=store.get(key(id));request.onsuccess=()=>result(request.result??null);});},
  async save(draft,expectedRevision){
   const selected=validateProgrammeDraft(draft);
   return transaction('readwrite',(store,result,fail)=>{
    const request=store.get(key(selected.id));request.onsuccess=()=>{
     const previous=request.result,current=previous?.revision??0;
     if(current!==expectedRevision){fail(Object.assign(new Error('This source draft changed in another tab. Download your edits or save a new copy, then reopen the saved edition.'),{code:'PROGRAMME_DRAFT_CONFLICT'}));return;}
     const row={key:key(selected.id),workspaceId,revision:current+1,updatedAt:new Date().toISOString(),draft:selected};
     store.put(row);result(row);
    };
   });
  },
  close(){db.close();}
 };
}
