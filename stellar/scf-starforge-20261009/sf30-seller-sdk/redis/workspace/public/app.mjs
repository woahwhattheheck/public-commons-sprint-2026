// MIT. Redis product editing and retained native operations.
import { createDraftStore } from '/local-draft-store.mjs';
const $=id=>document.getElementById(id),copy=value=>structuredClone(value),pretty=value=>JSON.stringify(value,null,2);
const names={get:'Value',hash:'Hash fields','sorted-set':'Sorted set',stream:'Stream'};
const tokenKey='redis-workspace-token:'+location.origin;
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){
  try{sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname);}catch{}
}else{try{token=sessionStorage.getItem(tokenKey)??'';}catch{token='';}}
let state,draft,storage,pending=null,selectedQuery='',selectedRoute=-1,tab='products',busy=false,preview=null,previewRevision=null;
let revisionRows=[],operationRows=[],revisionCursor=null,operationCursor=null,dirtyForm=false,planDirty=false;
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function errorOf(value){return Object.assign(new Error(value?.message??value?.error?.message??value?.error??'Workspace operation failed.'),{code:value?.code??value?.error?.code,status:value?.status});}
async function request(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'x-workspace-token':token,...(input===undefined?{}:{'content-type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)}),cache:'no-store'});
  const value=await response.json();
  if(!response.ok&&!(value?.id&&value?.status))throw Object.assign(errorOf(value),{httpStatus:response.status});
  return value;
}
function parse(id,label,shape='object'){
  let value;try{value=JSON.parse($(id).value);}catch{throw new Error('Correct the JSON for '+label+'.');}
  if(shape==='object'&&(!value||typeof value!=='object'||Array.isArray(value))||shape==='array'&&!Array.isArray(value))
    throw new Error(label+' must be a JSON '+shape+'.');
  return value;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function changed(){return !same({queries:draft.queries,plan:draft.plan},{queries:state.current.source.queries,plan:state.current.plan})||dirtyForm;}
function newDraft(revision=state.current){return {workspaceId:state.workspace.id,baseHead:state.workspace.head,queries:copy(revision.source.queries),plan:copy(revision.plan),note:''};}
async function retain(){
  draft.note=$('revision-note').value;
  await storage.writeDraft(draft);
  $('draft-status').textContent=(changed()?'Draft changes':'Saved configuration')+(draft.baseHead!==state.workspace.head?' · a newer version is current':'');
  $('revision-label').textContent='Current version '+state.workspace.head.slice(0,12)+' · '+Object.keys(draft.queries).length+' products · '+draft.plan.routes.length+' routes';
}
function button(label,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',()=>guard(action));return node;}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function showDetails(title,value){$('detail-title').textContent=title;$('detail-text').textContent=pretty(value);$('detail-dialog').showModal();}
function selectedItem(list,label,detail,selected,action){
  const node=button(label,action);node.setAttribute('aria-pressed',String(selected));node.append(el('small',detail));list.append(node);
}
function queryForm(){
  const query=draft.queries[selectedQuery];if(!query)return;
  $('query-name').value=selectedQuery;$('query-kind').value=query.kind;
  $('key-mode').value=typeof query.key==='string'?'fixed':'parameter';$('query-key').value=typeof query.key==='string'?query.key:'';
  $('key-prefix').value=typeof query.key==='object'?query.key.prefix:'';$('key-parameter').value=typeof query.key==='object'?query.key.parameter:'';
  $('query-parameters').value=pretty(query.parameters??{});$('query-fields').value=pretty(query.fields??{});
  $('query-columns').value=pretty(query.columns??(query.kind==='get'?['value']:['member','score']));
  $('query-rows').value=query.maxRows??(['get','hash'].includes(query.kind)?1:100);
  $('query-bytes').value=query.maxBytes??524288;$('query-timeout').value=query.timeoutMs??1500;
  $('query-offset').value=query.offset??'';$('query-after').value=query.after??'';queryVisibility();
}
function queryVisibility(){
  const kind=$('query-kind').value,parameter=$('key-mode').value==='parameter',fields=['hash','stream'].includes(kind);
  $('fixed-key-label').hidden=parameter;$('key-prefix-label').hidden=!parameter;$('key-parameter-label').hidden=!parameter;
  $('fields-label').hidden=!fields;$('columns-label').hidden=fields;$('offset-label').hidden=kind!=='sorted-set';$('after-label').hidden=kind!=='stream';
  if(['get','hash'].includes(kind))$('query-rows').value='1';
  $('query-rows').readOnly=['get','hash'].includes(kind);
}
function applyQuery(){
  if(!selectedQuery||!dirtyForm)return;
  const name=$('query-name').value.trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))throw new Error('Use a product name beginning with a letter or underscore, followed by up to 63 letters, numbers or underscores.');
  if(name!==selectedQuery&&Object.hasOwn(draft.queries,name))throw new Error('That product name is already used.');
  const kind=$('query-kind').value,query={kind,key:$('key-mode').value==='fixed'?$('query-key').value:{prefix:$('key-prefix').value,parameter:$('key-parameter').value},
    parameters:parse('query-parameters','parameters'),maxRows:Number($('query-rows').value),maxBytes:Number($('query-bytes').value),timeoutMs:Number($('query-timeout').value)};
  if(['hash','stream'].includes(kind))query.fields=parse('query-fields','projected fields');
  else query.columns=parse('query-columns','output columns','array');
  if(kind==='sorted-set'&&$('query-offset').value)query.offset=$('query-offset').value;
  if(kind==='stream'&&$('query-after').value)query.after=$('query-after').value;
  if(name!==selectedQuery){
    draft.queries=Object.fromEntries(Object.entries(draft.queries).map(([key,value])=>[key===selectedQuery?name:key,key===selectedQuery?query:value]));
    for(const route of draft.plan.routes)if(route.query===selectedQuery)route.query=name;
  }else draft.queries[name]=query;
  selectedQuery=name;
}
function productList(){
  const list=$('query-list');list.replaceChildren();
  if(!Object.hasOwn(draft.queries,selectedQuery))selectedQuery=Object.keys(draft.queries)[0];
  for(const [name,query]of Object.entries(draft.queries))selectedItem(list,name,names[query.kind]??query.kind,name===selectedQuery,async()=>{
    applyQuery();dirtyForm=false;await retain();selectedQuery=name;productList();queryForm();
  });
}
function termsForm(){
  planDirty=false;
  $('public-origin').value=draft.plan.publicOrigin;$('single-payment').hidden=!draft.plan.payment;
  if(draft.plan.payment){const payment=draft.plan.payment;$('payment-network').value=payment.network;$('payment-asset').value=payment.asset;
    $('payment-recipient').value=payment.payTo;$('payment-amount').value=payment.amount;$('payment-timeout').value=payment.maxTimeoutSeconds??60;}
  routeList();$('plan-editor').value=pretty(draft.plan);
}
function applyTerms(){
  draft.plan.publicOrigin=$('public-origin').value;
  if(draft.plan.payment)draft.plan.payment={...draft.plan.payment,network:$('payment-network').value,asset:$('payment-asset').value,
    payTo:$('payment-recipient').value,amount:$('payment-amount').value,maxTimeoutSeconds:Number($('payment-timeout').value)};
}
function applyRoute(){
  if(selectedRoute<0)return;
  const route=parse('route-editor','route definition');draft.plan.routes[selectedRoute]=route;
}
function routeList(){
  const list=$('route-list');list.replaceChildren();
  if(selectedRoute<0||selectedRoute>=draft.plan.routes.length)selectedRoute=draft.plan.routes.length?0:-1;
  draft.plan.routes.forEach((route,index)=>selectedItem(list,route.id??'Unnamed route',(route.method??'GET')+' '+(route.path??''),index===selectedRoute,async()=>{
    applyTerms();applyRoute();dirtyForm=false;await retain();selectedRoute=index;routeList();
  }));
  $('route-editor').value=selectedRoute<0?'{}':pretty(draft.plan.routes[selectedRoute]);
  $('apply-route').disabled=selectedRoute<0;$('remove-route').disabled=selectedRoute<0;
}
async function flush(){
  if(tab==='products')applyQuery();
  if(tab==='terms'){
    if(planDirty){const plan=parse('plan-editor','merchant plan');if(!Array.isArray(plan.routes))throw new Error('The merchant plan needs a routes array.');draft.plan=plan;selectedRoute=-1;termsForm();}
    else if(dirtyForm){applyTerms();applyRoute();}
  }
  dirtyForm=false;await retain();
}
function updatePending(){
  $('workspace').inert=busy;
  document.querySelectorAll('#panel-products,#panel-terms,.draft-bar,.note-field').forEach(node=>{node.inert=Boolean(pending);});
  $('pending-panel').hidden=!pending;
  if(pending)$('pending-message').textContent=pending.action+' · '+pending.input.requestId+' · '+(pending.observedStatus??'Outcome awaiting retrieval');
  document.querySelectorAll('#save,#run-preview,#prepare,#stage').forEach(node=>{node.disabled=busy||Boolean(pending);});
}
async function loadState({resetDraft=false}={}){
  state=await request('/api/state');
  if(!storage)storage=createDraftStore(state.workspace.id);
  revisionRows=state.revisions.items;operationRows=state.operations.items;revisionCursor=state.revisions.nextCursor;operationCursor=state.operations.nextCursor;
  if(resetDraft||!draft){draft=resetDraft?newDraft():await storage.readDraft()??newDraft();pending=await storage.readPending();}
  if(draft.workspaceId!==state.workspace.id)throw new Error('The local draft belongs to another workspace.');
  $('workspace-title').textContent=state.workspace.label;
  const connection=state.connection,rest=connection.transport==='upstash-rest';
  $('transport').textContent=rest?'Upstash HTTPS':'Redis / Valkey';
  $('connection').textContent=rest?connection.endpoint:connection.host+':'+(connection.port??6379)+' · database '+(connection.database??0)+' · '+(connection.tls??'verify-full');
  $('credential').textContent=connection.tokenEnv||connection.passwordEnv?'Credential: '+(connection.tokenEnv??connection.passwordEnv):'Host connection';
  $('revision-note').value=draft.note??'';
  productList();queryForm();termsForm();renderVersions();renderOperations();await previewVersions();
  $('workspace').hidden=false;updatePending();await retain();
}
async function perform(action,input){
  if(pending)throw new Error('Retrieve the saved request outcome before starting another operation.');
  const saved={workspaceId:state.workspace.id,action,input:{...copy(input),requestId:crypto.randomUUID()},createdAt:new Date().toISOString()};
  await storage.writePending(saved);pending=saved;updatePending();
  return finish(await sendPending());
}
async function sendPending(){
  const saved=pending;
  try{return await request('/api/'+saved.action,saved.input);}
  catch(error){
    if(error.httpStatus>=400&&error.httpStatus<500){
      let outcome,unrecorded=false;
      try{outcome=await request('/api/operation?id='+encodeURIComponent(saved.input.requestId));}
      catch(inspectError){unrecorded=inspectError.httpStatus===404;}
      if(outcome)return outcome;
      if(unrecorded){await storage.deletePending();pending=null;updatePending();}
    }
    throw error;
  }
}
async function finish(result){
  if(!result?.id||!['COMPLETED','FAILED','INTERRUPTED','RUNNING'].includes(result.status))throw new Error('The server did not return a retained operation.');
  if(['COMPLETED','FAILED'].includes(result.status)){
    const kind=result.kind;await storage.deletePending();pending=null;updatePending();
    if(result.status==='FAILED'){await loadState();throw errorOf(result.error);}
    if(kind==='save')await loadState({resetDraft:true});else await loadState();
    if(kind==='preview')await showPreview(result);
    if(kind==='stage')status('Release '+result.result.releaseId+' is staged. Open Release controls to select and run it.');
    else status(kind==='save'?'Revision saved.':kind==='prepare'?'Merchant package and customer files are ready.':kind==='preview'?'Live source preview completed.':kind+' completed.');
  }else if(pending){
    pending.observedStatus=result.status;await storage.writePending(pending);updatePending();
    status(result.status==='RUNNING'?'The saved operation is still running. Refresh its outcome.':'The prior process ended. Continue this saved request to recover its outcome.');
  }
  return result;
}
async function inspectPending(continueRequest=false){
  if(!pending)return;
  let result;
  try{result=await request('/api/operation?id='+encodeURIComponent(pending.input.requestId));}
  catch(error){
    if(error.httpStatus!==404)throw error;
    if(!continueRequest){pending.observedStatus='Ready to send';await storage.writePending(pending);updatePending();return;}
    result=await sendPending();
  }
  if(continueRequest&&result.status==='INTERRUPTED')result=await request('/api/resume',{requestId:pending.input.requestId});
  return finish(result);
}
async function previewVersions(){
  const selected=$('preview-version').value;
  const choices=[...revisionRows];
  if(previewRevision?.id===selected&&!choices.some(row=>row.id===selected))choices.push(previewRevision);
  $('preview-version').replaceChildren(...choices.map(revisionOption));
  $('preview-version').value=choices.some(row=>row.id===selected)?selected:state.workspace.head;
  await selectPreviewRevision();
}
function revisionOption(revision){
  const option=el('option',revision.id.slice(0,12)+' · '+revision.note);option.value=revision.id;return option;
}
async function selectPreviewRevision(){
  const selected=$('preview-version').value;if(!selected)return;
  const revision=selected===state.current.id?state.current:await request('/api/revision?id='+encodeURIComponent(selected));
  if($('preview-version').value!==selected)return;
  previewRevision=revision;const previous=$('preview-query').value;
  $('preview-query').replaceChildren(...Object.keys(revision.source.queries).map(name=>{const option=el('option',name);option.value=name;return option;}));
  if(Object.hasOwn(revision.source.queries,previous))$('preview-query').value=previous;
  resetPreviewInput();
}
function resetPreviewInput(){
  preview=null;$('preview-result').hidden=true;
  const route=previewRevision?.plan.routes.find(route=>route.query===$('preview-query').value);
  $('preview-input').value=pretty(route?.example??{});
}
async function showPreview(operation){
  const result=operation.result,data=result.data;
  if(![...$('preview-version').options].some(option=>option.value===result.revisionId))
    $('preview-version').append(revisionOption(await request('/api/revision?id='+encodeURIComponent(result.revisionId))));
  $('preview-version').value=result.revisionId;
  if(previewRevision?.id!==result.revisionId)await selectPreviewRevision();
  preview=operation;$('preview-query').value=result.query;$('preview-input').value=pretty(result.input);
  $('preview-summary').textContent=data.rowCount+' rows · '+result.query+' · '+result.observedAt+(data.truncated?' · more data available':'');
  const table=el('table'),head=el('thead'),row=el('tr');for(const name of data.columns)row.append(el('th',name));head.append(row);table.append(head);
  const body=el('tbody');for(const item of data.rows){const line=el('tr');for(const name of data.columns){const value=item[name];line.append(el('td',value===null?'null':typeof value==='object'?JSON.stringify(value):String(value)));}body.append(line);}table.append(body);
  $('preview-table').replaceChildren(table);$('preview-json').textContent=pretty(result);$('preview-result').hidden=false;$('next-preview').hidden=!data.nextInput;
}
function download(name,value,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadFile(packageId,name){
  const response=await fetch('/api/customer-file?package='+encodeURIComponent(packageId)+'&name='+encodeURIComponent(name),{headers:{'x-workspace-token':token},cache:'no-store'});
  if(!response.ok)throw errorOf(await response.json());download(name.split('/').at(-1),await response.blob());
}
function table(headers,rows){
  const result=el('table'),head=el('thead'),line=el('tr');headers.forEach(name=>line.append(el('th',name)));head.append(line);result.append(head);
  const body=el('tbody');rows.forEach(cells=>{const row=el('tr');cells.forEach(value=>{const cell=el('td');if(value instanceof Node)cell.append(value);else cell.textContent=String(value??'');row.append(cell);});body.append(row);});result.append(body);return result;
}
function renderVersions(){
  $('version-list').replaceChildren(table(['Version','Saved','Products / routes','Note','Actions'],revisionRows.map(revision=>{
    const actions=el('div',undefined,'actions');actions.append(button('Load draft',async()=>{
      if(pending)throw new Error('Retrieve the saved request outcome before replacing the draft.');
      await flush();const full=await request('/api/revision?id='+encodeURIComponent(revision.id));draft=newDraft(full);draft.note='Based on version '+revision.id.slice(0,12);
      dirtyForm=false;await loadState();status('Selected version loaded into the local draft.');
    }),button('Restore',async()=>{await flush();return perform('restore',{expectedHead:state.workspace.head,revisionId:revision.id,note:'Restored version '+revision.id.slice(0,12)});}));
    return [revision.id.slice(0,12)+(revision.id===state.workspace.head?' · current':''),revision.createdAt,revision.queryNames.length+' / '+revision.routes,revision.note,actions];
  })));$('older-versions').hidden=!revisionCursor;
}
function renderOperations(){
  const packages=operationRows.filter(row=>row.kind==='prepare'&&row.status==='COMPLETED'&&row.package);
  const list=$('package-list');list.replaceChildren();
  for(const row of packages){
    const box=el('article',undefined,'package'),files=el('div',undefined,'file-list');
    box.append(el('h3',row.id),el('p','Version '+row.revisionId.slice(0,12)+' · '+row.createdAt,'muted'));
    for(const name of Object.keys(row.package.files??{}).filter(name=>name==='openapi.json'||name.startsWith('client/')))files.append(button(name,()=>downloadFile(row.id,name)));
    box.append(files);list.append(box);
  }
  if(!packages.length)list.append(el('p','No packages are shown yet. Prepare a saved version to create its customer files.','muted'));
  const selected=$('stage-package').value;
  $('stage-package').replaceChildren(...packages.map(row=>{const option=el('option',row.id+' · '+row.revisionId.slice(0,12));option.value=row.id;return option;}));
  if(packages.some(row=>row.id===selected))$('stage-package').value=selected;
  $('older-packages').hidden=!operationCursor;$('older-activity').hidden=!operationCursor;
  $('activity-list').replaceChildren(table(['Operation','Status','Created','Version','Actions'],operationRows.map(row=>{
    const actions=el('div',undefined,'actions');actions.append(button('Details',async()=>{
      const full=await request('/api/operation?id='+encodeURIComponent(row.id));showDetails(row.kind+' · '+row.id,full);
    }));
    if(row.resumable)actions.append(button('Resume',async()=>{
      if(pending&&pending.input.requestId!==row.id)throw new Error('Retrieve the current saved request first.');
      const full=await request('/api/operation?id='+encodeURIComponent(row.id));
      if(!pending){pending={workspaceId:state.workspace.id,action:full.kind,input:full.input};await storage.writePending(pending);}
      return finish(await request('/api/resume',{requestId:row.id}));
    }));
    return [row.kind,row.status,row.createdAt,row.revisionId?.slice(0,12)??'',actions];
  })));
}
async function older(tableName){
  const cursor=tableName==='revisions'?revisionCursor:operationCursor;if(!cursor)return;
  const page=await request('/api/'+tableName+'?after='+encodeURIComponent(cursor));
  if(tableName==='revisions'){revisionRows.push(...page.items);revisionCursor=page.nextCursor;renderVersions();await previewVersions();}
  else{operationRows.push(...page.items);operationCursor=page.nextCursor;renderOperations();}
}
async function guard(action){
  if(busy)return;busy=true;updatePending();status('Working…');
  try{await action();}catch(error){status(error.message,true);}finally{busy=false;updatePending();if($('status').textContent==='Working…')status('Workspace ready.');}
}
function on(id,action){$(id).addEventListener('click',()=>guard(action));}
document.querySelectorAll('[data-tab]').forEach(node=>node.addEventListener('click',()=>guard(async()=>{
  await flush();tab=node.dataset.tab;document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-current',button===node?'page':'false'));
  document.querySelectorAll('.tab').forEach(panel=>{panel.hidden=panel.id!=='panel-'+tab;});productList();queryForm();termsForm();
})));
$('query-form').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{applyQuery();dirtyForm=false;await retain();productList();termsForm();status('Product applied to draft. Review and save the complete revision.');});});
$('query-kind').addEventListener('change',()=>{const kind=$('query-kind').value;if(kind==='get')$('query-columns').value=pretty(['value']);if(kind==='sorted-set')$('query-columns').value=pretty(['member','score']);queryVisibility();dirtyForm=true;});
$('key-mode').addEventListener('change',()=>{queryVisibility();dirtyForm=true;});
$('plan-editor').addEventListener('input',()=>{planDirty=true;dirtyForm=true;$('draft-status').textContent='Draft changes';});
document.querySelectorAll('#query-form input,#query-form textarea,#panel-terms input,#route-editor').forEach(node=>node.addEventListener('input',()=>{dirtyForm=true;$('draft-status').textContent='Draft changes';}));
$('revision-note').addEventListener('change',()=>guard(retain));
on('add-query',async()=>{await flush();let n=1;while(Object.hasOwn(draft.queries,'product_'+n))n++;selectedQuery='product_'+n;
  draft.queries[selectedQuery]={kind:'get',key:'merchant:'+selectedQuery,parameters:{},columns:['value'],maxRows:1,maxBytes:16384,timeoutMs:1500};await retain();productList();queryForm();});
on('remove-query',async()=>{if(Object.keys(draft.queries).length===1)throw new Error('Keep at least one product.');
  const removed=selectedQuery;delete draft.queries[removed];draft.plan.routes=draft.plan.routes.filter(route=>route.query!==removed);selectedQuery='';dirtyForm=false;await retain();productList();queryForm();termsForm();});
on('apply-route',async()=>{applyTerms();applyRoute();dirtyForm=false;await retain();termsForm();status('Route applied to draft.');});
on('add-route',async()=>{await flush();const query=Object.keys(draft.queries)[0];let n=1;while(draft.plan.routes.some(route=>route.id==='route_'+n))n++;
  selectedRoute=draft.plan.routes.length;draft.plan.routes.push({id:'route_'+n,query,path:'/data/'+n,method:'GET',serviceName:'redis-data',description:'Read '+query,example:{},parameterDescriptions:Object.fromEntries(Object.keys(draft.queries[query].parameters??{}).map(key=>[key,'Describe '+key]))});
  await retain();termsForm();});
on('remove-route',async()=>{if(selectedRoute<0)return;applyTerms();draft.plan.routes.splice(selectedRoute,1);selectedRoute=-1;dirtyForm=false;await retain();termsForm();});
on('apply-plan',async()=>{const plan=parse('plan-editor','merchant plan');if(!Array.isArray(plan.routes))throw new Error('The merchant plan needs a routes array.');draft.plan=plan;selectedRoute=-1;dirtyForm=false;await retain();termsForm();});
on('use-current',async()=>{draft=newDraft();dirtyForm=false;await loadState();status('Current saved version loaded into the draft.');});
on('download-draft',async()=>{await flush();download('redis-merchant-draft.json',{schema:'stellar-forge.redis-authoring-draft.v1',queries:draft.queries,plan:draft.plan,note:draft.note});});
$('import-draft').addEventListener('change',()=>guard(async()=>{
  const file=$('import-draft').files[0];if(!file)return;if(file.size>524288)throw new Error('Use a draft file within 512 KiB.');
  const value=JSON.parse(await file.text());if(value.schema!=='stellar-forge.redis-authoring-draft.v1')throw new Error('Choose a Redis merchant draft export.');
  await request('/api/review',{queries:value.queries,plan:value.plan});draft={...newDraft(),queries:value.queries,plan:value.plan,note:typeof value.note==='string'?value.note:''};dirtyForm=false;await loadState();$('import-draft').value='';status('Draft imported. Review and save it as a new version.');
}));
on('review',async()=>{await flush();showDetails('Draft review',await request('/api/review',{queries:draft.queries,plan:draft.plan}));status('Draft compiled successfully.');});
on('save',async()=>{await flush();return perform('save',{expectedHead:draft.baseHead,queries:draft.queries,plan:draft.plan,note:draft.note});});
on('refresh',async()=>{if(state)await flush();await loadState();if(pending)await inspectPending();else status('Saved work refreshed.');});
on('inspect-pending',()=>inspectPending());on('continue-pending',()=>inspectPending(true));
on('open-releases',async()=>{const result=await request('/api/release-console',{});const link=el('a','Open release controls ↗');link.href=result.operatorUrl;link.target='_blank';link.rel='noopener noreferrer';status('Release controls ready.');$('status').replaceChildren(link);});
$('preview-version').addEventListener('change',()=>guard(selectPreviewRevision));
$('preview-query').addEventListener('change',resetPreviewInput);
on('run-preview',async()=>{await flush();preview=null;$('preview-result').hidden=true;return perform('preview',{revisionId:$('preview-version').value,query:$('preview-query').value,input:parse('preview-input','preview input')});});
on('next-preview',async()=>{if(!preview?.result.data.nextInput)return;const result=preview.result;preview=null;$('preview-result').hidden=true;
  return perform('preview',{revisionId:result.revisionId,query:result.query,input:result.data.nextInput});});
on('download-preview',()=>{if(preview)download('redis-'+preview.result.query+'-'+preview.id+'.json',preview.result);});
on('prepare',async()=>{await flush();return perform('prepare',{revisionId:state.workspace.head});});
on('stage',async()=>{const runtime={port:Number($('stage-port').value)};if($('stage-facilitator').value)runtime.facilitator=$('stage-facilitator').value;
  if($('stage-local').checked)runtime.allowLocalFacilitator=true;return perform('stage',{packageId:$('stage-package').value,releaseId:$('stage-id').value,label:$('stage-label').value||$('stage-id').value,runtime});});
on('older-versions',()=>older('revisions'));on('older-activity',()=>older('operations'));on('older-packages',()=>older('operations'));
$('close-detail').addEventListener('click',()=>$('detail-dialog').close());
window.addEventListener('beforeunload',event=>{if(dirtyForm||planDirty){event.preventDefault();event.returnValue='';}});
guard(async()=>{await loadState();if(pending)await inspectPending();else status('Workspace ready.');});
