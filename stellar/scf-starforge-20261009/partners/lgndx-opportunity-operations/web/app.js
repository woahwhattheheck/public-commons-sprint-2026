// MIT. Original operator interface for the opportunity operating model.
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const label = value => String(value ?? '').replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
const arr = value => Array.isArray(value) ? value : [];
const compact = value => typeof value === 'string' ? value : JSON.stringify(value ?? '');
const tabs = [['overview','Overview'],['sources','Sources'],['capabilities','Capabilities'],['requirements','Requirements'],['team','Team & plan'],['questions','Q&A'],['packages','Packages'],['history','Changes & history']];
const roles = ['company','past_performance','award_background','solicitation','amendment','question_response','partner','other'];
let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('opportunity-token') || '';
if(token){sessionStorage.setItem('opportunity-token',token);history.replaceState(null,'',location.pathname+location.search);}
const state = {projects:[],project:null,tab:'overview',search:'',filter:'',busy:false,historical:false,comparison:null,editor:null};
const badge = (value,strong=false)=>'<span class="badge'+(strong?' strong':'')+'">'+esc(label(value||'Open'))+'</span>';
const rowId = row => row?.id ?? '';
const find = (kind,id)=>arr(state.project?.[kind]).find(row=>row.id===id);
const notice = (message,kind='info')=>{
  const box=$('#notice');box.hidden=!message;box.dataset.kind=kind;
  box.innerHTML=message?'<span>'+esc(message)+'</span><button type="button" class="quiet compact" data-action="dismiss-notice">Dismiss</button>':'';
};
function apiError(error){
  const code=error.code||error.message;
  const messages={
    REVISION_CONFLICT:'Another edit is already saved. Refresh the project, then apply your intended change to the current revision.',
    AUTH_REQUIRED:'Enter the private operator token from the workspace launch URL.',
    SOURCE_CHANGED:'The selected source has changed. Open Sources and review the new edition.',
    REQUEST_ID_CONFLICT:'This request identity belongs to different saved input. Reopen the editor and save the intended change.',
    WORKSPACE_CLOSING:'The workspace is closing. Reopen the original workspace before continuing.'
  };
  return messages[code]||String(error.message||code||'The operation did not complete.');
}
async function api(path,{method='GET',body}={}){
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const type=response.headers.get('content-type')||'';
  const data=type.includes('application/json')?await response.json():await response.text();
  if(!response.ok){const e=new Error(data?.message||data?.error||'HTTP '+response.status);e.code=data?.error||'HTTP_'+response.status;e.status=response.status;throw e;}
  return data;
}
function setBusy(on,text='Saving the operating record…'){
  state.busy=on;$('#busy-indicator').textContent=text;$('#busy-indicator').hidden=!on;
  $('#editor-save').disabled=on;$('#refresh-all').disabled=on;$('#new-project').disabled=on;
}
async function refresh(selectedId=state.project?.id,{keepNotice=true}={}){
  const result=await api('/api/projects');state.projects=arr(result.projects??result);
  if(selectedId){state.project=await api('/api/projects/'+encodeURIComponent(selectedId));state.historical=false;}
  else if(state.projects.length){state.project=await api('/api/projects/'+encodeURIComponent(state.projects[0].id));}
  $('#connection-state').textContent='Workspace connected';
  render();if(!keepNotice)notice('');
}
async function dispatch(action,payload,{message='Saved.'}={}){
  const request={...payload,requestId:payload.requestId||crypto.randomUUID()};
  const result=await api('/api/dispatch',{method:'POST',body:{action,payload:request}});
  const selected=result?.project?.id||result?.id||payload.id;
  await refresh(selected);notice(message);return result;
}
function fmtDate(value){
  if(!value)return 'Not set';
  const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
}
function dateDetail(value,zone=''){return value?'<span>'+esc(fmtDate(value))+'</span><small>'+esc(value)+(zone?' · '+esc(zone):'')+'</small>':'<span class="muted">Not set</span>';}
function sourceTitle(id){return find('sources',id)?.title||id;}
function evidenceLinks(evidence){
  const rows=arr(evidence);return rows.length?'<div class="tags">'+rows.map(e=>'<button type="button" class="link-button" data-action="view-source" data-id="'+esc(e.sourceId)+'">'+esc(sourceTitle(e.sourceId))+(e.locator?' · '+esc(e.locator):'')+'</button>').join('<span aria-hidden="true"> · </span>')+'</div>':'<span class="muted">Source reference not selected</span>';
}
const info=(title,description,actions='')=>'<div class="panel-heading"><div><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p></div><div class="panel-actions">'+actions+'</div></div>';
const button=(action,text,id='',primary=false)=>'<button type="button" data-action="'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+(primary?' class="primary"':'')+(state.historical?' disabled':'')+'>'+esc(text)+'</button>';
function empty(title,text,action='',buttonText='Add record'){return '<div class="empty"><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p>'+(action?'<div class="actions">'+button(action,buttonText,'',true)+'</div>':'')+'</div>';}
function filtered(rows,properties){
  const query=state.search.trim().toLowerCase();
  return arr(rows).filter(row=>(!query||properties.some(key=>compact(row[key]).toLowerCase().includes(query)))&&(!state.filter||row.status===state.filter||row.decision===state.filter||row.role===state.filter||row.kind===state.filter));
}
function filterBar(placeholder,values=[]){
  return '<div class="panel-tools"><label class="search-field"><span class="sr-only">'+esc(placeholder)+'</span><input id="panel-search" type="search" placeholder="'+esc(placeholder)+'" value="'+esc(state.search)+'"></label>'+(values.length?'<label><span class="sr-only">Filter records</span><select id="panel-filter"><option value="">All records</option>'+values.map(x=>'<option value="'+esc(x)+'"'+(state.filter===x?' selected':'')+'>'+esc(label(x))+'</option>').join('')+'</select></label>':'')+'</div>';
}
function renderProjects(){
  const q=$('#project-search').value.trim().toLowerCase();
  $('#project-list').innerHTML=state.projects.filter(p=>(p.title+' '+(p.company?.name||'')).toLowerCase().includes(q)).map(p=>'<button type="button" class="project-card'+(state.project?.id===p.id?' active':'')+'" data-action="open-project" data-id="'+esc(p.id)+'"><strong>'+esc(p.title)+'</strong><small>'+esc(p.company?.name||p.opportunity?.reference||'Operating project')+' · '+esc(label(p.opportunity?.stage||'research'))+'</small></button>').join('')||'<p class="muted">No matching projects.</p>';
}
function render(){
  renderProjects();const p=state.project;
  $('#project-header').hidden=!p;$('#project-tabs').hidden=!p;
  if(!p)return;
  const reqs=arr(p.requirements).filter(r=>r.status!=='retired');
  const coverage=new Map(arr(p.coverage).map(x=>[x.requirementId,x]));
  const reviewed=reqs.filter(r=>coverage.get(r.id)?.decision&&coverage.get(r.id).decision!=='unreviewed').length;
  const supported=reqs.filter(r=>coverage.get(r.id)?.decision==='supported').length;
  const pending=arr(p.changes).filter(r=>r.status!=='reviewed').length;
  const obligations=arr(p.milestones).filter(r=>!['done','cancelled'].includes(r.status));
  $('#project-header').innerHTML='<div class="project-title-row"><div><div class="eyebrow">'+esc(p.company?.name||'Operating project')+'</div><h1>'+esc(p.title)+'</h1><p class="project-subtitle">'+esc(p.opportunity?.title||p.description||'')+'</p></div><div class="actions">'+button('edit-project','Edit project')+'</div></div><div class="metadata-line">'+badge(p.opportunity?.stage||'research')+'<span>'+esc(p.opportunity?.reference||'Reference not set')+'</span><span>Revision '+esc(p.revision)+'</span>'+(p.opportunity?.dueAt?'<span>Response: '+esc(fmtDate(p.opportunity.dueAt))+'</span>':'')+'</div>'+(state.historical?'<div class="historical"><span>Viewing retained revision '+esc(p.revision)+'. Open the current project to make a new edit.</span><button type="button" data-action="current-project">Open current revision</button></div>':'')+'<div class="metrics"><div class="metric"><span class="value">'+reviewed+' / '+reqs.length+'</span><span class="label">Requirements reviewed</span></div><div class="metric"><span class="value">'+supported+'</span><span class="label">Requirements supported</span></div><div class="metric"><span class="value">'+pending+'</span><span class="label">Source changes to review</span></div><div class="metric"><span class="value">'+obligations.length+'</span><span class="label">Open delivery milestones</span></div></div>';
  $('#project-tabs').innerHTML=tabs.map(([id,name])=>'<button type="button" data-tab="'+id+'" class="'+(state.tab===id?'active':'')+'" aria-current="'+(state.tab===id?'page':'false')+'">'+name+'</button>').join('');
  const views={overview:overview,sources:sources,capabilities:capabilities,requirements:requirements,team:team,questions:questions,packages:packages,history:historyView};
  $('#panel').innerHTML=views[state.tab]();
}
function overview(){
  const p=state.project,r=p.responseRules||{},opp=p.opportunity||{},c=p.company||{};
  const summary=arr(p.requirements).filter(x=>x.status!=='retired').map(x=>({...x,coverage:arr(p.coverage).find(y=>y.requirementId===x.id)}));
  const gaps=summary.filter(x=>!x.coverage||['unreviewed','partial','gap','team_required'].includes(x.coverage.decision));
  return info('Operating overview','Review the selected opportunity, company context and work that needs an explicit decision.',button('edit-project','Edit project'))+
    '<div class="two-column"><section class="surface"><header class="surface-header"><h3>Opportunity</h3>'+badge(opp.documentKind||'other')+'</header><div class="surface-body"><dl class="detail-list"><dt>Buyer</dt><dd>'+esc(opp.buyer||'Not entered')+'</dd><dt>Reference</dt><dd>'+esc(opp.reference||'Not entered')+'</dd><dt>Response deadline</dt><dd>'+dateDetail(opp.dueAt,opp.timeZone)+'</dd><dt>Issued source</dt><dd>'+safeLink(opp.url)+'</dd><dt>Working notes</dt><dd>'+esc(opp.notes||'')+'</dd></dl></div></section><section class="surface"><header class="surface-header"><h3>Company context</h3></header><div class="surface-body"><dl class="detail-list"><dt>Company</dt><dd>'+esc(c.name||'Not entered')+'</dd><dt>Website</dt><dd>'+safeLink(c.website)+'</dd><dt>UEI</dt><dd>'+esc(c.uei||'Not entered')+'</dd><dt>NAICS</dt><dd>'+esc(arr(c.naics).join(', ')||'Not entered')+'</dd><dt>Size / classification</dt><dd>'+esc(c.size||'Not entered')+'</dd><dt>Description</dt><dd>'+esc(c.description||'')+'</dd></dl></div></section></div>'+
    '<section class="surface"><header class="surface-header"><h3>Response instructions</h3>'+button('edit-rules','Edit instructions')+'</header><div class="surface-body"><dl class="detail-list"><dt>Page limit</dt><dd>'+esc(r.maxPages??'Not entered')+'</dd><dt>Past performance limit</dt><dd>'+esc(r.capabilityMaxPages??'Not entered')+'</dd><dt>Excluded sections</dt><dd>'+esc(arr(r.excludedSections).join(', ')||'None entered')+'</dd><dt>Issued instructions</dt><dd>'+esc(r.notes||'Record the instructions from the selected source.')+'</dd><dt>Source</dt><dd>'+evidenceLinks(r.evidence)+'</dd></dl></div></section>'+
    '<section class="surface"><header class="surface-header"><h3>Coverage requiring a decision</h3><button type="button" data-tab="requirements">Open requirements</button></header><div class="surface-body">'+(gaps.length?'<div class="card-list">'+gaps.map(x=>'<div class="record-card"><div class="record-card-head"><h3>'+esc(x.number?x.number+' · ':'')+esc(x.title)+'</h3>'+badge(x.coverage?.decision||'unreviewed')+'</div><p>'+esc(x.coverage?.reviewNote||x.text)+'</p><small>Owner: '+esc(x.coverage?.owner||x.owner||'Unassigned')+'</small><div class="record-actions">'+button('edit-coverage','Review coverage',x.id)+'</div></div>').join('')+'</div>':'<p>All current requirements have an explicit coverage disposition.</p>')+'</div></section>';
}
function safeLink(url){
  if(!url)return '<span class="muted">Not entered</span>';
  try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return esc(url);return '<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">'+esc(url)+'</a>';}catch{return esc(url);}
}
function sources(){
  const rows=filtered(state.project.sources,['title','filename','url','role']);
  return info('Source intake','Retain the issued documents and company material. Each requirement and decision can refer to the exact source reviewed.',button('add-source','Retain source','',true)+button('import-awards','Import award edition'))+
    filterBar('Search source titles, files and URLs',roles)+
    (rows.length?'<div class="card-list">'+rows.map(s=>'<article class="record-card"><div class="record-card-head"><div><h3>'+esc(s.title)+'</h3><small>'+esc(s.filename||'Original award edition')+' · '+esc(s.bytes??'')+' bytes</small></div>'+badge(s.role)+'</div><p>'+safeLink(s.url)+'</p><small>Captured '+esc(s.capturedAt||'')+(s.replacesSourceId?' · Updates '+esc(sourceTitle(s.replacesSourceId)):'')+'</small><div class="record-actions"><button type="button" data-action="view-source" data-id="'+esc(s.id)+'">Read source</button><button type="button" data-action="download-source" data-id="'+esc(s.id)+'">Download original</button>'+button('replace-source','Retain a changed edition',s.id)+'</div></article>').join('')+'</div>':empty('Retain the source material','Start with the issued procurement, a company capability record or an original award edition.','add-source','Retain a source'));
}
function capabilities(){
  const rows=filtered(state.project.capabilities,['title','description','owner','tags']);
  return info('Capabilities and past performance','Keep the actual company record, its source, and the reviewed experience together.',button('add-capability','Add capability','',true))+filterBar('Search capabilities and experience',['capability','past_performance','draft','reviewed','retired'])+
    (rows.length?'<div class="card-list">'+rows.map(c=>'<article class="record-card"><div class="record-card-head"><div><div class="eyebrow">'+esc(label(c.kind))+'</div><h3>'+esc(c.title)+'</h3></div>'+badge(c.status)+'</div><p>'+esc(c.description)+'</p><small>Owner: '+esc(c.owner||'Unassigned')+'</small><div class="tags">'+arr(c.tags).map(t=>badge(t)).join('')+'</div><div class="record-actions">'+button('edit-capability','Edit record',c.id)+'</div><hr class="divider">'+evidenceLinks(c.evidence)+'</article>').join('')+'</div>':empty('Add source-backed capabilities','Capture a capability or past-performance record before using it in a requirement response.','add-capability','Add capability'));
}
function requirements(){
  const p=state.project;const all=arr(p.requirements).map(r=>({...r,decision:arr(p.coverage).find(c=>c.requirementId===r.id)?.decision||'unreviewed'}));
  const rows=filtered(all,['number','title','text','owner']);
  return info('Requirement and response matrix','Work through each issued question, select the supporting capability or teammate, and retain the response decision.',button('add-requirement','Add requirement','',true)+button('download-requirements','Export matrix'))+
    filterBar('Search questions, requirements and owners',['unreviewed','supported','partial','gap','team_required','exception','open','in_progress','reviewed','retired'])+
    (rows.length?'<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Requirement / question</th><th>Coverage</th><th>Owner</th><th>Response</th><th>Actions</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="nowrap">'+esc(r.number||'—')+(r.mandatory?'<small>Required</small>':'')+'</td><td class="wide-text"><strong>'+esc(r.title)+'</strong><small>'+esc(r.text)+'</small></td><td>'+badge(r.decision,r.decision==='supported')+'<small>'+esc(label(r.status))+'</small></td><td>'+esc(r.owner||'Unassigned')+'</td><td>'+esc(label(r.responseDisposition||'unanswered'))+'</td><td><div class="row-actions">'+button('edit-coverage','Review',r.id)+button('edit-requirement','Edit',r.id)+'</div></td></tr>').join('')+'</tbody></table></div><p class="table-summary">'+rows.length+' displayed / '+all.length+' retained requirements. Open Review to read the complete source and response.</p>':empty('Build the requirement matrix','Retain the original requirement text and source locator, then review it against the available capabilities.','add-requirement','Add requirement'));
}
function team(){
  const p=state.project;
  return info('Teaming and delivery plan','Record each partner’s actual disposition and assign the dependent work and deadlines.',button('add-team','Add team record','',true)+button('add-milestone','Add milestone'))+
    '<section class="surface"><header class="surface-header"><h3>Teaming decisions</h3><span class="muted">'+arr(p.teaming).length+' records</span></header><div class="surface-body">'+(arr(p.teaming).length?'<div class="card-list">'+arr(p.teaming).map(t=>'<article class="record-card"><div class="record-card-head"><div><h3>'+esc(t.name)+'</h3><small>'+esc(t.role)+'</small></div>'+badge(t.decision)+'</div><p>'+esc(t.scope)+'</p><small>Owner: '+esc(t.owner||'Unassigned')+'</small><p>'+esc(t.note||'')+'</p>'+evidenceLinks(t.evidence)+'<div class="record-actions">'+button('edit-team','Edit decision',t.id)+'</div></article>').join('')+'</div>':empty('Record the team','Keep candidate, contacted and confirmed relationships explicit.','add-team','Add team record'))+'</div></section>'+
    '<section class="surface"><header class="surface-header"><h3>Milestones and dependencies</h3><span class="muted">'+arr(p.milestones).length+' records</span></header><div class="surface-body">'+(arr(p.milestones).length?'<div class="table-scroll"><table><thead><tr><th>Milestone</th><th>Owner</th><th>Deadline</th><th>Status</th><th>Dependencies</th><th></th></tr></thead><tbody>'+arr(p.milestones).map(m=>'<tr><td class="wide-text"><strong>'+esc(m.title)+'</strong><small>'+esc(m.note||'')+'</small></td><td>'+esc(m.owner)+'</td><td>'+dateDetail(m.dueAt,m.timeZone)+'</td><td>'+badge(m.status)+'</td><td>'+arr(m.dependsOn).map(id=>esc(find('milestones',id)?.title||id)).join('<br>')+'</td><td>'+button('edit-milestone','Edit',m.id)+'</td></tr>').join('')+'</tbody></table></div>':empty('Build the work plan','Assign the work, dates and actual dependencies needed for the receiving package.','add-milestone','Add milestone'))+'</div></section>';
}
function questions(){
  const rows=filtered(state.project.questions,['number','text','owner','answer']);
  return info('Questions and answers','Track clarification, the issued response and its effect on the requirement matrix.',button('add-question','Add question','',true))+
    filterBar('Search questions and answers',['open','submitted','answered','parked'])+
    (rows.length?'<div class="card-list">'+rows.map(q=>'<article class="record-card"><div class="record-card-head"><h3>'+esc(q.number?q.number+' · ':'')+esc(q.text)+'</h3>'+badge(q.status)+'</div><small>Owner: '+esc(q.owner||'Unassigned')+(q.dueAt?' · Due '+esc(fmtDate(q.dueAt)):'')+'</small><p>'+esc(q.answer||'Answer not entered')+'</p><hr class="divider">'+evidenceLinks(q.evidence)+'<div class="record-actions">'+button('edit-question','Edit question',q.id)+'</div></article>').join('')+'</div>':empty('Capture the clarification work','A question can stay open while the current source, owner and deadline are retained.','add-question','Add question'));
}
function packages(){
  const p=state.project;
  return info('Response and receiving packages','Freeze a named edition for review or handoff, then export the complete operating record.',button('create-package','Create package','',true)+button('download-portable','Download current workspace'))+
    '<div class="three-column">'+[['html','Readable report','A complete printable report with requirements, responses, capabilities, team, plan and sources.'],['markdown','Editable response','The same current response package in Markdown for a receiving author.'],['requirements','Requirement matrix','A full CSV matrix for the selected original requirements and coverage decisions.'],['capabilities','Capability records','Company capabilities and past performance with source references.'],['teaming','Teaming decisions','Roles, responsibilities, actual contact disposition and linked requirements.'],['milestones','Delivery schedule','The original deadlines, explicit time zones, owners and dependencies.'],['questions','Clarification register','Complete questions, answers, linked requirements and original source references.']].map(([format,title,description])=>'<section class="record-card"><h3>'+title+'</h3><p>'+description+'</p><div class="record-actions"><button type="button" data-action="export" data-format="'+format+'">Download</button></div></section>').join('')+'</div><h3 class="package-heading">Named package editions</h3>'+
    (arr(p.packages).length?'<div class="card-list package-list">'+arr(p.packages).map(x=>'<article class="record-card"><div class="record-card-head"><div><h3>'+esc(x.title)+'</h3><small>Reviewed revision '+esc(x.sourceRevision??x.projectRevision??x.revision??'')+' · '+esc(x.createdAt||'')+'</small>'+(x.sourceRevision!==undefined?'<small>Package saved at revision '+esc(x.revision)+'</small>':'')+'</div>'+badge(x.status)+'</div><p>'+esc(x.note||'')+'</p><div class="record-actions"><button type="button" data-action="export-package" data-id="'+esc(x.id)+'" data-format="portable">Portable package</button><button type="button" data-action="export-package" data-id="'+esc(x.id)+'" data-format="html">Readable report</button><button type="button" data-action="export-package" data-id="'+esc(x.id)+'" data-format="markdown">Editable response</button></div></article>').join('')+'</div>':empty('Create a named handoff','A package records the selected project revision and its complete source and decision history.','create-package','Create package'));
}
function historyView(){
  const p=state.project;
  const changes=arr(p.changes);
  return info('Source changes and operating history','Review changed source material without overwriting the earlier decisions. Historical editions remain available.')+
    '<section class="surface"><header class="surface-header"><h3>Source changes</h3><span class="muted">'+changes.length+' changes</span></header><div class="surface-body">'+(changes.length?'<div class="card-list">'+changes.map(c=>'<article class="record-card"><div class="record-card-head"><h3>'+esc(c.title||c.description||'Source edition changed')+'</h3>'+badge(c.status)+'</div><p>'+esc(c.summary||c.reason||c.note||'Review the retained source and linked operating decisions.')+'</p><small>'+esc(c.afterSourceId?sourceTitle(c.afterSourceId):c.id)+'</small><p>'+esc(c.decision||'')+'</p><div class="record-actions">'+button('review-change','Review change',c.id)+(c.beforeSourceId?'<button type="button" data-action="view-source" data-id="'+esc(c.beforeSourceId)+'">Read previous source</button>':'')+(c.afterSourceId?'<button type="button" data-action="view-source" data-id="'+esc(c.afterSourceId)+'">Read new source</button>':'')+'</div></article>').join('')+'</div>':'<p>No source replacement has been retained in this project.</p>')+'</div></section>'+
    '<section class="surface"><header class="surface-header"><h3>Retained revisions</h3><button type="button" data-action="compare-revisions">Compare revisions</button></header><div class="table-scroll"><table><thead><tr><th>Revision</th><th>Saved change</th><th>Time / operator</th><th></th></tr></thead><tbody>'+arr(p.history).slice().reverse().map(h=>'<tr><td>'+esc(h.revision)+'</td><td>'+esc(h.label||h.action||h.change||'Saved project')+'</td><td>'+esc(h.createdAt||h.updatedAt||h.at||'')+'<small>'+esc(h.operator||'')+'</small></td><td><button type="button" data-action="view-revision" data-id="'+esc(h.revision)+'">Open revision</button></td></tr>').join('')+'</tbody></table></div></section>'+
    (state.comparison?'<section class="surface"><header class="surface-header"><h3>Revision comparison</h3></header><div class="surface-body"><pre class="source-content">'+esc(JSON.stringify(state.comparison,null,2))+'</pre></div></section>':'');
}
function inputField(name,title,value='',{type='text',required=false,wide=false,hint='',options,rows=4,min,max,placeholder}={}){
  const attr=' name="'+esc(name)+'" id="field-'+esc(name)+'"'+(required?' required':'')+(min!==undefined?' min="'+min+'"':'')+(max!==undefined?' max="'+max+'"':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'');
  let control;
  if(options)control='<select'+attr+'>'+options.map(o=>{const val=Array.isArray(o)?o[0]:o,caption=Array.isArray(o)?o[1]:label(o);return '<option value="'+esc(val)+'"'+(String(value??'')===String(val)?' selected':'')+'>'+esc(caption)+'</option>';}).join('')+'</select>';
  else if(type==='textarea')control='<textarea'+attr+' rows="'+rows+'">'+esc(value)+'</textarea>';
  else control='<input'+attr+' type="'+esc(type)+'"'+(type==='file'?' accept="'+esc(value||'*/*')+'"':' value="'+esc(value)+'"')+'>';
  return '<label class="field'+(wide?' full':'')+'"><span>'+esc(title)+(required?' *':'')+'</span>'+control+(hint?'<small>'+esc(hint)+'</small>':'')+'</label>';
}
function section(title,text=''){return '<div class="form-section"><h3>'+esc(title)+'</h3>'+(text?'<p>'+esc(text)+'</p>':'')+'</div>';}
function choices(name,title,rows,selected=[],describe=row=>row.title||row.name||row.text){
  return '<div class="field full"><span>'+esc(title)+'</span>'+(rows.length?'<div class="choice-list">'+rows.map(row=>'<label class="choice"><input type="checkbox" name="'+esc(name)+'" value="'+esc(row.id)+'"'+(selected.includes(row.id)?' checked':'')+'><div><strong>'+esc(describe(row))+'</strong><small>'+esc(row.kind||row.role||row.number||row.status||'')+'</small></div></label>').join('')+'</div>':'<small>Add the original records in their project section first.</small>')+'</div>';
}
function evidenceFields(selected=[]){
  const sources=arr(state.project?.sources);
  return section('Source references','Select each actual source and identify the relevant question, section, page or field.')+
    (sources.length?'<div class="evidence-list">'+sources.map((source,i)=>{
      const old=arr(selected).find(x=>x.sourceId===source.id);
      return '<div class="evidence-row" data-source-id="'+esc(source.id)+'"><label class="choice"><input type="checkbox" data-evidence-toggle value="'+esc(source.id)+'"'+(old?' checked':'')+'><div><strong>'+esc(source.title)+'</strong><small>'+esc(label(source.role))+' · '+esc(source.filename||source.capturedAt||'')+'</small></div></label><div class="evidence-fields field-grid"'+(!old?' hidden':'')+'>'+inputField('locator_'+i,'Source locator',old?.locator||'',{required:!!old,wide:true,placeholder:'Question 6, page 2, or the original field name'})+inputField('excerpt_'+i,'Selected excerpt',old?.excerpt||'',{type:'textarea',wide:true,rows:2,hint:'An optional exact excerpt from the retained source.'})+'</div></div>';
    }).join('')+'</div>':'<p class="muted">Retain the original source in Sources before linking evidence.</p>');
}
function readEvidence(form){
  return [...form.querySelectorAll('.evidence-row')].filter(row=>row.querySelector('[data-evidence-toggle]').checked).map(row=>{
    const locator=row.querySelector('[name^="locator_"]').value.trim();
    if(!locator)throw new Error('Enter a locator for every selected source.');
    return {sourceId:row.dataset.sourceId,locator,excerpt:row.querySelector('[name^="excerpt_"]').value};
  });
}
function checked(form,name){return [...form.querySelectorAll('input[name="'+name+'"]:checked')].map(x=>x.value);}
function formValues(form){return Object.fromEntries(new FormData(form));}
function openEditor({title,context=state.project?.title||'Opportunity Operations',fields,save,footnote='Changes are saved to the current project revision.',saveLabel='Save'}){
  state.editor={save,requestId:crypto.randomUUID()};
  $('#editor-title').textContent=title;$('#editor-context').textContent=context;$('#editor-fields').innerHTML=fields;
  $('#editor-error').hidden=true;$('#editor-error').textContent='';$('#editor-footnote').textContent=footnote;$('#editor-save').textContent=saveLabel;
  $('#editor').showModal();
  const first=$('#editor-fields input:not([type="checkbox"]),#editor-fields select,#editor-fields textarea');first?.focus();
}
function closeEditor(){if(state.busy)return;$('#editor').close();state.editor=null;}
function editProject(create=false){
  const p=create?{}:state.project,c=p.company||{},o=p.opportunity||{};
  const fields=section('Project')+'<div class="field-grid">'+inputField('title','Project title',p.title||'',{required:true,wide:true})+inputField('description','Working description',p.description||'',{type:'textarea',wide:true})+'</div>'+
    section('Company context')+'<div class="field-grid">'+inputField('companyName','Company name',c.name||'',{required:true})+inputField('companyWebsite','Website',c.website||'',{type:'url'})+inputField('companyUei','UEI',c.uei||'')+inputField('companySize','Size / classification',c.size||'')+inputField('companyNaics','NAICS codes',arr(c.naics).join(', '),{wide:true,hint:'Separate the original codes with commas.'})+inputField('companyDescription','Company description',c.description||'',{type:'textarea',wide:true})+'</div>'+
    section('Selected opportunity')+'<div class="field-grid">'+inputField('opportunityTitle','Opportunity title',o.title||'',{wide:true})+inputField('buyer','Buyer / issuer',o.buyer||'')+inputField('reference','Notice / solicitation reference',o.reference||'')+inputField('url','Original notice URL',o.url||'',{type:'url',wide:true})+inputField('documentKind','Document type',o.documentKind||'other',{options:['rfi','sources_sought','solicitation','implementation_target','other']})+inputField('stage','Current stage',o.stage||'research',{options:['research','qualifying','preparing','submitted','closed']})+inputField('dueAt','Response deadline',o.dueAt||'',{placeholder:'2026-10-29T18:00:00-04:00',hint:'Use the issuer timestamp with its UTC offset.'})+inputField('timeZone','Stated time zone',o.timeZone||'',{placeholder:'America/New_York',hint:'Retain any ambiguity in the notes.'})+inputField('notes','Opportunity notes',o.notes||'',{type:'textarea',wide:true})+'</div>';
  openEditor({title:create?'Create operating project':'Edit project',fields,save:async(form,requestId)=>{
    const v=formValues(form);
    const payload={...(create?{}:{id:p.id,expectedRevision:p.revision}),requestId,title:v.title,description:v.description,company:{name:v.companyName,website:v.companyWebsite,uei:v.companyUei,naics:v.companyNaics.split(',').map(x=>x.trim()).filter(Boolean),size:v.companySize,description:v.companyDescription},opportunity:{title:v.opportunityTitle,buyer:v.buyer,reference:v.reference,url:v.url,documentKind:v.documentKind,stage:v.stage,dueAt:v.dueAt,timeZone:v.timeZone,notes:v.notes}};
    await dispatch(create?'create':'update',payload,{message:create?'Project created. Retain the original sources to begin the operating work.':'Project context saved.'});
  }});
}
function editRules(){
  const p=state.project,r=p.responseRules||{};
  openEditor({title:'Edit response instructions',fields:'<div class="field-grid">'+inputField('maxPages','Response page limit',r.maxPages??'',{type:'number',min:1})+inputField('capabilityMaxPages','Past-performance page limit',r.capabilityMaxPages??'',{type:'number',min:1})+inputField('excludedSections','Sections excluded from the limit',arr(r.excludedSections).join(', '),{wide:true,hint:'Use the issued section names, separated by commas.'})+inputField('notes','Complete response instructions',r.notes||'',{type:'textarea',wide:true,rows:6,hint:'Record actual formatting, N/A treatment, experience restrictions and response rules.'})+'</div>'+evidenceFields(r.evidence),save:async(form,requestId)=>{
    const v=formValues(form);const responseRules={excludedSections:v.excludedSections.split(',').map(x=>x.trim()).filter(Boolean),notes:v.notes,evidence:readEvidence(form)};
    if(v.maxPages)responseRules.maxPages=Number(v.maxPages);if(v.capabilityMaxPages)responseRules.capabilityMaxPages=Number(v.capabilityMaxPages);
    await dispatch('update',{id:p.id,expectedRevision:p.revision,requestId,responseRules},{message:'Issued response instructions saved.'});
  }});
}
async function fileBase64(file){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The selected file could not be read.'));reader.readAsDataURL(file);});
}
function retainSource(replacesSourceId=''){
  const p=state.project,old=find('sources',replacesSourceId)||{};
  openEditor({title:replacesSourceId?'Retain a changed source edition':'Retain original source',fields:'<div class="help-box">Choose a source file or enter its complete text. The previous edition remains available when you retain a replacement.</div><div class="field-grid">'+inputField('title','Source title',old.title||'',{required:true,wide:true})+inputField('role','Source role',old.role||'solicitation',{options:roles})+inputField('capturedAt','Captured at',new Date().toISOString(),{required:true,hint:'Original capture time, including its UTC offset.'})+inputField('url','Original source URL',old.url||'',{type:'url',wide:true})+inputField('filename','Original filename',old.filename||'',{required:true,hint:'For text input, name the retained source file.'})+inputField('mediaType','Media type',old.mediaType||'text/plain')+inputField('sourceFile','Source file','*/*',{type:'file',wide:true,hint:'The complete original file, up to 24 MiB.'})+inputField('contentText','Complete source text','',{type:'textarea',wide:true,rows:8,hint:'Use this when there is no selected file. The source is retained exactly as entered.'})+inputField('sourceTerms','Source / retained-use terms',old.sourceTerms||'',{type:'textarea',wide:true,rows:2})+'</div>',saveLabel:'Retain source',save:async(form,requestId)=>{
    const v=formValues(form),file=form.elements.sourceFile.files[0];
    if(file&&v.contentText)throw new Error('Select the original file or enter source text, using one input for this edition.');
    if(file?.size>24*1024*1024)throw new Error('The source is larger than the 24 MiB retained-source limit.');
    if(!file&&!v.contentText)throw new Error('Select the complete original source file or enter its text.');
    const payload={id:p.id,expectedRevision:p.revision,requestId,role:v.role,title:v.title,url:v.url,capturedAt:v.capturedAt,filename:v.filename,mediaType:v.mediaType,sourceTerms:v.sourceTerms,...(replacesSourceId?{replacesSourceId}:{}),...(file?{contentBase64:await fileBase64(file)}:{contentText:v.contentText})};
    await dispatch('retain_source',payload,{message:replacesSourceId?'Changed source retained. Review its linked decisions in Changes & history.':'Original source retained and available to the requirement and capability records.'});
  }});
}
function importAwards(){
  const p=state.project;
  openEditor({title:'Import original USAspending edition',fields:'<div class="help-box">Select the complete edition export from the maintained USAspending research workspace. The original rows, source pages, detail records and receiving identity travel together.</div><div class="field-grid">'+inputField('label','Source label','Federal award background',{required:true,wide:true})+inputField('packetFile','Original edition JSON','application/json,.json',{type:'file',required:true,wide:true})+'</div>',saveLabel:'Import edition',save:async(form,requestId)=>{
    const v=formValues(form),file=form.elements.packetFile.files[0];if(!file)throw new Error('Select the complete original edition JSON.');
    const packet=JSON.parse(await file.text());
    await dispatch('import_award_edition',{id:p.id,expectedRevision:p.revision,requestId,label:v.label,packet},{message:'Original award edition received into the project source store.'});
  }});
}
function editCapability(id=''){
  const p=state.project,c=find('capabilities',id)||{};
  openEditor({title:id?'Edit capability record':'Add capability or past performance',fields:'<div class="field-grid">'+inputField('title','Record title',c.title||'',{required:true,wide:true})+inputField('kind','Record type',c.kind||'capability',{options:['capability','past_performance']})+inputField('status','Review status',c.status||'draft',{options:['draft','reviewed','retired']})+inputField('deliveryStatus','Actual delivery state',c.deliveryStatus||'unspecified',{options:['unspecified','deployed','pilot','proposed'],hint:'Select the state supported by the retained source.'})+inputField('owner','Responsible person',c.owner||'')+inputField('tags','Tags',arr(c.tags).join(', '),{hint:'Separate tags with commas.'})+inputField('description','Complete capability / experience record',c.description||'',{type:'textarea',required:true,wide:true,rows:7,hint:'Retain the actual scope, delivery role and operating context supported by the selected source.'})+'</div>'+evidenceFields(c.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_capability',{id:p.id,expectedRevision:p.revision,requestId,...(id?{capabilityId:id}:{}),title:v.title,kind:v.kind,status:v.status,deliveryStatus:v.deliveryStatus,owner:v.owner,description:v.description,tags:v.tags.split(',').map(x=>x.trim()).filter(Boolean),evidence:readEvidence(form)},{message:'Capability record saved.'});
  }});
}
function editRequirement(id=''){
  const p=state.project,r=find('requirements',id)||{};
  openEditor({title:id?'Edit requirement':'Add issued requirement or question',fields:'<div class="field-grid">'+inputField('number','Issued number / reference',r.number||'',{required:true})+inputField('category','Category',r.category||'')+inputField('title','Requirement title',r.title||'',{required:true,wide:true})+inputField('text','Complete issued requirement',r.text||'',{type:'textarea',required:true,wide:true,rows:7})+inputField('mandatory','Treatment',r.mandatory?'true':'false',{options:[['true','Required'],['false','Requested / informational']]})+inputField('responseDisposition','Response disposition',r.responseDisposition||'unanswered',{options:['unanswered','answer','not_applicable']})+inputField('evidenceRule','Issued experience rule',r.evidenceRule||'any',{options:[['any','Any source-backed relevant experience'],['deployed_only','Deployed experience only']],hint:'Use deployed-only when the actual question explicitly requires it.'})+inputField('owner','Response owner',r.owner||'')+inputField('status','Working status',r.status||'open',{options:['open','in_progress','reviewed','retired']})+'</div>'+evidenceFields(r.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_requirement',{id:p.id,expectedRevision:p.revision,requestId,...(id?{requirementId:id}:{}),number:v.number,title:v.title,text:v.text,category:v.category,mandatory:v.mandatory==='true',responseDisposition:v.responseDisposition,evidenceRule:v.evidenceRule,owner:v.owner,status:v.status,evidence:readEvidence(form)},{message:'Requirement saved with its original source references.'});
  }});
}
function editCoverage(requirementId){
  const p=state.project,r=find('requirements',requirementId);if(!r)throw new Error('The requirement is unavailable.');
  const c=arr(p.coverage).find(x=>x.requirementId===requirementId)||{};
  openEditor({title:'Review requirement coverage',fields:'<section class="help-box"><strong>'+esc(r.number)+' · '+esc(r.title)+'</strong><p class="text-block">'+esc(r.text)+'</p>'+evidenceLinks(r.evidence)+'</section><div class="field-grid">'+inputField('decision','Coverage decision',c.decision||'unreviewed',{options:['unreviewed','supported','partial','gap','team_required','exception']})+inputField('owner','Responsible person',c.owner||r.owner||'')+choices('capabilityIds','Selected company capabilities',arr(p.capabilities),arr(c.capabilityIds))+choices('teamIds','Selected teaming records',arr(p.teaming),arr(c.teamIds),x=>x.name+' · '+x.role)+inputField('response','Complete proposed response',c.response||'',{type:'textarea',wide:true,rows:9,hint:'Use the actual answer and source-backed experience. Apply the issued N/A rule where appropriate.'})+inputField('reviewNote','Decision and follow-up work',c.reviewNote||'',{type:'textarea',wide:true,rows:4})+'</div>'+evidenceFields(c.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_coverage',{id:p.id,expectedRevision:p.revision,requestId,requirementId,decision:v.decision,owner:v.owner,response:v.response,reviewNote:v.reviewNote,capabilityIds:checked(form,'capabilityIds'),teamIds:checked(form,'teamIds'),evidence:readEvidence(form)},{message:'Coverage decision and complete response saved.'});
  }});
}
function editTeam(id=''){
  const p=state.project,t=find('teaming',id)||{};
  openEditor({title:id?'Edit teaming decision':'Add teaming record',fields:'<div class="field-grid">'+inputField('name','Company / team name',t.name||'',{required:true})+inputField('role','Proposed delivery role',t.role||'',{required:true})+inputField('decision','Actual relationship disposition',t.decision||'considering',{options:['considering','contacted','confirmed','declined']})+inputField('owner','Relationship owner',t.owner||'')+inputField('scope','Responsibilities and workshare',t.scope||'',{type:'textarea',required:true,wide:true,rows:5})+choices('capabilityIds','Relevant company capabilities',arr(p.capabilities),arr(t.capabilityIds))+choices('requirementIds','Requirements this team supports',arr(p.requirements),arr(t.requirementIds),r=>(r.number?r.number+' · ':'')+r.title)+inputField('note','Decision notes',t.note||'',{type:'textarea',wide:true,rows:3})+'</div>'+evidenceFields(t.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_team',{id:p.id,expectedRevision:p.revision,requestId,...(id?{teamId:id}:{}),name:v.name,role:v.role,decision:v.decision,owner:v.owner,scope:v.scope,note:v.note,capabilityIds:checked(form,'capabilityIds'),requirementIds:checked(form,'requirementIds'),evidence:readEvidence(form)},{message:'Teaming decision saved.'});
  }});
}
function editMilestone(id=''){
  const p=state.project,m=find('milestones',id)||{};
  openEditor({title:id?'Edit delivery milestone':'Add delivery milestone',fields:'<div class="field-grid">'+inputField('title','Milestone',m.title||'',{required:true,wide:true})+inputField('owner','Responsible person',m.owner||'',{required:true})+inputField('status','Status',m.status||'open',{options:['open','in_progress','done','cancelled']})+inputField('dueAt','Deadline',m.dueAt||'',{required:true,placeholder:'2026-10-29T18:00:00-04:00',hint:'Include the source’s explicit UTC offset.'})+inputField('timeZone','Stated time zone',m.timeZone||p.opportunity?.timeZone||'')+choices('dependsOn','Complete these milestones first',arr(p.milestones).filter(x=>x.id!==id),arr(m.dependsOn))+choices('requirementIds','Linked requirements',arr(p.requirements),arr(m.requirementIds),r=>(r.number?r.number+' · ':'')+r.title)+inputField('note','Operating notes',m.note||'',{type:'textarea',wide:true,rows:4})+'</div>'+evidenceFields(m.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_milestone',{id:p.id,expectedRevision:p.revision,requestId,...(id?{milestoneId:id}:{}),title:v.title,owner:v.owner,status:v.status,dueAt:v.dueAt,timeZone:v.timeZone,dependsOn:checked(form,'dependsOn'),requirementIds:checked(form,'requirementIds'),note:v.note,evidence:readEvidence(form)},{message:'Milestone and dependencies saved.'});
  }});
}
function editQuestion(id=''){
  const p=state.project,q=find('questions',id)||{};
  openEditor({title:id?'Edit clarification record':'Add clarification question',fields:'<div class="field-grid">'+inputField('number','Question reference',q.number||'')+inputField('status','Status',q.status||'open',{options:['open','submitted','answered','parked']})+inputField('text','Complete question',q.text||'',{type:'textarea',required:true,wide:true,rows:5})+inputField('owner','Question owner',q.owner||'')+inputField('dueAt','Question deadline',q.dueAt||'',{placeholder:'2026-10-14T15:00:00-04:00'})+inputField('answer','Original answer and operating interpretation',q.answer||'',{type:'textarea',wide:true,rows:6})+choices('requirementIds','Affected requirements',arr(p.requirements),arr(q.requirementIds),r=>(r.number?r.number+' · ':'')+r.title)+'</div>'+evidenceFields(q.evidence),save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('save_question',{id:p.id,expectedRevision:p.revision,requestId,...(id?{questionId:id}:{}),number:v.number,text:v.text,owner:v.owner,dueAt:v.dueAt,status:v.status,answer:v.answer,requirementIds:checked(form,'requirementIds'),evidence:readEvidence(form)},{message:'Clarification record saved.'});
  }});
}
function reviewChange(id){
  const p=state.project,c=find('changes',id)||{};
  const records=[...arr(p.requirements),...arr(p.capabilities),...arr(p.teaming),...arr(p.milestones),...arr(p.questions)];
  openEditor({title:'Review source change',fields:'<div class="help-box">'+esc(c.description||c.summary||c.note||'Review the changed source and its effect on the retained operating decisions.')+'</div><div class="field-grid">'+inputField('status','Review state',c.status||'pending',{options:['pending','reviewed']})+inputField('decision','Operating decision',c.decision||'',{required:true})+inputField('note','Review and required corrections',c.note||'',{type:'textarea',wide:true,rows:6})+choices('affectedIds','Affected operating records',records,arr(c.affectedIds),x=>x.title||x.name||x.text)+'</div>',save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('review_change',{id:p.id,expectedRevision:p.revision,requestId,changeId:id,status:v.status,decision:v.decision,note:v.note,affectedIds:checked(form,'affectedIds')},{message:'Source change review saved.'});
  }});
}
function createPackage(){
  const p=state.project;
  openEditor({title:'Create named package edition',fields:'<div class="help-box">This edition carries the selected requirement and response matrix, company and team records, plan, sources and operating history.</div><div class="field-grid">'+inputField('title','Package title',p.title+' — review package',{required:true,wide:true})+inputField('status','Package disposition','ready_for_review',{options:['draft','ready_for_review','approved_for_handoff'],wide:true})+inputField('note','Receiving instructions', '',{type:'textarea',wide:true,rows:5})+'</div>',saveLabel:'Create package',save:async(form,requestId)=>{
    const v=formValues(form);await dispatch('create_package',{id:p.id,expectedRevision:p.revision,requestId,title:v.title,status:v.status,note:v.note},{message:'Named package edition created. Download its portable record or readable response from Packages.'});
  }});
}
function compareRevisions(){
  const p=state.project,values=arr(p.history).map(x=>[String(x.revision),'Revision '+x.revision+' · '+(x.label||x.action||'Saved project')]);
  openEditor({title:'Compare retained revisions',fields:'<div class="field-grid">'+inputField('before','Earlier revision',String(Math.max(1,p.revision-1)),{options:values})+inputField('after','Later revision',String(p.revision),{options:values})+'</div>',saveLabel:'Compare',footnote:'Comparison reads the two selected retained revisions.',save:async(form)=>{
    const v=formValues(form);state.comparison=await api('/api/dispatch',{method:'POST',body:{action:'compare',payload:{id:p.id,before:Number(v.before),after:Number(v.after)}}});state.tab='history';render();
  }});
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadExport(format,packageId){
  const p=state.project;
  const params=new URLSearchParams({format,...(packageId?{packageId}:state.historical?{revision:String(p.revision)}:{})});
  const response=await fetch('/api/projects/'+encodeURIComponent(p.id)+'/export?'+params,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const data=await response.json();throw Object.assign(new Error(data.message||data.error),{code:data.error});}
  const match=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'');
  downloadBlob(await response.blob(),match?.[1]||'opportunity-package.'+(format==='portable'?'json':format==='html'?'html':format==='markdown'?'md':'csv'));
  notice('Complete '+(format==='portable'?'receiving package':label(format)+' export')+' downloaded.');
}
async function sourceBytes(id){
  return api('/api/dispatch',{method:'POST',body:{action:'read_source',payload:{id:state.project.id,sourceId:id}}});
}
async function viewSource(id,download=false){
  const result=await sourceBytes(id),s=result.source||find('sources',id)||{};
  if(download){const raw=atob(result.contentBase64||''),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);downloadBlob(new Blob([bytes],{type:s.mediaType||'application/octet-stream'}),s.filename||'original-source.bin');return;}
  $('#source-viewer-title').textContent=s.title||'Original source';
  $('#source-viewer-body').innerHTML='<dl class="detail-list"><dt>Source role</dt><dd>'+esc(label(s.role))+'</dd><dt>Original URL</dt><dd>'+safeLink(s.url)+'</dd><dt>Captured at</dt><dd>'+esc(s.capturedAt||'')+'</dd><dt>File</dt><dd>'+esc(s.filename||'')+'</dd><dt>SHA-256</dt><dd>'+esc(s.sha256||'')+'</dd></dl><hr class="divider">'+(result.contentText!==null&&result.contentText!==undefined?'<pre class="source-content">'+esc(result.contentText)+'</pre>':'<p>The original binary source is retained. Download it to open it with the appropriate application.</p>')+'<div class="record-actions"><button type="button" data-action="download-source" data-id="'+esc(id)+'">Download original source</button></div>';
  $('#source-viewer').showModal();
}
async function handleAction(action,id,target){
  switch(action){
    case 'dismiss-notice':notice('');break;
    case 'create-project':editProject(true);break;
    case 'edit-project':editProject();break;
    case 'edit-rules':editRules();break;
    case 'open-project':state.tab='overview';state.search='';state.filter='';state.comparison=null;await refresh(id);break;
    case 'current-project':await refresh(state.project.id);break;
    case 'add-source':retainSource();break;
    case 'replace-source':retainSource(id);break;
    case 'import-awards':importAwards();break;
    case 'view-source':await viewSource(id);break;
    case 'download-source':await viewSource(id,true);break;
    case 'close-source':$('#source-viewer').close();break;
    case 'add-capability':editCapability();break;
    case 'edit-capability':editCapability(id);break;
    case 'add-requirement':editRequirement();break;
    case 'edit-requirement':editRequirement(id);break;
    case 'edit-coverage':editCoverage(id);break;
    case 'add-team':editTeam();break;
    case 'edit-team':editTeam(id);break;
    case 'add-milestone':editMilestone();break;
    case 'edit-milestone':editMilestone(id);break;
    case 'add-question':editQuestion();break;
    case 'edit-question':editQuestion(id);break;
    case 'review-change':reviewChange(id);break;
    case 'create-package':createPackage();break;
    case 'compare-revisions':compareRevisions();break;
    case 'view-revision':state.project=await api('/api/projects/'+encodeURIComponent(state.project.id)+'?revision='+encodeURIComponent(id));state.historical=true;render();break;
    case 'receive-package':$('#portable-file').click();break;
    case 'download-portable':await downloadExport('portable');break;
    case 'download-requirements':await downloadExport('requirements');break;
    case 'export':await downloadExport(target.dataset.format);break;
    case 'export-package':await downloadExport(target.dataset.format,id);break;
  }
}
document.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-tab]');
  if(tab){state.tab=tab.dataset.tab;state.search='';state.filter='';render();return;}
  const target=event.target.closest('[data-action]');if(!target||target.disabled||state.busy)return;
  try{await handleAction(target.dataset.action,target.dataset.id,target);}catch(error){notice(apiError(error),'error');}
});
document.addEventListener('input',event=>{
  if(event.target.id==='project-search'){renderProjects();return;}
  if(event.target.id==='panel-search'){const pos=event.target.selectionStart;state.search=event.target.value;render();const input=$('#panel-search');input?.focus();try{input?.setSelectionRange(pos,pos);}catch{}}
  if(event.target.closest('#editor-form')&&state.editor)state.editor.requestId=crypto.randomUUID();
});
document.addEventListener('change',event=>{
  if(event.target.id==='panel-filter'){state.filter=event.target.value;render();}
  if(event.target.matches('[data-evidence-toggle]')){
    const group=event.target.closest('.evidence-row'),fields=group.querySelector('.evidence-fields');
    fields.hidden=!event.target.checked;fields.querySelector('[name^="locator_"]').required=event.target.checked;
  }
  if(event.target.name==='sourceFile'&&event.target.files[0]){
    const file=event.target.files[0];$('#field-filename').value=file.name;
    if(file.type)$('#field-mediaType').value=file.type;
  }
  if(event.target.closest('#editor-form')&&state.editor)state.editor.requestId=crypto.randomUUID();
});
$('#editor-form').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy||!state.editor)return;
  const editor=state.editor;setBusy(true);$('#editor-error').hidden=true;
  try{await editor.save(event.currentTarget,editor.requestId);setBusy(false);closeEditor();}
  catch(error){$('#editor-error').textContent=apiError(error);$('#editor-error').hidden=false;setBusy(false);}
});
$('#editor-close').addEventListener('click',closeEditor);$('#editor-cancel').addEventListener('click',closeEditor);
$('#editor').addEventListener('cancel',event=>{if(state.busy)event.preventDefault();else state.editor=null;});
$('#new-project').addEventListener('click',()=>editProject(true));
$('#receive-package').addEventListener('click',()=>$('#portable-file').click());
$('#refresh-all').addEventListener('click',async()=>{try{setBusy(true,'Opening the current operating record…');await refresh();notice('Current project reopened.');}catch(error){notice(apiError(error),'error');}finally{setBusy(false);}});
$('#portable-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{setBusy(true,'Receiving the complete source and operating history…');const packet=JSON.parse(await file.text());const result=await api('/api/receive',{method:'POST',body:{packet}});await refresh(result?.project?.id||result.id);state.tab='overview';render();notice('Complete project received and reopened with its source and decision history.');}
  catch(error){notice(apiError(error),'error');}finally{event.target.value='';setBusy(false);}
});
async function connect(){
  if(!token){
    openEditor({title:'Open private operator workspace',context:'Workspace access',fields:inputField('token','Operator token','',{type:'password',required:true,wide:true,hint:'Use the token in the original workspace launch URL.'}),saveLabel:'Connect',footnote:'The token stays in this browser session.',save:async form=>{token=form.elements.token.value.trim();sessionStorage.setItem('opportunity-token',token);await refresh();}});
    return;
  }
  try{await refresh();}catch(error){$('#connection-state').textContent='Connection needs attention';notice(apiError(error),'error');if(error.code==='AUTH_REQUIRED'){token='';sessionStorage.removeItem('opportunity-token');await connect();}}
}
await connect();
