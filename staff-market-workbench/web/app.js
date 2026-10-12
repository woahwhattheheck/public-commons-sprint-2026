'use strict';
let state = null, currentView = 'sources', preview = null, sourceDraft = null;
let selectedJob = null, selectedSurvey = null, latestAnalysis = null, cycleDraft = null;
let jobsPage = 0, surveysPage = 0, peersPage = 0, jobsQuery = '', surveysQuery = '', peersQuery = '';
let sourceDetail = null, sourceDetailOffset = 0;
let renderSequence = 0, sourceSequence = 0, contextRestored = false;
let publisherScope = null, pricingCorrection = null;
const extensionViews = new Map();
const pageSize = 30;
const titles = {sources:'Sources',publisher:'Publisher intake',receiving:'Receiving and annual review',matches:'Jobs and matches',analysis:'Market analysis',cycles:'Survey cycles',reports:'Decisions and exports',workspace:'Workspace'};
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
const h = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = v => {
  if(v == null || v === '')return '—';
  const m=String(v).match(/^(-?)(\d+)(?:\.(\d+))?$/);if(!m)return String(v);
  const fraction=m[3]||'',scale=100n;
  let units=BigInt(m[2])*scale+BigInt((fraction+'00').slice(0,2));
  if((fraction[2]||'0')>='5')units+=1n;
  const whole=String(units/scale).replace(/\B(?=(\d{3})+(?!\d))/g,','),tail=String(units%scale).padStart(2,'0').replace(/0+$/,'');
  return (m[1]&&units?'−':'')+whole+(tail?'.'+tail:'');
};
const badge = v => '<span class="badge">'+h(v)+'</span>';
const options = (items, selected, blank='Select…') => '<option value="">'+h(blank)+'</option>'+items.map(item=>{const value=typeof item==='string'?item:item.value,label=typeof item==='string'?item:item.label;return '<option value="'+h(value)+'"'+(value===selected?' selected':'')+'>'+h(label)+'</option>';}).join('');
const field = (label,name,value='',type='text',extra='') => '<label>'+h(label)+'<input name="'+h(name)+'" type="'+type+'" value="'+h(value)+'" '+extra+'></label>';
const area = (label,name,value='',extra='') => '<label>'+h(label)+'<textarea name="'+h(name)+'" '+extra+'>'+h(value)+'</textarea></label>';
const select = (label,name,items,value='',blank='Select…') => '<label>'+h(label)+'<select name="'+h(name)+'">'+options(items,value,blank)+'</select></label>';
function note(message,error=false){const n=$('#notice');n.className='notice'+(error?' error':'');n.textContent=message;}
function fail(error){note(error.message || String(error),true);}
function table(headers,rows){return '<div class="scroll"><table><thead><tr>'+headers.map(x=>'<th>'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function cell(value,cls=''){return '<td class="'+cls+'">'+h(value == null ? '—' : value)+'</td>';}
function empty(message){return '<div class="blank">'+h(message)+'</div>';}
function button(label,action,id='',primary=false){return '<button data-action="'+h(action)+'" data-id="'+h(id)+'"'+(primary?' class="primary"':'')+'>'+h(label)+'</button>';}
function jsonDetail(value){return '<pre class="code">'+h(JSON.stringify(value,null,2))+'</pre>';}
function modal(title,html){$('#detail-content').innerHTML='<h3>'+h(title)+'</h3>'+html;$('#detail').showModal();}
function values(form){return Object.fromEntries(new FormData(form).entries());}
function pager(kind,result){return '<div class="pagination"><button data-action="'+h(kind)+'-previous"'+(result.offset===0?' disabled':'')+'>Previous</button><span>'+h(result.items.length?result.offset+1:0)+'–'+h(Math.min(result.offset+result.items.length,result.total))+' of '+h(result.total)+'</span><button data-action="'+h(kind)+'-next"'+(result.offset+result.items.length>=result.total?' disabled':'')+'>Next</button></div>';}

const storage = new Promise((resolve,reject)=>{
  const req=indexedDB.open('staff-market-workbench',2);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('pending'))req.result.createObjectStore('pending',{keyPath:'operation_id'});if(!req.result.objectStoreNames.contains('drafts'))req.result.createObjectStore('drafts',{keyPath:'key'});};
  req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Close the older workbench tab and reopen this workspace to update local draft storage.'));
});
async function pendingStore(mode, operation, name='pending'){const db=await storage;return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode),object=tx.objectStore(name);let result;try{result=operation(object);}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(result && result.result);tx.onerror=()=>reject(tx.error);});}
async function pendingAll(){return pendingStore('readonly',s=>s.getAll());}
function formKey(form){
  if(form.dataset.draftKey)return form.dataset.draftKey;
  const context=form.id==='job-review-form'?(selectedJob?.id||''):form.id==='match-form'?(selectedJob?.id||'')+'/'+(selectedSurvey?.id||''):form.id==='analysis-form'?(selectedJob?.id||'')+'/'+(pricingCorrection?.origin?.id||'')+'/'+(pricingCorrection?.origin?.entryKey||''):form.id==='review-form'?(form.dataset.id||''):form.id==='cycle-form'?(cycleDraft?.id||'new'):form.id==='mapping-form'?(preview?.id||''):'';
  return form.dataset.draftKey=state.workspace.id+':'+form.id+':'+context;
}
async function retainForm(form){
  if(!state||!form.id||!form.closest('#view')||form.closest('.extension-view'))return;
  const fields=Array.from(form.elements).filter(e=>e.name).map(e=>({name:e.name,type:e.type,value:e.value,checked:e.checked,selected:e.multiple?Array.from(e.selectedOptions).map(o=>o.value):null,file:e.type==='file'?(e.files[0]||null):null}));
  await pendingStore('readwrite',s=>s.put({key:formKey(form),fields,updated_at:new Date().toISOString()}),'drafts');
  await retainContext();
}
async function retainForms(){for(const form of $$('#view form[id]'))await retainForm(form);}
async function restoreForms(generation=renderSequence){
  for(const form of $$('#view form[id]')){
    if(form.closest('.extension-view'))continue;
    const saved=await pendingStore('readonly',s=>s.get(formKey(form)),'drafts');if(!saved)continue;
    if(generation!==renderSequence||!form.isConnected)return;
    for(const item of saved.fields){
      const matches=Array.from(form.elements).filter(e=>e.name===item.name);for(const e of matches){
        if(e.readOnly)continue;
        if(e.type==='checkbox'||e.type==='radio'){if(e.value===item.value)e.checked=item.checked;}
        else if(e.type==='file'){if(item.file){const transfer=new DataTransfer();transfer.items.add(item.file);e.files=transfer.files;}}
        else if(e.multiple){Array.from(e.options).forEach(o=>o.selected=(item.selected||[]).includes(o.value));}
        else e.value=item.value;
      }
    }
  }
}
async function retainContext(){
  if(!state||!contextRestored)return;
  const value={key:state.workspace.id+':context',workspace_id:state.workspace.id,view:currentView,job_id:selectedJob?.id||null,survey_id:selectedSurvey?.id||null,analysis_id:latestAnalysis?.id||null,cycle:cycleDraft,publisher_scope:publisherScope,pricing_correction:pricingCorrection?{origin:pricingCorrection.origin,analysis_id:pricingCorrection.prior_analysis_id}:null,jobsQuery,surveysQuery,peersQuery,jobsPage,surveysPage,peersPage};
  await pendingStore('readwrite',s=>s.put(value),'drafts');
}
async function restoreContext(){
  const value=await pendingStore('readonly',s=>s.get(state.workspace.id+':context'),'drafts');
  if(value?.workspace_id===state.workspace.id){
    if(titles[value.view])currentView=value.view;
    const originals=await Promise.allSettled([value.job_id?request('/api/document/record/'+encodeURIComponent(value.job_id)):null,value.survey_id?request('/api/document/record/'+encodeURIComponent(value.survey_id)):null,value.analysis_id?request('/api/document/analysis/'+encodeURIComponent(value.analysis_id)):null]);
    [selectedJob,selectedSurvey,latestAnalysis]=originals.map(r=>r.status==='fulfilled'?r.value:null);
    cycleDraft=value.cycle||null;jobsQuery=value.jobsQuery||'';surveysQuery=value.surveysQuery||'';peersQuery=value.peersQuery||'';
    jobsPage=value.jobsPage||0;surveysPage=value.surveysPage||0;peersPage=value.peersPage||0;
    if(value.publisher_scope&&['edition','cohort'].includes(value.publisher_scope.kind)&&/^[a-f0-9]{64}$/.test(value.publisher_scope.id||''))publisherScope=value.publisher_scope;
    if(value.pricing_correction){try{pricingCorrection=await loadPricingCorrection(value.pricing_correction.origin,value.pricing_correction.analysis_id);}catch(error){note('The saved receiving correction could not reopen: '+error.message,true);}}
  }
  contextRestored=true;
}
async function forgetForm(form){if(form?.dataset.draftKey)await pendingStore('readwrite',s=>s.delete(form.dataset.draftKey),'drafts');}
function retainActiveInput(event){const f=event.target.closest('form');if(!f||f.closest('.extension-view'))return;if(f.id==='cycle-form')collectCycle();retainForm(f).catch(fail);}
document.addEventListener('input',retainActiveInput);
document.addEventListener('change',retainActiveInput);
async function request(path,body){
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let data;try{data=await response.json();}catch(e){throw new Error('The response could not be read. Resume the saved original request from Workspace.');}
  if(!response.ok){const error=new Error(data.error || 'Request failed');error.code=data.code;error.status=response.status;error.details=data.details;throw error;}
  return data;
}
async function mutate(path,args,retained=null){
  const body=retained ? retained.body : {expected_revision:state.workspace.revision,operation_id:crypto.randomUUID(),...args};
  const saved=retained || {operation_id:body.operation_id,workspace_id:state.workspace.id,path,body,created_at:new Date().toISOString()};
  await pendingStore('readwrite',s=>s.put(saved));
  try{
    const result=await request(path,body);
    await pendingStore('readwrite',s=>s.delete(saved.operation_id));
    if(result.revision!==undefined)state.workspace.revision=result.revision;
    return result;
  }catch(e){
    if(e.status && e.status<500){await pendingStore('readwrite',s=>s.delete(saved.operation_id));if(e.code==='STALE_REVISION'){await refresh(false);e.message+=' Current data has been refreshed; your form remains below for review and resubmission.';}}
    else e.message+=' The exact request is retained in Workspace → Request recovery.';
    throw e;
  }
}
async function refresh(renderNow=true){
  const next=await request('/api/state');
  if(state&&state.workspace.id!==next.workspace.id){disposeExtensions();contextRestored=false;selectedJob=null;selectedSurvey=null;latestAnalysis=null;cycleDraft=null;preview=null;sourceDraft=null;publisherScope=null;pricingCorrection=null;jobsPage=surveysPage=peersPage=0;jobsQuery=surveysQuery=peersQuery='';}
  state=next;
  if(!contextRestored)await restoreContext();
  $('#workspace-title').textContent=state.workspace.title;
  $('#identity').textContent='Revision '+state.workspace.revision+' · '+state.workspace.id;
  if(renderNow)await render();
}
async function render(){
  const generation=++renderSequence;
  await retainForms();
  if(generation!==renderSequence)return;
  await retainContext();
  if(generation!==renderSequence)return;
  $('#view-title').textContent=titles[currentView];
  $$('#nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.view===currentView?'page':'false'));
  if(currentView==='publisher'||currentView==='receiving')await renderExtension(currentView,generation);
  else if(currentView==='sources')renderSources();
  else if(currentView==='matches')await renderMatches(generation);
  else if(currentView==='analysis')renderAnalysis();
  else if(currentView==='cycles')await renderCycles(generation);
  else if(currentView==='reports')renderReports();
  else await renderWorkspace(generation);
  if(generation===renderSequence)await restoreForms(generation);
}

function disposeExtensions(){
  for(const view of extensionViews.values()){view.disposed=true;view.controller?.destroy();view.element.remove();}
  extensionViews.clear();
}
window.addEventListener('pagehide',event=>{if(!event.persisted)disposeExtensions();});
async function renderExtension(name,generation){
  const workspaceId=state.workspace.id;
  let view=extensionViews.get(name);
  const reopening=!!view;
  if(!view){
    const element=document.createElement('div');element.className='extension-view';element.dataset.extension=name;
    element.innerHTML=empty('Loading '+titles[name].toLowerCase()+'…');
    view={element,workspaceId,controller:null,disposed:false,ready:null};
    extensionViews.set(name,view);
    const path=name==='publisher'?'/extensions/publisher/bridge.mjs':'/receiving-bridge.mjs';
    view.ready=import(path).then(async module=>{
      if(view.disposed||state.workspace.id!==workspaceId)return;
      const common={request,mutate,refresh,note};
      view.controller=name==='publisher'
        ?module.mountPublisherBridge(element,{...common,onSource:openPublisherSource})
        :module.mountReceivingBridge(element,{...common,getState:()=>state,onOpenAnalysis:openReceivingAnalysis});
      await view.controller.ready;
    }).catch(error=>{if(!view.disposed){note(error.message||String(error),true);if(!view.controller)element.innerHTML=empty('The view could not load. Refresh this view to retry.');throw error;}});
  }
  if(generation!==renderSequence||currentView!==name)return;
  $('#view').replaceChildren(view.element);
  try{
    await view.ready;
    if(reopening&&!view.disposed&&generation===renderSequence&&currentView===name)await view.controller?.refresh();
  }catch(error){
    if(!view.controller&&extensionViews.get(name)===view){view.disposed=true;extensionViews.delete(name);}
    throw error;
  }
}
async function openPublisherSource(payload){
  const source=payload?.document,kind=source?.kind==='cohort'?'cohort':'edition';
  const id=source?.[kind==='cohort'?'cohortHash':'editionHash'];
  if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Reopen the original reviewed publisher edition or cohort.');
  const workspaceId=state.workspace.id;
  const original=payload.firstRecordId?await request('/api/document/record/'+encodeURIComponent(payload.firstRecordId)):null;
  if(state.workspace.id!==workspaceId||currentView!=='publisher'){note('The reviewed publisher selection is ready. Reopen it from Publisher intake to continue pricing.');return;}
  publisherScope={kind,id,edition_hash:source.editionHash||null,row_count:(payload.recordIds||[]).length,label:source.selection?.label||source.selection?.name||source.label||source.source?.survey_name||source.source?.survey_id||'Reviewed publisher '+kind};
  selectedSurvey=original;surveysPage=0;surveysQuery='';
  if(payload.navigate===true){currentView='matches';await render();note('Matching now uses the exact saved '+kind+' and its original survey rows.');}
  else{await retainContext();note('Reviewed publisher '+kind+' retained. Select its comparison group here, then use the explicit pricing button to continue.');}
}
function publisherScopeHtml(){
  if(!publisherScope)return '';
  return '<div class="panel source-scope"><h3>Reviewed publisher '+h(publisherScope.kind)+'</h3><p>'+h(publisherScope.label)+' · '+h(publisherScope.row_count)+' retained rows</p><p class="muted small">This view keeps the selected source edition and comparison group. The analysis records whether its original sources are current or an explicit historical comparison.</p><div class="actions">'+button('Open publisher work','open-publisher')+button('Browse all current survey rows','clear-publisher-scope')+'</div></div>';
}
async function loadPricingCorrection(origin,analysisId){
  if(!origin||!['return-review','annual-review'].includes(origin.kind)||typeof origin.id!=='string')throw new Error('Select the original saved receiving review.');
  const [record,prior]=await Promise.all([request('/api/extensions/receiving/document/'+encodeURIComponent(origin.kind)+'/'+encodeURIComponent(origin.id)),request('/api/document/analysis/'+encodeURIComponent(analysisId))]);
  const entry=record.entries?.find(item=>item.key===origin.entryKey),decision=record.decisions?.find(item=>item.key===origin.entryKey);
  const side=origin.edition||(record.kind==='return-review'?'original':'current');
  const source=entry?.[side]?.source;
  if(!entry||!decision||!['request-pricing-review','needs-pricing-review'].includes(decision.action)||source?.id!==prior.id||source?.data?.id!==prior.id||source?.data?.result_sha256!==prior.result_sha256)throw new Error('This receiving decision does not bind the original requested pricing analysis.');
  return {origin:{kind:record.kind,id:record.id,entryKey:entry.key,edition:side},review_sha256:record.sha256,reviewer:record.createdBy,reviewed_at:record.createdAt,decision,changes:entry.changes||[],prior_analysis_id:prior.id,prior_analysis_sha256:prior.result_sha256,prior_title:prior.title,job_source_key:prior.job.source_key,job_record_key:prior.job.record_key};
}
async function openReceivingAnalysis(payload){
  const workspaceId=state.workspace.id,generation=renderSequence;
  const correction=await loadPricingCorrection(payload.receiving,payload.analysisId);
  const prior=await request('/api/document/analysis/'+encodeURIComponent(correction.prior_analysis_id));
  if(state.workspace.id!==workspaceId||currentView!=='receiving'||generation!==renderSequence){note('The saved correction is ready. Reopen its pricing action from Receiving to continue.');return;}
  pricingCorrection=correction;latestAnalysis=prior;selectedJob=prior.job;currentView='analysis';
  await render();note('Review the requested change, update the original matches or basis, then retain a new analysis linked to this receiving decision.');
}
function correctionHtml(){
  if(!pricingCorrection)return '';
  const c=pricingCorrection;
  return '<div class="panel correction-context"><h3>Receiving correction in progress</h3><p><strong>'+h(c.prior_title)+'</strong></p><p>'+h(c.decision.action)+' · '+h(c.reviewer)+' · '+h(c.reviewed_at)+'</p>'+jsonDetail({decision:c.decision,changes:c.changes})+'<p class="muted">Apply the reviewed change through the original match decisions and analysis basis. The next calculated result retains this receiving review and its previous analysis.</p><div class="actions">'+button('Review job and matches','open-matches')+button('Open saved receiving review','correction-detail')+button('Return to receiving','open-receiving')+button('Leave correction context','clear-correction')+'</div></div>';
}

function renderSources(){
  const rows=state.sources.map(s=>'<tr>'+cell(s.source_name+' / '+s.edition)+'<td>'+badge(s.kind)+'<span class="muted">'+h(s.filename)+'</span></td>'+cell(s.row_count,'number')+cell(s.status)+'<td>'+button('Inspect rows','source-detail',s.id)+' '+button(s.status==='PREVIEW'?'Resume preview':'Reopen mapping','resume-source',s.id)+' <a href="/api/original/'+encodeURIComponent(s.id)+'">Original file</a></td></tr>');
  $('#view').innerHTML='<div class="panel"><h3>Import a source edition</h3><p class="muted">Original CSV/JSON bytes and column mappings stay with the edition. Use a consistent source name when the next edition arrives.</p><form id="source-form"><div class="grid three">'+select('Source kind','kind',['jobs','surveys','peers'],'jobs')+field('Source name','source_name','','text','required')+field('Edition / effective release','edition','','text','required')+field('Original file','file','','file','accept=".csv,.json,.tsv" required')+select('Delimiter','delimiter',[{value:',',label:'Comma'},{value:';',label:'Semicolon'},{value:'\t',label:'Tab'}],',')+select('Numeric format','number_format',[{value:'plain',label:'Plain decimal: 34200.50'},{value:'us_grouped',label:'US grouped: 34,200.50'},{value:'decimal_comma',label:'Decimal comma: 34.200,50'}],'plain')+field('Original source URL / reference','source_url','','url')+field('Provider minimum organization count, if supplied','minimum_organizations','','number','min="0"')+field('Permitted use / agreed data scope','permitted_use')+'</div><details><summary>Source-wide defaults where a column is absent</summary><div class="grid three">'+field('Currency','currency','USD')+select('Pay period','period',['annual','hourly','monthly','weekly','biweekly','semimonthly','other'],'annual')+field('Amount scale','amount_scale','1')+field('Original effective date','effective_date','','date')+field('Annual hours for hourly amounts','annual_hours')+field('Periods per year for other pay periods','periods_per_year')+field('Publisher','publisher')+field('Survey name','survey_name')+field('Comparison cohort','cohort')+'</div></details><div class="actions"><button class="primary" type="submit">Read source and map columns</button><span class="muted small">UTF-8 · maximum 16 MiB / 100,000 rows</span></div></form></div><div id="mapping-area"></div><div class="panel"><h3>Retained source editions</h3>'+(rows.length?table(['Source / edition','Kind / file','Rows','State','Open'],rows):empty('Import the agreed job, survey and peer files to begin.'))+'</div>';
  if(preview)renderMapping();
}
function renderMapping(){
  if(!preview)return;
  const maps=state.fields[preview.kind].map(k=>select(k,'map:'+k,preview.columns,preview.mapping[k] || '', 'Use source-wide default / leave absent')).join('');
  const errors=preview.errors.length?'<h4>Source corrections</h4><ul class="issues">'+preview.errors.slice(0,40).map(e=>'<li>Row '+h(e.row)+': '+h(e.message)+'</li>').join('')+'</ul>':'';
  $('#mapping-area').innerHTML='<div class="panel"><h3>Column mapping · '+h(preview.row_count)+' rows</h3><p class="mono">Original file SHA-256 '+h(preview.raw_sha256)+'</p><form id="mapping-form"><div class="mapping">'+maps+'</div><div class="actions"><button type="submit">Apply mapping</button>'+button('Import this edition','commit-source',preview.id,true)+'</div></form>'+errors+'<details><summary>Original and normalized rows ('+h(preview.sample_count)+' shown)</summary>'+preview.sample.map(x=>'<div class="source-detail"><strong>Source row '+h(x.row)+'</strong>'+jsonDetail({raw:x.raw,record:x.record,defaults_applied:x.defaults_applied,errors:x.errors})+'</div>').join('')+'</details></div>';
  const commit=$('[data-action="commit-source"]');if(commit)commit.disabled=preview.errors.length>0;
}
async function startSource(form){
  const v=values(form),file=form.elements.file.files[0];if(!file)throw new Error('Choose the original file.');
  if(file.size>16*1024*1024)throw new Error('The original file exceeds 16 MiB.');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
  const defaults={};['currency','period','amount_scale','effective_date','annual_hours','periods_per_year','publisher','survey_name','cohort','source_url'].forEach(k=>{if(v[k])defaults[k]=v[k];});
  sourceDraft={kind:v.kind,text,filename:file.name,source_name:v.source_name,edition:v.edition,delimiter:v.delimiter,metadata:{number_format:v.number_format,source_url:v.source_url,permitted_use:v.permitted_use,minimum_organizations:v.minimum_organizations},defaults};
  const r=await mutate('/api/import/preview',sourceDraft);preview=r.result;renderMapping();note('Original source retained. Review the column mapping and originating rows.');
}
async function showSourceRows(){
  const generation=++sourceSequence;
  const p=await request('/api/source-rows/'+encodeURIComponent(sourceDetail.id)+'?offset='+sourceDetailOffset+'&limit='+pageSize);
  if(generation!==sourceSequence)return;
  const {records,...summary}=sourceDetail;
  const html='<p>'+h(sourceDetail.source_name)+' / '+h(sourceDetail.edition)+'</p>'+button('Resume mapping and import','resume-source',sourceDetail.id)+pager('source',p)+p.items.map(row=>'<div class="source-detail"><strong>Original row '+h(row.row)+'</strong>'+jsonDetail(row)+'</div>').join('')+'<details><summary>Complete source and mapping metadata</summary>'+jsonDetail(summary)+'</details>';
  if($('#detail').open)$('#detail-content').innerHTML='<h3>Retained source edition</h3>'+html;else modal('Retained source edition',html);
}
async function resumeSource(id){
  const source=await request('/api/document/source/'+encodeURIComponent(id));
  const original=await fetch('/api/original/'+encodeURIComponent(id),{cache:'no-store'});if(!original.ok)throw new Error('The retained original source could not be read.');
  sourceDraft={kind:source.kind,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await original.arrayBuffer()),filename:source.filename,source_name:source.source_name,edition:source.edition,delimiter:source.delimiter,metadata:source.metadata,defaults:source.defaults,mapping:source.mapping};
  const {records,...summary}=source;preview={...summary,sample:records.slice(0,30),sample_count:Math.min(30,records.length)};
  if($('#detail').open)$('#detail').close();currentView='sources';await render();note('Original preview reopened. Its source ID, bytes, mapping and existing import outcome are retained.');$('#mapping-area').scrollIntoView({block:'start'});
}
async function readRecord(kind,q,offset){const query=new URLSearchParams({q,offset:String(offset),limit:String(pageSize)});if(kind==='surveys'&&publisherScope){query.set('publisher_kind',publisherScope.kind);query.set('publisher_id',publisherScope.id);query.set('current','false');}return request('/api/records/'+kind+'?'+query);}
function recordDescription(record){if(!record)return empty('Select a record.');const r=record.record;return '<h4>'+h(r.title||r.job_title||r.name)+'</h4><p class="small muted">'+h(record.source_name)+' · '+h(record.edition)+' · '+h(record.record_key)+'</p><div class="record-description">'+h(r.description||'Description is absent from this original record. Use the supplied source context in the match rationale.')+'</div><p class="small">'+h([r.family,r.level,r.geography,r.industry,r.organization_size,r.cohort].filter(Boolean).join(' · '))+'</p>'+button('Full original record','record-detail',record.id);}
function jobDispositionHtml(){
  if(!selectedJob)return '';
  const reviews=(state.job_reviews||[]).filter(r=>r.job_id===selectedJob.id),latest=reviews[0];
  return '<div class="panel"><h3>Job benchmark disposition</h3><p class="muted">Record whether the original role supports a market benchmark before selecting survey matches. A role can remain unpriced while its source or job content is clarified.</p>'+(latest?'<p>Latest: '+badge(latest.outcome)+' · '+h(latest.reviewer)+'</p><p>'+h(latest.rationale)+'</p>':'')+'<form id="job-review-form"><div class="grid">'+field('Reviewer / analyst','reviewer','','text','required')+select('Job disposition','outcome',[{value:'benchmark_candidate',label:'Benchmark candidate'},{value:'non_benchmark',label:'Non-benchmark role'},{value:'needs_source',label:'Additional source or job detail required'}],latest?.outcome||'benchmark_candidate')+'<div class="full">'+area('Job-content assessment and source rationale','rationale','','required')+'</div></div><div class="actions"><button class="primary">Save job disposition</button></div></form>'+(reviews.length?'<details><summary>Original disposition history</summary>'+jsonDetail(reviews)+'</details>':'')+'</div>';
}
async function renderMatches(generation=renderSequence){
  const [jobs,surveys]=await Promise.all([readRecord('jobs',jobsQuery,jobsPage),readRecord('surveys',surveysQuery,surveysPage)]);
  if(generation!==renderSequence||currentView!=='matches')return;
  const jobRows=jobs.items.map(r=>'<tr'+(selectedJob&&selectedJob.id===r.id?' class="selected"':'')+'><td>'+button(r.record.title,'choose-job',r.id)+'<span class="muted">'+h(r.record_key)+'</span></td>'+cell(r.record.family)+cell(r.source_name)+'</tr>');
  const surveyRows=surveys.items.map(r=>'<tr'+(selectedSurvey&&selectedSurvey.id===r.id?' class="selected"':'')+'><td>'+button(r.record.job_title,'choose-survey',r.id)+'<span class="muted">'+h(r.record_key)+'</span></td>'+cell(r.record.cohort||r.record.geography)+cell(number(r.record.p50),'number')+cell(r.record.currency)+'</tr>');
  $('#view').innerHTML=correctionHtml()+publisherScopeHtml()+'<div class="split"><div class="panel"><h3>Current job editions</h3><form id="job-search" class="inline">'+field('Find a job','q',jobsQuery)+'<button>Search</button></form>'+(jobRows.length?table(['Job','Family','Source'],jobRows):empty('No current jobs match.'))+pager('jobs',jobs)+recordDescription(selectedJob)+'</div><div class="panel"><h3>'+h(publisherScope?'Reviewed publisher rows':'Current survey editions')+'</h3><form id="survey-search" class="inline">'+field('Find a survey job, publisher or cut','q',surveysQuery)+'<button>Search</button></form>'+(surveyRows.length?table(['Survey job','Cut','Published median','Currency'],surveyRows):empty('No current survey records match.'))+pager('surveys',surveys)+recordDescription(selectedSurvey)+'</div></div>'+jobDispositionHtml()+'<div class="panel"><h3>Record the professional match decision</h3><p class="muted">Keep the role content, comparison group, source dates and rationale visible. Select multiple source rows as distinct decisions for a weighted comparison.</p><form id="match-form"><div class="grid three">'+field('Job','job_name',selectedJob?selectedJob.record.title:'','text','readonly')+field('Survey row','survey_name',selectedSurvey?selectedSurvey.record.job_title:'','text','readonly')+field('Reviewer / analyst','reviewer','','text','required')+select('Decision','outcome',['selected','excluded'],'selected')+field('Weight','weight','1','number','step="any" min="0.0000001" required')+field('Scope adjustment, percent','scope_adjustment_pct','0','number','step="any" min="-99.99"')+select('Aging method','aging_mode',[{value:'none',label:'None — retain original basis'},{value:'linear',label:'Linear proportional change'},{value:'compound',label:'Compound annual change'}],'none')+field('Annual aging rate, percent','aging_rate_pct','0','number','step="any" min="-99.99"')+field('Day basis for one year','day_basis','365.25','number','step="any" min="1"')+'<div class="full">'+area('Match rationale / original job context','rationale','','required')+'</div><div class="full">'+area('Aging / scope factor source and rationale','factor_rationale')+'</div></div><div class="actions"><button class="primary" '+(!selectedJob||!selectedSurvey?'disabled':'')+'>Save match decision</button>'+button('Continue to market analysis','open-analysis')+'</div></form></div>';
}
function selectedForJob(){return state.selections.filter(s=>selectedJob&&s.job_id===selectedJob.id);}
function renderAnalysis(){
  const selected=selectedForJob(),latestDecision=new Map();
  selected.forEach(s=>{if(!latestDecision.has(s.survey_id))latestDecision.set(s.survey_id,s.id);});
  const rows=selected.map(s=>'<tr><td><label class="check"><input type="checkbox" name="selection_id" value="'+h(s.id)+'"'+(s.outcome==='selected'&&s.current&&latestDecision.get(s.survey_id)===s.id?' checked':'')+(s.outcome!=='selected'?' disabled':'')+'>'+h(s.survey_title||s.survey_id)+'</label><span class="muted">'+h((s.survey_source_name||'')+' / '+(s.survey_edition||''))+'</span></td>'+cell(s.weight)+cell(s.scope_adjustment_pct+'%')+cell(s.aging_mode+' / '+s.aging_rate_pct+'%')+'<td>'+badge(s.current?'current':'source changed')+'<span class="muted">'+h(s.outcome+(latestDecision.get(s.survey_id)===s.id?' · latest decision':' · prior decision'))+'</span></td><td>'+h(s.rationale)+'<span class="muted">'+h(s.reviewer)+'</span></td><td>'+button('Source','record-detail',s.survey_id)+'</td></tr>');
  $('#view').innerHTML=correctionHtml()+'<div class="panel"><h3>'+h(selectedJob?selectedJob.record.title:'Choose a job first')+'</h3>'+(selectedJob?'<p class="muted">'+h(selectedJob.source_name)+' / '+h(selectedJob.edition)+'</p>':button('Open jobs and matches','open-matches'))+'<form id="analysis-form">'+(rows.length?table(['Use / survey row','Weight','Scope','Aging','Source state','Rationale','Open'],rows):empty('Record the source-backed matches for this job in Jobs and matches.'))+'<div class="grid three">'+field('Analysis title','title',selectedJob?selectedJob.record.title+' — market comparison':'','text','required')+field('Common target date, if aging','target_date','','date')+select('Source edition basis','source_mode',[{value:'current',label:'Current imported editions'},{value:'historical',label:'Explicit historical comparison'}],'current')+'<div class="full">'+area('Analysis basis / purpose','basis_note','','required')+'</div></div><div class="actions"><button class="primary" '+(!selectedJob||!rows.length?'disabled':'')+'>Calculate and retain this analysis</button></div></form></div><div id="analysis-result"></div>';
  if(latestAnalysis)renderAnalysisResult(latestAnalysis);
}
function analysisHtml(a,includeReview=true){
  const metrics='<div class="grid three">'+['p25','p50','p75'].map(k=>'<div class="metric"><span>Weighted consensus · '+h(k)+'</span><strong>'+h(a.currency||'')+' '+h(number(a.consensus[k]))+'</strong><span>Annual basis</span></div>').join('')+'</div>';
  const lines=a.lines.map(line=>'<tr><td>'+h(line.survey.record.job_title)+'<span class="muted">'+h(line.survey.source_name)+' · '+h(line.survey.record_key)+'</span></td>'+cell(line.survey.record.effective_date||'Original example/source basis')+cell(line.unit_basis?line.unit_basis.period+' × '+line.unit_basis.period_factor+' × scale '+line.unit_basis.amount_scale:'—')+cell(line.aging_factor,'number')+cell(line.scope_factor,'number')+cell(line.selection.weight,'number')+cell(number((line.annualized_adjusted||{}).p50),'number')+'<td>'+h(line.errors.join('; '))+'</td></tr>');
  let html='<div class="panel"><h3>'+h(a.title)+'</h3><p>'+badge(a.status)+' <span class="small muted">'+h(a.created_at)+'</span></p>'+metrics+'<p class="small muted">'+h(a.method)+' Display amounts are rounded to two decimal places; the full frozen record and exports retain the original precision.</p><p><strong>Basis:</strong> '+h(a.basis_note)+'</p><p class="small">'+h(a.target_date?'Target date '+a.target_date:'Original source basis; no target date selected')+'</p>';
  if(a.receiving_origin)html+='<div class="source-detail"><h4>Original receiving correction</h4><p>'+h(a.receiving_origin.decision.action)+' · '+h(a.receiving_origin.reviewer)+' · '+h(a.receiving_origin.reviewed_at)+'</p><p class="small mono">Previous analysis '+h(a.receiving_origin.prior_analysis_id)+'</p>'+jsonDetail({decision:a.receiving_origin.decision,changes:a.receiving_origin.changes,review:a.receiving_origin.id})+'</div>';
  if(a.reference)html+='<p>Reference annual amount: <strong>'+h(a.currency)+' '+h(number(a.reference.annual_amount))+'</strong> · '+h(number(a.reference_percent_of_consensus.p50))+'% of the selected median-figure consensus.</p>';
  if(a.errors.length)html+='<h4>Corrections required</h4><ul class="issues">'+a.errors.map(x=>'<li>'+h(x)+'</li>').join('')+'</ul>';
  if(a.warnings.length)html+='<details open><summary>Basis and coverage notes</summary><ul class="issues">'+a.warnings.map(x=>'<li>'+h(x)+'</li>').join('')+'</ul></details>';
  html+=table(['Survey row','Effective date','Annualization','Aging factor','Scope factor','Weight','Adjusted median','Issue'],lines)+'<details><summary>Complete frozen source, decisions and calculation</summary>'+jsonDetail(a)+'</details></div>';
  if(includeReview)html+='<div class="panel"><h3>Receiving review</h3><p class="muted">This decision binds the displayed analysis and its original source. Corrections create a new analysis; previous results stay available.</p><form id="review-form" data-id="'+h(a.id)+'" data-sha="'+h(a.result_sha256)+'"><div class="grid">'+field('Reviewer','reviewer','','text','required')+select('Decision','outcome',[{value:'accepted',label:'Accepted for the stated purpose'},{value:'changes_requested',label:'Changes requested'}],a.errors.length?'changes_requested':'accepted')+'<div class="full">'+area('Review notes / exact correction','notes','','required')+'</div></div><div class="actions"><button class="primary">Save receiving review</button></div></form></div>';
  return html;
}
function renderAnalysisResult(a){$('#analysis-result').innerHTML=analysisHtml(a);}
function renderReports(){
  const rows=state.analyses.map(a=>'<tr><td>'+button(a.title,'analysis-detail',a.id)+'<span class="muted">'+h(a.created_at)+'</span></td>'+cell(a.currency+' '+number(a.consensus.p50),'number')+'<td>'+badge(a.latest_review?a.latest_review.outcome:a.status)+'<span class="muted">'+h(a.latest_review?a.latest_review.reviewer:'')+'</span></td><td>'+button('Open and review','review-analysis',a.id)+(a.latest_review&&a.latest_review.outcome==='accepted'?' <a href="/api/report/'+encodeURIComponent(a.id)+'?format=csv">CSV</a> · <a href="/api/report/'+encodeURIComponent(a.id)+'?format=json">Complete JSON</a>':'')+'</td></tr>');
  $('#view').innerHTML='<div class="panel"><h3>Retained analyses and receiving decisions</h3><p class="muted">Each result keeps its original inputs, source editions, professional decisions and exact calculation. Accepted receiving outputs remain tied to that historical state.</p>'+(rows.length?table(['Analysis','Median-figure consensus','Receiving decision','Open / export'],rows):empty('The first saved analysis will appear here.'))+'</div>';
}
async function renderCycles(generation=renderSequence){
  const peers=await readRecord('peers',peersQuery,peersPage);
  if(generation!==renderSequence||currentView!=='cycles')return;
  if(!cycleDraft)cycleDraft={title:'',owner:'',due_date:'',status:'open',participants:[],instructions:'',close_notes:''};
  const c=cycleDraft,used=new Set(c.participants.map(p=>p.peer_id));
  const peerRows=peers.items.map(p=>'<tr><td>'+button(used.has(p.id)?'Selected':'Add','add-peer',p.id)+'</td>'+cell(p.record.name)+cell(p.record.cohort)+cell(p.record.geography)+'</tr>');
  const sourceOptions=state.sources.filter(s=>s.status==='IMPORTED').map(s=>({value:s.id,label:s.source_name+' / '+s.edition}));
  const participantRows=c.participants.map((p,index)=>'<tr><td>'+h(p.name||p.peer_id)+'<span class="muted">'+h(p.cohort||'')+'</span></td><td><select name="status:'+h(p.peer_id)+'">'+options(['planned','invited','received','reviewed','declined','outstanding'],p.status)+'</select></td><td><select name="sources:'+h(p.peer_id)+'" multiple>'+sourceOptions.map(s=>'<option value="'+h(s.value)+'"'+((p.source_ids||[]).includes(s.value)?' selected':'')+'>'+h(s.label)+'</option>').join('')+'</select></td><td><textarea name="notes:'+h(p.peer_id)+'">'+h(p.notes||'')+'</textarea></td><td>'+button('Remove','remove-peer',String(index))+'</td></tr>');
  $('#view').innerHTML='<div class="panel"><div class="inline"><h3>Survey participation cycles</h3>'+button('New cycle','new-cycle')+'</div>'+table(['Cycle','Owner','Due','State','Open'],state.cycles.map(x=>'<tr>'+cell(x.title)+cell(x.owner)+cell(x.due_date)+cell(x.status)+'<td>'+button('Open','open-cycle',x.id)+'</td></tr>'))+'</div><div class="panel"><h3>'+h(c.id?'Edit retained cycle':'Prepare a cycle')+'</h3><form id="cycle-form"><div class="grid three">'+field('Cycle title','title',c.title,'text','required')+field('Receiving owner','owner',c.owner,'text','required')+field('Due date','due_date',c.due_date||'','date')+select('Cycle state','status',['open','closed'],c.status||'open')+'<div class="full">'+area('Questionnaire / participation instructions and source reference','instructions',c.instructions||'')+'</div></div><h4>Selected participants</h4>'+(participantRows.length?table(['Original peer','Status','Received original editions','Notes','Edit'],participantRows):empty('Select participants from the current peer records below.'))+'<div class="grid"><div class="full">'+area('Cycle close / exception disposition','close_notes',c.close_notes||'')+'</div></div><div class="actions"><button class="primary">Save cycle</button></div></form></div><div class="panel"><h3>Current peer records</h3><form id="peer-search" class="inline">'+field('Find a peer or comparison group','q',peersQuery)+'<button>Search</button></form>'+(peerRows.length?table(['Select','Institution','Cohort','Geography'],peerRows):empty('Import the approved peer source to populate this view.'))+pager('peers',peers)+'</div>';
}
function collectCycle(){
  const form=$('#cycle-form');if(!form)return;
  const v=values(form);
  ['title','owner','due_date','status','instructions','close_notes'].forEach(k=>cycleDraft[k]=v[k]||'');
  cycleDraft.participants.forEach(p=>{const key=p.peer_id,sourceField=form.elements.namedItem('sources:'+key);if(sourceField){p.status=v['status:'+key];p.notes=v['notes:'+key]||'';p.source_ids=Array.from(sourceField.selectedOptions).map(o=>o.value);}});
}
async function renderWorkspace(generation=renderSequence){
  const pending=(await pendingAll()).filter(p=>p.workspace_id===state.workspace.id);
  if(generation!==renderSequence||currentView!=='workspace')return;
  $('#view').innerHTML='<div class="panel"><h3>Operating workspace</h3><p class="mono">'+h(state.workspace.id)+'</p><form id="title-form"><div class="grid">'+field('Workspace title','title',state.workspace.title,'text','required')+'</div><div class="actions"><button>Save title</button></div></form><div class="keyline"></div><h4>Complete private save</h4><p class="muted">Save any edited forms first. The native ZIP contains original uploaded source bytes, source editions, matches, analyses, decisions, cycles and operation outcomes. Save it to the receiving location appropriate for those licensed data.</p>'+button('Save complete workspace','backup','',true)+'</div><div class="panel"><h3>Restore to a fresh receiving directory</h3><p class="muted">The archive and destination are paths on the computer running this application. The restored workspace opens through the same CLI; current work stays in this workspace.</p><form id="restore-form"><div class="grid">'+field('Original native ZIP path','package','','text','required')+field('New receiving directory','directory','','text','required')+'</div><div class="actions"><button>Restore original workspace</button></div></form><div id="restore-result"></div></div><div class="panel"><h3>Request recovery</h3><p class="muted">A request retained here has an uncertain response. Resume it unchanged so the native operation can reopen its saved outcome.</p>'+(pending.length?table(['Created','Operation','Action','Recover'],pending.map(p=>'<tr>'+cell(p.created_at)+cell(p.operation_id,'mono')+cell(p.path)+'<td>'+button('Resume original request','resume-request',p.operation_id)+'</td></tr>')):empty('All browser request responses are reconciled.'))+'</div><div class="panel"><h3>Source and operation totals</h3>'+table(['Source kind','Retained rows'],Object.entries(state.counts).map(([k,v])=>'<tr>'+cell(k)+cell(v,'number')+'</tr>'))+'<p class="small muted">Counts include historical editions. The record browsers use complete paginated current-source views.</p></div>';
}

document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.id || form.method==='dialog'||form.closest('.extension-view'))return;
  event.preventDefault();const submit=event.submitter;if(submit)submit.disabled=true;
  try{
    const v=values(form);
    if(form.id==='source-form')await startSource(form);
    else if(form.id==='mapping-form'){
      if(!sourceDraft)throw new Error('Reopen this source from its original file to change the mapping.');
      const mapping={};Object.entries(v).forEach(([k,val])=>{if(k.startsWith('map:'))mapping[k.slice(4)]=val;});
      preview=(await mutate('/api/import/preview',{...sourceDraft,mapping})).result;renderMapping();note('Mapping applied to the retained original source.');
    }else if(form.id==='job-search'){jobsQuery=v.q;jobsPage=0;await render();}
    else if(form.id==='survey-search'){surveysQuery=v.q;surveysPage=0;await render();}
    else if(form.id==='peer-search'){collectCycle();peersQuery=v.q;peersPage=0;await render();}
    else if(form.id==='job-review-form'){
      if(!selectedJob)throw new Error('Select the original job first.');
      await mutate('/api/job-review',{...v,job_id:selectedJob.id});await forgetForm(form);form.reset();await refresh();note('Job benchmark disposition saved with the original job content.');
    }else if(form.id==='match-form'){
      if(!selectedJob||!selectedSurvey)throw new Error('Select the original job and survey row.');
      delete v.job_name;delete v.survey_name;await mutate('/api/selection',{...v,job_id:selectedJob.id,survey_id:selectedSurvey.id,...(publisherScope?{publisher_origin:{kind:publisherScope.kind,id:publisherScope.id}}:{})});await refresh(false);note('Match decision retained. Select another source or continue to the analysis.');
    }else if(form.id==='analysis-form'){
      const selection_ids=$$('input[name="selection_id"]:checked',form).map(e=>e.value);delete v.selection_id;
      latestAnalysis=(await mutate('/api/analysis',{...v,job_id:selectedJob.id,selection_ids,...(pricingCorrection?{receiving_origin:pricingCorrection.origin}:{})})).result;await refresh(false);renderAnalysisResult(latestAnalysis);$('#analysis-result').scrollIntoView({behavior:'smooth',block:'start'});note('Original analysis and its full source calculation are retained.');
    }else if(form.id==='review-form'){
      await mutate('/api/review',{...v,analysis_id:form.dataset.id,result_sha256:form.dataset.sha});await forgetForm(form);await refresh(false);note('Receiving decision saved with this exact analysis.');
    }else if(form.id==='cycle-form'){
      collectCycle();cycleDraft=(await mutate('/api/cycle',{cycle:cycleDraft})).result;await refresh();note('Survey cycle and its original receiving sources are saved.');
    }else if(form.id==='title-form'){
      await mutate('/api/title',{title:v.title});await refresh();note('Workspace title updated.');
    }else if(form.id==='restore-form'){
      const r=await request('/api/restore',v);$('#restore-result').innerHTML='<h4>Restored receiving workspace</h4>'+jsonDetail(r)+'<p>Open it with:</p><pre class="code">python3 cli.py --workspace '+h(JSON.stringify(v.directory))+' serve</pre>';note('The original workspace was restored to its receiving directory.');
    }
  }catch(e){fail(e);}finally{if(submit && submit.isConnected)submit.disabled=false;}
});

document.addEventListener('click',async event=>{
  const nav=event.target.closest('#nav [data-view]');if(nav){if(currentView==='cycles')collectCycle();currentView=nav.dataset.view;try{await render();}catch(e){fail(e);}return;}
  if(event.target.closest('.extension-view'))return;
  const target=event.target.closest('[data-action]');if(!target)return;
  event.preventDefault();const action=target.dataset.action,id=target.dataset.id;target.disabled=true;
  try{
    if(action==='source-detail'){
      sourceDetail=await request('/api/document/source/'+encodeURIComponent(id));sourceDetailOffset=0;await showSourceRows();
    }else if(action==='source-next'||action==='source-previous'){sourceDetailOffset=Math.max(0,sourceDetailOffset+(action.endsWith('next')?pageSize:-pageSize));await showSourceRows();
    }else if(action==='resume-source'){await resumeSource(id);
    }else if(action==='record-detail'){modal('Original record and source',jsonDetail(await request('/api/document/record/'+encodeURIComponent(id))));}
    else if(action==='commit-source'){
      const r=await mutate('/api/import/commit',{preview_id:id});preview=null;sourceDraft=null;await refresh();note('Imported '+r.result.rows+' original rows. '+(r.result.change?JSON.stringify(r.result.change):'The existing edition was reopened.'));
    }else if(action==='choose-job'){selectedJob=await request('/api/document/record/'+encodeURIComponent(id));if(pricingCorrection&&(selectedJob.source_key!==pricingCorrection.job_source_key||selectedJob.record_key!==pricingCorrection.job_record_key))pricingCorrection=null;latestAnalysis=null;await render();}
    else if(action==='choose-survey'){selectedSurvey=await request('/api/document/record/'+encodeURIComponent(id));await render();}
    else if(action==='open-analysis'){currentView='analysis';await render();}
    else if(action==='open-matches'){currentView='matches';await render();}
    else if(action==='open-publisher'){currentView='publisher';await render();}
    else if(action==='open-receiving'){currentView='receiving';await render();}
    else if(action==='clear-publisher-scope'){publisherScope=null;selectedSurvey=null;surveysPage=0;await render();}
    else if(action==='clear-correction'){pricingCorrection=null;await render();note('Independent analysis context reopened. The saved receiving review remains in Receiving.');}
    else if(action==='correction-detail'){if(!pricingCorrection)throw new Error('Open a saved receiving correction.');const origin=pricingCorrection.origin;modal('Original saved receiving review',jsonDetail(await request('/api/extensions/receiving/document/'+encodeURIComponent(origin.kind)+'/'+encodeURIComponent(origin.id))));}
    else if(action==='jobs-next'||action==='jobs-previous'){jobsPage=Math.max(0,jobsPage+(action.endsWith('next')?pageSize:-pageSize));await render();}
    else if(action==='surveys-next'||action==='surveys-previous'){surveysPage=Math.max(0,surveysPage+(action.endsWith('next')?pageSize:-pageSize));await render();}
    else if(action==='peers-next'||action==='peers-previous'){collectCycle();peersPage=Math.max(0,peersPage+(action.endsWith('next')?pageSize:-pageSize));await render();}
    else if(action==='analysis-detail'){const a=await request('/api/document/analysis/'+encodeURIComponent(id));modal('Retained analysis',analysisHtml(a,false));}
    else if(action==='review-analysis'){latestAnalysis=await request('/api/document/analysis/'+encodeURIComponent(id));pricingCorrection=null;selectedJob=latestAnalysis.job;currentView='analysis';await render();}
    else if(action==='new-cycle'){collectCycle();cycleDraft=null;await render();}
    else if(action==='open-cycle'){collectCycle();cycleDraft=await request('/api/document/cycle/'+encodeURIComponent(id));await render();}
    else if(action==='add-peer'){
      collectCycle();const p=await request('/api/document/record/'+encodeURIComponent(id));if(!cycleDraft.participants.some(x=>x.peer_id===id))cycleDraft.participants.push({peer_id:id,name:p.record.name,cohort:p.record.cohort,status:'planned',source_ids:[],notes:''});await render();
    }else if(action==='remove-peer'){collectCycle();cycleDraft.participants.splice(Number(id),1);await render();}
    else if(action==='backup'){
      const result=await mutate('/api/backup',{});const a=document.createElement('a');a.href='/api/backup/'+encodeURIComponent(result.result.id);a.download=result.result.id+'.zip';a.click();note('The complete native snapshot is preparing for download. The same backup ID reopens the original saved file.');await refresh(false);
    }else if(action==='resume-request'){
      const saved=(await pendingAll()).find(p=>p.operation_id===id&&p.workspace_id===state.workspace.id);if(!saved)throw new Error('Original saved request is absent.');const r=await mutate(saved.path,null,saved);await refresh();note('Original request reconciled'+(r.replayed?' from its saved native outcome.':'.'));modal('Recovered original result',jsonDetail(r));
    }
  }catch(e){fail(e);}finally{if(target.isConnected)target.disabled=false;}
});
$('#refresh').addEventListener('click',()=>refresh().then(()=>note('Current workspace data loaded.')).catch(fail));
refresh().then(async()=>{const n=(await pendingAll()).filter(p=>p.workspace_id===state.workspace.id).length;if(n)note(n+' original request(s) await response reconciliation in Workspace.');}).catch(fail);
