/** Durable original Economic requests; shared by the native Economic and field-cost desks. */
const DB='upstate-economic-request-recovery',STORE='records',VERSION=1;
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const SHA=/^[a-f0-9]{64}$/;
async function hash(value){const body=new TextEncoder().encode(canonical(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),b=>b.toString(16).padStart(2,'0')).join('');}
function identityError(message){const error=Error(message);error.code='ECONOMIC_RECOVERY_IDENTITY';return error;}
function openDB(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(Error('Persistent browser request storage is unavailable.'));return;}const request=indexedDB.open(DB,VERSION);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});};request.onerror=()=>reject(request.error||Error('Persistent request storage could not open.'));request.onblocked=()=>reject(Error('Close an older Economic browser tab to upgrade its persistent request storage.'));request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};});}
function tx(db,mode){try{return db.transaction(STORE,mode,{durability:mode==='readwrite'?'strict':'default'});}catch{return db.transaction(STORE,mode);}}
async function get(key){const db=await openDB();try{return await new Promise((resolve,reject)=>{const t=tx(db,'readonly'),request=t.objectStore(STORE).get(key);let value;request.onsuccess=()=>{value=request.result||null;};t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error||request.error||Error('Original request read failed.'));t.onabort=()=>reject(t.error||Error('Original request read was interrupted.'));});}finally{db.close();}}
async function put(records,requestRecord){const db=await openDB();try{return await new Promise((resolve,reject)=>{const t=tx(db,'readwrite'),store=t.objectStore(STORE);let failure=null;
 const write=()=>{const stateRecord=records[0],read=store.get(stateRecord.key);read.onsuccess=()=>{const old=read.result?.body,prior=pendingOf(old),next=pendingOf(stateRecord.body),finished=stateRecord.body.lastReceipt?.operation_id||stateRecord.body.receipt?.request?.operation_id||stateRecord.body.retiredRequest?.operation_id;if(prior?.operation_id&&prior.operation_id!==next?.operation_id&&prior.operation_id!==finished&&!['failed','cancelled'].includes(prior.state)){failure=identityError('Another original request is retained for this desk. Reopen and recover it before replacing its browser state.');t.abort();return;}for(const record of records)store.put(record);};};
 if(requestRecord){const existing=store.get(requestRecord.key);existing.onsuccess=()=>{if(existing.result&&existing.result.sha256!==requestRecord.sha256){failure=identityError('This original operation ID already retains a different payload.');t.abort();return;}if(!existing.result)store.put(requestRecord);write();};}else write();
 t.oncomplete=()=>resolve();t.onerror=()=>reject(failure||t.error||Error('Persistent original request write failed.'));t.onabort=()=>reject(failure||t.error||Error('Original request write was interrupted.'));
 });}finally{db.close();}}
async function verified(record,key,workspace,owner){if(!record||record.key!==key||record.workspace!==workspace||record.owner!==owner||!SHA.test(record.sha256||'')||await hash(record.body)!==record.sha256)throw identityError('The retained original browser record has a different identity or bytes.');return clone(record.body);}
function pendingOf(state){return state?.pendingRequest||state?.pending||null;}
function envelope(pending,workspace){if(!pending||pending.legacy)return null;if(typeof pending.operation_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(pending.operation_id)||!['economic.draft.save','economic.edition.build','implementation.cost-review.apply','economic.comparison.build'].includes(pending.action)||!pending.payload||typeof pending.payload!=='object'||Array.isArray(pending.payload)||(pending.workspace&&pending.workspace!==workspace))throw Error('The original Economic request is incomplete or belongs to another Workspace.');return {workspace,action:pending.action,operation_id:pending.operation_id,payload:clone(pending.payload)};}
export function createEconomicRecoveryStore(workspace,owner,localKey){
 if(typeof workspace!=='string'||!workspace||typeof owner!=='string'||!owner)throw Error('Choose the original Workspace and Economic desk before retaining requests.');
 const stateKey=JSON.stringify(['state',workspace,owner]);let chain=Promise.resolve(),fileOriginalHash=null,lastWarning='';
 const requestKey=id=>JSON.stringify(['request',workspace,owner,id]);
 async function record(key,body){return {schema:'upstate.economic-browser-record/v1',key,workspace,owner,sha256:await hash(body),body};}
 function pointer(record,pending){return {schema:'upstate.economic-browser-pointer/v1',workspace_key:workspace,owner,state_key:stateKey,sha256:record.sha256,pending:pending?{id:pending.id||null,operation_id:pending.operation_id||null,action:pending.action||null}:null};}
 async function readOriginal(ref){if(!ref||!SHA.test(ref.sha256||'')||ref.key!==requestKey(ref.operation_id))throw Error('The original request pointer is invalid.');const r=await get(ref.key);if(r?.sha256!==ref.sha256)throw Error('The original request differs from its retained payload hash.');return verified(r,ref.key,workspace,owner);}
 async function hydrate(body){
  for(const name of ['pendingRequest','pending']){const p=body?.[name];if(p?.request_ref){const original=await readOriginal(p.request_ref);if(original.operation_id!==p.operation_id||original.action!==p.action||original.workspace!==workspace)throw Error('The saved state names a different original request.');body[name]={...p,workspace,payload:original.payload};delete body[name].request_ref;}}
  return body;
 }
 async function load(){
  lastWarning='';let local=null;try{local=JSON.parse(localStorage.getItem(localKey)||'null');}catch(error){lastWarning='The compact browser pointer could not be read: '+error.message;}
  let retained=null;try{retained=await get(stateKey);}catch(error){lastWarning=error.message||String(error);}
  if(retained)return {state:await hydrate(await verified(retained,stateKey,workspace,owner)),warning:lastWarning};
  if(local?.schema==='upstate.economic-browser-pointer/v1'){if(local.workspace_key!==workspace||local.owner!==owner)throw Error('The retained request pointer belongs to another desk or Workspace.');throw Error(lastWarning||'The retained original request body is unavailable. Open its exported recovery file.');}
  if(local){if(typeof local!=='object'||Array.isArray(local)||(local.workspace_key&&local.workspace_key!==workspace))throw Error('The retained Economic browser state belongs to another Workspace or is invalid.');return {state:clone(local),warning:lastWarning};}
  return {state:null,warning:lastWarning};
 }
 async function saveNow(value){
  const state=clone(value),p=pendingOf(state),original=envelope(p,workspace),originalHash=original?await hash(original):null;
  let requestRecord=null;
  if(original){requestRecord=await record(requestKey(original.operation_id),original);for(const name of ['pendingRequest','pending'])if(state[name]){state[name]={...state[name],request_ref:{key:requestRecord.key,operation_id:original.operation_id,sha256:requestRecord.sha256}};delete state[name].payload;}}
  const stateRecord=await record(stateKey,state);
  try{
   await put([stateRecord],requestRecord);
   try{localStorage.setItem(localKey,JSON.stringify(pointer(stateRecord,p)));lastWarning='';}catch{lastWarning='The compact browser pointer could not be written. The complete original state remains in persistent browser storage for this Workspace.';}
   return {stored:true,file_backed:false,warning:lastWarning};
  }catch(error){
   if(error.code==='ECONOMIC_RECOVERY_IDENTITY')throw error;
   if(originalHash&&fileOriginalHash===originalHash){lastWarning='Browser storage is unavailable. Recovery is using the exact original file you opened; retain that file and download the latest completion before closing.';return {stored:false,file_backed:true,warning:lastWarning};}
   throw Error((error.message||String(error))+' Download the exact recovery file, then open that saved file to continue the same original request.');
  }
 }
 function save(value){const snapshot=clone(value);const operation=chain.catch(()=>{}).then(()=>saveNow(snapshot));chain=operation;return operation;}
 async function verifyRequest(pending){
  const original=envelope(pending,workspace);if(!original)throw Error('Recover the original native task before submitting a legacy request.');
  const expected=await hash(original);
  try{const r=await get(requestKey(original.operation_id));if(!r)throw Error('The original persistent request is unavailable.');const body=await verified(r,requestKey(original.operation_id),workspace,owner);if(r.sha256!==expected||canonical(body)!==canonical(original))throw identityError('The stored original request differs from the selected source payload.');return clone(body);}
  catch(error){if(error.code==='ECONOMIC_RECOVERY_IDENTITY')throw error;if(fileOriginalHash===expected)return clone(original);throw error;}
 }
 async function exportFile(state){const body=clone(state);return {schema:'upstate.economic-browser-recovery/v1',workspace_key:workspace,owner,sha256:await hash(body),state:body};}
 async function importFile(value,currentPending=null){
  if(value?.schema!=='upstate.economic-browser-recovery/v1'||value.workspace_key!==workspace||value.owner!==owner||!SHA.test(value.sha256||'')||await hash(value.state)!==value.sha256)throw Error('Choose an unchanged original Economic recovery file for this desk and Workspace.');
  const incoming=pendingOf(value.state),original=envelope(incoming,workspace);
  if(currentPending){const existing=envelope(currentPending,workspace);if(!existing||!original||canonical(existing)!==canonical(original))throw Error('Recover the currently retained original request before opening another recovery file.');}
  fileOriginalHash=original?await hash(original):null;
  try{await save(value.state);}catch(error){if(error.code==='ECONOMIC_RECOVERY_IDENTITY')throw error;lastWarning=original?'Browser storage is unavailable. Recovery uses the exact original file you opened.':'Browser storage is unavailable. The verified recovery file is open for review; new requests still require their complete original identity to be retained.';}
  return clone(value.state);
 }
 return {load,save,verifyRequest,exportFile,importFile,get warning(){return lastWarning;}};
}
