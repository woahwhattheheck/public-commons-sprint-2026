// MIT. Complete editable Gateway intake; optimistic revisions prevent silent tab overwrite.
const DATABASE='tyk-gateway-commissioning-drafts',STORE='drafts';
function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});
  request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});}
export async function readGatewayDraft(key){const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get(key);
  request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});}finally{db.close();}}
export async function saveGatewayDraft(key,value,expectedRevision){const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let result,error;
  const request=store.get(key);request.onsuccess=()=>{const prior=request.result;
    if((prior?.revision??0)!==expectedRevision){error=Object.assign(new Error('Another tab saved this intake. Download your working copy, then reopen the saved draft.'),{code:'GATEWAY_DRAFT_CONFLICT'});tx.abort();return;}
    result={key,revision:expectedRevision+1,savedAt:new Date().toISOString(),value};store.put(result);};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error??tx.error??new Error('Draft save was interrupted.'));tx.onerror=()=>{};});}finally{db.close();}}

export async function listGatewayDrafts(prefix){const db=await database();try{return await new Promise((resolve,reject)=>{
  const values=[],tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).openCursor();
  request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(values);return;}
    if(cursor.key.startsWith(prefix))values.push(cursor.value);cursor.continue();};request.onerror=()=>reject(request.error);
});}finally{db.close();}}
