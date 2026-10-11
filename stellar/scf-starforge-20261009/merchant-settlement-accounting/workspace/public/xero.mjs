// MIT. Original accounting workspace Xero operator workflow.
const $=id=>document.getElementById(id);
let state,source,preview,detail,comparison,returnPreview,operationTimer,busy=false;
const actor=$('actor');
actor.value=localStorage.getItem('merchant-accounting-xero-actor')??'';
actor.addEventListener('change',()=>localStorage.setItem('merchant-accounting-xero-actor',actor.value.trim()));
function operator(){const value=actor.value.trim();if(!value)throw Error('Enter the operator name first.');return value;}
function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);$('notice').hidden=false;}
function node(tag,text,attributes={}){const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=String(text);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,String(value));return el;}
function jsonDetails(label,value){const el=node('details');el.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));return el;}
function table(headers,rows){const wrap=node('div',null,{class:'xero-scroll'}),el=node('table'),thead=node('thead'),tr=node('tr');for(const header of headers)tr.append(node('th',header));thead.append(tr);el.append(thead);const body=node('tbody');for(const row of rows){const rowEl=node('tr');for(const value of row){const td=node('td');if(value instanceof Node)td.append(value);else td.textContent=value??'';rowEl.append(td);}body.append(rowEl);}el.append(body);wrap.append(el);return wrap;}
function options(select,rows,label,selected){select.replaceChildren(node('option','Choose…',{value:''}));for(const row of rows)select.append(node('option',label(row),{value:row.id}));if(rows.some(row=>row.id===selected))select.value=selected;}
function summary(plan){const result=node('div');result.append(node('p',plan.name+' · '+plan.context.organization.name+' · '+plan.context.organization.baseCurrency));result.append(jsonDetails('Journal summary and source',plan.summary));result.append(table(['Journal date','Narration','Lines','Total debits','State'],plan.journals.map(journal=>[journal.date,journal.narration,journal.payload?.JournalLines?.length??journal.lines?.length,journal.debitTotal??journal.total??'',journal.payload?.Status??'DRAFT'])));for(const journal of plan.journals)result.append(jsonDetails('Native draft · '+journal.narration,journal.payload));if(plan.excluded?.length)result.append(jsonDetails('Explicit source exclusions',plan.excluded));return result;}
async function api(path,value){const response=await fetch(path,{method:value===undefined?'GET':'POST',cache:'no-store',headers:value===undefined?{}:{'Content-Type':'application/json','X-Workspace-Request':'1'},...(value===undefined?{}:{body:JSON.stringify(value)})});let result;try{result=await response.json();}catch{throw Error('The local workspace did not return a JSON response.');}if(!response.ok)throw Error(result.message??result.error??'Workspace request failed.');return result;}
async function action(fn){if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');try{return await fn();}catch(error){notice(error.message??String(error),true);}finally{busy=false;document.body.removeAttribute('aria-busy');}}
async function encoded(file){if(!file)throw Error('Choose the original JSON response file.');if(file.size>64_000_000)throw Error('Use an original source response of at most 64 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
function record(){return detail?.record;}
function selectedPlan(){if(!$('plans').value)throw Error('Choose a saved journal plan.');return $('plans').value;}
function planPath(){return '/api/xero/plans/'+encodeURIComponent(selectedPlan());}
function capturePath(){if(!$('capture').value)throw Error('Choose a retained comparison.');return planPath()+'/captures/'+encodeURIComponent($('capture').value);}
function clearReturn(){returnPreview=null;$('return').hidden=true;}
function connectionAvailable(){return Boolean(state?.connection?.available);}
async function refresh(){
  const oldHandoff=$('handoff').value,oldContext=$('context').value,oldPlan=$('plans').value;
  state=await api('/api/xero');
  $('workspace-revision').textContent='Workspace revision '+state.revision;
  $('connection').textContent=connectionAvailable()?'Xero connection configured in the server process.':'Native source import is available. Configure the Xero connection in the server process for API reads and draft creation.';
  options($('handoff'),state.handoffs,row=>row.name+' · '+row.id.slice(0,8),oldHandoff);
  options($('context'),state.contexts,row=>row.name+' · '+(row.baseCurrency??row.organization?.baseCurrency??'')+' · '+row.id.slice(0,8),oldContext);
  options($('plans'),state.plans,row=>row.name+' · '+(row.cancelledAt?'CANCELLED':row.createdAt??row.id.slice(0,8)),oldPlan);
  $('contexts').replaceChildren(table(['Organization','Base currency','Account source','Recorded'],state.contexts.map(row=>[row.name,row.baseCurrency??row.organization?.baseCurrency??'',row.accountCount??'',row.createdAt??''])));
  document.querySelector('#context-form button[value="capture"]').disabled=!connectionAvailable();
}
function labelled(text,input){const label=node('label',text);label.append(input);return label;}
function input(name,{value='',required=false,type='text',placeholder='',maxLength}={}){const element=node('input',null,{name,type});element.value=value;element.required=required;element.placeholder=placeholder;if(maxLength)element.maxLength=maxLength;return element;}
function accountSelect(name,accounts){const el=node('select',null,{name});el.required=true;el.append(node('option','Choose an account',{value:''}));for(const account of accounts)el.append(node('option',account.code+' · '+account.name,{value:account.code}));return el;}
function renderSource(){
  $('components').replaceChildren();$('source-summary').textContent=source.components.length+' original payment or verified refund components. Choose an accounting treatment for each.';
  $('plan-form').elements.purpose.value=source.context.organization.isDemoCompany?'demo':'books';
  $('plan-form').elements.name.value=source.handoff.name+' · Xero';
  const accounts=source.context.accounts.filter(account=>account.eligible);
  for(const [index,component]of source.components.entries()){
    const article=node('article',null,{class:'xero-component','data-component':component.id});
    article.append(node('h4',(index+1)+'. '+component.kind+' · '+component.eventId),node('p','Original '+component.amountAtomic+' atomic units · '+component.network,{class:'source'}),jsonDetails('Original component',component));
    const decision=node('select',null,{name:'decision'});decision.append(node('option','Choose treatment',{value:''}),node('option','Include in journals',{value:'include'}),node('option','Exclude with a reason',{value:'exclude'}));decision.required=true;article.append(labelled('Accounting treatment',decision));
    const included=node('div',null,{'data-included':'1',hidden:''}),excluded=node('div',null,{'data-excluded':'1',hidden:''});
    const first=node('div',null,{class:'xero-grid'}),second=node('div',null,{class:'xero-grid'});
    first.append(labelled('Value in '+source.context.organization.baseCurrency,input('amount',{placeholder:'0.00',required:true})),labelled('Journal date',input('date',{type:'date',value:component.sourceAt?.slice(0,10)??'',required:true})));
    second.append(labelled('Debit account',accountSelect('debitAccountCode',accounts)),labelled('Credit account',accountSelect('creditAccountCode',accounts)));
    included.append(first,second,labelled('Valuation source for this component',input('valuationNote',{required:true,maxLength:2000})),labelled('Description',input('description',{value:component.kind+' '+component.eventId,maxLength:2000})));
    excluded.append(labelled('Exclusion reason',input('reason',{required:true,maxLength:2000})));
    function treatment(){included.hidden=decision.value!=='include';excluded.hidden=decision.value!=='exclude';for(const control of included.querySelectorAll('input,select'))control.disabled=included.hidden;for(const control of excluded.querySelectorAll('input'))control.disabled=excluded.hidden;invalidatePreview();}
    decision.addEventListener('change',treatment);article.append(included,excluded);$('components').append(article);treatment();
  }
  $('plan-form').hidden=false;invalidatePreview();
}
function invalidatePreview(){preview=null;$('preview').hidden=true;}
$('actor').addEventListener('input',()=>{invalidatePreview();clearReturn();});
$('plan-form').addEventListener('input',invalidatePreview);
$('handoff').addEventListener('change',()=>{source=null;$('plan-form').hidden=true;invalidatePreview();});
$('context').addEventListener('change',()=>{source=null;$('plan-form').hidden=true;invalidatePreview();});
$('refresh').addEventListener('click',()=>action(refresh));
$('context-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const form=event.currentTarget,request={id:crypto.randomUUID(),revision:state.revision,actor:operator(),name:form.elements.name.value.trim(),tenantId:form.elements.tenantId.value.trim()};
  if(event.submitter.value==='import'){request.organizationBase64=await encoded(form.elements.organizationFile.files[0]);request.accountsBase64=await encoded(form.elements.accountsFile.files[0]);}
  const result=await api('/api/xero/contexts/'+event.submitter.value,request);await refresh();const id=result.context?.id??result.record?.id??request.id;$('context').value=id;notice('Retained the original Xero organization and account responses.');form.reset();
});});
$('source-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{source=await api('/api/xero/source?'+new URLSearchParams({handoffId:$('handoff').value,contextId:$('context').value}));renderSource();notice('Original source loaded. Enter an explicit accounting treatment for each component.');});});
$('plan-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const form=event.currentTarget,entries=[...$('components').querySelectorAll('[data-component]')].map(article=>{const values=Object.fromEntries([...article.querySelectorAll('input,select')].filter(el=>!el.disabled).map(el=>[el.name,el.value]));return {componentId:article.dataset.component,...values};});
  const request={id:crypto.randomUUID(),name:form.elements.name.value.trim(),actor:operator(),createdAt:new Date().toISOString(),handoffId:$('handoff').value,contextId:$('context').value,accountantRevisionId:source.accountantRevisionId??'initial',purpose:form.elements.purpose.value,valuationBasis:form.elements.valuationBasis.value.trim(),showOnCashBasisReports:form.elements.cashBasis.checked,entries};
  preview=await api('/api/xero/preview',request);$('preview-content').replaceChildren(summary(preview.plan));if(preview.conflicts.length)$('preview-content').append(jsonDetails('Components already reserved by other active plans',preview.conflicts));$('save').disabled=Boolean(preview.conflicts.length);$('preview').hidden=false;notice('Review the exact draft journal payloads before saving the plan.');
});});
$('save').addEventListener('click',()=>action(async()=>{if(!preview)throw Error('Review a journal plan first.');const saved=await api('/api/xero/plans',{...preview.request,revision:preview.workspaceRevision,previewSha256:preview.previewSha256});const id=saved.record?.id??saved.plan?.id??preview.request.id;invalidatePreview();await refresh();$('plans').value=id;await loadPlan();notice('Saved the journal plan with its original accounting and Xero source.');}));
async function loadPlan(){
  clearTimeout(operationTimer);clearReturn();comparison=null;$('captures').hidden=true;detail=null;
  if(!$('plans').value){$('plan-detail').replaceChildren();for(const id of ['native','response-form','reload-plan','cancel-form'])$(id).hidden=true;return;}
  detail=await api(planPath());const retained=record(),plan=detail.plan;$('plan-detail').replaceChildren(summary(plan));
  const links=node('div',null,{class:'xero-links'});
  for(const [name,label]of [['xero-handoff.tar','Download complete Xero handoff'],['plan.json','Download saved journal plan'],['review.html','Open retained review']])links.append(node('a',label,{href:planPath()+'/download/'+encodeURIComponent(name)}));
  $('plan-detail').append(links,jsonDetails('Delivery state',retained));
  const retainedFiles=node('details');retainedFiles.append(node('summary','Retained requests, responses and source files'));const fileLinks=node('div',null,{class:'xero-links'});for(const file of retained.files)fileLinks.append(node('a',file.name,{href:planPath()+'/download/'+file.name.split('/').map(encodeURIComponent).join('/')}));retainedFiles.append(fileLinks);$('plan-detail').append(retainedFiles);
  for(const intent of retained.returnIntents.filter(intent=>intent.status==='PREPARED')){const resume=node('button','Complete retained accountant return '+intent.id.slice(0,8),{type:'button'});resume.addEventListener('click',()=>action(async()=>{await api(planPath()+'/captures/'+encodeURIComponent(intent.captureId)+'/returns',{id:intent.id,previewSha256:intent.previewSha256});await refresh();await loadPlan();notice('Completed the retained original accountant return.');}));$('plan-detail').append(resume);}
  if(retained.cancelledAt)$('plan-detail').append(node('p','Cancelled: '+retained.cancellationReason,{class:'xero-callout'}));
  $('reload-plan').hidden=false;$('native').hidden=Boolean(retained.cancelledAt);$('response-form').hidden=Boolean(retained.cancelledAt);
  $('create-drafts').disabled=!connectionAvailable()||!retained.journals.some(journal=>(!journal.attempted||journal.status==='REJECTED')&&!journal.journalId);
  $('refresh-native').disabled=!connectionAvailable();
  $('cancel-form').hidden=Boolean(retained.cancelledAt)||retained.journals.some(journal=>journal.attempted||journal.journalId)||retained.captures.some(capture=>capture.nativeJournalCount>0);
  const oldCapture=$('capture').value;options($('capture'),retained.captures,row=>row.createdAt+' · '+row.id.slice(0,8),oldCapture);
  $('captures').hidden=retained.captures.length===0;
  if(retained.captures.length){$('capture').value=retained.captures.some(row=>row.id===oldCapture)?oldCapture:retained.captures.at(-1).id;await loadComparison();}
  const operation=retained.operations.at(-1);$('operation').replaceChildren();if(operation){$('operation').append(jsonDetails('Latest native operation',operation));if(['QUEUED','RUNNING'].includes(operation.status))pollOperation(operation.id);}
}
$('plans').addEventListener('change',()=>action(loadPlan));$('reload-plan').addEventListener('click',()=>action(async()=>{await refresh();await loadPlan();}));
async function nativeOperation(actionName){
  const request={id:crypto.randomUUID(),revision:state.revision,actor:operator(),action:actionName,planSha256:detail.plan.sha256},queued=await api(planPath()+'/operations',request);
  notice(actionName==='create-drafts'?'Draft creation started. Each request and native response is retained in this plan.':'Reading the original journals from Xero.');
  await refresh();await loadPlan();const op=queued.operation?.id??queued.id;if(op)pollOperation(op);
}
$('create-drafts').addEventListener('click',()=>action(()=>nativeOperation('create-drafts')));
$('refresh-native').addEventListener('click',()=>action(()=>nativeOperation('refresh')));
function pollOperation(id){
  clearTimeout(operationTimer);const planId=$('plans').value;
  operationTimer=setTimeout(async()=>{if($('plans').value!==planId)return;try{const operation=await api('/api/xero/plans/'+encodeURIComponent(planId)+'/operations/'+encodeURIComponent(id));$('operation').replaceChildren(jsonDetails('Native operation',operation));if(['QUEUED','RUNNING'].includes(operation.status)){pollOperation(id);return;}await refresh();if($('plans').value===planId)await loadPlan();notice('Native operation '+operation.status+'. '+(operation.error?.message??'The retained source is ready to review.'),!['COMPLETE','COMPLETED'].includes(operation.status));}catch(error){notice(error.message,true);}},1250);
}
$('response-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const files=[];for(const file of event.currentTarget.elements.files.files)files.push({name:file.name,base64:await encoded(file)});await api(planPath()+'/captures',{id:crypto.randomUUID(),revision:state.revision,actor:operator(),files});await refresh();await loadPlan();notice('Retained the original response files and journal comparison.');});});
async function loadComparison(){clearReturn();comparison=await api(capturePath());$('comparison').replaceChildren(jsonDetails('Full journal comparison',comparison));if(comparison.summary)$('comparison').prepend(jsonDetails('Comparison summary',comparison.summary));}
$('capture').addEventListener('change',()=>action(loadComparison));
$('preview-return').addEventListener('click',()=>action(async()=>{
  const request={id:crypto.randomUUID(),name:detail.plan.name+' · Xero return',actor:operator(),createdAt:new Date().toISOString()};
  returnPreview=await api(capturePath()+'/preview',request);$('return-preview').replaceChildren(jsonDetails('Original accountant import preview',returnPreview.preview??returnPreview.accountantPreview??returnPreview));
  if(returnPreview.conflicts?.length)$('return-preview').prepend(jsonDetails('Later accountant edits requiring review',returnPreview.conflicts));
  if(returnPreview.skipped?.length)$('return-preview').append(jsonDetails('Rows not proposed for this return',returnPreview.skipped));
  $('apply-return').disabled=!returnPreview.matchedRows;$('return').hidden=false;notice('Review the original accountant return. Matching drafts produce REVIEWED rows; posted journals produce BOOKED rows.');
}));
$('apply-return').addEventListener('click',()=>action(async()=>{if(!returnPreview)throw Error('Preview the accountant return first.');await api(capturePath()+'/returns',{...returnPreview.request,revision:returnPreview.workspaceRevision,previewSha256:returnPreview.previewSha256});await refresh();await loadPlan();notice('Applied the return through the original accountant history. Download the complete handoff to carry its source and return together.');}));
$('cancel-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{await api(planPath()+'/cancel',{revision:state.revision,actor:operator(),reason:event.currentTarget.elements.reason.value.trim(),noExternalImport:event.currentTarget.elements.noExternalImport.checked});await refresh();await loadPlan();notice('Cancelled the unused plan and released its local source reservation.');});});
window.addEventListener('pagehide',()=>clearTimeout(operationTimer));
action(refresh);
