// MIT. Browser controls over the original retained WordPress workspace.
import { createPublisherPanel } from '/publisher.mjs';
const $=id=>document.getElementById(id),json=value=>JSON.stringify(value,null,2);
const readable=value=>value===null||value===undefined?'—':typeof value==='object'?json(value):String(value);
const short=value=>value?String(value).slice(0,14):'—';
const count=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-US'):'—';
const bytes=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-US')+' B':'—';
const token=document.querySelector('meta[name="workspace-token"]').content;
let state=null,busy=false,refreshing=false,section='source',currentJob=null,recordsPage=null,recordsOffset=0,comparePage=null,compareOffset=0;
let projectionPreview=null,pending=[],storageKey='',lastQuery=null,discovery=null;
function node(tag,value,className){const item=document.createElement(tag);if(value!==undefined)item.textContent=readable(value);if(className)item.className=className;return item;}
function facts(target,entries){const list=node('dl');for(const [label,value]of entries)list.append(node('dt',label),node('dd',value));$(target).replaceChildren(list);}
function options(target,entries,preferred,force=false){const control=$(target),old=control.value;control.replaceChildren();
  for(const [value,label]of entries){const option=node('option',label);option.value=value;control.append(option);}
  if(!entries.length){const option=node('option','No retained selection');option.value='';control.append(option);}
  control.value=force&&entries.some(row=>row[0]===preferred)?preferred:entries.some(row=>row[0]===old)?old:
    entries.some(row=>row[0]===preferred)?preferred:entries[0]?.[0]??'';
}
function button(label,callback,{primary=false,write=false}={}){const result=node('button',label,primary?'primary':undefined);result.type='button';
  if(write)result.dataset.write='';result.addEventListener('click',()=>handle(callback));return result;}
function detail(label,value){const result=node('details');result.append(node('summary',label),node('pre',json(value)));return result;}
function table(target,columns,rows){const area=$(target);area.replaceChildren();if(!rows.length){area.append(node('p','No retained records in this selection.','empty'));return;}
  const element=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
  for(const column of columns)header.append(node('th',column.label));head.append(header);
  for(const row of rows){const line=node('tr');for(const column of columns){const cell=node('td'),value=column.value(row);
      if(value instanceof Node)cell.append(value);else cell.append(node('div',value,'cell-long'));line.append(cell);}body.append(line);}
  element.append(head,body);area.append(element);
}
function showDetails(title,value){$('detail-title').textContent=title;$('detail-body').textContent=typeof value==='string'?value:json(value);$('detail-dialog').showModal();}
function notice(message,kind='info'){$('notice').textContent=message;$('notice').className='notice'+(kind==='error'?' error':'');$('notice').hidden=!message;}
function parse(target){try{return JSON.parse($(target).value);}catch(error){throw new Error('Correct the JSON in '+($(target).closest('label')?.firstChild.textContent.trim()||target)+': '+error.message);}}
const required=(value,message)=>{if(!value)throw new Error(message);return value;};
const pair=value=>{const [sourceId,id]=String(value??'').split('|');required(sourceId&&id,'Select the retained source job.');return{sourceId,id};};
const jobValue=row=>row.sourceId+'|'+row.id;
const selectedJob=()=>pair($('job-select').value);
function selectedCapture(){return pair($('projection-capture').value);}
function publisherState(){return {...state,exports:(state?.exports??[]).filter(row=>row.productId===state?.activeProductId),
  ...(lastQuery?{lastQuery:{initialQuery:lastQuery}}:{})};}
async function request(path,{method='GET',body,blob=false,text=false}={}){
  const response=await fetch(path,{method,headers:{'x-workspace-token':token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});
  if(!response.ok){let value;try{value=await response.json();}catch{value={error:{message:response.statusText}};}
    if(value.state){state=value.state;render();}
    const error=new Error(value.error?.message||'The original request failed.');error.code=value.error?.code;error.status=response.status;
    error.details=value.error?.details;throw error;
  }
  return blob?{blob:await response.blob(),headers:response.headers}:text?response.text():response.json();
}
const params=value=>new URLSearchParams(Object.entries(value).filter(([,item])=>item!==null&&item!==undefined&&item!=='')).toString();
function persistPending(){if(storageKey){sessionStorage.setItem(storageKey,JSON.stringify(pending));}renderPending();}
function renderPending(){const value=pending.at(-1);$('pending-operation').hidden=!value;if(!value)return;
  const original=state?.operations?.find(row=>row.id===value.operationId);
  $('pending-status').textContent=original?.status??'Awaiting saved result';
  $('pending-description').textContent=value.action+' · '+value.operationId;
  $('pending-details').textContent=json(value);
}
async function perform(action,input={},retained=null){
  required(state,'Open the original workspace.');
  const envelope=retained??{action,operationId:crypto.randomUUID(),expectedRevision:state.revision,input};
  if(!pending.some(row=>row.operationId===envelope.operationId)){pending.push(envelope);pending=pending.slice(-20);persistPending();}
  const result=await request('/api/act',{method:'POST',body:envelope});
  state=result.state;pending=pending.filter(row=>row.operationId!==envelope.operationId);persistPending();render();
  notice((result.reused?'Recovered original action: ':'Saved: ')+action+'.');
  return result.result;
}
async function refresh({silent=false}={}){
  if(refreshing)return;refreshing=true;
  try{
    const value=await request('/api/state');
    if(state&&value.id!==state.id){pending=[];currentJob=null;projectionPreview=null;lastQuery=null;}
    state=value;
    const nextKey='stellar-forge-wordpress:'+state.id;
    if(storageKey!==nextKey){storageKey=nextKey;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'[]');
      pending=Array.isArray(saved)?saved.filter(row=>typeof row.operationId==='string'&&typeof row.action==='string'):[];}catch{pending=[];}
      try{lastQuery=sessionStorage.getItem(storageKey+':query')||null;}catch{}}
    pending=pending.filter(row=>state.operations.find(item=>item.id===row.operationId)?.status!=='complete');
    persistPending();render();$('connection-status').textContent='Connected · revision '+state.revision;
  }catch(error){$('connection-status').textContent='Connection interrupted';if(!silent)throw error;}
  finally{refreshing=false;}
}
async function handle(action){if(busy)return;busy=true;controls();
  try{return await action();}
  catch(error){notice((error.code?error.code+': ':'')+error.message,'error');}
  finally{busy=false;controls();}
}
function selectSection(name){if(!['source','captures','projection','editions','publisher','exports'].includes(name))name='source';section=name;document.querySelectorAll('main>[data-panel]').forEach(panel=>{panel.hidden=panel.dataset.panel!==name;});
  document.querySelectorAll('[data-section]').forEach(control=>{if(control.dataset.section===name)control.setAttribute('aria-current','page');else control.removeAttribute('aria-current');});
}
const publisher=createPublisherPanel({getState:publisherState,perform,download:(kind,id)=>downloadPublisher(kind,id),handle,notice,selectSection});
function controls(){
  document.querySelectorAll('[data-write]').forEach(control=>{control.disabled=busy||!state;});
  for(const id of ['source-discover','source-copy','source-download'])$(id).disabled=busy||!state?.activeSourceId;
  $('capture-form').querySelector('button[type="submit"]').disabled=busy||!$('discovery-select').value;
  for(const id of ['job-open','job-resume','job-pause'])$(id).disabled=busy||!$('job-select').value;
  $('job-resume').disabled||=!!currentJob?.active||currentJob?.status==='complete';
  $('job-pause').disabled||=currentJob?.status==='complete';
  $('job-project').disabled=busy||!currentJob||currentJob.kind!=='capture'||currentJob.status!=='complete';
  for(const id of ['projection-default','projection-preview','projection-save'])$(id).disabled=busy||!$('projection-capture').value;
  $('edition-form').querySelector('button[type="submit"]').disabled=busy||!$('edition-mapping').value;
  for(const id of ['edition-open','edition-csv','edition-source'])$(id).disabled=busy||!$('edition-select').value;
  $('merchant-form').querySelector('button[type="submit"]').disabled=busy||!$('edition-select').value;
  $('export-form').querySelector('button[type="submit"]').disabled=busy||!$('edition-select').value||!$('export-merchant').value;
  $('source-files-form').querySelector('button[type="submit"]').disabled=busy||!$('source-files-packet').value||!$('source-files-merchant').value;
  $('packet-create').disabled=busy||!!state?.jobs?.some(row=>row.active);
  $('records-prev').disabled=busy||recordsOffset===0;$('records-next').disabled=busy||recordsPage?.nextOffset===null||!recordsPage;
  $('compare-prev').disabled=busy||compareOffset===0;$('compare-next').disabled=busy||comparePage?.nextOffset===null||!comparePage;
  for(const id of ['pending-inspect','pending-retry'])$(id).disabled=busy;
  publisher.controls(busy||!state?.activeProductId);
}
function render(){
  if(!state)return;
  $('workspace-id').textContent=state.id;$('workspace-revision').textContent='Revision '+state.revision;
  options('source-select',state.sources.map(row=>[row.id,row.label+' · '+row.context]),state.activeSourceId,true);
  options('product-select',state.products.map(row=>[row.id,row.label]),state.activeProductId,true);
  const selectedProduct=state.products.find(row=>row.id===state.activeProductId);
  $('product-summary').textContent=selectedProduct?selectedProduct.id:'Export an edition to create its publisher product.';
  renderSource();renderSelections();renderExports();renderHistory();renderPending();publisher.render(publisherState());controls();
}
function renderSource(){
  const selected=state.sources.find(row=>row.id===state.activeSourceId);
  facts('source-summary',selected?[['Native REST root',selected.apiRoot],['Context',selected.context],['Source ID',selected.id],
    ['Source SHA-256',selected.sourceSha256],['Saved',selected.createdAt]]:[['Selection','Save a WordPress source connection.']]);
  $('source-environment').textContent=state.environment.length?state.environment.map(row=>row.name+': '+(row.configured?'configured':'configure on this host')).join(' · '):'Public source access';
  const discoveries=state.jobs.filter(row=>row.sourceId===state.activeSourceId&&row.kind==='discovery');
  $('source-discoveries').replaceChildren();
  for(const row of discoveries.slice(0,5)){
    const card=node('div',undefined,'record-card');card.append(node('strong',row.status+' · '+row.id,'small'),
      node('p',row.responseCount+' retained responses · '+(row.updatedAt??''),'help'),
      button('Open discovery',async()=>{$('job-select').value=jobValue(row);await loadJob();selectSection('captures');}));
    $('source-discoveries').append(card);
  }
}
function renderSelections(){
  const sourceJobs=state.jobs.filter(row=>row.sourceId===state.activeSourceId);
  options('discovery-select',sourceJobs.filter(row=>row.kind==='discovery'&&row.status==='complete').map(row=>[row.id,row.createdAt+' · '+short(row.sha256)]));
  options('job-select',state.jobs.map(row=>[jobValue(row),(row.kind??'job')+' · '+row.status+' · '+row.createdAt+' · '+short(row.id)]));
  const captures=state.jobs.filter(row=>row.kind==='capture'&&row.status==='complete');
  options('projection-capture',captures.map(row=>[jobValue(row),row.createdAt+' · '+count(row.recordCount)+' records · '+short(row.sha256)]));
  const mappings=[...state.mappings].reverse().map(row=>[row.id,row.projection.label+' · '+short(row.captureSha256)]);
  options('projection-saved',mappings);options('edition-mapping',mappings);
  const editions=[...state.editions].reverse().map(row=>[row.id,row.name+' · '+count(row.rowCount)+' rows · '+short(row.snapshot)]);
  for(const id of ['edition-select','compare-before','compare-after'])options(id,editions);
  const merchants=[...state.merchants].reverse().map(row=>[row.id,row.origin+row.path+' · '+short(row.id)]);
  for(const id of ['export-merchant','source-files-merchant'])options(id,merchants);
  options('export-product',[['','Create new product'],...state.products.map(row=>[row.id,row.label])]);
  options('source-files-packet',[...state.packets].reverse().map(row=>[row.id,row.createdAt+' · '+bytes(row.bytes)+' · '+short(row.manifestSha256)]));
  renderProjectionCapture();renderMappingPins();renderEditionSummary();
}
function renderProjectionCapture(){
  const selected=state.jobs.find(row=>jobValue(row)===$('projection-capture').value);
  $('projection-capture-summary').textContent=selected?'Original capture '+selected.id+' · SHA-256 '+selected.sha256:'Complete a native content capture before projecting its fields.';
}
function renderMappingPins(){const mapping=state.mappings.find(row=>row.id===$('edition-mapping').value);
  facts('edition-review-pins',mapping?[['Saved mapping',mapping.id],['Capture SHA-256',mapping.captureSha256],['Projection SHA-256',mapping.projectionHash]]:[['Selection','Save the reviewed projection.']]);
}
function renderEditionSummary(){const edition=state.editions.find(row=>row.id===$('edition-select').value);
  facts('edition-summary',edition?[['Edition',edition.id],['Dataset',edition.name],['Rows',count(edition.rowCount)],['CSV bytes',bytes(edition.csvBytes)],
    ['Dataset snapshot',edition.snapshot],['Original capture',edition.captureId],['Capture SHA-256',edition.captureSha256]]:[['Selection','Build a reviewed native edition.']]);
}
function renderExports(){
  $('exports-count').textContent=state.exports.length+' exports';$('exports-list').replaceChildren();
  for(const row of [...state.exports].reverse()){
    const card=node('article',undefined,'record-card'),heading=node('div',undefined,'record-title');
    heading.append(node('span',row.delivery==='source-files'?'Complete WordPress source product':'WordPress content edition'),node('span',row.createdAt,'small muted'));card.append(heading);
    card.append(node('div',row.id+' · snapshot '+row.snapshot,'mono small'));
    const actions=node('div',undefined,'actions');
    actions.append(button('Select publisher',async()=>{await perform('product.select',{productId:row.productId});selectSection('publisher');},{primary:true,write:true}));
    for(const name of ['dataset.csv','dataset.json','source.json','seller.json'])if(row.files.some(file=>file.path===name))
      actions.append(button(name,()=>downloadFile('export',row.id,name)));
    card.append(actions,detail('Complete source-file inventory',row.files));$('exports-list').append(card);
  }
  if(!state.exports.length)$('exports-list').append(node('p','Export a reviewed edition with original merchant terms.','empty'));
  $('packets-list').replaceChildren();
  for(const row of [...state.packets].reverse()){
    const card=node('article',undefined,'record-card');card.append(node('strong',row.createdAt+' · '+bytes(row.bytes)));
    card.append(node('p',row.id,'mono small'),node('p','Manifest SHA-256 '+row.manifestSha256,'help'));
    card.append(button('Download complete packet',()=>downloadFile('packet',row.id)),button('Use for receiving',()=>{$('receive-input').value=state.directory+'/packets/'+row.id+'.zip';$('receive-directory').focus();}),detail('Retained packet identity',row));$('packets-list').append(card);
  }
  if(!state.packets.length)$('packets-list').append(node('p','Create a complete source packet after pausing active captures.','empty'));
}
function renderHistory(){
  $('operations-list').replaceChildren();
  for(const row of state.operations.slice(0,30)){
    const card=node('article',undefined,'record-card'),heading=node('div',undefined,'record-title');
    heading.append(node('strong',row.action),node('span',row.status,'badge'));card.append(heading,node('p',row.id,'mono small'));
    if(row.error)card.append(node('p',row.error.code+': '+row.error.message,'help'));
    card.append(button('Read retained action',async()=>showDetails(row.action,await request('/api/operation?'+params({id:row.id})))));
    $('operations-list').append(card);
  }
}
async function download(path,fallback){
  const value=await request(path,{blob:true}),url=URL.createObjectURL(value.blob),link=document.createElement('a');
  const match=value.headers.get('content-disposition')?.match(/filename="([^"]+)"/);
  link.href=url;link.download=match?.[1]??fallback;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function downloadFile(kind,id,name,sourceId){required(id,'Select the retained file.');return download('/api/file?'+params({kind,id,name,sourceId}),'wordpress-source');}
async function downloadPublisher(kind,id){return download('/api/publisher-file?'+params({productId:state.activeProductId,kind,id}),'wordpress-customer-file');}
async function loadDiscovery(){
  const id=required($('discovery-select').value,'Complete and select native discovery.'),value=await request('/api/job?'+params({sourceId:state.activeSourceId,id}));
  if(value.status!=='complete'||value.kind!=='discovery')throw new Error('Complete this original discovery.');
  discovery=value.complete;
  $('discovery-summary').textContent=discovery.collections.length+' native collections · original discovery '+value.id+' · '+discovery.sha256;
  table('discovery-collections',[{label:'Use',value:row=>{const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='source-choice';checkbox.checked=true;checkbox.dataset.collection=row.key;
      checkbox.setAttribute('aria-label','Capture '+row.name);checkbox.addEventListener('change',buildSelection);return checkbox;}},
    {label:'Collection',value:row=>row.name+' ('+row.key+')'},{label:'Native route',value:row=>row.route},{label:'Kind',value:row=>row.kind},
    {label:'Native arguments',value:row=>button('Inspect filters',()=>showDetails(row.route,{arguments:row.arguments,native:row.native}))}],discovery.collections);
  buildSelection();notice('Loaded the original native collection and filter definitions.');
}
function buildSelection(){
  const collections=[...document.querySelectorAll('[data-collection]:checked')].map(control=>({key:control.dataset.collection,query:{}}));
  let previous;try{previous=JSON.parse($('capture-selection').value);}catch{}
  for(const row of collections){const saved=previous?.collections?.find(item=>item.key===row.key);if(saved)row.query=saved.query??{};}
  $('capture-selection').value=json({collections,maxPages:previous?.maxPages??10000,maxRecords:previous?.maxRecords??250000,maxBytes:previous?.maxBytes??536870912});
}
async function loadJob({silent=false}={}){
  const selected=selectedJob(),value=await request('/api/job?'+params(selected));currentJob={...value,sourceId:selected.sourceId};
  facts('job-summary',[['Original job',value.id],['Kind / status',value.kind+' / '+value.status],['Responses',count(value.responseCount)],
    ['Records',count(value.recordCount)],['Retained body bytes',bytes(value.responseBytes)],['Cursor',value.collectionIndex+' / page '+value.page],
    ['Next retry',value.nextRetryAt??'Available'],['Capture SHA-256',value.complete?.sha256],['Source SHA-256',value.sourceSha256]]);
  $('job-details').textContent=json(value);$('job-findings').replaceChildren();
  for(const finding of [...(value.findings??[]),...(value.error?[value.error]:[])]){
    const row=node('div',undefined,'finding');row.append(node('strong',finding.code??'Source observation'),node('div',finding.message??finding));
    if(['WORDPRESS_CAPTURE_LIMIT','WORDPRESS_CAPTURE_PAGE_LIMIT'].includes(finding.code))row.append(node('p','Create a new capture with larger declared limits to include this source. The retained capped capture keeps its original responses and cursor.','help'),button('Review new capture limits',()=>selectSection('source')));
    $('job-findings').append(row);
  }
  const collectionKeys=value.intent.input.selection?.collections.map(row=>row.key)??[];
  options('records-collection',[['','All captured collections'],...collectionKeys.map(key=>[key,key])]);
  options('response-select',(value.responses??[]).map(row=>[String(row.sequence),'Response '+row.sequence+' · '+(row.status??'')+' · '+short(row.responseSha256)]));
  controls();if(!silent)notice('Read the original '+value.kind+' cursor.');
  return value;
}
async function loadRecords(reset=false){
  if(reset)recordsOffset=0;const selected=selectedJob();
  recordsPage=await request('/api/records?'+params({...selected,offset:recordsOffset,limit:Number($('records-limit').value),collection:$('records-collection').value}));
  $('records-count').textContent=count(recordsPage.recordCount)+' records';
  table('records-table',[{label:'Native identity',value:row=>row.key},{label:'Title / name',value:row=>row.native?.title?.rendered??row.native?.name??row.native?.slug??'—'},
    {label:'Status',value:row=>row.native?.status??row.kind},{label:'Original source',value:row=>{const area=node('div');
      area.append(button('Native record',()=>showDetails(row.key,row)));
      area.append(button('Response '+row.responseSequence,async()=>{$('response-select').value=String(row.responseSequence);await loadResponse();}));
      area.append(node('div',short(row.responseSha256),'native-meta'));return area;}}],recordsPage.rows);
  $('records-page').textContent=recordsPage.recordCount?count(recordsOffset+1)+'–'+count(Math.min(recordsOffset+recordsPage.rows.length,recordsPage.recordCount))+' of '+count(recordsPage.recordCount):'No captured rows';
  controls();
}
async function loadResponse(){
  const selected=selectedJob(),sequence=required($('response-select').value,'Select a saved source response.');
  const value=await request('/api/response?'+params({...selected,sequence}));
  facts('response-summary',[['Request',value.request.url],['HTTP status',value.response.status],['Observed',value.observedAt],
    ['Body SHA-256',value.response.sha256],['Bytes',bytes(value.response.bytes)],['Preview',value.response.clipped?'First '+bytes(value.response.previewBytes)+'; download retains the full body':'Complete body']]);
  $('response-body').textContent=value.response.bodyText;
}
async function loadDefaultProjection(){const selected=selectedCapture();
  $('projection-json').value=json(await request('/api/projection?'+params(selected)));projectionPreview=null;renderProjectionCapture();
}
async function previewProjection(){const selected=selectedCapture();
  projectionPreview=await request('/api/preview',{method:'POST',body:{sourceId:selected.sourceId,captureId:selected.id,projection:parse('projection-json'),offset:0,limit:20}});
  facts('projection-preview-summary',[['Records',count(projectionPreview.recordCount)],['Capture SHA-256',projectionPreview.captureSha256],['Projection SHA-256',projectionPreview.projectionHash]]);
  const fields=Object.keys(projectionPreview.projection.mapping);
  table('projection-preview-table',fields.map(field=>({label:field,value:row=>row.row[field]})),projectionPreview.rows);
  $('projection-preview-details').textContent=json(projectionPreview);
}
async function loadMapping(target='projection-saved'){
  const value=await request('/api/mapping?'+params({id:required($(target).value,'Select a saved mapping.')}));
  $('projection-capture').value=value.sourceId+'|'+value.captureId;$('projection-json').value=json(value.projection);
  $('edition-mapping').value=value.id;projectionPreview=null;renderMappingPins();renderProjectionCapture();controls();return value;
}
function nativeTable(target,result){
  const value=result.body??result,rows=value.rows??[],fields=value.fields??(rows.length&&!Array.isArray(rows[0])?Object.keys(rows[0]):[]);
  if(Number(result.status)>=400){$(target).replaceChildren(node('p',readable(value.message??value.error??value),'error-detail'));return;}
  table(target,fields.map((field,index)=>({label:field,value:row=>Array.isArray(row)?row[index]:row[field]})),rows);
}
async function compareEditions(reset=false){
  if(reset)compareOffset=0;
  comparePage=await request('/api/compare?'+params({before:required($('compare-before').value,'Select the before edition.'),
    after:required($('compare-after').value,'Select the after edition.'),offset:compareOffset,limit:50}));
  facts('compare-summary',Object.entries(comparePage.counts).map(([key,value])=>[key,count(value)]));
  table('compare-table',[{label:'Native record',value:row=>row.key},{label:'Change',value:row=>row.kind},
    {label:'Original record versions',value:row=>button('Inspect source versions',()=>showDetails(row.key,row))}],comparePage.changes);
  $('compare-page').textContent=comparePage.changeCount?count(compareOffset+1)+'–'+count(compareOffset+comparePage.changes.length)+' of '+count(comparePage.changeCount):'No record changes';
  $('compare-details').textContent=json({sameSource:comparePage.sameSource,sameProjection:comparePage.sameProjection,sameCollections:comparePage.sameCollections,before:comparePage.before,after:comparePage.after});controls();
}
function form(id,action){$(id).addEventListener('submit',event=>{event.preventDefault();handle(action);});}
document.querySelectorAll('[data-section]').forEach(control=>control.addEventListener('click',()=>selectSection(control.dataset.section)));
$('detail-close').addEventListener('click',()=>$('detail-dialog').close());
$('refresh').addEventListener('click',()=>handle(()=>refresh()));
$('handbook').addEventListener('click',()=>handle(async()=>showDetails('WordPress source operator guide',await request('/api/handbook',{text:true}))));
$('source-auth').addEventListener('change',()=>{const active=$('source-auth').value==='application-password';$('source-user-label').hidden=!active;$('source-password-label').hidden=!active;
  $('source-user-env').required=active;$('source-password-env').required=active;});
form('source-form',async()=>{
  const mode=$('source-auth').value,source={schema:'stellar-forge.wordpress-source.v1',label:$('source-label').value,apiRoot:$('source-root').value,
    context:$('source-context').value,authentication:{mode,...(mode==='application-password'?{usernameEnv:$('source-user-env').value,passwordEnv:$('source-password-env').value}:{})},
    perPage:Number($('source-per-page').value),timeoutMs:Number($('source-timeout').value),maxResponseBytes:Number($('source-response-bytes').value),allowLoopback:$('source-loopback').checked};
  await perform('source.save',{source});discovery=null;$('capture-selection').value='';
});
$('source-select').addEventListener('change',()=>handle(async()=>{await perform('source.select',{sourceId:$('source-select').value});discovery=null;}));
$('product-select').addEventListener('change',()=>handle(()=>perform('product.select',{productId:$('product-select').value})));
$('source-copy').addEventListener('click',()=>handle(async()=>{
  const {source}=await request('/api/source?'+params({id:state.activeSourceId}));
  $('source-label').value=source.label;$('source-root').value=source.apiRoot;$('source-context').value=source.context;
  $('source-auth').value=source.authentication.mode;$('source-user-env').value=source.authentication.usernameEnv??'';
  $('source-password-env').value=source.authentication.passwordEnv??'';$('source-per-page').value=source.perPage;
  $('source-timeout').value=source.timeoutMs;$('source-response-bytes').value=source.maxResponseBytes;$('source-loopback').checked=source.allowLoopback;
  $('source-auth').dispatchEvent(new Event('change'));
}));
$('source-download').addEventListener('click',()=>handle(()=>downloadFile('source',state.activeSourceId)));
$('source-discover').addEventListener('click',()=>handle(async()=>{
  const result=await perform('source.discover',{sourceId:state.activeSourceId});$('job-select').value=result.sourceId+'|'+result.jobId;
  await loadJob();selectSection('captures');
}));
$('discovery-load').addEventListener('click',()=>handle(loadDiscovery));
form('capture-form',async()=>{
  const result=await perform('capture.start',{sourceId:state.activeSourceId,discoveryId:required($('discovery-select').value,'Select completed native discovery.'),selection:parse('capture-selection')});
  $('job-select').value=result.sourceId+'|'+result.jobId;await loadJob();selectSection('captures');
});
$('job-open').addEventListener('click',()=>handle(()=>loadJob()));
$('job-select').addEventListener('change',()=>handle(async()=>{recordsOffset=0;recordsPage=null;await loadJob();if(currentJob.kind==='capture')await loadRecords();}));
$('job-resume').addEventListener('click',()=>handle(async()=>{const selected=selectedJob();await perform('capture.resume',{sourceId:selected.sourceId,captureId:selected.id});await loadJob();}));
$('job-pause').addEventListener('click',()=>handle(async()=>{const selected=selectedJob();await perform('capture.pause',{sourceId:selected.sourceId,captureId:selected.id});await loadJob();}));
$('job-project').addEventListener('click',()=>handle(async()=>{$('projection-capture').value=currentJob.sourceId+'|'+currentJob.id;await loadDefaultProjection();selectSection('projection');}));
$('records-load').addEventListener('click',()=>handle(()=>loadRecords(true)));
$('records-prev').addEventListener('click',()=>handle(()=>{recordsOffset=Math.max(0,recordsOffset-Number($('records-limit').value));return loadRecords();}));
$('records-next').addEventListener('click',()=>handle(()=>{if(recordsPage?.nextOffset!==null)recordsOffset=recordsPage.nextOffset;return loadRecords();}));
$('response-open').addEventListener('click',()=>handle(loadResponse));
$('response-download').addEventListener('click',()=>handle(()=>{const selected=selectedJob();return downloadFile('response',selected.id,$('response-select').value,selected.sourceId);}));
$('projection-capture').addEventListener('change',()=>{projectionPreview=null;renderProjectionCapture();});
$('projection-json').addEventListener('input',()=>{projectionPreview=null;});
$('projection-default').addEventListener('click',()=>handle(loadDefaultProjection));
$('projection-open-mapping').addEventListener('click',()=>handle(()=>loadMapping()));
$('projection-preview').addEventListener('click',()=>handle(previewProjection));
$('projection-save').addEventListener('click',()=>handle(async()=>{
  await previewProjection();const selected=selectedCapture(),result=await perform('mapping.save',{sourceId:selected.sourceId,captureId:selected.id,
    expectedCaptureSha256:projectionPreview.captureSha256,projection:projectionPreview.projection});
  $('edition-mapping').value=result.id;$('projection-saved').value=result.id;$('edition-approve').checked=false;renderMappingPins();
}));
$('edition-mapping').addEventListener('change',()=>{$('edition-approve').checked=false;renderMappingPins();});
form('edition-form',async()=>{
  const mapping=state.mappings.find(row=>row.id===$('edition-mapping').value);required(mapping,'Select the saved reviewed mapping.');
  const result=await perform('edition.build',{mappingId:mapping.id,dataset:parse('edition-dataset'),review:{reviewer:$('edition-reviewer').value,
    note:$('edition-note').value,decision:'approve',expectedCaptureSha256:mapping.captureSha256,projectionHash:mapping.projectionHash}});
  $('edition-select').value=result.id;renderEditionSummary();selectSection('editions');
});
$('edition-select').addEventListener('change',renderEditionSummary);
$('edition-open').addEventListener('click',()=>handle(async()=>showDetails('Retained WordPress edition',await request('/api/edition?'+params({id:$('edition-select').value})))));
$('edition-csv').addEventListener('click',()=>handle(()=>downloadFile('edition',$('edition-select').value,'dataset.csv')));
$('edition-source').addEventListener('click',()=>handle(()=>downloadFile('edition',$('edition-select').value,'source.json')));
form('dataset-preview-form',async()=>{
  const query=$('dataset-query').value,result=await request('/api/dataset-preview',{method:'POST',body:{editionId:required($('edition-select').value,'Select a retained edition.'),query}});
  lastQuery=query;sessionStorage.setItem(storageKey+':query',query);nativeTable('dataset-preview-table',result);$('dataset-preview-details').textContent=json(result);publisher.render(publisherState());
});
form('compare-form',()=>compareEditions(true));
$('compare-prev').addEventListener('click',()=>handle(()=>{compareOffset=Math.max(0,compareOffset-50);return compareEditions();}));
$('compare-next').addEventListener('click',()=>handle(()=>{if(comparePage?.nextOffset!==null)compareOffset=comparePage.nextOffset;return compareEditions();}));
form('merchant-form',async()=>{
  const result=await perform('merchant.save',{editionId:required($('edition-select').value,'Select the edition for these original terms.'),
    origin:$('merchant-origin').value,path:$('merchant-path').value,payment:parse('merchant-payment'),reviewer:$('merchant-reviewer').value,note:$('merchant-note').value});
  $('export-merchant').value=result.id;$('source-files-merchant').value=result.id;$('merchant-saved').textContent='Saved original merchant terms '+result.id+'.';
});
form('export-form',async()=>{
  const productId=$('export-product').value;
  await perform('edition.export',{editionId:required($('edition-select').value,'Select the reviewed edition.'),merchantId:$('export-merchant').value,
    ...(productId?{productId}:{productLabel:$('export-product-label').value}),reviewer:$('export-reviewer').value,note:$('export-note').value});
  selectSection('publisher');
});
$('packet-create').addEventListener('click',()=>handle(()=>perform('source.packet',{})));
form('source-files-form',async()=>{
  await perform('source.files',{packetId:$('source-files-packet').value,merchantId:$('source-files-merchant').value,
    name:$('source-files-name').value,productLabel:$('source-files-label').value,reviewer:$('source-files-reviewer').value,note:$('source-files-note').value});
  selectSection('publisher');
});
form('receive-form',async()=>{
  const value={input:$('receive-input').value,directory:$('receive-directory').value};
  sessionStorage.setItem(storageKey+':receive',JSON.stringify(value));
  const result=await request('/api/receive',{method:'POST',body:value});$('receive-result').textContent=json(result);
  notice('Received the exact source packet. Open '+result.directory+' with wordpress/cli.mjs serve.');
});
$('pending-inspect').addEventListener('click',()=>handle(async()=>{
  const value=pending.at(-1);if(!value)return;
  const result=await request('/api/operation?'+params({id:value.operationId}));showDetails('Original action result',result);
  if(result.operation.status==='complete'){pending=pending.filter(row=>row.operationId!==value.operationId);persistPending();await refresh();}
}));
$('pending-retry').addEventListener('click',()=>handle(async()=>{
  const value=pending.at(-1);if(!value)return;
  try{await request('/api/operation?'+params({id:value.operationId}));}catch(error){if(error.status!==404)throw error;value.expectedRevision=state.revision;persistPending();}
  await perform(value.action,value.input,value);
}));
$('pending-clear').addEventListener('click',()=>{pending.pop();persistPending();notice('Dismissed this browser reminder. The original action remains in workspace history.');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)refresh({silent:true});});
setInterval(async()=>{
  if(document.hidden||busy||refreshing||!state)return;
  const running=state.jobs.some(row=>row.active)||state.running?.length;
  if(!running)return;
  try{await refresh({silent:true});if(section==='captures'&&$('job-select').value)await loadJob({silent:true});}catch{}
},2500);
handle(async()=>{await refresh();selectSection(location.hash.slice(1)||'source');
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey+':receive')||'null');if(saved){$('receive-input').value=saved.input;$('receive-directory').value=saved.directory;}}catch{}
});
