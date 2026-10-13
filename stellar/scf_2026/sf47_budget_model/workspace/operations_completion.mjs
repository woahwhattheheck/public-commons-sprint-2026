// Payment-based completion operations in the original SF47 case.
import {completionCorrections,validateCompletionCorrectionInputs} from './operations_completion_corrections.mjs';
import {completionInstallations,validateInstallationWorkingCopy,validateInstallationWorkingState} from './operations_completion_installations.mjs';
import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const utcDate=()=>new Date().toISOString().slice(0,10);
const clone=value=>structuredClone(value);
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-completion-action="'+action+'" '+attrs+(disabled?' disabled data-completion-fixed="true"':'')+'>'+esc(text)+'</button>';
const table=(heads,rows)=>'<div class="completion-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const note=text=>'<p class="completion-note">'+esc(text)+'</p>';
function field(title,key,value='',options={}){
  const attrs=' name="'+esc(key)+'"'+(options.required?' required':'')+(options.attrs?' '+options.attrs:'');
  let input;
  if(options.options){const selected=options.multiple?(value||[]):[value];options={...options,options:[...options.options,...selected.filter(id=>id!==null&&id!==undefined&&id!==''&&!options.options.some(([key])=>String(key)===String(id))).map(id=>[id,'Retained original selection · '+id])]};}
  if(options.options)input='<select'+attrs+(options.multiple?' multiple size="3"':'')+'>'+options.options.map(([id,name,disabled])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+(disabled?' disabled':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>'+esc(value)+'</textarea>';
  else input='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>';
  return '<label class="'+(options.wide?'completion-wide':'')+'">'+esc(title)+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function saveDownload(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function values(select){return [...select.selectedOptions].map(row=>row.value);}
function definite(error){return [400,401,403,404,409,413,422].includes(error?.status)&&typeof error?.code==='string';}


const WORKING_SCHEMA='stellar-forge.sf47-completion-working-copy.v1';
const WORKING_LIMIT=256*1024*1024;
const completionObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const completionOrdered=value=>Array.isArray(value)?value.map(completionOrdered):completionObject(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,completionOrdered(value[key])])):value;
const completionSame=(a,b)=>JSON.stringify(completionOrdered(a))===JSON.stringify(completionOrdered(b));
const completionScope=context=>context?.installationId&&context?.staffId?
  {installationId:context.installationId,staffId:context.staffId}:null;
const completionFailure=(code,message)=>Object.assign(new Error(message),{code});
const completionCopyId=()=> 'completion-copy-'+crypto.randomUUID();
function completionJson(value){
  const text=JSON.stringify(value);
  if(new Blob([text]).size>WORKING_LIMIT)throw Error('Keep the complete original copy. Completion working files support up to 256 MiB.');
  return text;
}
function completionRequest(value){
  if(!completionObject(value)||!completionObject(value.payload))throw Error('Retain the complete original Completion request.');
  const p=value.payload;
  if(typeof p.requestId!=='string'||!p.requestId||p.requestId.length>200||
    !Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<1||typeof p.actor!=='string'||
    !['completion.save','completion.prepare','completion.extension','completion.submit','completion.decision','completion.corrections.save'].includes(p.action)||
    !completionObject(p.data)||(p.note!==undefined&&typeof p.note!=='string'))
    throw Error('The original request identity, actor, version or body is incomplete.');
  if(value.result!==undefined&&(!completionObject(value.result)||typeof value.result.id!=='string'||
    !Number.isSafeInteger(value.result.version)))throw Error('Keep the complete original accepted receipt.');
  if(value.rejection!==undefined&&!completionObject(value.rejection))throw Error('Keep the original rejection record.');
  return clone(value);
}
function mergeCompletionRequest(a,b){
  if(!a)return completionRequest(b);
  a=completionRequest(a);b=completionRequest(b);
  if(!completionSame(a.payload,b.payload))throw completionFailure('COMPLETION_REQUEST_CONFLICT',
    'Another complete original body uses this request ID. Keep both copies; do not replace its request.');
  if(a.result&&b.result&&!completionSame(a.result,b.result))throw completionFailure('COMPLETION_REQUEST_CONFLICT',
    'The original request has different accepted receipts. Keep both complete copies.');
  return {...a,...b,payload:clone(a.payload),...(a.result||b.result?{result:clone(a.result||b.result)}:{}),
    ...(a.rejection||b.rejection?{rejection:clone(b.rejection||a.rejection)}:{})};
}
function completionRequests(session){
  const records=new Map();
  const add=value=>{const checked=completionRequest(value),id=checked.payload.requestId;
    records.set(id,mergeCompletionRequest(records.get(id),checked));};
  for(const row of session.requestHistory||[])add(row);
  if(session.pending)add({payload:session.pending.payload});
  if(session.accepted)add(session.accepted);
  if(session.rejected)add({payload:session.rejected.payload,rejection:{code:session.rejected.code||'',message:session.rejected.message||''}});
  return [...records.values()];
}
function validateCompletionWorking(value,caseId){
  completionJson(value);
  const obj=completionObject,strings=x=>Array.isArray(x)&&x.every(y=>typeof y==='string');
  if(!obj(value)||value.schema!==WORKING_SCHEMA||value.caseId!==caseId||!obj(value.copy)||
    !/^completion-copy-[a-f0-9-]{36}$/.test(value.copy.id)||typeof value.copy.name!=='string'||
    !Number.isSafeInteger(value.copy.revision)||value.copy.revision<0||typeof value.copy.updatedAt!=='string'||
    !(value.scope===null||obj(value.scope)&&/^[a-f0-9]{32}$/.test(value.scope.installationId)&&/^(owner|[a-z][a-z0-9._-]{2,63})$/.test(value.scope.staffId))||
    !obj(value.session))throw Error('Choose the complete Completion working copy for this original case.');
  const s=value.session;
  if(![1,2,3].includes(s.tranche)||typeof s.asOfDate!=='string'||!obj(s.drafts)||!obj(s.formDrafts)||
    ['receiptId','summary','reviewId','correctionReviewId'].some(k=>typeof s[k]!=='string')||
    !strings(s.cohortReviewIds)||!strings(s.implementationReviewIds)||
    !Array.isArray(s.requestHistory||[])||(s.retainedDisplayHistory!==undefined&&!Array.isArray(s.retainedDisplayHistory))||
    !obj(s.corrections)||Object.keys(s).some(k=>k.startsWith('__completion')))throw Error('Keep the full editable Completion fields.');
  for(const [number,draft]of Object.entries(s.drafts)){
    if(!['1','2','3'].includes(number))throw Error('Choose an original Completion tranche.');
    validateInstallationWorkingCopy({schema:'stellar-forge.sf47-completion-installation-draft.v1',
      caseId,tranche:Number(number),assignment:draft,working:s.installationCompletion?.[number]||{}},caseId,Number(number));
  }
  for(const [number,form]of Object.entries(s.formDrafts)){
    if(!['1','2','3'].includes(number)||!obj(form)||['receiptId','summary','reviewId'].some(k=>typeof form[k]!=='string')||
      (form.cohortReviewIds!==undefined&&!strings(form.cohortReviewIds))||
      (form.implementationReviewIds!==undefined&&!strings(form.implementationReviewIds)))
      throw Error('Retain the complete original tranche form fields.');
  }
  for(const field of['dialog','closedDialog']){
    if(s[field]!=null&&(!obj(s[field])||!['completion.extension','completion.submit','completion.decision'].includes(s[field].action)||!obj(s[field].data)))
      throw Error('Keep the complete unfinished issuer form.');
    if(s[field])for(const [key,v]of Object.entries(s[field].data)){
      if(key==='sourceIds'?!strings(v):typeof v!=='string')throw Error('Retain the original issuer fields and source selections.');
    }
  }
  if(s.installationCompletion!==undefined&&(!obj(s.installationCompletion)||Object.keys(s.installationCompletion).some(k=>!['1','2','3'].includes(k)||!obj(s.installationCompletion[k]))))
    throw Error('Retain the original Installation tranche working state.');
  for(const [number,working]of Object.entries(s.installationCompletion||{}))
    validateInstallationWorkingState(working,caseId,Number(number));
  if(s.corrections!==undefined){
    const c=s.corrections;
    if(!obj(c)||!obj(c.drafts)||['selectedRoundId','outcomeId','reviewId','notice'].some(k=>typeof c[k]!=='string'))
      throw Error('Retain the full issuer-correction selection.');
    for(const [id,d]of Object.entries(c.drafts)){
      if(!obj(d)||!obj(d.seed)||!obj(d.seed.sourceOutcome)||!obj(d.seed.originalPreparation)||!Array.isArray(d.retained)||
        !Number.isSafeInteger(d.baseVersion)||typeof d.asOfDate!=='string')throw Error('Retain the complete correction draft and original source.');
      validateCompletionCorrectionInputs(d.inputs);validateCompletionCorrectionInputs(d.seed.inputs);
      if(id!==d.inputs.roundId||d.seed.inputs.roundId!==id||d.inputs.outcomeId!==d.seed.sourceOutcome.id)
        throw Error('The correction source and draft identities differ.');
    }
  }
  if(s.pending!=null)completionRequest(s.pending);
  if(s.accepted!=null)completionRequest(s.accepted);
  if(s.rejected!=null)completionRequest({payload:s.rejected.payload,rejection:{code:s.rejected.code||''}});
  completionRequests(s);
  // All assigned maps are original JSON, without prototype-changing keys.
  const visit=x=>{if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){
    if(['__proto__','prototype','constructor'].includes(k))throw Error('Use ordinary original working-copy fields.');visit(v);}};
  visit(value);
  return clone(value);
}
function openCompletionDatabase(name){
  return new Promise((resolve,reject)=>{
    let settled=false;const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>{const db=request.result;
      if(!db.objectStoreNames.contains('copies'))db.createObjectStore('copies',{keyPath:'key'});
      if(!db.objectStoreNames.contains('requests'))db.createObjectStore('requests',{keyPath:'key'});};
    request.onerror=()=>{settled=true;reject(request.error||Error('Completion storage could not open.'));};
    request.onblocked=()=>{settled=true;reject(Error('Close the earlier Completion storage reader, then reopen this copy.'));};
    request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}
      settled=true;db.onversionchange=()=>db.close();resolve(db);};
  });
}
function completionRead(db,store,key){
  return new Promise((resolve,reject)=>{const transaction=db.transaction(store,'readonly'),request=transaction.objectStore(store).get(key);
    let value;request.onsuccess=()=>{value=request.result;};
    transaction.oncomplete=()=>resolve(value??null);transaction.onabort=transaction.onerror=()=>reject(transaction.error||Error('Completion storage read failed.'));});
}
function completionCopies(db,caseId){
  return new Promise((resolve,reject)=>{const transaction=db.transaction('copies','readonly'),request=transaction.objectStore('copies').getAll();
    let values=[];request.onsuccess=()=>{values=request.result.filter(x=>x.value.caseId===caseId).map(x=>x.value);};
    transaction.oncomplete=()=>resolve(values.sort((a,b)=>b.copy.updatedAt.localeCompare(a.copy.updatedAt)));
    transaction.onabort=transaction.onerror=()=>reject(transaction.error||Error('Completion copies could not be listed.'));});
}
function writeCompletionCopy(db,value,expected){
  const incoming=completionRequests(value.session),key=value.caseId+':'+value.copy.id,requestPrefix=value.caseId+':'+JSON.stringify(value.scope?{installationId:value.scope.installationId,staffId:value.scope.staffId}:null)+':';
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(['copies','requests'],'readwrite'),copies=transaction.objectStore('copies'),requests=transaction.objectStore('requests');
    let failure=null,remaining=incoming.length+1,current=null,merged=[],result;
    const abort=error=>{failure=error;transaction.abort();};
    const finish=()=>{
      if(--remaining)return;
      try{
        if((current?.value.copy.revision??0)!==expected)throw completionFailure('COMPLETION_COPY_CONFLICT',
          'Another window saved this copy. Download your complete current work or keep it as a separate copy; the saved version remains unchanged.');
        result=clone(value);result.copy.revision=expected+1;result.copy.updatedAt=new Date().toISOString();
        result.session.requestHistory=merged;
        for(const row of merged)requests.put({key:requestPrefix+row.payload.requestId,value:row});
        copies.put({key,value:result});
      }catch(error){abort(error);}
    };
    const original=copies.get(key);original.onsuccess=()=>{current=original.result;finish();};
    incoming.forEach((row,i)=>{const read=requests.get(requestPrefix+row.payload.requestId);
      read.onsuccess=()=>{try{merged[i]=mergeCompletionRequest(read.result?.value,row);finish();}catch(error){abort(error);}};});
    transaction.oncomplete=()=>resolve(result);
    transaction.onabort=transaction.onerror=()=>reject(failure||transaction.error||Error('The complete working copy could not be retained.'));
  });
}

export function mountCompletion({container,current,saveApi,session,mutationId,recordingActor,onCase,staffContext=currentStaffContext()}){
  const root=document.createElement('section');root.className='completion-desk';root.setAttribute('aria-label','Tranche completion');container.replaceChildren(root);
  if(!document.querySelector('link[data-completion-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_completion.css';link.dataset.completionStyle='true';document.head.append(link);
  }
  for(const [key,value] of Object.entries({tranche:1,asOfDate:utcDate(),drafts:{},formDrafts:{},receiptId:'',summary:'',cohortReviewIds:[],implementationReviewIds:[],correctionReviewId:'',preview:null,reviewId:'',review:null,pending:null,accepted:null,inflight:null,dialog:null,notice:'',error:''})){
    if(!Object.hasOwn(session,key))session[key]=value;
  }
  let active=true,hostBusy=false,busy=false,caseValue=current,calendar=current.completion;
  const available=()=>active&&root.isConnected;
  const editable=()=>scopeCurrent()&&!workingBusy()&&caseValue.program.state==='OPEN'&&!hostBusy&&!busy&&!session.pending&&!session.inflight&&!session.accepted;
  const $=selector=>root.querySelector(selector);
  const draft=()=>session.drafts[String(session.tranche)];
  const sourceOptions=()=>caseValue.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,10)]);
  const identity=id=>(caseValue.records.contributors.find(row=>row.id===id)?.name||id);
  const prefix='/api/operations/'+current.program.id;
  const savedPlan=tranche=>caseValue.completionPlans?.find(row=>row.tranche===tranche);
  function clearPreview(){session.preview=null;}
  const corrections=completionCorrections({getCase:()=>caseValue,session,api:saveApi,mutate,clearPreview,
    selectEvidence(id){session.correctionReviewId=id;clearPreview();},
    async adoptCase(next){captureCurrent(next);if(available())await onCase(next,null);}});
  const installationCompletion=completionInstallations({getCase:()=>caseValue,getDraft:draft,session,api:saveApi,clearPreview,beforeReplace:preserveWorking});

  const pinnedContext=staffContext?{...staffContext}:null,currentScope=completionScope(pinnedContext);
  const storageName=staffDeskStorageKey('sf47.completion-working.v1',pinnedContext);
  const pointerKey=staffDeskStorageKey('sf47.completion-copy.'+current.program.id,pinnedContext);
  const persistence=session.__completionPersistence??={copyId:completionCopyId(),revision:0,name:'Completion working copy',
    scope:clone(currentScope),serial:Promise.resolve(),initialized:false,fault:null,dirty:false,changes:0,timer:null,db:null,copies:[]};
  session.__completionPersistence=persistence;
  session.requestHistory??=[];
  const scopeCurrent=()=>completionSame(persistence.scope,currentScope);
  const workingBusy=()=>!persistence.initialized||persistence.receiving===true;
  function workingSnapshot(){
    const state=Object.fromEntries(Object.entries(session).filter(([key])=>!key.startsWith('__completion')&&key!=='inflight'));
    state.inflight=null;state.requestHistory=completionRequests(session);
    return {schema:WORKING_SCHEMA,caseId:current.program.id,scope:clone(persistence.scope),
      copy:{id:persistence.copyId,name:persistence.name,revision:persistence.revision,updatedAt:new Date().toISOString()},session:clone(state)};
  }
  function retainMemoryRequests(records){
    const merged=new Map(completionRequests(session).map(row=>[row.payload.requestId,row]));
    for(const row of records)merged.set(row.payload.requestId,mergeCompletionRequest(merged.get(row.payload.requestId),row));
    session.requestHistory=[...merged.values()];
  }
  async function workingDatabase(){
    if(!persistence.db)persistence.db=await openCompletionDatabase(storageName);
    return persistence.db;
  }
  function rememberPointer(){try{sessionStorage.setItem(pointerKey,persistence.copyId);}catch{
    persistence.pointerWarning='This browser cannot remember the selected copy. Reopen it from Saved working copies after reload.';}}
  async function listWorkingCopies(){
    try{persistence.copies=await completionCopies(await workingDatabase(),current.program.id);}
    catch(cause){persistence.fault=cause;}
  }
  function storageMessage(){
    if(!persistence.initialized)return 'Opening the complete retained working copy…';
    if(persistence.fault)return persistence.fault.message+' Your complete current download remains available.';
    if(!scopeCurrent())return 'This retained copy belongs to its original installation/operator. It is open for reading and download.';
    return persistence.dirty?'Keeping the complete current fields…':'Complete working copy retained · revision '+persistence.revision;
  }
  function refreshWorkingStatus(){
    if(!available())return;
    const el=$('[data-completion-working-status]');if(el)el.textContent=storageMessage();
  }
  function writeWorking(value,change,{retry=false}={}){
    const work=persistence.serial.then(async()=>{
      if(value.copy.id!==persistence.copyId)throw completionFailure('COMPLETION_COPY_CONTEXT_CHANGED','This queued save belongs to its original working copy.');
      if(persistence.fault&&!retry)throw persistence.fault;
      const result=await writeCompletionCopy(await workingDatabase(),value,persistence.revision);
      persistence.revision=result.copy.revision;persistence.fault=null;
      retainMemoryRequests(result.session.requestHistory);rememberPointer();
      if(persistence.changes===change)persistence.dirty=false;
      const i=persistence.copies.findIndex(x=>x.copy.id===result.copy.id);
      if(i<0)persistence.copies.unshift(result);else persistence.copies[i]=result;
      refreshWorkingStatus();return result;
    });
    persistence.serial=work.catch(cause=>{if(value.copy.id===persistence.copyId){persistence.fault=cause;refreshWorkingStatus();}});
    return work;
  }
  function queueWorkingSave(){
    if(!persistence.initialized||persistence.receiving)return;
    persistence.dirty=true;persistence.changes++;
    clearTimeout(persistence.timer);
    persistence.timer=setTimeout(()=>{
      persistence.timer=null;
      try{writeWorking(workingSnapshot(),persistence.changes).catch(()=>{});}
      catch(cause){persistence.fault=cause;refreshWorkingStatus();}
    },150);
    refreshWorkingStatus();
  }
  async function persistWorking({retry=false}={}){
    clearTimeout(persistence.timer);persistence.timer=null;
    const value=workingSnapshot();completionJson(value);
    return writeWorking(value,persistence.changes,{retry});
  }
  function downloadWorking(filename='completion-working-copy'){
    // Original field handlers update synchronously before this click; no storage
    // or network read is needed to retain uncertain requests and entered fields.
    const value=workingSnapshot();
    saveDownload(new Blob([completionJson(value)+'\n'],{type:'application/json'}),current.program.id+'-'+filename+'.json');
  }
  function applyWorking(value){
    const incoming=clone(value.session),oldCorrections=session.corrections;
    incoming.inflight=null;incoming.requestHistory=completionRequests(incoming);
    const retained={preview:incoming.preview,review:incoming.review,forms:{},installations:{},corrections:{}};
    incoming.preview=null;incoming.review=null;
    for(const [number,form]of Object.entries(incoming.formDrafts)){
      retained.forms[number]={preview:form.preview,review:form.review};form.preview=null;form.review=null;
    }
    incoming.installationCompletion??={};
    for(const [number,work]of Object.entries(incoming.installationCompletion)){
      retained.installations[number]={preview:work.preview,requestInputs:work.requestInputs};
      incoming.installationCompletion[number]=validateInstallationWorkingState(work,current.program.id,Number(number));
      incoming.installationCompletion[number].preview=null;incoming.installationCompletion[number].requestInputs=null;
    }
    if(incoming.corrections){
      retained.corrections={review:incoming.corrections.review,rebase:incoming.corrections.rebase,drafts:{}};
      incoming.corrections.review=null;incoming.corrections.rebase=null;
      for(const [id,d]of Object.entries(incoming.corrections.drafts)){retained.corrections.drafts[id]=d.preview;d.preview=null;}
    }
    incoming.retainedDisplayHistory??=[];
    if(retained.preview||retained.review||Object.values(retained.forms).some(x=>x.preview||x.review)||
      Object.values(retained.installations).some(x=>x.preview)||retained.corrections.review||retained.corrections.rebase||
      Object.values(retained.corrections.drafts||{}).some(Boolean))incoming.retainedDisplayHistory.push(retained);
    completionJson(incoming);
    // The original correction controller holds its state object; retain that
    // object while replacing its complete fields only after full validation.
    for(const key of Object.keys(session))if(!key.startsWith('__completion'))delete session[key];
    Object.assign(session,incoming);
    if(oldCorrections&&incoming.corrections){
      for(const key of Object.keys(oldCorrections))delete oldCorrections[key];
      Object.assign(oldCorrections,incoming.corrections);session.corrections=oldCorrections;
    }
    persistence.copyId=value.copy.id;persistence.revision=value.copy.revision;
    persistence.name=value.copy.name;persistence.scope=clone(value.scope);
  }
  async function initializeWorking(){
    if(persistence.initialized)return;
    try{
      let chosen;try{chosen=sessionStorage.getItem(pointerKey);}catch{}
      if(chosen&&/^completion-copy-[a-f0-9-]{36}$/.test(chosen))persistence.copyId=chosen;
      const stored=await completionRead(await workingDatabase(),'copies',current.program.id+':'+persistence.copyId);
      const retained=Object.keys(session.drafts).length>0||session.pending||session.accepted||session.dialog||session.closedDialog||session.summary||session.requestHistory.length>0;
      if(stored&&!retained){
        const value=validateCompletionWorking(stored.value,current.program.id);
        // A same-page retained session can hold an in-flight original request.
        // Initial cold receiving occurs only before any new native action.
        applyWorking(value);
      }
      if(retained){persistence.copyId=completionCopyId();persistence.revision=0;persistence.name='Retained in-page Completion copy';}
      persistence.initialized=true;await listWorkingCopies();
      if(!stored||retained)await persistWorking();
      else rememberPointer();
    }catch(cause){persistence.fault=cause;persistence.initialized=true;}
  }
  async function preserveWorking(label){
    downloadWorking('before-replacement');
    if(!persistence.fault)await persistWorking();
    session.notice=label+'. The complete preceding work remains in its original copy and download.';
  }
  async function separateWorking(){
    clearTimeout(persistence.timer);persistence.timer=null;
    const previousId=persistence.copyId,change=persistence.changes;
    await persistence.serial;if(!available()||persistence.copyId!==previousId||persistence.changes!==change)return;
    const value=workingSnapshot();value.copy={...value.copy,id:completionCopyId(),revision:0,name:persistence.name+' — separate copy'};
    const result=await writeCompletionCopy(await workingDatabase(),value,0);
    if(!available()||persistence.copyId!==previousId||persistence.changes!==change)return;
    applyWorking(result);persistence.fault=null;persistence.dirty=false;rememberPointer();await listWorkingCopies();
    session.notice='Opened a separate complete copy. The earlier saved version and its original requests remain retained.';
  }
  async function receiveWorking(value){
    const checked=validateCompletionWorking(value,current.program.id),previousId=persistence.copyId,change=persistence.changes;
    const existing=new Map(completionRequests(session).map(row=>[row.payload.requestId,row]));
    checked.session.requestHistory=completionRequests(checked.session).map(row=>completionSame(checked.scope,persistence.scope)?mergeCompletionRequest(existing.get(row.payload.requestId),row):row);
    if(session.pending||session.accepted)throw Error('Receive the current original save before opening another working copy. Its complete download remains available.');
    await preserveWorking('Before opening another Completion working copy');
    if(!available()||persistence.copyId!==previousId||persistence.changes!==change)return;
    const received=clone(checked);received.copy={...received.copy,id:completionCopyId(),revision:0};
    // The original copy and selected file are retained. All request collisions
    // are preflighted in the same atomic transaction before adopting the fields.
    let result,storageFailure=null;
    try{result=await writeCompletionCopy(await workingDatabase(),received,0);}
    catch(cause){if(['COMPLETION_REQUEST_CONFLICT','COMPLETION_COPY_CONFLICT'].includes(cause.code))throw cause;storageFailure=cause;result=received;}
    if(!available()||persistence.copyId!==previousId||persistence.changes!==change)return;
    applyWorking(result);persistence.fault=storageFailure;persistence.dirty=!!storageFailure;rememberPointer();if(!storageFailure)await listWorkingCopies();
    render();
    if(!scopeCurrent()){session.notice='Opened the original operator’s complete copy for reading and download. Continue its requests with that operator and installation.';return;}
    const next=await reloadCase();await reconcileAccepted(next);
    if(session.reviewId)await openReview(session.reviewId);
    session.notice=scopeCurrent()?'Opened the full original working copy. Review its saved source versions before saving.':
      'Opened the original operator’s complete copy for reading and download. Continue its requests with that operator and installation.';
  }
  async function workingAction(action){
    if(action==='working-download'){downloadWorking();return true;}
    if(action==='working-separate'){await separateWorking();return true;}
    if(action==='working-save'){await persistWorking({retry:true});session.notice='Retained the complete original working copy.';return true;}
    if(action==='working-refresh'){await listWorkingCopies();return true;}
    if(action==='working-open'){
      const id=$('[name=completionWorkingSelection]')?.value;if(!id)throw Error('Choose a saved complete working copy.');
      const selected=await completionRead(await workingDatabase(),'copies',current.program.id+':'+id);
      if(!selected)throw Error('The selected original working copy is unavailable.');
      await receiveWorking(selected.value);return true;
    }
    if(action==='working-import'){
      const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
      const file=await new Promise(resolve=>{picker.addEventListener('change',()=>resolve(picker.files?.[0]||null),{once:true});
        picker.addEventListener('cancel',()=>resolve(null),{once:true});picker.click();});
      if(!file)return true;
      if(file.size>WORKING_LIMIT)throw Error('Open a complete Completion working file within 256 MiB.');
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
      if(!available())return true;
      await receiveWorking(JSON.parse(text.replace(/^\uFEFF/,'')));return true;
    }
    return false;
  }
  function workingMarkup(){
    return '<section aria-label="Completion working copies"><h3>Complete working copies</h3>'+
      '<p>Each copy retains every tranche, unfinished form, Installation selection and original request. A request awaiting its result keeps its original ID and body.</p>'+
      '<p data-completion-working-status role="status">'+esc(storageMessage())+'</p>'+
      (persistence.pointerWarning?'<p>'+esc(persistence.pointerWarning)+'</p>':'')+
      '<div class="completion-fields">'+field('Working copy name','completionWorkingName',persistence.name)+
      field('Saved working copies','completionWorkingSelection',persistence.copyId,{options:persistence.copies.map(x=>[x.copy.id,x.copy.name+' · '+new Date(x.copy.updatedAt).toLocaleString()+' · revision '+x.copy.revision])})+'</div>'+
      '<div class="completion-actions">'+button('Save working copy','working-save')+
      button('Keep as separate copy','working-separate')+button('Refresh saved copies','working-refresh')+
      button('Open selected working copy','working-open','',!!session.pending||!!session.accepted)+
      button('Open complete working-copy file','working-import','',!!session.pending||!!session.accepted)+
      button('Download complete working copy','working-download')+'</div>'+
      (session.requestHistory?.length?'<details><summary>Original request and receipt history</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(session.requestHistory,null,2))+'</pre></details>':'')+'</section>';
  }

  function error(error){session.error=error.message||String(error);if(available())render();}
  function updateControls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(hostBusy||busy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const action=el.dataset.completionAction,download=['working-download','installation-download','download-draft','correction-download'].includes(action);
      if(download){el.disabled=workingBusy()&&action!=='working-download';continue;}
      const local=action?.startsWith('working-')||['completionWorkingName','completionWorkingSelection'].includes(el.name);
      const retry=action==='retry',readback=action==='readback',recovery=local;
      el.disabled=el.dataset.completionFixed==='true'||workingBusy()||!scopeCurrent()&&!local||hostBusy||busy||!!session.inflight||
        (!!session.pending&&!retry&&!readback&&!recovery)||(!!session.accepted&&!readback&&!recovery)||
        ((el.dataset.completionWrite==='true'||el.closest('[data-completion-dialog]')&&el.tagName!=='BUTTON')&&caseValue.program.state!=='OPEN');
    }
  }
  async function run(fn){
    if(!available()||workingBusy()||hostBusy||busy||session.inflight)return;
    busy=true;session.error='';updateControls();
    try{return await fn();}catch(cause){error(cause);}finally{busy=false;queueWorkingSave();if(available())render();}
  }
  function captureCurrent(next){
    if(next.program.id!==current.program.id)throw new Error('The returned completion case changed identity.');
    caseValue=next;
    for(const [number,value] of Object.entries(session.drafts)){
      const saved=next.completionPlans?.find(row=>row.tranche===Number(number));
      const amended=(value.planContentSha256&&value.planContentSha256!==next.plan.contentSha256)||
        Number(next.program.lastPlanAmendmentVersion||0)>value.baseVersion;
      if(!value.dirty&&amended&&!value.retainedDraft){delete session.drafts[number];continue;}
      if(amended){
        value.reviewRequired=true;
        if(!value.previousInputs&&saved)value.previousInputs=clone(saved.inputs);
      }
      const savedCurrent=saved&&(saved.planContentSha256===next.plan.contentSha256||
        !saved.planContentSha256&&!next.program.lastPlanAmendmentVersion);
      if(!value.dirty&&savedCurrent){
        value.inputs=clone(saved.inputs);value.baseVersion=next.program.version;value.planContentSha256=next.plan.contentSha256;
        value.reviewRequired=false;value.previousInputs=null;
      }
    }
    if(session.preview?.source.version!==next.program.version)session.preview=null;
    calendar=next.completion;
  }
  async function reloadCase(){
    const next=await saveApi(prefix);captureCurrent(next);
    if(session.asOfDate!==next.completion.asOfDate)calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(session.asOfDate));
    return next;
  }
  function downloadDraft(value=draft()){
    if(!value)return;
    const content={caseId:caseValue.program.id,tranche:session.tranche,...clone(value)};
    saveDownload(new Blob([JSON.stringify(content,null,2)+'\n'],{type:'application/json'}),
      caseValue.program.id+'-completion-tranche-'+session.tranche+'-draft.json');
  }
  async function reconcileDraft(next){
    const value=draft();
    if(!value)return loadDraft(session.tranche);
    const amended=value.planContentSha256&&value.planContentSha256!==next.plan.contentSha256||
      Number(next.program.lastPlanAmendmentVersion||0)>value.baseVersion;
    if(!amended){value.baseVersion=next.program.version;return value;}
    const number=session.tranche;
    const seeded=await saveApi(prefix+'/completion-seed',{expectedVersion:next.program.version,tranche:number});
    if(session.tranche!==number||session.drafts[String(number)]!==value||caseValue.program.version!==next.program.version)
      throw new Error('The case or selected draft changed while its current assignments were opening. Reopen the retained draft.');
    const earlier=clone(value),retained=new Map(value.inputs.items.map(item=>[item.costId,item]));
    const inputs={...clone(seeded.inputs),note:value.inputs.note,
      items:seeded.inputs.items.map(item=>clone(retained.get(item.costId)||item))};
    const reconciled={inputs,baseVersion:next.program.version,dirty:true,planContentSha256:next.plan.contentSha256,
      reviewRequired:true,previousInputs:seeded.previousInputs?clone(seeded.previousInputs):null,retainedDraft:earlier};
    session.drafts[String(session.tranche)]=reconciled;
    return reconciled;
  }
  async function loadDraft(tranche){
    const key=String(tranche),existing=session.drafts[key];
    if(existing)return existing;
    const version=caseValue.program.version,planContentSha256=caseValue.plan.contentSha256;
    const seeded=await saveApi(prefix+'/completion-seed',{expectedVersion:version,tranche});
    if(session.drafts[key])return session.drafts[key];
    const created={inputs:seeded.inputs,baseVersion:version,dirty:false,
      planContentSha256,reviewRequired:!!seeded.reviewRequired,
      previousInputs:seeded.previousInputs?clone(seeded.previousInputs):null};
    session.drafts[key]=created;return created;
  }
  async function reconcileAccepted(next){
    const accepted=session.accepted;if(!accepted)return;
    const {payload,result}=accepted;
    if(next.program.id!==result.id||next.program.version<result.version)return;
    let superseded=false;
    if(payload.action==='completion.corrections.save'){
      if(!next.reviews.some(row=>row.id===result.recordId))return;
      await corrections.accepted(next,payload,result);
    }else if(payload.action==='completion.save'){
      const number=payload.data.inputs.tranche,saved=next.completionPlans?.find(row=>row.tranche===number);
      if(!saved||saved.id!==result.recordId||!result.unchanged&&saved.version<result.version)return;
      superseded=saved.version>result.version;
      const retainedDraft=session.drafts[String(number)]?.retainedDraft||null;
      const currentBasis=saved.planContentSha256===next.plan.contentSha256||
        !saved.planContentSha256&&!next.program.lastPlanAmendmentVersion;
      if(currentBasis){
        session.drafts[String(number)]={inputs:clone(saved.inputs),baseVersion:next.program.version,dirty:false,
          planContentSha256:next.plan.contentSha256,reviewRequired:false,previousInputs:null,retainedDraft};
      }else{
        delete session.drafts[String(number)];
        const selected=await loadDraft(number);selected.retainedDraft=retainedDraft;
      }
    }else if(payload.action==='completion.prepare'){
      if(!next.reviews.some(row=>row.id===result.recordId))return;
      session.reviewId=result.recordId;session.review=null;
    }else if(payload.action==='completion.extension'){
      if(!next.completionPlans.some(row=>row.extensions.some(item=>item.id===result.extensionId)))return;
    }else if(!next.records.outcomes.some(row=>row.id===result.recordId))return;
    retainMemoryRequests([{payload:clone(payload),result:clone(result)}]);
    if(session.pending?.payload.requestId===payload.requestId)session.pending=null;
    session.accepted=null;session.dialog=null;
    session.notice=payload.action==='completion.corrections.save'?'Saved the original correction edition and its complete source.':payload.action==='completion.prepare'?'Prepared the complete original tranche form and selected sources.':
      payload.action==='completion.submit'?'Retained the actual form submission with its original preparation and payment deadline.':
      payload.action==='completion.extension'?'Retained the issuer confirmation; the original deadline remains visible.':
      payload.action==='completion.decision'?'Retained the issuer outcome on the original form submission.':
      superseded?'Your assignments were saved. The current case also contains a later recorded assignment change.':
      result.unchanged?'Reopened the original saved assignments.':'Saved the complete tranche assignments in this case.';
  }
  async function sendPending(){
    const retained=session.pending;if(!retained)return;
    if(!scopeCurrent())throw Error('Receive this original request with its retained installation and operator.');
    assertStaffRequestActor(retained.payload,pinnedContext);
    if(session.inflight){await session.inflight;return;}
    const original=clone(retained.payload);
    const work=(async()=>{
      // Admission is the complete original JSON; no live form is read after this.
      // Copy and global request records commit together before the first POST.
      const stored=await persistWorking();
      const recorded=stored.session.requestHistory.find(x=>x.payload.requestId===original.requestId);
      if(recorded?.rejection&&!recorded.result){
        session.pending=null;session.rejected={payload:original,...clone(recorded.rejection)};
        await persistWorking();throw Object.assign(new Error(recorded.rejection.message||'This original request was rejected. Review its retained fields before preparing a corrected request.'),{code:recorded.rejection.code});
      }
      if(recorded?.result){
        session.accepted={payload:original,result:clone(recorded.result)};session.pending=null;
        await persistWorking();return recorded.result;
      }
      let result;
      try{result=await saveApi(prefix+'/command',original);}
      catch(cause){
        if(definite(cause)&&![401,403].includes(cause.status)){
          const rejection={code:cause.code,message:cause.message||String(cause)};
          retainMemoryRequests([{payload:original,rejection}]);
          session.pending=null;session.rejected={payload:original,...rejection};
          session.notice='The original request was rejected. Its complete body and your entered fields remain retained.';
          try{await persistWorking();}catch(storageError){persistence.fault=storageError;}
        }
        session.error=cause.message||String(cause);throw cause;
      }
      // A storage failure after the actual reply keeps both the accepted result
      // and exact pending request in memory/download; it never marks it rejected.
      session.accepted={payload:original,result:clone(result)};
      retainMemoryRequests([session.accepted]);await persistWorking();
      session.pending=null;session.error='';await persistWorking();return result;
    })();
    session.inflight=work;updateControls();
    let result;
    try{result=await work;}finally{if(session.inflight===work)session.inflight=null;}
    const next=await reloadCase();await reconcileAccepted(next);await persistWorking();
    if(available())await onCase(next,result);return result;
  }
  async function mutate(action,data,expectedVersion=caseValue.program.version){
    if(!available()||workingBusy()||!scopeCurrent()||hostBusy||session.pending||session.inflight||session.accepted||caseValue.program.state!=='OPEN')return;
    const payload={expectedVersion,actor:recordingActor(),action,data:clone(data),note:''};
    payload.requestId=await mutationId('operations:'+action,payload);
    if(!available())return;
    assertStaffRequestActor(payload,pinnedContext);
    session.pending={payload};retainMemoryRequests([{payload}]);session.error='';$('dialog.completion-dialog')?.close();
    try{return await sendPending();}
    catch(cause){
      if(definite(cause)&&![401,403].includes(cause.status)){
        const next=await reloadCase();
        if(available())await onCase(next,null);
      }
      throw cause;
    }
  }
  async function openReview(id){
    if(!id){session.review=null;session.reviewId='';return;}
    const review=await saveApi(prefix+'/reviews/'+id);
    if(review.purpose!=='TRANCHE_COMPLETION')throw new Error('Select an original tranche completion preparation.');
    session.reviewId=id;session.review=review;
  }
  async function selectTranche(number){
    session.formDrafts[String(session.tranche)]={receiptId:session.receiptId,summary:session.summary,cohortReviewIds:clone(session.cohortReviewIds),implementationReviewIds:clone(session.implementationReviewIds),correctionReviewId:session.correctionReviewId,
      preview:session.preview,reviewId:session.reviewId,review:session.review};
    session.tranche=number;
    Object.assign(session,{cohortReviewIds:[],implementationReviewIds:[],correctionReviewId:''},session.formDrafts[String(number)]||{receiptId:'',summary:'',preview:null,reviewId:'',review:null});
    if(session.preview?.source.version!==caseValue.program.version)session.preview=null;
    await loadDraft(number);chooseReceipt();
  }
  async function openCalendarSelection(){
    const retained=session.requestCalendar;
    const requested=retained||([1,2,3].includes(session.requestTranche)?{tranche:session.requestTranche}:null);
    if(!requested||session.pending||session.inflight||session.accepted)return '';
    const stillSelected=()=>available()&&(retained?session.requestCalendar===retained:
      !session.requestCalendar&&session.requestTranche===requested.tranche);
    const number=[1,2,3].includes(requested.tranche)?requested.tranche:session.tranche;
    let selectedCalendar=calendar,selectedReview=null;
    if(requested.asOfDate&&requested.asOfDate!==calendar.asOfDate)
      selectedCalendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(requested.asOfDate));
    const selectedReceipt=requested.receiptId?
      selectedCalendar.clocks.find(row=>row.receiptId===requested.receiptId&&row.tranche===number):null;
    if(requested.receiptId&&!selectedReceipt)
      throw new Error('The linked payment is no longer attached to this tranche. Refresh the delivery calendar.');
    if(requested.reviewId){
      selectedReview=await saveApi(prefix+'/reviews/'+encodeURIComponent(requested.reviewId));
      if(selectedReview.purpose!=='TRANCHE_COMPLETION')
        throw new Error('Select an original tranche completion preparation.');
    }
    await loadDraft(number);
    if(!stillSelected())return '';
    if(number!==session.tranche)await selectTranche(number);
    if(!stillSelected())return '';
    const changed=session.asOfDate!==selectedCalendar.asOfDate||
      selectedReceipt&&session.receiptId!==selectedReceipt.receiptId;
    session.asOfDate=selectedCalendar.asOfDate;calendar=selectedCalendar;
    if(selectedReceipt)session.receiptId=selectedReceipt.receiptId;
    if(changed)clearPreview();
    if(selectedReview){session.reviewId=selectedReview.id;session.review=selectedReview;}
    delete session.requestCalendar;delete session.requestTranche;
    return requested.costId||'';
  }
  function chooseReceipt(){
    if(session.receiptId)return;
    session.receiptId=calendar.clocks.find(row=>row.tranche===session.tranche&&row.active)?.receiptId||'';
  }
  function clockTable(){
    if(!calendar.clocks.length)return note('Record a received grant payment in Cash / issuer to begin a completion clock. Assignment planning is available now.');
    return table(['Previous payment','Completion','Original deadline','Confirmed deadline','Form state',''],calendar.clocks.map(row=>[
      'T'+row.paymentTranche+' · '+esc(row.paidOn)+'<small>'+esc(row.paymentReference)+'</small>',
      'T'+row.tranche,
      esc(row.originalDeadlineOn),
      row.extension?esc(row.deadlineOn)+'<small>'+esc(row.extension.reference)+'</small>':'—',
      esc(label(row.status))+(row.active?'<small>'+row.daysRemaining+' calendar days remaining</small>':''),
      button('Use this payment','receipt','data-receipt="'+esc(row.receiptId)+'"')+
        button('Record issuer extension','extension','data-receipt="'+esc(row.receiptId)+'" data-completion-write="true"',!row.active||caseValue.program.state!=='OPEN'),
    ]));
  }
  function itemFields(item,original){
    if(!original)return '<details class="completion-item" open><summary><strong>'+esc(item.costId)+
      '</strong> · earlier package retained in draft</summary><p>This package is absent from the selected tranche in the current plan. Open saved assignments to prepare the current package set. Its complete earlier assignment remains below and in case history.</p><pre>'+esc(JSON.stringify(item,null,2))+'</pre></details>';
    const attrs=key=>'data-completion-field="'+key+'" data-cost="'+esc(item.costId)+'" data-completion-write="true"';
    const work=caseValue.records.work.filter(row=>row.costId===item.costId).map(row=>[row.id,row.description+' · '+row.state]);
    const deployments=caseValue.records.deployments.filter(row=>(row.tranche===null||row.tranche===session.tranche)&&(!row.costIds.length||row.costIds.includes(item.costId))).map(row=>[row.id,row.name+' · '+row.state]);
    for(const id of item.workIds)if(!work.some(row=>row[0]===id)){
      const row=caseValue.records.work.find(value=>value.id===id);work.push([id,(row?.description||id)+' · association changed; review']);
    }
    for(const id of item.deploymentIds)if(!deployments.some(row=>row[0]===id)){
      const row=caseValue.records.deployments.find(value=>value.id===id);deployments.push([id,(row?.name||id)+' · association changed; review']);
    }
    return '<details class="completion-item" data-completion-item="'+esc(item.costId)+'" open><summary><strong>'+esc(item.costId)+'</strong> · '+esc(label(item.state))+'</summary>'+
      '<p>'+esc(original.remainingWork)+'</p><p><strong>Success criteria:</strong> '+esc(original.successCriteria)+'</p>'+
      '<p class="completion-small">Original award days '+original.awardStartDay+'–'+original.awardEndDay+
      (original.awardStartDate?' · '+esc(original.awardStartDate)+' to '+esc(original.awardEndDate):'')+
      ' · '+esc(original.plannedHours)+' planned hours · $'+esc(original.plannedUsd)+'</p>'+
      (original.planningAssignments.length?'<p class="completion-small">Planning allocation: '+original.planningAssignments.map(row=>esc(row.name)+' '+esc(row.hours)+' h').join(', ')+'</p>':'')+
      '<div class="completion-fields">'+
      field('Assigned contributors','owners_'+item.costId,item.ownerIds,{options:caseValue.records.contributors.map(row=>[row.id,row.name]),multiple:true,attrs:attrs('ownerIds'),wide:true})+
      field('Assigned start','start_'+item.costId,item.startDate,{type:'date',attrs:attrs('startDate')})+
      field('Assigned finish','finish_'+item.costId,item.endDate,{type:'date',attrs:attrs('endDate')})+
      field('Delivery state','state_'+item.costId,item.state,{options:['PLANNED','IN_PROGRESS','COMPLETE'].map(x=>[x,label(x)]),attrs:attrs('state')})+
      field('Actual completion date','completed_'+item.costId,item.completedOn,{type:'date',attrs:attrs('completedOn')})+
      field('Actual completed result','result_'+item.costId,item.completionNote,{area:true,wide:true,attrs:attrs('completionNote')})+
      field('Original work records','work_'+item.costId,item.workIds,{options:work,multiple:true,attrs:attrs('workIds')})+
      field('Original deployments','deployments_'+item.costId,item.deploymentIds,{options:deployments,multiple:true,attrs:attrs('deploymentIds')})+
      field('Retained deliverable sources','sources_'+item.costId,item.sourceIds,{options:sourceOptions(),multiple:true,wide:true,attrs:attrs('sourceIds')})+
      field('Assignment note','note_'+item.costId,item.note,{area:true,wide:true,attrs:attrs('note')})+
      '</div></details>';
  }
  function assignments(){
    const value=draft(),row=calendar.tranches.find(x=>x.tranche===session.tranche);
    if(!value)return note('Opening the original work-package assignments…');
    const stale=value.baseVersion!==caseValue.program.version;
    const packages=new Map(row.packages.map(x=>[x.costId,x]));
    return '<section><div class="completion-heading"><h3>Tranche '+session.tranche+' deliverables</h3><div class="completion-actions">'+
      button('Save assignments','save','data-completion-write="true"',caseValue.program.state!=='OPEN'||stale)+
      button('Open saved assignments','reset')+button('Download assignment draft','download-draft')+'</div></div>'+
      '<p>'+esc(row.deliverable)+'</p><p class="completion-small">Award-relative submission: day '+row.awardSubmitDay+(row.awardSubmitDate?' · '+esc(row.awardSubmitDate):'')+'</p>'+
      '<p class="completion-note" data-completion-draft-status>'+esc(value.dirty?'Unsaved assignment changes':'Original assignment source version '+value.baseVersion)+'</p>'+
      (stale?'<div class="completion-note"><p>The case is now version '+caseValue.program.version+'. Review the saved source alongside your retained draft.</p>'+
        button('Keep draft against current case','rebase','data-completion-write="true"',caseValue.program.state!=='OPEN')+'</div>':'')+
      (value.reviewRequired?'<div class="completion-note"><p>The case plan was amended. Review the current package scope, assignments and linked records, then save these assignments to retain this revision.</p>'+
        (value.previousInputs?'<details><summary>Earlier saved assignments</summary><pre>'+esc(JSON.stringify(value.previousInputs,null,2))+'</pre></details>':'')+'</div>':'')+
      (value.retainedDraft?'<details><summary>Retained draft before package reconciliation</summary><p>The complete earlier fields remain in the assignment-draft download.</p><pre>'+
        esc(JSON.stringify(value.retainedDraft,null,2))+'</pre></details>':'')+
      value.inputs.items.map(item=>itemFields(item,packages.get(item.costId))).join('')+
      field('Completion plan note','completionPlanNote',value.inputs.note,{area:true,wide:true,attrs:'data-completion-plan-note data-completion-write="true"'})+
      '</section>';
  }
  function implementationSelection(){
    const selected=session.implementationReviewIds;
    const rows=caseValue.reviews.filter(row=>row.purpose==='IMPLEMENTATION_EVIDENCE'&&(row.implementationTranche===session.tranche||selected.includes(row.id)));
    const options=rows.map(row=>[row.id,'T'+row.implementationTranche+' · '+(row.implementationName||row.id)+' · '+(row.evidenceReady?'current evidence':'findings retained')+(row.implementationCurrent?.current===false?' · linked source changed':'')]);
    for(const id of selected)if(!rows.some(row=>row.id===id))options.push([id,id+' · original review unavailable']);
    return field('Frozen implementation evidence (optional)','completionImplementation',selected,{options,multiple:true,wide:true,
      help:'Select exact reviews from Implementation evidence. The preview checks their tranche, cutoff and original linked records and Installation editions. Technical and customer receiving remain distinct.'});
  }
  function implementationEvidence(candidate){
    const rows=candidate?.implementationEvidence||[];if(!rows.length)return '';
    return '<section class="completion-cohorts"><h4>Frozen implementation evidence</h4>'+
      table(['Review','Observation cutoff','Separate receiving',''],rows.map(row=>{
        const value=row.review.implementation,counts=value.summary;
        return [esc(value.inputs.name)+'<small>'+esc(row.reviewId)+'</small>',esc(value.inputs.asOfAt),
          counts.technicalAcceptedTasks+' technical / '+counts.customerAcceptedTasks+' customer accepted tasks<small>'+
          (row.sourceCurrent?'Selected links current':'Selected links changed')+'</small>',
          button('Download implementation evidence','download-implementation','data-review="'+esc(row.reviewId)+'"')];
      }))+'</section>';
  }
  function cohortSelection(){
    const selected=session.cohortReviewIds;
    const rows=caseValue.reviews.filter(row=>row.purpose==='COHORT_EVALUATION'&&(row.cohortTranche===session.tranche||selected.includes(row.id)));
    const options=rows.map(row=>[row.id,'T'+row.cohortTranche+' · '+(row.cohortName||row.id)+' · '+(row.cohortReady?'targets met':'findings retained')+(row.cohortSourceCurrent===false?' · source changed':'')]);
    for(const id of selected)if(!rows.some(row=>row.id===id))options.push([id,id+' · original review unavailable']);
    return field('Frozen cohort evidence (optional)','completionCohorts',selected,{options,multiple:true,wide:true,
      help:'Select reviews prepared in Cohort acceptance. The completion preview checks their original tranche, cutoff, targets and measurement source. Selection does not assert issuer acceptance.'});
  }
  function cohortEvidence(candidate){
    const rows=candidate?.cohortEvidence||[];if(!rows.length)return '';
    return '<section class="completion-cohorts"><h4>Frozen cohort evidence</h4>'+
      table(['Review','Purchase window / cutoff','At preparation',''],rows.map(row=>{
        const value=row.review.cohort,inputs=value.inputs;
        return [esc(inputs.name)+'<small>'+esc(row.reviewId)+'</small>',
          esc(inputs.windowStart||'Unentered')+' – '+esc(inputs.windowEnd||'Unentered')+'<small>'+esc(inputs.asOfAt)+'</small>',
          (row.ready?'Targets met':'Findings retained')+'<small>'+(row.sourceCurrent?'Measurement source current':'Measurement source changed')+'</small>',
          button('Download cohort evidence','download-cohort','data-review="'+esc(row.reviewId)+'"')];
      }))+'</section>';
  }
  function preparation(){
    const options=calendar.clocks.filter(row=>row.tranche===session.tranche).map(row=>[row.receiptId,'T'+row.paymentTranche+' payment '+row.paidOn+' · due '+row.deadlineOn+' · '+row.paymentReference,!row.active]);
    const value=draft(),preview=session.preview;
    return '<section><h3>Prepare the completion form</h3><div class="completion-fields">'+
      field('Previous payment','completionReceipt',session.receiptId,{options:[['','Choose the actual previous payment'],...options],wide:true})+
      field('Completed tranche result','completionSummary',session.summary,{area:true,rows:5,wide:true,max:20000,attrs:'data-completion-write="true"'})+
      cohortSelection()+implementationSelection()+
      field('Saved issuer correction edition (optional)','completionCorrection',session.correctionReviewId,{options:[['','No correction edition selected'],...caseValue.reviews.filter(x=>x.purpose==='TRANCHE_CORRECTIONS'&&x.completionTranche===session.tranche).map(x=>[x.id,x.correctionTitle+' · edition '+x.correctionRevision])],wide:true,help:'This exact saved round and its original issuer findings accompany re-preparation. It does not change the actual payment deadline.'})+
      '</div><div class="completion-actions">'+button('Preview completion','preview','',!session.receiptId||!!value?.dirty)+
      button('Prepare completion','prepare','data-completion-write="true"',!preview?.ready||preview?.source.version!==caseValue.program.version||caseValue.program.state!=='OPEN')+'</div>'+
      (value?.dirty?note('Save the edited assignments before preparing their form.'): '')+
      (preview?'<div class="completion-preview" data-completion-preview><h4>'+ (preview.ready?'Ready to prepare':'Complete the remaining fields')+
        '</h4><p>Previous payment '+esc(preview.receipt.date)+' · form deadline '+esc(preview.clock.deadlineOn)+'</p>'+
        (preview.issues.length?'<ul>'+preview.issues.map(item=>'<li>'+esc(item.costId?item.costId+': ':'')+esc(item.message)+'</li>').join('')+'</ul>':'')+
        '<p>'+esc(preview.summary)+'</p>'+cohortEvidence(preview)+implementationEvidence(preview)+corrections.evidence(preview)+installationCompletion.evidence(preview)+'<small>Reviewed case version '+preview.source.version+'</small></div>':'')+'</section>';
  }
  function preparations(){
    const reviews=caseValue.reviews.filter(row=>row.purpose==='TRANCHE_COMPLETION'&&row.completionTranche===session.tranche);
    const review=session.review,candidate=review?.completion;
    return '<section><h3>Saved form preparations</h3>'+
      (reviews.length?field('Prepared completion','completionReview',session.reviewId,{options:[['','Choose an original preparation'],...reviews.map(row=>[row.id,row.createdAt+' · T'+row.completionTranche+' · '+row.id])],wide:true}):note('Prepared forms appear here with their complete frozen source.'))+
      (candidate?'<div class="completion-preview" data-completion-review="'+esc(review.id)+'"><h4>Tranche '+candidate.clock.tranche+' preparation</h4>'+
        '<p>'+esc(candidate.summary)+'</p><p>Paid '+esc(candidate.receipt.date)+' · reviewed deadline '+esc(candidate.clock.deadlineOn)+'</p>'+
        table(['Work package','Owners','Completed','Result'],candidate.completionPlan.inputs.items.map(item=>[
          esc(item.costId),item.ownerIds.map(id=>esc(candidate.completionPlan?review.snapshot.records.contributors.find(row=>row.id===id)?.name||id:id)).join(', '),
          esc(item.completedOn),esc(item.completionNote)]))+cohortEvidence(candidate)+implementationEvidence(candidate)+corrections.evidence(candidate)+installationCompletion.evidence(candidate)+
        '<div class="completion-actions">'+button('Download prepared files','download-review')+
        button('Record form submission','submission','data-completion-write="true"',caseValue.program.state!=='OPEN')+'</div></div>':'')+
      '</section>';
  }
  function submissions(){
    const rows=caseValue.records.outcomes.filter(row=>row.completion&&row.tranche===session.tranche);
    return '<section><h3>Actual form submissions and issuer outcomes</h3>'+
      (rows.length?table(['Form reference','Submitted','Deadline used','Current issuer outcome',''],rows.map(row=>[
        esc(row.completion.formReference),esc(row.completion.submittedOn),
        esc(row.completion.deadlineOn)+'<small>'+ (row.completion.submittedOn<=row.completion.deadlineOn?'Submitted within deadline':'Submitted after deadline')+'</small>',
        esc(label(row.state))+'<small>'+esc(row.date)+'</small>'+(row.completion.correction?'<small>Resubmission from '+esc(row.completion.correction.sourceOutcomeId)+' · correction edition '+row.completion.correction.revision+'</small>':''),
        button('Open preparation','review','data-review="'+esc(row.completion.reviewId)+'"')+
        button('Record issuer outcome','decision','data-outcome="'+esc(row.id)+'" data-completion-write="true"',caseValue.program.state!=='OPEN')+
        (row.state==='CHANGES_REQUESTED'?button('Start correction round','correction-new','data-outcome="'+esc(row.id)+'" data-completion-write="true"',caseValue.program.state!=='OPEN'):''),
      ])):note('Use the original completion form receipt to record its submission. Each receipt keeps the exact prepared source.'))+'</section>';
  }
  function dialogMarkup(){
    const selected=session.dialog;if(!selected||session.pending||session.inflight||session.accepted)return '';
    const v=selected.data;
    let fields='',title='';
    if(selected.action==='completion.extension'){
      title='Record issuer-confirmed extension';
      fields=note('Original previous payment '+v.receiptId)+
        field('Issuer confirmation date','confirmedOn',v.confirmedOn,{type:'date',required:true})+
        field('Confirmed submission deadline','deadlineOn',v.deadlineOn,{type:'date',required:true})+
        field('Original confirmation reference','reference',v.reference,{wide:true,required:true})+
        field('Issuer confirmation note','note',v.note,{area:true,wide:true})+
        field('Retained confirmation sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }else if(selected.action==='completion.submit'){
      title='Record actual form submission';
      fields=field('Actual form submission date','submittedOn',v.submittedOn,{type:'date',required:true})+
        field('Original form receipt reference','formReference',v.formReference,{required:true,wide:true})+
        field('Original form source / observation','sourceNote',v.sourceNote,{area:true,wide:true})+
        field('Retained form receipt sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }else{
      title='Record issuer outcome';
      fields=field('Issuer outcome','state',v.state,{options:['ACCEPTED','CHANGES_REQUESTED','WITHDRAWN'].map(x=>[x,label(x)])})+
        field('Actual outcome date','date',v.date,{type:'date',required:true})+
        field('Original issuer reference and outcome','sourceNote',v.sourceNote,{area:true,wide:true,required:true})+
        field('Retained issuer sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }
    return '<dialog class="completion-dialog" aria-labelledby="completion-dialog-title"><form data-completion-dialog>'+
      '<h3 id="completion-dialog-title">'+title+'</h3><div class="completion-fields">'+fields+'</div>'+
      '<p role="alert">'+esc(session.error)+'</p><div class="completion-actions">'+button('Keep draft and close','close-dialog')+
      '<button type="submit" data-completion-write="true">Save original record</button></div></form></dialog>';
  }
  function render(){
    if(!available())return;
    const pending=session.pending;
    root.innerHTML='<div class="completion-heading"><div><h2>Tranche completion</h2><p>Assignments, received payments, prepared forms and actual submissions in this case.</p></div>'+
      '<a href="'+esc(calendar.rule.sourceUrl)+'" target="_blank" rel="noopener noreferrer">SCF tranche guidelines</a></div>'+
      '<p class="completion-small">Each T0, T1 or T2 payment starts the following tranche form’s 90-calendar-day clock. The original award schedule stays alongside it. Issuer outcomes below show their current recorded state; the calendar date selects payment and form dates.</p>'+
      '<div class="completion-fields">'+field('Completion tranche','completionTranche',session.tranche,{options:[[1,'Tranche 1'],[2,'Tranche 2'],[3,'Tranche 3']]})+
      field('Calendar date','completionAsOfDate',session.asOfDate,{type:'date',help:caseValue.program.mode==='WALKTHROUGH'?'Illustrative dates remain in this walkthrough.':'Current UTC date by default.'})+'</div>'+
      '<p data-completion-message role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.error||session.notice)+'</p>'+
      (pending?'<div class="completion-note"><p>Retained request '+esc(pending.payload.requestId)+' awaits its original result.</p>'+button('Retry same save','retry')+'</div>':'')+
      (session.accepted?'<div class="completion-note"><p>The write returned its receipt.</p>'+button('Reopen accepted result','readback')+'</div>':'')+
      (session.closedDialog&&!session.dialog?button('Resume form draft','resume-dialog'):'')+
      '<section><h3>Payment clocks</h3>'+clockTable()+
      (calendar.unassignedGrantIds.length?note('These received grant payments need their original tranche selection. Use the original cash correction to void an incorrect receipt and record its corrected source: '+calendar.unassignedGrantIds.join(', ')):'')+
      (calendar.finalPaymentIds.length?note('Final T3 payments retained: '+calendar.finalPaymentIds.join(', ')):'')+'</section>'+
      workingMarkup()+assignments()+installationCompletion.markup()+corrections.markup()+preparation()+preparations()+submissions()+dialogMarkup();
    const dialog=$('dialog.completion-dialog');if(dialog&&!dialog.open)dialog.showModal();
    updateControls();
  }
  root.addEventListener('input',event=>{
    const el=event.target;
    if(el.name==='completionWorkingName'&&!workingBusy()&&!busy){persistence.name=el.value;queueWorkingSave();return;}
    if(!editable())return;
    if(installationCompletion.input(el))return;
    if(corrections.input(el)){clearPreview();const prepare=root.querySelector('[data-completion-action=correction-save]');if(prepare){prepare.disabled=true;prepare.dataset.completionFixed='true';}return;}
    if(el.matches('[data-completion-field]')){
      const value=draft(),item=value.inputs.items.find(row=>row.costId===el.dataset.cost),key=el.dataset.completionField;
      item[key]=el.multiple?values(el):el.type==='date'?(el.value||null):el.value;value.dirty=true;clearPreview();
    }else if(el.matches('[data-completion-plan-note]')){draft().inputs.note=el.value;draft().dirty=true;clearPreview();}
    else if(el.name==='completionSummary'){session.summary=el.value;clearPreview();}
    else if(el.closest('[data-completion-dialog]'))session.dialog.data[el.name]=el.multiple?values(el):el.value;
    const status=$('[data-completion-draft-status]');if(status&&draft()?.dirty)status.textContent='Unsaved assignment changes';
    const previewButton=$('[data-completion-action=preview]');if(previewButton){previewButton.dataset.completionFixed=String(!session.receiptId||!!draft()?.dirty);previewButton.disabled=previewButton.dataset.completionFixed==='true';}
    const preview=$('[data-completion-preview]');if(preview&&!session.preview)preview.remove();
    const prepare=root.querySelector('[data-completion-action=prepare]');if(prepare&&!session.preview){prepare.disabled=true;prepare.dataset.completionFixed='true';}
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(installationCompletion.input(el)){if(editable())queueWorkingSave();render();return;}
    if(corrections.change(el)){render();return;}
    if(el.name==='completionCorrection'){session.correctionReviewId=el.value;clearPreview();render();return;}
    if(el.closest('[data-completion-dialog]')&&editable())session.dialog.data[el.name]=el.multiple?values(el):el.value;
    if(el.name==='completionTranche')run(async()=>{if(session.pending||session.accepted)return;await selectTranche(Number(el.value));});
    if(el.name==='completionAsOfDate')run(async()=>{if(session.pending)return;session.asOfDate=el.value;calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(el.value));clearPreview();chooseReceipt();});
    if(el.name==='completionReceipt'){if(session.pending||busy||hostBusy)return;session.receiptId=el.value;clearPreview();render();}
    if(el.name==='completionImplementation'){if(session.pending||busy||hostBusy)return;session.implementationReviewIds=values(el);clearPreview();render();}
    if(el.name==='completionCohorts'){if(session.pending||busy||hostBusy)return;session.cohortReviewIds=values(el);clearPreview();render();}
    if(el.name==='completionReview')run(async()=>openReview(el.value));
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-completion-action]');if(!target||target.disabled)return;
    const action=target.dataset.completionAction;
    if(action==='working-download'){try{downloadWorking();}catch(cause){error(cause);}return;}
    if(['installation-download','download-draft','correction-download'].includes(action)){
      try{
        if(action==='download-draft')downloadDraft();
        else if(action==='installation-download')installationCompletion.action(action,target).catch(error);
        else corrections.action(action,target).catch(error);
      }catch(cause){error(cause);}return;
    }
    run(async()=>{
      if(await workingAction(action))return;
      if(action==='retry'){
        await sendPending();return;
      }
      if(action==='readback'){const accepted=session.accepted;const next=await reloadCase();await reconcileAccepted(next);await persistWorking();if(available())await onCase(next,accepted?.result||null);return;}
      if(action==='correction-download'){await corrections.action(action,target);return;}
      if(session.pending||session.accepted)return;
      if(await installationCompletion.action(action,target))return;
      if(await corrections.action(action,target))return;
      if(action==='resume-dialog'){session.dialog=session.closedDialog;session.closedDialog=null;return;}
      if(action==='save'){
        const value=draft();
        if(value.baseVersion!==caseValue.program.version)throw new Error('Review the current case before saving your retained draft.');
        await mutate('completion.save',{inputs:value.inputs},value.baseVersion);return;
      }
      if(action==='download-draft'){downloadDraft();return;}
      if(action==='reset'){
        const value=draft();if(value?.dirty||value?.retainedDraft)await preserveWorking('Before opening saved assignments');
        delete session.drafts[String(session.tranche)];await loadDraft(session.tranche);clearPreview();return;
      }
      if(action==='rebase'){
        const next=await reloadCase();await reconcileDraft(next);
        session.notice='Retained edits are joined to the current package set. Review assignments and linked work before saving.';
        clearPreview();if(available())await onCase(next,null);return;
      }
      if(action==='receipt'){
        const clock=calendar.clocks.find(row=>row.receiptId===target.dataset.receipt);
        if(clock.tranche!==session.tranche)await selectTranche(clock.tranche);
        session.receiptId=clock.receiptId;clearPreview();return;
      }
      if(action==='preview'){
        if(draft()?.dirty)throw new Error('Save the edited assignments before preparing their completion.');
        session.preview=await saveApi(prefix+'/completion-preview',{expectedVersion:caseValue.program.version,receiptId:session.receiptId,asOfDate:session.asOfDate,summary:session.summary,...(session.cohortReviewIds.length?{cohortReviewIds:clone(session.cohortReviewIds)}:{}),...(session.implementationReviewIds.length?{implementationReviewIds:clone(session.implementationReviewIds)}:{}),...(session.correctionReviewId?{correctionReviewId:session.correctionReviewId}:{})});return;
      }
      if(action==='prepare'){
        const preview=session.preview;if(!preview?.ready||preview.source.version!==caseValue.program.version)throw new Error('Preview the complete current source before preparing.');
        await mutate('completion.prepare',{receiptId:session.receiptId,asOfDate:session.asOfDate,summary:session.summary,expectedPreviewSha256:preview.previewSha256,...(session.cohortReviewIds.length?{cohortReviewIds:clone(session.cohortReviewIds)}:{}),...(session.implementationReviewIds.length?{implementationReviewIds:clone(session.implementationReviewIds)}:{}),...(session.correctionReviewId?{correctionReviewId:session.correctionReviewId}:{})});return;
      }
      if(action==='review'){await openReview(target.dataset.review);return;}
      if(action==='download-implementation'){
        const id=target.dataset.review,response=await saveApi(prefix+'/implementation-reviews/'+encodeURIComponent(id)+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())saveDownload(blob,id+'-implementation.zip');return;
      }
      if(action==='download-cohort'){
        const id=target.dataset.review,response=await saveApi(prefix+'/cohort-reviews/'+encodeURIComponent(id)+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())saveDownload(blob,id+'-cohort.zip');return;
      }
      if(action==='download-review'){
        const response=await saveApi(prefix+'/completion-reviews/'+session.reviewId+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())saveDownload(blob,session.reviewId+'-completion.zip');return;
      }
      if(action==='extension'){
        session.dialog={action:'completion.extension',data:{receiptId:target.dataset.receipt,confirmedOn:session.asOfDate,deadlineOn:'',reference:'',sourceIds:[],note:''}};return;
      }
      if(action==='submission'){
        if(!session.review)throw new Error('Open the original prepared form first.');
        session.dialog={action:'completion.submit',data:{reviewId:session.review.id,expectedReviewSha256:session.review.businessSha256,submittedOn:session.asOfDate,formReference:'',sourceIds:[],sourceNote:''}};return;
      }
      if(action==='decision'){
        session.dialog={action:'completion.decision',data:{outcomeId:target.dataset.outcome,state:'ACCEPTED',date:session.asOfDate,sourceIds:[],sourceNote:''}};return;
      }
      if(action==='close-dialog'){$('dialog.completion-dialog')?.close();session.closedDialog=session.dialog;session.dialog=null;return;}
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-completion-dialog]'))return;event.preventDefault();
    const selected=session.dialog;
    run(async()=>{if(!selected||session.pending)return;await mutate(selected.action,selected.data);});
  });
  root.addEventListener('cancel',event=>{
    if(event.target.matches('dialog.completion-dialog')){event.preventDefault();if(!session.pending&&!session.inflight){session.closedDialog=session.dialog;session.dialog=null;render();}}
  },true);
  const changedWorking=()=>{if(available()&&persistence.initialized&&!busy&&!hostBusy)queueWorkingSave();};
  root.addEventListener('input',changedWorking);
  root.addEventListener('change',changedWorking);
  root.addEventListener('cancel',changedWorking,true);
  const beforeUnload=event=>{
    if(persistence.dirty||persistence.fault||session.pending||session.accepted||session.inflight){
      event.preventDefault();event.returnValue='';
    }
  };
  // Keep the case's warning through in-page navigation while its durable write
  // is unfinished. A remount replaces this one listener rather than accumulating it.
  if(persistence.beforeUnload)window.removeEventListener('beforeunload',persistence.beforeUnload);
  persistence.beforeUnload=beforeUnload;window.addEventListener('beforeunload',beforeUnload);
  render();
  const ready=(async()=>{
    let selectedCost='';
    busy=true;updateControls();
    try{
      await initializeWorking();render();
      if(!scopeCurrent())return;
      if(session.inflight){try{await session.inflight;}catch{}}
      captureCurrent(caseValue);
      if(session.accepted||session.rejected){const next=await reloadCase();await reconcileAccepted(next);session.rejected=null;}
      else if(session.asOfDate!==calendar.asOfDate)calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(session.asOfDate));
      selectedCost=await openCalendarSelection();
      await loadDraft(session.tranche);chooseReceipt();
      if(session.reviewId&&session.review?.id!==session.reviewId)await openReview(session.reviewId);
    }finally{
      busy=false;queueWorkingSave();render();
      if(selectedCost&&available()){
        const item=[...root.querySelectorAll('[data-completion-item]')].find(row=>row.dataset.completionItem===selectedCost);
        if(item){item.open=true;item.scrollIntoView({block:'start'});const title=item.querySelector('summary');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
      }
    }
  })();
  return {ready,root,setHostBusy(value){hostBusy=!!value;updateControls();},
    dispose(){if(persistence.initialized){clearTimeout(persistence.timer);persistence.timer=null;
      try{persistWorking().catch(()=>{});}catch(cause){persistence.fault=cause;}}
      active=false;$('dialog.completion-dialog')?.close();}};
}
