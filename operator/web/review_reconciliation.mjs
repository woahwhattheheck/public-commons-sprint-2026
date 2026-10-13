/* Returned response desk for the original Upper Savannah extension host. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const human = value => String(value ?? '').replaceAll('-', ' ').replaceAll('_', ' ');
const short = value => String(value ?? '').slice(0, 12);
const date = value => value ? new Date(value).toLocaleString() : '';
const options = (values, selected) => values.map(([key,label]) => '<option value="'+esc(key)+'"'+(key===selected?' selected':'')+'>'+esc(label)+'</option>').join('');
const decisions = [['unreviewed','Unreviewed'],['accepted','Accepted'],['changes-requested','Changes requested'],['question','Question'],['not-applicable','Not applicable']];
const dispositions = [['in-review','In review'],['changes-requested','Changes requested'],['ready-for-purpose','Ready for purpose']];
const table = (headers, rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const button = (action,label,extra='',primary=false) => '<button type="button" data-recon-action="'+action+'" '+extra+' class="'+(primary?'primary':'small')+'">'+esc(label)+'</button>';
const textField = (name,label,value='',rows=0) => '<label><span>'+esc(label)+'</span>'+(rows?'<textarea data-recon-field="'+esc(name)+'" rows="'+rows+'" maxlength="20000">'+esc(value)+'</textarea>':'<input data-recon-field="'+esc(name)+'" value="'+esc(value)+'" maxlength="'+(['name','role'].includes(name)?300:500)+'">')+'</label>';
const selectField = (name,label,values,value) => '<label><span>'+esc(label)+'</span><select data-recon-field="'+esc(name)+'">'+options(values,value)+'</select></label>';
const decisionView = value => {
  if(value===null)return '<p>No correction in this version.</p>';
  if(typeof value!=='object')return '<p class="review-source-detail">'+esc(dispositions.some(([key])=>key===value)?human(value):value)+'</p>';
  if(value.decision!==undefined)return '<p><strong>'+esc(human(value.decision))+'</strong></p>'+
    (value.comment?'<p class="review-source-detail">'+esc(value.comment)+'</p>':'')+
    (value.requested_change?'<p><strong>Requested change</strong></p><p class="review-source-detail">'+esc(value.requested_change)+'</p>':'')+
    (value.assignee?'<p>Assigned to '+esc(value.assignee)+'</p>':'');
  return '<p><strong>'+esc(value.title)+'</strong> · '+esc(human(value.state))+' · '+esc(human(value.priority))+' priority</p>'+
    (value.description?'<p class="review-source-detail">'+esc(value.description)+'</p>':'')+
    (value.assignee?'<p>Assigned to '+esc(value.assignee)+'</p>':'')+
    (value.resolution?'<p><strong>Resolution</strong></p><p class="review-source-detail">'+esc(value.resolution)+'</p>':'')+
    '<p class="note">'+(value.artifact_ids?.length??0)+' linked files · '+(value.requirement_ids?.length??0)+' linked requirements</p>';
};

/** The host supplies its existing authenticated request and retained task APIs. */
export function attachReviewReconciliation(host) {
  const doc = host.document || globalThis.document;
  let root=null, state=null, catalogue=null, active=null, edits=null, file=null, fileValue=null;
  let epoch=0, previewSequence=0, busy=false, stale=false, pending=null, search='', unresolvedOnly=false;
  const workspace = () => host.getState()?.workspace_key;
  const project = () => host.getState()?.data?.project?.id || catalogue?.project?.id;
  const q = (selector,node=root) => node?.querySelector(selector);
  const qa = (selector,node=root) => [...(node?.querySelectorAll(selector)??[])];
  const alive = (generation, key) => root?.isConnected && generation===epoch && workspace()===key;
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const pendingKey = key => 'upstate-response-operation:v1:'+key;
  const draftKey = id => 'upstate-response-resolution:v1:'+project()+':'+id;
  const activeKey = () => 'upstate-response-selection:v1:'+project();
  function stored(key) {try {return JSON.parse(localStorage.getItem(key)||'null');} catch (_) {return null;}}
  function save(key,value) {
    try {if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));return true;}
    catch (_) {notice('Browser draft saving failed. Keep this page open while retaining the response.');return false;}
  }
  function notice(message,error=false) {
    const node=q('[data-recon-notice]');
    if(node){node.textContent=message;node.hidden=!message;node.className=error?'notice error':'notice';}
    else if(message)host.toast(message);
  }
  function setBusy(value,message=null) {
    busy=value;
    for(const node of qa('[data-recon-action="stage"],[data-recon-action="commit"],[data-recon-action="refresh"],[data-recon-action="open"],[data-recon-action="received"],[data-recon-action="resume"]'))node.disabled=value;
    const node=q('[data-recon-progress]');if(node&&message!==null)node.textContent=message;
    updateCount();
  }
  function request(path,{method='GET',body}={}) {
    const key=workspace();
    return host.api(method==='GET'?host.endpoint(path,body||{}):path,
      method==='GET'?{}:{method,body:{workspace:key,...body}});
  }
  function completedDraft(id) {
    const draft=catalogue?.returned_responses.find(item=>item.draft_id===id);
    return draft&&catalogue.reconciliations.find(item=>item.state==='complete'&&item.incoming_sha256===draft.original_sha256);
  }
  function draftRows() {
    if(!catalogue)return '';
    const names=new Map(catalogue.reviews.map(x=>[x.id,x.title]));
    const completed=new Map(catalogue.reconciliations.filter(x=>x.state==='complete').map(x=>[x.incoming_sha256,x]));
    return catalogue.returned_responses.map(item=>{
      const done=completed.get(item.original_sha256);
      return '<tr><td class="name-cell"><strong>'+esc(names.get(item.review_id)||short(item.review_id))+'</strong><small>'+esc(item.reviewer.name)+' · '+esc(item.reviewer.organization||item.reviewer.role)+'</small></td><td>'+esc(date(item.received_at))+'</td><td>'+item.artifacts+' files · '+item.requirements+' requirements</td><td>'+esc(done?'Received into review':'Ready to compare')+'</td><td>'+(done?button('received','Open received response','data-operation-id="'+esc(done.operation_id)+'"'):button('open','Open comparison','data-draft-id="'+esc(item.draft_id)+'"'))+'</td></tr>';
    }).join('');
  }
  function renderInbox() {
    const target=q('[data-recon-inbox]');if(!target)return;
    const rows=draftRows();
    target.innerHTML=rows?table(['Selected review','Received','Coverage','State',''],[rows]):'<p>No returned response files have been received in this project.</p>';
    const history=q('[data-recon-history]');
    if(history)history.innerHTML=(catalogue?.reconciliations.length??0)?table(
      ['Reconciliation','Review','Result',''],
      catalogue.reconciliations.map(item=>'<tr><td>'+esc(date(item.created_at))+'<small>'+esc(item.reviewer?.name||'Original reviewer')+'</small></td><td>'+esc(catalogue.reviews.find(x=>x.id===item.review_id)?.title||short(item.review_id))+'</td><td>'+esc(item.state==='complete'?'Received':'Prepared')+' · '+item.conflicts_resolved+' conflicts resolved</td><td>'+button('detail','Open record','data-operation-id="'+esc(item.operation_id)+'"')+'</td></tr>')
    ):'<p>Completed response receiving operations will appear here.</p>';
    setBusy(busy);
  }
  async function refreshCatalogue() {
    const generation=epoch,key=workspace(),value=await request('/api/review-reconciliation/catalog');
    if(!alive(generation,key))return null;
    catalogue=value;renderInbox();return value;
  }
  function renderShell() {
    root.innerHTML='<header class="page-header"><div><p class="eyebrow">CUSTOMER REVIEW</p><h1>Returned responses</h1><p>Receive review files, compare independent decisions, and continue the same project history.</p></div></header>'+
      '<p data-recon-notice class="notice" role="status" aria-live="polite" hidden></p>'+
      '<section class="section"><header class="section-header"><div><h2>Receive a returned response</h2><p>The complete original file is retained with the project before you compare its decisions.</p></div></header><div class="section-body">'+
      '<label><span>Response exported by a review desk</span><input data-recon-file type="file" accept=".json,application/json"></label>'+
      '<div data-recon-file-preview aria-live="polite"></div><div class="page-actions">'+button('stage','Receive and compare','',true)+'</div><p data-recon-progress aria-live="polite"></p><div data-recon-pending></div></div></section>'+
      '<section class="section"><header class="section-header"><h2>Returned files in this project</h2></header><div class="section-body" data-recon-inbox><p>Opening retained responses…</p></div></section>'+
      '<section data-recon-comparison></section>'+
      '<section class="section"><header class="section-header"><h2>Response receiving history</h2></header><div class="section-body" data-recon-history></div></section>';
  }
  function saveEdits() {
    if(!active||!edits)return;
    edits.reviewer={
      name:q('[data-recon-actor="name"]')?.value??edits.reviewer.name,
      role:q('[data-recon-actor="role"]')?.value??edits.reviewer.role,
      organization:q('[data-recon-actor="organization"]')?.value??edits.reviewer.organization
    };
    edits.disposition=q('[data-recon-final-disposition]')?.value??edits.disposition;
    edits.note=q('[data-recon-note]')?.value??edits.note;
    save(draftKey(active.draft.draft_id),edits);
    save('upstate-response-reconciler:v1:'+project(),edits.reviewer);
    updateCount();
  }
  function chosenValue(conflict,model) {
    if(!model?.choice)return null;
    if(model.choice==='edit')return copy(model.value);
    if(conflict.conflicting_fields?.length&&conflict.proposed) {
      const result=copy(conflict.proposed);
      for(const field of conflict.conflicting_fields)result[field]=copy(conflict[model.choice][field]);
      return result;
    }
    return copy(conflict[model.choice]);
  }
  function editor(conflict,model) {
    const value=model?.value??copy(conflict.proposed??conflict.returned??conflict.current??conflict.base);
    if(conflict.item_id===null) {
      return conflict.section==='disposition'
        ?selectField('value','Disposition',dispositions,value??'in-review')
        :textField('value','Summary',value??'',5);
    }
    if(conflict.section==='corrections')return '<div class="form-grid">'+
      textField('title','Correction title',value?.title??'')+
      selectField('state','State',[['open','Open'],['resolved','Resolved']],value?.state??'open')+
      selectField('priority','Priority',[['normal','Normal'],['high','High']],value?.priority??'normal')+
      textField('assignee','Assigned to',value?.assignee??'')+
      textField('description','Requested work',value?.description??'',4)+
      textField('resolution','Resolution',value?.resolution??'',4)+
      '</div><p class="note">Linked files and requirements are preserved from the selected starting version.</p>';
    return '<div class="form-grid">'+selectField('decision','Decision',decisions,value?.decision??'unreviewed')+
      textField('assignee','Assigned to',value?.assignee??'')+
      textField('comment','Comment',value?.comment??'',4)+
      textField('requested_change','Requested change',value?.requested_change??'',4)+'</div>';
  }
  function conflictCard(conflict) {
    const seeds=[...(conflict.proposed!=null?[['combined','Combined independent changes']]:[]),['returned','Returned version'],['current','Current version'],['base','Original version']];
    const initialSeed=seeds.find(([key])=>(key==='combined'?conflict.proposed:conflict[key])!=null)?.[0]??'returned';
    const model=edits.choices[conflict.key]??{choice:'',seed:initialSeed,value:copy(conflict.proposed??conflict.returned??conflict.current??conflict.base)};
    model.seed=model.seed??initialSeed;
    edits.choices[conflict.key]=model;
    return '<article class="section" data-recon-conflict="'+esc(conflict.key)+'"><header class="section-header"><div><h3>'+esc(conflict.label)+'</h3><p>'+esc(human(conflict.section))+'</p></div></header><div class="section-body">'+
      table(['Original revision','Current retained revision','Returned response'],['<tr><td>'+decisionView(conflict.base)+'</td><td>'+decisionView(conflict.current)+'</td><td>'+decisionView(conflict.returned)+'</td></tr>'])+
      (conflict.conflicting_fields?.length?'<p>Resolve '+esc(conflict.conflicting_fields.map(human).join(', '))+'. Independent field changes are preserved.</p>':'')+'<label><span>Resolution</span><select data-recon-choice>'+options([['','Choose a resolution'],['current','Keep current retained version'],['returned','Use returned version'],['base','Use original version'],['edit','Edit a combined version']],model.choice)+'</select></label>'+
      '<div data-recon-editor '+(model.choice==='edit'?'':'hidden')+'><label><span>Start editing from</span><select data-recon-seed>'+options(seeds,model.seed)+'</select></label><div data-recon-edit-fields>'+editor(conflict,model)+'</div></div>'+
      '<div data-recon-resolution '+(model.choice&&model.choice!=='edit'?'':'hidden')+'>'+decisionView(chosenValue(conflict,model))+'</div></div></article>';
  }
  function renderComparison() {
    const target=q('[data-recon-comparison]');if(!target||!active)return;
    const {plan,draft}=active;
    const actor=edits.reviewer;
    const reconcile=plan.mode==='reconcile';
    target.innerHTML='<header class="page-header"><div><h2>'+esc(plan.review.title)+'</h2><p>'+esc(plan.review.purpose)+'</p></div><div class="page-actions">'+button('refresh','Refresh comparison')+
      '<a class="button" href="'+esc(active._original_download.url)+'?download=1" download>Download original response</a></div></header>'+
      '<div class="cards">'+[
        ['Returned by',draft.reviewer.name,date(draft.created_at)],
        ['Current response',plan.current_reviewer?.name??'No previous response',plan.current_created_at?date(plan.current_created_at):''],
        ['Independent changes',plan.automatic_changes.length,'Compatible decisions are combined automatically.'],
        ['Conflicting items',plan.conflicts.length,'Choose the version or edit the combined decision.']
      ].map(([title,value,note])=>'<article class="card"><h3>'+esc(title)+'</h3><strong>'+esc(value)+'</strong><p>'+esc(note)+'</p></article>').join('')+
      '<p data-recon-stale class="notice" hidden>Another response arrived. Refresh the comparison to include its decisions.</p>'+
      (plan.mode==='already-retained'?'<p class="notice">This exact response is already part of the retained review history.</p>':plan.mode==='current'?'<p>This response follows the current review revision. Its original reviewer and decisions will be retained together.</p>':'')+
      '<details><summary>'+plan.automatic_changes.length+' independent changes</summary>'+
      table(['Selected item','Source','Decision'],plan.automatic_changes.map(item=>'<tr><td>'+esc(item.label)+'</td><td>'+esc(item.source==='same-change'?'Both reviewers':item.source==='combined'?'Combined independent fields':item.source==='current'?'Current review':'Returned response')+'</td><td>'+decisionView(item.value)+'</td></tr>'))+'</details>'+
      (plan.conflicts.length?'<div class="review-filters"><label><span>Find a conflicting item</span><input data-recon-search type="search" value="'+esc(search)+'"></label><label class="check"><input data-recon-unresolved type="checkbox" '+(unresolvedOnly?'checked':'')+'>Show unresolved items only</label></div><p data-recon-count aria-live="polite"></p>':'')+
      '<div data-recon-conflicts>'+plan.conflicts.map(conflictCard).join('')+'</div>'+
      (reconcile?'<section class="section"><header class="section-header"><h3>Retain the combined review</h3></header><div class="section-body"><p>Enter the person responsible for this reconciliation. The returned original and earlier reviewers remain in the project history.</p><div class="form-grid">'+
        ['name','role','organization'].map(name=>'<label><span>'+esc(name==='name'?'Reconciled by':human(name))+'</span><input data-recon-actor="'+name+'" value="'+esc(actor[name])+'" maxlength="'+(name==='organization'?500:300)+'" '+(name==='name'?'required':'')+'></label>').join('')+
        '<label><span>Final disposition</span><select data-recon-final-disposition>'+options([['','Use the resolved disposition'],...dispositions],edits.disposition??'')+'</select></label>'+
        '<label class="full"><span>Reconciliation note</span><textarea data-recon-note rows="3" maxlength="20000">'+esc(edits.note??'')+'</textarea></label></div></div></section>':'')+
      '<div class="page-actions">'+button('commit',plan.mode==='already-retained'?'Record receipt':reconcile?'Retain combined response':'Retain returned response','',true)+'</div><p data-recon-result aria-live="polite"></p>';
    updateCount();filterConflicts();setBusy(busy);
  }
  function updateCount() {
    if(!active||!edits)return;
    const remaining=active.plan.conflicts.filter(item=>!edits.choices[item.key]?.choice).length;
    const node=q('[data-recon-count]');
    if(node)node.textContent=remaining+' unresolved of '+active.plan.conflicts.length+' conflicting items';
    const commit=q('[data-recon-action="commit"]');
    if(commit)commit.disabled=busy||stale||remaining>0;
  }
  function filterConflicts() {
    if(!active)return;
    for(const node of qa('[data-recon-conflict]')) {
      const key=node.dataset.reconConflict;
      const conflict=active.plan.conflicts.find(item=>item.key===key);
      const haystack=(conflict?.label+' '+pretty(conflict)).toLowerCase();
      node.hidden=(search&&!haystack.includes(search.toLowerCase()))||(unresolvedOnly&&Boolean(edits.choices[key]?.choice));
    }
  }
  function readEditor(conflict,node) {
    const model=edits.choices[conflict.key],fields=q('[data-recon-edit-fields]',node);
    if(conflict.item_id===null)return q('[data-recon-field="value"]',fields)?.value??'';
    const result=copy(model.value??conflict.returned??conflict.current??conflict.base);
    for(const field of qa('[data-recon-field]',fields))result[field.dataset.reconField]=field.value;
    return result;
  }
  async function openDraft(id) {
    const done=completedDraft(id);
    if(done)return openReceipt(done.operation_id);
    const key=workspace(),generation=epoch,sequence=++previewSequence;
    const current=()=>alive(generation,key)&&sequence===previewSequence;
    setBusy(true,'Opening the returned response…');notice('');
    try {
      const value=await request('/api/review-reconciliation/preview',{method:'POST',body:{draft_id:id}});
      if(!current())return;
      const completed=completedDraft(id);
      if(completed)return openReceipt(completed.operation_id);
      active=value;stale=false;
      const retained=stored(draftKey(id)),same=retained?.plan_id===value.plan.id;
      const priorActor=retained?.reviewer||stored('upstate-response-reconciler:v1:'+project())||{name:'',role:'',organization:''};
      const conflicts=Object.fromEntries(value.plan.conflicts.map(item=>[item.key,pretty(item)]));
      const compatible=Object.fromEntries(value.plan.conflicts.filter(item=>retained?.conflict_versions?.[item.key]===pretty(item)&&retained?.choices?.[item.key]).map(item=>[item.key,copy(retained.choices[item.key])]));
      if(retained&&!same)save(draftKey(id)+':'+retained.plan_id,retained);
      edits=same?retained:{plan_id:value.plan.id,choices:compatible,reviewer:priorActor,disposition:'',note:retained?.note||''};
      edits.conflict_versions=conflicts;
      save(activeKey(),id);save(draftKey(id),edits);
      renderComparison();
      if(retained&&!same)notice('The comparison now includes the current response. Resolutions for unchanged conflicts were kept.');
    } catch(error) {if(current())notice(error.message,true);}
    finally {if(current()){setBusy(false,'');updateCount();}}
  }
  async function readFile(event) {
    file=null;fileValue=null;
    const selected=event.target.files[0],node=q('[data-recon-file-preview]');
    if(!selected){if(node)node.textContent='';return;}
    const generation=epoch,key=workspace();
    try {
      if(selected.size>32*1024*1024)throw Error('Choose a returned-response JSON file of at most 32 MiB.');
      const value=JSON.parse(await selected.text());
      if(!alive(generation,key)||event.target.files[0]!==selected)return;
      if(value.schema!=='upstate.customer-review-response/v1')throw Error('Choose the response exported by a customer review desk.');
      if(value.project_id!==catalogue.project.id)throw Error('This response belongs to another project. Open that project to receive it.');
      const review=catalogue.reviews.find(item=>item.id===value.review_id);
      if(!review)throw Error('The selected review is not retained in this project. Reopen its original review packet.');
      file=selected;fileValue=value;
      node.innerHTML='<h3>'+esc(review.title)+'</h3><p>'+esc(value.reviewer?.name??'')+' · '+esc(date(value.created_at))+'</p><p class="review-source-detail">'+esc(value.summary??'')+'</p><p>'+(value.artifact_decisions?.length??0)+' file decisions · '+(value.requirement_decisions?.length??0)+' requirement decisions</p>';
      notice('');
    } catch(error) {if(alive(generation,key)){if(node)node.textContent='';notice(error.message,true);}}
  }
  function storePending(value,replace=false) {
    const latest=stored(pendingKey(value.workspace));
    if(!replace&&latest&&latest.operation_id!==value.operation_id)return false;
    if(!replace&&pending&&pending.workspace===value.workspace&&pending.operation_id!==value.operation_id)return false;
    pending=value;save(pendingKey(value.workspace),value);return true;
  }
  function clearPending(value) {
    const latest=stored(pendingKey(value.workspace));
    if(latest?.operation_id===value.operation_id)save(pendingKey(value.workspace),null);
    if(pending?.operation_id!==value.operation_id)return;
    pending=null;
    if(latest&&latest.operation_id!==value.operation_id)return;
    const node=q('[data-recon-pending]');if(node)node.replaceChildren();
  }
  async function awaitTask(operation, task, generation) {
    const key=operation.workspace;
    for(;;) {
      if(!alive(generation,key))return null;
      operation={...operation,task_id:task.id};
      if(!storePending(operation))return null;
      const progress=q('[data-recon-progress]');
      if(progress)progress.textContent=task.state==='complete'?'Response task completed.':'Response task '+human(task.state)+'…';
      if(task.state==='complete'){clearPending(operation);return task;}
      if(['failed','interrupted','cancelled'].includes(task.state)) {
        const target=q('[data-recon-pending]');
        if(target)target.innerHTML='<p>'+esc(task.error?.message||'The retained task can be reopened.')+'</p>'+
          button('task','Open retained task','data-task-id="'+esc(task.id)+'"')+
          (task.error?.code!=='REVIEW_HEAD_CHANGED'?button('resume','Resume this task','data-task-id="'+esc(task.id)+'"'):'');
        if(task.error?.code==='REVIEW_HEAD_CHANGED'&&active) {
          stale=true;updateCount();q('[data-recon-stale]')?.removeAttribute('hidden');
        }
        throw Object.assign(new Error(task.error?.message||'Open the retained response task to continue.'),{taskId:task.id,code:task.error?.code});
      }
      await delay(1000);
      if(!alive(generation,key))return null;
      task=await request('/api/task',{body:{id:task.id}});
    }
  }
  async function runTask(action,payload,original=null) {
    const generation=epoch;
    const operation=original??{workspace:workspace(),action,payload,operation_id:crypto.randomUUID()};
    if(!storePending(operation,original===null))return null;
    const task=await host.api('/api/actions',{method:'POST',body:operation});
    return awaitTask(operation,task,generation);
  }
  function closeComparison(operationId) {
    if(active&&edits)saveEdits();
    previewSequence++;active=null;edits=null;stale=false;
    save(activeKey(),null);
    const target=q('[data-recon-comparison]');
    if(target)target.innerHTML='<header class="page-header"><div><h2>Response received</h2><p>The selected response is retained in the original review history. Continue later feedback from Customer reviews.</p></div></header><div class="page-actions">'+button('received','Open receiving record','data-operation-id="'+esc(operationId)+'"')+button('task','Open retained task','data-task-id="'+esc(operationId)+'"')+'</div>';
  }
  async function openReceipt(id) {
    const generation=epoch,key=workspace();
    setBusy(true,'Opening the received response…');notice('');
    closeComparison(id);
    try {return await showDetail(id,{inline:true});}
    finally {if(alive(generation,key))setBusy(false,'');}
  }
  async function afterTask(task,generation,key) {
    if(!task||!alive(generation,key))return;
    const previousPending=stored(pendingKey(key));
    if(previousPending&&previousPending.task_id!==task.id)return;
    const received=task.action==='customer.review.response.reconcile';
    const selected=received&&(!active||active.draft.draft_id===task.result.draft_id);
    if(selected)closeComparison(task.id);
    if(host.refreshState)await host.refreshState({force:true});
    if(!alive(generation,key))return;
    await refreshCatalogue();
    if(!alive(generation,key))return;
    const latest=stored(pendingKey(key));
    if(latest&&latest.task_id!==task.id)return;
    if(task.action==='customer.review.response.stage')await openDraft(task.result.draft_id);
    else {
      if(selected)await openReceipt(task.id);
      notice('The response is retained in the original review history.');
    }
  }
  async function stage() {
    if(busy)return;
    if(!file||!fileValue)throw Error('Choose the complete returned response file first.');
    const generation=epoch,key=workspace(),selected=file,value=fileValue;
    setBusy(true,'Receiving '+selected.name+'…');notice('');
    try {
      const upload=await host.api('/api/upload',{method:'POST',raw:selected,filename:selected.name});
      if(!alive(generation,key))return;
      const task=await runTask('customer.review.response.stage',{review_id:value.review_id,upload_id:upload.id});
      if(alive(generation,key))await afterTask(task,generation,key);
    } finally {if(alive(generation,key)){setBusy(false);updateCount();}}
  }
  function resolutionPayload() {
    const {plan,draft}=active;
    saveEdits();
    const choices={};
    if(plan.mode==='reconcile')for(const conflict of plan.conflicts) {
      const value=edits.choices[conflict.key];
      if(!value?.choice)throw Error('Choose a resolution for '+conflict.label+'.');
      choices[conflict.key]=value.choice==='edit'?{choice:'edit',value:copy(value.value)}:{choice:value.choice};
    }
    if(plan.mode==='reconcile'&&!edits.reviewer.name.trim())throw Error('Enter the person responsible for this reconciliation.');
    return {draft_id:draft.draft_id,review_id:plan.review_id,plan_id:plan.id,
      expected_response_id:plan.expected_response_id,choices,
      reviewer:plan.mode==='reconcile'?edits.reviewer:null,
      ...(edits.disposition?{disposition:edits.disposition}:{}),note:edits.note||''};
  }
  async function commit() {
    if(busy)return;
    if(!active)throw Error('Open a returned response first.');
    if(stale)throw Error('Refresh the comparison to include the current response.');
    const generation=epoch,key=workspace(),payload=resolutionPayload();
    setBusy(true,'Preparing the selected response…');notice('');
    try {
      await request('/api/review-reconciliation/validate',{method:'POST',body:payload});
      if(!alive(generation,key))return;
      const task=await runTask('customer.review.response.reconcile',payload);
      if(alive(generation,key))await afterTask(task,generation,key);
    } catch(error) {
      if(error.code==='REVIEW_HEAD_CHANGED'&&alive(generation,key)) {
        stale=true;q('[data-recon-stale]')?.removeAttribute('hidden');
      }
      throw error;
    } finally {if(alive(generation,key)){setBusy(false);updateCount();}}
  }
  async function showDetail(id,{inline=false}={}) {
    const generation=epoch,key=workspace();
    const value=await request('/api/review-reconciliation/detail',{body:{operation_id:id}});
    if(!alive(generation,key))return;
    const prepared=value.prepared;
    const body='<h3>'+esc(catalogue.reviews.find(x=>x.id===prepared.review_id)?.title||'Response reconciliation')+'</h3>'+
      '<p>'+esc(prepared.candidate.reviewer.name)+' · '+esc(date(prepared.request.created_at))+'</p>'+
      '<p>'+prepared.conflicts.length+' conflicting items resolved · '+prepared.automatic_changes.length+' independent changes retained.</p>'+
      (value.completed?'<p>Received '+esc(date(value.completed.imported_at))+'. The original returned file and selected response remain available below.</p>':'')+
      (prepared.request.note?'<p class="review-source-detail">'+esc(prepared.request.note)+'</p>':'')+
      '<div class="page-actions">'+value._downloads.map(item=>'<a class="button" href="'+esc(item.url)+'?download=1" download>'+esc(item.label||item.filename)+'</a>').join('')+'</div>'+
      '<details><summary>Complete original revisions and selected resolutions</summary><pre class="json-view">'+esc(pretty(prepared))+'</pre></details>';
    if(inline) {
      const target=q('[data-recon-comparison]');
      if(target)target.innerHTML='<header class="page-header"><div><h2>Received response</h2><p>Continue later feedback from the original Customer reviews desk.</p></div><div class="page-actions">'+button('task','Open retained task','data-task-id="'+esc(id)+'"')+'</div></header>'+body;
    } else if(host.detail)host.detail('Response receiving record',body,{kind:'review-reconciliation',id});
    else {const node=q('[data-recon-result]')||q('[data-recon-comparison]');if(node)node.innerHTML=body;}
    return value;
  }
  async function resumePending(operation,resume=false) {
    const key=workspace(),generation=epoch;
    if(operation.workspace!==key)return;
    setBusy(true,'Reopening the retained response task…');notice('');
    try {
      const task=resume
        ?await host.api('/api/task/resume',{method:'POST',body:{id:operation.task_id}})
        :operation.task_id?await request('/api/task',{body:{id:operation.task_id}})
        :await host.api('/api/actions',{method:'POST',body:operation});
      const completed=await awaitTask(operation,task,generation);
      if(alive(generation,key))await afterTask(completed,generation,key);
    } finally {if(alive(generation,key)){setBusy(false);updateCount();}}
  }
  function change(event) {
    const target=event.target;
    if(target.matches('[data-recon-file]')){if(event.type==='change')readFile(event).catch(error=>notice(error.message,true));return;}
    if(target.matches('[data-recon-search]')){search=target.value;filterConflicts();return;}
    if(target.matches('[data-recon-unresolved]')){unresolvedOnly=target.checked;filterConflicts();return;}
    const row=target.closest('[data-recon-conflict]');
    if(row&&active) {
      const conflict=active.plan.conflicts.find(item=>item.key===row.dataset.reconConflict),model=edits.choices[conflict.key];
      if(target.matches('[data-recon-choice]')) {
        model.choice=target.value;
        q('[data-recon-editor]',row).hidden=target.value!=='edit';
        const preview=q('[data-recon-resolution]',row);
        preview.hidden=!target.value||target.value==='edit';preview.innerHTML=decisionView(chosenValue(conflict,model));
      } else if(target.matches('[data-recon-seed]')) {
        const source=target.value==='combined'?conflict.proposed:conflict[target.value];
        if(source==null){target.value=model.seed;notice('Choose a starting version containing this correction, or select its empty version to remove it.');return;}
        model.seed=target.value;model.value=copy(source);
        q('[data-recon-edit-fields]',row).innerHTML=editor(conflict,model);
      } else if(target.matches('[data-recon-field]'))model.value=readEditor(conflict,row);
      saveEdits();filterConflicts();return;
    }
    if(target.matches('[data-recon-actor],[data-recon-final-disposition],[data-recon-note]'))saveEdits();
  }
  async function click(event) {
    const node=event.target.closest('[data-recon-action]');
    if(!node||!root.contains(node))return;
    event.preventDefault();event.stopPropagation();
    const action=node.dataset.reconAction;
    if(busy&&!['detail','task'].includes(action))return;
    try {
      if(action==='stage')await stage();
      if(action==='open')await openDraft(node.dataset.draftId);
      if(action==='refresh'&&active)await openDraft(active.draft.draft_id);
      if(action==='commit')await commit();
      if(action==='received')await openReceipt(node.dataset.operationId);
      if(action==='detail')await showDetail(node.dataset.operationId);
      if(action==='task')await host.showTask(node.dataset.taskId);
      if(action==='resume'&&pending)await resumePending(pending,true);
    } catch(error) {notice(error.message||String(error),true);}
  }
  async function mount(node,nextState) {
    if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',change);}
    root=node;state=nextState;epoch++;active=null;edits=null;busy=false;stale=false;pending=null;file=null;fileValue=null;
    root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',change);
    renderShell();
    const generation=epoch,key=workspace();
    const result=await refreshCatalogue();if(!result||!alive(generation,key))return;
    const id=stored(activeKey());
    if(id&&catalogue.returned_responses.some(x=>x.draft_id===id))await openDraft(id);
    const operation=stored(pendingKey(key));
    if(operation&&alive(generation,key))resumePending(operation).catch(error=>notice(error.message,true));
  }
  function update(nextState) {
    state=nextState;
    if(!root?.isConnected)return;
    const value=state.data?.review_reconciliation;
    if(catalogue&&value){catalogue={...catalogue,...value};renderInbox();}
    const records=state.data?.customer_review_responses;
    if(active&&Array.isArray(records)) {
      const chain=records.filter(x=>x.review_id===active.plan.review_id);
      const predecessors=new Set(chain.map(x=>x.previous_response_id).filter(Boolean));
      const latest=chain.find(x=>!predecessors.has(x.id))?.id??null;
      if(latest!==active.plan.expected_response_id) {
        stale=true;q('[data-recon-stale]')?.removeAttribute('hidden');updateCount();
      }
    }
  }
  function detach() {
    if(active&&edits)saveEdits();
    epoch++;
    if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',change);}
    root=null;busy=false;
  }
  return {mount,update,detach,openDraft};
}
