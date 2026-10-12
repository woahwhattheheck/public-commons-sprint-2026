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
    '<button data-action="example">Use selected catalog example</button><button data-action="save">Save reviewed plan</button><div data-plan-receipt></div></fieldset>'+
    '<fieldset><legend>2. Run or continue</legend><div class="row"><div><label>Saved plan<select data-plan-select></select></label></div><div><label>Operation ID<input data-operation autocomplete="off"></label></div></div>'+
    '<button data-action="prepare">Create run</button><div class="scroll"><table><thead><tr><th>Run</th><th>State</th><th>Observed</th><th>Passed / findings</th><th>Actions</th></tr></thead><tbody data-runs></tbody></table></div></fieldset>'+
    '<fieldset><legend>Retained source response</legend><p class="muted">Attach an already captured original response to its matching reviewed case.</p><div class="row"><div><label>Run<select data-adopt-run></select></label></div><div><label>Case ID<input data-adopt-case autocomplete="off"></label></div></div><label>Original capture<select data-adopt-capture></select></label><button data-action="adopt">Use retained response</button></fieldset>'+
    '<fieldset><legend>3. Inspect and compare</legend><div class="row"><div><label>Earlier run<select data-left></select></label></div><div><label>Later run<select data-right></select></label></div></div>'+
    '<button data-action="compare">Compare observed results</button><div data-report></div></fieldset>'+
    '<fieldset><legend>4. Receive a complete operating record</legend><p class="muted">Select the package through this host’s saved-file picker, then enter its file ID. Original responses, policy, run and receiving identity are retained together.</p>'+
    '<label>Saved package file ID<input data-file-id autocomplete="off"></label><button data-action="receive">Receive package</button><div data-imports></div></fieldset>'+
    '</section>';
}
export function mountCommissioning(element,{dispatch,principals=['anonymous']}={}){
  if(typeof dispatch!=='function')throw new TypeError('The original operator host dispatch is required.');
  element.innerHTML=commissioningMarkup();const root=element.querySelector('.eoapi-commissioning');
  const one=selector=>root.querySelector(selector),status=message=>{one('[data-status]').textContent=message;};
  let state=null,destroyed=false;const reviewedIntents=new Map(),receivingIntents=new Map();
  const operation=prefix=>prefix+'-'+crypto.randomUUID();
  one('[data-operation]').value=operation('commissioning');
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
      if(button.dataset.action==='save'){
        const input=JSON.parse(one('[data-plan]').value);input.approvalId=one('[data-approval]').value;input.target=one('[data-target]').value;
        const key=JSON.stringify(input);if(!reviewedIntents.has(key))reviewedIntents.set(key,operation('plan'));
        const result=await call('POST','/plans',{input,operationId:reviewedIntents.get(key)});await refresh();
        one('[data-plan-select]').value=result.id;one('[data-plan-receipt]').textContent='Saved '+result.id+' · '+result.plan.digest;status('Reviewed plan saved.');
      }
      if(button.dataset.action==='prepare'){
        const result=await call('POST','/runs',{planId:one('[data-plan-select]').value,operationId:one('[data-operation]').value});
        await refresh();status('Run '+result.id+' is ready. Run / continue performs the reviewed source reads.');
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
      if(button.dataset.action==='receive'){
        const fileId=one('[data-file-id]').value;if(!receivingIntents.has(fileId))receivingIntents.set(fileId,operation('receive'));
        const result=await call('POST','/receive',{fileId,operationId:receivingIntents.get(fileId)});
        await refresh();showReport(await call('GET','/imports/'+result.id));status('Complete operating record received.');
      }
      if(button.dataset.openImport){showReport(await call('GET','/imports/'+button.dataset.openImport));status('Received operating record reopened.');}
    }catch(error){status(String(error.message??error));}finally{if(button.isConnected)button.disabled=prior;}
  }
  root.addEventListener('click',click);
  const ready=refresh().then(()=>{if(!destroyed&&state.approvals.length)example();}).catch(error=>status(String(error.message??error)));
  return {ready,refresh,destroy(){destroyed=true;root.removeEventListener('click',click);element.replaceChildren();}};
}
