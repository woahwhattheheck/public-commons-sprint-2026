'use strict';
(() => {
const $=id=>document.getElementById(id);
const S={mode:new URLSearchParams(location.search).get('mode')==='sandbox'?'sandbox':'demo',
  workspace:null,view:null,note:null,document:null,sequence:0,busy:false,pending:null,dirty:false,
  selected:new Set(),conflict:null,settings:null};
const workNames=['title','owner','due_date','priority','work_status','next_action','notes','customer_note','outcome','resolution_summary'];
const workIds={title:'work-title',owner:'work-owner',due_date:'work-due',priority:'work-priority',work_status:'work-status',
  next_action:'work-next',notes:'work-notes',customer_note:'work-customer-note',outcome:'work-outcome',resolution_summary:'work-resolution'};
const labels={todo:'To do',in_progress:'In progress',waiting:'Waiting',ready:'Ready for review',
  support_completed:'Support completed',monitoring:'Monitoring arranged',subscription_ended:'Subscription ended',no_follow_up:'No follow-up needed'};
const events={case_opened:'Case opened',source_refreshed:'Subscription facts refreshed',plan_saved:'Work plan saved',
  note_prepared:'Support note prepared',source_changed:'Provider facts changed',resolution_reviewed:'Resolution reviewed',
  case_resolved:'Support case resolved',case_reopened:'Support case reopened',handover_restored:'Original handover restored'};
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function show(id,value=true){$(id).hidden=!value;}
function note(message,kind='status'){$('notice').textContent=message;$('notice').dataset.kind=kind;show('notice',!!message);}
function humanDate(value){if(!value)return 'Not provided';const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString():value;}
function storageGet(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function storageSet(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));}
  catch{note('Browser storage is full. Save the work plan to retain your edits.','error');}}
function pendingKey(){return 'renewalguard.pending.'+(S.workspace?.scope.id || S.mode);}
function draftKey(){return 'renewalguard.draft.'+S.workspace.scope.id+'.'+S.view.case.id;}
function draftValue(){return Object.fromEntries(workNames.map(k=>[k,$(workIds[k]).value]));}
function defaultWork(view){return {title:'Renewal support · '+view.case.subscription_id,owner:'',due_date:'',priority:view.source?.facts.tier==='HIGH'?'high':'normal',
  work_status:'todo',next_action:view.source?.facts.rationale || 'Review the subscription and record the next support action.',notes:'',customer_note:'',outcome:'',resolution_summary:''};}
function fillWork(work){for(const k of workNames)$(workIds[k]).value=work[k]??'';}
function saveLocalDraft(){if(!S.view)return;storageSet(draftKey(),{case_id:S.view.case.id,base_revision:S.view.revision,work:draftValue(),at:new Date().toISOString()});}
function markDirty(){if(!S.view)return;S.dirty=JSON.stringify(draftValue())!==JSON.stringify(S.view.plan?.work || defaultWork(S.view));
  if(S.dirty)saveLocalDraft();else storageSet(draftKey(),null);updateActions();}
function url(path,params={}){return path+'?'+new URLSearchParams({mode:S.mode,...params});}
async function api(path,{method='GET',body,timeout=30000}={}){
  const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout),cache:'no-store'});
  let data;try{data=await response.json();}catch{throw new Error('The local server returned an incomplete response');}
  if(!response.ok){const error=new Error(data.error||'Request failed');error.code=data.code;error.status=response.status;error.details=data.details||{};throw error;}
  return data;
}
function download(name,content,type='application/json'){
  const blob=new Blob([typeof content==='string'?content:JSON.stringify(content,null,2)+'\n'],{type});
  const href=URL.createObjectURL(blob),anchor=node('a');anchor.href=href;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
function stagePending(payload){S.pending=payload;storageSet(pendingKey(),payload);renderPending();}
function clearPending(){storageSet(pendingKey(),null);S.pending=null;renderPending();}
function renderPending(status){
  show('pending-panel',!!S.pending);if(!S.pending){updateActions();return;}
  $('pending-title').textContent=S.busy?'Operation in progress':'Original operation retained';
  $('pending-id').textContent=S.pending.request_id;
  $('pending-status').textContent=status || (S.busy?'The server retains the original request before reading providers or saving case work.':'Recover this request to retrieve its saved result or continue it.');
  $('recover-request').disabled=S.busy;
  updateActions();
}
function updateActions(){
  const view=S.view,open=view?.case.stage==='open',pending=!!S.pending,busy=S.busy,locked=busy||pending;
  $('mode').disabled=busy;$('refresh-portfolio').disabled=locked;$('reload-workspace').disabled=busy;
  $('intake-selected').disabled=locked||!S.selected.size;
  $('capture-form').querySelector('button').disabled=locked;$('restore-form').querySelector('button').disabled=locked;
  for(const button of $('recent-operations').querySelectorAll('button'))button.disabled=locked;
  if(!view)return;
  $('plan-fields').disabled=busy||!open;
  $('save-plan').disabled=locked||!open;
  $('refresh-case').disabled=locked;$('prepare-note').disabled=locked||!open;
  $('use-note').disabled=busy||!open||!S.note;
  $('download-note').disabled=!S.note;
  $('save-review').disabled=locked||!open||S.dirty||!view.plan;
  $('resolve-case').disabled=locked||!open||S.dirty||!view.review;
  $('reopen-form').querySelector('button').disabled=locked;
  $('download-work').disabled=!view.plan;$('download-calendar').disabled=!view.plan?.work.due_date;
  $('draft-state').textContent=S.dirty?'Unsaved edits retained in this browser':view.plan?'Saved edition '+view.plan.number:'Create the first saved plan';
  $('review-guidance').textContent=S.dirty?'Save the edited plan before review.':open?
    'Set an owner, mark work ready, and save the resolution outcome and summary.':'This case is resolved. Its original plan and review remain available.';
}
async function refreshWorkspace({keepCase=true}={}){
  const mode=S.mode,sequence=++S.sequence;
  const data=await api(url('/api/workspace'));if(mode!==S.mode||sequence!==S.sequence)return;
  S.workspace=data;S.pending=storageGet(pendingKey());renderWorkspace();renderPending();
  if(keepCase&&S.view)await openCase(S.view.case.id,{preserveDraft:true});
}
function renderWorkspace(){
  const w=S.workspace;
  $('saved-count').textContent=w.cases.length;
  $('queue-counts').replaceChildren(...[['open','Open'],['overdue','Overdue'],['ready','Ready'],['resolved','Resolved']].map(([key,label])=>{
    const box=node('span');box.append(node('strong',String(w.counts[key])),document.createTextNode(label));return box;
  }));
  $('source-description').textContent=w.scope.mode==='demo'?'Demonstration records are retained separately from sandbox work.':
    'PayPal sandbox · app '+w.scope.app_fingerprint.slice(0,12);
  $('connection-description').textContent=S.settings?(S.settings.sandbox_configured?'Sandbox app configured. ':'Configure a sandbox app to use that source. ')+
    (S.settings.ai_configured?'AI draft adapter configured.':'Rule-based note preview available.'):'';
  $('recent-operations').replaceChildren(...(w.recent_operations || []).map(op=>{
    const row=node('div',undefined,'operation-row'),description=node('div');
    description.append(node('strong',op.action.replaceAll('_',' ')+' · '+op.state),node('small',humanDate(op.updated_at)));
    if(op.error)description.append(node('small',op.error.message));
    const button=node('button',op.state==='done'?'Open saved result':op.state==='rejected'?'Open rejected result':'Recover original operation');
    button.disabled=!!S.pending||S.busy;button.addEventListener('click',()=>guard(async()=>{
      stagePending({mode:S.mode,request_id:op.request_id,action:op.action,input:{case_id:op.case_id},resume:true});
      await recover();
    }));row.append(description,button);return row;
  }));
  renderCases();renderPortfolio();updateActions();
}
function renderCases(){
  if(!S.workspace)return;
  const q=$('case-search').value.trim().toLowerCase(),filter=$('case-filter').value;
  const cases=S.workspace.cases.filter(c=>{
    const matches=filter==='all'||filter==='overdue'&&c.overdue||filter==='ready'&&c.stage==='open'&&c.plan?.work_status==='ready'||c.stage===filter;
    return matches&&[c.subscription_id,c.plan?.title,c.plan?.owner,c.source?.status].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  $('case-list').replaceChildren(...cases.map(c=>{
    const button=node('button',undefined,'case-button');button.dataset.caseId=c.id;button.setAttribute('aria-current',String(S.view?.case.id===c.id));
    button.append(node('strong',c.plan?.title||c.subscription_id),node('small',c.subscription_id+' · '+(c.source?.status||'No snapshot')),
      node('small',(c.plan?.owner||'Unassigned')+' · '+(labels[c.plan?.work_status]||c.stage)));
    if(c.plan?.due_date)button.append(node('small','Due '+c.plan.due_date+(c.overdue?' · overdue':''),c.overdue?'overdue':''));
    button.addEventListener('click',()=>guard(()=>openCase(c.id)));return button;
  }));
  show('case-empty',!cases.length);$('case-empty').textContent=S.workspace.cases.length?'No saved cases match this queue.':'Open subscriptions from intake to create the work queue.';
}
function visiblePortfolio(){const q=$('portfolio-search').value.trim().toLowerCase();return(S.workspace?.portfolio?.items||[])
  .filter(x=>[x.id,x.status,x.plan_id].join(' ').toLowerCase().includes(q));}
function renderPortfolio(){
  const p=S.workspace?.portfolio;
  $('portfolio-coverage').textContent=p?
    (p.incomplete?'Partial portfolio · ':'Retained portfolio · ')+p.items.length+' subscriptions across '+p.pages_read+' page(s), read '+humanDate(p.at)+
    (p.incomplete?'. The list limit is 200 records; open any additional subscription by its exact ID.':'.')+
    ' Filters use these loaded records.':'Read the current portfolio, or open a subscription by its exact ID.';
  const rows=visiblePortfolio();
  $('portfolio-rows').replaceChildren(...rows.map(item=>{
    const tr=node('tr'),check=node('input');check.type='checkbox';check.checked=S.selected.has(item.id);check.setAttribute('aria-label','Select '+item.id);
    check.addEventListener('change',()=>{if(check.checked)S.selected.add(item.id);else S.selected.delete(item.id);renderPortfolio();});
    const select=node('td');select.append(check);tr.append(select,node('td',item.id),node('td',item.status),node('td',item.plan_id||'Not provided'));
    const cell=node('td'),saved=S.workspace.cases.find(c=>c.subscription_id===item.id);
    if(saved){const b=node('button',saved.stage==='resolved'?'Open resolved case':'Open case');b.addEventListener('click',()=>guard(()=>openCase(saved.id)));cell.append(b);}
    else cell.textContent='Ready for intake';
    tr.append(cell);return tr;
  }));
  $('select-visible').checked=!!rows.length&&rows.every(x=>S.selected.has(x.id));
  $('select-visible').indeterminate=rows.some(x=>S.selected.has(x.id))&&!$('select-visible').checked;
  $('intake-selected').textContent='Open selected cases'+(S.selected.size?' ('+S.selected.size+')':'');
  updateActions();
}
function showPortfolio(){
  if(S.dirty)saveLocalDraft();S.view=null;S.note=null;S.document=null;S.conflict=null;
  show('portfolio-view');show('case-view',false);show('document-viewer',false);
  history.replaceState(null,'',url('/',{}));renderCases();
}
async function openCase(id,{preserveDraft=false,clearDraft=false}={}){
  if(S.view&&S.dirty)saveLocalDraft();
  const previous=S.view?.case.id===id&&preserveDraft&&S.dirty?draftValue():null;
  const mode=S.mode,sequence=++S.sequence;
  const view=await api(url('/api/case',{case_id:id}));if(mode!==S.mode||sequence!==S.sequence)return;
  S.view=view;S.document=null;S.note=null;S.conflict=null;
  if(clearDraft)storageSet(draftKey(),null);
  const saved=clearDraft?null:storageGet(draftKey());
  const current=view.plan?.work||defaultWork(view),draft=previous||saved?.work;
  fillWork(draft||current);S.dirty=JSON.stringify(draftValue())!==JSON.stringify(current);
  if(saved&&saved.base_revision!==view.revision&&S.dirty)showConflict(view,saved.base_revision);
  else show('conflict-panel',false);
  show('portfolio-view',false);show('case-view');show('document-viewer',false);
  renderCase();renderCases();history.replaceState(null,'',url('/',{case:id}));
  const ref=view.case.notes.at(-1);
  if(ref){
    const noteResult=await api(url('/api/document',{case_id:id,sha:ref.sha}));
    if(S.view?.case.id!==id||sequence!==S.sequence)return;
    S.note=noteResult.document;renderNote();updateActions();
  }
}
function fact(label,value){const box=node('div');box.append(node('dt',label),node('dd',value||'Not provided'));return box;}
function renderCase(){
  const v=S.view,c=v.case,source=v.source,facts=source?.facts||{};
  $('case-stage').textContent=(c.stage==='resolved'?'Resolved case':'Open case')+' · revision '+v.revision;
  $('case-title').textContent=v.plan?.work.title||'Renewal support case';$('case-subscription').textContent=c.subscription_id+' · '+(S.mode==='sandbox'?'PayPal sandbox':'Demonstration');
  $('source-observed').textContent=source?'Observed '+humanDate(source.at):'';
  $('facts-grid').replaceChildren(fact('Subscription status',facts.status),fact('Triage',facts.tier),fact('Plan',facts.plan_id),
    fact('Next billing',facts.next_billing_at?humanDate(facts.next_billing_at):''),fact('Last disclosed payment failure',facts.last_failed_at?humanDate(facts.last_failed_at):''),
    fact('Status updated',facts.status_updated_at?humanDate(facts.status_updated_at):''));
  $('source-rationale').textContent=facts.rationale||'';
  $('source-identity').replaceChildren(fact('Source ID',source?.id),fact('Facts fingerprint',facts.fingerprint),
    fact('Source scope',S.workspace.scope.id),fact('Case ID',c.id));
  $('plan-edition').textContent=v.plan?'Edition '+v.plan.number+' · '+humanDate(v.plan.at):'First edition';
  renderNote();
  show('saved-review',!!v.review);
  if(v.review){
    $('review-details').textContent=v.review.reviewer+' · plan '+c.reviews.find(x=>x.id===v.review.id)?.plan_number+' · '+humanDate(v.review.at);
    $('review-text').textContent=v.review.summary;
  }
  if(!$('reviewer').value)$('reviewer').value=v.plan?.work.owner||'';
  show('resolution-panel',!!v.resolution);
  if(v.resolution){$('resolution-details').textContent=(labels[v.resolution.outcome]||v.resolution.outcome)+' · '+humanDate(v.resolution.at);
    $('resolution-summary').textContent=v.resolution.summary;}
  show('reopen-form',c.stage==='resolved');
  $('case-timeline').replaceChildren(...[...c.events].reverse().map(event=>{
    const li=node('li');li.append(node('strong',events[event.type]||event.type),node('time',humanDate(event.at)));
    const detail=event.reason||event.outcome&&labels[event.outcome]||event.number&&'Plan edition '+event.number||event.changed&&'The subscription facts fingerprint changed.';
    if(detail)li.append(node('p',String(detail)));return li;
  }));
  const groups=[['Subscription snapshot',c.sources],['Work plan',c.plans],['Support note',c.notes],['Resolution review',c.reviews],['Case resolution',c.resolutions]];
  $('case-documents').replaceChildren(...groups.flatMap(([label,refs])=>[...refs].reverse().map(ref=>{
    const b=node('button',label+(ref.number?' · edition '+ref.number:''));b.append(node('small',humanDate(ref.at)+' · '+(ref.status||ref.kind||ref.reviewer||ref.owner||ref.id)));
    b.addEventListener('click',()=>guard(()=>openDocument(ref,label)));return b;
  })));
  updateActions();
}
function renderNote(){
  $('note-text').textContent=S.note?.proposal.text||'Prepare a note to review here.';
  $('note-kind').textContent=S.note?(S.note.proposal.available?'AI-generated support note':'Rule-based support preview'):
    'Uses the subscription’s current status, renewal date and disclosed failure date.';
  $('note-source').textContent=S.note?'Prepared '+humanDate(S.note.at)+' · source '+S.note.source_id:'';
}
function showConflict(view,baseRevision){
  S.conflict=view;show('conflict-panel');
  $('conflict-description').textContent='Your edited fields are retained below. Their base was revision '+baseRevision+
    '; the case is now revision '+view.revision+'. Compare the current saved plan before continuing.';
  $('conflict-current').textContent=JSON.stringify(view.plan?.work||defaultWork(view),null,2);
}
async function openDocument(ref,label){
  const caseId=S.view.case.id,result=await api(url('/api/document',{case_id:caseId,sha:ref.sha}));
  if(S.view?.case.id!==caseId)return;S.document=result;
  $('document-title').textContent=label;$('document-hash').textContent='SHA-256 '+result.sha;
  $('document-content').textContent=JSON.stringify(result.document,null,2);show('document-viewer');
  $('document-viewer').scrollIntoView({block:'nearest',behavior:'auto'});
}
async function acceptResult(result,payload){
  clearPending();
  const state=result.result?.state;
  if(payload.action==='save_plan'&&['plan_saved','plan_unchanged'].includes(state)&&S.view?.case.id===payload.input.case_id){
    storageSet(draftKey(),null);S.dirty=false;
  }
  const previous=S.view?.case.id;
  await refreshWorkspace({keepCase:false});
  const caseId=result.result?.case_id||previous;
  if(caseId)await openCase(caseId,{preserveDraft:true,clearDraft:payload.action==='save_plan'&&['plan_saved','plan_unchanged'].includes(state)});
  if(payload.action==='intake')S.selected.clear();
  renderPortfolio();
  note(result.result?.message||({
    portfolio_saved:'Portfolio retained. Select subscriptions to open their cases.',
    intake_complete:'Selected subscriptions are retained in the work queue.',
    source_refreshed:'Current subscription facts are retained in the case timeline.',
    case_opened:'Subscription retained. Assign the work and save its first plan.',
    plan_saved:'Work plan saved as a new edition.',
    plan_unchanged:'The matching plan edition is already retained.',
    note_prepared:'Support note retained with its original subscription snapshot.',
    resolution_reviewed:'Resolution review saved against the exact plan and fresh source.',
    case_resolved:'Support case resolved. Its complete work and source history remain available.',
    case_reopened:'Support case reopened with its previous resolution retained.',
    handover_restored:'Complete handover restored in its original source scope.',
    already_retained:'This original handover is already retained.',
  }[state]||'Operation completed.'));
}
async function handleFailure(error,payload){
  let status;
  try{status=await api(url('/api/operation',{request_id:payload.request_id}));}catch{}
  if(status?.state==='done'){await acceptResult(status,payload);return;}
  if(status?.state==='rejected'||(!status?.found&&error.status&&error.status<500)){
    clearPending();
    if(['revision_changed','plan_changed','review_changed'].includes(error.code)&&payload.input.case_id){
      const local=S.view?.case.id===payload.input.case_id?draftValue():null,base=payload.input.expected_revision;
      await refreshWorkspace({keepCase:false});await openCase(payload.input.case_id,{preserveDraft:true});
      if(local){fillWork(local);S.dirty=true;saveLocalDraft();showConflict(S.view,base);updateActions();}
    }
    note(error.message,'error');return;
  }
  renderPending((status?.progress?'Retained '+status.progress.completed+' of '+status.progress.total+' cases. ':'')+
    (status?.error?.message||error.message)+' Recover the original request to continue.');
  note('The request remains retained as '+payload.request_id+'.','error');
}
async function sendPending(){
  const payload=S.pending;if(!payload||S.busy)return;
  S.busy=true;renderPending();try{
    const result=await api(payload.resume?'/api/resume':'/api/command',{method:'POST',body:payload.resume?{mode:payload.mode,request_id:payload.request_id}:payload,timeout:30000});
    await acceptResult(result,payload);
  }catch(error){await handleFailure(error,payload);}
  finally{S.busy=false;renderPending();updateActions();}
}
async function command(action,input){
  if(S.pending)throw new Error('Recover the retained request before starting another case operation');
  if(!S.workspace)throw new Error('Reopen the workspace first');
  const payload={mode:S.mode,request_id:crypto.randomUUID(),action,input};
  stagePending(payload);await sendPending();
}
async function recover(){
  if(!S.pending||S.busy)return;
  const payload=S.pending,mode=S.mode;
  let status;try{status=await api(url('/api/operation',{request_id:payload.request_id}));}catch(error){note(error.message,'error');return;}
  if(S.pending?.request_id!==payload.request_id||S.mode!==mode)return;
  if(status.state==='done'){await acceptResult(status,payload);return;}
  if(status.state==='rejected'){
    await handleFailure(Object.assign(new Error(status.error.message),status.error),payload);return;
  }
  if(status.active){renderPending(status.progress?'Intake saved '+status.progress.completed+' of '+status.progress.total+' cases. The original request is still running.':
    'The original request is still running. Refresh its status again shortly.');return;}
  await sendPending();
}
async function guard(fn){try{await fn();}catch(error){note(error.message||'Operation failed','error');}}
function currentInput(extra={}){if(!S.view)throw new Error('Open a saved case first');return{case_id:S.view.case.id,expected_revision:S.view.revision,...extra};}
function workSheet(){
  const v=S.view,w=v.plan.work;return '# '+w.title+'\n\nSubscription: '+v.case.subscription_id+'\nSource: '+v.scope.provider+
    '\nCase: '+v.case.id+'\nPlan edition: '+v.plan.number+'\nPlan source fingerprint: '+v.plan.source_fingerprint+
    '\nOwner: '+(w.owner||'Unassigned')+'\nDue: '+(w.due_date||'Not set')+'\nPriority: '+w.priority+'\nWork status: '+labels[w.work_status]+
    '\n\n## Next action\n\n'+w.next_action+'\n\n## Work notes\n\n'+w.notes+'\n\n## Customer support note\n\n'+w.customer_note+
    '\n\n## Resolution to review\n\n'+(labels[w.outcome]||'Not selected')+'\n\n'+w.resolution_summary+
    (v.review?'\n\n## Saved review\n\n'+v.review.reviewer+' · '+v.review.at+'\n\n'+v.review.summary:'')+'\n';
}
function foldIcs(line){
  const out=[];let current='',bytes=0;for(const char of line){const n=new TextEncoder().encode(char).length;if(bytes+n>74){out.push(current);current=' '+char;bytes=1+n;}else{current+=char;bytes+=n;}}
  out.push(current);return out.join('\r\n');
}
function icsText(value){return value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\r/g,'');}
$('mode').value=S.mode;
$('mode').addEventListener('change',()=>guard(async()=>{
  if(S.view&&S.dirty)saveLocalDraft();S.mode=$('mode').value;S.sequence++;S.workspace=null;S.view=null;S.pending=null;S.note=null;S.selected.clear();S.dirty=false;
  $('case-list').replaceChildren();$('portfolio-rows').replaceChildren();show('case-view',false);show('portfolio-view');renderPending();
  history.replaceState(null,'',url('/'));await refreshWorkspace({keepCase:false});note('Opened the retained '+(S.mode==='demo'?'demonstration':'PayPal sandbox')+' workspace.');
}));
$('reload-workspace').addEventListener('click',()=>guard(()=>refreshWorkspace()));
$('show-portfolio').addEventListener('click',showPortfolio);
$('case-search').addEventListener('input',renderCases);$('case-filter').addEventListener('change',renderCases);
$('portfolio-search').addEventListener('input',renderPortfolio);
$('select-visible').addEventListener('change',event=>{for(const item of visiblePortfolio()){if(event.target.checked)S.selected.add(item.id);else S.selected.delete(item.id);}renderPortfolio();});
$('refresh-portfolio').addEventListener('click',()=>guard(async()=>{S.selected.clear();await command('refresh_portfolio',{});}));
$('intake-selected').addEventListener('click',()=>guard(()=>command('intake',{portfolio_sha:S.workspace.portfolio.sha,subscription_ids:[...S.selected].sort()})));
$('capture-form').addEventListener('submit',event=>{event.preventDefault();guard(()=>command('capture',{subscription_id:$('subscription-id').value.trim()}));});
$('restore-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
  const file=$('handover-file').files[0];if(!file)throw new Error('Choose a complete handover file');if(file.size>31*1024*1024)throw new Error('The supported handover upload size is 31 MiB');
  const handover=JSON.parse(await file.text());await command('restore',{handover});
});});
$('plan-form').addEventListener('input',markDirty);
$('plan-form').addEventListener('submit',event=>{event.preventDefault();guard(()=>command('save_plan',currentInput({work:draftValue()})));});
$('refresh-case').addEventListener('click',()=>guard(()=>command('capture',{subscription_id:S.view.case.subscription_id,expected_revision:S.view.revision})));
$('prepare-note').addEventListener('click',()=>guard(()=>command('ai_note',currentInput())));
$('use-note').addEventListener('click',()=>{if(S.note){$('work-customer-note').value=S.note.proposal.text;markDirty();$('work-customer-note').focus();}});
$('download-note').addEventListener('click',()=>{if(S.note)download(S.note.id+'.json',S.note);});
$('review-form').addEventListener('submit',event=>{event.preventDefault();guard(()=>command('review',currentInput({plan_id:S.view.plan.id,reviewer:$('reviewer').value,summary:$('review-summary').value})));});
$('resolve-case').addEventListener('click',()=>guard(()=>command('resolve',currentInput({review_id:S.view.review.id}))));
$('download-review').addEventListener('click',()=>{if(S.view?.review)download(S.view.review.id+'.json',S.view.review);});
$('reopen-form').addEventListener('submit',event=>{event.preventDefault();guard(()=>command('reopen',currentInput({reason:$('reopen-reason').value})));});
$('export-case').addEventListener('click',()=>guard(async()=>{const id=S.view.case.id;const handover=await api(url('/api/export',{case_id:id}));download(id+'-handover-r'+handover.case_revision+'.json',handover);}));
$('download-work').addEventListener('click',()=>{if(S.view?.plan)download(S.view.case.id+'-plan-'+S.view.plan.number+'.md',workSheet(),'text/markdown;charset=utf-8');});
$('download-calendar').addEventListener('click',()=>{
  const v=S.view,p=v?.plan;if(!p?.work.due_date)return;
  const date=p.work.due_date.replace(/-/g,''),stamp=p.at.replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//RenewalGuard//Renewal Work//EN','BEGIN:VTODO',
    'UID:'+v.case.id+'@renewalguard.local','DTSTAMP:'+stamp,'SEQUENCE:'+p.number,
    'DUE;VALUE=DATE:'+date,'SUMMARY:'+icsText(p.work.title),'DESCRIPTION:'+icsText(workSheet()),
    'STATUS:'+(v.case.stage==='resolved'?'COMPLETED':p.work.work_status==='in_progress'?'IN-PROCESS':'NEEDS-ACTION'),
    'PRIORITY:'+(p.work.priority==='urgent'?'1':p.work.priority==='high'?'3':'5'),'END:VTODO','END:VCALENDAR'];
  download(v.case.id+'.ics',lines.map(foldIcs).join('\r\n')+'\r\n','text/calendar;charset=utf-8');
});
$('use-saved-plan').addEventListener('click',()=>{if(S.view){fillWork(S.view.plan?.work||defaultWork(S.view));S.dirty=false;S.conflict=null;storageSet(draftKey(),null);show('conflict-panel',false);updateActions();}});
$('rebase-draft').addEventListener('click',()=>guard(async()=>{if(!S.conflict)return;show('conflict-panel',false);S.conflict=null;await command('save_plan',currentInput({work:draftValue()}));}));
$('recover-request').addEventListener('click',()=>guard(recover));
$('download-document').addEventListener('click',()=>{if(S.document)download(S.document.document.id+'.json',S.document.document);});
$('close-document').addEventListener('click',()=>show('document-viewer',false));
window.addEventListener('beforeunload',()=>{if(S.view&&S.dirty)saveLocalDraft();});
guard(async()=>{
  const savedCase=new URLSearchParams(location.search).get('case');
  S.settings=await api('/api/settings');await refreshWorkspace({keepCase:false});
  if(savedCase)await openCase(savedCase);
});
})();
