// Complete contributor agreements and native receiving in the original SF47 case.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
import {ENGAGEMENT_STATE_KEYS,ENGAGEMENT_WORKING_MAX_COPIES,captureEngagementState,engagementStateShape,
  engagementWorkingBinding,createEngagementWorkingCopy,validateEngagementWorkingCopy,encodeEngagementWorkingCopy,
  readEngagementWorkingFile,readEngagementSessionText,inspectEngagementWorkingCopy,reconcileEngagementWorkingState,verifyEngagementPortfolioFile,
  engagementBytesSha256,engagementBase64,engagementUnbase64,equalEngagementValue} from './engagement-working-copy.mjs';
import {createEngagementWorkingDesk} from './engagement-working-desk.mjs';
import {createEngagementWorkingStore} from './engagement-working-store.mjs';
const SCHEMA='stellar-forge.sf47-contributor-engagements.v1';
const STORAGE='sf47.engagements.v1:';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const date=()=>new Date().toISOString().slice(0,10);
const words=value=>String(value??'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const attrs=value=>Object.entries(value).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('');
const button=(label,action,data={},disabled=false)=>'<button type="button" data-engagement-action="'+action+'"'+attrs(data)+(disabled?' disabled data-engagement-fixed="true"':'')+'>'+esc(label)+'</button>';
const empty=text=>'<p class="engagement-empty">'+esc(text)+'</p>';
const note=text=>'<div class="engagement-note">'+esc(text)+'</div>';
const table=(headers,rows)=>'<div class="engagement-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const status=value=>'<span class="engagement-status">'+esc(words(value))+'</span>';
const selectedValues=select=>[...select.selectedOptions].map(o=>o.value);
const definite=error=>[400,401,403,404,409,413,422].includes(error?.status)&&typeof error?.code==='string';
function field(label,value,options={}){
  const properties={...options.attrs};
  if(options.required)properties.required='required';
  let input;
  if(options.options)input='<select'+attrs(properties)+(options.multiple?' multiple size="4"':'')+'>'+options.options.map(([id,text,disabled])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+(disabled?' disabled':'')+'>'+esc(text)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+attrs(properties)+' rows="'+(options.rows||3)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>'+esc(value)+'</textarea>';
  else input='<input'+attrs(properties)+' type="'+(options.type||'text')+'" value="'+esc(value)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>';
  if(options.type==='checkbox')input='<input'+attrs(properties)+' type="checkbox"'+(value?' checked':'')+'>';
  return '<label'+(options.wide?' class="engagement-wide"':options.type==='checkbox'?' class="engagement-check"':'')+'>'+esc(label)+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function plain(value){
  if(value===null||value===undefined)return 'Unstated';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value==='string'||typeof value==='number')return String(value);
  return JSON.stringify(value);
}
function nativeDetails(value,depth=0){
  if(value===null||typeof value!=='object')return '<p>'+esc(plain(value))+'</p>';
  if(Array.isArray(value)){
    if(!value.length)return empty('No entries.');
    if(value.every(item=>item===null||typeof item!=='object'))return '<ul>'+value.map(item=>'<li>'+esc(plain(item))+'</li>').join('')+'</ul>';
    const columns=[...new Set(value.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).flatMap(Object.keys))];
    if(columns.length&&columns.length<=8&&value.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.values(item).every(v=>v===null||typeof v!=='object')))
      return table(columns.map(words),value.map(item=>columns.map(key=>esc(plain(item[key])))));
    return value.map((item,index)=>'<details'+(depth<1?' open':'')+'><summary>'+esc(item?.name||item?.role||item?.message||item?.code||'Entry '+(index+1))+'</summary><div>'+nativeDetails(item,depth+1)+'</div></details>').join('');
  }
  const scalar=Object.entries(value).filter(([,v])=>v===null||typeof v!=='object'),nested=Object.entries(value).filter(([,v])=>v!==null&&typeof v==='object');
  return (scalar.length?table(['Item','Retained value'],scalar.map(([key,v])=>[esc(words(key)),esc(plain(v))])):'')+nested.map(([key,v])=>'<details'+(depth<1?' open':'')+'><summary>'+esc(words(key))+'</summary><div>'+nativeDetails(v,depth+1)+'</div></details>').join('');
}
export function mountEngagements({container,current,saveApi,session,mutationId,recordingActor,onCase,onSources,onPortfolio,onForecast,
  isCurrent=()=>true,staffContext=currentStaffContext()}){
  const root=document.createElement('section');root.className='engagement-desk';root.setAttribute('aria-label','Contributor engagements');container.replaceChildren(root);
  if(!document.querySelector('link[data-engagement-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_engagements.css';link.dataset.engagementStyle='true';document.head.append(link);
  }
  if(!document.querySelector('link[data-engagement-working-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/engagement-working-desk.css';link.dataset.engagementWorkingStyle='true';document.head.append(link);
  }
  const programId=current.program.id,prefix='/api/operations/'+programId,storageKey=staffDeskStorageKey(STORAGE+programId,staffContext);
  const storage=createEngagementWorkingStore({key:storageKey});
  let storageLoaded=false,dependenciesReady=false;
  const defaults={tab:'editor',document:null,selectedAgreement:'',search:'',acceptanceFilter:'',newContributor:'',
    preview:null,previewVersion:null,selectedReview:'',saved:null,history:[],pending:null,accepted:null,rejected:null,
    handoff:null,receiving:null,receivingHistory:[],notice:'',error:'',storageError:'',draftVersion:null,
    controls:{},portfolioFile:null,pendingPortfolioFile:null,storageOriginal:null,requestReceipts:[],storageBlocked:false,legacySession:null,copies:[],workingName:'Contributor preparation',workingSelected:null};
  for(const[key,value]of Object.entries(defaults))if(!Object.hasOwn(session,key))session[key]=clone(value);
  async function loadStoredSession(){
    if(session.initialized){
      const stored=await storage.read();
      const observed=storage.inspect().revision;
      if(session.storageRevision===undefined&&stored!==null)throw new Error('A complete stored preparation already exists alongside this retained open view. Download this current work before reopening the stored edition.');
      if(session.storageRevision!==undefined&&session.storageRevision!==observed)throw new Error('Another window saved a newer complete preparation while this view was closed. Download the retained current work before reopening or choosing another stored edition.');
      session.storageRevision=observed;storageLoaded=true;return;
    }
    for(const[key,value]of Object.entries(defaults))session[key]=clone(value);
    // The full record is in IndexedDB. Only the previous complete session is
    // read from sessionStorage; its exact key is never rewritten or deleted.
    const retainedRecord=await storage.read();session.storageRevision=storage.inspect().revision;
    let raw=null;
    try{
      let retained=retainedRecord,originalKey=storageKey;
      if(retained===null||retained===undefined){
        raw=sessionStorage.getItem(storageKey);
        if(raw===null&&storageKey!==STORAGE+programId){originalKey=STORAGE+programId;raw=sessionStorage.getItem(originalKey);}
        retained=raw?JSON.parse(raw):null;
      }
      if(retained){
        if(raw&&retained.schema==='sf47.engagement-operator.v1'&&retained.programId===programId){
          session.legacySession={key:originalKey,raw};session.storageOriginal=raw;session.storageBlocked=true;session.tab='copies';
          session.storageError='The original browser preparation is retained unchanged. Inspect its complete conversion and explicitly open it under the current recording-staff scope.';
        }else{
          if(retained.schema!=='sf47.engagement-operator.v2'||retained.programId!==programId||retained.scopeKey!==storageKey)throw new Error('The retained preparation belongs to another case or staff scope.');
          for(const key of Object.keys(defaults))if(Object.hasOwn(retained,key))session[key]=retained[key];
          engagementStateShape(captureEngagementState(session),programId);
          if(!Array.isArray(session.copies)||session.copies.length>ENGAGEMENT_WORKING_MAX_COPIES)throw new Error('The complete local checkpoint inventory is unavailable.');
          for(const row of session.copies){validateEngagementWorkingCopy(row.document);if(row.id!==row.sha256||!/^[a-f0-9]{64}$/.test(row.id)||!Number.isInteger(row.bytes))throw new Error('The local checkpoint identity is incomplete.');}
          if(session.workingSelected)validateEngagementWorkingCopy(session.workingSelected.document);
        }
      }
    }catch(error){
      for(const[key,value]of Object.entries(defaults))session[key]=clone(value);
      session.storageOriginal=raw??JSON.stringify(retainedRecord);session.storageBlocked=true;
      session.storageError='The original local preparation could not be opened. Its complete bytes remain retained for working-file recovery: '+error.message;
      session.tab='copies';
    }
    storageLoaded=true;session.initialized=true;
  }
  let active=true,busy=false,hostBusy=false,caseValue=current;
  const available=()=>active&&root.isConnected&&isCurrent();
  const downloads=new Map();let closing=null;
  const retainedCloseOwner={close:()=>dispose()};
  function blobDownload(blob,name){
    const url=URL.createObjectURL(blob);downloads.set(url,null);
    try{const link=document.createElement('a');link.href=url;link.download=name;link.click();
      downloads.set(url,setTimeout(()=>{try{URL.revokeObjectURL(url);downloads.delete(url);}catch{}},10000));
    }catch(error){try{URL.revokeObjectURL(url);downloads.delete(url);}catch{}throw error;}
  }
  const $=selector=>root.querySelector(selector);
  const editable=()=>caseValue.program.state==='OPEN'&&!session.saved;
  const unfinishedFlow=()=>!!session.receiving?.forecastId&&session.receiving.phase!=='COMPLETED';
  const canWrite=()=>available()&&editable()&&!busy&&!hostBusy&&!session.pending&&!session.accepted&&!session.inflight&&!unfinishedFlow();
  const agreements=()=>session.document?.agreements||[];
  const agreement=()=>agreements().find(row=>row.id===session.selectedAgreement);
  const contributors=()=>caseValue.records.contributors;
  const contributor=id=>contributors().find(row=>row.id===id);
  const packages=()=>caseValue.plan.scenario.future_costs;
  const packageName=id=>{const row=packages().find(row=>row.id===id);return row?.name||row?.description||row?.label||id;};
  const sourceOptions=()=>caseValue.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
  const contributorOptions=()=>contributors().filter(row=>row.state==='ACTIVE'||row.id===agreement()?.contributorId).map(row=>[row.id,row.name]);
  function persist(required=false){
    if(!storageLoaded){if(required)return Promise.reject(new Error('The original complete preparation has not finished opening.'));return Promise.resolve(false);}
    if(session.storageBlocked){if(required)return Promise.reject(new Error(session.storageError||'Retain the original unreadable preparation before replacing it.'));return Promise.resolve(false);}
    const record={schema:'sf47.engagement-operator.v2',programId,scopeKey:storageKey};
    for(const key of Object.keys(defaults))record[key]=session[key];
    record.storageError='';
    let pending;
    try{pending=required?storage.write(record):storage.schedule(record);}catch(error){pending=Promise.reject(error);}
    return Promise.resolve(pending).then(()=>{session.storageRevision=storage.inspect().revision;session.storageError='';return true;},error=>{
      session.storageError='The browser could not commit this complete preparation. Keep it open and download the whole working file before continuing. '+error.message;
      if(required){const failure=new Error(session.storageError);failure.code=error.code;failure.cause=error;throw failure;}return false;
    });
  }
  function invalidate(){session.preview=null;session.previewVersion=null;session.handoff=null;session.receiving=null;session.portfolioFile=null;session.pendingPortfolioFile=null;}
  function captureCase(next){
    if(next?.program?.id!==programId)throw new Error('The native engagement response belongs to another case.');
    if(caseValue.program.version!==next.program.version){
      session.preview=null;session.previewVersion=null;
      if(session.handoff&&!session.receiving?.forecastId){session.handoff.forecastPreview=null;session.handoff.portfolioPreview=null;}
    }
    caseValue=next;
  }
  async function refreshCase(){const next=await saveApi(prefix);captureCase(next);return next;}
  async function refreshHistory(){
    const response=await saveApi(prefix+'/engagements');
    if(!Array.isArray(response.engagements))throw new Error('The native engagement history is incomplete.');
    session.history=response.engagements;session.receivingHistory=Array.isArray(response.receivings)?response.receivings:[];persist();return response.engagements;
  }
  function keepError(error){session.error=error?.message||String(error);if(available())render();}
  function updateControls(){
    if(!available())return;
    const running=busy||hostBusy||!!session.inflight||!!session.operation;
    root.setAttribute('aria-busy',String(running));
    for(const element of root.querySelectorAll('button,input,select,textarea')){
      const action=element.dataset.engagementAction,recovery=action==='resume-request'||action==='reconcile-receipt'||action==='export-draft'||action?.startsWith('working-')||(action==='tab'&&element.dataset.tab==='copies')||!!element.closest('.engagement-working-desk');
      const localRecovery=(action==='export-draft'||action==='working-download-current')&&session.initialized;
      element.disabled=element.dataset.engagementFixed==='true'||running||(!dependenciesReady&&!localRecovery)||
        ((!!session.pending||!!session.accepted)&&!recovery)||
        (element.dataset.engagementWrite==='true'&&(!editable()||!!session.pending||!!session.accepted||unfinishedFlow()))||
        (unfinishedFlow()&&['new-draft','successor'].includes(action));
    }
  }
  async function run(fn,{localRecovery=false}={}){
    if(!available()||(!dependenciesReady&&!(localRecovery&&session.initialized))||busy||hostBusy||session.inflight||session.operation)return;
    busy=true;session.error='';updateControls();
    const work=(async()=>{try{return await fn();}catch(error){keepError(error);}})();
    session.operation=work;
    try{return await work;}
    finally{if(session.operation===work)session.operation=null;busy=false;persist();if(available())render();}
  }
  function workingBinding(){return engagementWorkingBinding(caseValue,storageKey,recordingActor());}
  function workingState(){return engagementStateShape(captureEngagementState(session),programId);}
  function workingView(){
    return {name:session.workingName,copies:session.copies.map(row=>({id:row.id,name:row.document.name,createdAt:row.document.createdAt,bytes:row.bytes,sha256:row.sha256,
      summary:{agreements:row.document.state.document?.agreements.length||0,selectedReview:row.document.state.selectedReview||null,receivingPhase:row.document.state.receiving?.phase||null,pendingRequestId:row.document.state.pending?.payload?.requestId||null}})),
      selected:session.workingSelected,storageBlocked:session.storageBlocked};
  }
  async function checkpoint(name,{state=workingState(),required=true}={}){
    if(session.copies.length>=ENGAGEMENT_WORKING_MAX_COPIES)throw new Error('The desk retains 16 complete checkpoints. Download and remove one local checkpoint before retaining another; original native editions remain unchanged.');
    const document=createEngagementWorkingCopy({name,binding:workingBinding(),state});
    const bytes=encodeEngagementWorkingCopy(document),sha256=await engagementBytesSha256(bytes);
    const row={id:sha256,bytes:bytes.length,sha256,document};
    session.copies.push(row);
    try{if(required)await persist(true);}catch(error){session.copies.pop();throw error;}
    return row;
  }
  async function captureWorkingCopy(name){
    const row=await checkpoint(name||'Contributor preparation');
    session.workingName=row.document.name;
    session.notice='Retained the complete named preparation, unfinished controls and original native request state.';
  }
  async function inspectWorkingSelection(document,file){
    validateEngagementWorkingCopy(document);await verifyEngagementPortfolioFile(document.state);
    const next={document:clone(document),file:clone(file),inspection:inspectEngagementWorkingCopy(document,workingBinding())};
    session.workingSelected=next;session.tab='copies';persist();
    return next;
  }
  async function inspectSavedWorkingCopy(id){
    const row=session.copies.find(item=>item.id===id);if(!row)throw new Error('Select one retained complete working copy.');
    const bytes=encodeEngagementWorkingCopy(row.document);
    if(bytes.length!==row.bytes||await engagementBytesSha256(bytes)!==row.sha256)throw new Error('The complete retained checkpoint differs from its saved identity. Keep the original browser state for recovery.');
    return inspectWorkingSelection(row.document,{name:row.document.name+'.json',bytes:row.bytes,sha256:row.sha256});
  }
  async function inspectWorkingFile(file){
    const value=await readEngagementWorkingFile(file);
    return inspectWorkingSelection(value.document,value.file);
  }
  async function lookupEngagementRequest(command){
    const value=await saveApi(prefix+'/engagement-request',{command:clone(command)});
    if(value?.schema!=='stellar-forge.sf47-engagement-request.v1'||value.programId!==programId||value.requestId!==command.requestId||typeof value.found!=='boolean')
      throw new Error('The original request lookup returned an incomplete identity. Keep the exact retained request.');
    return value;
  }
  async function reconcileCurrentWorkingState(){
    if(!session.pending&&!session.accepted&&!session.receiving&&!session.requestReceipts.length)return;
    const value=await reconcileEngagementWorkingState(workingState(),{programId,lookup:lookupEngagementRequest,read:path=>saveApi(prefix+'/'+path)});
    // Publish native success in memory before local storage can fail.
    if(value.state.accepted){session.accepted=clone(value.state.accepted);session.pending=null;}
    await persist(true);
    if(session.accepted)await acceptReceipt();
  }
  async function openWorkingSelection(){
    const selected=session.workingSelected;if(!selected)throw new Error('Inspect one complete working copy first.');
    if(session.pending||session.accepted)throw new Error('Reconcile the active original request before replacing its preparation.');
    await refreshCase();
    const inspection=inspectEngagementWorkingCopy(selected.document,workingBinding());
    session.workingSelected.inspection=inspection;
    if(!inspection.canOpen)throw new Error(inspection.conflicts.join(' '));
    const reconciled=await reconcileEngagementWorkingState(selected.document.state,{programId,lookup:lookupEngagementRequest,read:path=>saveApi(prefix+'/'+path)});
    // A read failure or conflicting receipt leaves the entire active and
    // incoming copies untouched. Opening never dispatches a native command.
    const next=reconciled.state;
    if(next.pending&&next.pending.payload.actor.trim()!==recordingActor().trim())throw new Error('The pending command belongs to its original recording operator. Open this case under that operator to resume it; the request actor is never rewritten.');
    if(selected.document.binding.caseVersion!==caseValue.program.version||inspection.sources.some(row=>row.status!=='UNCHANGED')){
      next.preview=null;next.previewVersion=null;
      if(next.handoff&&!next.receiving?.forecastId){next.handoff.forecastPreview=null;next.handoff.portfolioPreview=null;}
      if(next.receiving&&!next.receiving.portfolioId&&next.receiving.portfolioVersion!==caseValue.program.version){
        next.receiving.portfolioPreview=null;if(next.handoff)next.handoff.portfolioPreview=null;
      }
    }
    const prior=workingState(),priorCopies=session.copies.slice(),priorBlocked=session.storageBlocked,priorError=session.storageError;
    const priorName=session.workingName,priorLegacy=session.legacySession;
    if(session.copies.length>=ENGAGEMENT_WORKING_MAX_COPIES)throw new Error('Keep room for the complete recovery checkpoint before opening another working copy. Download and remove a selected local checkpoint first.');
    await checkpoint('Before opening · '+new Date().toISOString(),{state:prior,required:false});
    try{
      for(const key of ENGAGEMENT_STATE_KEYS)session[key]=clone(next[key]);
      session.workingName=selected.document.name;session.storageBlocked=false;session.storageError='';session.legacySession=null;
      session.preview=null;session.previewVersion=null;
      session.tab=next.receiving?'handoff':next.saved?'editor':next.tab==='copies'?'editor':next.tab;
      await persist(true);
    }catch(error){
      for(const key of ENGAGEMENT_STATE_KEYS)session[key]=prior[key];
      session.copies=priorCopies;session.storageBlocked=priorBlocked;session.storageError=priorError;session.workingName=priorName;session.legacySession=priorLegacy;
      throw error;
    }
    session.notice='Opened the complete preparation after reading its original native identities. The previous active state is retained as a recovery checkpoint. Review unsent work again before saving.';
    if(session.accepted)await acceptReceipt();
  }
  async function downloadCurrentWorkingCopy(){
    const document=createEngagementWorkingCopy({name:session.workingName||'Contributor preparation',binding:workingBinding(),state:workingState()});
    const bytes=encodeEngagementWorkingCopy(document);
    blobDownload(new Blob([bytes],{type:'application/json'}),'contributor-working-copy.json');
  }
  async function downloadSelectedWorkingCopy(){
    if(!session.workingSelected)throw new Error('Inspect a complete working copy first.');
    const bytes=encodeEngagementWorkingCopy(session.workingSelected.document);
    blobDownload(new Blob([bytes],{type:'application/json'}),'contributor-selected-working-copy.json');
  }
  async function removeSavedWorkingCopy(id){
    if(!session.copies.some(row=>row.id===id))throw new Error('Select a retained local checkpoint.');
    const previous=session.copies;session.copies=session.copies.filter(row=>row.id!==id);
    try{await persist(true);}catch(error){session.copies=previous;throw error;}
    session.notice='Removed only the selected local checkpoint. Native editions and active preparation remain unchanged.';
  }
  const workingDesk=createEngagementWorkingDesk({root,view:workingView,capture:captureWorkingCopy,
    inspectSaved:inspectSavedWorkingCopy,inspectFile:inspectWorkingFile,openSelected:openWorkingSelection,
    downloadCurrent:downloadCurrentWorkingCopy,downloadSelected:downloadSelectedWorkingCopy,removeSaved:removeSavedWorkingCopy,
    dismiss:()=>{session.workingSelected=null;persist();},setName:value=>{session.workingName=value;persist();}});

  function retainAcceptedReceipt(accepted){
    const prior=session.requestReceipts.find(row=>row.payload.requestId===accepted.payload.requestId);
    if(prior){
      if(!equalEngagementValue(prior.payload,accepted.payload)||!equalEngagementValue(prior.result,accepted.result)||!equalEngagementValue(prior.context??null,accepted.context??null))throw new Error('The original accepted request has conflicting retained receipt bytes. Keep both complete working files for reconciliation.');
    }else session.requestReceipts.push(clone(accepted));
  }
  async function acceptReceipt(){
    const accepted=session.accepted;if(!accepted)return null;
    const observed=await lookupEngagementRequest(accepted.payload);
    if(!observed.found||!equalEngagementValue(observed.result,accepted.result))throw new Error('The known accepted result differs from its original native request. Keep the complete receipt for reconciliation.');
    retainAcceptedReceipt(accepted);await persist(true);
    const next=await refreshCase();
    if(accepted.result.id!==programId||next.program.version<accepted.result.version)throw new Error('The original case has not yet returned the saved engagement version.');
    const action=accepted.payload.action;
    if(action==='engagement.prepare'){
      const detail=await saveApi(prefix+'/engagements/'+encodeURIComponent(accepted.result.recordId));
      if(detail.review?.id!==accepted.result.recordId||!detail.document)throw new Error('The complete saved engagement edition has not yet returned.');
      session.saved=detail;session.selectedReview=detail.review.id;session.document=clone(detail.document);session.controls={};
      session.selectedAgreement=detail.document.agreements.find(row=>row.id===session.selectedAgreement)?.id||detail.document.agreements[0]?.id||'';
      session.preview=null;session.previewVersion=null;
      await refreshHistory();
      session.notice='Saved the complete contributor engagement edition with its original source and decisions.';
    }else await acceptHandoffReceipt(accepted,next);
    session.accepted=null;session.rejected=null;await persist(true);
    if(available()&&(action==='engagement.prepare'||session.receiving?.phase==='COMPLETED'))await onCase(next,accepted.result);
    return accepted.result;
  }
  async function sendPending(){
    if(!session.pending)return;
    if(session.inflight)return session.inflight;
    const retained=clone(session.pending);
    const work=(async()=>{
      try{
        const observation=await lookupEngagementRequest(retained.payload);
        if(!observation.found&&retained.payload.actor.trim()!==recordingActor().trim())throw new Error('Resume this original pending command as its original recording operator; its actor is retained unchanged.');
        let result=observation.result;
        if(!observation.found){await persist(true);result=await saveApi(prefix+'/command',retained.payload);}
        session.accepted={payload:retained.payload,result,context:retained.context||null};
        session.pending=null;await persist(true);
        return await acceptReceipt();
      }catch(error){
        if(!session.accepted&&definite(error)){
          let observation=null;try{observation=await lookupEngagementRequest(retained.payload);}catch{}
          if(observation?.found){
            session.accepted={payload:retained.payload,result:observation.result,context:retained.context||null};
            session.pending=null;persist();return await acceptReceipt();
          }
          const rejected=['INVALID_ENGAGEMENT','ENGAGEMENT_PREVIEW_CHANGED','OPERATIONS_CONFLICT','OPERATIONS_CLOSED','FORECAST_PREVIEW_CONFLICT','PORTFOLIO_PREVIEW_CONFLICT'];
          if(observation?.found===false&&rejected.includes(error.code)){
            session.rejected={payload:retained.payload,context:retained.context||null,code:error.code,message:error.message};
            session.pending=null;session.notice='The original journal confirms no accepted result for this explicitly rejected command. The complete draft remains available for correction.';persist();
          }
        }
        throw error;
      }
    })();
    session.inflight=work;
    try{return await work;}finally{if(session.inflight===work)session.inflight=null;}
  }
  async function mutate(action,data,{expectedVersion=caseValue.program.version,note='',context=null}={}){
    if(!available()||caseValue.program.state!=='OPEN'||session.pending||session.accepted||session.inflight)return;
    const payload={expectedVersion,actor:recordingActor(),action,data:clone(data),note};
    payload.requestId=await mutationId('operations:'+action,payload);
    session.pending={payload,context:context?clone(context):null};session.rejected=null;
    await persist(true);
    return sendPending();
  }
  async function seed(reviewId=null){
    const body={expectedVersion:caseValue.program.version};if(reviewId)body.reviewId=reviewId;
    const value=await saveApi(prefix+'/engagement-seed',body);
    if(value.document?.schema!==SCHEMA)throw new Error('The native engagement seed is incomplete.');
    session.document=clone(value.document);session.saved=null;session.selectedReview='';session.controls={};
    session.selectedAgreement=value.document.agreements[0]?.id||'';session.draftVersion=caseValue.program.version;
    invalidate();session.tab='editor';session.notice=reviewId?'Opened a sourced successor of the selected edition.':'Opened the complete contributor engagement draft.';await persist(true);
  }
  async function openReview(id){
    const value=await saveApi(prefix+'/engagements/'+encodeURIComponent(id));
    if(value.review?.id!==id||value.document?.schema!==SCHEMA)throw new Error('Select an original complete engagement edition.');
    session.saved=value;session.document=clone(value.document);session.selectedReview=id;session.controls={};
    session.selectedAgreement=value.document.agreements[0]?.id||'';session.preview=null;session.previewVersion=null;session.tab='editor';persist();
  }
  function draftChanged(){
    if(session.saved)return;
    invalidate();session.error='';persist();
  }
  function sourceFields(value,path){
    return field('Original supporting sources',value.sourceIds,{multiple:true,options:sourceOptions(),wide:true,attrs:{'data-engagement-field':path?path+'.sourceIds':'sourceIds','data-engagement-write':'true'},help:'Retained source files and their exact byte identities remain in the original case.'})+
      field('Source context',value.sourceNote,{area:true,wide:true,max:12000,attrs:{'data-engagement-field':path?path+'.sourceNote':'sourceNote','data-engagement-write':'true'}});
  }
  function sourceLinks(ids){
    if(!ids?.length)return '<small>No source selected</small>';
    return ids.map(id=>{const s=caseValue.sources.find(row=>row.id===id);return '<div class="engagement-source-row"><div>'+button(s?.filename||id,'download-source',{'data-source':id})+'<small>'+esc(s?.sha256||id)+'</small></div></div>';}).join('');
  }
  function fieldsForAgreement(row){
    if(!row)return empty('Choose a contributor agreement or add a named contributor to this draft.');
    const a=row.availability,c=row.compensation,decision=row.acceptance,raw=session.controls[row.id]||{};
    const f=(label,value,path,options={})=>field(label,Object.hasOwn(raw.fields||{},path)?raw.fields[path]:value,{...options,attrs:{...options.attrs,'data-engagement-field':path,'data-engagement-write':'true'}});
    const hours=(label,value,path,options={})=>f(label,value,path,{...options,attrs:{inputmode:'decimal'},help:options.help||'Exact nonnegative decimal hours; up to four decimal places.'});
    const basis=[['HOURLY','Hourly'],['FIXED','Fixed total'],['IN_KIND','In kind'],['UNSPECIFIED','Unspecified']];
    const decisions=[['PROPOSED','Proposed'],['CONFIRMED','Confirmed'],['DECLINED','Declined'],['WITHDRAWN','Withdrawn']];
    return '<div class="engagement-editor">'+
      '<fieldset><legend>Named contributor and complete scope</legend><div class="engagement-fields">'+
      f('Contributor',row.contributorId,'contributorId',{options:contributorOptions(),required:true})+
      f('Role',row.role,'role',{required:true,max:300})+
      f('Scope',row.scope,'scope',{area:true,wide:true,required:true,max:12000})+
      f('Availability starts',row.startDate,'startDate',{type:'date',required:true})+
      f('Availability ends',row.endDate,'endDate',{type:'date',required:true})+
      sourceFields(row,'')+'</div></fieldset>'+
      '<fieldset><legend>Actual availability</legend><div class="engagement-week">'+
      ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,i)=>hours(day,a.hoursByWeekday[i],'availability.hoursByWeekday.'+i,{help:'Blank: unstated. Zero: unavailable.'})).join('')+
      '</div><h4>Dated exceptions</h4>'+
      (Object.keys(a.hoursByDate).length?Object.keys(a.hoursByDate).sort().map(day=>'<div class="engagement-date-row">'+field('Date',day,{type:'date',attrs:{readonly:'readonly'}})+
        field('Available hours',Object.hasOwn(raw.fields||{},'dated:'+day)?raw.fields['dated:'+day]:a.hoursByDate[day],{attrs:{inputmode:'decimal','data-engagement-date':day,'data-engagement-write':'true'},required:true})+
        button('Remove exception','remove-exception',{'data-date':day,'data-engagement-write':'true'},!!session.saved)+'</div>').join(''):empty('No dated exceptions.'))+
      '<div class="engagement-date-row">'+field('New exception date',raw.exceptionDate||'',{type:'date',attrs:{'data-new-exception-date':'true','data-engagement-write':'true'}})+
      field('Available hours',raw.exceptionHours||'',{attrs:{inputmode:'decimal','data-new-exception-hours':'true','data-engagement-write':'true'}})+
      button('Add dated exception','add-exception',{'data-engagement-write':'true'},!!session.saved)+'</div>'+
      '<div class="engagement-fields">'+f('Availability note',a.note,'availability.note',{area:true,wide:true,max:12000})+sourceFields(a,'availability')+'</div></fieldset>'+
      '<fieldset><legend>Compensation and payment terms</legend><div class="engagement-fields">'+
      f('Compensation basis',c.basis,'compensation.basis',{options:basis})+
      f('Original payment treatment',c.paymentMode,'compensation.paymentMode',{options:[['original','Original package treatment'],['accrual','Accrual'],['completion','Completion']]})+
      f('Hourly rate (USD)',c.rateUsd,'compensation.rateUsd',{attrs:{inputmode:'decimal'},help:'Leave unstated when it is not part of the selected agreement.'})+
      f('Total agreed compensation (USD)',c.totalUsd,'compensation.totalUsd',{attrs:{inputmode:'decimal'},help:'Exact agreed amount, when supplied by the original terms.'})+
      f('Complete payment terms',c.paymentTerms,'compensation.paymentTerms',{area:true,wide:true,max:12000})+
      f('Compensation note',c.note,'compensation.note',{area:true,wide:true,max:12000})+sourceFields(c,'compensation')+
      '</div></fieldset>'+
      '<fieldset><legend>Agreement acceptance</legend><div class="engagement-fields">'+
      f('Actual decision',decision.status,'acceptance.status',{options:decisions})+
      f('Decision maker',decision.by,'acceptance.by',{required:decision.status==='CONFIRMED',max:300})+
      f('Decision time',decision.at,'acceptance.at',{required:decision.status==='CONFIRMED',wide:true,help:'Exact ISO 8601 time from the original decision, including its timezone; for example 2026-10-12T18:00:00.000Z.'})+
      f('Decision note',decision.note,'acceptance.note',{area:true,wide:true,max:12000})+sourceFields(decision,'acceptance')+
      '</div>'+note('The selected decision is recorded explicitly. Retaining an agreement file does not change its acceptance state.')+'</fieldset>'+
      '<fieldset><legend>Original remaining work-package allocations</legend>'+
      (row.allocations.length?row.allocations.map((allocation,i)=>'<div class="engagement-panel"><h4>'+esc(packageName(allocation.costId))+'</h4><div class="engagement-fields">'+
        field('Original work package',allocation.costId,{options:packages().map(p=>[p.id,packageName(p.id)]),attrs:{'data-engagement-allocation':i,'data-allocation-field':'costId','data-engagement-write':'true'}})+
        field('Remaining hours',allocation.remainingHours,{required:true,attrs:{inputmode:'decimal','data-engagement-allocation':i,'data-allocation-field':'remainingHours','data-engagement-write':'true'}})+
        field('Remaining cost (USD)',allocation.remainingCostUsd,{required:true,attrs:{inputmode:'decimal','data-engagement-allocation':i,'data-allocation-field':'remainingCostUsd','data-engagement-write':'true'}})+
        field('Allocation note',allocation.note,{area:true,wide:true,attrs:{'data-engagement-allocation':i,'data-allocation-field':'note','data-engagement-write':'true'}})+
        '</div>'+button('Remove this allocation','remove-allocation',{'data-index':i,'data-engagement-write':'true'},!!session.saved)+'</div>').join(''):empty('No work-package allocation selected.'))+
      '<div class="engagement-date-row">'+field('Add original work package',raw.allocationCostId||'',{options:[['','Choose a work package'],...packages().filter(p=>!row.allocations.some(x=>x.costId===p.id)).map(p=>[p.id,packageName(p.id)])],attrs:{'data-new-allocation':'true','data-engagement-write':'true'}})+
      button('Add allocation','add-allocation',{'data-engagement-write':'true'},!!session.saved)+'</div></fieldset>'+
      '<details><summary>Complete retained source files</summary><div>'+sourceLinks([...new Set([...(row.sourceIds||[]),...(a.sourceIds||[]),...(c.sourceIds||[]),...(decision.sourceIds||[])])])+'</div></details>'+
      (session.saved?'':'<footer class="engagement-actions">'+button('Remove contributor from draft','remove-agreement',{'data-engagement-write':'true'})+
        button('Attach original agreement source','sources')+'</footer>')+'</div>';
  }
  function register(){
    const query=session.search.trim().toLowerCase();
    const rows=agreements().filter(row=>(!session.acceptanceFilter||row.acceptance.status===session.acceptanceFilter)&&(!query||[contributor(row.contributorId)?.name,row.role,row.scope].join(' ').toLowerCase().includes(query)));
    return '<div class="engagement-toolbar">'+
      field('Find a contributor or role',session.search,{attrs:{'data-engagement-search':'true'}})+
      field('Acceptance',session.acceptanceFilter,{options:[['','All decisions'],['PROPOSED','Proposed'],['CONFIRMED','Confirmed'],['DECLINED','Declined'],['WITHDRAWN','Withdrawn']],attrs:{'data-engagement-filter':'true'}})+
      field('Add named contributor',session.newContributor,{options:[['','Choose an existing contributor'],...contributors().filter(p=>p.state==='ACTIVE'&&!agreements().some(row=>row.contributorId===p.id)).map(p=>[p.id,p.name])],attrs:{'data-engagement-new-contributor':'true','data-engagement-write':'true'}})+
      '</div><div class="engagement-actions">'+button('Add contributor agreement','add-agreement',{'data-engagement-write':'true'},!!session.saved)+button('Open original source attachments','sources')+'</div>'+
      (rows.length?table(['Contributor and role','Dates','Compensation','Acceptance',''],rows.map(row=>[
        esc(contributor(row.contributorId)?.name||row.contributorId)+'<small>'+esc(row.role||'Role not entered')+'</small>',
        esc(row.startDate||'Unstated')+' – '+esc(row.endDate||'Unstated'),
        esc(words(row.compensation.basis))+(row.compensation.rateUsd!==null?'<small>USD '+esc(row.compensation.rateUsd)+' per hour</small>':'')+
          (row.compensation.totalUsd!==null?'<small>USD '+esc(row.compensation.totalUsd)+' total</small>':''),
        status(row.acceptance.status),button(session.saved?'Inspect agreement':'Edit agreement','select-agreement',{'data-agreement':row.id})
      ])):empty('No agreements match this selection.'));
  }
  function editor(){
    const doc=session.document;
    if(!doc)return empty('Open an original engagement seed to begin.')+'<div class="engagement-actions">'+button('Open engagement draft','new-draft',{},caseValue.program.state!=='OPEN')+'</div>';
    const saved=session.saved;
    return '<div class="engagement-actions">'+(saved?button('Create sourced successor','successor',{'data-review':saved.review.id},caseValue.program.state!=='OPEN')+button('Download complete original case','download-edition',{'data-review':saved.review.id}):'')+
      button('Save draft JSON','export-draft')+'</div>'+
      (saved?note('Saved edition '+saved.review.id+' · original case version '+saved.review.version+(saved.current?.sourceChanged?' · current case sources have changed.':'')):'')+
      '<form data-engagement-editor><div class="engagement-fields">'+
      field('Edition name',doc.name,{required:true,max:300,attrs:{'data-engagement-document':'name','data-engagement-write':'true'}})+
      field('Source review date',doc.asOfDate,{required:true,type:'date',attrs:{'data-engagement-document':'asOfDate','data-engagement-write':'true'}})+
      field('Recorded edition review note',doc.note,{area:true,wide:true,required:true,max:12000,help:'Retained as the original recorded review note when this complete edition is saved.',attrs:{'data-engagement-document':'note','data-engagement-write':'true'}})+'</div>'+
      (doc.supersedes?'<p class="engagement-break">Supersedes '+esc(doc.supersedes.reviewId)+' · '+esc(doc.supersedes.reviewSha256)+'</p>':'')+
      register()+fieldsForAgreement(agreement())+
      (saved?'':'<div class="engagement-actions">'+button('Review complete edition','preview',{'data-engagement-write':'true'})+'</div>')+'</form>'+
      (session.preview?'<section class="engagement-panel"><h4>Native review of this complete edition</h4>'+nativeDetails(session.preview.report)+
        '<details><summary>Selected original source</summary><div>'+nativeDetails(session.preview.source)+'</div></details>'+
        '<div class="engagement-actions">'+button('Save this reviewed edition','prepare',{'data-engagement-write':'true'},caseValue.program.state!=='OPEN')+'</div></section>':'')+
      (saved?'<section class="engagement-panel"><h4>Saved native report</h4>'+nativeDetails(saved.report)+
        (saved.receivings?.length?'<h4>Original receiving history for this edition</h4>'+nativeDetails(saved.receivings):'')+'</section>':'');
  }
  function history(){
    return '<div class="engagement-actions">'+button('Refresh saved editions','refresh-history')+button('Open engagement draft','new-draft',{},caseValue.program.state!=='OPEN')+'</div>'+
      (session.history.length?table(['Edition','Recorded','Actual decisions','Allocated work',''],session.history.map(row=>[
        esc(row.name)+'<small>'+esc(row.id)+'</small>',
        esc(row.createdAt)+'<small>Case version '+esc(row.version)+' · '+esc(row.actor)+'</small>',
        esc(row.confirmed)+' confirmed / '+esc(row.proposed)+' proposed<small>'+esc(row.declined)+' declined / '+esc(row.withdrawn)+' withdrawn</small>',
        esc(row.allocatedHours)+' hours<small>USD '+esc(row.remainingCostUsd)+' remaining cost</small>',
        '<div class="engagement-actions">'+button('Open edition','open-review',{'data-review':row.id})+
          button('Create successor','successor',{'data-review':row.id},caseValue.program.state!=='OPEN')+
          button('Download whole case','download-edition',{'data-review':row.id})+'</div>'
      ])):empty('No contributor engagement editions have been saved in this case.'))+
      '<section class="engagement-panel"><h4>Original engagement receiving records</h4>'+
      (session.receivingHistory.length?nativeDetails(session.receivingHistory):empty('No native Forecast/Portfolio joins have been recorded.'))+'</section>';
  }
  function pending(){
    if(session.pending)return '<section class="engagement-pending" role="status"><h4>Original request retained</h4><p>The native outcome is not yet confirmed. Continue this exact request before editing or starting another one.</p><p class="engagement-break">'+esc(session.pending.payload.action)+' · '+esc(session.pending.payload.requestId)+' · case version '+esc(session.pending.payload.expectedVersion)+'</p><div class="engagement-actions">'+button('Resume original request','resume-request')+button('Save exact draft and request','export-draft')+'</div></section>';
    if(session.accepted)return '<section class="engagement-pending" role="status"><h4>Saved receipt awaiting case readback</h4><p>The original command returned its receipt. Reopen that complete record to finish the same operation.</p><p class="engagement-break">'+esc(session.accepted.result.recordId||session.accepted.result.id)+'</p><div class="engagement-actions">'+button('Reconcile saved receipt','reconcile-receipt')+button('Save exact draft and receipt','export-draft')+'</div></section>';
    return '';
  }
  function render(){
    if(!available())return;
    const document=session.document,confirmed=document?.agreements.filter(row=>row.acceptance.status==='CONFIRMED').length||0;
    root.innerHTML='<header class="engagement-heading"><div><h3>Contributor engagements</h3><p>Retain named availability, compensation, agreement sources and actual decisions. Review a complete edition and carry it into the original delivery and cash plan.</p></div><div class="engagement-state-list">'+status(caseValue.program.state)+'<span class="engagement-status">Case version '+esc(caseValue.program.version)+'</span></div></header>'+
      (session.error?'<p role="alert">'+esc(session.error)+'</p>':'')+(session.storageError?'<p role="alert">'+esc(session.storageError)+'</p>':'')+
      (session.initialized?'<div class="engagement-actions">'+button('Download current preparation','export-draft')+'</div>':'')+
      (session.notice?'<p role="status">'+esc(session.notice)+'</p>':'')+pending()+
      '<nav class="engagement-tabs" aria-label="Engagement views">'+[['editor','Agreements'],['history','Saved editions'],['handoff','Portfolio and cash handoff'],['copies','Working copies']].map(([id,label])=>button(label,'tab',{'data-tab':id,...(session.tab===id?{'aria-current':'page'}:{})})).join('')+'</nav>'+
      '<div class="engagement-metrics"><div><strong>'+esc(document?.agreements.length||0)+'</strong><small>Named agreements in selection</small></div><div><strong>'+esc(confirmed)+'</strong><small>Explicitly confirmed</small></div><div><strong>'+esc(session.history.length)+'</strong><small>Saved complete editions</small></div><div><strong>'+esc(caseValue.plan.revision??caseValue.program.planRevision??'Retained')+'</strong><small>Original selected plan revision</small></div></div>'+
      (session.tab==='editor'?editor():session.tab==='history'?history():session.tab==='copies'?workingDesk.render():handoffView());
    updateControls();
  }
  async function exportDraft(){return downloadCurrentWorkingCopy();}
  function setPath(target,path,value){
    const parts=path.split('.'),last=parts.pop();let cursor=target;
    for(const key of parts)cursor=cursor[key];
    cursor[last]=value;
  }
  function inputChanged(event){
    if(!available()||!dependenciesReady||busy||hostBusy||session.inflight||session.operation)return;
    const input=event.target;
    if(event.type==='change'&&input.hasAttribute('data-engagement-working-file')){
      const selected=input.files?.[0];if(selected)void run(()=>inspectWorkingFile(selected));return;
    }
    if(workingDesk.input(event)){if(event.type==='change')render();return;}
    if(session.pending||session.accepted)return;
    if(event.type==='change'&&input.hasAttribute('data-handoff-file')){
      const selected=input.files?.[0];if(selected)void run(()=>retainPendingPortfolioFile(selected));return;
    }
    if(input.hasAttribute('data-new-exception-date')||input.hasAttribute('data-new-exception-hours')||input.hasAttribute('data-new-allocation')){
      const id=session.selectedAgreement;if(!id)return;
      const retained=session.controls[id]||(session.controls[id]={exceptionDate:'',exceptionHours:'',allocationCostId:''});
      const key=input.hasAttribute('data-new-exception-date')?'exceptionDate':input.hasAttribute('data-new-exception-hours')?'exceptionHours':'allocationCostId';
      retained[key]=input.value;persist();return;
    }
    if(input.closest('[data-engagement-handoff]')){
      if(event.type==='change'&&handoffChangedSelection(event))return;
      handoffInputChanged(event);
      if(event.type==='change'&&(input.dataset.handoffField==='explicitRemainders'||input.dataset.handoffField==='explicitPaymentModes'))render();
      return;
    }
    if(input.dataset.engagementSearch!==undefined){session.search=input.value;persist();if(event.type==='change')render();return;}
    if(input.dataset.engagementFilter!==undefined){session.acceptanceFilter=input.value;persist();render();return;}
    if(input.dataset.engagementNewContributor!==undefined){session.newContributor=input.value;persist();return;}
    if(input.dataset.engagementDocument!==undefined&&!session.saved&&!unfinishedFlow()){session.document[input.dataset.engagementDocument]=input.value;draftChanged();return;}
    const row=agreement();if(!row||session.saved||unfinishedFlow())return;
    if(input.dataset.engagementField!==undefined){
      const path=input.dataset.engagementField;
      if(!input.multiple){const raw=session.controls[row.id]||(session.controls[row.id]={});(raw.fields||={})[path]=input.value;}
      let value=input.multiple?selectedValues(input):input.value;
      if(path.startsWith('availability.hoursByWeekday.')||path==='compensation.rateUsd'||path==='compensation.totalUsd'||path==='acceptance.at')value=value.trim()===''?null:value.trim();
      if(path==='contributorId'&&agreements().some(item=>item.id!==row.id&&item.contributorId===value)){input.value=row.contributorId;if(session.controls[row.id]?.fields)session.controls[row.id].fields.contributorId=row.contributorId;session.error='This contributor already has an agreement in the current edition.';persist();render();return;}
      setPath(row,path,value);draftChanged();
      if(path==='acceptance.status'||path==='contributorId')render();
      return;
    }
    if(input.dataset.engagementDate!==undefined){const raw=session.controls[row.id]||(session.controls[row.id]={});(raw.fields||={})['dated:'+input.dataset.engagementDate]=input.value;row.availability.hoursByDate[input.dataset.engagementDate]=input.value.trim();draftChanged();return;}
    if(input.dataset.engagementAllocation!==undefined){const index=Number(input.dataset.engagementAllocation),allocation=row.allocations[index];if(!allocation)return;allocation[input.dataset.allocationField]=input.value;draftChanged();return;}
    handoffInputChanged(event);
  }
  async function clicked(event){
    const target=event.target.closest('[data-engagement-action]');if(!target||!root.contains(target)||target.disabled)return;
    event.preventDefault();const action=target.dataset.engagementAction;
    await run(async()=>{
      if(action==='tab'){session.tab=target.dataset.tab;if(session.tab==='history')await refreshHistory();if(session.tab==='handoff')await ensureHandoff();return;}
      if(action==='export-draft'){await exportDraft();return;}
      if(action.startsWith('working-')){await workingDesk.action(action,target);return;}
      if(action==='resume-request'){await sendPending();if(available()&&session.receiving)await resumeReceiving(false);return;}
      if(action==='reconcile-receipt'){await acceptReceipt();if(available()&&session.receiving)await resumeReceiving(false);return;}
      if(action==='sources'){await persist(true);if(onSources)await onSources();else session.notice='Open Sources in the original Operations case; this complete engagement draft is retained.';return;}
      if(action==='new-draft'){await seed();return;}
      if(action==='refresh-history'){await refreshHistory();return;}
      if(action==='open-review'){await openReview(target.dataset.review);return;}
      if(action==='successor'){await seed(target.dataset.review);return;}
      if(action==='select-agreement'){session.selectedAgreement=target.dataset.agreement;return;}
      if(action==='download-edition'){
        const response=await saveApi(prefix+'/engagements/'+encodeURIComponent(target.dataset.review)+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())blobDownload(blob,target.dataset.review+'-engagement-case.zip');return;
      }
      if(action==='download-source'){
        const id=target.dataset.source,original=caseValue.sources.find(row=>row.id===id);
        if(!original)throw new Error('The selected original source is not in this case.');
        const response=await saveApi(prefix+'/sources/'+encodeURIComponent(id),undefined,{download:true});
        const blob=await response.blob();if(available())blobDownload(blob,original.filename);return;
      }
      if(action==='add-agreement'){
        const id=session.newContributor,person=contributor(id);if(!person||person.state!=='ACTIVE')throw new Error('Choose an active original contributor.');
        if(agreements().some(row=>row.contributorId===id))throw new Error('This contributor already has an agreement in the current edition.');
        const row={id:'engagement-'+crypto.randomUUID().replaceAll('-',''),contributorId:id,role:'',scope:'',startDate:'',endDate:'',
          availability:{hoursByWeekday:Array(7).fill(null),hoursByDate:{},note:'',sourceIds:[],sourceNote:''},
          compensation:{basis:'UNSPECIFIED',rateUsd:null,totalUsd:null,paymentTerms:'',paymentMode:'original',note:'',sourceIds:[],sourceNote:''},
          acceptance:{status:'PROPOSED',by:'',at:null,note:'',sourceIds:[],sourceNote:''},allocations:[],sourceIds:[],sourceNote:''};
        session.document.agreements.push(row);session.selectedAgreement=row.id;session.newContributor='';draftChanged();return;
      }
      const row=agreement();
      if(action==='remove-agreement'){if(!row)return;session.removedAgreement=clone(row);session.document.agreements=session.document.agreements.filter(item=>item.id!==row.id);session.selectedAgreement=agreements()[0]?.id||'';draftChanged();session.notice='Removed this row from the editable draft. Earlier saved editions remain complete.';return;}
      if(action==='add-exception'){
        if(!row)return;const day=$('[data-new-exception-date]').value,hours=$('[data-new-exception-hours]').value.trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||hours==='')throw new Error('Enter the exact exception date and available hours.');
        if(Object.hasOwn(row.availability.hoursByDate,day))throw new Error('That exception date is already retained; edit its existing row.');
        row.availability.hoursByDate[day]=hours;session.controls[row.id]={...(session.controls[row.id]||{}),exceptionDate:'',exceptionHours:''};draftChanged();return;
      }
      if(action==='remove-exception'){delete row.availability.hoursByDate[target.dataset.date];draftChanged();return;}
      if(action==='add-allocation'){
        const costId=$('[data-new-allocation]').value;if(!packages().some(item=>item.id===costId)||row.allocations.some(item=>item.costId===costId))throw new Error('Choose another original work package.');
        row.allocations.push({costId,remainingHours:'',remainingCostUsd:'',note:''});session.controls[row.id]={...(session.controls[row.id]||{}),allocationCostId:''};draftChanged();return;
      }
      if(action==='remove-allocation'){row.allocations.splice(Number(target.dataset.index),1);draftChanged();return;}
      if(action==='preview'){
        if(!$('[data-engagement-editor]').reportValidity())return;
        const value=await saveApi(prefix+'/engagement-preview',{expectedVersion:caseValue.program.version,document:clone(session.document)});
        if(value.document?.schema!==SCHEMA||typeof value.previewSha256!=='string')throw new Error('The original engagement preview is incomplete.');
        session.document=clone(value.document);session.preview=value;session.previewVersion=caseValue.program.version;await persist(true);return;
      }
      if(action==='prepare'){
        if(!session.preview||session.previewVersion!==caseValue.program.version)throw new Error('Review this complete edition against the current case first.');
        const reviewNote=String(session.preview.document.note??'').trim();
        if(!reviewNote)throw new Error('Enter the recorded edition review note and review the complete book again before saving.');
        await mutate('engagement.prepare',{document:clone(session.preview.document),expectedPreviewSha256:session.preview.previewSha256},{expectedVersion:session.previewVersion,note:reviewNote});return;
      }
      await handoffAction(action,target);
    },{localRecovery:action==='export-draft'||action==='working-download-current'});
  }
  function submitted(event){if(event.target.matches('[data-engagement-editor]')){event.preventDefault();const target=root.querySelector('[data-engagement-action="preview"]');if(target&&!target.disabled)target.click();}}
  root.addEventListener('click',clicked);root.addEventListener('input',inputChanged);root.addEventListener('change',inputChanged);root.addEventListener('submit',submitted);
  function dispose(){
    active=false;root.removeEventListener('click',clicked);root.removeEventListener('input',inputChanged);root.removeEventListener('change',inputChanged);root.removeEventListener('submit',submitted);
    if(closing)return closing;
    closing=(async()=>{
      await Promise.allSettled([ready,session.operation,session.inflight].filter(Boolean));
      // A preceding failed close remains owned until its same owner closes.
      if(previousCloseOwner)await previousCloseOwner.close();
      if(storageLoaded&&!session.storageBlocked)await persist(true);
      const errors=[];
      for(const[url,timer]of downloads){if(timer!==null)clearTimeout(timer);try{URL.revokeObjectURL(url);downloads.delete(url);}catch(error){errors.push(error);}}
      try{await storage.close();}catch(error){errors.push(error);}
      if(errors.length)throw errors[0];
    })();
    session.closeOwner=closing;session.retiringOwner=retainedCloseOwner;
    const attempt=closing;
    closing.then(()=>{if(session.closeOwner===attempt)session.closeOwner=null;if(session.retiringOwner===retainedCloseOwner)session.retiringOwner=null;},()=>{if(closing===attempt)closing=null;});return closing;
  }
  function setHostBusy(value){hostBusy=!!value;updateControls();}
  const previousReady=session.ready,previousCloseOwner=session.retiringOwner;
  const ready=(async()=>{
    busy=true;render();
    try{
      if(previousReady)await previousReady;
      if(previousCloseOwner)await previousCloseOwner.close();
      if(!active)return;
      await loadStoredSession();dependenciesReady=true;
      if(!active)return;
      if(session.operation)try{await session.operation;}catch{}
      if(session.inflight)try{await session.inflight;}catch{}
      await refreshCase();await refreshHistory();
      if(session.legacySession&&!session.workingSelected){
        const original=await readEngagementSessionText(session.legacySession.raw);
        await inspectWorkingSelection(original.document,original.file);
        session.notice='Inspected the complete earlier browser session. Its original key and bytes remain unchanged. Reconcile and open explicitly to continue as this operator.';
      }
      if(!session.storageBlocked)await reconcileCurrentWorkingState();
      if(!session.document&&!session.pending&&!session.accepted&&!session.storageBlocked&&caseValue.program.state==='OPEN')await seed();
    }catch(error){keepError(error);}
    finally{busy=false;if(available())render();}
  })();
  session.ready=ready;
  // Native handoff methods are composed below from the original engine contract.
  function handoffDraft(){
    if(!session.handoff)session.handoff={reviewId:session.saved?.review.id||'',reviewSha256:session.saved?.review.sha256||'',
      book:session.saved?clone(session.saved):null,baseForecastId:'',baseForecast:null,agreementIds:[],
      explicitRemainders:false,remainders:{},explicitPaymentModes:false,paymentModes:{},
      name:'Contributor engagement cash forecast',note:'',receivingNote:session.saved?.document.note||'',resourceMap:{},portfolioName:'Contributor engagement allocation',
      portfolioNote:'',portfolioDraft:null,portfolioDraftSource:null,forecastPreview:null,portfolioPreview:null};
    return session.handoff;
  }
  async function ensureHandoff(){
    const value=handoffDraft();await refreshHistory();
    if(value.reviewId&&!value.book){
      const book=await saveApi(prefix+'/engagements/'+encodeURIComponent(value.reviewId));
      if(book.review?.id!==value.reviewId)throw new Error('The selected engagement book changed identity.');
      value.book=book;value.reviewSha256=book.review.sha256;
    }
    return value;
  }
  function chosenAgreements(){
    const h=handoffDraft();return (h.book?.document.agreements||[]).filter(row=>h.agreementIds.includes(row.id));
  }
  function affectedCosts(){return [...new Set(chosenAgreements().flatMap(row=>row.allocations.map(a=>a.costId)))].sort();}
  function nativeResourceOptions(){
    const h=handoffDraft(),map=new Map();
    for(const row of caseValue.plan.planning?.contributors||[])map.set(row.id,row.name||row.id);
    for(const row of h.portfolioDraft?.resources||[])map.set(row.id,row.name||row.id);
    return [...map.entries()];
  }
  function forecastLocked(){return !!session.receiving?.forecastId;}
  function portfolioLocked(){return !!session.receiving?.portfolioId;}
  function handoffChanged(kind){
    const h=handoffDraft();
    if(kind==='forecast'){
      h.forecastPreview=null;h.portfolioPreview=null;
      if(!session.receiving?.forecastId)session.receiving=null;
    }else{
      h.portfolioPreview=null;
      if(session.receiving&&!session.receiving.portfolioId){
        session.receiving.portfolioChoice={resourceMap:resourceSelection(),inputs:h.portfolioDraft?clone(h.portfolioDraft):null,
          name:h.portfolioName,note:h.portfolioNote};
        session.receiving.portfolioPreview=null;session.receiving.portfolioSelection=null;
        if(session.receiving.forecastId)session.receiving.phase='FORECAST_SAVED';
      }
    }
    session.error='';persist();
  }
  function resourceSelection(){
    const h=handoffDraft();return chosenAgreements().map(row=>({engagementId:row.id,resourceId:h.resourceMap[row.id]||''}));
  }
  function forecastSelection(){
    const h=handoffDraft();
    if(!h.book||h.book.review.id!==h.reviewId||h.book.review.sha256!==h.reviewSha256)throw new Error('Select the complete original saved engagement edition.');
    const value={reviewId:h.reviewId,reviewSha256:h.reviewSha256,forecastId:h.baseForecastId,
      agreementIds:clone(h.agreementIds),name:h.name,note:h.note};
    if(h.explicitRemainders)value.remainders=affectedCosts().map(costId=>{
      const row=h.remainders[costId]||{};return {costId,remainingHours:row.remainingHours??'',remainingCostUsd:row.remainingCostUsd??'',note:row.note||''};
    });
    if(h.explicitPaymentModes)value.paymentModes=affectedCosts().map(costId=>{
      const row=h.paymentModes[costId]||{};return {costId,paymentMode:row.paymentMode||'original',note:row.note||''};
    });
    return value;
  }
  async function chooseHandoffBook(id){
    if(forecastLocked())throw new Error('This original receiving already saved its Forecast. Finish its current join first.');
    const h=handoffDraft();
    if(!id){h.reviewId='';h.reviewSha256='';h.book=null;h.agreementIds=[];handoffChanged('forecast');return;}
    const book=await saveApi(prefix+'/engagements/'+encodeURIComponent(id));
    if(book.review?.id!==id||book.document?.schema!==SCHEMA)throw new Error('The selected complete engagement book is unavailable.');
    h.reviewId=id;h.reviewSha256=book.review.sha256;h.book=book;
    h.agreementIds=[];h.resourceMap={};h.remainders={};h.paymentModes={};
    h.name=book.document.name+' — cash forecast';h.portfolioName=book.document.name+' — delivery allocation';h.receivingNote=book.document.note||'';
    handoffChanged('forecast');
  }
  async function chooseForecast(id){
    if(forecastLocked())throw new Error('The original receiving Forecast is already saved.');
    const h=handoffDraft();h.baseForecastId=id;h.baseForecast=null;handoffChanged('forecast');
    if(id){
      const value=await saveApi(prefix+'/forecasts/'+encodeURIComponent(id));
      if(value.id!==id||!value.inputs)throw new Error('The complete original base Forecast is unavailable.');
      h.baseForecast=value;persist();
    }
  }
  async function retainPendingPortfolioFile(file){
    if(portfolioLocked())throw new Error('The original receiving Portfolio is already saved.');
    if(!file||!Number.isInteger(file.size)||file.size<1||file.size>8*1024*1024)throw new Error('Select a complete native Portfolio JSON file up to 8 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length!==file.size)throw new Error('The selected original Portfolio file was not read completely.');
    const selected={name:file.name,type:file.type||'application/json',bytes:bytes.length,
      sha256:await engagementBytesSha256(bytes),contentBase64:engagementBase64(bytes)};
    session.pendingPortfolioFile=selected;await persist(true);
    session.notice='Retained the entire selected Portfolio file. Choose Use complete selected draft to apply it; unfinished or invalid JSON remains downloadable in the working copy.';
    return selected;
  }
  async function usePortfolioFile(file){
    if(portfolioLocked())throw new Error('The original receiving Portfolio is already saved.');
    const selected=file?await retainPendingPortfolioFile(file):session.pendingPortfolioFile;
    if(!selected)throw new Error('Select the original complete Portfolio draft or reopen a working copy with its retained file.');
    const bytes=engagementUnbase64(selected.contentBase64);
    if(bytes.length!==selected.bytes||await engagementBytesSha256(bytes)!==selected.sha256)throw new Error('The selected Portfolio file differs from its original complete bytes.');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const inputs=value?.inputs?.schema==='stellar-forge.sf47-portfolio.v1'?value.inputs:value;
    if(inputs?.schema!=='stellar-forge.sf47-portfolio.v1'||!Array.isArray(inputs.resources)||!Array.isArray(inputs.tasks)||!Array.isArray(inputs.alternatives))throw new Error('Select the complete original Portfolio input, including resources, tasks and alternatives.');
    const h=handoffDraft();h.portfolioDraft=clone(inputs);h.portfolioDraftSource={filename:selected.name,bytes:selected.bytes,sha256:selected.sha256};
    session.portfolioFile=clone(selected);session.pendingPortfolioFile=null;
    handoffChanged('portfolio');await persist(true);session.notice='Retained the complete original Portfolio draft, exact source file and all alternative/Installation fields.';
  }
  function handoffInputChanged(event){
    const input=event.target,h=handoffDraft();
    if(input.dataset.handoffField!==undefined){
      const key=input.dataset.handoffField,kind=key==='receivingNote'?'receiving':['portfolioName','portfolioNote'].includes(key)?'portfolio':'forecast';
      if(kind==='forecast'&&forecastLocked()||kind==='portfolio'&&portfolioLocked()||kind==='receiving'&&session.receiving?.receivingReviewId)return;
      h[key]=input.type==='checkbox'?input.checked:input.value;
      if(kind==='receiving'){if(session.receiving)session.receiving.receivingNote=input.value;persist();return;}
      handoffChanged(kind);return;
    }
    if(input.dataset.handoffAgreement!==undefined){
      if(forecastLocked())return;const id=input.dataset.handoffAgreement;
      const confirmed=h.book?.document.agreements.some(row=>row.id===id&&row.acceptance.status==='CONFIRMED');
      if(!confirmed){input.checked=false;return;}
      if(input.checked&&!h.agreementIds.includes(id))h.agreementIds.push(id);
      else if(!input.checked)h.agreementIds=h.agreementIds.filter(value=>value!==id);
      handoffChanged('forecast');render();return;
    }
    if(input.dataset.handoffRemainder!==undefined){
      if(forecastLocked())return;const id=input.dataset.handoffRemainder;
      h.remainders[id]||={remainingHours:'',remainingCostUsd:'',note:''};h.remainders[id][input.dataset.remainderField]=input.value;handoffChanged('forecast');return;
    }
    if(input.dataset.handoffTiming!==undefined){
      if(forecastLocked())return;const id=input.dataset.handoffTiming;
      h.paymentModes[id]||={paymentMode:'original',note:''};h.paymentModes[id][input.dataset.timingField]=input.value;handoffChanged('forecast');return;
    }
    if(input.dataset.handoffResource!==undefined){
      if(portfolioLocked())return;h.resourceMap[input.dataset.handoffResource]=input.value;handoffChanged('portfolio');return;
    }
  }
  async function previewCash(){
    const h=handoffDraft();
    if(forecastLocked())throw new Error('Continue the already saved original Forecast in this receiving.');
    const selection=forecastSelection();
    const value=await saveApi(prefix+'/engagement-forecast',{expectedVersion:caseValue.program.version,selection});
    if(!value.selection||!value.inputs||typeof value.forecast?.previewSha256!=='string')throw new Error('The native engagement Forecast preview is incomplete.');
    h.forecastPreview={...value,caseVersion:caseValue.program.version};
    h.portfolioPreview=null;await persist(true);session.notice='Reviewed the complete original cash projection and its selected agreement allocations.';
  }
  async function previewAllocation(){
    const flow=session.receiving,h=handoffDraft();
    if(!flow?.forecastId)throw new Error('Save the reviewed engagement Forecast before reviewing its allocation.');
    if(flow.portfolioId)return;
    const selection={reviewId:flow.reviewId,reviewSha256:flow.reviewSha256,forecastId:flow.forecastId,
      agreementIds:clone(flow.forecastSelection.agreementIds),resourceMap:resourceSelection(),name:h.portfolioName,note:h.portfolioNote};
    if(h.portfolioDraft)selection.inputs=clone(h.portfolioDraft);
    flow.portfolioChoice={resourceMap:clone(selection.resourceMap),inputs:h.portfolioDraft?clone(h.portfolioDraft):null,name:h.portfolioName,note:h.portfolioNote};
    await persist(true);
    const value=await saveApi(prefix+'/engagement-portfolio',{expectedVersion:caseValue.program.version,selection});
    if(!value.selection||!value.inputs||typeof value.portfolio?.previewSha256!=='string')throw new Error('The native engagement Portfolio preview is incomplete.');
    h.portfolioPreview={...value,caseVersion:caseValue.program.version};
    flow.portfolioSelection=clone(value.selection);flow.portfolioInputs=clone(value.inputs);
    flow.portfolioPreviewSha256=value.portfolio.previewSha256;flow.portfolioVersion=caseValue.program.version;
    flow.portfolioPreview=clone(h.portfolioPreview);flow.phase='PORTFOLIO_REVIEWED';await persist(true);
    session.notice='The original allocator has reviewed the complete resource/calendar/phase selection. Inspect its findings before saving the Portfolio.';
  }
  async function acceptHandoffReceipt(accepted,next){
    const flow=session.receiving,context=accepted.context;
    if(!flow||!context||context.flowId!==flow.id)throw new Error('The retained receiving receipt does not match its original workflow.');
    flow.receipts||=[];
    if(!flow.receipts.some(row=>row.payload.requestId===accepted.payload.requestId))flow.receipts.push(clone(accepted));
    if(context.step==='forecast'){
      if(accepted.payload.action!=='forecast.save')throw new Error('The original Forecast receipt action differs.');
      const saved=await saveApi(prefix+'/forecasts/'+encodeURIComponent(accepted.result.recordId));
      if(saved.id!==accepted.result.recordId||!saved.inputs||canonical(saved.inputs)!==canonical(flow.forecastInputs))
        throw new Error('The original saved Forecast has not returned with its exact reviewed inputs.');
      flow.forecastId=saved.id;flow.forecastSha256=saved.sha256;flow.phase='FORECAST_SAVED';
      flow.forecastReceipt=clone(accepted.result);session.notice='Saved the reviewed engagement Forecast. Its original allocation can now be reviewed.';
    }else if(context.step==='portfolio'){
      if(accepted.payload.action!=='portfolio.save')throw new Error('The original Portfolio receipt action differs.');
      const saved=await saveApi(prefix+'/portfolios/'+encodeURIComponent(accepted.result.recordId));
      if(saved.id!==accepted.result.recordId||!saved.inputs||canonical(saved.inputs)!==canonical(flow.portfolioInputs))
        throw new Error('The original saved Portfolio has not returned with its exact reviewed inputs.');
      flow.portfolioId=saved.id;flow.portfolioSha256=saved.sha256;flow.phase='PORTFOLIO_SAVED';
      flow.portfolioReceipt=clone(accepted.result);session.notice='Saved the reviewed native allocation; completing the original source-to-plan receiving record.';
    }else if(context.step==='receiving'){
      if(accepted.payload.action!=='engagement.receiving')throw new Error('The original receiving receipt action differs.');
      const review=await saveApi(prefix+'/reviews/'+encodeURIComponent(accepted.result.recordId));
      if(review.id!==accepted.result.recordId||review.purpose!=='CONTRIBUTOR_ENGAGEMENTS_RECEIVING')throw new Error('The complete original engagement receiving record has not returned.');
      flow.receivingReviewId=review.id;flow.receivingSha256=review.sha256||review.businessSha256;
      flow.receivingReceipt=clone(accepted.result);flow.phase='COMPLETED';flow.completedVersion=next.program.version;
      await refreshHistory();
      const book=await saveApi(prefix+'/engagements/'+encodeURIComponent(flow.reviewId));
      if(book.review?.id!==flow.reviewId)throw new Error('The original source engagement book did not reopen.');
      handoffDraft().book=book;session.notice='Completed the original engagement edition → Forecast → Portfolio receiving. All original writes and sources are retained.';
    }else throw new Error('The retained receiving step is unavailable.');
    await persist(true);
  }
  async function startReceiving(){
    const h=handoffDraft(),preview=h.forecastPreview;
    if(session.receiving?.forecastId)return resumeReceiving(false);
    if(!preview||preview.caseVersion!==caseValue.program.version)throw new Error('Review the complete engagement Forecast against the current case first.');
    if(resourceSelection().some(row=>!row.resourceId.trim()))throw new Error('Select an explicit resource identity for every confirmed contributor before starting this receiving.');
    if(!String(h.receivingNote??'').trim())throw new Error('Enter the recorded receiving review note before starting this native handoff.');
    const flow={schema:'sf47.engagement-receiving-flow.v1',id:crypto.randomUUID(),phase:'FORECAST_REVIEWED',
      reviewId:preview.selection.reviewId,reviewSha256:preview.selection.reviewSha256,
      forecastSelection:clone(preview.selection),forecastInputs:clone(preview.inputs),
      forecastPreviewSha256:preview.forecast.previewSha256,forecastVersion:preview.caseVersion,
      forecastId:null,portfolioId:null,receivingReviewId:null,
      portfolioChoice:{resourceMap:resourceSelection(),inputs:h.portfolioDraft?clone(h.portfolioDraft):null,name:h.portfolioName,note:h.portfolioNote},
      receipts:[],finishRequested:false,receivingNote:h.receivingNote};
    session.receiving=flow;await persist(true);
    await resumeReceiving(false);
  }
  async function resumeReceiving(finish=false){
    const flow=session.receiving;if(!flow)return;
    if(session.pending){await sendPending();if(!available())return;}
    if(session.accepted){await acceptReceipt();if(!available())return;}
    if(flow.phase==='COMPLETED')return;
    if(finish){flow.finishRequested=true;await persist(true);}
    if(!flow.forecastId){
      if(flow.forecastVersion!==caseValue.program.version)throw new Error('The case changed before its original Forecast was saved. Retain this draft and review the current native projection again.');
      await mutate('forecast.save',{inputs:clone(flow.forecastInputs),expectedPreviewSha256:flow.forecastPreviewSha256},
        {expectedVersion:flow.forecastVersion,note:flow.forecastInputs.note||'',context:{flowId:flow.id,step:'forecast'}});
      if(!available()||!flow.forecastId)return;
    }
    if(!flow.portfolioId){
      if(!flow.portfolioPreview||flow.portfolioVersion!==caseValue.program.version){
        flow.finishRequested=false;await previewAllocation();return;
      }
      if(!flow.finishRequested)return;
      await mutate('portfolio.save',{inputs:clone(flow.portfolioInputs),expectedPreviewSha256:flow.portfolioPreviewSha256},
        {expectedVersion:flow.portfolioVersion,note:flow.portfolioInputs.note||'',context:{flowId:flow.id,step:'portfolio'}});
      if(!available()||!flow.portfolioId)return;
    }
    if(!flow.receivingReviewId){
      const reviewNote=String(flow.receivingNote??'').trim();
      if(!reviewNote)throw new Error('Enter the recorded receiving review note before completing this native join.');
      await mutate('engagement.receiving',{reviewId:flow.reviewId,reviewSha256:flow.reviewSha256,
        forecastId:flow.forecastId,portfolioId:flow.portfolioId,forecastSelection:clone(flow.forecastSelection),
        portfolioSelection:clone(flow.portfolioSelection)},{expectedVersion:caseValue.program.version,note:reviewNote,context:{flowId:flow.id,step:'receiving'}});
    }
  }
  function handoffView(){
    const h=handoffDraft(),flow=session.receiving,book=h.book,locked=forecastLocked(),pLocked=portfolioLocked();
    const f=(label,value,key,options={})=>field(label,value,{...options,attrs:{...options.attrs,'data-handoff-field':key,...((key==='receivingNote'?!!flow?.receivingReviewId:['portfolioName','portfolioNote'].includes(key)?pLocked:locked)?{disabled:'disabled','data-engagement-fixed':'true'}:{})}});
    const confirmed=book?.document.agreements.filter(row=>row.acceptance.status==='CONFIRMED')||[];
    const costs=affectedCosts(),resources=nativeResourceOptions();
    const flowStatus=flow?'<section class="engagement-pending"><h4>Original native receiving</h4><p>'+esc(words(flow.phase))+'</p>'+
      table(['Original item','Retained identity'],[['Engagement edition',esc(flow.reviewId)],['Saved Forecast',esc(flow.forecastId||'Awaiting original save')],['Saved Portfolio',esc(flow.portfolioId||'Awaiting native review/save')],['Receiving record',esc(flow.receivingReviewId||'Awaiting original join')]])+
      '<div class="engagement-actions">'+(flow.phase!=='COMPLETED'?button('Resume native receiving','resume-receiving'):button('Download complete received case','download-edition',{'data-review':flow.reviewId}))+
      (flow.forecastId?button('Open saved cash forecast','open-forecast',{'data-forecast':flow.forecastId}):'')+
      (flow.portfolioId?button('Open saved allocation','open-portfolio',{'data-portfolio':flow.portfolioId}):'')+
      (flow.phase==='COMPLETED'?button('Start another reviewed handoff','new-handoff'):button('Save original workflow JSON','export-draft'))+
      '</div></section>':'';
    return '<div data-engagement-handoff>'+flowStatus+
      '<fieldset><legend>Original source edition and dated cash plan</legend><div class="engagement-fields">'+
      field('Saved engagement edition',h.reviewId,{options:[['','Choose a saved edition'],...session.history.map(row=>[row.id,row.name+' · '+row.asOfDate+' · '+row.id])],attrs:{'data-handoff-book':'true',...(locked?{disabled:'disabled','data-engagement-fixed':'true'}:{})}})+
      field('Original saved base Forecast',h.baseForecastId,{options:[['','Choose a saved Forecast'],...caseValue.forecasts.map(row=>[row.id,row.name||row.id])],attrs:{'data-handoff-base-forecast':'true',...(locked?{disabled:'disabled','data-engagement-fixed':'true'}:{})}})+
      f('New Forecast name',h.name,'name',{required:true})+f('Forecast handoff note',h.note,'note',{area:true,wide:true})+
      f('Recorded receiving review note',h.receivingNote||'','receivingNote',{area:true,wide:true,required:true,help:'This explicit note is retained in the final original engagement receiving review.'})+'</div>'+
      (book?'<p>Engagement review date: '+esc(book.document.asOfDate)+'. '+(h.baseForecast?'Base Forecast date: '+esc(h.baseForecast.inputs.asOfDate)+'.':'Select the retained base Forecast to inspect its date and original cash links.')+'</p>':'')+
      (book?'<div class="engagement-fields">'+(confirmed.length?confirmed.map(row=>'<label class="engagement-check"><input type="checkbox" data-handoff-agreement="'+esc(row.id)+'"'+(h.agreementIds.includes(row.id)?' checked':'')+(locked?' disabled data-engagement-fixed="true"':'')+'><span>'+esc(contributor(row.contributorId)?.name||row.contributorId)+' · '+esc(row.role)+'<small>'+esc(row.startDate)+' – '+esc(row.endDate)+' · actual confirmation '+esc(row.acceptance.by)+' / '+esc(row.acceptance.at)+'</small></span></label>').join(''):empty('This edition has no explicitly confirmed contributor agreements.'))+'</div>':'')+
      (h.baseForecast?'<details><summary>Original package and observed direct-cash links</summary><div>'+nativeDetails(h.baseForecast.inputs.packageOverrides||[])+
        '<p>These original links are carried with the complete base Forecast. Open that native Forecast to revise observed cash associations before selecting a new source here.</p>'+button('Open original cash forecast','open-forecast',{'data-forecast':h.baseForecastId})+'</div></details>':'')+'</fieldset>'+
      '<fieldset><legend>Remaining original work and payment treatment</legend>'+
      f('Enter explicit remainder for every affected package',h.explicitRemainders,'explicitRemainders',{type:'checkbox'})+
      note('When explicit remainders are omitted, the native engine shows original baseline amounts less the selected agreement allocations. Each affected cost remains one original package.')+
      (h.explicitRemainders?(costs.length?costs.map(costId=>{const row=h.remainders[costId]||{};return '<div class="engagement-panel"><h4>'+esc(packageName(costId))+'</h4><div class="engagement-fields">'+
        field('Remaining unassigned hours',row.remainingHours??'',{required:true,attrs:{inputmode:'decimal','data-handoff-remainder':costId,'data-remainder-field':'remainingHours',...(locked?{'data-engagement-fixed':'true'}:{})}})+
        field('Remaining unassigned cost (USD)',row.remainingCostUsd??'',{required:true,attrs:{inputmode:'decimal','data-handoff-remainder':costId,'data-remainder-field':'remainingCostUsd',...(locked?{'data-engagement-fixed':'true'}:{})}})+
        field('Remainder note',row.note||'',{area:true,wide:true,attrs:{'data-handoff-remainder':costId,'data-remainder-field':'note',...(locked?{'data-engagement-fixed':'true'}:{})}})+'</div></div>';}).join(''):empty('Select confirmed agreements with original cost allocations.')):'')+
      f('Choose explicit payment treatment for every affected package',h.explicitPaymentModes,'explicitPaymentModes',{type:'checkbox'})+
      (h.explicitPaymentModes?costs.map(costId=>{const row=h.paymentModes[costId]||{};return '<div class="engagement-panel"><h4>'+esc(packageName(costId))+'</h4><div class="engagement-fields">'+
        field('Payment treatment',row.paymentMode||'original',{options:[['original','Original package treatment'],['accrual','Accrual'],['completion','Completion']],attrs:{'data-handoff-timing':costId,'data-timing-field':'paymentMode',...(locked?{'data-engagement-fixed':'true'}:{})}})+
        field('Reviewed timing note',row.note||'',{area:true,attrs:{'data-handoff-timing':costId,'data-timing-field':'note',...(locked?{'data-engagement-fixed':'true'}:{})}})+'</div></div>';}).join(''):note('The native engine uses a common agreement payment treatment. Differing treatments require an explicit reviewed choice.'))+'</fieldset>'+
      '<fieldset><legend>Named resources and complete existing allocation draft</legend><div class="engagement-fields">'+
      f('New Portfolio name',h.portfolioName,'portfolioName',{required:true})+f('Portfolio note',h.portfolioNote,'portfolioNote',{area:true})+
      field('Original full Portfolio draft or saved portfolio.json','',{type:'file',wide:true,attrs:{accept:'.json,application/json','data-handoff-file':'true',...(pLocked?{'data-engagement-fixed':'true'}:{})},help:'The complete original calendar, tasks, alternatives and Installation phase arrays are retained.'})+'</div>'+
      '<div class="engagement-actions">'+button('Use complete selected draft','load-portfolio-file',{},pLocked)+(h.portfolioDraft?button('Use original native seed instead','clear-portfolio-file',{},pLocked):'')+'</div>'+
      (session.pendingPortfolioFile?'<p class="engagement-break">Selected, not yet applied: '+esc(session.pendingPortfolioFile.name)+' · '+esc(session.pendingPortfolioFile.bytes)+' bytes · '+esc(session.pendingPortfolioFile.sha256)+'</p>':'')+
      (h.portfolioDraftSource?'<p class="engagement-break">'+esc(h.portfolioDraftSource.filename)+' · '+esc(h.portfolioDraftSource.bytes)+' bytes · '+esc(h.portfolioDraftSource.sha256)+'</p>':'')+
      (h.portfolioDraft?'<details><summary>Complete retained Portfolio draft</summary><div>'+nativeDetails(h.portfolioDraft)+'</div></details>':'')+
      '<datalist id="engagement-resources-'+esc(programId)+'">'+resources.map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('')+'</datalist>'+
      (chosenAgreements().length?table(['Confirmed contributor','Original or distinct new resource ID'],chosenAgreements().map(row=>[
        esc(contributor(row.contributorId)?.name||row.contributorId)+'<small>'+esc(row.role)+'</small>',
        field('Resource identity',h.resourceMap[row.id]||'',{required:true,attrs:{list:'engagement-resources-'+programId,'data-handoff-resource':row.id,...(pLocked?{'data-engagement-fixed':'true'}:{})}})
      ])):empty('Select confirmed contributors to map their original availability.'))+
      '<div class="engagement-actions">'+button('Use the named contributor IDs as new resources','map-contributor-ids',{},pLocked||!chosenAgreements().length)+'</div>'+
      '<details><summary>Available original role/resource identities</summary><div>'+table(['Resource ID','Original name'],resources.map(([id,name])=>[esc(id),esc(name)]))+'</div></details></fieldset>'+
      '<div class="engagement-actions">'+(!locked?button('Review cash handoff','preview-cash',{},caseValue.program.state!=='OPEN'):button('Review allocation from saved Forecast','preview-allocation',{},pLocked||caseValue.program.state!=='OPEN'))+'</div>'+
      (h.forecastPreview?'<section class="engagement-panel"><h4>Native engagement and cash projection</h4>'+nativeDetails(h.forecastPreview.projection)+
        '<details><summary>Complete original Forecast findings and calculation</summary><div>'+nativeDetails(h.forecastPreview.forecast.report)+'</div></details>'+
        '<details><summary>Full normalized original selection</summary><div>'+nativeDetails(h.forecastPreview.selection)+'</div></details>'+
        '<div class="engagement-actions">'+button('Save cash forecast and review allocation','start-receiving',{},locked||caseValue.program.state!=='OPEN')+'</div></section>':'')+
      (h.portfolioPreview||flow?.portfolioPreview?(()=>{const preview=h.portfolioPreview||flow.portfolioPreview;return '<section class="engagement-panel"><h4>Original allocation and capacity review</h4>'+nativeDetails(preview.projection)+
        '<details open><summary>Native delivery allocation and findings</summary><div>'+nativeDetails(preview.portfolio.report)+'</div></details>'+
        '<details><summary>Complete original resources, calendar, tasks and alternatives</summary><div>'+nativeDetails(preview.inputs)+'</div></details>'+
        '<div class="engagement-actions">'+button('Save allocation and finish receiving','finish-receiving',{},pLocked||caseValue.program.state!=='OPEN')+'</div></section>';})():'')+
      '</div>';
  }
  async function handoffAction(action,target){
    const h=handoffDraft();
    if(action==='load-portfolio-file'){await usePortfolioFile($('[data-handoff-file]')?.files?.[0]);return;}
    if(action==='clear-portfolio-file'){h.portfolioDraft=null;h.portfolioDraftSource=null;session.portfolioFile=null;session.pendingPortfolioFile=null;handoffChanged('portfolio');return;}
    if(action==='map-contributor-ids'){for(const row of chosenAgreements())h.resourceMap[row.id]=row.contributorId;handoffChanged('portfolio');return;}
    if(action==='preview-cash'){await previewCash();return;}
    if(action==='preview-allocation'){await previewAllocation();return;}
    if(action==='start-receiving'){await startReceiving();return;}
    if(action==='resume-receiving'){await resumeReceiving(false);return;}
    if(action==='finish-receiving'){await resumeReceiving(true);return;}
    if(action==='new-handoff'){
      if(session.receiving?.phase!=='COMPLETED')throw new Error('Finish the original retained receiving first.');
      session.receiving=null;h.forecastPreview=null;h.portfolioPreview=null;h.baseForecastId='';h.baseForecast=null;await persist(true);return;
    }
    if(action==='open-forecast'){
      await persist(true);
      if(onForecast)await onForecast({forecastId:target.dataset.forecast});
      else session.notice='Open Forecast '+target.dataset.forecast+' in the original Operating forecast tab.';
      return;
    }
    if(action==='open-portfolio'){
      await persist(true);
      if(onPortfolio)await onPortfolio({portfolioId:target.dataset.portfolio});
      else session.notice='Open Portfolio '+target.dataset.portfolio+' in the original Delivery allocation tab.';
      return;
    }
  }
  function handoffChangedSelection(event){
    const element=event.target;
    if(element.dataset.handoffBook!==undefined){void run(()=>chooseHandoffBook(element.value));return true;}
    if(element.dataset.handoffBaseForecast!==undefined){void run(()=>chooseForecast(element.value));return true;}
    return false;
  }

  return {ready,root,setHostBusy,dispose};
}
