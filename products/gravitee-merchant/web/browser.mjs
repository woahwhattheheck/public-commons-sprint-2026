// SPDX-License-Identifier: MIT
import {createGraviteeWorkspaceClient,WRITE_METHODS} from '/client.mjs';
const $=id=>document.getElementById(id),pretty=value=>JSON.stringify(value,null,2),form=id=>new FormData($(id));
const state={view:null,records:[],source:null,draft:null,operation:null,history:null,files:[],commissioning:null};
const client=createGraviteeWorkspaceClient({url:location.href});
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function tab(id){document.querySelectorAll('.tab').forEach(section=>section.hidden=section.id!==id);document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-current',button.dataset.tab===id?'page':'false'));}
const errorMessage=error=>error.message+(error.requestId?'\nOriginal request: '+error.requestId:'');
function safe(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){status(errorMessage(error),true);}};}
async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function call(method,input={}){
  if(WRITE_METHODS.includes(method)&&!['refreshOperation','executeOperation','reconcileOperation'].includes(method)){
    const key='gravitee-original-'+await digest(JSON.stringify({method,input}));
    const requestId=input.requestId??sessionStorage.getItem(key)??crypto.randomUUID();sessionStorage.setItem(key,requestId);
    try{const result=await client.action(method,{...input,requestId});sessionStorage.removeItem(key);return result;}catch(error){throw error;}
  }
  return client.action(method,input);
}
const currentTarget=()=>{if(!$('target').value)throw new Error('Save and select the target Management API connection.');return $('target').value;};
function option(select,value,label){const node=document.createElement('option');node.value=value;node.textContent=label;select.append(node);}
function selectOptions(select,rows,value,label){const before=select.value;select.replaceChildren();for(const row of rows)option(select,value(row),label(row));if(rows.some(row=>value(row)===before))select.value=before;}
function button(label,fn){const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',safe(fn));return node;}
function table(host,columns,rows){
  host.replaceChildren();if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No saved records yet.';host.append(empty);return;}
  const wrap=document.createElement('div');wrap.className='table-scroll';const node=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
  columns.forEach(column=>{const cell=document.createElement('th');cell.scope='col';cell.textContent=column.title;tr.append(cell);});head.append(tr);node.append(head);
  const body=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const column of columns){const cell=document.createElement('td'),value=column.value(row);if(value instanceof Node)cell.append(value);else cell.textContent=value??'';tr.append(cell);}body.append(tr);}node.append(body);wrap.append(node);host.append(wrap);
}
const date=value=>value?new Date(value).toLocaleString():'';
function records(kind){return state.records.filter(row=>row.kind===kind);}
const recordColumns=(open=showHistory)=>[
 {title:'Record',value:row=>button(row.label,()=>open(row))},{title:'State',value:row=>row.state},
 {title:'Updated',value:row=>date(row.updatedAt)},{title:'Revision',value:row=>row.revision}];
async function allRecords(){
  const rows=[];let offset=0;while(true){const result=await call('list',{offset,limit:500});rows.push(...result.items);if(result.nextOffset===null)break;offset=result.nextOffset;}return rows;
}
function targetChanged(){
  const target=state.view?.connections.find(row=>row.id===$('target').value);
  $('target-summary').textContent=target?target.connection.managementUrl+'\n'+target.connection.organizationId+' / '+target.connection.environmentId+'\n'+(target.credentialAvailable?'Credential variables available':'Set the named credential variables in the running process.'):'Configure a Management API connection.';
  if(target){selectOptions($('native-operation'),Object.entries(target.contract.operations),row=>row[0],row=>row[0]+' · '+row[1].method);sessionStorage.setItem('gravitee-target',target.id);}
}
async function refresh(){
  const [view,rows]=await Promise.all([call('view'),allRecords()]);state.view=view;state.records=rows;
  $('workspace-identity').textContent='Workspace '+view.workspaceId;
  selectOptions($('target'),view.connections,row=>row.id,row=>row.label);
  const saved=sessionStorage.getItem('gravitee-target');if(view.connections.some(row=>row.id===saved))$('target').value=saved;targetChanged();
  $('counts').replaceChildren();for(const [label,value]of[['Target environments',view.connections.length],['Source bundles',view.counts.source??0],['Native drafts',view.counts.draft??0],['Native operations',view.counts.operation??0]]){
    const node=document.createElement('div');node.className='metric';const count=document.createElement('strong'),caption=document.createElement('span');count.textContent=value;caption.textContent=label;node.append(count,caption);$('counts').append(node);}
  table($('recent-table'),recordColumns(),rows.filter(row=>!['request','connection'].includes(row.kind)).slice(0,12));
  table($('source-table'),recordColumns(row=>loadSource(row.id)),records('source'));
  table($('draft-table'),recordColumns(row=>loadDraft(row.id)),records('draft'));
  table($('connection-table'),[{title:'Connection',value:row=>button(row.label,()=>{$('connection-detail').textContent=pretty(row);})},{title:'Credentials',value:row=>row.credentialAvailable?'Available':'Set environment variables'},{title:'Contract',value:row=>row.contract.release}],view.connections);
  table($('handover-table'),recordColumns(),records('handover'));
  selectOptions($('commission-draft'),records('draft'),row=>row.id,row=>row.label+' · revision '+row.revision);
  renderHistory();status('Workspace refreshed. '+view.activeOperations+' active operation'+(view.activeOperations===1?'':'s')+'.');
}
function renderHistory(){const kind=$('history-kind').value;table($('history-table'),[{title:'Kind',value:row=>row.kind},...recordColumns()],state.records.filter(row=>!kind||row.kind===kind));}
async function decodeObject(reference){const bytes=await client.download(reference);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function saveDownload(bytes,name,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function downloadReference(reference,name){const bytes=await client.download(reference);saveDownload(bytes,name);return bytes.byteLength;}
async function loadSource(id){
  state.source=await call('readSource',{id});state.draft=null;
  const {record,source}=state.source;$('source-detail').hidden=false;$('mapping-panel').hidden=false;$('draft-editor').hidden=true;
  $('source-title').textContent=source.label;$('source-description').textContent=source.dialect+' · '+source.files.length+' original files · '+source.routes.length+' operations · '+source.sourceSha256;
  table($('source-file-table'),[{title:'Original path',value:row=>row.path},{title:'Bytes',value:row=>row.bytes.toLocaleString()},{title:'Source',value:row=>button('Download original',()=>saveDownload(Uint8Array.from(atob(row.base64),c=>c.charCodeAt(0)),row.path.split('/').at(-1),row.mediaType))}],source.files);
  table($('route-table'),[{title:'Method',value:row=>row.method},{title:'Path',value:row=>row.path},{title:'Operation',value:row=>row.operationId},{title:'Source authentication',value:row=>pretty(row.security)}],source.routes);
  $('source-json').textContent=pretty({entry:source.entry,files:source.files.map(({base64,text,...rest})=>rest),originalDocument:source.originalDocument,normalizedOpenAPI:source.normalizedOpenAPI});
  const native=source.nativeDefinition?.api??source.nativeDefinition,fields=$('mapping-form').elements;
  fields.name.value=native?.name??source.normalizedOpenAPI?.info?.title??source.label;fields.apiVersion.value=native?.apiVersion??source.normalizedOpenAPI?.info?.version??'1.0';
  fields.contextPath.value=native?.listeners?.[0]?.paths?.[0]?.path??'';fields.upstream.value=native?.endpointGroups?.[0]?.endpoints?.[0]?.configuration?.target??source.normalizedOpenAPI?.servers?.[0]?.url??'';
  fields.description.value=native?.description??source.normalizedOpenAPI?.info?.description??'';tab('sources');
}
function renderFindings(draft){
  $('mapping-findings').replaceChildren();
  if(!draft.findings.length){const node=document.createElement('p');node.className='small';node.textContent='This source has no additional behavior findings.';$('mapping-findings').append(node);}
  for(const finding of draft.findings){const node=document.createElement('div');node.className='finding';const label=document.createElement('label'),text=document.createElement('span'),detail=document.createElement('p'),input=document.createElement('textarea');
    text.textContent=finding.code+' · '+finding.location;detail.textContent=finding.detail;input.rows=3;input.dataset.finding=finding.id;input.value=draft.resolutions?.[finding.id]??'';label.append(text,input);node.append(detail,label);$('mapping-findings').append(node);}
}
async function loadDraft(id){
  const result=await call('readDraft',{id});await loadSource(result.record.value.source.id);state.draft=result;
  $('mapping-title').textContent=result.draft.label+' · native draft revision '+result.record.revision;
  $('draft-editor').hidden=false;$('draft-body').value=pretty(result.draft.body);$('draft-plans').value=pretty(result.draft.plans??[]);
  renderFindings(result.draft);$('draft-review-summary').textContent=result.review.addressed+' of '+result.review.sourceFindings+' source behavior mappings recorded.';
}
async function renderOperation(record){
  state.operation=record;$('operation-summary').replaceChildren();
  const values=document.createElement('dl');values.className='key-values';
  for(const [key,value]of[['Operation',record.value.operationId],['State',record.value.state],['Request',record.value.requestId],['Provider status',record.value.status??'Pending'],['Original outcome',record.value.originalOutcome??record.value.state],['Native effect matched',record.value.effectMatched===undefined?'Awaiting observation':String(record.value.effectMatched)]]){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;values.append(dt,dd);}$('operation-summary').append(values);
  $('execute-request').disabled=!['PREPARED','DEFERRED'].includes(record.value.state);
  $('refresh-request').disabled=!['PREPARED','STALE','PREPARATION_FAILED'].includes(record.value.state);
  $('reconcile-request').disabled=!record.value.preparation;$('native-selection').hidden=!['OUTCOME_UNKNOWN','DISPATCHED','REJECTED'].includes(record.value.state);
  $('prepared-json').textContent=record.value.preparation?pretty(await decodeObject(record.value.preparation)):pretty(record.value.error??{});
  $('response-json').textContent='';
  if(record.value.response){const response=await decodeObject(record.value.response),{bodyBase64,...metadata}=response;$('response-json').textContent=pretty({...metadata,...(response.json===null&&bodyBase64?{bodyText:new TextDecoder().decode(Uint8Array.from(atob(bodyBase64),c=>c.charCodeAt(0)))}:{})});}
  if(record.value.reconciliation){const observed=await decodeObject(record.value.reconciliation);$('response-json').textContent+='\n\nCurrent observation\n'+pretty(observed);}
  $('import-impact').replaceChildren();if(record.value.definitionImport){const node=document.createElement('div');node.className='impact';node.textContent='Complete-definition import: '+record.value.definitionImport.plansAbsentFromPayload.length+' current plans are absent from the payload. '+record.value.definitionImport.groupSemantics;const pre=document.createElement('pre');pre.textContent=pretty(record.value.definitionImport);node.append(pre);$('import-impact').append(node);}
}
async function showHistory(row){
  const record=await call('get',{kind:row.kind,id:row.id,includeJournal:true});state.history=record;
  $('history-title').textContent=record.value.label??record.value.operationId??record.kind;$('history-detail').textContent=pretty(record);$('history-object').textContent='';
  $('history-native').disabled=!['operation','commissioning','source','draft'].includes(record.kind);$('history-download').disabled=false;
  const contentReference=record.value.captureRef??record.value.sourceRef??record.value.draft??record.value.reference??record.value.response;
  $('history-content').disabled=!contentReference;$('history-content').textContent=record.kind==='handover'?'Download saved handover':'Read original content';
  $('history-continue-capture').hidden=!(record.kind==='capture'&&record.value.state!=='CAPTURED'&&record.value.input);
  table($('journal-table'),[{title:'Sequence',value:row=>row.sequence},{title:'Time',value:row=>date(row.at)},{title:'Event',value:row=>row.event.type},{title:'Original content',value:row=>row.event.reference?button('Read full object',async()=>{$('history-object').textContent=pretty(await decodeObject(row.event.reference));}):row.event.requestSha256??''}],record.journal??[]);
  if(record.kind==='commissioning'){state.commissioning=record;renderCommission(record);}
  tab('history');
}
function renderCommission(record){
  state.commissioning=record;$('commission-result').textContent=pretty(record);$('commission-steps').replaceChildren();
  for(const step of record.value.steps??[]){const node=document.createElement('div');node.className='step';node.append(button(step.name,async()=>{const native=await call('get',{kind:'operation',id:step.operation.id});await renderOperation(native);tab('requests');}));const value=document.createElement('span');value.textContent=step.state;node.append(value);$('commission-steps').append(node);}
  $('resume-commission').hidden=['COMMISSIONED','COMMISSIONED_WITH_DIFFERENCES'].includes(record.value.state);
}
async function updateReadiness(){
  if(!$('commission-draft').value)return;const value=await call('readDraft',{id:$('commission-draft').value});
  $('commission-readiness').textContent=value.draft.label+': '+value.review.addressed+' of '+value.review.sourceFindings+' source behavior mappings recorded. Native body '+value.review.nativeBodySha256+'.';
}
async function collectFiles(input){
  state.files=[];$('source-entry').replaceChildren();
  for(const file of input.files){const array=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<array.length;offset+=32768)binary+=String.fromCharCode(...array.subarray(offset,offset+32768));
    const path=file.webkitRelativePath||file.name;state.files.push({path,base64:btoa(binary),mediaType:file.type||'application/octet-stream'});option($('source-entry'),path,path);}
  const likely=state.files.find(file=>/\.(?:raml|yaml|yml|json)$/i.test(file.path));if(likely)$('source-entry').value=likely.path;
  $('source-file-count').textContent=state.files.length+' complete files selected.';status('Source files loaded. Select the entry contract.');
}
document.querySelectorAll('[data-tab]').forEach(node=>node.addEventListener('click',()=>tab(node.dataset.tab)));
$('refresh').addEventListener('click',safe(refresh));$('target').addEventListener('change',targetChanged);$('history-kind').addEventListener('change',renderHistory);
$('auth-type').addEventListener('change',()=>{$('bearer-fields').hidden=$('auth-type').value!=='bearer';$('basic-fields').hidden=$('auth-type').value!=='basic';});
$('connection-form').addEventListener('submit',safe(async()=>{
  const fields=form('connection-form'),auth=fields.get('authType')==='basic'?{type:'basic',usernameEnv:fields.get('usernameEnv'),passwordEnv:fields.get('passwordEnv')}:{type:'bearer',tokenEnv:fields.get('tokenEnv')};
  const source=$('installed-contract').files[0],contract=source?JSON.parse(await source.text()):null;
  const result=await call('saveConnection',{connection:{label:fields.get('label'),managementUrl:fields.get('managementUrl'),organizationId:fields.get('organizationId'),environmentId:fields.get('environmentId'),auth,allowHttp:fields.has('allowHttp'),gatewayUrls:String(fields.get('gatewayUrls')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean),contract}});
  sessionStorage.setItem('gravitee-target',result.id);await refresh();status('Connection saved with its selected Management API contract.');
}));
$('source-files').addEventListener('change',safe(event=>collectFiles(event.target)));$('source-directory').addEventListener('change',safe(event=>collectFiles(event.target)));
$('source-form').addEventListener('submit',safe(async()=>{
  const fields=form('source-form');status('Importing the complete original source bundle…');const record=await call('importSource',{files:state.files,entry:fields.get('entry'),label:fields.get('label')||undefined});await refresh();await loadSource(record.id);status('Original source bundle imported.');
}));
$('mapping-form').addEventListener('submit',safe(async()=>{
  if(!state.source)throw new Error('Select the original source bundle.');const fields=form('mapping-form');
  const security={type:fields.get('security'),configuration:JSON.parse(fields.get('securityConfiguration')||'{}')};
  const mapping={name:fields.get('name'),apiVersion:fields.get('apiVersion'),contextPath:fields.get('contextPath'),upstream:fields.get('upstream'),
    description:fields.get('description'),security,visibility:fields.get('visibility')};
  if(state.source.source.nativeDefinition)mapping.nativeDefinition=state.source.source.nativeDefinition;
  const record=await call('saveDraft',{sourceId:state.source.record.id,sourceRevision:state.source.record.revision,mapping});await refresh();await loadDraft(record.id);status('Complete native draft saved. Record any remaining source behavior mappings below.');
}));
$('save-draft').addEventListener('click',safe(async()=>{
  if(!state.draft)throw new Error('Open a saved draft.');const draft=structuredClone(state.draft.draft);draft.body=JSON.parse($('draft-body').value);draft.plans=JSON.parse($('draft-plans').value);draft.label=(draft.body.api??draft.body).name??draft.label;draft.resolutions={};
  document.querySelectorAll('[data-finding]').forEach(input=>draft.resolutions[input.dataset.finding]=input.value);
  const record=await call('saveDraft',{sourceId:state.source.record.id,sourceRevision:state.source.record.revision,id:state.draft.record.id,expectedRevision:state.draft.record.revision,draft});
  await refresh();await loadDraft(record.id);status('Draft revision '+record.revision+' saved with its full native definition and source mappings.');
}));
$('use-draft-request').addEventListener('click',safe(async()=>{
  if(!state.draft)throw new Error('Open a saved draft.');$('native-operation').value=state.draft.draft.operationId;$('native-body').value=pretty(state.draft.draft.body);tab('requests');
}));
$('use-draft-commission').addEventListener('click',safe(async()=>{if(!state.draft)throw new Error('Open a saved draft.');$('commission-draft').value=state.draft.record.id;await updateReadiness();tab('commissioning');}));
$('capture-form').addEventListener('submit',safe(async()=>{
  const fields=form('capture-form'),ids=String(fields.get('apiIds')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);status('Capturing the original environment and API pages…');
  const record=await call('capture',{connectionId:currentTarget(),label:fields.get('label'),...(ids.length?{apiIds:ids}:{})});await refresh();await showHistory(record);status('Capture finished with state '+record.value.state+'.');
}));
$('note-form').addEventListener('submit',safe(async()=>{const fields=form('note-form');await call('addNote',{label:fields.get('label'),note:fields.get('note')});await refresh();status('Operating note saved.');}));
$('request-form').addEventListener('submit',safe(async()=>{
  const fields=form('request-form'),parameters={query:JSON.parse(fields.get('query')||'{}')};
  for(const key of ['apiId','planId','pageId','eventId'])if(fields.get(key))parameters[key]=fields.get(key);
  if(String(fields.get('body')).trim())parameters.body=JSON.parse(fields.get('body'));
  status('Reading the current native target and preparing its exact request…');
  const record=await call('prepareOperation',{connectionId:currentTarget(),operationId:fields.get('operationId'),parameters});await renderOperation(record);await refresh();tab('requests');status('Native request '+record.value.state+'.');
}));
$('execute-request').addEventListener('click',safe(async()=>{status('Executing the original prepared native request…');const record=await call('executeOperation',{id:state.operation.id,planSha256:state.operation.value.planSha256});await renderOperation(record);await refresh();status('Original native result: '+record.value.state+'.');}));
$('refresh-request').addEventListener('click',safe(async()=>{const record=await call('refreshOperation',{id:state.operation.id});await renderOperation(record);status('Current target captured for the original unsent request.');}));
$('reconcile-request').addEventListener('click',safe(async()=>{
  const input={id:state.operation.id};if($('resolved-api-id').value)input.apiId=$('resolved-api-id').value;if($('resolved-plan-id').value)input.planId=$('resolved-plan-id').value;
  status('Reading the current native API and original operation result…');const record=await call('reconcileOperation',input);await renderOperation(record);await refresh();status('Current native observation saved. Original outcome: '+(record.value.originalOutcome??record.value.state)+'.');
}));
$('commission-draft').addEventListener('change',safe(updateReadiness));
$('commission-form').addEventListener('submit',safe(async()=>{
  const fields=form('commission-form'),selected=await call('readDraft',{id:fields.get('draftId')});
  const input={connectionId:currentTarget(),draftId:selected.record.id,draftRevision:selected.record.revision,mappingSha256:selected.review.mappingSha256,
    label:fields.get('label')||selected.draft.label,publishPlans:fields.has('publishPlans'),publishAPI:fields.has('publishAPI'),start:fields.has('start'),deploy:fields.has('deploy'),
    review:{request:fields.has('requestReview'),accept:fields.has('acceptReview'),message:fields.get('reviewMessage')},
    deploymentLabel:fields.get('deploymentLabel')||selected.draft.label.slice(0,32),probes:[]};
  if(fields.get('probePath'))input.probes.push({gatewayIndex:Number(fields.get('gatewayIndex')),path:fields.get('probePath'),method:'GET',expectedStatus:Number(fields.get('expectedStatus')),headerEnv:JSON.parse(fields.get('headerEnv')||'{}')});
  status('Running the saved commissioning sequence. Refresh or reopen History to see retained progress.');const record=await call('commission',input);renderCommission(record);await refresh();status('Commissioning state: '+record.value.state+'.');
}));
$('resume-commission').addEventListener('click',safe(async()=>{if(!state.commissioning?.value.input)throw new Error('Select the original commissioning record.');const record=await call('commission',state.commissioning.value.input);renderCommission(record);await refresh();tab('commissioning');status('Original commissioning sequence: '+record.value.state+'.');}));
$('history-native').addEventListener('click',safe(async()=>{
 const record=await call('get',{kind:state.history.kind,id:state.history.id});
 if(record.kind==='source'){await loadSource(record.id);return;}
 if(record.kind==='draft'){await loadDraft(record.id);return;}
 if(record.kind==='commissioning'){renderCommission(record);tab('commissioning');return;}
 await renderOperation(record);tab('requests');
}));
$('history-content').addEventListener('click',safe(async()=>{
 const record=state.history,reference=record.value.captureRef??record.value.sourceRef??record.value.draft??record.value.reference??record.value.response;
 if(!reference)throw new Error('This record has no saved content object.');
 if(record.kind==='handover'){await downloadReference(reference,'gravitee-handover-'+record.id+'.json');status('Original saved handover downloaded.');}
 else{$('history-object').textContent=pretty(await decodeObject(reference));status('Complete original content received.');}
}));
$('history-continue-capture').addEventListener('click',safe(async()=>{
 if(state.history?.kind!=='capture'||!state.history.value.input)throw new Error('Select the original capture.');
 const original=state.history.value.input;status('Continuing the same native API capture…');
 const record=await call('capture',original);await refresh();await showHistory(record);status('Original capture: '+record.value.state+'.');
}));
$('download-source-bundle').addEventListener('click',safe(async()=>{
 if(!state.source)throw new Error('Select the original source bundle.');
 saveDownload(pretty(state.source.source),'gravitee-source-'+state.source.record.id+'.json');status('Complete source bundle downloaded.');
}));
$('history-download').addEventListener('click',safe(async()=>{saveDownload(pretty(state.history),'gravitee-'+state.history.kind+'-'+state.history.id+'.json');status('Complete record downloaded.');}));
$('export-handover').addEventListener('click',safe(async()=>{
  status('Packaging the complete editable workspace and application source…');const result=await call('exportHandover',{includeSoftware:true});
  const count=await downloadReference(result.reference,'gravitee-handover-'+state.view.workspaceId+'.json');$('handover-summary').textContent=result.inspection.totalFiles+' files / '+result.inspection.totalBytes.toLocaleString()+' original bytes. Downloaded package: '+count.toLocaleString()+' bytes. Package '+result.inspection.sha256+'.';
  await refresh();status('Complete handover saved and downloaded.');
}));
await refresh();
