import {nativeJSONCanonical, parseExactMappingJSON} from './operations_installation_mapping_reconciliation.mjs';
// Complete original-source preparation and native Workshare/Installation handover.
import {Sha256, sha256File} from './operations_installation_source_hash.mjs';
import {bindingTemplate, prepareInstallation, renderWorkorder} from '/installation-prepare-core.mjs';
import {composeCustomerProgramme, programmeFiles} from '/installation-workorders/customer-programme-core.mjs';
import {createCommissioningReceivingDesk} from './operations_installation_commissioning.mjs';
import {createSourceCollectionDesk, validateCollection} from './operations_installation_source_collection.mjs';
import {createSourceEditionDesk, validateSourceEditionWork} from './operations_installation_source_editions.mjs';
import {currentStaffContext, staffDeskStorageKey, assertStaffRequestActor} from './staff-session.mjs';

const SCHEMA='stellar-forge.installation-source-desk.v1';
const SELECTION='stellar-forge.installation-source-selection.v1';
const NATIVE_SELECTION='stellar-forge.canadabuys-workshare-selection.v1';
const HANDOVER_SELECTION='stellar-forge.installation-handover-selection.v1';
const MAX_FILE=8*1024*1024, MAX_ARCHIVE=192*1024*1024, MAX_WORKING=512*1024*1024;
const WORKING_COPY='stellar-forge.installation-source-working-copy.v1';
const EDITION_MAPPING_FIELDS=['binding:','field:work.','field:selection.','field:caseForm.','field:profileWork.'];
const editionMappingField=key=>EDITION_MAPPING_FIELDS.some(prefix=>key.startsWith(prefix));
const activeCopies=new Map();
const clone=value=>structuredClone(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sorted=value=>Array.isArray(value)?value.map(sorted):record(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const stable=nativeJSONCanonical;
const equal=(a,b)=>stable(a)===stable(b);
const utf8=value=>new TextEncoder().encode(value);
const hash=value=>new Sha256().update(typeof value==='string'?utf8(value):value).hex();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2)+'\n';
const decimalText=/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const filenameOK=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const finiteJSON=value=>{
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Keep exact decimal amounts as text and whole counts within their native integer range.');
  if(value&&typeof value==='object')for(const item of Object.values(value))finiteJSON(item);
  return value;
};
function parseObject(value,label){
  let result;try{result=JSON.parse(value);}catch{throw new Error(label+' must contain the complete JSON object.');}
  if(!record(result))throw new Error(label+' must contain an object.');
  return finiteJSON(result);
}
const btn=(label,action,attrs='',disabled=false)=>'<button type="button" data-source-action="'+action+'" '+attrs+
  (disabled?' disabled data-source-fixed="true"':'')+'>'+esc(label)+'</button>';
const empty=text=>'<p class="source-desk-empty">'+esc(text)+'</p>';
const hint=text=>'<p class="source-desk-hint">'+esc(text)+'</p>';
const table=(heads,rows)=>'<div class="source-desk-table"><table><thead><tr>'+heads.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function field(label,path,value='',options={}){
  const a=' data-source-field="'+esc(path)+'"'+(options.readonly?' readonly':' data-source-edit');
  let input;
  if(options.options)input='<select'+a+'>'+[...options.options,...(value!==null&&value!==undefined&&String(value)!==''&&!options.options.some(([id])=>String(id)===String(value))?[[value,'Original selection · '+value]]:[])].map(([v,label])=>'<option value="'+esc(v)+'"'+(String(value??'')===String(v)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+a+' rows="'+(options.rows||4)+'" spellcheck="false">'+esc(value)+'</textarea>';
  else input='<input'+a+' type="'+(options.type||'text')+'" value="'+esc(value)+'"'+(options.list?' list="'+esc(options.list)+'"':'')+'>';
  return '<label class="'+(options.wide?'source-desk-wide':'')+'"><span>'+esc(label)+'</span>'+input+
    (options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function setPath(object,path,value){
  const bits=path.split('.');let current=object;
  for(const bit of bits.slice(0,-1)){
    if(!Object.hasOwn(current,bit)||current[bit]===null)current[bit]={};
    current=current[bit];
  }
  current[bits.at(-1)]=value;
}
function base64(raw){
  let binary='';for(let i=0;i<raw.length;i+=32768)binary+=String.fromCharCode(...raw.subarray(i,i+32768));
  return btoa(binary);
}
function downloadBlob(raw,name,type='application/json'){
  const blob=raw instanceof Blob?raw:new Blob([raw],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function originalFile(row){
  return {path:row.filename,...Object.fromEntries(['filename','bytes','sha256','mediaType','sourceUrl','observedAt'].map(k=>[k,row[k]]))};
}

class BrowserJournal{
  constructor(key){this.key=key;this.closed=false;this.opening=new Promise((resolve,reject)=>{
    let rejected=false;
    const fail=error=>{rejected=true;reject(error);};
    const request=indexedDB.open('sf47.installation-source-desk',1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('records'))db.createObjectStore('records');};
    request.onsuccess=()=>{if(rejected){request.result.close();return;}
      request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>fail(request.error||new Error('The browser draft journal is unavailable.'));
    request.onblocked=()=>fail(new Error('Close the older preparation desk before upgrading its browser journal.'));
  });}
  async access(mode,action){
    if(this.closed)throw new Error('The original browser journal is closed.');
    const db=await this.opening;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records',mode),store=tx.objectStore('records');let result;
      try{const request=action(store);request.onsuccess=()=>{result=request.result;};request.onerror=()=>tx.abort();}
      catch(error){tx.abort();reject(error);return;}
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('The complete browser journal write failed.'));
      tx.onerror=()=>{};
    });
  }
  get(name){return this.access('readonly',s=>s.get(this.key+':'+name));}
  async transaction(action){
    if(this.closed)throw new Error('The original browser journal is closed.');
    const db=await this.opening;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let result,problem;
      const fail=error=>{problem=error;try{tx.abort();}catch{}};
      try{action(store,value=>{result=value;},fail);}catch(error){fail(error);}
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem||tx.error||new Error('The complete browser write failed.'));tx.onerror=()=>{};
    });
  }
  async entries(prefix='',key=this.key){
    if(this.closed)throw new Error('The original browser journal is closed.');
    const db=await this.opening,stem=key+':'+prefix;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readonly'),values=[];
      const request=tx.objectStore('records').openCursor(IDBKeyRange.bound(stem,stem+'\uffff'));
      request.onsuccess=()=>{const cursor=request.result;if(cursor){values.push({key:cursor.key,value:cursor.value});cursor.continue();}};
      tx.oncomplete=()=>resolve(values);tx.onabort=()=>reject(tx.error||request.error||new Error('The complete local inventory could not be read.'));tx.onerror=()=>{};
    });
  }
  readAt(key,name){return this.access('readonly',s=>s.get(key+':'+name));}
  async receiveRequests(records){
    if(!records.length)return [];
    return this.transaction((store,done,fail)=>{
      const values=[];let remaining=records.length;
      for(const incoming of records){
        const key=this.key+':request:'+incoming.body.requestId,read=store.get(key);
        read.onsuccess=()=>{try{
          const prior=read.result;
          if(prior&&(!equal(prior.body,incoming.body)||prior.requestSha256!==incoming.requestSha256||
            prior.draftId!==incoming.draftId||prior.caseId!==incoming.caseId||
            prior.receipt&&incoming.receipt&&!equal(prior.receipt,incoming.receipt)))
            throw Object.assign(new Error('Keep both conflicting complete original request copies.'),{code:'SOURCE_REQUEST_CONFLICT'});
          const value=prior?.receipt?{...clone(incoming),...prior}:incoming.receipt?{...prior,...clone(incoming)}:{...prior,...clone(incoming)};
          values.push({key,value});if(--remaining===0){for(const row of values)store.put(row.value,row.key);done(values.map(row=>row.value));}
        }catch(error){fail(error);}};
        read.onerror=()=>fail(read.error);
      }
    });
  }
  put(name,value){
    if(name.startsWith('request:'))return this.receiveRequests([value]).then(rows=>rows[0]);
    return this.access('readwrite',s=>s.put(clone(value),this.key+':'+name));
  }
  saveCopy(value,expectedSequence=0){
    return this.transaction((store,done,fail)=>{
      const key=this.key+':copy:'+value.copyId,read=store.get(key);
      read.onsuccess=()=>{try{
        const prior=read.result;
        if((prior?.sequence??0)!==expectedSequence)
          throw Object.assign(new Error('This local working copy advanced in another window. Keep both complete copies and save your fields as a separate copy.'),{code:'SOURCE_COPY_CONFLICT'});
        const saved={...clone(value),sequence:expectedSequence+1,updatedAt:new Date().toISOString()};
        store.put(saved,key);
        store.put({copyId:saved.copyId,sequence:saved.sequence,name:saved.name||saved.state?.copyName||'Source working copy',
          sourceDraftId:saved.sourceDraftId,updatedAt:saved.updatedAt,pendingId:saved.state?.pendingId??null},
          this.key+':copy-index:'+saved.copyId);
        done(saved);
      }catch(error){fail(error);}};
      read.onerror=()=>fail(read.error);
    });
  }
  async close(){if(this.closed)return;const db=await this.opening;db.close();this.closed=true;}
}

/** Bridge borrows the original authenticated API and original installation editor. */
export function mountInstallationSources(root,bridge){
  root.classList.add('source-desk');root.setAttribute('aria-label','Installation source preparation');
  if(!document.querySelector('link[data-installation-source-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_installation_sources.css';
    link.dataset.installationSourceStyle='true';document.head.append(link);
  }
  const context=bridge.context(),scope={caseId:context.caseId,planId:context.planId,createdAt:context.createdAt},caseId=scope.caseId,prefix='/api/operations/'+caseId+'/installation-sources';
  const staffContext=currentStaffContext(),legacyKey=caseId+':'+scope.planId+':'+scope.createdAt;
  const journalKey=staffDeskStorageKey(legacyKey,staffContext),pointerKey=staffDeskStorageKey('sf47.installation-source-copy:'+legacyKey,staffContext);
  const journal=new BrowserJournal(journalKey);
  let copyId=crypto.randomUUID(),copySequence=0,copyConflict=false,localCopies=[],legacyCopy=null,selectedLocalCopy='';
  let selectedFile=null,earlierCopies=[],copyLoading=true;
  const requestRecords=new Map();
  activeCopies.set(pointerKey,copyId);
  const initial={schema:SCHEMA,scope,open:false,tab:'files',draftId:null,revision:null,work:null,note:'',newTitle:'',
    upload:{filename:'',mediaType:'application/json',sourceUrl:'',observedAt:''},
    caseForm:null,pendingId:null,preparationId:null,profileWork:null,commissioningWork:null,collectionWork:null,editionWork:null,nativeDraftJSON:null,
    inspectionFileId:null,notice:'',error:'',rejected:[],copyName:'Source working copy',rawFields:{},fieldErrors:{},historyRevisionText:null};
  let state=clone(initial),alive=true,busy=false,hostBusy=false,initialized=false;
  let saved=null,edition=null,heads=[],catalogue=null,prepared=null,inspection=null,request=null,chosenFile=null;
  let generation=0,persistedGeneration=0,persistence=Promise.resolve(),timer=null,storageError='',downloads=new Set();
  const inspectors=new Map(),owned=new Set(),$=q=>root.querySelector(q),available=()=>alive&&root.isConnected;
  let closing=null,disposePersistenceAttempted=false,disposePersistenceError=null;
  function own(promise){owned.add(promise);promise.then(()=>owned.delete(promise),()=>owned.delete(promise));return promise;}
  const current=()=>bridge.context();
  const readonly=()=>hostBusy||!!bridge.readOnlyReason?.();
  const historic=()=>saved&&state.revision!==null&&state.revision!==saved.revision;
  const workingDirty=()=>!!state.work?.dirty||!!state.caseForm?.dirty||!!state.profileWork?.dirty||!!state.commissioningWork?.dirty;
  const pending=()=>!!state.pendingId;
  const editing=()=>initialized&&!copyLoading&&!busy&&!pending()&&!readonly()&&!historic();
  const commissioning=createCommissioningReceivingDesk({
    state:()=>state,draft:()=>selectedDraft(),files:()=>files(),caseId,available,editing,historic,
    requireEdit,changed,render,issue,esc,pretty,stable,header,table,empty,hint,btn,field,
    api:(suffix,value)=>bridge.api(prefix+'/'+state.draftId+suffix,value),
    download:downloadBlob
  });
  const collection=createSourceCollectionDesk({
    state:()=>state,draft:()=>saved,displayedDraft:()=>selectedDraft(),
    request:id=>requestRecords.get(id),allRequests:()=>[...requestRecords.values()],pending:()=>state.pendingId,
    requireEdit,changed,persistNow,parkWorking,render,snapshot,available,hash,base64,checkedFile,clone,esc,pretty,header,table,empty,hint,btn,
    issue,recoverRequest,refreshCurrent:refreshSelectedCopy,readonly:()=>readonly()||historic(),editing:()=>editing(),download:downloadBlob
  });
  const editions=createSourceEditionDesk({
    state:()=>state,draft:()=>selectedDraft(),currentDraft:()=>saved,heads:()=>heads,caseId,
    editing,historic,readonly,pending,requireEdit,changed,render,parkWorking,issue,
    mappingDirty:()=>workingDirty()||Object.keys(state.rawFields||{}).some(editionMappingField),
    esc,pretty,stable,hash,table,empty,hint,btn,download:downloadBlob,
    downloadOriginal:(ref,file)=>download(prefix+'/'+encodeURIComponent(ref.draftId)+'/files/'+encodeURIComponent(file.id)+'?revision='+ref.revision+'&expectedSha256='+file.sha256,file),
    downloadOutput:(ref,id,file)=>download(prefix+'/'+encodeURIComponent(ref.draftId)+'/preparations/'+encodeURIComponent(id)+'/outputs/'+encodeURIComponent(file.filename)+'?expectedSha256='+file.sha256,file),
    api:(draftId,suffix,value)=>bridge.api(prefix+'/'+draftId+suffix,value)
  });
  function snapshot(){return {
    schema:SCHEMA,workingCopySchema:WORKING_COPY,scope:clone(scope),staffContext:clone(staffContext),
    copyId,sequence:copySequence,name:state.copyName||'Source working copy',
    sourceDraftId:state.draftId,selectedRevision:state.revision??saved?.revision??null,
    saved:clone(selectedDraft()),working:clone(state.work),caseForm:clone(state.caseForm),
    profileWork:clone(state.profileWork),pendingRequest:request?clone(request):null,
    state:clone(state),current:clone(saved),selected:clone(edition),prepared:clone(prepared),
    inspection:clone(inspection),catalogue:clone(catalogue),selectedFile:clone(selectedFile),
    requests:[...requestRecords.values()].map(clone),earlierCopies:clone(earlierCopies)
  };}
  function validateRequest(value){
    if(!record(value)||value.schema!==SCHEMA||value.caseId!==caseId||typeof value.draftId!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value.draftId)||!record(value.body)||
      typeof value.body.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.body.requestId)||
      value.requestSha256!==hash(stable({schema:SCHEMA,caseId,draftId:value.draftId,body:value.body})))
      throw new Error('Keep the complete original source request and its original byte identity.');
    if(value.receipt&&(value.receipt.schema!==SCHEMA||value.receipt.requestId!==value.body.requestId||
      value.receipt.requestSha256!==value.requestSha256||value.receipt.draft?.caseId!==caseId||value.receipt.draft?.id!==value.draftId))
      throw new Error('The retained original receipt differs from its complete request.');
    return value;
  }
  function mergeRequests(values){
    const merged=new Map([...requestRecords].map(([id,value])=>[id,clone(value)]));
    for(const original of values){
      validateRequest(original);const value=clone(original),id=value.body.requestId,prior=merged.get(id);
      if(prior&&(!equal(prior.body,value.body)||prior.requestSha256!==value.requestSha256||prior.draftId!==value.draftId||
        prior.receipt&&value.receipt&&!equal(prior.receipt,value.receipt)))
        throw Object.assign(new Error('Keep both conflicting original request copies. Their complete bodies are different.'),{code:'SOURCE_REQUEST_CONFLICT'});
      merged.set(id,prior?.receipt?{...value,...prior}:value.receipt?{...prior,...value}:{...prior,...value});
    }
    return merged;
  }
  async function retainRequest(value){
    validateRequest(value);const merged=mergeRequests([value]);requestRecords.set(value.body.requestId,merged.get(value.body.requestId));
    const retained=await journal.put('request:'+value.body.requestId,merged.get(value.body.requestId));
    requestRecords.set(value.body.requestId,clone(retained));return retained;
  }
  function commitPointer(){
    if(activeCopies.get(pointerKey)!==copyId)return;
    try{sessionStorage.setItem(pointerKey,copyId);}catch(error){storageError='Saved the complete local copy; this window could not retain its reopen pointer. '+error.message;}
  }
  function persistNow(){
    clearTimeout(timer);timer=null;const value=snapshot(),version=generation;
    persistence=persistence.catch(()=>{}).then(async()=>{
      if(copyConflict)throw new Error('Keep this complete conflicting working copy or save it as a separate local copy.');
      const stored=await journal.saveCopy({...value,copyId},copySequence);
      copySequence=stored.sequence;persistedGeneration=Math.max(persistedGeneration,version);storageError='';commitPointer();
    }).catch(async error=>{
      storageError=error.message||String(error);
      if(error.code==='SOURCE_COPY_CONFLICT'&&!copyConflict){
        copyConflict=true;const retained={...value,copyId:crypto.randomUUID(),sequence:0,name:'Conflicting working copy'};
        try{await journal.saveCopy(retained,0);}catch{earlierCopies.push({...retained,earlierCopies:[]});}
      }
      throw error;
    });
    return persistence;
  }

  function checkedFile(value){
    if(value===null||value===undefined)return null;
    if(!record(value)||typeof value.name!=='string'||typeof value.type!=='string'||
      !Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_FILE||
      typeof value.contentBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64))
      throw new Error('Keep the complete selected original file within its native limit.');
    let raw;try{raw=Uint8Array.from(atob(value.contentBase64),c=>c.charCodeAt(0));}catch{throw new Error('The selected original file is incomplete.');}
    if(raw.length!==value.bytes||base64(raw)!==value.contentBase64||hash(raw)!==value.sha256)
      throw new Error('The selected original file differs from its complete retained bytes.');
    return new File([raw],value.name,{type:value.type,lastModified:value.lastModified||0});
  }
  function validateCopy(input){
    if(!record(input)||input.schema!==SCHEMA||!equal(input.scope,scope))
      throw new Error('Open this complete working copy in its original operating case, plan and installation.');
    const value=clone(input),legacy=value.workingCopySchema===undefined;
    if(!legacy&&value.workingCopySchema!==WORKING_COPY)throw new Error('Open the complete original source working-copy format.');
    let next=legacy?(value.state||value):value.state;
    if(legacy&&!next.upload)next={...clone(initial),draftId:value.sourceDraftId??null,revision:value.selectedRevision??null,
      work:value.working??null,caseForm:value.caseForm??null,profileWork:value.profileWork??null,
      pendingId:value.pendingRequest?.body?.requestId??null};
    if(!record(next)||!record(next.upload)||!['files','mapping','outputs','installation','commissioning','editions','history'].includes(next.tab)||
      !['note','newTitle'].every(key=>typeof next[key]==='string')||!['filename','mediaType','sourceUrl','observedAt'].every(key=>typeof next.upload[key]==='string')||
      !(next.draftId===null||typeof next.draftId==='string')||!(next.pendingId===null||typeof next.pendingId==='string')||
      !(next.revision===null||Number.isSafeInteger(next.revision)&&next.revision>0))
      throw new Error('Keep every original source editor field and selected edition.');
    for(const key of ['work','caseForm','profileWork','commissioningWork'])if(next[key]!==null&&!record(next[key]))
      throw new Error('Keep the complete '+key+' editor.');
    if(next.work&&(typeof next.work.selectionText!=='string'||next.work.draftId!==next.draftId||!Number.isSafeInteger(next.work.baseRevision)))
      throw new Error('Keep the original complete mapping text and its selected source revision.');
    if(next.caseForm&&(!Array.isArray(next.caseForm.fileIds)||!Array.isArray(next.caseForm.phaseRows)||
      !record(next.caseForm.total)||!['amendmentText','bindingsText','programmeText'].every(k=>next.caseForm[k]===undefined||typeof next.caseForm[k]==='string')))
      throw new Error('Keep every original customer mapping and effort field.');
    if(next.profileWork&&typeof next.profileWork.bindingsText!=='string')throw new Error('Keep the complete profile bindings text, including unfinished JSON.');
    for(const key of ['rawFields','fieldErrors'])if(next[key]!==undefined&&(!record(next[key])||Object.values(next[key]).some(v=>typeof v!=='string')))
      throw new Error('Keep the exact unfinished guided fields.');
    for(const name of ['current','selected','saved']){
      const draft=value[name];if(draft!==null&&draft!==undefined&&(!record(draft)||draft.schema!==SCHEMA||
        draft.caseId!==caseId||draft.id!==next.draftId||!Number.isSafeInteger(draft.revision)||
        !Array.isArray(draft.files)||!Array.isArray(draft.preparations)||!Array.isArray(draft.attachments)))
        throw new Error('The saved source edition differs from this working copy.');
    }
    if(value.prepared!==null&&value.prepared!==undefined&&(!record(value.prepared)||!Array.isArray(value.prepared.files)))
      throw new Error('Keep the complete selected preparation.');
    if(value.inspection!==null&&value.inspection!==undefined&&(!record(value.inspection)||!Array.isArray(value.inspection.numericCandidates)))
      throw new Error('Keep the complete original file inspection.');
    if(value.catalogue!==null&&value.catalogue!==undefined&&(!record(value.catalogue)||!Array.isArray(value.catalogue.profiles)))
      throw new Error('Keep the complete source profile catalogue.');
    if(value.requests!==undefined&&!Array.isArray(value.requests)||value.earlierCopies!==undefined&&!Array.isArray(value.earlierCopies))
      throw new Error('Keep the complete original request and earlier-copy inventories.');
    const requests=[...(value.requests||[]),...(value.pendingRequest?[value.pendingRequest]:[])];
    const merged=mergeRequests(requests),pending=next.pendingId?merged.get(next.pendingId):null;
    if(next.pendingId&&(!pending||pending.draftId!==next.draftId))throw new Error('The complete pending original request is missing from this copy.');
    checkedFile(value.selectedFile);
    if(next.nativeDraftJSON!==null&&next.nativeDraftJSON!==undefined){
      const original=parseExactMappingJSON(next.nativeDraftJSON).value;
      if(original.schema!==SCHEMA||original.caseId!==caseId||original.id!==next.draftId||!Number.isSafeInteger(original.revision))
        throw new Error('Keep the exact native draft JSON in its original source working copy.');
    }
    validateSourceEditionWork(next.editionWork,{caseId,draftId:next.draftId});
    if(next.collectionWork!==null&&next.collectionWork!==undefined)
      validateCollection(next.collectionWork,{hash,checkedFile,draftId:next.draftId,requests:[...merged.values()]});
    return {...value,state:{...clone(initial),...next,rawFields:next.rawFields||{},fieldErrors:next.fieldErrors||{}},
      requests:[...merged.values()],pendingRequest:pending||null,current:value.current??value.saved??null,
      selected:value.selected??value.saved??null,selectedFile:value.selectedFile??null,earlierCopies:value.earlierCopies||[]};
  }
  async function refreshCopies(){
    const rows=await journal.entries('copy-index:');
    if(!available())return;
    localCopies=rows.map(row=>row.value).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const old=await journal.readAt(legacyKey,'working');
    if(!available())return;
    legacyCopy=old&&old.schema===SCHEMA&&equal(old.scope,scope)?old:null;
  }
  async function legacyEnvelope(){
    const old=await journal.readAt(legacyKey,'working');
    if(!old||old.schema!==SCHEMA||!equal(old.scope,scope))throw new Error('The original legacy working copy is unavailable in this case.');
    const records=(await journal.entries('request:',legacyKey)).map(row=>row.value);
    const pending=old.pendingId?records.find(row=>row.body?.requestId===old.pendingId):null;
    return {schema:SCHEMA,scope:clone(scope),state:clone(old),requests:records,pendingRequest:pending};
  }
  async function parkWorking(label){
    const value={...snapshot(),copyId:crypto.randomUUID(),sequence:0,name:label,earlierCopies:[]};
    clearTimeout(timer);timer=null;
    await persistence.catch(()=>{});
    try{await journal.saveCopy(value,0);}
    catch(error){earlierCopies.push(value);storageError='Earlier complete work remains in this copy’s download. '+error.message;}
  }
  function applyCopy(value){
    const open=state.open;
    state={...clone(initial),...clone(value.state),open,copyName:value.name||value.state.copyName||'Source working copy'};
    saved=clone(value.current);edition=clone(value.selected);prepared=clone(value.prepared??null);
    inspection=clone(value.inspection??null);catalogue=clone(value.catalogue??catalogue);
    selectedFile=clone(value.selectedFile);chosenFile=checkedFile(selectedFile);
    earlierCopies=clone(value.earlierCopies);request=clone(value.pendingRequest);
    requestRecords.clear();for(const original of value.requests)requestRecords.set(original.body.requestId,clone(original));
    inspectors.clear();generation++;initialized=true;
  }
  async function refreshSelectedCopy(){
    await refreshHeads();await readCatalogue();
    if(!available()||!state.draftId)return;
    const retained=clone(state),head=await bridge.api(prefix+'/'+state.draftId);
    if(!available())return;
    if(head.schema!==SCHEMA||head.caseId!==caseId||head.id!==state.draftId||!Number.isSafeInteger(head.revision))
      throw new Error('The current source head differs from this retained case.');
    saved=head;
    if(retained.revision!==null&&retained.revision!==head.revision)
      edition=await bridge.api(prefix+'/'+state.draftId+'?revision='+retained.revision);
    else edition=head;
    if(edition.schema!==SCHEMA||edition.caseId!==caseId||edition.id!==state.draftId||
      !Number.isSafeInteger(edition.revision)||retained.revision!==null&&edition.revision!==retained.revision)
      throw new Error('The selected historical edition differs from the original working copy.');
    // The full editor stays based on its original source, including unfinished raw text.
    if(!state.work)state.work={draftId:state.draftId,baseRevision:edition.revision,selectionText:edition.selection?pretty(edition.selection):'',dirty:false};
    else if(state.work.baseRevision!==head.revision&&retained.revision===null)state.work.dirty=true;
    await editions.exactDraft(edition);
    if(state.preparationId&&!prepared)await readPreparation(state.preparationId);
  }
  async function receiveCopy(input,{savedId=null}={}){
    checkContext();const value=validateCopy(input);
    if(state.pendingId&&state.pendingId!==value.state.pendingId)
      throw new Error('Recover the current original request before opening another working copy. Its complete download remains available.');
    clearTimeout(timer);timer=null;await persistence.catch(()=>{});
    if(!available())return;
    if(savedId){
      const latest=await journal.get('copy:'+savedId);
      if(!equal(latest,input))throw new Error('That saved copy changed in another window. Refresh the copy list and choose its complete current revision.');
    }
    downloadBlob(pretty(snapshot()),(state.draftId||'installation-source-working')+'-working-before-open.json');
    await parkWorking('Before opening another complete working copy');
    if(!available())return;
    // Request writes are all preflighted in one transaction before the editor changes.
    const merged=mergeRequests(value.requests);
    try{
      const retained=await journal.receiveRequests([...merged.values()]);
      for(const original of retained)merged.set(original.body.requestId,clone(original));
    }
    catch(error){
      if(error.code==='SOURCE_REQUEST_CONFLICT')throw error;
      storageError='Opened in memory; original requests remain downloadable and cannot be sent until their journal is writable. '+error.message;
    }
    if(!available())return;
    const previousEarlier=clone(earlierCopies);value.requests=[...merged.values()];
    value.pendingRequest=value.state.pendingId?merged.get(value.state.pendingId):null;
    applyCopy(value);earlierCopies.push(...previousEarlier);
    copyId=crypto.randomUUID();copySequence=0;copyConflict=false;activeCopies.set(pointerKey,copyId);
    render();
    try{await persistNow();await refreshCopies();}catch(error){storageError=error.message;}
    if(!available())return;
    try{await refreshSelectedCopy();}catch(error){state.error='The complete editor is retained. Reopen its original native source when available. '+error.message;}
    if(available()){changed();render();}
  }
  async function openWorkingFile(file){
    if(!file)return;if(file.size>MAX_WORKING)throw new Error('Open a complete source working copy within 512 MiB.');
    const raw=await file.arrayBuffer();if(!available())return;
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
    await receiveCopy(JSON.parse(text.replace(/^\uFEFF/,'')));
  }
  async function forkWorking(){
    await persistence.catch(()=>{});if(!available())return;
    copyId=crypto.randomUUID();copySequence=0;copyConflict=false;activeCopies.set(pointerKey,copyId);
    state.copyName=(state.copyName||'Source working copy')+' · separate copy';generation++;
    await persistNow();await refreshCopies();state.notice='Saved this complete working copy separately; all earlier local copies remain.';
  }
  function workingCopiesView(){
    return '<section class="source-desk-recovery">'+header('Complete working copies',
      'Retain unfinished mappings, original file bytes, customer programmes, commissioning fields and the exact original requests.')+
      '<div class="source-desk-fields"><label>Working copy name<input data-source-copy-name value="'+esc(state.copyName)+'"></label>'+
      '<label>Open complete working-copy JSON<input type="file" accept=".json,application/json" data-source-working-file></label>'+
      '<label>Saved local copy<select data-source-working-copy><option value="">Choose a complete local copy</option>'+
      localCopies.map(row=>'<option value="'+esc(row.copyId)+'"'+(row.copyId===selectedLocalCopy?' selected':'')+'>'+
        esc((row.name||'Source working copy')+' · '+(row.sourceDraftId||'Unfinished new preparation')+' · '+new Date(row.updatedAt).toLocaleString())+'</option>').join('')+'</select></label></div>'+
      '<div class="source-desk-actions">'+btn('Refresh saved copies','working-refresh')+
      btn('Open selected local copy','working-open-saved','',!selectedLocalCopy)+btn('Save as separate local copy','working-fork')+
      (legacyCopy?btn('Open earlier original local copy','working-open-legacy','data-legacy-draft-id="'+esc(legacyCopy.draftId||'')+'" data-legacy-pending-id="'+esc(legacyCopy.pendingId||'')+'"'):'')+'</div>'+
      hint('Every window owns a separate copy. Opening another copy downloads the preceding complete editor first. A retained request keeps its original operator; an active named operator cannot silently replace that actor.')+
      (earlierCopies.length?hint(earlierCopies.length+' preceding complete copies are included in this download because local retention was unavailable.'):'')+
      (copyConflict?hint('This copy has a local storage conflict. Its complete download remains available; save a separate copy to continue local retention.'):'')+'</section>';
  }

  function changed(){
    generation++;clearTimeout(timer);timer=setTimeout(()=>{persistNow().catch(()=>{if(available())status();});},180);
    controls();
  }
  function status(){
    const target=$('[data-source-status]');if(target){target.textContent=storageError||state.error||state.notice;
      target.setAttribute('role',storageError||state.error?'alert':'status');}
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy||copyLoading));
    for(const node of root.querySelectorAll('button,input,textarea,select')){
      const action=node.dataset.sourceAction;
      if(action==='working-download'||action==='collection-download'||action?.startsWith('edition-download-')){node.disabled=false;continue;}
      if(action==='collection-pause'){node.disabled=!collection.running();continue;}
      const liveDisabled={
        'edition-preview':!editions.canPreview(),
        'edition-apply':!editions.canApply(),
        'edition-mapping-preview':!editions.canMappingPreview(),
        'edition-mapping-apply':!editions.canMappingApply(),
        'working-open-saved':!selectedLocalCopy,
        'save-selection':!saved||historic()||!state.work?.dirty,
        'prepare':!saved?.selection||saved.selection.schema===NATIVE_SELECTION||!!state.work?.dirty||!!state.caseForm?.dirty||historic(),
        'profile-apply':!state.profileWork?.preview||state.profileWork.previewBindings!==state.profileWork.bindingsText,
        'profile-download':!state.profileWork?.prepared||state.profileWork.previewBindings!==state.profileWork.bindingsText
      };
      node.disabled=(Object.hasOwn(liveDisabled,action)?liveDisabled[action]:node.dataset.sourceFixed==='true')||busy||hostBusy||copyLoading||
        (node.matches('[data-source-edit]')&&!editing())||
        (!!state.pendingId&&['new','upload','remove','save-selection','prepare','native-receive','attach','case-add','case-remove','case-new','case-edit','profile-seed','profile-apply','commissioning-open','commissioning-inspect','commissioning-preview','commissioning-attach','commissioning-archive-inspect','commissioning-archive-receive'].includes(action));
    }
  }
  function checkContext(){
    const next=current();
    if(next.caseId!==scope.caseId||next.planId!==scope.planId||next.createdAt!==scope.createdAt)
      throw new Error('Reopen this complete preparation in its original operating case.');
  }
  function requireEdit(){
    checkContext();
    if(readonly())throw new Error(bridge.readOnlyReason?.()||'The operating workspace is currently busy.');
    if(pending())throw new Error('Recover the original preparation request before starting another mutation.');
    if(historic())throw new Error('Open the current draft before editing. The historical edition remains downloadable.');
    if(!saved)throw new Error('Create or open an original source preparation first.');
    if(workingDirty()&&state.work?.baseRevision!==saved.revision)
      throw new Error('The saved source draft advanced. Review both complete selections and reconcile your retained mapping before editing.');
  }
  async function run(fn){
    if(!available()||busy||hostBusy||copyLoading)return;
    busy=true;state.error='';controls();
    try{return await own(Promise.resolve().then(fn));}
    catch(error){state.error=error.message||String(error);changed();}
    finally{busy=false;if(available())render();}
  }
  async function refreshHeads(){
    const value=await bridge.api(prefix);
    if(value.schema!==SCHEMA||value.caseId!==caseId||!Array.isArray(value.drafts))
      throw new Error('The source-draft list differs from its original case.');
    heads=value.drafts;return value;
  }
  async function readCatalogue(){
    const value=await bridge.api('/api/operations/installation-source-profiles');
    if(value.schema!==SCHEMA||!value.engine?.sha256||!Array.isArray(value.profiles))
      throw new Error('Retain the complete installed preparation/profile catalogue.');
    catalogue=value;return value;
  }
  function acceptState(value,{replace=false}={}){
    if(value.schema!==SCHEMA||value.caseId!==caseId||value.id!==state.draftId||!Number.isSafeInteger(value.revision))
      throw new Error('The source draft changed original case or edition.');
    saved=value;edition=value;state.nativeDraftJSON=null;
    if(replace||!state.work||state.work.draftId!==value.id){
      state.work={draftId:value.id,baseRevision:value.revision,selectionText:value.selection?pretty(value.selection):'',dirty:false};
      state.caseForm=null;state.profileWork=null;
    }else if(!workingDirty()){
      state.work.baseRevision=value.revision;state.work.selectionText=value.selection?pretty(value.selection):'';
    }
    state.revision=null;
    commissioning.onDraftAccepted({replace});
  }
  async function openDraft(id,revision=null,force=false){
    if(pending())throw new Error('Recover the original request before replacing its source draft or selected revision.');
    if(!force&&(workingDirty()||editions.isDirty())&&!confirm('Keep the saved history and replace the current unsaved preparation fields?'))return;
    await parkWorking('Before opening another source edition');if(!available())return;
    const epoch=++generation;
    const latest=await bridge.api(prefix+'/'+id);
    const value=revision===null||revision===latest.revision?latest:await bridge.api(prefix+'/'+id+'?revision='+revision);
    if(!available()||epoch!==generation)return;
    state.draftId=id;state.commissioningWork=null;state.collectionWork=null;state.editionWork=null;state.rawFields={};state.fieldErrors={};state.historyRevisionText=null;acceptState(latest,{replace:true});
    if(value.revision!==latest.revision){
      state.revision=value.revision;
      state.work={draftId:id,baseRevision:value.revision,selectionText:value.selection?pretty(value.selection):'',dirty:false};
    }
    edition=value;state.preparationId=value.preparations.at(-1)?.id??null;
    await editions.exactDraft(value);
    state.tab='files';inspection=null;prepared=null;inspectors.clear();chosenFile=null;selectedFile=null;state.inspectionFileId=null;
    state.notice=revision===null?'Opened complete source preparation revision '+latest.revision+'.':'Opened retained revision '+value.revision+'.';
    await persistNow();
    if(state.preparationId)await readPreparation(state.preparationId);
  }
  function selectedDraft(){return edition||saved;}
  async function viewEdition(){return selectedDraft();}
  async function createDraft(){
    if(pending())throw new Error('Recover the original source request first.');
    if((workingDirty()||editions.isDirty())&&!confirm('Keep the saved history and replace the current unsaved preparation fields?'))return;
    const title=state.newTitle.trim();
    if(!title)throw new Error('Name this complete source preparation.');
    await parkWorking('Before creating another source preparation');if(!available())return;
    const id='source-desk-'+crypto.randomUUID().replaceAll('-','');
    state.rawFields={};state.fieldErrors={};state.historyRevisionText=null;edition=null;prepared=null;inspection=null;
    state.draftId=id;state.work=null;state.caseForm=null;state.profileWork=null;state.commissioningWork=null;state.collectionWork=null;state.editionWork=null;state.revision=null;saved=null;
    return issue('create',{title},0);
  }
  function verifyReceipt(value,original){
    if(value.schema!==SCHEMA||value.requestId!==original.body.requestId||
       value.requestSha256!==original.requestSha256||value.draft?.caseId!==caseId||value.draft.id!==original.draftId)
      throw new Error('The returned preparation receipt differs from the complete original request.');
    editions.verifyReceipt(value,original);
    return value;
  }
  async function adoptReceipt(value,original){
    verifyReceipt(value,original);
    original.receipt=clone(value);original.state='RECORDED';original.recordedAt=new Date().toISOString();
    await retainRequest(original);
    if(state.pendingId!==original.body.requestId)throw new Error('Retain the original pending request before adopting its result.');
    const beforeWork=state.work;
    state.pendingId=null;request=null;state.notice='Saved complete source preparation revision '+value.draft.revision+'.';
    if(state.draftId===value.draft.id){
      const newer=beforeWork?.dirty&&original.editorText!==beforeWork.selectionText;
      if(['edition.apply','mapping.apply'].includes(original.body.action)&&!newer)clearRawFields(EDITION_MAPPING_FIELDS);
      acceptState(value.draft,{replace:!newer&&['selection.save','native.receive','edition.apply','mapping.apply'].includes(original.body.action)});
      if(newer){state.work=beforeWork;state.work.baseRevision=value.draft.revision;}
      else if(state.work)state.work.baseRevision=value.draft.revision;
    }
    if(value.result?.state==='PREPARED_SOURCE'){
      prepared=value.result;state.preparationId=prepared.id;state.tab='outputs';
      state.notice=value.result.kind==='canadabuys-native-workshare'?'Received the complete original CanadaBuys package and mapped Workshare editions. Review them before attachment.':'Prepared every original document and the complete native receiving package.';
    }
    if(value.result?.state==='ATTACHED_SOURCES'){
      state.tab='installation';state.notice='Attached the complete prepared cohort to the original case in one transaction.';
    }
    commissioning.adoptReceipt(value.result);
    editions.adoptReceipt(value,original);
    editions.adoptNativeDraft(value);
    changed();
    try{await persistNow();}catch(error){state.pendingId=original.body.requestId;request=original;throw error;}
    // Once both the receipt and working selection are durable, a failed read is
    // readback only. It never changes a recorded original POST into a new request.
    try{
      await refreshHeads();
      if(value.result?.state==='ATTACHED_SOURCES'){
        await bridge.refreshCase();
        if(available())await readPreparation(value.result.preparationId);
      }else if(value.result?.state==='ATTACHED_COMMISSIONING'){
        await bridge.refreshCase();
      }
    }catch(error){state.error='Saved original request; refresh its current case to finish readback. '+(error.message||String(error));changed();}
    return value;
  }
  async function issue(action,data,expected=saved?.revision,onPrepared=null){
    checkContext();
    if(readonly())throw new Error(bridge.readOnlyReason?.()||'The operating workspace is busy.');
    if(pending())throw new Error('Recover the original request before recording another change.');
    if(action!=='create')requireEdit();
    const body={requestId:'source-'+crypto.randomUUID(),expectedRevision:expected,
      actor:bridge.recordingActor(),note:state.note,action,data:clone(data)};
    assertStaffRequestActor(body,staffContext);
    if(Object.keys(state.fieldErrors||{}).some(key=>!['edition.apply','mapping.apply'].includes(action)||!editionMappingField(key)))
      throw new Error('Correct the retained unfinished fields before recording the native request.');
    if(!body.actor?.trim())throw new Error('Enter the recording operator in the original workspace.');
    const original={schema:SCHEMA,caseId,draftId:state.draftId,body,createdAt:new Date().toISOString(),
      requestSha256:hash(stable({schema:SCHEMA,caseId,draftId:state.draftId,body})),
      editorText:state.work?.selectionText??null,state:'PREPARED'};
    if(onPrepared)onPrepared(original);
    // Full upload and request bytes must be retained before their first POST.
    await retainRequest(original);
    state.pendingId=body.requestId;request=original;changed();await persistNow();
    return sendOriginal(original);
  }
  async function sendOriginal(original=request){
    if(!original||state.pendingId!==original.body.requestId||original.caseId!==caseId||original.draftId!==state.draftId)
      throw new Error('Reopen the complete original pending request.');
    if(hash(stable({schema:SCHEMA,caseId,draftId:original.draftId,body:original.body}))!==original.requestSha256)
      throw new Error('The retained original request bytes changed.');
    checkContext();assertStaffRequestActor(original.body,staffContext);
    // A received in-memory copy must establish the same durable request before any replay.
    original=await retainRequest(original);request=original;await persistNow();
    if(original.receipt)return adoptReceipt(original.receipt,original);
    let value;
    try{value=await bridge.saveApi(prefix+'/'+original.draftId,clone(original.body));}
    catch(error){
      original.lastError={message:error.message||String(error),code:error.code??null,status:error.status??null,
        definitive:[400,401,403,404,409,413,422].includes(error.status)&&typeof error.code==='string',at:new Date().toISOString()};
      original.state='UNRESOLVED';request=original;await retainRequest(original);throw error;
    }
    return adoptReceipt(value,original);
  }
  async function recoverRequest(value){
    checkContext();validateRequest(value);
    if(value.draftId!==state.draftId||value.caseId!==caseId)
      throw new Error('Open this collection in its original current source draft before recovering its request.');
    if(state.pendingId&&state.pendingId!==value.body.requestId)
      throw new Error('Recover the selected original source request before continuing another collection file.');
    let original=mergeRequests([value]).get(value.body.requestId);
    if(original.state==='REJECTED'&&!original.receipt)
      throw new Error('Keep the rejected original request in its history and review the corrected collection row before creating another request.');
    state.pendingId=original.body.requestId;request=original;changed();
    original=await retainRequest(original);request=original;await persistNow();
    if(original.receipt)return adoptReceipt(original.receipt,original);
    const result=await readOriginal();
    return result?.state==='NOT_RECORDED'?sendOriginal(request):result;
  }
  async function readOriginal(){
    const original=request;if(!original)throw new Error('No original request is pending.');
    const value=await bridge.saveApi(prefix+'/'+original.draftId+'/requests/'+original.body.requestId);
    if(value.schema!==SCHEMA||value.requestId!==original.body.requestId)throw new Error('The original request status changed identity.');
    if(value.state==='RECORDED')return adoptReceipt(value.result,original);
    if(value.state!=='NOT_RECORDED')throw new Error('The original request has no recognized complete status.');
    original.statusRead={state:value.state,at:new Date().toISOString()};await retainRequest(original);
    state.notice='The original request is not recorded. Retry that same request, or reconcile its definite rejection.';return value;
  }
  async function retireRejected(){
    if(!request?.lastError?.definitive)throw new Error('Keep an uncertain original request selected for reconciliation.');
    const original=request,status=await readOriginal();if(status?.state!=='NOT_RECORDED')return;
    original.state='REJECTED';await retainRequest(original);
    state.rejected.push({requestId:original.body.requestId,action:original.body.action,code:original.lastError.code});
    state.pendingId=null;request=null;changed();await persistNow();
    if(saved){const current=await bridge.api(prefix+'/'+saved.id);saved=current;edition=current;}
    state.notice='Kept the rejected original request. Your complete edited selection remains available for reconciliation.';
  }
  async function upload(){
    requireEdit();
    const file=chosenFile,metadata=clone(state.upload);
    if(!file||file.size<1||file.size>MAX_FILE)throw new Error('Choose one complete original file up to 8 MiB.');
    if(!filenameOK.test(metadata.filename))throw new Error('Use a receiving filename with letters, numbers, dots, underscores or hyphens.');
    const epoch=generation,raw=new Uint8Array(await file.arrayBuffer());
    if(file!==chosenFile||epoch!==generation||raw.length!==file.size)throw new Error('The selected original upload changed. Choose it again.');
    return issue('file.add',{...metadata,bytes:raw.length,sha256:hash(raw),contentBase64:base64(raw)});
  }
  async function saveSelection(){
    requireEdit();if(state.caseForm?.dirty)throw new Error('Apply the edited customer mapping to the complete selection first.');
    const selection=parseExactMappingJSON(state.work?.selectionText||'').value;
    if(!record(selection)||![SELECTION,HANDOVER_SELECTION].includes(selection.schema))throw new Error('Use the complete original packet or saved handover source selection.');
    // The native writer parses the complete original editor text without a JS number round trip.
    return issue('selection.save',{selectionJSON:state.work.selectionText});
  }
  async function receiveNative(fileId){
    requireEdit();
    if(workingDirty())throw new Error('Save or retain your edited mapping and Installation bindings before receiving another original source package.');
    const file=files().find(x=>x.id===fileId);
    if(!file||!file.filename.toLowerCase().endsWith('.zip'))throw new Error('Select the complete original CanadaBuys source ZIP.');
    await readCatalogue();
    const engine=catalogue.nativePackages?.find(x=>x.kind==='canadabuys-native-workshare');
    const profile=catalogue.profiles.find(x=>x.id===engine?.profile);
    if(!engine?.engine?.sha256||!profile?.sha256)throw new Error('Open the complete installed native source-package reader and CanadaBuys profile.');
    return issue('native.receive',{fileId:file.id,expectedSha256:file.sha256,
      expectedEngineSha256:engine.engine.sha256,expectedProfileSha256:profile.sha256});
  }
  async function prepare(){
    requireEdit();
    if(state.work?.dirty||state.caseForm?.dirty)throw new Error('Save the complete edited source selection before native preparation.');
    if(!saved.selection)throw new Error('Save the complete native source mapping first.');
    if(saved.selection.schema===NATIVE_SELECTION)throw new Error('Receive the complete source ZIP for this native mapping. Revise its original Workshare and explicit mapping through the installed CanadaBuys command.');
    const original=await editions.exactDraft(saved),selected=original.value.selection,profiles={};
    await readCatalogue();
    for(const row of selected.cases||[]){
      const profile=catalogue.profiles.find(p=>p.id===row.profile);
      if(!profile)throw new Error('Select an installed profile for every original customer.');
      profiles[profile.id]=profile.sha256;
    }
    const engine=catalogue.sourceFormats?.find(x=>x.schema===selected.schema)?.engine??(selected.schema===SELECTION?catalogue.engine:null);
    if(!engine?.sha256)throw new Error('Open the installed source reader for this complete original format.');
    return issue('prepare',{expectedEngineSha256:engine.sha256,expectedSelectionSha256:original.selectionSha256,expectedProfiles:profiles});
  }
  async function readPreparation(id){
    const value=await bridge.api(prefix+'/'+state.draftId+'/preparations/'+id);
    if(value.schema!=='stellar-forge.installation-source-desk-preparation.v1'||value.caseId!==caseId||value.draftId!==state.draftId||value.id!==id)
      throw new Error('The complete preparation belongs to another original selection.');
    prepared=value;state.preparationId=id;return value;
  }
  async function attach(){
    requireEdit();if(!prepared)throw new Error('Open a complete preparation first.');
    await bridge.refreshCase();
    return issue('attach',{preparationId:prepared.id,expectedSelectionSha256:prepared.selectionSha256,expectedVersion:current().version});
  }
  async function download(path,receipt){
    if(!Number.isSafeInteger(receipt.bytes)||receipt.bytes<0||receipt.bytes>MAX_ARCHIVE||!/^[a-f0-9]{64}$/.test(receipt.sha256))
      throw new Error('Keep the complete original file receipt.');
    const controller=new AbortController();downloads.add(controller);
    let reader,writer,published=false;
    try{
      if(typeof window.showSaveFilePicker==='function'){
        try{
          const handle=await window.showSaveFilePicker({suggestedName:receipt.filename});
          writer=await handle.createWritable({keepExistingData:false});
        }catch(error){if(error.name==='AbortError')return;
          if(!['SecurityError','NotAllowedError'].includes(error.name))throw error;}
      }
      const response=await bridge.api(path,undefined,{download:true,signal:controller.signal});
      if(response.headers.get('content-length')!==String(receipt.bytes))throw new Error('The complete download length differs from the original selection.');
      reader=response.body.getReader();const checksum=new Sha256(),parts=[];let count=0;
      while(true){if(controller.signal.aborted||!alive)throw new Error('The original download was interrupted.');
        const {done,value}=await reader.read();if(done)break;
        count+=value.length;if(count>receipt.bytes)throw new Error('The download exceeds the original complete file.');
        checksum.update(value);if(writer)await writer.write(value);else parts.push(value);
      }
      if(controller.signal.aborted||!alive)throw new Error('The original download was interrupted.');
      if(count!==receipt.bytes||checksum.hex()!==receipt.sha256)throw new Error('The downloaded bytes differ from the complete original SHA-256.');
      if(writer)await writer.close();else downloadBlob(new Blob(parts,{type:receipt.mediaType}),receipt.filename);
      published=true;state.notice='Downloaded the complete '+receipt.filename+' ('+receipt.bytes+' verified bytes).';
    }finally{
      if(writer&&!published)await writer.abort().catch(()=>{});
      if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}
      controller.abort();downloads.delete(controller);
    }
  }

  const files=()=>selectedDraft()?.files||[];
  const revisionQuery=()=>state.revision===null?'':'revision='+state.revision+'&';
  function blankSelection(){
    const suffix=state.draftId?.replace(/^source-desk-/,'')||'unselected';
    return {schema:SELECTION,operationId:'source-preparation-'+suffix,requestPrefix:'installation-'+suffix,
      receivingName:'',sourceUrl:'',observedAt:'',cases:[]};
  }
  function selectionValue(){
    const value=state.work?.selectionText?.trim()?parseObject(state.work.selectionText,'Complete source selection'):blankSelection();
    if(!(([SELECTION,HANDOVER_SELECTION].includes(value.schema)&&Array.isArray(value.cases))||(value.schema===NATIVE_SELECTION&&Array.isArray(value.workshares))))throw new Error('Keep the complete original source selection and its customer cases or native Workshares.');
    return value;
  }
  function keepSelection(value){
    state.work={...state.work,draftId:state.draftId,baseRevision:state.work?.baseRevision??saved.revision,
      selectionText:pretty(value),dirty:true};
    prepared=null;state.preparationId=null;changed();
  }
  function replaceFormAllowed(form){
    return !form?.dirty||confirm('Keep the complete saved selection and replace these unsaved mapping fields?');
  }
  async function inspectFile(fileId,amendment=null){
    const file=files().find(f=>f.id===fileId);if(!file)throw new Error('Select a complete original file in this draft edition.');
    const key=file.id+':'+(state.revision??saved.revision)+':'+stable(amendment);
    if(inspectors.has(key))return inspectors.get(key);
    const value=amendment===null?await bridge.api(prefix+'/'+state.draftId+'/files/'+fileId+'/inspect?'+revisionQuery().replace(/&$/,'')):
      await bridge.api(prefix+'/'+state.draftId+'/files/'+fileId+'/inspect',{revision:state.revision,phaseIdAmendment:amendment});
    if(value.schema!==SCHEMA||value.file.id!==file.id||value.file.sha256!==file.sha256||value.file.bytes!==file.bytes||
       hash(value.jsonText)!==file.sha256||utf8(value.jsonText).length!==file.bytes||!equal(value.phaseAmendment,amendment))
      throw new Error('The native source inspection differs from the complete selected original.');
    inspectors.set(key,value);if(inspectors.size>3)inspectors.delete(inspectors.keys().next().value);
    return value;
  }
  async function openInspection(fileId){
    const value=await inspectFile(fileId);
    inspection=value;state.inspectionFileId=fileId;changed();
  }
  function emptyCase(){
    return {index:null,caseId:'',profile:'',packetId:'',fileIds:[],phaseRows:[],
      total:{hours:'',sourcePointer:'',sourceFile:'',unit:'hours'},
      amendmentText:'',bindingsText:'',programmeText:'',packet:null,sourceKind:'workshare-packet',reviewedAmendment:null,dirty:false,earlierPhaseRows:[]};
  }
  async function editCase(index=null){
    requireEdit();
    if(!replaceFormAllowed(state.caseForm))return;
    await parkWorking('Before replacing the complete customer mapping');if(!available())return;
    const selected=selectionValue(),row=index===null?null:selected.cases[index],form=emptyCase();
    if(index!==null&&!row)throw new Error('Select the original mapped customer row.');
    if(row){
      form.index=index;form.caseId=row.caseId;form.profile=row.profile;
      const original=row.handover??row.packet;
      if(!original)throw new Error('Retain this mapping’s complete original packet or saved handover.');
      form.packetId=files().find(f=>f.filename===original.filename&&f.sha256===original.sha256)?.id??'';
      form.originalMapping=clone(row);
      form.missingFiles=row.files.filter(x=>!files().some(f=>f.filename===x.filename&&f.sha256===x.sha256));
      form.fileIds=row.files.map(x=>files().find(f=>f.filename===x.filename&&f.sha256===x.sha256)?.id).filter(Boolean);
      form.phaseRows=clone(row.productionEffort||[]).map(x=>({...x,sourceFile:x.sourceFile??''}));
      form.total={...clone(row.effortTotal||{}),sourceFile:row.effortTotal?.sourceFile??''};
      form.amendmentText=row.phaseIdAmendment?pretty(row.phaseIdAmendment):'';
      form.bindingsText=row.bindings?pretty(row.bindings):'';
      form.programmeText=row.programme?pretty(row.programme):'';
      form.sourceKind=row.handover?'delivery-handover':'workshare-packet';
    }
    clearRawFields(['field:caseForm.']);state.caseForm=form;state.tab='mapping';changed();
    if(form.packetId)await reviewPacket();
  }
  async function reviewPacket(){
    requireEdit();const form=state.caseForm;
    if(!form?.packetId)throw new Error('Choose the complete original Workshare packet or saved delivery handover.');
    const amendment=form.amendmentText.trim()?parseObject(form.amendmentText,'Explicit phase-ID amendment'):null;
    const epoch=generation,fingerprint=stable({packetId:form.packetId,amendment});
    const value=await inspectFile(form.packetId,amendment);
    if(!available()||epoch!==generation||form!==state.caseForm||
       fingerprint!==stable({packetId:form.packetId,amendment:form.amendmentText.trim()?parseObject(form.amendmentText,'Phase amendment'):null}))return;
    if(!value.packet||!Array.isArray(value.packet.plan.phases))throw new Error('This complete JSON file has no original Workshare plan/phases.');
    const previous=form.phaseRows,byId=new Map(previous.map(x=>[x.phaseId,x]));
    form.earlierPhaseRows=previous.filter(x=>!value.packet.plan.phases.some(p=>p.id===x.phaseId));
    form.phaseRows=value.packet.plan.phases.map(p=>byId.get(p.id)||{phaseId:p.id,hours:'',sourcePointer:'',sourceFile:'',unit:'hours',basis:''});
    form.packet=clone(value.packet);form.sourceKind=value.sourceKind??'workshare-packet';
    form.originalHandover=clone(value.originalHandover??null);
    form.reviewedAmendment=clone(amendment);form.amendmentReceipt=clone(value.phaseAmendmentReceipt);
    if(!form.caseId&&value.packet.caseId)form.caseId=value.packet.caseId;
    form.dirty=true;inspection=value;state.inspectionFileId=form.packetId;changed();
    state.notice='Opened all '+form.phaseRows.length+' original phases. Select the exact source pointer for every assigned effort.';
  }
  function effortRow(row,phase=false){
    if(!decimalText.test(row.hours??''))throw new Error('Enter exact nonnegative decimal hours for every original effort.');
    if(typeof row.sourcePointer!=='string'||!row.sourcePointer.startsWith('/'))throw new Error('Select an exact JSON pointer for each original effort value.');
    if(!['hours','minutes'].includes(row.unit))throw new Error('Select the original effort unit.');
    const result={...(phase?{phaseId:row.phaseId}:{}),hours:row.hours,sourcePointer:row.sourcePointer,unit:row.unit};
    if(row.sourceFile){
      if(!files().some(f=>f.filename===row.sourceFile))throw new Error('Keep each effort pointer linked to a retained full source file.');
      result.sourceFile=row.sourceFile;
    }
    if(phase){if(!row.basis?.trim())throw new Error('Explain the original basis for each phase effort.');result.basis=row.basis;}
    return result;
  }
  function applyCase(){
    requireEdit();const form=state.caseForm;
    if(!form?.packet||!form.caseId.trim()||!form.profile)throw new Error('Review the complete original packet, case ID and installed profile first.');
    if(form.missingFiles?.length)throw new Error('Restore the complete original supporting documents before applying this retained mapping. Their full original identities remain in the working copy.');
    const amendment=form.amendmentText.trim()?parseObject(form.amendmentText,'Explicit phase amendment'):null;
    if(!equal(amendment,form.reviewedAmendment))throw new Error('Review the edited phase amendment against the original packet before applying it.');
    const packet=files().find(f=>f.id===form.packetId),selected=selectionValue();
    if(!packet||!catalogue.profiles.some(x=>x.id===form.profile))throw new Error('Select the complete retained packet and installed profile.');
    const selectedFiles=[...new Set(form.fileIds)].filter(id=>id!==packet.id).map(id=>{
      const f=files().find(x=>x.id===id);if(!f)throw new Error('A selected original document is absent.');return originalFile(f);
    });
    const declared=new Set([packet.filename,...selectedFiles.map(x=>x.filename)]);
    const phases=form.phaseRows.map(x=>effortRow(x,true)),total=effortRow(form.total);
    for(const x of [...phases,total])if(x.sourceFile&&!declared.has(x.sourceFile))
      throw new Error('Include the complete '+x.sourceFile+' document selected by an effort pointer.');
    const handover=form.sourceKind==='delivery-handover',schema=handover?HANDOVER_SELECTION:SELECTION;
    if(selected.cases.some((x,i)=>i!==form.index)&&(selected.schema!==schema))
      throw new Error('Keep saved handovers and original receiving packets in separate named preparations. Each preparation carries its complete original reader.');
    if(handover&&(amendment||form.caseId!==form.packet.caseId))
      throw new Error('Keep this saved handover’s exact original customer and phase identities.');
    selected.schema=schema;
    const row={caseId:form.caseId,profile:form.profile,[handover?'handover':'packet']:originalFile(packet),planSha256:form.packet.planSha256,
      productionEffort:phases,effortTotal:total,files:selectedFiles};
    if(amendment)row.phaseIdAmendment=amendment;
    if(form.bindingsText.trim())row.bindings=parseObject(form.bindingsText,'Complete native bindings');
    if(form.programmeText?.trim()){
      const programme=parseObject(form.programmeText,'Complete original customer programme');
      const keys=['calendarFile','selectionFile','taskBudgetFile','nativeChangeFile'];
      if(programme.schema!=='stellar-forge.installation-customer-programme.v1'||!programme.calendarFile||
         Object.keys(programme).some(key=>key!=='schema'&&!keys.includes(key)))
        throw new Error('Use the original customer programme schema and selected complete source filenames.');
      for(const key of keys)if(Object.hasOwn(programme,key)&&!declared.has(programme[key]))
        throw new Error('Include the full '+key+' document in this customer’s selected source files.');
      row.programme=programme;
    }
    if(selected.cases.some((x,i)=>x.caseId===row.caseId&&i!==form.index))throw new Error('Keep each original customer case once in this complete selection.');
    if(form.index===null)selected.cases.push(row);else selected.cases[form.index]=row;
    keepSelection(selected);state.caseForm=null;state.notice='Applied all original phases and document bindings to the complete editable selection.';
  }
  async function removeCase(index){
    requireEdit();const selected=selectionValue(),row=selected.cases[index];
    if(!row||!confirm('Remove '+row.caseId+' from this working selection? Earlier saved editions remain retained.'))return;
    await parkWorking('Before removing a customer mapping');if(!available())return;
    selected.cases.splice(index,1);keepSelection(selected);clearRawFields(['field:caseForm.']);state.caseForm=null;
  }
  async function inspectPointerSource(index){
    const form=state.caseForm,row=index==='total'?form?.total:form?.phaseRows[Number(index)];
    if(!row)throw new Error('Select the original effort row.');
    const f=row.sourceFile?files().find(f=>f.filename===row.sourceFile):files().find(f=>f.id===form.packetId);
    if(!f)throw new Error('Select the original complete source for this effort.');
    const value=await inspectFile(f.id,row.sourceFile?null:form.reviewedAmendment);
    inspection=value;state.inspectionFileId=f.id;state.pointerTarget={index,sourceFile:row.sourceFile??'',basis:row.sourceFile?'file':'plan'};changed();
  }
  function choosePointer(index){
    requireEdit();const target=state.pointerTarget,item=inspection?.numericCandidates[index],form=state.caseForm;
    if(!target||!item||item.basis!==target.basis||!form)throw new Error('Open the exact effort source before choosing its pointer.');
    const row=target.index==='total'?form.total:form.phaseRows[Number(target.index)];
    if(!row||row.sourceFile!==target.sourceFile)throw new Error('The selected effort source changed.');
    row.sourcePointer=item.pointer;form.dirty=true;changed();
    state.notice='Selected the original value '+item.text+'. Enter its explicit assigned hours and original unit; native preparation checks the exact conversion.';
  }
  async function preparedObject(preparation,filename){
    const file=preparation.files.find(row=>row.filename===filename);
    if(!file||file.bytes>MAX_FILE)throw new Error('Keep the complete selected preparation output: '+filename+'.');
    const controller=new AbortController();downloads.add(controller);
    try{
      const response=await bridge.api(prefix+'/'+state.draftId+'/preparations/'+preparation.id+
        '/outputs/'+encodeURIComponent(filename)+'?expectedSha256='+file.sha256,undefined,
        {download:true,signal:controller.signal});
      if(response.headers.get('content-length')!==String(file.bytes))
        throw new Error('The complete preparation output length changed: '+filename+'.');
      const raw=new Uint8Array(await response.arrayBuffer());
      if(controller.signal.aborted||!alive||raw.length!==file.bytes||hash(raw)!==file.sha256)
        throw new Error('The complete preparation output differs from its saved original: '+filename+'.');
      return parseObject(new TextDecoder('utf-8',{fatal:true}).decode(raw),filename);
    }finally{controller.abort();downloads.delete(controller);}
  }
  function latestAttachment(){
    return [...(saved?.attachments||[])].reverse().find(a=>a.state==='ATTACHED_SOURCES'&&(!state.preparationId||a.preparationId===state.preparationId))??null;
  }
  async function openInstallation(){
    requireEdit();
    const attachment=latestAttachment();if(!attachment)throw new Error('Attach one complete preparation to this operating case first.');
    await bridge.refreshCase();
    const selection={...clone(attachment.selection),expectedVersion:current().version};
    const inventory=await bridge.api('/api/operations/'+caseId+'/installation-workshares',selection);
    if(inventory.source?.caseId!==undefined&&inventory.source.caseId!==caseId)throw new Error('The native Workshare selection belongs to another case.');
    if(!Array.isArray(inventory.cases))throw new Error('Retain the complete attached Workshare inventory.');
    if(state.profileWork?.dirty){
      state.notice='Kept your edited profile bindings. Review their original source before replacing them.';
      state.tab='installation';changed();return;
    }
    const originalPreparation=await readPreparation(attachment.preparationId);
    const nativeSelection=originalPreparation.report.nativeReview?.selection??null;
    const sourceSelection=await preparedObject(originalPreparation,'SOURCE_SELECTION.json');
    clearRawFields(['binding:','field:profileWork.']);
    state.profileWork={attachmentId:attachment.preparationId,selection,inventory,nativeSelection:clone(nativeSelection),
      sourceSelection,programmeInputs:null,
      workshareCaseId:inventory.cases[0]?.caseId??'',profileId:'',bindingsText:'',seed:null,
      profileSha256:null,prepared:null,preview:null,dirty:false};
    const mapping=nativeSelection?.workshares.find(x=>x.workshareId===state.profileWork.workshareCaseId)??
      (sourceSelection.cases||[]).find(x=>x.caseId===state.profileWork.workshareCaseId);
    if(mapping)state.profileWork.profileId=mapping.profile;
    state.tab='installation';changed();
  }
  async function seedProfile(){
    requireEdit();const work=state.profileWork;
    if(!work?.workshareCaseId||!work.profileId)throw new Error('Select the original attached Workshare and installed receiving profile.');
    if(work.dirty&&!confirm('Keep the complete source history and replace the current edited profile bindings?'))return;
    await parkWorking('Before replacing the complete Installation bindings');if(!available())return;
    await bridge.refreshCase();await readCatalogue();
    const selected=catalogue.profiles.find(x=>x.id===work.profileId);if(!selected)throw new Error('Select an installed complete profile.');
    const selection={...clone(work.selection),expectedVersion:current().version};
    const value=await bridge.api('/api/operations/'+caseId+'/installation-workshare-seed',{
      ...selection,workshareCaseId:work.workshareCaseId,installationId:null,expectedRevision:0});
    if(value.source?.caseId!==caseId||value.source.version!==selection.expectedVersion||value.installationId!==null||
       value.expectedRevision!==0||value.workshare?.caseId!==work.workshareCaseId)
      throw new Error('The native installation seed differs from the selected original Workshare.');
    const bindings=bindingTemplate(value,selected.profile);
    const originalMapping=work.nativeSelection?.workshares.find(x=>x.workshareId===work.workshareCaseId&&x.profile===work.profileId)??
      work.sourceSelection?.cases?.find(x=>x.caseId===work.workshareCaseId&&x.profile===work.profileId);
    const originalBindings=originalMapping?.bindings;
    if(originalBindings!==undefined){
      if(!originalBindings||typeof originalBindings!=='object'||Array.isArray(originalBindings))throw new Error('Keep the original optional Installation bindings as a complete object.');
      for(const [key,original] of Object.entries(originalBindings)){
        if(!Object.hasOwn(bindings,key))throw new Error('The original native mapping contains an unsupported Installation binding: '+key+'. Review that explicit source before continuing.');
        if(['schema','profile','selection','workshareCaseId'].includes(key)){
          if(!equal(bindings[key],original))throw new Error('The original native mapping differs from this fresh Installation seed identity: '+key+'.');
        }else bindings[key]=clone(original);
      }
    }
    let programmeInputs=null;
    if(originalMapping?.programme){
      const preparation=await readPreparation(work.attachmentId),mapping=originalMapping.programme;
      if(mapping.schema!=='stellar-forge.installation-customer-programme.v1'||!mapping.calendarFile)
        throw new Error('Keep the complete original customer programme selection.');
      const roles=preparation.sourceRoles??{commissioning:'Supplier_Workshare_Commissioning.json'};
      programmeInputs={commissioning:await preparedObject(preparation,roles.commissioning),
        calendarInput:await preparedObject(preparation,mapping.calendarFile)};
      for(const [key,target] of [['selectionFile','selection'],['taskBudgetFile','taskBudget'],['nativeChangeFile','nativeChange']])
        if(mapping[key])programmeInputs[target]=await preparedObject(preparation,mapping[key]);
    }
    clearRawFields(['binding:','field:profileWork.']);
    work.programmeInputs=programmeInputs;
    work.selection=selection;work.seed=value;work.profile=clone(selected.profile);work.profileSha256=selected.sha256;
    work.bindingsText=pretty(bindings);work.dirty=false;work.prepared=null;work.preview=null;changed();
    state.notice='Prepared the full native profile binding template. Enter only actual known deployment, receiving and payment selections.';
  }
  async function previewProfile(){
    requireEdit();if(Object.keys(state.fieldErrors||{}).length)throw new Error('Correct the retained unfinished fields before reviewing this Installation.');const work=state.profileWork;
    if(!work?.seed)throw new Error('Read the full original Workshare/profile binding template first.');
    const bindings=parseObject(work.bindingsText,'Complete profile bindings'),beforeText=work.bindingsText;
    const value=prepareInstallation(work.seed,work.profile,bindings);
    if(work.programmeInputs){
      const programme=composeCustomerProgramme({seed:work.seed,document:value.document,profile:work.profile,...work.programmeInputs});
      value.document=clone(programme.document);value.preview.document=clone(programme.document);
      value.customerProgramme=programme;
    }
    await bridge.refreshCase();await readCatalogue();
    if(current().version!==work.seed.source.version||catalogue.profiles.find(x=>x.id===work.profileId)?.sha256!==work.profileSha256)
      throw new Error('The case or installed profile changed. Preserve your bindings and reopen the original current source.');
    const review=await bridge.api('/api/operations/'+caseId+'/installation-preview',value.preview);
    if(work!==state.profileWork||work.bindingsText!==beforeText)throw new Error('The full bindings changed during review.');
    if(review.source?.caseId!==caseId||review.source.version!==value.source.version||!equal(review.document,value.document))
      throw new Error('The native complete Installation preview differs from the prepared document.');
    work.prepared=value;work.preview=review;work.previewBindings=beforeText;changed();
    state.notice='Reviewed the complete source, '+value.document.checks.length+' acceptance checks and native installation document.';
  }
  async function receiveProfile(){
    requireEdit();if(Object.keys(state.fieldErrors||{}).length)throw new Error('Correct the retained unfinished fields before receiving this Installation.');const work=state.profileWork;
    if(!work?.prepared||!work.preview||work.previewBindings!==work.bindingsText)
      throw new Error('Review the exact current complete bindings before opening their Installation draft.');
    await bridge.refreshCase();
    if(current().version!==work.prepared.source.version)throw new Error('The original case changed after review. Keep the bindings and review the complete current selection.');
    const accepted=await bridge.receiveDraft({scope:{caseId,version:current().version},document:clone(work.preview.document),
      prepared:clone(work.prepared),preview:clone(work.preview),sourcePreparationId:work.attachmentId,
      sourceDeskDraftId:state.draftId,workshareCaseId:work.workshareCaseId});
    if(!accepted?.applied)throw new Error(accepted?.message||'The original Installation editor could not receive this complete draft.');
    work.receivedDraftKey=accepted.draftKey;work.dirty=false;state.notice='Opened the complete prepared Installation draft. Review and save its original native edition in the Installation editor.';
    changed();await persistNow();state.open=false;root.hidden=true;bridge.close?.();
  }
  function snapshotDownload(){
    downloadBlob(pretty(snapshot()),(state.draftId||'installation-source-working')+'-working.json');
    state.notice='Downloaded the complete original editor, selected file, requests, customer programme and commissioning fields.';
  }

  function header(title,description,actions=''){
    return '<div class="source-desk-heading"><div><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p></div><div class="source-desk-actions">'+actions+'</div></div>';
  }
  function filesView(){
    const selected=files();
    return collection.render()+header('Complete original files','Keep the original bytes, receiving filename, source reference and observation time together.')+
      '<div class="source-desk-upload"><label>Choose complete original file<input type="file" data-source-upload data-source-edit></label>'+
      (chosenFile?hint('Selected '+chosenFile.name+' · '+chosenFile.size+' bytes. The complete input is retained before its first request.'):'')+
      '<div class="source-desk-fields">'+field('Receiving filename','upload.filename',state.upload.filename)+
      field('Media type','upload.mediaType',state.upload.mediaType)+field('Original source URL / reference','upload.sourceUrl',state.upload.sourceUrl,{wide:true})+
      field('Observed at, with timezone','upload.observedAt',state.upload.observedAt,{help:'ISO 8601, for example 2026-10-13T00:00:00Z.'})+'</div>'+
      '<div class="source-desk-actions">'+btn('Retain complete file','upload','',!saved||!chosenFile||historic())+'</div></div>'+
      (selected.length?table(['Original receiving file','Complete identity and provenance','Actions'],selected.map(f=>[
        '<strong>'+esc(f.filename)+'</strong><br>'+esc(f.mediaType)+' · '+f.bytes+' bytes',
        '<code>'+esc(f.sha256)+'</code><br>'+esc(f.sourceUrl)+'<br>'+esc(f.observedAt),
        (f.filename.toLowerCase().endsWith('.zip')?btn('Receive native CanadaBuys source','native-receive','data-id="'+f.id+'"',historic()||workingDirty()||pending()):btn('Inspect JSON','inspect','data-id="'+f.id+'"'))+btn('Download original','file-download','data-id="'+f.id+'"')+
        btn('Remove from next edition','remove','data-id="'+f.id+'"',historic()||pending())
      ])):empty('Retain the complete Workshare packet or saved delivery handover, plus every document supplying original effort or customer programme context.'))+
      hint('For a native CanadaBuys Workshare, retain the complete ZIP produced by the installed canadabuys package command, then choose Receive native CanadaBuys source. Its original package, explicit mapping and all five prepared files stay together.')+inspectionView();
  }
  function inspectionView(){
    if(!inspection)return '';
    const choosing=state.pointerTarget&&state.caseForm;
    const candidates=inspection.numericCandidates.map((x,i)=>({x,i})).filter(({x})=>!choosing||x.basis===state.pointerTarget.basis);
    return '<section class="source-desk-inspection">'+header('Original file inspection',inspection.file.filename+' · '+inspection.file.bytes+' bytes',btn('Close inspection','inspect-close'))+
      (inspection.packet?'<p><strong>'+esc(inspection.packet.plan.title||inspection.packet.caseId)+'</strong><br>'+esc(inspection.packet.plan.customer||'')+
        ' · '+esc(inspection.packet.plan.supplier||'')+'</p><p>Original case <code>'+esc(inspection.packet.caseId)+'</code><br>Selected plan <code>'+esc(inspection.packet.planSha256)+'</code></p>':'')+
      (candidates.length?'<details'+(choosing?' open':'')+'><summary>Exact original numeric values ('+inspection.numericCandidateCount+' in complete source)</summary>'+
        (inspection.candidatesLimited?hint('This preview lists the first 2,000 values. Every original byte remains below; enter any exact JSON pointer manually.'):'')+
        table(['Source','Original JSON pointer','Exact original value',...(choosing?['Selection']:[])],candidates.map(({x,i})=>[
          esc(x.basis),'<code>'+esc(x.pointer)+'</code>','<code>'+esc(x.text)+'</code>',...(choosing?[btn('Use this pointer','pointer','data-index="'+i+'"')]:[])
        ]))+'</details>':'')+
      (inspection.phaseAmendmentReceipt?'<details><summary>Complete selected phase-ID amendment receipt</summary><pre>'+esc(pretty(inspection.phaseAmendmentReceipt))+'</pre></details>':'')+
      '<details><summary>Complete original JSON, unchanged</summary><pre>'+esc(inspection.jsonText)+'</pre></details></section>';
  }
  function effortFields(row,path,total=false){
    const sourceChoices=[['','Original selected plan'],...files().map(f=>[f.filename,f.filename])];
    return '<div class="source-desk-effort">'+
      field('Assigned hours',path+'.hours',row.hours,{help:'Exact decimal text; native preparation verifies the original source value.'})+
      field('Value belongs to',path+'.sourceFile',row.sourceFile,{options:sourceChoices})+
      field('Exact JSON pointer',path+'.sourcePointer',row.sourcePointer)+
      field('Original value unit',path+'.unit',row.unit,{options:[['hours','Hours'],['minutes','Minutes']]})+
      (!total?field('Original effort basis',path+'.basis',row.basis,{area:true,wide:true}):'')+
      '<div class="source-desk-actions">'+btn('Inspect original values','pointer-inspect','data-index="'+(total?'total':path.split('.').at(-1))+'"')+'</div></div>';
  }
  function caseFormView(){
    const form=state.caseForm;if(!form)return '';
    const profileOptions=[['','Select installed profile'],...(catalogue?.profiles||[]).map(x=>[x.id,x.profile.title||x.profile.name||x.id])];
    return '<section class="source-desk-customer">'+header(form.index===null?'Add complete customer mapping':'Edit complete customer mapping',
      'Map every original phase and total to explicit source values. The original documents and commercial semantics stay retained.',
      btn('Close mapping','case-cancel'))+
      '<div class="source-desk-fields">'+
      field('Original customer case ID','caseForm.caseId',form.caseId,{wide:true})+
      field('Installed receiving profile','caseForm.profile',form.profile,{options:profileOptions})+
      field('Whole original Workshare packet or saved handover','caseForm.packetId',form.packetId,{options:[['','Select original source'],...files().map(f=>[f.id,f.filename])]})+
      '</div><details><summary>Explicit original packet phase-ID amendment, if required</summary>'+
      hint('Only an explicitly reviewed phase-ID/dependency mapping is supported. Keep reason, source URL and selected receiving filename; native inspection verifies the complete inverse against the original packet.')+
      field('Complete phaseIdAmendment JSON','caseForm.amendmentText',form.amendmentText,{area:true,rows:8,wide:true})+'</details>'+
      '<div class="source-desk-actions">'+btn('Review original source and every phase','packet-review')+'</div>'+
      (form.missingFiles?.length?'<details open><summary>Original supporting documents to restore</summary><pre>'+esc(pretty(form.missingFiles))+'</pre></details>':'')+
      (form.packet?'<p><strong>'+esc(form.packet.plan.title)+'</strong><br>'+esc(form.packet.plan.customer)+' / '+esc(form.packet.plan.supplier)+
       '</p>'+hint(form.sourceKind==='delivery-handover'?'Saved delivery handover: '+(form.originalHandover?.originalCompletedPhases??0)+' of '+(form.originalHandover?.originalTotalPhases??form.phaseRows.length)+' phases recorded complete in its original source.':'Original complete Workshare receiving packet.')+
       '<details><summary>Original plan and handover identities</summary><pre>'+esc(pretty({planSha256:form.packet.planSha256,handover:form.originalHandover??null}))+'</pre></details>'+
       '<details><summary>Complete original commercial terms</summary><pre>'+esc(pretty(form.packet.plan.commercial))+'</pre></details>'+
       '<fieldset><legend>Whole supporting documents</legend>'+files().filter(f=>f.id!==form.packetId).map(f=>
         '<label class="source-desk-check"><input type="checkbox" data-source-case-file="'+f.id+'" data-source-edit'+
         (form.fileIds.includes(f.id)?' checked':'')+'> <span>'+esc(f.filename)+' · '+f.bytes+' bytes</span></label>').join('')+'</fieldset>'+
       '<h4>Every original phase</h4>'+form.phaseRows.map((row,index)=>{
         const phase=form.packet.plan.phases.find(x=>x.id===row.phaseId);
         return '<fieldset><legend>'+esc(row.phaseId)+' · '+esc(phase?.title)+'</legend>'+
           '<p>'+esc(phase?.description)+'</p>'+hint('Owner: '+(phase?.owner??'')+' · Dependencies: '+(phase?.depends_on||[]).join(', '))+
           '<p><strong>Acceptance:</strong> '+esc(phase?.acceptance)+'</p>'+
           effortFields(row,'caseForm.phaseRows.'+index)+'</fieldset>';
       }).join('')+'<fieldset><legend>Original complete effort total</legend>'+effortFields(form.total,'caseForm.total',true)+'</fieldset>'+
       (form.earlierPhaseRows?.length?'<details open><summary>Retained earlier mapping fields for changed phase IDs</summary><pre>'+esc(pretty(form.earlierPhaseRows))+'</pre></details>':'')+
       '<details><summary>Optional complete native profile bindings</summary>'+
       field('Original bindings JSON','caseForm.bindingsText',form.bindingsText,{area:true,rows:10,wide:true})+'</details>'+
       '<details><summary>Existing customer calendar and operating programme</summary>'+
       hint('Select the retained original programme by its complete source filenames. Its calendar, commercial selection, optional task budget and native editor change are received through the maintained programme composer.')+
       field('Original programme selection JSON','caseForm.programmeText',form.programmeText||'',{area:true,rows:8,wide:true})+'</details>'+
       '<div class="source-desk-actions">'+btn('Apply complete mapping to selection','case-add')+'</div>':
       empty('Review the original packet or saved delivery handover to expose every phase and its full commercial scope.'))+'</section>';
  }
  function nativeMappingView(selected){
    return header('Original CanadaBuys Workshare mapping','Review the exact native package and explicitly selected parties, effort and delivery phases.')+
      '<p>Operation <strong>'+esc(selected.operationId)+'</strong> · package <code>'+esc(selected.package.packageId)+'</code></p>'+
      '<p>Workspace '+esc(selected.package.workspaceId)+' · original revision '+esc(selected.package.workspaceRevision)+
      '<br>Source '+esc(selected.sourceUrl)+' · observed '+esc(selected.observedAt)+'</p>'+
      selected.workshares.map(row=>'<section><h3>'+esc(row.workshareId)+' · selected revision '+esc(row.revision)+'</h3>'+
        '<p>Profile '+esc(row.profile)+' · edition <code>'+esc(row.workshareSha256)+'</code></p>'+
        table(['Explicit party','Original selection'],[['Customer',esc(row.parties.customer)],['Supplier',esc(row.parties.supplier)],['Basis',esc(row.parties.basis)]])+
        '<p>'+esc(row.mappingNote)+'</p><p>'+esc(row.schedule.businessDays)+' working days · '+esc(row.schedule.basis)+'</p>'+
        '<p>Start conditions: '+esc(row.schedule.startConditions.join('; '))+'</p>'+
        table(['Phase / original milestones','Separate effort','Working days / dependency','Owner / delivery / acceptance'],row.phases.map(phase=>[
          '<strong>'+esc(phase.title)+'</strong><br>'+esc(phase.id)+'<br>'+esc(phase.milestoneIds.join(', ')),
          esc(phase.productionHours)+' production hours<br>'+esc(phase.partnerHours)+' partner hours',
          esc(phase.businessDays)+' days<br>'+esc(phase.dependsOn.join(', ')||'No preceding phase'),
          esc(phase.owner)+'<br>'+esc(phase.deliverables)+'<br>'+esc(phase.acceptance)+'<br>Inputs: '+esc(phase.inputs)
        ]))+'</section>').join('')+
      hint('Revise the original Workshare in CanadaBuys and its explicit installed-command mapping, then receive the next complete source ZIP here. Earlier source editions and attachments remain available in this draft history.')+
      '<details><summary>Complete original native selection</summary><pre>'+esc(pretty(selected))+'</pre></details>';
  }
  function nativeReviewView(review){
    if(!review)return '';
    return '<section><h3>Original native Workshares</h3>'+
      review.workshares.map(row=>{
        const original=row.original.selectedEdition,history=row.original.nativeHead.history;
        return '<section><h4>'+esc(original.title||row.id)+'</h4>'+
          '<p>'+esc(row.id)+' · selected revision '+esc(original.revision)+' of '+history.length+
          ' · original status '+esc(original.status)+'</p>'+
          table(['Original commercial record','Separate effort / schedule'],[
            [esc(original.currency)+' '+esc(row.plan.commercial.amount)+' · '+esc(original.feeCents)+' cents',
             esc(row.plan.native.productionHours)+' production hours · '+esc(row.plan.native.partnerHours)+' partner hours<br>'+
             esc(row.plan.schedule.business_days)+' explicitly mapped working days'],
            ['Recorded partner: '+esc(original.partner)+'<br>Recorded owner: '+esc(original.owner),
             'Available from: '+esc(original.availableFrom)+'<br>Original delivery days: '+esc(original.deliveryDays)]
          ])+
          '<p>Scope: '+esc(original.scope)+'<br>Deliverables: '+esc(original.deliverables)+
          '<br>Acceptance: '+esc(original.acceptance)+'</p>'+
          table(['Original milestone','Exact original amount','Due / acceptance'],original.milestones.map(m=>[
            esc(m.id)+' · '+esc(m.title),esc(original.currency)+' '+esc(m.amountCents)+' cents',
            esc(m.due)+'<br>'+esc(m.acceptance)
          ]))+
          table(['Retained edition','Native status','Original amount / effort','Original operator / time'],history.map(v=>[
            esc(v.revision),esc(v.status),esc(v.currency)+' '+esc(v.feeCents)+' cents<br>'+
            esc(v.estimatedHours)+' production hours · '+esc(v.partnerHours)+' partner hours',esc(v.operator)+'<br>'+esc(v.updatedAt)
          ]))+
          '<details><summary>Complete source row, history, phase allocation and Installation plan</summary><pre>'+
          esc(pretty(row))+'</pre></details></section>';
      }).join('')+
      hint('Native status and price are retained source facts. This receipt does not establish agreement, a payer, payment, or currency conversion.')+'</section>';
  }
  function mappingView(){
    let selected,error;try{selected=selectionValue();}catch(e){error=e.message;}
    if(selected?.schema===NATIVE_SELECTION)return nativeMappingView(selected);
    return header('Source and effort mapping','Prepare one complete receiving cohort from exact original customer documents.',
      btn('Add original customer','case-new','',!saved||historic()))+
      (selected?'<div class="source-desk-fields">'+
        field('Preparation operation ID','selection.operationId',selected.operationId)+
        field('Original request prefix','selection.requestPrefix',selected.requestPrefix)+
        field('Complete receiving operation name','selection.receivingName',selected.receivingName,{wide:true})+
        field('Selection source URL / reference','selection.sourceUrl',selected.sourceUrl,{wide:true})+
        field('Selection observed at, with timezone','selection.observedAt',selected.observedAt)+'</div>'+
        (selected.cases.length?table(['Original customer / installed profile','Complete selected plan','Effort and source files','Actions'],selected.cases.map((c,i)=>[
          '<strong>'+esc(c.caseId)+'</strong><br>'+esc(c.profile),
          '<code>'+esc(c.planSha256)+'</code>',esc(c.effortTotal?.hours??'')+' hours · '+(c.productionEffort?.length??0)+' phases<br>'+
            esc((c.handover??c.packet)?.filename)+' + '+(c.files?.length??0)+' complete documents',
          btn('Edit mapping','case-edit','data-index="'+i+'"',historic())+btn('Remove from selection','case-remove','data-index="'+i+'"',historic())
        ])):empty('Add each original customer with the complete quoted plan, explicit effort pointers and full source documents.')):hint(error))+
      caseFormView()+inspectionView()+
      '<details'+(error?' open':'')+'><summary>Complete editable native source selection</summary>'+
      field('Full native selection JSON','work.selectionText',state.work?.selectionText||'',{area:true,rows:18,wide:true})+
      hint('This is the exact complete JSON saved to the native draft. All original values, pointers, files and optional bindings remain editable.')+'</details>'+
      '<div class="source-desk-actions">'+btn('Save complete selection','save-selection','',!saved||historic()||!state.work?.dirty)+
      btn('Prepare complete native package','prepare','',!saved?.selection||!!state.work?.dirty||!!state.caseForm?.dirty||historic())+'</div>';
  }
  function outputsView(){
    const list=selectedDraft()?.preparations||[];
    return header('Complete prepared outputs','Original native preparation retains every declared document, exact Workshare scope and receiving input.')+
      (list.length?'<div class="source-desk-actions">'+list.map(x=>btn('Preparation from draft '+x.draftRevision,'preparation-open','data-id="'+x.id+'"')).join('')+'</div>':empty('Save a complete source mapping, then prepare its native receiving package.'))+
      (prepared?'<p><strong>'+esc(prepared.state)+'</strong> · prepared '+esc(prepared.preparedAt)+' by '+esc(prepared.actor)+'</p>'+
       '<p>Selection <code>'+esc(prepared.selectionSha256)+'</code></p>'+nativeReviewView(prepared.report.nativeReview)+
       table(['Complete original customer','Original plan / effort','Installed profile'],(prepared.report.cases||[]).map(c=>[
         esc(c.caseId),'<code>'+esc(c.planSha256)+'</code><br>'+esc(c.completeEffort?.hours??'')+' hours',esc(c.profile??'')
       ]))+
       table(['Complete file','Byte identity','Download'],prepared.files.map(f=>[
         '<strong>'+esc(f.filename)+'</strong><br>'+esc(f.mediaType),f.bytes+' bytes<br><code>'+esc(f.sha256)+'</code>',
         btn('Download complete file','output-download','data-filename="'+esc(f.filename)+'"')
       ]))+
       '<div class="source-desk-actions">'+btn('Download whole source and receiving ZIP','archive-download')+
       btn('Attach complete cohort to this case','attach','',historic()||readonly()||pending())+
       (latestAttachment()?btn('Open native Installation preparation','installation-open'):'')+'</div>'+
       hint('Attachment is one native case transaction. If the complete cohort exceeds the original case capacity, no partial source set is recorded.')+
       '<details><summary>Complete native preparation report</summary><pre>'+esc(pretty(prepared.report))+'</pre></details>'+
       '<details><summary>Original engine and selected profile sources</summary><pre>'+esc(pretty({engine:prepared.engine,profiles:prepared.report.profiles}))+'</pre></details>':'');
  }
  function bindingFields(work){
    let b;try{b=parseObject(work.bindingsText,'Complete profile bindings');}catch(error){return hint(error.message);}
    const f=(label,path,value,options={})=>field(label,path,value,options).replace('data-source-field=','data-source-binding=');
    const currentCase=bridge.caseData?.(),deployments=currentCase?.records?.deployments||[];
    const merchants=deployments.filter(x=>['MERCHANT','BOTH'].includes(x.role)),buyers=deployments.filter(x=>['BUYER','BOTH'].includes(x.role));
    return '<div class="source-desk-fields">'+
      f('Accountable existing merchant deployment','merchantDeploymentId',b.merchantDeploymentId??'',{options:[['','Not selected'],...merchants.map(x=>[x.id,x.name+' · '+x.operator])],help:'Record a new deployment through the existing case editor if it is not listed.'})+
      f('Actual receiving host','receiving.host',b.receiving?.host??'')+
      f('Named receiving operator','receiving.operator',b.receiving?.operator??'')+
      f('Exact customer source / edition','source.reference',b.source?.reference??'',{wide:true})+
      f('Original source-use authority','source.authority',b.source?.authority??'',{area:true,wide:true})+
      f('Selected network','payment.network',b.payment?.network??'')+
      f('Selected asset','payment.asset',b.payment?.asset??'')+
      f('Approved recipient','payment.recipient',b.payment?.recipient??'')+
      f('Payment authority','payment.authority',b.payment?.authority??'',{wide:true})+
      f('Exact price in atomic units','payment.priceAtomic',b.payment?.priceAtomic??'')+
      f('Selected whole task count','payment.taskUnits',b.payment?.taskUnits??'')+
      f('Exact task budget in atomic units','payment.taskBudgetAtomic',b.payment?.taskBudgetAtomic??'')+'</div>'+
      '<fieldset><legend>Existing independent customer deployments</legend>'+
      (buyers.length?buyers.map(x=>'<label class="source-desk-check"><input type="checkbox" data-source-buyer="'+esc(x.id)+'" data-source-edit'+
        (b.buyerDeploymentIds?.includes(x.id)?' checked':'')+'> <span>'+esc(x.name)+' · '+esc(x.operator)+'</span></label>').join(''):hint('Use the original case deployment editor to record an actual customer operator. No deployment is guessed here.'))+'</fieldset>';
  }
  function installationView(){
    const attachment=latestAttachment(),work=state.profileWork;
    if(!attachment)return header('Prepare the native Installation','Attach a complete original preparation first.')+empty('Your source packet is preserved in Outputs. Attachment records every source before native Workshare receiving.');
    return header('Receive into the original Installation editor','Start from complete original Workshare scope, then add actual customer deployment and operating selections.',
      btn('Refresh attached Workshare selection','installation-open','',!!work?.dirty))+
      '<p>Complete preparation <code>'+esc(attachment.preparationId)+'</code> · '+attachment.sources.length+' retained case sources.</p>'+
      (work?'<div class="source-desk-fields">'+
        field('Original attached Workshare case','profileWork.workshareCaseId',work.workshareCaseId,{options:[['','Select original case'],...work.inventory.cases.map(x=>[x.caseId,x.title+' · '+x.hours+' hours'])]})+
        field('Installed task / receiving profile','profileWork.profileId',work.profileId,{options:[['','Select installed profile'],...(catalogue?.profiles||[]).map(x=>[x.id,x.profile.title||x.profile.name||x.id])]})+'</div>'+
        '<div class="source-desk-actions">'+btn('Read original profile binding template','profile-seed')+'</div>'+
        (work.seed?'<p><strong>'+esc(work.seed.workshare.commercial?.currency)+' '+esc(work.seed.workshare.commercial?.amount)+'</strong> · '+
          esc(work.seed.workshare.commercial?.price_status)+' · '+esc(work.seed.workshare.hours)+' original planned hours</p>'+
          bindingFields(work)+
          '<details><summary>Complete editable profile bindings</summary>'+
          field('Full native binding JSON','profileWork.bindingsText',work.bindingsText,{area:true,rows:18,wide:true})+'</details>'+
          '<details><summary>Complete installed profile, implementation steps and source files</summary><pre>'+esc(pretty(work.profile))+'</pre></details>'+
          '<div class="source-desk-actions">'+btn('Review complete native Installation','profile-preview')+
          btn('Open complete Installation draft','profile-apply','',!work.preview||work.previewBindings!==work.bindingsText)+
          btn('Download full prepared workorder','profile-download','',!work.prepared||work.previewBindings!==work.bindingsText)+'</div>'+
          (work.prepared?'<section class="source-desk-review"><h4>Actual selections still required</h4>'+
            (work.prepared.selections.length?table(['Field','Operating purpose'],work.prepared.selections.map(x=>[esc(x.field),esc(x.purpose)])):
              hint('The profile’s required operating selections are present. Original native acceptance checks remain under their own receiving workflow.'))+
            (work.prepared.customerProgramme?'<h4>Original customer operating programme</h4>'+
              '<p>'+work.prepared.customerProgramme.customerRows.length+' complete selected tasks from '+esc(work.prepared.customerProgramme.calendar.startDate)+' through '+esc(work.prepared.customerProgramme.calendar.endDateInclusive)+'.</p>'+
              table(['UTC review','Source start, inclusive','Source end, exclusive','Snapshot requested'],work.prepared.customerProgramme.customerRows.map(row=>[
                esc(row.scheduledAt),esc(row.sourceStartInclusive||''),esc(row.sourceEndExclusive||''),esc(row.requestedSnapshotAt||'')]))+
              '<details><summary>Complete programme and original commercial terms</summary><pre>'+esc(pretty(work.prepared.customerProgramme))+'</pre></details>':'')+
            '<details><summary>Complete original native Installation preview</summary><pre>'+esc(pretty(work.preview))+'</pre></details></section>':''):''):
        '<div class="source-desk-actions">'+btn('Read attached Workshare inventory','installation-open')+'</div>');
  }
  function historyView(){
    const value=selectedDraft();
    return header('Original saved source history','Every save appends a complete draft revision. Earlier files and prepared packages retain their own identities.')+
      (saved?'<div class="source-desk-actions"><label>Saved revision<input type="number" data-source-revision min="1" max="'+saved.revision+'" value="'+esc(state.historyRevisionText??state.revision??saved.revision)+'"></label>'+
        btn('Open exact revision','revision-open')+btn('Open current head','current-open')+'</div>'+
        table(['Revision / original request','Recording context','Change'],[...(value?.history||[])].reverse().map(row=>[
          esc(row.revision??'')+'<br><code>'+esc(row.requestId??'')+'</code>',
          esc(row.actor??'')+'<br>'+esc(row.at??row.recordedAt??'')+'<br>'+esc(row.note??''),
          '<details><summary>'+esc(row.action??'Complete source change')+'</summary><pre>'+esc(pretty(row))+'</pre></details>'
        ]))+
        '<details><summary>Complete original attachment receipts</summary><pre>'+esc(pretty(value?.attachments||[]))+'</pre></details>':
        empty('Create or open an original source preparation to see its complete history.'));
  }
  function conflictView(){
    if(!saved||!workingDirty()||state.work?.baseRevision===saved.revision)return '';
    return '<section class="source-desk-recovery">'+header('Saved source draft advanced',
      'Your complete edited mapping is preserved from revision '+state.work.baseRevision+'. The current saved revision is '+saved.revision+'.')+
      '<details><summary>Current saved complete selection</summary><pre>'+esc(pretty(saved.selection))+'</pre></details>'+
      '<details><summary>Your complete retained edited selection</summary><pre>'+esc(state.work.selectionText)+'</pre></details>'+
      (state.caseForm?.dirty?'<details><summary>Your complete edited customer mapping</summary><pre>'+esc(pretty(state.caseForm))+'</pre></details>':'')+
      (state.profileWork?.dirty?'<details><summary>Your complete edited Installation bindings</summary><pre>'+esc(pretty(state.profileWork))+'</pre></details>':'')+
      (state.commissioningWork?.dirty?'<details><summary>Your complete commissioning receiving selection</summary><pre>'+esc(pretty(state.commissioningWork))+'</pre></details>':'')+
      '<div class="source-desk-actions">'+btn('Keep edited mapping against this reviewed revision','rebase')+btn('Open current saved selection','current-open')+'</div></section>';
  }
  async function rebaseWorking(){
    checkContext();if(readonly()||pending()||historic())throw new Error('Recover the original editable current source draft first.');
    const before=saved,head=await bridge.api(prefix+'/'+state.draftId);
    if(head.revision!==before.revision){saved=head;edition=head;changed();throw new Error('The source draft advanced again. Review its newly returned complete selection.');}
    if(!confirm('Keep your complete edited mapping against saved revision '+head.revision+' after reviewing both selections?'))return;
    state.reconciliations??=[];
    state.reconciliations.push({fromRevision:state.work.baseRevision,reviewedRevision:head.revision,
      editedSelectionText:state.work.selectionText,editedCustomerMapping:clone(state.caseForm),
      editedProfileBindings:clone(state.profileWork),editedCommissioningReceiving:clone(state.commissioningWork),savedSelection:clone(head.selection),at:new Date().toISOString()});
    state.work.baseRevision=head.revision;commissioning.rebase();changed();await persistNow();
    state.notice='Kept both complete selections and your edited mapping. Native preparation will verify every source binding before attachment.';
  }
  function recoveryView(){
    if(!request)return '';
    return '<section class="source-desk-recovery">'+header('Original request retained',
      'Keep this same complete request through an interrupted response or a saved-result readback.')+
      '<p><code>'+esc(request.body.requestId)+'</code> · '+esc(request.body.action)+' · '+esc(request.state)+'</p>'+
      (request.lastError?hint(request.lastError.message):'')+
      '<div class="source-desk-actions">'+btn('Read original request status','request-status')+
      btn(request.receipt?'Adopt recorded original receipt':'Retry exact original request','request-retry')+
      btn('Keep rejected request and reconcile fields','request-reject','',!request.lastError?.definitive)+'</div>'+
      '<details><summary>Exact complete original request and retained receipt</summary><pre>'+esc(pretty(request))+'</pre></details></section>';
  }
  function render(){
    if(!available())return;
    root.dataset.sourceCopyId=copyId;root.dataset.sourceDraftId=state.draftId||'';root.dataset.sourcePendingId=state.pendingId||'';
    root.dataset.sourceScope=JSON.stringify(scope);
    root.hidden=!state.open;
    const tabs=[['files','1 · Original files'],['mapping','2 · Source mapping'],['outputs','3 · Complete package'],['installation','4 · Installation'],['commissioning','5 · Receive commissioning'],['editions','Customer editions'],['history','Saved history']];
    let content;
    try{content=state.tab==='mapping'?mappingView():state.tab==='outputs'?outputsView():state.tab==='installation'?installationView():
      state.tab==='commissioning'?commissioning.render():state.tab==='editions'?editions.render():state.tab==='history'?historyView():filesView();}
    catch(error){
      content=hint('Your complete fields remain retained. Correct their original JSON before opening the guided view: '+error.message)+
        (state.work?field('Full native selection JSON','work.selectionText',state.work.selectionText,{area:true,rows:18,wide:true}):'')+
        (state.profileWork?field('Full native binding JSON','profileWork.bindingsText',state.profileWork.bindingsText,{area:true,rows:18,wide:true}):'')+
        '<details><summary>Complete original editor fields</summary><pre>'+esc(pretty(state))+'</pre></details>';
    }
    root.innerHTML=header('Prepare original source workshares','Complete documents → exact effort mapping → native receiving package → original Installation.',
      btn('Download complete working fields','working-download','',!saved)+btn('Close source desk','close'))+
      '<p data-source-status class="source-desk-status" aria-live="polite"></p>'+
      '<div class="source-desk-layout"><aside><h4>Retained preparations</h4>'+
      '<label>Name a new preparation<input data-source-new-title maxlength="300" placeholder="Customer supplier onboarding" value="'+esc(state.newTitle)+'"'+(pending()?' disabled':'')+'></label>'+
      btn('Create source preparation','new','',!initialized||readonly()||pending())+
      '<div class="source-desk-drafts">'+heads.map(x=>'<button type="button" data-source-action="draft-open" data-id="'+x.id+'"'+
        (state.draftId===x.id?' aria-current="page"':'')+'><strong>'+esc(x.title)+'</strong><span>Revision '+x.revision+' · '+x.fileCount+' files</span>'+
        '<small>'+x.preparationCount+' complete preparations · '+x.attachmentCount+' attachments</small></button>').join('')+'</div>'+
      (heads.length?'':empty('No retained source preparation in this case yet.'))+'</aside><div class="source-desk-main">'+
      (saved?'<div class="source-desk-edition"><strong>'+esc(saved.title)+'</strong><span>'+
        (historic()?'Historical revision '+state.revision:'Current saved revision '+saved.revision)+
        ((workingDirty()||editions.isDirty())?' · edited fields retained in this browser':'')+'</span></div>':'')+
      (historic()?hint('This is an immutable earlier source edition. Open the current head to edit. Complete earlier files and packages remain available.'):'')+
      workingCopiesView()+recoveryView()+conflictView()+'<nav aria-label="Source preparation steps">'+tabs.map(([id,label])=>'<button type="button" data-source-action="tab" data-tab="'+id+'"'+
        (state.tab===id?' aria-current="page"':'')+'>'+esc(label)+'</button>').join('')+'</nav>'+
      (saved?content:empty(initialized?'Create or open an original source preparation to begin.':'Opening the retained browser journal and original operating case…'))+
      (saved?'<label class="source-desk-note">Reason for the next source change<textarea data-source-field="note" data-source-edit rows="3">'+esc(state.note)+'</textarea></label>':'')+
      '</div></div>';
    for(const [key,value] of Object.entries(state.rawFields||{})){
      const [kind,...parts]=key.split(':');const path=parts.join(':');
      const attribute=kind==='binding'?'data-source-binding':kind==='field'?'data-source-field':null;
      if(!attribute)continue;
      const node=[...root.querySelectorAll('['+attribute+']')].find(el=>el.getAttribute(attribute)===path);
      if(node){if(node.tagName==='SELECT'&&![...node.options].some(option=>option.value===value))node.add(new Option('Original selection · '+value,value));node.value=value;}
    }
    status();controls();
  }

  function editBinding(path,value){
    requireEdit();const work=state.profileWork;if(!work?.seed)throw new Error('Read the native profile template first.');
    const bindings=parseObject(work.bindingsText,'Complete profile bindings');
    if(path==='payment.taskUnits'){
      if(value!==''&&!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('Keep the task count as an exact whole number.');
      value=value===''?null:Number(value);
      if(value!==null&&!Number.isSafeInteger(value))throw new Error('The whole task count exceeds its native range.');
    }else if(['merchantDeploymentId','payment.priceAtomic','payment.taskBudgetAtomic'].includes(path))value=value===''?null:value;
    setPath(bindings,path,value);work.bindingsText=pretty(bindings);work.dirty=true;work.prepared=null;work.preview=null;changed();
  }
  async function handleField(target){
    const path=target.dataset.sourceField;if(!path)return;
    if(!initialized||copyLoading||pending()||readonly()||historic())return;
    let value=target.value;
    if(path.startsWith('selection.')){
      const selected=selectionValue();setPath(selected,path.slice(10),value);keepSelection(selected);return;
    }
    if(path.startsWith('profileWork.')&&['workshareCaseId','profileId'].includes(path.split('.')[1])){
      const work=state.profileWork,key=path.split('.')[1],old=work[key];
      if(value!==old&&work.dirty&&!confirm('Replace the edited binding fields with the newly selected original Workshare/profile?')){
        target.value=old;return;
      }
      if(value!==old){await parkWorking('Before selecting another Workshare or profile');if(!available()||work!==state.profileWork)return;clearRawFields(['binding:','field:profileWork.']);work[key]=value;work.seed=null;work.bindingsText='';work.prepared=null;work.preview=null;work.dirty=false;changed();render();}
      return;
    }
    setPath(state,path,value);
    if(path==='work.selectionText'){state.work.dirty=true;prepared=null;state.preparationId=null;}
    if(path.startsWith('caseForm.')){state.caseForm.dirty=true;if(path==='caseForm.packetId')state.caseForm.packet=null;}
    if(path==='profileWork.bindingsText'){state.profileWork.dirty=true;state.profileWork.prepared=null;state.profileWork.preview=null;}
    changed();status();
  }
  function clearRawFields(prefixes){
    for(const bank of [state.rawFields,state.fieldErrors])
      for(const key of Object.keys(bank||{}))if(prefixes.some(prefix=>key.startsWith(prefix)))delete bank[key];
  }
  function fieldFailure(target,error){
    const key=target.dataset.sourceBinding?'binding:'+target.dataset.sourceBinding:
      target.dataset.sourceField?'field:'+target.dataset.sourceField:null;
    if(key){state.rawFields[key]=target.value;state.fieldErrors[key]=error.message||String(error);}
    state.error=error.message||String(error);changed();status();
  }
  function bindingEdit(target){
    const key='binding:'+target.dataset.sourceBinding;
    state.rawFields[key]=target.value;
    try{editBinding(target.dataset.sourceBinding,target.value);delete state.rawFields[key];delete state.fieldErrors[key];}
    catch(error){fieldFailure(target,error);}
  }
  function dispatchField(target){
    const key='field:'+target.dataset.sourceField;
    const switching=target.tagName==='SELECT'&&['profileWork.workshareCaseId','profileWork.profileId'].includes(target.dataset.sourceField);
    const execute=async()=>{try{await handleField(target);delete state.rawFields[key];delete state.fieldErrors[key];}catch(error){fieldFailure(target,error);}};
    if(switching)run(execute);else own(execute()).catch(error=>fieldFailure(target,error));
  }
  root.addEventListener('input',event=>{
    const target=event.target;
    if(!available()||busy||hostBusy||copyLoading)return;
    try{
      if(target.matches('[data-source-copy-name]')){state.copyName=target.value;changed();return;}
      if(target.matches('[data-source-revision]')){state.historyRevisionText=target.value;changed();return;}
      if(target.matches('[data-source-new-title]')){state.newTitle=target.value;changed();return;}
      if(editions.edit(target))return;
      if(collection.edit(target))return;
      if(target.matches('[data-source-binding]')){bindingEdit(target);return;}
      if(target.matches('[data-source-field]')&&target.tagName!=='SELECT')dispatchField(target);
    }catch(error){fieldFailure(target,error);}
  });
  root.addEventListener('change',event=>{
    const target=event.target;
    if(!available()||busy||hostBusy||copyLoading)return;
    try{
      if(target.matches('[data-source-working-copy]')){selectedLocalCopy=target.value;controls();return;}
      if(target.matches('[data-source-working-file]')){const file=target.files?.[0];run(()=>openWorkingFile(file));return;}
      if(target.matches('[data-source-collection-files]')){const selected=Array.from(target.files||[]);run(()=>collection.readFiles(selected));return;}
      if(editions.edit(target)){render();return;}
      if(collection.edit(target)){render();return;}
      if(commissioning.edit(target))return;
      if(target.matches('[data-source-upload]')){
        if(!editing())return;
        const file=target.files?.[0]??null;
        run(async()=>{
          if(file&&(file.size<1||file.size>MAX_FILE))throw new Error('Choose one complete original file up to 8 MiB.');
          const raw=file?new Uint8Array(await file.arrayBuffer()):null;if(!available())return;
          if(raw&&raw.length!==file.size)throw new Error('Keep the complete selected original file.');
          await parkWorking('Before choosing another complete original file');if(!available())return;
          selectedFile=file?{name:file.name,type:file.type||'application/octet-stream',lastModified:file.lastModified,
            bytes:raw.length,sha256:hash(raw),contentBase64:base64(raw)}:null;
          chosenFile=checkedFile(selectedFile);
          if(file){state.upload.filename=file.name;state.upload.mediaType=selectedFile.type;state.upload.observedAt=new Date().toISOString();}
          changed();await persistNow();render();
        });return;
      }
      if(target.matches('select[data-source-binding]')){bindingEdit(target);return;}
      if(target.matches('[data-source-buyer]')){
        requireEdit();const work=state.profileWork,bindings=parseObject(work.bindingsText,'Complete profile bindings'),id=target.dataset.sourceBuyer;
        const selected=new Set(bindings.buyerDeploymentIds||[]);
        if(target.checked)selected.add(id);else selected.delete(id);
        bindings.buyerDeploymentIds=[...selected];work.bindingsText=pretty(bindings);work.dirty=true;work.prepared=null;work.preview=null;changed();return;
      }
      if(target.matches('[data-source-case-file]')){
        requireEdit();const form=state.caseForm;if(!form)throw new Error('Open the complete customer mapping first.');
        const ids=new Set(form.fileIds);if(target.checked)ids.add(target.dataset.sourceCaseFile);else ids.delete(target.dataset.sourceCaseFile);
        form.fileIds=[...ids];form.dirty=true;changed();return;
      }
      if(target.matches('select[data-source-field]'))dispatchField(target);
    }catch(error){fieldFailure(target,error);}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-source-action]');if(!target||!root.contains(target)||target.disabled)return;
    event.preventDefault();const action=target.dataset.sourceAction;
    if(action==='working-download'){snapshotDownload();status();return;}
    if(action==='collection-download'){own(Promise.resolve().then(()=>collection.action(action,target))).catch(error=>{state.error=error.message||String(error);status();});return;}
    if(action?.startsWith('edition-download-')){own(Promise.resolve().then(()=>editions.action(action,target))).catch(error=>{state.error=error.message||String(error);status();});return;}
    if(action==='collection-pause'){collection.pause();controls();status();return;}
    if(action==='close'){own(closeView()).catch(error=>{state.error=error.message;status();});return;}
    run(async()=>{
      if(action.startsWith('edition-'))return editions.action(action,target);
      if(action.startsWith('collection-'))return collection.action(action,target);
      if(action==='working-refresh')return refreshCopies();
      if(action==='working-fork')return forkWorking();
      if(action==='working-open-legacy')return receiveCopy(await legacyEnvelope());
      if(action==='working-open-saved'){
        if(!selectedLocalCopy)throw new Error('Choose the complete saved local copy.');
        const id=selectedLocalCopy,value=await journal.get('copy:'+id);
        if(!value)throw new Error('The selected complete local copy is unavailable.');
        return receiveCopy(value,{savedId:id});
      }
      if(action.startsWith('commissioning-'))return commissioning.action(action,target);
      if(action==='new')return createDraft();
      if(action==='draft-open')return openDraft(target.dataset.id);
      if(action==='current-open')return openDraft(state.draftId);
      if(action==='revision-open'){
        const n=Number($('[data-source-revision]')?.value);
        if(!Number.isSafeInteger(n)||n<1||n>saved.revision)throw new Error('Select an actual retained draft revision.');
        return openDraft(state.draftId,n);
      }
      if(action==='tab'){
        state.tab=target.dataset.tab;changed();
        if(state.tab==='installation'&&!state.profileWork&&latestAttachment()&&!historic())await openInstallation();
        if(state.tab==='commissioning'&&!state.commissioningWork&&!historic()&&!pending()&&!readonly())commissioning.open();
        return;
      }
      if(action==='working-download')return snapshotDownload();
      if(action==='rebase')return rebaseWorking();
      if(action==='upload')return upload();
      if(action==='inspect')return openInspection(target.dataset.id);
      if(action==='native-receive')return receiveNative(target.dataset.id);
      if(action==='inspect-close'){inspection=null;state.inspectionFileId=null;state.pointerTarget=null;changed();return;}
      if(action==='remove'){
        requireEdit();const f=files().find(x=>x.id===target.dataset.id);
        if(f&&confirm('Remove '+f.filename+' from the next source revision? The full original remains in earlier history.'))return issue('file.remove',{fileId:f.id});
        return;
      }
      if(action==='file-download'){
        const f=files().find(x=>x.id===target.dataset.id);if(!f)throw new Error('Select an original complete file.');
        return download(prefix+'/'+state.draftId+'/files/'+f.id+'?'+revisionQuery()+'expectedSha256='+f.sha256,f);
      }
      if(action==='case-new')return editCase();
      if(action==='case-edit')return editCase(Number(target.dataset.index));
      if(action==='case-remove')return removeCase(Number(target.dataset.index));
      if(action==='case-cancel'){
        if(replaceFormAllowed(state.caseForm)){await parkWorking('Before closing the complete customer mapping');if(!available())return;clearRawFields(['field:caseForm.']);state.caseForm=null;state.pointerTarget=null;changed();}return;
      }
      if(action==='packet-review')return reviewPacket();
      if(action==='pointer-inspect')return inspectPointerSource(target.dataset.index);
      if(action==='pointer')return choosePointer(Number(target.dataset.index));
      if(action==='case-add')return applyCase();
      if(action==='save-selection')return saveSelection();
      if(action==='prepare')return prepare();
      if(action==='preparation-open'){await readPreparation(target.dataset.id);state.tab='outputs';changed();return;}
      if(action==='output-download'){
        const file=prepared?.files.find(x=>x.filename===target.dataset.filename);if(!file)throw new Error('Select one full prepared output.');
        return download(prefix+'/'+state.draftId+'/preparations/'+prepared.id+'/outputs/'+encodeURIComponent(file.filename)+'?expectedSha256='+file.sha256,file);
      }
      if(action==='archive-download'){
        const path=prefix+'/'+state.draftId+'/preparations/'+prepared.id+'/archive',id=prepared.id;
        const receipt=await bridge.api(path+'?describe=1');
        if(receipt.preparationId!==id)throw new Error('The whole archive changed original preparation.');
        return download(path+'?expectedSha256='+receipt.sha256,receipt);
      }
      if(action==='attach')return attach();
      if(action==='installation-open'){await parkWorking('Before refreshing the Installation selection');if(!available())return;return openInstallation();}
      if(action==='profile-seed')return seedProfile();
      if(action==='profile-preview')return previewProfile();
      if(action==='profile-apply')return receiveProfile();
      if(action==='profile-download'){
        const w=state.profileWork;if(!w?.prepared||w.previewBindings!==w.bindingsText)throw new Error('Review the complete current profile bindings.');
        downloadBlob(pretty(w.prepared),'INSTALLATION_PREPARATION.json');
        const programme=w.prepared.customerProgramme?programmeFiles(w.prepared.customerProgramme).get('CUSTOMER_PROGRAMME.md'):'';
        downloadBlob(renderWorkorder(w.prepared)+(programme?'\n\n'+programme:''),'INSTALLATION_WORKORDER.md','text/markdown;charset=utf-8');return;
      }
      if(action==='request-status')return readOriginal();
      if(action==='request-retry')return sendOriginal();
      if(action==='request-reject')return retireRejected();
    });
  });
  const beforeUnload=event=>{
    if(workingDirty()||editions.isDirty()||collection.collectionDirty()||pending()||storageError||persistedGeneration<generation){
      event.preventDefault();event.returnValue='';
    }
  };
  window.addEventListener('beforeunload',beforeUnload);
  async function closeView(){
    if(busy||hostBusy||copyLoading)return;
    await persistNow();state.open=false;changed();await persistNow();root.hidden=true;bridge.close?.();
  }
  async function initialize(){
    let retained=null;
    try{
      const rows=await journal.entries('request:');if(!available())return;
      const records=mergeRequests(rows.map(row=>row.value));for(const [id,value] of records)requestRecords.set(id,value);
      let pointer=null;try{pointer=sessionStorage.getItem(pointerKey);}catch(error){storageError='This window’s reopen pointer is unavailable. Choose a saved local copy explicitly. '+error.message;}
      if(pointer)retained=await journal.get('copy:'+pointer);
      if(!available())return;
      if(retained)applyCopy(validateCopy(retained));
      await refreshCopies();
    }catch(error){storageError='The complete local journal could not be opened. Download current fields or explicitly open a retained complete copy. '+error.message;state.error=storageError;if(retained)earlierCopies.push({...clone(retained),earlierCopies:[]});}
    if(!available())return;
    initialized=true;render();
    // Every new document owns a fresh copy even when a duplicated tab inherited its pointer.
    try{await persistNow();}catch(error){storageError=error.message;}
    if(!available())return;
    try{await refreshSelectedCopy();}
    catch(error){state.error='Your complete working fields are retained. Reopen the original source to finish readback. '+error.message;}
    if(!available())return;
    try{await persistNow();await refreshCopies();}catch(error){storageError=error.message;}
    finally{copyLoading=false;if(available())render();}
  }
  render();
  const ready=own(initialize()).catch(error=>{
    copyLoading=false;initialized=true;state.error=error.message||String(error);if(available())render();throw error;
  });
  // Expose the original failure while avoiding an unobserved rejected startup.
  ready.catch(()=>{});
  return {
    ready,
    async open(){await ready.catch(()=>{});if(!available())return;state.open=true;changed();render();try{await persistNow();}catch(error){storageError=error.message;status();}root.scrollIntoView({block:'start'});},
    setHostBusy(value){hostBusy=!!value;controls();},
    refresh(){if(available())render();},
    dispose(){
      if(closing)return closing;
      alive=false;clearTimeout(timer);timer=null;
      if(activeCopies.get(pointerKey)===copyId)activeCopies.delete(pointerKey);
      window.removeEventListener('beforeunload',beforeUnload);
      for(const controller of downloads)controller.abort();
      closing=(async()=>{
        // Accepted requests own their full journal through their final receipt.
        while(owned.size)await Promise.allSettled([...owned]);
        if(initialized&&!disposePersistenceAttempted){
          try{await persistNow();}catch(error){disposePersistenceError=error;}
          finally{disposePersistenceAttempted=true;}
        }
        let closeError=null;
        try{await journal.close();}catch(error){closeError=error;}
        const errors=[disposePersistenceError,closeError].filter(Boolean);
        if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'The preparation desk could not save and close its original browser journal.');
      })().catch(error=>{closing=null;throw error;});
      closing.catch(()=>{});return closing;
    }
  };
}
