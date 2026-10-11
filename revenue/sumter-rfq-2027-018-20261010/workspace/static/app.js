'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}
[c]));
const label=k=>String(k).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const stamp=v=>new Date(v).toLocaleString();
const S={
  user:null,csrf:'',dashboard:null,project:null,tab:'authoring',library:null,pending:{
  }
  ,release:null,releaseProject:null}
;
const say=(message,error=false)=>{
  $('#notice').textContent=message;
  $('#notice').className=error?'error':'';
}
;
async function api(path,data){
  const response=await fetch(path,{
    method:data===undefined?'GET':'POST',headers:data===undefined?{
    }
    :{
      'Content-Type':'application/json','X-CSRF-Token':S.csrf}
    ,body:data===undefined?undefined:JSON.stringify(data)}
  );
  const value=await response.json();
  if(!response.ok){
    const error=new Error(value.error||'The request could not complete.');
    error.detail=value.detail;
    throw error;
  }
  return value;
}
const guard=fn=>async event=>{
  const button=event?.currentTarget?.tagName==='BUTTON'?event.currentTarget:null;
  if(button)button.disabled=true;
  try{
    await fn(event);
  }
  catch(e){
    say(e.message,true);
  }
  finally{
    if(button)button.disabled=false;
  }
}
;
function clicks(selector,fn){
  $$(selector).forEach(button=>{
    button._handlers??=new Map();
    const previous=button._handlers.get(selector);
    if(previous)button.removeEventListener('click',previous);
    const handler=guard(event=>fn(button,event));
    button._handlers.set(selector,handler);
    button.addEventListener('click',handler);
  }
  );
}
function form(selector,fn){
  const f=$(selector);
  if(f)f.addEventListener('submit',guard(async event=>{
    event.preventDefault();
    const button=f.querySelector('button[type=submit],button:not([type])');
    if(button)button.disabled=true;
    try{
      await fn(new FormData(f),f);
    }
    finally{
      if(button)button.disabled=false;
    }
  }
  ));
}
const options=(items,selected)=>items.map(item=>`<option value="${h(item.value)}" ${String(item.value)===String(selected)?'selected':''}>${h(item.label)}</option>`).join('');
const usersOptions=selected=>S.dashboard.users.filter(u=>u.active).map(u=>`<option value="${h(u.id)}" ${selected.includes(u.id)?'selected':''}>${h(u.name)}</option>`).join('');
const name=id=>S.dashboard?.users.find(u=>u.id===id)?.name||id;
const pinVersions=(key,revision,kind='template')=>{
  const current=S.dashboard.library.find(r=>r.kind===kind&&r.key===key);
  return options(Array.from({
    length:current?.revision||revision}
  ,(_,i)=>({
    value:i+1,label:'Revision '+(i+1)+(i+1===current?.revision?' · latest':'')}
  )),revision);
}
;
function captureFields(){
  if(!S.project)return;
  $$('#fields-form [data-field]').forEach(input=>{
    const key=S.project.id+':'+input.dataset.field;
    const original=S.project.document.fields[input.dataset.field]||'';
    if(input.value!==original)S.pending[key]=input.value;
    else delete S.pending[key];
  }
  );
}
function identity(){
  $('#identity').innerHTML=S.user?`<span>${h(S.user.name)} · ${h(S.user.role)}</span><button id="logout">Sign out</button>`:'';
  clicks('#logout',async()=>{
    await api('/api/logout',{
    }
    );
    S.user=null;
    S.csrf='';
    S.pending={
    }
    ;
    login();
  }
  );
  $$('header nav button').forEach(b=>b.hidden=!S.user);
}
function login(){
  identity();
  $('#app').innerHTML=`<section class="panel login"><h1>Staff sign-in</h1><p class="help">Use the named operator created for this private workspace.</p><form id="login"><label>Operator name<input name="name" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Sign in</button></form></section>`;
  form('#login',async data=>{
    const result=await api('/api/login',Object.fromEntries(data));
    S.user=result.user;
    S.csrf=result.csrf;
    say('Signed in.');
    await load();
  }
  );
}
async function load(){
  S.dashboard=await api('/api/dashboard');
  S.user=S.dashboard.user;
  identity();
  const params=new URLSearchParams(location.search);
  if(params.get('project'))await openProject(params.get('project'),params.get('tab')||'authoring');
  else projects();
}
async function refreshDashboard(){
  S.dashboard=await api('/api/dashboard');
  S.user=S.dashboard.user;
  identity();
}
function navigation(page){
  captureFields();
  if(page==='projects')projects();
  if(page==='library')library();
  if(page==='operators')operators();
}
clicks('[data-nav]',button=>navigation(button.dataset.nav));
function projects(){
  history.replaceState({
  }
  ,'',location.pathname);
  $('#app').innerHTML=`<div class="heading"><div><h1>Implementation projects</h1><p class="muted">Author, review and deliver solicitations and contract records.</p></div><a class="download" href="/api/export" ${S.user.role==='admin'?'':'hidden'}>Transfer complete workspace</a></div><div class="split"><section class="panel"><h2>New project</h2><form id="new-project"><label>Project title<input name="title" required maxlength="500"></label><label>Project type<select name="kind"><option value="solicitation">Solicitation</option><option value="contract">Contract record</option></select></label><label>Starting template<select name="template">${options(S.dashboard.library.filter(r=>r.kind==='template').map(r=>({
    value:r.key,label:r.payload.title}
  )),'request-for-proposal')}</select></label><label>Use<select name="mode"><option value="operator">Operator source content</option><option value="demonstration">Clearly marked demonstration</option></select></label><p class="help">Select further templates and assign reviewers inside the project.</p><button class="primary" ${['admin','author'].includes(S.user.role)?'':'disabled'}>Create project</button></form></section><section class="panel"><h2>Retained projects</h2>${S.dashboard.projects.length?S.dashboard.projects.map(p=>`<button class="record" data-project="${h(p.id)}"><strong>${h(p.title)}</strong><small>${h(p.kind)} · ${h(p.state)} · revision${p.revision} · ${h(stamp(p.updated))}</small></button>`).join(''):'<p class="empty">Create the first implementation project.</p>'}</section></div>`;
  clicks('[data-project]',b=>openProject(b.dataset.project));
  form('#new-project',async data=>{
    const t=S.dashboard.library.find(t=>t.kind==='template'&&t.key===data.get('template'));
    const p=await api('/api/projects',{
      title:data.get('title'),kind:data.get('kind'),mode:data.get('mode'),templates:[{
        key:t.key,revision:t.revision,visibility:'internal'}
      ]}
    );
    await refreshDashboard();
    await openProject(p.id);
    say('Project created with the selected original template.');
  }
  );
}
async function openProject(id,tab=S.tab,revision){
  captureFields();
  S.project=await api('/api/projects/'+encodeURIComponent(id)+(revision?'?revision='+revision:''));
  S.tab=tab;
  S.release=null;
  S.releaseProject=null;
  history.replaceState({
  }
  ,'',`?project=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}`);
  renderProject();
}
async function updateProject(value){
  captureFields();
  S.project=value?.document?value:await api('/api/projects/'+S.project.id);
  await refreshDashboard();
  renderProject();
}
const currentEditable=()=>S.project.selected_revision===S.project.revision&&!['archived','released'].includes(S.project.state)&&['admin','author'].includes(S.project.role);
async function saveSections(changes,note){
  const revision=S.project.selected_revision;
  const result=await api('/api/projects/'+S.project.id+'/save',{
    revision,changes,note}
  );
  for(const key of Object.keys(changes)){
    if(key.startsWith('field:'))delete S.pending[S.project.id+':'+key.slice(6)];
  }
  S.project=result.document?result:await api('/api/projects/'+S.project.id);
  await refreshDashboard();
  renderProject();
  say(result.unchanged?'No content changed.':'Revision '+S.project.revision+' saved. Its configured reviewers can inspect the exact content.');
}
function renderProject(){
  const p=S.project;
  $('#app').innerHTML=`<div class="heading"><div><h1>${h(p.title)}</h1><p class="muted">${h(p.kind)} · ${h(p.state)} · revision${p.selected_revision}${p.selected_revision!==p.revision?' of'+p.revision+' — historical view':''} · your role: ${h(p.role)}${p.document.mode==='demonstration'?' · DEMONSTRATION':''}</p></div><div class="actions"><button id="show-preview">Preview rendered copy</button><button id="refresh-project">Open current revision</button></div></div><nav class="tabbar" aria-label="Project">${['authoring','sources','reviews','releases','history','access'].map(tab=>`<button data-tab="${tab}" aria-current="${S.tab===tab}">${label(tab)}</button>`).join('')}</nav><div id="project-panel"></div>`;
  clicks('[data-tab]',b=>{
    captureFields();
    S.tab=b.dataset.tab;
    history.replaceState({
    }
    ,'',`?project=${p.id}&tab=${S.tab}`);
    renderProject();
  }
  );
  clicks('#refresh-project',()=>openProject(p.id,S.tab));
  clicks('#show-preview',async()=>{
    captureFields();
    const result=await api('/api/projects/'+p.id+'/preview?revision='+p.selected_revision);
    $('#project-panel').innerHTML=`<section class="panel"><h2>Rendered revision${result.revision}</h2><p>${result.map.unresolvedCount} unresolved references across${result.map.templates.length} selected templates.</p><p class="help">This view uses saved source content. Save any field changes before regenerating it.</p>${Object.entries(result.documents).map(([id,text])=>`<details><summary>${h(result.map.templates.find(t=>t.id===id).title)}</summary><pre>${h(text)}</pre></details>`).join('')}</section>`;
  }
  );
  ({
    authoring:authoring,sources:sources,reviews:reviews,releases:releases,history:projectHistory,access:access}
  )[S.tab]();
}
function selectedBlueprints(){
  return S.project.library_records.filter(r=>r.kind==='template');
}
function authoring(){
  const p=S.project,doc=p.document,disabled=currentEditable()?'':'disabled';
  const fieldInfo=new Map([['agency','Agency'],['project_title','Project title'],['solicitation_id','Solicitation identifier'],['procurement_contact','Procurement contact'],['approved_submission_instructions','Approved submission or handling instructions']]);
  for(const record of selectedBlueprints()){
    record.payload.required_fields.forEach(k=>{
      if(!fieldInfo.has(k))fieldInfo.set(k,label(k));
    }
    );
    record.payload.sections.forEach(s=>fieldInfo.set(s.field,s.heading));
  }
  const clauseKeys=[...new Set(selectedBlueprints().flatMap(r=>r.payload.approved_clause_keys))];
  $('#project-panel').innerHTML=`<details class="panel"><summary>Selected templates and publication scope</summary><form id="templates-form">${S.dashboard.library.filter(r=>r.kind==='template').map(t=>{
    const s=doc.templates.find(s=>s.key===t.key);
    return `<div class="row" data-template="${h(t.key)}"><input type="checkbox" aria-label="Select ${h(t.payload.title)}" ${s?'checked':''} ${disabled}><div class="grow"><strong>${h(t.payload.title)}</strong><p class="help">${h(t.payload.purpose)}</p></div><select data-revision aria-label="Template revision" ${disabled}>${pinVersions(t.key,s?.revision||t.revision)}</select><select data-visibility aria-label="Publication scope" ${disabled}>${options([{
      value:'internal',label:'Internal handover'}
    ,{
      value:'public',label:'Include in public copy'}
    ],s?.visibility||'internal')}</select></div>`;
  }
  ).join('')}<div class="form-end"><label>Revision note<input name="note" required ${disabled}></label><button class="primary" ${disabled}>Save selection</button></div></form></details><section class="panel"><h2>Project content</h2><form id="fields-form"><div class="fields">${[...fieldInfo].map(([key,title])=>{
    const owner=p.locks.find(l=>l.section==='field:'+key),blocked=owner&&owner.user_id!==S.user.id;
    return `<div class="field ${['approved_submission_instructions','purchase_scope','business_problem'].includes(key)?'wide':''}"><div class="section-top"><label for="field-${h(key)}">${h(title)}<small>${owner?'Locked by '+h(owner.name):'Available to project authors'}</small></label><button type="button" data-lock="${h(key)}" data-locked="${!!owner}" ${['admin','author'].includes(p.role)?'':'disabled'}>${owner?'Release lock':'Lock section'}</button></div><textarea id="field-${h(key)}" data-field="${h(key)}" ${disabled||blocked?'disabled':''}>${h(S.pending[p.id+':'+key]??doc.fields[key]??'')}</textarea></div>`;
  }
  ).join('')}</div><div class="form-end"><label>Revision note<input name="note" required ${disabled}></label><button class="primary" ${disabled}>Save content</button></div></form></section><section class="panel"><h2>Source clauses</h2><p class="help">Pin the exact locally reviewed clause revisions for this project.</p><form id="clauses-form">${clauseKeys.map(key=>{
    const item=S.dashboard.library.find(r=>r.kind==='clause'&&r.key===key);
    return `<div class="map-row"><label>${h(label(key))}</label><div class="actions">${item?`<select data-clause="${h(key)}" ${disabled}><option value="">Choose a reviewed revision</option>${pinVersions(key,doc.clauses[key]||'', 'clause')}</select><button type="button" data-library="${h(key)}" data-kind="clause">Inspect source</button>`:`<span class="help">No clause has been supplied.</span><button type="button" data-new-clause="${h(key)}">Add source clause</button>`}</div></div>`;
  }
  ).join('')}<div class="form-end"><label>Revision note<input name="note" required ${disabled}></label><button class="primary" ${disabled}>Save pinned clauses</button></div></form></section>`;
  form('#fields-form',async(data)=>{
    const changes={
    }
    ;
    $$('#fields-form [data-field]').forEach(t=>{
      if(!t.disabled&&t.value!==(doc.fields[t.dataset.field]||''))changes['field:'+t.dataset.field]=t.value;
    }
    );
    if(!Object.keys(changes).length)return say('No field content changed.');
    await saveSections(changes,data.get('note'));
  }
  );
  form('#templates-form',async(data)=>{
    const selected=$$('[data-template]').filter(r=>r.querySelector('input[type=checkbox]').checked).map(r=>({
      key:r.dataset.template,revision:Number(r.querySelector('[data-revision]').value),visibility:r.querySelector('[data-visibility]').value}
    ));
    await saveSections({
      templates:selected}
    ,data.get('note'));
  }
  );
  form('#clauses-form',async data=>{
    const clauses={
    }
    ;
    $$('[data-clause]').forEach(s=>{
      if(s.value)clauses[s.dataset.clause]=Number(s.value);
    }
    );
    await saveSections({
      clauses}
    ,data.get('note'));
  }
  );
  clicks('[data-lock]',async b=>{
    captureFields();
    const owner=p.locks.find(l=>l.section==='field:'+b.dataset.lock);
    const note=owner&&owner.user_id!==S.user.id?'Administrator released section for continued project authoring.':'';
    await updateProject(await api('/api/projects/'+p.id+'/locks',{
      section:'field:'+b.dataset.lock,locked:b.dataset.locked!=='true',note}
    ));
  }
  );
  clicks('[data-library]',b=>openLibrary(b.dataset.kind,b.dataset.library));
  clicks('[data-new-clause]',b=>newLibrary('clause',b.dataset.newClause));
}
async function fileValue(input){
  const file=input.files[0];
  if(!file)throw new Error('Choose a file.');
  if(file.size>20*1024*1024)throw new Error('Use a file up to20 MiB.');
  const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  }
  );
  return {
    name:file.name,mime:file.type,data}
  ;
}
function uploadForm(id){
  return `<form id="${id}"><div class="grid"><label>Original file<input name="file" type="file" required></label><label>Source or version reference<input name="source" required placeholder="Issuer URL, original export, or retained review reference"></label></div><div class="form-end"><button>Retain original file</button></div></form>`;
}
function sources(){
  const p=S.project,disabled=currentEditable()?'':'disabled';
  $('#project-panel').innerHTML=`<section class="panel"><h2>Original attachments and evidence</h2><p class="help">Uploads retain their original bytes. Select their project use and publication scope separately.</p>${uploadForm('project-upload')}</section><section class="panel"><h2>Selected file register</h2><form id="attachments-form">${p.files.map(f=>{
    const selected=p.document.attachments.find(a=>a.id===f.id);
    return `<div class="row" data-file="${h(f.id)}"><input type="checkbox" aria-label="Use ${h(f.name)}" ${selected?'checked':''} ${disabled}><div class="grow"><a href="/api/files/${f.id}">${h(f.name)}</a><small class="hash">${h(f.source)}<br>${f.bytes.toLocaleString()} bytes · ${h(f.hash)}</small></div><select data-classification ${disabled}>${options([{
      value:'internal',label:'Internal handover'}
    ,{
      value:'public',label:'Public copy'}
    ,{
      value:'withheld',label:'Withheld from exports'}
    ],selected?.visibility||'internal')}</select><label class="subtle">Template destinations<select data-destinations multiple ${disabled}>${p.document.templates.map(t=>`<option value="${h(t.key)}" ${selected?.templates?.includes(t.key)?'selected':''}>${h(t.key)}</option>`).join('')}</select><small>No selection applies to the whole project.</small></label></div>`;
  }
  ).join('')||'<p class="empty">Retain an original source or attachment to begin.</p>'}<div class="form-end"><label>Revision note<input name="note" required ${disabled}></label><button class="primary" ${disabled}>Save file selection</button></div></form></section>`;
  form('#project-upload',async(data,f)=>{
    const content=await fileValue(f.elements.file);
    await api('/api/projects/'+p.id+'/files',{
      ...content,source:data.get('source')}
    );
    await updateProject();
    say('Original file retained. Select its use in the register.');
  }
  );
  form('#attachments-form',async data=>{
    const attachments=$$('[data-file]').filter(r=>r.querySelector('input').checked).map(r=>({
      id:r.dataset.file,visibility:r.querySelector('[data-classification]').value,templates:[...r.querySelector('[data-destinations]').selectedOptions].map(o=>o.value)}
    ));
    await saveSections({
      attachments}
    ,data.get('note'));
  }
  );
}
function stageMarkup(stage){
  return `<div class="stage" data-stage="${h(stage.id)}"><div class="grid"><label>Stage name<input data-label value="${h(stage.label)}" required></label><label>Assigned reviewers<select data-reviewers multiple>${usersOptions(stage.reviewers)}</select><small>Leave empty for any assigned project reviewer or administrator.</small></label></div><div class="actions"><button type="button" data-stage-up>Move earlier</button><button type="button" data-stage-remove>Remove stage</button></div></div>`;
}
function stageBindings(){
  clicks('[data-stage-up]',b=>{
    const row=b.closest('[data-stage]');
    if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling);
  }
  );
  clicks('[data-stage-remove]',b=>b.closest('[data-stage]').remove());
}
function reviews(){
  const p=S.project,r=p.readiness,canReview=['admin','reviewer'].includes(p.role);
  $('#project-panel').innerHTML=`<section class="panel"><h2>Revision${p.selected_revision} readiness</h2><p>${r.ready_to_release?'All configured reviews are complete. This exact revision is ready to freeze.':r.content_complete?'Source content is complete. Finish the named approval stages below.':'Complete the required source content and library reviews.'}</p>${r.missing.length?`<details open><summary>Missing source content (${r.missing.length})</summary><ul>${r.missing.map(x=>`<li>${h(x)}</li>`).join('')}</ul></details>`:''}${r.library_reviews_needed.length?`<details open><summary>Library revisions requiring review</summary><ul>${r.library_reviews_needed.map(x=>`<li>${h(x)}</li>`).join('')}</ul></details>`:''}${r.newer_library_versions.length?`<p class="help">Newer library revisions are available: ${h(r.newer_library_versions.join(', '))}. The project retains its pinned source until an author chooses an update.</p>`:''}<button id="freeze" class="primary" ${r.ready_to_release&&p.selected_revision===p.revision?'':'disabled'}>Freeze implementation handover</button></section><section class="panel"><h2>Approval workflow</h2>${r.stages.map(s=>`<form class="stage decision" data-stage-id="${h(s.id)}"><h3>${h(s.label)} <span class="badge">${h(s.review?.decision||'Awaiting review')}</span></h3>${s.review?`<p>${h(s.review.note)}</p><p class="help">${h(name(s.review.reviewer))} · ${h(stamp(s.review.created))} · revision${s.review.revision}</p>`:''}<div class="grid"><label>Decision<select name="decision"><option value="approved">Approve this revision</option><option value="changes_requested">Request changes</option></select></label><label>Review note<textarea name="note" required></textarea></label></div><button ${canReview&&p.selected_revision===p.revision?'':'disabled'}>Record decision</button></form>`).join('')}</section><details class="panel"><summary>Configure sequential review stages</summary><form id="workflow-form"><div id="workflow-stages">${p.document.workflow.map(stageMarkup).join('')}</div><div class="actions"><button type="button" id="add-stage">Add review stage</button></div><div class="form-end"><label>Revision note<input name="note" required></label><button class="primary" ${currentEditable()?'':'disabled'}>Save workflow</button></div></form></details>`;
  clicks('#freeze',async()=>{
    const release=await api('/api/projects/'+p.id+'/freeze',{
      revision:p.selected_revision}
    );
    S.tab='releases';
    await updateProject();
    say('The reviewed implementation and selected publication copy are frozen as '+release.id+'.');
  }
  );
  $$('.decision').forEach(f=>f.addEventListener('submit',guard(async e=>{
    e.preventDefault();
    const data=new FormData(f);
    await updateProject(await api('/api/projects/'+p.id+'/reviews',{
      revision:p.selected_revision,stage:f.dataset.stageId,...Object.fromEntries(data)}
    ));
    say('The named review is saved against revision'+p.selected_revision+'.');
  }
  )));
  clicks('#add-stage',()=>{
    $('#workflow-stages').insertAdjacentHTML('beforeend',stageMarkup({
      id:'review-'+crypto.randomUUID().slice(0,8),label:'Additional review',reviewers:[]}
    ));
    stageBindings();
  }
  );
  stageBindings();
  form('#workflow-form',async data=>{
    const workflow=$$('#workflow-stages [data-stage]').map(s=>({
      id:s.dataset.stage,label:s.querySelector('[data-label]').value,reviewers:[...s.querySelector('[data-reviewers]').selectedOptions].map(o=>o.value)}
    ));
    await saveSections({
      workflow}
    ,data.get('note'));
  }
  );
}
function releases(){
  const p=S.project;
  $('#project-panel').innerHTML=`<section class="panel"><h2>Frozen releases</h2>${p.releases.length?p.releases.map(r=>`<div class="row"><div class="grow"><strong>Revision${r.revision}</strong> · ${h(stamp(r.created))}<p class="help"><code>${h(r.id)}</code>${r.parent?' · amendment of '+h(r.parent):''}</p></div><div class="actions"><a class="download" href="/api/releases/${r.id}/implementation">Implementation ZIP</a><a class="download" href="/api/releases/${r.id}/publication-copy">Public copy ZIP</a><button data-adoption="${r.id}">Record platform handover</button><a class="download" href="/api/releases/${r.id}/accepted-handover">Accepted handover ZIP</a></div></div>`).join(''):'<p class="empty">Complete revision review to freeze the first handover.</p>'}</section><div id="adoption-panel"></div><section class="panel"><h2>Amendment and archive</h2><form id="lifecycle"><div class="grid"><label>Action<select name="action"><option value="amend">Start amendment from a frozen release</option><option value="archive">Archive the project</option><option value="reopen">Reopen the current content for editing</option></select></label><label>Exact parent release<select name="release_id">${options(p.releases.map(r=>({
    value:r.id,label:'Revision'+r.revision+' · '+r.id}
  )),p.releases[0]?.id)}</select></label></div><label>Reason<textarea name="note" required></textarea></label><button>Continue project lifecycle</button></form></section>`;
  clicks('[data-adoption]',async b=>{
    S.release=p.releases.find(r=>r.id===b.dataset.adoption);
    S.releaseProject=await api('/api/projects/'+p.id+'?revision='+S.release.revision);
    adoption();
  }
  );
  form('#lifecycle',async data=>{
    S.release=null;
    S.releaseProject=null;
    await updateProject(await api('/api/projects/'+p.id+'/lifecycle',{
      ...Object.fromEntries(data),revision:p.revision}
    ));
    say('The original releases remain retained; the project lifecycle is updated.');
  }
  );
  if(S.release&&S.releaseProject)adoption();
}
function adoption(){
  const p=S.project,r=S.release,original=S.releaseProject,records=p.adoptions.filter(a=>a.release_id===r.id);
  $('#adoption-panel').innerHTML=`<section class="panel"><h2>Native platform handover · revision${r.revision}</h2><p class="help">Record the actual configured IDs, roles and source mappings against this frozen release.</p><label>Template<select id="adoption-template">${options(original.document.templates.map(t=>({
    value:t.key,label:t.key}
  )),original.document.templates[0].key)}</select></label><div id="adoption-form-holder"></div><h3>Retained handover decisions</h3>${records.map(a=>`<p><strong>${h(a.template)}</strong> · ${h(a.record.kind)} · ${h(a.record.decision)}<br><small>${h(a.record.platform)} / ${h(a.record.environment)} / ${h(a.record.native_project||'')} / ${h(a.record.module||'')} / ${h(a.record.native_id)} · ${h(name(a.actor))} · ${h(stamp(a.created))}<br>${h(a.record.note)}</small></p>`).join('')||'<p class="help">No platform handover has been recorded for this release.</p>'}</section>`;
  $('#adoption-template').addEventListener('change',adoptionForm);
  adoptionForm();
}
function adoptionForm(){
  const p=S.project,r=S.release,o=S.releaseProject,key=$('#adoption-template').value;
  const latest=p.adoptions.find(a=>a.release_id===r.id&&a.template===key);
  const previous=latest?.record;
  const t=o.library_records.find(v=>v.kind==='template'&&v.key===key).payload;
  const maps={
    field_map:[...new Set(['agency','project_title','solicitation_id','procurement_contact','approved_submission_instructions',...t.required_fields])],clause_map:t.approved_clause_keys,attachment_map:o.document.attachments.filter(a=>!a.templates?.length||a.templates.includes(key)).map(a=>a.id),role_map:o.document.workflow.map(s=>s.id)}
  ;
  $('#adoption-form-holder').innerHTML=`${latest?`<p class="help">Latest retained decision: <strong>${h(previous.decision)}</strong> · ${h(name(latest.actor))} · ${h(stamp(latest.created))}. The fields below show that record. Recording a correction creates another attributable decision and keeps the earlier one.</p>`:''}<form id="adoption-form"><div class="grid"><label>Record type<select name="kind"><option value="native_configuration">Actual native configuration</option><option value="internal_exercise">Internal handover exercise</option></select></label><label>Platform<input name="platform" required></label><label>Environment<input name="environment" required placeholder="Actual workspace or tenant"></label><label>Native project or record ID<input name="native_project" required></label><label>Native module<input name="module" required placeholder="Solicitations or Contracts"></label><label>Native template ID<input name="native_id" required></label><label>Platform operator<input name="operator" required></label><label>Decision<select name="decision"><option value="recorded">Record transfer</option><option value="accepted">Accept reviewed transfer</option><option value="changes_requested">Request corrections</option></select></label></div>${Object.entries(maps).map(([group,keys])=>`<details open><summary>${label(group)}</summary>${keys.length?keys.map(k=>`<div class="map-row"><label>${h(group==='attachment_map'?o.files.find(f=>f.id===k)?.name||k:label(k))}</label><input data-map="${group}" data-key="${h(k)}" required placeholder="Actual native destination or explicit retained handling"></div>`).join(''):'<p class="help">No entries apply to this template.</p>'}</details>`).join('')}<label>Original native review or export<select name="evidence_file"><option value="">Choose a retained project evidence file</option>${options(p.files.filter(f=>f.project===p.id).map(f=>({
    value:f.id,label:f.name}
  )),null)}</select></label><label>Transfer and acceptance note<textarea name="note" required></textarea></label><button class="primary">Record exact handover</button></form>`;
  if(previous){
    for(const field of ['kind','platform','environment','native_project','module','native_id','operator','decision','evidence_file']){
      const input=$('#adoption-form [name="'+field+'"]');
      if(input&&previous[field])input.value=previous[field];
    }
    $$('#adoption-form [data-map]').forEach(input=>input.value=previous[input.dataset.map]?.[input.dataset.key]||'');
  }
  form('#adoption-form',async data=>{
    const value={
      ...Object.fromEntries(data),release_id:r.id,template:key}
    ;
    Object.keys(maps).forEach(group=>value[group]={
    }
    );
    $$('[data-map]').forEach(input=>value[input.dataset.map][input.dataset.key]=input.value);
    await updateProject(await api('/api/projects/'+p.id+'/adoptions',value));
    say('Native mappings and the named handover decision are retained.');
  }
  );
}
function projectHistory(){
  const p=S.project;
  $('#project-panel').innerHTML=`<section class="panel"><h2>Retained content revisions</h2><p class="help">Earlier content, source pins and reviews remain attached to their original revision.</p>${p.history.map(r=>`<div class="row"><div class="grow"><strong>Revision${r.revision}</strong><p>${h(r.note)}</p><small>${h(name(r.actor))} · ${h(stamp(r.created))}<br><code>${h(r.hash)}</code></small></div><button data-history="${r.revision}">Open revision</button><button data-diff="${r.revision}">Compare with current</button></div>`).join('')}</section><div id="diff"></div>`;
  clicks('[data-history]',b=>openProject(p.id,'authoring',Number(b.dataset.history)));
  clicks('[data-diff]',async b=>{
    const older=await api('/api/projects/'+p.id+'?revision='+b.dataset.diff),current=await api('/api/projects/'+p.id);
    const keys=[...new Set([...Object.keys(older.document.fields),...Object.keys(current.document.fields)])].map(k=>'field:'+k).concat(['templates','clauses','attachments','workflow','parent_release']);
    const get=(d,k)=>k.startsWith('field:')?d.fields[k.slice(6)]:d[k];
    const changed=keys.filter(k=>JSON.stringify(get(older.document,k))!==JSON.stringify(get(current.document,k)));
    $('#diff').innerHTML=`<section class="panel"><h2>Revision${older.selected_revision} →${current.revision}</h2>${changed.length?changed.map(k=>`<details><summary>${h(k)}</summary><div class="grid"><div><h3>Earlier</h3><pre>${h(JSON.stringify(get(older.document,k),null,2))}</pre></div><div><h3>Current</h3><pre>${h(JSON.stringify(get(current.document,k),null,2))}</pre></div></div></details>`).join(''):'<p>The document content is unchanged.</p>'}</section>`;
  }
  );
}
function access(){
  const p=S.project;
  $('#project-panel').innerHTML=`<section class="panel"><h2>Named project access</h2><p class="help">Authors edit content; reviewers record decisions; viewers inspect the retained project. Administrators can operate every project.</p>${p.members.map(m=>`<p><strong>${h(m.name)}</strong> · ${h(m.role)}</p>`).join('')}<form id="member"><div class="grid"><label>Operator<select name="user_id">${options(S.dashboard.users.filter(u=>u.active).map(u=>({
    value:u.id,label:u.name}
  )),null)}</select></label><label>Project role<select name="role"><option value="author">Author</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></select></label></div><div class="form-end"><button>Assign project access</button></div></form></section>`;
  form('#member',async data=>{
    await updateProject(await api('/api/projects/'+p.id+'/members',Object.fromEntries(data)));
    say('Named project access updated.');
  }
  );
}
function library(){
  captureFields();
  $('#app').innerHTML=`<div class="heading"><div><h1>Template and clause library</h1><p class="muted">Reusable source content with independent revision and review history.</p></div><div class="actions"><button id="new-template">New template</button><button id="new-clause">New clause</button>${S.project?'<button id="back-project">Return to project</button>':''}</div></div><div class="split"><section class="panel"><h2>Reusable records</h2>${S.dashboard.library.map(r=>`<button class="record" data-library="${h(r.key)}" data-kind="${r.kind}"><strong>${h(r.payload.title||label(r.key))}</strong><small>${r.kind} · revision${r.revision} · ${h(r.review?.decision||'Awaiting review')}</small></button>`).join('')}</section><section class="panel" id="library-detail"><p class="empty">Select a source record to inspect, revise or review.</p></section></div><section class="panel"><h2>Original library source files</h2>${uploadForm('library-upload')}<div id="library-files"></div></section>`;
  clicks('[data-library]',b=>openLibrary(b.dataset.kind,b.dataset.library));
  clicks('#new-template',()=>newLibrary('template'));
  clicks('#new-clause',()=>newLibrary('clause'));
  clicks('#back-project',()=>renderProject());
  form('#library-upload',async(data,f)=>{
    await api('/api/sources',{
      ...(await fileValue(f.elements.file)),source:data.get('source')}
    );
    await libraryFiles();
    say('Original library source retained.');
  }
  );
  libraryFiles().catch(e=>say(e.message,true));
}
async function libraryFiles(){
  const data=await api('/api/sources');
  S.sources=data.files;
  if($('#library-files'))$('#library-files').innerHTML=data.files.map(f=>`<p><a href="/api/files/${f.id}">${h(f.name)}</a> · <code>${h(f.id)}</code><br><small>${h(f.source)}</small></p>`).join('');
}
function newLibrary(kind,key=''){
  library();
  S.library={
    kind,key,revision:0,payload:kind==='clause'?{
      title:label(key),text:''}
    :{
      id:key,title:'',purpose:'',required_fields:['agency','project_title','solicitation_id','procurement_contact','approved_submission_instructions'],sections:[],approved_clause_keys:[],attachment_prompts:[],proposed_workflow:[]}
    ,source:{
      reference:'',files:[]}
    ,review:null,history:[]}
  ;
  libraryEditor();
}
async function openLibrary(kind,key,revision){
  if(!$('#library-detail'))library();
  S.library=await api('/api/library/'+kind+'/'+encodeURIComponent(key)+(revision?'?revision='+revision:''));
  libraryEditor();
}
function libraryEditor(){
  const r=S.library,t=r.payload;
  const canAuthor=['admin','author'].includes(S.user.role),canReview=['admin','reviewer'].includes(S.user.role);
  $('#library-detail').innerHTML=`<h2>${r.revision?'Revision'+r.revision:'New'} ${h(r.kind)}</h2>${r.history?.length?`<label>Retained revision<select id="library-version">${options(r.history.map(v=>({
    value:v.revision,label:'Revision'+v.revision+' · '+stamp(v.created)}
  )),r.revision)}</select></label>`:''}<form id="library-edit"><div class="grid"><label>Stable ${r.kind} key<input name="key" value="${h(r.key)}" required ${r.revision?'readonly':''}></label><label>Title<input name="title" value="${h(t.title||'')}" required></label></div>${r.kind==='clause'?`<label>Original clause text<textarea name="text" required rows="10">${h(t.text)}</textarea></label>`:`<label>Purpose<textarea name="purpose" required>${h(t.purpose)}</textarea></label><label>Required field keys<small>One per line. The five identification fields are always included.</small><textarea name="required_fields">${h(t.required_fields.join('\n'))}</textarea></label><label>Document sections<small>One per line: section heading | field_key</small><textarea name="sections" rows="7">${h(t.sections.map(s=>s.heading+' | '+s.field).join('\n'))}</textarea></label><label>Selected clause keys<small>One per line.</small><textarea name="approved_clause_keys">${h(t.approved_clause_keys.join('\n'))}</textarea></label><label>Attachment prompts<textarea name="attachment_prompts">${h(t.attachment_prompts.join('\n'))}</textarea></label><label>Proposed operator steps<textarea name="proposed_workflow">${h(t.proposed_workflow.join('\n'))}</textarea></label>`}<label>Original source reference<textarea name="source" required>${h(r.source.reference)}</textarea></label><label>Retained library source file IDs<small>Choose the file IDs shown in the source list; separate multiple IDs with commas.</small><input name="files" value="${h((r.source.files||[]).join(', '))}"></label><p class="help">Saving creates a new immutable revision. Existing projects keep their earlier selected version until an author adopts this revision.</p><button class="primary" ${canAuthor?'':'disabled'}>Save new revision</button></form>${r.revision?`<hr><h3>Source review</h3><p>${h(r.review?.decision||'Awaiting review')}${r.review?' · '+h(name(r.review.reviewer)):''}</p>${r.review?`<p class="help">${h(r.review.note)}</p>`:''}<form id="library-review"><label>Decision<select name="decision"><option value="approved">Approve for local implementation use</option><option value="changes_requested">Request changes</option></select></label><label>Review scope and note<textarea name="note" required></textarea></label><button ${canReview?'':'disabled'}>Record source review</button></form>`:''}`;
  if($('#library-version'))$('#library-version').addEventListener('change',guard(()=>openLibrary(r.kind,r.key,Number($('#library-version').value))));
  form('#library-edit',async data=>{
    const lines=name=>String(data.get(name)||'').split('\n').map(x=>x.trim()).filter(Boolean);
    const key=data.get('key');
    let payload;
    if(r.kind==='clause')payload={
      title:data.get('title'),text:data.get('text')}
    ;
    else payload={
      id:key,title:data.get('title'),purpose:data.get('purpose'),required_fields:lines('required_fields'),sections:lines('sections').map(line=>{
        const parts=line.split('|');
        if(parts.length!==2)throw new Error('Use section heading | field_key on each line.');
        return {
          heading:parts[0].trim(),field:parts[1].trim()}
        ;
      }
      ),approved_clause_keys:lines('approved_clause_keys'),attachment_prompts:lines('attachment_prompts'),proposed_workflow:lines('proposed_workflow')}
    ;
    const updated=await api('/api/library',{
      kind:r.kind,key,revision:r.revision,payload,source:{
        reference:data.get('source'),files:String(data.get('files')).split(',').map(x=>x.trim()).filter(Boolean)}
    }
    );
    await refreshDashboard();
    await openLibrary(updated.kind,updated.key);
    say('New source revision saved.');
  }
  );
  form('#library-review',async data=>{
    await api('/api/library/review',{
      kind:r.kind,key:r.key,revision:r.revision,...Object.fromEntries(data)}
    );
    await refreshDashboard();
    await openLibrary(r.kind,r.key,r.revision);
    say('Review retained for this exact library revision.');
  }
  );
}
function operators(){
  const admin=S.user.role==='admin';
  $('#app').innerHTML=`<div class="heading"><div><h1>Named operators</h1><p class="muted">Workspace roles and project access are managed separately.</p></div></div><div class="grid"><section class="panel"><h2>Operator register</h2>${S.dashboard.users.map(u=>`<form class="operator row" data-user="${h(u.id)}"><div class="grow"><strong>${h(u.name)}</strong><small>${u.active?'Active':'Access disabled'}</small></div><select name="role" ${admin?'':'disabled'}>${options(['admin','author','reviewer','viewer'].map(v=>({
    value:v,label:label(v)}
  )),u.role)}</select><label class="check"><input type="checkbox" name="active" ${u.active?'checked':''} ${admin?'':'disabled'}>Active</label><button ${admin?'':'disabled'}>Update</button></form>`).join('')}</section><section class="panel"><h2>Create an operator</h2><form id="new-operator"><label>Operator name<input name="name" required></label><label>Workspace role<select name="role"><option value="author">Author</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label><label>Private initial password<input name="password" type="password" minlength="16" autocomplete="new-password" required></label><p class="help">Use at least16 characters and provide the private password to its named operator through your established account process.</p><button class="primary" ${admin?'':'disabled'}>Create operator</button></form></section></div>`;
  form('#new-operator',async data=>{
    await api('/api/users',Object.fromEntries(data));
    await refreshDashboard();
    operators();
    say('Named operator created. Assign project access inside the project.');
  }
  );
  $$('.operator').forEach(f=>f.addEventListener('submit',guard(async event=>{
    event.preventDefault();
    const data=new FormData(f);
    await api('/api/users/'+f.dataset.user,{
      role:data.get('role'),active:data.has('active')}
    );
    await refreshDashboard();
    operators();
    say('Access changed; previous sessions for that operator are closed.');
  }
  )));
}
(async()=>{
  try{
    const session=await api('/api/session');
    S.user=session.user;
    S.csrf=session.csrf;
    await load();
  }
  catch{
    login();
  }
}
)();

