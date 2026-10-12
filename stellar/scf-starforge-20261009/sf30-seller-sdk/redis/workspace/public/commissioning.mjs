// MIT. Complete customer commissioning in the original retained Redis workspace.
import { createDraftStore } from '/local-draft-store.mjs';
const $=id=>document.getElementById(id),copy=value=>structuredClone(value),pretty=value=>JSON.stringify(value,null,2);
const names={get:'Value',hash:'Hash fields','sorted-set':'Sorted set',stream:'Stream',list:'List entries',set:'Set members'};
const expectedFields=['rowCount','columns','rows','requiredRows','rowsSha256'];
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const tokenKey='redis-workspace-token:'+location.origin;
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname);}
else token=sessionStorage.getItem(tokenKey)??'';
let state,draft,storage,storageId,pending,review,contract,run,handover,template;
let checkIndex=0,busy=false,dirty=false,historyRows=[],historyCursor=null,pollTimer=null,draftTimer=null,tab='contract';
let observed=null,observedCheck=null,rowCursor='',rowBack=[];
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function button(text,action){const node=el('button',text);node.type='button';node.addEventListener('click',()=>guard(action));return node;}
function table(headers,rows){
  const result=el('table'),head=el('thead'),h=el('tr'),body=el('tbody');
  headers.forEach(value=>h.append(el('th',value)));head.append(h);
  for(const values of rows){const row=el('tr');for(const value of values){const cell=el('td');cell.append(value instanceof Node?value:el('span',value===null?'null':typeof value==='object'?JSON.stringify(value):String(value??'')));row.append(cell);}body.append(row);}
  result.append(head,body);return result;
}
async function request(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'x-workspace-token':token,...(input===undefined?{}:{'content-type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)}),cache:'no-store'});
  const value=await response.json();
  if(!response.ok&&!(value?.id&&value?.status))throw Object.assign(new Error(value.message??value.error??'Workspace request failed.'),{code:value.error,httpStatus:response.status});
  return value;
}
function parse(id,label,kind='object'){
  let value;try{value=JSON.parse($(id).value);}catch{throw new Error('Correct the JSON for '+label+'.');}
  if(kind==='array'?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value))
    throw new Error(label+' must be a JSON '+kind+'.');
  return value;
}
function integer(id,label){const value=$(id).value;if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('Use a whole number for '+label+'.');return Number(value);}
function showTab(next){tab=next;document.querySelectorAll('[data-commission-tab]').forEach(node=>node.setAttribute('aria-current',node.dataset.commissionTab===next?'page':'false'));document.querySelectorAll('.commission-tab').forEach(node=>{node.hidden=node.id!=='commission-panel-'+next;});}
function inputIdentity(value){return {revisionId:value.revisionId,input:value.input,customerPlan:value.customerPlan??null};}
function rawForm(){return Object.fromEntries([...document.querySelectorAll('#commission-panel-contract input[id],#commission-panel-contract select[id],#commission-panel-contract textarea[id]')].map(node=>[node.id,node.type==='checkbox'?node.checked:node.value]));}
async function retainDraft(){
  if(!storage||!draft)return;
  await storage.writeDraft({workspaceId:storageId,originalWorkspaceId:state.workspace.id,draft:copy(draft),raw:rawForm(),checkIndex,dirty,contractId:contract?.id??null});
  $('commission-draft-state').textContent=dirty?'Draft retained in this browser. Review and save the complete contract.':contract?'Saved contract '+contract.id:'New draft from the selected saved product version.';
}
function markDirty(){
  dirty=true;review=null;$('commission-save').disabled=true;$('commission-review-result').hidden=true;
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>{void retainDraft().catch(error=>status(error.message,true));},200);
}
function applyCheck(){
  const current=draft.input.checks[checkIndex];if(!current)return;
  const expected={};
  for(const key of expectedFields)if($('commission-expect-'+key).checked)
    expected[key]=key==='rowCount'?integer('commission-expected-rowCount','expected row count'):key==='rowsSha256'?$('commission-expected-'+key).value.trim():parse('commission-expected-'+key,key,'array');
  draft.input.checks[checkIndex]={id:$('commission-check-id').value.trim(),query:$('commission-check-query').value,
    input:parse('commission-check-input','the original query input'),
    allPages:$('commission-check-all-pages').checked,maxPages:integer('commission-check-max-pages','maximum pages'),
    maxRows:integer('commission-check-max-rows','maximum collected rows'),expected};
}
function customerPlan(){
  if(!$('commission-customer-enabled').checked)return null;
  const products=[];
  for(const [index,route]of draft.input.setup.plan.routes.entries()){
    if(!$('customer-select-'+index).checked)continue;
    const query=draft.input.setup.source.queries[route.query];
    products.push({id:route.id,query:route.query,kind:query.kind,...(query.kind==='set'?{cursorParameter:query.cursor}:{}),
      input:parse('customer-input-'+index,'customer input for '+route.id),maxAtomic:$('customer-atomic-'+index).value.trim(),
      acceptIndex:integer('customer-accept-'+index,'the selected offer'),paymentFlow:$('customer-flow-'+index).value});
  }
  return {schema:'tjlabs.redis-customer-export.v1',operationId:$('commission-customer-operation').value.trim(),
    budget:{maxCalls:integer('commission-customer-calls','maximum buyer calls'),maxAtomic:$('commission-customer-atomic').value.trim()},
    response:{maxBytes:integer('commission-customer-bytes','response bytes'),timeoutMs:integer('commission-customer-timeout','response timeout')},products};
}
function capture(){
  applyCheck();draft.note=$('commission-note').value;draft.input.operationId=$('commission-operation').value.trim();draft.input.requestId=$('commission-creation').value.trim();
  draft.revisionId=$('commission-revision').value;draft.customerPlan=customerPlan();
  if($('commission-stage-enabled').checked){
    const runtime={port:integer('commission-release-port','merchant port')};
    if($('commission-release-facilitator').value.trim())runtime.facilitator=$('commission-release-facilitator').value.trim();
    if($('commission-release-local').checked)runtime.allowLocalFacilitator=true;
    draft.input.release={releaseId:$('commission-release-id').value.trim(),label:$('commission-release-label').value.trim()||$('commission-release-id').value.trim(),runtime};
  }else delete draft.input.release;
}
function renderExpectedControls(){for(const key of expectedFields)$('commission-expected-'+key).disabled=!$('commission-expect-'+key).checked;}
function renderCheck(){
  const check=draft.input.checks[checkIndex];if(!check)return;
  $('commission-check-id').value=check.id;
  $('commission-check-query').replaceChildren(...Object.entries(draft.input.setup.source.queries).map(([name,spec])=>{const option=el('option',name+' · '+names[spec.kind]);option.value=name;return option;}));
  $('commission-check-query').value=check.query;$('commission-check-input').value=pretty(check.input);
  $('commission-check-all-pages').checked=check.allPages??false;$('commission-check-max-pages').value=check.maxPages??100;$('commission-check-max-rows').value=check.maxRows??10000;
  for(const key of expectedFields){$('commission-expect-'+key).checked=Object.hasOwn(check.expected,key);$('commission-expected-'+key).value=key==='rowCount'?check.expected[key]??0:key==='rowsSha256'?check.expected[key]??'':pretty(check.expected[key]??[]);}
  renderExpectedControls();
}
function renderMatrix(){
  const grid=table(['Example','Source product','Native read','Collection','Expected'],draft.input.checks.map((check,index)=>{
    const action=button(check.id||'Unnamed example',async()=>{applyCheck();checkIndex=index;renderCheck();renderMatrix();await retainDraft();});
    return [action,check.query,names[draft.input.setup.source.queries[check.query]?.kind]??'Unknown',check.allPages?'All native pages':'Selected first page',Object.keys(check.expected).join(', ')];
  }));
  [...grid.tBodies[0].rows].forEach((row,index)=>row.setAttribute('aria-selected',String(index===checkIndex)));
  $('commission-matrix').replaceChildren(grid);
}
function field(id,type,value,options={}){
  const node=el(type==='textarea'?'textarea':type==='select'?'select':'input');node.id=id;
  if(type==='textarea'){node.rows=3;node.className='code';node.spellcheck=false;}
  else if(type==='select'){for(const item of options.values??[])node.append(new Option(item,item));}
  else node.type=type;
  if(type==='checkbox')node.checked=value;else node.value=String(value??'');
  if(options.min!==undefined)node.min=String(options.min);if(options.max!==undefined)node.max=String(options.max);
  if(options.label)node.setAttribute('aria-label',options.label);
  return node;
}
function renderCustomer(){
  const plan=draft.customerPlan??template.customerPlan;
  $('commission-customer-enabled').checked=draft.customerPlan!==null;
  $('commission-customer-fields').hidden=!$('commission-customer-enabled').checked;
  $('commission-customer-operation').value=plan.operationId;$('commission-customer-calls').value=plan.budget.maxCalls;
  $('commission-customer-atomic').value=plan.budget.maxAtomic;$('commission-customer-bytes').value=plan.response.maxBytes;$('commission-customer-timeout').value=plan.response.timeoutMs;
  const rows=draft.input.setup.plan.routes.map((route,index)=>{
    const selected=plan.products.find(item=>item.id===route.id),fallback=template.customerPlan.products.find(item=>item.id===route.id);
    const product=selected??fallback??{input:route.example??{},maxAtomic:'0',acceptIndex:0,paymentFlow:'authorization'};
    const description=el('div');description.append(el('strong',route.id),el('p',route.query+' · '+names[draft.input.setup.source.queries[route.query]?.kind],'muted'));
    return [field('customer-select-'+index,'checkbox',!!selected,{label:'Include '+route.id}),description,
      field('customer-input-'+index,'textarea',pretty(product.input),{label:'Customer query input '+route.id}),
      field('customer-atomic-'+index,'text',product.maxAtomic,{label:'Per-call atomic limit '+route.id}),
      field('customer-accept-'+index,'number',product.acceptIndex,{min:0,max:31,label:'Offer index '+route.id}),
      field('customer-flow-'+index,'select',product.paymentFlow,{values:['authorization','upfront'],label:'Payment flow '+route.id})];
  });
  $('commission-customer-products').replaceChildren(table(['Use','Generated operation','Initial input','Per-call ceiling','Offer index','Payment flow'],rows));
}
function renderVersions(){
  const revisions=[...state.revisions.items];
  if(!revisions.some(item=>item.id===draft.revisionId))revisions.unshift({id:draft.revisionId,note:'Selected contract version'});
  $('commission-revision').replaceChildren(...revisions.map(item=>{const option=el('option',item.id.slice(0,12)+' · '+item.note);option.value=item.id;return option;}));
  $('commission-revision').value=draft.revisionId;
}
function renderDraft(){
  $('commission-contract-title').textContent=contract?'Saved customer contract':'Commissioning draft';
  $('commission-note').value=draft.note??'';$('commission-operation').value=draft.input.operationId;$('commission-creation').value=draft.input.requestId;
  renderVersions();
  const profile=draft.input.setup.source.connection;
  const refs=[profile.passwordEnv,profile.sentinelPasswordEnv,profile.tokenEnv].filter(Boolean);
  $('commission-source-summary').textContent=(profile.transport==='upstash-rest'?'Upstash HTTPS':profile.topology??'standalone')+' · '+draft.input.setup.plan.routes.length+' offered products · '+(refs.length?'Source variables: '+refs.join(', '):'Host-declared connection');
  const release=draft.input.release;
  $('commission-stage-enabled').checked=!!release;$('commission-release-id').value=release?.releaseId??'';$('commission-release-label').value=release?.label??'';
  $('commission-release-port').value=release?.runtime?.port??0;$('commission-release-facilitator').value=release?.runtime?.facilitator??'';
  $('commission-release-local').checked=release?.runtime?.allowLocalFacilitator??false;
  checkIndex=Math.max(0,Math.min(checkIndex,draft.input.checks.length-1));renderCheck();renderMatrix();renderCustomer();
  $('commission-save').disabled=!review;
  $('commission-receive').disabled=!contract||!!pending;
  $('commission-receive-contract').textContent=contract?'Contract '+contract.id+' · '+contract.input.input.checks.length+' receiving examples':'Save a reviewed contract to start.';
}
function renderHistory(){
  const list=$('commission-history-list');list.replaceChildren();
  for(const row of historyRows.filter(item=>!$('commission-history-kind').value||item.kind===$('commission-history-kind').value)){
    const box=el('article');box.dataset.selected=String([contract?.id,run?.id,handover?.id].includes(row.id));
    const label=row.kind==='commission-contract'?'Contract':row.kind==='commission-receive'?'Receiving':'Handover';
    box.append(button(label+' · '+(row.operationId??row.id),()=>loadRecord(row.id)));
    box.append(el('p',(row.outcome??row.status)+' · '+row.createdAt,'muted'));
    if(row.note)box.append(el('p',row.note));
    list.append(box);
  }
  if(!list.children.length)list.append(el('p','No matching saved work on this page.','muted'));
  $('commission-history-more').hidden=!historyCursor;
}
async function refreshHistory(more=false){
  const page=await request('/api/commissioning/history'+(more?'?after='+encodeURIComponent(historyCursor):''));
  historyRows=more?[...historyRows,...page.items]:page.items;historyCursor=page.nextCursor;renderHistory();
}
async function adoptContract(value,{reset=true}={}){
  if(value.kind!=='commission-contract'||value.status!=='COMPLETED')throw new Error(value.error?.message??'Select a completed saved contract.');
  contract=value;review=null;
  if(reset){
    template=await request('/api/commissioning/template?revision='+value.input.revisionId);
    draft={revisionId:value.input.revisionId,input:copy(value.input.input),customerPlan:copy(value.input.customerPlan??null),note:value.input.note??''};
    dirty=false;checkIndex=0;renderDraft();await retainDraft();
  }
}
async function loadRecord(id){
  const value=await request('/api/commissioning/operation?id='+encodeURIComponent(id));
  if(value.kind==='commission-contract'){await adoptContract(value);showTab('contract');}
  else if(value.kind==='commission-receive'){
    await adoptContract(await request('/api/commissioning/operation?id='+encodeURIComponent(value.input.contractId)));
    run=value;renderRun();showTab('receiving');
  }else if(value.kind==='commission-handover'){
    handover=value;renderHandover();showTab('handover');
  }
  renderHistory();
}
function renderReview(value){
  review=value;$('commission-review-result').hidden=false;$('commission-save').disabled=false;
  const missing=value.review.setup.environment.filter(item=>!item.available).map(item=>item.name);
  $('commission-review-summary').textContent=value.review.checks.length+' receiving examples cover '+value.review.setup.routes.length+' offered products. '+(missing.length?'Live receiving needs '+missing.join(', ')+'.':'Source environment references are available.')+(value.customer?' Customer export: '+value.customer.plan.products.length+' operations, '+value.customer.plan.budget.maxCalls+' calls, aggregate '+value.customer.plan.budget.maxAtomic+' atomic units.':'');
  $('commission-review-matrix').replaceChildren(table(['Example','Product','Rows/page budget','Comparison'],value.review.checks.map(item=>[item.id,item.query,(item.allPages?'All pages':'First page')+' · '+item.maxPages+' pages / '+item.maxRows+' rows',pretty(item.expected)])));
  $('commission-review-json').textContent=pretty(value);
}
function updatePending(){
  $('commission-pending').hidden=!pending;
  if(pending){
    $('commission-pending-text').textContent='Original '+pending.action+' request '+pending.input.requestId+' · '+(pending.observedStatus??'Awaiting readback');
    $('commission-pending-continue').hidden=!['INTERRUPTED','UNRECORDED'].includes(pending.observedStatus);
    $('commission-pending-continue').textContent=pending.observedStatus==='UNRECORDED'?'Send retained request':'Continue original request';
  }
  $('commission-receive').disabled=!contract||!!pending;$('commission-make-handover').disabled=!run||run.status!=='COMPLETED'||run.result?.status!=='RECEIVED'||!!pending;
}
function schedulePoll(){
  clearTimeout(pollTimer);
  if(pending&&['RUNNING','QUEUED'].includes(pending.observedStatus))
    pollTimer=setTimeout(()=>{void reconcilePending().catch(error=>status(error.message,true));},document.hidden?5000:1500);
}
async function retainPending(){if(pending)await storage.writePending(pending);else await storage.deletePending();updatePending();}
async function consumeOutcome(value){
  if(value.kind==='commission-contract'&&value.status==='COMPLETED'){
    let unchanged=false;try{capture();unchanged=same(inputIdentity(draft),inputIdentity(value.input));}catch{}
    await adoptContract(value,{reset:unchanged});if(!unchanged)await retainDraft();
  }
  if(value.kind==='commission-receive'){run=value;renderRun();}
  if(value.kind==='commission-handover'){handover=value;renderHandover();if(value.status==='COMPLETED')showTab('handover');}
  if(pending?.input.requestId===value.id){
    if(['COMPLETED','FAILED'].includes(value.status))pending=null;
    else pending.observedStatus=value.status;
    await retainPending();
  }
  schedulePoll();
  await refreshHistory();
  if(value.status==='FAILED')status(value.error?.message??'The original operation returned an error.',true);
  else if(value.status==='COMPLETED')status(value.result?.status==='ACCEPTANCE_MISMATCH'?'Receiving saved the expected-result differences. Review the original rows.':value.kind==='commission-contract'?'Complete commissioning contract saved.':value.kind==='commission-handover'?'Complete customer handover is ready.':'Native receiving and customer package are complete.');
  schedulePoll();return value;
}
async function reconcilePending(continueRequest=false){
  if(!pending)return;
  const retained=copy(pending);let value;
  try{value=await request('/api/commissioning/operation?id='+encodeURIComponent(retained.input.requestId));}
  catch(error){
    if(error.httpStatus!==404)throw error;
    pending.observedStatus='UNRECORDED';await retainPending();
    if(!continueRequest){status('The original request is retained locally and ready to send.');return;}
    value=await request('/api/commissioning/'+retained.action,retained.input);
  }
  if(continueRequest&&value.status==='INTERRUPTED')
    value=await request(value.kind==='commission-contract'?'/api/resume':'/api/commissioning/continue',{requestId:value.id});
  return consumeOutcome(value);
}
async function sendAction(action,input){
  if(pending)throw new Error('Retrieve the original pending request before starting another operation.');
  pending={workspaceId:storageId,originalWorkspaceId:state.workspace.id,action,input:{...copy(input),requestId:crypto.randomUUID()},createdAt:new Date().toISOString()};
  const original=copy(pending);
  await retainPending();
  try{return await consumeOutcome(await request('/api/commissioning/'+action,original.input));}
  catch(error){
    if(error.httpStatus>=400&&error.httpStatus<500){
      try{
        const found=await request('/api/commissioning/operation?id='+encodeURIComponent(original.input.requestId));return consumeOutcome(found);
      }catch(readError){if(readError.httpStatus===404&&pending?.input.requestId===original.input.requestId){pending=null;await retainPending();}}
    }
    throw error;
  }
}
function renderRun(){
  $('commission-current-run').hidden=!run;if(!run)return;
  $('commission-run-title').textContent='Receiving '+run.id;
  const outcome=run.result?.status??run.status;
  $('commission-run-status').textContent=outcome+(run.error?' · '+run.error.message:'');
  const p=run.progress??{},total=contract?.input.input.checks.length??p.totalChecks??1;
  $('commission-progress').max=total;$('commission-progress').value=run.result?.checks?.length??p.completedChecks??0;
  $('commission-run-progress').textContent=(p.phase??'Retained request')+(p.checkId?' · '+p.checkId+' · '+(p.pageCount??0)+' pages · '+(p.rowCount??0)+' rows':'')+(p.source?' · '+(p.source.continuationUnavailable??'Native completion not reached'):'');
  const specs=contract?.input.input.checks??[];
  $('commission-run-checks').replaceChildren(table(['Example','Product','Outcome','Rows / pages','Original rows'],specs.map(check=>{
    const result=run.result?.checks?.find(row=>row.id===check.id),progress=run.progressChecks?.find(row=>row?.checkId===check.id);
    const label=result?(result.passed?'Matched':'Differs: '+result.mismatches.join(', ')):progress?(progress.passed?'Matched':'Differs: '+progress.mismatches.join(', ')):p.checkId===check.id?p.phase:'Waiting';
    return [check.id,check.query,label,result?result.rowCount+' / '+result.pages.length:progress?progress.rowCount+' / '+progress.pageCount:'',button('Inspect rows',()=>openRows(check.id))];
  })));
  $('commission-run-json').textContent=pretty(run);$('commission-continue').hidden=run.status!=='INTERRUPTED';
  updatePending();
}
async function openRows(checkId,cursor='',back=false){
  if(!run)return;
  const value=await request('/api/commissioning/rows?run='+encodeURIComponent(run.id)+'&check='+encodeURIComponent(checkId)+'&cursor='+encodeURIComponent(cursor)+'&limit=50');
  if(checkId!==observedCheck){rowBack=[];rowCursor='';}
  else if(!back&&cursor!==rowCursor)rowBack.push(rowCursor);
  observedCheck=checkId;rowCursor=cursor;observed=value;
  $('commission-observed').hidden=false;
  $('commission-observed-summary').textContent=checkId+' · '+value.rows.length+' displayed rows · '+(value.sourceIncomplete?'Native source limit: '+(value.sourceIncomplete.continuationUnavailable??'completion unavailable'):value.receivingLimit?'Receiving limit: '+(value.receivingLimit.reason??value.receivingLimit.message):value.waiting?'Original page is awaiting completion':value.complete?'Final retained page':'More retained rows');
  $('commission-observed-table').replaceChildren(table(value.columns??[],value.rows.map(row=>Array.isArray(row)?row:(value.columns??[]).map(column=>row[column]))));
  $('commission-observed-json').textContent=pretty({...value,rows:undefined});
  $('commission-rows-previous').disabled=!rowBack.length;$('commission-rows-next').disabled=!value.nextCursor||value.waiting;
}
function renderHandover(){
  const ready=handover?.status==='COMPLETED'&&handover.result?.status==='HANDOVER_READY';
  $('commission-handover-empty').hidden=ready;$('commission-handover-ready').hidden=!ready;
  if(!ready){$('commission-handover-empty').textContent=handover?handover.status+(handover.error?' · '+handover.error.message:' · preparing original public files'):'Complete a receiving run, then prepare its customer handover.';return;}
  const value=handover.result;
  $('commission-handover-title').textContent=value.file.name;
  $('commission-handover-summary').textContent=value.members.length+' complete files · '+value.file.bytes.toLocaleString()+' ZIP bytes · original receiving '+value.runId;
  $('commission-handover-files').replaceChildren(table(['File','Complete bytes','SHA256'],value.members.map(item=>[item.path,item.bytes,item.sha256])));
  $('commission-handover-json').textContent=pretty(value);
}
function download(name,value,type='application/json'){
  const url=URL.createObjectURL(value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type}));
  const link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadHandover(){
  const response=await fetch('/api/commissioning/handover?id='+encodeURIComponent(handover.id),{headers:{'x-workspace-token':token},cache:'no-store'});
  if(!response.ok){const error=await response.json();throw new Error(error.message??'The saved handover could not be read.');}
  const bytes=await response.arrayBuffer(),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==handover.result.file.bytes||actual!==handover.result.file.sha256)throw new Error('The downloaded handover differs from its retained file identity.');
  download(handover.result.file.name,new Blob([bytes],{type:'application/zip'}));status('Complete customer handover downloaded.');
}
async function newContract(){
  const revision=$('commission-revision').value||state.workspace.head;
  template=await request('/api/commissioning/template?revision='+encodeURIComponent(revision));draft={...copy(template),note:''};contract=null;review=null;dirty=true;checkIndex=0;
  renderDraft();showTab('contract');await retainDraft();status('New commissioning draft uses the selected saved product version.');
}
async function refresh(){
  state=await request('/api/state');$('commission-workspace-label').textContent=state.workspace.label+' · '+state.workspace.id;
  renderVersions();await refreshHistory();
  if(pending)await reconcilePending();
  else{
    if(run){run=await request('/api/commissioning/operation?id='+encodeURIComponent(run.id));renderRun();}
    if(handover){handover=await request('/api/commissioning/operation?id='+encodeURIComponent(handover.id));renderHandover();}
  }
}
async function guard(action){
  if(busy)return;busy=true;
  try{await action();}catch(error){status(error.message,true);}
  finally{busy=false;updatePending();}
}
function on(id,action){$(id).addEventListener('click',()=>guard(action));}
document.querySelectorAll('[data-commission-tab]').forEach(node=>node.addEventListener('click',()=>guard(async()=>{await retainDraft();showTab(node.dataset.commissionTab);})));
$('commission-panel-contract').addEventListener('input',event=>{if(event.target.matches('input,textarea,select'))markDirty();});
$('commission-panel-contract').addEventListener('change',event=>{if(event.target.matches('input,textarea,select'))markDirty();renderExpectedControls();$('commission-customer-fields').hidden=!$('commission-customer-enabled').checked;});
$('commission-history-kind').addEventListener('change',renderHistory);
$('commission-check-query').addEventListener('change',()=>{const route=draft.input.setup.plan.routes.find(value=>value.query===$('commission-check-query').value);$('commission-check-input').value=pretty(route?.example??{});markDirty();});
$('commission-revision').addEventListener('change',()=>guard(async()=>{
  applyCheck();const revision=$('commission-revision').value,newTemplate=await request('/api/commissioning/template?revision='+encodeURIComponent(revision));
  draft.input.setup=copy(newTemplate.input.setup);draft.revisionId=revision;
  draft.input.checks=draft.input.checks.filter(check=>Object.hasOwn(draft.input.setup.source.queries,check.query));
  const covered=new Set(draft.input.checks.map(check=>check.query));
  for(const check of newTemplate.input.checks)if(!covered.has(check.query)){let n=1;while(draft.input.checks.some(item=>item.id==='example-'+n))n++;draft.input.checks.push({...check,id:'example-'+n});covered.add(check.query);}
  if(draft.customerPlan)draft.customerPlan.products=draft.customerPlan.products.filter(product=>newTemplate.customerPlan.products.some(item=>item.id===product.id&&item.query===(product.query??product.id)&&item.kind===product.kind));
  template=newTemplate;contract=null;dirty=true;review=null;renderDraft();await retainDraft();
}));
on('commission-add-check',async()=>{capture();let n=1;while(draft.input.checks.some(item=>item.id==='example-'+n))n++;const query=Object.keys(draft.input.setup.source.queries)[0],route=draft.input.setup.plan.routes.find(item=>item.query===query);draft.input.checks.push({id:'example-'+n,query,input:copy(route?.example??{}),allPages:false,maxPages:100,maxRows:10000,expected:{rowCount:1}});checkIndex=draft.input.checks.length-1;markDirty();renderCheck();renderMatrix();await retainDraft();});
on('commission-remove-check',async()=>{if(draft.input.checks.length===1)throw new Error('Keep at least one receiving example.');draft.input.checks.splice(checkIndex,1);checkIndex=Math.min(checkIndex,draft.input.checks.length-1);markDirty();renderCheck();renderMatrix();await retainDraft();});
on('commission-apply-check',async()=>{capture();markDirty();renderMatrix();await retainDraft();status('Example applied to the complete draft.');});
on('commission-review',async()=>{capture();await retainDraft();renderReview(await request('/api/commissioning/review',inputIdentity(draft)));status('Complete source, expected results, customer terms and release selection reviewed.');});
on('commission-save',async()=>{capture();if(!review)throw new Error('Review the complete contract first.');const result=await sendAction('save',{...inputIdentity(draft),digest:review.digest,note:draft.note??''});if(result?.status==='COMPLETED')showTab('receiving');});
on('commission-receive',async()=>{capture();if(!contract||!same(inputIdentity(draft),inputIdentity(contract.input)))throw new Error('Save the changed commissioning contract before receiving it.');showTab('receiving');await sendAction('receive',{contractId:contract.id});});
on('commission-inspect-run',async()=>{if(run)await consumeOutcome(await request('/api/commissioning/operation?id='+encodeURIComponent(run.id)));});
on('commission-continue',async()=>{
  if(!run)return;
  if(pending&&pending.input.requestId!==run.id)throw new Error('Retrieve the retained pending request before continuing this run.');
  if(!pending){pending={workspaceId:storageId,originalWorkspaceId:state.workspace.id,action:'receive',input:copy(run.input),createdAt:run.createdAt,observedStatus:run.status};await retainPending();}
  await reconcilePending(true);
});
on('commission-pending-refresh',()=>reconcilePending());
on('commission-pending-continue',()=>reconcilePending(true));
on('commission-make-handover',async()=>{if(!run)throw new Error('Select the original receiving run.');showTab('handover');await sendAction('handover',{runId:run.id});});
on('commission-download-run',()=>{if(run)download('redis-receiving-'+run.id+'.json',run);});
on('commission-rows-next',()=>openRows(observedCheck,observed.nextCursor));
on('commission-rows-previous',()=>{const cursor=rowBack.pop();return openRows(observedCheck,cursor,true);});
on('commission-rows-download',()=>{if(observed)download('redis-'+observedCheck+'-retained-page.json',observed);});
on('commission-download-handover',downloadHandover);
on('commission-handover-receiving',()=>loadRecord(handover.input.runId));
on('commission-release-controls',async()=>{const result=await request('/api/release-console',{}),link=el('a','Open original release controls');link.href=result.operatorUrl;link.target='_blank';link.rel='noopener noreferrer';$('status').replaceChildren(link);});
on('commission-download',async()=>{capture();download('redis-commissioning-contract.json',{schema:'stellar-forge.redis-commissioning-workbook.v1',...inputIdentity(draft),note:draft.note??''});await retainDraft();});
$('commission-import').addEventListener('change',()=>guard(async()=>{
  const file=$('commission-import').files[0];if(!file)return;if(file.size>5242880)throw new Error('Select a complete commissioning input or workbook within 5 MiB.');
  const value=JSON.parse(await file.text());
  if(value.schema==='stellar-forge.redis-commissioning-workbook.v1')draft={revisionId:value.revisionId,input:value.input,customerPlan:value.customerPlan??null,note:value.note??''};
  else if(value.schema==='stellar-forge.redis-commissioning-input.v1')draft={revisionId:state.workspace.head,input:value,customerPlan:null,note:''};
  else throw new Error('Select an original Redis commissioning input or workbook.');
  if(!Array.isArray(draft.input.checks)||!draft.input.checks.length)throw new Error('The imported contract needs its receiving examples.');
  template=await request('/api/commissioning/template?revision='+encodeURIComponent(draft.revisionId));
  contract=null;review=null;dirty=true;checkIndex=0;renderDraft();await retainDraft();$('commission-import').value='';status('Complete contract imported. Review it against this selected saved source.');
}));
on('commission-new',newContract);on('commission-history-more',()=>refreshHistory(true));on('commission-refresh',refresh);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
guard(async()=>{
  state=await request('/api/state');storageId=state.workspace.id+':commissioning';storage=createDraftStore(storageId);
  const retained=await storage.readDraft();pending=await storage.readPending();
  if(pending&&pending.originalWorkspaceId!==state.workspace.id)throw new Error('The retained request belongs to another workspace.');
  if(retained&&retained.originalWorkspaceId===state.workspace.id){
    draft=retained.draft;dirty=retained.dirty;checkIndex=retained.checkIndex??0;
    template=await request('/api/commissioning/template?revision='+encodeURIComponent(draft.revisionId));
    if(retained.contractId){try{contract=await request('/api/commissioning/operation?id='+encodeURIComponent(retained.contractId));}catch(error){if(error.httpStatus!==404)throw error;}}
    renderDraft();for(const [id,value]of Object.entries(retained.raw??{})){const node=$(id);if(node){if(node.type==='checkbox')node.checked=value;else node.value=value;}}
    renderExpectedControls();$('commission-customer-fields').hidden=!$('commission-customer-enabled').checked;
  }else{template=await request('/api/commissioning/template');draft={...copy(template),note:''};renderDraft();}
  $('commission-workspace-label').textContent=state.workspace.label+' · '+state.workspace.id;$('commission-main').hidden=false;
  await refreshHistory();await retainDraft();if(pending)await reconcilePending();else status('Saved customer commissioning workspace ready.');
});
