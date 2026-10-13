/** Durable complete working copies for the original delivery-preparation desk. */
export const DRAFT_SCHEMA='upstate.delivery-preparation-working-copy/v1';
export const clone=value=>JSON.parse(JSON.stringify(value));
export const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])):row);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateWorkingCopy(value,{projectId}={}) {
  if(!object(value)||value.schema!==DRAFT_SCHEMA||!object(value.project)||typeof value.project.id!=='string'||!object(value.draft))throw Error('Choose a complete delivery preparation working copy.');
  if(projectId&&value.project.id!==projectId)throw Error('Open this working copy in its original scientific project, or receive the complete original project first.');
  const row=value.draft;
  if(typeof row.id!=='string'||!object(row.selection)||!object(row.raw)||!Array.isArray(row.operations)||typeof row.title!=='string'||typeof row.purpose!=='string')throw Error('The working copy is missing its complete preparation or retained operations.');
  if(row.base!==null&&(!object(row.base)||typeof row.base.preparation_id!=='string'||!Number.isInteger(row.base.revision)||row.base.revision<1))throw Error('The saved preparation basis is incomplete.');
  const ids=new Set();
  for(const op of row.operations){
    if(!object(op)||typeof op.operation_id!=='string'||ids.has(op.operation_id)||!object(op.request)||op.request.operation_id!==op.operation_id||
       !['delivery.preparation.save','delivery.preparation.build'].includes(op.request.action)||!object(op.request.payload)||typeof op.request.workspace!=='string')
      throw Error('The working copy contains an incomplete or repeated original operation.');
    ids.add(op.operation_id);
    if(typeof op.signature!=='string'||op.signature!==canonical(op.request))throw Error('A retained operation no longer matches its original full request.');
  }

  const draftSignature=canonical({title:row.title,purpose:row.purpose,selection:row.selection,raw:row.raw,base:row.base});
  for(const op of row.operations){
    if(!['complete','rejected'].includes(op.state)&&!op.claimed_complete){
      if(op.draft_signature!==draftSignature)throw Error('An unfinished original request differs from the displayed complete draft. Receive the original unedited working copy before retrying.');
      if(op.request.action==='delivery.preparation.save'){
        const payload=op.request.payload;
        if(payload.preparation_id!==(row.base?.preparation_id||row.preparation_id)||payload.expected_revision!==(row.base?.revision||0)||payload.title!==row.title||payload.purpose!==row.purpose||canonical(payload.selection)!==canonical(workingSelection(row)))
          throw Error('The pending save differs from this preparation identity, revision, name or purpose.');
      }else if(!row.base||op.request.payload.preparation_id!==row.base.preparation_id||op.request.payload.revision!==row.base.revision)
        throw Error('The pending build differs from the displayed saved preparation revision.');
    }
  }
  return clone(value);
}
/** One transaction compares and replaces the entire copy; no localStorage read/write race. */
export function createPreparationStorage(indexedDB=globalThis.indexedDB) {
  let opening;
  function database(){
    if(!indexedDB)return Promise.reject(Error('This browser cannot retain a working copy. Download the visible copy before leaving; saving or building requires working browser storage.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('upstate-delivery-preparation-v1',1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('copies')){const store=db.createObjectStore('copies',{keyPath:'key'});store.createIndex('scope','scope',{unique:false});}};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=()=>{opening=null;reject(request.error||Error('Browser working-copy storage could not open.'));};
      request.onblocked=()=>{opening=null;reject(Error('Another tab is upgrading working-copy storage. Close that tab and reopen this preparation.'));};
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
export function workingCopyEnvelope(project,draft) {
  return {schema:DRAFT_SCHEMA,exported_at:new Date().toISOString(),project:clone(project),draft:clone(draft)};
}

const text=value=>String(value??'');
const human=value=>text(value).replaceAll('_',' ');
function set(row,path,value){
  const keys=path.split('.');
  if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Choose an ordinary native field.');
  const last=keys.pop();let cursor=row;
  for(const key of keys){if(!object(cursor[key]))cursor[key]={};cursor=cursor[key];}
  if(value===undefined)delete cursor[last];else cursor[last]=value;
}

export function workingSelection(draft){
    const s=clone(draft.selection);
    for(const [path,value]of Object.entries(draft.raw)){
      if(path.startsWith('@'))continue;
      if(path==='notes'){set(s,path,text(value).split(/\r?\n/).map(x=>x.trim()).filter(Boolean));continue;}
      if(path==='observed_context_sources'||path.endsWith('.where')){
        let parsed;try{parsed=JSON.parse(value|| (path.endsWith('.where')?'{}':'[]'));}catch{throw Error('Complete the JSON for '+human(path)+', or keep this unfinished browser copy.');}
        if(path.endsWith('.where')&&!object(parsed)||path==='observed_context_sources'&&!Array.isArray(parsed))throw Error('Use the expected object or array for '+human(path)+'.');
        set(s,path,parsed);continue;
      }
      if(/^map_settings\.(weights|caps)\./.test(path)||['map_settings.dpi','map_settings.display_percentile'].includes(path)){
        if(text(value).trim()===''&&path.startsWith('map_settings.caps.'))set(s,path,undefined);
        else {const n=Number(value);set(s,path,text(value).trim()!==''&&Number.isFinite(n)?n:value);}
        continue;
      }
      set(s,path,value);
    }
    for(const bag of ['weights','caps','family_titles'])if(object(s.map_settings?.[bag]))for(const [k,v]of Object.entries(s.map_settings[bag]))if(v==='')delete s.map_settings[bag][k];
    const roles={high_quality_waters:'HIGH_QUALITY_WATERS',drinking_water:'SOURCE_WATER_PROTECTION_AREAS',protected_lands:'PROTECTED_LANDS_OVERLAY'};
    for(const key of (Array.isArray(draft.raw['@changed-overlays'])?draft.raw['@changed-overlays']:[])){
      if(!Object.prototype.hasOwnProperty.call(roles,key))continue;
      if(!object(s.source_roles))s.source_roles={};
      if(s.overlays?.[key])s.source_roles[roles[key]]=clone(s.overlays[key]);else delete s.source_roles[roles[key]];
    }
    return s;
  }
