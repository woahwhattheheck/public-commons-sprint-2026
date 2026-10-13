/** Complete drafts and exact original requests; one browser transaction owns each revision. */
export const DRAFT_SCHEMA='upstate.structural-study-working-copy/v1';
export const clone=value=>JSON.parse(JSON.stringify(value));
export const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])):row);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const ACTIONS=['structural-study.prepare','structural-study.run','structural-study.report'];
export function validateWorkingCopy(value,{projectId}={}) {
  if(!object(value)||value.schema!==DRAFT_SCHEMA||!object(value.project)||typeof value.project.id!=='string'||!object(value.draft))
    throw Error('Choose a complete structural-study working copy.');
  if(projectId&&value.project.id!==projectId)throw Error('Receive the complete original scientific project before opening this working copy.');
  const d=value.draft;
  if(typeof d.id!=='string'||!object(d.selection)||!Array.isArray(d.selection.cases)||!object(d.raw)||!Array.isArray(d.operations))
    throw Error('The full original selection, case list or request history is missing.');
  if(d.study!==null&&(!object(d.study)||typeof d.study.id!=='string'))
    throw Error('The retained original study identity is incomplete.');
  const ids=new Set();
  for(const op of d.operations){
    if(!object(op)||typeof op.operation_id!=='string'||ids.has(op.operation_id)||!object(op.request)||
      op.request.operation_id!==op.operation_id||!ACTIONS.includes(op.request.action)||!object(op.request.payload)||
      typeof op.request.workspace!=='string'||op.signature!==canonical(op.request))
      throw Error('A retained original request is incomplete, duplicated or changed.');
    ids.add(op.operation_id);
    if(op.request.action==='structural-study.prepare'){
      if(canonical(op.request.payload)!==canonical(d.selection))throw Error('The displayed selection differs from the retained original preparation request.');
    }else if(!d.study||op.request.payload.study_id!==d.study.id||Object.keys(op.request.payload).length!==1)
      throw Error('A retained native run or report request names a different original study.');
  }
  if(d.operations.length&&!d.frozen)throw Error('A copy with original command history must keep its study inputs frozen; make an explicit separate copy to edit.');
  if(d.frozen&&Object.keys(d.raw).some(k=>k!=='@json'))throw Error('A frozen study has unfinished input values outside its exact original selection.');
  return clone(value);
}
/** One transaction compares and replaces the entire copy; no localStorage read/write race. */
export function createStructuralStorage(indexedDB=globalThis.indexedDB) {
  let opening;
  function database(){
    if(!indexedDB)return Promise.reject(Error('This browser cannot retain a working copy. Download the visible copy before leaving; saving or building requires working browser storage.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('upstate-structural-studies-v1',1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('copies')){const store=db.createObjectStore('copies',{keyPath:'key'});store.createIndex('scope','scope',{unique:false});}};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=()=>{opening=null;reject(request.error||Error('Browser working-copy storage could not open.'));};
      request.onblocked=()=>{opening=null;reject(Error('Another tab is upgrading working-copy storage. Close that tab and reopen this structural study.'));};
    });
    return opening;
  }
  async function read(scope,id){
    const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('copies','readonly'),request=tx.objectStore('copies').get(scope+':'+id);
      request.onsuccess=()=>resolve(request.result?clone(request.result):null);request.onerror=()=>reject(request.error);});
  }
  async function list(scope){
    const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('copies','readonly'),request=tx.objectStore('copies').index('scope').getAll(scope);
      request.onsuccess=()=>resolve(request.result.map(clone).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)));request.onerror=()=>reject(request.error);});
  }
  async function write(scope,id,expectedRevision,body){
    const db=await database(),snapshot=clone(body);
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies');let result,failure;
      const request=store.get(scope+':'+id);
      request.onsuccess=()=>{
        const old=request.result;
        if((old?.revision||0)!==expectedRevision){failure=Object.assign(Error('Another tab saved this working copy. Your visible changes still use their original basis. Save them as a separate copy or explicitly reopen the other tab’s version.'),{code:'WORKING_COPY_CONFLICT',currentRevision:old?.revision||0});tx.abort();return;}
        result={key:scope+':'+id,scope,id,revision:expectedRevision+1,updated_at:new Date().toISOString(),body:snapshot};store.put(result);
      };
      tx.oncomplete=()=>resolve(clone(result));tx.onerror=()=>reject(failure||tx.error||Error('The complete working copy could not be saved.'));tx.onabort=()=>reject(failure||tx.error||Error('The working copy was not changed.'));
    });
  }
  return {read,list,write};
}

export function workingCopyEnvelope(project,draft){return {schema:DRAFT_SCHEMA,exported_at:new Date().toISOString(),project:clone(project),draft:clone(draft)};}
