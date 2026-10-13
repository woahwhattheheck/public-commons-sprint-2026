// MIT. Turbolong operating application with durable request, file and receiving recovery.
import {openTurbolongJournal,requestJSON,id,now,errorValue,pretty,parseObject,exampleValue,fileSha256,downloadResponse,downloadJSON} from './journal.mjs';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)],copy=value=>structuredClone(value);
const TABLES=['periods','vaults','acquisitions','operations','sources','incidents','corrections','analyses','reports'];
const PERIOD_TABLES=new Set(['acquisitions','operations','sources','incidents','corrections','analyses','reports']);
const models=new Map(TABLES.map(name=>[name,new Map()])),pages=new Map(),cursors=new Map(),totals=new Map(),draftTimers=new Map();
let token,bootstrap,state,journal,methods=[],native=[],activePeriod='',currentOperation=null,currentAcquisition=null,currentSource=null,currentAnalysis=null,currentReport=null,currentExport=null,reportURL=null,busy=0,initialized=false;
const field=(form,name)=>form.elements.namedItem(name),value=(form,name)=>field(form,name)?.value??'';
const split=value=>String(value??'').split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
const utc=value=>value?new Date(value.endsWith('Z')?value:value+'Z').toISOString():undefined;
const local=value=>value?new Date(value).toISOString().slice(0,19):'';
const formatNumber=value=>typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:5}):value??'—';
const percent=value=>typeof value==='number'?(100*value).toFixed(1)+'%':'Not declared';
const nameOf=(table,id)=>models.get(table)?.get(id)?.name??id??'—';
function failure(code,message){return Object.assign(new Error(message),{code});}
function setStatus(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function problem(error){setStatus((error.code?error.code+': ':'')+error.message,true);}
function element(tag,text,attributes={}){
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;
 for(const [key,value]of Object.entries(attributes))key==='class'?node.className=value:node.setAttribute(key,value);
 return node;
}
function button(label,work){const node=element('button',label,{type:'button'});node.addEventListener('click',()=>perform(work));return node;}
function actions(...items){const node=element('div',undefined,{class:'row'});for(const item of items)if(item)node.append(item);return node;}
function table(target,rows,columns,{empty='No retained records in this selection.'}={}){
 const root=typeof target==='string'?$(target):target;root.replaceChildren();
 if(!rows.length){root.append(element('div',empty,{class:'empty'}));return;}
 const wrap=element('div',undefined,{class:'table-wrap'}),grid=element('table'),head=element('thead'),hr=element('tr');
 columns.forEach(column=>hr.append(element('th',column.label)));head.append(hr);grid.append(head);
 const body=element('tbody');for(const row of rows){const tr=element('tr');for(const column of columns){const td=element('td'),selected=column.value(row);if(selected instanceof Node)td.append(selected);else td.textContent=selected??'';tr.append(td);}body.append(tr);}
 grid.append(body);wrap.append(grid);root.append(wrap);
}
async function perform(work){
 busy++;try{return await work();}catch(error){problem(error);return null;}finally{busy--;await renderRequests().catch(()=>{});}
}
function onSubmit(selector,work){$(selector).addEventListener('submit',event=>{
 event.preventDefault();const form=event.currentTarget,control=event.submitter;if(form.dataset.submitting)return;
 form.dataset.submitting='true';if(control)control.disabled=true;
 perform(()=>work(form)).finally(()=>{delete form.dataset.submitting;if(control)control.disabled=false;});
});}
function headers(extra={}){return {Authorization:'Bearer '+token,'X-Turbolong-Workspace-ID':state.workspaceId,...extra};}
async function read(method,args={}){return requestJSON('/api/invoke',{method:'POST',body:{method,args},headers:headers()});}
function showTab(name){for(const panel of $$('[data-panel]'))panel.hidden=panel.dataset.panel!==name;
 for(const tab of $$('[data-tab]'))tab.setAttribute('aria-current',tab.dataset.tab===name?'page':'false');
 if(initialized)journal.view('tab',name).catch(problem);
}
function remember(tableName,rows){const selected=models.get(tableName);for(const row of rows??[])selected?.set(row.id,row);}
function all(tableName){return [...models.get(tableName).values()].sort((a,b)=>(b.updatedAt??b.createdAt??'').localeCompare(a.updatedAt??a.createdAt??''));}
function selectedRows(tableName){return all(tableName).filter(row=>!activePeriod||!PERIOD_TABLES.has(tableName)||row.periodId===activePeriod);}
function fillOptions(select,rows,{label=row=>row.name??row.id,value=row=>row.id,empty,preserve=true}={}){
 const chosen=select.value,old=[...select.options].find(option=>option.value===chosen)?.textContent;
 select.replaceChildren();if(empty!==undefined)select.append(element('option',empty,{value:''}));
 for(const row of rows)select.append(element('option',label(row),{value:String(value(row))}));
 if(chosen&&![...select.options].some(option=>option.value===chosen)&&preserve)select.append(element('option',old??chosen,{value:chosen}));
 if([...select.options].some(option=>option.value===chosen))select.value=chosen;
}
function populateSelections(){
 fillOptions($('#active-period'),all('periods'),{empty:'All operating periods',label:row=>row.name+' · v'+row.currentVersion});
 $('#active-period').value=activePeriod;
 for(const select of $$('[data-period]')){
  fillOptions(select,all('periods'),{empty:select.required?undefined:'No period selection',label:row=>row.name+' · '+row.network+' · v'+row.currentVersion});
  if(!select.value&&activePeriod)select.value=activePeriod;updateVersion(select,false);
 }
 for(const select of $$('[data-vault]')){fillOptions(select,all('vaults'),{empty:'All / no single vault',label:row=>row.name+' · '+row.network});updateVersion(select,false);}
 fillOptions($('#native-correction'),all('corrections'),{empty:'None',label:row=>row.title+' · '+row.status});
 fillOptions($('#report-analysis'),all('analyses').filter(row=>row.state==='COMPLETE'),{label:row=>row.name+' · '+row.createdAt});
 fillOptions($('#export-report'),all('reports').filter(row=>row.state==='COMPLETE'),{empty:'Select for report delivery',label:row=>row.name+' · '+row.createdAt});
 fillOptions($('#native-connection'),state.connections??[],{value:row=>row.alias,label:row=>row.alias+' · '+(row.network??row.error?.code??'attached')});
 fillOptions($('#native-action'),native,{value:row=>row.action,label:row=>(row.title??row.name??row.action)+' · '+row.action});
}
function updateVersion(select,force){
 const period=select.hasAttribute('data-period'),form=select.closest('form');if(!form)return;
 const control=field(form,period?'periodVersion':'vaultVersion');if(!control)return;
 const selected=models.get(period?'periods':'vaults').get(select.value);
 if(!select.value){control.value='';return;}
 if(force||!control.value)control.value=selected?.currentVersion??'';
}
function scope(form){
 const args={};for(const key of ['periodId','vaultId'])if(value(form,key))args[key]=value(form,key);
 for(const key of ['periodVersion','vaultVersion'])if(value(form,key))args[key]=Number(value(form,key));
 return args;
}
function fullVersion(table,id,version){const row=models.get(table).get(id);return row?.versions?.find(item=>item.version===Number(version||row.currentVersion));}
function renderOverview(){
 $('#stats').replaceChildren();for(const [name,label]of [['periods','Operating periods'],['operations','Operations'],['sources','Source captures'],['reports','Report editions']]){
  const node=element('div',undefined,{class:'stat'});node.append(element('strong',String(state.counts[name])),element('span',label));$('#stats').append(node);
 }
 table('#overview-acquisitions',selectedRows('acquisitions').filter(row=>row.desiredState==='RUNNING'||row.execution),[
  {label:'Acquisition',value:row=>row.name},{label:'Schedule',value:row=>(row.paused?'Paused':row.desiredState)+' · '+(row.execution?.state??'Waiting')},
  {label:'Next run',value:row=>row.nextRunAt??'One cycle'},{label:'Open',value:row=>button('Inspect',()=>selectAcquisition(row.id))}]);
 table('#overview-operations',selectedRows('operations').filter(row=>!['COMPLETED','CANCELED'].includes(row.state)||row.continuationError),[
  {label:'Action',value:row=>row.action},{label:'State',value:row=>row.state+(row.paused?' · paused':'')},{label:'Last outcome',value:row=>row.lastError?.message??row.continuationError?.message??''},
  {label:'Open',value:row=>button('Inspect',()=>selectOperation(row.id))}]);
 table('#overview-incidents',selectedRows('incidents').filter(row=>row.status!=='RESOLVED'),[{label:'Incident',value:row=>row.title},{label:'Severity',value:row=>row.severity},
  {label:'Open',value:row=>button('Update',()=>loadIncident(row.id))}]);
 table('#overview-analyses',selectedRows('analyses').slice(0,8),[{label:'Edition',value:row=>row.name},{label:'State',value:row=>row.state},{label:'Open',value:row=>button('Read',()=>selectAnalysis(row.id))}]);
 table('#connections-table',state.connections??[],[{label:'Alias',value:row=>row.alias},{label:'Network',value:row=>row.network??'—'},
  {label:'Source',value:row=>row.error?.message??row.telemetryUrl??row.connection?.telemetryUrl??'Selected native installation'},
  {label:'Details',value:row=>button('Inspect',()=>showResult(row))}]);
}
function renderRows(name,rows=pages.get(name)??selectedRows(name)){
 const open=(label,fn)=>({label:'Open',value:row=>button(label,()=>fn(row.id))});
 const columns={
  periods:[{label:'Period',value:row=>row.name},{label:'Network',value:row=>row.network},{label:'Version',value:row=>row.currentVersion},
   {label:'Bounds',value:row=>{const d=fullVersion('periods',row.id)?.definition;return d?d.startsAt+' → '+d.endsAt:'';}},open('Load',loadPeriod)],
  vaults:[{label:'Vault',value:row=>row.name},{label:'Network',value:row=>row.network},{label:'Version',value:row=>row.currentVersion},
   {label:'Strategy / pool',value:row=>{const d=fullVersion('vaults',row.id)?.definition;return d?.strategyId??d?.poolId??d?.shareTokenId;}},open('Load',loadVault)],
  acquisitions:[{label:'Acquisition',value:row=>row.name},{label:'Period',value:row=>nameOf('periods',row.periodId)},{label:'Schedule',value:row=>row.desiredState+(row.paused?' · paused':'')},
   {label:'Cycle',value:row=>row.execution?.state??'Not started'},{label:'Completed cycles',value:row=>row.cycles?.length??0},open('Inspect',selectAcquisition)],
  operations:[{label:'Action',value:row=>row.action},{label:'Period / vault',value:row=>nameOf('periods',row.periodId)+' / '+nameOf('vaults',row.vaultId)},
   {label:'State',value:row=>row.state+(row.paused?' · paused':'')},{label:'Retained attempts',value:row=>row.attemptIds?.length??0},open('Inspect',selectOperation)],
  sources:[{label:'Source',value:row=>row.name??row.action??row.kind},{label:'Period',value:row=>nameOf('periods',row.periodId)},
   {label:'Observed',value:row=>row.observedAt},{label:'Status / kind',value:row=>row.stage==='PREPARATION'?'Preparation failure':row.state??row.kind},open('Inspect',selectSource)],
  incidents:[{label:'Incident',value:row=>row.title},{label:'State',value:row=>row.status},{label:'Severity',value:row=>row.severity},
   {label:'Period',value:row=>nameOf('periods',row.periodId)},open('Update',loadIncident)],
  corrections:[{label:'Corrective work',value:row=>row.title},{label:'State',value:row=>row.status},{label:'Recorded effect',value:row=>row.action??'Operating work'},
   {label:'Linked operations',value:row=>row.operationIds?.length??0},open('Update',loadCorrection)],
  analyses:[{label:'Edition',value:row=>row.name},{label:'State',value:row=>row.state},{label:'Period',value:row=>nameOf('periods',row.periodId)},
   {label:'Sources',value:row=>row.sourceIds?.length??0},{label:'Created',value:row=>row.createdAt},open('Read',selectAnalysis)],
  reports:[{label:'Report',value:row=>row.name},{label:'State',value:row=>row.state},{label:'Members',value:row=>row.files?.length??0},
   {label:'Created',value:row=>row.createdAt},{label:'Open',value:row=>actions(button('Read files',()=>selectReport(row.id)),button('Export',()=>{showTab('receiving');field($('#export-form'),'kind').value='report';field($('#export-form'),'reportId').value=row.id;}))}]
 };
 table('#'+name+'-table',rows,columns[name]);$('#more-'+name).hidden=!cursors.get(name);
 $('#count-'+name).textContent=rows.length+' shown'+(totals.has(name)?' / '+totals.get(name)+' selected':'');
}
async function loadTable(name,{more=false}={}){
 const args={table:name,limit:100,...(activePeriod&&PERIOD_TABLES.has(name)?{periodId:activePeriod}:{}),
  ...(more&&cursors.get(name)?{after:cursors.get(name)}:{})};
 const result=await read('records.page',args);remember(name,result.rows);
 pages.set(name,more?[...(pages.get(name)??[]),...result.rows]:result.rows);cursors.set(name,result.nextCursor);totals.set(name,result.total);
 populateSelections();renderRows(name);return result;
}
async function refresh({message=true}={}){
 state=await requestJSON('/api/state',{headers:headers()});for(const name of TABLES)remember(name,state[name]);
 $('#workspace-label').textContent=state.workspaceId+' · revision '+state.revision;
 populateSelections();renderOverview();for(const name of TABLES)if(!pages.has(name))renderRows(name);
 if(!$('#profile-json').dataset.dirty)$('#profile-json').value=pretty(state.profile);
 if(message)setStatus('Workspace refreshed.');return state;
}
async function send(record){
 if(record.method==='source.import'&&record.file){
  $('#upload-progress').textContent='Transferring '+record.fileSelection.size.toLocaleString()+' bytes…';
  return requestJSON('/api/source-import?args='+encodeURIComponent(JSON.stringify(record.args)),{method:'POST',body:record.file,headers:headers({...record.headers,'X-Content-SHA256':record.fileSelection.sha256})});
 }
 if(record.method==='package.unpack'){
  const params=new URLSearchParams({requestId:record.id,...(record.args.expectedManifestSha256?{manifestSha256:record.args.expectedManifestSha256}:{})});
  return requestJSON('/api/packages/unpack?'+params,{method:'POST',body:record.file,headers:headers(record.headers)});
 }
 return requestJSON(record.route,{method:'POST',body:{method:record.method,args:record.args},headers:headers(record.headers)});
}
async function showResult(result){$('#last-result').textContent=pretty(result);await journal.view('lastResult',result);}
function renderExport(result){
 currentExport=result.export??result;$('#export-selected').hidden=false;
 $('#export-summary').textContent=(currentExport.files??'Complete')+' files · '+formatNumber(currentExport.bytes)+' bytes · '+currentExport.kind+' delivery';
 $('#export-detail').textContent=pretty(currentExport);
}
function showReceiving(result){
 $('#receiving-detail').textContent=pretty(result);const root=$('#receiving-handoff');root.hidden=false;root.replaceChildren(element('h4','Received installation'));
 if(result.application&&result.workspace){root.append(element('p','Open the received application with this host’s private connection configuration. Acquisition schedules and unresolved operations start paused.'),
  element('pre','node '+JSON.stringify(result.application.cli)+' serve --workspace '+JSON.stringify(result.workspace.directory)+' --connections-file /private/turbolong-received-connections.json --port 8779 --startup-format json'),
  element('pre',pretty({workspaceId:result.workspace.workspaceId,runtimes:result.application.runtimeConnections})));
 }else root.append(element('pre',pretty(result.report??result)));
}
async function applyResult(result,record){
 if(Number.isSafeInteger(result.revision))state.revision=Math.max(state.revision,result.revision);
 await showResult(result);
 for(const [key,tableName]of Object.entries({period:'periods',vault:'vaults',acquisition:'acquisitions',operation:'operations',source:'sources',incident:'incidents',correction:'corrections',analysis:'analyses',report:'reports'}))
  if(result[key]?.id)remember(tableName,[result[key]]);
 if(result.operation){await journal.view('selectedOperation',result.operation.id);renderOperation(result.operation);}
 if(result.acquisition){currentAcquisition={acquisition:result.acquisition,version:result.acquisition.versions?.find(v=>v.version===result.acquisition.currentVersion),operations:[]};renderAcquisition(currentAcquisition);}
 if(record.method==='workspace.export'||record.method==='report.export'){renderExport(result);await journal.view('currentExport',currentExport);}
 if(record.method==='package.unpack'){
  field($('#receive-form'),'sourceDirectory').value=result.sourceDirectory;field($('#receive-form'),'expectedManifestSha256').value=result.manifestSha256;
  $('#receiving-detail').textContent=pretty(result);await journal.view('unpacked',result);
 }
 if(record.method==='package.receive'){showReceiving(result);await journal.view('received',result);}
 if(record.method==='profile.save')delete $('#profile-json').dataset.dirty;
 if(record.method==='source.import')$('#upload-progress').textContent='Complete source retained.';
 await refresh({message:false});
 if(result.analysis?.state==='COMPLETE'){await selectAnalysis(result.analysis.id,{navigate:false});}
 if(result.report?.state==='COMPLETE'){await selectReport(result.report.id,{navigate:false});}
 setStatus(record.method+' completed'+(result.error?' with retained '+result.error.code:'')+'.',Boolean(result.error));
}
async function mutate(method,args={},metadata={}){
 const spec=methods.find(row=>row.name===method);if(!spec?.mutates){const result=await read(method,args);await showResult(result);return result;}
 const requestId=args.requestId??id(),selected={...args,requestId};
 if(spec.required.includes('expectedRevision')&&selected.expectedRevision===undefined)selected.expectedRevision=state.revision;
 const record=await journal.enqueue({requestId,method,args:selected,metadata});return journal.execute(record,send,applyResult);
}
async function renderRequests(){
 if(!journal)return;const rows=(await journal.requests()).filter(row=>row.state!=='CANCELED'&&(row.state!=='COMPLETE'||!row.appliedAt));
 table('#requests-table',rows,[{label:'Request',value:row=>row.id},{label:'Action',value:row=>row.method},{label:'State',value:row=>row.state},
  {label:'Outcome',value:row=>row.error?.message??''},{label:'Recover',value:row=>actions(
   button('Inspect',()=>{$('#request-detail').textContent=pretty({...row,file:row.fileSelection});}),
   button('Retry same request',()=>journal.execute(row,send,applyResult)),
   row.state==='REVISION_CONFLICT'?button('Refresh rejected revision',async()=>{await refresh({message:false});const next=await journal.rebase(row,state.revision);return journal.execute(next,send,applyResult);}):null,
   ['READY','REJECTED','REVISION_CONFLICT'].includes(row.state)?button('Cancel unsent request',()=>journal.cancel(row)):null)}]);
}
async function recoverRequests(){
 for(const row of await journal.requests()){
  if(!['READY','SENDING','UNCERTAIN'].includes(row.state)&&!(row.state==='COMPLETE'&&!row.appliedAt))continue;
  try{await journal.execute(row,send,applyResult);}catch(error){problem(error);if(['WORKSPACE_IDENTITY_MISMATCH','WORKSPACE_IDENTITY_REQUIRED','UNAUTHORIZED'].includes(error.code))break;}
 }await renderRequests();
}
async function download(route,filename){
 const response=await requestJSON(route,{headers:headers(),binary:true});
 const result=await downloadResponse(response,filename,{onProgress:bytes=>{$('#download-progress').textContent=bytes.toLocaleString()+' bytes saved';}});
 setStatus(result.bytes.toLocaleString()+' bytes downloaded.');return result;
}

function setForm(form,data){for(const [key,item]of Object.entries(data)){const selected=field(form,key);if(!selected)continue;
 selected.value=item===null||item===undefined?'':typeof item==='object'?pretty(item):String(item);}}
function extra(form){return parseObject(value(form,'extra')||'{}','Additional fields');}
async function loadPeriod(periodId,version){
 const result=await read('period.read',{periodId,...(version?{version}: {})});remember('periods',[result.period]);populateSelections();
 const d=result.version.definition,form=$('#period-form');setForm(form,{...d,periodId,name:result.version.name,startsAt:local(d.startsAt),endsAt:local(d.endsAt),
  surfaces:(d.surfaces??[]).join(', '),healthDimensions:(d.healthDimensions??[]).join(', '),...d.acceptance,extra:d});
 $('#period-editor-title').textContent=result.period.name+' · editing from version '+result.version.version;showTab('periods');await saveDraft(form);
}
async function loadVault(vaultId,version){
 const result=await read('vault.read',{vaultId,...(version?{version}:{})});remember('vaults',[result.vault]);populateSelections();
 setForm($('#vault-form'),{...result.version.definition,vaultId,name:result.version.name,extra:result.version.definition});
 $('#vault-editor-title').textContent=result.vault.name+' · editing from version '+result.version.version;showTab('periods');await saveDraft($('#vault-form'));
}
function renderAcquisition(result){
 currentAcquisition=result;const row=result.acquisition;$('#acquisition-selected').hidden=false;$('#acquisition-title').textContent=row.name;
 $('#acquisition-summary').textContent=row.id+' · '+row.desiredState+(row.paused?' · paused':'')+' · '+(row.cycles?.length??0)+' completed cycles'+(row.nextRunAt?' · next '+row.nextRunAt:'');
 table('#acquisition-progress',result.operations??[],[{label:'Action',value:r=>r.action},{label:'State',value:r=>r.state},{label:'Sources',value:r=>r.sourceIds?.length??0},
  {label:'Open',value:r=>button('Inspect operation',()=>selectOperation(r.id))}]);
 $('#acquisition-detail').textContent=pretty(result);
}
async function selectAcquisition(acquisitionId){const result=await read('acquisition.read',{acquisitionId});remember('acquisitions',[result.acquisition]);renderAcquisition(result);showTab('acquisitions');await journal.view('selectedAcquisition',acquisitionId);}
function readOnlyActions(){return native.filter(item=>item.readOnly===true&&item.mutates!==true);}
function addQuery(query={}){
 const node=element('div',undefined,{class:'query'}),grid=element('div',undefined,{class:'grid'}),connection=element('select'),action=element('select'),name=element('input'),maxPages=element('input');
 connection.dataset.query='connection';action.dataset.query='action';name.dataset.query='name';maxPages.dataset.query='maxPages';maxPages.type='number';maxPages.min='1';maxPages.step='1';maxPages.placeholder='All provider pages';
 fillOptions(connection,state.connections??[],{value:r=>r.alias,label:r=>r.alias});fillOptions(action,readOnlyActions(),{value:r=>r.action,label:r=>r.title??r.name??r.action});
 if(query.connection)connection.value=query.connection;if(query.action)action.value=query.action;name.value=query.name??'';maxPages.value=query.maxPages??'';
 for(const [label,control]of [['Connection',connection],['Action',action],['Name',name],['Page cap (optional)',maxPages]]){const wrap=element('label',label);wrap.append(control);grid.append(wrap);}
 const args=element('textarea');args.dataset.query='args';args.spellcheck=false;args.value=pretty(query.args??exampleValue(native.find(r=>r.action===action.value)?.inputSchema)??{});
 const vault=element('select');vault.dataset.query='vaultId';fillOptions(vault,all('vaults'),{empty:'No single vault'});if(query.vaultId)vault.value=query.vaultId;
 const vaultVersion=element('input');vaultVersion.type='number';vaultVersion.min='1';vaultVersion.dataset.query='vaultVersion';vaultVersion.value=query.vaultVersion??'';
 const vaultLabel=element('label','Vault selection (optional)');vaultLabel.append(vault);const versionLabel=element('label','Vault version');versionLabel.append(vaultVersion);grid.append(vaultLabel,versionLabel);
 vault.addEventListener('change',()=>{vaultVersion.value=models.get('vaults').get(vault.value)?.currentVersion??'';scheduleDraft($('#acquisition-form'));});
 action.addEventListener('change',()=>{args.value=pretty(exampleValue(native.find(r=>r.action===action.value)?.inputSchema)??{});syncQueryScope(node);scheduleDraft($('#acquisition-form'));});
 node.append(grid,element('p','Complete native query arguments',{class:'muted'}),args,button('Remove query',()=>{node.remove();scheduleDraft($('#acquisition-form'));}));
 $('#acquisition-queries').append(node);syncQueryScope(node);
 node.addEventListener('input',()=>scheduleDraft($('#acquisition-form')));node.addEventListener('change',()=>scheduleDraft($('#acquisition-form')));return node;
}
function queryValues(node){
 const get=key=>node.querySelector('[data-query="'+key+'"]').value;
 return {connection:get('connection'),action:get('action'),args:parseObject(get('args'),'Query arguments'),
  ...(get('name')?{name:get('name')}:{}),...(get('maxPages')?{maxPages:Number(get('maxPages'))}:{}),
  ...(get('vaultId')?{vaultId:get('vaultId'),...(get('vaultVersion')?{vaultVersion:Number(get('vaultVersion'))}:{})}:{})};
}
function readQueries(){return $$('#acquisition-queries .query').map(queryValues);}
function syncQueryScope(node){
 const form=$('#acquisition-form'),period=fullVersion('periods',value(form,'periodId'),value(form,'periodVersion'))?.definition;
 if(!period)return;const control=node.querySelector('[data-query="args"]'),action=node.querySelector('[data-query="action"]').value;
 let args;try{args=parseObject(control.value);}catch{return;}const properties=native.find(r=>r.action===action)?.inputSchema?.properties??{};
 for(const key of ['network','startsAt','endsAt'])if(Object.hasOwn(properties,key))args[key]=period[key];control.value=pretty(args);
}
async function editAcquisition(){
 if(!currentAcquisition)throw new Error('Select an acquisition.');const {acquisition:row,version}=currentAcquisition,d=version.definition;
 setForm($('#acquisition-form'),{...d,acquisitionId:row.id,name:version.name,extra:d});$('#acquisition-queries').replaceChildren();for(const query of d.queries)addQuery(query);
 $('#acquisition-editor-title').textContent=row.name+' · editing from version '+version.version;await saveDraft($('#acquisition-form'));
}
async function acquisitionAction(method){
 if(!currentAcquisition)throw new Error('Select an acquisition.');const row=currentAcquisition.acquisition;
 let args={acquisitionId:row.id};if(method==='acquisition.run'&&row.execution&&!['COMPLETE','CANCELED'].includes(row.execution.state)&&row.execution.requestArgs)
  args={...copy(row.execution.requestArgs),expectedRevision:state.revision};
 await mutate(method,args);await selectAcquisition(row.id);await loadTable('acquisitions');
}
function renderNativeArguments(args,reset=false){
 const spec=native.find(row=>row.action===$('#native-action').value);if(!spec)return;
 if(reset)args=exampleValue(spec.inputSchema)??{};args=copy(args??{});
 const root=$('#native-arguments');root.replaceChildren();
 $('#native-description').textContent=(spec.description??spec.title??spec.name??spec.action)+(spec.mutates?' This action uses the selected native write path. Preparation and dispatch remain separate.':'');
 $('#native-contract').textContent=pretty(spec);
 for(const [name,schema]of Object.entries(spec.inputSchema.properties??{})){
  const types=Array.isArray(schema.type)?schema.type:[schema.type],kind=types.includes('object')||types.includes('array')||schema.properties||schema.oneOf||schema.anyOf?'json':types.includes('boolean')?'boolean':types.includes('integer')||types.includes('number')?'number':'string';
  const required=(spec.inputSchema.required??[]).includes(name),nullable=types.includes('null'),wrap=element('label',name+(required?' *':''),{class:'native-argument'+(kind==='json'?' wide':'')});
  let control;
  if(schema.enum){control=element('select');if(!required)control.append(element('option','Not supplied',{value:''}));for(const item of schema.enum)control.append(element('option',String(item),{value:String(item)}));control.dataset.enum=pretty(schema.enum);}
  else if(kind==='boolean'){control=element('select');if(!required)control.append(element('option','Not supplied',{value:''}));control.append(element('option','False',{value:'false'}),element('option','True',{value:'true'}));}
  else if(kind==='json'){control=element('textarea');control.spellcheck=false;}
  else{control=element('input');if(kind==='number'){control.type='number';control.step=types.includes('integer')?'1':'any';if(schema.minimum!==undefined)control.min=String(schema.minimum);if(schema.maximum!==undefined)control.max=String(schema.maximum);}}
  control.dataset.nativeName=name;control.dataset.kind=kind;control.dataset.nullable=String(nullable);control.dataset.required=String(required);
  control.name='native_arg:'+name;if(required&&!nullable)control.required=true;
  const selected=args[name];control.value=selected===undefined?'':selected===null?(kind==='json'?'null':''):kind==='json'?pretty(selected):String(selected);
  control.addEventListener('input',()=>{try{$('#native-args').value=pretty(readNativeArguments());}catch{}scheduleDraft($('#native-form'));});
  wrap.append(control);if(schema.description)wrap.append(element('small',schema.description));root.append(wrap);
 }
 $('#native-args').value=pretty(args);
}
function readNativeArguments(){
 const args=parseObject($('#native-args').value||'{}','Native arguments');
 for(const control of $$('#native-arguments [data-native-name]')){
  const key=control.dataset.nativeName,raw=control.value,required=control.dataset.required==='true',nullable=control.dataset.nullable==='true';
  if(raw===''){if(required&&nullable)args[key]=null;else if(required)args[key]='';else delete args[key];continue;}
  if(control.dataset.enum){const variants=JSON.parse(control.dataset.enum),match=variants.find(item=>String(item)===raw);args[key]=match;}
  else if(control.dataset.kind==='json')args[key]=JSON.parse(raw);
  else if(control.dataset.kind==='boolean')args[key]=raw==='true';
  else if(control.dataset.kind==='number'){const n=Number(raw);if(!Number.isFinite(n))throw new Error('Supply a number for '+key+'.');args[key]=n;}
  else args[key]=raw;
 }return args;
}
function syncNativeScope(){
 const form=$('#native-form'),period=fullVersion('periods',value(form,'periodId'),value(form,'periodVersion'))?.definition;
 let args;try{args=readNativeArguments();}catch{return;}const properties=native.find(row=>row.action===value(form,'action'))?.inputSchema?.properties??{};
 if(period)for(const key of ['network','startsAt','endsAt'])if(Object.hasOwn(properties,key))args[key]=period[key];
 renderNativeArguments(args);scheduleDraft(form);
}
function useSelectedVault(){
 const form=$('#native-form'),d=fullVersion('vaults',value(form,'vaultId'),value(form,'vaultVersion'))?.definition;
 if(!d)throw new Error('Select a saved vault version.');const action=value(form,'action'),args=readNativeArguments();
 if(action==='vault.inspect'){args.strategyId=d.strategyId;args.symbol=d.symbol;}
 else if(action==='vault.shareInspect')args.tokenId=d.shareTokenId;
 else if(action.startsWith('keeper.')){const selected={symbol:d.symbol,strategyId:d.strategyId};
  if(action.startsWith('keeper.harvest.'))Object.assign(selected,{underlyingClassic:d.underlyingClassic??null,underlyingSoroban:d.underlyingSoroban,...(d.swapVia?{swapVia:d.swapVia}:{})});
  args.vaults=[selected];
 }else if(action==='snapshots.list'){if(d.poolId)args.pool_id=d.poolId;args.asset=d.symbol;}
 else if(action==='routes.list')args.strategy_id=d.strategyId;
 else throw new Error('This action requires its own complete arguments; the selected vault remains attached to its source scope.');
 renderNativeArguments(args);scheduleDraft(form);
}
function renderOperation(row,details={}){
 currentOperation=row;$('#operation-selected').hidden=false;$('#operation-title').textContent=row.action;
 $('#operation-summary').textContent=row.id+' · '+row.state+(row.paused?' · paused':'')+' · '+row.attemptIds.length+' retained attempts';
 $('#operation-detail').textContent=pretty({...details,operation:row});
 const coverage=row.pagination?.coverage;$('#operation-coverage').textContent=row.nextRequest?'A complete provider continuation is retained. Collect pages to continue.':
  coverage?.kind==='latest-window'?'The provider returned its current retained route window. Older period rows require keeper history.':
  row.pagination?.complete===true?'The selected provider read reached its terminal page. Period coverage is assessed separately in the analysis.':
  row.continuationError?'The next-page preparation failed; the acquired page remains retained. Reconcile this operation.':'';
 for(const control of $$('[data-operation-action]')){
  const method=control.dataset.operationAction;
  control.disabled=method==='operation.run'&&(row.paused||!(row.state==='PREPARED'||['COMPLETED','PARTIAL'].includes(row.state)&&row.nextRequest))||
   method==='operation.collect'&&(row.catalogue?.readOnly!==true||row.catalogue?.mutates===true||row.paused)||
   method==='operation.cancel'&&row.attemptIds.length>0;
 }
 const reprepare=$('#operation-reprepare');if(reprepare)reprepare.disabled=!(row.state==='FAILED'&&row.preparation?.failed&&row.attemptIds.length===0);
 table('#operation-attempts',details.attempts??[],[{label:'Attempt',value:r=>r.id},{label:'State',value:r=>r.state??r.status},{label:'Started',value:r=>r.startedAt},{label:'Mode',value:r=>r.mode??r.kind??''}]);
 table('#operation-sources',details.sources??[],[{label:'Source',value:r=>r.id},{label:'Kind',value:r=>r.kind},{label:'State',value:r=>r.state},{label:'Read',value:r=>button('Inspect',()=>selectSource(r.id))}]);
}
async function selectOperation(operationId){const result=await read('operation.read',{operationId});remember('operations',[result.operation]);renderOperation(result.operation,result);showTab('operations');await journal.view('selectedOperation',operationId);}
async function operationAction(method){
 if(!currentOperation)throw new Error('Select an operation.');const row=currentOperation;let args={operationId:row.id};
 if(method==='operation.collect'&&row.collector&&!['COMPLETE','CANCELED'].includes(row.collector.state)&&row.collector.requestArgs)args={...copy(row.collector.requestArgs),expectedRevision:state.revision};
 await mutate(method,args);await selectOperation(row.id);await loadTable('operations');
}
async function reprepareOperation(){
 const row=currentOperation;if(!row)throw new Error('Select an operation.');const form=$('#native-form');
 setForm(form,{...row.scope,operationId:row.id,connection:row.connection,action:row.action,correctionId:row.correctionId??''});
 renderNativeArguments(row.args);await saveDraft(form);form.scrollIntoView({behavior:'smooth'});
}
async function selectSource(sourceId){
 const result=await read('source.read',{sourceId}),row=result.source;remember('sources',[row]);currentSource=row;$('#source-selected').hidden=false;
 $('#source-title').textContent=row.name??row.action??row.kind;$('#source-summary').textContent=row.id+' · '+row.kind+' · '+(row.observedAt??row.createdAt);
 const members=[{label:'Source metadata',file:row.file},...(row.body?[{label:row.name??'Complete imported file',file:row.body}]:[]),
  ...(row.members??[]).map(member=>({label:'Observation '+member.index+' · '+member.part,file:member.file}))];
 table('#source-members',members,[{label:'Member',value:r=>r.label},{label:'Bytes',value:r=>formatNumber(r.file.bytes)},{label:'SHA256',value:r=>r.file.sha256},
  {label:'Download',value:r=>button('Download',()=>download('/api/sources/'+row.id+'/file?path='+encodeURIComponent(r.file.path),r.file.path.split('/').at(-1)))}]);
 $('#source-detail').textContent=pretty(result);showTab('sources');await journal.view('selectedSource',sourceId);
}
async function loadIncident(incidentId){
 const result=await read('incident.read',{incidentId}),row=result.incident;remember('incidents',[row]);populateSelections();
 setForm($('#incident-form'),{...row,incidentId,sourceIds:(row.sourceIds??[]).join(', '),startedAt:local(row.startedAt??row.createdAt),resolvedAt:local(row.resolvedAt),extra:currentWorkFields(row)});
 $('#incident-editor-title').textContent=row.title+' · '+row.history.length+' updates';$('#work-history').textContent=pretty(result);showTab('incidents');await saveDraft($('#incident-form'));
}
function currentWorkFields(row){const result=copy(row);for(const key of ['id','history','createdAt','updatedAt'])delete result[key];return result;}
async function loadCorrection(correctionId){
 const result=await read('correction.read',{correctionId}),row=result.correction;remember('corrections',[row]);populateSelections();
 setForm($('#correction-form'),{...row,correctionId,sourceIds:(row.sourceIds??[]).join(', '),incidentIds:(row.incidentIds??[]).join(', '),operationIds:(row.operationIds??[]).join(', '),
  targetSourceId:row.target?.sourceId??row.sourceId??'',targetRowId:row.target?.rowId??row.rowId??'',extra:currentWorkFields(row)});
 $('#correction-editor-title').textContent=row.title+' · '+row.history.length+' updates';$('#work-history').textContent=pretty(result);showTab('incidents');await saveDraft($('#correction-form'));
}
function metric(root,label,number){const node=element('div',undefined,{class:'stat'});node.append(element('strong',formatNumber(number)),element('span',label));root.append(node);}
async function selectAnalysis(analysisId,{navigate=true}={}){
 const result=await read('analysis.read',{analysisId}),row=result.analysis;remember('analyses',[row]);currentAnalysis=result;populateSelections();
 $('#analysis-selected').hidden=false;$('#analysis-title').textContent=row.name+' · '+row.state;$('#analysis-detail').textContent=pretty(result);
 const data=result.record?.analysis;$('#analysis-stats').replaceChildren();
 if(data){
  for(const [key,label]of [['selectedSources','Selected sources'],['includedRecords','Included records'],['verifiedGroupedMainnetHarvests','Correlated mainnet harvests'],['longestGreenOperatingDays','Consecutive operating days']])metric($('#analysis-stats'),label,data.summary[key]);
  table('#analysis-acceptance',data.acceptance??[],[{label:'Operating target',value:r=>r.name},{label:'Observed',value:r=>formatNumber(r.observed)},{label:'Target',value:r=>formatNumber(r.target)},{label:'Basis',value:r=>r.unit},{label:'State',value:r=>r.status}]);
  table('#analysis-rates',data.rates?.series??[],[{label:'Asset / pool',value:r=>r.assetSymbol+' / '+r.poolId},{label:'Observations',value:r=>formatNumber(r.observations)},
   {label:'Available days',value:r=>formatNumber(r.availableHistoryDays)},{label:'Cadence coverage',value:r=>percent(r.coverageRatio)}]);
  const coverage=[...(data.coverage?.snapshotHistories??[]).map(r=>({kind:'Snapshot history',state:r.complete?'Complete cursor chain':'Incomplete cursor chain',description:(r.pages?.length??0)+' pages; '+(r.problems??[]).map(p=>p.code).join(', ')})),
   ...(data.coverage?.latestRouteWindows??[]).map(r=>({kind:'Route telemetry',state:'Latest provider window',description:(r.returnedRows??r.rows??'Retained')+' rows; older period history requires source logs'})),
   ...(data.coverage?.originalFiles??[]).map(r=>({kind:'Keeper / source file',state:'Complete selected file',description:r.sourceId}))];
  table('#analysis-coverage',coverage,[{label:'Source',value:r=>r.kind},{label:'Coverage',value:r=>r.state},{label:'Details',value:r=>r.description}]);
  table('#analysis-issues',(data.issues??[]).slice(0,200),[{label:'Issue',value:r=>r.code},{label:'Message',value:r=>r.message},{label:'Record / source',value:r=>r.recordId??r.sourceId??r.details?.sourceId??''}]);
  if((data.issues?.length??0)>200)$('#analysis-issues').append(element('p','Showing 200 of '+data.issues.length+' issues. The complete analysis and report retain every issue.'));
  table('#analysis-next',data.nextOperations??[],[{label:'Action',value:r=>r.action},{label:'Reason',value:r=>r.reason},{label:'Prepare',value:r=>button('Load operation',()=>loadSuggestedOperation(r,result.record))}]);
 }
 $('#download-analysis').disabled=!row.file;$('#report-analysis').value=row.id;field($('#report-form'),'name').value=row.name+' report';
 await journal.view('selectedAnalysis',analysisId);if(navigate)showTab('reports');
}
async function loadSuggestedOperation(plan,record){
 const form=$('#native-form');setForm(form,{periodId:record.periodId,periodVersion:record.periodVersion,action:plan.action,operationId:''});
 renderNativeArguments(plan.args);showTab('operations');await saveDraft(form);
}
async function selectReport(reportId,{navigate=true}={}){
 const result=await read('report.read',{reportId}),row=result.report;remember('reports',[row]);currentReport=result;populateSelections();
 $('#report-selected').hidden=false;$('#report-title').textContent=row.name+' · '+row.state;$('#report-detail').textContent=pretty(result);
 table('#report-members',row.files??[],[{label:'File',value:r=>r.filename},{label:'Bytes',value:r=>formatNumber(r.file.bytes)},
  {label:'Read',value:r=>actions(button('Download',()=>download('/api/reports/'+row.id+'/file?filename='+encodeURIComponent(r.filename),r.filename)),
   r.format==='html'?button('Preview',()=>previewReport(row.id,r.filename)):null)}]);
 $('#export-report').value=row.id;await journal.view('selectedReport',reportId);if(navigate)showTab('reports');
}
async function previewReport(reportId,filename){
 const response=await requestJSON('/api/reports/'+reportId+'/file?filename='+encodeURIComponent(filename),{headers:headers(),binary:true});
 const blob=await response.blob();if(reportURL)URL.revokeObjectURL(reportURL);reportURL=URL.createObjectURL(blob);
 $('#report-preview').src=reportURL;$('#report-preview').hidden=false;
}

function formDraft(form){
 const values={};for(const control of [...form.elements])if(control.name&&!['file','submit','button'].includes(control.type)&&!control.name.startsWith('native_arg:'))
  values[control.name]=control.type==='checkbox'?control.checked:control.value;
 if(form.id==='acquisition-form'){try{values.__queries=readQueries();}catch{values.__queryDrafts=$$('#acquisition-queries .query').map(node=>Object.fromEntries([...node.querySelectorAll('[data-query]')].map(control=>[control.dataset.query,control.value])));}}
 return values;
}
async function saveDraft(form){if(journal)await journal.view('draft:'+form.id,formDraft(form));}
function scheduleDraft(form){clearTimeout(draftTimers.get(form.id));draftTimers.set(form.id,setTimeout(()=>saveDraft(form).catch(problem),300));}
function defaultScope(form){
 if(activePeriod){field(form,'periodId').value=activePeriod;updateVersion(field(form,'periodId'),true);}
}
function newPeriod(){
 const form=$('#period-form');form.reset();field(form,'periodId').value='';field(form,'extra').value='{}';
 const end=new Date();end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()+1);
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-30);
 setForm(form,{startsAt:local(start.toISOString()),endsAt:local(end.toISOString())});$('#period-editor-title').textContent='New operating period';
}
function newVault(){const form=$('#vault-form');form.reset();field(form,'vaultId').value='';field(form,'extra').value='{}';$('#vault-editor-title').textContent='Vault selection';}
function newAcquisition(){
 const form=$('#acquisition-form');form.reset();field(form,'acquisitionId').value='';field(form,'extra').value='{}';defaultScope(form);$('#acquisition-queries').replaceChildren();
 addQuery({action:'snapshots.list',args:{limit:500}});addQuery({action:'routes.list',args:{limit:500}});
 $('#acquisition-editor-title').textContent='Complete period acquisition';
}
function newWork(kind){
 const form=$('#'+kind+'-form');form.reset();field(form,kind+'Id').value='';field(form,'extra').value='{}';defaultScope(form);
 if(kind==='incident')field(form,'startedAt').value=local(now());
 $('#'+kind+'-editor-title').textContent=kind==='incident'?'Incident':'Corrective work';
}
async function savePeriod(form){
 const definition=extra(form);Object.assign(definition,{name:value(form,'name'),network:value(form,'network'),startsAt:utc(value(form,'startsAt')),endsAt:utc(value(form,'endsAt')),
  expectedSnapshotIntervalSeconds:Number(value(form,'expectedSnapshotIntervalSeconds')),surfaces:split(value(form,'surfaces')),healthDimensions:split(value(form,'healthDimensions')),
  acceptance:{...(definition.acceptance??{}),executedMainnetHarvests:Number(value(form,'executedMainnetHarvests')),rateHistoryDays:Number(value(form,'rateHistoryDays')),consecutiveGreenDays:Number(value(form,'consecutiveGreenDays'))}});
 for(const key of ['expectedSurfaceIntervalSeconds','expectedHealthIntervalSeconds'])if(value(form,key))definition[key]=Number(value(form,key));else delete definition[key];
 const result=await mutate('period.save',{definition,name:definition.name,...(value(form,'periodId')?{periodId:value(form,'periodId')}:{})});
 if(result.period){field(form,'periodId').value=result.period.id;activePeriod=result.period.id;await journal.view('activePeriod',activePeriod);await loadPeriod(result.period.id);}
 await loadTable('periods');
}
async function saveVault(form){
 const definition=extra(form);Object.assign(definition,{name:value(form,'name'),symbol:value(form,'symbol'),network:value(form,'network'),underlyingClassic:value(form,'underlyingClassic')||null});
 for(const key of ['strategyId','shareTokenId','poolId','underlyingSoroban','swapVia'])if(value(form,key))definition[key]=value(form,key);else delete definition[key];
 const result=await mutate('vault.save',{definition,name:definition.name,...(value(form,'vaultId')?{vaultId:value(form,'vaultId')}:{})});
 if(result.vault)await loadVault(result.vault.id);await loadTable('vaults');
}
async function saveAcquisition(form){
 const definition={...extra(form),...scope(form),name:value(form,'name'),cadenceSeconds:value(form,'cadenceSeconds')?Number(value(form,'cadenceSeconds')):null,queries:readQueries()};
 const result=await mutate('acquisition.save',{definition,name:definition.name,...(value(form,'acquisitionId')?{acquisitionId:value(form,'acquisitionId')}:{})});
 if(result.acquisition){await selectAcquisition(result.acquisition.id);await editAcquisition();}await loadTable('acquisitions');
}
async function saveIncident(form){
 const incident={...extra(form),...scope(form),title:value(form,'title'),status:value(form,'status'),severity:value(form,'severity'),sourceIds:split(value(form,'sourceIds')),note:value(form,'note')};
 if(value(form,'startedAt'))incident.startedAt=utc(value(form,'startedAt'));else delete incident.startedAt;
 if(incident.status==='RESOLVED'&&value(form,'resolvedAt'))incident.resolvedAt=utc(value(form,'resolvedAt'));else {delete incident.resolvedAt;delete incident.closedAt;}
 const result=await mutate('incident.save',{incident,...(value(form,'incidentId')?{incidentId:value(form,'incidentId')}:{})});
 if(result.incident)await loadIncident(result.incident.id);await loadTable('incidents');
}
async function saveCorrection(form){
 const correction={...extra(form),...scope(form),title:value(form,'title'),status:value(form,'status'),note:value(form,'note'),reason:value(form,'note'),
  sourceIds:split(value(form,'sourceIds')),incidentIds:split(value(form,'incidentIds')),operationIds:split(value(form,'operationIds'))};
 if(value(form,'action')){correction.action=value(form,'action');correction.target={...(correction.target??{})};
  if(value(form,'targetSourceId'))correction.target.sourceId=value(form,'targetSourceId');else delete correction.target.sourceId;
  if(value(form,'targetRowId')){correction.target.rowId=value(form,'targetRowId');delete correction.target.key;}else delete correction.target.rowId;
 }else{delete correction.action;delete correction.operation;delete correction.target;delete correction.sourceId;delete correction.rowId;delete correction.rowKey;}
 for(const key of ['harvestId','replacementSourceId'])if(value(form,key))correction[key]=value(form,key);else delete correction[key];
 const result=await mutate('correction.save',{correction,...(value(form,'correctionId')?{correctionId:value(form,'correctionId')}:{})});
 if(result.correction)await loadCorrection(result.correction.id);await loadTable('corrections');
}
function bind(){
 for(const tab of $$('[data-tab]'))tab.addEventListener('click',()=>perform(async()=>{
  const name=tab.dataset.tab;showTab(name);
  const tables={periods:['periods','vaults'],acquisitions:['acquisitions'],operations:['operations'],sources:['sources'],incidents:['incidents','corrections'],reports:['analyses','reports']};
  for(const table of tables[name]??[])await loadTable(table);if(name==='recovery')await renderRequests();
 }));
 $('#refresh').onclick=()=>perform(()=>refresh());
 $('#active-period').onchange=()=>perform(async()=>{
  activePeriod=$('#active-period').value;await journal.view('activePeriod',activePeriod);
  for(const name of PERIOD_TABLES){pages.delete(name);cursors.delete(name);totals.delete(name);renderRows(name);}renderOverview();
 });
 for(const control of $$('[data-reload]'))control.onclick=()=>perform(()=>loadTable(control.dataset.reload));
 for(const control of $$('[data-more]'))control.onclick=()=>perform(()=>loadTable(control.dataset.more,{more:true}));
 for(const select of $$('[data-period],[data-vault]'))select.addEventListener('change',()=>{
  updateVersion(select,true);const form=select.closest('form');
  if(form.id==='native-form')syncNativeScope();
  if(form.id==='acquisition-form')for(const query of $$('#acquisition-queries .query'))syncQueryScope(query);
  scheduleDraft(form);
 });
 for(const control of $$('[data-period-version],[data-vault-version]'))control.addEventListener('change',()=>{
  const form=control.closest('form');if(form.id==='native-form')syncNativeScope();
  if(form.id==='acquisition-form')for(const query of $$('#acquisition-queries .query'))syncQueryScope(query);
 });
 for(const form of $$('form[data-draft]')){form.addEventListener('input',()=>scheduleDraft(form));form.addEventListener('change',()=>scheduleDraft(form));}
 $('#new-period').onclick=()=>perform(async()=>{newPeriod();await saveDraft($('#period-form'));});
 $('#new-vault').onclick=()=>perform(async()=>{newVault();await saveDraft($('#vault-form'));});
 $('#new-acquisition').onclick=()=>perform(async()=>{newAcquisition();await saveDraft($('#acquisition-form'));});
 $('#new-incident').onclick=()=>perform(async()=>{newWork('incident');await saveDraft($('#incident-form'));});
 $('#new-correction').onclick=()=>perform(async()=>{newWork('correction');await saveDraft($('#correction-form'));});
 onSubmit('#period-form',savePeriod);onSubmit('#vault-form',saveVault);onSubmit('#acquisition-form',saveAcquisition);
 onSubmit('#incident-form',saveIncident);onSubmit('#correction-form',saveCorrection);
 $('#add-query').onclick=()=>{addQuery();scheduleDraft($('#acquisition-form'));};
 $('#edit-acquisition').onclick=()=>perform(editAcquisition);
 for(const control of $$('[data-acquisition-action]'))control.onclick=()=>perform(()=>acquisitionAction(control.dataset.acquisitionAction));
 $('#native-action').onchange=()=>{field($('#native-form'),'operationId').value='';renderNativeArguments({},true);syncNativeScope();};
 $('#reset-native-args').onclick=()=>{field($('#native-form'),'operationId').value='';renderNativeArguments({},true);syncNativeScope();};
 $('#apply-native-json').onclick=()=>perform(async()=>{renderNativeArguments(parseObject($('#native-args').value));await saveDraft($('#native-form'));});
 $('#use-selected-vault').onclick=()=>perform(useSelectedVault);
 onSubmit('#native-form',async form=>{
  const args={...scope(form),connection:value(form,'connection'),action:value(form,'action'),args:readNativeArguments(),
   ...(value(form,'operationId')?{operationId:value(form,'operationId')}:{}),...(value(form,'correctionId')?{correctionId:value(form,'correctionId')}:{})};
  const result=await mutate('operation.prepare',args);if(result.operation)await selectOperation(result.operation.id);await loadTable('operations');
 });
 for(const control of $$('[data-operation-action]'))control.onclick=()=>perform(()=>operationAction(control.dataset.operationAction));
 $('#operation-reprepare').onclick=()=>perform(reprepareOperation);
 $('#operation-correction').onclick=()=>perform(async()=>{
  if(!currentOperation)throw new Error('Select an operation.');newWork('correction');const row=currentOperation;
  setForm($('#correction-form'),{periodId:row.periodId,periodVersion:row.periodVersion,vaultId:row.vaultId,vaultVersion:row.vaultVersion,
   title:'Follow through '+row.action,operationIds:row.id,sourceIds:row.sourceIds.join(', '),status:'AWAITING_OUTCOME'});
  showTab('incidents');await saveDraft($('#correction-form'));
 });
 onSubmit('#source-form',async form=>{
  const file=field(form,'file').files[0];if(!file)throw new Error('Select the complete source file.');
  $('#upload-progress').textContent='Retaining the full File in the browser journal…';
  const requestId=id(),expectedSha256=await fileSha256(file),args={...scope(form),requestId,expectedRevision:state.revision,name:file.name,
   kind:value(form,'kind')==='other'?value(form,'customKind'):value(form,'kind'),expectedSha256,
   contentType:file.type||(/\.jsonl$/i.test(file.name)?'application/x-ndjson':/\.json$/i.test(file.name)?'application/json':'application/octet-stream'),
   coverage:parseObject(value(form,'coverage')||'{}','Coverage description'),notes:value(form,'notes'),
   ...(value(form,'observedAt')?{observedAt:utc(value(form,'observedAt'))}:{}),...(value(form,'runtime').trim()?{runtime:parseObject(value(form,'runtime'),'Runtime descriptor')}:{})};
  const record=await journal.enqueue({requestId,method:'source.import',args,route:'/api/source-import',file,metadata:{filename:file.name}});
  const result=await journal.execute(record,send,applyResult);if(result.source)await selectSource(result.source.id);await loadTable('sources');
 });
 onSubmit('#analysis-form',async form=>{
  const args={...extra(form),...scope(form),name:value(form,'name')};
  for(const key of ['sourceIds','vaultIds'])if(value(form,key).trim()){const selected=JSON.parse(value(form,key));if(!Array.isArray(selected))throw new Error(key+' must be a JSON array.');args[key]=selected;}else delete args[key];
  const result=await mutate('analysis.create',args);if(result.analysis)await selectAnalysis(result.analysis.id);await loadTable('analyses');
 });
 $('#download-analysis').onclick=()=>perform(()=>{if(!currentAnalysis)throw new Error('Select an analysis.');return download('/api/analyses/'+currentAnalysis.analysis.id+'/file','period-analysis-'+currentAnalysis.analysis.id+'.json');});
 onSubmit('#report-form',async form=>{const result=await mutate('report.create',{analysisId:value(form,'analysisId'),name:value(form,'name')});
  if(result.report)await selectReport(result.report.id);await loadTable('reports');});
 onSubmit('#export-form',async form=>{
  const method=value(form,'kind')==='report'?'report.export':'workspace.export';if(method==='report.export'&&!value(form,'reportId'))throw new Error('Select a report.');
  await mutate(method,{destination:value(form,'destination'),...(method==='report.export'?{reportId:value(form,'reportId')}:{})});
 });
 $('#download-archive').onclick=()=>perform(()=>{if(!currentExport)throw new Error('Prepare a delivery first.');
  return download('/api/packages/'+currentExport.exportId+'/archive','turbolong-operations-'+currentExport.exportId+'.tar.gz');});
 onSubmit('#unpack-form',async form=>{
  const file=field(form,'archive').files[0];if(!file)throw new Error('Select the complete archive.');
  const requestId=id(),expectedManifestSha256=value(form,'manifestSha256').trim(),record=await journal.enqueue({requestId,method:'package.unpack',
   args:{...(expectedManifestSha256?{expectedManifestSha256}:{})},file,route:'/api/packages/unpack',
   headers:expectedManifestSha256?{'X-Turbolong-Manifest-SHA256':expectedManifestSha256}:{},metadata:{filename:file.name}});
  await journal.execute(record,send,applyResult);
 });
 $('#inspect-package').onclick=()=>perform(async()=>{
  const form=$('#receive-form'),result=await read('package.inspect',{sourceDirectory:value(form,'sourceDirectory'),
   ...(value(form,'expectedManifestSha256')?{expectedManifestSha256:value(form,'expectedManifestSha256')}:{})});$('#receiving-detail').textContent=pretty(result);await showResult(result);
 });
 onSubmit('#receive-form',form=>mutate('package.receive',{sourceDirectory:value(form,'sourceDirectory'),expectedManifestSha256:value(form,'expectedManifestSha256'),destination:value(form,'destination')}));
 $('#profile-json').oninput=()=>{$('#profile-json').dataset.dirty='true';};
 onSubmit('#profile-form',form=>mutate('profile.save',{profile:parseObject(value(form,'profile'),'Workspace profile')}));
 $('#method-select').onchange=()=>{const spec=methods.find(row=>row.name===$('#method-select').value);
  $('#method-args').value=pretty(Object.fromEntries((spec?.required??[]).filter(key=>!['requestId','expectedRevision'].includes(key)).map(key=>[key,['args','profile','definition','incident','correction'].includes(key)?{}:''])));};
 onSubmit('#method-form',form=>mutate(value(form,'method'),parseObject(value(form,'args'),'Method arguments')));
 $('#recover-requests').onclick=()=>perform(recoverRequests);
 $('#clear-completed-requests').onclick=()=>perform(async()=>{await journal.forgetCompleted();await renderRequests();setStatus('Acknowledged browser copies removed; retained workspace sources remain available.');});
}
async function restoreDrafts(){
 for(const form of $$('form[data-draft]')){
  const data=await journal.view('draft:'+form.id);if(!data)continue;
  for(const [key,saved]of Object.entries(data)){if(key.startsWith('__'))continue;const control=field(form,key);if(!control||control.type==='file')continue;
   if(control.tagName==='SELECT'&&saved&&![...control.options].some(option=>option.value===saved))control.append(element('option',saved,{value:saved}));
   if(control.type==='checkbox')control.checked=Boolean(saved);else control.value=saved;
  }
  if(form.id==='profile-form')$('#profile-json').dataset.dirty='true';
  if(form.id==='acquisition-form'){
   if(data.__queries){$('#acquisition-queries').replaceChildren();for(const query of data.__queries)addQuery(query);}
   else if(data.__queryDrafts){$('#acquisition-queries').replaceChildren();for(const draft of data.__queryDrafts){const node=addQuery({});for(const control of node.querySelectorAll('[data-query]'))if(draft[control.dataset.query]!==undefined)control.value=draft[control.dataset.query];}}
  }
 }
 try{renderNativeArguments(parseObject($('#native-args').value||'{}'));}catch{renderNativeArguments({},true);}
}
async function main(){
 const fromURL=new URLSearchParams(location.hash.slice(1)).get('token');if(fromURL){sessionStorage.setItem('turbolong-operator-token',fromURL);history.replaceState(null,'',location.pathname+location.search);}
 token=sessionStorage.getItem('turbolong-operator-token');if(!token)throw new Error('Open the private operator link printed by serve.');
 bootstrap=await requestJSON('/api/bootstrap',{headers:{Authorization:'Bearer '+token}});state=bootstrap.state;methods=bootstrap.methods;native=bootstrap.catalogue.actions;
 journal=await openTurbolongJournal({workspaceId:state.workspaceId,scope:'operator'});
 activePeriod=await journal.view('activePeriod')??'';for(const name of TABLES)remember(name,state[name]);populateSelections();renderOverview();for(const name of TABLES)renderRows(name);
 $('#workspace-label').textContent=state.workspaceId+' · revision '+state.revision;$('#all-methods').textContent=pretty(methods);
 $('#configuration-schema').textContent=pretty({connections:state.connections,runtime:'Private selected source/runtime and execution directories stay outside the workspace.'});
 fillOptions($('#method-select'),methods,{value:row=>row.name,label:row=>row.title+' · '+row.name});
 $('#runtime-command').textContent='stellar-turbolong-operations runtime-build --installation-directory /private/turbolong-source --source-capsule-file /private/turbolong-original-source.json --runtime-directory /private/turbolong-runtime --node-heap-mb 512 --cargo-jobs 1';
 newPeriod();newVault();newAcquisition();newWork('incident');newWork('correction');renderNativeArguments({},true);
 $('#profile-json').value=pretty(state.profile);field($('#export-form'),'destination').value=bootstrap.operator.workspaceDirectory+'.delivery-'+Date.now();
 field($('#receive-form'),'destination').value=bootstrap.operator.workspaceDirectory+'.received-'+Date.now();
 bind();await restoreDrafts();
 const previousExport=await journal.view('currentExport');if(previousExport)renderExport(previousExport);
 const unpacked=await journal.view('unpacked');if(unpacked){field($('#receive-form'),'sourceDirectory').value=unpacked.sourceDirectory;field($('#receive-form'),'expectedManifestSha256').value=unpacked.manifestSha256;}
 const received=await journal.view('received');if(received)showReceiving(received);
 const last=await journal.view('lastResult');if(last)$('#last-result').textContent=pretty(last);
 const selectedAnalysis=await journal.view('selectedAnalysis');if(selectedAnalysis)await selectAnalysis(selectedAnalysis,{navigate:false}).catch(problem);
 const selectedReport=await journal.view('selectedReport');if(selectedReport)await selectReport(selectedReport,{navigate:false}).catch(problem);
 showTab(await journal.view('tab')??'overview');initialized=true;setStatus('Operating workspace opened.');await recoverRequests();
 setInterval(()=>{if(!busy&&document.visibilityState==='visible')perform(()=>refresh({message:false}));},10000);
}
main().catch(problem);
