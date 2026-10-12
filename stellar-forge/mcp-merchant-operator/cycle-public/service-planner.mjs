// MIT. Explicit service periods over the original customer/pass capture catalogue.
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty=value=>JSON.stringify(value,null,2);
const date=value=>{
  const parsed=new Date(value);return Number.isFinite(parsed.getTime())?
    new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'}).format(parsed)+' UTC':'Date unavailable';
};
const status=value=>({RETAINED:'Current',SUPERSEDED:'Superseded',WITHDRAWN:'Withdrawn'}[value]??value);
const stateLabel=value=>({NEXT_CAPTURE_AVAILABLE:'Next period available',FIRST_PERIOD:'First captured period',NO_LATER_CAPTURE:'Choose a later capture',CHOOSE_CAPTURES:'Choose the exact boundary'}[value]??value);
const captureLabel=row=>(row.name||'Service capture')+' · '+date(row.sourceCreatedAt)+' · '+row.id.slice(-8);
const runLabel=row=>(row.name||'Accounting run')+' · '+date(row.completedAt);
const saveFile=(content,name,type)=>{
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
function options(rows,selected,label,empty){
  const missing=selected&&!rows.some(row=>row.id===selected)?'<option value="'+escape(selected)+'" selected>Saved selection unavailable — '+escape(selected.slice(-8))+'</option>':'';
  return '<option value="">'+escape(empty)+'</option>'+missing+rows.map(row=>'<option value="'+escape(row.id)+'"'+
    (row.id===selected?' selected':'')+'>'+escape(label(row))+'</option>').join('');
}
const latestCaptureId=rows=>{
  if(!rows.length)return '';
  const last=rows.at(-1),atEnd=rows.filter(row=>Date.parse(row.sourceCreatedAt)===Date.parse(last.sourceCreatedAt));
  return atEnd.length===1?last.id:'';
};
const utcInput=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString().slice(0,19):'';
const isoInput=value=>value?new Date(value+'Z').toISOString():undefined;
const asChoice=row=>Object.fromEntries(['rowId','runId','usageOpeningId','usageId','replacesId','from','until']
  .filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));

export function createServicePlannerUi({getState,api,notice,showError,clearError,openReview,openCycle,showSetup}){
  const state={scope:null,inventory:null,choices:[],defaultRunId:'',label:'',search:'',filter:'all',page:0,choicePage:0,planPage:0,
    plan:null,busy:false,preparing:false,requestId:crypto.randomUUID(),pending:null,lastCycleKey:null,draftSaved:true,
    history:null,historyPage:0,historyFilter:'own',stale:false};
  const root=$('service-planner-view');
  root.innerHTML='<div class="page-heading"><div><h1 id="service-planner-title">Plan service close</h1><p>Select the next original source period for each customer and purchased pass. Inspect current statements and corrections, then prepare their complete customer reviews.</p></div><button type="button" id="service-refresh">Refresh service history</button></div>'+
    '<section class="panel" aria-labelledby="service-sources-title"><div class="section-heading"><h2 id="service-sources-title">Customers and purchased passes</h2><span id="service-inventory-state" class="muted">Read original service captures to begin.</span></div>'+
    '<div class="service-toolbar"><label>Find customer, pass or order<input id="service-search" type="search" placeholder="Customer, plan or order reference"></label><label>Show<select id="service-filter"><option value="all">All assigned passes</option><option value="ready">Next period available</option><option value="notes">History notes</option><option value="selected">Selected passes</option></select></label>'+
    '<label>Default completed accounting run<select id="service-default-run"><option value="">Choose a completed run</option></select></label></div>'+
    '<p class="hint">Opening and closing capture times define service use. Accounting runs and optional purchase dates select the purchase records that accompany each statement.</p>'+
    '<div id="service-source-rows" class="table-wrap"></div><div class="panel-footer"><div id="service-source-page" class="actions"></div><button type="button" id="service-add-page">Add available periods on this page</button></div>'+
    '<details id="service-source-classifications"><summary>Other captures and unassigned passes</summary><div id="service-other-sources"></div></details></section>'+
    '<section class="panel" aria-labelledby="service-choices-title"><div class="section-heading"><h2 id="service-choices-title">Selected service periods</h2><span id="service-choice-count" class="muted">No periods selected</span></div>'+
    '<label class="wide">Closing cycle name<input id="service-label" maxlength="200" autocomplete="off" placeholder="October service close"></label>'+
    '<div id="service-choices"></div><div id="service-choice-page" class="actions"></div>'+
    '<div class="panel-footer"><div class="actions"><button type="button" id="service-clear">Clear selections</button><button type="button" id="service-import">Open saved plan</button><input id="service-plan-file" type="file" accept=".json,application/json" hidden></div>'+
    '<button type="button" id="service-compile" class="primary">Review selected plan</button></div>'+
    '<p id="service-draft-state" class="hint"></p></section>'+
    '<section id="service-plan-panel" class="panel" aria-labelledby="service-plan-title" hidden><div class="section-heading"><h2 id="service-plan-title">Service close plan</h2><span id="service-plan-count" class="muted"></span></div>'+
    '<div id="service-plan-rows" class="table-wrap"></div><div id="service-plan-page" class="actions"></div>'+
    '<div class="panel-footer"><div class="actions"><button type="button" data-service-export="json">Download plan JSON</button><button type="button" data-service-export="csv">Download CSV register</button><button type="button" data-service-export="html">Download readable plan</button></div>'+
    '<button type="button" id="service-prepare" class="primary">Prepare complete customer reviews</button></div>'+
    '<p class="hint">The saved cycle keeps every original request and full native review. Continue there to issue statements, recover partial work and download customer handovers.</p></section>'+
    '<section id="service-last-cycle" class="panel" hidden><h2>Original preparation</h2><p id="service-pending-note" class="hint"></p><button type="button" id="service-open-cycle">Open saved closing cycle</button></section>'+
    '<dialog id="service-history-dialog" class="service-history-dialog" aria-labelledby="service-history-title"><div class="dialog-heading"><h2 id="service-history-title">Original service history</h2><button id="service-history-close" type="button">Close</button></div>'+
    '<div id="service-history-summary"></div><label>Statement history<select id="service-history-filter"><option value="own">This customer: all statuses</option><option value="current">This customer: current</option><option value="previous">Previous customer</option><option value="unresolved">Source identity needs inspection</option><option value="cumulative">Cumulative snapshots</option></select></label>'+
    '<div id="service-history-rows" class="table-wrap"></div><div id="service-history-page" class="actions"></div><div id="service-history-coverage"></div></dialog>';

  function draftKey(){return 'customer-service-planner:'+getState().context.draftScope;}
  function loadDraft(){
    const scope=getState().context?.draftScope;if(!scope||state.scope===scope)return;
    state.scope=scope;
    try{
      const saved=JSON.parse(localStorage.getItem(draftKey())??'null');
      if(saved&&Array.isArray(saved.choices)&&saved.choices.length<=2000){
        state.choices=saved.choices.filter(row=>row&&typeof row.id==='string'&&typeof row.rowId==='string').map(row=>({...asChoice(row),id:row.id}));
        state.label=typeof saved.label==='string'?saved.label.slice(0,200):'';
        state.defaultRunId=typeof saved.defaultRunId==='string'?saved.defaultRunId:'';
        if(/^[a-f0-9-]{36}$/.test(saved.requestId??''))state.requestId=saved.requestId;
        state.pending=saved.pending??null;state.lastCycleKey=saved.lastCycleKey??null;
      }
    }catch{}
    $('service-label').value=state.label;
  }
  function persist(){
    try{
      localStorage.setItem(draftKey(),JSON.stringify({choices:state.choices,label:state.label,defaultRunId:state.defaultRunId,
        requestId:state.requestId,pending:state.pending,lastCycleKey:state.lastCycleKey}));state.draftSaved=true;
    }catch{state.draftSaved=false;}
    $('service-draft-state').textContent=state.draftSaved?
      'Selections stay in this merchant’s browser draft. Download the plan to keep or transfer its complete source references.':
      'Browser draft storage is unavailable. Download the complete plan before leaving this page.';
    renderLastCycle();
  }
  function changed({keepPlan=false}={}){
    state.requestId=crypto.randomUUID();state.pending=null;if(!keepPlan)state.plan=null;state.planPage=0;
    persist();renderPlan();renderSourceRows();renderCounts();
  }
  function focusAfter(container,markup){
    const active=document.activeElement,focus=container.contains(active)?active.dataset.focus:null;
    container.innerHTML=markup;
    if(focus)container.querySelector('[data-focus="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
  }
  function pager(id,total,page,size,name){
    const pages=Math.max(1,Math.ceil(total/size));
    $(id).innerHTML='<button type="button" data-service-page="'+name+'" data-step="-1"'+(page<=0?' disabled':'')+'>Previous</button>'+
      '<span class="hint">Page '+(page+1)+' of '+pages+' · '+total+' records</span>'+
      '<button type="button" data-service-page="'+name+'" data-step="1"'+(page>=pages-1?' disabled':'')+'>Next</button>';
  }
  function rowFor(choice){return state.inventory?.rows.find(row=>row.id===choice.rowId);}
  function selectedRows(){return new Set(state.choices.map(choice=>choice.rowId));}
  function visibleRows(){
    const query=state.search.trim().toLowerCase(),selected=selectedRows();
    return (state.inventory?.rows??[]).filter(row=>{
      if(query&&![row.customer.name,row.customer.reference,row.pass.orderRef,row.planLabel,row.binding.label].join(' ').toLowerCase().includes(query))return false;
      return state.filter==='ready'?Boolean(row.suggestion.closingId):state.filter==='notes'?row.warnings.length>0:
        state.filter==='selected'?selected.has(row.id):true;
    });
  }
  function pageRows(){return visibleRows().slice(state.page*25,state.page*25+25);}
  function renderSourceRows(){
    const rows=visibleRows();state.page=Math.min(state.page,Math.max(0,Math.ceil(rows.length/25)-1));
    const selected=selectedRows(),page=pageRows();
    $('service-source-rows').innerHTML=page.length?'<table><thead><tr><th>Customer</th><th>Purchased pass</th><th>Period position</th><th>History</th><th>Actions</th></tr></thead><tbody>'+
      page.map(row=>'<tr><td>'+escape(row.customer.name)+'<small>'+escape(row.customer.reference)+'</small></td><td>'+escape(row.planLabel)+
        '<small>Order '+escape(row.pass.orderRef)+'</small><small>'+row.counts.captures+' native captures</small></td><td>'+escape(stateLabel(row.suggestion.state))+
        '<small>'+(row.suggestion.openingId?'Opening '+escape(date(row.captures.find(capture=>capture.id===row.suggestion.openingId)?.sourceCreatedAt)):'Choose the intended opening capture')+
        '</small>'+(row.suggestion.closingId?'<small>Closing '+escape(date(row.captures.find(capture=>capture.id===row.suggestion.closingId)?.sourceCreatedAt))+'</small>':'')+
        '</td><td>'+row.counts.current+' current · '+row.counts.superseded+' superseded · '+row.counts.withdrawn+' withdrawn'+
        (row.warnings.length?'<small>'+row.warnings.length+' history notes</small>':'')+'</td><td><div class="actions"><button type="button" data-service-add="'+escape(row.id)+'">'+
        (selected.has(row.id)?'Add another period':'Add period')+'</button><button type="button" data-service-history="'+escape(row.id)+'">Inspect history</button></div></td></tr>').join('')+
        '</tbody></table>':'<div class="empty">'+(state.inventory?'No assigned passes match this view.':'Refresh service history to read the original captures and statements.')+'</div>';
    pager('service-source-page',rows.length,state.page,25,'sources');
    $('service-add-page').disabled=state.busy||!page.some(row=>row.suggestion.openingId&&row.suggestion.closingId&&!selected.has(row.id));
  }
  function renderOtherSources(){
    const inventory=state.inventory;if(!inventory){$('service-other-sources').textContent='Service sources have not been read.';return;}
    const other=inventory.captures.filter(row=>!row.periodEligible);
    $('service-other-sources').innerHTML='<p>'+inventory.unassigned.length+' native captures belong to unassigned passes. '+other.length+' other captures remain available in the original cumulative statement workflow.</p>'+
      '<button type="button" data-service-setup>Open Customers and service</button>'+
      (inventory.unassigned.length?'<details><summary>Unassigned original captures ('+inventory.unassigned.length+')</summary><pre>'+escape(pretty(inventory.unassigned))+'</pre></details>':'')+
      (other.length?'<details><summary>Other retained capture classifications ('+other.length+')</summary><pre>'+escape(pretty(other.map(row=>({id:row.id,name:row.name,sourceSchema:row.sourceSchema,sourceCreatedAt:row.sourceCreatedAt,unavailableCode:row.unavailableCode}))))+'</pre></details>':'');
  }
  function renderCounts(){
    $('service-choice-count').textContent=state.choices.length+' selected period'+(state.choices.length===1?'':'s');
    $('service-compile').disabled=state.busy||state.preparing||!state.choices.length||!state.inventory;
    $('service-clear').disabled=!state.choices.length||state.preparing;
    for(const control of root.querySelectorAll('#service-label,#service-default-run,#service-choices input,#service-choices select,[data-service-add],[data-service-copy],[data-service-remove],#service-import'))control.disabled=state.preparing;
  }
  function selectedField(choice,name,label,contents){
    return '<label>'+escape(label)+'<select data-choice="'+escape(choice.id)+'" data-field="'+name+'" data-focus="'+escape(choice.id+':'+name)+'">'+contents+'</select></label>';
  }
  function balances(label,capture){
    return capture?'<div><strong>'+label+'</strong><span>'+escape(date(capture.sourceCreatedAt))+'</span><span>Used '+escape(capture.pass.unitsUsed)+
      ' · reserved '+escape(capture.pass.unitsReserved)+' · remaining '+escape(capture.pass.unitsRemaining)+'</span></div>':'<div><strong>'+label+'</strong><span>Select the original capture.</span></div>';
  }
  function renderChoices(){
    state.choicePage=Math.min(state.choicePage,Math.max(0,Math.ceil(state.choices.length/12)-1));
    const page=state.choices.slice(state.choicePage*12,state.choicePage*12+12);
    const markup=page.length?page.map((choice,offset)=>{
      const row=rowFor(choice),number=state.choicePage*12+offset+1;
      if(!row)return '<article class="service-choice"><div class="selection-heading"><h3>'+number+'. Saved pass selection</h3><button type="button" data-service-remove="'+escape(choice.id)+'">Remove</button></div>'+
        '<p>The saved pass is absent from the current catalogue. Its original choice is kept below. Refresh the catalogue to edit it, or open its original saved cycle.</p><details><summary>Saved selections</summary><pre>'+escape(pretty(asChoice(choice)))+'</pre></details></article>';
      const current=row.history.filter(statement=>statement.status==='RETAINED'),opening=row.captures.find(capture=>capture.id===choice.usageOpeningId),
        closing=row.captures.find(capture=>capture.id===choice.usageId);
      return '<article class="service-choice"><div class="selection-heading"><div><h3>'+number+'. '+escape(row.customer.name)+' · '+escape(row.planLabel)+'</h3><p class="hint">'+escape(row.customer.reference)+' · Order '+escape(row.pass.orderRef)+'</p></div>'+
        '<div class="actions"><button type="button" data-service-preview="'+escape(choice.id)+'">Review native statement</button><button type="button" data-service-history="'+escape(row.id)+'">History</button>'+
        '<button type="button" data-service-copy="'+escape(choice.id)+'">Add next period</button><button type="button" data-service-remove="'+escape(choice.id)+'">Remove</button></div></div>'+
        '<div class="form-grid">'+selectedField(choice,'usageOpeningId','Opening native capture',options(row.captures,choice.usageOpeningId,captureLabel,'Choose the exact opening'))+
        selectedField(choice,'usageId','Closing native capture',options(row.captures,choice.usageId,captureLabel,'Choose the exact closing'))+
        selectedField(choice,'runId','Completed accounting run',options(state.inventory.runs,choice.runId,runLabel,'Choose a completed run'))+'</div>'+
        '<div class="service-balances">'+balances('Opening balance',opening)+balances('Closing balance',closing)+'</div>'+
        '<div class="form-grid">'+selectedField(choice,'replacesId','Statement relationship',options(current,choice.replacesId,row=>row.number+' · '+date(row.servicePeriod.from)+' to '+date(row.servicePeriod.until),'New statement'))+
        '<label>Purchase records from (UTC, optional)<input type="datetime-local" step="1" data-choice="'+escape(choice.id)+'" data-field="from" data-focus="'+escape(choice.id+':from')+'" value="'+escape(utcInput(choice.from))+'"></label>'+
        '<label>Purchase records until (UTC, optional)<input type="datetime-local" step="1" data-choice="'+escape(choice.id)+'" data-field="until" data-focus="'+escape(choice.id+':until')+'" value="'+escape(utcInput(choice.until))+'"></label></div>'+
        (row.warnings.length?'<div class="service-notes">'+row.warnings.map(note=>'<p>'+escape(note.message)+'</p>').join('')+'</div>':'')+
        '<details class="source-details"><summary>Original pass and selected capture references</summary><pre>'+escape(pretty({customer:row.customer,binding:row.binding,pass:row.pass,opening,closing}))+'</pre></details></article>';
    }).join(''):'<div class="empty">Add customer pass periods above. Several periods for the same customer or pass can share one closing cycle.</div>';
    focusAfter($('service-choices'),markup);pager('service-choice-page',state.choices.length,state.choicePage,12,'choices');renderCounts();
  }
  function renderPlan(){
    const plan=state.plan;$('service-plan-panel').hidden=!plan;if(!plan)return;
    state.planPage=Math.min(state.planPage,Math.max(0,Math.ceil(plan.rows.length/20)-1));
    $('service-plan-count').textContent=plan.counts.statements+' periods · '+plan.counts.customers+' customers · '+plan.counts.corrections+' corrections · '+plan.counts.withNotes+' rows with notes';
    $('service-plan-rows').innerHTML='<table><thead><tr><th>Customer / pass</th><th>Selected source period</th><th>Statement relationship</th><th>History notes</th></tr></thead><tbody>'+
      plan.rows.slice(state.planPage*20,state.planPage*20+20).map(row=>'<tr><td>'+escape(row.customer.name)+'<small>'+escape(row.customer.reference)+' · '+escape(row.planLabel)+'</small><small>Order '+escape(row.pass.orderRef)+
        '</small></td><td>'+escape(date(row.opening.sourceCreatedAt))+'<br>to '+escape(date(row.closing.sourceCreatedAt))+'</td><td>'+
        escape(row.replaces?'Correct '+row.replaces.number:'New statement')+'</td><td>'+row.warnings.map(note=>'<p>'+escape(note.message)+'</p>').join('')+'</td></tr>').join('')+'</tbody></table>';
    pager('service-plan-page',plan.rows.length,state.planPage,20,'plan');$('service-prepare').disabled=state.preparing;
  }
  function renderLastCycle(){
    const key=state.pending?.key??state.lastCycleKey;$('service-last-cycle').hidden=!key;
    $('service-pending-note').textContent=state.pending?'This preparation keeps its original request identity. Open the saved cycle to see its latest progress or resume its reviews.':'Continue the most recent preparation in Saved cycles.';
  }
  async function refresh(){
    if(state.busy)return;loadDraft();state.busy=true;$('service-refresh').disabled=true;clearError();renderCounts();
    notice('Reading the original customer assignments, complete service capture catalogue and all statement statuses…');
    try{
      state.inventory=await api('/api/service-planner');state.stale=false;
      $('service-inventory-state').textContent=state.inventory.counts.passes+' assigned passes · '+state.inventory.counts.nativeCaptures+' native captures · '+date(state.inventory.observedAt);
      $('service-default-run').innerHTML=options(state.inventory.runs,state.defaultRunId,runLabel,'Choose a completed run');
      renderSourceRows();renderOtherSources();renderChoices();renderPlan();persist();
      notice('Service history refreshed. Each proposed boundary refers to an original capture.');
    }finally{state.busy=false;$('service-refresh').disabled=false;renderSourceRows();renderCounts();}
  }
  function add(row,{openingId,closingId,replaces,runId,from,until}={}){
    if(state.choices.length>=2000)throw new Error('One cycle can contain up to 2,000 selected periods.');
    const choice={id:crypto.randomUUID(),rowId:row.id,runId:runId??state.defaultRunId,
      usageOpeningId:openingId??row.suggestion.openingId??'',usageId:closingId??row.suggestion.closingId??'',replacesId:replaces??null};
    if(from&&until){choice.from=from;choice.until=until;}
    state.choices.push(choice);state.choicePage=Math.floor((state.choices.length-1)/12);changed();renderChoices();return choice;
  }
  async function compile(){
    if(!state.inventory)throw new Error('Refresh the original service catalogue before reviewing these choices.');
    state.plan=await api('/api/service-planner/plan',{inventorySha256:state.inventory.inventorySha256,choices:state.choices.map(asChoice)});
    state.planPage=0;renderPlan();persist();return state.plan;
  }
  async function prepare(){
    if(state.preparing)return;
    const label=state.label.trim();if(!label){$('service-label').focus();throw new Error('Name this closing cycle.');}
    state.preparing=true;renderCounts();renderPlan();clearError();
    try{
      if(state.pending?.requestId===state.requestId){
        try{await api('/api/cycles/'+encodeURIComponent(state.pending.key));await openCycle(state.pending.key);return;}
        catch(error){if(error.status!==404)throw error;}
      }
      const plan=state.plan??await compile(),key='cycle-'+state.requestId;
      state.pending={key,requestId:state.requestId,label,planSha256:plan.planSha256};state.lastCycleKey=key;persist();
      notice('Saving the original cycle request and preparing every complete native customer review…');
      const result=await api('/api/service-planner/cycles',{requestId:state.requestId,label,plan});
      state.lastCycleKey=result.key;persist();await openCycle(result.key);
      notice('The original closing cycle is preparing its complete native customer reviews.');
    }finally{state.preparing=false;renderCounts();renderPlan();}
  }
  function historyRows(){
    const row=state.history;if(!row)return [];
    return state.historyFilter==='current'?row.history.filter(statement=>statement.status==='RETAINED'):
      state.historyFilter==='previous'?row.otherCustomerHistory:state.historyFilter==='unresolved'?row.unresolvedHistory:
      state.historyFilter==='cumulative'?row.cumulativeStatements:row.history;
  }
  function renderHistory(){
    const row=state.history;if(!row)return;
    $('service-history-title').textContent=row.customer.name+' · '+row.planLabel;
    $('service-history-summary').innerHTML='<p>'+escape(row.customer.reference)+' · Order '+escape(row.pass.orderRef)+'</p>'+
      '<p class="hint">Current periods set the continuation boundary. Superseded, withdrawn and previous-customer records retain their original source and correction references.</p>';
    const records=historyRows();state.historyPage=Math.min(state.historyPage,Math.max(0,Math.ceil(records.length/15)-1));
    $('service-history-rows').innerHTML=records.length?'<table><thead><tr><th>Statement</th><th>Status</th><th>Source period</th><th>Relationship</th><th>Actions</th></tr></thead><tbody>'+
      records.slice(state.historyPage*15,state.historyPage*15+15).map(statement=>{
        const period=statement.servicePeriod,current=statement.status==='RETAINED'&&statement.customerId===row.customer.id&&statement.sourceMatches;
        return '<tr><td>'+escape(statement.number)+'<small>'+escape(statement.customerName)+'</small></td><td>'+escape(status(statement.status))+'</td><td>'+
          (period?escape(date(period.from))+'<br>to '+escape(date(period.until)):'Cumulative captured balance')+'</td><td>'+
          (statement.replacesId?'Replaces '+escape(statement.replacesId)+'<br>':'')+(statement.supersededBy?'Replaced by '+escape(statement.supersededBy):'')+
          '</td><td><div class="actions"><a href="/api/setup/statements/'+encodeURIComponent(statement.id)+'/file/statement.html" download>Download original statement</a>'+
          (current?'<button type="button" data-service-correct="'+escape(statement.id)+'">Prepare correction</button>':'')+
          (statement.sourceMatches?'<button type="button" data-service-boundary="'+escape(statement.usageId)+'">Use closing as opening</button>':'')+
          '</div><details><summary>Source references</summary><pre>'+escape(pretty(statement))+'</pre></details></td></tr>';
      }).join('')+'</tbody></table>':'<div class="empty">No statement records in this history view.</div>';
    pager('service-history-page',records.length,state.historyPage,15,'history');
    $('service-history-coverage').innerHTML=(row.warnings.length?'<div class="service-notes">'+row.warnings.map(note=>'<p>'+escape(note.message)+'</p>').join('')+'</div>':'')+
      (row.coverage.gaps.length?'<h3>Uncovered intervals between current statements</h3><ul>'+row.coverage.gaps.map((gap,index)=>'<li>'+escape(date(gap.from))+' to '+escape(date(gap.until))+
        ' <button type="button" data-service-gap="'+index+'">Choose this gap</button></li>').join('')+'</ul>':'')+
      '<details><summary>All original coverage relationships</summary><pre>'+escape(pretty(row.coverage))+'</pre></details>';
  }
  function openHistory(id){
    state.history=state.inventory.rows.find(row=>row.id===id);if(!state.history)return;
    state.historyPage=0;state.historyFilter='own';$('service-history-filter').value='own';renderHistory();
    if(!$('service-history-dialog').open)$('service-history-dialog').showModal();
  }
  function chosen(id){const choice=state.choices.find(row=>row.id===id);if(!choice)throw new Error('Choose a current selected period.');return choice;}
  function nativeSelection(choice){
    const row=rowFor(choice);if(!row)throw new Error('Refresh this pass in the original service catalogue.');
    return {customerId:row.customer.id,runId:choice.runId,usageOpeningId:choice.usageOpeningId,usageId:choice.usageId,
      replacesId:choice.replacesId??null,...(choice.from||choice.until?{from:choice.from,until:choice.until}:{})};
  }
  async function handleClick(event){
    const button=event.target.closest('button');if(!button||!root.contains(button))return;
    const data=button.dataset;
    if(data.serviceAdd){const row=state.inventory.rows.find(row=>row.id===data.serviceAdd);add(row);notice('A source period was added. Choose its exact captures and completed accounting run.');return;}
    if(data.serviceHistory){openHistory(data.serviceHistory);return;}
    if(data.serviceRemove){state.choices=state.choices.filter(row=>row.id!==data.serviceRemove);changed();renderChoices();return;}
    if(data.serviceCopy){
      const choice=chosen(data.serviceCopy),row=rowFor(choice);if(!row)throw new Error('Refresh the original pass before adding its next period.');
      const opening=row.captures.find(capture=>capture.id===choice.usageId),later=opening?row.captures.filter(capture=>Date.parse(capture.sourceCreatedAt)>Date.parse(opening.sourceCreatedAt)):[];
      add(row,{openingId:opening?.id??'',closingId:latestCaptureId(later),runId:choice.runId,from:choice.from,until:choice.until});return;
    }
    if(data.servicePreview){button.disabled=true;try{openReview(await api('/api/preview',{selection:nativeSelection(chosen(data.servicePreview))}));}finally{button.disabled=false;}return;}
    if(data.servicePage){
      const value=Number(data.step);
      if(data.servicePage==='sources'){state.page+=value;renderSourceRows();}
      if(data.servicePage==='choices'){state.choicePage+=value;renderChoices();}
      if(data.servicePage==='plan'){state.planPage+=value;renderPlan();}
      if(data.servicePage==='history'){state.historyPage+=value;renderHistory();}return;
    }
    if(data.serviceExport){
      if(!state.plan)throw new Error('Review the selected service plan first.');
      if(data.serviceExport==='json')saveFile(pretty(state.plan)+'\n','service-close-'+state.plan.planSha256.slice(0,12)+'.json','application/json');
      else{button.disabled=true;try{const file=await api('/api/service-planner/export',{plan:state.plan,format:data.serviceExport});saveFile(file.content,file.filename,file.mimeType);}finally{button.disabled=false;}}return;
    }
    if(data.serviceCorrect){
      const row=state.history,statement=row.history.find(item=>item.id===data.serviceCorrect&&item.status==='RETAINED');
      if(!statement)throw new Error('Refresh the original current statement before preparing a correction.');
      add(row,{openingId:statement.usageOpeningId,closingId:statement.usageId,replaces:statement.id,runId:statement.runId,from:statement.from,until:statement.until});
      $('service-history-dialog').close();notice('The original current period was added as a correction. Review the complete replacement before issuing.');return;
    }
    if(data.serviceBoundary){
      const row=state.history,opening=row.captures.find(capture=>capture.id===data.serviceBoundary),later=row.captures.filter(capture=>Date.parse(capture.sourceCreatedAt)>Date.parse(opening.sourceCreatedAt));
      add(row,{openingId:opening.id,closingId:latestCaptureId(later)});$('service-history-dialog').close();return;
    }
    if(data.serviceGap!==undefined){
      const row=state.history,gap=row.coverage.gaps[Number(data.serviceGap)],following=row.history.find(statement=>statement.id===gap.followingStatementId),
        preceding=row.history.filter(statement=>gap.precedingStatementIds.includes(statement.id)),ids=[...new Set(preceding.map(statement=>statement.usageId))];
      add(row,{openingId:ids.length===1?ids[0]:'',closingId:following?.usageOpeningId??''});$('service-history-dialog').close();
      notice('The uncovered interval was added. Confirm its exact boundary captures and accounting run.');return;
    }
    if('serviceSetup' in data){await showSetup();return;}
  }
  root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||!Object.keys(button.dataset).some(key=>key.startsWith('service')))return;clearError();Promise.resolve(handleClick(event)).catch(showError);});
  $('service-refresh').addEventListener('click',()=>refresh().catch(showError));
  $('service-search').addEventListener('input',event=>{state.search=event.target.value;state.page=0;renderSourceRows();});
  $('service-filter').addEventListener('change',event=>{state.filter=event.target.value;state.page=0;renderSourceRows();});
  $('service-default-run').addEventListener('change',event=>{state.defaultRunId=event.target.value;persist();});
  $('service-label').addEventListener('input',event=>{state.label=event.target.value;changed({keepPlan:true});});
  $('service-add-page').addEventListener('click',()=>{
    try{
      const selected=selectedRows(),rows=pageRows().filter(row=>row.suggestion.openingId&&row.suggestion.closingId&&!selected.has(row.id));
      for(const row of rows)add(row);
      notice(rows.length+' original pass periods were added. Review their captures and completed accounting runs.');
    }catch(error){showError(error);}
  });
  $('service-clear').addEventListener('click',()=>{state.choices=[];state.choicePage=0;changed();renderChoices();});
  $('service-choices').addEventListener('change',event=>{
    const {choice:id,field}=event.target.dataset;if(!id||!field)return;
    try{
      const choice=chosen(id),value=event.target.value;
      if(field==='from'||field==='until'){if(value)choice[field]=isoInput(value);else delete choice[field];}
      else choice[field]=value||(field==='replacesId'?null:'');
      changed();renderChoices();
    }catch(error){showError(error);}
  });
  $('service-compile').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;clearError();
    try{await compile();notice('The selected plan is ready. Its original native customer statements are prepared by the next action.');$('service-plan-title').scrollIntoView({block:'start'});}
    catch(error){showError(error);}finally{renderCounts();}
  });
  $('service-prepare').addEventListener('click',()=>prepare().catch(showError));
  $('service-open-cycle').addEventListener('click',async()=>{
    clearError();const key=state.pending?.key??state.lastCycleKey;
    try{await openCycle(key);}catch(error){showError(error);if(error.status===404)notice('The original request has not reached the work directory. Retry preparation with the same saved selections.');}
  });
  $('service-history-close').addEventListener('click',()=>$('service-history-dialog').close());
  $('service-history-filter').addEventListener('change',event=>{state.historyFilter=event.target.value;state.historyPage=0;renderHistory();});
  $('service-import').addEventListener('click',()=>$('service-plan-file').click());
  $('service-plan-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;clearError();
    try{
      if(file.size>20_000_000)throw new Error('Choose a complete service plan up to 20 MB.');
      const plan=JSON.parse(await file.text());await api('/api/service-planner/validate',{plan});
      state.choices=plan.rows.map(row=>({id:crypto.randomUUID(),rowId:row.rowId,runId:row.selection.runId,
        usageOpeningId:row.selection.usageOpeningId,usageId:row.selection.usageId,replacesId:row.selection.replacesId,
        ...(row.selection.from!==undefined?{from:row.selection.from,until:row.selection.until}:{})}));
      state.requestId=crypto.randomUUID();state.pending=null;state.plan=plan;state.planPage=0;state.choicePage=0;
      state.label=state.label||'Service close';$('service-label').value=state.label;
      persist();renderChoices();renderSourceRows();renderPlan();notice('The complete saved service plan is open. Prepare its original customer reviews, or refresh the catalogue to revise its selections.');
    }catch(error){showError(error);}finally{event.target.value='';}
  });
  return {
    async show(){loadDraft();if(!state.inventory)await refresh();else{renderLastCycle();renderChoices();renderPlan();if(state.stale)notice('Workspace records changed. Refresh service history before choosing the next periods.');}},
    inventoryChanged(){if(state.inventory){state.stale=true;$('service-inventory-state').textContent='Workspace records refreshed elsewhere. Refresh service history for current period positions.';}}
  };
}
