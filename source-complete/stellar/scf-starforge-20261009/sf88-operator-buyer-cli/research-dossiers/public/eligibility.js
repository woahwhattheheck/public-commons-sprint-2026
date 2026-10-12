// MIT. Eligibility review inside the original authenticated Research workspace.
import {renderInspectedSource,renderOriginalRecordControl} from './source-inspection.js';
const CACHE='research-eligibility-browser-v1',PAGE_SIZE=30,MAX_BYTES=16*1024*1024;
const ACTIONS=['create-review','revise-protocol','create-workset','decide','resolve','study-link','apply-outcomes','review-impact'];
const SECTIONS=[['overview','Overview'],['reviews','Reviews'],['occurrences','Retained reports'],['queue','Review queue'],['decisions','Decisions'],['resolutions','Resolutions'],['studies','Studies'],['impact','Source changes'],['operations','Operations']];
const TABLES=['occurrences','queue','decisions','resolutions','studies','impact','operations'];
const ASSESSMENTS=[['','Choose assessment'],['meets','Meets'],['does_not_meet','Does not meet'],['unclear','Unclear'],['not_applicable','Not applicable']];
const CLASSIFICATIONS=[['unreviewed','Unreviewed'],['supports','Supports'],['contradicts','Contradicts'],['background','Background']];
const ERROR_MESSAGES={
 REVISION_CONFLICT:'This dossier changed. Refresh its saved revision, review the retained draft and explicitly rebase before saving.',
 ELIGIBILITY_REQUEST_CONFLICT:'That request ID already belongs to different input. Recover the original request before preparing a new operation.',
 ELIGIBILITY_PRECEDING_STAGE_UNRESOLVED:'Resolve the preceding stage before reviewing this stage.',
 ELIGIBILITY_MINIMUM_DECISIONS_REQUIRED:'The saved protocol still needs more distinct reviewer decisions.',
 ELIGIBILITY_CURRENT_DECISIONS_REQUIRED:'The decision set changed. Reopen this report and resolve its current recorded decisions.',
 ELIGIBILITY_CONSENSUS_DISAGREEMENT:'The current decisions do not agree on this outcome and exclusion reason. Use the protocol’s disagreement procedure.',
 ELIGIBILITY_CORRECTION_REFERENCE_REQUIRED:'A correction must explicitly reference this reviewer’s current saved decision.',
 ELIGIBILITY_ACTOR_OUTSIDE_PROCESS:'Choose the exact reviewer name and ID assigned to this stage or resolver operation in the saved protocol.',
 ELIGIBILITY_REVIEWER_NOT_ALLOWED:'Choose a reviewer assigned to this stage or a resolver assigned to this operation.',
 ELIGIBILITY_FULL_TEXT_BASIS_REQUIRED:'This decisive full-text outcome needs an available retained source basis.',
 ELIGIBILITY_AVAILABLE_BASIS_REQUIRED:'Available evidence needs its exact retained occurrences and a source locator.',
 ELIGIBILITY_INCLUDE_CRITERIA_UNRESOLVED:'An include decision requires all stage criteria to meet the rule or be marked not applicable.',
 ELIGIBILITY_EXCLUSION_CRITERION_REQUIRED:'An exclusion needs at least one criterion that does not meet the rule.',
 ELIGIBILITY_EXCLUSION_REASON_REQUIRED:'Choose an exclusion reason from the saved protocol.',
 ELIGIBILITY_REPORT_ALREADY_LINKED:'A selected report belongs to another current study. Correct its prior study link first.',
 ELIGIBILITY_CURRENT_PROTOCOL_REQUIRED:'Create the outcome work set under the current protocol edition before applying it.',
 ELIGIBILITY_QUESTION_CHANGED:'The question wording changed. Retain a reviewed protocol edition for the current question.',
 ELIGIBILITY_FINAL_RESOLUTION_REQUIRED:'This outcome needs a current final resolution. Reopen its review queue.',
 ELIGIBILITY_FINAL_STAGE_REQUIRED:'Inclusion must complete the final stage in this protocol.',
 ELIGIBILITY_PROTOCOL_UNCHANGED:'This protocol and question wording already match the saved edition.',
 ELIGIBILITY_PAGE_REVISION_REQUIRED:'Continue this page using its original saved revision.',
};
const STATUSES={NOT_READY:'Earlier stage incomplete',NOT_REQUIRED:'Stage not required',MISSING_DECISIONS:'Reviewers needed',UNCERTAIN:'Uncertain',UNAVAILABLE:'Source unavailable',CONFLICT:'Disagreement',AGREEMENT:'Agreement awaiting resolution',RESOLVED_INCLUDE:'Resolved: include',RESOLVED_EXCLUDE:'Resolved: exclude',AWAITING_INFORMATION:'Awaiting information',RESOLUTION_STALE:'Resolution needs review'};
const arr=v=>Array.isArray(v)?v:[],clone=v=>structuredClone(v),now=()=>new Date().toISOString();
const uid=p=>p+crypto.randomUUID().replaceAll('-','');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const err=(code,message)=>Object.assign(new Error(message),{code,detail:message});
const need=(ok,code,message)=>{if(!ok)throw err(code,message);};
const size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const ids=v=>[...new Set(String(v??'').split(/[\s,]+/).filter(Boolean))];
const text=v=>v===undefined||v===null?'':String(v);
const readable=v=>text(v).replaceAll('_',' ').replaceAll('-',' ');
const date=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toLocaleString():text(v)||'Not recorded';};
const node=(tag,value,css)=>{const e=document.createElement(tag);if(value!==undefined&&value!==null)e.textContent=text(value);if(css)e.className=css;return e;};
const option=(value,label)=>{const e=node('option',label);e.value=value;return e;};
const href=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const scope=(dossierId,reviewId)=>JSON.stringify([dossierId,reviewId??null]);
const download=(body,name,type='application/json')=>{
 const u=URL.createObjectURL(new Blob([body],{type})),a=node('a');a.href=u;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
};
async function browserCache(){
 need(globalThis.indexedDB,'ELIGIBILITY_BROWSER_STORAGE','This browser cannot retain review drafts. Open the original workspace in a browser with IndexedDB enabled.');
 const db=await new Promise((resolve,reject)=>{
  let ended=false;const q=indexedDB.open(CACHE,1);
  q.onupgradeneeded=()=>{for(const name of ['drafts','pending']){const s=q.result.createObjectStore(name,{keyPath:'id'});s.createIndex('dossierId','dossierId');}};
  q.onerror=()=>{if(!ended){ended=true;reject(q.error);}};
  q.onblocked=()=>{if(!ended){ended=true;reject(err('ELIGIBILITY_BROWSER_STORAGE','Close an older eligibility window to reopen this browser’s draft database.'));}};
  q.onsuccess=()=>{if(ended){q.result.close();return;}ended=true;resolve(q.result);};
 });
 let closed=false;db.onversionchange=()=>{closed=true;db.close();};db.onclose=()=>{closed=true;};
 const transact=(name,mode,work)=>new Promise((resolve,reject)=>{
  if(closed){reject(err('ELIGIBILITY_BROWSER_STORAGE','Reload the original workspace to reopen its review drafts.'));return;}
  let tx,result,failure;
  try{tx=db.transaction(name,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch(e){reject(e);return;}
  const fail=e=>{failure=e;try{tx.abort();}catch{}};
  const read=(q,fn)=>{q.onsuccess=()=>{try{fn(q.result);}catch(e){fail(e);}};};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure||tx.error||err('ELIGIBILITY_BROWSER_STORAGE','The browser did not commit this record.'));
  try{work(tx.objectStore(name),read,v=>{result=v;},fail);}catch(e){fail(e);}
 });
 return {
  list:(name,dossierId)=>transact(name,'readonly',(s,r,done)=>r(s.index('dossierId').getAll(dossierId),v=>done(v.sort((a,b)=>(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt))))),
  draft:value=>transact('drafts','readwrite',(s,r,done)=>r(s.get(value.id),old=>{
   need(!old||old.writer===value.writer&&(old.editVersion<value.editVersion||same(old,value)),'ELIGIBILITY_DRAFT_CHANGED','Another window changed this draft. Download your open edit before reopening its saved copy.');
   if(!old||!same(old,value))s.put(clone(value));done(clone(value));
  })),
  removeDraft:(id,expected)=>transact('drafts','readwrite',(s,r,done)=>r(s.get(id),old=>{const match=!!old&&same(old,expected);if(match)s.delete(id);done(match);})),
  pending:value=>transact('pending','readwrite',(s,r,done)=>r(s.get(value.id),old=>{
   need(!old||old.dossierId===value.dossierId&&same(old.payload,value.payload),'ELIGIBILITY_REQUEST_CHANGED','The original saved request must keep its complete input.');
   if(old){done(old);return;}
   r(s.index('dossierId').getAll(value.dossierId),rows=>{
    need(!rows.some(v=>['READY','SENDING','UNCERTAIN'].includes(v.state)),'ELIGIBILITY_REQUEST_PENDING','Recover the original pending request before saving another operation in this dossier.');
    s.add(clone(value));done(clone(value));
   });
  })),
  result:(id,changes)=>transact('pending','readwrite',(s,r,done)=>r(s.get(id),old=>{
   need(old,'ELIGIBILITY_REQUEST_MISSING','The original browser request is unavailable.');
   need(!Object.keys(changes).some(k=>['id','dossierId','payload','createdAt','draft'].includes(k)),'ELIGIBILITY_REQUEST_CHANGED','The original saved request is immutable.');
   if(old.state==='COMPLETE'){
    if(changes.state==='COMPLETE')need(same(old.reply?.operation,changes.reply?.operation),'ELIGIBILITY_OPERATION_CHANGED','The original operation returned a different receipt.');
    done(old);return;
   }
   const value={...old,...clone(changes),updatedAt:now()};s.put(value);done(value);
  })),
  close(){closed=true;db.close();}
 };
}

export function createEligibilityPanel({root,tab,api,task,notify,getDossier,isBusy,onReceived}){
 const writer=uid('window_'),initial=new URLSearchParams(location.hash.slice(1));
 const state={dossier:null,visible:false,view:null,reviewId:initial.get('eligReview')||null,workSetId:initial.get('eligWorkset')||null,
  section:SECTIONS.some(v=>v[0]===initial.get('eligSection'))?initial.get('eligSection'):'overview',offset:0,pinnedRevision:null,
  reviews:new Map(),reviewsRevision:null,catalogKey:null,catalogWorkSets:[],focus:null,filter:'',status:'all',selectedOccurrences:new Map(),selectedOutcomes:new Map(),
  draft:null,drafts:[],pending:[],cache:null,cachePromise:null,persist:Promise.resolve(),storageError:null,loading:false,busy:false,
  loadId:0,accepting:false,sourceId:0,lastReply:null,message:null};
 const unsaved=new Map(),controls={};
 const base=(id=state.dossier?.id)=>'/api/dossiers/'+encodeURIComponent(id);
 const busy=()=>state.busy||isBusy();
 const message=(value,kind='info')=>{state.message=value?{value,kind}:null;if(controls.message){controls.message.textContent=value||'';controls.message.dataset.kind=kind;controls.message.hidden=!value;}};
 const report=e=>{const value=ERROR_MESSAGES[e?.code]||e?.detail||e?.message||String(e);message(value,'error');notify(value,'error');};
 const run=fn=>task(async()=>{state.busy=true;updateBusy();try{return await fn();}catch(e){report(e);}finally{state.busy=false;updateBusy();}});
 const button=(label,fn,{css='',mutate=false,disabled=false}={})=>{
  const b=node('button',label,css||'compact');b.type='button';b.dataset.erButton='1';if(mutate)b.dataset.erMutate='1';b.dataset.erDisabled=disabled?'1':'0';b.disabled=disabled||busy();
  b.addEventListener('click',()=>run(fn));return b;
 };
 const tag=(label)=>node('span',label,'er-tag');
 const details=(title,value)=>{const d=node('details',undefined,'er-original');d.append(node('summary',title),node('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return d;};
 const field=(label,input,hint)=>{const l=node('label',undefined,'er-field');l.append(node('span',label),input);if(hint)l.append(node('small',hint));return l;};
 const input=(value,onChange,{rows,max=100000,type='text',required=false,readonly=false,placeholder=''}={})=>{
  const e=node(rows?'textarea':'input');if(rows)e.rows=rows;else e.type=type;e.value=text(value);e.maxLength=max;e.required=required;e.readOnly=readonly;e.placeholder=placeholder;e.dataset.erEdit='1';
  if(onChange)e.addEventListener('input',()=>onChange(e.value));return e;
 };
 const select=(values,value,onChange,{required=false}={})=>{
  const e=node('select');e.append(...values.map(v=>option(v[0],v[1])));e.value=value??'';e.required=required;e.dataset.erEdit='1';if(onChange)e.addEventListener('change',()=>onChange(e.value));return e;
 };
 const check=(label,value,onChange)=>{
  const e=node('label',undefined,'er-check'),i=node('input');i.type='checkbox';i.checked=!!value;i.dataset.erEdit='1';i.addEventListener('change',()=>onChange(i.checked));e.append(i,node('span',label));return e;
 };
 const protocolFor=id=>arr(state.view?.protocols).find(v=>v.id===id);
 const worksetFor=id=>arr(state.catalogWorkSets).find(v=>v.id===id)||arr(state.view?.workSets).find(v=>v.id===id);
 const currentWorkset=()=>worksetFor(state.workSetId);
 const currentProtocol=()=>protocolFor(currentWorkset()?.protocolId)||arr(state.view?.protocols).filter(v=>v.reviewId===state.reviewId).at(-1);
 const unresolved=()=>state.pending.some(v=>['READY','SENDING','UNCERTAIN'].includes(v.state));
 async function cache(){
  if(state.cache)return state.cache;if(!state.cachePromise)state.cachePromise=browserCache().then(v=>(state.cache=v)).catch(e=>{state.cachePromise=null;throw e;});return state.cachePromise;
 }
 async function browserRecords(){
  if(!state.dossier)return;
  const id=state.dossier.id;
  try{const c=await cache(),[drafts,pending]=await Promise.all([c.list('drafts',id),c.list('pending',id)]);
   if(state.dossier?.id!==id)return;state.drafts=drafts;state.pending=pending;state.storageError=null;
  }catch(e){state.storageError=e?.message||String(e);}
 }
 function persistDraft(){
  if(!state.draft)return Promise.resolve();
  const value=clone(state.draft);unsaved.set(value.id,value);
  state.persist=state.persist.catch(()=>{}).then(async()=>{
   try{await(await cache()).draft(value);if(same(unsaved.get(value.id),value))unsaved.delete(value.id);state.storageError=null;}
   catch(e){state.storageError=e?.message||String(e);throw e;}
  });
  state.persist.catch(()=>{});return state.persist;
 }
 function touch(change){
  if(!state.draft)return;change(state.draft);state.draft.editVersion++;state.draft.updatedAt=now();persistDraft();
  if(controls.draftStatus)controls.draftStatus.textContent='Saving browser draft…';updateDraftStatus();
 }
 function updateDraftStatus(){
  const id=state.draft?.id;
  if(controls.draftStatus)controls.draftStatus.textContent=state.storageError?'Browser storage: '+state.storageError:id&&unsaved.has(id)?'Browser draft is being saved':'Browser draft retained';
  state.persist.finally(()=>{if(controls.draftStatus&&state.draft?.id===id)controls.draftStatus.textContent=state.storageError?'Browser storage: '+state.storageError:'Browser draft retained';}).catch(()=>{});
 }
 function updateBusy(){
  for(const b of root.querySelectorAll('[data-er-button]'))b.disabled=busy()||b.dataset.erDisabled==='1';
  for(const e of root.querySelectorAll('[data-er-edit]'))e.disabled=busy();
 }
 function hashState(){
  const p=new URLSearchParams(location.hash.slice(1));
  for(const [key,value] of [['eligReview',state.reviewId],['eligWorkset',state.workSetId],['eligSection',state.section]])if(value)p.set(key,value);else p.delete(key);
  history.replaceState(null,'','#'+p.toString());
 }
 function viewUrl({section=state.section,reviewId=state.reviewId,workSetId=state.workSetId,offset=state.offset,revision=state.pinnedRevision||state.dossier?.revision,limit=PAGE_SIZE}={}){
  const p=new URLSearchParams({section,offset:String(offset),limit:String(limit),revision:String(revision)});
  if(reviewId)p.set('reviewId',reviewId);if(workSetId)p.set('workSetId',workSetId);return base()+'/eligibility?'+p;
 }
 async function load({offset=state.offset,section=state.section}={}){
  if(!state.dossier||!state.visible)return;
  const generation=++state.loadId,id=state.dossier.id,revision=state.pinnedRevision||state.dossier.revision;
  state.loading=true;state.offset=offset;state.section=section;render();
  try{
   const path=viewUrl({offset,section,revision}),wantReviews=state.reviewsRevision!==revision,scopeKey=JSON.stringify([revision,state.reviewId]);
   const [view,reviews,catalog]=await Promise.all([api(path),wantReviews&&section!=='reviews'?api(viewUrl({section:'reviews',workSetId:null,reviewId:null,offset:0,revision,limit:100})):null,
    state.workSetId&&state.catalogKey!==scopeKey?api(viewUrl({section:'overview',workSetId:null,offset:0,revision})):null]);
   if(generation!==state.loadId||state.dossier?.id!==id)return;
   need(view.schema==='sf88-research-eligibility-view/v1'&&view.dossier?.id===id&&view.dossier.revision===revision,'ELIGIBILITY_VIEW_CHANGED','The eligibility page belongs to a different saved dossier revision.');
   state.view=view;state.pinnedRevision=view.dossier.revision;
   if(catalog||!state.workSetId){state.catalogKey=scopeKey;state.catalogWorkSets=clone((catalog||view).workSets||[]);}
   if(view.reviewId)state.reviewId=view.reviewId;if(view.workSetId)state.workSetId=view.workSetId;
   const reviewPage=reviews||(section==='reviews'?view:null);
   if(reviewPage){if(state.reviewsRevision!==revision)state.reviews.clear();for(const row of arr(reviewPage.items))state.reviews.set(row.id,row);state.reviewsRevision=revision;}
   if(state.focus){const current=arr(view.items).find(v=>rowId(v)===rowId(state.focus));state.focus=current?clone(current):null;}
   await browserRecords();hashState();
  }catch(e){if(generation===state.loadId)report(e);}
  finally{if(generation===state.loadId){state.loading=false;render();}}
 }
 async function fresh(){
  need(state.dossier,'ELIGIBILITY_DOSSIER_REQUIRED','Open a dossier first.');
  const id=state.dossier.id,view=await api(base(id));state.accepting=true;
  try{await onReceived(view);}finally{state.accepting=false;}
  state.dossier=view;state.pinnedRevision=view.revision;state.reviewsRevision=null;state.offset=0;
  await load({offset:0});
 }
 async function choose({reviewId=state.reviewId,workSetId=state.workSetId,section=state.section}={}){
  const changed=reviewId!==state.reviewId||workSetId!==state.workSetId;
  state.reviewId=reviewId||null;state.workSetId=workSetId||null;state.section=section;state.offset=0;state.focus=null;state.filter='';state.status='all';
  if(changed){state.selectedOccurrences.clear();state.selectedOutcomes.clear();}
  await load({offset:0});
 }
 function rowId(v){return v?.id||[v?.workSetId,v?.occurrenceId,v?.stageId].filter(Boolean).join(':')||v?.occurrenceId||'';}
 function blankProtocol(){
  return {name:'',criteria:[{id:'criterion_1',name:'',include:'',exclude:''}],
   stages:[{id:'stage_1',name:'',criterionIds:['criterion_1'],reviewerIds:['reviewer_1','reviewer_2'],minimumDecisions:2,requireFullText:false}],
   reviewers:[{id:'reviewer_1',name:''},{id:'reviewer_2',name:''}],resolverIds:[],exclusionReasons:[{id:'reason_1',label:''}],disagreementProcedure:''};
 }
 async function begin(action,data,context={}){
  need(ACTIONS.includes(action),'ELIGIBILITY_ACTION_INVALID','Choose an eligibility operation.');
  need(!unresolved(),'ELIGIBILITY_REQUEST_PENDING','Recover the original pending request before preparing another operation.');
  if(state.draft)await persistDraft();
  const definition=context.protocol?.definition||currentProtocol()?.definition;
  state.draft={schema:'sf88-research-eligibility-browser-draft/v1',id:uid('draft_'),writer,editVersion:1,dossierId:state.dossier.id,
   reviewId:action==='create-review'?null:state.reviewId,action,actor:{id:'',name:''},baseRevision:state.pinnedRevision||state.dossier.revision,
   data:clone(data),context:clone(context),createdAt:now(),updatedAt:now()};
  if(definition&&action!=='create-review')state.draft.context.actorReviewers=clone(definition.reviewers||[]);
  await persistDraft();await browserRecords();render();
 }
 async function reopenDraft(old){
  need(old.dossierId===state.dossier?.id,'ELIGIBILITY_DRAFT_DOSSIER','Open the original dossier for this draft.');
  if(state.draft)await persistDraft();
  state.draft={...clone(old),id:uid('draft_'),writer,editVersion:1,parentDraft:{id:old.id,value:clone(old)},updatedAt:now()};
  await persistDraft();render();
 }
 function requestFromDraft(){
  const d=state.draft;need(d&&d.dossierId===state.dossier?.id,'ELIGIBILITY_DRAFT_REQUIRED','Open this dossier’s draft first.');
  need(d.actor.id&&d.actor.name,'ELIGIBILITY_ACTOR_REQUIRED','Choose the local reviewer named in this protocol.');
  need(d.baseRevision===state.dossier.revision&&d.baseRevision===(state.pinnedRevision||state.dossier.revision),'REVISION_CONFLICT','This draft belongs to an earlier revision. Refresh and explicitly rebase it before saving.');
  const payload={requestId:uid('eligibility_'),expectedRevision:d.baseRevision,actor:clone(d.actor),action:d.action,data:clone(d.data)};
  if(d.reviewId)payload.reviewId=d.reviewId;
  if(d.action==='create-review'){need(d.data.questionId&&d.data.name,'ELIGIBILITY_REVIEW_REQUIRED','Choose a question and name this review.');validateProtocol(d.data.protocol);}
  if(d.action==='revise-protocol')validateProtocol(d.data.protocol);
  if(!['create-review'].includes(d.action))need(text(d.data.reason).trim(),'ELIGIBILITY_REASON_REQUIRED','Record the reason for this operation.');
  if(d.action==='create-workset')need(arr(d.data.occurrenceIds).length,'ELIGIBILITY_WORKSET_EMPTY','Select the exact retained report occurrences.');
  if(d.action==='decide'){
   need(d.data.disposition,'ELIGIBILITY_DECISION_REQUIRED','Choose the reviewer’s disposition.');
   if(['include','exclude'].includes(d.data.disposition))need(arr(d.data.criterionAnswers).every(v=>ASSESSMENTS.some(a=>a[0]&&a[0]===v.assessment)),'ELIGIBILITY_ASSESSMENT_REQUIRED','Complete each criterion assessment for this decisive outcome.');
   else payload.data.criterionAnswers=arr(payload.data.criterionAnswers).filter(v=>v.assessment);
   const previous=arr(d.context.row?.decisions).find(v=>v.actor?.id===d.actor.id);if(previous)need(d.data.supersedes===previous.id,'ELIGIBILITY_CORRECTION_REFERENCE_REQUIRED','Use your recorded decision as a correction, preserving its original ID.');
   if(d.data.basis.availability==='available')need(arr(d.data.basis.occurrenceIds).length&&text(d.data.basis.locator).trim(),'ELIGIBILITY_AVAILABLE_BASIS_REQUIRED','Available evidence needs its exact retained occurrence IDs and a locator.');
   if(['include','exclude'].includes(d.data.disposition)&&d.context.row?.requireFullText)
    need(d.data.basis.availability==='available'&&arr(d.data.basis.occurrenceIds).length&&text(d.data.basis.locator).trim(),'ELIGIBILITY_FULL_TEXT_REQUIRED','A decisive full-text review needs available retained evidence, its exact occurrence IDs and a locator.');
  }
  if(d.action==='resolve')need(d.data.mode&&d.data.disposition&&arr(d.data.decisionIds).length,'ELIGIBILITY_RESOLUTION_REQUIRED','Choose the resolution method, outcome and original decisions.');
  if(['decide','resolve'].includes(d.action)&&d.data.disposition==='exclude')need(d.data.exclusionReasonId,'ELIGIBILITY_EXCLUSION_REASON_REQUIRED','Choose the protocol’s exclusion reason.');
  if(d.action==='apply-outcomes')need(arr(d.data.outcomes).length,'ELIGIBILITY_OUTCOMES_EMPTY','Select current resolved outcomes to apply.');
  need(size(payload)<=MAX_BYTES,'ELIGIBILITY_REQUEST_SIZE','This operation exceeds the original workspace’s 16 MiB request limit.');return payload;
 }
 function validateProtocol(p){
  need(p&&p.name&&arr(p.criteria).length&&arr(p.stages).length&&arr(p.reviewers).length,'ELIGIBILITY_PROTOCOL_REQUIRED','Complete the protocol name, criteria, stages and local reviewers.');
  for(const key of ['criteria','stages','reviewers','exclusionReasons'])need(new Set(arr(p[key]).map(v=>v.id)).size===arr(p[key]).length,'ELIGIBILITY_PROTOCOL_DUPLICATE','Protocol identifiers must be unique within each table.');
  need(arr(p.criteria).every(v=>v.id&&v.name&&v.include&&v.exclude)&&arr(p.reviewers).every(v=>v.id&&v.name),'ELIGIBILITY_PROTOCOL_REQUIRED','Complete every criterion and reviewer.');
  need(arr(p.stages).every(v=>v.id&&v.name&&Number.isInteger(v.minimumDecisions)&&v.minimumDecisions>0&&arr(v.reviewerIds).length>=v.minimumDecisions),'ELIGIBILITY_PROTOCOL_REVIEWERS','Each stage needs its named reviewers and a valid minimum number of decisions.');
  need(text(p.disagreementProcedure).trim(),'ELIGIBILITY_DISAGREEMENT_REQUIRED','Record how disagreements and unavailable information will be handled.');
 }
 async function saveDraft(form){
  need(form.reportValidity(),'ELIGIBILITY_FORM_INCOMPLETE','Complete the highlighted fields.');
  await persistDraft();const payload=requestFromDraft(),entry={schema:'sf88-research-eligibility-browser-request/v1',id:payload.requestId,dossierId:state.dossier.id,
   payload,draft:clone(state.draft),state:'READY',createdAt:now(),updatedAt:now()};
  await(await cache()).pending(entry);await browserRecords();await sendOriginal(entry);
 }
 async function sendOriginal(entry){
  need(entry.dossierId===state.dossier?.id,'ELIGIBILITY_REQUEST_DOSSIER','Open the original dossier to recover this request.');
  need(['READY','SENDING','UNCERTAIN'].includes(entry.state),'ELIGIBILITY_REQUEST_TERMINAL','This request already has a recorded outcome.');
  const c=await cache();await c.result(entry.id,{state:'SENDING',lastAttemptAt:now()});await browserRecords();render();
  try{
   const reply=await api(base(entry.dossierId)+'/eligibility/reviews?projection=metadata',{method:'POST',body:entry.payload});
   need(reply?.operation?.requestId===entry.id&&reply.operation.action===entry.payload.action&&reply.dossier?.id===entry.dossierId,'ELIGIBILITY_OPERATION_RECEIPT','Keep this original request: the response did not contain its matching operation receipt.');
   await c.result(entry.id,{state:'COMPLETE',reply:clone(reply),error:null});state.lastReply=reply;
   if(state.draft?.id===entry.draft?.id){const old=clone(state.draft);await c.removeDraft(old.id,old);if(old.parentDraft)await c.removeDraft(old.parentDraft.id,old.parentDraft.value);state.draft=null;}
   const result=reply.operation.result||{};state.reviewId=reply.operation.reviewId||result.review?.id||entry.payload.reviewId||state.reviewId;
   if(result.workSet?.id){state.workSetId=result.workSet.id;state.selectedOccurrences.clear();}
   if(result.application)state.selectedOutcomes.clear();
   await browserRecords();await fresh();message((reply.duplicate?'Recovered original operation. ':'Saved operation. ')+readable(entry.payload.action)+' · revision '+reply.operation.revision);notify('Eligibility '+readable(entry.payload.action)+' saved.');
  }catch(e){
   const terminal=Number.isInteger(e?.status)&&[400,401,403,404,405,409,413,415,422,429].includes(e.status);
   await c.result(entry.id,{state:terminal?'REJECTED':'UNCERTAIN',error:{code:e?.code||'REQUEST_FAILED',message:e?.detail||e?.message||String(e),at:now()}}).catch(storage=>{state.storageError=storage.message;});
   await browserRecords();render();throw e;
  }
 }
 async function rebase(){
  const d=state.draft;need(d,'ELIGIBILITY_DRAFT_REQUIRED','Open a draft first.');
  need(!unresolved(),'ELIGIBILITY_REQUEST_PENDING','Recover the pending request before creating another revision of its draft.');
  await fresh();need(state.draft?.id===d.id,'ELIGIBILITY_DRAFT_CHANGED','The selected draft changed.');
  touch(v=>{v.baseRevision=state.dossier.revision;v.rebasedAt=now();});await persistDraft();render();
  message('Draft retained with the current dossier revision. Review the selected protocol, source reports and any superseded decision before saving.');
 }
 async function exportReport(format){
  need(state.reviewId,'ELIGIBILITY_REVIEW_REQUIRED','Choose a review to export.');
  const section=TABLES.includes(state.section)?state.section:'queue',p=new URLSearchParams({format,section,reviewId:state.reviewId,revision:String(state.pinnedRevision||state.dossier.revision)});
  if(state.workSetId)p.set('workSetId',state.workSetId);
  const r=await api(base()+'/eligibility/export?'+p,{download:true}),bytes=await r.arrayBuffer();
  const declared=r.headers.get('content-length');need(!declared||Number(declared)===bytes.byteLength,'ELIGIBILITY_EXPORT_INCOMPLETE','The report download is incomplete.');
  const filename=(r.headers.get('content-disposition')||'').match(/filename="?([^";]+)"?/)?.[1]||'eligibility-'+section+'.'+format;
  download(bytes,filename.split(/[\\/]/).at(-1),r.headers.get('content-type')||'application/octet-stream');notify('Eligibility report downloaded.');
 }
 async function importRequest(file){
  need(file&&file.size<=MAX_BYTES,'ELIGIBILITY_REQUEST_SIZE','Choose a complete eligibility request of at most 16 MiB.');
  let value;try{value=JSON.parse(await file.text());}catch{throw err('JSON_INVALID','The selected request is not valid JSON.');}
  const payload=value.payload||value;
  need(payload&&typeof payload.requestId==='string'&&ACTIONS.includes(payload.action)&&payload.data&&typeof payload.data==='object'&&payload.actor?.id&&payload.actor?.name&&Number.isSafeInteger(payload.expectedRevision),'ELIGIBILITY_REQUEST_INVALID','Choose the complete original request, including actor, action, revision and request ID.');
  need(!value.dossierId||value.dossierId===state.dossier.id,'ELIGIBILITY_REQUEST_DOSSIER','This request belongs to another dossier.');
  const entry={schema:'sf88-research-eligibility-browser-request/v1',id:payload.requestId,dossierId:state.dossier.id,payload:clone(payload),state:'READY',createdAt:now(),updatedAt:now()};
  await(await cache()).pending(entry);await browserRecords();render();message('Original request imported. Review its complete input under Browser drafts and requests, then submit that same request.');
 }


 function sectionTitle(){return SECTIONS.find(v=>v[0]===state.section)?.[1]||'Eligibility';}
 function titleOf(row){return row.title||row.name||row.question?.text||row.occurrenceId||row.id||'Retained record';}
 function stat(label,value,hint){const e=node('article',undefined,'er-stat');e.append(node('strong',value??0),node('span',label));if(hint)e.append(node('small',hint));return e;}
 function render(){
  root.replaceChildren();root.classList.add('eligibility-workspace');controls.message=node('div',state.message?.value||'','er-message');
  controls.message.hidden=!state.message;controls.message.dataset.kind=state.message?.kind||'info';controls.message.setAttribute('role','status');
  const header=node('header',undefined,'er-header'),heading=node('div');heading.append(node('p','RESEARCH / ELIGIBILITY','er-eyebrow'),node('h2','Eligibility review'),
   node('p','Keep the review question, protocol, report editions and each reviewer’s decisions together.','er-subtitle'));
  const actions=node('div',undefined,'button-row');actions.append(
   button('Refresh saved revision',fresh,{disabled:!state.dossier||state.loading}),
   button('New review',()=>begin('create-review',{questionId:'',name:'',description:'',protocol:blankProtocol()}),{mutate:true,disabled:!state.dossier||unresolved()}));
  header.append(heading,actions);root.append(header,controls.message);
  if(!state.dossier){root.append(node('p','Open a saved dossier to review its retained reports.','er-empty'));return;}
  const toolbar=node('div',undefined,'er-toolbar');
  const reviews=[['','Choose review'],...Array.from(state.reviews.values()).map(v=>[v.id,v.name||v.title||v.id])];
  if(state.reviewId&&!reviews.some(v=>v[0]===state.reviewId))reviews.push([state.reviewId,state.reviewId]);
  toolbar.append(field('Review',select(reviews,state.reviewId,v=>run(()=>choose({reviewId:v,workSetId:null,section:'overview'})))));
  const worksets=[['','All work sets'],...arr(state.catalogWorkSets).filter(v=>!state.reviewId||v.reviewId===state.reviewId).map(v=>[v.id,v.name||v.id])];
  toolbar.append(field('Work set',select(worksets,state.workSetId,v=>run(()=>choose({workSetId:v,section:state.section==='overview'?'queue':state.section})))));
  const revision=node('div',undefined,'er-revision');revision.append(node('span','Saved revision'),node('strong',state.pinnedRevision||state.dossier.revision));
  if(state.pinnedRevision&&state.pinnedRevision!==state.dossier.revision)revision.append(node('small','Current dossier revision '+state.dossier.revision));
  toolbar.append(revision);root.append(toolbar);
  const nav=node('nav',undefined,'er-tabs');nav.setAttribute('aria-label','Eligibility sections');
  for(const [key,label] of SECTIONS){const b=button(label,()=>choose({section:key}),{css:'er-tab',disabled:state.loading});b.dataset.section=key;b.setAttribute('aria-current',key===state.section?'page':'false');nav.append(b);}
  root.append(nav);
  if(state.loading)root.append(node('p','Opening the saved '+sectionTitle().toLowerCase()+'…','er-loading'));
  const content=node('div',undefined,'er-content');
  if(state.view){if(state.section==='overview')content.append(renderOverview());else content.append(renderRows());}
  else if(!state.loading)content.append(node('p','Choose a saved review or create a review for an existing question.','er-empty'));
  root.append(content);
  const editor=node('section',undefined,'er-editor');editor.id='eligibility-editor';controls.editor=editor;root.append(editor);renderEditor();
  root.append(renderBrowserRecords());updateBusy();
 }
 function renderOverview(){
  const outer=node('div',undefined,'er-overview'),o=state.view.overview||{},stats=node('div',undefined,'er-stats');
  for(const [key,label,hint] of [
   ['reportOccurrenceCount','Retained reports','Exact source occurrences'],
   ['confirmedStudyCount','Confirmed studies','Reviewed report-to-study links'],
   ['ungroupedReportCount','Ungrouped reports','Study linkage remains open'],
   ['decisionCount','Reviewer decisions','Original and corrected decisions'],
   ['resolutionCount','Resolutions','Consensus and adjudication'],
   ['appliedOutcomeCount','Applied outcomes','Saved evidence decisions'],
   ['unresolvedImpactCount','Source changes to review','Question and source history'],
  ])stats.append(stat(label,o[key],hint));
  outer.append(stats);
  if(o.includedReportAssignments!==undefined||o.excludedReportAssignments!==undefined)outer.append(node('p',
   text(o.includedReportAssignments??0)+' included report assignments · '+text(o.excludedReportAssignments??0)+' excluded report assignments. '+(o.units?typeof o.units==='string'?o.units:JSON.stringify(o.units):'Assignments retain their work set and stage.')));
  const counts=node('div',undefined,'er-summary-grid');
  for(const stage of arr(o.stageCounts)){const box=node('article',undefined,'er-card');box.append(node('h3',stage.stageName||stage.stageId),node('p',text(stage.reports)+' report assignments'));const dl=node('dl');
   for(const [status,count] of Object.entries(stage.statusCounts||{}))dl.append(node('dt',STATUSES[status]||readable(status)),node('dd',count));box.append(dl);counts.append(box);}
  if(counts.children.length)outer.append(counts);
  if(!state.reviewId){outer.append(node('p','Choose a review to open its protocol and work sets. The Reviews section includes all saved review pages.','er-empty'));return outer;}
  const head=node('div',undefined,'er-section-heading');head.append(node('h3','Protocol editions'),button('Select reports for a work set',()=>choose({section:'occurrences',workSetId:null})));outer.append(head);
  const protocols=arr(state.view.protocols).filter(v=>v.reviewId===state.reviewId);
  for(const p of protocols){
   const d=p.definition||{},box=node('article',undefined,'er-card'),h=node('div',undefined,'er-section-heading');h.append(node('h4',d.name||p.id),tag('Edition '+p.edition));
   box.append(h,node('p',p.question?.text||''),node('code',p.id,'er-id'),node('p','Saved '+date(p.createdAt)+' by '+(p.actor?.name||p.actor?.id||'local reviewer')));
   box.append(details('Criteria, stages and reviewers',d));
   const a=node('div',undefined,'button-row');a.append(
    button('Revise protocol',()=>begin('revise-protocol',{protocol:clone(d),reason:''},{protocol:p}),{mutate:true}),
    button('Create work set for this edition',()=>begin('create-workset',{protocolId:p.id,name:'',occurrenceIds:Array.from(state.selectedOccurrences.keys()),reason:''},{protocol:p}),{mutate:true}));
   box.append(a);outer.append(box);
  }
  const worksets=arr(state.catalogWorkSets).filter(v=>v.reviewId===state.reviewId);
  if(worksets.length){outer.append(node('h3','Work sets'));for(const w of worksets){const box=node('article',undefined,'er-card');box.append(
   node('h4',w.name),node('p',arr(w.sources).length+' exact reports · source revision '+w.sourceRevision),node('code',w.id,'er-id'),node('p',w.reason||''),
   button('Open review queue',()=>choose({workSetId:w.id,section:'queue'})),details('Original work-set source bindings',w));outer.append(box);}}
  const report=node('div',undefined,'er-export-row');report.append(node('p','JSON includes the full review and its source/history bindings. CSV exports the chosen section. Complete dossier export also carries eligibility state for editable receiving.'),
   button('Download complete review JSON',()=>exportReport('json')),button('Open reports and operation history',()=>choose({section:'operations'})));
  outer.append(report);return outer;
 }
 function renderRows(){
  const wrap=node('div'),heading=node('div',undefined,'er-section-heading'),view=state.view;
  heading.append(node('h3',sectionTitle()),node('span',view.total+' saved records','er-muted'));
  const tools=node('div',undefined,'button-row');
  if(state.reviewId){tools.append(button('Review JSON',()=>exportReport('json')));if(TABLES.includes(state.section))tools.append(button('This table CSV',()=>exportReport('csv')));}
  heading.append(tools);wrap.append(heading);
  if(state.section==='occurrences'){
   wrap.append(node('p','Choose exact report occurrences across retained editions. A grouped source identifier can refer to several questions; each checkbox selects only the displayed occurrence.','er-muted'));
   const actions=node('div',undefined,'er-selection-bar');actions.append(node('strong',state.selectedOccurrences.size+' selected'),
    button('Create work set',()=>{const p=currentProtocol();need(p,'ELIGIBILITY_PROTOCOL_REQUIRED','Choose a review with a saved protocol.');return begin('create-workset',{protocolId:p.id,name:'',occurrenceIds:Array.from(state.selectedOccurrences.keys()),reason:''},{protocol:p});},{mutate:true,disabled:!state.reviewId||!state.selectedOccurrences.size}),
    button('Clear selection',async()=>{state.selectedOccurrences.clear();render();},{disabled:!state.selectedOccurrences.size}));wrap.append(actions);
  }
  if(state.section==='queue'){
   const actions=node('div',undefined,'er-selection-bar');actions.append(node('strong',state.selectedOutcomes.size+' resolved outcomes selected'),
    button('Apply selected outcomes',()=>beginApply(),{mutate:true,disabled:!state.workSetId||!state.selectedOutcomes.size}),
    button('Clear outcome selection',async()=>{state.selectedOutcomes.clear();render();},{disabled:!state.selectedOutcomes.size}));wrap.append(actions);
  }
  if(state.section==='studies')wrap.append(button('Link reports to a study',()=>begin('study-link',{name:'',occurrenceIds:[],reason:'',evidence:[]},{protocol:currentProtocol()}),{mutate:true,disabled:!state.reviewId}));
  const filters=node('div',undefined,'er-list-filters'),search=input(state.filter,v=>{state.filter=v;renderTableRows();},{max:1000,placeholder:'Filter this page by title, identifier or reviewer'});
  search.dataset.erFilter='1';filters.append(field('Filter the loaded page',search));
  if(state.section==='queue')filters.append(field('Status on this page',select([['all','All statuses'],...Object.entries(STATUSES)],state.status,v=>{state.status=v;renderTableRows();})));
  wrap.append(filters);
  const table=node('div',undefined,'er-record-list');controls.rows=table;wrap.append(table);renderTableRows();
  const pager=node('div',undefined,'er-pagination');pager.append(
   button('Previous page',()=>load({offset:Math.max(0,view.offset-view.limit)}),{disabled:view.offset===0||state.loading}),
   node('span',view.total?text(view.offset+1)+'–'+text(view.offset+arr(view.items).length)+' of '+view.total:'0 records'),
   button('Next page',()=>load({offset:view.nextOffset}),{disabled:view.nextOffset===null||view.nextOffset===undefined||state.loading}));
  wrap.append(pager,node('small','Pages are pinned to dossier revision '+view.dossier.revision+'. Refresh saved revision to read newer work.','er-muted'));
  if(state.focus)wrap.append(renderFocus(state.focus));return wrap;
 }
 function renderTableRows(){
  if(!controls.rows||!state.view)return;const query=state.filter.toLocaleLowerCase();
  const items=arr(state.view.items).filter(v=>(!query||JSON.stringify(v).toLocaleLowerCase().includes(query))&&(state.status==='all'||v.status===state.status));
  controls.rows.replaceChildren();
  if(!items.length){controls.rows.append(node('p',arr(state.view.items).length?'No loaded records match this filter.':'This saved section has no records yet.','er-empty'));return;}
  for(const row of items){
   const card=node('article',undefined,'er-record');card.dataset.recordId=rowId(row);
   const body=node('div',undefined,'er-record-main'),title=node('h4',titleOf(row));body.append(title);
   if(state.section==='reviews'){
    body.append(node('p',row.questionText||row.question?.text||row.questionId||''),node('code',row.id,'er-id'));
    card.append(body,button('Open review',()=>choose({reviewId:row.id,workSetId:null,section:'overview'})));controls.rows.append(card);continue;
   }
   if(state.section==='occurrences'){
    const checked=check('Select report',state.selectedOccurrences.has(row.occurrenceId),v=>{
     if(v)state.selectedOccurrences.set(row.occurrenceId,clone(row));else state.selectedOccurrences.delete(row.occurrenceId);render();
    });card.append(checked);
    body.append(node('p',[row.editionLabel||row.editionId,row.provider].filter(Boolean).join(' · ')),node('code',row.occurrenceId,'er-id'));
    if(row.workSetIds?.length)body.append(node('small',row.workSetIds.length+' existing work-set assignment(s)'));
   }else if(state.section==='queue'){
    body.append(node('p',[row.stageName,STATUSES[row.status]||row.status].filter(Boolean).join(' · ')),node('code',row.occurrenceId,'er-id'));
    body.append(node('small',row.remainingDecisions+' decisions remaining · '+arr(row.missingReviewerIds).join(', ')));
    if(row.resolution&&row.resolutionCurrent&&['RESOLVED_INCLUDE','RESOLVED_EXCLUDE'].includes(row.status)&&(row.resolution.disposition==='exclude'||row.stageIndex===arr(protocolFor(row.protocolId)?.definition?.stages).length-1)){
     const selected=state.selectedOutcomes.has(row.occurrenceId);
     card.append(check('Select resolved outcome',selected,v=>{if(v)state.selectedOutcomes.set(row.occurrenceId,clone(row));else state.selectedOutcomes.delete(row.occurrenceId);render();}));
    }
   }else{
    const labels=[row.actor?.name||row.actor?.id,row.disposition?readable(row.disposition):null,row.stageId,row.createdAt?date(row.createdAt):null].filter(Boolean);
    body.append(node('p',labels.join(' · ')),node('code',row.id||row.occurrenceId,'er-id'));
    if(row.active!==undefined)body.append(tag(row.active?'Active decision':'Superseded decision'));
    if(row.current!==undefined)body.append(tag(row.current?'Current resolution':'Historical resolution'));
    if(row.reason)body.append(node('p',row.reason));
   }
   const actions=node('div',undefined,'er-record-actions');
   actions.append(button('Open record',async()=>{state.focus=clone(row);render();root.querySelector('.er-focus')?.scrollIntoView({block:'nearest'});}));
   if(state.section==='queue'){
    actions.append(button('Record my decision',()=>beginDecision(row),{mutate:true,disabled:['NOT_READY','NOT_REQUIRED'].includes(row.status)}));
    actions.append(button('Resolve report',()=>beginResolution(row),{mutate:true,disabled:!arr(row.decisionIds).length||['NOT_READY','NOT_REQUIRED'].includes(row.status)}));
   }
   if(state.section==='impact')actions.append(button('Review change',()=>begin('review-impact',{impactId:row.id,workSetId:state.workSetId||undefined,reason:'',disposition:''},{impact:row,protocol:currentProtocol()}),{mutate:true}));
   if(state.section==='studies')actions.append(button('Revise study link',()=>begin('study-link',{studyId:row.id,name:row.name||'',occurrenceIds:clone(row.occurrenceIds||[]),reason:'',evidence:clone(row.evidence||[])},{study:row,protocol:currentProtocol()}),{mutate:true}));
   card.append(body,actions);controls.rows.append(card);
  }
 }
 function sourceSnapshot(row){
  const id=row.occurrenceId;return row.key!==undefined?row:state.selectedOccurrences.get(id)||arr(worksetFor(row.workSetId||state.workSetId)?.sources).find(v=>v.occurrenceId===id)||row;
 }
 function renderFocus(row){
  const box=node('section',undefined,'er-focus'),head=node('div',undefined,'er-section-heading');head.append(node('h3',titleOf(row)),button('Close record',async()=>{state.focus=null;render();}));box.append(head);
  const snap=sourceSnapshot(row),dl=node('dl',undefined,'er-facts');
  for(const [label,key] of [['Occurrence','occurrenceId'],['Retained edition','editionId'],['Question','questionId'],['Source SHA-256','sourceSha256'],['Source bytes','sourceBytes'],['Study','studyId']])if(snap[key]!==undefined)dl.append(node('dt',label),node('dd',snap[key]));
  box.append(dl);const url=href(row.url||snap.url);if(url){const a=node('a','Open source URL');a.href=url;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}
  const group=arr(state.dossier.sources).find(s=>arr(s.citations).some(c=>c.occurrenceId===snap.occurrenceId||(c.editionId===snap.editionId&&String(c.key)===String(snap.key)))),
   citation=arr(group?.citations).find(c=>c.occurrenceId===snap.occurrenceId||(c.editionId===snap.editionId&&String(c.key)===String(snap.key)));
  if(citation)renderOriginalRecordControl({root:box,citation,dossierId:state.dossier.id,revision:state.pinnedRevision,api,task,notify});
  const variant=arr(group?.variants).find(v=>v.inspection?.selection?.editionId===snap.editionId&&String(v.inspection?.selection?.key)===String(snap.key));
  if(group&&(variant||group.inspection?.selection?.occurrenceId===snap.occurrenceId)){
   const files=node('div'),excerpt=node('pre',undefined,'er-source-excerpt');box.append(files,excerpt);
   renderInspectedSource({filesRoot:files,excerpt,source:group,variant,dossierId:state.dossier.id,revision:state.pinnedRevision,api,task,notify});
  }
  if(snap.editionId&&snap.key!==undefined)box.append(button('Inspect exact retained source',async()=>{
   const value=await api(base()+'/retained-editions/'+encodeURIComponent(snap.editionId)+'/occurrences/'+encodeURIComponent(snap.key)+'?revision='+state.pinnedRevision);
   const d=details('Original retained source inspection',value);d.open=true;box.append(d);
  }));
  if(row.status)box.append(node('p',STATUSES[row.status]||row.status));
  if(row.decisions)box.append(details('Recorded independent decisions',row.decisions));
  if(row.resolution)box.append(details('Latest original resolution',row.resolution));
  box.append(details('Complete saved record',row));return box;
 }
 async function beginDecision(row){
  const p=protocolFor(row.protocolId);need(p,'ELIGIBILITY_PROTOCOL_REQUIRED','Reopen the queue’s saved protocol before recording a decision.');
  const data={workSetId:row.workSetId,occurrenceId:row.occurrenceId,stageId:row.stageId,disposition:'',
   criterionAnswers:arr(row.criterionIds).map(criterionId=>({criterionId,assessment:'',note:''})),
   basis:{availability:row.requireFullText?'':'not_required',occurrenceIds:[],locator:'',note:''},reason:''};
  await begin('decide',data,{row,protocol:p});
 }
 async function beginResolution(row){
  const p=protocolFor(row.protocolId);need(p,'ELIGIBILITY_PROTOCOL_REQUIRED','Reopen the queue’s saved protocol before resolving it.');
  await begin('resolve',{workSetId:row.workSetId,occurrenceId:row.occurrenceId,stageId:row.stageId,mode:'',disposition:'',
   decisionIds:clone(row.decisionIds),reason:''},{row,protocol:p});
 }
 async function beginApply(){
  need(state.workSetId,'ELIGIBILITY_WORKSET_REQUIRED','Select one work set before applying its reviewed outcomes.');
  const rows=Array.from(state.selectedOutcomes.values());need(rows.every(v=>v.workSetId===state.workSetId),'ELIGIBILITY_WORKSET_CHANGED','Selected outcomes must belong to the same work set.');
  await begin('apply-outcomes',{workSetId:state.workSetId,outcomes:rows.map(v=>({occurrenceId:v.occurrenceId,resolutionId:v.resolution.id})),reason:''},
   {protocol:currentProtocol(),rows});
 }
 function actorOptions(){
  const d=state.draft;if(!d)return[];
  const people=arr(d.action==='create-review'?d.data.protocol?.reviewers:d.context.actorReviewers||d.context.protocol?.definition?.reviewers);
  const allowed=['resolve','apply-outcomes'].includes(d.action)?new Set(arr(d.context.protocol?.definition?.resolverIds)):d.action==='decide'?new Set(arr(d.context.row?.reviewerIds)):null;
  return people.filter(v=>v.id&&v.name&&(!allowed||allowed.has(v.id)));
 }
 function refreshActorOptions(){
  const d=state.draft,e=controls.actorSelect;if(!d||!e)return;
  const people=actorOptions();e.replaceChildren(option('','Choose local reviewer'),...people.map(v=>option(v.id,v.name+' · '+v.id)));e.value=d.actor.id;
  const actual=people.find(v=>v.id===d.actor.id);if(actual&&actual.name!==d.actor.name)touch(v=>{v.actor=clone(actual);});
 }
 function actorControl(){
  const d=state.draft,people=actorOptions(),e=select([['','Choose local reviewer'],...people.map(v=>[v.id,v.name+' · '+v.id])],d.actor.id,v=>{
   const person=actorOptions().find(p=>p.id===v);touch(x=>{x.actor=person?clone(person):{id:'',name:''};});renderEditor();
  },{required:true});controls.actorSelect=e;
  const box=field(d.action==='resolve'?'Resolver named in protocol':'Local reviewer',e,'Reviewer labels record who made this decision in the local workflow.');
  if(!people.length)box.append(node('small',d.action==='create-review'?'Complete the protocol reviewer names below.':'This protocol has no eligible named actor for this action. Review its registered reviewers and resolvers.'));
  return box;
 }


 function renderEditor(){
  const host=controls.editor;if(!host)return;host.replaceChildren();controls.draftStatus=null;controls.actorSelect=null;
  const d=state.draft;if(!d)return;
  const header=node('div',undefined,'er-section-heading');header.append(node('h3',readable(d.action)),tag('Draft · revision '+d.baseRevision));
  const actions=node('div',undefined,'button-row');actions.append(
   button('Download draft',async()=>download(JSON.stringify(d,null,2)+'\n','eligibility-draft-'+d.id+'.json')),
   button('Close editor',async()=>{await persistDraft();state.draft=null;await browserRecords();render();}));
  header.append(actions);host.append(header);
  const status=node('p','','er-muted');controls.draftStatus=status;host.append(status);updateDraftStatus();
  if(d.reviewId&&d.reviewId!==state.reviewId)host.append(node('p','This open draft belongs to review '+d.reviewId+'. Its original review selection is retained.','er-notice'));
  if(d.baseRevision!==state.dossier.revision||state.pinnedRevision!==null&&d.baseRevision!==state.pinnedRevision){
   const box=node('div',undefined,'er-notice');box.append(node('p','The draft is based on revision '+d.baseRevision+'. The current dossier is revision '+state.dossier.revision+'.'),
    button('Refresh and rebase this draft',rebase,{disabled:unresolved()}));host.append(box);
  }
  if(unresolved())host.append(node('p','An original request is awaiting a definite outcome. Recover it in Browser drafts and requests before starting another save.','er-notice'));
  const form=node('form',undefined,'er-operation-form');form.id='eligibility-operation-form';form.append(actorControl());
  if(d.action==='create-review'){
   const questions=arr(state.dossier.questions);
   form.append(field('Dossier question',select([['','Choose an existing question'],...questions.map(v=>[v.id,v.text])],d.data.questionId,v=>touch(x=>{x.data.questionId=v;}),{required:true})),
    field('Review name',input(d.data.name,v=>touch(x=>{x.data.name=v;}),{max:240,required:true})),
    field('Review description',input(d.data.description,v=>touch(x=>{x.data.description=v;}),{rows:3,max:20000})));
   form.append(protocolEditor());
  }else if(d.action==='revise-protocol'){
   form.append(node('p','This saves a new protocol edition with the current question wording. Earlier work sets remain bound to their original edition.','er-muted'),details('Previous protocol edition',d.context.protocol),protocolEditor());
  }else if(d.action==='create-workset')form.append(worksetEditor());
  else if(d.action==='decide')form.append(decisionEditor());
  else if(d.action==='resolve')form.append(resolutionEditor());
  else if(d.action==='study-link')form.append(studyEditor());
  else if(d.action==='apply-outcomes')form.append(applicationEditor());
  else if(d.action==='review-impact')form.append(impactEditor());
  if(d.action!=='create-review')form.append(field('Reason and review rationale',input(d.data.reason,v=>touch(x=>{x.data.reason=v;}),{rows:4,max:20000,required:true})));
  const preview=node('details',undefined,'er-original');preview.append(node('summary','Review operation input'));
  preview.addEventListener('toggle',()=>{if(preview.open){preview.querySelector('pre')?.remove();preview.append(node('pre',JSON.stringify({dossierId:d.dossierId,expectedRevision:d.baseRevision,actor:d.actor,action:d.action,...(d.reviewId?{reviewId:d.reviewId}:{}),data:d.data},null,2)));}});
  form.append(preview,node('p','The original request ID and complete input are retained in this browser before the save is sent. The saved dossier operation remains available in exports and receiving copies.','er-muted'));
  const footer=node('div',undefined,'er-editor-footer'),submit=node('button','Save reviewed operation','primary');submit.type='submit';submit.dataset.erButton='1';submit.dataset.erMutate='1';submit.dataset.erDisabled=unresolved()?'1':'0';
  footer.append(submit);form.append(footer);form.addEventListener('submit',e=>{e.preventDefault();if(form.reportValidity())run(()=>saveDraft(form));});
  host.append(form);updateBusy();
 }
 function protocolEditor(){
  const d=state.draft,p=d.data.protocol,box=node('section',undefined,'er-protocol-editor');
  box.append(node('h4','Criterion protocol'),field('Protocol name',input(p.name,v=>touch(x=>{x.data.protocol.name=v;}),{max:240,required:true})));
  const section=(title,description)=>{const x=node('section',undefined,'er-protocol-section');x.append(node('h5',title),node('p',description,'er-muted'));box.append(x);return x;};
  const criteria=section('Eligibility criteria','Record the inclusion and exclusion wording used by reviewers.');
  p.criteria.forEach((v,i)=>{
   const row=node('fieldset',undefined,'er-edit-row');row.append(node('legend','Criterion '+(i+1)));
   row.append(field('Criterion ID',input(v.id,n=>touch(x=>{x.data.protocol.criteria[i].id=n;}),{max:100,required:true})),
    field('Name',input(v.name,n=>touch(x=>{x.data.protocol.criteria[i].name=n;}),{max:240,required:true})),
    field('Include when',input(v.include,n=>touch(x=>{x.data.protocol.criteria[i].include=n;}),{rows:3,max:20000,required:true})),
    field('Exclude when',input(v.exclude,n=>touch(x=>{x.data.protocol.criteria[i].exclude=n;}),{rows:3,max:20000,required:true})),
    button('Remove criterion',async()=>{touch(x=>{x.data.protocol.criteria.splice(i,1);});renderEditor();},{disabled:p.criteria.length<=1}));
   criteria.append(row);
  });
  criteria.append(button('Add criterion',async()=>{touch(x=>{x.data.protocol.criteria.push({id:'criterion_'+uid('').slice(0,8),name:'',include:'',exclude:''});});renderEditor();}));
  const reviewers=section('Named reviewers','These are the local workflow identities recorded with each decision.');
  p.reviewers.forEach((v,i)=>{
   const row=node('div',undefined,'er-edit-grid'),id=input(v.id,n=>touch(x=>{x.data.protocol.reviewers[i].id=n;}),{max:100,required:true}),
    name=input(v.name,n=>touch(x=>{x.data.protocol.reviewers[i].name=n;}),{max:200,required:true});
   id.addEventListener('change',refreshActorOptions);name.addEventListener('change',refreshActorOptions);
   row.append(field('Reviewer ID',id),field('Reviewer name',name),button('Remove reviewer',async()=>{touch(x=>{x.data.protocol.reviewers.splice(i,1);});renderEditor();},{disabled:p.reviewers.length<=1}));reviewers.append(row);
  });
  reviewers.append(button('Add reviewer',async()=>{touch(x=>{x.data.protocol.reviewers.push({id:'reviewer_'+uid('').slice(0,8),name:''});});renderEditor();}));
  const stages=section('Ordered stages','Each stage uses saved criteria and named reviewers. Later stages open after a current include resolution in the preceding stage.');
  p.stages.forEach((v,i)=>{
   const row=node('fieldset',undefined,'er-edit-row');row.append(node('legend','Stage '+(i+1)));
   const minimum=input(v.minimumDecisions,n=>touch(x=>{x.data.protocol.stages[i].minimumDecisions=n===''?0:Number(n);} ),{type:'number',required:true});minimum.min='1';minimum.step='1';
   row.append(field('Stage ID',input(v.id,n=>touch(x=>{x.data.protocol.stages[i].id=n;}),{max:100,required:true})),
    field('Stage name',input(v.name,n=>touch(x=>{x.data.protocol.stages[i].name=n;}),{max:240,required:true})),
    field('Criterion IDs',input(v.criterionIds.join('\n'),n=>touch(x=>{x.data.protocol.stages[i].criterionIds=ids(n);}),{rows:2,required:true}),'One or more of the criterion IDs above.'),
    field('Eligible reviewer IDs',input(v.reviewerIds.join('\n'),n=>touch(x=>{x.data.protocol.stages[i].reviewerIds=ids(n);}),{rows:2,required:true})),
    field('Minimum distinct decisions',minimum),
    check('Require an available retained full-text basis for include/exclude',v.requireFullText,n=>touch(x=>{x.data.protocol.stages[i].requireFullText=n;})));
   const move=node('div',undefined,'button-row');
   move.append(button('Move earlier',async()=>{touch(x=>{[x.data.protocol.stages[i-1],x.data.protocol.stages[i]]=[x.data.protocol.stages[i],x.data.protocol.stages[i-1]];});renderEditor();},{disabled:i===0}),
    button('Move later',async()=>{touch(x=>{[x.data.protocol.stages[i+1],x.data.protocol.stages[i]]=[x.data.protocol.stages[i],x.data.protocol.stages[i+1]];});renderEditor();},{disabled:i===p.stages.length-1}),
    button('Remove stage',async()=>{touch(x=>{x.data.protocol.stages.splice(i,1);});renderEditor();},{disabled:p.stages.length<=1}));
   row.append(move);stages.append(row);
  });
  stages.append(button('Add stage',async()=>{touch(x=>{x.data.protocol.stages.push({id:'stage_'+uid('').slice(0,8),name:'',criterionIds:[],reviewerIds:[],minimumDecisions:1,requireFullText:false});});renderEditor();}));
  const reasons=section('Exclusion catalogue','A decisive exclusion records one of these explicit reasons.');
  p.exclusionReasons.forEach((v,i)=>{
   const row=node('div',undefined,'er-edit-grid');row.append(
    field('Reason ID',input(v.id,n=>touch(x=>{x.data.protocol.exclusionReasons[i].id=n;}),{max:100,required:true})),
    field('Reason label',input(v.label,n=>touch(x=>{x.data.protocol.exclusionReasons[i].label=n;}),{max:1000,required:true})),
    button('Remove reason',async()=>{touch(x=>{x.data.protocol.exclusionReasons.splice(i,1);});renderEditor();},{disabled:p.exclusionReasons.length<=1}));reasons.append(row);
  });
  reasons.append(button('Add exclusion reason',async()=>{touch(x=>{x.data.protocol.exclusionReasons.push({id:'reason_'+uid('').slice(0,8),label:''});});renderEditor();}));
  box.append(field('Resolver IDs',input(p.resolverIds.join('\n'),v=>touch(x=>{x.data.protocol.resolverIds=ids(v);}),{rows:2,required:true}),'Choose IDs from the named reviewers.'),
   field('Disagreement and unavailable-information procedure',input(p.disagreementProcedure,v=>touch(x=>{x.data.protocol.disagreementProcedure=v;}),{rows:4,max:20000,required:true})));
  return box;
 }
 function worksetEditor(){
  const d=state.draft,box=node('section'),protocols=arr(state.view?.protocols).filter(v=>v.reviewId===d.reviewId);
  if(d.context.protocol&&!protocols.some(v=>v.id===d.context.protocol.id))protocols.push(d.context.protocol);
  box.append(field('Saved protocol edition',select(protocols.map(v=>[v.id,(v.definition?.name||v.id)+' · edition '+v.edition]),d.data.protocolId,v=>{
   const p=protocols.find(x=>x.id===v);touch(x=>{x.data.protocolId=v;x.context.protocol=clone(p);x.context.actorReviewers=clone(p.definition.reviewers);x.actor={id:'',name:''};});renderEditor();
  },{required:true})),
   field('Work-set name',input(d.data.name,v=>touch(x=>{x.data.name=v;}),{max:240,required:true})),
   field('Exact report occurrence IDs',input(arr(d.data.occurrenceIds).join('\n'),v=>touch(x=>{x.data.occurrenceIds=ids(v);}),{rows:8,required:true}),'One retained occurrence ID per line. Every ID remains bound to this review’s question and its original source edition.'));
  const actions=node('div',undefined,'button-row');actions.append(
   button('Use '+state.selectedOccurrences.size+' selected reports',async()=>{touch(x=>{x.data.occurrenceIds=Array.from(state.selectedOccurrences.keys());});renderEditor();},{disabled:!state.selectedOccurrences.size}),
   button('Browse retained reports',()=>choose({reviewId:d.reviewId,workSetId:null,section:'occurrences'})));
  box.append(actions,node('p',arr(d.data.occurrenceIds).length+' report occurrences in this draft.','er-muted'));
  const selection=node('details');selection.append(node('summary','Selected original report identities'));
  selection.append(node('pre',JSON.stringify(arr(d.data.occurrenceIds).map(id=>state.selectedOccurrences.get(id)||{occurrenceId:id}),null,2)));box.append(selection);
  return box;
 }
 function selectedReason(value,onChange,required){
  return field('Protocol exclusion reason',select([['','Choose a reason'],...arr(state.draft.context.protocol?.definition?.exclusionReasons).map(v=>[v.id,v.label])],value,onChange,{required}));
 }
 function decisionEditor(){
  const d=state.draft,row=d.context.row,p=d.context.protocol.definition,box=node('section'),own=arr(row.decisions).find(v=>v.actor?.id===d.actor.id);
  box.append(node('h4',row.title||row.occurrenceId),node('p',row.stageName+' · '+(STATUSES[row.status]||row.status)),node('code',row.occurrenceId,'er-id'),
   node('p','Protocol '+row.protocolId+' · work set '+row.workSetId,'er-muted'));
  if(own){
   const mine=node('div',undefined,'er-own-decision');mine.append(node('h5','Your recorded decision'),node('p',readable(own.disposition)+' · '+date(own.createdAt)),
    details('Your original assessment and basis',own),
    button('Use my recorded values for a correction',async()=>{
     touch(x=>{x.data.disposition=own.disposition;x.data.criterionAnswers=arr(row.criterionIds).map(criterionId=>clone(arr(own.criterionAnswers).find(v=>v.criterionId===criterionId)||{criterionId,assessment:'',note:''}));
      x.data.basis=clone(own.basis);if(own.exclusionReasonId)x.data.exclusionReasonId=own.exclusionReasonId;else delete x.data.exclusionReasonId;x.data.supersedes=own.id;x.data.reason='';});renderEditor();
    }));
   mine.append(check('Record an explicit correction to '+own.id,d.data.supersedes===own.id,v=>touch(x=>{if(v)x.data.supersedes=own.id;else delete x.data.supersedes;})));box.append(mine);
  }
  if(d.data.supersedes)box.append(node('p','This correction preserves previous decision '+d.data.supersedes+'.','er-notice'));
  box.append(field('Reviewer disposition',select([['','Choose disposition'],['include','Include'],['exclude','Exclude'],['uncertain','Uncertain — further review needed'],['unavailable','Unavailable source']],d.data.disposition,v=>{
   touch(x=>{x.data.disposition=v;if(v!=='exclude')delete x.data.exclusionReasonId;});renderEditor();
  },{required:true})));
  if(d.data.disposition==='exclude')box.append(selectedReason(d.data.exclusionReasonId,v=>touch(x=>{x.data.exclusionReasonId=v;}),true));
  box.append(node('h5','Criterion assessments'));
  if(['uncertain','unavailable'].includes(d.data.disposition))box.append(node('p','Record the assessments you can make. Unassessed criteria remain open in this nondecisive review.','er-muted'));
  d.data.criterionAnswers.forEach((answer,i)=>{
   const criterion=arr(p.criteria).find(v=>v.id===answer.criterionId),part=node('fieldset',undefined,'er-edit-row');
   part.append(node('legend',criterion?.name||answer.criterionId),node('p','Include: '+(criterion?.include||'')),node('p','Exclude: '+(criterion?.exclude||'')),
    field('Assessment',select(ASSESSMENTS,answer.assessment,v=>touch(x=>{x.data.criterionAnswers[i].assessment=v;}),{required:['include','exclude'].includes(d.data.disposition)})),
    field('Criterion note',input(answer.note,v=>touch(x=>{x.data.criterionAnswers[i].note=v;}),{rows:2,max:20000})));box.append(part);
  });
  box.append(node('h5','Retained source basis'),field('Availability',select([['','Choose availability'],['available','Available retained evidence'],['unavailable','Source unavailable'],['not_required','Full text not required for this stage']],d.data.basis.availability,v=>touch(x=>{x.data.basis.availability=v;}),{required:true})),
   field('Basis occurrence IDs',input(arr(d.data.basis.occurrenceIds).join('\n'),v=>touch(x=>{x.data.basis.occurrenceIds=ids(v);}),{rows:3}),'Use the exact retained report or associated document occurrence IDs for this question.'),
   button('Use this report as the basis occurrence',async()=>{touch(x=>{x.data.basis.occurrenceIds=[row.occurrenceId];});renderEditor();}),
   field('Source locator',input(d.data.basis.locator,v=>touch(x=>{x.data.basis.locator=v;}),{rows:2,max:4000}),'For example the actual page, section, table or source passage used for the assessment.'),
   field('Source-basis note',input(d.data.basis.note,v=>touch(x=>{x.data.basis.note=v;}),{rows:3,max:20000})));
  if(row.requireFullText)box.append(node('p','This saved stage requires available retained full-text evidence for an include or exclude decision.','er-notice'));
  const others=arr(row.decisions).filter(v=>v.actor?.id!==d.actor.id);if(others.length)box.append(details('Other recorded reviewers — '+others.length,others));
  box.append(button('Open report and retained source',async()=>{state.focus=clone(row);render();root.querySelector('.er-focus')?.scrollIntoView({block:'nearest'});}));
  return box;
 }
 function resolutionEditor(){
  const d=state.draft,row=d.context.row,box=node('section');
  box.append(node('h4',row.title||row.occurrenceId),node('p',row.stageName+' · '+(STATUSES[row.status]||row.status)),node('code',row.occurrenceId,'er-id'),
   node('p','A resolution binds the complete current set of independent decisions. The saved protocol determines its required reviewer count.','er-muted'));
  for(const decision of arr(row.decisions)){
   const card=node('article',undefined,'er-card');card.append(check((decision.actor?.name||decision.actor?.id)+' · '+readable(decision.disposition),d.data.decisionIds.includes(decision.id),v=>{
    touch(x=>{x.data.decisionIds=v?[...x.data.decisionIds.filter(id=>id!==decision.id),decision.id]:x.data.decisionIds.filter(id=>id!==decision.id);});
   }),node('code',decision.id,'er-id'),node('p',decision.reason),details('Criterion answers and source basis',decision));box.append(card);
  }
  box.append(field('Resolution method',select([['','Choose method'],['consensus','Consensus of the current decisions'],['adjudication','Adjudication under the saved procedure']],d.data.mode,v=>touch(x=>{x.data.mode=v;}),{required:true})),
   field('Resolution outcome',select([['','Choose outcome'],['include','Include'],['exclude','Exclude'],['awaiting_information','Awaiting information']],d.data.disposition,v=>{
    touch(x=>{x.data.disposition=v;if(v!=='exclude')delete x.data.exclusionReasonId;});renderEditor();
   },{required:true})));
  if(d.data.disposition==='exclude')box.append(selectedReason(d.data.exclusionReasonId,v=>touch(x=>{x.data.exclusionReasonId=v;}),true));
  if(row.resolution)box.append(details('Previous resolution retained in history',row.resolution));
  box.append(details('Saved disagreement procedure',d.context.protocol.definition.disagreementProcedure));return box;
 }
 function studyEditor(){
  const d=state.draft,box=node('section');
  if(d.data.studyId)box.append(node('p','Correcting study '+d.data.studyId+'. Earlier versions remain in the review history.','er-notice'));
  box.append(field('Study name',input(d.data.name,v=>touch(x=>{x.data.name=v;}),{max:240,required:true})),
   field('Report occurrence IDs',input(arr(d.data.occurrenceIds).join('\n'),v=>touch(x=>{x.data.occurrenceIds=ids(v);}),{rows:5,required:true}),'Select report identities deliberately. Matching titles or DOIs do not automatically establish a study.'),
   button('Use selected retained reports',async()=>{touch(x=>{x.data.occurrenceIds=Array.from(state.selectedOccurrences.keys());});renderEditor();},{disabled:!state.selectedOccurrences.size}));
  box.append(node('h5','Evidence for each report link'),node('p','Retain a locator and note for every selected report. A report can belong to one current study group within this review.','er-muted'));
  d.data.evidence.forEach((v,i)=>{
   const row=node('fieldset',undefined,'er-edit-row');row.append(node('legend','Link evidence '+(i+1)),
    field('Report occurrence ID',select([['','Choose a selected report'],...d.data.occurrenceIds.map(id=>[id,id])],v.occurrenceId,n=>touch(x=>{x.data.evidence[i].occurrenceId=n;}),{required:true})),
    field('Original source locator',input(v.locator,n=>touch(x=>{x.data.evidence[i].locator=n;}),{rows:2,max:4000,required:true})),
    field('Relationship evidence',input(v.note,n=>touch(x=>{x.data.evidence[i].note=n;}),{rows:3,max:20000,required:true})),
    button('Remove link evidence',async()=>{touch(x=>{x.data.evidence.splice(i,1);});renderEditor();}));box.append(row);
  });
  box.append(button('Add evidence for a report',async()=>{touch(x=>{x.data.evidence.push({occurrenceId:'',locator:'',note:''});});renderEditor();}));
  if(d.context.study)box.append(details('Previous complete study link',d.context.study));return box;
 }
 function applicationEditor(){
  const d=state.draft,box=node('section');
  box.append(node('h4','Apply resolved reports to the original dossier'),node('p','Each selected report keeps its exact resolution. Eligibility controls selection; supports, contradicts and background remain separate evidence judgments.','er-muted'));
  d.data.outcomes.forEach((v,i)=>{
   const original=arr(d.context.rows).find(r=>r.occurrenceId===v.occurrenceId),row=node('fieldset',undefined,'er-edit-row');row.append(node('legend',original?.title||v.occurrenceId),
    node('p',readable(original?.resolution?.disposition)+' · '+(original?.stageName||'')),node('code',v.occurrenceId,'er-id'),node('code',v.resolutionId,'er-id'));
   const changeClassification=Object.hasOwn(v,'classification'),changeNote=Object.hasOwn(v,'note');
   row.append(check('Set evidence classification',changeClassification,n=>{touch(x=>{if(n)x.data.outcomes[i].classification=original?.classification||'unreviewed';else delete x.data.outcomes[i].classification;});renderEditor();}));
   if(changeClassification)row.append(field('Evidence classification',select(CLASSIFICATIONS,v.classification,n=>touch(x=>{x.data.outcomes[i].classification=n;}))));
   row.append(check('Replace evidence note',changeNote,n=>{touch(x=>{if(n)x.data.outcomes[i].note='';else delete x.data.outcomes[i].note;});renderEditor();}));
   if(changeNote)row.append(field('Evidence note',input(v.note,n=>touch(x=>{x.data.outcomes[i].note=n;}),{rows:3,max:100000})));
   row.append(button('Remove outcome from this draft',async()=>{touch(x=>{x.data.outcomes.splice(i,1);});renderEditor();}));box.append(row);
  });
  return box;
 }
 function impactEditor(){
  const d=state.draft,box=node('section'),impact=d.context.impact;
  box.append(node('h4',impact?.title||readable(impact?.kind)||'Source or protocol change'),details('Exact observed source/protocol impact',impact),
   field('Review disposition',select([['','Choose disposition'],['reviewed','Reviewed'],['needs_review','Further review needed'],['out_of_scope','Outside this review’s scope']],d.data.disposition,v=>touch(x=>{x.data.disposition=v;}),{required:true})),
   field('Receiving work set, when applicable',select([['','No work set selected'],...arr(state.catalogWorkSets).filter(v=>v.reviewId===d.reviewId).map(v=>[v.id,v.name])],d.data.workSetId,v=>touch(x=>{if(v)x.data.workSetId=v;else delete x.data.workSetId;}))),
   node('p','This records a review of the specific impact. Use the original work-set, decision, resolution and apply-outcomes commands for the resulting changes.','er-muted'));
  return box;
 }
 function renderBrowserRecords(){
  const box=node('details',undefined,'er-browser-records'),pending=state.pending.filter(v=>v.state!=='COMPLETE'&&v.state!=='REJECTED');
  box.open=pending.length>0||!!state.storageError;box.append(node('summary','Browser drafts and requests · '+state.drafts.length+' drafts · '+pending.length+' awaiting outcome'));
  if(state.storageError)box.append(node('p',state.storageError,'er-notice'));
  const importControl=node('input');importControl.type='file';importControl.accept='.json,application/json';importControl.dataset.erEdit='1';
  importControl.addEventListener('change',()=>{const f=importControl.files[0];if(f)run(()=>importRequest(f));});
  box.append(field('Import a complete original request JSON',importControl,'The original request ID, expected revision and actor are preserved. Submit it explicitly after reviewing the retained input.'));
  const failed=Array.from(unsaved.values()).filter(v=>v.dossierId===state.dossier.id);
  if(failed.length){box.append(node('h4','Open edits awaiting browser storage'));for(const d of failed)box.append(button('Download unsaved '+readable(d.action),async()=>download(JSON.stringify(d,null,2)+'\n','eligibility-unsaved-'+d.id+'.json')));}
  if(state.drafts.length)box.append(node('h4','Retained drafts'));
  for(const d of state.drafts){
   const row=node('article',undefined,'er-browser-row');row.append(node('strong',readable(d.action)),node('span','Revision '+d.baseRevision+' · '+date(d.updatedAt)),
    button('Reopen draft',()=>reopenDraft(d)),button('Download draft',async()=>download(JSON.stringify(d,null,2)+'\n','eligibility-draft-'+d.id+'.json')),
    button('Remove this saved draft',async()=>{
     need(state.draft?.id!==d.id,'ELIGIBILITY_DRAFT_OPEN','Close the open editor before removing its saved draft.');
     await(await cache()).removeDraft(d.id,d);await browserRecords();render();
    }));
   box.append(row);
  }
  if(state.pending.length)box.append(node('h4','Original save requests'));
  for(const entry of state.pending){
   const row=node('article',undefined,'er-browser-row');row.append(node('strong',readable(entry.payload.action)),tag(readable(entry.state)),
    node('code',entry.id,'er-id'),node('span','Expected revision '+entry.payload.expectedRevision+' · '+date(entry.createdAt)));
   if(entry.error)row.append(node('p',entry.error.message,'er-notice'));
   row.append(button('Download original request',async()=>download(JSON.stringify({schema:entry.schema,dossierId:entry.dossierId,payload:entry.payload},null,2)+'\n','eligibility-request-'+entry.id+'.json')),
    details('Exact original request input',entry.payload));
   if(['READY','SENDING','UNCERTAIN'].includes(entry.state))row.append(button(entry.state==='READY'?'Submit original request':'Recover original request',()=>sendOriginal(entry),{mutate:true}));
   if(entry.reply)row.append(details('Original saved operation receipt',entry.reply));
   if(entry.state==='REJECTED'&&entry.draft)row.append(button('Reopen rejected draft',()=>reopenDraft(entry.draft)));
   box.append(row);
  }
  return box;
 }
 return {
  setDossier(value){
   const changed=state.dossier?.id!==value?.id,revisionChanged=state.dossier?.revision!==value?.revision;
   if(changed){
    state.loadId++;state.sourceId++;state.view=null;state.catalogKey=null;state.catalogWorkSets=[];state.reviews.clear();state.reviewsRevision=null;state.focus=null;state.draft=null;state.drafts=[];state.pending=[];
    state.selectedOccurrences.clear();state.selectedOutcomes.clear();state.pinnedRevision=null;state.offset=0;
    if(state.dossier||initial.get('dossier')!==value?.id){state.reviewId=null;state.workSetId=null;state.section='overview';}
   }
   state.dossier=value;
   if(revisionChanged&&value){state.pinnedRevision=value.revision;state.offset=0;state.reviewsRevision=null;}
   if(changed||revisionChanged){render();if(state.visible&&value&&!state.accepting)load({offset:0});}
  },
  show(visible){const opening=visible&&!state.visible;state.visible=visible;if(opening){render();if(state.dossier)load({offset:state.offset});}},
  updateBusy,
  hasUnsaved(){return unsaved.size>0||!!state.storageError&&!!state.draft||state.pending.some(v=>['READY','SENDING','UNCERTAIN'].includes(v.state));},
  close(){state.loadId++;state.cache?.close();}
 };
}
