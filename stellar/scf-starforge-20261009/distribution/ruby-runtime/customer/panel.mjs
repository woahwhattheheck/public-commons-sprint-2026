// MIT. Customer source review and same-operation commissioning over the original runtime desk.
const $=id=>document.getElementById(id);
const all=(selector,within=document)=>[...within.querySelectorAll(selector)];
const full=value=>JSON.stringify(value,null,2);
const HASH=/^[a-f0-9]{64}$/;
const PENDING='starforge-ruby-customer-actions-v1';
const FOLLOW='starforge-ruby-customer-follow-v1';
const SELECTED='starforge-ruby-customer-selected-v1';
const ACTIVE=new Set(['COMMISSIONING','REGISTERING']);
const RETRY=new Set(['CUSTOMER_NEEDS_RESUME','REGISTRATION_NEEDS_RESUME']);
const state={directory:null,connected:false,closed:false,busy:false,refreshing:null,timer:null,
  offset:0,page:null,selectedId:null,detail:null,pending:[],pendingId:null,following:[],
  listGeneration:0,detailGeneration:0,sourceGeneration:0,existingGeneration:0,
  source:null,sourceTuple:null,existing:null,existingDirectory:null};
const notice=(message,kind='status')=>{ $('customer-notice').textContent=message;$('customer-notice').dataset.kind=kind; };
const errorText=issue=>[issue.code,issue.message||String(issue)].filter(Boolean).join(': ');
function element(tag,text,className) {
  const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);
  if(className)value.className=className;return value;
}
function on(id,event,action) {
  $(id).addEventListener(event,event=>{
    if(event.type==='submit')event.preventDefault();
    Promise.resolve().then(()=>action(event)).catch(issue=>notice(errorText(issue),'error'));
  });
}
function button(label,action) {
  const value=element('button',label);value.type='button';
  value.addEventListener('click',()=>Promise.resolve().then(action).catch(issue=>notice(errorText(issue),'error')));return value;
}
function facts(target,values) {
  target.replaceChildren();
  for(const [key,value]of values)target.append(element('dt',key),element('dd',
    value===null||value===undefined||value===''?'—':typeof value==='object'?full(value):value));
}
function cell(row,value,secondary) {
  const td=element('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';
  if(secondary)td.append(element('span',secondary,'secondary'));row.append(td);return td;
}
function storage(key,value) {
  if(value===undefined){const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw):null;}
  sessionStorage.setItem(key,JSON.stringify(value));
}
function rememberPending(record,removeId) {
  const id=removeId??record?.id;
  const next=state.pending.filter(value=>value.id!==id);
  if(record)next.push(record);
  storage(PENDING,next);state.pending=next;
  state.pendingId=record?.id??state.pendingId;
  if(!state.pending.some(value=>value.id===state.pendingId))state.pendingId=state.pending.at(-1)?.id??null;
  renderPending();
}
function setFollow(detail,value) {
  const next=state.following.filter(item=>!(item.directory===state.directory&&item.id===detail.id));
  if(value)next.push({directory:state.directory,id:detail.id,selectionSha256:detail.selectionSha256});
  storage(FOLLOW,next);state.following=next;
}
function isFollowing(detail=state.detail) {
  return !!detail&&state.following.some(item=>item.directory===state.directory&&item.id===detail.id&&item.selectionSha256===detail.selectionSha256);
}
function selectedPhase(detail) {
  return ['REGISTERING','REGISTRATION_NEEDS_RESUME','FINALIZING','READY'].includes(detail?.phase)?'registration':'customer';
}
function requireConnected() {
  if(!state.connected||!state.directory)throw new Error('Connect to the original private runtime first.');
}
async function api(path,body) {
  requireConnected();
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  let value;try{value=await response.json();}
  catch{throw Object.assign(new Error('The original response was interrupted. Continue its saved action.'),{code:'RUBY_CUSTOMER_RESPONSE_INTERRUPTED'});}
  if(!response.ok)throw Object.assign(new Error(value.message||'Read the original customer and runtime operation.'),{code:value.code,status:response.status});
  return value;
}
function sourceTuple() {
  const form=$('customer-select-form');
  return JSON.stringify([form.elements.kind.value,form.elements.sourceDirectory.value,form.elements.expectedSourceSha256.value]);
}
function invalidateSource() {
  state.sourceGeneration++;state.source=null;state.sourceTuple=null;
  $('customer-source-review').hidden=true;$('customer-source-state').textContent='Inspect the selected original source.';
  $('customer-key-fields').replaceChildren();renderEnabled();
}
function invalidateExisting() {
  state.existingGeneration++;state.existing=null;state.existingDirectory=null;
  $('customer-existing-review').hidden=true;$('customer-existing-state').textContent='Inspect the original saved customer input.';
  renderEnabled();
}
function kindChanged() {
  const baserow=$('customer-select-form').elements.kind.value==='baserow';
  $('customer-native-options').hidden=baserow;$('customer-baserow-options').hidden=!baserow;
  const form=$('customer-select-form');
  for(const name of ['customerKey','sourceRef'])form.elements[name].required=baserow;
  form.elements.sourceKey.required=!baserow;
  invalidateSource();
}
async function inspectSource() {
  requireConnected();
  const form=$('customer-select-form'),tuple=sourceTuple(),generation=++state.sourceGeneration,directory=state.directory;
  const input={kind:form.elements.kind.value,directory:form.elements.sourceDirectory.value,
    ...(form.elements.expectedSourceSha256.value?{expectedSha256:form.elements.expectedSourceSha256.value}:{})};
  $('customer-source-state').textContent='Reading the original manifest and semantics…';
  const value=await api('/api/customer/source',input);
  if(generation!==state.sourceGeneration||tuple!==sourceTuple()||directory!==state.directory)return;
  if(value?.schema!=='stellar-forge.ruby-customer-source.v1'||value.kind!==input.kind||value.directory!==input.directory||!HASH.test(value.manifest?.sha256))
    throw new Error('The original source review did not return its selected manifest identity.');
  form.elements.expectedSourceSha256.value=value.manifest.sha256;
  state.source=value;state.sourceTuple=sourceTuple();
  facts($('customer-source-facts'),[['Kind',value.kind],['Original file',value.manifest.name],['SHA-256',value.manifest.sha256],
    ['Bytes',value.manifest.bytes],['Rows',value.summary?.rows],['Fields',value.summary?.fields],
    ['Snapshot',value.summary?.snapshot],['Original provider',value.summary?.provider??value.summary?.publisherDirectory]]);
  $('customer-source-json').textContent=full(value);
  $('customer-source-review').hidden=false;$('customer-source-state').textContent='Original selection retained for this form.';
  const fields=$('customer-key-fields');fields.replaceChildren();
  for(const name of value.summary?.fields??[]) {
    const label=element('label',undefined,'check'),input=document.createElement('input');
    input.type='checkbox';input.name='keys';input.value=name;input.checked=(value.summary?.suggestedKeys??[]).includes(name);
    label.append(input,document.createTextNode(name));fields.append(label);
  }
  if(!fields.childElementCount&&value.kind==='native')fields.append(element('p','This manifest did not expose projected key fields.'));
  renderEnabled();
}
async function inspectExisting() {
  requireConnected();
  const root=$('customer-adopt-form').elements.outputDirectory.value,generation=++state.existingGeneration,directory=state.directory;
  $('customer-existing-state').textContent='Reading the original saved input and complete result…';
  const value=await api('/api/customer/existing',{directory:root});
  if(generation!==state.existingGeneration||directory!==state.directory||root!==$('customer-adopt-form').elements.outputDirectory.value)return;
  if(value?.schema!=='stellar-forge.ruby-customer-existing.v1'||value.directory!==root||!HASH.test(value.input?.sha256)||!value.selected)
    throw new Error('The original customer did not return its retained input identity.');
  state.existing=value;state.existingDirectory=root;
  facts($('customer-existing-facts'),[['Kind',value.selected.kind],['Original input SHA-256',value.input.sha256],
    ['Original source',value.selected.sourceDirectory],['Customer output',root],['Original dataset ID',value.selected.datasetId],
    ['Rows',value.result?.rows],['Complete application',value.result?.application?.directory]]);
  $('customer-existing-json').textContent=full(value);$('customer-existing-review').hidden=false;
  $('customer-existing-state').textContent=value.result?'Complete original customer result found.':'Original customer inputs found; continue the same operation.';
  renderEnabled();
}
function inputValues(form) {
  const result={};
  for(const [key,value]of new FormData(form))if(typeof value==='string'&&value!==''&&key!=='keys')result[key]=value;
  return result;
}
function selectBody() {
  const form=$('customer-select-form');
  if(!state.source||state.sourceTuple!==sourceTuple())throw new Error('Inspect this exact original source before saving the customer selection.');
  const body=inputValues(form);
  if(body.kind==='native') {
    body.keys=all('input[name=keys]:checked',form).map(input=>input.value);
    for(const key of ['customerKey','sourceRef','query'])delete body[key];
    if(!body.keys.length&&!(state.source.summary?.suggestedKeys?.length))throw new Error('Choose the original stable key field or fields.');
  } else {delete body.sourceKey;body.query=form.elements.query.value;}
  body.requestId=crypto.randomUUID();return body;
}
function adoptBody() {
  const form=$('customer-adopt-form');
  if(!state.existing||state.existingDirectory!==form.elements.outputDirectory.value)
    throw new Error('Inspect this original saved customer before retaining it.');
  return {...inputValues(form),expectedInputSha256:state.existing.input.sha256,requestId:crypto.randomUUID()};
}
function validReply(request,value) {
  return value?.schema==='stellar-forge.ruby-customer.v1'&&value.id===request.body.id&&HASH.test(value.selectionSha256)&&
    (!request.body.requestId||value.requestId===request.body.requestId)&&
    (!request.body.expectedSelectionSha256||value.selectionSha256===request.body.expectedSelectionSha256);
}
async function command(path,body,label,original=null,{reveal=true}={}) {
  requireConnected();
  if(state.busy)throw new Error('The current saved customer action is still returning.');
  const request=original??{id:crypto.randomUUID(),directory:state.directory,path,body:structuredClone(body),label,
    createdAt:new Date().toISOString(),status:'SAVED'};
  if(request.directory!==state.directory)throw new Error('Open this action in its original runtime: '+request.directory);
  const directory=state.directory,selectedId=state.selectedId;
  state.busy=true;
  try {
    rememberPending({...request,status:'SENDING'});renderEnabled();
    const value=await api(request.path,request.body);
    if(directory!==state.directory||!validReply(request,value))throw Object.assign(new Error('Read and continue the retained action using its original customer identity.'),{code:'RUBY_CUSTOMER_REPLY_BINDING'});
    rememberPending(null,request.id);
    if((reveal&&state.selectedId===selectedId)||state.selectedId===value.id) {
      state.selectedId=value.id;state.detail=value;state.detailGeneration++;
      storage(SELECTED,{directory,id:value.id});renderDetail();
    }
    await readList();
    notice(request.label+' returned. The original customer and operation identities are retained.');
    return value;
  } catch(issue) {
    rememberPending({...request,status:'RECEIVING',error:errorText(issue)});
    throw issue;
  } finally {state.busy=false;renderEnabled();renderPending();}
}
function renderPending() {
  const choices=state.pending.filter(value=>value.directory===state.directory);
  const current=choices.find(value=>value.id===state.pendingId)??choices.at(-1);
  state.pendingId=current?.id??null;
  const selector=$('customer-pending-choice');selector.replaceChildren();
  for(const item of choices)selector.add(new Option(item.label+' · '+item.body.id,item.id));
  selector.value=current?.id??'';$('customer-pending-panel').hidden=!current;
  if(!current)return;
  $('customer-pending-description').textContent=current.label+' · '+current.status+(current.error?' · '+current.error:'');
  $('customer-pending-record').textContent=full(current);
  for(const id of ['customer-pending-read','customer-pending-retry','customer-pending-dismiss'])$(id).disabled=state.busy||!state.connected;
}
function renderList() {
  const page=state.page,body=$('customer-rows');body.replaceChildren();
  for(const value of page?.customers??[]) {
    const row=element('tr');row.dataset.selected=String(value.id===state.selectedId);
    cell(row,value.title||value.id,value.id);cell(row,value.selected?.kind??value.source?.kind??value.request?.selected?.kind);
    cell(row,value.phase);cell(row,value.environment?.id??value.request?.environmentId);
    cell(row,value.applicationId);cell(row,button('Review',()=>selectCustomer(value.id)));body.append(row);
  }
  if(!body.childElementCount) {
    const row=element('tr'),td=element('td','No customer selections on this page. Select an original source or open an existing customer.','empty');
    td.colSpan=6;row.append(td);body.append(row);
  }
  $('customer-page').textContent=page?'Customers '+(page.customers.length?page.offset+1:0)+'–'+(page.offset+page.customers.length)+' of '+page.total:'';
  $('customer-previous').disabled=!state.connected||state.busy||!page||page.offset===0;
  $('customer-next').disabled=!state.connected||state.busy||!page||page.nextOffset===null;
}
function customerFile(id,name,label) {
  const link=element('a',label??name,'button');
  link.href='/api/customer/file?'+new URLSearchParams({id,name});link.download='';return link;
}
const NOTES={
  SELECTING:'Complete the saved source-selection action shown above.',
  SELECTED:'The source and original operation are saved. Commission this customer to begin or recover its first dispatch.',
  COMMISSIONING:'The original native customer operation is active. Its full output remains in Operations.',
  CUSTOMER_COMPLETE:'The complete customer application is ready for its original managed registration.',
  CUSTOMER_NEEDS_RESUME:'Read the actual customer operation and resume that same phase after correcting its reported failure.',
  REGISTERING:'The original managed runtime is receiving the complete customer application.',
  REGISTRATION_NEEDS_RESUME:'Read the actual application registration and resume the same original phase.',
  FINALIZING:'The original application registration is complete. Retain its joined customer receipt to finish receiving.',
  READY:'The complete customer application is registered. Open Applications to launch, verify or export it.'
};
function renderDetail() {
  const value=state.detail;$('customer-detail').hidden=!value;if(!value){renderEnabled();return;}
  $('customer-title').textContent=value.title||value.id;$('customer-phase-note').textContent=NOTES[value.phase]??value.phase;
  facts($('customer-facts'),[['Customer',value.id],['Phase',value.phase],['Selection SHA-256',value.selectionSha256],
    ['Original source',value.selected?.sourceDirectory],['Original source SHA-256',value.selected?.expectedSourceSha256],
    ['Original customer output',value.selected?.outputDirectory],['Environment',value.environment?.id],
    ['Original customer operation',value.customerOperationId],['Original registration',value.registrationId],
    ['Received application',value.applicationId],['Rows',value.result?.rows??value.source?.summary?.rows]]);
  $('customer-argv').textContent=full({entry:value.entry,argv:value.argv});
  $('customer-record').textContent=full(value);
  const files=$('customer-files');files.replaceChildren();
  if(value.selectionSha256)files.append(customerFile(value.id,'selection.json','Complete customer selection'));
  for(const file of value.files??[])files.append(customerFile(value.id,file.name,file.name+' · '+file.bytes+' bytes'));
  if(value.result)files.append(customerFile(value.id,'result.json','Complete original customer result'));
  $('customer-follow-note').textContent=isFollowing(value)?'This desk continues the saved customer and its registration. Closing the desk preserves the original worker and saved continuation.':'';
  renderEnabled();
}
function renderEnabled() {
  const live=state.connected&&!state.busy,value=state.detail,phase=value?.phase;
  $('customer-source-read').disabled=!live;$('customer-existing-read').disabled=!live;
  $('customer-select-save').disabled=!live||!state.source;$('customer-adopt-save').disabled=!live||!state.existing;
  $('customer-source-download').disabled=!state.source;
  $('customer-refresh').disabled=!live;$('customer-detail-read').disabled=!live||!value;
  $('customer-advance').disabled=!live||!value?.selectionSha256||RETRY.has(phase)||phase==='SELECTING'||phase==='READY'&&!!value.result;
  $('customer-advance').textContent=ACTIVE.has(phase)?'Continue this original operation':'Commission and receive application';
  $('customer-resume').disabled=!live||!RETRY.has(phase);
  const operation=selectedPhase(value)==='registration'?value?.registrationOperation:value?.customerOperation;
  $('customer-cancel').disabled=!live||!operation||!operation.active&&!['QUEUED','RUNNING'].includes(operation.phase);
  $('customer-follow-stop').hidden=!isFollowing(value);$('customer-follow-stop').disabled=!live;
  $('customer-show-worker').disabled=!value?.customerOperation;
  $('customer-show-registration').disabled=!value?.registrationOperation;
  $('customer-show-application').disabled=!value?.application;
}
async function readList() {
  if(!state.connected)return;
  const directory=state.directory,offset=state.offset,generation=++state.listGeneration;
  const value=await api('/api/customers?'+new URLSearchParams({offset:String(offset),limit:'25'}));
  if(directory!==state.directory||offset!==state.offset||generation!==state.listGeneration)return;
  if(value?.schema!=='stellar-forge.ruby-customers.v1'||value.offset!==offset||!Array.isArray(value.customers))throw new Error('The customer page did not retain the selected offset.');
  state.page=value;renderList();return value;
}
async function readDetail() {
  if(!state.selectedId||!state.connected)return;
  const id=state.selectedId,directory=state.directory,generation=++state.detailGeneration;
  const value=await api('/api/customer?'+new URLSearchParams({id}));
  if(generation!==state.detailGeneration||directory!==state.directory||id!==state.selectedId)return;
  if(value?.schema!=='stellar-forge.ruby-customer.v1'||value.id!==id)throw new Error('The original customer identity changed.');
  state.detail=value;renderDetail();return value;
}
async function selectCustomer(id) {
  state.selectedId=id;state.detail=null;state.detailGeneration++;
  storage(SELECTED,{directory:state.directory,id});renderDetail();renderList();await readDetail();
  $('customer-detail').scrollIntoView({block:'start',behavior:'auto'});
}
async function continueFollow() {
  if(state.busy)return;
  const pendingIds=new Set(state.pending.filter(item=>item.directory===state.directory).map(item=>item.body.id));
  for(const item of [...state.following]) {
    if(item.directory!==state.directory||pendingIds.has(item.id)||!state.connected)continue;
    const value=state.detail?.id===item.id?state.detail:
      state.page?.customers.find(value=>value.id===item.id)??await api('/api/customer?'+new URLSearchParams({id:item.id}));
    if(value.id!==item.id||value.selectionSha256!==item.selectionSha256) {
      setFollow(item,false);notice('The saved continuation no longer matches customer '+item.id+'. Read its original selection.','error');continue;
    }
    if(RETRY.has(value.phase)||value.phase==='READY'&&value.result){setFollow(value,false);continue;}
    if(['SELECTED','CUSTOMER_COMPLETE','FINALIZING','READY'].includes(value.phase)) {
      try {
        const returned=await command('/api/customer/advance',{id:item.id,expectedSelectionSha256:item.selectionSha256},'Continue original customer and registration',null,{reveal:false});
        if(returned.phase==='READY'&&returned.result)setFollow(returned,false);
      } catch(issue) {setFollow(item,false);notice(errorText(issue),'error');}
      return;
    }
  }
}
async function refresh() {
  if(!state.connected||state.closed||state.busy)return;
  if(state.refreshing)return state.refreshing;
  state.refreshing=(async()=>{
    await readList();
    if(state.selectedId)await readDetail();
    await continueFollow();
  })();
  try{return await state.refreshing;}finally{state.refreshing=null;}
}
function poll() {
  clearTimeout(state.timer);if(state.closed)return;
  state.timer=setTimeout(async()=>{
    try{syncSession();if(state.connected)await refresh();}
    catch(issue){if(issue.status!==403)notice(errorText(issue),'error');}
    finally{poll();}
  },state.following.some(value=>value.directory===state.directory)||ACTIVE.has(state.detail?.phase)?2500:10000);
}
function syncSession() {
  const connected=$('connection-state').textContent==='Connected'&&$('session-panel').hidden;
  const directory=$('workspace-directory').textContent;
  const ready=connected&&directory.startsWith('/');
  if(ready&&state.directory!==directory) {
    state.directory=directory;state.page=null;state.offset=0;state.detail=null;
    const last=storage(SELECTED);state.selectedId=last?.directory===directory?last.id:null;
    state.detailGeneration++;state.listGeneration++;invalidateSource();invalidateExisting();
    renderList();renderDetail();renderPending();
  }
  const changed=state.connected!==ready;state.connected=ready;
  if(changed){renderEnabled();renderPending();if(ready)refresh().catch(issue=>notice(errorText(issue),'error'));}
}
function nativeTab(name,id) {
  const tab=document.querySelector('[data-tab="'+name+'"]');tab?.click();
  const field=name==='applications'?$('app-filter'):$('operation-filter');
  field.value=id;field.dispatchEvent(new Event('input',{bubbles:true}));
  if(name==='operations'){$('operation-phase').value='';$('operation-phase').dispatchEvent(new Event('change',{bubbles:true}));}
  const rows=$(name==='applications'?'application-rows':'operation-rows');
  const row=[...rows.rows].find(row=>all('.secondary',row).some(value=>value.textContent===id));
  row?.querySelector('button')?.click();
}
function downloadJson(name,value) {
  const blob=new Blob([full(value)+'\n'],{type:'application/json'}),href=URL.createObjectURL(blob),link=element('a');
  link.href=href;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
}
export function bootCustomerDesk() {
  try {
    state.pending=storage(PENDING)??[];state.following=storage(FOLLOW)??[];
    if(!Array.isArray(state.pending)||!Array.isArray(state.following))throw new Error('Saved customer browser actions are not an array.');
  } catch(issue){notice(errorText(issue),'error');return;}
  on('customer-new','click',()=>{$('customer-select-panel').open=true;$('customer-select-panel').scrollIntoView({block:'start'});});
  on('customer-adopt-show','click',()=>{$('customer-adopt-panel').open=true;$('customer-adopt-panel').scrollIntoView({block:'start'});});
  const select=$('customer-select-form'),adopt=$('customer-adopt-form');
  select.elements.kind.addEventListener('change',kindChanged);
  for(const name of ['sourceDirectory','expectedSourceSha256'])select.elements[name].addEventListener('input',invalidateSource);
  adopt.elements.outputDirectory.addEventListener('input',invalidateExisting);
  on('customer-source-read','click',inspectSource);on('customer-existing-read','click',inspectExisting);
  on('customer-source-download','click',()=>downloadJson('customer-source-review.json',state.source));
  on('customer-select-form','submit',async()=>{const body=selectBody();await command('/api/customer/select',body,'Save reviewed customer selection');});
  on('customer-adopt-form','submit',async()=>{const body=adoptBody();await command('/api/customer/adopt',body,'Retain original customer');});
  on('customer-refresh','click',refresh);on('customer-detail-read','click',readDetail);
  on('customer-previous','click',()=>{state.offset=Math.max(0,state.offset-25);return readList();});
  on('customer-next','click',()=>{if(state.page&&state.page.nextOffset!==null){state.offset=state.page.nextOffset;return readList();}});
  on('customer-advance','click',async()=>{
    const value=state.detail;if(!value?.selectionSha256)throw new Error('Select a complete original customer.');
    setFollow(value,true);
    try {
      const result=await command('/api/customer/advance',{id:value.id,expectedSelectionSha256:value.selectionSha256},'Commission original customer and receive application');
      if(RETRY.has(result.phase)||result.phase==='READY'&&result.result)setFollow(result,false);
    } catch(issue){setFollow(value,false);throw issue;}finally{renderDetail();}
  });
  on('customer-resume','click',async()=>{
    const value=state.detail,phase=selectedPhase(value);
    if(!value?.selectionSha256)throw new Error('Select the original customer.');
    const result=await command('/api/customer/resume',{id:value.id,phase,expectedSelectionSha256:value.selectionSha256},'Resume original '+phase+' phase');
    setFollow(result,true);renderDetail();
  });
  on('customer-cancel','click',async()=>{
    const value=state.detail;if(!value?.selectionSha256)throw new Error('Select the original customer.');
    setFollow(value,false);
    await command('/api/customer/cancel',{id:value.id,phase:selectedPhase(value),expectedSelectionSha256:value.selectionSha256},'Cancel original customer phase');
  });
  on('customer-follow-stop','click',()=>{if(state.detail)setFollow(state.detail,false);renderDetail();notice('Desk continuation paused. The original worker remains available in Operations.');});
  on('customer-show-worker','click',()=>nativeTab('operations',state.detail.customerOperationId));
  on('customer-show-registration','click',()=>nativeTab('operations',state.detail.registrationId));
  on('customer-show-application','click',()=>nativeTab('applications',state.detail.applicationId));
  on('customer-pending-choice','change',()=>{state.pendingId=$('customer-pending-choice').value;renderPending();});
  on('customer-pending-read','click',()=>{const saved=state.pending.find(item=>item.id===state.pendingId);if(saved)return selectCustomer(saved.body.id);});
  on('customer-pending-retry','click',async()=>{
    const saved=state.pending.find(item=>item.id===state.pendingId);if(!saved)return;
    const result=await command(saved.path,saved.body,saved.label,saved);
    if(['/api/customer/advance','/api/customer/resume'].includes(saved.path)&&!RETRY.has(result.phase))setFollow(result,true);
    renderDetail();
  });
  on('customer-pending-dismiss','click',()=>{
    const saved=state.pending.find(item=>item.id===state.pendingId);if(!saved)return;
    rememberPending(null,saved.id);notice('The browser reminder was removed. The retained original customer and operation remain in this runtime.');
  });
  const observer=new MutationObserver(()=>{try{syncSession();}catch(issue){notice(errorText(issue),'error');}});
  observer.observe($('connection-state'),{childList:true,characterData:true,subtree:true});
  observer.observe($('workspace-directory'),{childList:true,characterData:true,subtree:true});
  observer.observe($('session-panel'),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('pagehide',()=>{state.closed=true;clearTimeout(state.timer);});
  window.addEventListener('pageshow',()=>{state.closed=false;syncSession();poll();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.connected)refresh().catch(issue=>notice(errorText(issue),'error'));});
  kindChanged();invalidateExisting();syncSession();renderPending();renderList();renderDetail();poll();
}
