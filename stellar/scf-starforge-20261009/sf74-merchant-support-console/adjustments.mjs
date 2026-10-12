// MIT. Complete saved-case Service adjustments and original buyer/accountant operation.
const $=id=>document.getElementById(id),uuid=()=>crypto.randomUUID(),copy=value=>structuredClone(value);
const state={caseId:null,view:null,buyerView:null,buyer:null,prepared:null,pending:null,busy:false,cases:[],caseOffset:null,runs:[],runOffset:null,events:[],eventOffset:null,buyerInstance:null,labelBasis:null,centerBasis:null,periodBasis:null,accountantReturn:null};
const text=(id,value)=>{$(id).textContent=String(value??'');};
const message=(value,error=false)=>{text('message',value);$('message').dataset.error=String(error);};
const value=id=>$(id).value.trim();
const required=id=>{const result=value(id);if(!result)throw new Error('Complete '+($(id).closest('label')?.firstChild?.textContent?.trim()??id)+'.');return result;};
const actor=()=>required('operator-name');
const idb=new Promise((accept,reject)=>{
  const request=indexedDB.open('merchant-service-adjustments',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('requests');
  request.onerror=()=>reject(new Error('The browser could not open its retained request store.'));
  request.onsuccess=()=>accept(request.result);
});
async function storage(action,key,input){
  const db=await idb;
  return new Promise((accept,reject)=>{
    const tx=db.transaction('requests',action==='get'?'readonly':'readwrite'),store=tx.objectStore('requests');
    const req=action==='get'?store.get(key):action==='set'?store.put(input,key):store.delete(key);
    let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>accept(result);
    tx.onerror=tx.onabort=()=>reject(new Error('The complete request could not be retained in this browser.'));
  });
}
const key=name=>'service:'+location.origin+':'+state.caseId+':'+name;
const samePending=(a,b)=>Boolean(a&&b)&&a.path===b.path&&JSON.stringify(a.body)===JSON.stringify(b.body);
async function pendingStore(mode,pending){
  const db=await idb,selected=key('pending');
  return new Promise((accept,reject)=>{
    let error,result;
    const tx=db.transaction('requests','readwrite'),s=tx.objectStore('requests'),read=s.get(selected);
    read.onsuccess=()=>{
      const current=read.result;
      if(current&&!samePending(current,pending)){
        error=Object.assign(new Error('Another tab has retained a different request for this case. Recover that original request before continuing.'),{pending:current});tx.abort();return;
      }
      result=current;
      if(mode==='clear')s.delete(selected);else s.put(copy(pending),selected);
    };
    tx.oncomplete=()=>accept(result);
    tx.onabort=tx.onerror=()=>reject(error??new Error('The original pending request could not be retained.'));
  });
}
async function preparationStoreClear(materialId){
  const db=await idb,selected=key('prepared');
  return new Promise((accept,reject)=>{
    let current;
    const tx=db.transaction('requests','readwrite'),s=tx.objectStore('requests'),read=s.get(selected);
    read.onsuccess=()=>{current=read.result;if(current?.material?.id===materialId){s.delete(selected);current=null;}};
    tx.oncomplete=()=>accept(current??null);tx.onabort=tx.onerror=()=>reject(new Error('The prepared action could not be reconciled.'));
  });
}
async function ensureNoPending(){
  const current=await storage('get',key('pending'));
  if(current){state.pending=current;renderPending();throw new Error('Recover the retained request before preparing another case operation.');}
}

async function http(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:body===undefined?{accept:'application/json'}:{accept:'application/json','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.detail??result.error??'The original operation did not complete.'),{status:response.status,code:result.error,currentRevision:result.currentRevision});
  return result;
}
async function work(operation){
  if(state.busy)return;
  state.busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await operation();}
  catch(error){message(error.message,true);}
  finally{state.busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);renderPending();}
}
function options(id,items,getValue,getLabel,{empty='Choose…',append=false}={}){
  const node=$(id),selected=node.value;
  if(!append)node.replaceChildren(new Option(empty,''));
  for(const item of items){const option=new Option(getLabel(item),String(getValue(item)));node.append(option);}
  if([...node.options].some(option=>option.value===selected))node.value=selected;
}
function table(id,head,rows){
  const target=$(id);target.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='No retained records for this selection.';target.append(p);return;}
  const t=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
  for(const label of head){const th=document.createElement('th');th.textContent=label;tr.append(th);}thead.append(tr);t.append(thead);
  const body=document.createElement('tbody');
  for(const row of rows){const line=document.createElement('tr');for(const cell of row){const td=document.createElement('td');if(cell instanceof Node)td.append(cell);else td.textContent=String(cell??'');line.append(td);}body.append(line);}
  t.append(body);target.append(t);
}
function detail(id,rows){
  const dl=document.createElement('dl');
  for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.className='review-value';dd.textContent=typeof value==='object'?JSON.stringify(value,null,2):String(value??'');dl.append(dt,dd);}
  $(id).replaceChildren(dl);
}
function download(name,body,type='application/json'){
  const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const saveJson=(name,value)=>download(name,JSON.stringify(value,null,2)+'\n');
async function remoteFile(route,body){
  const response=await fetch(route,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){const problem=await response.json();throw new Error(problem.detail??problem.error??'The original file is unavailable.');}
  const bytes=await response.arrayBuffer(),expected=response.headers.get('x-content-sha256');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(!expected||expected!==actual)throw new Error('The downloaded file differs from its retained original bytes.');
  const name=/filename="([A-Za-z0-9_.-]+)"/.exec(response.headers.get('content-disposition')??'')?.[1];
  if(!name)throw new Error('The original delivery filename is missing.');
  download(name,bytes,response.headers.get('content-type')??'application/octet-stream');message('Downloaded '+name+'.');
}
const route=action=>'/api/cases/'+state.caseId+'/adjustments'+(action?'/'+action:'');
function selectedProposal(){const found=state.view?.proposals.find(row=>row.id===value('proposal-picker'));if(!found)throw new Error('Choose the saved reviewed proposal.');return found;}
function renderPending(){
  $('pending').hidden=!state.pending;
  if(!state.pending)return;
  text('pending-description',state.pending.label+'. The complete original request is retained for recovery.'+(state.pending.error?' '+state.pending.error:''));
  $('pending-clear').hidden=!state.pending.rejected;
}
async function dispatch(pending){
  try{await pendingStore('claim',pending);state.pending=pending;}
  catch(error){if(error.pending)state.pending=error.pending;renderPending();throw error;}
  renderPending();
  let result;
  try{result=await http(pending.path,pending.body);}
  catch(error){
    state.pending.error=error.message;
    state.pending.rejected=!pending.path.endsWith('/execute')&&!pending.path.endsWith('/buyer-execute')&&[400,404,409,422].includes(error.status);
    await pendingStore('claim',state.pending);renderPending();throw error;
  }
  {
    await pendingStore('clear',pending);state.pending=null;renderPending();
    if(pending.clearPreparation){state.prepared=await preparationStoreClear(pending.clearPreparation);renderPrepared();}
    await refresh();message(pending.label+' completed'+(result.replayed?' from its retained original result.':'.'));
    if(pending.path.endsWith('/buyer-execute')){
      const material=result.material,record=material?.result?.response?.result;
      if(material?.action==='period_review'&&record?.id)$('period-review-id').value=record.id;
      if(material?.action==='period_close'&&record?.id){$('delivery-close-id').value=record.id;$('return-close-id').value=record.id;}
      if(material?.action==='accountant_return_save')state.accountantReturn=null;
    }
    return result;
  }
}
async function effect(action,body,label,{clearPreparation=false}={}){
  await ensureNoPending();
  return dispatch({path:route(action),body:copy(body),label,createdAt:new Date().toISOString(),clearPreparation});
}
async function findCases(append=false){
  const query=new URLSearchParams({q:value('case-search'),limit:'50',offset:String(append?state.caseOffset??0:0)});
  const result=await http('/api/cases?'+query),rows=result.cases??result.items??[];
  state.cases=append?[...state.cases,...rows]:rows;
  state.caseOffset=result.nextOffset??(result.offset+rows.length<result.total?result.offset+rows.length:null);
  options('case-picker',state.cases,row=>row.id,row=>row.name??row.metadata?.merchant??row.id);
  $('more-cases').hidden=state.caseOffset===null;
}
async function openCase(){
  const selected=required('case-picker');
  state.caseId=selected;state.buyer=null;state.labelBasis=null;state.centerBasis=null;state.periodBasis=null;state.accountantReturn=null;
  $('return-review').replaceChildren();$('return-supersedes').replaceChildren();$('asset-labels').replaceChildren();
  state.prepared=await storage('get',key('prepared'))??null;state.pending=await storage('get',key('pending'))??null;
  const url=new URL(location.href);url.searchParams.set('case',selected);history.replaceState(null,'',url);
  await refresh();renderPrepared();renderPending();message('Opened the original saved case.');
}
async function refresh(){
  if(!state.caseId)return;
  const view=await http(route(''));
  const buyerView=await http(route('buyer')+'?'+new URLSearchParams({revision:view.case.revision}));
  state.view=view;state.buyerView=buyerView;
  document.body.dataset.caseReady='true';document.body.dataset.caseId=state.caseId;
  text('case-id',state.caseId);text('case-revision',view.case.revision);text('case-summary',view.case.name+' · '+view.reports.length+' retained service reports');
  options('adjustment-report',view.reports,row=>row.id,row=>row.title+' · '+row.customer+' · '+(row.period?.from??row.period?.fromAt??row.createdAt));
  if(!$('adjustment-report').value&&view.reports.length)$('adjustment-report').value=view.reports.at(-1).id;
  options('proposal-picker',view.proposals,row=>row.id,row=>row.report.customer+' · '+row.native.kind+' '+row.native.amountAtomic+' · '+row.createdAt);
  if(!$('proposal-picker').value&&view.proposals.length)$('proposal-picker').value=view.proposals.at(-1).id;
  options('intent-picker',view.intents,row=>row.id,row=>row.action+' · '+row.actor+' · '+row.createdAt);
  if(!$('intent-picker').value&&view.intents.length)$('intent-picker').value=view.intents.at(-1).id;
  const captures=view.outcomes.filter(row=>row.action==='capture');
  options('buyer-capture',captures,row=>row.id,row=>'Captured adjustment · '+row.createdAt);
  if(!$('buyer-capture').value&&captures.length)$('buyer-capture').value=captures.at(-1).id;
  options('buyer-intent-picker',buyerView.intents??[],row=>row.id,row=>row.action+' · '+row.buyer.alias+' · '+row.createdAt);
  if(!$('buyer-intent-picker').value&&buyerView.intents?.length)$('buyer-intent-picker').value=buyerView.intents.at(-1).id;
  options('accountant-delivery',(buyerView.outcomes??[]).filter(row=>row.action==='delivery'),row=>row.id,row=>'Buyer delivery · '+row.createdAt);
  table('native-history',['Observed','Operation','Adjustment','Verification','Reference'],view.outcomes.map(row=>[row.createdAt,row.action,row.native.status,row.native.jobStatus??'',row.native.transaction??row.native.adjustmentId]));
  table('buyer-history',['Observed','Operation','Buyer workspace','Result'],(buyerView.outcomes??[]).map(row=>[row.createdAt,row.action,row.buyer.alias,row.recordId??row.id]));
  renderProposal();renderDownloads();await readReport();
}
async function sources(){
  const result=await http('/api/adjustments/sources'),accounting=result.accounting.workspaces??[],buyer=result.buyer.workspaces??[];
  options('accounting-workspace',accounting,row=>row.workspace??row.alias??row.id,row=>row.label??row.workspace??row.alias??row.id);
  options('accountant-workspace',accounting,row=>row.workspace??row.alias??row.id,row=>row.label??row.workspace??row.alias??row.id);
  options('buyer-workspace',buyer,row=>row.workspace??row.alias,row=>row.label??row.workspace??row.alias);
}
async function accounting(method,input={}){
  return http('/api/adjustments/accounting/'+method,{accountingId:required('accounting-workspace'),...input});
}
async function runs(append=false){
  const result=await accounting('runs',{offset:append?state.runOffset??0:0,limit:50}),page=result.page??result;
  const rows=page.items??page.runs??[];state.runs=append?[...state.runs,...rows]:rows;
  state.runOffset=page.offset+rows.length<page.total?page.offset+rows.length:null;
  options('adjustment-run',state.runs,row=>row.id,row=>(row.name??row.status??'Reconciliation')+' · '+(row.completedAt??row.createdAt??row.id));
  $('more-runs').hidden=state.runOffset===null;
  if(!$('adjustment-run').value&&state.runs.length)$('adjustment-run').value=state.runs.at(-1).id;
  if(value('adjustment-run'))await events();
}
async function events(append=false){
  const result=await accounting('events',{runId:required('adjustment-run'),offset:append?state.eventOffset??0:0,limit:50});
  const rows=result.items??[];state.events=append?[...state.events,...rows]:rows;
  state.eventOffset=result.offset+rows.length<result.total?result.offset+rows.length:null;
  options('adjustment-event',state.events,row=>row.eventId,row=>(row.transfer??row.classification??'Payment')+' · '+row.amountAtomic+' · '+row.network+' · '+row.eventId.slice(0,12));
  $('more-events').hidden=state.eventOffset===null;
  if(!$('adjustment-event').value&&state.events.length)$('adjustment-event').value=state.events[0].eventId;
  await payment();
}
async function payment(){
  if(!value('adjustment-event'))return;
  const selected=await accounting('event',{runId:required('adjustment-run'),eventId:required('adjustment-event')});
  state.payment=selected;const event=selected.event;
  text('payment-summary',(selected.refundTerms?.asset??selected.originalProof?.asset??event.assetDigest)+' · '+event.amountAtomic+' atomic units · '+event.network+' · '+event.transfer);
}
async function readReport(){
  const id=value('adjustment-report');if(!state.caseId||!id){$('incident-options').replaceChildren();return;}
  const result=await http(route('')+'?'+new URLSearchParams({section:'reports',recordId:id,revision:state.view.case.revision}));
  const report=result.records[0];state.report=report;
  const previous=new Set([...document.querySelectorAll('[name=incidentId]:checked')].map(input=>input.value));
  table('incident-options',['Include','Condition','Opened','Response / target','Recovery / target','Owner'],report.preview.incidents.map(row=>{
    const input=document.createElement('input');input.type='checkbox';input.name='incidentId';input.value=row.id;input.checked=previous.has(row.id);input.setAttribute('aria-label','Include '+row.kind+' '+row.openedAt);
    return [input,row.kind+' · '+row.status,row.openedAt,row.response.serviceMinutes+' / '+row.response.targetMinutes+' min',row.recovery.serviceMinutes+' / '+row.recovery.targetMinutes+' min',row.owner];
  }));
}
function renderProposal(){
  const p=state.view?.proposals.find(row=>row.id===value('proposal-picker'));if(!p){$('proposal-summary').replaceChildren();return;}
  detail('proposal-summary',[['Customer',p.report.customer],['Adjustment',p.native.kind+' · '+p.native.amountAtomic+' atomic units'],['Basis',p.basis.reference],['Original payment',p.native.eventId],['Reviewed by',p.actor]]);
}
function renderPrepared(){
  $('prepared-section').hidden=!state.prepared;
  if(!state.prepared)return;
  const {kind,material}=state.prepared;
  text('prepared-heading',kind==='proposal'?'Review service adjustment':kind==='buyer'?'Review buyer operation':'Review native action');
  text('save-prepared',kind==='proposal'?'Save reviewed proposal':'Save prepared action');
  if(kind==='proposal')detail('prepared-review',[['Customer',material.report.preview.terms.customer],['Service',material.report.preview.terms.title],['Selected incidents',material.incidentIds.length],['Adjustment',material.nativePreview.request.kind+' · '+material.nativePreview.request.amountAtomic+' atomic units'],['Monetary basis',material.basis.amountAtomic+' atomic units · '+material.basis.reference],['Basis description',material.basis.description],['Reason',material.nativePreview.request.reason],['Original payment',material.nativePreview.request.eventId],['Operator',material.actor]]);
  else if(kind==='buyer')detail('prepared-review',[['Operation',material.action],['Buyer',material.buyer.alias],['Operator',material.actor],['Reviewed input',material.input],['Saved capture',material.capture.id]]);
  else detail('prepared-review',[['Operation',material.action],['Operator',material.actor],['Saved proposal',material.proposalId],['Original request',material.request]]);
}
async function prepared(kind,result){
  await ensureNoPending();
  state.prepared={kind,material:result.proposal??result.intent,case:result.case,revision:result.revision};
  await storage('set',key('prepared'),state.prepared);renderPrepared();$('prepared-section').scrollIntoView({behavior:'smooth',block:'start'});message('The complete preparation is ready for review.');
}
async function previewProposal(){
  await ensureNoPending();
  if(!state.view||!state.report)throw new Error('Open a case and select its saved service report.');
  const incidentIds=[...document.querySelectorAll('[name=incidentId]:checked')].map(input=>input.value);
  const date=required('adjustment-effective'),effectiveAt=new Date(date+'Z').toISOString();
  const input={id:uuid(),reportId:state.report.id,reportSha256:state.report.sha256,incidentIds,
    basis:{amountAtomic:required('basis-amount'),reference:required('basis-reference'),description:required('basis-description')},
    accountingId:required('accounting-workspace'),actor:actor(),request:{runId:required('adjustment-run'),eventId:required('adjustment-event'),kind:value('adjustment-kind'),
      amountAtomic:required('adjustment-amount'),effectiveAt,reason:required('adjustment-reason'),reference:value('adjustment-reference')}};
  await prepared('proposal',await http(route('preview'),{expectedRevision:state.view.case.revision,input}));
}
async function prepareNative(action){
  await ensureNoPending();
  const proposal=selectedProposal();let input={};
  if(action==='verify'){
    const result=await http('/api/adjustments/accounting/status',{accountingId:proposal.accountingId});
    const revision=result.state?.revision??result.revision;
    input={revision,transaction:required('verification-transaction'),...(value('verification-rpc')?{rpcEndpoint:value('verification-rpc')}:{})};
  }
  await prepared('native',await http(route('intent'),{expectedRevision:state.view.case.revision,input:{id:uuid(),proposalId:proposal.id,action,actor:actor(),input}}));
}
async function savePrepared(){
  if(!state.prepared)throw new Error('Prepare the original operation first.');
  const p=state.prepared;
  await effect(p.kind==='buyer'?'buyer-material':'material',{expectedRevision:p.case.revision,expectedImplementationRevision:p.revision,requestId:uuid(),material:p.material},
    p.kind==='proposal'?'Save reviewed proposal':'Save prepared action',{clearPreparation:p.material.id});
}
async function executeNative(refresh=false){
  const intent=state.view?.intents.find(row=>row.id===value('intent-picker'));
  if(!intent)throw new Error('Select a saved native action.');
  if(refresh&&intent.action!=='verify')throw new Error('Select the original verification action to refresh.');
  await effect('execute',{intentId:intent.id,requestId:uuid()},refresh?'Refresh original verification':'Execute saved '+intent.action);
}
function fileButton(label,operation){const button=document.createElement('button');button.dataset.deliveryFile='true';button.type='button';button.className='file-button';button.textContent=label;button.addEventListener('click',()=>work(operation));return button;}
function renderDownloads(){
  $('native-downloads').replaceChildren();$('buyer-downloads').replaceChildren();
  const proposal=state.view?.proposals.find(row=>row.id===value('proposal-picker'));
  if(proposal){
    const base={revision:state.view.case.revision,proposalId:proposal.id,proposalSha256:proposal.sha256};
    for(const [kind,label] of [['handover','Complete handover JSON'],['customer-html','Customer summary'],['service-report','Service report'],['case','Original case'],['workspace','Complete workspace']])
      $('native-downloads').append(fileButton(label,()=>remoteFile(route('download'),{...base,kind})));
    for(const outcome of state.view.outcomes.filter(row=>row.action==='capture'&&row.proposalId===proposal.id)){
      for(const [kind,label] of [['native-json','Accounting JSON'],['native-csv','Accounting CSV'],['native-html','Accounting report'],['buyer-source','Buyer source']])
        $('native-downloads').append(fileButton(label+' · '+outcome.createdAt,()=>remoteFile(route('download'),{...base,kind,outcomeId:outcome.id})));
    }
  }
  for(const outcome of state.buyerView?.outcomes??[]){
    const files=[...(outcome.files??outcome.result?.files??[]),{name:'original-buyer-result.json'}];
    for(const file of files)$('buyer-downloads').append(fileButton(file.name,()=>remoteFile(route('buyer-download'),{revision:state.buyerView.case.revision,outcomeId:outcome.id,name:file.name})));
  }
}
async function inspectBuyer(extra={}){
  if(!state.view)throw new Error('Open the saved case first.');
  const input={captureOutcomeId:required('buyer-capture'),buyerWorkspace:required('buyer-workspace'),...extra};
  const result=await http(route('buyer-inspect'),{revision:state.view.case.revision,input});
  state.buyer=result;
  text('buyer-summary','Buyer '+result.buyer.alias+' · revision '+result.buyer.revision+' · '+result.buyer.dataContext);
  const list=value=>Array.isArray(value)?value:value?.items??value?.packets??value?.credits??[];
  options('buyer-packet',list(result.packets),row=>row.id,row=>(row.name??row.id)+' · '+(row.status??row.decision??'Received'));
  options('buyer-credit',list(result.credits),row=>row.id,row=>(row.amount??row.amount_atomic??row.id)+' · '+(row.status??'Credit'));
  options('buyer-period',list(result.periods),row=>row.id,row=>row.name??row.id);
  options('center-picker',list(result.centers),row=>row.id,row=>(row.code?row.code+' · ':'')+(row.name??row.id),{empty:'New cost center'});
  options('period-edit',list(result.periods),row=>row.id,row=>row.name??row.id,{empty:'New period'});
  if(result.packet)$('buyer-packet').value=result.packet.id;
  if(result.item)$('buyer-item-id').value=result.item.id;
  if(result.credit)$('buyer-credit').value=result.credit.id;
  if(result.buyer.dataContext&&[...$('buyer-data-context').options].some(row=>row.value===result.buyer.dataContext))$('buyer-data-context').value=result.buyer.dataContext;
  if(result.packet)text('buyer-packet-summary',(result.packet.name??result.packet.id)+' · '+(result.packet.status??result.packet.decision??'Original source'));
  if(result.credit||result.item){const record=result.credit??result.item;text('coding-basis','Current original basis loaded for '+record.id+'.');}
  if(result.report){
    detail('period-summary',[['Period',result.report.name??result.report.id??value('buyer-period')],['Ready to issue',result.report.ready?'Yes':'Resolve the displayed issues'],['Unresolved issues',(result.report.issues??[]).filter(row=>!row.resolved).length]]);
    options('period-issue',(result.report.issues??[]).filter(row=>!row.resolved),row=>[row.item_id??'',row.code,row.basis].join('|'),row=>row.description??row.code);
    if(!$('period-issue').value&&$('period-issue').options.length===2)$('period-issue').selectedIndex=1;
    renderIssue();
  }
  for(const select of document.querySelectorAll('.allocation-center'))options(select.id,list(result.centers),row=>row.id,row=>row.name??row.id);
  return result;
}
function selectedIssue(){
  return state.buyer?.report?.issues?.find(row=>[row.item_id??'',row.code,row.basis].join('|')===value('period-issue'));
}
function renderIssue(){
  const issue=selectedIssue();
  options('issue-kind',issue?.allowed_kinds??[],kind=>kind,kind=>kind.replaceAll('_',' '));
  text('issue-description',issue?.description??'Choose the current original period issue.');
}
function loadCenter(){
  const center=(state.buyer?.centers??[]).find(row=>row.id===value('center-picker'));
  state.centerBasis=center?{buyer:state.buyer.buyer.alias,original:copy(center)}:null;
  $('center-code').value=center?.code??'';$('center-name').value=center?.name??'';$('center-active').checked=center?.active??true;
}
function loadPeriod(){
  const period=(state.buyer?.periods??[]).find(row=>row.id===value('period-edit'));
  state.periodBasis=period?{buyer:state.buyer.buyer.alias,original:copy(period)}:null;
  $('period-name').value=period?.name??'';$('period-from').value=period?.from_day??'';$('period-through').value=period?.through_day??'';
}
function addLabel(label={}){
  const row=document.createElement('tr');
  for(const field of ['network','asset','symbol','decimals']){
    const td=document.createElement('td'),input=document.createElement('input');input.dataset.labelField=field;input.setAttribute('aria-label',field==='asset'?'Original asset':field);
    input.value=label[field]??'';if(field==='decimals'){input.type='number';input.min='0';input.max='30';input.step='1';}
    td.append(input);row.append(td);
  }
  const td=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>row.remove());td.append(remove);row.append(td);$('asset-labels').append(row);
}
async function readLabels(){
  const inspected=await inspectBuyer(),labels=inspected.labels;
  if(!Array.isArray(labels))throw new Error('The original buyer labels are unavailable.');
  state.labelBasis={buyer:inspected.buyer.alias,labels:copy(labels)};$('asset-labels').replaceChildren();for(const label of labels)addLabel(label);
  message('Loaded the complete original asset label set for review.');
}
async function readReturnFile(){
  const file=$('return-file').files?.[0];
  if(!file)throw new Error('Choose the complete original accountant return file.');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(file.name))throw new Error('Use the original accountant JSON filename.');
  if(file.size>48*1024*1024)throw new Error('The accountant return exceeds the original 48 MiB file limit.');
  const bytes=new Uint8Array(await file.arrayBuffer()),parts=[];
  for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  return {name:file.name,type:file.type||'application/json',bytes:bytes.length,sha256,base64:btoa(parts.join(''))};
}
async function previewReturn(){
  await ensureNoPending();if(!state.view)throw new Error('Open the original saved case.');
  const file=await readReturnFile(),input={captureOutcomeId:required('buyer-capture'),buyerWorkspace:required('buyer-workspace'),closeId:required('return-close-id'),file};
  const result=await http(route('buyer-accountant-preview'),{revision:state.view.case.revision,input});
  state.accountantReturn={caseId:state.caseId,input:copy(input),result};
  detail('return-review',[['File',file.name+' · '+file.bytes+' bytes'],['Buyer workspace',result.buyer.alias],['Original buyer revision',result.buyer.revision],['Issued close',result.closeId],['Related accepted handoffs',result.preview.other_handoffs?.length??0]]);
  $('return-supersedes').replaceChildren();
  const others=result.preview.other_handoffs??[];
  if(others.length){const p=document.createElement('p');p.textContent='Review each accepted handoff replaced by this return and record the replacement reason.';$('return-supersedes').append(p);}
  for(const other of others){const label=document.createElement('label'),checkbox=document.createElement('input');label.className='check';checkbox.type='checkbox';checkbox.name='returnSupersedes';checkbox.value=other.return_id;
    label.append(checkbox,document.createTextNode('Replace '+(other.name??other.handoff_id??other.return_id)+' · '+other.return_id));$('return-supersedes').append(label);}
  message('Reviewed the original accountant file against the issued buyer period.');
}
function clearReturnPreview(){state.accountantReturn=null;$('return-review').replaceChildren();$('return-supersedes').replaceChildren();}
function buyerFields(){
  const action=value('buyer-action');
  document.querySelectorAll('[data-buyer-fields]').forEach(node=>node.hidden=!node.dataset.buyerFields.split(' ').includes(action));
  document.querySelector('[data-credit-choice]').hidden=action!=='credit_coding_save';
  document.querySelector('[data-purchase-choice]').hidden=action!=='coding_save';
}
function addAllocation(){
  const row=document.createElement('tr'),suffix=uuid(),fields=[['select','center','allocation-center'],['input','amount','allocation-amount'],['input','project','allocation-project'],['input','account','allocation-account']];
  for(const [tag,key,className] of fields){
    const td=document.createElement('td'),node=document.createElement(tag);node.id='allocation-'+key+'-'+suffix;node.className=className;
    node.setAttribute('aria-label',{center:'Cost center',amount:'Atomic amount',project:'Project',account:'Account code'}[key]);
    if(key==='amount'){node.inputMode='numeric';node.pattern='[0-9]+';}
    if(key==='center'){node.append(new Option('Choose…',''));const centers=state.buyer?.centers??[];for(const center of Array.isArray(centers)?centers:centers.items??[])node.append(new Option(center.name??center.id,center.id));}
    td.append(node);row.append(td);
  }
  const td=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>row.remove());td.append(remove);row.append(td);$('allocations').append(row);
}
async function buyerInput(){
  const action=required('buyer-action'),operator=actor();
  if(action==='adjustment_capture')return {name:required('buyer-source-name'),provenance:required('buyer-provenance'),dataContext:value('buyer-data-context')};
  if(action==='refund_review'){
    const payload={decision:value('buyer-decision'),operator,reason:required('buyer-review-reason')};
    if(value('buyer-purchase-id'))payload.purchase_item_id=value('buyer-purchase-id');
    if($('buyer-register-purchase').checked){if(payload.purchase_item_id)throw new Error('Select an existing purchase or register its original verified source.');payload.register_original_purchase=true;}
    return {id:required('buyer-packet'),payload};
  }
  if(action==='coding_save'||action==='credit_coding_save'){
    const selectedId=required(action==='credit_coding_save'?'buyer-credit':'buyer-item-id');
    const inspected=await inspectBuyer({packetId:required('buyer-packet'),[action==='credit_coding_save'?'creditId':'itemId']:selectedId});
    const record=action==='credit_coding_save'?inspected.credit:inspected.item;
    if(!record?.basis)throw new Error('Read the current original coding basis.');
    const allocations=[...document.querySelectorAll('#allocations tr')].map(row=>{
      const center_id=row.querySelector('.allocation-center').value,amount=row.querySelector('.allocation-amount').value.trim(),
        project=row.querySelector('.allocation-project').value.trim(),account_code=row.querySelector('.allocation-account').value.trim();
      if(!center_id||!/^[0-9]+$/.test(amount))throw new Error('Give every allocation its original cost center and exact atomic amount.');
      return {center_id,amount,...(project?{project}:{}),...(account_code?{account_code}:{})};
    });
    if(!allocations.length)throw new Error('Add the bookkeeping allocations.');
    return {id:selectedId,packetId:required('buyer-packet'),payload:{basis:record.basis,recognition_date:required('coding-date'),operator,memo:value('coding-memo'),allocations}};
  }
  if(action==='center_save'){
    const centerId=value('center-picker'),payload={code:required('center-code'),name:required('center-name'),active:$('center-active').checked,...(centerId?{id:centerId}:{})};
    if(centerId){const inspected=await inspectBuyer(),current=inspected.centers.find(row=>row.id===centerId);
      if(state.centerBasis?.buyer!==inspected.buyer.alias||JSON.stringify(current)!==JSON.stringify(state.centerBasis.original))throw new Error('Read the current original cost center and review its changes again.');}
    return {payload};
  }
  if(action==='labels_save'){
    const inspected=await inspectBuyer();
    if(!state.labelBasis||state.labelBasis.buyer!==inspected.buyer.alias||JSON.stringify(state.labelBasis.labels)!==JSON.stringify(inspected.labels))throw new Error('Read the current original labels before reviewing the complete edited set.');
    const assets=[...document.querySelectorAll('#asset-labels tr')].map(row=>{
      const label=Object.fromEntries([...row.querySelectorAll('[data-label-field]')].map(node=>[node.dataset.labelField,node.value.trim()]));
      if(!label.network||!label.asset||!label.symbol||!/^([0-9]|[12][0-9]|30)$/.test(label.decimals))throw new Error('Give every asset its original network, asset, symbol and scale from 0 to 30.');
      return {...label,decimals:Number(label.decimals)};
    });
    return {payload:{assets}};
  }
  if(action==='period_save'){
    const periodId=value('period-edit'),payload={name:required('period-name'),from_day:required('period-from'),through_day:required('period-through'),...(periodId?{id:periodId}:{})};
    if(periodId){const inspected=await inspectBuyer(),current=inspected.periods.find(row=>row.id===periodId);
      if(state.periodBasis?.buyer!==inspected.buyer.alias||JSON.stringify(current)!==JSON.stringify(state.periodBasis.original))throw new Error('Read the current original period and review its changes again.');}
    return {payload};
  }
  if(action==='disposition'){
    const selected=selectedIssue(),kind=required('issue-kind');
    if(!selected||!selected.allowed_kinds?.includes(kind))throw new Error('Choose a resolution permitted by the current original issue.');
    return {periodId:required('buyer-period'),payload:{item_id:selected.item_id??'',code:selected.code,basis:selected.basis,kind,reason:required('issue-reason'),operator}};
  }
  if(action==='period_reopen')return {id:required('buyer-period'),operator,reason:required('period-reopen-reason')};
  if(action==='period_review')return {id:required('buyer-period'),reviewer:operator,role:required('period-role'),notes:value('period-notes')};
  if(action==='period_close')return {id:required('buyer-period'),reviewId:required('period-review-id')};
  if(action==='delivery')return {closeId:required('delivery-close-id')};
  if(action==='accountant_create')return {deliveryOutcomeId:required('accountant-delivery'),accountingWorkspace:required('accountant-workspace'),name:required('accountant-name')};
  if(action==='accountant_return_save'){
    const reviewed=state.accountantReturn,file=await readReturnFile();
    if(!reviewed||reviewed.caseId!==state.caseId||reviewed.input.captureOutcomeId!==required('buyer-capture')||reviewed.input.buyerWorkspace!==required('buyer-workspace')||reviewed.input.closeId!==required('return-close-id')||JSON.stringify(reviewed.input.file)!==JSON.stringify(file))throw new Error('Review this exact accountant return for the selected original buyer period.');
    const supersedes=[...document.querySelectorAll('[name=returnSupersedes]:checked')].map(node=>node.value),others=reviewed.result.preview.other_handoffs??[];
    if(others.length!==supersedes.length||!others.every(row=>supersedes.includes(row.return_id)))throw new Error('Review and select every original accepted handoff replaced by this return.');
    if(supersedes.length&&!value('return-reason'))throw new Error('Record the reason for replacing the selected accepted handoffs.');
    return {closeId:reviewed.input.closeId,file,previewSha256:reviewed.result.preview.preview_sha256,operator,name:required('return-name'),reason:value('return-reason'),supersedes};
  }
  throw new Error('Choose a supported buyer operation.');
}
async function prepareBuyer(){
  await ensureNoPending();
  if(!state.view)throw new Error('Open the saved case.');
  const input=await buyerInput();
  await prepared('buyer',await http(route('buyer-intent'),{expectedRevision:state.view.case.revision,input:{id:uuid(),captureOutcomeId:required('buyer-capture'),buyerWorkspace:required('buyer-workspace'),action:required('buyer-action'),actor:actor(),input}}));
}
function click(id,fn){$(id).addEventListener('click',()=>work(fn));}
function change(id,fn){$(id).addEventListener('change',()=>work(fn));}
click('find-cases',()=>findCases());click('more-cases',()=>findCases(true));click('open-case',openCase);click('refresh-case',async()=>{await refresh();message('Refreshed the original case.');});
click('open-accounting',async()=>{await accounting('open');await runs();message('Opened the original accounting workspace.');});
click('refresh-accounting',()=>runs());click('more-runs',()=>runs(true));click('more-events',()=>events(true));
change('adjustment-run',()=>events());change('adjustment-event',payment);change('adjustment-report',readReport);
change('proposal-picker',async()=>{renderProposal();renderDownloads();});
$('proposal-form').addEventListener('submit',event=>{event.preventDefault();void work(previewProposal);});
click('save-prepared',savePrepared);click('prepared-download',async()=>{if(state.prepared)saveJson('prepared-service-request.json',state.prepared);});
click('prepared-discard',async()=>{await ensureNoPending();if(state.prepared)state.prepared=await preparationStoreClear(state.prepared.material.id);renderPrepared();});
click('prepare-record',()=>prepareNative('record'));click('prepare-verification',()=>prepareNative('verify'));click('prepare-capture',()=>prepareNative('capture'));
click('execute-intent',()=>executeNative());click('refresh-verification',()=>executeNative(true));
click('pending-retry',async()=>{if(state.pending)await dispatch(state.pending);});
click('pending-download',async()=>{if(state.pending)saveJson('retained-service-request.json',state.pending);});
click('pending-clear',async()=>{if(state.pending?.rejected){await pendingStore('clear',state.pending);state.pending=null;renderPending();message('Cleared the rejected request. Review the current case before preparing again.');}});
click('open-buyer',async()=>{const result=await http('/api/adjustments/buyer/open',{buyerWorkspace:required('buyer-workspace')});state.buyerInstance=result.instanceId;await inspectBuyer();message('Opened and inspected the original buyer workspace.');});
click('inspect-buyer',()=>inspectBuyer());change('buyer-packet',()=>inspectBuyer({packetId:required('buyer-packet')}));
change('buyer-period',()=>inspectBuyer({periodId:required('buyer-period')}));
click('read-coding-basis',()=>inspectBuyer({packetId:required('buyer-packet'),[value('buyer-action')==='credit_coding_save'?'creditId':'itemId']:required(value('buyer-action')==='credit_coding_save'?'buyer-credit':'buyer-item-id')}));
click('add-allocation',async()=>addAllocation());$('buyer-action').addEventListener('change',buyerFields);
change('center-picker',async()=>loadCenter());change('period-edit',async()=>loadPeriod());change('period-issue',async()=>renderIssue());
click('read-labels',readLabels);click('add-label',async()=>addLabel());click('preview-return',previewReturn);
$('return-file').addEventListener('change',clearReturnPreview);$('return-close-id').addEventListener('input',clearReturnPreview);
$('buyer-workspace').addEventListener('change',()=>{state.buyer=null;state.labelBasis=null;state.centerBasis=null;state.periodBasis=null;clearReturnPreview();});
$('buyer-capture').addEventListener('change',clearReturnPreview);
$('buyer-form').addEventListener('submit',event=>{event.preventDefault();void work(prepareBuyer);});
click('execute-buyer-intent',()=>effect('buyer-execute',{intentId:required('buyer-intent-picker'),requestId:uuid()},'Execute saved buyer action'));
click('open-accountant',async()=>{await http('/api/adjustments/accounting/open',{accountingId:required('accountant-workspace')});message('Opened the original accountant workspace.');});
$('adjustment-effective').value=new Date().toISOString().slice(0,19);$('coding-date').value=new Date().toISOString().slice(0,10);
buyerFields();addAllocation();
await work(async()=>{await idb;await Promise.all([findCases(),sources()]);const selected=new URL(location.href).searchParams.get('case');if(selected){if(![...$('case-picker').options].some(option=>option.value===selected))$('case-picker').append(new Option('Original case '+selected,selected));$('case-picker').value=selected;await openCase();}else message('Choose a saved service case.');});
