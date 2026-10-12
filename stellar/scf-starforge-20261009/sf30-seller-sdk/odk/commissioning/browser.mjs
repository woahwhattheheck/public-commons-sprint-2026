// MIT. Private neutral commissioning UI on the original Central listener.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const copy=x=>JSON.parse(JSON.stringify(x)),format=x=>JSON.stringify(x,null,2);
const uid=()=>crypto.randomUUID(),plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const authKey='central-commissioning-token:'+location.origin;
let token=new URLSearchParams(location.hash.slice(1)).get('token')??sessionStorage.getItem(authKey);
if(token){sessionStorage.setItem(authKey,token);history.replaceState(null,'',location.pathname);}
let state=null,busy=false,agreement=null,draftRevision=0,loadedDraftId=null,renderedInspection=null,hostInput=null,requestKey=null,pending={};
const localError=(message,details)=>Object.assign(new Error(message),details?{details}:{});
function tell(message){$('message').textContent=message;}
function setBusy(value){busy=value;document.querySelectorAll('button,input,select,textarea').forEach(x=>{x.disabled=value;});}
async function request(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',redirect:'error',
    headers:{Authorization:'Bearer '+(token??''),...(input===undefined?{}:{'Content-Type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  const result=await response.json();
  if(!response.ok||result.ok===false)throw Object.assign(new Error(result.error?.message||'The original workspace request failed.'),result.error??{status:response.status});
  return result.result??result;
}
function retainPending(){if(requestKey)sessionStorage.setItem(requestKey,JSON.stringify(pending));}
function currentCommission(){return state?.commissions.find(x=>x.id===$('commission-select').value)??null;}
function currentInspection(){return state?.inspections.find(x=>x.id===$('inspection-select').value)??null;}
function options(element,values,selected,empty){
  const before=selected??element.value;
  element.innerHTML=(empty?'<option value="">'+esc(empty)+'</option>':'')+values.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
  if(values.some(x=>String(x.value)===String(before)))element.value=String(before);
  else if(empty)element.value='';
}
function button(text,attributes={}){return '<button type="button" '+Object.entries(attributes).map(([k,v])=>k+'="'+esc(v)+'"').join(' ')+'>'+esc(text)+'</button>';}
function renderPending(){
  const entries=Object.entries(pending);
  $('pending').innerHTML=entries.length?'<h3>Retained operation requests</h3>'+entries.map(([key,value])=>
    '<div class="card"><strong>'+esc(value.method)+'</strong><p>'+esc(value.completed?'The original response was received. Refresh or recover it to reconcile saved state.':'This exact input remains available after an uncertain response.')+
    '</p><code>'+esc(value.body.requestId??value.body.id??value.body.captureId)+'</code> '+button('Recover this original request',{'data-recover':key})+
    '<details><summary>Retained input</summary><pre>'+esc(format(value.body))+'</pre></details></div>').join(''):'';
}
function renderSource(){
  const allProjects=new Map();
  for(const inspection of state.inspections)for(const project of inspection.projects??[])allProjects.set(String(project.id),project);
  options($('project-select'),[...allProjects.values()].map(p=>({value:String(p.id),label:p.name+' · '+p.id})),undefined,'Choose an accessible project');
  options($('inspection-select'),state.inspections.filter(x=>x.status==='READY').map(x=>({value:x.id,label:x.project.name+' · '+x.id})),undefined,'Select a completed source inspection');
  const inspection=currentInspection();
  if(inspection){
    $('source-summary').innerHTML='<dl><dt>Original project</dt><dd>'+esc(inspection.project.name)+' · '+esc(inspection.project.id)+
      '</dd><dt>Authenticated actor</dt><dd>'+esc(inspection.actor.displayName??inspection.actor.email??inspection.actor.id)+
      ' · '+esc(inspection.actor.id)+'</dd><dt>Source identity</dt><dd><code>'+esc(inspection.sourceIdentity)+'</code></dd></dl>';
    if(renderedInspection!==inspection.id){
      const chosen=new Set((agreement?.customer_decisions?.selected_forms??[]).map(x=>typeof x==='string'?x:x.form_id??x.formId??x.xmlFormId));
      $('form-selection').innerHTML=inspection.forms.map(f=>'<label class="check"><input type="checkbox" data-form="'+esc(f.xmlFormId)+'"'+
        (chosen.has(f.xmlFormId)?' checked':'')+'><span>'+esc(f.name)+' <code>'+esc(f.xmlFormId)+'</code> · version '+esc(f.version??'not returned')+'</span></label>').join('');
      renderedInspection=inspection.id;
    }
  }else{$('source-summary').textContent='Read and select a native project before preparing the agreement.';$('form-selection').innerHTML='';renderedInspection=null;}
  $('host-receipts').innerHTML=state.hostReceipts.length?state.hostReceipts.map(x=>'<div class="card"><strong>'+esc(x.operationId)+
    '</strong><p>Observed '+esc(x.observedAt)+' · '+esc(typeof x.version==='string'?x.version:JSON.stringify(x.version))+
    '</p>'+(x.receipt?button('Download original host receipt',{'data-source':x.receipt.sha256,'data-name':'central-host-handover.json'}):'')+'</div>').join(''):
    '<p>No original deployment receipt is recorded. Source inspection and a host operation receipt describe separate observations.</p>';
}
function renderDrafts(){
  const values=state.drafts.map(x=>({value:x.id,label:(x.agreement.name||x.id)+' · revision '+x.revision}));
  options($('draft-select'),values,undefined,'New agreement');options($('prepare-draft'),values,undefined,'Choose a saved agreement revision');
}
function renderCommission(){
  options($('commission-select'),state.commissions.map(x=>({value:x.id,label:x.id+' · '+x.status})),undefined,'Choose a retained version');
  const commission=currentCommission();
  if(!commission){$('commission-summary').innerHTML='<p>No commissioning version selected.</p>';$('periods').innerHTML='';$('deliveries').innerHTML='';
    options($('delivery-0'),[],undefined,'No accepted capture');options($('delivery-1'),[],undefined,'No accepted capture');return;}
  const def=commission.definition,schedule=def.schedule;
  $('commission-summary').innerHTML='<div class="card"><span class="badge">'+esc(commission.status)+'</span><dl><dt>Agreement</dt><dd>'+esc(def.agreement.name||def.agreement.opportunity_id)+
    '</dd><dt>Saved source revision</dt><dd>'+esc(commission.sourceDefinition.draftId)+' / '+commission.sourceDefinition.draftRevision+
    '</dd><dt>Full agreement hash</dt><dd><code>'+esc(def.agreementSha256)+'</code></dd><dt>Reporting calendar</dt><dd>'+
    esc(schedule.status)+' · '+esc(schedule.start??'date not selected')+' → '+esc(schedule.finish??'date not selected')+
    ' · '+schedule.workingDays+' working days</dd></dl><p>'+esc(schedule.description)+'</p>'+
    (commission.error?'<p>'+esc(commission.error.message)+'</p>':'')+'</div>';
  $('periods').innerHTML=def.plans.map((plan,index)=>{
    const captures=commission.captures.filter(c=>c.planId===plan.id);
    return '<div class="card"><h3>'+esc(def.periods[index].label)+'</h3><p>'+esc(plan.scope.submittedFrom)+' through '+
      esc(plan.scope.submittedBefore)+' (exclusive)</p><p>Original plan <code>'+esc(plan.id)+'</code></p>'+
      button('Receive this original period',{'data-capture-period':index})+
      (captures.length?'<div class="table-scroll"><table><thead><tr><th>Capture</th><th>Source state</th><th>Rows</th><th>Source review</th><th>Open</th></tr></thead><tbody>'+
        captures.map(c=>'<tr><td><code>'+esc(c.id)+'</code></td><td>'+esc(c.status)+(c.error?'<p>'+esc(c.error.message)+'</p>':'')+
        '</td><td>'+esc(c.rowCount??'')+'</td><td>'+esc(c.decision?.decision??'Not reviewed')+'</td><td>'+
        button('Show original fields',{'data-fields':c.id})+(c.status==='PAUSED'||c.status==='FAILED'?button('Resume original capture',{'data-resume':c.id}):'')+
        '</td></tr>').join('')+'</tbody></table></div>':'<p>No capture has been dispatched for this plan.</p>')+'</div>';
  }).join('');
  for(let i=0;i<2;i++){
    const captures=commission.captures.filter(c=>c.planId===def.plans[i].id&&c.status==='COMPLETE'&&c.decision?.decision==='accept');
    options($('delivery-'+i),captures.map(c=>({value:c.id,label:c.id+' · '+(c.rowCount??0)+' rows · review '+c.decision.id})),undefined,'Choose the accepted original capture');
  }
  $('deliveries').innerHTML=commission.deliveries.map(d=>{
    const nativeOutputs=[...(d.datasets??[]).map(x=>({...x,kind:'Dataset'})),...(d.reports??[]).map(x=>({...x,kind:'Report'}))];
    let html='<article class="card"><h3>Handover '+esc(d.id)+'</h3><span class="badge">'+esc(d.status)+'</span>'+
      (d.error?'<p>'+esc(d.error.message)+'</p>':'')+
      (d.status!=='COMPLETE'?button('Resume this retained handover',{'data-delivery-resume':d.id}):'')+
      '<div class="file-list">'+(d.documents??[]).map(x=>button(x.name,{'data-source':x.sha256,'data-name':x.name})).join('')+'</div>';
    for(const output of nativeOutputs)html+='<details><summary>'+esc(output.kind)+' · '+esc(output.id)+'</summary><div class="file-list">'+
      output.files.map(path=>button(path,{'data-export':output.id,'data-path':path})).join('')+'</div></details>';
    if(d.archive)html+='<p>Complete original archive · '+esc(d.archive.bytes)+' bytes · <code>'+esc(d.archive.sha256)+'</code></p><div class="file-list">'+
      d.archive.files.map(path=>button(path,{'data-export':d.archive.id,'data-path':path})).join('')+'</div>';
    else if(state.receivedArchive)html+='<p>This independent workspace was restored from its original archive. The saved definition and outputs are reopened; a historical producer archive row is not fabricated.</p>';
    return html+'</article>';
  }).join('')||'<p>No complete report handover has been requested for this version.</p>';
}
function render(){
  $('overview').innerHTML='<dt>Workspace</dt><dd><code>'+esc(state.workspaceId)+'</code></dd><dt>Saved revision</dt><dd>'+esc(state.revision)+
    '</dd><dt>Source connection</dt><dd>'+esc(state.connection?.url??'No live source selected; retained work can still be read')+
    '</dd><dt>Credential reference</dt><dd>'+esc(state.connection?.authEnv??'Not supplied')+'</dd>'+
    (state.storageReopenRequired?'<dt>Storage state</dt><dd>Close and reopen this original owner before resuming the uncertain write.</dd>':'');
  renderSource();renderDrafts();renderCommission();renderPending();setBusy(busy);
}
async function refresh(){
  const value=await request('/api/commissioning/state');
  if(state&&value.workspaceId!==state.workspaceId)throw localError('This listener now serves another workspace. Reopen its original private link.');
  state=value;
  if(!requestKey){requestKey='central-commissioning-requests:'+state.workspaceId;try{pending=JSON.parse(sessionStorage.getItem(requestKey)||'{}');}catch{pending={};}}
  render();return value;
}
async function work(fn){
  if(busy)return null;setBusy(true);let result=null;
  try{result=await fn();}catch(error){tell((error.code?error.code+': ':'')+error.message+(error.details?'\n'+format(error.details):''));}
  finally{setBusy(false);renderPending();}
  return result;
}
async function executeRetained(key){
  const item=pending[key];if(!item)throw localError('The retained request is no longer present.');
  let result;
  try{result=await request('/api/commissioning/'+item.method,item.body);}
  catch(error){retainPending();throw error;}
  item.completed=true;item.completedAt=new Date().toISOString();retainPending();
  try{await refresh();delete pending[key];retainPending();tell('Saved '+item.method+' · '+(item.body.requestId??item.body.id??item.body.captureId??'original operation')+'.');}
  catch(error){tell('The original '+item.method+' response was received. Its saved request remains retained because refresh failed: '+error.message);}
  return result;
}
async function operate(tag,method,body,generated=[]){
  const semantic=JSON.stringify(canonical(body)),old=pending[tag];
  if(old&&old.semantic!==semantic)throw localError('A different '+method+' input is still retained under this action. Recover that original request below before starting another selection.');
  if(!old){body=copy(body);for(const name of generated)body[name]=uid();pending[tag]={method,body,semantic,createdAt:new Date().toISOString(),completed:false};retainPending();}
  return executeRetained(tag);
}
function setText(id,value){$(id).value=typeof value==='string'?value:value===undefined||value===null?'':$(id).tagName==='TEXTAREA'?format(value):JSON.stringify(value);}
function loadAgreement(value,{id,revision=0}={}){
  if(!plain(value))throw localError('Use the complete original agreement JSON object.');
  agreement=copy(value);draftRevision=revision;loadedDraftId=id??$('draft-id').value;
  const d=agreement.customer_decisions??{},periods=d.periods??[];
  $('processing-ack').checked=agreement.processing?.reviewStates==='all'&&agreement.processing?.lateEdits==='current-state-at-capture'&&agreement.processing?.portableSource==='complete-selected-capture';
  if(id!==undefined)$('draft-id').value=id;
  setText('opportunity-id',agreement.opportunity_id);setText('agreement-name',agreement.name);
  setText('project-owner',d.accountable_project_owner);setText('technical-receiver',d.technical_receiver);setText('reporting-timezone',d.reporting_timezone);
  for(let i=0;i<2;i++){setText('period-'+i+'-label',periods[i]?.label);setText('period-'+i+'-start',periods[i]?.submitted_from);setText('period-'+i+'-end',periods[i]?.submitted_before_exclusive);}
  setText('late-edit',d.late_edit_policy);setText('review-states',d.review_state_inclusion);setText('media-policy',d.media_retention_selection);
  setText('outputs',d.approved_output_fields??[]);setText('metrics',d.metric_definitions??[]);
  const kickoff=agreement.kickoff??{};$('kickoff-status').value=kickoff.status??'proposed';setText('kickoff-start',kickoff.start);
  setText('working-days',String(agreement.commercial_scope?.delivery_business_days??10));
  setText('kickoff-reference',kickoff.agreementReference);setText('inputs-reference',kickoff.inputsReadyReference);setText('capacity-reference',kickoff.capacityReference);
  $('full-agreement').value=format(agreement);$('draft-revision').textContent='Loaded draft revision '+revision+'; save uses this exact expected revision.';
  renderedInspection=null;if(state)renderSource();
}
function interpreted(id,old){
  const text=$(id).value;
  // Preserve structured source definitions unless the operator explicitly edited their rendered JSON.
  if(typeof old==='object'&&old!==null){try{return JSON.parse(text);}catch{throw localError('Preserve valid JSON for the structured '+id+' definition.');}}
  return text.trim();
}
function collectAgreement(){
  if(!agreement)throw localError('Load the blank template or the original complete agreement first.');
  if(!$('processing-ack').checked)throw localError('Review and explicitly choose the actual source processing semantics.');
  const intendedId=$('draft-id').value.trim();
  if(state.drafts.some(x=>x.id===intendedId)&&loadedDraftId!==intendedId)throw localError('Load the current saved agreement before replacing that existing draft.');
  const value=copy(agreement),old=value.customer_decisions??{},inspection=currentInspection();
  const selectedForms=[...document.querySelectorAll('[data-form]:checked')].map(x=>({project_id:String(inspection?.project.id),form_id:x.dataset.form}));
  if(!inspection)throw localError('Choose a completed original project inspection.');
  const priorForms=new Map((old.selected_forms??[]).filter(plain).map(x=>[x.form_id??x.formId??x.xmlFormId,x]));
  const periods=[0,1].map(i=>({...old.periods?.[i],label:$('period-'+i+'-label').value.trim(),
    submitted_from:$('period-'+i+'-start').value.trim(),submitted_before_exclusive:$('period-'+i+'-end').value.trim()}));
  value.opportunity_id=$('opportunity-id').value.trim();value.name=$('agreement-name').value.trim();
  value.customer_decisions={...old,accountable_project_owner:interpreted('project-owner',old.accountable_project_owner),
    technical_receiver:interpreted('technical-receiver',old.technical_receiver),authorized_central_origin:state.connection.url,
    project_id:String(inspection.project.id),selected_forms:selectedForms.map(f=>({...priorForms.get(f.form_id),...f})),
    reporting_timezone:$('reporting-timezone').value.trim(),periods,
    late_edit_policy:interpreted('late-edit',old.late_edit_policy),review_state_inclusion:interpreted('review-states',old.review_state_inclusion),
    media_retention_selection:interpreted('media-policy',old.media_retention_selection),
    approved_output_fields:JSON.parse($('outputs').value),metric_definitions:JSON.parse($('metrics').value)};
  value.processing={...value.processing,reviewStates:'all',lateEdits:'current-state-at-capture',portableSource:'complete-selected-capture'};
  value.commercial_scope={...value.commercial_scope,delivery_business_days:Number($('working-days').value)};
  value.kickoff={...value.kickoff,status:$('kickoff-status').value,start:$('kickoff-start').value||null,
    agreementReference:$('kickoff-reference').value.trim()||null,inputsReadyReference:$('inputs-reference').value.trim()||null,
    capacityReference:$('capacity-reference').value.trim()||null};
  return value;
}
async function fileJson(file){
  if(!file||file.size>2*1024*1024)throw localError('Choose a UTF-8 JSON file up to 2 MiB.');
  return JSON.parse(await file.text());
}
async function download(input){
  const value=await request('/api/downloads',input),a=document.createElement('a');a.href=value.url;a.download=value.name;a.rel='noreferrer';document.body.append(a);a.click();a.remove();
  tell('Opened original '+value.name+' · '+value.bytes+' bytes · SHA-256 '+value.sha256+'.');
}
async function showFields(id){
  const capture=await request('/api/captures/'+encodeURIComponent(id));
  $('native-fields').innerHTML=capture.tables.map(table=>{
    const form=capture.forms.find(x=>x.key===table.formKey);
    return '<div class="card"><h3>'+esc(form?.formId)+' / '+esc(table.name)+'</h3><p>Capture <code>'+esc(id)+
      '</code>; original table <code>'+esc(table.id)+'</code></p><p>Required row keys: <code>'+esc(table.query.keyFields.join(', '))+
      '</code>'+(table.relation?'; repeat parent key: <code>'+esc(table.relation.parentField)+'</code>':'')+
      '</p><pre>'+esc(format(table.query.fields.map(x=>({path:x.path,type:x.type,nullable:x.nullable}))))+'</pre></div>';
  }).join('');
  $('native-fields').closest('details').open=true;
}
$('refresh').addEventListener('click',()=>work(async()=>{await refresh();tell('Current original workspace reloaded. Unsaved agreement fields are preserved.');}));
$('inspect-projects').addEventListener('click',()=>work(async()=>{const result=await operate('inspect-projects','inspect',{projectId:null},['id']);
  if(result?.projects?.length===1)$('project-select').value=String(result.projects[0].id);}));
$('inspect-project').addEventListener('click',()=>work(async()=>{const projectId=$('project-select').value;if(!projectId)throw localError('Select an actual accessible project.');
  const result=await operate('inspect-project','inspect',{projectId},['id']);if(result){$('inspection-select').value=result.id;renderSource();}}));
$('inspection-select').addEventListener('change',()=>{if(!busy){renderedInspection=null;renderSource();}});
$('host-file').addEventListener('change',()=>work(async()=>{hostInput=await fileJson($('host-file').files[0]);tell('Original host handover loaded for review; it has not been saved.');}));
$('record-host').addEventListener('click',()=>work(async()=>{if(!hostInput)throw localError('Load the actual original host handover JSON.');await operate('record-host','recordHost',{handover:hostInput},['id']);}));
$('agreement-file').addEventListener('change',()=>work(async()=>{loadAgreement(await fileJson($('agreement-file').files[0]),{id:'agreement-'+uid()});tell('Complete original agreement loaded. Inspect/select its source and save the reviewed draft.');}));
$('load-example').addEventListener('click',()=>work(async()=>{const response=await fetch('/commissioning/agreement.example.json');if(!response.ok)throw localError('The complete blank template could not be read.');
  loadAgreement(await response.json(),{id:'agreement-'+uid()});tell('Blank source agreement loaded; no project, form, reporting dates or business data have been invented.');}));
$('load-draft').addEventListener('click',()=>work(async()=>{const draft=state.drafts.find(x=>x.id===$('draft-select').value);if(!draft)throw localError('Select a saved original agreement.');
  loadAgreement(draft.agreement,{id:draft.id,revision:draft.revision});tell('Loaded complete original agreement revision '+draft.revision+'.');}));
$('draft-id').addEventListener('change',()=>{if(busy)return;const existing=state?.drafts.find(x=>x.id===$('draft-id').value);
  draftRevision=loadedDraftId===$('draft-id').value?draftRevision:0;$('draft-revision').textContent=existing&&loadedDraftId!==existing.id?'This ID already exists. Load its saved revision before changing it.':'Expected draft revision '+draftRevision;});
$('apply-json').addEventListener('click',()=>work(async()=>{loadAgreement(JSON.parse($('full-agreement').value),{id:$('draft-id').value,revision:draftRevision});tell('Complete JSON loaded into the editor, preserving original additional fields.');}));
$('agreement-form').addEventListener('submit',event=>{event.preventDefault();void work(async()=>{
  const complete=collectAgreement(),id=$('draft-id').value.trim();
  const result=await operate('save-draft','saveDraft',{id,expectedRevision:draftRevision,agreement:complete},['requestId']);
  if(result){agreement=copy(result.agreement);draftRevision=result.revision;loadedDraftId=result.id;$('full-agreement').value=format(agreement);
    $('draft-revision').textContent='Saved complete draft revision '+draftRevision+'.';$('prepare-draft').value=id;$('draft-select').value=id;
    $('readiness').innerHTML=result.readiness.ready?'<p>All required source/report definitions are present. Prepare a version to validate them against the actual inspected source.</p>':
      '<ul>'+result.readiness.issues.map(x=>'<li>'+esc(x.field)+': '+esc(x.message)+'</li>').join('')+'</ul>';}
});});
$('prepare').addEventListener('click',()=>work(async()=>{
  const draft=state.drafts.find(x=>x.id===$('prepare-draft').value),inspection=currentInspection();
  if(!draft||!inspection)throw localError('Select a saved agreement revision and completed native source inspection.');
  const body={id:$('commission-id').value.trim(),draftId:draft.id,draftRevision:draft.revision,inspectionId:inspection.id};
  if($('existing-plans').value.trim())body.existingPlanIds=JSON.parse($('existing-plans').value);
  const result=await operate('prepare','prepare',body);
  if(result){$('commission-select').value=result.id;renderCommission();}
}));
$('commission-select').addEventListener('change',()=>{if(!busy)renderCommission();});
$('install').addEventListener('click',()=>work(async()=>{const c=currentCommission();if(!c)throw localError('Select the prepared commissioning version.');await operate('install','install',{id:c.id});}));
$('deliver').addEventListener('click',()=>work(async()=>{
  const c=currentCommission();if(!c)throw localError('Select the installed commissioning version.');
  const captures=[0,1].map(period=>{const source=c.captures.find(x=>x.id===$('delivery-'+period).value);if(!source?.decision)throw localError('Select both accepted original captures.');
    return {period,captureId:source.id,reviewId:source.decision.id};});
  await operate('deliver','deliver',{id:c.id,captures},['requestId']);
}));
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||busy)return;
  if(target.dataset.recover)void work(()=>executeRetained(target.dataset.recover));
  else if(target.dataset.capturePeriod!==undefined)void work(async()=>{const c=currentCommission();if(!c)throw localError('Select the installed commissioning version.');
    await operate('capture-period-'+target.dataset.capturePeriod,'capturePeriod',{id:c.id,period:Number(target.dataset.capturePeriod)},['requestId']);});
  else if(target.dataset.resume)void work(async()=>{const c=currentCommission();await operate('resume-'+target.dataset.resume,'resumeCapture',{id:c.id,captureId:target.dataset.resume});});
  else if(target.dataset.fields)void work(()=>showFields(target.dataset.fields));
  else if(target.dataset.source)void work(()=>download({kind:'source',hash:target.dataset.source,name:target.dataset.name}));
  else if(target.dataset.export)void work(()=>download({kind:'export',id:target.dataset.export,path:target.dataset.path}));
  else if(target.dataset.deliveryResume)void work(async()=>{const c=currentCommission(),d=c.deliveries.find(x=>x.id===target.dataset.deliveryResume);
    await operate('delivery-resume-'+d.id,'deliver',{id:c.id,requestId:d.id,captures:d.selection.captures});});
});
$('commission-id').value='commission-'+uid();$('draft-id').value='agreement-'+uid();
for(const id of ['field-link','review-link'])$(id).href='/#token='+encodeURIComponent(token??'');
void work(async()=>{if(!token)throw localError('Open the private commissioning link supplied by the original operator host.');
  await refresh();tell('Original workspace opened. Select retained work or prepare a complete source agreement.');});
