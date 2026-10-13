/** Recipient packages for an exact saved watershed comparison and completed report. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const terminal=state=>['complete','failed','interrupted','cancelled','canceled'].includes(state);
const action='observed.landcover.handover';
const short=value=>String(value??'').slice(0,12);
const storageKey=(workspace,id)=>'upstate.landcover-handover/v1:'+workspace+':'+id;

export function createObservedLandcoverHandover(host){
  const {getState,api,endpoint,openForm,submitAction}=host;
  let root=null,workspace='',comparisonId='',generation=0,readTicket=0,detailTicket=0,events=null;
  const contexts=new Map();
  const selectedWorkspace=()=>getState()?.workspace_key||'';
  function context(w,id){
    const key=w+':'+id;
    if(!contexts.has(key)){
      const value={reportId:'',selectionRevision:0,catalog:null,tasks:new Map(),submitting:false,checking:false,message:'',error:false};
      try{
        const saved=JSON.parse(globalThis.sessionStorage?.getItem(storageKey(w,id))||'null');
        if(validId(saved?.reportId))value.reportId=saved.reportId;
        for(const row of list(saved?.tasks)){
          if(validId(row.id)&&validId(row.reportId))value.tasks.set(row.id,{reportId:row.reportId,state:'unknown'});
        }
      }catch{}
      contexts.set(key,value);
    }
    return contexts.get(key);
  }
  function persist(w,id,c){
    try{globalThis.sessionStorage?.setItem(storageKey(w,id),JSON.stringify({
      reportId:c.reportId,tasks:[...c.tasks].map(([taskId,row])=>({id:taskId,reportId:row.reportId})),
    }));}catch{}
  }
  const current=(w,id,g)=>!!root&&workspace===w&&comparisonId===id&&generation===g&&selectedWorkspace()===w;
  const find=selector=>root?.querySelector(selector);
  function note(c,message,error=false){
    c.message=String(message||'');c.error=error;
    const node=find('[data-lch-note]');
    if(node){node.textContent=c.message;node.setAttribute('role',error?'alert':'status');}
  }
  function tickets(items){
    return list(items).map(row=>{
      if(typeof row.url!=='string'||!/^\/api\/file\/[0-9a-f]{64}$/.test(row.url))
        throw Error('Reopen this retained package to obtain its original authenticated downloads.');
      return '<a href="'+esc(row.url)+'?download=1">'+esc(row.label||row.filename||'Original file')+'</a>';
    }).join('');
  }
  function validateCatalog(value,id){
    if(value?.comparison?.id!==id||!Array.isArray(value.reports)||!Array.isArray(value.handovers))
      throw Error('The recipient catalog does not belong to this saved comparison.');
    const ids=new Set();
    for(const row of value.reports){
      if(!validId(row.id)||ids.has(row.id))throw Error('The completed report catalog repeats or loses an original identity.');
      ids.add(row.id);
    }
    for(const row of value.handovers){
      if(!validId(row.id)||row.comparison_id!==id||row.state!=='complete'||!validId(row.report_id))
        throw Error('The recipient package has another saved comparison identity.');
      tickets(row._downloads);
    }
    return value;
  }
  function render(c){
    if(!root)return;
    const catalog=c.catalog,reports=list(catalog?.reports),handovers=list(catalog?.handovers);
    const active=[...c.tasks].filter(([,row])=>!terminal(row.state));
    const chosen=reports.find(row=>row.id===c.reportId);
    const pending=c.submitting||active.some(([,row])=>row.reportId===c.reportId);
    root.innerHTML='<section class="olc-panel" aria-label="Recipient handover">'+
      '<h3>Recipient package</h3><p>Send this saved comparison with an existing scientific report, its original sources and an editable Study.</p>'+
      '<div data-lch-note role="status" aria-live="polite"></div>'+
      (!catalog?'<p>Reading matching completed reports and retained packages…</p>':
        reports.length?'<div class="olc-toolbar"><label>Completed scientific report<select data-lch-report>'+
          '<option value="">Choose a completed report</option>'+
          (c.reportId&&!chosen?'<option value="'+esc(c.reportId)+'" selected disabled>Previously selected report is unavailable</option>':'')+
          reports.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===c.reportId?' selected':'')+'>'+
            esc(row.title||'Saved scientific report')+' · '+esc(short(row.id))+'</option>').join('')+
          '</select></label><button type="button" data-lch-create'+(!chosen||pending?' disabled':'')+'>Create recipient package</button></div>':
        '<p>No completed scientific report contains this exact saved comparison yet. Use the existing report controls above to compose and save its Scientific Report, then refresh this panel.</p>')+
      '<div class="olc-toolbar"><button type="button" data-lch-refresh>Refresh reports and packages</button></div>'+
      (active.length?'<p>'+esc(active.length)+' accepted package operation'+(active.length===1?' is':'s are')+
        ' retained in Tasks. You may leave this comparison; returning will read the original task.</p>':'')+
      (c.tasks.size?'<details><summary>Original package tasks</summary><ul>'+[...c.tasks].map(([taskId,row])=>
        '<li>Task <code title="'+esc(taskId)+'">'+esc(short(taskId))+'</code> · report '+esc(short(row.reportId))+
        ' · '+esc(row.state)+'. Continue the original task in Tasks.</li>').join('')+'</ul></details>':'')+
      '<div data-lch-detail></div>'+
      '<h4>Retained recipient packages</h4>'+
      (handovers.length?'<ul>'+handovers.map(row=>'<li><strong>'+esc(row.title||'Recipient package')+'</strong>'+
        ' · report '+esc(short(row.report_id))+' <button type="button" data-lch-open="'+esc(row.id)+'">Open package downloads</button>'+
        '<div class="olc-downloads">'+tickets(row._downloads)+'</div></li>').join('')+'</ul>':
        '<p>No recipient package has been retained for this comparison.</p>')+
      '<p>The package uses completed report files. It does not run a model or render a replacement report. Download and extract the complete bundle, then open START_HERE for its reader, files and editable reopening instructions.</p></section>';
    note(c,c.message,c.error);
  }
  async function refresh(){
    if(!root)return false;
    const w=workspace,id=comparisonId,g=generation,ticket=++readTicket,c=context(w,id),prior=c.reportId,selectionRevision=c.selectionRevision;
    note(c,'Reading exact matching completed reports…');
    try{
      const value=validateCatalog(await api(endpoint('/api/observed-landcover/handover-catalog',{workspace:w,id})),id);
      if(!current(w,id,g)||ticket!==readTicket)return false;
      c.catalog=value;
      // Preserve any explicit selector edit made while the catalog was read.
      if(!c.reportId&&c.reportId===prior&&c.selectionRevision===selectionRevision&&value.reports.length)c.reportId=value.reports[0].id;
      persist(w,id,c);
      note(c,value.reports.length?'Choose a completed report, or open a retained package below.':
        'Save a Scientific Report containing this comparison, then refresh.');
      render(c);
      return true;
    }catch(error){
      if(current(w,id,g)&&ticket===readTicket){note(c,error.message||String(error),true);render(c);}
      return false;
    }
  }
  async function openPackage(id){
    if(!root||!validId(id))return;
    const w=workspace,comparison=comparisonId,g=generation,ticket=++detailTicket,c=context(w,comparison);
    note(c,'Verifying the retained package and reading its original downloads…');
    try{
      const value=await api(endpoint('/api/observed-landcover/handover',{workspace:w,id}));
      if(!current(w,comparison,g)||ticket!==detailTicket)return;
      if(value?.id!==id||value.state!=='complete'||value.comparison_id!==comparison||!validId(value.report_id))
        throw Error('The retained package belongs to another saved comparison.');
      const links=tickets(value._downloads);
      const target=find('[data-lch-detail]');
      if(target)target.innerHTML='<section class="olc-panel"><h4>'+esc(value.title||'Recipient package')+
        '</h4><p>Saved comparison '+esc(short(comparison))+' · completed report '+esc(short(value.report_id))+
        '.</p><div class="olc-downloads">'+links+'</div>'+
        '<p>Start with the complete recipient bundle. Extract it before opening START_HERE; the editable Study ZIP retains its original project and source records.</p></section>';
      note(c,'Retained package verified. The links save its original files.');
    }catch(error){if(current(w,comparison,g)&&ticket===detailTicket)note(c,error.message||String(error),true);}
  }
  function matchesTask(task,w,id,reportId){
    return task?.workspace===w&&task.action===action&&task.payload?.comparison_id===id&&task.payload?.report_id===reportId;
  }
  function retainTask(c,w,id,reportId,task){
    if(!validId(task?.id))throw Error('The original queue did not return an accepted task identifier.');
    if(task.workspace!==undefined&&task.workspace!==w)throw Error('The accepted task belongs to another Workspace.');
    if(task.action!==undefined&&task.action!==action)throw Error('The accepted task has another action.');
    if(task.payload!==undefined&&(task.payload.comparison_id!==id||task.payload.report_id!==reportId))
      throw Error('The accepted task changed its comparison or report selection.');
    c.tasks.set(task.id,{reportId,state:'accepted'});persist(w,id,c);
  }
  function create(){
    if(!root)return;
    const w=workspace,id=comparisonId,g=generation,c=context(w,id);
    const report=list(c.catalog?.reports).find(row=>row.id===c.reportId);
    if(!report)throw Error('Choose a completed Scientific Report containing this exact comparison.');
    if(c.submitting||[...c.tasks.values()].some(row=>row.reportId===report.id&&!terminal(row.state)))
      throw Error('Continue the existing accepted package task, or refresh its status.');
    const payload={comparison_id:id,report_id:report.id};
    openForm('Create recipient package',
      'Collect the saved comparison, completed scientific report, original sources and editable Study.',
      '<p><strong>'+esc(c.catalog.comparison.title)+'</strong></p>'+
      '<p>'+esc(list(c.catalog.comparison.huc12s).length)+' original selected watersheds. Completed report: <strong>'+
      esc(report.title||'Saved scientific report')+'</strong>.</p>'+
      '<p>The package includes START_HERE, the offline reader and PDF, complete source downloads and the editable Study ZIP. Existing completed reports and original sources stay unchanged.</p>'+
      '<details><summary>Exact saved selection</summary><pre>'+esc(JSON.stringify(payload,null,2))+'</pre></details>',
      'Create complete recipient package',async()=>{
        if(!current(w,id,g)||c.reportId!==report.id)
          throw Error('Reopen the recipient package form for the current Workspace, comparison and report.');
        if(c.submitting)throw Error('This package request is already being submitted.');
        c.submitting=true;render(c);note(c,'Submitting this exact saved comparison and report to the original task queue…');
        try{
          const result=await submitAction(action,{...payload});
          // An accepted operation remains owned by its original context even
          // when the user leaves while the POST response is in flight.
          retainTask(c,w,id,report.id,result);
          if(current(w,id,g))note(c,'Package task accepted. Follow its original task or return here for completed downloads.');
          return result;
        }finally{
          c.submitting=false;
          if(current(w,id,g))render(c);
        }
      });
  }
  async function update(){
    if(!root)return;
    const w=workspace,id=comparisonId,g=generation,c=context(w,id);
    if(selectedWorkspace()!==w){detach();return;}
    if(c.checking)return;
    const pending=[...c.tasks].filter(([,row])=>!terminal(row.state));
    if(!pending.length)return;
    c.checking=true;
    let completed=false,changed=false;
    try{
      for(const [taskId,tracked] of pending){
        if(!current(w,id,g))break;
        let task=list(getState()?.tasks).find(row=>row.id===taskId&&row.workspace===w);
        // Use the original detail endpoint when state does not carry this task.
        if(!task||terminal(task.state)||!task.payload)task=await api(endpoint('/api/task',{id:taskId}));
        if(!current(w,id,g))break;
        if(!matchesTask(task,w,id,tracked.reportId))
          throw Error('The retained task no longer matches its original comparison and report.');
        const old=tracked.state;
        if(task.state==='complete'){
          if(!validId(task.result?.id)||task.result.comparison_id!==id||task.result.report_id!==tracked.reportId)
            throw Error('The completed package task returned another saved selection.');
          tracked.handoverId=task.result.id;completed=true;
        }else if(terminal(task.state)){
          note(c,'The original package task '+short(taskId)+' is '+task.state+
            '. Open it in Tasks to inspect the actual error and resume the same operation.',true);
        }
        tracked.state=task.state;changed=changed||old!==task.state;
      }
      if(current(w,id,g)){
        if(changed)render(c);
        if(completed)await refresh();
      }
    }catch(error){if(current(w,id,g))note(c,error.message||String(error),true);}
    finally{c.checking=false;}
  }
  function detach(){
    ++generation;++readTicket;++detailTicket;events?.abort();events=null;
    root=null;workspace='';comparisonId='';
  }
  async function mount(container,selection){
    if(!validId(selection?.comparisonId)||typeof selection?.workspace!=='string'||!selection.workspace)
      throw Error('Open an original saved comparison before preparing its recipient package.');
    if(root===container&&workspace===selection.workspace&&comparisonId===selection.comparisonId){
      await refresh();return update();
    }
    detach();root=container;workspace=selection.workspace;comparisonId=selection.comparisonId;
    const w=workspace,id=comparisonId,g=generation,c=context(w,id);
    events=new AbortController();render(c);
    root.addEventListener('change',event=>{
      if(!current(w,id,g)||!event.target.matches?.('[data-lch-report]'))return;
      c.reportId=event.target.value;++c.selectionRevision;++detailTicket;persist(w,id,c);render(c);
    },{signal:events.signal});
    root.addEventListener('click',event=>{
      const target=event.target.closest?.('[data-lch-create],[data-lch-refresh],[data-lch-open]');
      if(!target||!root?.contains(target)||!current(w,id,g))return;
      event.preventDefault();
      Promise.resolve().then(()=>{
        if(!current(w,id,g))return;
        if(target.hasAttribute('data-lch-create'))return create();
        if(target.hasAttribute('data-lch-refresh'))return refresh().then(()=>update());
        return openPackage(target.getAttribute('data-lch-open'));
      }).catch(error=>{if(current(w,id,g))note(c,error.message||String(error),true);});
    },{signal:events.signal});
    await refresh();
    if(current(w,id,g))await update();
  }
  return {mount,update,detach};
}
