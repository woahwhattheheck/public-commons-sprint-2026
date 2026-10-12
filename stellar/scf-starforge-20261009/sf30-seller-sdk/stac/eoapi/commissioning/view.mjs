// MIT. Industrial operator panel mounted by the original eoAPI host.
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function commissioningMarkup(){
  return '<section class="eoapi-commissioning" aria-label="Deployment commissioning">'+
    '<style>.eoapi-commissioning{font:14px/1.45 system-ui,sans-serif;color:#202020;background:#fff;padding:20px;max-width:1180px}.eoapi-commissioning *{box-sizing:border-box}.eoapi-commissioning h2{font-size:22px;margin:0 0 6px}.eoapi-commissioning h3{font-size:16px;margin:0 0 12px}.eoapi-commissioning p{margin:6px 0 14px}.eoapi-commissioning fieldset{border:1px solid #c8c8c8;padding:16px;margin:16px 0}.eoapi-commissioning legend{padding:0 6px;font-weight:600}.eoapi-commissioning label{display:block;font-weight:600;margin:12px 0 4px}.eoapi-commissioning input,.eoapi-commissioning select,.eoapi-commissioning textarea,.eoapi-commissioning button{font:inherit;border:1px solid #aaa;border-radius:2px;padding:8px;background:#fff;color:inherit;max-width:100%}.eoapi-commissioning input,.eoapi-commissioning select{min-width:200px}.eoapi-commissioning textarea{display:block;width:100%;min-height:235px;font:13px/1.5 ui-monospace,monospace;resize:vertical}.eoapi-commissioning button{cursor:pointer;background:#f3f3f3;margin:6px 6px 6px 0}.eoapi-commissioning button:disabled{opacity:.5;cursor:wait}.eoapi-commissioning table{width:100%;border-collapse:collapse;font-size:13px}.eoapi-commissioning th,.eoapi-commissioning td{border-bottom:1px solid #d8d8d8;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}.eoapi-commissioning th{background:#f5f5f5}.eoapi-commissioning .scroll{overflow:auto}.eoapi-commissioning .muted{color:#555}.eoapi-commissioning .row{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.eoapi-commissioning .row>div{flex:1;min-width:220px}.eoapi-commissioning pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f7;border:1px solid #ddd;padding:12px;max-height:520px;overflow:auto}.eoapi-commissioning [role=status]{min-height:24px;padding:6px 0}@media(max-width:600px){.eoapi-commissioning{padding:12px}.eoapi-commissioning fieldset{padding:10px}.eoapi-commissioning table{min-width:620px}}</style>'+
    '<h2>Deployment commissioning</h2><p class="muted">Review the approved deployment, check its actual access responses, and retain the complete operating record.</p>'+
    '<button data-action="refresh">Refresh</button><span data-workspace></span><div role="status" aria-live="polite" data-status></div>'+
    '<fieldset><legend>1. Review an access plan</legend><label>Approved policy<select data-approval></select></label><label>Observed service<select data-target><option value="deployment">Deployment access</option><option value="upstream">Upstream source baseline</option></select></label>'+
    '<p class="muted">The selected approval and source revision stay attached to every run. Requests use the connection names configured in this host.</p>'+
    '<label>Access cases<textarea data-plan spellcheck="false" aria-label="Access plan JSON"></textarea></label>'+
    '<button data-action="example">Use selected catalog example</button><button data-action="save">Save reviewed plan</button><button data-action="new-plan">New plan operation</button><p class="muted" data-plan-intent></p><div data-plan-receipt></div></fieldset>'+
    '<fieldset><legend>2. Run or continue</legend><div class="row"><div><label>Saved plan<select data-plan-select></select></label></div><div><label>Operation ID<input data-operation autocomplete="off"></label></div></div>'+
    '<button data-action="prepare">Create / recover run</button><button data-action="new-run">New run operation</button><div class="scroll"><table><thead><tr><th>Run</th><th>State</th><th>Observed</th><th>Passed / findings</th><th>Actions</th></tr></thead><tbody data-runs></tbody></table></div></fieldset>'+
    '<fieldset><legend>Retained source response</legend><p class="muted">Attach an already captured original response to its matching reviewed case.</p><div class="row"><div><label>Run<select data-adopt-run></select></label></div><div><label>Case ID<input data-adopt-case autocomplete="off"></label></div></div><label>Original capture<select data-adopt-capture></select></label><button data-action="adopt">Use retained response</button></fieldset>'+
    '<fieldset><legend>3. Inspect and compare</legend><div class="row"><div><label>Earlier run<select data-left></select></label></div><div><label>Later run<select data-right></select></label></div></div>'+
    '<button data-action="compare">Compare observed results</button><div data-report></div></fieldset>'+
    '<fieldset><legend>4. Receive a complete operating record</legend><p class="muted">Select the package through this host’s saved-file picker, then enter its file ID. Original responses, policy, run and receiving identity are retained together.</p>'+
    '<label>Saved package file ID<input data-file-id autocomplete="off"></label><button data-action="receive">Receive / recover package</button><button data-action="new-receive">New receiving operation</button><p class="muted" data-receive-intent></p><div data-imports></div></fieldset>'+
    '</section>';
}
export function mountCommissioning(element,{dispatch,principals=['anonymous'],intentStore}={}){
  if(typeof dispatch!=='function')throw new TypeError('The original operator host dispatch is required.');
  element.innerHTML=commissioningMarkup();const root=element.querySelector('.eoapi-commissioning');
  const one=selector=>root.querySelector(selector),status=message=>{one('[data-status]').textContent=message;};
  let state=null,destroyed=false,intents=null,storageKey=null;
  const operation=prefix=>prefix+'-'+crypto.randomUUID();
  let storage=intentStore;
  if(storage===undefined){try{storage=globalThis.sessionStorage;}catch{storage=null;}}
  const storageRequired=()=>{
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')
      throw new Error('This host must retain operator intents before starting a mutation.');
  };
  function retain(){
    storageRequired();
    const text=JSON.stringify(intents);
    storage.setItem(storageKey,text);
    if(storage.getItem(storageKey)!==text)throw new Error('The operator intent was not retained. Retry the same operation.');
  }
  function loadIntents(){
    if(intents?.workspaceId===state.id)return false;
    storageRequired();storageKey='eoapi-commissioning:intents:v1:'+state.id;
    const raw=storage.getItem(storageKey);
    const next=raw?JSON.parse(raw):{schema:'scf-eoapi-commissioning-ui-intents/v1',workspaceId:state.id,plans:[],receives:[],runs:[],ui:{}};
    if(next.schema!=='scf-eoapi-commissioning-ui-intents/v1'||next.workspaceId!==state.id||
      !['plans','receives','runs'].every(key=>Array.isArray(next[key]))||!next.ui||typeof next.ui!=='object')
      throw new Error('The retained operator intents cannot be read. Keep this workspace record for recovery.');
    for(const key of ['plans','receives','runs'])for(const row of next[key])
      if(!row||typeof row.operationId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(row.operationId))
        throw new Error('A retained operator intent is invalid. Keep this workspace record for recovery.');
    intents=next;return true;
  }
  const latest=(rows,predicate)=>rows.findLast(predicate);
  function rememberForm(){
    if(!intents)loadIntents();
    intents.ui={planText:one('[data-plan]').value,approvalId:one('[data-approval]').value,
      target:one('[data-target]').value,planId:one('[data-plan-select]').value,fileId:one('[data-file-id]').value};
  }
  function showIntents(){
    const receive=latest(intents?.receives??[],row=>row.fileId===one('[data-file-id]').value);
    one('[data-receive-intent]').textContent=receive?'Retained operation '+receive.operationId+(receive.id?' · '+receive.id:''):'A receiving operation is retained before dispatch.';
    const plan=latest(intents?.plans??[],row=>row.operationId===intents?.ui?.planOperationId)??intents?.plans.at(-1);
    one('[data-plan-intent]').textContent=plan?'Retained operation '+plan.operationId+(plan.id?' · '+plan.id:''):'A plan operation is retained before dispatch.';
  }
  async function planIntent(fresh=false){
    if(!intents)loadIntents();
    const input=JSON.parse(one('[data-plan]').value);input.approvalId=one('[data-approval]').value;input.target=one('[data-target]').value;
    const key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))].map(value=>value.toString(16).padStart(2,'0')).join('');
    let row=fresh?null:latest(intents.plans,value=>value.key===key);
    if(!row){row={key,operationId:operation('plan')};intents.plans.push(row);}
    rememberForm();intents.ui.planText=JSON.stringify(input,null,2);intents.ui.planOperationId=row.operationId;
    retain();showIntents();return {input,row};
  }
  function receiveIntent(fresh=false){
    if(!intents)loadIntents();
    const fileId=one('[data-file-id]').value;
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(fileId))throw new Error('Select the original saved package file ID.');
    let row=fresh?null:latest(intents.receives,value=>value.fileId===fileId);
    if(!row){row={fileId,operationId:operation('receive')};intents.receives.push(row);}
    rememberForm();retain();showIntents();return row;
  }
  function runIntent(fresh=false){
    if(!intents)loadIntents();
    const planId=one('[data-plan-select]').value;
    if(!planId)throw new Error('Select the saved plan first.');
    const entered=one('[data-operation]').value;
    let row=fresh?null:latest(intents.runs,value=>value.planId===planId&&(!entered||value.operationId===entered));
    if(!row){row={planId,operationId:fresh||!entered?operation('commissioning'):entered};intents.runs.push(row);}
    rememberForm();retain();one('[data-operation]').value=row.operationId;return row;
  }
  async function call(method,path,body){
    const response=await dispatch({method,path,...(body===undefined?{}:{body})});
    if(response?.status!==undefined){if(response.status>=400)throw new Error(response.body?.error??'The operation failed.');return response.body;}
    return response;
  }
  const option=(value,label,selected='')=>'<option value="'+escape(value)+'"'+(value===selected?' selected':'')+'>'+escape(label)+'</option>';
  function select(selector,rows,value,title){
    const previous=one(selector).value;one(selector).innerHTML=rows.map(row=>option(value(row),title(row),previous)).join('');
  }
  function showReport(report){
    const run=report.run??report.report?.run,selected=report.plan??report.report?.plan;
    if(!run){one('[data-report]').innerHTML='<pre>'+escape(JSON.stringify(report,null,2))+'</pre>';return;}
    one('[data-report]').innerHTML='<h3>'+escape(selected?.title??run.id)+'</h3><p>Policy '+escape(run.policyDigest)+'<br>Run '+escape(run.id)+' · '+escape(run.status)+'</p>'+
      '<div class="scroll"><table><thead><tr><th>Case / connection</th><th>HTTP</th><th>Collections / items</th><th>Result</th><th>Source</th></tr></thead><tbody>'+
      run.results.map(row=>'<tr><td>'+escape(row.caseId)+'<br>'+escape(row.principal)+'</td><td>'+escape(row.observed.status)+'</td><td>'+
        escape(row.observed.collections.join(', '))+'<br>'+row.observed.items.length+' items'+(row.observed.hasNextPage?' · next page present':'')+
        '</td><td>'+escape(row.passed?'Passed':row.issues.map(issue=>issue.code).join(', '))+'</td><td>'+escape(row.observed.responseAt)+
        '<br>'+escape(row.observed.sha256)+'</td></tr>').join('')+'</tbody></table></div>'+
      '<details><summary>Complete reviewed cases and original source identities</summary><pre>'+escape(JSON.stringify(report,null,2))+'</pre></details>';
  }
  async function refresh(){
    state=await call('GET','/state');if(destroyed)return;
    one('[data-workspace]').textContent=state.title+' · '+state.id;
    select('[data-approval]',state.approvals,row=>row.id,row=>row.id+(row.current?' · current':''));
    select('[data-plan-select]',state.plans,row=>row.id,row=>row.title+' · '+row.id);
    select('[data-adopt-run]',state.runs,row=>row.id,row=>row.id+' · '+row.status);
    select('[data-adopt-capture]',state.retainedCaptures,row=>row.captureRef,row=>row.request.method+' '+row.request.url+' · '+row.captureRef);
    const completed=state.runs.filter(row=>row.status==='COMPLETE');
    for(const selector of ['[data-left]','[data-right]'])select(selector,completed,row=>row.id,row=>row.id);
    one('[data-runs]').innerHTML=state.runs.map(row=>'<tr><td>'+escape(row.id)+'</td><td>'+escape(row.status)+'</td><td>'+row.cases+
      '</td><td>'+row.passed+' / '+row.failed+'</td><td><button data-report-run="'+escape(row.id)+'">Inspect</button>'+
      (row.status==='COMPLETE'?'<button data-export-run="'+escape(row.id)+'">Export package</button>':'<button data-execute-run="'+escape(row.id)+'">Run / continue</button>')+'</td></tr>').join('');
    one('[data-imports]').innerHTML=state.imports.map(row=>'<p>'+escape(row.runId)+' · '+escape(row.completedAt)+' <button data-open-import="'+escape(row.id)+'">Reopen</button></p>').join('');
    if(loadIntents()){
      for(const [selector,key] of [['[data-plan]','planText'],['[data-approval]','approvalId'],['[data-target]','target'],['[data-file-id]','fileId']])
        if(typeof intents.ui[key]==='string')one(selector).value=intents.ui[key];
    }
    if(intents.ui.planId&&state.plans.some(row=>row.id===intents.ui.planId))one('[data-plan-select]').value=intents.ui.planId;
    const current=latest(intents.runs,row=>row.planId===one('[data-plan-select]').value);
    one('[data-operation]').value=current?.operationId??'';showIntents();
  }
  function example(){
    const approval=state.approvals.find(row=>row.id===one('[data-approval]').value);
    const target=one('[data-target]').value,endpoint=target==='upstream'?approval?.upstream:approval?.endpoint;
    if(!endpoint)throw new Error('Select an approval with its deployment URL first.');
    const request=state.retainedCaptures.find(row=>row.request.url.replace(/\/+$/,'')===endpoint.replace(/\/+$/,'')&&row.request.method==='GET')?.request??
      {url:endpoint,method:'GET',headers:{accept:'application/geo+json, application/json'}};
    one('[data-plan]').value=JSON.stringify({title:'Catalog access commissioning',approvalId:approval.id,target,minimumIntervalMs:1000,cases:[
      {id:'catalog-public',title:'Public catalog',principal:'anonymous',request,expect:{statuses:[200],documentType:'Catalog'}}
    ]},null,2);
    status('Review the endpoint, expected access and source version before saving. Available connections: '+principals.join(', ')+'.');
  }
  async function click(event){
    const button=event.target.closest('button');if(!button||!root.contains(button))return;
    const prior=button.disabled;button.disabled=true;
    try{
      if(button.dataset.action==='refresh'){await refresh();status('Current retained records loaded.');}
      if(button.dataset.action==='example')example();
      if(button.dataset.action==='new-plan'){await planIntent(true);status('A new plan operation is retained. Save reviewed plan creates its separate record.');}
      if(button.dataset.action==='save'){
        const {input,row}=await planIntent();
        const result=await call('POST','/plans',{input,operationId:row.operationId});
        row.id=result.id;intents.ui.planId=result.id;retain();await refresh();
        one('[data-plan-select]').value=result.id;one('[data-plan-receipt]').textContent='Saved '+result.id+' · '+result.plan.digest;status('Reviewed plan saved.');
      }
      if(button.dataset.action==='new-run'){runIntent(true);status('A new run operation is retained for the selected plan. Create / recover run prepares it.');}
      if(button.dataset.action==='prepare'){
        const row=runIntent();
        const result=await call('POST','/runs',{planId:row.planId,operationId:row.operationId});
        row.id=result.id;retain();await refresh();status('Run '+result.id+' is ready. Run / continue performs the reviewed source reads.');
      }
      if(button.dataset.executeRun){const result=await call('POST','/execute',{runId:button.dataset.executeRun});await refresh();showReport(await call('GET','/runs/'+result.id));status('Run '+result.status+'.');}
      if(button.dataset.reportRun){showReport(await call('GET','/runs/'+button.dataset.reportRun));status('Original response observations loaded.');}
      if(button.dataset.exportRun){const result=await call('POST','/export',{runId:button.dataset.exportRun});showReport(result);status('Complete package saved by the operator host.');}
      if(button.dataset.action==='adopt'){
        const capture=state.retainedCaptures.find(row=>row.captureRef===one('[data-adopt-capture]').value);
        if(!capture)throw new Error('Select a registered original capture.');
        const result=await call('POST','/adopt',{runId:one('[data-adopt-run]').value,caseId:one('[data-adopt-case]').value,captureRef:capture.captureRef,sourceWorkspaceId:capture.sourceWorkspaceId});
        await refresh();showReport(await call('GET','/runs/'+result.run.id));status('Original response adopted into the reviewed case.');
      }
      if(button.dataset.action==='compare'){showReport(await call('POST','/compare',{leftRunId:one('[data-left]').value,rightRunId:one('[data-right]').value}));status('Completed runs compared.');}
      if(button.dataset.action==='new-receive'){receiveIntent(true);status('A new receiving operation is retained for this saved package. Receive / recover package creates its separate record.');}
      if(button.dataset.action==='receive'){
        const row=receiveIntent();
        const result=await call('POST','/receive',{fileId:row.fileId,operationId:row.operationId});
        row.id=result.id;retain();await refresh();showReport(await call('GET','/imports/'+result.id));status('Complete operating record received.');
      }
      if(button.dataset.openImport){showReport(await call('GET','/imports/'+button.dataset.openImport));status('Received operating record reopened.');}
    }catch(error){status(String(error.message??error));}finally{if(button.isConnected)button.disabled=prior;}
  }
  function change(event){
    if(destroyed||!state)return;
    try{
      if(!intents)loadIntents();
      if(event.target.matches('[data-plan-select]')){
        const current=latest(intents.runs,row=>row.planId===one('[data-plan-select]').value);
        one('[data-operation]').value=current?.operationId??'';
      }
      rememberForm();retain();showIntents();
    }catch(error){status(String(error.message??error));}
  }
  root.addEventListener('click',click);root.addEventListener('change',change);
  const ready=refresh().then(()=>{if(!destroyed&&state.approvals.length&&!one('[data-plan]').value)example();}).catch(error=>status(String(error.message??error)));
  return {ready,refresh,destroy(){destroyed=true;root.removeEventListener('click',click);root.removeEventListener('change',change);element.replaceChildren();}};
}
