/** Complete drafts and exact original requests; one browser transaction owns each revision. */
export const DRAFT_SCHEMA='upstate.profile-workbook-return-working-copy/v1';
export const clone=value=>JSON.parse(JSON.stringify(value));
export const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])):row);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

const ACTION='profile.workbook_return.create';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function sourceKey(value){return canonical(value);}
export function baseSelection(value){const out=clone(value);delete out.preview_sha256;return out;}
export function validateWorkingCopy(value,{projectId,profileId}={}) {
  if(!object(value)||value.schema!==DRAFT_SCHEMA||!object(value.project)||typeof value.project.id!=='string'||!object(value.draft))
    throw Error('Choose a complete profile workbook working copy.');
  if(projectId&&value.project.id!==projectId)throw Error('Receive the complete original project before opening this working copy.');
  const d=value.draft,s=d.selection;
  if(typeof d.id!=='string'||!object(s)||!hash(s.profile_id)||profileId&&s.profile_id!==profileId||
     !Array.isArray(s.mappings)||!Array.isArray(s.exclusions)||!Array.isArray(d.operations)||
     typeof s.title!=='string'||typeof s.author!=='string'||typeof s.reason!=='string')
    throw Error('The original profile, complete mapping or operation history is missing.');
  if(s.workbook!==null&&(!object(s.workbook)||!hash(s.workbook.source_collection_id)||
     typeof s.workbook.source_id!=='string'||!Number.isSafeInteger(s.workbook.part)||s.workbook.part<0||!hash(s.workbook.sha256)))
    throw Error('The retained original workbook identity is incomplete.');
  const selectors=[];
  function checkSource(source){
    if(!object(source)||!['table','parameter'].includes(source.kind))throw Error('A saved value selector is incomplete.');
    if(source.kind==='table'&&(typeof source.lucode!=='string'||typeof source.column!=='string'))throw Error('A coefficient selector is incomplete.');
    if(source.kind==='parameter'&&(!['ndr','sdr'].includes(source.model)||typeof source.name!=='string'))throw Error('A native parameter selector is incomplete.');
    const k=sourceKey(source);if(selectors.includes(k))throw Error('Each original saved value needs one mapping or exclusion.');selectors.push(k);
  }
  for(const row of s.mappings){if(!object(row)||typeof row.sheet!=='string'||typeof row.cell!=='string')throw Error('A workbook cell mapping is incomplete.');checkSource(row.source);}
  for(const row of s.exclusions){if(!object(row)||typeof row.reason!=='string')throw Error('An exclusion must retain its explanation.');checkSource(row.source);}
  if(d.record!==null&&(!object(d.record)||!hash(d.record.id)))throw Error('The saved return identity is incomplete.');
  const ids=new Set();
  for(const op of d.operations){
    if(!object(op)||typeof op.operation_id!=='string'||ids.has(op.operation_id)||!object(op.request)||
      op.request.operation_id!==op.operation_id||op.request.action!==ACTION||!object(op.request.payload)||
      typeof op.request.workspace!=='string'||op.signature!==canonical(op.request)||
      canonical(baseSelection(op.request.payload))!==canonical(s)||!hash(op.request.payload.preview_sha256))
      throw Error('A saved original request differs from its complete displayed selection.');
    ids.add(op.operation_id);
  }
  if(d.operations.length&&!d.frozen)throw Error('Original command history freezes its mapping; make a separate editable copy.');
  return clone(value);
}
/** One transaction compares and replaces the entire copy; no localStorage read/write race. */
export function createProfileWorkbookReturnStorage(indexedDB=globalThis.indexedDB) {
  let opening;
  function database(){
    if(!indexedDB)return Promise.reject(Error('This browser cannot retain a working copy. Download the visible copy before leaving; saving or building requires working browser storage.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('upstate-profile-workbook-return-v1',1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('copies')){const store=db.createObjectStore('copies',{keyPath:'key'});store.createIndex('scope','scope',{unique:false});}};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=()=>{opening=null;reject(request.error||Error('Browser working-copy storage could not open.'));};
      request.onblocked=()=>{opening=null;reject(Error('Another tab is upgrading working-copy storage. Close that tab and reopen this workbook return.'));};
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
