const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const stages={profile:'Revised parameter profile',scenario:'Revised land-cover scenario',prepare:'Prepared revised run',compare:'Original comparison'};
const settled=new Set(['complete','failed','cancelled','interrupted','not_submitted','unavailable','rejected']);
const nativeModels=value=>Array.isArray(value?.models)?value.models:['ndr','sdr'];
const short=value=>String(value||'').slice(0,12);
export function revisionFormRequest(review,step,workspace){
  if(!review||typeof review.id!=='string'||!stages[step]||typeof review.selection_sha256!=='string')
    throw Error('Open a retained revision and its current input selection.');
  const request={workspace_key:workspace,revision_id:review.id,step,expected_selection_sha256:review.selection_sha256};
  if(step==='profile')request.record_id=review.selection.profile_id;
  if(step==='scenario')request.record_id=review.selection.scenario_id;
  if(step==='prepare')request.selection=copy(review.selection);
  if(step==='compare'){
    if(!review.revised_run_id)throw Error('Prepare and complete the revised run first.');
    request.selection={baseline_run_id:review.baseline_run_id,run_ids:[review.revised_run_id]};
  }
  return request;
}
export function attachRunRevisions(host){
  const {api,endpoint,getState,getWorkspace,openItem,showTask,openDesk,openRunRevisionForm,toast}=host;
  let root=null,workspace=null,epoch=0,intent=0,busy=false,error='',notice='',review=null,rows=[],signature='',loading=false;
  let baselineDraft='',titleDraft='';
  const remembered=new Map();
  const current=()=>getWorkspace?.()||getState()?.workspace_key;
  const mark=()=>({root,workspace,epoch,intent});
  const mounted=m=>root===m.root&&root?.isConnected&&workspace===m.workspace&&current()===m.workspace&&epoch===m.epoch;
  const valid=m=>mounted(m)&&intent===m.intent;
  const url=(operation,query={})=>endpoint('/api/run-revisions/'+operation,query);
  const unwrap=result=>result?.review||result;
  const data=()=>getState()?.data||{};
  const find=(kind,id)=>(data()[kind]||[]).find(row=>row.id===id);
  const name=(kind,id)=>{const row=find(kind,id);return row?.title||row?.spec?.title||short(id);};
  const runName=id=>{const row=find('runs',id);return row?name('scenarios',row.selection.scenario_id)+' · '+name('profiles',row.selection.profile_id):short(id);};
  const button=(action,label,attrs='',disabled=false)=>'<button type="button" data-revision-action="'+action+'" '+attrs+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
  const item=(kind,id,label)=>id?button('item',label,'data-kind="'+esc(kind)+'" data-id="'+esc(id)+'"'):'';
  const pending=()=>Boolean(review?.operations?.some(op=>!settled.has(op.state)&&op.state!=='superseded'));
  function remember(){if(workspace&&review?.id){remembered.set(workspace,review.id);try{sessionStorage.setItem('upstate-run-revision:'+workspace,review.id);}catch{}}}
  function savedId(){try{return remembered.get(workspace)||sessionStorage.getItem('upstate-run-revision:'+workspace)||'';}catch{return remembered.get(workspace)||'';}}
  function receive(result){const row=unwrap(result);if(!row||typeof row.id!=='string')throw Error('The revision response is incomplete.');review=row;remember();}
  async function request(operation,body,query={}){
    const m=mark(),result=await api(url(operation,query),body===undefined?undefined:{method:'POST',body});
    if(!valid(m))return null;
    if(result?.workspace_key&&result.workspace_key!==workspace)throw Error('The revision belongs to another Workspace.');
    return result;
  }
  async function reload({selected=true}={}){
    if(loading)return;
    loading=true;const m=mark();
    try{
      const result=await request('catalog');
      if(!result||!valid(m))return;
      rows=result.reviews||[];
      const id=selected?(review?.id||savedId()):'';
      if(id&&rows.some(row=>row.id===id)){
        const loaded=await request('review',undefined,{id});
        if(loaded&&valid(m))receive(loaded);
      }
      if(valid(m))render();
    }catch(e){if(valid(m)){error=e.message||String(e);render();}}
    finally{if(mounted(m))loading=false;}
  }
  function pairReady(){const original=review?.records?.baseline||find('runs',review?.baseline_run_id),revised=review?.records?.run||find('runs',review?.revised_run_id);return original?.state==='complete'&&revised?.state==='complete'&&original.id!==revised.id;}
  function orderedPatches(){
    const row=review?.records?.scenario||find('scenarios',review?.selection?.scenario_id);
    if(!row)return '';
    const patches=row.patches||[];
    return '<details class="revision-details"><summary>Current ordered land-cover changes · '+patches.length+'</summary>'+
      (patches.length?'<ol>'+patches.map(p=>'<li><strong>'+esc(p.mask_source_id)+'</strong><p>Codes '+esc((p.from_codes||[]).join(', '))+' → '+esc(p.to_code)+'</p><p>'+esc(p.reason)+'</p>'+
        (p.layer?'<p>Layer: '+esc(p.layer)+'</p>':'')+(p.where?'<pre>'+esc(JSON.stringify(p.where,null,2))+'</pre>':'')+'</li>').join('')+'</ol>':'<p>This saved scenario keeps the original land cover unchanged.</p>')+
      '<p>Changes are applied in this saved order. A later patch sees the land cover produced by earlier patches; only its configured from-codes are changed.</p></details>';
  }
  function revisionPanel(){
    if(!review)return '<section class="revision-card"><h2>Keep a completed run as the reference</h2><p>Create a revision below, or reopen an existing revision. Saved profiles, scenarios and runs retain their original identities.</p></section>';
    const selection=review.selection||{},run=find('runs',review.revised_run_id)||review.records?.run;
    const locked=busy||pending(),ready=pairReady();
    return '<section class="revision-card"><div class="revision-heading"><div><h2>'+esc(review.title)+'</h2><p class="revision-id">'+esc(review.id)+'</p></div>'+button('reload','Refresh saved results','',busy)+'</div>'+
      '<div class="revision-reference"><h3>Original reference</h3><p>'+esc(runName(review.baseline_run_id))+'</p><p class="revision-id">'+esc(review.baseline_run_id)+'</p>'+
      '<p>Prepared grid '+esc(name('grids',selection.grid_id))+' · '+esc(nativeModels(selection).map(x=>x.toUpperCase()).join(' + '))+'</p>'+
      item('runs',review.baseline_run_id,'Open original run')+'</div>'+
      '<div class="revision-steps"><section><h3>1. Revise saved inputs</h3><p>Save a new parameter profile, a new ordered land-cover scenario, or both. The reference run keeps its original inputs.</p>'+
      '<dl><dt>Parameter profile</dt><dd>'+esc(name('profiles',selection.profile_id))+'<small>'+esc(selection.profile_id)+'</small></dd><dt>Land-cover scenario</dt><dd>'+esc(name('scenarios',selection.scenario_id))+'<small>'+esc(selection.scenario_id)+'</small></dd></dl>'+
      '<div class="revision-actions">'+button('profile','Revise parameter profile','',locked)+button('scenario','Revise land-cover scenario','',locked)+item('profiles',selection.profile_id,'Inspect saved parameters')+item('scenarios',selection.scenario_id,'Inspect saved scenario')+'</div>'+orderedPatches()+'</section>'+
      '<section><h3>2. Prepare and run the revised selection</h3><p>The original grid and model cohort stay fixed for this comparison. Preparation checks the selected original inputs and creates the actual run identity.</p>'+
      button('prepare','Prepare revised run','',locked)+
      (review.revised_run_id?'<p><strong>'+esc(run?.state||'Saved run')+'</strong> · '+esc(runName(review.revised_run_id))+'</p><p class="revision-id">'+esc(review.revised_run_id)+'</p>'+item('runs',review.revised_run_id,run?.state==='complete'?'Open completed revised run':'Inspect inputs and start native models'):'<p class="revision-muted">No revised run has been prepared for these inputs.</p>')+
      '<p>The original run controls preview the changed cells, start or resume the native models, and retain their actual arguments and logs.</p></section>'+
      '<section><h3>3. Compare the actual results</h3><p>The reference remains first and the revised run remains the alternative. Input changes and annual model quantities keep their original support and units.</p>'+
      '<div class="revision-actions">'+button('compare','Compare reference and revised run','',locked||!ready)+button('inputs','Review actual input changes','',busy||!ready)+button('quantities','Review native quantities','',busy||!ready)+
      (review.comparison_id?item('comparisons',review.comparison_id,'Open saved comparison and delivery'):'')+'</div>'+
      (!ready?'<p class="revision-muted">Complete both retained runs to compare their outputs.</p>':'')+'</section></div>'+
      '<h3>Retained operations</h3>'+operations()+
      '<div class="revision-actions">'+button('export','Download revision JSON','',busy)+button('backup','Back up complete Workspace','',busy)+'</div>'+
      '<p class="revision-muted">Revision JSON reopens these exact choices in the original or restored Workspace. It does not contain the model rasters. Use the complete Workspace backup or the existing GIS and delivery exports for the full handoff.</p></section>';
  }
  function operations(){
    if(!review.operations?.length)return '<p>No revised input has been submitted.</p>';
    return '<div class="revision-scroll"><table><thead><tr><th>Operation</th><th>State</th><th>Original task / saved result</th></tr></thead><tbody>'+review.operations.map(op=>'<tr><td>'+esc(stages[op.step]||op.action)+'</td><td>'+esc(op.state)+(op.error?'<p>'+esc(typeof op.error==='string'?op.error:op.error.message)+'</p>':'')+'</td><td>'+
      (op.task_id&&op.task_available?button('task','Open retained operation','data-id="'+esc(op.task_id)+'"'):'<span>'+esc(op.task_id?'Original task retained; queue unavailable here':'No accepted native task')+'</span>')+
      (op.result_id?'<small class="revision-id">'+esc(op.result_id)+'</small>':'')+(op.accepted_task||op.source_accepted_task?'<details class="revision-details"><summary>Original accepted request and result</summary><pre>'+esc(JSON.stringify(op.accepted_task||op.source_accepted_task,null,2))+'</pre></details>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function render(){
    if(!root||current()!==workspace)return;
    const focus=root.contains(document.activeElement)?document.activeElement?.id:'';
    const completed=(data().runs||[]).filter(row=>row.state==='complete');
    root.innerHTML='<div class="run-revision-desk"><header><h1>Revise and compare a run</h1><p>Edit saved assumptions, prepare the actual revised run and compare it with its original reference.</p></header>'+
      '<div class="revision-status" role="status">'+esc(notice)+'</div>'+(error?'<div class="revision-error" role="alert">'+esc(error)+'</div>':'')+revisionPanel()+
      '<section class="revision-card"><h2>Create another revision</h2><label>Completed reference run<select id="revision-baseline" '+(busy?'disabled':'')+'><option value="">Choose a completed run…</option>'+completed.map(row=>'<option value="'+esc(row.id)+'" '+(row.id===baselineDraft?'selected':'')+'>'+esc(runName(row.id))+' · '+esc(short(row.id))+'</option>').join('')+'</select></label>'+
      '<label>Revision title<input id="revision-title" maxlength="240" value="'+esc(titleDraft)+'" placeholder="Describe the input change to review" '+(busy?'disabled':'')+'></label>'+button('create','Create retained revision','',busy||!completed.length)+'</section>'+
      '<section class="revision-card"><h2>Saved revisions</h2>'+(rows.length?'<div class="revision-list">'+rows.map(row=>'<div><strong>'+esc(row.title)+'</strong><small>'+esc(runName(row.baseline_run_id))+'</small>'+button('open','Open revision','data-id="'+esc(row.id)+'"',busy)+'</div>').join('')+'</div>':'<p>No revision has been saved in this Workspace.</p>')+
      '<label>Reopen exported revision JSON<input id="revision-import" type="file" accept=".json,application/json" '+(busy?'disabled':'')+'></label><p class="revision-muted">Every referenced saved record is checked before adopting the imported selection. Importing does not start a model.</p></section></div>';
    if(focus){const node=root.querySelector('#'+focus);node?.focus();}
  }
  async function action(kind,node){
    if(busy)return;
    error='';notice='';intent++;const m=mark();
    if(kind==='item'){host.closeDetail?.();return openItem(node.dataset.kind,node.dataset.id);}
    if(kind==='task')return showTask(node.dataset.id);
    if(kind==='profile'||kind==='scenario'||kind==='prepare'||kind==='compare'){
      const request=revisionFormRequest(review,kind,workspace);
      host.closeDetail?.();
      return openRunRevisionForm({...request,isCurrent:()=>valid(m)});
    }
    if(kind==='inputs')return openDesk('scenario-inputs','openPair',review.baseline_run_id,review.revised_run_id);
    if(kind==='quantities')return openDesk('native-process-reports','createForRuns',{workspace_key:workspace,run_ids:[review.baseline_run_id,review.revised_run_id],models:nativeModels(review.selection),title:review.title+' · reference and revision'});
    busy=true;render();
    try{
      if(kind==='create'){
        if(!baselineDraft||!titleDraft.trim())throw Error('Choose the completed reference run and enter a revision title.');
        const result=await request('create',{baseline_run_id:baselineDraft,title:titleDraft.trim(),operation_id:crypto.randomUUID()});
        if(result){receive(result);notice='Revision retained. The reference run remains unchanged.';}
      }else if(kind==='open'){
        const result=await request('review',undefined,{id:node.dataset.id});if(result)receive(result);
      }else if(kind==='reload'){
        const result=await request('capture',{id:review.id});if(result)receive(result);
      }else if(kind==='export'||kind==='backup'){
        const captured=await request('capture',{id:review.id});if(!captured)return;
        receive(captured);
        if(kind==='backup'){busy=false;return host.openBackup();}
        const result=await request('export',undefined,{id:review.id});if(!result)return;
        download(JSON.stringify(result.export||result.review||result,null,2)+'\n',review.id+'.json','application/json');
        notice='Downloaded the checked revision choices. Use a complete Workspace backup to retain all original inputs and outputs.';
      }
      if(valid(m)){const result=await request('catalog');if(result)rows=result.reviews||rows;}
    }finally{if(mounted(m)){busy=false;render();}}
  }
  function download(body,name,type){
    const blob=new Blob([body],{type}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  async function importFile(file){
    if(!file||busy)return;
    if(file.size>8*1024*1024)throw Error('Choose a revision JSON smaller than 8 MiB. Complete model archives belong in Workspace restore.');
    const m=mark();busy=true;render();
    try{
      const body=await file.text();if(!valid(m))return;
      let value;try{value=JSON.parse(body);}catch{throw Error('Choose the complete exported revision JSON.');}
      const result=await request('import',{review:value});
      if(result){receive(result);notice='Reopened the exact retained revision. No model was submitted.';const list=await request('catalog');if(list)rows=list.reviews||rows;}
    }finally{if(valid(m)){busy=false;render();}}
  }
  function fail(e){error=e.message||String(e);busy=false;render();toast?.(error);}
  function click(event){const node=event.target.closest('[data-revision-action]');if(node&&root?.contains(node)){event.preventDefault();const m=mark();action(node.dataset.revisionAction,node).catch(e=>{if(mounted(m))fail(e);});}}
  function change(event){
    if(event.target.id==='revision-baseline')baselineDraft=event.target.value;
    if(event.target.id==='revision-import'){const m=mark();importFile(event.target.files?.[0]).catch(e=>{if(mounted(m))fail(e);});}
  }
  function input(event){if(event.target.id==='revision-title')titleDraft=event.target.value;}
  async function mount(container){detach();root=container;workspace=current();root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);render();await reload();}
  function detach(){if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);}epoch++;intent++;root=null;workspace=null;review=null;rows=[];busy=false;loading=false;error='';notice='';signature='';baselineDraft='';titleDraft='';}
  function update(){
    if(!root)return;
    if(current()!==workspace){detach();return;}
    const next=JSON.stringify({tasks:(getState()?.tasks||[]).map(t=>[t.id,t.state]),runs:(data().runs||[]).map(r=>[r.id,r.state]),profiles:(data().profiles||[]).map(r=>r.id),scenarios:(data().scenarios||[]).map(r=>r.id)});
    if(signature!==next){signature=next;if(!busy)void reload();}
  }
  async function openForRun(value){
    if(!root||current()!==workspace)throw Error('Open the revision desk in the original Workspace first.');
    if(value?.workspace_key!==undefined&&value.workspace_key!==workspace)throw Error('Choose the run in its original Workspace.');
    const id=typeof value==='string'?value:value?.run_id;
    if(find('runs',id)?.state!=='complete')throw Error('Choose a completed original run.');
    intent++;baselineDraft=id;titleDraft='Revision of '+runName(id);error='';notice='Choose a title and create the revision to keep this completed run as its reference.';render();
    root.querySelector('#revision-title')?.focus();
  }
  async function openSaved(value){
    const id=typeof value==='string'?value:value?.id;
    if(!root||current()!==workspace)throw Error('Open the revision desk first.');
    if(value?.workspace_key&&value.workspace_key!==workspace)throw Error('Open the original Workspace first.');
    intent++;const result=await request('review',undefined,{id});if(result){receive(result);render();}
  }
  function taskActions(task){
    if(task.workspace!==current()||!Array.isArray(task._run_revisions))return '';
    return '<div class="page-actions">'+task._run_revisions.map(row=>
      '<button type="button" data-action="runrevision-open-saved" data-id="'+esc(row.id)+'" data-workspace="'+esc(task.workspace)+'">Return to revision: '+esc(row.title)+'</button>').join('')+'</div>';
  }
  async function dispatch(node){
    if(node.dataset.action!=='runrevision-open-saved')return false;
    if(node.dataset.workspace!==current())throw Error('Open this task in its original Workspace before its revision.');
    host.closeDetail?.();
    await openDesk('run-revisions','openSaved',{workspace_key:current(),id:node.dataset.id});
    return true;
  }
  return {mount,update,detach,openForRun,openSaved,taskActions,dispatch};
}
