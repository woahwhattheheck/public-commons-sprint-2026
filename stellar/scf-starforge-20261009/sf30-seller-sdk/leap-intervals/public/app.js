const $=id=>document.getElementById(id);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object??{},key);
const SHA=/^[0-9a-f]{64}$/;
const names={overview:'Overview',sources:'Source files',mappings:'Device mappings',batches:'Batch review',jobs:'Upload jobs',missing:'Missing intervals',delivery:'Export & receiving'};
const headings={overview:'Make each interval accountable.',sources:'Keep the complete original.',mappings:'Connect source and device identity.',batches:'Review the exact load.',jobs:'Follow the original upload.',missing:'Resolve the missing intervals.',delivery:'Hand over a complete record.'};
const collections=['imports','mappings','batches','missing_snapshots','api_receipts','meters','original_files'];
const model={state:null,token:decodeURIComponent(location.hash.slice(1)),section:'overview',providerKind:'api_receipts',pending:null,pendingFile:null,pendingObserved:null,busy:false,selection:{},pages:Object.fromEntries(collections.map(k=>[k,{offset:0,limit:25}])),batchRecords:{kind:'rows',offset:0,limit:50},missingRecords:{offset:0,limit:50},lastOperation:null,requestEpoch:0,renderEpoch:0,inspectEpoch:{}};
const templates={
 configuration:()=>({environment:model.state?.config?.environment??'staging',partner_account_id:model.state?.config?.partner_account_id??'',token_env:model.state?.config?.token_env??'LEAP_API_TOKEN'}),
 mapping:()=>({schema:'stellar-forge.leap-interval-mapping.v1',name:'',environment:model.state?.config?.environment??'staging',partner_account_id:model.state?.config?.partner_account_id??'',reviewer:'',ownership_evidence_source_id:'',ownership:[{meter_id:'',start_utc:'',end_utc:''}],entries:[]}),
 prepare:()=>({name:'',source_ids:model.selection.imports?[model.selection.imports]:[],mapping_id:model.selection.mappings??''}),
 submit:()=>({batch_id:model.selection.batches??''}),refresh:()=>({batch_id:model.selection.batches??''}),reconcile:()=>({batch_id:model.selection.batches??''}),
 missing:()=>({meter_ids:[],status:'OPEN',missing_interval_window_start_date_time_utc:'',missing_interval_window_end_date_time_utc:''}),
 export:()=>({batch_id:model.selection.batches??''})
};
function notice(message,kind=''){const el=$('notice');el.hidden=!message;el.className='notice'+(kind?' '+kind:'');el.textContent=message;}
function errorText(error){return [error.code,error.message].filter(Boolean).join(' · ');}
function actionError(body,status){const value=body?.error??body??{};return Object.assign(new Error(typeof value==='string'?value:value.message??'The original request returned HTTP '+status),{status,code:typeof value==='object'?value.code??body?.code:undefined,body});}
function safeUrl(path){const url=new URL(path,location.origin);if(url.origin!==location.origin||!/^\/api\/(?:file|export)$/.test(url.pathname))throw new Error('The original file must belong to this authenticated console.');return url.href;}
function storageKey(){return 'starforge.leap.pending.v1:'+model.state.workspace_id;}
function writePending(value){const key=storageKey();if(value)localStorage.setItem(key,pretty(value));else localStorage.removeItem(key);model.pending=value;renderPending();applyBusy();}
function rememberForms(){if(!model.state)return;const data={};document.querySelectorAll('textarea').forEach(el=>data[el.id]=el.value);try{localStorage.setItem('starforge.leap.forms.v1:'+model.state.workspace_id,pretty(data));}catch{}}
function restoreForms(){let data;try{data=JSON.parse(localStorage.getItem('starforge.leap.forms.v1:'+model.state.workspace_id)||'null');}catch{}if(data&&typeof data==='object')for(const [id,value]of Object.entries(data))if($(id)&&typeof value==='string')$(id).value=value;}
async function api(path,{method='GET',body,headers={},signal,timeout=180000}={}){
 if(!model.token)throw new Error('Open the private console link to connect to this owner.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 try{
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+model.token,...headers,...(body!==undefined&&typeof body==='string'?{'Content-Type':'application/json'}:{})},body,signal:controller.signal,cache:'no-store'});
  const text=await response.text();let data;try{data=text?JSON.parse(text):{};}catch{throw new Error('The original console returned an unreadable JSON response.');}
  if(!response.ok)throw actionError(data,response.status);
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function applyBusy(){
 const blocked=model.busy||!!model.pending||!model.state;
 document.querySelectorAll('[data-mutation]').forEach(button=>button.disabled=blocked);
 $('refresh').disabled=model.busy;
 $('pending-check').disabled=model.busy;
 $('pending-retry').disabled=model.busy;
}
function valueText(value){return value===null?'null':value===undefined?'—':typeof value==='object'?pretty(value):String(value);}
function facts(object,keys){return keys.map(key=>'<dt>'+esc(key.replaceAll('_',' '))+'</dt><dd>'+esc(valueText(object?.[key]))+'</dd>').join('');}
function badge(value){const text=String(value??'—'),kind=/FAILED|INVALID|REJECTED|ERROR/.test(text)?'error':/UNKNOWN|PENDING|QUEUED|RUNNING|PROCESSING|PREPARED|DEFERRED|AUTHENTICATION_REQUIRED|ELIGIBILITY_REVIEW|NEEDS_REPLAN|DUPLICATE_REVIEW|INTERRUPTED|INCOMPLETE_ROWS/.test(text)?'warning':'neutral';return '<span class="badge '+kind+'">'+esc(text)+'</span>';}
function table(items,{columns,select,selected,empty='No retained records in this page.'}={}){
 if(!items.length)return '<div class="empty">'+esc(empty)+'</div>';
 const keys=columns??[...new Set(items.flatMap(item=>Object.keys(item??{})))].slice(0,9);
 return '<div class="table-scroll"><table><thead><tr>'+keys.map(k=>'<th>'+esc(k.replaceAll('_',' '))+'</th>').join('')+'<th>Original record</th></tr></thead><tbody>'+items.map((row,index)=>{
  const id=row.id??row.sha256??row.job_id??'',mark=id===selected?' class="selected"':'';
  return '<tr'+mark+'>'+keys.map(k=>'<td>'+(k==='status'?badge(row[k]):esc(valueText(row[k])))+'</td>').join('')+'<td>'+(select&&id?'<button class="button small" data-select="'+esc(select)+'" data-id="'+esc(id)+'">Inspect</button>':'<details><summary>View full record</summary><pre>'+esc(pretty(row))+'</pre></details>')+'</td></tr>';
 }).join('')+'</tbody></table></div>';
}
function listReply(reply){if(!reply||!Array.isArray(reply.items)||!Number.isSafeInteger(reply.total))throw new Error('The original paged response must contain items and total.');return reply;}
function pager(container,reply,scope){
 const offset=reply.offset??0,limit=reply.limit??25,end=Math.min(offset+reply.items.length,reply.total);
 $(container).innerHTML='<span>'+(reply.total?esc((offset+1)+'–'+end+' of '+reply.total):'0 records')+'</span><div><button class="button small" data-page="'+esc(scope)+'" data-offset="'+Math.max(0,offset-limit)+'" '+(offset<=0?'disabled':'')+'>Previous</button><button class="button small" data-page="'+esc(scope)+'" data-offset="'+(offset+limit)+'" '+(offset+limit>=reply.total?'disabled':'')+'>Next</button></div>';
}
function fileMetadata(object){
 const results=[],seen=new Set();
 function walk(value,depth=0){
  if(!value||typeof value!=='object'||depth>8)return;
  if(typeof value.download_url==='string'&&typeof value.name==='string'){
   const key=value.download_url;
   if(!seen.has(key)){seen.add(key);results.push(value);}
  }
  for(const [key,child]of Object.entries(value))if(key!=='config')if(Array.isArray(child))child.forEach(v=>walk(v,depth+1));else if(child&&typeof child==='object')walk(child,depth+1);
 }
 walk(object);return results;
}
function fileButtons(object){
 return fileMetadata(object).map(file=>'<button class="button small" data-download="'+esc(encodeURIComponent(pretty(file)))+'">Download '+esc(file.name)+' <span>'+esc(file.bytes??'')+' bytes</span></button>').join('');
}
function originalDetail(value,{keys=['id','name','status','created_at','bytes','sha256']}={}){
 const data=value?.item??value;
 return '<dl class="facts">'+facts(data,keys.filter(k=>own(data,k)))+'</dl><div class="source-links">'+fileButtons(data)+'</div><details><summary>Complete original metadata and response</summary><pre>'+esc(pretty(data))+'</pre></details>';
}
function displayPendingStorage(){
 try{model.pending=JSON.parse(localStorage.getItem(storageKey())||'null');}catch(error){notice('The retained browser request could not be read: '+error.message,'warning');}
 if(model.pending?.workspace_id!==model.state.workspace_id)model.pending=null;
 renderPending();
}
function renderPending(){
 const pending=model.pending;$('pending-panel').hidden=!pending;
 if(!pending)return;
 const observed=model.pendingObserved,status=observed?.status??'UNCONFIRMED';
 $('pending-state').textContent=status;
 $('pending-summary').textContent='Read the original UUID before continuing. The saved request retains its exact workspace revision and source identity.';
 $('pending-identity').innerHTML=facts({request_id:pending.request_id,action:pending.kind==='action'?pending.body.action:pending.kind,expected_revision:pending.expected_revision,source_sha256:pending.file?.sha256,workspace_id:pending.workspace_id},['request_id','action','expected_revision','source_sha256','workspace_id']);
 $('pending-detail').textContent=pretty({request:pending,observed});
 const retry=observed?.status==='NOT_FOUND'||observed?.status==='INTERRUPTED'&&observed?.recoverable===true;
 $('pending-retry').hidden=!retry;
 $('pending-file-label').hidden=!(retry&&pending.kind!=='action'&&!model.pendingFile);
}
function fillTemplates(force=false){for(const [name,create]of Object.entries(templates)){const element=$(name==='configuration'?'configuration-json':name+'-json');if(element&&(force||!element.value.trim()))element.value=pretty(create());}}
function selectSection(section){
 if(!names[section])return;model.section=section;
 document.querySelectorAll('.section').forEach(el=>el.hidden=el.id!=='section-'+section);
 document.querySelectorAll('nav [data-section]').forEach(el=>{if(el.dataset.section===section)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 $('section-title').textContent=headings[section];$('section-eyebrow').textContent='RETAINED INTERVALS / '+names[section].toUpperCase();
 if(model.state)loadSection().catch(showError);
}
function renderState(){
 const state=model.state;$('connection-panel').hidden=true;$('connection-dot').classList.add('ready');$('connection-label').textContent='Original owner connected';
 $('workspace-short').textContent=state.workspace_id;$('footer-identity').textContent='Workspace '+state.workspace_id+' · revision '+state.revision;
 const env=state.config?.environment??'—';$('environment-badge').textContent=env==='production'?'Production':env==='staging'?'Staging':env;$('environment-badge').classList.toggle('production',env==='production');
 const countKeys=['imports','mappings','batches','missing_snapshots'];
 $('metrics').innerHTML=countKeys.map(k=>'<article class="metric"><span>'+esc(k.replaceAll('_',' '))+'</span><strong>'+esc(state.counts?.[k]??state[k]?.length??'—')+'</strong></article>').join('');
 $('config-facts').innerHTML=facts(state.config,['environment','partner_account_id','token_env']);
 $('workspace-facts').innerHTML=facts(state,['workspace_id','revision','schema']);
 $('restore-identity').innerHTML=facts(state,['workspace_id','revision']);
 $('revision-badge').textContent='Revision '+state.revision;$('state-json').textContent=pretty(state);
 fillTemplates();renderPending();applyBusy();
}
async function refreshState(){
 const epoch=++model.requestEpoch,oldId=model.state?.workspace_id,state=await api('/api/state');
 if(epoch!==model.requestEpoch)return;
 if(state.schema!=='stellar-forge.leap-interval-workspace.v1'||typeof state.workspace_id!=='string'||!Number.isSafeInteger(state.revision))throw new Error('The connected owner returned a different workspace contract.');
 if(oldId&&oldId!==state.workspace_id)throw new Error('This console now belongs to a different workspace. Reopen its private link before continuing.');
 model.state=state;
 if(!oldId){fillTemplates(true);restoreForms();displayPendingStorage();}
 renderState();await loadSection();
}
async function loadList(collection){
 const epoch=model.renderEpoch,page=model.pages[collection];
 const reply=listReply(await api('/api/list?'+new URLSearchParams({collection,offset:page.offset,limit:page.limit})));
 if(epoch!==model.renderEpoch)return;
 const priorities=collection==='batches'?['name','status','row_count','issue_count','created_at']:collection==='mappings'?['name','environment','reviewer','created_at']:collection==='imports'?['name','format','bytes','created_at']:['id','status','created_at'];
 const keys=priorities.filter(k=>reply.items.some(r=>own(r,k)));
 $(collection+'-list').innerHTML=table(reply.items,{columns:keys.length?keys:undefined,select:collection,selected:model.selection[collection]});$(collection+'-total').textContent=reply.total+' retained';pager(collection+'-pager',reply,collection);
}
async function loadSection(){
 model.renderEpoch++;
 if(model.section==='sources')await loadList('imports');
 if(model.section==='mappings')await loadList('mappings');
 if(model.section==='batches'){await loadList('batches');if(model.selection.batches)await loadBatchRecords();}
 if(model.section==='missing'){await loadList('missing_snapshots');if(model.selection.missing_snapshots)await loadMissingRecords();}
 if(model.section==='jobs'){if(model.selection.batches)await inspect('batches',model.selection.batches,{navigate:false});await loadProviderList();}
}
async function inspect(collection,id,{navigate=false}={}){
 const epoch=(model.inspectEpoch[collection]??0)+1;model.inspectEpoch[collection]=epoch;
 const reply=await api('/api/item?'+new URLSearchParams({collection,id}));if(epoch!==model.inspectEpoch[collection])return null;const value=reply.item??reply;
 model.selection[collection]=id;
 if(['api_receipts','meters','original_files'].includes(collection)){$('provider-detail').classList.remove('empty');$('provider-detail').innerHTML=originalDetail(value,{keys:['id','job_id','environment','partner_account_id','method','path','state','status','body_sha256','started_at','completed_at','observed_at','downloaded_at']});}
 if(collection==='imports'){$('import-id').textContent=id;$('import-detail').classList.remove('empty');$('import-detail').innerHTML=originalDetail(value);if(navigate)selectSection('sources');}
 if(collection==='mappings'){$('mapping-detail').classList.remove('empty');$('mapping-detail').innerHTML=originalDetail(value,{keys:['id','name','environment','partner_account_id','reviewer','ownership_evidence_source_id','created_at']})+(Array.isArray(value.entries)?'<h3>Device and channel assignments</h3>'+table(value.entries):'')+(Array.isArray(value.ownership)?'<h3>Reviewed ownership windows</h3>'+table(value.ownership):'');}
 if(collection==='missing_snapshots'){$('missing-id').textContent=id;$('missing-detail').classList.remove('empty');$('missing-detail').innerHTML=originalDetail(value);if(model.lastMissing!==id){model.missingRecords.offset=0;model.lastMissing=id;}await loadMissingRecords();}
 if(collection==='batches'){
  $('batch-id').textContent=id;$('batch-title').textContent=value.name||'Batch inspection';$('batch-detail').classList.remove('empty');
  const keys=['id','name','status','source_ids','mapping_id','row_count','issue_count','meter_count','clock_utc','job_id','correction_of','missing_snapshot_id'];
  const mappingReply=await api('/api/item?'+new URLSearchParams({collection:'mappings',id:value.mapping_id}));if(epoch!==model.inspectEpoch[collection])return null;const mapping=mappingReply.item??mappingReply;
  $('batch-detail').innerHTML=originalDetail(value,{keys});$('job-batch-summary').classList.remove('empty');$('job-batch-summary').innerHTML='<div class="actions">'+badge(value.status)+'</div>'+originalDetail(value,{keys:['id','name','status','row_count','issue_count','meter_count','job_id','correction_of']})+'<h3>Destination retained in the mapping</h3><dl class="facts">'+facts(mapping,['id','environment','partner_account_id','reviewer'])+'</dl><h3>Current owner configuration</h3><dl class="facts">'+facts(model.state.config,['environment','partner_account_id','token_env'])+'</dl>';
  const next={UNKNOWN:'The original submission outcome is unknown. Reconcile this batch against the original complete upload file.',DEFERRED:'The provider deferred the request. Retain its Retry-After and use the same batch when that boundary has elapsed.',AUTHENTICATION_REQUIRED:'The original provider requires its configured account credential. Keep its error and configure the named process environment variable.',ELIGIBILITY_REVIEW:'Review the original device observations and saved eligibility error before preparing a corrected plan.',NEEDS_REPLAN:'The current missing-window search changed. Inspect that original snapshot and prepare the reviewed eligible load.',DUPLICATE_REVIEW:'Another retained batch already has these upload bytes and an accepted or uncertain attempt. Inspect that original batch.'}[value.status];
  $('job-history').innerHTML=next?'<div class="notice warning">'+esc(next)+(value.status==='DEFERRED'&&model.state.provider_not_before?' Earliest retained provider time: '+esc(model.state.provider_not_before)+'.':'')+'</div>':'';
  if(model.lastBatch!==id){model.batchRecords.offset=0;for(const name of ['submit','refresh','reconcile','export'])$(name+'-json').value=pretty(templates[name]());$('submit-reviewed').checked=false;model.lastBatch=id;}
  if(model.section==='batches')await loadBatchRecords();
 }
 applyBusy();rememberForms();
 return value;
}
async function loadBatchRecords(){
 const id=model.selection.batches;if(!id)return;
 const page=model.batchRecords,kind=page.kind,epoch=model.renderEpoch;
 const reply=listReply(await api('/api/'+kind+'?'+new URLSearchParams({batch_id:id,offset:page.offset,limit:page.limit})));
 if(id!==model.selection.batches||kind!==model.batchRecords.kind||epoch!==model.renderEpoch)return;
 const columns=kind==='rows'?['row_index','meter_id','interval_start_time_utc','interval_end_time_utc','energy_net_kwh','energy_consumed_kwh','energy_generated_kwh','final','region','origins']:['row_index','source_id','source_line','meter_id','code','column','message'];
 $('batch-records').innerHTML=table(reply.items,{columns});pager('batch-records-pager',reply,'batch-records');
 $('batch-rows-tab').classList.toggle('active',kind==='rows');$('batch-issues-tab').classList.toggle('active',kind==='issues');
}
async function loadMissingRecords(){
 const id=model.selection.missing_snapshots;if(!id)return;
 const page=model.missingRecords,epoch=model.renderEpoch;
 const reply=listReply(await api('/api/missing?'+new URLSearchParams({snapshot_id:id,offset:page.offset,limit:page.limit})));
 if(id!==model.selection.missing_snapshots||epoch!==model.renderEpoch)return;
 $('missing-records').innerHTML=table(reply.items);pager('missing-records-pager',reply,'missing-records');
}
async function loadProviderList(){
 const collection=model.providerKind,page=model.pages[collection],epoch=model.renderEpoch;
 const reply=listReply(await api('/api/list?'+new URLSearchParams({collection,offset:page.offset,limit:page.limit})));
 if(collection!==model.providerKind||epoch!==model.renderEpoch)return;
 const columns=collection==='api_receipts'?['id','method','path','state','status','started_at']:collection==='meters'?['id','environment','partner_account_id','observed_at']:['job_id','receipt_id','downloaded_at'];
 $('provider-list').innerHTML=table(reply.items,{columns,select:collection,selected:model.selection[collection]});
 $('provider-total').textContent=reply.total+' retained';pager('provider-pager',reply,'provider');
 document.querySelectorAll('[data-provider]').forEach(el=>el.classList.toggle('active',el.dataset.provider===collection));
}
function parseEditor(id){const text=$(id).value;let value;try{value=JSON.parse(text);}catch(error){throw new Error('Correct the JSON in '+id.replace('-json','')+': '+error.message);}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Use one complete JSON object.');return value;}
function showError(error){notice(errorText(error),'error');if(error.status===401||error.status===403){$('connection-label').textContent='Connection needs attention';$('connection-dot').classList.remove('ready');$('connection-panel').hidden=false;}}
async function dispatchPending(){
 const pending=model.pending;if(!pending)throw new Error('No original request is retained.');
 model.busy=true;applyBusy();
 try{
  let response;
  if(pending.kind==='action')response=await api('/api/action',{method:'POST',body:pretty(pending.body)});
  else{
   const file=model.pendingFile;if(!file)throw new Error('Reselect the same original source file before retrying.');
   const bytes=await file.arrayBuffer(),digest=await hash(bytes);
   if(bytes.byteLength!==pending.file.bytes||digest!==pending.file.sha256)throw new Error('The selected file differs from the original retained request.');
   response=await api(pending.kind==='restore'?'/api/restore':'/api/upload',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream','X-Leap-Name':encodeURIComponent(pending.file.name),'X-Leap-Format':pending.file.format??'evidence','X-Leap-Revision':String(pending.expected_revision),'X-Leap-Request-Id':pending.request_id}});
  }
  model.lastOperation={request:pending,response};$('last-operation-id').textContent=pending.request_id;$('last-operation').classList.remove('empty');$('last-operation').innerHTML=originalDetail(response,{keys:['request_id','revision']});
  const result=response.result??{};
  if(pending.body?.action==='configuration.save')$('submit-reviewed').checked=false;
  if(pending.kind==='action'&&pending.body.action==='package.export'){$('export-result').classList.remove('empty');$('export-result').innerHTML=originalDetail(result);}
  writePending(null);model.pendingFile=null;model.pendingObserved=null;
  await refreshState();
  const id=result.id??result.batch_id??result.batch?.id;
  const collection=pending.kind==='upload'?'imports':pending.body?.action==='mapping.save'?'mappings':pending.body?.action==='batch.prepare'?'batches':pending.body?.action==='missing.refresh'?'missing_snapshots':null;
  if(collection&&typeof id==='string')await inspect(collection,id);
  if(model.selection.batches&&pending.body?.action?.startsWith('batch.'))await inspect('batches',model.selection.batches);
  notice('Original request retained at revision '+response.revision+'.');
  return response;
 }catch(error){
  if(model.pending){model.pendingObserved={status:'UNCONFIRMED',error:{code:error.code,message:error.message,http_status:error.status}};renderPending();}
  showError(error);throw error;
 }finally{model.busy=false;applyBusy();}
}
async function act(action,payload){
 if(model.busy||model.pending)throw new Error('Reconcile the retained original request first.');
 if(!model.state)throw new Error('Connect to the original workspace first.');
 rememberForms();
 const request_id=crypto.randomUUID(),expected_revision=model.state.revision;
 const pending={workspace_id:model.state.workspace_id,request_id,expected_revision,kind:'action',created_at:new Date().toISOString(),body:{action,payload,expected_revision,request_id}};
 writePending(pending);return dispatchPending();
}
async function hash(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function raw(kind,file,format){
 if(model.busy||model.pending)throw new Error('Reconcile the retained original request first.');
 if(!model.state||!file)throw new Error('Choose the complete original file in this workspace.');
 model.busy=true;applyBusy();
 try{
  const bytes=await file.arrayBuffer(),request_id=crypto.randomUUID();
  const pending={workspace_id:model.state.workspace_id,request_id,expected_revision:model.state.revision,kind,created_at:new Date().toISOString(),file:{name:file.name,bytes:bytes.byteLength,sha256:await hash(bytes),format}};
  model.pendingFile=file;writePending(pending);
 }catch(error){model.busy=false;applyBusy();throw error;}
 return dispatchPending();
}
async function reconcilePending(){
 const pending=model.pending;if(!pending)return;
 model.busy=true;applyBusy();
 try{
  let value;try{value=await api('/api/operation?'+new URLSearchParams({id:pending.request_id}));}catch(error){if(error.status===404)value={id:pending.request_id,status:'NOT_FOUND'};else throw error;}
  model.pendingObserved=value;renderPending();
  if(value.status==='COMPLETED'||value.status==='FAILED'){
   model.lastOperation=value;$('last-operation-id').textContent=pending.request_id;$('last-operation').classList.remove('empty');$('last-operation').innerHTML=originalDetail(value,{keys:['id','action','status','started_at','completed_at','revision']});
   writePending(null);model.pendingFile=null;await refreshState();
   notice(value.status==='FAILED'?'The original operation recorded a failure. Its full error is retained in Upload jobs.':'The original operation is complete. Its retained result has been reopened.',value.status==='FAILED'?'warning':'');
  }else notice(value.status==='NOT_FOUND'?'This owner has no saved operation for the original UUID. You may explicitly retry the exact retained request.':value.status==='INTERRUPTED'&&value.recoverable===true?'The original owner identified an interrupted local operation before its commit. You may explicitly resume its exact UUID and input.':'The original operation is still '+value.status+'. Keep its request identity.','warning');
 }catch(error){showError(error);}finally{model.busy=false;applyBusy();}
}
async function download(file){
 const url=safeUrl(file.download_url),response=await fetch(url,{headers:{Authorization:'Bearer '+model.token},cache:'no-store'});
 if(!response.ok){let body;try{body=await response.json();}catch{}throw actionError(body,response.status);}
 const bytes=await response.arrayBuffer(),digest=await hash(bytes);
 if(Number.isSafeInteger(file.bytes)&&bytes.byteLength!==file.bytes)throw new Error('The original download byte length differs.');
 if(file.sha256&&digest!==file.sha256)throw new Error('The original download SHA-256 differs.');
 const blob=new Blob([bytes],{type:response.headers.get('Content-Type')||'application/octet-stream'}),target=URL.createObjectURL(blob);
 const anchor=document.createElement('a');anchor.href=target;anchor.download=String(file.name||file.id||'original-file').replace(/[\\/\0]/g,'_');anchor.click();setTimeout(()=>URL.revokeObjectURL(target),30000);
 notice('Received '+file.name+' · '+bytes.byteLength+' bytes · SHA-256 '+digest+'.');
}
function bindForm(id,action,editor){$(id).addEventListener('submit',event=>{event.preventDefault();try{
 const payload=parseEditor(editor);
 if(action==='batch.submit'&&payload.batch_id!==model.selection.batches)throw new Error('Select and inspect this same batch before confirming its submission.');
 if(action==='batch.submit'&&!$('submit-reviewed').checked)throw new Error('Review the displayed original batch and provider destination first.');
 act(action,payload).catch(showError);
 }catch(error){showError(error);}});}
for(const [id,action,editor]of [
 ['configuration-form','configuration.save','configuration-json'],['mapping-form','mapping.save','mapping-json'],['prepare-form','batch.prepare','prepare-json'],['submit-form','batch.submit','submit-json'],['refresh-form','batch.refresh','refresh-json'],['reconcile-form','batch.reconcile','reconcile-json'],['missing-form','missing.refresh','missing-json'],['export-form','package.export','export-json']
])bindForm(id,action,editor);
document.addEventListener('click',event=>{
 const nav=event.target.closest('[data-section],[data-goto]');if(nav){event.preventDefault();selectSection(nav.dataset.section??nav.dataset.goto);}
 const select=event.target.closest('[data-select]');if(select)inspect(select.dataset.select,select.dataset.id).catch(showError);
 const page=event.target.closest('[data-page]');if(page&&!page.disabled){const scope=page.dataset.page;if(scope==='batch-records'){model.batchRecords.offset=Number(page.dataset.offset);loadBatchRecords().catch(showError);}else if(scope==='provider'){model.pages[model.providerKind].offset=Number(page.dataset.offset);loadProviderList().catch(showError);}else if(scope==='missing-records'){model.missingRecords.offset=Number(page.dataset.offset);loadMissingRecords().catch(showError);}else{model.pages[scope].offset=Number(page.dataset.offset);loadList(scope).catch(showError);}}
 const provider=event.target.closest('[data-provider]');if(provider){model.providerKind=provider.dataset.provider;loadProviderList().catch(showError);}
 const button=event.target.closest('[data-download]');if(button)download(JSON.parse(decodeURIComponent(button.dataset.download))).catch(showError);
});
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();selectSection('overview');});
document.querySelectorAll('textarea').forEach(el=>el.addEventListener('input',()=>{rememberForms();if(el.id==='submit-json')$('submit-reviewed').checked=false;}));
$('refresh').addEventListener('click',()=>refreshState().then(()=>notice('Original workspace refreshed.')).catch(showError));
$('connect-form').addEventListener('submit',event=>{event.preventDefault();try{const url=new URL($('connect-url').value);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.hash)throw new Error('Use the original private 127.0.0.1 console URL.');if(url.origin!==location.origin){location.assign(url.href);return;}model.token=decodeURIComponent(url.hash.slice(1));history.replaceState(null,'',url.pathname+url.hash);$('connect-url').value='';refreshState().catch(showError);}catch(error){showError(error);}});
$('upload-form').addEventListener('submit',event=>{event.preventDefault();raw('upload',$('upload-file').files[0],$('upload-format').value).catch(showError);});
$('restore-form').addEventListener('submit',event=>{event.preventDefault();raw('restore',$('restore-file').files[0],'evidence').catch(showError);});
$('pending-check').addEventListener('click',reconcilePending);
$('pending-retry').addEventListener('click',()=>dispatchPending().catch(()=>{}));
$('pending-file').addEventListener('change',()=>{model.pendingFile=$('pending-file').files[0]??null;renderPending();});
$('mapping-template').addEventListener('click',()=>{$('mapping-json').value=pretty(templates.mapping());rememberForms();});
$('prepare-template').addEventListener('click',()=>{$('prepare-json').value=pretty(templates.prepare());rememberForms();});
$('missing-template').addEventListener('click',()=>{$('missing-json').value=pretty(templates.missing());rememberForms();});
$('mapping-preview').addEventListener('click',()=>{try{const mapping=parseEditor('mapping-json');$('mapping-preview-table').innerHTML='<h3>Device ownership windows</h3>'+table(Array.isArray(mapping.ownership)?mapping.ownership:[],{columns:['meter_id','start_utc','end_utc']})+'<h3>Source channel assignments</h3>'+table(Array.isArray(mapping.entries)?mapping.entries:[],{columns:['source_meter_id','source_series_id','source_channel','leap_meter_id','target_column']});}catch(error){showError(error);}});
$('batch-rows-tab').addEventListener('click',()=>{model.batchRecords.kind='rows';model.batchRecords.offset=0;loadBatchRecords().catch(showError);});
$('batch-issues-tab').addEventListener('click',()=>{model.batchRecords.kind='issues';model.batchRecords.offset=0;loadBatchRecords().catch(showError);});
$('jobs-refresh-detail').addEventListener('click',()=>{if(model.selection.batches)inspect('batches',model.selection.batches).catch(showError);});
$('operation-form').addEventListener('submit',event=>{event.preventDefault();api('/api/operation?'+new URLSearchParams({id:$('operation-id').value.trim()})).then(value=>{$('operation-detail').innerHTML=originalDetail(value,{keys:['id','action','status','revision','started_at','completed_at']});}).catch(showError);});
window.addEventListener('beforeunload',rememberForms);
fillTemplates();
refreshState().catch(error=>{$('connection-panel').hidden=true;if(!model.token||error.status===401||error.status===403)$('connection-panel').hidden=false;showError(error);applyBusy();});
