import {createEconomicRecoveryStore} from './economic_request_store.mjs';
/** Native report and sourced cost intake for the retained economic desk. */
import {exportCostWorksheet,previewCostWorksheet,applyCostWorksheet} from './economic_cost_worksheet.mjs';
import {economicImplementationOptions,economicImplementationSelection} from './economic_implementation.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => String(value || '').slice(0, 12);
const axes = {
  nitrogen_export:{source:'nitrogen',label:'Nitrogen',unit:'kg/year'},
  phosphorus_export:{source:'phosphorus',label:'Phosphorus',unit:'kg/year'},
  sediment_export:{source:'sediment',label:'Sediment',unit:'t/year'}
};
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const format = value => numeric(value) ? new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value) : '—';
const activeAxes = source => Object.keys(axes).filter(key => source?.pollutants?.includes(axes[key].source));
const number = (value, label, {positive=false}={}) => {
  if (String(value ?? '').trim()==='') throw Error('Enter '+label+'.');
  const result=Number(value);
  if (!Number.isFinite(result)||result<0||(positive&&result<=0)) throw Error(label+' must be '+(positive?'positive':'nonnegative')+' and finite.');
  return result;
};
const field = (label,name,value='',type='text',extra='') =>
  '<label><span>'+escape(label)+'</span><input data-field="'+escape(name)+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';
const button = (action,label,extra='') => '<button type="button" data-econ="'+action+'" '+extra+'>'+label+'</button>';
const moneyFields = [
  ['capital','Upfront cost'],['annual_operating','Annual operating cost'],
  ['horizon_years','Horizon, years'],['discount_percent','Real discount rate, %']
];

export function attachEconomicDesk(host) {
  const {getState,api,endpoint,toast}=host;
  let root=null,frame=null,workspace=null,source=null,catalog=null,draft=null;
  let epoch=0,busy=false,pending=null,preview=null,openEditionId=null,requestedSource=null;
  let rowFingerprint='',completedTask=null,worksheetPreview=null;
  let editionEpoch=0,implementationOptions=null,implementationRun='';
  let requestedEdition=null,mountReady=null;
  let recoveryStore=null;
  let recoveryBlocked='',storageIssue='',lastReceipt=null,retiredRequest=null,taskTimer=null,taskReading=false,requestSending=false,mountTurn=0;
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const economicActions=new Set(['economic.draft.save','economic.edition.build']);
  const node=selector=>frame?.querySelector(selector);
  const key=()=> 'upstate-economic-desk:'+workspace;
  const valid=token=>token===epoch&&frame&&workspace===getState()?.workspace_key;
  const url=(path,values={})=>endpoint(path,{workspace,...values});

  function message(text,error=false) {
    const target=node('[data-status]');
    if(target){target.textContent=text;target.setAttribute('role',error?'alert':'status');target.classList.toggle('econ-error',error);}
  }
  function setBusy(value) {
    busy=value;
    const frozen=value||!!pending||!!recoveryBlocked,selectedZone=source?.zones.find(row=>row.zone_id===draft?.zoneId);
    for(const control of frame?.querySelectorAll('[data-submit]')||[])control.disabled=frozen||!source?.alternatives?.length||!selectedZone?.common_support_available;
    for(const control of frame?.querySelectorAll('[data-inputs] input,[data-inputs] textarea,[data-inputs] select,[data-inputs] button,[data-report],[data-zone],[data-cost-worksheet]')||[])control.disabled=frozen||(control.dataset.econ==='worksheet-apply'&&!!worksheetPreview?.errors?.length);
    for(const control of frame?.querySelectorAll('[data-econ="refresh"],[data-econ="edit-edition"],[data-econ="open-draft"],[data-econ="implementation-choose"],[data-econ="implementation-open"],[data-econ="client-report"]')||[])control.disabled=frozen;
  }
  function recoverySnapshot() {
    return {schema:'upstate.economic-browser-state/v2',workspace_key:workspace,draft:copy(draft),pendingRequest:pending?copy(pending):null,pendingId:pending?.id||null,lastReceipt:lastReceipt?copy(lastReceipt):null,retiredRequest:retiredRequest?copy(retiredRequest):null,openEditionId};
  }
  function remember({required=false}={}) {
    const selectedWorkspace=workspace,store=recoveryStore;
    if(!workspace||!draft||recoveryBlocked||!store){const error=Error(recoveryBlocked||'Retain the original Economic workspace first.');return required?Promise.reject(error):Promise.resolve(false);}
    const state=recoverySnapshot();
    return store.save(state).then(result=>{if(workspace===selectedWorkspace){storageIssue=result.warning||'';renderRecovery();}return true;}).catch(error=>{if(workspace===selectedWorkspace){storageIssue=error.message||String(error);renderRecovery();}if(required)throw error;return false;});
  }
  function validOriginalRequest(value,selectedWorkspace) {
    return value&&value.workspace===selectedWorkspace&&economicActions.has(value.action)&&typeof value.operation_id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(value.operation_id)&&value.payload&&typeof value.payload==='object'&&!Array.isArray(value.payload)&&typeof value.payload.report_id==='string'&&/^[a-f0-9]{64}$/.test(value.payload.report_sha256||'')&&typeof value.payload.zone_id==='string'&&value.payload.selection&&typeof value.payload.selection==='object';
  }
  async function readMemory() {
    const selectedWorkspace=workspace,store=recoveryStore,turn=mountTurn;
    try{
      const loaded=await store.load(),value=loaded.state;
      if(workspace!==selectedWorkspace||recoveryStore!==store||mountTurn!==turn)return null;
      storageIssue=loaded.warning||'';
      if(value!==null&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('The retained Economic browser state is invalid.');
      if(value?.workspace_key&&value.workspace_key!==workspace)throw Error('The retained Economic state belongs to another Workspace.');
      if(value?.pendingRequest&&!validOriginalRequest(value.pendingRequest,workspace)&&!(value.pendingRequest.legacy&&value.pendingRequest.id&&value.pendingRequest.workspace===workspace))throw Error('The original retained Economic request is incomplete. Open its original recovery file or inspect its native task.');
      return value;
    }catch(error){if(workspace===selectedWorkspace&&recoveryStore===store&&mountTurn===turn)recoveryBlocked=error.message||String(error);return null;}
  }
  function adoptRecoveredState(restored) {
    draft=restored?.draft||blank();
    pending=restored?.pendingRequest?copy(restored.pendingRequest):(restored?.pendingId?{id:restored.pendingId,workspace,legacy:true,state:'original_task_lookup'}:null);
    lastReceipt=restored?.lastReceipt||null;retiredRequest=restored?.retiredRequest||null;openEditionId=restored?.openEditionId||null;
  }
  function downloadRecovery(name,value) {
    downloadWorksheet({filename:name,content:typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',mimeType:'application/json'});
  }
  function renderRecovery() {
    const box=node('[data-recovery]');if(!box)return;
    const request=pending,receipt=lastReceipt;box.hidden=!request&&!receipt&&!recoveryBlocked&&!storageIssue;
    let body='<h3>Original Economic operation</h3><div class="econ-actions">'+button('recovery-export','Download exact recovery file')+button('recovery-import','Open original recovery file',requestSending||taskReading?'disabled':'')+'</div><input type="file" data-economic-recovery-file accept=".json,application/json" hidden>'; 
    if(recoveryBlocked)body+='<p role="alert">'+escape(recoveryBlocked)+'</p>'+button('recovery-state','Download retained browser state');
    if(storageIssue)body+='<p role="alert">'+escape(storageIssue)+'</p>'+button('recovery-state','Download retained browser state');
    if(request){
      body+='<p>'+escape(request.action||'Retained native task')+' · '+escape(request.state||'awaiting original task lookup')+'</p><p class="econ-note">Original operation '+escape(request.operation_id||'legacy task '+request.id)+'. Its selected source, zone, inputs and identity remain fixed until the native task outcome is known.</p><div class="econ-actions">'+
        button('recovery-check',request.id?'Check original task':'Recover original request',requestSending||taskReading?'disabled':'')+
        (request.id?button('recovery-task','Open original task'):'')+
        (request.state==='interrupted'?button('recovery-resume','Resume original interrupted task',requestSending||taskReading?'disabled':''):'')+
        (['failed','cancelled'].includes(request.state)?button('recovery-retire','Retain failed request and return to inputs'):'')+
        button('recovery-request','Download original request')+'</div>';
      if(request.error)body+='<p role="alert">'+escape(request.error)+'</p>';
    }
    if(receipt){
      body+='<h4>Completed original '+(receipt.action==='economic.edition.build'?'edition':'saved input')+'</h4><p>'+escape(receipt.title||receipt.result_id)+' · '+escape(receipt.task_id)+'</p><div class="econ-actions">'+
        (receipt.action==='economic.edition.build'?button('recovery-open-edition','Open completed edition'):button('recovery-open-input','Reopen saved inputs',pending?'disabled':''))+
        button('recovery-receipt','Download original completion')+button('recovery-complete-task','Open completed original task')+button('recovery-refresh-receipt','Refresh original completion',requestSending||taskReading?'disabled':'')+'</div>';
      body+='<p class="econ-note">This completion retains its original input. Opening an edition leaves the current input draft intact; Reopen saved inputs is an explicit replacement of the current form.</p>';
    }
    box.innerHTML=body;
  }
  function activeTaskContext(selectedWorkspace,selectedFrame,turn) {
    return frame===selectedFrame&&!!frame&&workspace===selectedWorkspace&&getState()?.workspace_key===selectedWorkspace&&mountTurn===turn;
  }
  function exactTask(task,request) {
    if(!task||task.id!==request.id||task.workspace!==request.workspace||task.action!==request.action||task.operation_id!==request.operation_id||canonical(task.payload)!==canonical(request.payload))throw Error('The native task differs from the original retained Economic request.');
  }
  function fromOriginalTask(task,selectedWorkspace,id) {
    if(task?.id!==id||task.workspace!==selectedWorkspace||!economicActions.has(task.action))throw Error('This task is not the original Economic operation in this Workspace.');
    const request={workspace:selectedWorkspace,action:task.action,operation_id:task.operation_id,payload:copy(task.payload),id:task.id,state:task.state||'queued'};
    if(!validOriginalRequest(request,selectedWorkspace))throw Error('The original native task does not contain a complete recoverable Economic request.');
    return request;
  }
  async function acceptOriginalTask(task,request) {
    const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;
    exactTask(task,request);request.state=task.state;request.error=task.error?.message||'';remember();
    if(task.state==='complete'){
      if(!task.result?.id||canonical(task.result.input)!==canonical(request.payload))throw Error('The completed Economic record differs from its original retained input.');
      lastReceipt={schema:'upstate.economic-browser-completion/v1',workspace_key:workspace,task_id:task.id,action:task.action,operation_id:task.operation_id,payload:copy(request.payload),result_id:task.result.id,title:task.result.title||'',completed_at:task.completed_at||null};
      pending=null;completedTask=task.id;clearTimeout(taskTimer);setBusy(false);remember();renderRecovery();
      message(task.action==='economic.edition.build'?'The complete original Economic edition is saved. Its source-bound input and current form remain retained.':'The original economic input and cost sources are saved.');
      if(!source)await loadCatalog();
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn))return;
      if(task.action==='economic.edition.build')await openEdition(task.result.id);
      if(activeTaskContext(selectedWorkspace,selectedFrame,turn)&&typeof host.refreshState==='function')await host.refreshState({force:true});
      return;
    }
    setBusy(false);renderRecovery();
    if(['failed','cancelled','interrupted'].includes(task.state)){message(request.error||'The original Economic task '+task.state+'. Recover or inspect that task before changing inputs.',true);return;}
    message(task.state==='queued'?'The original Economic operation is queued.':'The original Economic operation is running.');
  }
  async function pollOriginal() {
    clearTimeout(taskTimer);const request=pending;if(!request?.id||taskReading||!frame)return;
    const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;taskReading=true;renderRecovery();
    try{
      if(!request.legacy){await remember({required:true});await recoveryStore.verifyRequest(request);}
      const result=await api(endpoint('/api/task',{workspace:selectedWorkspace,id:request.id})),task=result.task||result;
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||pending!==request)return;
      if(request.legacy){pending=fromOriginalTask(task,selectedWorkspace,request.id);await remember({required:true});}
      const retained=pending;await acceptOriginalTask(task,retained);
      if(activeTaskContext(selectedWorkspace,selectedFrame,turn)&&pending===retained&&!['failed','cancelled','interrupted'].includes(retained.state))taskTimer=setTimeout(()=>pollOriginal().catch(error=>message(error.message||String(error),true)),2000);
    }catch(error){if(activeTaskContext(selectedWorkspace,selectedFrame,turn)){message(error.message||String(error),true);renderRecovery();}throw error;}
    finally{if(activeTaskContext(selectedWorkspace,selectedFrame,turn)){taskReading=false;setBusy(busy);renderRecovery();}}
  }
  async function recoverOriginal() {
    const request=pending;if(!request||requestSending)return;
    if(request.id)return pollOriginal();
    if(!validOriginalRequest(request,workspace))throw Error('Retain the complete original request before recovery.');
    const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn,store=recoveryStore;requestSending=true;setBusy(true);renderRecovery();
    try{
      await remember({required:true});await store.verifyRequest(request);
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||pending!==request)return;
      const result=await api('/api/actions',{method:'POST',body:{workspace:request.workspace,action:request.action,payload:request.payload,operation_id:request.operation_id}});
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||pending!==request)return;
      const task=result.task||result;
      if(!task.id||(task.workspace&&task.workspace!==request.workspace))throw Error('No matching original Economic task was returned. Keep and recover this same request.');
      request.id=task.id;request.state=task.state||'queued';request.error='';remember();await pollOriginal();
    }catch(error){
      if(activeTaskContext(selectedWorkspace,selectedFrame,turn)&&pending===request){if(!request.id)request.state='response_unconfirmed';request.error=error.message||String(error);remember();message(request.error,true);}
      throw error;
    }finally{if(activeTaskContext(selectedWorkspace,selectedFrame,turn)){requestSending=false;setBusy(false);renderRecovery();}}
  }
  async function refreshOriginalReceipt() {
    const receipt=lastReceipt;if(!receipt||taskReading)return;
    const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;taskReading=true;renderRecovery();
    try{
      const result=await api(endpoint('/api/task',{workspace:selectedWorkspace,id:receipt.task_id})),task=result.task||result;
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||lastReceipt!==receipt)return;
      exactTask(task,{workspace:selectedWorkspace,id:receipt.task_id,action:receipt.action,operation_id:receipt.operation_id,payload:receipt.payload});
      if(task.state!=='complete'||task.result?.id!==receipt.result_id||canonical(task.result.input)!==canonical(receipt.payload))throw Error('The completed task no longer matches its original Economic receipt.');
      message('Original completed Economic record verified.');renderRecovery();
    }finally{if(activeTaskContext(selectedWorkspace,selectedFrame,turn)){taskReading=false;renderRecovery();}}
  }
  async function recoveryAction(action) {
    if(action==='recovery-export'){downloadRecovery('economic-original-recovery.json',await recoveryStore.exportFile(recoverySnapshot()));return;}
    if(action==='recovery-import'){node('[data-economic-recovery-file]')?.click();return;}
    if(action==='recovery-check'){await recoverOriginal();return;}
    if(action==='recovery-task'){if(pending?.id)await host.showTask?.(pending.id);return;}
    if(action==='recovery-request'){if(pending)downloadRecovery('original-economic-request.json',pending);return;}
    if(action==='recovery-state'){downloadRecovery('economic-original-recovery.json',await recoveryStore.exportFile(recoverySnapshot()));return;}
    if(action==='recovery-complete-task'){if(lastReceipt?.task_id)await host.showTask?.(lastReceipt.task_id);return;}
    if(action==='recovery-receipt'){if(lastReceipt)downloadRecovery('original-economic-completion.json',lastReceipt);return;}
    if(action==='recovery-refresh-receipt'){await refreshOriginalReceipt();return;}
    if(action==='recovery-open-edition'){if(lastReceipt?.action==='economic.edition.build')await openEdition(lastReceipt.result_id);return;}
    if(action==='recovery-open-input'){if(pending||busy||recoveryBlocked)throw Error('Recover the original request first.');if(lastReceipt?.action==='economic.draft.save')await loadSaved('draft',lastReceipt.result_id);return;}
    if(action==='recovery-retire'){
      if(!pending||!['failed','cancelled'].includes(pending.state))throw Error('Retain the original request until its definitive native outcome is known.');
      retiredRequest=copy(pending);downloadRecovery('original-'+pending.state+'-economic-request.json',retiredRequest);pending=null;remember();renderRecovery();await loadCatalog();return;
    }
    if(action==='recovery-resume'){
      const request=pending;if(!request?.id||request.state!=='interrupted')throw Error('Choose the original interrupted Economic task.');
      if(requestSending||taskReading)return;
      const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;requestSending=true;renderRecovery();
      try{const result=await api(endpoint('/api/task/resume',{workspace:selectedWorkspace}),{method:'POST',body:{id:request.id}});if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||pending!==request)return;const task=result.task||result;if(task.id&&task.id!==request.id)throw Error('The resumed task has a different original identity.');request.state='queued';request.error='';remember();}
      finally{if(activeTaskContext(selectedWorkspace,selectedFrame,turn)){requestSending=false;renderRecovery();}}
      await pollOriginal();return;
    }
  }
  function blank(reportId='',zoneId='') {
    return {reportId,reportSha:'',zoneId,title:'',currency:'USD',capital_limit:'',
      annualized_limit:'',targets:{},costs:{},costWorksheets:[],notes:'',originalReportId:'',originalZoneId:'',originalSelection:null};
  }
  function current() {
    if(!draft||!frame)return draft;
    for(const input of frame.querySelectorAll('[data-field]')){
      const name=input.dataset.field;
      if(name.startsWith('target:'))draft.targets[name.slice(7)]=input.value;
      else draft[name]=input.value;
    }
    for(const row of frame.querySelectorAll('[data-cost-run]')){
      const value=draft.costs[row.dataset.costRun]||{};
      for(const input of row.querySelectorAll('[data-cost]'))
        value[input.dataset.cost]=input.type==='checkbox'?input.checked:input.value;
      draft.costs[row.dataset.costRun]=value;
    }
    return draft;
  }
  function fromInput(value) {
    const selected=value.selection||{};
    const state=blank(value.report_id,value.zone_id);
    state.reportSha=value.report_sha256;state.title=selected.title||'';
    state.originalReportId=value.report_id;state.originalZoneId=value.zone_id;state.originalSelection=JSON.parse(JSON.stringify(selected));
    state.currency=selected.budget?.currency||selected.costs?.[0]?.currency||'USD';
    state.capital_limit=selected.budget?.capital_limit??'';
    state.annualized_limit=selected.budget?.annualized_limit??'';
    state.targets={...selected.targets};state.notes=(selected.notes||[]).join('\n');
    state.costWorksheets=JSON.parse(JSON.stringify(selected.cost_worksheets||[]));
    for(const cost of selected.costs||[]){
      state.costs[cost.run_id]={
        originalCost:JSON.parse(JSON.stringify(cost)),enabled:true,currency:cost.currency,capital:cost.capital,
        annual_operating:cost.annual_operating,horizon_years:cost.horizon_years,
        discount_percent:Number(cost.discount_rate)*100,
        source_title:cost.source?.title||'',source_uri:cost.source?.uri||'',
        source_as_of:cost.source?.as_of||'',
        cost_scope:cost.scope?.kind==='whole_scenario'?'whole-scenario':cost.scope?.kind==='reporting_zone'?'reporting-zone':'retained',
        estimate_zone_id:cost.scope?.zone_id||value.zone_id,
        estimate_zone_title:cost.scope?.zone_title||value.zone_id,
        estimate_report_id:cost.scope?.producer_report_id||value.report_id,
        reviewed_from:cost.scope?.reviewed_from||null,
        note:cost.scope_note??cost.note??''
      };
    }
    return state;
  }
  function payload() {
    current();
    if(!source||source.producer_report_id!==draft.reportId)throw Error('Choose a completed native report.');
    const zone=source.zones.find(row=>row.zone_id===draft.zoneId);
    if(!zone)throw Error('Choose a reporting zone from this native report.');
    if(!zone.common_support_available)throw Error(zone.reasons.join('; '));
    if(!draft.title.trim())throw Error('Give this economic edition a title.');
    if(draft.reportSha!==source.source.sha256)throw Error('Refresh the changed native report before building this edition.');
    const currency=String(draft.currency||'').trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw Error('Use a three-letter currency such as USD.');
    const retained=draft.originalReportId===draft.reportId&&draft.originalZoneId===draft.zoneId?(draft.originalSelection||{}):{};
    const costs=[];
    const known=new Set([...source.alternatives,...(source.unavailable_alternatives||[])].map(row=>row.run_id));
    for(const [runId,value] of Object.entries(draft.costs)){
      if(!value.enabled)continue;
      if(!known.has(runId))throw Error('A saved cost names a scenario outside this native report.');
      const label=source.alternatives.find(row=>row.run_id===runId)?.label||short(runId);
      const binding=value.worksheetBinding;
      const worksheetBound=binding&&binding.report_id===draft.reportId&&binding.report_sha256===draft.reportSha&&binding.project_id===String(source.project?.id??'')&&
        source.zones.some(originalZone=>originalZone.zone_id===binding.zone_id);
      const original=draft.originalReportId===draft.reportId||worksheetBound?(value.originalCost||{}):{};
      const origin={...(original.source||{}),title:String(value.source_title||'').trim(),uri:String(value.source_uri||'').trim(),as_of:String(value.source_as_of||'').trim()};
      if(!origin.title||!origin.uri||!/^\d{4}-\d{2}-\d{2}$/.test(origin.as_of))throw Error('Add the actual cost source title, reference and as-of date for '+label+'.');
      const scope=value.cost_scope;
      if(scope!=='whole-scenario'&&value.estimate_zone_id&&value.estimate_zone_id!==zone.zone_id)throw Error('Review '+label+' cost originally scoped to '+(value.estimate_zone_title||value.estimate_zone_id)+' before including it in '+zone.title+'.');
      const scopeRecord={...(original.scope||{}),kind:scope==='whole-scenario'?'whole_scenario':scope==='reporting-zone'?'reporting_zone':'retained'};
      if(scopeRecord.kind!=='whole_scenario')Object.assign(scopeRecord,{zone_id:zone.zone_id,zone_title:zone.title,producer_report_id:source.producer_report_id});
      else for(const name of ['zone_id','zone_title','producer_report_id'])delete scopeRecord[name];
      if(value.reviewed_from)scopeRecord.reviewed_from=value.reviewed_from;
      let note=String(value.note||'').trim();
      if(scope==='whole-scenario')note='Cost footprint: the complete modeled scenario. '+note;
      else if(scope==='reporting-zone')note='Cost footprint: an implementation estimate explicitly scoped to '+zone.title+'. '+note;
      else if(scope!=='retained')throw Error('Choose the cost footprint for '+label+'.');
      costs.push({
        ...original,run_id:runId,currency:value.currency||currency,
        capital:number(value.capital,label+' upfront cost'),
        annual_operating:number(value.annual_operating,label+' annual operating cost'),
        horizon_years:number(value.horizon_years,label+' horizon',{positive:true}),
        discount_rate:number(value.discount_percent,label+' discount rate')/100,
        source:origin,note:note.trim(),scope:scopeRecord,scope_note:String(value.note||'').trim()
      });
    }
    const selection={...retained,schema:'upstate.decision-selection/v1',title:draft.title.trim(),
      comparison_id:zone.comparison_id,costs,targets:{},notes:draft.notes.split('\n').filter(line=>line.trim())};
    if(draft.costWorksheets?.length)selection.cost_worksheets=JSON.parse(JSON.stringify(draft.costWorksheets));
    else delete selection.cost_worksheets;
    delete selection.budget;
    const budget={...(retained.budget||{}),currency};
    let hasBudgetLimit=false;
    for(const name of ['capital_limit','annualized_limit']){
      delete budget[name];
      if(String(draft[name]).trim()!==''){budget[name]=number(draft[name],name.replaceAll('_',' '));hasBudgetLimit=true;}
    }
    if(hasBudgetLimit)selection.budget=budget;
    for(const [metric,value] of Object.entries(draft.targets||{}))if(String(value).trim()!==''){
      if(!activeAxes(source).includes(metric))throw Error('The retained '+(axes[metric]?.label||metric)+' target names an unmodeled output. Clear it or choose its native report.');
      selection.targets[metric]=number(value,axes[metric].label+' avoided-export target');
    }
    return {report_id:draft.reportId,report_sha256:draft.reportSha,zone_id:draft.zoneId,selection};
  }
  function shell() {
    frame=document.createElement('div');frame.className='economic-workbench';
    frame.innerHTML='<header class="econ-heading"><div><p class="econ-kicker" data-study-label>DECISION COMPANION</p><h2>Economic desk</h2><p>Choose a completed native report and reporting zone. Compare whole scenarios using their modeled exports, sourced costs and budget.</p></div>'+button('refresh','Refresh completed results')+'</header>'+
      '<p data-status class="econ-status" role="status">Opening completed native reports…</p><section data-recovery hidden class="econ-card"></section>'+
      '<section class="econ-card"><div class="econ-section-heading"><h3>1. Native results and reporting zone</h3></div>'+
      '<div class="econ-fields"><label><span>Completed native report</span><select data-report aria-label="Completed native report"></select></label>'+
      '<label><span>Find a reporting zone</span><input data-zone-filter type="search" placeholder="Zone title or retained ID"></label>'+
      '<label><span>Native reporting zone</span><select data-zone aria-label="Native reporting zone"></select></label></div>'+
      '<div data-source-detail></div><details data-source-issues hidden><summary>Other retained source records</summary><ul></ul></details></section>'+
      '<section data-inputs hidden></section><section data-preview hidden class="econ-card"></section>'+
      '<section class="econ-card"><div class="econ-section-heading"><h3>Saved inputs and completed editions</h3>'+button('refresh-saved','Refresh saved work')+'</div><div data-saved></div></section>'+
      '<section data-edition hidden class="econ-card"><div class="econ-section-heading"><h3 data-edition-title>Economic edition</h3>'+button('close-edition','Close embedded desk')+'</div><div data-edition-links></div><section data-implementation hidden></section><iframe data-edition-frame title="Complete retained economic decision desk" loading="lazy"></iframe></section>';
    root.replaceChildren(frame);
    frame.addEventListener('click',onClick);
    frame.addEventListener('change',onChange);
    frame.addEventListener('input',onInput);
  }
  function renderReports() {
    const select=node('[data-report]');
    select.innerHTML='<option value="">Choose a completed native report</option>'+
      (catalog?.reports||[]).map(row=>'<option value="'+escape(row.id)+'">'+escape(row.title)+' · '+row.pollutants.map(p=>escape(p)).join(', ')+' · '+row.zone_count+' zones</option>').join('');
    select.value=draft?.reportId||'';
    const issues=catalog?.source_issues||[];
    const box=node('[data-source-issues]');box.hidden=!issues.length;
    box.querySelector('ul').innerHTML=issues.map(row=>'<li><code>'+escape(short(row.id))+'</code> '+escape(row.message)+'</li>').join('');
  }
  function renderZones() {
    const select=node('[data-zone]'),query=(node('[data-zone-filter]')?.value||'').trim().toLowerCase();
    const rows=(source?.zones||[]).filter(zone=>zone.zone_id===draft?.zoneId||!query||(zone.title+' '+zone.zone_id).toLowerCase().includes(query));
    select.innerHTML='<option value="">Choose a native reporting zone</option>'+rows.map(zone=>
      '<option value="'+escape(zone.zone_id)+'" '+(!zone.common_support_available?'disabled':'')+'>'+escape(zone.title)+' · '+format(zone.area_ha)+' ha'+(!zone.common_support_available?' · no common export support':'')+'</option>').join('');
    select.value=draft?.zoneId||'';select.disabled=!source;
  }
  function renderSource() {
    const zone=source?.zones.find(row=>row.zone_id===draft?.zoneId),part=node('[data-source-detail]');
    node('[data-study-label]').textContent=(source?.project?.title||getState()?.data?.project?.title||'Native watershed study')+' / DECISION COMPANION';
    if(!source){part.innerHTML='<p class="econ-empty">Build a native scenario report in the existing reporting workflow, then refresh this list.</p>';return;}
    const modelled=activeAxes(source).map(metric=>axes[metric].label).join(', ');
    let body='<dl class="econ-facts"><div><dt>Baseline run</dt><dd><code>'+escape(short(source.baseline_run_id))+'</code></dd></div>'+
      '<div><dt>Whole-scenario alternatives</dt><dd>'+source.alternatives.length+'</dd></div>'+
      '<div><dt>Modeled outputs</dt><dd>'+escape(modelled)+'</dd></div></dl>';
    if(zone){
      body+='<p><strong>'+escape(zone.title)+'</strong> · '+format(zone.area_ha)+' ha · '+escape(zone.scope)+'. Each pollutant uses the original report’s common cells across its entire run cohort.</p>';
      body+='<div class="econ-table-wrap"><table><thead><tr><th>Native output</th><th>Common cells</th><th>Common area, ha</th><th>Selected cells</th></tr></thead><tbody>'+
        activeAxes(source).map(metric=>{const coverage=zone.coverage[axes[metric].source]||{};return '<tr><th>'+axes[metric].label+'</th><td>'+format(coverage.common_valid_cells)+'</td><td>'+format(coverage.common_valid_area_ha)+'</td><td>'+format(coverage.selected_cells)+'</td></tr>';}).join('')+'</tbody></table></div>';
    }
    if(source.unavailable_alternatives?.length)body+='<details><summary>Alternatives outside this management comparison</summary><ul>'+source.unavailable_alternatives.map(row=>'<li><code>'+escape(short(row.run_id))+'</code> '+escape(row.reason)+'</li>').join('')+'</ul></details>';
    part.innerHTML=body;
  }
  function worksheetControls() {
    const retained=draft.costWorksheets||[];
    return '<div class="econ-actions">'+button('worksheet-csv','Download cost worksheet CSV','data-worksheet-action')+
      button('worksheet-json','Download cost worksheet JSON','data-worksheet-action')+
      '<label>Review completed worksheet <input data-cost-worksheet type="file" accept=".csv,.json,text/csv,application/json"></label></div>'+
      '<p class="econ-note">One row per original alternative. Enter the actual source, cost footprint and amounts; set include_cost to yes for reviewed estimates. Import shows every change before applying it. Rows absent from a worksheet keep their current estimates.</p>'+
      (retained.length?'<details><summary>'+retained.length+' original imported cost worksheet'+(retained.length===1?'':'s')+'</summary><ul>'+
        retained.map((item,index)=>'<li>'+escape(item.filename||'Cost worksheet')+' · '+escape(item.imported_at)+' '+button('worksheet-source','Download original','data-index="'+index+'" data-worksheet-action')+'</li>').join('')+'</ul></details>':'')+
      '<div data-worksheet-preview hidden></div>';
  }
  function downloadWorksheet(file) {
    const objectURL=URL.createObjectURL(new Blob([file.content],{type:file.mimeType}));
    const link=document.createElement('a');link.href=objectURL;link.download=file.filename;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
  }
  function renderWorksheetPreview() {
    const box=node('[data-worksheet-preview]');if(!box)return;
    box.hidden=!worksheetPreview;if(!worksheetPreview)return;
    const selected=worksheetPreview;
    const errors=selected.errors.length?'<ul role="alert">'+selected.errors.map(row=>'<li>'+escape(row.message)+'</li>').join('')+'</ul>':'';
    const rows=selected.rows.map(row=>{
      const details=row.changed.map(key=>'<li>'+escape(key.replaceAll('_',' '))+': <span>'+escape(row.before[key]??'—')+'</span> → <strong>'+escape(row.after[key]??'—')+'</strong></li>').join('');
      const metadata=row.metadata_changed?'<details><summary>Source and estimate provenance changes</summary><p>Current retained metadata</p><pre>'+escape(JSON.stringify(row.metadata_before,null,2))+'</pre><p>Metadata retained after import</p><pre>'+escape(JSON.stringify(row.metadata_after,null,2))+'</pre></details>':'';
      return '<tr><th>'+escape(row.label)+'<br><code>'+escape(short(row.run_id))+'</code></th><td>'+(row.after.enabled?'Include reviewed estimate':'Keep cost unchecked')+'</td><td>'+(details?'<ul>'+details+'</ul>':row.metadata_changed?'Cost amounts unchanged':'Values unchanged')+metadata+'</td></tr>';
    }).join('');
    box.innerHTML='<h4>Review '+escape(selected.filename)+'</h4><p>'+selected.rows.length+' valid rows · '+selected.included_count+' reviewed estimates · '+selected.untouched_count+' other alternatives kept as entered.</p>'+errors+
      '<div class="econ-table-wrap"><table><thead><tr><th>Original alternative</th><th>Estimate selection</th><th>Changes to current inputs</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="econ-actions">'+button('worksheet-apply','Apply reviewed worksheet','data-worksheet-action '+(selected.errors.length?'disabled':''))+
      button('worksheet-cancel','Cancel worksheet preview','data-worksheet-action')+'</div>';
  }
  async function readWorksheet(file) {
    if(!file)return;
    worksheetPreview=null;renderWorksheetPreview();
    current();const token=epoch,expected=JSON.stringify(draft);
    if(file.size>1024*1024)throw Error('Use a cost worksheet of at most 1 MiB. Split larger files by original scenario rows.');
    setBusy(true);message('Reading the worksheet and comparing its original scenario identities…');
    try{
      const bytes=await file.arrayBuffer();
      if(!valid(token))return;
      if(JSON.stringify(current())!==expected)throw Error('The economic inputs changed while reading the file. Select the worksheet again.');
      const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      if(!valid(token))return;
      if(JSON.stringify(current())!==expected)throw Error('The economic inputs changed while reading the file. Select the worksheet again.');
      worksheetPreview=previewCostWorksheet(content,{filename:file.name,source,draft});
      worksheetPreview.sha256=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
      renderWorksheetPreview();
      message(worksheetPreview.errors.length?'Correct the listed worksheet rows, then select the corrected file.':'Review the worksheet changes, then apply the reviewed estimates.',!!worksheetPreview.errors.length);
    }finally{if(valid(token))setBusy(false);}
  }
  function renderInputs() {
    const box=node('[data-inputs]'),zone=source?.zones.find(row=>row.zone_id===draft?.zoneId);
    box.hidden=!zone;
    if(!zone)return;
    const metricFields=activeAxes(source).map(metric=>field(axes[metric].label+' minimum avoided export, '+axes[metric].unit,'target:'+metric,draft.targets[metric]??'','number','min="0" step="any" placeholder="No target"')).join('');
    const inactive=Object.entries(draft.targets||{}).filter(([metric,value])=>String(value).trim()!==''&&!activeAxes(source).includes(metric));
    const retainedTargets=inactive.length?'<section class="econ-status"><strong>Retained targets for outputs absent from this report</strong><ul>'+inactive.map(([metric,value])=>'<li>'+escape(axes[metric]?.label||metric)+': '+escape(value)+' '+escape(axes[metric]?.unit||'')+' '+button('clear-target','Clear this retained target','data-metric="'+escape(metric)+'"')+'</li>').join('')+'</ul><p class="econ-note">These original criteria stay in the draft until explicitly cleared. Choose a report containing the output to keep using the target.</p></section>':'';
    const rows=source.alternatives.map(row=>{
      const value=draft.costs[row.run_id]||{};
      const fields=moneyFields.map(([name,label])=>'<label><span>'+label+'</span><input data-cost="'+name+'" type="number" min="0" step="any" value="'+escape(value[name]??'')+'"></label>').join('');
      const scope=value.cost_scope||'';
      return '<details class="econ-cost" data-cost-run="'+escape(row.run_id)+'" '+(value.enabled?'open':'')+'><summary><span>'+escape(row.label)+'</span><code>'+escape(short(row.run_id))+'</code></summary>'+
        '<label class="econ-checkbox"><input type="checkbox" data-cost="enabled" '+(value.enabled?'checked':'')+'> Include this scenario’s reviewed implementation estimate</label>'+
        (value.needs_scope_review?'<p class="econ-note"><strong>Original estimate zone: '+escape(value.needs_scope_review.zone_title||value.needs_scope_review.zone_id)+'.</strong> The cost is unchecked after changing the reporting zone. Review its actual footprint and quantities before including it in this zone.</p>':'')+
        (value.reviewed_from?'<p class="econ-note">Estimate provenance retained from '+escape(value.reviewed_from.zone_title||value.reviewed_from.zone_id)+'; reviewed for this selection.</p>':'')+
        '<div class="econ-cost-fields" '+(!value.enabled?'hidden':'')+'><div class="econ-fields">'+fields+
        '<label><span>Cost currency</span><input data-cost="currency" maxlength="3" value="'+escape(value.currency||draft.currency)+'"></label>'+
        '<label><span>Cost footprint</span><select data-cost="cost_scope"><option value="">Choose actual cost scope</option><option value="whole-scenario" '+(scope==='whole-scenario'?'selected':'')+'>Complete modeled scenario</option><option value="reporting-zone" '+(scope==='reporting-zone'?'selected':'')+'>Defined implementation in this reporting zone</option>'+(scope==='retained'?'<option value="retained" selected>Original retained scope note</option>':'')+'</select></label></div>'+
        '<div class="econ-fields"><label><span>Actual cost source title</span><input data-cost="source_title" value="'+escape(value.source_title||'')+'"></label><label><span>Source URL or retained document reference</span><input data-cost="source_uri" value="'+escape(value.source_uri||'')+'"></label><label><span>Source as of</span><input data-cost="source_as_of" type="date" value="'+escape(value.source_as_of||'')+'"></label></div>'+
        '<label><span>Cost scope, quantities and estimate assumptions</span><textarea data-cost="note" rows="2">'+escape(value.note||'')+'</textarea></label></div></details>';
    }).join('');
    box.innerHTML='<section class="econ-card"><h3>2. Edition, budget and physical targets</h3><div class="econ-fields">'+field('Edition title','title',draft.title)+field('Budget / default cost currency','currency',draft.currency,'text','maxlength="3"')+
      field('Upfront budget limit','capital_limit',draft.capital_limit,'number','min="0" step="any" placeholder="No upfront limit"')+
      field('Annualized budget limit','annualized_limit',draft.annualized_limit,'number','min="0" step="any" placeholder="No annualized limit"')+
      metricFields+'</div>'+retainedTargets+'<p class="econ-note">Empty budget or target fields leave that criterion open. Costs use the actual intervention footprint; the reporting zone’s area does not prorate them.</p></section>'+
      '<section class="econ-card"><h3>3. Whole-scenario cost sources</h3><p>Keep a scenario’s cost unchecked until its full implementation estimate is available. Assistance and payment schedules are funding contributions; retain those references in notes instead of entering them as implementation cost. Enter explicit zero values where the estimate has no upfront or annual cost. The physical edition remains useful with every cost unchecked.</p>'+worksheetControls()+rows+
      '<label class="econ-notes"><span>Working notes carried with this edition</span><textarea data-field="notes" rows="3">'+escape(draft.notes)+'</textarea></label>'+
      '<div class="econ-actions">'+button('preview','Calculate decision preview','data-submit')+button('save-draft','Save inputs to workspace','data-submit')+button('build','Build and open complete edition','data-submit class="econ-primary"')+'</div>'+
      '<p class="econ-note">Every candidate remains one complete modeled scenario. Nitrogen, phosphorus and sediment keep their own units.</p></section>';
    renderWorksheetPreview();setBusy(busy);
  }
  function renderSaved(value=catalog) {
    if(!value)return;
    const editions=value.editions||[],drafts=value.drafts||[];
    let body='<div class="econ-saved-grid"><div><h4>Completed editions</h4>';
    body+=editions.length?'<ul class="econ-saved-list">'+editions.map(row=>'<li><strong>'+escape(row.title)+'</strong><span>'+escape(row.zone_title)+' · '+row.candidate_count+' scenarios · '+row.costed_count+' costs · '+row.eligible_count+' eligible</span><div>'+button('open-edition','Open desk','data-id="'+escape(row.id)+'"')+button('edit-edition','Reuse inputs','data-id="'+escape(row.id)+'"')+
      (typeof host.openExtension==='function'?button('client-report','Prepare client report','data-id="'+escape(row.id)+'"')+button('implementation-choose','Plan implementation','data-id="'+escape(row.id)+'"'):'')+'</div></li>').join('')+'</ul>':'<p class="econ-empty">Completed economic editions appear here.</p>';
    body+='</div><div><h4>Saved inputs</h4>';
    body+=drafts.length?'<ul class="econ-saved-list">'+drafts.map(row=>'<li><strong>'+escape(row.title)+'</strong><span>'+escape(row.zone_title)+' · '+row.costed_count+' sourced costs</span>'+button('open-draft','Reopen inputs','data-id="'+escape(row.id)+'"')+'</li>').join('')+'</ul>':'<p class="econ-empty">Save the actual source, zone and completed cost inputs for another operator.</p>';
    body+='</div></div>';
    const issues=value.issues||[];
    if(issues.length)body+='<details><summary>Saved records needing attention</summary><ul>'+issues.map(row=>'<li>'+escape(short(row.id))+': '+escape(row.message)+'</li>').join('')+'</ul></details>';
    node('[data-saved]').innerHTML=body;
    rowFingerprint=JSON.stringify(value);
  }
  function renderPreview(report) {
    preview=report;
    const metrics=Object.keys(report.baseline.outputs),box=node('[data-preview]');
    const budget=report.assessment.budget;
    box.hidden=false;
    box.innerHTML='<h3>Calculated whole-scenario preview</h3><p>'+report.alternatives.length+' comparable scenarios; '+report.frontier.eligible_ids.length+' meet the prepared criteria. '+(budget?'Budget currency '+escape(budget.currency)+'.':'No budget was applied.')+'</p>'+
      '<div class="econ-table-wrap"><table><thead><tr><th>Scenario</th>'+metrics.map(metric=>'<th>'+axes[metric].label+' avoided, '+axes[metric].unit+'</th>').join('')+'<th>Annualized cost</th><th>Decision</th></tr></thead><tbody>'+report.alternatives.map(row=>'<tr><th>'+escape(row.label)+'</th>'+metrics.map(metric=>'<td>'+format(row.outputs[metric].reduction)+'</td>').join('')+'<td>'+(row.cost?format(row.cost.annualized)+' '+escape(row.cost.currency)+'/year':'Cost not entered')+'</td><td>'+(row.decision.eligible?'Eligible':'Outside prepared criteria')+(row.decision.pareto?' · Pareto':'')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="econ-note">The complete edition retains source coverage, signed changes, undefined zero-baseline percentages, cost assumptions, exports and working notes.</p>';
  }
  async function loadSource(reportId,{preserve=false,zoneId=null}={}) {
    const token=++epoch,selectedWorkspace=workspace,retained=preserve&&draft?JSON.parse(JSON.stringify(draft)):null;
    worksheetPreview=null;
    setBusy(true);message('Reading the completed native report and exact zones…');
    try{
      const value=await api(url('/api/economic-desk/source',{report_id:reportId}));
      if(!valid(token)||selectedWorkspace!==workspace)return;
      source=value;draft=retained||blank(reportId,zoneId||'');
      draft.reportId=reportId;
      if(draft.reportSha&&draft.reportSha!==value.source.sha256){
        throw Error('This saved selection names different native report bytes. Its original costs are retained in the form; refresh the source before rebuilding.');
      }
      draft.reportSha=value.source.sha256;
      if(zoneId)draft.zoneId=zoneId;
      if(!value.zones.some(row=>row.zone_id===draft.zoneId))
        draft.zoneId=value.zones.find(row=>row.zone_id==='reporting_area'&&row.common_support_available)?.zone_id||
          value.zones.find(row=>row.common_support_available)?.zone_id||'';
      if(!draft.title)draft.title=value.title+' · '+(value.zones.find(row=>row.zone_id===draft.zoneId)?.title||'economic edition');
      renderReports();renderZones();renderSource();renderInputs();remember();
      message(value.alternatives.length?'Native report and zone loaded. Enter available sourced costs or build the physical decision edition.':'This report has no land-cover alternative under its baseline profile. Choose the completed management cohort.');
    }catch(error){if(valid(token)){message(error.message||String(error),true);renderZones();renderSource();renderInputs();}}
    finally{if(valid(token))setBusy(false);}
  }
  async function loadCatalog({preserve=true}={}) {
    const token=++epoch;
    if(preserve&&!pending&&!recoveryBlocked)current();
    setBusy(true);message('Discovering completed native reports and saved economic editions…');
    try{
      const value=await api(url('/api/economic-desk/catalog'));
      if(!valid(token))return;
      catalog=value;renderReports();renderSaved();
      if(pending||recoveryBlocked){source=null;renderZones();renderSource();renderInputs();setBusy(false);renderRecovery();return;}
      const wanted=requestedSource;
      if(wanted){requestedSource=null;draft=blank(wanted.report_id,wanted.zone_id||'');}
      const reportId=wanted?.report_id||draft?.reportId||value.reports.find(row=>row.ready_zones&&row.alternative_count)?.id;
      if(reportId&&value.reports.some(row=>row.id===reportId)){
        setBusy(false);
        await loadSource(reportId,{preserve:!!draft,zoneId:wanted?.zone_id});
      }else{
        source=null;renderZones();renderSource();renderInputs();setBusy(false);
        message(value.reports.length?'Choose a completed native report.':'No completed native scenario report is present in this workspace. Build it in the native reporting workflow, then refresh.');
      }
    }catch(error){if(valid(token)){message(error.message||String(error),true);setBusy(false);}}
  }
  async function openEdition(id,{implementation=false}={}) {
    const token=epoch,reading=++editionEpoch;
    implementationOptions=null;implementationRun='';renderImplementation();
    message('Opening the retained economic edition…');
    const value=await api(url('/api/economic-desk/edition',{edition_id:id}));
    if(!valid(token)||reading!==editionEpoch)return;
    implementationOptions=null;implementationRun='';
    openEditionId=id;
    const section=node('[data-edition]');section.hidden=false;
    node('[data-edition-title]').textContent=value.title;
    const links=node('[data-edition-links]');
    links.innerHTML='<a target="_blank" rel="noopener" href="'+escape(value.open_url)+'">Open full desk in a new tab</a> '+
      (value._downloads||[]).map(file=>'<a href="'+escape(file.url)+'?download=1">'+escape(file.label)+'</a>').join(' ')+
      (typeof host.openExtension==='function'?' '+button('client-report','Prepare client report','data-id="'+escape(id)+'"')+' '+button('implementation-choose','Plan implementation','data-id="'+escape(id)+'"'):'');
    node('[data-edition-frame]').src=value.open_url;
    renderImplementation();
    if(implementation){implementationOptions=economicImplementationOptions(value,workspace);renderImplementation();}
    section.scrollIntoView({block:'start',behavior:'smooth'});
    message('Complete economic edition opened with its original modeled outcomes and cost inputs.');remember();return value;
  }

  function renderImplementation() {
    const box=node('[data-implementation]');if(!box)return;
    box.hidden=!implementationOptions;if(!implementationOptions)return;
    const options=implementationOptions,row=options.alternatives.find(item=>item.run_id===implementationRun);
    let detail='<p>Choose the complete scenario you intend to carry into fieldwork.</p>';
    if(row){
      const original=row.original_cost,cost=row.cost;
      const scope=original?.scope?.kind==='whole_scenario'?'Whole modeled scenario':
        original?.scope?.kind==='reporting_zone'?'Reporting zone: '+(original.scope.zone_title||options.zone_title):
        original?.scope?.kind==='retained'?'Original retained footprint':'';
      const reasons=Array.isArray(row.decision.reasons)?row.decision.reasons.map(value=>
        '<li>'+escape(typeof value==='string'?value:JSON.stringify(value))+'</li>').join(''):'';
      detail='<h4>'+escape(row.label)+'</h4><p>Reporting zone: <strong>'+escape(options.zone_title)+'</strong>. '+
        (row.eligible?'This scenario meets the edition’s prepared criteria.':'This scenario is outside the edition’s prepared criteria.')+'</p>'+
        (reasons?'<ul>'+reasons+'</ul>':'')+
        '<div class="econ-table-wrap"><table><thead><tr><th>Modeled output</th><th>Annual avoided export</th><th>Common cells</th></tr></thead><tbody>'+
        row.outputs.map(output=>'<tr><th>'+escape(output.label)+'</th><td>'+format(output.reduction)+' '+escape(output.units)+'</td><td>'+format(output.support?.valid_cells)+'</td></tr>').join('')+'</tbody></table></div>'+
        (cost?'<dl class="econ-facts"><div><dt>Upfront planning estimate</dt><dd>'+format(cost.capital)+' '+escape(cost.currency)+'</dd></div>'+
        '<div><dt>Annual operating estimate</dt><dd>'+format(cost.annual_operating)+' '+escape(cost.currency)+'/year</dd></div>'+
        '<div><dt>Annualized comparison cost</dt><dd>'+format(cost.annualized)+' '+escape(cost.currency)+'/year</dd></div></dl>'+
        '<p>'+escape(scope)+(scope?'. ':'')+'Source: '+escape(original.source?.title)+' · '+escape(original.source?.as_of)+'.</p>':
        '<p>This edition has no sourced implementation estimate for this scenario.</p>');
    }
    box.innerHTML='<div class="econ-section-heading"><h3>Plan implementation</h3>'+button('implementation-cancel','Close scenario selection')+'</div>'+
      '<label><span>Whole scenario from '+escape(options.edition_title)+'</span><select data-implementation-run aria-label="Whole scenario for implementation"><option value="">Choose one whole scenario</option>'+
      options.alternatives.map(row=>'<option value="'+escape(row.run_id)+'">'+escape(row.label)+' · '+escape(short(row.run_id))+'</option>').join('')+'</select></label>'+detail+
      '<p class="econ-note">The original scenario, reporting zone, modeled support and cost sources travel together. In Implementation &amp; fieldwork, choose the destination plan and review its proposed work. Assign tasks, dates and field budgets there. Annualized costs remain part of the scenario comparison.</p>'+
      '<div class="econ-actions">'+button('implementation-open','Continue to implementation planning',!row?'disabled':'')+'</div>';
    box.querySelector('[data-implementation-run]').value=implementationRun;
  }
  async function prepareImplementation() {
    if(typeof host.openExtension!=='function')throw Error('Open the current operator to plan implementation.');
    const selection=economicImplementationSelection(implementationOptions,implementationRun);
    if(selection.workspace_key!==workspace||workspace!==getState()?.workspace_key)
      throw Error('Reopen this economic edition in its original workspace.');
    current();remember();
    await host.openExtension('implementation','openEconomicScenario',selection);
  }

  async function prepareClientReport(id) {
    if(typeof host.openExtension!=='function')throw Error('Open this completed edition with the current map-release operator.');
    const token=epoch,key=workspace;
    current();remember();
    message('Opening the client report with this completed economic edition…');
    const [edition,module]=await Promise.all([
      api(url('/api/economic-desk/edition',{edition_id:id})),
      import('/web/extensions/scenario_reports.mjs')
    ]);
    if(!valid(token))return;
    if(edition.id!==id||!edition.input?.report_id)throw Error('Reopen the completed economic edition to retain its original report.');
    const release=await api(url('/api/scenario-reports/release',{report_id:edition.input.report_id}));
    if(!valid(token))return;
    if(!release.ready)throw Error((release.issues||[]).map(item=>item.message).join(' ')||
      'Complete the selected native report before preparing its maps and economic report.');
    const selection=module.economicReleaseSelection(release,id);
    await host.openExtension('map-atlas','create',{workspace_key:key,selection});
  }
  async function loadSaved(kind,id) {
    if(pending||busy||recoveryBlocked)throw Error('Recover the original Economic request before replacing the current input form.');
    const token=epoch;
    const value=await api(url('/api/economic-desk/'+kind,{[kind==='draft'?'draft_id':'edition_id']:id}));
    if(!valid(token))return;
    draft=fromInput(value.input);
    preview=null;node('[data-preview]').hidden=true;
    await loadSource(draft.reportId,{preserve:true,zoneId:draft.zoneId});
  }
  async function submit(action) {
    if(pending||recoveryBlocked)throw Error('Finish or recover the original Economic request before saving another input.');
    if(!economicActions.has(action))throw Error('Choose the maintained Economic save or build action.');
    const body=payload();
    if(lastReceipt?.action===action&&canonical(lastReceipt.payload)===canonical(body)){
      message('These exact inputs already have a completed original operation. Reopening its retained result.');await refreshOriginalReceipt();
      if(action==='economic.edition.build')await openEdition(lastReceipt.result_id);return;
    }
    pending={workspace,action,payload:copy(body),operation_id:crypto.randomUUID(),state:'submitting'};
    const request=pending,selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;
    try{await remember({required:true});}catch(error){if(activeTaskContext(selectedWorkspace,selectedFrame,turn)&&pending===request){request.state='storage_unavailable';renderRecovery();}throw error;}
    if(!activeTaskContext(selectedWorkspace,selectedFrame,turn)||pending!==request)return;
    completedTask=null;renderRecovery();await recoverOriginal();
  }
  async function onClick(event) {
    const target=event.target.closest('[data-econ]');
    if(!target||!frame.contains(target))return;
    event.preventDefault();event.stopPropagation();
    try{
      const action=target.dataset.econ;
      if(action.startsWith('recovery-'))return await recoveryAction(action);
      if((pending||recoveryBlocked)&&!['refresh-saved','close-edition','open-edition','worksheet-csv','worksheet-json','worksheet-source'].includes(action))throw Error('Finish or recover the original Economic request before changing its inputs.');
      if(action==='refresh')return await loadCatalog();
      if(action==='refresh-saved'){if(typeof host.refreshState==='function')await host.refreshState();catalog={...catalog,...getState()?.data?.economic_editions};return renderSaved(catalog);}
      if(action==='close-edition'){editionEpoch++;implementationOptions=null;implementationRun='';node('[data-edition]').hidden=true;node('[data-edition-frame]').removeAttribute('src');openEditionId=null;return remember();}
      if(action==='open-edition')return await openEdition(target.dataset.id);
      if(action==='edit-edition')return await loadSaved('edition',target.dataset.id);
      if(action==='implementation-choose'){
        target.disabled=true;
        try{return await openEdition(target.dataset.id,{implementation:true});}
        finally{if(target.isConnected)target.disabled=false;}
      }
      if(action==='implementation-cancel'){editionEpoch++;implementationOptions=null;implementationRun='';renderImplementation();return;}
      if(action==='implementation-open'){
        target.disabled=true;
        try{return await prepareImplementation();}
        finally{if(target.isConnected)target.disabled=false;}
      }
      if(action==='client-report'){
        target.disabled=true;
        try{return await prepareClientReport(target.dataset.id);}
        finally{if(target.isConnected)target.disabled=false;}
      }
      if(action==='open-draft')return await loadSaved('draft',target.dataset.id);
      if(busy)throw Error('The current economic operation is still running; its task remains in the operator queue.');
      if(action==='worksheet-csv'||action==='worksheet-json'){current();downloadWorksheet(exportCostWorksheet(source,draft,action==='worksheet-csv'?'csv':'json'));return;}
      if(action==='worksheet-source'){const item=draft.costWorksheets?.[Number(target.dataset.index)];if(!item)throw Error('Choose a retained original worksheet.');downloadWorksheet({filename:item.filename,content:item.original_text,mimeType:item.format==='csv'?'text/csv;charset=utf-8':'application/json'});return;}
      if(action==='worksheet-cancel'){worksheetPreview=null;renderWorksheetPreview();message('Worksheet preview closed. Current inputs are retained.');return;}
      if(action==='worksheet-apply'){current();draft=applyCostWorksheet(draft,worksheetPreview,{sha256:worksheetPreview?.sha256,imported_at:new Date().toISOString()});worksheetPreview=null;preview=null;node('[data-preview]').hidden=true;renderInputs();remember();message('Reviewed cost rows applied. Save inputs or build the edition to retain the original worksheet with this work.');return;}
      if(action==='clear-target'){delete draft.targets[target.dataset.metric];preview=null;node('[data-preview]').hidden=true;renderInputs();remember();message('The selected retained target was cleared. Other criteria are preserved.');return;}
      if(action==='preview'){
        const token=epoch;setBusy(true);message('Calculating costs, affordability and separate physical objectives…');
        try{const value=await api('/api/economic-desk/preview',{method:'POST',body:{workspace,...payload()}});if(valid(token)){renderPreview(value.report);message('Decision preview calculated from the retained native outcomes.');}}
        finally{if(valid(token))setBusy(false);}
      }else if(action==='save-draft')await submit('economic.draft.save');
      else if(action==='build')await submit('economic.edition.build');
    }catch(error){message(error.message||String(error),true);if(typeof toast==='function')toast(error.message||String(error));}
  }
  async function onChange(event) {
    try{
      if(event.target.matches('[data-economic-recovery-file]')){
        const file=event.target.files?.[0];event.target.value='';if(!file)return;if(requestSending||taskReading)throw Error('Wait for the original request lookup before opening a recovery file.');
        const selectedWorkspace=workspace,selectedFrame=frame,turn=mountTurn;if(file.size>128*1024*1024)throw Error('Choose a recovery file within 128 MiB.');const value=JSON.parse(await file.text());if(!activeTaskContext(selectedWorkspace,selectedFrame,turn))return;
        const recovered=await recoveryStore.importFile(value,pending);if(!activeTaskContext(selectedWorkspace,selectedFrame,turn))return;adoptRecoveredState(recovered);recoveryBlocked='';storageIssue=recoveryStore.warning;renderRecovery();await loadCatalog();if(pending?.id)await pollOriginal();return;
      }
      if(pending||recoveryBlocked){setBusy(busy);throw Error('Recover the original Economic request before changing its retained inputs.');}
      if(event.target.matches('[data-implementation-run]')){implementationRun=event.target.value;renderImplementation();return;}
      if(event.target.matches('[data-cost-worksheet]')){try{await readWorksheet(event.target.files?.[0]);}finally{event.target.value='';}return;}
      if(event.target.matches('[data-report]')){
        current();remember();
        const id=event.target.value;
        if(id){draft=blank(id);source=null;await loadSource(id);}
        else{epoch++;source=null;draft=blank();preview=null;node('[data-preview]').hidden=true;node('[data-zone-filter]').value='';renderReports();renderZones();renderSource();renderInputs();setBusy(false);remember();message('Choose a completed native report to begin.');}
        return;
      }
      if(event.target.matches('[data-zone]')){
        current();const oldZone=source?.zones.find(row=>row.zone_id===draft.zoneId),nextZone=event.target.value;
        if(nextZone!==draft.zoneId){
          for(const value of Object.values(draft.costs)){
            if(value.cost_scope==='whole-scenario')continue;
            if(value.enabled){
              value.enabled=false;
              value.needs_scope_review={producer_report_id:value.estimate_report_id||draft.reportId,
                zone_id:value.estimate_zone_id||draft.zoneId,zone_title:value.estimate_zone_title||oldZone?.title||draft.zoneId};
            }
          }
        }
        worksheetPreview=null;draft.zoneId=nextZone;
        if(draft.title===source.title+' · '+oldZone?.title)draft.title=source.title+' · '+(source.zones.find(row=>row.zone_id===draft.zoneId)?.title||'economic edition');
        preview=null;node('[data-preview]').hidden=true;
        renderSource();renderInputs();remember();return;
      }
      if(event.target.matches('[data-cost="enabled"],[data-cost="cost_scope"]')){
        current();
        const row=event.target.closest('[data-cost-run]'),value=draft.costs[row.dataset.costRun];
        const zone=source.zones.find(item=>item.zone_id===draft.zoneId);
        if(value.enabled&&(event.target.dataset.cost==='enabled'||event.target.dataset.cost==='cost_scope')){
          if(value.needs_scope_review){value.reviewed_from=value.needs_scope_review;delete value.needs_scope_review;}
          if(value.cost_scope!=='whole-scenario'){
            value.estimate_zone_id=draft.zoneId;value.estimate_zone_title=zone.title;value.estimate_report_id=draft.reportId;
          }
        }
        renderInputs();
      }
      preview=null;node('[data-preview]').hidden=true;current();remember();
    }catch(error){message(error.message||String(error),true);}
  }
  function onInput(event) {
    if(pending||recoveryBlocked){setBusy(busy);return;}
    if(event.target.matches('[data-zone-filter]'))return renderZones();
    preview=null;node('[data-preview]').hidden=true;current();remember();
  }
  function update(state=getState()) {
    if(!frame||workspace!==state?.workspace_key)return;
    const saved=state.data?.economic_editions;
    if(saved&&JSON.stringify(saved)!==rowFingerprint){catalog={...catalog,...saved};renderSaved(saved);setBusy(busy);}
    if(!pending?.id)return;
    const task=(state.tasks||[]).find(row=>row.id===pending.id);
    if(task&&!taskReading&&!requestSending)pollOriginal().catch(error=>message(error.message||String(error),true));
  }
  function mount(element,state=getState()) {
    root=element;workspace=state?.workspace_key;mountTurn++;clearTimeout(taskTimer);taskReading=false;requestSending=false;recoveryBlocked='';storageIssue='';
    recoveryStore=createEconomicRecoveryStore(workspace,'economic-desk',key());draft=blank();pending=null;lastReceipt=null;retiredRequest=null;openEditionId=null;
    shell();setBusy(true);const turn=mountTurn,selectedFrame=frame,selectedWorkspace=workspace;
    mountReady=(async()=>{
      const restored=await readMemory();if(!activeTaskContext(selectedWorkspace,selectedFrame,turn))return;adoptRecoveredState(restored);renderRecovery();await loadCatalog();
      if(!activeTaskContext(selectedWorkspace,selectedFrame,turn))return;
      if(pending?.id)await pollOriginal();
      else if(!pending&&!recoveryBlocked&&!requestedEdition&&openEditionId)await openEdition(openEditionId);
      renderRecovery();
    })();
    mountReady.then(()=>consumeSavedEdition()).catch(error=>{message(error.message||String(error),true);rejectSavedEdition(error);});
  }
  function detach() {
    clearTimeout(taskTimer);mountTurn++;taskReading=false;requestSending=false;
    if(frame)rejectSavedEdition(Error('The Economic desk closed before the retained edition opened.'));
    mountReady=null;
    if(frame){current();remember();frame.removeEventListener('click',onClick);frame.removeEventListener('change',onChange);frame.removeEventListener('input',onInput);}
    epoch++;editionEpoch++;root=null;frame=null;source=null;catalog=null;busy=false;preview=null;worksheetPreview=null;implementationOptions=null;implementationRun='';
  }
  async function openReport(selection) {
    if(!frame){const selectedWorkspace=getState()?.workspace_key,loaded=await createEconomicRecoveryStore(selectedWorkspace,'economic-desk','upstate-economic-desk:'+selectedWorkspace).load();if(getState()?.workspace_key!==selectedWorkspace)throw Error('The selected Workspace changed.');if(loaded.state?.pendingId||loaded.state?.pendingRequest)throw Error('Open the Economic desk and recover its original request before changing sources.');}
    if(pending||busy||recoveryBlocked)throw Error('Recover the original Economic request before opening a new source selection.');
    if(!selection?.report_id)throw Error('Choose an actual completed native report.');
    requestedSource={report_id:selection.report_id,zone_id:selection.zone_id||null};
    const wasMounted=!!frame;
    if(typeof host.navigate==='function')host.navigate('economic-desk');
    if(wasMounted&&frame)await loadCatalog({preserve:false});
  }
  function rejectSavedEdition(error) {
    const request=requestedEdition;if(!request)return;requestedEdition=null;request.reject(error);
  }
  async function consumeSavedEdition() {
    const request=requestedEdition;if(!request||!frame||request.consuming)return;
    request.consuming=true;
    try{
      if(mountReady)await mountReady;
      if(requestedEdition!==request)return;
      if(!frame||workspace!==request.workspace_key||getState()?.workspace_key!==request.workspace_key)throw Error('Open the retained edition in its original Workspace.');
      if(busy||pending||recoveryBlocked||requestedSource)throw Error('Finish or recover the original Economic operation before opening this retained edition.');
      current();remember();
      const value=await openEdition(request.edition_id);
      if(requestedEdition!==request)return;
      if(!value||!frame||workspace!==request.workspace_key||getState()?.workspace_key!==request.workspace_key)throw Error('The Workspace changed before the retained Economic edition opened.');
      requestedEdition=null;request.resolve({workspace_key:workspace,edition_id:request.edition_id,open_url:value.open_url});
    }catch(error){if(requestedEdition===request){requestedEdition=null;request.reject(error);}}
  }
  async function openSavedEdition(selection) {
    if(!selection||selection.workspace_key!==getState()?.workspace_key||typeof selection.edition_id!=='string'||!selection.edition_id.trim())return Promise.reject(Error('Choose the complete Economic edition in its original Workspace.'));
    if(requestedEdition)return Promise.reject(Error('The original retained edition is already opening.'));
    if(frame&&(busy||pending||recoveryBlocked||requestedSource))return Promise.reject(Error('Finish or recover the original Economic operation first.'));
    const stored=!frame?(await createEconomicRecoveryStore(selection.workspace_key,'economic-desk','upstate-economic-desk:'+selection.workspace_key).load()).state:null;
    if(getState()?.workspace_key!==selection.workspace_key)throw Error('The selected Workspace changed.');
    if(requestedEdition)throw Error('The original retained edition is already opening.');
    if(frame&&(busy||pending||recoveryBlocked||requestedSource))throw Error('Finish or recover the original Economic operation first.');
    if(stored?.pendingId||stored?.pendingRequest)throw Error('Open the Economic desk and reconcile its retained original task before opening another edition.');
    return new Promise((resolve,reject)=>{
      requestedEdition={workspace_key:selection.workspace_key,edition_id:selection.edition_id,resolve,reject,consuming:false};
      try{
        if(typeof host.navigate!=='function')throw Error('The original Economic navigation capability is unavailable.');
        host.navigate('economic-desk');
        if(frame)consumeSavedEdition();
      }catch(error){rejectSavedEdition(error);}
    });
  }
  return {mount,update,detach,openReport,openEdition,openSavedEdition,loadSaved,prepareClientReport,prepareImplementation};
}
