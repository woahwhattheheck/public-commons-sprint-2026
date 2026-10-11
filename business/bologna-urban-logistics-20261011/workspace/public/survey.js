'use strict';
const $ = s => document.querySelector(s);
const node = (tag, text, props = {}) => Object.assign(document.createElement(tag), {textContent: text ?? '', ...props});
let data, review, sourcePayload, selectedId = '', page = 0, dirty = false, busy = false;
let filters = {}, selectedEvidence = new Set(), evidenceVersions = new Map(), selectedDigest = "";
const dirtyForms = new Set();
const PAGE_SIZE = 20;
function message(text, error = false) { $('#message').textContent = text; $('#message').dataset.error = String(error); }
async function request(url, payload) {
  const response = await fetch(url, payload === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result = await response.json();
  if (!response.ok) throw Error(result.message || result.error || `HTTP ${response.status}`);
  return result;
}
function values(form) { return Object.fromEntries(new FormData(form)); }
function selectOptions(element, items, emptyLabel) {
  const previous = element.value;
  const selected = new Set([...element.selectedOptions].map(x=>x.value));
  element.replaceChildren();
  if (emptyLabel !== undefined) element.append(node('option',emptyLabel,{value:''}));
  for (const [value,label] of items) element.append(node('option',label,{value}));
  if (element.multiple) [...element.options].forEach(o=>o.selected=selected.has(o.value));
  else if ([...element.options].some(x=>x.value===previous)) element.value=previous;
}
function fill(form, object) { for (const [key,value] of Object.entries(object || {})) if (form.elements.namedItem(key)) form.elements.namedItem(key).value=value ?? ''; }
function metrics(element, entries) { element.replaceChildren(...entries.map(([value,label])=>{const div=node('div','',{className:'metric'});div.append(node('strong',value),node('span',label));return div;})); }
function table(headers, rows) {
  const t=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
  headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head,body);
  for (const cells of rows) {const r=node('tr');for(const cell of cells){const td=node('td');td.append(cell instanceof Node ? cell : document.createTextNode(cell ?? '—'));r.append(td);}body.append(r);}
  if (!rows.length) {const r=node('tr'),td=node('td','No records');td.colSpan=headers.length;r.append(td);body.append(r);}
  return t;
}
function details(label, value) {const d=node('details');d.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));return d;}
async function perform(form, payload, revision) {
  if (busy) return;
  busy=true; const buttons=[...form.querySelectorAll('button')];buttons.forEach(x=>x.disabled=true);
  try {
    const result=await request('/api/action',{...payload,expectedRevision:revision ?? data.revision});
    dirtyForms.delete(form.id);
    if(payload.action==='survey.import')dirtyForms.delete('preview-form');
    dirty=dirtyForms.size>0;
    data=await request(`/api/survey?${new URLSearchParams(filters)}`);render(false);
    message(`Saved · ${result.result.event} · workspace revision ${data.revision}`);
    return result;
  } catch(error){message(error.message,true);return null;}
  finally{busy=false;buttons.forEach(x=>x.disabled=false);}
}
async function refresh(initial=false) {
  if (!initial && dirty && !confirm('Refresh saved state and discard unsaved form edits?')) return;
  try{data=await request('/api/survey');filters={};dirtyForms.clear();render(true);dirty=false;review=null;$('#preview').hidden=true;message('');}
  catch(error){message(error.message,true);}
}
function render(forms=false) {
  $('#revision').textContent=`Saved revision ${data.revision}`;
  const a=data.analysis;
  metrics($('#metrics'),[[a.includedCompleted,'Target-cohort completed'],[`${a.targetMin}–${a.targetMax}`,'Collection target'],[a.includedIncomplete,'Included incomplete'],[a.excluded,'Excluded']]);
  $('#cohort-note').textContent=`Target cohort: ${a.targetCohort}. ${a.remainingToMinimum} additional completed responses to reach the minimum. ${a.allCohortsCompleted} completed responses across all cohorts.`;
  $('#sources').replaceChildren(...data.imports.map(x=>{const d=node('div');d.append(node('p',`${x.filename} · ${x.importedAt}`),node('p',x.sourceSha256,{className:'mono'}),node('a','Download exact retained CSV',{href:`/api/survey/source?id=${encodeURIComponent(x.id)}`}));return d;}));
  if(!data.imports.length)$('#sources').textContent='No response source has been imported.';
  $('#cohorts').replaceChildren(table(['Cohort','Completed'],a.cohorts.map(x=>[x.id,x.completed])));
  $('#questionnaire-id').textContent=`${data.questionnaire.id} · ${data.questionnaire.status} · cohort ${data.questionnaire.cohortId || 'current'}`;
  if(forms) {
    fill($('#campaign-form'),{...data.campaign,targetCohort:a.targetCohort});fill($('#questionnaire-form'),data.questionnaire);
    $('#question-wording').replaceChildren(...Object.entries(data.questionnaire.questions).map(([key,text])=>{const label=node('label',data.schema.labels[key][1]);label.append(node('textarea','',{name:`q.${key}`,value:text,rows:2,required:true,maxLength:500}));return label;}));
  }
  selectOptions($('#filter-cohort'),a.cohorts.map(x=>[x.id,x.id]));$('#filter-cohort').append(node('option','All cohorts · combined view',{value:'all'}));$('#filter-cohort').value=filters.cohort || a.targetCohort;
  selectOptions($('#filter-street'),Object.entries(data.schema.options.streets).map(([id,labels])=>[id,labels[1]]),'All streets');
  selectOptions($('#filter-role'),Object.entries(data.schema.options.role).map(([id,labels])=>[id,labels[1]]),'All roles');
  selectOptions($('#finding-scenarios'),data.scenarios.map(x=>[x.id,`${x.id} · ${x.name.en}`]));
  selectOptions($('#finding-decisions'),data.decisions.map(x=>[x.id,`${x.id} · ${x.subject}`]));
  $('#theme-list').replaceChildren(...data.themes.map(t=>{const b=node('button',`${t.id} · ${t.it} / ${t.en}`,{type:'button'});b.onclick=()=>{fill($('#theme-form'),t);dirtyForms.add('theme-form');dirty=true;};return b;}));
  selectOptions($('#publication-source'),data.publications.map(x=>[x.id,`${x.name} · revision ${x.workspaceRevision}`]),'Current filtered analysis');
  renderResponses();renderDetail();renderAnalysis(data.analysis);links();
}
function renderResponses() {
  const search=$('#response-search').value.toLowerCase(), inclusion=$('#response-inclusion').value;
  const matches=data.responses.filter(r=>(inclusion==='all'||(inclusion==='included')===(r.included!==false)) && `${r.respondentId} ${r.role} ${r.note||''} ${r.constraint||''}`.toLowerCase().includes(search));
  page=Math.min(page,Math.max(0,Math.ceil(matches.length/PAGE_SIZE)-1));
  $('#responses').replaceChildren(table(['Evidence','Response','Status','Role','Cohort'],matches.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(r=>{
    const box=node('input','',{type:'checkbox',checked:selectedEvidence.has(r.respondentId)});box.setAttribute('aria-label',`Evidence ${r.respondentId}`);box.onchange=()=>{box.checked?selectedEvidence.add(r.respondentId):selectedEvidence.delete(r.respondentId);box.checked?evidenceVersions.set(r.respondentId,r.contentSha256):evidenceVersions.delete(r.respondentId);dirtyForms.add('finding-form');$('#selected-count').textContent=`${selectedEvidence.size} responses selected for a finding`;dirty=true;};
    const b=node('button',r.respondentId,{type:'button'});b.onclick=()=>{if(selectedId!==r.respondentId && (dirtyForms.has('coding-form')||dirtyForms.has('inclusion-form')) && !confirm('Discard unsaved coding/inclusion edits for the previous response?'))return;dirtyForms.delete('coding-form');dirtyForms.delete('inclusion-form');selectedDigest=r.contentSha256;selectedId=r.respondentId;renderDetail();};
    return [box,b,r.included===false?'Excluded':r.complete===false?'Incomplete':'Included complete',r.role,r.cohortId||'current'];
  })));
  $('#page-position').textContent=`${matches.length ? page*PAGE_SIZE+1 : 0}–${Math.min((page+1)*PAGE_SIZE,matches.length)} of ${matches.length}`;
  $('#previous').disabled=page===0;$('#next').disabled=(page+1)*PAGE_SIZE>=matches.length;
  $('#selected-count').textContent=`${selectedEvidence.size} responses selected for a finding`;
}
function renderDetail() {
  const r=data.responses.find(x=>x.respondentId===selectedId);
  $('#selected-title').textContent=r ? r.respondentId : 'Choose a response';$('#response-controls').hidden=!r;$('#response-detail').replaceChildren();
  if(!r)return;
  $('#response-detail').append(node('p',`Questionnaire ${r.questionnaireId||'legacy'} · ${r.cohortId||'current'} · ${r.collectedOn||'collection date unrecorded'}`),node('p',r.note||'No additional observation'),details('Complete current response',r),details('Retained corrections and reviews',data.history.filter(x=>x.respondentId===selectedId)));
  if(r.source)$('#response-detail').append(node('a','Exact original source',{href:`/api/survey/source?id=${encodeURIComponent(r.source.importId)}`}));
  if(!dirtyForms.has('coding-form') && !dirtyForms.has('inclusion-form'))selectedDigest=r.contentSha256;
  if(!dirtyForms.has('inclusion-form'))$('#inclusion-form').elements.included.value=String(r.included!==false);
  const codingDraft=dirtyForms.has('coding-form') ? {note:$('#coding-form').elements.note.value,themes:[...$('#coding-form').querySelectorAll('input[name=theme]:checked')].map(x=>x.value)} : null;
  $('#coding-themes').replaceChildren(...data.themes.map(t=>{const l=node('label',`${t.it} / ${t.en}`,{className:'check'});l.prepend(node('input','',{type:'checkbox',name:'theme',value:t.id,checked:(codingDraft?.themes||r.coding?.themes||[]).includes(t.id)}));return l;}));
  $('#coding-form').elements.note.value=codingDraft?.note ?? r.coding?.note ?? '';
  if(r.coding && !r.codingCurrent)$('#response-detail').prepend(node('p','Coding needs review: the source response changed.'));
}
function renderAnalysis(a) {
  $('#methods').textContent=a.methods.en;
  metrics($('#analysis-summary'),[[a.selectedCompleted,'Selected complete responses'],[a.coding.current,'Current coded responses'],[a.coding.needsReview,'Coding reviews needed'],[a.deliveries.missing,'Missing delivery frequency']]);
  $('#analysis-tables').replaceChildren(...Object.entries(a.tables).map(([field,t])=>{
    const section=node('section'),wrap=node('div','',{className:'table-scroll'});section.append(node('h3',data.schema.labels[field][1]),node('p',`Answered ${t.answered} / eligible ${t.eligible}; missing ${t.missing}.${t.multiSelect?' Multiple selections; percentages are non-additive.':''}`));
    wrap.append(table(['Category','n','% of answered'],t.rows.map(r=>[r.en,r.count,r.percentOfAnswered??'—'])));section.append(wrap);return section;
  }));
  $('#analysis-tables').append(node('h3','Reported weekly delivery frequency'),table(['Answered','Missing','Median','Mean','Min','Max'],[[a.deliveries.answered,a.deliveries.missing,a.deliveries.median,a.deliveries.mean,a.deliveries.min,a.deliveries.max]]));
  $('#analysis-findings').replaceChildren(table(['Theme','n','Coded denominator'],a.themes.map(t=>[t.en,t.count,t.codedResponses])));
  for(const f of a.findings){const d=node('div','',{className:'finding'});d.append(node('h4',`${f.id} · revision ${f.revision} · ${f.status}`),node('p',f.it),node('p',f.en),node('p',`${f.evidenceCount} references; ${f.changedReferences} changed. Findings retain their original unfiltered evidence selection.`));const edit=node('button','Review / revise finding',{type:'button'});edit.onclick=()=>{const full=data.findings.find(x=>x.id===f.id);fill($('#finding-form'),full);selectedEvidence=new Set(full.evidence.map(x=>x.respondentId));evidenceVersions=new Map(full.evidence.map(x=>[x.respondentId,x.responseSha256]));dirtyForms.add('finding-form');for(const [sel,ids] of [['#finding-scenarios',full.scenarioIds],['#finding-decisions',full.decisionIds]])[...$(sel).options].forEach(o=>o.selected=ids.includes(o.value));setTab('review');renderResponses();dirty=true;};d.append(edit);$('#analysis-findings').append(d);}
}
function links() {
  const publication=$('#publication-source').value;
  const params=new URLSearchParams(publication?{publication}:filters);
  $('#report-zip').href=`/api/survey/export?${params}`;
  for(const lang of ['it','en']){const q=new URLSearchParams(params);q.set('language',lang);$(`#report-${lang}`).href=`/api/survey/report?${q}`;}
}
function setTab(id) {document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!==id);document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===id)));}
function encode(buffer){let binary='';for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);return btoa(binary);}
function renderPreview() {
  $('#preview').hidden=false;$('#preview-title').textContent=`${review.rows.length} rows · ${Object.entries(review.counts).map(([s,n])=>`${n} ${s.toLowerCase()}`).join(' · ')}`;
  $('#preview-source').textContent=`${review.filename} · ${review.sourceBytes} bytes · SHA256 ${review.sourceSha256} · reviewed revision ${review.workspaceRevision}`;
  $('#preview-rows').replaceChildren(table(['Row / line','Response','Status','Source review','Decision'],review.rows.map(r=>{
    const options={NEW:['skip','add'],CORRECTION:['skip','replace'],SAME:['skip'],INVALID:['skip']}[r.status];const select=node('select');select.dataset.row=String(r.row);select.setAttribute('aria-label',`Decision row ${r.row}`);options.forEach(o=>select.append(node('option',o,{value:o})));
    const detail=details(r.errors.length?r.errors.join('; '):'Before / after',{before:r.before,after:r.response,errors:r.errors});
    return [`${r.row} / ${r.endLine}`,r.response?.respondentId||r.respondentId,r.status,detail,select];
  })));
}
$('#refresh').onclick=()=>refresh();
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
document.querySelectorAll('form').forEach(f=>f.addEventListener('input',()=>{dirty=true;dirtyForms.add(f.id);}));
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
$('#campaign-form').onsubmit=async e=>{e.preventDefault();await perform(e.currentTarget,{action:'survey.campaign',...values(e.currentTarget)});};
$('#questionnaire-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,p=values(form),questions={};for(const key of Object.keys(p))if(key.startsWith('q.')){questions[key.slice(2)]=p[key];delete p[key];}await perform(form,{action:'survey.questionnaire',...p,questions});};
$('#preview-form').onsubmit=async e=>{e.preventDefault();const file=$('#source-file').files[0];try{if(!file||file.size>data.schema.maxBytes)throw Error('Select a CSV of at most 512 KiB.');sourcePayload={filename:file.name,csvBase64:encode(await file.arrayBuffer())};review=await request('/api/survey/preview',sourcePayload);renderPreview();message('Preview ready. Review row decisions before committing.');}catch(error){review=null;$('#preview').hidden=true;message(error.message,true);}};
$('#source-file').onchange=()=>{review=null;$('#preview').hidden=true;$('#file-info').textContent=$('#source-file').files[0]?.name||'';};
$('#select-new').onclick=()=>{for(const r of review.rows)if(r.status==='NEW')$(`#preview-rows select[data-row="${r.row}"]`).value='add';dirty=true;};
$('#commit-form').onsubmit=async e=>{e.preventDefault();if(!review)return;const form=e.currentTarget,choices={};$('#preview-rows').querySelectorAll('select').forEach(x=>choices[x.dataset.row]=x.value);const result=await perform(form,{action:'survey.import',...sourcePayload,...values(form),nonIdentifyingReviewed:form.elements.nonIdentifyingReviewed.checked,choices,reviewToken:review.reviewToken},review.workspaceRevision);if(result){review=null;$('#preview').hidden=true;}};
for(const id of ['response-search','response-inclusion'])$(`#${id}`).addEventListener(id==='response-search'?'input':'change',()=>{page=0;renderResponses();});
$('#previous').onclick=()=>{page--;renderResponses();};$('#next').onclick=()=>{page++;renderResponses();};
$('#inclusion-form').onsubmit=async e=>{e.preventDefault();const p=values(e.currentTarget);await perform(e.currentTarget,{action:'survey.inclusion',...p,included:p.included==='true',respondentId:selectedId,expectedResponseSha256:selectedDigest});};
$('#coding-form').onsubmit=async e=>{e.preventDefault();await perform(e.currentTarget,{action:'survey.code',...values(e.currentTarget),themes:[...e.currentTarget.querySelectorAll('input[name=theme]:checked')].map(x=>x.value),respondentId:selectedId,expectedResponseSha256:selectedDigest});};
$('#theme-form').onsubmit=async e=>{e.preventDefault();await perform(e.currentTarget,{action:'survey.theme',...values(e.currentTarget)});};
$('#finding-form').onsubmit=async e=>{e.preventDefault();await perform(e.currentTarget,{action:'survey.finding',...values(e.currentTarget),respondentIds:[...selectedEvidence],expectedEvidence:Object.fromEntries([...selectedEvidence].map(id=>[id,evidenceVersions.get(id)])),scenarioIds:[...$('#finding-scenarios').selectedOptions].map(x=>x.value),decisionIds:[...$('#finding-decisions').selectedOptions].map(x=>x.value)});};
$('#analysis-form').onsubmit=async e=>{e.preventDefault();filters={cohort:$('#filter-cohort').value,street:$('#filter-street').value,role:$('#filter-role').value};try{const result=await request(`/api/survey?${new URLSearchParams(filters)}`);renderAnalysis(result.analysis);$('#publication-source').value='';links();message('Selected cohort and filters applied.');}catch(error){message(error.message,true);}};
$('#publication-source').onchange=links;
$('#publish-form').onsubmit=async e=>{e.preventDefault();if([...dirtyForms].some(id=>id!=='publish-form') && !confirm('Publish the saved assessment? Unsubmitted edits in other forms are not part of this snapshot.'))return;const result=await perform(e.currentTarget,{action:'publish',...values(e.currentTarget)});if(result){$('#publication-source').value=result.result.id;links();}};
refresh(true);
