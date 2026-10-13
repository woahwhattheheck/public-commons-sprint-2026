/* Retained Monitoring decisions in the original scientific delivery workflow. */
const clone=value=>JSON.parse(JSON.stringify(value));
const terminal=new Set(['complete','failed','cancelled']);
const memory=new Map();
const readSaved=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return memory.get(key)||null;}};
const saveSaved=(key,value)=>{memory.set(key,clone(value));try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}};
const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function attachMonitoringReport(node, context, workspaceKey) {
  const {getState,api,openDelivery,showTask,toast}=context;
  const host=node.shadowRoot.querySelector('[data-export="bundle"]')?.closest('details');
  if(!host)throw Error('The current Monitoring report controls are missing.');
  const section=document.createElement('section');
  section.className='monitoring-scientific-report';
  section.innerHTML=`
    <h4>Use this Monitoring work in the scientific report</h4>
    <p class="small">Retain an exact saved design, campaign revision or budget comparison with its original scientific sources. Add that retained source to the existing scientific report.</p>
    <div class="row"><label>Report scope<select data-report-scope><option value="programme">Current saved plan or campaign</option><option value="comparison">Saved budget comparison</option></select></label>
    <label data-report-comparison-field hidden>Saved budget comparison<select data-report-comparison><option value="">Choose a saved comparison</option></select></label></div>
    <button type="button" data-report-comparisons-refresh hidden>Refresh saved comparisons</button>
    <p data-report-selection class="small"></p>
    <div class="row"><label>Report source title<input data-report-title required maxlength="300"></label>
    <label>Scientific delivery<select data-report-delivery><option value="">New report selection</option></select></label></div>
    <div class="row"><button type="button" data-report-prepare>Prepare scientific report source</button>
    <button type="button" data-report-task hidden>Open saved operation</button>
    <button type="button" data-report-retry hidden>Resume original request</button>
    <button type="button" data-report-open hidden>Open prepared report form</button></div>
    <p data-report-status class="small" role="status" aria-live="polite"></p>\n    <p data-report-prepared class="small"></p>
    <div class="row"><label>Saved monitoring report sources<select data-report-saved><option value="">Choose a retained report source</option></select></label>
    <button type="button" data-report-refresh>Refresh saved sources</button>
    <button type="button" data-report-reopen>Open saved report source</button></div>
    <div data-report-downloads class="downloads"></div>`;
  host.append(section);
  const find=name=>section.querySelector('[data-report-'+name+']');
  const storageKey='eco-monitoring-scientific-report:'+workspaceKey;
  const saved=readSaved(storageKey)||{};
  let operation=saved.operation||null, prepared=saved.prepared||null;
  let chosenDelivery=saved.delivery_id||'', selectedSaved=saved.saved_id||'';
  let reportScope=saved.scope==='comparison'?'comparison':'programme',chosenComparison=saved.comparison_id||'',comparison=null;
  const titleDrafts=saved.title_drafts&&typeof saved.title_drafts==='object'&&!Array.isArray(saved.title_drafts)?saved.title_drafts:{};
  let comparisonReading=false,comparisonSequence=0,comparisonCatalogSequence=0,comparisonNeedsRefresh=false;
  find('scope').value=reportScope;
  let generation=0, detached=false, reading=false, submitting=false, requestSequence=0;
  let selectionKey='', sourceRows=[], lastTaskState=operation?.handled_complete_id===operation?.task_id&&operation?.task_id?operation.task_id+':complete':'', lastDeliveryList='';
  const current=()=>!detached&&node.isConnected&&getState()?.workspace_key===workspaceKey;
  const status=(text,error=false)=>{find('status').textContent=text;find('status').dataset.error=String(error);};
  function persist(){saveSaved(storageKey,{operation,prepared,delivery_id:chosenDelivery,saved_id:selectedSaved,scope:reportScope,comparison_id:chosenComparison,title_drafts:titleDrafts});}
  function choice(){
    if(reportScope==='comparison')return comparison&&!comparisonReading&&comparison.id===chosenComparison?{comparison_id:comparison.id}:null;
    const plan=node.plan;
    if(!plan||!['optimal','feasible'].includes(plan.status))return null;
    const campaign=node.campaign&&node.campaign.plan?.id===plan.id?node.campaign:null;
    return campaign
      ? {campaign_id:campaign.revision.campaign_id,expected_revision_id:campaign.revision.id}
      : {plan_id:plan.id};
  }
  function title(){
    if(reportScope==='comparison')return comparison?.title||'Monitoring budget choices';
    return (node.campaign&&node.campaign.plan?.id===node.plan?.id?node.campaign.revision.title:node.plan?.title)||'Monitoring programme';
  }
  function fail(error){status(error?.message||String(error),true);toast?.(error?.message||String(error));}
  function selectionIdentity(){const value=choice();return value?JSON.stringify(value):'';}
  function renderSelection(){
    const selected=choice(), next=selected?JSON.stringify(selected):'';
    if(next!==selectionKey){
      if(selectionKey)titleDrafts[selectionKey]=find('title').value;
      selectionKey=next;
      if(next)find('title').value=Object.prototype.hasOwnProperty.call(titleDrafts,next)?titleDrafts[next]:title()+(reportScope==='comparison'?' — budget comparison':' — monitoring programme');
      persist();
    }
    find('comparison-field').hidden=reportScope!=='comparison';
    find('comparisons-refresh').hidden=reportScope!=='comparison';
    find('comparison').disabled=comparisonReading;
    find('comparison').value=chosenComparison;
    const campaign=selected?.campaign_id;
    const baseline=comparison?.rows?.find(row=>row.plan_id===comparison.baseline_plan_id);
    find('selection').textContent=reportScope==='comparison'
      ? comparisonReading?'Reading the original saved comparison…'
        : selected?(comparison.title+' · '+comparison.plan_ids.length+' original plans · baseline '+(baseline?.title||'original selected plan'))
        :'Choose an exact saved budget comparison to prepare its scientific report source.'
      : selected
        ? campaign?'Current saved campaign revision '+node.campaign.revision.revision+' · '+campaign
          :'Saved '+node.plan.status+' design · '+node.plan.id
        :'Open a feasible saved design or a campaign to prepare its report source.';
    find('prepare').disabled=!selected||submitting||(operation&&!terminal.has(operation.state)&&!!operation.task_id);
    find('task').hidden=!operation?.task_id;
    find('retry').hidden=!operation||!!operation.task_id||submitting;
    find('open').hidden=!prepared?.source||!prepared?.delivery_selection;
    const retained=prepared?.selection||{};
    find('prepared').textContent=prepared?.source
      ? 'Prepared source: '+(prepared.title||prepared.id)+(retained.campaign_id?' · campaign '+retained.campaign_id+' · exact revision '+retained.expected_revision_id:retained.plan_id?' · saved design '+retained.plan_id:retained.comparison_id?' · saved budget comparison':'')
      : '';
    find('reopen').disabled=!selectedSaved||reading;
    const rows=getState()?.data?.deliveries||[];
    const signature=JSON.stringify(rows.map(row=>[row.id,row.title]));
    if(signature!==lastDeliveryList){
      lastDeliveryList=signature;
      const select=find('delivery');
      select.replaceChildren(new Option('New report selection',''));
      for(const row of rows)if(validId(row.id))select.add(new Option(row.title||row.id,row.id));
      if(chosenDelivery&&![...select.options].some(option=>option.value===chosenDelivery))
        select.add(new Option('Previously selected delivery · '+chosenDelivery,chosenDelivery));
      select.value=chosenDelivery;
    }
  }
  function showFiles(downloads){
    const target=find('downloads');target.replaceChildren();
    for(const file of downloads||[]){
      if(!file?.id)continue;
      const link=document.createElement('a');
      link.href='/api/file/'+encodeURIComponent(file.id)+'?download=1';
      link.textContent=file.label||file.filename||file.name||'Download retained report source';
      target.append(link,document.createTextNode(' '));
    }
  }
  function acceptTask(task){
    if(!operation||task?.id!==operation.task_id)return;
    operation.state=task.state;
    const identity=task.id+':'+task.state;
    if(task.state==='complete'){
      if(!task.result?.source||!task.result?.delivery_selection)
        throw Error('The completed report operation has no retained source selection.');
      if(identity!==lastTaskState){
        prepared=clone(task.result);
        operation.handled_complete_id=task.id;
        status('Scientific report source retained. Open the prepared report form to review its native runs and delivery settings.');
        showFiles(task._downloads);
        void refreshSources(false);
      }
    }else if(task.state==='failed'||task.state==='cancelled'){
      if(identity!==lastTaskState)status(task.error?.message||'The original operation is '+task.state+'. Open that saved operation for its result and continuation.',true);
    }else if(identity!==lastTaskState)status('Original report operation '+task.state+'.');
    lastTaskState=identity;persist();renderSelection();
  }
  async function readTask(){
    if(!operation?.task_id||reading||!current())return;
    const key=operation.task_id, ticket=++requestSequence, version=generation;
    reading=true;
    try{
      const task=await api('/api/task?'+new URLSearchParams({workspace:workspaceKey,id:key}));
      if(current()&&version===generation&&ticket===requestSequence&&operation?.task_id===key)acceptTask(task);
    }catch(error){if(current()&&version===generation)fail(error);}
    finally{reading=false;if(current())renderSelection();}
  }
  async function submitOriginal(){
    if(!operation||submitting||!current())return;
    if(operation.task_id){await readTask();return;}
    const original=clone(operation), version=generation;
    submitting=true;status('Retaining this exact programme selection in the original operator queue.');renderSelection();
    try{
      const task=await api('/api/actions',{method:'POST',body:{
        workspace:workspaceKey,action:'monitoring.report.prepare',
        payload:original.payload,operation_id:original.operation_id
      }});
      if(operation?.operation_id!==original.operation_id)return;
      operation.task_id=task.id;operation.state=task.state;persist();
      if(current()&&version===generation)acceptTask(task);
    }catch(error){
      if(current()&&version===generation)fail(error);
    }finally{submitting=false;if(current())renderSelection();}
  }
  async function prepare(){
    if(submitting||!current())return;
    const selected=choice();if(!selected)throw Error(reportScope==='comparison'?'Choose and open an actual saved budget comparison.':'Open an actual feasible saved design or campaign.');
    const heading=find('title').value.trim();if(!heading)throw Error('Provide the report source title.');
    if(heading.length>300)throw Error('Use a title of at most 300 characters.');
    const payload={...selected,title:heading,...(chosenDelivery?{delivery_id:chosenDelivery}:{})};
    const signature=JSON.stringify(payload);
    if(operation&&JSON.stringify(operation.payload)===signature&&!terminal.has(operation.state)){
      await submitOriginal();return;
    }
    if(operation&&!terminal.has(operation.state))
      throw Error('Resume the original retained report request before preparing a different source.');
    operation={operation_id:'monitoring-report-'+crypto.randomUUID(),payload,state:'unsent',task_id:null};
    prepared=null;lastTaskState='';persist();await submitOriginal();
  }
  async function refreshSources(showMessage=true){
    if(!current())return;
    const version=generation;
    try{
      const response=await api('/api/monitoring-report?'+new URLSearchParams({workspace:workspaceKey,action:'catalog'}));
      if(!current()||version!==generation)return;
      sourceRows=Array.isArray(response.reports)?response.reports:[];
      const select=find('saved');select.replaceChildren(new Option('Choose a retained report source',''));
      for(const row of sourceRows)select.add(new Option((row.title||row.id)+(row.selection?.comparison_id?' · budget comparison':row.selection?.campaign_id?' · campaign revision':' · saved design'),row.id));
      if(selectedSaved&&!sourceRows.some(row=>row.id===selectedSaved))selectedSaved='';
      select.value=selectedSaved;persist();renderSelection();
      if(showMessage)status(sourceRows.length+' retained monitoring report source'+(sourceRows.length===1?'':'s')+'.');
    }catch(error){if(current()&&version===generation&&showMessage)fail(error);}
  }
  async function loadComparison(id){
    const version=generation,sequence=++comparisonSequence;
    comparison=null;comparisonReading=Boolean(id);renderSelection();
    if(!id)return;
    try{
      if(!validId(id))throw Error('Choose an original saved comparison.');
      const value=await api('/api/monitoring?'+new URLSearchParams({
        workspace:workspaceKey,action:'comparison.get',payload:JSON.stringify({comparison_id:id})
      }));
      if(!current()||version!==generation||sequence!==comparisonSequence||reportScope!=='comparison'||id!==chosenComparison)return;
      if(value.id!==id||!Array.isArray(value.plan_ids)||!value.plan_ids.length||!value.plan_ids.includes(value.baseline_plan_id))
        throw Error('The saved comparison has a different original plan inventory.');
      comparison=value;
    }catch(error){if(current()&&version===generation&&sequence===comparisonSequence)fail(error);}
    finally{if(sequence===comparisonSequence){comparisonReading=false;if(current())renderSelection();}}
  }
  async function refreshComparisons(showMessage=false){
    if(!current())return;
    const version=generation,sequence=++comparisonCatalogSequence;
    try{
      const response=await api('/api/monitoring?'+new URLSearchParams({
        workspace:workspaceKey,action:'comparison.list',payload:'{}'
      }));
      if(!current()||version!==generation||sequence!==comparisonCatalogSequence)return;
      const rows=Array.isArray(response.records)?response.records:[],select=find('comparison');
      select.replaceChildren(new Option('Choose a saved comparison',''));
      for(const row of rows)if(validId(row.id))select.add(new Option((row.title||row.id)+' · '+row.plan_ids.length+' plans',row.id));
      if(chosenComparison&&![...select.options].some(option=>option.value===chosenComparison))
        select.add(new Option('Previously selected comparison · '+chosenComparison.slice(0,12),chosenComparison));
      select.value=chosenComparison;
      if(reportScope==='comparison'&&chosenComparison&&comparison?.id!==chosenComparison)await loadComparison(chosenComparison);
      if(current()&&version===generation&&sequence===comparisonCatalogSequence){
        renderSelection();
        if(showMessage)status(rows.length+' saved budget comparison'+(rows.length===1?'':'s')+'.');
      }
    }catch(error){if(current()&&version===generation&&(showMessage||reportScope==='comparison'))fail(error);}
  }
  async function reopen(){
    if(!current()||reading||!validId(selectedSaved))return;
    const id=selectedSaved, delivery=chosenDelivery, version=generation, sequence=++requestSequence;
    reading=true;renderSelection();
    try{
      const value=await api('/api/monitoring-report?'+new URLSearchParams({
        workspace:workspaceKey,action:'get',id,...(delivery?{delivery_id:delivery}:{})
      }));
      if(!current()||version!==generation||sequence!==requestSequence||id!==selectedSaved||delivery!==chosenDelivery)return;
      if(value.id!==id)throw Error('The saved report source identity changed.');
      prepared=value;persist();showFiles(value._downloads);
      status('Original report source reopened. Open the prepared report form to review its delivery selection.');
    }catch(error){if(current()&&version===generation)fail(error);}
    finally{reading=false;if(current())renderSelection();}
  }
  async function open(){
    if(!current()||!prepared?.source||!prepared?.delivery_selection)return;
    if(typeof openDelivery!=='function')throw Error('Use the current shared scientific report form.');
    await openDelivery(clone(prepared.delivery_selection));
  }
  find('scope').onchange=()=>{
    reportScope=find('scope').value==='comparison'?'comparison':'programme';
    comparisonSequence++;comparisonReading=false;persist();renderSelection();
    if(reportScope==='comparison')void refreshComparisons();
  };
  find('comparison').onchange=()=>{chosenComparison=find('comparison').value;persist();void loadComparison(chosenComparison);};
  find('comparisons-refresh').onclick=()=>refreshComparisons(true);
  find('title').oninput=()=>{if(selectionKey)titleDrafts[selectionKey]=find('title').value;persist();};
  find('prepare').onclick=()=>prepare().catch(fail);
  find('retry').onclick=()=>submitOriginal().catch(fail);
  find('task').onclick=()=>operation?.task_id&&showTask?.(operation.task_id);
  find('open').onclick=()=>open().catch(fail);
  find('refresh').onclick=()=>refreshSources();
  find('reopen').onclick=()=>reopen();
  find('delivery').onchange=()=>{chosenDelivery=find('delivery').value;prepared=null;persist();renderSelection();};
  find('saved').onchange=()=>{selectedSaved=find('saved').value;persist();renderSelection();};
  const originalRender=node.render;
  node.render=function(...args){const value=originalRender.apply(this,args);if(current())renderSelection();return value;};
  function update(){
    detached=false;
    if(!current())return;
    renderSelection();
    if(comparisonNeedsRefresh&&reportScope==='comparison'){comparisonNeedsRefresh=false;void refreshComparisons();}
    const task=(getState()?.tasks||[]).find(row=>row.id===operation?.task_id);
    if(task){
      if(task.state==='complete'&&!task.result?.source){
        if(lastTaskState!==task.id+':complete')void readTask();
      }
      else{try{acceptTask(task);}catch(error){fail(error);}}
    }
  }
  function detach(){detached=true;generation++;requestSequence++;comparisonSequence++;comparisonCatalogSequence++;comparisonReading=false;comparisonNeedsRefresh=true;}
  update();void refreshSources(false);void readTask();
  if(reportScope==='comparison')void refreshComparisons();
  return {update,detach};
}
