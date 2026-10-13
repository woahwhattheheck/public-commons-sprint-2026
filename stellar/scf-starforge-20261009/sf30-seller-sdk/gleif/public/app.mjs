// SPDX-License-Identifier: MIT
import { escapeHtml as e, plan, COMPANY_FACT_LABELS, sourceFact, sourceReferenceDetails } from '/core.mjs';
import { mountMonitoring } from '/monitoring.mjs';
const $=id=>document.getElementById(id),forms=['capture-form','review-form','batch-form','report-form','compare-form','query-form'];
let token=new URLSearchParams(location.hash.slice(1)).get('token')??sessionStorage.getItem('gleif-token')??'';
if(token){sessionStorage.setItem('gleif-token',token);history.replaceState(null,'',location.pathname);}
let state,workspaceId,instanceId,selectedCapture=null,offset=0,rows=null,detail=null,selected=new Map(),pending=null,polling=false,db,rowsRequest=0,detailBinding=null;
const notice=(text,error=false)=>{$('notice').textContent=text;$('notice').setAttribute('role',error?'alert':'status');};
async function api(path,{method='GET',body,raw=false}={}) {
  const response=await fetch(path,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(instanceId&&response.headers.get('x-gleif-instance')!==instanceId)throw new Error('The original application instance changed. Reopen its current private URL.');
  if(!response.ok){let v;try{v=await response.json();}catch{}throw Object.assign(new Error(v?.message??'Request failed: '+response.status),{code:v?.error,status:response.status});}
  return raw?response.arrayBuffer():response.json();
}

const reviewFields=['decision','reviewer','rationale','useCase','nextWork'];
const actionNames={'capture':'Capture source','capture.resume':'Continue source pages','source.import':'Receive original responses','review.save':'Save company review','review.batch':'Review selected companies','report.prepare':'Prepare customer files','dataset.prepare':'Prepare native dataset','monitoring.prepare':'Prepare Monitoring handover'};
const actionName=value=>actionNames[value]??value;
const stateName=value=>({COMPLETE:'Complete',INTERRUPTED:'Ready to continue',PENDING:'Saved',RUNNING:'Running',FETCHING:'Capturing source',SOURCE_REVIEW:'Source review needed'}[value]??value);
function observedTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date)+' UTC':'Time unavailable';}
function captureTime(capture){return observedTime(capture.pages.at(-1)?.observedAt??capture.createdAt);}
function currentReview(lei){return state?.reviews.find(value=>value.lei===lei)??null;}
function reviewSnapshot(item){const current=currentReview(item.row.lei);return {id:current?.id??'lei-'+item.row.lei,title:item.row.legalName,captureId:item.row.captureId,lei:item.row.lei,expectedVersion:current?.version??0};}
function changedReview(binding){const current=currentReview(binding.lei);return (current?.version??0)!==binding.expectedVersion||(current&&current.id!==binding.id);}
function reviewDraftSlot(binding){return workspaceId+'/review-edition/'+binding.captureId+'/'+binding.lei;}
function formValues(form){return Object.fromEntries(new FormData(form));}
function fillReviewFields(form,values={}){for(const name of reviewFields)form.elements[name].value=values[name]??(name==='decision'?'research':'');}
function retainReviewDraft(){if(!detailBinding)return;localStorage.setItem(reviewDraftSlot(detailBinding),JSON.stringify({schema:'gleif.review-editor.v1',binding:detailBinding,fields:formValues($('review-form'))}));}
function previousDraft(){if(!detailBinding)return;const slot=reviewDraftSlot(detailBinding),value=localStorage.getItem(slot);if(value)localStorage.setItem(slot+'/previous',value);}
function savedReviewDescription(review){if(!review)return '<p>No company review is saved yet.</p>';const labels={decision:'Decision',reviewer:'Reviewer',rationale:'Research rationale',useCase:'Customer use case',nextWork:'Next research work'};return '<dl>'+reviewFields.map(name=>'<dt><strong>'+e(labels[name])+'</strong></dt><dd>'+e(review[name]||'—')+'</dd>').join('')+'</dl>';}
function renderEditingContexts(){
  const panel=$('review-context');
  if(detail&&detailBinding){
    const capture=state.captures.find(c=>c.id===detailBinding.captureId),current=currentReview(detailBinding.lei),changed=changedReview(detailBinding);
    let legacy;try{legacy=JSON.parse(localStorage.getItem(workspaceId+'/review/'+detailBinding.lei)??'null');}catch{}
    panel.innerHTML='<p class="hint">Selected source: '+e(capture?.plan.query??detail.row.legalName)+' · '+e(capture?captureTime(capture):'')+'. '+(detailBinding.expectedVersion?'Editing saved review revision '+detailBinding.expectedVersion+'.':'New company review.')+'</p>'+
      (changed?'<div role="alert"><p><strong>The saved company review has changed.</strong> Your edits still refer to revision '+detailBinding.expectedVersion+'. The current saved revision is '+(current?.version??0)+'. Compare its contents below before continuing.</p>'+savedReviewDescription(current)+'<div class="toolbar"><button type="button" data-review-edit="reload">Load the saved review</button><button type="button" data-review-edit="rebase">Keep my edits with this revision</button></div></div>':'')+
      (legacy&&typeof legacy==='object'&&!Array.isArray(legacy)?'<p><button type="button" data-review-edit="legacy">Restore earlier browser draft</button></p>':'');
  }else panel.innerHTML='';
  const changed=[...selected.values()].filter(item=>changedReview(item.reviewBinding));
  $('batch-context').innerHTML=changed.length?'<div role="alert"><p><strong>'+changed.length+' selected company '+(changed.length===1?'review has':'reviews have')+' changed.</strong> The batch still carries the versions you selected. Review their current saved contents before applying your batch edits.</p>'+changed.map(item=>'<details><summary>'+e(item.row.legalName)+' · selected revision '+item.reviewBinding.expectedVersion+' · saved revision '+(currentReview(item.row.lei)?.version??0)+'</summary>'+savedReviewDescription(currentReview(item.row.lei))+'</details>').join('')+'<button type="button" data-batch-edit="rebase">Keep batch edits with these revisions</button></div>':'';
}
async function releaseEditedRequest(kind){
  const original=pending;if(!original)return;
  await refresh({loadRows:false});if(state.active)throw new Error('Finish or pause the running project operation first.');
  if(pending?.id!==original.id)return;
  const same=kind==='single'?original.action==='review.save'&&original.input.lei===detailBinding?.lei&&original.input.captureId===detailBinding?.captureId:
    original.action==='review.batch'&&Array.isArray(original.input.items)&&original.input.items.length===selected.size&&original.input.items.every(input=>selected.get(input.lei)?.reviewBinding.captureId===input.captureId);
  if(!same)return;
  await stored('put',original,'request/'+original.id);await clearPendingRequest(original);renderPending();await renderRequestHistory();
}
async function finishRequest(result){
  const original=pending;if(!original||result.id!==original.id||result.state!=='COMPLETE')return;
  const reviews=original.action==='review.save'?[result.result]:original.action==='review.batch'?result.result:[];
  for(const review of reviews??[]){
    if(!review)continue;
    const input=original.action==='review.save'?original.input:original.input.items.find(value=>value.lei===review.lei&&value.captureId===review.captureId);
    if(detailBinding&&input&&detailBinding.id===review.id&&detailBinding.captureId===review.captureId&&detailBinding.expectedVersion===input.expectedVersion){detailBinding={...detailBinding,expectedVersion:review.version};retainReviewDraft();}
    const item=selected.get(review.lei);
    if(item&&input&&item.reviewBinding.id===review.id&&item.reviewBinding.captureId===review.captureId&&item.reviewBinding.expectedVersion===input.expectedVersion)item.reviewBinding={...item.reviewBinding,expectedVersion:review.version};
  }
  await clearPendingRequest(original);renderPending();renderEditingContexts();notice('Completed: '+actionName(original.action)+'.');
}
$('review-form').querySelector('h3').insertAdjacentHTML('afterend','<div id="review-context"></div>');
$('batch-form').insertAdjacentHTML('afterbegin','<div id="batch-context"></div>');

async function database() {return new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-forge-gleif',1);request.onupgradeneeded=()=>request.result.createObjectStore('work');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function stored(mode,value,slot='pending') {
  return new Promise((resolve,reject)=>{const tx=db.transaction('work',mode==='get'?'readonly':'readwrite'),store=tx.objectStore('work'),key=workspaceId+'/'+slot;let result;
    const request=mode==='get'?store.get(key):mode==='delete'?store.delete(key):store.put(value,key);
    request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The saved request could not be retained.'));});
}
async function clearPendingRequest(original) {
  const cleared=await new Promise((resolve,reject)=>{
    const tx=db.transaction('work','readwrite'),store=tx.objectStore('work'),key=workspaceId+'/pending';let removed=false;
    const request=store.get(key);
    request.onsuccess=()=>{if(request.result?.id===original.id){store.delete(key);removed=true;}};
    tx.oncomplete=()=>resolve(removed);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The saved request could not be updated.'));
  });
  if(pending?.id===original.id)pending=null;
  return cleared;
}
async function renderRequestHistory() {
  const prefix=workspaceId+'/request/';
  const requests=await new Promise((resolve,reject)=>{const tx=db.transaction('work','readonly'),req=tx.objectStore('work').getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  $('browser-requests').innerHTML=requests.length?requests.map(request=>{const operation=state?.operations.find(value=>value.id===request.id);const description=request.input?.plan?.query??request.input?.title??request.input?.name??(request.action==='review.batch'?(request.input.items?.length??0)+' selected companies':'');return '<article><strong>'+e(actionName(request.action))+'</strong>'+(description?'<p>'+e(description)+'</p>':'')+'<p class="hint">'+e(operation?stateName(operation.state)+' · '+observedTime(operation.createdAt):'Saved in this browser')+'</p><button data-browser-request="'+e(request.id)+'">Continue original request</button><details><summary>Request reference</summary><code>'+e(request.id)+'</code></details></article>';}).join(''):'<p>No original browser requests have been retained.</p>';
}
function chooseCapture(id){rowsRequest++;selectedCapture=id;offset=0;selected.clear();detail=null;detailBinding=null;$('detail').hidden=true;$('batch').hidden=true;}
function draftKey(id){return workspaceId+'/form/'+id;}
function saveDraft(form) {if(!workspaceId)return;if(form.id==='review-form'){retainReviewDraft();return;}const value=Object.fromEntries(new FormData(form));if(form.id==='report-form')value.captureIds=[...form.elements.captureIds.selectedOptions].map(v=>v.value);localStorage.setItem(draftKey(form.id),JSON.stringify(value));}
function restoreDraft(form){if(form.id==='review-form')return;let value;try{value=JSON.parse(localStorage.getItem(draftKey(form.id))??'null');}catch{}if(!value)return;
  for(const [name,v]of Object.entries(value)){const field=form.elements.namedItem(name);if(!field)continue;if(field.multiple){for(const option of field.options)option.selected=Array.isArray(v)&&v.includes(option.value);}else field.value=v;}}
function options(select,items,defaultValue) {
  const values=select.multiple?[...select.selectedOptions].map(v=>v.value):[select.value||defaultValue];
  select.innerHTML=items.map(([value,text])=>'<option value="'+e(value)+'">'+e(text)+'</option>').join('');
  for(const option of select.options)option.selected=values.includes(option.value);
  if(!select.multiple&&!select.value&&select.options.length)select.options[0].selected=true;
}
async function refresh({loadRows=true}={}) {
  state=await api('/api/status');$('title').textContent=state.workspace.title;if(state.persistenceFailure)notice(state.persistenceFailure.message,true);
  const editions=state.captures;const complete=editions.filter(c=>c.state==='COMPLETE');
  $('captures').innerHTML=editions.length?editions.slice().reverse().map(c=>'<article class="'+(selectedCapture===c.id?'active':'')+'"><button data-capture="'+e(c.id)+'">'+e(c.plan.query)+'</button><p>'+e(stateName(c.state))+' · '+c.rows+' records · '+c.pages.length+' pages</p><p class="hint">Observed '+e(captureTime(c))+'</p><details><summary>Source reference</summary><code>'+e(c.id)+'</code></details>'+(c.error?'<p>'+e(c.error.message)+'</p>':'')+(c.state==='INTERRUPTED'&&c.next?'<button data-continue-capture="'+e(c.id)+'">Continue original pages</button>':'')+'</article>').join(''):'<p class="hint">No source editions have been captured.</p>';
  $('shortlist').innerHTML=state.reviews.length?state.reviews.map(r=>'<article><button data-review="'+e(r.id)+'">'+e(r.title)+'</button><p>'+e(r.decision)+' · '+e(r.reviewer)+' · revision '+r.version+'</p><small>'+e(r.lei)+'</small></article>').join(''):'<p class="hint">Company research decisions appear here.</p>';
  for(const select of document.querySelectorAll('.capture-select,.capture-multi'))options(select,complete.map(c=>[c.id,c.plan.query+' · '+captureTime(c)]));
  $('reports').innerHTML=state.reports.map(r=>'<article><strong>'+e(r.title)+'</strong><p>'+r.records+' complete source records</p><div class="toolbar">'+r.files.map(file=>'<button data-file="'+file.sha256+'" data-name="'+e(file.name)+'">'+e(file.name)+'</button>').join('')+'</div></article>').join('');
  $('datasets').innerHTML=state.datasets.map(r=>'<article><strong>'+e(r.name)+'</strong><p>'+r.rows+' rows · native snapshot <small>'+e(r.snapshot)+'</small></p><code>'+e(r.relativeDirectory)+'</code><div class="toolbar">'+r.files.map(file=>'<button data-file="'+file.sha256+'" data-name="'+e(file.name)+'">'+e(file.name)+'</button>').join('')+'</div></article>').join('');
  options($('dataset-select'),state.datasets.map(d=>[d.id,d.name+' · '+observedTime(d.createdAt)]));
  $('operations').innerHTML=state.operations.slice().reverse().map(op=>'<article><strong>'+e(actionName(op.action))+'</strong> · '+e(stateName(op.state))+'<p class="hint">'+e(observedTime(op.updatedAt??op.createdAt))+'</p><details><summary>Operation reference</summary><code>'+e(op.id)+'</code></details>'+(op.error?'<p>'+e(op.error.message)+'</p>':'')+
    (op.state==='INTERRUPTED'?'<button data-resume="'+e(op.id)+'">Resume original request</button>':'')+'</article>').join('');
  if(!selectedCapture&&editions.length)selectedCapture=editions.at(-1).id;
  const completed=pending&&state.operations.find(op=>op.id===pending.id&&op.state==='COMPLETE');if(completed)await finishRequest(completed);
  monitoring.refresh(state);renderPending();renderEditingContexts();if(selectedCapture&&loadRows)await loadEntityRows();
}
function renderPending() {
  $('pending').hidden=!pending&&!state?.active;$('pause').hidden=!['capture','capture.resume'].includes(state?.active?.action);
  $('resume').disabled=!!state?.active||!pending;$('dismiss').disabled=!!state?.active||!pending;
  $('pending-text').textContent=state?.active?actionName(state.active.action)+' · running':pending?actionName(pending.action)+' · saved for continuation':'';
}
async function loadEntityRows() {
  const captureId=selectedCapture,sequence=++rowsRequest;
  const incoming=await api('/api/captures/'+encodeURIComponent(captureId)+'/rows?'+new URLSearchParams({offset:String(offset),limit:'50',search:$('row-search').value}));
  if(sequence!==rowsRequest||selectedCapture!==captureId)return;rows=incoming;
  if(rows.issues?.length)notice(rows.issues[0].message,true);
  $('edition-title').textContent=rows.capture.plan.query;$('edition-meta').textContent=stateName(rows.capture.state)+' · '+rows.total+' retained matching records · observed '+captureTime(rows.capture);
  $('entity-rows').innerHTML=rows.items.map(item=>'<tr><td><input type="checkbox" data-select="'+e(item.row.lei)+'" '+(selected.has(item.row.lei)?'checked':'')+' aria-label="Select '+e(item.row.legalName)+'"></td><td><button data-entity="'+e(item.row.lei)+'">'+e(item.row.legalName)+'</button><small>'+e(item.row.lei)+'</small></td><td>'+e(item.row.legalJurisdiction)+'</td><td>'+e(item.row.entityStatus)+'</td><td>'+e(item.row.registrationStatus)+'</td><td>'+e(item.needsReview?'Source changed; review again':item.review?.decision??'Awaiting review')+'</td></tr>').join('');
  $('page-label').textContent=rows.total?(offset+1)+'–'+Math.min(offset+rows.items.length,rows.total)+' of '+rows.total:'0 records';
  $('previous').disabled=offset===0;$('next').disabled=rows.nextOffset===null;
}
function showDetail(item) {
  detail=item;detailBinding=reviewSnapshot(item);$('detail').hidden=false;$('detail-title').textContent=item.row.legalName;
  $('source-fields').innerHTML=Object.entries(COMPANY_FACT_LABELS).map(([key,label])=>'<div><strong>'+e(label)+'</strong>'+sourceFact(key,item.row[key])+'</div>').join('')+'<div>'+sourceReferenceDetails(item.row)+'</div>';
  $('resource').textContent=JSON.stringify(item.resource,null,2);
  const form=$('review-form');fillReviewFields(form,item.review??currentReview(item.row.lei)??{});
  let draft;try{draft=JSON.parse(localStorage.getItem(reviewDraftSlot(detailBinding))??'null');}catch{}
  if(draft?.schema==='gleif.review-editor.v1'&&draft.binding?.captureId===item.row.captureId&&draft.binding?.lei===item.row.lei&&Number.isInteger(draft.binding.expectedVersion)&&draft.binding.expectedVersion>=0){
    detailBinding={...draft.binding};fillReviewFields(form,draft.fields);
  }
  renderEditingContexts();$('detail').scrollIntoView({behavior:'smooth',block:'start'});
}
async function execute(request) {
  if(pending&&pending.id!==request.id)throw new Error('Continue the saved request before starting another operation.');
  pending=request;await stored('put',pending,'request/'+pending.id);await stored('put',pending);renderPending();await renderRequestHistory();
  await api('/api/start',{method:'POST',body:request});notice('Running: '+actionName(request.action)+'. The complete request is saved.');
  if(!polling)poll();
}
async function poll() {
  const id=pending?.id;if(!id)return;polling=true;
  try{
    while(pending?.id===id){
      const result=await api('/api/operations/'+encodeURIComponent(id));if(pending?.id!==id)break;
      await refresh();if(pending?.id!==id)break;
      if(result.state==='COMPLETE'){await finishRequest(result);break;}
      if(result.state==='INTERRUPTED'){notice(result.error?.message??'The original request is ready to continue.',true);break;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }catch(error){notice(error.message,true);}finally{polling=false;renderPending();if(pending&&pending.id!==id)poll();}
}
function request(action,input){return {id:crypto.randomUUID(),action,input,expectedRevision:state.revision};}
function researchInput(item,form,binding) {
  if(!binding||binding.lei!==item.row.lei||binding.captureId!==item.row.captureId)throw new Error('Open this company from its original source edition before editing.');
  return {...binding,...formValues(form)};
}
async function download(sha,name){const data=await api('/api/objects/'+sha,{raw:true}),url=URL.createObjectURL(new Blob([data]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function run(fn){return async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(error){notice(error.message,true);}};}
$('capture-form').onsubmit=run(async()=>{
  const value=Object.fromEntries(new FormData($('capture-form')));value.pageSize=Number(value.pageSize);value.country=value.country.toUpperCase();
  if(value.kind==='lei'){delete value.country;delete value.entityStatus;delete value.registrationStatus;}
  await execute(request('capture',{plan:plan(value)}));
});
$('source-import').onclick=run(async()=>{const file=$('source-file').files[0];if(!file)throw new Error('Choose the original source-response file.');const input=JSON.parse(await file.text());await execute(request('source.import',input));});
$('refresh').onclick=run(()=>refresh());
$('resume').onclick=run(async()=>{if(pending)await execute(pending);});
$('dismiss').onclick=run(async()=>{const original=pending;if(!original)return;await refresh({loadRows:false});if(state.active)throw new Error('Finish or pause the running project operation first.');if(pending?.id!==original.id)return;await stored('put',original,'request/'+original.id);await clearPendingRequest(original);renderPending();await renderRequestHistory();notice('The original request remains in browser and project history. Edit the form and start a new request.');});
$('browser-requests').onclick=run(async event=>{const button=event.target.closest('[data-browser-request]');if(!button)return;const saved=await stored('get',undefined,'request/'+button.dataset.browserRequest);if(saved)await execute(saved);});
$('pause').onclick=run(async()=>{if(state.active)await api('/api/pause/'+state.active.id,{method:'POST',body:{}});await refresh();});
$('previous').onclick=run(async()=>{offset=Math.max(0,offset-50);await loadEntityRows();});
$('next').onclick=run(async()=>{if(rows.nextOffset!==null){offset=rows.nextOffset;await loadEntityRows();}});
let searchTimer;$('row-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;loadEntityRows().catch(error=>notice(error.message,true));},250);};
$('captures').onclick=run(async event=>{const continuation=event.target.closest('[data-continue-capture]');if(continuation){const id=continuation.dataset.continueCapture;if(pending&&(pending.id===id||pending.input?.captureId===id))await execute(pending);else await execute(request('capture.resume',{captureId:id}));return;}const button=event.target.closest('[data-capture]');if(!button)return;chooseCapture(button.dataset.capture);await refresh();});
$('shortlist').onclick=run(async event=>{const button=event.target.closest('[data-review]');if(!button)return;const review=state.reviews.find(r=>r.id===button.dataset.review);chooseCapture(review.captureId);$('row-search').value=review.lei;await refresh();const item=rows.items.find(r=>r.row.lei===review.lei);if(item)showDetail(item);});
$('entity-rows').onclick=run(async event=>{const entity=event.target.closest('[data-entity]');if(entity)showDetail(rows.items.find(r=>r.row.lei===entity.dataset.entity));
  const checkbox=event.target.closest('[data-select]');if(checkbox){const item=rows.items.find(r=>r.row.lei===checkbox.dataset.select);if(checkbox.checked)selected.set(item.row.lei,{...item,reviewBinding:reviewSnapshot(item)});else selected.delete(item.row.lei);renderEditingContexts();}});
$('source-download').onclick=run(async()=>{if(!detail)return;const capture=state.captures.find(value=>value.id===detail.row.captureId),source=capture?.pages[detail.page-1];if(!source)throw new Error('Reopen this company from its retained source edition.');await download(source.sha256,'gleif-'+capture.id+'-page-'+detail.page+'.json');});
$('review-form').onsubmit=run(async()=>{if(!detail)return;retainReviewDraft();if(changedReview(detailBinding)){renderEditingContexts();throw new Error('The saved company review changed. Compare it with your retained edits below.');}await execute(request('review.save',researchInput(detail,$('review-form'),detailBinding)));});
$('review-selected').onclick=run(async()=>{if(!selected.size)throw new Error('Select companies from the retained source table.');$('batch').hidden=false;$('batch-label').textContent=selected.size+' selected companies from '+(state.captures.find(value=>value.id===selectedCapture)?.plan.query??'this source edition');renderEditingContexts();$('batch').scrollIntoView({behavior:'smooth'});});
$('batch-form').onsubmit=run(async()=>{if(!selected.size)throw new Error('Select companies from the retained source table.');if([...selected.values()].some(item=>changedReview(item.reviewBinding))){renderEditingContexts();throw new Error('A selected company review changed. Compare its saved version before applying the batch.');}await execute(request('review.batch',{items:[...selected.values()].map(item=>researchInput(item,$('batch-form'),item.reviewBinding))}));});

$('review-context').onclick=run(async event=>{
  const button=event.target.closest('[data-review-edit]');if(!button||!detail||!detailBinding)return;
  const choice=button.dataset.reviewEdit,shown=reviewSnapshot(detail),opened=detailBinding;
  await releaseEditedRequest('single');await refresh({loadRows:false});if(state.active)throw new Error('Finish or pause the running project operation first.');
  if(detailBinding!==opened||detail?.row.captureId!==shown.captureId||detail?.row.lei!==shown.lei)throw new Error('The selected company changed. Reopen its current review.');
  if(choice==='rebase'&&changedReview(shown)){renderEditingContexts();throw new Error('The saved review changed again. Compare the newly displayed revision before continuing.');}
  previousDraft();
  if(choice==='reload'){fillReviewFields($('review-form'),currentReview(detail.row.lei)??{});detailBinding=reviewSnapshot(detail);}
  else if(choice==='legacy'){let draft;try{draft=JSON.parse(localStorage.getItem(workspaceId+'/review/'+detail.row.lei)??'null');}catch{}if(!draft)throw new Error('The earlier browser draft is unavailable.');fillReviewFields($('review-form'),draft);}
  else if(choice==='rebase')detailBinding=shown;
  retainReviewDraft();renderEditingContexts();
  notice(choice==='reload'?'The saved company review is open for editing. Its earlier draft is retained in this browser.':choice==='legacy'?'The earlier draft is restored with the source and review revision you opened.':'Your edits now use the displayed saved revision and original source edition. Save the review when ready.');
});
$('batch-context').onclick=run(async event=>{
  if(!event.target.closest('[data-batch-edit]'))return;
  const shown=new Map([...selected.values()].map(item=>[item.row.lei,reviewSnapshot(item)]));
  await releaseEditedRequest('batch');await refresh({loadRows:false});if(state.active)throw new Error('Finish or pause the running project operation first.');
  if(shown.size!==selected.size||[...shown].some(([lei,binding])=>selected.get(lei)?.reviewBinding.captureId!==binding.captureId))throw new Error('The selected company set changed. Review the current selection before continuing.');
  if([...shown.values()].some(changedReview)){renderEditingContexts();throw new Error('A saved review changed again. Compare the newly displayed revisions before continuing.');}
  for(const[lei,binding]of shown)selected.get(lei).reviewBinding=binding;
  renderEditingContexts();notice('The batch keeps your edits and the original selected source. Save the selected company reviews when ready.');
});

$('compare-form').onsubmit=run(async()=>{const values=Object.fromEntries(new FormData($('compare-form'))),result=await api('/api/compare?'+new URLSearchParams(values));
  $('comparison').innerHTML='<p>'+result.counts.added+' added · '+result.counts.missing+' absent from the later search · '+result.counts.changed+' changed · '+result.counts.unchanged+' unchanged</p>'+
    result.changed.map(c=>'<details><summary>'+e(c.legalName)+' · '+e(c.lei)+' · '+c.fields.length+' changed fields</summary><pre>'+e(JSON.stringify(c.fields,null,2))+'</pre></details>').join('')+
    '<details><summary>Complete comparison and original records</summary><pre>'+e(JSON.stringify(result,null,2))+'</pre></details>';});
function reportInput(){const form=$('report-form');return {title:form.elements.title.value,captureIds:[...form.elements.captureIds.selectedOptions].map(v=>v.value),selection:form.elements.selection.value};}
$('report-form').onsubmit=run(()=>execute(request('report.prepare',reportInput())));
$('dataset-prepare').onclick=run(async()=>{const input=reportInput();await execute(request('dataset.prepare',{...input,name:input.title}));});
$('query-form').onsubmit=run(async()=>{const form=$('query-form');const value=await api('/api/datasets/'+encodeURIComponent(form.elements.dataset.value)+'/query?'+form.elements.query.value);$('query-result').textContent=JSON.stringify(value,null,2);});
for(const id of ['reports','datasets'])$(id).onclick=run(async event=>{const b=event.target.closest('[data-file]');if(b)await download(b.dataset.file,b.dataset.name);});
$('operations').onclick=run(async event=>{const b=event.target.closest('[data-resume]');if(!b)return;const op=await api('/api/operations/'+b.dataset.resume);await execute({id:op.id,action:op.action,input:op.input});});
$('export').onclick=run(async()=>{const file=await api('/api/package-file',{method:'POST',body:{}});await download(file.sha256,file.name);notice('Complete project exported. Use gleif receive to open it in an independent private directory.');});
for(const id of forms){const form=$(id);form.addEventListener('input',()=>saveDraft(form));}
const monitoring=mountMonitoring({root:$('monitoring-handover'),api,execute,request,getState:()=>state,escape:e,notice});
async function start(){
  const identity=await api('/api/identity');workspaceId=identity.workspaceId;instanceId=identity.instanceId;db=await database();pending=await stored('get')??null;
  await refresh();await renderRequestHistory();for(const id of forms)restoreDraft($(id));
  if(pending){try{const result=await api('/api/operations/'+pending.id);if(result.state==='COMPLETE'){await finishRequest(result);}else if(result.state==='RUNNING')poll();}catch{}}
  notice('Saved company research is ready.');
}
start().catch(error=>notice(error.message,true));
