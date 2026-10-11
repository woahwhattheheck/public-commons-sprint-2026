const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const list = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uri = value => encodeURIComponent(String(value ?? ''));
const json = value => JSON.stringify(value, null, 2);
const human = value => String(value ?? '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const time = value => !value ? 'Not recorded' : Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : String(value);
const short = value => String(value ?? '').slice(0, 12);
const count = value => Array.isArray(value) ? value.length : value ?? 0;
const tabs = [['overview','Manager overview'],['sources','Original CRM sources'],['config','Pipeline definitions'],['runs','Saved monitoring runs'],['attention','Daily attention'],['cohorts','Cohorts & trends'],['actions','Follow-up work'],['handoff','History & handover']];
const reasonNames = {
  OVERDUE_DECLARED_NEXT_ACTION:'Declared next action is overdue',
  NO_PARSEABLE_DECLARED_NEXT_ACTION_DATE:'Next action date is missing or unreadable',
  STALE_CRM_RECORD_UPDATE_NOT_CONTACT_PROOF:'CRM record has not been updated recently'
};
const reviewStates = ['open','confirmed','dismissed','resolved','deferred'];
const ui = {
  index:null, projectId:'', data:null, schema:null, tab:'overview', snapshotId:'', snapshot:null,
  deals:null, dealOffset:0, dealFilters:{search:'',pipeline:'',owner:''}, runId:'', run:null, report:null,
  alerts:null, alertOffset:0, alertFilters:{search:'',owner:'',status:'',reason:''}, alertDetail:null,
  cohorts:null, cohortOffset:0, compareId:'', comparison:null, actionId:'', actionDetail:null,
  busy:false, pending:null, incoming:false, poll:null
};
const drafts = new Map(), disabled = new WeakMap(), reports = new Map(), collectionCache = new Map(), collectionTotals = new Map();
const project = () => ui.data?.project || null;
const rows = key => list(ui.data?.[key]);
const item = (key, id) => rows(key).find(value => value.id === id);
const base = () => '/api/projects/' + uri(ui.projectId);
const runName = id => item('runs', id)?.name || id || 'Not selected';
const snapshotName = id => item('snapshots', id)?.name || id || 'Not selected';
const operator = () => $('#operator').value.trim() || 'Operator';
const button = (label, act, attrs='', cls='') => `<button type="button" data-act="${esc(act)}" class="${cls}" ${attrs}>${esc(label)}</button>`;
const link = (label, url, download=false) => `<a class="button" href="${esc(url)}" ${download?'download':''}>${esc(label)}</a>`;
const badge = (value, strong=false) => `<span class="badge${strong?' strong':''}">${esc(human(value || 'pending'))}</span>`;
const empty = text => `<div class="empty">${esc(text)}</div>`;
const field = (name, label, value='', options={}) => `<label>${esc(label)}${options.textarea
  ? `<textarea name="${esc(name)}" aria-label="${esc(label)}" rows="${options.rows||4}" ${options.required?'required':''} ${options.mono?'class="mono"':''}>${esc(value)}</textarea>`
  : `<input name="${esc(name)}" aria-label="${esc(label)}" value="${esc(value)}" type="${options.type||'text'}" ${options.required?'required':''} ${options.min!==undefined?`min="${options.min}"`:''} ${options.max!==undefined?`max="${options.max}"`:''} ${options.list?`list="${esc(options.list)}"`:''} ${options.placeholder?`placeholder="${esc(options.placeholder)}"`:''}>`}
  ${options.help?`<span class="help">${esc(options.help)}</span>`:''}</label>`;
function select(name, label, choices, selected='', help='') {
  const options = choices.map(value => Array.isArray(value) ? value : [value,human(value)]);
  if (selected && !options.some(([value]) => String(value) === String(selected))) options.unshift([selected,selected]);
  return `<label>${esc(label)}<select name="${esc(name)}" aria-label="${esc(label)}">${options.map(([value,text])=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(text)}</option>`).join('')}</select>${help?`<span class="help">${esc(help)}</span>`:''}</label>`;
}
const check = (name,label,value) => `<label class="check"><input type="checkbox" name="${esc(name)}" ${value?'checked':''}>${esc(label)}</label>`;
const heading = (title,description,actions='') => `<div class="pagehead"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;
const metrics = values => `<div class="metrics">${values.map(([label,value])=>`<div class="metric"><strong>${esc(value??'—')}</strong><span>${esc(label)}</span></div>`).join('')}</div>`;
const kv = values => `<dl class="keyvals">${Object.entries(object(values)).map(([key,value])=>`<dt>${esc(human(key))}</dt><dd>${value!==null&&typeof value==='object'?`<pre>${esc(json(value))}</pre>`:esc(value??'Not supplied')}</dd>`).join('')}</dl>`;
function table(values, columns, cls='data', noRows='No retained records yet.') {
  if (!values.length) return empty(noRows);
  return `<div class="tablewrap"><table class="${cls}"><thead><tr>${columns.map(c=>`<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${values.map(row=>`<tr>${columns.map(c=>`<td>${c.render?c.render(row):esc(row[c.key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function pager(kind, offset, total, limit=50) {
  return `<div class="pager"><span>${total?offset+1:0}–${Math.min(offset+limit,total)} of ${total} records</span><div class="actions">${button('Previous',kind+'-page',`data-offset="${Math.max(0,offset-limit)}" ${offset===0?'disabled':''}`)}${button('Next',kind+'-page',`data-offset="${offset+limit}" ${offset+limit>=total?'disabled':''}`)}</div></div>`;
}
function safeDealLink(url) {
  try { const value=new URL(url); if(value.protocol==='https:') return `<a href="${esc(value.href)}" target="_blank" rel="noopener noreferrer">Open native deal</a>`; } catch {}
  return '';
}
function draft(key, defaults={}) {
  if (!drafts.has(key)) drafts.set(key,{...structuredClone(defaults),_base:structuredClone(defaults),dirty:false});
  return drafts.get(key);
}
function setPath(target, path, value) {
  const keys=path.split('.'); let current=target;
  for(let i=0;i<keys.length;i++) {
    const key=keys[i]; if(['__proto__','prototype','constructor'].includes(key)) throw Error('Unsupported field name.');
    if(i===keys.length-1) current[key]=value;
    else { if(!current[key]||typeof current[key]!=='object') current[key]=/^\d+$/.test(keys[i+1])?[]:{}; current=current[key]; }
  }
}
function captureForm(form) {
  const key=form.dataset.draft; if(!key) return;
  const value=draft(key);
  for(const control of form.querySelectorAll('[name]')) {
    if(control.disabled||control.type==='submit') continue;
    let next=control.type==='checkbox'?control.checked:control.value;
    if(control.type==='file') { if(!control.files.length) continue; next=control.files[0]; }
    setPath(value,control.name,next);
  }
  value.dirty=true;
}
function captureDrafts() { for(const form of all('form[data-draft]')) if(drafts.get(form.dataset.draft)?.dirty) captureForm(form); }
function values(key) { const form=all('form[data-draft]').find(f=>f.dataset.draft===key); if(form) captureForm(form); return draft(key); }
function mergeChanged(original, edited, current) {
  if(JSON.stringify(original)===JSON.stringify(edited)) return structuredClone(current);
  if(original&&edited&&current&&[original,edited,current].every(v=>typeof v==='object'&&!Array.isArray(v))) {
    const next=structuredClone(current);
    for(const key of new Set([...Object.keys(original),...Object.keys(edited)])) {
      if(!(key in edited)) { if(key in original) delete next[key]; }
      else next[key]=mergeChanged(original[key],edited[key],current[key]);
    }
    return next;
  }
  return structuredClone(edited);
}
const isEditing = () => $('#dialog').open || all('form[data-draft]').some(f=>drafts.get(f.dataset.draft)?.dirty) || document.activeElement?.closest('form');
function tell(message) { $('#notice').textContent=message; $('#notice').hidden=!message; }
function busy(value) {
  ui.busy=value; document.body.classList.toggle('working',value);
  for(const control of all('button,input,select,textarea')) {
    if(value) { if(!disabled.has(control)) disabled.set(control,control.disabled); control.disabled=true; }
    else if(disabled.has(control)) { control.disabled=disabled.get(control); disabled.delete(control); }
  }
  renderConflict();
}
async function request(url, options={}) {
  let response;
  try { response=await fetch(url,{...options,cache:'no-store'}); }
  catch(cause) { const error=new Error('The connection ended before a saved result was received.'); error.transport=true; error.cause=cause; throw error; }
  let value;
  try { value=await response.json(); }
  catch(cause) { const error=new Error(`The service returned an unreadable response (${response.status}).`); error.transport=response.ok; error.cause=cause; throw error; }
  if(!response.ok) { const error=new Error(value.message||value.error||`Request failed (${response.status}).`); error.status=response.status; error.code=value.error; error.data=value; throw error; }
  return value;
}
async function fileContent(file) {
  if(!file) throw Error('Choose the original file.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const chunks=[]; for(let i=0;i<bytes.length;i+=8192) chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(chunks.join(''));
}
function selectProject(id) {
  if(ui.projectId===id) return;
  captureDrafts(); ui.projectId=id; ui.data=null; ui.schema=null; ui.snapshotId=''; ui.snapshot=null; ui.deals=null; ui.dealOffset=0;
  ui.runId=''; ui.run=null; ui.report=null; ui.alerts=null; ui.alertOffset=0; ui.alertDetail=null; ui.cohorts=null; ui.cohortOffset=0;
  ui.compareId=''; ui.comparison=null; ui.actionId=''; ui.actionDetail=null;
}
async function loadDetails() {
  if(!project()) return;
  ui.schema=await request(base()+'/schema');
  if(!item('snapshots',ui.snapshotId)) ui.snapshotId=rows('snapshots')[0]?.id||'';
  if(!item('runs',ui.runId)) ui.runId=rows('runs')[0]?.id||'';
  if(ui.tab==='sources'&&ui.snapshotId) {
    ui.snapshot=await request('/api/snapshots/'+uri(ui.snapshotId));
    ui.deals=await request('/api/snapshots/'+uri(ui.snapshotId)+'/deals?'+new URLSearchParams({offset:String(ui.dealOffset),limit:'50',...ui.dealFilters}));
  }
  if(ui.runId&&['overview','runs','attention','cohorts','actions','handoff'].includes(ui.tab)) {
    ui.run=await request('/api/runs/'+uri(ui.runId));
    if(ui.run.run.status==='completed'&&!reports.has(ui.runId)) reports.set(ui.runId,await request('/api/runs/'+uri(ui.runId)+'/report'));
    ui.report=ui.run.run.status==='completed'?(reports.get(ui.runId)||null):null;
    if(!ui.report) { ui.alerts=null; ui.cohorts=null; ui.comparison=null; }
    if(ui.tab==='attention'&&ui.report) {
      ui.alerts=await request('/api/runs/'+uri(ui.runId)+'/alerts?'+new URLSearchParams({offset:String(ui.alertOffset),limit:'50',...ui.alertFilters}));
      if(ui.alertDetail) {
        const current=await request('/api/runs/'+uri(ui.runId)+'/alerts?'+new URLSearchParams({search:ui.alertDetail.dealId,limit:'50'}));
        ui.alertDetail=list(current.alerts).find(a=>a.dealId===ui.alertDetail.dealId)||ui.alertDetail;
      }
    }
    if(ui.tab==='cohorts'&&ui.report) ui.cohorts=await request('/api/runs/'+uri(ui.runId)+'/cohorts?offset='+ui.cohortOffset+'&limit=50');
    if(ui.compareId&&ui.report&&['runs','cohorts'].includes(ui.tab)) ui.comparison=await request('/api/runs/'+uri(ui.runId)+'/compare?baseline='+uri(ui.compareId));
  } else if(!ui.runId) { ui.run=null; ui.report=null; }
  if(ui.actionId&&ui.tab==='actions') ui.actionDetail=await request('/api/actions/'+uri(ui.actionId));
}
async function reloadData() {
  ui.index=await request('/api/state');
  if(!list(ui.index.projects).some(p=>p.id===ui.projectId)) selectProject(list(ui.index.projects)[0]?.id||'');
  if(ui.projectId) { ui.data=await request(base()); rememberCollections(); await loadDetails(); }
  $('#revision').textContent=project()?`Saved revision ${project().revision}`:'No project selected';
  $('#workspace-label').textContent=project()?`${project().name}\n${short(project().id)} · revision ${project().revision}`:'Private manager workspace';
}
function rememberCollections() {
  for(const kind of['snapshots','runs','jobs','actions','exports']) {
    const key=ui.projectId+':'+kind, current=list(ui.data?.[kind]), known=collectionCache.get(key)||[];
    const ids=new Set(current.map(x=>x.id)); const merged=[...current,...known.filter(x=>!ids.has(x.id))];
    if(ui.data) ui.data[kind]=merged; collectionCache.set(key,merged);
    if(ui.data?.totals?.[kind]!==undefined) collectionTotals.set(key,ui.data.totals[kind]);
    else if(current.length<100&&!collectionTotals.has(key)) collectionTotals.set(key,current.length);
  }
}
function moreButton(kind) {
  const loaded=rows(kind).length,total=collectionTotals.get(ui.projectId+':'+kind);
  if(total!==undefined&&loaded>=total) return '';
  if(total===undefined&&loaded<100) return '';
  return `<div class="actions smallgap">${button('Load older retained '+human(kind).toLowerCase(),'more-items',`data-kind="${esc(kind)}"`)}<span class="help">${loaded} loaded${total!==undefined?' of '+total:''}</span></div>`;
}
async function loadOlder(kind) {
  const names={snapshots:'snapshot',runs:'run',jobs:'job',actions:'action',exports:'export'};
  if(!names[kind]) return;
  const result=await request(base()+'/items?'+new URLSearchParams({kind:names[kind],offset:String(rows(kind).length),limit:'50'}));
  const known=rows(kind),ids=new Set(known.map(x=>x.id));
  ui.data[kind]=[...known,...list(result.items).filter(x=>!ids.has(x.id))];
  collectionCache.set(ui.projectId+':'+kind,ui.data[kind]); collectionTotals.set(ui.projectId+':'+kind,result.total);
  render(); tell('Older retained '+human(kind).toLowerCase()+' loaded.');
}
function jobsActive(data=ui.data) {
  return list(data?.jobs).some(j=>['queued','running','waiting','retry_wait','retrying'].includes(j.status)) ||
    list(data?.runs).some(r=>r.status==='queued') || list(data?.actions).some(a=>a.status==='executing'||a.reconciling);
}
function schedulePoll() { clearTimeout(ui.poll); if(jobsActive()) ui.poll=setTimeout(poll,1500); }
async function poll() {
  if(ui.busy) return schedulePoll();
  try {
    const latest=await request(base());
    if(isEditing()||ui.pending) { ui.incoming=latest.project.revision!==project().revision; ui.data.jobs=latest.jobs; ui.data.actions=latest.actions; ui.data.runs=latest.runs; rememberCollections(); renderIncoming(); }
    else { ui.data=latest; rememberCollections(); await loadDetails(); render(); }
  } catch(error) { tell(error.message+' Refresh to retrieve retained work.'); }
  finally { schedulePoll(); }
}
async function refresh(inspect=false) {
  if(ui.busy) return;
  captureDrafts(); busy(true);
  try { await reloadData(); ui.incoming=false; if(inspect&&ui.pending) ui.pending.inspected=true; render(); tell(inspect?'Latest saved work loaded. Inspect it, edit your retained draft and reapply.':'Saved work refreshed.'); }
  catch(error) { tell(error.message); }
  finally { busy(false); schedulePoll(); }
}
function renderIncoming() {
  const node=$('#incoming'); node.hidden=!ui.incoming;
  if(ui.incoming) node.innerHTML=`<strong>Newer saved work is available</strong><p>Your current draft remains in place.</p>${button('Load latest saved work','load-incoming')}`;
}
function renderConflict() {
  const node=$('#conflict'); $('#dialog-conflict')?.remove(); const pending=ui.pending; node.hidden=!pending; if(!pending) return;
  const uncertain=pending.kind==='uncertain';
  node.innerHTML=`<strong>${uncertain?'Retrieve the saved outcome':'Another operator saved newer work'}</strong><p>${esc(pending.error)} Your draft is retained.</p><div class="actions">${button('Reload and inspect','conflict-refresh')}${button(uncertain?'Retrieve the same operation':'Reapply current draft','conflict-reapply',pending.inspected?'':'disabled')}${button('Keep editing','conflict-dismiss')}</div>${pending.inspected?`<details class="smallgap"><summary>Inspect the current saved record</summary><pre>${esc(json(pending.options.inspect?.()||project()))}</pre></details>`:''}`;
  if(ui.busy) for(const control of node.querySelectorAll('button')) control.disabled=true;
  if($('#dialog').open) { const copy=node.cloneNode(true); copy.id='dialog-conflict'; $('#dialog-body').prepend(copy); }
}
async function mutate(build, options={}, frozen=null) {
  if(ui.busy) return; captureDrafts(); busy(true); let sent=frozen, written=null;
  try {
    if(!sent) {
      const built=await build(); const payload={...built.data,actor:operator(),requestId:crypto.randomUUID()};
      if(options.projectRevision!==false&&project()) payload.revision=project().revision;
      sent={url:built.url,options:{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(payload)}};
    }
    const result=await request(sent.url,sent.options); written=result; ui.pending=null; ui.incoming=false;
    if(options.draftKey) drafts.delete(options.draftKey);
    if(options.after) await options.after(result);
    await reloadData(); render(); tell(options.message||'Saved.'); return result;
  } catch(error) {
    if(written) { ui.pending=null; tell('The operation was saved. Refresh the current view to continue: '+error.message); renderConflict(); }
    else if(error.status===409&&['STALE_REVISION','STALE_PROJECT','STALE_REVIEW','STALE_ACTION'].includes(error.code)) { ui.pending={kind:'conflict',build,options,error:error.message,inspected:false}; renderConflict(); tell('Newer work is saved. Your draft remains available.'); }
    else if(error.transport&&sent) { ui.pending={kind:'uncertain',build,options,frozen:sent,error:error.message,inspected:false}; renderConflict(); tell('Inspect saved work, then retrieve the same operation using its retained request identifier.'); }
    else { tell(error.message); if($('#dialog').open) { const notice=document.createElement('div'); notice.className='notice'; notice.textContent=error.message; $('#dialog-body').prepend(notice); } }
  } finally { busy(false); schedulePoll(); }
}
function openDialog(title, body) { $('#dialog-title').textContent=title; $('#dialog-body').innerHTML=body; if(!$('#dialog').open) $('#dialog').showModal(); renderConflict(); }
function closeDialog() { const form=$('#dialog-body form[data-draft]'); if(form&&drafts.get(form.dataset.draft)?.dirty) captureForm(form); $('#dialog').close(); $('#dialog-body').innerHTML=''; renderConflict(); }
function downloadJSON(name, value) { const url=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'})); const anchor=document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function projectDialog() {
  const key='new-project', d=draft(key,{name:''});
  openDialog('Create a manager workspace',`<p>Name the pipeline or team whose source, monitoring definitions and operating decisions belong together.</p><form data-action="project" data-draft="${key}">${field('name','Project name',d.name,{required:true})}<button class="primary">Create project</button></form>`);
}
function noProject() { return heading('Pipeline operations','Retain original CRM sources, monitor the selected pipeline, review the actual findings and carry approved follow-up work through to its native outcome.')+empty('Create a project or restore an existing complete handover.')+`<div class="actions smallgap">${button('Create project','new-project','','primary')}${button('Restore a handover','tab','data-tab="handoff"')}</div>`; }
function scope() {
  if(!list(ui.index?.projects).length) return '';
  return `<div class="scope"><label>Operating project<select id="project-choice" aria-label="Operating project">${list(ui.index.projects).map(p=>`<option value="${esc(p.id)}" ${p.id===ui.projectId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${button('Create project','new-project')}</div>`;
}
function runTable(values) {
  return table(values,[{label:'Monitoring run',render:r=>button(r.name||r.id,'open-run',`data-id="${esc(r.id)}"`,'link')},{label:'State',render:r=>badge(r.status)},{label:'Captured source',render:r=>esc(snapshotName(r.snapshotId))},{label:'As of',render:r=>esc(time(r.asOf))},{label:'Created',render:r=>esc(time(r.createdAt))},{label:'Continue',render:r=>`<div class="actions">${button('Attention queue','open-attention',`data-id="${esc(r.id)}" ${r.status==='completed'?'':'disabled'}`)}${button('Cohorts','open-cohorts',`data-id="${esc(r.id)}" ${r.status==='completed'?'':'disabled'}`)}</div>`}]);
}
function overview() {
  if(!project()) return noProject(); const report=ui.report;
  return heading('Manager overview','Follow the retained pipeline from actual source records to reviewed priorities, comparable cohorts and completed native work.')+
    metrics([['Retained source versions',ui.data.totals?.snapshots??rows('snapshots').length],['Deals in selected run',report?.inputCount],['Selected alerts',list(report?.alerts).length],['Additional candidates outside caps',report?.suppressedAlertCount]])+
    `<div class="grid"><section class="card"><h2>Complete the operating cycle</h2><ol class="step-list"><li><strong>Retain the original CRM collection</strong><p>Import original exports and schema, or continue a configured paginated source collection.</p>${button('Original CRM sources','tab','data-tab="sources"')}</li><li><strong>Map the actual pipeline and properties</strong><p>Declare native stages, team scope, next-action fields, lead quality and alert volume.</p>${button('Pipeline definitions','tab','data-tab="config"')}</li><li><strong>Monitor and work the actual queue</strong><p>Pin a source version and as-of time, inspect the native record, and record the manager’s decision.</p>${button('Saved monitoring runs','tab','data-tab="runs"')}</li><li><strong>Complete follow-up work and hand over</strong><p>Review the exact task or note request, approve it, and retain its native result alongside the complete project.</p>${button('Follow-up work','tab','data-tab="actions"')}</li></ol></section><section class="card"><h2>Selected monitoring result</h2>${report?`${kv({run:runName(ui.runId),as_of:report.asOf,closed_records_in_window:report.closedInWindow,unknown_creation_dates:report.unknownAges,future_creation_dates:report.futureCreated,missing_next_action_dates:report.missingNextActions,alert_limit:report.caps?.maxAlerts,per_owner_limit:report.caps?.maxPerOwner,minimum_closed_cohort:report.caps?.minCohort})}<div class="actions smallgap">${button('Work selected alerts','open-attention',`data-id="${esc(ui.runId)}"`)}${button('Compare cohorts','open-cohorts',`data-id="${esc(ui.runId)}"`)}</div>`:empty('Create a monitoring run from an original source collection.')}<hr><h3>Manager interpretation</h3><p class="help">Record-update age and customer-contact history are separate fields. Cohorts describe the retained pipeline, source, quality and age groups; manager decisions stay attached to their original evidence.</p></section></div><section class="card"><h2>Retained monitoring runs</h2>${runTable(rows('runs'))}${moreButton('runs')}</section>`;
}
function sourceTable() {
  return table(rows('snapshots'),[{label:'Source version',render:s=>button(s.name||s.id,'open-snapshot',`data-id="${esc(s.id)}"`,'link')},{label:'Captured',render:s=>esc(time(s.capturedAt||s.createdAt))},{label:'Records',render:s=>esc(s.recordCount??s.records??s.count??'Inspect source')},{label:'Collection declaration',render:s=>badge(s.completeness||(s.complete?'complete collection':'partial export'))},{label:'Continue',render:s=>button('Inspect original records','open-snapshot',`data-id="${esc(s.id)}"`)}]);
}
function jobsTable() {
  return table(rows('jobs'),[{label:'Source operation',render:j=>button(j.name||j.id,'inspect-job',`data-id="${esc(j.id)}"`,'link')},{label:'Status',render:j=>badge(j.status,['failed','uncertain'].includes(j.status))},{label:'Pages / records',render:j=>`${esc(count(j.pages))} / ${esc(count(j.records))}`},{label:'Observed at',render:j=>esc(time(j.updatedAt||j.startedAt))},{label:'Outcome',render:j=>`${esc(j.error?.message||j.error||'')}${j.snapshotId?`<div>${button('Open retained source','open-snapshot',`data-id="${esc(j.snapshotId)}"`,'link')}</div>`:''}`},{label:'Continue',render:j=>`<div class="actions">${['failed','interrupted','cancelled','paused'].includes(j.status)?button('Resume source operation','resume-job',`data-id="${esc(j.id)}"`):''}${['queued','running','waiting','retry_wait','retrying'].includes(j.status)?button('Cancel collection','cancel-job',`data-id="${esc(j.id)}"`):''}${button('Inspect operation','inspect-job',`data-id="${esc(j.id)}"`)}</div>`}]);
}
function sourcesPage() {
  if(!project()) return noProject();
  const key='import:'+ui.projectId, d=draft(key,{name:'',declaredComplete:false});
  const schemaKey='schema:'+ui.projectId, s=draft(schemaKey,{kind:'properties'});
  const syncKey='sync:'+ui.projectId, sync=draft(syncKey,{name:''}), provider=object(ui.index?.provider);
  return heading('Original CRM sources','Retain original response bytes and explicit source coverage. Each monitoring run keeps its own exact source version.')+
    `<div class="grid"><section class="card"><h2>Import an original collection</h2><form data-action="import" data-draft="${esc(key)}">${field('name','Source version name',d.name,{required:true})}<label class="filelabel">Original deals JSON<input name="file" type="file" accept=".json,application/json" ${d.file?'':'required'}><span class="help">${d.file?`Retained selection: ${esc(d.file.name)}. `:''}Native deals array, original results response, or a pages array containing the retained responses.</span></label>${check('declaredComplete','The supplied files contain the complete collection intended for this run',d.declaredComplete)}<p class="help">A paginated collection represents its observed acquisition interval. Keep the actual export or collection scope with the selected version.</p><button class="primary">Retain original collection</button></form></section><section class="card"><h2>Collect from the configured HubSpot source</h2>${kv({provider_kind:provider.kind||'HUBSPOT',connection:provider.configured?'Configured in the operator runtime':'Configure the original provider in the operator runtime',token_environment:provider.tokenEnv||'See the native operating guide',source:provider.origin||provider.baseUrl||'HubSpot CRM API'})}<form class="smallgap" data-action="sync" data-draft="${esc(syncKey)}">${field('name','Collection operation name',sync.name,{required:true})}<button class="primary" ${provider.configured?'':'disabled'}>Start source collection</button></form><p class="help">The retained operation follows original pagination, waits through provider backoff and preserves its next cursor. Continue the same operation after an interruption.</p></section></div>
    <section class="card"><h2>Retained source versions</h2>${sourceTable()}${moreButton('snapshots')}</section>${snapshotPanel()}
    <section class="card"><h2>Original native collection operations</h2>${jobsTable()}${moreButton('jobs')}</section>
    <div class="grid"><section class="card"><h2>Retain the original property or pipeline schema</h2><form data-action="schema" data-draft="${esc(schemaKey)}">${select('kind','Native schema kind',[['properties','Deal properties'],['pipelines','Pipelines and stages']],s.kind)}<label class="filelabel">Original schema JSON<input type="file" name="file" accept=".json,application/json" ${s.file?'':'required'}><span class="help">${s.file?`Retained selection: ${esc(s.file.name)}`:'Use the actual property or pipeline API response.'}</span></label><button>Retain native schema</button></form></section><section class="card"><h2>Schema sources</h2>${table(list(ui.schema?.schemas),[{label:'Original file',key:'name'},{label:'Kind',key:'kind'},{label:'Captured',render:r=>esc(time(r.capturedAt))},{label:'Original identity',render:r=>`<code>${esc(r.sha256)}</code>`}], '')}<div class="actions smallgap">${button('Map these native fields','tab','data-tab="config"')}</div></section></div>`;
}
function snapshotPanel() {
  if(!ui.snapshot||ui.snapshot.snapshot?.id!==ui.snapshotId) return '';
  const source=ui.snapshot.snapshot, data=ui.deals, filters=ui.dealFilters;
  return `<section class="card" id="snapshot-detail"><div class="summary-row"><h2>${esc(source.name||source.id)}</h2>${button('Use this source for monitoring','use-snapshot',`data-id="${esc(source.id)}"`)}</div>${kv(source)}<hr><h3>Original received files</h3>${table(list(ui.snapshot.sourceFiles),[{label:'File',key:'name'},{label:'Bytes',key:'bytes'},{label:'Exact source identity',render:f=>`<code>${esc(f.sha256)}</code>`},{label:'Download',render:f=>link('Original bytes','/api/files/'+uri(f.id)+'/download',true)}], '')}<hr><h3>Retained native deals</h3><form data-action="deal-filter"><div class="filter">${field('search','Find deal or original value',filters.search)}${field('pipeline','Native pipeline ID',filters.pipeline)}${field('owner','Native owner ID',filters.owner)}<button>Apply source filters</button></div></form>${data?table(list(data.deals),[{label:'Native deal',render:d=>button(d.id,'inspect-deal',`data-id="${esc(d.id)}"`,'link')},{label:'Pipeline / stage',render:d=>`${esc(d.properties?.pipeline)}<div class="muted">${esc(d.properties?.dealstage)}</div>`},{label:'Owner',render:d=>esc(d.properties?.hubspot_owner_id||'Unassigned')},{label:'Original properties',render:d=>`<code class="rowpreview">${esc(json(d.properties))}</code>`},{label:'Inspect',render:d=>button('Open original record','inspect-deal',`data-id="${esc(d.id)}"`)}])+pager('deal',ui.dealOffset,data.total):empty('Loading the original records…')}<details class="smallgap"><summary>Observed fields and native stage inventory</summary><pre>${esc(json({fields:ui.snapshot.observedFields,stages:ui.snapshot.stageInventory}))}</pre></details></section>`;
}
const triageDefaults = {portalId:'',nextActionProperty:'next_action_date',sourceProperty:'hs_analytics_source',leadQualityProperty:'',lastRecordUpdateProperty:'hs_lastmodifieddate',staleRecordDays:7,minAgeDays:2,lookbackDays:90,minCohort:10,maxAlerts:40,maxPerOwner:5};
function configDraft() {
  const config=structuredClone(project()?.config||ui.index?.defaults?.config||{});
  return draft('config:'+ui.projectId,{triage:{...triageDefaults,...object(config.triage)},context:{lastContactProperty:'',stageEnteredProperty:'',lostReasonProperty:'',amountProperty:'amount',currencyProperty:'deal_currency_code',...object(config.context)},pipelineIds:list(config.scope?.pipelineIds).join('\n'),ownerIds:list(config.scope?.ownerIds).join('\n'),stages:Object.entries(object(config.triage?.stageStatus)).map(([id,status])=>({id,status})),originalConfig:config});
}
function buildConfig(d) {
  const triage={...object(d.originalConfig?.triage),...object(d.triage)}, stageStatus=Object.create(null);
  for(const stage of list(d.stages)) {
    const id=String(stage.id||'').trim(); if(!id||!['open','won','lost'].includes(stage.status)) throw Error('Give each native stage ID its explicit open, won or lost meaning.');
    if(Object.hasOwn(stageStatus,id)) throw Error('Each native stage ID must occur once.');
    stageStatus[id]=stage.status;
  }
  for(const key of['staleRecordDays','minAgeDays','lookbackDays','minCohort','maxAlerts','maxPerOwner']) triage[key]=Number(triage[key]);
  triage.stageStatus=stageStatus;
  const split=text=>[...new Set(String(text||'').split(/[\n,]/).map(v=>v.trim()).filter(Boolean))];
  const context=Object.fromEntries(Object.entries(object(d.context)).map(([key,value])=>[key,String(value??'').trim()||null]));
  return {...object(d.originalConfig),triage,scope:{...object(d.originalConfig?.scope),pipelineIds:split(d.pipelineIds),ownerIds:split(d.ownerIds)},context};
}
function configPage() {
  if(!project()) return noProject(); const d=configDraft(), key='config:'+ui.projectId;
  const nativeFields=[...new Set(list(ui.schema?.properties).map(p=>p.name).filter(Boolean))];
  const nativeStages=list(ui.schema?.pipelines).flatMap(p=>list(p.stages).map(s=>({pipeline:p.id,pipelineLabel:p.label,id:s.id,label:s.label,...s})));
  return heading('Pipeline definitions','Declare the native source fields, stage meanings, monitoring scope and manager alert limits. Saved runs retain their original definitions.')+
    `<datalist id="native-properties">${nativeFields.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist><section class="card"><form data-action="config" data-draft="${esc(key)}"><h2>Native account and pipeline scope</h2>${field('triage.portalId','Numeric HubSpot account ID',d.triage.portalId,{help:'Used for native deal links. Keep the account ID as text.'})}<div class="inline">${field('pipelineIds','Included native pipeline IDs',d.pipelineIds,{textarea:true,rows:3,help:'One ID per line. Leave empty to include all pipelines present in the retained collection.'})}${field('ownerIds','Included native owner IDs',d.ownerIds,{textarea:true,rows:3,help:'One ID per line. Leave empty to include all owners present in the retained collection.'})}</div><hr><div class="summary-row"><h2>Explicit native stage meanings</h2>${button('Add a stage','add-stage')}${button('Add stages from retained schema','schema-stages',nativeStages.length?'':'disabled')}</div>${d.stages.length?`<div class="tablewrap"><table class="stage-map"><thead><tr><th>Native stage ID</th><th>Operating meaning</th><th>Remove</th></tr></thead><tbody>${d.stages.map((stage,i)=>`<tr><td>${field(`stages.${i}.id`,`Stage ${i+1} native ID`,stage.id,{required:true})}</td><td>${select(`stages.${i}.status`,`Stage ${i+1} meaning`,[['','Choose the actual meaning'],['open','Open'],['won','Closed won'],['lost','Closed lost']],stage.status)}</td><td>${button('Remove','remove-stage',`data-index="${i}"`)}</td></tr>`).join('')}</tbody></table></div>`:empty('Add the original pipeline’s stage IDs and confirm each actual meaning before monitoring.')}<details><summary>Retained native pipeline and stage labels</summary><pre>${esc(json(nativeStages))}</pre></details><hr><h2>Source properties</h2><div class="inline">${field('triage.nextActionProperty','Declared next-action date property',d.triage.nextActionProperty,{required:true,list:'native-properties'})}${field('triage.sourceProperty','Lead-source property',d.triage.sourceProperty,{required:true,list:'native-properties'})}${field('triage.leadQualityProperty','Lead-quality property',d.triage.leadQualityProperty,{list:'native-properties',help:'Use the actual measured field when available.'})}${field('triage.lastRecordUpdateProperty','CRM record update property',d.triage.lastRecordUpdateProperty,{required:true,list:'native-properties'})}${field('context.lastContactProperty','Actual customer-contact date property',d.context.lastContactProperty,{list:'native-properties',help:'Optional source evidence, separate from CRM record edits.'})}${field('context.stageEnteredProperty','Stage-entered date property',d.context.stageEnteredProperty,{list:'native-properties'})}${field('context.lostReasonProperty','Lost-deal or cancellation reason property',d.context.lostReasonProperty,{list:'native-properties'})}${field('context.amountProperty','Original deal amount property',d.context.amountProperty,{list:'native-properties'})}${field('context.currencyProperty','Original currency property',d.context.currencyProperty,{list:'native-properties'})}</div><hr><h2>Monitoring and manager capacity</h2><div class="inline triple">${field('triage.staleRecordDays','Stale record age in days',d.triage.staleRecordDays,{type:'number',min:1,max:90,required:true})}${field('triage.minAgeDays','Minimum open-deal age in days',d.triage.minAgeDays,{type:'number',min:0,max:30,required:true})}${field('triage.lookbackDays','Closed-cohort lookback in days',d.triage.lookbackDays,{type:'number',min:7,max:730,required:true})}${field('triage.minCohort','Minimum closed records per cohort',d.triage.minCohort,{type:'number',min:5,max:100,required:true})}${field('triage.maxAlerts','Maximum alerts per monitoring run',d.triage.maxAlerts,{type:'number',min:1,max:250,required:true})}${field('triage.maxPerOwner','Maximum alerts per owner',d.triage.maxPerOwner,{type:'number',min:1,max:25,required:true})}</div><div class="sticky-actions"><button class="primary">Save pipeline definitions</button>${button('Preview complete definitions','preview-config')}</div></form></section>`;
}
function runSelector(action, title, selected=ui.runId) {
  const available=rows('runs').filter(r=>r.status==='completed');
  if(!available.some(r=>r.id===selected)) selected='';
  return `<form data-action="${esc(action)}"><div class="scope">${select('runId',title,[['','Choose a retained monitoring run'],...available.map(r=>[r.id,`${r.name||r.id} · ${time(r.asOf)}`])],selected)}<button>Open selected run</button></div></form>`;
}
function runsPage() {
  if(!project()) return noProject();
  const key='run:'+ui.projectId,d=draft(key,{name:'',snapshotId:ui.snapshotId||rows('snapshots')[0]?.id||'',asOf:new Date().toISOString()});
  return heading('Saved monitoring runs','Pin the original collection, current pipeline definitions and an explicit as-of time. Compare later versions while retaining each original result.')+
    `<section class="card"><h2>Prepare a monitoring run</h2>${rows('snapshots').length?`<form data-action="run" data-draft="${esc(key)}">${field('name','Monitoring run name',d.name,{required:true})}<div class="inline">${select('snapshotId','Original source version',rows('snapshots').map(s=>[s.id,s.name||s.id]),d.snapshotId)}${field('asOf','Monitoring as-of time',d.asOf,{required:true,help:'Explicit ISO timestamp with timezone; retained with the run.'})}</div><p class="help">This run uses the project’s current saved definitions and the original deal-triage engine.</p><div class="actions"><button class="primary">Run pipeline monitoring</button>${button('Review current definitions','tab','data-tab="config"')}</div></form>`:empty('Retain an original source collection before creating a monitoring run.')}</section><section class="card"><h2>Retained runs</h2>${runTable(rows('runs'))}${moreButton('runs')}</section>${runPanel()}`;
}
function runPanel() {
  if(!ui.run) return ''; const run=ui.run.run,report=ui.report;
  if(!report) return `<section class="card" id="run-detail"><div class="summary-row"><h2>${esc(run.name||run.id)}</h2>${badge(run.status)}</div>${run.error?kv({outcome:run.error}):'<p>The original monitoring run is queued. Its retained result appears when the operation completes.</p>'}${['failed','interrupted'].includes(run.status)?button('Retry original monitoring inputs','retry-run',`data-id="${esc(run.id)}"`):''}</section>`;
  return `<section class="card" id="run-detail"><div class="summary-row"><h2>${esc(run.name||run.id)}</h2>${badge('retained original report')}</div>${metrics([['Deals in scope',report.inputCount],['Alert candidates',report.alertCandidates],['Selected manager alerts',list(report.alerts).length],['Candidates outside configured caps',report.suppressedAlertCount]])}<div class="actions">${button('Work attention queue','open-attention',`data-id="${esc(run.id)}"`)}${button('Open cohorts','open-cohorts',`data-id="${esc(run.id)}"`)}${button('Inspect original source','open-snapshot',`data-id="${esc(run.snapshotId)}"`)}${link('Original triage report JSON','/api/runs/'+uri(run.id)+'/report',true)}${button('Prepare complete handover','handover-run',`data-id="${esc(run.id)}"`)}</div><hr><div class="grid"><div><h3>Original result</h3>${kv({as_of:report.asOf,source:snapshotName(run.snapshotId),closed_records_in_window:report.closedInWindow,unknown_creation_dates:report.unknownAges,future_creation_dates:report.futureCreated,missing_next_action_dates:report.missingNextActions,minimum_closed_cohort:report.caps?.minCohort})}</div><div><h3>Manager review progress</h3>${kv(ui.run.reviewSummary||{})}</div></div>${comparisonPanel()}<details class="smallgap"><summary>Pinned source and monitoring definitions</summary><pre>${esc(json(run))}</pre></details><details><summary>Complete original engine report</summary><pre>${esc(json(report))}</pre></details></section>`;
}
function comparisonPanel() {
  const alternatives=rows('runs').filter(r=>r.id!==ui.runId&&r.status==='completed'),comparison=ui.comparison;
  if(!alternatives.length) return '';
  return `<hr><h3>Compare retained monitoring runs</h3><form data-action="compare"><div class="scope">${select('baseline','Earlier monitoring run',[['','Choose a baseline'],...alternatives.map(r=>[r.id,r.name||r.id])],ui.compareId)}<button>Compare retained results</button></div></form>${comparison?`<div class="smallgap">${kv({baseline:runName(ui.compareId),current:runName(ui.runId),same_monitoring_definitions:comparison.compatibility?.sameConfig,same_pipeline_and_owner_scope:comparison.compatibility?.sameScope,same_as_of_time:comparison.compatibility?.sameAsOf})}</div><div class="grid smallgap"><div><h3>Observed change summary</h3>${kv(comparison.summary||{})}</div><div><h3>Source collection changes</h3>${kv(comparison.records||{})}<p class="help">Absent records are absent from the selected collection. Source coverage and as-of changes remain part of the comparison.</p></div></div>${['new','resolved','persisting'].map(key=>`<details class="smallgap"><summary>${esc(human(key))} alert identities · ${count(comparison.alerts?.[key])}</summary><pre>${esc(json(comparison.alerts?.[key]||[]))}</pre></details>`).join('')}`:''}`;
}
function alertTable(alerts) {
  return table(alerts,[{label:'Priority',render:a=>`<span class="priority">${esc(a.priority)}</span>`},{label:'Native deal',render:a=>button(a.dealId,'open-alert',`data-id="${esc(a.dealId)}"`,'link')+`<div class="muted">${safeDealLink(a.dealUrl)}</div>`},{label:'Reason for attention',render:a=>`<ul class="reason-list">${list(a.reasons).map(r=>`<li>${esc(reasonNames[r]||human(r))}</li>`).join('')}</ul>`},{label:'Pipeline / stage / owner',render:a=>`${esc(a.pipeline)} / ${esc(a.stage)}<div class="muted">Owner ${esc(a.ownerId)}</div>`},{label:'Lead context',render:a=>`${esc(a.leadSource)}<div class="muted">${esc(a.leadQuality)}</div>`},{label:'Manager review',render:a=>badge(a.review?.status||'open')+`<div class="muted">${esc(a.review?.assignee||'Unassigned')}</div>`},{label:'Continue',render:a=>button('Inspect and review','open-alert',`data-id="${esc(a.dealId)}"`)}], 'wide');
}
function attentionPage() {
  if(!project()) return noProject(); const report=ui.report, filters=ui.alertFilters;
  return heading('Daily attention','Work the original prioritised queue, inspect the received record and keep the manager’s decision with the exact source evidence.')+
    `<section class="card">${runSelector('attention-run','Monitoring run for attention')}${report?`${metrics([['Selected alerts',list(report.alerts).length],['Additional candidates outside caps',report.suppressedAlertCount],['Maximum per owner',report.caps?.maxPerOwner],['Captured deals in scope',report.inputCount]])}<form data-action="alert-filter"><div class="filter">${field('search','Find deal, review or source value',filters.search)}${field('owner','Native owner ID',filters.owner)}${select('status','Manager review status',[['','All review states'],...reviewStates.map(s=>[s,human(s)])],filters.status)}${select('reason','Reason for attention',[['','All reasons'],...Object.entries(reasonNames)],filters.reason)}<button>Apply attention filters</button></div></form>${ui.alerts?alertTable(list(ui.alerts.alerts))+pager('alert',ui.alertOffset,ui.alerts.total):empty('Loading selected alerts…')}<p class="help smallgap">The alert limits control manager workload. Additional candidates remain counted in the original report. A source correction or later collection creates a new monitoring run.</p>`:empty('Select a retained monitoring run.')}</section>`;
}
async function openAlert(id) {
  if(ui.tab!=='attention') { ui.tab='attention'; await loadDetails(); render(); }
  let alert=list(ui.alerts?.alerts).find(a=>a.dealId===id);
  if(!alert) { const result=await request('/api/runs/'+uri(ui.runId)+'/alerts?'+new URLSearchParams({search:id,limit:'50'})); alert=list(result.alerts).find(a=>a.dealId===id); }
  if(!alert) throw Error('This deal is not present in the selected run’s retained alert queue.');
  ui.alertDetail=alert;
  const original=await request('/api/snapshots/'+uri(ui.run.run.snapshotId)+'/deals/'+uri(id));
  const key='review:'+ui.runId+':'+id, review=object(alert.review), d=draft(key,{status:review.status||'open',note:review.note||'',assignee:review.assignee||'',dueAt:review.dueAt||''});
  openDialog('Deal '+id+' · manager review',`<div class="summary-row">${badge('priority '+alert.priority,true)}${safeDealLink(alert.dealUrl)}</div><ul class="reason-list">${list(alert.reasons).map(r=>`<li>${esc(reasonNames[r]||human(r))}</li>`).join('')}</ul><hr><div class="grid"><div><h3>Retained monitoring evidence</h3>${kv({pipeline:alert.pipeline,stage:alert.stage,owner:alert.ownerId,lead_source:alert.leadSource,lead_quality:alert.leadQuality,declared_next_action:alert.nextActionAt,crm_record_updated:alert.recordUpdatedAt,source_record_sha256:alert.recordSha256})}</div><div><h3>Mapped source context</h3>${kv(alert.context||{})}</div></div><details class="smallgap"><summary>Exact original CRM record</summary><pre>${esc(json(original.deal))}</pre></details><hr><form data-action="review" data-id="${esc(id)}" data-draft="${esc(key)}"><div class="inline">${select('status','Manager review status',reviewStates,d.status)}${field('assignee','Responsible manager or operator',d.assignee)}</div>${field('dueAt','Review follow-up due at',d.dueAt,{help:'Optional explicit ISO timestamp with timezone.'})}${field('note','Manager decision and next operation',d.note,{textarea:true,rows:5,required:true})}<button class="primary">Save manager review</button></form><div class="actions smallgap">${button('Prepare follow-up work','new-action',`data-run="${esc(ui.runId)}" data-deal="${esc(id)}"`)}</div><details class="smallgap"><summary>Retained review metadata</summary><pre>${esc(json(review))}</pre></details>`);
}
const rate = value => value===null||value===undefined ? 'Not shown' : (Number(value)*100).toFixed(1)+'%';
function cohortNotes(cohort) {
  if(!cohort.eligibleForComparison) return 'Below the configured closed-record minimum';
  if(['NOT_MEASURED','UNKNOWN_QUALITY'].includes(cohort.leadQuality)) return 'Lead-quality measurement is unavailable for this group';
  return 'Observed closed-record result for this group';
}
function cohortsPage() {
  if(!project()) return noProject(); const data=ui.cohorts;
  return heading('Cohorts and trends','Compare observed closed outcomes within the original pipeline, lead-source, quality and deal-age groups. Keep each group’s sample size visible.')+
    `<section class="card">${runSelector('cohort-run','Monitoring run for cohort review')}${data?`${table(list(data.cohorts),[{label:'Pipeline',key:'pipeline'},{label:'Lead source',key:'leadSource'},{label:'Lead quality',key:'leadQuality'},{label:'Deal-age group',key:'ageBucket'},{label:'Won / lost',render:c=>`${esc(c.won)} / ${esc(c.lost)}`},{label:'Closed sample',key:'n'},{label:'Observed win rate',render:c=>`${esc(rate(c.observedWinRate))}<div class="muted">${esc(cohortNotes(c))}</div>`}], 'wide')}${pager('cohort',ui.cohortOffset,data.total)}<p class="help smallgap">Groups below the saved minimum do not display a rate. Changes in collection coverage, definitions and as-of time remain visible in the retained-run comparison.</p>`:empty('Select a monitoring run to inspect its native cohorts.')}${ui.report?comparisonPanel():''}</section>${ui.comparison?`<section class="card"><h2>Matched cohort changes</h2>${table(list(ui.comparison.cohorts),[{label:'Original cohort',key:'key'},{label:'Earlier closed sample',render:c=>esc(c.baseline?.n??'Absent')},{label:'Current closed sample',render:c=>esc(c.current?.n??'Absent')},{label:'Earlier observed win rate',render:c=>esc(rate(c.baseline?.observedWinRate))},{label:'Current observed win rate',render:c=>esc(rate(c.current?.observedWinRate))},{label:'Exact group counts',render:c=>`<details><summary>Inspect both groups</summary><pre>${esc(json({baseline:c.baseline,current:c.current}))}</pre></details>`}], 'wide')}</section>`:''}`;
}
function actionDraft(runId='',dealId='') {
  return draft('action:'+ui.projectId,{runId:runId||ui.runId,dealId,kind:'task',subject:'',body:'',ownerId:'',dueAt:'',reminderAt:'',priority:'MEDIUM'});
}
function actionEditor() {
  const d=actionDraft(),key='action:'+ui.projectId,available=rows('runs').filter(r=>r.status==='completed');
  if(!available.some(r=>r.id===d.runId)) d.runId=available[0]?.id||'';
  return `<section class="card" id="action-editor"><h2>Prepare source-bound follow-up work</h2>${available.length?`<form data-action="action-create" data-draft="${esc(key)}"><div class="inline">${select('runId','Original monitoring run',available.map(r=>[r.id,r.name||r.id]),d.runId)}${field('dealId','Original native deal ID',d.dealId,{required:true})}</div><div class="inline">${select('kind','Follow-up kind',[['task','Follow-up task'],['reminder','Reminder'],['escalation','Manager escalation'],['note','Deal note']],d.kind)}${select('priority','Task priority',['LOW','MEDIUM','HIGH'],d.priority)}</div>${field('subject','Task or note subject',d.subject,{required:true})}${field('body','Proposed task or note text',d.body,{textarea:true,rows:6,required:true})}<div class="inline">${field('ownerId','Responsible native HubSpot owner ID',d.ownerId)}${field('dueAt','Task due at',d.dueAt,{help:'Use an explicit ISO timestamp with timezone for tasks, reminders and escalations.'})}${field('reminderAt','Optional reminder at',d.reminderAt,{help:'Explicit ISO timestamp with timezone.'})}</div><p class="help">This creates a retained proposal. Its exact native request is prepared from the original deal and association type before a manager approves execution.</p><button class="primary">Save follow-up proposal</button></form>`:empty('Create a monitoring run before preparing work against its original deal records.')}</section>`;
}
function actionsPage() {
  if(!project()) return noProject();
  return heading('Follow-up work','Carry each retained task, reminder, escalation or note from its original source through a specific approved request and actual HubSpot outcome.')+
    `<section class="card"><h2>Retained proposals and native outcomes</h2>${table(rows('actions'),[{label:'Follow-up work',render:a=>button(a.details?.subject||a.subject||a.name||a.id,'open-action',`data-id="${esc(a.id)}"`,'link')},{label:'Kind / deal',render:a=>`${esc(human(a.kind))}<div class="muted">${esc(a.dealId)}</div>`},{label:'State',render:a=>badge(a.status,['uncertain','source_changed','failed'].includes(a.status))},{label:'Original monitoring run',render:a=>esc(runName(a.runId))},{label:'Native object',render:a=>esc(a.nativeId||'Not recorded')},{label:'Continue',render:a=>button('Open complete operation','open-action',`data-id="${esc(a.id)}"`)}])}${moreButton('actions')}</section>${actionPanel()}${actionEditor()}`;
}
function actionPanel() {
  const data=ui.actionDetail, action=data?.action;
  if(!action||action.id!==ui.actionId) return '';
  const configured=ui.index?.provider?.configured, draftKey='approval:'+action.id, approval=draft(draftKey,{note:''});
  const reconcileKey='reconcile:'+action.id,reconcile=draft(reconcileKey,{nativeId:action.nativeId||''});
  return `<section class="card" id="action-detail"><div class="summary-row"><h2>${esc(action.details?.subject||action.subject||'Follow-up operation')}</h2>${badge(action.status,['uncertain','source_changed','failed'].includes(action.status))}</div>${kv({kind:action.kind,native_deal:action.dealId,original_run:runName(action.runId),original_source:snapshotName(action.snapshotId),source_record_sha256:action.recordSha256,native_object:action.nativeId,error:action.error||''})}<hr><h3>Proposed work</h3>${kv(action.details||{})}<div class="actions smallgap">${['draft','source_changed','failed'].includes(action.status)&&!action.writeStartedAt?button('Prepare exact native request','prepare-action',`data-id="${esc(action.id)}" ${configured?'':'disabled'}`,'primary'):''}${button('Inspect original deal','action-source',`data-id="${esc(action.id)}"`)}</div>${action.prepared?`<hr><h3>Exact native request</h3>${kv({method:action.prepared.method,path:action.prepared.path,request_sha256:action.prepared.sha256,source_checked_at:action.prepared.checkedAt})}<pre class="smallgap">${esc(json(action.prepared.body))}</pre><div class="actions smallgap">${link('Download exact prepared request','/api/actions/'+uri(action.id)+'/request',true)}</div>`:''}${action.status==='prepared'?`<hr><h3>Manager approval of this request</h3><form data-action="approve-action" data-id="${esc(action.id)}" data-draft="${esc(draftKey)}">${field('note','Approval decision and operating scope',approval.note,{textarea:true,rows:4,required:true})}<button class="primary">Approve this exact request</button></form>`:''}${action.approval?`<hr><h3>Retained approval</h3>${kv(action.approval)}`:''}${action.status==='approved'?`<div class="notice smallgap"><strong>Approved request ready for execution</strong><p>The next operation rechecks the current source and sends this exact task or note request to the configured HubSpot source.</p>${button('Execute approved native request','execute-action',`data-id="${esc(action.id)}" ${configured?'':'disabled'}`,'primary')}</div>`:''}${action.status==='executing'||action.reconciling?'<div class="notice smallgap">The native operation is in progress. Its retained outcome will appear here.</div>':''}${['uncertain','completed'].includes(action.status)&&!action.reconciling?`<hr><h3>Recover the original native outcome</h3><p>Read the original object or retained request marker to recover this operation’s outcome.</p><form data-action="reconcile-action" data-id="${esc(action.id)}" data-draft="${esc(reconcileKey)}">${field('nativeId','Known native object ID',reconcile.nativeId,{help:'Optional; leave empty to use the original operation’s retained marker.'})}<button ${configured?'':'disabled'}>Reconcile original native outcome</button></form>`:''}${['prepared','approved'].includes(action.status)?`<div class="actions smallgap">${button('Revoke this proposal','revoke-action',`data-id="${esc(action.id)}"`)}</div>`:''}<hr><h3>Retained native receipts</h3>${list(data.receipts).length?list(data.receipts).map((receipt,i)=>`<details><summary>Native receipt ${i+1}</summary><pre>${esc(json(receipt))}</pre></details>`).join(''):empty('No native receipt has been retained for this proposal yet.')}<h3 class="smallgap">Operating history</h3>${table(list(data.events),[{label:'Time',render:e=>esc(time(e.at||e.createdAt||e.timestamp))},{label:'Operator',render:e=>esc(e.actor||'')},{label:'Operation',render:e=>esc(human(e.kind))},{label:'State',render:e=>esc(human(e.status??''))},{label:'Original event',render:e=>`<details><summary>Inspect original event</summary><pre>${esc(json(e))}</pre></details>`}], '')}</section>`;
}
function revokeDialog(id) {
  const key='revoke:'+id,d=draft(key,{note:''});
  openDialog('Revoke the retained proposal',`<p>Record why this proposal is being withdrawn from execution. Its original source and decision history remain retained.</p><form data-action="revoke-action" data-id="${esc(id)}" data-draft="${esc(key)}">${field('note','Revocation decision',d.note,{textarea:true,rows:4,required:true})}<button>Revoke proposal</button></form>`);
}
function handoffPage() {
  const restoreKey='restore',restore=draft(restoreKey,{name:''});
  const restorePanel=`<section class="card"><h2>Restore a complete project</h2><form data-action="restore" data-draft="${restoreKey}">${field('name','Restored project name',restore.name,{required:true})}<label class="filelabel">Complete project recovery<input type="file" name="file" accept=".gz,.json,application/gzip,application/json" ${restore.file?'':'required'}><span class="help">${restore.file?`Retained selection: ${esc(restore.file.name)}. `:''}Restore the original complete handover into a separate project.</span></label><button class="primary">Restore complete project</button></form><p class="help">The restored project preserves original source identities, definitions, monitoring results, reviews, native work and history.</p></section>`;
  if(!project()) return heading('History and handover','Open an existing recoverable pipeline operation or create a new manager workspace.')+restorePanel;
  const key='export:'+ui.projectId,d=draft(key,{name:'',runId:ui.runId||''});
  return heading('History and handover','Keep the complete operating project together: original CRM bytes, versioned monitoring, manager decisions and native outcomes.')+
    `<div class="grid"><section class="card"><h2>Prepare a complete operating handover</h2><form data-action="export" data-draft="${esc(key)}">${field('name','Handover name',d.name,{required:true})}${select('runId','Featured monitoring run',[['','Complete project without a featured run'],...rows('runs').map(r=>[r.id,r.name||r.id])],d.runId)}<button class="primary">Create complete handover</button></form><p class="help">The portable recovery contains the full retained project, including its original source files and decision history. Keep it with the project’s authorised operators.</p></section>${restorePanel}</div><section class="card"><h2>Retained handovers</h2>${table(rows('exports'),[{label:'Handover',key:'name'},{label:'Created',render:e=>esc(time(e.createdAt))},{label:'Featured run',render:e=>esc(runName(e.runId))},{label:'Download',render:e=>link('Complete project recovery','/api/exports/'+uri(e.id)+'/download',true)}])}${moreButton('exports')}</section><section class="card"><h2>Operating history</h2>${table(rows('history'),[{label:'Time',render:e=>esc(time(e.at||e.createdAt||e.timestamp))},{label:'Operator',render:e=>esc(e.actor||'')},{label:'Operation',render:e=>esc(human(e.kind||e.type||e.action||e.event||''))},{label:'Retained outcome',render:e=>`<details><summary>Inspect original event</summary><pre>${esc(json(e))}</pre></details>`}])}</section>`;
}
function render() {
  $('#nav').innerHTML=tabs.map(([id,label])=>`<button type="button" data-tab="${id}" aria-current="${ui.tab===id?'page':'false'}">${esc(label)}</button>`).join('');
  $('#scope').innerHTML=scope();
  const views={overview,sources:sourcesPage,config:configPage,runs:runsPage,attention:attentionPage,cohorts:cohortsPage,actions:actionsPage,handoff:handoffPage};
  $('#content').innerHTML=views[ui.tab](); renderIncoming(); renderConflict();
}
async function go(tab) { if(ui.busy) return; captureDrafts(); busy(true); ui.tab=tab; try { await loadDetails(); render(); window.scrollTo(0,0); } finally { busy(false); schedulePoll(); } }
async function openSnapshot(id) {
  if($('#dialog').open) closeDialog(); captureDrafts(); ui.snapshotId=id; ui.snapshot=null; ui.deals=null; ui.dealOffset=0; ui.dealFilters={search:'',pipeline:'',owner:''};
  await go('sources'); $('#snapshot-detail')?.scrollIntoView({block:'start'});
}
async function openRun(id,tab='runs') {
  if($('#dialog').open) closeDialog(); captureDrafts();
  if(ui.runId!==id) { ui.run=null; ui.report=null; ui.alerts=null; ui.cohorts=null; ui.alertDetail=null; ui.alertOffset=0; ui.alertFilters={search:'',owner:'',status:'',reason:''}; ui.cohortOffset=0; ui.compareId=''; ui.comparison=null; }
  ui.runId=id; await go(tab); if(tab==='runs') $('#run-detail')?.scrollIntoView({block:'start'});
}
async function openAction(id) { if($('#dialog').open) closeDialog(); ui.actionId=id; await go('actions'); $('#action-detail')?.scrollIntoView({block:'start'}); }
function reviewValues(d,current) {
  return Object.fromEntries(['status','note','assignee','dueAt'].map(key=>[key,String(d[key]??'')===String(d._base?.[key]??'')?current[key]:d[key]]));
}
async function handleButton(control) {
  captureDrafts(); const act=control.dataset.act,id=control.dataset.id;
  if(act==='tab') return go(control.dataset.tab);
  if(act==='new-project') return projectDialog();
  if(act==='close-dialog') return closeDialog();
  if(act==='more-items') return loadOlder(control.dataset.kind);
  if(act==='open-snapshot') return openSnapshot(id);
  if(act==='use-snapshot') { const key='run:'+ui.projectId,d=draft(key,{name:'',snapshotId:id,asOf:new Date().toISOString()}); d.snapshotId=id; d.dirty=true; return go('runs'); }
  if(act==='inspect-deal') {
    const result=await request('/api/snapshots/'+uri(ui.snapshotId)+'/deals/'+uri(id));
    return openDialog('Original native deal '+id,`<p>${esc(snapshotName(ui.snapshotId))}</p><pre>${esc(json(result.deal))}</pre>`);
  }
  if(act==='inspect-job') { const data=await request('/api/jobs/'+uri(id)); return openDialog(data.job.name||'Original source operation',kv(data.job)); }
  if(act==='resume-job'||act==='cancel-job') return mutate(()=>({url:'/api/jobs/'+uri(id)+(act==='resume-job'?'/resume':'/cancel'),data:{}}),{projectRevision:false,message:act==='resume-job'?'Original source collection resumed with its retained cursor.':'Cancellation requested for the original collection.'});
  if(act==='add-stage') { const d=configDraft(); d.stages.push({id:'',status:''}); d.dirty=true; return render(); }
  if(act==='remove-stage') { const d=configDraft(); d.stages.splice(Number(control.dataset.index),1); d.dirty=true; return render(); }
  if(act==='schema-stages') {
    const d=configDraft(),ids=new Set(d.stages.map(s=>s.id));
    for(const pipeline of list(ui.schema?.pipelines)) for(const stage of list(pipeline.stages)) if(!ids.has(String(stage.id))) { ids.add(String(stage.id)); d.stages.push({id:String(stage.id),status:''}); }
    d.dirty=true; render(); return tell('Retained native stage IDs loaded. Confirm their actual meanings before saving.');
  }
  if(act==='preview-config') return openDialog('Complete monitoring definitions',`<pre>${esc(json(buildConfig(values('config:'+ui.projectId))))}</pre>`);
  if(act==='open-run') return openRun(id);
  if(act==='open-attention') return openRun(id,'attention');
  if(act==='open-cohorts') return openRun(id,'cohorts');
  if(act==='retry-run') return mutate(()=>({url:'/api/runs/'+uri(id)+'/retry',data:{}}),{projectRevision:false,after:r=>{ui.runId=r.run.id;},message:'The original monitoring inputs are retained in a new retry run.'});
  if(act==='open-alert') return openAlert(id);
  if(act==='deal-page') { ui.dealOffset=Number(control.dataset.offset); await loadDetails(); render(); return $('#snapshot-detail')?.scrollIntoView({block:'start'}); }
  if(act==='alert-page') { ui.alertOffset=Number(control.dataset.offset); await loadDetails(); return render(); }
  if(act==='cohort-page') { ui.cohortOffset=Number(control.dataset.offset); await loadDetails(); return render(); }
  if(act==='new-action') {
    const runId=control.dataset.run||ui.runId,dealId=control.dataset.deal||'',d=actionDraft(runId,dealId);
    d.runId=runId; d.dealId=dealId; d.dirty=true;
    if(ui.alertDetail?.dealId===dealId&&!d.ownerId) d.ownerId=ui.alertDetail.ownerId==='UNASSIGNED'?'':ui.alertDetail.ownerId;
    if($('#dialog').open) closeDialog(); await go('actions'); return $('#action-editor')?.scrollIntoView({block:'start'});
  }
  if(act==='open-action') return openAction(id);
  if(act==='action-source') {
    const a=ui.actionDetail?.action; if(!a||a.id!==id) throw Error('Open the current operation first.');
    const value=await request('/api/snapshots/'+uri(a.snapshotId)+'/deals/'+uri(a.dealId));
    return openDialog('Retained source for this follow-up',kv({monitoring_run:runName(a.runId),record_sha256:a.recordSha256})+`<pre class="smallgap">${esc(json(value.deal))}</pre>`);
  }
  if(act==='prepare-action'||act==='execute-action') {
    return mutate(()=>{const a=ui.actionDetail?.action; if(a?.id!==id) throw Error('Open the retained operation first.'); return {url:'/api/actions/'+uri(id)+(act==='prepare-action'?'/prepare':'/execute'),data:{version:a.version}};},
      {projectRevision:false,inspect:()=>ui.actionDetail?.action,after:r=>{ui.actionId=r.action.id;},message:act==='prepare-action'?'Exact native request prepared from the checked original deal.':'The approved native operation has started. Its actual outcome remains with this proposal.'});
  }
  if(act==='revoke-action') return revokeDialog(id);
  if(act==='handover-run') { const key='export:'+ui.projectId,d=draft(key,{name:'',runId:id}); d.runId=id; d.dirty=true; return go('handoff'); }
  if(act==='load-incoming') return refresh();
  if(act==='conflict-refresh') return refresh(true);
  if(act==='conflict-reapply') { const pending=ui.pending; if(!pending?.inspected) throw Error('Load and inspect current saved work first.'); return mutate(pending.build,pending.options,pending.kind==='uncertain'?pending.frozen:null); }
  if(act==='conflict-dismiss') { ui.pending=null; renderConflict(); return tell('Your draft remains available for editing.'); }
}
async function submitForm(form) {
  captureForm(form); const action=form.dataset.action,key=form.dataset.draft,id=form.dataset.id,projectId=ui.projectId;
  if(action==='project') return mutate(()=>({url:'/api/projects',data:{name:values(key).name}}),{projectRevision:false,draftKey:key,after:r=>{closeDialog();selectProject(r.project.id);ui.tab='sources';},message:'Manager project created.'});
  if(action==='config') return mutate(()=>{const d=values(key),edited=buildConfig(d); return {url:base()+'/config',data:{config:mergeChanged(d.originalConfig,edited,project().config)}};},
    {draftKey:key,inspect:()=>project()?.config,message:'Pipeline definitions saved. Earlier monitoring runs retain their original settings.'});
  if(action==='import') return mutate(async()=>{const d=values(key); if(!d.file) throw Error('Choose the original CRM deals file.'); return {url:base()+'/import',data:{name:d.name,filename:d.file.name,contentBase64:await fileContent(d.file),declaredComplete:Boolean(d.declaredComplete)}};},
    {draftKey:key,after:r=>{ui.snapshotId=r.snapshot.id;ui.snapshot=null;ui.dealOffset=0;drafts.delete('run:'+projectId);},message:'Original collection retained with its exact source bytes and coverage.'});
  if(action==='schema') return mutate(async()=>{const d=values(key); if(!d.file) throw Error('Choose the original native schema file.'); return {url:base()+'/schema',data:{kind:d.kind,filename:d.file.name,contentBase64:await fileContent(d.file)}};},
    {draftKey:key,message:'Original schema retained. Its native fields and stages are available in the definition editor.'});
  if(action==='sync') return mutate(()=>({url:base()+'/sync',data:{name:values(key).name}}),{draftKey:key,message:'Original source collection started. Its cursor and provider responses will remain with the operation.'});
  if(action==='deal-filter') { const data=new FormData(form);ui.dealFilters=Object.fromEntries(['search','pipeline','owner'].map(k=>[k,String(data.get(k)||'')]));ui.dealOffset=0;await loadDetails();return render(); }
  if(action==='run') return mutate(()=>{const d=values(key);return {url:base()+'/runs',data:{snapshotId:d.snapshotId,name:d.name,asOf:d.asOf}};},
    {draftKey:key,after:r=>{ui.runId=r.run.id;ui.compareId='';ui.comparison=null;ui.tab='runs';},message:'Monitoring run queued with its original collection and saved definitions.'});
  if(action==='attention-run'||action==='cohort-run') { const selected=String(new FormData(form).get('runId')||'');if(!selected)throw Error('Choose a retained monitoring run.');return openRun(selected,action==='attention-run'?'attention':'cohorts'); }
  if(action==='alert-filter') { const data=new FormData(form);ui.alertFilters=Object.fromEntries(['search','owner','status','reason'].map(k=>[k,String(data.get(k)||'')]));ui.alertOffset=0;await loadDetails();return render(); }
  if(action==='review') return mutate(()=>{const current=ui.alertDetail;if(current?.dealId!==id)throw Error('Open the original alert before recording its review.');const data=reviewValues(values(key),object(current.review));data.dueAt=String(data.dueAt||'').trim()||null;return {url:'/api/runs/'+uri(ui.runId)+'/alerts/'+uri(id)+'/review',data:{version:current.review?.version||0,...data}};},
    {projectRevision:false,draftKey:key,inspect:()=>ui.alertDetail?.review,after:()=>closeDialog(),message:'Manager decision retained with this source-bound alert.'});
  if(action==='compare') { const baseline=String(new FormData(form).get('baseline')||'');if(!baseline)throw Error('Choose an earlier completed monitoring run.');ui.compareId=baseline;await loadDetails();return render(); }
  if(action==='action-create') return mutate(()=>{const d=values(key);return {url:'/api/runs/'+uri(d.runId)+'/actions',data:{dealId:String(d.dealId).trim(),kind:d.kind,subject:d.subject,body:d.body,ownerId:String(d.ownerId||'').trim(),dueAt:String(d.dueAt||'').trim()||null,reminderAt:String(d.reminderAt||'').trim()||null,priority:d.priority}};},
    {draftKey:key,after:r=>{ui.actionId=r.action.id;},message:'Follow-up proposal retained with its original run and source record.'});
  if(['approve-action','reconcile-action','revoke-action'].includes(action)) {
    const ending={'approve-action':'approve','reconcile-action':'reconcile','revoke-action':'revoke'}[action];
    return mutate(()=>{const current=ui.actionDetail?.action;if(current?.id!==id)throw Error('Open the retained follow-up operation first.');const d=values(key);return {url:'/api/actions/'+uri(id)+'/'+ending,data:{version:current.version,...(action==='reconcile-action'?{nativeId:String(d.nativeId||'').trim()||null}:{note:d.note})}};},
      {projectRevision:false,draftKey:key,inspect:()=>ui.actionDetail?.action,after:r=>{ui.actionId=r.action.id;if(action==='revoke-action')closeDialog();},message:action==='approve-action'?'Approval recorded for this exact prepared request.':action==='reconcile-action'?'Original native outcome recovery started with the retained request marker.':'Proposal revoked; its source and operating history remain retained.'});
  }
  if(action==='export') return mutate(()=>{const d=values(key);return {url:base()+'/exports',data:{name:d.name,runId:d.runId||null}};},{draftKey:key,message:'Complete project handover retained and ready to download.'});
  if(action==='restore') return mutate(async()=>{const d=values(key);if(!d.file)throw Error('Choose the complete original project recovery file.');return {url:'/api/restore',data:{name:d.name,filename:d.file.name,contentBase64:await fileContent(d.file)}};},
    {projectRevision:false,draftKey:key,after:r=>{selectProject(r.project.id);ui.tab='overview';},message:'Complete project restored separately with original source and operating history.'});
}
try { $('#operator').value=localStorage.getItem('pipeline-operator')||''; } catch {}
document.addEventListener('input',event=>{const form=event.target.closest('form[data-draft]');if(form)captureForm(form);if(event.target.id==='operator')try{localStorage.setItem('pipeline-operator',event.target.value);}catch{}});
document.addEventListener('change',async event=>{
  try { const form=event.target.closest('form[data-draft]');if(form)captureForm(form);if(event.target.id==='project-choice'){selectProject(event.target.value);await reloadData();render();schedulePoll();} }
  catch(error){tell(error.message);}
});
document.addEventListener('click',async event=>{
  const nav=event.target.closest('#nav [data-tab]'),control=event.target.closest('[data-act]');if(!nav&&!control)return;event.preventDefault();
  try { if(nav)await go(nav.dataset.tab);else await handleButton(control); }
  catch(error){tell(error.message);if($('#dialog').open){const note=document.createElement('div');note.className='notice';note.textContent=error.message;$('#dialog-body').prepend(note);}}
});
document.addEventListener('submit',async event=>{const form=event.target.closest('form[data-action]');if(!form)return;event.preventDefault();try{await submitForm(form);}catch(error){tell(error.message);if($('#dialog').open){const note=document.createElement('div');note.className='notice';note.textContent=error.message;$('#dialog-body').prepend(note);}}});
$('#dialog').addEventListener('cancel',()=>{captureDrafts();setTimeout(()=>{$('#dialog-body').innerHTML='';renderConflict();},0);});
$('#refresh').addEventListener('click',()=>refresh());
window.addEventListener('beforeunload',event=>{if(all('form[data-draft]').some(f=>drafts.get(f.dataset.draft)?.dirty)){event.preventDefault();event.returnValue='';}});
refresh();
