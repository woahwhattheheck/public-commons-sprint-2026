import * as Portable from './portable.mjs';
const NAME='commons.audit-migration.offline.v1';
let opening=null;
function database(){if(!opening)opening=new Promise((resolve,reject)=>{const request=indexedDB.open(NAME,1);request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('copies',{keyPath:'key'});db.createObjectStore('drafts',{keyPath:'key'});};request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close an older Audit Source Workspace page so this browser can open its saved work.'));});return opening;}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function completed(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('The saved-work transaction was aborted.'));tx.onerror=()=>{};});}
function copyRow(key,workspace,selection,createdAt){return {key,workspace,selection,head:Portable.head(workspace),revision:workspace.revision,createdAt:createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};}
function draftKey(copy,tab,form){return JSON.stringify([copy,tab,form]);}
export async function listCopies(){const db=await database(),tx=db.transaction('copies','readonly'),done=completed(tx),rows=await request(tx.objectStore('copies').getAll());await done;return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export async function readCopy(key){const db=await database(),tx=db.transaction('copies','readonly'),done=completed(tx),row=await request(tx.objectStore('copies').get(key));await done;return row||null;}
export async function createCopy(key,workspace,selection={},tab=null,drafts={}){
  const row=copyRow(key,workspace,selection);const db=await database(),tx=db.transaction(['copies','drafts'],'readwrite'),done=completed(tx);tx.objectStore('copies').add(row);
  if(tab)for(const [form,value]of Object.entries(drafts))tx.objectStore('drafts').put({key:draftKey(key,tab,form),copy:key,tab,form,value,updatedAt:row.updatedAt});
  await done;return row;
}
export async function commitCopy({key,expectedHead,workspace,selection,tab,submitted={}}){
  const next=copyRow(key,workspace,selection),db=await database(),tx=db.transaction(['copies','drafts'],'readwrite'),done=completed(tx);let conflict=null;
  const copies=tx.objectStore('copies'),drafts=tx.objectStore('drafts'),get=copies.get(key);
  get.onsuccess=()=>{
    const current=get.result;if(!current||current.head!==expectedHead){conflict=Error('Another tab saved a different workspace revision. Your complete proposed branch and unfinished writing can be kept independently.');conflict.code='COPY_CONFLICT';tx.abort();return;}
    next.createdAt=current.createdAt;copies.put(next);
    for(const [form,value]of Object.entries(submitted)){const selected=drafts.get(draftKey(key,tab,form));selected.onsuccess=()=>{if(selected.result&&Portable.canonical(selected.result.value)===Portable.canonical(value))drafts.delete(selected.result.key);};}
  };
  try{await done;}catch(error){throw conflict||error;}return next;
}
export async function readDrafts(copy,tab){const db=await database(),tx=db.transaction('drafts','readonly'),done=completed(tx),rows=await request(tx.objectStore('drafts').getAll());await done;return Object.fromEntries(rows.filter(r=>r.copy===copy&&r.tab===tab).map(r=>[r.form,r.value]));}
export async function saveDraft(copy,tab,form,value){const db=await database(),tx=db.transaction('drafts','readwrite'),done=completed(tx);tx.objectStore('drafts').put({key:draftKey(copy,tab,form),copy,tab,form,value,updatedAt:new Date().toISOString()});await done;}
export async function clearDraft(copy,tab,form,expected){const db=await database(),tx=db.transaction('drafts','readwrite'),done=completed(tx),store=tx.objectStore('drafts'),get=store.get(draftKey(copy,tab,form));get.onsuccess=()=>{if(get.result&&(!expected||Portable.canonical(get.result.value)===Portable.canonical(expected)))store.delete(get.result.key);};await done;}
export async function mergeDrafts(copy,tab,incoming){
 const db=await database(),tx=db.transaction('drafts','readwrite'),done=completed(tx),store=tx.objectStore('drafts'),lineage='received-'+Portable.draftIdentity(incoming);let preserved=false;
 const preserve=()=>{if(preserved)return;preserved=true;for(const [form,value]of Object.entries(incoming))store.put({key:draftKey(copy,lineage,form),copy,tab:lineage,form,value,updatedAt:new Date().toISOString()});};
 for(const [form,value]of Object.entries(incoming)){const key=draftKey(copy,tab,form),get=store.get(key);get.onsuccess=()=>{if(!get.result)store.put({key,copy,tab,form,value,updatedAt:new Date().toISOString()});else if(Portable.canonical(get.result.value)!==Portable.canonical(value))preserve();};}
 await done;return readDrafts(copy,tab);
}
export async function draftSets(copy){const db=await database(),tx=db.transaction('drafts','readonly'),done=completed(tx),rows=await request(tx.objectStore('drafts').getAll());await done;const sets=new Map();for(const row of rows.filter(r=>r.copy===copy)){const item=sets.get(row.tab)||{tab:row.tab,updatedAt:row.updatedAt,drafts:{}};item.drafts[row.form]=row.value;if(row.updatedAt>item.updatedAt)item.updatedAt=row.updatedAt;sets.set(row.tab,item);}return [...sets.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
