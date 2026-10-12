// MIT. Industrial browser over the original private RisingWave workbench.
import {BROWSER_STATE_SCHEMA, RECOVERABLE_ROUTE, validateBrowserState, originalRequest, recordOperation, operationReceipt, same, mergeDraft} from './recovery.mjs';
const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value,null,2);
const split = text => text.split(',').map(value=>value.trim()).filter(Boolean);
const el = (tag,text,className) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const types=['string','integer','number','boolean','bigint','decimal','timestamp','timestamptz','date','time','interval','uuid','json','bytes'];
const state={saved:null,source:null,merchant:null,payments:[],dirty:false,reportDirty:false,selectedReport:'',
  columns:[],parameters:[],filters:[],catalogue:null,captures:null,offset:0,product:null,offer:null,
  subscriptionReview:null,subscriptionRequests:new Map(),captureRequests:new Map(),productRequests:new Map(),
  comparisonRequests:new Map(),saveRequests:new Map(),buyerRequests:new Map(),journal:[],downloads:[],rawEditors:{},remoteSaved:null,buyerOffset:0,buyerDrafts:{},productGeneration:0,productReadVersion:0,pendingProductId:null,offerVersion:0,offerSelection:null,operationGeneration:0,workspaceGeneration:0};

const requestMapNames = ['subscriptionRequests','captureRequests','productRequests','comparisonRequests','saveRequests','buyerRequests'];
const dynamicFormNames = ['payments','report-columns','report-parameters','report-filters','preview-parameters','capture-parameters'];
const recovery = {ready:false,id:null,version:0,pending:null,flushing:null,timer:null,lastSaved:null,localError:null,remoteError:null};
const fieldValue = node => ({kind:node.type==='checkbox'?'checked':'value',value:node.type==='checkbox'?node.checked:node.value});
const setField = (node,field) => {
  if(!node||!field)return;
  if(field.kind==='checked'&&node.type==='checkbox')node.checked=field.value;
  else if(field.kind==='value'){
    if(node.tagName==='SELECT'&&field.value!==''&&![...node.options].some(option=>option.value===field.value)){
      const original=el('option','Retained selection · '+field.value);original.value=field.value;node.append(original);
    }
    node.value=field.value;
  }
};
const browserId = () => 'browser-'+Date.now()+'-'+crypto.randomUUID();
const localKey = () => 'risingwave-browser:'+state.saved.workspaceIdentity;
function browserSnapshot() {
  if(!state.saved)return null;
  rememberBuyerDraft();
  const form=Object.fromEntries([...document.querySelectorAll('input[id],select[id],textarea[id]')]
    .filter(node=>node.type!=='file'&&!node.id.startsWith('recovery-')).map(node=>[node.id,fieldValue(node)]));
  const parameterInputs=Object.fromEntries(dynamicFormNames.map(name=>[name,
    [...$(name).querySelectorAll('input,select,textarea')].map(fieldValue)]));
  return {schema:BROWSER_STATE_SCHEMA,workspaceIdentity:state.saved.workspaceIdentity,baseRevision:state.saved.revision,
    source:structuredClone(state.source),merchant:structuredClone(state.merchant),payments:structuredClone(state.payments),
    dirty:state.dirty,reportDirty:state.reportDirty,selectedReport:state.selectedReport,rawEditors:structuredClone(state.rawEditors??{}),
    columns:structuredClone(state.columns),parameters:structuredClone(state.parameters),filters:structuredClone(state.filters),
    form,parameterInputs,requests:Object.fromEntries(requestMapNames.map(name=>[name,[...(state[name]??new Map())]])),
    journal:structuredClone(state.journal),downloads:structuredClone(state.downloads),buyerDrafts:structuredClone(state.buyerDrafts),
    view:{tab:document.querySelector('nav button[aria-selected="true"]')?.dataset.tab??'source',offset:state.offset,
      comparisonOffset:state.comparisonOffset??0,buyerOffset:state.buyerOffset??0,productId:state.product?.id??null,
      subscriptionReviewId:state.subscriptionReview?.requestId??null,offer:structuredClone(state.offer),offerSelection:structuredClone(state.offerSelection),
      reconcileRequested:state.reconcileRequested===true,reconcileChoices:structuredClone(state.reconcileChoices??{})}};
}
function localCheckpoint(snapshot=browserSnapshot()) {
  if(!recovery.ready||!snapshot)return;
  try{localStorage.setItem(localKey(),JSON.stringify({id:recovery.id,version:recovery.version,state:snapshot,pending:recovery.pending}));recovery.localError=null;}
  catch(error){recovery.localError=error.message;}
}
function recoveryStatus() {
  const target=$('recovery-status');if(!target)return;
  if(recovery.remoteError)target.textContent='Draft retained in this page. Workspace save: '+recovery.remoteError;
  else if(recovery.pending||recovery.flushing)target.textContent='Saving the complete browser workspace…';
  else if(recovery.id&&recovery.version)target.textContent='Browser workspace '+recovery.id+' · saved version '+recovery.version;
  else target.textContent='Browser drafts and original operations are saved with this workbench.';
  target.classList.toggle('error-text',Boolean(recovery.remoteError));
  if(recovery.localError)target.textContent+=' Local browser storage: '+recovery.localError;
}
function checkpoint() {
  if(!recovery.ready)return;
  localCheckpoint();clearTimeout(recovery.timer);
  recovery.timer=setTimeout(()=>{void flushRecovery().catch(()=>{});},500);
}
async function flushRecovery() {
  if(!recovery.ready)return;
  if(recovery.flushing)return recovery.flushing;
  clearTimeout(recovery.timer);
  recovery.flushing=(async()=>{
    for(;;){
      const snapshot=validateBrowserState(browserSnapshot(),state.saved.workspaceIdentity);
      if(!recovery.pending&&same(snapshot,recovery.lastSaved))return;
      recovery.pending??={id:recovery.id,expectedVersion:recovery.version,
        writeId:'draft-'+Date.now()+'-'+crypto.randomUUID(),state:snapshot};
      localCheckpoint(snapshot);recoveryStatus();
      const sent=recovery.pending;
      let result;
      try{result=await requestApi('browser-workspace',sent,15000);}
      catch(error){
        recovery.remoteError=error.message;
        if(error.code==='BROWSER_VERSION_CHANGED'){
          // Keep both complete editors. This tab continues under its own durable identity.
          recovery.id=browserId();recovery.version=0;recovery.pending=null;recovery.lastSaved=null;
          recovery.remoteError=null;localCheckpoint();continue;
        }
        localCheckpoint();throw error;
      }
      recovery.id=result.id;recovery.version=result.version;recovery.lastSaved=structuredClone(sent.state);
      recovery.pending=null;recovery.remoteError=null;localCheckpoint();
      if(same(browserSnapshot(),recovery.lastSaved))return;
    }
  })().finally(()=>{recovery.flushing=null;recoveryStatus();});
  return recovery.flushing;
}
async function api(path,body) {
  if(body===undefined||!RECOVERABLE_ROUTE.test(path)||!state.saved)return requestApi(path,body);
  const operation=recordOperation(state.journal,path,body);
  operation.state='IN_FLIGHT';operation.attempts++;operation.lastAttemptAt=new Date().toISOString();
  checkpoint();renderOperations();
  await flushRecovery().catch(()=>{});
  try{
    const result=await requestApi(path,operation.body);
    operation.state='RETURNED';operation.returnedAt=new Date().toISOString();operation.receipt=operationReceipt(result);delete operation.error;
    return result;
  }catch(error){operation.state='ERROR';operation.error=error.message;throw error;}
  finally{checkpoint();renderOperations();}
}
function restoreFields(snapshot) {
  for(const[id,field]of Object.entries(snapshot.form))setField($(id),field);
  for(const[name,fields]of Object.entries(snapshot.parameterInputs)){
    if(!dynamicFormNames.includes(name)||!Array.isArray(fields))continue;
    const nodes=[...$(name).querySelectorAll('input,select,textarea')];fields.forEach((field,index)=>setField(nodes[index],field));
  }
}
function currentHasChanges(){return state.dirty||state.reportDirty||Object.values(state.rawEditors??{}).some(Boolean);}
async function installBrowserSnapshot(snapshot,latest) {
  const value=validateBrowserState(snapshot,latest.workspaceIdentity);
  state.productGeneration++;state.productReadVersion++;state.offerVersion++;state.pendingProductId=null;$('selected-product').inert=false;
  let base=latest;
  if(value.baseRevision!==latest.revision){
    const original=value.baseRevision?await requestApi('revisions/'+value.baseRevision):{revision:0,source:null,merchant:null,sourceHash:null,savedAt:null};
    base={...latest,...original};
  }
  state.product=null;state.offer=null;state.offerSelection=null;state.subscriptionReview=null;$('selected-product').hidden=true;$('subscription-review').hidden=true;
  install(base);state.remoteSaved=latest;
  state.source=structuredClone(value.source);state.merchant=structuredClone(value.merchant);state.payments=structuredClone(value.payments);
  state.selectedReport=value.selectedReport;state.rawEditors=structuredClone(value.rawEditors??{});
  sourceFields(state.source,state.merchant);renderPayments();refreshReportOptions(value.selectedReport);loadReport(value.selectedReport);
  state.columns=structuredClone(value.columns);state.parameters=structuredClone(value.parameters);state.filters=structuredClone(value.filters);
  renderColumns();renderParameters();renderFilters();
  state.dirty=value.dirty||value.baseRevision!==latest.revision;state.reportDirty=value.reportDirty;
  state.journal=structuredClone(value.journal);state.downloads=structuredClone(value.downloads??[]);state.buyerDrafts=structuredClone(value.buyerDrafts??{});
  for(const name of requestMapNames)state[name]=new Map(structuredClone(value.requests[name]??[]));
  state.offset=value.view.offset??0;state.comparisonOffset=value.view.comparisonOffset??0;state.buyerOffset=value.view.buyerOffset??0;
  state.reconcileRequested=value.view.reconcileRequested===true;state.reconcileChoices=structuredClone(value.view.reconcileChoices??{});
  restoreFields(value);
  renderParameterInputs('preview-parameters',$('report-select').value);
  renderParameterInputs('capture-parameters',$('capture-query').value);
  restoreFields(value);
  const selectedCaptures=[...new Set(['capture-base','compare-before','compare-after'].map(name=>value.form[name]?.value).filter(Boolean))];
  state.knownCaptures??=new Map();
  const reads=await Promise.allSettled(selectedCaptures.map(id=>requestApi('captures/'+id)));
  for(const result of reads)if(result.status==='fulfilled')state.knownCaptures.set(result.value.id,result.value);
  captureOptions();restoreFields(value);
  if(value.view.productId){
    try{state.product=await requestApi('publications/'+value.view.productId+'?buyerOffset='+state.buyerOffset);renderProduct();restoreFields(value);}
    catch(error){notice('The saved draft is open. Product refresh: '+error.message,true);}
  }
  if(value.view.subscriptionReviewId){
    try{showSubscriptionReview(await requestApi('subscriptions/'+value.view.subscriptionReviewId));}
    catch(error){notice('The saved draft is open. Subscription refresh: '+error.message,true);}
  }
  state.offer=structuredClone(value.view.offer);state.offerSelection=structuredClone(value.view.offerSelection??null);
  if(state.offer&&!same(state.offerSelection,buyerSelection())){state.offer=null;state.offerSelection=null;}
  if(state.offer){options($('buyer-option'),state.offer.accepts.map((choice,index)=>({value:String(index),label:index+' · '+choice.network+' · '+choice.amount})),value.form['buyer-option']?.value??'0');}
  tab(value.view.tab);renderOperations();renderDownloads();status();
  if(value.baseRevision!==latest.revision)notice('Restored all browser edits from revision '+value.baseRevision+'. Revision '+latest.revision+' is now saved; reconcile the changes before saving this draft.');
}
async function workspaceTransition(action) {
  const inert=document.body.inert;document.body.inert=true;
  state.workspaceGeneration++;state.productGeneration++;state.productReadVersion++;state.offerVersion++;state.operationGeneration++;
  state.pendingProductId=null;$('selected-product').inert=false;
  try{return await action();}finally{document.body.inert=inert;}
}
async function openRecovery(id) {return workspaceTransition(async()=>{
  await flushRecovery();
  const [record,latest]=await Promise.all([requestApi('browser-workspaces/'+id),requestApi('state')]);
  recovery.ready=false;
  try{await installBrowserSnapshot(record.state,latest);recovery.id=record.id;recovery.version=record.version;
    recovery.pending=null;recovery.lastSaved=structuredClone(record.state);}
  finally{recovery.ready=true;}
  checkpoint();await refreshRecoveryList();notice('Opened the complete saved browser workspace and its original operations.');
});}
async function refreshRecoveryList() {
  const result=await requestApi('browser-workspaces');
  options($('recovery-select'),result.items.map(item=>({value:item.id,label:item.updatedAt+' · source '+item.baseRevision+
    (item.dirty?' · draft':'')+' · '+item.pendingOperations+' pending'})),recovery.id);
  $('recovery-open').disabled=!result.total;
}
async function initializeRecovery(latest) {
  install(latest);state.remoteSaved=latest;
  let local=null;
  try{const text=localStorage.getItem(localKey());if(text){local=JSON.parse(text);validateBrowserState(local.state,latest.workspaceIdentity);}}
  catch(error){local=null;recovery.localError=error.message;notice('The saved source is open. Browser draft: '+error.message,true);}
  const listed=await requestApi('browser-workspaces');
  let record=null;
  if(local){
    try{
      if(local.pending){
        const received=await requestApi('browser-workspace',local.pending,15000);local.version=received.version;local.pending=null;
      }
      if(listed.items.some(item=>item.id===local.id))record=await requestApi('browser-workspaces/'+local.id);
      if(record&&record.version>local.version&&!same(record.state,local.state)){
        local.id=browserId();local.version=0;local.pending=null;record=null;
      }
      await installBrowserSnapshot(local.state,latest);recovery.id=local.id;recovery.version=local.version;
      recovery.pending=local.pending??null;recovery.lastSaved=record?.state??null;
    }catch(error){
      if(error.code==='BROWSER_VERSION_CHANGED'){await installBrowserSnapshot(local.state,latest);recovery.id=browserId();recovery.version=0;}
      else{notice('The saved source is open. Retained browser recovery: '+error.message,true);throw error;}
    }
  }else if(listed.items.length){
    record=await requestApi('browser-workspaces/'+listed.items[0].id);
    await installBrowserSnapshot(record.state,latest);recovery.id=record.id;recovery.version=record.version;recovery.lastSaved=record.state;
  }else{recovery.id=browserId();recovery.version=0;}
  recovery.ready=true;checkpoint();await refreshRecoveryList();renderOperations();renderDownloads();
}
function renderOperations() {
  const target=$('recovery-operations');if(!target)return;
  target.replaceChildren(grid(['Operation','State','Original request','Continue'],[...state.journal].reverse().map(entry=>[
    entry.path,entry.state+(entry.error?' · '+entry.error:''),entry.body.requestId??entry.body.captureId??entry.body.comparisonId??entry.body.publicationId??entry.body.buyerId??entry.body.id??entry.id,
    button(entry.state==='RETURNED'?'Open original result':'Continue original request',()=>continueOperation(entry))])));
  if(!state.journal.length)target.append(el('p','Original source saves, subscriptions, editions, differences, products and customer requests appear here.','muted'));
}
async function continueOperation(entry) {
  const generation=++state.operationGeneration,context=entry.path==='publications'?beginProductSelection(entry.body.publicationId):null;
  try {
  let result;
  if(entry.state==='RETURNED'){
    const receipt=entry.receipt??{};
    if(entry.path==='save'){const saved=await requestApi('revisions/'+(receipt.saveOperation?.revision??receipt.revision));if(generation===state.operationGeneration)$('recovery-result').replaceChildren(details(saved,'Original saved source revision'));return;}
    if(entry.path.startsWith('subscription/'))result=await requestApi('subscriptions/'+entry.body.requestId);
    else if(entry.path==='capture'||entry.path.startsWith('capture/'))result=await requestApi('captures/'+(entry.body.captureId??entry.body.id));
    else if(entry.path==='captures/compare')result=await requestApi('comparisons/'+entry.body.comparisonId);
    else if(entry.path==='publications')result=await requestApi('publications/'+entry.body.publicationId);
    else if(entry.path.endsWith('/buyer')){
      const publication=entry.path.split('/')[1],buyer=receipt.id??entry.body.buyerId;
      $('recovery-result').replaceChildren(details(entry,'Original customer preparation'),button('Download original customer request',()=>download('files/buyer/'+publication+'/'+buyer,'RisingWave-Dataset-Buyer-'+buyer+'.json')));return;
    }else result=await requestApi('publications/'+entry.path.split('/')[1]);
  }else result=await api(entry.path,entry.body);
  if(generation!==state.operationGeneration)return;
  $('recovery-result').replaceChildren(details(result,'Original operation result'));
  if(entry.path.startsWith('subscription/'))showSubscriptionReview(result);
  else if(entry.path==='capture'||entry.path.startsWith('capture/')){$('capture-operation').replaceChildren(captureCard(result));await refreshCaptures();}
  else if(entry.path==='captures/compare'){renderComparison(result);await refreshComparisons();}
  else if(entry.path==='save'){state.remoteSaved=await requestApi('state');status();}
  else if(entry.path==='publications'){adoptProduct(result,context);}
  else if(entry.path.endsWith('/buyer')){const publication=entry.path.split('/')[1];$('recovery-result').append(button('Download original customer request',()=>download('files/buyer/'+publication+'/'+result.id,'RisingWave-Dataset-Buyer-'+result.id+'.json')));}
  notice('Opened the original '+entry.path+' operation.');checkpoint();
  } finally {if(context)finishProductSelection(context);}
}
function renderDownloads() {
  const target=$('recovery-downloads');if(!target)return;
  target.replaceChildren(grid(['File','Received bytes','Original download'],[...state.downloads].reverse().map(entry=>[
    entry.filename,entry.bytes??'Pending',button('Download original file',()=>download(entry.path,entry.filename))])));
}
async function draftForReconciliation() {
  if(Object.values(state.rawEditors??{}).some(Boolean))throw new Error('Apply the edited source JSON and payment JSON before reconciling their fields.');
  const source=currentSource();
  if(state.reportDirty){
    const name=$('report-name').value.trim();if(!name)throw new Error('Enter the report name before reconciling.');
    source.queries[name]=await api('report/compile',{report:reportSpec()});
  }
  return {source,merchant:currentMerchant()};
}
async function prepareReconciliation() {
  const generation=state.workspaceGeneration,reviewed=editorEdition(),originalState=structuredClone(state.saved);
  const draft=await draftForReconciliation(),latest=await requestApi('state');
  if(generation!==state.workspaceGeneration)return;
  state.remoteSaved=latest;state.reconcileRequested=true;state.reconcileChoices??={};
  if(!same(reviewed,editorEdition())){$('reconcile-result').replaceChildren(el('p','The draft changed while its reconciliation was prepared.'),button('Review the current draft',prepareReconciliation));checkpoint();return;}
  const original={source:originalState.source??freshSource(),merchant:originalState.merchant};
  const saved={source:latest.source??freshSource(),merchant:latest.merchant};
  const result=mergeDraft(original,draft,saved,key=>state.reconcileChoices[key]);
  const target=$('reconcile-result');target.replaceChildren(el('p','Draft source revision '+state.saved.revision+' · saved source revision '+latest.revision));
  for(const conflict of result.conflicts){
    const panel=el('section',undefined,'subpanel'),choice=el('select');
    options(choice,[{value:'',label:'Choose this field'},{value:'draft',label:'Use my draft value'},{value:'saved',label:'Use the saved value'}],'');
    panel.append(el('h3',conflict.path.join(' / ')),details({previous:conflict.base,draft:conflict.draft,saved:conflict.saved},'Compare complete values'),choice);
    choice.addEventListener('change',()=>{state.reconcileChoices[conflict.key]=choice.value;checkpoint();});
    target.append(panel);
  }
  if(result.conflicts.length)target.append(button('Recalculate with these field choices',prepareReconciliation));
  else target.append(button('Apply reconciled draft',async()=>{
    if(generation!==state.workspaceGeneration)return;
    if(!same(reviewed,editorEdition())){await prepareReconciliation();return;}
    const observed=await requestApi('state');
    if(generation!==state.workspaceGeneration)return;
    if(observed.revision!==latest.revision||!same(reviewed,editorEdition())){await prepareReconciliation();return;}
    const source=result.value.source,merchant=result.value.merchant;
    install(latest);state.remoteSaved=latest;state.source=structuredClone(source);state.merchant=structuredClone(merchant);
    state.payments=structuredClone(merchant?.paymentOptions??(merchant?.payment?[merchant.payment]:[]));
    sourceFields(source,merchant);renderPayments();refreshReportOptions(state.selectedReport);loadReport($('report-select').value);
    state.dirty=!same(result.value,saved);state.reportDirty=false;state.rawEditors={};state.reconcileRequested=false;state.reconcileChoices={};
    target.replaceChildren(el('p','The complete reconciled draft now uses saved revision '+latest.revision+'.'));
    status();checkpoint();notice('Applied the reconciled source and merchant draft.');
  }));
  checkpoint();
}

const freshSource=()=>({schema:'stellar-forge.risingwave-source.v1',connectionStringEnv:'RISINGWAVE_URL',tls:'require',
  allowLocal:false,maxInFlight:1,queryTimeoutMs:30000,queries:{}});
const token=location.hash.slice(1);
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function requestApi(path,body,timeout=330000){
  if(typeof path!=='string'||path.includes('#'))throw new Error('Invalid workbench route.');
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(timeout),
    headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  let value;try{value=await response.json();}catch{throw new Error('The original workbench did not return a JSON response. Reopen its printed URL.');}
  if(!response.ok)throw Object.assign(new Error((value.code?value.code+': ':'')+(value.message??value.error??'Request failed.')),{status:response.status,code:value.code});
  return value;
}
async function run(action){try{return await action();}catch(error){notice(error.message,true);return undefined;}finally{checkpoint();}}
function on(id,action){$(id).addEventListener('click',()=>{void run(async()=>{const button=$(id);if(button.disabled)return;button.disabled=true;try{return await action();}finally{button.disabled=false;}});});}
function button(label,action){const node=el('button',label);node.type='button';node.addEventListener('click',()=>{void run(async()=>{if(node.disabled)return;node.disabled=true;try{return await action();}finally{node.disabled=false;}});});return node;}
function options(target,values,selected){target.replaceChildren(...values.map(item=>{const option=el('option',item.label);option.value=item.value;return option;}));if(values.some(item=>item.value===selected))target.value=selected;}
function json(text,kind='object'){let value;try{value=JSON.parse(text);}catch{throw new Error('Enter valid JSON.');}if(kind==='array'?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value))throw new Error('Enter a JSON '+kind+'.');return value;}
function facts(target,entries){target.replaceChildren(...entries.flatMap(([label,value])=>[el('dt',label),el('dd',value===null?'NULL':typeof value==='object'?pretty(value):String(value??''))]));}
function details(value,title='Complete metadata'){const node=el('details');node.append(el('summary',title),el('pre',pretty(value)));return node;}
function grid(headers,rows){const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('tr');head.append(...headers.map(label=>el('th',label)));const thead=el('thead');thead.append(head);const body=el('tbody');
  for(const values of rows){const row=el('tr');for(const value of values){const cell=el('td');if(value instanceof Node)cell.append(value);else if(value===null)cell.append(el('span','NULL','null'));else if(value==='')cell.append(el('span','empty text','empty'));else cell.textContent=typeof value==='object'?pretty(value):String(value??'');row.append(cell);}body.append(row);}table.append(thead,body);wrap.append(table);return wrap;}
function downloadObject(value,filename){const url=URL.createObjectURL(new Blob([pretty(value)+'\n'],{type:'application/json'})),anchor=el('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function download(path,filename){
  let entry=state.downloads.find(value=>value.path===path&&value.filename===filename);
  if(!entry){entry={path,filename,createdAt:new Date().toISOString()};state.downloads.push(entry);}
  checkpoint();await flushRecovery().catch(()=>{});
  const response=await fetch('/api/'+path,{headers:{authorization:'Bearer '+token},redirect:'error'});
  if(!response.ok){const value=await response.json();throw new Error(value.error??'Download failed.');}
  const content=await response.blob();entry.bytes=content.size;entry.lastReceivedAt=new Date().toISOString();
  const url=URL.createObjectURL(content),anchor=el('a');anchor.href=url;anchor.download=filename;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);renderDownloads();checkpoint();
}
function rowsView(target,result){const value=result.sample??result,rows=value.rows??value.dataset??value.data;
  target.replaceChildren();if(Array.isArray(rows)){const declared=value.columns??value.fields;const names=Array.isArray(declared)?declared.map(item=>typeof item==='string'?item:item.name??item.column):Object.keys(rows[0]??{});
    target.append(el('p','Returned '+rows.length+' preview rows. '+(rows.length>200?'The table displays the first 200.':'')+' Capture an edition for complete source delivery.'));
    target.append(grid(names,rows.slice(0,200).map(row=>Array.isArray(row)?row:names.map(name=>row[name]))));}
  target.append(button('Download complete preview response',()=>downloadObject(result,'RisingWave-Preview.json')),details(result,'Complete native preview response'));}
function markDirty(){state.dirty=true;status();}
function markReportDirty(){state.reportDirty=true;status();}
function status(){$('revision-status').textContent='Saved revision '+(state.saved?.revision??0);$('draft-status').textContent=currentHasChanges()?'Unsaved changes':'Saved';$('workspace-location').textContent=state.saved?.directory??'';$('saved-time').textContent=(state.saved?.savedAt?'Saved '+state.saved.savedAt:'')+(state.remoteSaved&&state.remoteSaved.revision!==state.saved?.revision?' · newer saved revision '+state.remoteSaved.revision:'');}
function tab(name){for(const node of document.querySelectorAll('.tab'))node.hidden=node.id!==name;for(const node of document.querySelectorAll('nav button'))node.setAttribute('aria-selected',String(node.dataset.tab===name));}
for(const node of document.querySelectorAll('nav button'))node.addEventListener('click',()=>{tab(node.dataset.tab);if(node.dataset.tab==='captures')void run(async()=>{await refreshCaptures();await refreshComparisons();});if(node.dataset.tab==='subscriptions')void run(refreshSubscriptions);if(node.dataset.tab==='products')void run(refreshProducts);});
function requiredInteger(id,minimum=1){const raw=$(id).value;if(!/^(0|[1-9][0-9]*)$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<minimum)throw new Error('Enter a valid whole number for '+$(id).closest('label').firstChild.textContent.trim()+'.');return Number(raw);}
function currentSource(){const source=structuredClone(state.source??freshSource());source.connectionStringEnv=$('connection-env').value.trim();source.tls=$('tls').value;source.allowLocal=$('allow-local').checked;source.maxInFlight=requiredInteger('max-inflight');source.queryTimeoutMs=requiredInteger('query-timeout');
  if($('ca-env').value.trim())source.caFileEnv=$('ca-env').value.trim();else delete source.caFileEnv;return source;}
function sourceFields(source,merchant){$('connection-env').value=source.connectionStringEnv??'RISINGWAVE_URL';$('tls').value=source.tls??'require';$('ca-env').value=source.caFileEnv??'';$('allow-local').checked=source.allowLocal===true;$('max-inflight').value=source.maxInFlight??1;$('query-timeout').value=source.queryTimeoutMs??30000;
  $('merchant-origin').value=merchant?.publicOrigin??'';$('merchant-service').value=merchant?.serviceName??'RisingWave datasets';$('merchant-description').value=merchant?.description??'Versioned RisingWave subscription reports';$('source-json').value=pretty(source);}
function currentMerchant(){if(!$('merchant-origin').value.trim())return null;const original=state.merchant??{};const value={...original,publicOrigin:$('merchant-origin').value.trim(),serviceName:$('merchant-service').value,description:$('merchant-description').value,tags:original.tags??['risingwave','dataset']};delete value.payment;delete value.paymentOptions;
  if(original.payment&&state.payments.length===1)value.payment=structuredClone(state.payments[0]);else value.paymentOptions=structuredClone(state.payments);return value;}
function renderPayments(){$('payments').replaceChildren(...state.payments.map((choice,index)=>{const row=el('tr');for(const name of ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']){const cell=el('td'),input=el('input');input.value=choice[name]??'';input.setAttribute('aria-label',name+' for payment choice '+index);
  input.addEventListener('input',()=>{choice[name]=name==='maxTimeoutSeconds'?Number(input.value):input.value;$('payment-json').value=pretty(state.payments);markDirty();});cell.append(input);row.append(cell);}const cell=el('td');cell.append(button('Remove',()=>{state.payments.splice(index,1);renderPayments();markDirty();}));row.append(cell);return row;}));$('payment-json').value=pretty(state.payments);}
function refreshReportOptions(selected=state.selectedReport){const entries=Object.keys(state.source?.queries??{}).map(name=>({value:name,label:name}));
  options($('report-select'),[{value:'',label:'New report'},...entries],selected);
  const saved=Object.keys(state.saved?.source?.queries??{}).map(name=>({value:name,label:name}));
  for(const id of ['capture-query','product-query','subscription-query'])options($(id),saved,$(id).value||selected);
  renderParameterInputs('preview-parameters',$('report-select').value);renderParameterInputs('capture-parameters',$('capture-query').value);renderHandoff();}
function install(saved){state.saved=saved;state.source=structuredClone(saved.source??freshSource());state.merchant=structuredClone(saved.merchant??null);state.payments=structuredClone(saved.merchant?.paymentOptions??(saved.merchant?.payment?[saved.merchant.payment]:[]));state.dirty=false;state.reportDirty=false;state.rawEditors={};sourceFields(state.source,state.merchant);renderPayments();refreshReportOptions(state.selectedReport);loadReport($('report-select').value);
  $('environment-status').replaceChildren(...(saved.environment??[]).map(item=>el('span',item.name+' · '+(item.configured?'Configured':'Missing'),'badge')));
  $('source-history').replaceChildren(grid(['Revision','Saved','Reports','Files'],(saved.history??[]).map(item=>[item.revision,item.savedAt,item.reports,button('Download source',()=>download('files/revision/'+item.revision+'/source.json','RisingWave-Source-Revision-'+item.revision+'.json'))])));renderProducts();status();}
function requireSaved(){if(!state.saved?.revision)throw new Error('Save the source connection first.');if(currentHasChanges())throw new Error('Save the current changes before starting a native operation.');return state.saved.revision;}
const sourceFieldNames=['connection-env','tls','ca-env','query-timeout','max-inflight','allow-local','merchant-origin','merchant-service','merchant-description','source-json','payment-json'];
const reportFieldNames=['report-select','report-name','report-description','relation-schema','relation-name','subscription-schema','subscription-name','report-key','report-max-rows','report-max-bytes'];
const pickedFields=(snapshot,names)=>Object.fromEntries(names.map(name=>[name,snapshot.form[name]]));
const sourceEdition=snapshot=>({source:snapshot.source,merchant:snapshot.merchant,payments:snapshot.payments,form:pickedFields(snapshot,sourceFieldNames),rawEditors:snapshot.rawEditors});
const reportEdition=snapshot=>({selectedReport:snapshot.selectedReport,columns:snapshot.columns,parameters:snapshot.parameters,filters:snapshot.filters,form:pickedFields(snapshot,reportFieldNames)});
const editorEdition=(snapshot=browserSnapshot())=>({baseRevision:snapshot.baseRevision,source:sourceEdition(snapshot),report:reportEdition(snapshot)});
function nativeParameterDrafts() {
  return Object.fromEntries([['preview-parameters','report-select'],['capture-parameters','capture-query']].map(([target,select])=>{
    const query=$(select).value,parameters=state.saved?.source?.queries?.[query]?.parameters??{};
    return [target,{query,parameters:structuredClone(parameters),fields:[...$(target).querySelectorAll('[data-parameter]')].map(node=>{
      const name=node.dataset.parameter;
      return {name,value:node.value,include:[...$(target).querySelectorAll('[data-include]')].find(value=>value.dataset.include===name)?.checked,
        nil:[...$(target).querySelectorAll('[data-null]')].find(value=>value.dataset.null===name)?.checked};
    })}];
  }));
}
function restoreNativeParameterDrafts(drafts) {
  for(const[target,select]of [['preview-parameters','report-select'],['capture-parameters','capture-query']]){
    const draft=drafts[target],query=$(select).value;if(!draft||draft.query!==query)continue;
    const parameters=state.saved?.source?.queries?.[query]?.parameters??{};
    for(const field of draft.fields){
      const previous=draft.parameters[field.name],parameter=parameters[field.name];
      if(!previous||!parameter||previous.type!==parameter.type||Boolean(previous.array)!==Boolean(parameter.array))continue;
      const value=[...$(target).querySelectorAll('[data-parameter]')].find(node=>node.dataset.parameter===field.name);
      if(value)value.value=field.value;
      const include=[...$(target).querySelectorAll('[data-include]')].find(node=>node.dataset.include===field.name);
      if(include&&parameter.required===false)include.checked=Boolean(field.include);
      const nil=[...$(target).querySelectorAll('[data-null]')].find(node=>node.dataset.null===field.name);
      if(nil&&parameter.nullable===true)nil.checked=Boolean(field.nil);
    }
  }
}
function renderSourceMetadata(saved) {
  $('environment-status').replaceChildren(...(saved.environment??[]).map(item=>el('span',item.name+' · '+(item.configured?'Configured':'Missing'),'badge')));
  $('source-history').replaceChildren(grid(['Revision','Saved','Reports','Files'],(saved.history??[]).map(item=>[
    item.revision,item.savedAt,item.reports,button('Download source',()=>download('files/revision/'+item.revision+'/source.json','RisingWave-Source-Revision-'+item.revision+'.json'))])));
  renderProducts();status();
}

async function saveSource(){
  if(Object.values(state.rawEditors??{}).some(Boolean))throw new Error('Apply the edited source JSON and payment JSON before saving their fields.');
  const generation=state.workspaceGeneration,submitted=browserSnapshot(),input={expectedRevision:state.saved?.revision??0,source:currentSource(),merchant:currentMerchant()};
  const report=state.reportDirty?{name:$('report-name').value.trim(),spec:reportSpec()}:null;
  if(report&&!report.name)throw new Error('Enter a report name.');
  if(report)input.source.queries[report.name]=await api('report/compile',{report:report.spec});
  if(generation!==state.workspaceGeneration)return;
  const request=originalRequest(state,'saveRequests',input,'requestId','save');
  const saved=await api('save',request);
  if(generation!==state.workspaceGeneration)return;
  const later=browserSnapshot(),parameters=nativeParameterDrafts();
  state.remoteSaved=saved;
  const authorChanged=!same(editorEdition(submitted),editorEdition(later));
  const fieldsChanged=!same(submitted.form,later.form)||!same(submitted.parameterInputs,later.parameterInputs);
  if(!authorChanged&&!fieldsChanged){
    if(report)state.selectedReport=report.name;
    install(saved);restoreNativeParameterDrafts(parameters);
    notice('Saved the complete source, reports and merchant terms.');
  }else if(saved.saveOperation?.revision===saved.revision){
    // Apply the acknowledged submission as the base and retain every later editor delta.
    state.source=mergeDraft(submitted.source,later.source,saved.source,()=> 'draft').value;
    state.merchant=mergeDraft(submitted.merchant,later.merchant,saved.merchant,()=> 'draft').value;
    state.saved=saved;state.dirty=!same(sourceEdition(submitted),sourceEdition(later));
    state.reportDirty=!same(reportEdition(submitted),reportEdition(later));
    if(report&&state.selectedReport===submitted.selectedReport)state.selectedReport=report.name;
    refreshReportOptions(state.selectedReport);restoreNativeParameterDrafts(parameters);
    if(!state.rawEditors.source)$('source-json').value=pretty(state.source);
    renderSourceMetadata(saved);
    notice('Saved source revision '+saved.revision+'. Edits made during the save remain in the current draft.');
  }else{
    // A replay can acknowledge an older accepted save while another revision is current.
    state.dirty=true;renderSourceMetadata({...state.saved,history:saved.history,publications:saved.publications});
    notice('Original source revision '+saved.saveOperation.revision+' is saved. Later edits remain available for reconciliation with revision '+saved.revision+'.');
  }
  checkpoint();
}
function inputCell(value,label,onInput,{type='text',checked=false}={}){const cell=el('td'),input=el('input');input.type=type;input.setAttribute('aria-label',label);if(type==='checkbox'){input.checked=checked;input.className='cell-check';}else input.value=value??'';input.addEventListener(type==='checkbox'?'change':'input',()=>{onInput(type==='checkbox'?input.checked:input.value);markReportDirty();});cell.append(input);return cell;}
function selectCell(value,label,choices,onChange){const cell=el('td'),select=el('select');select.setAttribute('aria-label',label);options(select,choices.map(value=>({value,label:value})),value);select.addEventListener('change',()=>{onChange(select.value);markReportDirty();});cell.append(select);return cell;}
function renderColumns(){$('report-columns').replaceChildren(...state.columns.map((column,index)=>{const row=el('tr');row.append(inputCell(column.alias,'Output alias '+index,v=>column.alias=v),inputCell(column.column,'Native column '+index,v=>column.column=v),selectCell(column.type,'Type '+index,types,v=>column.type=v),inputCell(null,'Nullable '+index,v=>column.nullable=v,{type:'checkbox',checked:column.nullable===true}));const cell=el('td');cell.append(button('Remove',()=>{state.columns.splice(index,1);renderColumns();markReportDirty();}));row.append(cell);return row;}));}
function renderParameters(){$('report-parameters').replaceChildren(...state.parameters.map((parameter,index)=>{const row=el('tr');
  row.append(inputCell(parameter.name,'Parameter name '+index,v=>parameter.name=v),
    selectCell(parameter.type,'Parameter type '+index,types,v=>parameter.type=v),
    inputCell(null,'Required '+index,v=>parameter.required=v,{type:'checkbox',checked:parameter.required!==false}),
    inputCell(null,'Nullable '+index,v=>parameter.nullable=v,{type:'checkbox',checked:parameter.nullable===true}),
    inputCell(null,'Array '+index,v=>parameter.array=v,{type:'checkbox',checked:parameter.array===true}),
    inputCell(null,'Include probe '+index,v=>parameter.probeIncluded=v,{type:'checkbox',checked:parameter.probeIncluded===true||parameter.required!==false}),
    inputCell(parameter.probe,'Probe value '+index,v=>parameter.probe=v),
    inputCell(null,'NULL probe '+index,v=>parameter.probeNull=v,{type:'checkbox',checked:parameter.probeNull===true}));
  const cell=el('td');cell.append(button('Remove',()=>{state.parameters.splice(index,1);renderParameters();markReportDirty();}));row.append(cell);return row;}));}
function renderFilters(){$('report-filters').replaceChildren(...state.filters.map((filter,index)=>{const row=el('tr');row.append(inputCell(filter.column,'Filter field '+index,v=>filter.column=v),selectCell(filter.op,'Comparison '+index,['eq','ne','lt','lte','gt','gte','in','notIn','isNull','isNotNull'],v=>filter.op=v),inputCell(filter.parameter,'Filter parameter '+index,v=>filter.parameter=v));const cell=el('td');cell.append(button('Remove',()=>{state.filters.splice(index,1);renderFilters();markReportDirty();}));row.append(cell);return row;}));}
function atom(type,value){if(value===null)return null;const text=typeof value==='string'?value:String(value);
  if(type==='integer'){if(!/^-?(?:0|[1-9][0-9]*)$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error('Enter an exact safe integer. Use bigint for larger values.');return Number(text);}
  if(type==='number'){if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('Enter a finite number.');return Number(text);}
  if(type==='boolean'){if(text==='true')return true;if(text==='false')return false;throw new Error('Use true or false for a boolean.');}
  return text;}
function typedValue(parameter,text,isNull=false){if(isNull)return null;if(parameter.array){let values;try{values=JSON.parse(text);}catch{throw new Error('Enter an array as JSON. Quote exact large integers and decimals.');}if(!Array.isArray(values))throw new Error('Enter a JSON array.');
    if(['bigint','decimal','timestamp','timestamptz','date','time','interval','uuid','json','bytes'].includes(parameter.type)&&values.some(value=>value!==null&&typeof value!=='string'))throw new Error('Keep exact values as strings in this parameter array.');
    return values.map(value=>atom(parameter.type,value));}return atom(parameter.type,text);}
function reportSpec(){const columns={},parameters={},probe={};
  for(const column of state.columns){const alias=column.alias.trim();if(!alias||Object.hasOwn(columns,alias))throw new Error('Use distinct nonempty output aliases.');columns[alias]={column:column.column.trim(),type:column.type,nullable:column.nullable===true};}
  for(const parameter of state.parameters){const name=parameter.name.trim();if(!name||Object.hasOwn(parameters,name))throw new Error('Use distinct nonempty parameter names.');const declaration={...(parameter.original??{}),type:parameter.type,required:parameter.required!==false,nullable:parameter.nullable===true};
    if(parameter.array)declaration.array=true;else delete declaration.array;parameters[name]=declaration;
    if(parameter.required!==false||parameter.probeIncluded===true)probe[name]=typedValue(parameter,parameter.probe,parameter.probeNull);}
  const result={relation:{schema:$('relation-schema').value.trim(),name:$('relation-name').value.trim()},subscription:{schema:$('subscription-schema').value.trim(),name:$('subscription-name').value.trim()},key:split($('report-key').value),columns,parameters,
    filters:state.filters.map(filter=>({column:filter.column.trim(),op:filter.op,...(['isNull','isNotNull'].includes(filter.op)?{}:{parameter:filter.parameter.trim()})})),probe,maxRows:requiredInteger('report-max-rows'),maxBytes:requiredInteger('report-max-bytes')};
  if($('report-description').value.trim())result.description=$('report-description').value.trim();return result;}
function loadReport(name){state.selectedReport=name;const report=state.source?.queries?.[name]??{};
  $('report-name').value=name;$('report-description').value=report.description??'';$('relation-schema').value=report.relation?.schema??'public';$('relation-name').value=report.relation?.name??'';$('subscription-schema').value=report.subscription?.schema??'public';$('subscription-name').value=report.subscription?.name??'';$('report-key').value=(report.key??[]).join(', ');$('report-max-rows').value=report.maxRows??100;$('report-max-bytes').value=report.maxBytes??1048576;
  state.columns=Object.entries(report.columns??{}).map(([alias,column])=>({alias,...structuredClone(column)}));state.parameters=Object.entries(report.parameters??{}).map(([name,value])=>{
    const hasProbe=Object.hasOwn(report.probe??{},name),initial=hasProbe?report.probe[name]:value.default;
    return{name,type:value.type,required:value.required!==false,nullable:value.nullable===true,array:value.array===true,original:structuredClone(value),
      probeIncluded:hasProbe||value.required!==false,probeNull:initial===null,
      probe:initial===undefined||initial===null?'':typeof initial==='string'?initial:JSON.stringify(initial)};});state.filters=structuredClone(report.filters??[]);renderColumns();renderParameters();renderFilters();state.reportDirty=false;renderParameterInputs('preview-parameters',name);status();}
function renderParameterInputs(targetId,name){const report=state.saved?.source?.queries?.[name],target=$(targetId);target.replaceChildren();
  for(const[name,parameter]of Object.entries(report?.parameters??{})){const wrap=el('div'),label=el('label',name+' · '+parameter.type+(parameter.array?' array':'')),input=el('input');input.className='parameter-input';input.dataset.parameter=name;const hasProbe=Object.hasOwn(report.probe??{},name),initial=hasProbe?report.probe[name]:parameter.default;input.value=initial===undefined||initial===null?'':typeof initial==='string'?initial:JSON.stringify(initial);label.append(input);const controls=el('div',undefined,'editor-controls');
    const includeLabel=el('label',undefined,'check'),include=el('input');include.type='checkbox';include.dataset.include=name;include.checked=parameter.required!==false||hasProbe||Object.hasOwn(parameter,'default');include.disabled=parameter.required!==false;includeLabel.append(include,document.createTextNode('Include'));const nullLabel=el('label',undefined,'check'),nil=el('input');nil.type='checkbox';nil.dataset.null=name;nil.checked=initial===null;nil.disabled=parameter.nullable!==true;nullLabel.append(nil,document.createTextNode('NULL'));controls.append(includeLabel,nullLabel);wrap.append(label,controls);target.append(wrap);}
  if(!target.children.length)target.append(el('p','This report has no parameters.','muted'));}
function parameterInput(targetId,reportName){const result={},report=state.saved?.source?.queries?.[reportName];if(!report)throw new Error('Select a saved report.');
  const fields=[...$(targetId).querySelectorAll('[data-parameter]')];for(const input of fields){const name=input.dataset.parameter,include=[...$(targetId).querySelectorAll('[data-include]')].find(node=>node.dataset.include===name),nil=[...$(targetId).querySelectorAll('[data-null]')].find(node=>node.dataset.null===name);if(include?.checked)result[name]=typedValue(report.parameters[name],input.value,nil?.checked);}return result;}
function inferType(column){const oid=String(column.typeOid??'');const byOid={'20':'bigint','21':'integer','23':'integer','700':'number','701':'number','1700':'decimal','16':'boolean','1082':'date','1083':'time','1114':'timestamp','1184':'timestamptz','1186':'interval','2950':'uuid','114':'json','3802':'json','17':'bytes'};return byOid[oid]??'string';}
function useRelation(relation){if(state.reportDirty)throw new Error('Save or discard the current report draft before selecting another relation.');loadReport('');const used=new Set();state.columns=relation.columns.filter(column=>!column.hidden).map(column=>{let alias=column.name.replace(/[^A-Za-z0-9_]/g,'_');if(!/^[A-Za-z_]/.test(alias))alias='column_'+alias;const base=alias;let index=2;while(used.has(alias))alias=base+'_'+index++;used.add(alias);return{alias,column:column.name,type:inferType(column),nullable:column.nullable===true};});
  const subscription=state.catalogue.subscriptions.find(value=>String(value.relationId)===String(relation.id));$('report-name').value=relation.name.replace(/[^A-Za-z0-9_]/g,'_');$('relation-schema').value=relation.schema;$('relation-name').value=relation.name;$('subscription-schema').value=subscription?.schema??relation.schema;$('subscription-name').value=subscription?.name??relation.name+'_changes';$('report-key').value=state.columns.filter(column=>(relation.primaryKey??[]).includes(column.column)).map(column=>column.alias).join(', ');renderColumns();markReportDirty();tab('reports');notice('Loaded the native relation into a new report draft.');}
function renderCatalogue(){const catalogue=state.catalogue;$('catalogue').replaceChildren(el('p','Observed '+catalogue.observedAt+' · '+catalogue.version));for(const relation of catalogue.relations){const card=el('article',undefined,'catalogue-card');card.append(el('h3',relation.schema+'.'+relation.name),el('p',relation.type),button('Use in report',()=>useRelation(relation)),grid(['Column','Native type','Nullable','Key'],relation.columns.map(column=>[column.name,column.type,column.nullable?'Yes':'No',column.primaryKey?'Primary key':''])),details(relation,'Native relation metadata'));$('catalogue').append(card);}if(!catalogue.relations.length)$('catalogue').append(el('p','No relations matched this catalogue selection.'));$('catalogue').append(details(catalogue.subscriptions,'Existing native subscriptions'));}

function captureOptions(){const complete=[...(state.knownCaptures?.values()??[])].filter(item=>item.state==='COMPLETE');
  const compatible=complete.filter(item=>item.query===$('capture-query').value&&item.sourceHash===state.saved?.sourceHash);
  options($('capture-base'),[{value:'',label:'Latest compatible edition'},...compatible.map(item=>({value:item.id,label:item.query+' · '+item.startedAt}))],$('capture-base').value);
  $('capture-base').disabled=$('capture-mode').value==='full';
  const entries=complete.map(item=>({value:item.id,label:item.query+' · '+item.startedAt}));options($('compare-before'),entries,$('compare-before').value||entries[1]?.value);options($('compare-after'),entries,$('compare-after').value||entries[0]?.value);}
function captureCard(record){const card=el('article',undefined,'capture-card'),heading=el('div',undefined,'heading'),title=el('h3',record.query);title.append(el('span',record.state,'badge'));heading.append(title,el('span',record.startedAt,'muted'));card.append(heading);
  const manifest=record.manifest,progress=record.progress;const detail=el('dl',undefined,'facts');facts(detail,[['Edition',record.id],['Source revision',record.revision],['Mode',manifest?.effectiveMode??progress?.effectiveMode??record.mode],['Previous edition',record.baseCaptureId??'Initial snapshot'],['Source rows',manifest?.sourceRowCount??progress?.rows??'Reading'],['Report rows',manifest?.rowCount??'Materializing'],['Native stage',progress?.state??record.state]]);card.append(detail);
  if(record.error)card.append(el('p',record.error.code+': '+record.error.message,'error-text'));
  if(record.state==='COMPLETE'){const actions=el('div',undefined,'actions');for(const[name,file]of Object.entries(record.files??{}))actions.append(button(file.path+' · '+file.bytes+' bytes',()=>download('captures/'+record.id+'/files/'+name,file.path)));card.append(actions);}
  else if(record.state==='CAPTURING')card.append(button('Cancel original read',async()=>{await api('capture/cancel',{id:record.id});await refreshCaptures();}));
  else card.append(button('Resume this edition',async()=>{await api('capture/resume',{id:record.id});await refreshCaptures();notice('Continued original edition '+record.id+'.');}),button('Recover completed native files',async()=>{await api('capture/recover',{id:record.id});await refreshCaptures();}));
  card.append(details(record,'Complete edition and checkpoint metadata'));return card;}
async function refreshCaptures(){state.captures=await api('captures?limit=20&offset='+state.offset);
  state.knownCaptures??=new Map();for(const record of state.captures.items)state.knownCaptures.set(record.id,record);
  $('captures-list').replaceChildren(...state.captures.items.map(captureCard));if(!state.captures.items.length)$('captures-list').append(el('div','Capture a saved report to create its first complete edition.','empty-state'));
  $('captures-page').textContent=state.captures.total?(state.offset+1)+'–'+(state.offset+state.captures.items.length)+' of '+state.captures.total:'No editions';$('captures-prev').disabled=state.offset===0;$('captures-next').disabled=state.captures.nextOffset===null;
  for(const[key,request]of state.captureRequests){let record=state.captures.items.find(item=>item.id===request.captureId);if(!record)record=await api('captures/'+request.captureId).catch(error=>{if(error.status===404)return null;throw error;});if(record&&record.state!=='CAPTURING')state.captureRequests.delete(key);}
  captureOptions();renderHandoff();}
function selectedCaptureInput(){const query=$('capture-query').value,extraction={};for(const[id,name]of [['capture-max-rows','maxRows'],['capture-max-bytes','maxBytes'],['capture-max-row-bytes','maxRowBytes'],['capture-batch','batchSize'],['capture-timeout','timeoutSeconds']])if($(id).value!=='')extraction[name]=requiredInteger(id);
  if($('capture-duration').value!=='')extraction.maxDurationMs=requiredInteger('capture-duration')*1000;
  const mode=$('capture-mode').value;return{expectedRevision:requireSaved(),query,input:parameterInput('capture-parameters',query),mode,onGap:$('capture-gap').value,extraction,...(mode!=='full'&&$('capture-base').value?{baseCaptureId:$('capture-base').value}:{})};}
async function startCapture(){const input=selectedCaptureInput(),key=pretty(input);let request=state.captureRequests.get(key);if(!request){request={...input,captureId:'capture-'+Date.now()+'-'+crypto.randomUUID()};state.captureRequests.set(key,request);}
  $('capture-operation').replaceChildren(el('p','Original capture: '+request.captureId),button('Inspect this capture',async()=>{$('capture-operation').replaceChildren(captureCard(await api('captures/'+request.captureId)));}));
  const result=await api('capture',request);$('capture-operation').replaceChildren(captureCard(result));state.offset=0;await refreshCaptures();notice(result.state==='CAPTURING'?'Native capture started. The original operation is retained.':'Reopened the original capture.');}
function renderComparison(result){const target=$('comparison-result');target.replaceChildren();const counts=el('div',undefined,'metric-row');for(const[label,key]of [['Before','before'],['After','after'],['Added','added'],['Removed','removed'],['Changed','changed'],['Unchanged','unchanged']]){const item=el('div');item.append(el('strong',result.counts[key]),el('span',label));counts.append(item);}target.append(counts,el('p','All retained rows were compared. Difference tables display up to '+result.sampleLimit+' examples per group.'));
  for(const key of ['added','removed','changed']){const section=el('section',undefined,'subpanel');section.append(el('h3',key[0].toUpperCase()+key.slice(1)),grid(['Key','Before','After'],result[key].map(row=>[row.key,row.before??'',row.after??''])));target.append(section);}const files=el('div',undefined,'actions');
  for(const[name,file]of Object.entries(result.files))files.append(button(file.path+' · '+file.bytes+' bytes',()=>download('comparisons/'+result.id+'/files/'+name,file.path)));
  target.append(el('p','Complete comparison: '+result.id),files,el('pre','starforge risingwave-workbench receive-comparison --connection /private/workbench-launch.json --comparison '+result.id+' --directory /private/complete-differences'),details(result));
}
async function refreshComparisons(){state.comparisonOffset??=0;const result=await api('comparisons?limit=20&offset='+state.comparisonOffset);state.comparisons=result;
  $('comparisons-list').replaceChildren(grid(['Compared','Before','After','Added / removed / changed','Open'],result.items.map(value=>[value.comparedAt,value.before,value.after,value.counts.added+' / '+value.counts.removed+' / '+value.counts.changed,button('Open complete differences',async()=>renderComparison(await api('comparisons/'+value.id)))])));
  if(!result.items.length)$('comparisons-list').append(el('p','Saved complete differences will appear here.','muted'));
  $('comparisons-page').textContent=result.total?(state.comparisonOffset+1)+'–'+(state.comparisonOffset+result.items.length)+' of '+result.total:'No comparisons';$('comparisons-prev').disabled=state.comparisonOffset===0;$('comparisons-next').disabled=result.nextOffset===null;
}
function showSubscriptionReview(record){state.subscriptionReview=record;$('subscription-review').hidden=false;const review=record.review;facts($('subscription-review-facts'),[['Request',record.requestId],['Saved source revision',record.revision],['Relation',review.relation.schema+'.'+review.relation.name],['Subscription',review.subscription.schema+'.'+review.subscription.name],['Retention',review.retention.text],['Result',record.result?.status??'Reviewed']]);$('subscription-statement').textContent=review.statement;}
async function refreshSubscriptions(){const result=await api('subscriptions');$('subscription-operations').replaceChildren(grid(['Request','Report','Source revision','State','Open'],result.items.map(record=>[record.requestId,record.review.query,record.revision,record.result?.status??'Reviewed',button('Open review',()=>showSubscriptionReview(record))])));
  if(!result.items.length)$('subscription-operations').append(el('p','Saved subscription reviews and their original operation results appear here.','muted'));}
function renderHandoff(){const target=$('handoff-files');if(!target)return;target.replaceChildren();if(state.saved?.revision){target.append(button('Download saved source',()=>download('files/revision/'+state.saved.revision+'/source.json','RisingWave-Source.json')),button('Download saved merchant terms',()=>download('files/revision/'+state.saved.revision+'/merchant.json','RisingWave-Merchant.json')));}
  const capture=state.captures?.items.find(item=>item.state==='COMPLETE');$('transfer-command').textContent='starforge risingwave-workbench receive \\\n  --connection /private/workbench-launch.json \\\n  --capture '+(capture?.id??'CAPTURE_ID')+' \\\n  --directory /private/customer-edition';}
function buyerSelection() {
  return {publicationId:state.product?.id??null,runId:$('buyer-run').value,query:$('buyer-query').value};
}
function currentBuyerInput() {
  return {...buyerSelection(),intentId:$('buyer-intent').value,acceptIndex:Number($('buyer-option').value),
    offerSha256:state.offer?.offerSha256??null};
}
function invalidateOffer() {state.offerVersion++;state.offer=null;state.offerSelection=null;$('buyer-option').replaceChildren();$('buyer-result').replaceChildren();}
function rememberBuyerDraft() {
  if(!state.product||!$('buyer-intent'))return;
  state.buyerDrafts[state.product.id]={form:Object.fromEntries(['buyer-run','buyer-query','buyer-intent','buyer-option'].map(id=>[id,fieldValue($(id))])),
    offer:structuredClone(state.offer),offerSelection:structuredClone(state.offerSelection)};
}
function productContext() {
  if(!state.product)throw new Error('Open a data product first.');
  if(state.pendingProductId)throw new Error('Wait for the selected data product to open.');
  return {generation:state.productGeneration,id:state.product.id};
}
function sameProduct(context) {
  return !state.pendingProductId&&context.generation===state.productGeneration&&context.id===state.product?.id;
}
function beginProductSelection(id) {
  rememberBuyerDraft();
  const context={generation:++state.productGeneration,id};
  state.pendingProductId=id;state.productReadVersion++;state.offerVersion++;$('selected-product').inert=true;
  return context;
}
function finishProductSelection(context) {
  if(context.generation!==state.productGeneration)return;
  state.pendingProductId=null;$('selected-product').inert=false;
}
function adoptProduct(product,context) {
  if(context.generation!==state.productGeneration||context.id!==product.id)return false;
  rememberBuyerDraft();state.product=product;state.buyerOffset=product.buyerPage?.offset??0;
  state.offer=null;state.offerSelection=null;finishProductSelection(context);
  $('buyer-intent').value='risingwave-'+crypto.randomUUID();$('buyer-query').value='limit=10';$('buyer-run').value='';
  $('buyer-option').replaceChildren();$('buyer-result').replaceChildren();
  renderProduct();
  const retained=state.buyerDrafts[product.id];
  if(retained){
    state.offer=structuredClone(retained.offer);state.offerSelection=structuredClone(retained.offerSelection??null);
    if(state.offer)options($('buyer-option'),state.offer.accepts.map((choice,index)=>({value:String(index),label:index+' · '+choice.network+' · '+choice.amount})),'0');
    for(const[id,field]of Object.entries(retained.form))setField($(id),field);
    if(state.offer&&!same(state.offerSelection,buyerSelection()))invalidateOffer();
  }
  checkpoint();return true;
}
async function openProduct(id) {
  const context=beginProductSelection(id);
  try{adoptProduct(await api('publications/'+id),context);}
  finally{finishProductSelection(context);}
}
function renderProducts() {
  $('products-list').replaceChildren(...(state.saved?.publications??[]).map(item=>{
    const card=el('article',undefined,'capture-card');
    card.append(el('h3',item.query),el('p',item.path),button('Open product',()=>openProduct(item.id)));return card;
  }));
}
async function refreshProducts() {
  const latest=await api('state');
  if(latest.revision>=Math.max(state.saved?.revision??0,state.remoteSaved?.revision??0)){
    state.remoteSaved=latest;
    if(currentHasChanges())state.saved={...state.saved,publications:latest.publications,history:latest.history};
    else if(latest.revision!==state.saved?.revision)install(latest);
    else state.saved=latest;
    renderProducts();status();
  }
  if(state.product&&!state.pendingProductId)await refreshProduct();
}
async function refreshProduct(context=productContext()) {
  if(!sameProduct(context))return;
  const offset=state.buyerOffset,version=++state.productReadVersion;
  const product=await api('publications/'+context.id+'?buyerOffset='+offset);
  if(sameProduct(context)&&version===state.productReadVersion&&offset===state.buyerOffset){state.product=product;renderProduct();}
  return product;
}
function renderProduct(){const product=state.product;if(!product)return;$('selected-product').hidden=false;$('product-title').textContent=product.query;$('publisher-link').href=product.consoleUrl;
  facts($('product-facts'),[['Resource',product.merchant.publicOrigin+product.path],['Saved source revision',product.revision],['Seller',product.seller?.origin??'Stopped'],['Scheduler',product.schedule?.enabled?'Enabled':'Paused'],['Product',product.id]]);
  const runs=product.status.runs??[];$('product-runs').replaceChildren(grid(['Run','State','Action'],runs.map(item=>[item.id,item.state,button('Inspect',async()=>{const context=productContext();const result=await api('publications/'+product.id+'/run?runId='+encodeURIComponent(item.id));if(sameProduct(context)&&context.id===product.id)$('product-runs').append(details(result,'Run '+item.id));})])));
  const retainedRun=fieldValue($('buyer-run'));options($('buyer-run'),[{value:'',label:'Choose a published edition'},...runs.filter(item=>['PUBLISHED','READY'].includes(item.state)).map(item=>({value:item.id,label:item.id+' · '+item.state}))],retainedRun.value);setField($('buyer-run'),retainedRun);
  $('buyer-history').replaceChildren(grid(['Prepared','Intent','Published edition','Original request'],(product.buyers??[]).map(item=>[
    item.createdAt,item.intentId,item.snapshot,button('Download customer request',()=>download('files/buyer/'+product.id+'/'+item.id,'RisingWave-Dataset-Buyer-'+item.id+'.json'))])));
  const page=product.buyerPage??{offset:0,total:product.buyers?.length??0,nextOffset:null};
  $('buyers-page').textContent=page.total?(page.offset+1)+'–'+(page.offset+(product.buyers?.length??0))+' of '+page.total:'No customer requests';
  $('buyers-prev').disabled=!page.offset;$('buyers-next').disabled=page.nextOffset===null;
}
on('reload',()=>workspaceTransition(async()=>{await flushRecovery();recovery.id=browserId();recovery.version=0;recovery.pending=null;recovery.lastSaved=null;const latest=await api('state');install(latest);state.remoteSaved=latest;notice('Opened the latest saved source. The previous complete draft remains in Transfer.');}));

on('save-source',saveSource);
on('add-payment',()=>{state.payments.push({scheme:'exact',network:'',asset:'',amount:'',payTo:'',maxTimeoutSeconds:60});renderPayments();markDirty();});
on('apply-payments',()=>{state.payments=json($('payment-json').value,'array');state.rawEditors.payments=false;renderPayments();markDirty();});
on('apply-source-json',()=>{const source=json($('source-json').value);if(!source.queries||typeof source.queries!=='object'||Array.isArray(source.queries))throw new Error('The source declaration needs its named queries object.');state.source=source;state.rawEditors.source=false;sourceFields(state.source,currentMerchant());refreshReportOptions('');loadReport('');markDirty();});
for(const id of ['connection-env','tls','ca-env','query-timeout','max-inflight','allow-local','merchant-origin','merchant-service','merchant-description'])$(id).addEventListener('input',markDirty);
for(const id of ['report-name','report-description','relation-schema','relation-name','subscription-schema','subscription-name','report-key','report-max-rows','report-max-bytes'])$(id).addEventListener('input',markReportDirty);
on('discover',async()=>{const result=await api('catalogue',{expectedRevision:requireSaved(),...($('discovery-schemas').value.trim()?{schemas:split($('discovery-schemas').value)}:{})});state.catalogue=result.catalogue;renderCatalogue();notice('Read the native relation and subscription catalogue.');});
$('report-select').addEventListener('change',()=>{if(state.reportDirty){$('report-select').value=state.selectedReport;notice('Save or discard this report draft before selecting another report.',true);return;}loadReport($('report-select').value);});
on('new-report',()=>{if(state.reportDirty)throw new Error('Save or discard this report draft first.');$('report-select').value='';loadReport('');});
on('discard-report',()=>{loadReport(state.selectedReport);notice('Reloaded this report from the current source draft.');});
on('remove-report',()=>{const name=$('report-select').value;if(!name)throw new Error('Select a report to remove from the draft.');delete state.source.queries[name];state.selectedReport='';state.reportDirty=false;refreshReportOptions('');loadReport('');markDirty();});
on('add-column',()=>{state.columns.push({alias:'',column:'',type:'string',nullable:true});renderColumns();markReportDirty();});
on('add-parameter',()=>{state.parameters.push({name:'',type:'string',required:true,nullable:false,array:false,probeIncluded:true,probe:'',probeNull:false,original:{}});renderParameters();markReportDirty();});
on('add-filter',()=>{state.filters.push({column:'',op:'eq',parameter:''});renderFilters();markReportDirty();});
on('compile-report',async()=>{const result=await api('report/compile',{report:reportSpec()});$('compiled-report').replaceChildren(details(result,'Complete report declaration'));$('compiled-report').firstChild.open=true;notice('Compiled the report declaration.');});
on('save-report',async()=>{state.reportDirty=true;await saveSource();});
on('preview-report',async()=>{const query=$('report-select').value;const result=await api('sample',{expectedRevision:requireSaved(),query,input:parameterInput('preview-parameters',query)});rowsView($('preview-result'),result);notice('Read the saved report preview.');});
$('capture-query').addEventListener('change',()=>{renderParameterInputs('capture-parameters',$('capture-query').value);captureOptions();});
$('capture-mode').addEventListener('change',captureOptions);
on('capture-report',startCapture);on('refresh-captures',refreshCaptures);
on('captures-prev',async()=>{state.offset=Math.max(0,state.offset-20);await refreshCaptures();});
on('captures-next',async()=>{if(state.captures?.nextOffset!==null){state.offset=state.captures.nextOffset;await refreshCaptures();}});
on('compare-captures',async()=>{const input={before:$('compare-before').value,after:$('compare-after').value,sampleLimit:requiredInteger('compare-limit'),...($('compare-keys').value.trim()?{keys:split($('compare-keys').value)}:{})};
  state.comparisonRequests??=new Map();const key=pretty(input);let request=state.comparisonRequests.get(key);
  if(!request){request={...input,comparisonId:'comparison-'+Date.now()+'-'+crypto.randomUUID()};state.comparisonRequests.set(key,request);}
  $('comparison-result').replaceChildren(el('p','Original comparison: '+request.comparisonId));
  renderComparison(await api('captures/compare',request));state.comparisonOffset=0;await refreshComparisons();notice('Retained every difference using the selected unique key.');});
on('refresh-comparisons',refreshComparisons);
on('comparisons-prev',async()=>{state.comparisonOffset=Math.max(0,(state.comparisonOffset??0)-20);await refreshComparisons();});
on('comparisons-next',async()=>{if(state.comparisons?.nextOffset!==null){state.comparisonOffset=state.comparisons.nextOffset;await refreshComparisons();}});

on('inspect-subscription',async()=>{const result=await api('subscription/inspect',{expectedRevision:requireSaved(),query:$('subscription-query').value});$('subscription-inspection').replaceChildren(details(result,result.exists?'Existing subscription':'Subscription inspection'));$('subscription-inspection').firstChild.open=true;notice(result.exists?'Read the existing native subscription.':'The selected subscription is not present.');});
on('prepare-subscription',async()=>{const input={expectedRevision:requireSaved(),query:$('subscription-query').value,retention:$('subscription-retention').value.trim()},key=pretty(input);let request=state.subscriptionRequests.get(key);if(!request){request={...input,requestId:'subscription-'+Date.now()+'-'+crypto.randomUUID()};state.subscriptionRequests.set(key,request);}notice('Preparing original subscription request '+request.requestId+'.');showSubscriptionReview(await api('subscription/prepare',request));await refreshSubscriptions();notice('Saved the exact subscription creation review.');});
on('create-subscription',async()=>{const selected=state.subscriptionReview;if(!selected)throw new Error('Open a saved creation review first.');const result=await api('subscription/create',{expectedRevision:selected.revision,requestId:selected.requestId,reviewHash:selected.review.reviewHash});showSubscriptionReview(result);await refreshSubscriptions();notice('Original subscription operation: '+result.result.status+'.');});
on('refresh-subscriptions',refreshSubscriptions);
on('create-product',async()=>{
  const input={expectedRevision:requireSaved(),query:$('product-query').value,path:$('product-path').value.trim()},key=pretty(input);
  let request=state.productRequests.get(key);
  if(!request){
    const existing=state.saved.publications.find(item=>item.revision===input.expectedRevision&&item.query===input.query&&item.path===input.path);
    request={...input,publicationId:existing?.id??'publication-'+Date.now()+'-'+crypto.randomUUID()};state.productRequests.set(key,request);
  }
  const context=beginProductSelection(request.publicationId);
  try{const product=await api('publications',request);adoptProduct(product,context);await refreshProducts();
    if(sameProduct(context))notice('Opened the original dataset publication.');}
  finally{finishProductSelection(context);}
});
on('refresh-products',refreshProducts);
for(const action of ['start','stop'])on(action+'-seller',async()=>{
  const context=productContext();await api('publications/'+context.id+'/seller/'+action,{});
  if(sameProduct(context))await refreshProduct(context);
});
on('read-offer',async()=>{
  const context=productContext(),selection=buyerSelection(),version=++state.offerVersion;
  const offer=await api('publications/'+context.id+'/buyer?runId='+encodeURIComponent(selection.runId)+'&query='+encodeURIComponent(selection.query));
  if(!sameProduct(context)||version!==state.offerVersion||!same(selection,buyerSelection()))return;
  state.offer=offer;state.offerSelection=selection;
  options($('buyer-option'),offer.accepts.map((choice,index)=>({value:String(index),label:index+' · '+choice.network+' · '+choice.amount})),'0');
  $('buyer-result').replaceChildren(details(offer,'Exact customer offer'));checkpoint();
});
on('prepare-buyer',async()=>{
  const context=productContext();
  if(!state.offer||!same(state.offerSelection,buyerSelection()))throw new Error('Read the exact buyer offer for this selected edition and query first.');
  const submitted=currentBuyerInput();
  const selected=originalRequest(state,'buyerRequests',submitted,'buyerId','buyer');
  const {publicationId,...request}=selected,result=await api('publications/'+publicationId+'/buyer',request);
  if(!sameProduct(context)||!same(submitted,currentBuyerInput()))return;
  await refreshProduct(context);
  if(!sameProduct(context)||!same(submitted,currentBuyerInput()))return;
  $('buyer-result').replaceChildren(details(result,'Prepared customer request'),
    button('Download customer request',()=>download('files/buyer/'+publicationId+'/'+result.id,'RisingWave-Dataset-Buyer-'+result.id+'.json')));
});
for(const id of ['buyer-run','buyer-query'])$(id).addEventListener('input',invalidateOffer);
window.addEventListener('beforeunload',event=>{localCheckpoint();if(currentHasChanges()){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){localCheckpoint();void flushRecovery().catch(()=>{});}});
document.addEventListener('input',event=>{if(event.target.id==='source-json')state.rawEditors.source=true;if(event.target.id==='payment-json')state.rawEditors.payments=true;status();checkpoint();});
document.addEventListener('change',()=>{checkpoint();});
on('buyers-prev',async()=>{state.buyerOffset=Math.max(0,state.buyerOffset-20);await refreshProduct();});
on('buyers-next',async()=>{const next=state.product?.buyerPage?.nextOffset;if(next!==null&&next!==undefined){state.buyerOffset=next;await refreshProduct();}});
on('reconcile-source',prepareReconciliation);
on('recovery-save',async()=>{await flushRecovery();await refreshRecoveryList();notice('Saved the complete browser workspace with this workbench.');});
on('recovery-refresh',refreshRecoveryList);
on('recovery-open',()=>openRecovery($('recovery-select').value));
on('recovery-export',()=>{localCheckpoint();downloadObject(browserSnapshot(),'RisingWave-Browser-Workspace-'+recovery.id+'.json');});
on('recovery-import',()=>workspaceTransition(async()=>{
  const selected=$('recovery-file').files?.[0];if(!selected)throw new Error('Choose a complete browser workspace JSON file.');
  const value=validateBrowserState(JSON.parse(await selected.text()),state.saved.workspaceIdentity);
  await flushRecovery();const latest=await api('state');recovery.ready=false;
  try{await installBrowserSnapshot(value,latest);recovery.id=browserId();recovery.version=0;recovery.pending=null;recovery.lastSaved=null;}
  finally{recovery.ready=true;}
  await flushRecovery();await refreshRecoveryList();notice('Imported the complete browser workspace and its original operation selections.');
}));

let polling=false;setInterval(()=>{if(polling||document.hidden||$('captures').hidden||!state.captures?.items.some(item=>item.state==='CAPTURING'))return;polling=true;void run(refreshCaptures).finally(()=>{polling=false;});},3000);
await run(()=>workspaceTransition(async()=>{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Open the complete private URL printed by the workbench launcher.');await initializeRecovery(await requestApi('state'));if(state.reconcileRequested)await prepareReconciliation();notice('Opened the original workbench and retained browser workspace.');}));
