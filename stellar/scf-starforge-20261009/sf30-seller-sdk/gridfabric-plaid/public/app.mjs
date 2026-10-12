// MIT. Industrial operator over the original authenticated GridFabric workspace.
const $=id=>document.getElementById(id),format=value=>JSON.stringify(value,null,2);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes=n=>new Intl.NumberFormat().format(n??0)+' bytes';
const label=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const idOf=(collection,row)=>row.id??row[{instances:'instance_id',instance_editions:'edition_id',sources:'source_id',source_rows:'row_id',
  source_issues:'issue_id',mappings:'mapping_id',events:'id',event_revisions:'revision_id',callbacks:'callback_id',
  callback_deliveries:'delivery_id',distributions:'distribution_id',opt_decisions:'decision_id',device_actions:'device_action_id',
  reports:'report_id',report_rows:'report_row_id',management_operations:'operation_id',management_receipts:'receipt_id',operations:'request_id'}[collection]];
const model={token:location.hash.slice(1)||sessionStorage.getItem('gridfabric-connection')||'',state:null,launch:null,contracts:null,
  section:'overview',busy:false,pending:null,history:[],storageKey:null,selected:null,dispatch:null,recordPage:null,recent:{},inspectorGeneration:0};
if(location.hash){sessionStorage.setItem('gridfabric-connection',model.token);history.replaceState(null,'',location.pathname+location.search);}
let disabledBefore=new Map();
function notice(message,error=false){
  $('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=!message;
}
function setBusy(value,message='Working with the original workspace'){
  model.busy=value;document.body.classList.toggle('busy',value);$('footer-status').textContent=value?message:'Original owner connected';
  if(value){
    disabledBefore=new Map();
    for(const element of document.querySelectorAll('button[type="submit"],#dispatch-send,#export-create,#pending-read,#pending-continue,#pending-dismiss,#pending-reconcile,#refresh')){
      disabledBefore.set(element,element.disabled);element.disabled=true;
    }
  }else{
    for(const [element,disabled] of disabledBefore)element.disabled=disabled;
    disabledBefore.clear();renderPending();renderDispatch();
  }
}
async function guarded(fn,message){
  if(model.busy){notice('The original operation is still in progress.');return;}
  setBusy(true,message);
  try{return await fn();}catch(error){notice((error.code?error.code+': ':'')+error.message,true);console.error(error);}
  finally{setBusy(false);}
}
async function api(path,{method='GET',body,headers={},raw=false,timeout=660000}={}){
  if(!model.token){$('connection-panel').hidden=false;throw Object.assign(new Error('Open the private original connection.'),{code:'GRIDFABRIC_OPERATOR_AUTH'});}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const requestHeaders={Authorization:'Bearer '+model.token,...headers};
    if(body!==undefined&&!raw)requestHeaders['Content-Type']='application/json';
    const response=await fetch(path,{method,headers:requestHeaders,body:body===undefined?undefined:raw?body:JSON.stringify(body),
      credentials:'omit',cache:'no-store',signal:controller.signal});
    if(!response.ok){
      let original;try{original=await response.json();}catch{original=null;}
      const detail=original?.error||{},error=Object.assign(new Error(detail.message||'The original owner returned HTTP '+response.status),
        {code:detail.code||'GRIDFABRIC_HTTP_ERROR',http_status:response.status,original});
      if(response.status===401)$('connection-panel').hidden=false;
      throw error;
    }
    const consume=method=>async()=>{try{return await response[method]();}finally{clearTimeout(timer);}};
    return {status:response.status,ok:response.ok,headers:response.headers,url:response.url,
      json:consume('json'),arrayBuffer:consume('arrayBuffer'),text:consume('text')};
  }catch(error){clearTimeout(timer);throw error;}
}
const read=async path=>(await api(path)).json();
async function sha256(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function jsonInput(id){
  let value;try{value=JSON.parse($(id).value);}catch{throw new Error('Enter complete valid JSON in '+$(id).closest('label').firstChild.textContent.trim()+'.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The original action input must be a JSON object.');
  return value;
}
function persist(){
  if(!model.storageKey)throw new Error('Connect the original workspace before saving a request.');
  localStorage.setItem(model.storageKey,JSON.stringify({workspace_id:model.state.workspace_id,pending:model.pending,history:model.history.slice(-50)}));
}
function loadLocal(){
  const value=localStorage.getItem(model.storageKey);
  if(!value)return;
  const retained=JSON.parse(value);
  if(retained.workspace_id!==model.state.workspace_id)throw new Error('The saved browser request belongs to another workspace.');
  model.pending=retained.pending||null;model.history=retained.history||[];
}
function requireNoPending(){
  if(model.pending){showSection('recovery');throw new Error('Read or reconcile the saved original request before starting another action.');}
}
function summarized(value){
  if(!value||typeof value!=='object')return value;
  const keys=['request_id','revision','action','status','source_id','mapping_id','instance_id','report_id','row_count','issue_count',
    'operation_id','attempt_id','device_action_id','export_id','workspace_id','directory','dispatch_status','replayed'];
  return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}
function completedPending(value){
  const pending=model.pending;
  model.history.push({request_id:pending.request_id,label:pending.label,kind:pending.kind,created_at:pending.created_at,
    observed_at:new Date().toISOString(),status:'OBSERVED',request:{path:pending.path,body:pending.body,workspace_id:pending.workspace_id},result:summarized(value)});
  model.pending=null;persist();renderPending();return value;
}
async function transmit(pending){
  try{
    const response=await api(pending.path,{method:'POST',body:pending.body}),value=await response.json();
    if(pending.kind==='dispatch'&&value.host_dispatch?.status!=='COMPLETE'){
      model.pending={...pending,status:'ORIGINAL_OPERATION_RETAINED',original:value,canContinue:false,absenceVerified:false};
      persist();await recoverPending();return value;
    }
    completedPending(value);await refresh();notice('Recorded '+pending.label+'.');return value;
  }catch(error){
    model.pending={...pending,status:'OUTCOME_NOT_CONFIRMED',error:{code:error.code||error.name,message:error.message},observed_at:new Date().toISOString()};
    persist();renderPending();throw error;
  }
}
async function mutate(action,input,labelText=label(action)){
  requireNoPending();const request_id=crypto.randomUUID(),body={action,input,request_id,expected_revision:model.state.revision};
  model.pending={kind:'action',label:labelText,path:'/api/action',body,request_id,workspace_id:model.state.workspace_id,
    created_at:new Date().toISOString(),status:'PREPARED'};
  persist();renderPending();return transmit(model.pending);
}
async function dispatch(){
  requireNoPending();const selected=model.dispatch;
  if(!selected)throw new Error('Inspect the original request before dispatch.');
  const kind=$('dispatch-kind').value,id=$('dispatch-id').value.trim();
  if(kind!==selected.kind||id!==selected.id)throw new Error('Inspect this original operation before dispatch.');
  const current=(await read('/api/detail?'+new URLSearchParams({collection:kind==='management'?'management_operations':'device_actions',id}))).record;
  if(current.status!==(kind==='management'?'PREPARED':'QUEUED'))throw new Error('This original operation has already left its prepared state. Read its retained outcome.');
  const state=await read('/api/state');model.state=state;renderState();
  const request_id=crypto.randomUUID(),input=kind==='management'?{operation_id:id}:{device_action_id:id};
  model.pending={kind:'dispatch',label:kind==='management'?'management dispatch':'device dispatch',path:'/api/dispatch/'+kind,
    body:{input,request_id,expected_revision:state.revision},request_id,workspace_id:state.workspace_id,
    created_at:new Date().toISOString(),status:'PREPARED'};
  persist();renderPending();const result=await transmit(model.pending);await inspectDispatch();return result;
}
async function createExport(){
  requireNoPending();const request_id=crypto.randomUUID();
  model.pending={kind:'export',label:'complete portable export',path:'/api/export',
    body:{request_id,expected_revision:model.state.revision},request_id,workspace_id:model.state.workspace_id,
    created_at:new Date().toISOString(),status:'PREPARED'};
  persist();renderPending();const result=await transmit(model.pending);
  $('export-result').replaceChildren(fileNode(result,result.download_url));return result;
}
function dispatchBinding(pending){
  if(pending.kind!=='dispatch')throw new Error('The pending request is not an original dispatch.');
  const kind=pending.path==='/api/dispatch/management'?'management':pending.path==='/api/dispatch/device'?'device':null;
  const key=kind==='management'?'operation_id':'device_action_id',id=pending.body?.input?.[key];
  if(!kind||typeof id!=='string'||!id)throw new Error('The saved original dispatch binding is incomplete.');
  return {kind,key,id,collection:kind==='management'?'management_operations':'device_actions'};
}
async function observedDispatch(pending,observed){
  const binding=dispatchBinding(pending),host=observed.host_dispatch,captured=host?.captured||observed.operation?.result;
  if(host&&(host.request_id!==pending.request_id||host.kind!==binding.kind||host.operation_id!==binding.id))
    throw new Error('The native host journal differs from the saved original dispatch.');
  if(!captured?.attempt_id||captured[binding.key]!==binding.id)
    throw new Error('The original begun attempt is not available for bound recovery.');
  const record=(await read('/api/detail?'+new URLSearchParams({collection:binding.collection,id:binding.id}))).record;
  if(record[binding.key]!==binding.id||record.attempt_id!==captured.attempt_id)
    throw new Error('The current operation differs from the captured original attempt.');
  return {...binding,attempt_id:captured.attempt_id,record,host:host||null};
}
function recordReconciledPending(pending,observed){
  const record=observed.record;
  model.history.push({request_id:pending.request_id,label:pending.label,kind:pending.kind,created_at:pending.created_at,
    observed_at:new Date().toISOString(),status:record.status==='UNKNOWN'?'UNKNOWN_RECORDED':record.status,
    request:{path:pending.path,body:pending.body,workspace_id:pending.workspace_id},
    recovery_history:pending.recovery_history||[],host_dispatch:observed.host,
    result:{[observed.key]:observed.id,attempt_id:observed.attempt_id,status:record.status,
      reconciliation:record.reconciliation||null,recoveries:record.recoveries||[]}});
  model.pending=null;persist();renderPending();
}
function hasOriginalReconciliation(observed){
  const record=observed.record;
  if(!['UNKNOWN','RECONCILED_COMPLETE','RECONCILED_NOT_APPLIED'].includes(record.status))return false;
  return record.reconciliation?.attempt_id===observed.attempt_id||
    (record.status==='UNKNOWN'&&(record.recoveries||[]).some(row=>row.attempt_id===observed.attempt_id));
}
function saveRecoveryOutcome(value){
  const pending=model.pending,recovery=pending?.recovery;
  if(!recovery)throw new Error('The original recovery request is no longer selected.');
  if(value.request_id!==recovery.request_id||value.workspace_id!==pending.workspace_id)
    throw new Error('The native recovery outcome belongs to another request or workspace.');
  pending.recovery_history=[...(pending.recovery_history||[]),{...recovery,status:'OBSERVED',observed_at:new Date().toISOString(),result:value}];
  delete pending.recovery;persist();renderPending();
}
async function transmitRecovery(){
  const pending=model.pending,recovery=pending?.recovery;
  if(!recovery)throw new Error('No original recovery action is pending.');
  let value;
  try{value=await(await api(recovery.path,{method:'POST',body:recovery.body})).json();}
  catch(error){
    if(model.pending?.request_id===pending.request_id&&model.pending.recovery?.request_id===recovery.request_id){
      model.pending.recovery={...recovery,status:'OUTCOME_NOT_CONFIRMED',canContinue:false,absenceVerified:false,
        error:{code:error.code||error.name,message:error.message},observed_at:new Date().toISOString()};
      persist();renderPending();
    }
    throw error;
  }
  saveRecoveryOutcome(value);await recoverPending();await refresh();return value;
}
async function recoverChild(state){
  const pending=model.pending,recovery=pending.recovery;
  try{
    const observed=await read('/api/operation?'+new URLSearchParams({request_id:recovery.request_id}));
    if(observed.operation?.result){saveRecoveryOutcome(observed.operation.result);return true;}
    pending.recovery={...recovery,status:'ORIGINAL_RECOVERY_RETAINED',canContinue:false,absenceVerified:false,original:observed};
  }catch(error){
    if(error.http_status!==404||error.code!=='GRIDFABRIC_OPERATION_NOT_FOUND')throw error;
    pending.recovery={...recovery,status:'NOT_ACCEPTED',absenceVerified:true,
      canContinue:state.revision===recovery.body.expected_revision};
  }
  persist();renderPending();notice(pending.recovery.canContinue?
    'The bound recovery action was not accepted. Continue its same UUID and input.':
    pending.recovery.absenceVerified?'The recovery draft was not accepted. Archive only this draft, then review recovery against the current revision.':
    'The original recovery action remains retained. Read its exact outcome before another action.');
  return false;
}
async function reconcilePending(action,input){
  if(!model.pending)return mutate(action,input);
  await recoverPending();
  if(!model.pending)return mutate(action,input);
  const pending=model.pending;
  if(pending.kind!=='dispatch'||pending.recovery)
    throw new Error('Receive the existing saved action before another reconciliation.');
  const binding=dispatchBinding(pending);
  if(action!=='recover_dispatches'&&action!==(binding.kind==='management'?'reconcile_management':'reconcile_device_action'))
    throw new Error('Only a reconciliation for this exact original dispatch is permitted while it is pending.');
  if(action!=='recover_dispatches'&&input[binding.key]!==binding.id)
    throw new Error('Select the original pending operation identity in the reconciliation input.');
  const native=await read('/api/operation?'+new URLSearchParams({request_id:pending.request_id}));
  const observation=await observedDispatch(pending,native);
  if(action==='recover_dispatches'&&observation.record.status!=='SENDING')
    throw new Error('The original attempt is already out of SENDING. Record its matching reviewed disposition.');
  const state=await read('/api/state');
  if(state.workspace_id!==pending.workspace_id)throw new Error('The original workspace identity changed.');
  model.state=state;
  const request_id=crypto.randomUUID();
  pending.recovery={kind:'action',label:label(action),path:'/api/action',request_id,workspace_id:pending.workspace_id,
    body:{action,input,request_id,expected_revision:state.revision},created_at:new Date().toISOString(),status:'PREPARED',
    dispatch_binding:{request_id:pending.request_id,kind:binding.kind,id:binding.id,attempt_id:observation.attempt_id}};
  pending.canContinue=false;pending.absenceVerified=false;persist();renderPending();
  return transmitRecovery();
}
async function recoverPending(){
  let pending=model.pending;if(!pending){notice('No original browser request is pending.');return;}
  const state=await read('/api/state');
  if(state.workspace_id!==pending.workspace_id)throw new Error('This connection belongs to another original workspace.');
  model.state=state;renderState();
  if(pending.recovery){if(!await recoverChild(state))return;pending=model.pending;}
  if(pending.kind==='export'){
    const catalogue=await read('/api/exports'),item=catalogue.items.find(item=>item.export_id===pending.request_id);
    if(item?.status==='READY'){completedPending(item);await refresh();notice('The original portable export is complete.');return;}
    model.pending={...pending,status:item?.status||'NOT_ACCEPTED',canContinue:Boolean(item)||state.revision===pending.body.expected_revision,
      absenceVerified:!item,original:item||null};persist();renderPending();return;
  }
  if(pending.kind==='restore'){
    try{
      const outcome=await read('/api/restore-status?'+new URLSearchParams({name:pending.destination_name,sha256:pending.file_sha256}));
      if(outcome.source?.sha256!==pending.file_sha256)throw new Error('The original destination records another portable file.');
      completedPending(outcome);$('restore-result').textContent='Original receiving completed: '+outcome.directory;notice(outcome.current?.matches_snapshot===false?'The original restoration completed. The receiving workspace has since advanced; its saved restoration identity remains retained.':'The original cold receiving outcome is retained.');return;
    }catch(error){if(error.http_status!==404)throw error;}
    model.pending={...pending,status:'RESTORE_NOT_CONFIRMED',canContinue:false,absenceVerified:false};persist();renderPending();
    notice('Reselect the same portable file and use the original receiving request. The native receiver preserves its exact pending stage.');return;
  }
  try{
    const observed=await read('/api/operation?'+new URLSearchParams({request_id:pending.request_id}));
    if(pending.kind==='dispatch'){
      if(observed.host_dispatch?.status==='COMPLETE'){completedPending(observed.host_dispatch.result);await refresh();notice('The original dispatch receipt was received without another send.');return;}
      const dispatch=await observedDispatch(pending,observed);
      if(hasOriginalReconciliation(dispatch)){
        recordReconciledPending(pending,dispatch);await refresh();
        notice('The original attempt is recorded as '+dispatch.record.status+'. Its dispatch and reviewed recovery remain in saved history.');return;
      }
      model.pending={...pending,status:'ORIGINAL_OPERATION_RETAINED',canContinue:Boolean(dispatch.host?.receipt),
        canReconcile:true,absenceVerified:false,original:observed,native_operation:dispatch.record};
      persist();renderPending();notice(dispatch.host?.receipt?
        'The native receipt is retained. Continue the same UUID to finish receiving that receipt without sending again.':
        'The original attempt is retained. Open its bound reconciliation; no dispatch will be repeated.');return;
    }
    if(observed.operation?.result){completedPending(observed.operation.result);await refresh();notice('The original action completed and its saved result was received.');return;}
    model.pending={...pending,status:'ORIGINAL_OPERATION_RETAINED',canContinue:false,absenceVerified:false,original:observed};
    persist();renderPending();notice('The original operation is retained. Read its saved outcome.');return;
  }catch(error){
    if(error.http_status!==404||error.code!=='GRIDFABRIC_OPERATION_NOT_FOUND')throw error;
    model.pending={...pending,status:'NOT_ACCEPTED',absenceVerified:true,
      canContinue:pending.kind==='action'&&state.revision===pending.body.expected_revision};
    persist();renderPending();
    notice(model.pending.canContinue?'The exact original request was not accepted. You may continue the same local UUID and input.':
      'The original request was not accepted. Archive this draft before reviewing a new action.');
  }
}
function renderPending(){
  const pending=model.pending,active=pending?.recovery||pending;
  $('pending-summary').innerHTML=pending?'<div class="record-summary">'+statusBadge(active.status)+'<strong>'+escape(active.label)+'</strong></div>'+
    '<dl><dt>Original request UUID</dt><dd class="mono">'+escape(pending.request_id)+'</dd>'+
    (pending.recovery?'<dt>Bound recovery UUID</dt><dd class="mono">'+escape(pending.recovery.request_id)+'</dd>':'')+
    '<dt>Saved revision</dt><dd>'+escape(active.body?.expected_revision??'Portable receiving')+
    '</dd><dt>Recorded</dt><dd>'+escape(active.created_at)+'</dd></dl>'+(active.error?'<p>'+escape(active.error.message)+'</p>':''):
    '<p class="empty">No pending original request.</p>';
  $('pending-json').textContent=pending?format(pending):'';
  $('pending-read').disabled=model.busy||!pending;
  $('pending-continue').disabled=model.busy||!active?.canContinue;
  $('pending-continue').textContent=!pending?.recovery&&pending?.kind==='dispatch'?'Finish saved receipt':'Continue same local request';
  $('pending-dismiss').disabled=model.busy||!active?.absenceVerified;
  $('pending-dismiss').textContent=pending?.recovery?'Archive unaccepted recovery draft':'Archive unaccepted request';
  $('pending-reconcile').disabled=model.busy||pending?.kind!=='dispatch'||!pending?.canReconcile||Boolean(pending?.recovery);
  const historyRows=[...model.history].reverse().map(row=>({id:row.request_id,...row}));
  simpleTable('local-history','operations',historyRows,{local:true});
}
function statusBadge(value){
  const s=String(value??'—'),needs=/UNKNOWN|NEEDS|FAILED|ERROR|REJECT|UNPROJECTED|CONFLICT|PENDING|INTERRUPT/.test(s);
  return '<span class="status '+(needs?'needs':/READY|COMPLETE|ACCEPTED|OBSERVED/.test(s)?'complete':'')+'">'+escape(s)+'</span>';
}
function display(value,maximum=110){
  if(value===null||value===undefined)return '—';
  const text=typeof value==='object'?JSON.stringify(value):String(value);
  return text.length>maximum?text.slice(0,maximum)+'…':text;
}
function rowTitle(row){
  return row.name??row.label??row.action??row.namespace??row.callback_kind??row.message_type??row.event_id??row.r_id??row.device_id??row.request_id??row.id??'Original record';
}
function simpleTable(target,collection,rows,{local=false}={}){
  const node=typeof target==='string'?$(target):target;
  if(!rows.length){node.innerHTML='<p class="empty">No original records in this selection.</p>';return;}
  const table=document.createElement('div');table.className='table-wrap';
  table.innerHTML='<table><thead><tr><th>Original record</th><th>State / action</th><th>Details</th><th>Recorded</th><th>Open</th></tr></thead><tbody>'+
    rows.map((row,index)=>{
      const details=[row.row_count!==undefined?row.row_count+' rows':null,row.issue_count!==undefined?row.issue_count+' issues':null,
        row.valid_rows!==undefined?row.valid_rows+' valid':null,row.instance_id,row.r_id].filter(v=>v!==null&&v!==undefined&&v!=='').join(' · ');
      return '<tr><td>'+escape(display(rowTitle(row)))+'<small class="mono">'+escape(display(idOf(collection,row)||'',65))+'</small></td><td>'+
        statusBadge(row.status||row.processing_status||row.action||'RETAINED')+'</td><td>'+escape(display(details||row.original_line||row.created_at||''))+
        '</td><td>'+escape(String(row.created_at||row.observed_at||row.updated_at||'').replace('T',' ').replace('Z',''))+'</td><td><button type="button" data-row="'+index+'">View</button></td></tr>';
    }).join('')+'</tbody></table>';
  table.querySelectorAll('button[data-row]').forEach(button=>button.addEventListener('click',()=>guarded(async()=>{
    const row=rows[Number(button.dataset.row)];
    if(local){showRaw('Browser receiving note',row);return;}
    if(collection==='host_files'){await download('/api/file?id='+encodeURIComponent(row.sha256),row);return;}
    if(collection==='host_dispatches'){showRaw('Original host dispatch',row);return;}
    await inspectRecord(collection,idOf(collection,row));
  })));
  node.replaceChildren(table);
}
async function nativePage(collection,{scope,offset=0,limit=8,order='desc',tag}={}){
  const params=new URLSearchParams({collection,offset:String(offset),limit:String(limit),order});
  if(scope!==undefined&&scope!=='')params.set('scope',scope);if(tag!==undefined&&tag!=='')params.set('tag',tag);
  return read((collection.startsWith('host_')?'/api/host/page?':'/api/page?')+params);
}
function renderState(){
  if(!model.state)return;
  $('workspace-name').textContent=model.state.name;$('workspace-id').textContent=model.state.workspace_id;
  $('workspace-revision').textContent='Revision '+model.state.revision;$('connection-state').textContent='Original owner connected';
  const selections=[['sources','Sources'],['source_rows','Original rows'],['source_issues','Source issues'],['mappings','Mapping editions'],
    ['callbacks','Callbacks'],['events','Events'],['reports','Reports'],['management_operations','Management operations']];
  $('counts').innerHTML=selections.map(([key,text])=>'<div class="count"><button data-open-collection="'+key+'"><strong>'+
    new Intl.NumberFormat().format(model.state.collections[key]||0)+'</strong><span>'+text+'</span></button></div>').join('');
}
async function refreshLists(){
  const pairs=[['operations','recent-actions'],['instances','instance-list'],['sources','source-list'],['mappings','mapping-list'],
    ['events','event-list'],['device_actions','device-list'],['reports','report-list'],['management_operations','management-list']];
  const results=await Promise.allSettled(pairs.map(async([collection,target])=>{
    const page=await nativePage(collection);model.recent[collection]=page;simpleTable(target,collection,page.rows);
    if(page.total>page.rows.length){const caption=document.createElement('p');caption.className='caption';caption.textContent='Showing '+page.rows.length+' most recent of '+page.total+' original records. All pages are available in All records.';$(target).append(caption);}
  }));
  for(const result of results)if(result.status==='rejected')throw result.reason;
}
async function refreshExports(){
  const data=await read('/api/exports');$('export-list').replaceChildren();
  if(!data.items.length){$('export-list').innerHTML='<p class="empty">No portable export has been prepared.</p>';return;}
  for(const item of data.items){
    const element=document.createElement('div');element.className='panel';
    element.innerHTML='<div class="record-summary">'+statusBadge(item.status)+'<strong>Revision '+escape(item.revision)+'</strong><span>'+escape(item.created_at)+'</span></div>';
    if(item.status==='READY')element.append(fileNode(item,item.download_url));
    else{const pre=document.createElement('pre');pre.textContent=format(item);element.append(pre);}
    $('export-list').append(element);
  }
}
async function refresh(){
  const state=await read('/api/state');
  if(model.state&&model.state.workspace_id!==state.workspace_id)throw new Error('This listener now identifies a different original workspace.');
  model.state=state;renderState();await Promise.all([refreshLists(),refreshExports()]);
  if(model.section==='records')await readRecordPage();
}
function showSection(name){
  if(!$('section-'+name))return;model.section=name;
  document.querySelectorAll('.section').forEach(section=>{section.hidden=section.id!=='section-'+name;});
  document.querySelectorAll('nav [data-section]').forEach(button=>{if(button.dataset.section===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
}
function fileRefs(value){
  const result=new Map(),stack=[value];
  while(stack.length){
    const current=stack.pop();if(!current||typeof current!=='object')continue;
    if(typeof current.sha256==='string'&&/^[0-9a-f]{64}$/.test(current.sha256)&&Number.isSafeInteger(current.bytes)&&(current.name||current.mime_type))
      result.set(current.sha256,current);
    for(const child of Object.values(current))if(child&&typeof child==='object')stack.push(child);
  }return [...result.values()];
}
function fileNode(metadata,path='/api/file?id='+encodeURIComponent(metadata.sha256)){
  const node=document.createElement('div');node.className='file-item';
  const body=document.createElement('div');body.className='file-meta';
  body.innerHTML='<strong>'+escape(metadata.name||metadata.sha256)+'</strong><small>'+bytes(metadata.bytes)+' · '+escape(metadata.sha256||'')+'</small>';
  const button=document.createElement('button');button.type='button';button.textContent='Download original';
  button.addEventListener('click',()=>guarded(()=>download(path,metadata),'Receiving complete original bytes'));
  node.append(body,button);return node;
}
async function download(path,metadata={}){
  const response=await api(path),buffer=await response.arrayBuffer(),sha=await sha256(buffer);
  const declared=response.headers.get('x-content-sha256')||metadata.sha256;
  if(declared&&sha!==declared)throw new Error('The downloaded original SHA256 differs.');
  if(metadata.bytes!==undefined&&buffer.byteLength!==metadata.bytes)throw new Error('The complete downloaded original byte count differs.');
  const blob=new Blob([buffer],{type:response.headers.get('content-type')||metadata.mime_type||'application/octet-stream'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=metadata.name||'GridFabric_Original_'+sha;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  notice('Received complete '+(metadata.name||'original file')+' · '+bytes(buffer.byteLength)+' · '+sha);
  return {bytes:buffer.byteLength,sha256:sha};
}
function showRaw(title,record,files=fileRefs(record)){
  $('inspector').hidden=false;$('inspector-title').textContent=title;$('inspector-json').textContent=format(record);
  $('inspector-summary').innerHTML='<div class="record-summary">'+statusBadge(record?.status||record?.processing_status||'RETAINED')+'</div>';
  $('inspector-actions').replaceChildren();$('inspector-files').replaceChildren(...files.map(file=>fileNode(file)));
  $('inspector').scrollIntoView({block:'start',behavior:'auto'});
}
function addAction(text,callback){
  const button=document.createElement('button');button.type='button';button.textContent=text;button.addEventListener('click',()=>guarded(callback));$('inspector-actions').append(button);
}
async function inspectRecord(collection,id){
  if(!id)throw new Error('The original record has no selectable identity.');
  const generation=++model.inspectorGeneration,detail=await read('/api/detail?'+new URLSearchParams({collection,id}));
  if(generation!==model.inspectorGeneration)return;
  model.selected={collection,id,record:detail.record};showRaw(label(collection)+' / '+id,detail.record);
  const row=detail.record;
  if(collection==='instances'){
    addAction('Edit as new instance edition',async()=>{
      const keys=['instance_id','name','management_url','management_headers_env','callback_headers_env','callback_basic_user_env','callback_basic_password_env',
        'plugin_api_version','plugin_version','schema_source_id','bindings','devices','device_adapter_url','device_adapter_headers_env'];
      $('instance-input').value=format(Object.fromEntries(keys.filter(k=>row[k]!==undefined&&row[k]!==null).map(k=>[k,row[k]])));
      renderRoutes(row.instance_id);showSection('instances');$('instance-input').focus();
    });renderRoutes(row.instance_id);
  }
  if(collection==='sources'){
    const channels=row.device_channels||[];
    if(channels.length){
      const select=document.createElement('select');select.setAttribute('aria-label','Original device and channel');
      for(const channel of channels){const option=document.createElement('option');option.value=JSON.stringify([channel.device_id,channel.channel]);
        option.textContent=channel.device_id+' / '+channel.channel+' · '+channel.kind+' · '+channel.rows+' rows';select.append(option);}
      $('inspector-actions').append(select);
      addAction('Read selected channel rows',()=>{const [device,channel]=JSON.parse(select.value);return openCollection('source_rows',id+'\0'+device+'\0'+channel);});
    }
    addAction('All source issues',()=>openCollection('source_issues',id));
    addAction('Use as correction predecessor',async()=>{$('source-corrects').value=id;showSection('sources');});
  }
  if(collection==='mappings'){
    addAction('Review activation',async()=>{$('activation-id').value=id;showSection('mappings');$('activation-reviewer').focus();});
    addAction('Use as new mapping draft',async()=>{$('mapping-input').value=format({instance_id:row.instance_id,name:row.name+' correction',reviewer:'',
      entries:row.entries,registration_response:row.registration_response,source_evidence:(row.source_evidence||[]).map(item=>typeof item==='string'?item:item.source_id)});
      showSection('mappings');});
  }
  if(collection==='reports'){addAction('All report rows',()=>openCollection('report_rows',id));renderReport(row);showSection('reports');}
  if(collection==='events'){
    addAction('Review event decision',async()=>{$('event-action-name').value='record_opt_decision';setEventTemplate(row);showSection('events');});
  }
  if(collection==='management_operations'||collection==='device_actions'){
    addAction('Review original dispatch',async()=>{$('dispatch-kind').value=collection==='device_actions'?'device':'management';$('dispatch-id').value=id;
      showSection('management');await inspectDispatch();});
  }
  if(collection==='callbacks')addAction('Every original delivery',()=>openCollection('callback_deliveries',id));
}
function renderRoutes(instanceId){
  $('callback-routes').innerHTML=model.contracts.public.callbacks.map(route=>'<div class="route"><strong>'+escape(route.messageType)+'</strong><code>'+
    escape(location.origin+'/callbacks/'+encodeURIComponent(instanceId)+'/'+route.endpoint)+'</code></div>').join('');
}
function renderReport(row){
  $('report-result').innerHTML='<h3>Original report</h3><div class="record-summary">'+statusBadge(row.status)+'<span>'+escape(row.row_count)+' rows · '+escape(row.issue_count)+' issues</span></div>'+
    '<dl><dt>Report</dt><dd class="mono">'+escape(row.report_id)+'</dd><dt>Mapping</dt><dd class="mono">'+escape(row.mapping_id||'')+'</dd></dl>';
  for(const file of fileRefs(row))$('report-result').append(fileNode(file));
  const button=document.createElement('button');button.textContent='Read every report row';button.addEventListener('click',()=>guarded(()=>openCollection('report_rows',row.report_id)));$('report-result').append(button);
}
async function inspectDispatch(){
  const kind=$('dispatch-kind').value,id=$('dispatch-id').value.trim();
  if(!id){model.dispatch=null;renderDispatch();return;}
  const detail=await read('/api/detail?'+new URLSearchParams({collection:kind==='management'?'management_operations':'device_actions',id}));
  model.dispatch={kind,id,record:detail.record};renderDispatch();
}
function renderDispatch(){
  const selected=model.dispatch,kind=$('dispatch-kind').value;
  $('dispatch-send').textContent=kind==='device'?'Send device request':'Send management request';
  $('dispatch-send').disabled=model.busy||!selected||selected.kind!==kind||selected.id!==$('dispatch-id').value.trim()||
    selected.record.status!==(kind==='management'?'PREPARED':'QUEUED');
  if(!selected){$('dispatch-review').innerHTML='<p class="empty">Select and inspect the original request.</p>';return;}
  const row=selected.record;
  $('dispatch-review').innerHTML='<div class="record-summary">'+statusBadge(row.status)+'</div><dl><dt>Endpoint</dt><dd>'+escape(row.endpoint||'Configured original adapter')+
    '</dd><dt>Attempt</dt><dd class="mono">'+escape(row.attempt_id||'Not started')+'</dd></dl>';
  for(const file of fileRefs(row))$('dispatch-review').append(fileNode(file));
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
  summary.textContent='Complete captured operation';pre.textContent=format(row);details.append(summary,pre);$('dispatch-review').append(details);
}
async function openCollection(collection,scope=''){
  $('record-collection').value=collection;$('record-scope').value=scope.replaceAll('\0',' / ');$('record-scope').dataset.rawScope=scope;$('record-tag').value='';$('record-offset').value='0';
  showSection('records');await readRecordPage();
}
async function readRecordPage(){
  const collection=$('record-collection').value;
  const page=await nativePage(collection,{scope:$('record-scope').dataset.rawScope??$('record-scope').value.trim(),tag:$('record-tag').value.trim(),
    offset:Number($('record-offset').value),limit:Number($('record-limit').value),order:$('record-order').value});
  model.recordPage=page;simpleTable('record-table',collection,page.rows);
  $('record-count').textContent=page.total?'Rows '+(page.offset+1)+'–'+(page.offset+page.rows.length)+' of '+page.total+' · '+label(collection):'No records in this original selection';
  $('record-previous').disabled=page.offset===0;$('record-next').disabled=page.next_offset===null;
}
const instanceTemplate=()=>({instance_id:'',name:'',management_url:'http://127.0.0.1:8000/',management_headers_env:{},
  callback_headers_env:{},plugin_api_version:'',plugin_version:'',schema_source_id:null,bindings:{},devices:[]});
const profileTemplate=format=>({rows_pointer:format==='json'?'/rows':undefined,fields:format==='json'?
  {device_id:'/device',channel:'/channel',kind:'/kind',start:'/start',end:'/end',value:'/value',unit:'/unit',data_quality:'/quality',status:'/status'}:
  {device_id:'device',channel:'channel',kind:'kind',start:'start',end:'end',value:'value',unit:'unit',data_quality:'quality',status:'status'},
  constants:{},timestamp_format:'iso8601',value_semantics:{energy:'interval_energy',power:'interval_average_power',status:'status'}});
function setEventTemplate(row={}){
  const action=$('event-action-name').value,instance_id=row.instance_id||'',event_id=row.event_id||'';
  const templates={
    record_opt_decision:{instance_id,event_id,opt_type:'optIn',opt_reason:'participating',reviewer:'',source_evidence:[]},
    reconcile_distribution:{distribution_id:'',complete:true,event_ids:[],reviewer:'',source_evidence:[]},
    project_event_history:{instance_id,reviewer:'',source_evidence:[]},
    resume_event_callback:{callback_id:'',event_id,expected_event_revision:row.current_revision??null,reviewer:'',source_evidence:[]}
  };
  $('event-action-input').value=format(templates[action]||{});
}
function setReconcileTemplate(){
  const action=$('reconcile-name').value;
  $('reconcile-input').value=format(action==='recover_dispatches'?{reviewer:'',reason:''}:
    {[action==='reconcile_management'?'operation_id':'device_action_id']:$('dispatch-id').value.trim(),disposition:'still_unknown',reviewer:'',reason:'',source_evidence:[]});
}
function setManagementTemplate(){
  const namespace=$('management-example').value,example=model.contracts.examples.management_requests.find(x=>x.body?.namespace===namespace);
  $('management-input').value=format({instance_id:'',namespace,parameters:structuredClone(example?.body?.parameters||{}),reviewer:''});
}
async function connect(){
  model.launch=await read('/api/launch');model.state=await read('/api/state');
  if(model.launch.workspace_id!==model.state.workspace_id)throw new Error('The original launch and workspace identities differ.');
  model.storageKey='gridfabric-original-operator:'+model.state.workspace_id;loadLocal();
  model.contracts=await read('/api/contracts');
  $('connection-panel').hidden=true;$('source-identity').textContent=format(model.launch.source);
  $('native-summary').innerHTML='<dt>Owner</dt><dd>'+escape(model.launch.origin)+'</dd><dt>Native runtime</dt><dd>Node '+escape(model.launch.source.node)+
    '</dd><dt>Source identity</dt><dd class="mono">'+escape(model.launch.source.sha256)+'</dd>';
  const collections=[...model.launch.tables,'host_files','host_dispatches'];
  $('record-collection').innerHTML=collections.map(value=>'<option value="'+escape(value)+'">'+label(value)+'</option>').join('');
  $('event-action-name').innerHTML=['record_opt_decision','reconcile_distribution','project_event_history','resume_event_callback']
    .filter(value=>model.launch.actions.includes(value)).map(value=>'<option value="'+value+'">'+label(value)+'</option>').join('');
  $('management-example').innerHTML=model.contracts.public.management.operations.map(value=>'<option value="'+escape(value.namespace)+'">'+escape(value.namespace)+'</option>').join('');
  if(!$('instance-input').value)$('instance-input').value=format(instanceTemplate());
  if(!$('source-profile').value)$('source-profile').value=format(profileTemplate('json'));
  if(!$('source-provenance').value)$('source-provenance').value=format({classification:'Operator-provided original source',origin:'',owner:'',received_at:new Date().toISOString()});
  if(!$('mapping-input').value)$('mapping-input').value=format({instance_id:'',name:'',reviewer:'',entries:[{r_id:'',report_specifier_id:'',
    source_ids:[],device_id:'',channel:'',kind:'energy',unit:'kWh',time_basis:'start',period_seconds:900,aggregation:'energy_sum',
    decimal_places:6,allow_resample:false}],registration_response:{},source_evidence:[]});
  if(!$('report-query').value)$('report-query').value=format({startTimet:0,endTimet:0,granularityInSeconds:900,rIds:[]});
  setEventTemplate();setReconcileTemplate();setManagementTemplate();renderPending();await refresh();
  notice(model.pending?'An original saved request needs outcome receiving. Open Saved actions.':'');
}
document.addEventListener('click',event=>{
  const section=event.target.closest('[data-section]');if(section){showSection(section.dataset.section);return;}
  const collection=event.target.closest('[data-open-collection]');if(collection)guarded(()=>openCollection(collection.dataset.openCollection));
});
$('connection-form').addEventListener('submit',event=>{event.preventDefault();model.token=$('connection-token').value.trim();sessionStorage.setItem('gridfabric-connection',model.token);guarded(connect,'Opening the original owner');});
$('refresh').addEventListener('click',()=>guarded(refresh,'Reading original workspace'));
$('inspector-close').addEventListener('click',()=>{$('inspector').hidden=true;model.inspectorGeneration++;});
$('instance-template').addEventListener('click',()=>{$('instance-input').value=format(instanceTemplate());});
$('instance-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{const r=await mutate('configure_instance',jsonInput('instance-input'));renderRoutes(r.instance_id);});});
$('source-file').addEventListener('change',()=>{if($('source-file').files[0])$('source-name').value=$('source-file').files[0].name;});
$('source-format').addEventListener('change',()=>{$('source-profile').disabled=$('source-format').value==='original';});
$('source-profile-template').addEventListener('click',()=>{$('source-profile').value=format(profileTemplate($('source-format').value));});
$('source-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  requireNoPending();const file=$('source-file').files[0];if(!file)throw new Error('Select the complete original file.');
  const buffer=await file.arrayBuffer(),sha=await sha256(buffer),name=$('source-name').value.trim()||file.name,formatValue=$('source-format').value;
  const uploaded=await(await api('/api/upload',{method:'POST',body:buffer,raw:true,headers:{
    'Content-Type':formatValue==='csv'?'text/csv':formatValue==='json'?'application/json':'text/plain',
    'X-GridFabric-Name':encodeURIComponent(name),'X-GridFabric-Sha256':sha}})).json();
  if(uploaded.sha256!==sha||uploaded.bytes!==buffer.byteLength)throw new Error('The retained original upload differs.');
  const input={file_sha256:sha,name,format:formatValue,provenance:jsonInput('source-provenance'),
    ...(formatValue==='original'?{}:{profile:jsonInput('source-profile')}),
    ...($('source-corrects').value.trim()?{corrects_source_id:$('source-corrects').value.trim()}:{})};
  const result=await mutate('import_source',input,'original source import');$('source-result').hidden=false;
  $('source-result').innerHTML='<h3>Retained source</h3>'+statusBadge(result.status)+'<p class="mono">'+escape(result.source_id)+'</p>';
  $('source-result').append(fileNode(uploaded));await inspectRecord('sources',result.source_id);
},'Retaining and parsing the complete original source');});
$('mapping-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{const r=await mutate('save_mapping',jsonInput('mapping-input'));$('activation-id').value=r.mapping_id;});});
$('activation-form').addEventListener('submit',event=>{event.preventDefault();guarded(()=>mutate('activate_mapping',{mapping_id:$('activation-id').value.trim(),reviewer:$('activation-reviewer').value.trim()}));});
$('event-action-name').addEventListener('change',()=>setEventTemplate(model.selected?.collection==='events'?model.selected.record:{}));
$('event-action-form').addEventListener('submit',event=>{event.preventDefault();guarded(()=>mutate($('event-action-name').value,jsonInput('event-action-input')));});
$('report-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{const r=await mutate('build_report',{instance_id:$('report-instance').value.trim(),query:jsonInput('report-query')});
  await inspectRecord('reports',r.report_id);},'Building complete report from the original sources');});
$('management-example').addEventListener('change',setManagementTemplate);
$('management-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{const r=await mutate('prepare_management',jsonInput('management-input'));
  $('dispatch-kind').value='management';$('dispatch-id').value=r.operation_id;await inspectDispatch();});});
$('dispatch-kind').addEventListener('change',()=>{model.dispatch=null;renderDispatch();setReconcileTemplate();});
$('dispatch-id').addEventListener('input',()=>renderDispatch());
$('dispatch-inspect').addEventListener('click',()=>guarded(inspectDispatch));
$('dispatch-send').addEventListener('click',()=>guarded(dispatch,'Waiting for the original external dispatch receipt'));
$('reconcile-name').addEventListener('change',setReconcileTemplate);
$('reconcile-form').addEventListener('submit',event=>{event.preventDefault();guarded(()=>reconcilePending($('reconcile-name').value,jsonInput('reconcile-input')));});
$('export-create').addEventListener('click',()=>guarded(createExport,'Streaming the complete original portable workspace'));
$('exports-refresh').addEventListener('click',()=>guarded(refreshExports));
$('restore-form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{
  const file=$('restore-file').files[0],name=$('restore-name').value.trim();if(!file||!name)throw new Error('Select the complete portable file and new workspace name.');
  const buffer=await file.arrayBuffer(),sha=await sha256(buffer);
  if(model.pending&&!(model.pending.kind==='restore'&&model.pending.file_sha256===sha&&model.pending.destination_name===name))requireNoPending();
  const request_id=model.pending?.request_id||crypto.randomUUID();
  model.pending={kind:'restore',label:'cold portable receiving',request_id,workspace_id:model.state.workspace_id,
    destination_name:name,file_sha256:sha,file_bytes:buffer.byteLength,created_at:model.pending?.created_at||new Date().toISOString(),status:'PREPARED'};
  persist();renderPending();
  try{
    const outcome=await(await api('/api/restore?'+new URLSearchParams({name}),{method:'POST',body:buffer,raw:true,
      headers:{'Content-Type':'application/gzip','X-GridFabric-Request-Id':request_id,'X-GridFabric-Sha256':sha}})).json();
    completedPending(outcome);$('restore-result').textContent='Original workspace '+outcome.workspace_id+' restored at revision '+outcome.revision+' to '+outcome.directory+'.';
    notice('Cold receiving completed with the original logical records and source files.');
  }catch(error){model.pending={...model.pending,status:'OUTCOME_NOT_CONFIRMED',error:{code:error.code,message:error.message}};persist();renderPending();throw error;}
},'Receiving and reopening the complete original portable source');});
$('record-scope').addEventListener('input',()=>{delete $('record-scope').dataset.rawScope;});
$('record-filter').addEventListener('submit',event=>{event.preventDefault();guarded(readRecordPage);});
$('record-previous').addEventListener('click',()=>guarded(async()=>{$('record-offset').value=Math.max(0,model.recordPage.offset-model.recordPage.limit);await readRecordPage();}));
$('record-next').addEventListener('click',()=>guarded(async()=>{$('record-offset').value=model.recordPage.next_offset;await readRecordPage();}));
$('pending-read').addEventListener('click',()=>guarded(recoverPending));
$('pending-continue').addEventListener('click',()=>guarded(async()=>{
  await recoverPending();const pending=model.pending,active=pending?.recovery||pending;
  if(!active?.canContinue)throw new Error('The original request does not have a supported same-UUID continuation.');
  if(pending.recovery)await transmitRecovery();else await transmit(pending);
}));
$('pending-dismiss').addEventListener('click',()=>guarded(async()=>{
  await recoverPending();const pending=model.pending,active=pending?.recovery||pending;
  if(!active?.absenceVerified)throw new Error('The original absence was not verified.');
  const archived={...active,observed_at:new Date().toISOString(),status:'NOT_ACCEPTED_ARCHIVED',result:null};
  if(pending.recovery){pending.recovery_history=[...(pending.recovery_history||[]),archived];delete pending.recovery;}
  else{model.history.push(archived);model.pending=null;}
  persist();renderPending();notice(pending.recovery_history?
    'The unaccepted recovery draft is archived. The original dispatch remains retained for reviewed reconciliation.':
    'The unaccepted original draft is retained in local history. Review a new action.');
}));
$('pending-reconcile').addEventListener('click',()=>guarded(async()=>{
  await recoverPending();const pending=model.pending;
  if(!pending||pending.kind!=='dispatch'||pending.recovery)throw new Error('Read the selected original dispatch outcome first.');
  const binding=dispatchBinding(pending);
  $('dispatch-kind').value=binding.kind;$('dispatch-id').value=binding.id;await inspectDispatch();
  $('reconcile-name').value=pending.native_operation.status==='SENDING'?'recover_dispatches':
    binding.kind==='management'?'reconcile_management':'reconcile_device_action';
  setReconcileTemplate();showSection('management');$('reconcile-input').focus();
  notice($('reconcile-name').value==='recover_dispatches'?
    'Review the original recovery action: it records every currently SENDING native attempt as UNKNOWN. Its complete affected-record result will be retained with this saved dispatch.':
    'Review the disposition and original evidence for this exact saved attempt. This action does not resend it.');
}));
guarded(connect,'Opening the original GridFabric workspace');
