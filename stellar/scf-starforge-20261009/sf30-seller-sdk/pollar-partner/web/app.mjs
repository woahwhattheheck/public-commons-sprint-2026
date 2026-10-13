// MIT. Complete industrial Pollar operator with original request and upload recovery.
import {openPollarJournal,requestJSON,id,now,errorValue,pretty,parseObject,exampleValue,downloadResponse,downloadJSON} from './journal.mjs';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)],copy=value=>structuredClone(value);
let token,bootstrap,state,journal,methods=[],native=[],currentApplication=null,currentOperation=null,currentSource=null,currentExport=null,oneTime=null,busy=0;
const tableCache=new Map(),tableCursor=new Map(),knownApplications=new Map();
const terminal=new Set(['COMPLETE','FAILED','CANCELED']);
function setStatus(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function problem(error){setStatus((error.code?error.code+': ':'')+error.message,true);}
function element(tag,text,attributes={}){
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;
 for(const [key,value]of Object.entries(attributes))key==='class'?node.className=value:node.setAttribute(key,value);return node;
}
function button(label,work){const node=element('button',label,{type:'button'});node.addEventListener('click',()=>perform(work));return node;}
async function perform(work){
 busy++;try{const result=await work();return result;}catch(error){problem(error);return null;}finally{busy--;await renderRequests().catch(()=>{});}
}
function headers(extra={}){return {Authorization:'Bearer '+token,'X-Pollar-Workspace-ID':state.workspaceId,...extra};}
async function read(method,args={}){return requestJSON('/api/invoke',{method:'POST',body:{method,args},headers:headers()});}
function showTab(name){for(const panel of $$('[data-panel]'))panel.hidden=panel.dataset.panel!==name;
 for(const tab of $$('[data-tab]'))tab.setAttribute('aria-current',tab.dataset.tab===name?'page':'false');journal?.view('tab',name).catch(problem);}
function fillOptions(select,rows,{label=row=>row.name??row.id,value=row=>row.id,empty}={}){
 const selected=select.value;select.replaceChildren();if(empty!==undefined)select.append(element('option',empty,{value:''}));
 for(const row of rows)select.append(element('option',label(row),{value:value(row)}));
 if([...select.options].some(option=>option.value===selected))select.value=selected;
}
function table(target,rows,columns){
 const root=$(target);root.replaceChildren();
 if(!rows.length){root.append(element('div','No retained records in this selection.',{class:'empty'}));return;}
 const wrap=element('div',undefined,{class:'table-wrap'}),grid=element('table'),head=element('thead'),hr=element('tr');
 columns.forEach(column=>hr.append(element('th',column.label)));head.append(hr);grid.append(head);
 const body=element('tbody');
 for(const row of rows){const tr=element('tr');for(const column of columns){const td=element('td');const value=column.value(row);
  if(value instanceof Node)td.append(value);else td.textContent=value??'';tr.append(td);}body.append(tr);}
 grid.append(body);wrap.append(grid);root.append(wrap);
}
function rowActions(...items){const result=element('div',undefined,{class:'row'});for(const item of items)if(item)result.append(item);return result;}
function actionForm(){return $('#native-form');}
function renderApplications(){
 for(const row of state.applications??[])knownApplications.set(row.id,row);
 const applications=[...knownApplications.values()].sort((a,b)=>a.name.localeCompare(b.name));
 for(const selector of ['#native-application','#snapshot-application'])fillOptions($(selector),applications,{label:row=>row.name+' · '+row.network});
 fillOptions($('#application-runtime'),state.runtimes??[],{label:row=>row.id.slice(0,16)+' · '+row.versions['@pollar/core'],empty:'Select retained browser runtime'});
 table('#applications-table',applications,[{label:'Application',value:row=>row.name},{label:'Provider / network',value:row=>row.originalApplicationId+' / '+row.network},
  {label:'Saved version',value:row=>row.currentVersion},{label:'Open',value:row=>rowActions(button('Load',()=>loadApplication(row.id)),
   button('Portal',()=>{window.open('/portal?application='+encodeURIComponent(row.id),'_blank','noopener');}))}]);
 table('#overview-applications',applications,[{label:'Application',value:row=>row.name},{label:'Network',value:row=>row.network},
  {label:'Open',value:row=>button('Open saved configuration',()=>loadApplication(row.id))}]);
}
function renderOverview(){
 $('#stats').replaceChildren();for(const [tableName,label]of [['applications','Applications'],['participants','Verified participants'],['operations','Original operations'],['sources','Retained sources']]){
  const item=element('div',undefined,{class:'stat'});item.append(element('strong',String(state.counts[tableName])),element('span',label));$('#stats').append(item);
 }
 table('#overview-pending',(state.operations??[]).filter(row=>!terminal.has(row.state)),[{label:'Action',value:row=>row.action},{label:'State',value:row=>row.state+(row.paused?' · paused':'')},
  {label:'Original operation',value:row=>row.id},{label:'Open',value:row=>button('Inspect',()=>selectOperation(row.id))}]);
 table('#runtimes',state.runtimes??[],[{label:'Runtime ID',value:row=>row.id},{label:'Manifest SHA256',value:row=>row.manifestSha256},
  {label:'Original packages',value:row=>Object.entries(row.versions).map(([name,version])=>name+' '+version).join('\n')}]);
}
function renderConnections(){
 fillOptions($('#native-connection'),state.connections??[],{value:row=>row.alias,label:row=>row.alias+(row.error?' · '+row.error.code:'')});
 fillOptions($('#native-action'),native,{value:row=>row.action,label:row=>row.title+' · '+row.action});renderNativeContract(false);
}
function renderNativeContract(reset=true){
 const spec=native.find(row=>row.action===$('#native-action').value);if(!spec)return;
 $('#native-contract').textContent=pretty(spec);
 if(reset){const args=exampleValue(spec.inputSchema)??{};const app=knownApplications.get($('#native-application').value);if(Object.hasOwn(args,'id')&&app)args.id=app.originalApplicationId;$('#native-args').value=pretty(args);}
}
async function refresh({message=true}={}){
 state=await requestJSON('/api/state',{headers:headers()});$('#workspace-label').textContent=state.workspaceId+' · revision '+state.revision;
 renderApplications();renderOverview();renderConnections();
 if(!$('#profile-json').dataset.dirty)$('#profile-json').value=pretty(state.profile);
 if(message)setStatus('Original workspace refreshed.');
 return state;
}
async function send(record){
 if(record.file)return requestJSON(record.route,{method:'POST',body:record.file,headers:headers(record.headers)});
 return requestJSON(record.route,{method:'POST',body:{method:record.method,args:record.args},headers:headers(record.headers)});
}
async function applyResult(result,record){
 const retained=copy(result);delete retained.ephemeral;
 if(Number.isSafeInteger(result.revision))state.revision=Math.max(state.revision,result.revision);
 $('#last-result').textContent=pretty(retained);$('#last-result').hidden=false;await journal.view('lastResult',retained);
 if(result.ephemeral){oneTime=result.ephemeral;$('#one-time-body').textContent=pretty(oneTime);$('#one-time-result').hidden=false;showTab('operations');}
 if(record.method==='application.save'&&result.application){knownApplications.set(result.application.id,result.application);currentApplication=result.application.id;await loadApplication(result.application.id);}
 if(result.operation){currentOperation=result.operation.id;renderOperation(result.operation);}
 if(record.method==='workspace.export'||record.method==='report.export'){
  currentExport=result.export??result;$('#export-selected').hidden=false;$('#export-detail').textContent=pretty(currentExport);await journal.view('currentExport',currentExport);
 }
 if(record.method==='package.unpack'){
  $('#receive-form').elements.sourceDirectory.value=result.sourceDirectory;
  $('#receive-form').elements.expectedManifestSha256.value=result.manifestSha256;
  $('#receiving-detail').hidden=false;$('#receiving-detail').textContent=pretty(result);await journal.view('unpacked',result);
 }
 if(record.method==='package.receive'){showReceiving(result);await journal.view('received',result);}
 if(record.method==='profile.save')delete $('#profile-json').dataset.dirty;
 await refresh({message:false});setStatus('Original '+record.method+' completed.');
}
async function mutate(method,args={},metadata={}){
 const spec=methods.find(row=>row.name===method);if(!spec?.mutates)return read(method,args);
 const requestId=args.requestId??id(),selected={...args,requestId};
 if(spec.required.includes('expectedRevision')&&selected.expectedRevision===undefined)selected.expectedRevision=state.revision;
 const record=await journal.enqueue({requestId,method,args:selected,metadata});
 return journal.execute(record,send,applyResult);
}
async function loadApplication(applicationId){
 const selected=await read('application.read',{applicationId});knownApplications.set(applicationId,selected.application);currentApplication=applicationId;
 const form=$('#application-form');form.elements.applicationId.value=applicationId;form.elements.name.value=selected.version.name;
 form.elements.configuration.value=pretty(selected.version.configuration);form.elements.runtimeId.value=selected.version.runtime?.id??'';
 $('#application-editor-title').textContent=selected.application.name+' · editing from version '+selected.version.version;
 showTab('applications');
}
function renderOperation(row){
 currentOperation=row.id;$('#operation-selected').hidden=false;$('#operation-title').textContent=row.action;
 $('#operation-summary').textContent=row.id+' · '+row.state+(row.paused?' · paused':'')+' · '+row.mode;
 $('#operation-detail').textContent=pretty(row);
 for(const control of $$('[data-operation-action]')){
  const method=control.dataset.operationAction;
  control.disabled=row.mode!=='native'&&['operation.run','operation.collect','operation.reconcile'].includes(method)||
   method==='operation.run'&&!(row.state==='PREPARED'||row.state==='COMPLETE'&&row.nextRequest)||
   method==='operation.cancel'&&!(row.state==='PREPARED'&&row.attemptIds.length===0);
 }
}
async function selectOperation(operationId){const result=await read('operation.read',{operationId});renderOperation(result.operation);showTab('operations');}
async function selectSource(sourceId){const result=await read('source.read',{sourceId});currentSource=result.source;$('#source-selected').hidden=false;$('#source-detail').textContent=pretty(result);
 $('#source-response').disabled=!result.source.body;showTab('sources');}
async function loadTable(name,{more=false}={}){
 const result=await read('records.page',{table:name,limit:100,...(more&&tableCursor.get(name)?{after:tableCursor.get(name)}:{})});
 const rows=more?[...(tableCache.get(name)??[]),...result.rows]:result.rows;tableCache.set(name,rows);tableCursor.set(name,result.nextCursor);
 const moreButton=$('#more-'+name);if(moreButton)moreButton.hidden=!result.nextCursor;
 if(name==='operations')table('#operations-table',rows,[{label:'Action',value:row=>row.action},{label:'State',value:row=>row.state+(row.paused?' · paused':'')},
  {label:'Participant',value:row=>row.participantId??'Operator'},{label:'Updated',value:row=>row.updatedAt},{label:'Open',value:row=>button('Inspect',()=>selectOperation(row.id))}]);
 if(name==='participants')table('#participants-table',rows,[{label:'Provider user',value:row=>row.userId},{label:'Application',value:row=>knownApplications.get(row.applicationId)?.name??row.applicationId},
  {label:'Verified',value:row=>row.verifiedAt},{label:'Open',value:row=>button('Inspect',()=>{$('#participant-detail').hidden=false;$('#participant-detail').textContent=pretty(row);})}]);
 if(name==='sources')table('#sources-table',rows,[{label:'Original action',value:row=>row.kind},{label:'Source ID',value:row=>row.id},{label:'Retained',value:row=>row.createdAt},
  {label:'Open',value:row=>button('Inspect source',()=>selectSource(row.id))}]);
 if(name==='snapshots')table('#snapshots-table',rows,[{label:'Snapshot',value:row=>row.name},{label:'Original operations',value:row=>row.counts.operations},{label:'Created',value:row=>row.createdAt},
  {label:'Open',value:row=>rowActions(button('Read full snapshot',async()=>{$('#report-detail').hidden=false;$('#report-detail').textContent=pretty(await read('snapshot.read',{snapshotId:row.id}));}),
   button('Build report',async()=>{await mutate('report.create',{snapshotId:row.id,name:row.name});await loadTable('reports');}))}]);
 if(name==='reports')table('#reports-table',rows,[{label:'Report',value:row=>row.name},{label:'Created',value:row=>row.createdAt},
  {label:'Full original files',value:row=>rowActions(...row.formats.map(format=>button(format.toUpperCase(),()=>download('/api/reports/'+row.id+'/'+format,'pollar-report-'+row.id+'.'+format))),
   button('Inspect',async()=>{$('#report-detail').hidden=false;$('#report-detail').textContent=pretty(await read('report.read',{reportId:row.id}));}),
   button('Export',()=>{showTab('receiving');$('#export-form').elements.kind.value='report';$('#export-form').elements.reportId.value=row.id;}))}]);
}
async function download(route,filename){
 const response=await requestJSON(route,{headers:headers(),binary:true});const saved=await downloadResponse(response,filename,{onProgress:bytes=>{$('#download-progress').textContent=bytes.toLocaleString()+' bytes saved';}});
 setStatus(saved.bytes.toLocaleString()+' original bytes downloaded.');return saved;
}
function showReceiving(result){
 $('#receiving-detail').hidden=false;$('#receiving-detail').textContent=pretty(result);const container=$('#receiving-handoff');container.hidden=false;container.replaceChildren(element('h3','Received installation'));
 if(result.application&&result.workspace){
  container.append(element('p','The complete application and runtime graph are ready at the returned receiving directory. Supply the original private provider configuration for this host.'),
   element('pre','node '+JSON.stringify(result.application.cli)+' serve --workspace '+JSON.stringify(result.workspace.directory)+' --connections-file /private/received-pollar-connections.json --port 8778 --startup-format json'),
   element('pre',pretty({runtimes:result.application.runtimeConnections,workspaceId:result.workspace.workspaceId})));
 }else container.append(element('pre',pretty(result.report??result)));
}
async function renderRequests(){
 if(!journal)return;const records=(await journal.requests()).filter(row=>row.state!=='COMPLETE'&&row.state!=='CANCELED');
 table('#requests-table',records,[{label:'Original request',value:row=>row.id},{label:'Action',value:row=>row.method},{label:'State',value:row=>row.state},
  {label:'Outcome',value:row=>row.error?.message??''},{label:'Recover',value:row=>rowActions(
   button('Retry original',()=>journal.execute(row,send,applyResult)),
   row.state==='REVISION_CONFLICT'?button('Refresh rejected revision',async()=>{await refresh({message:false});const rebased=await journal.rebase(row,state.revision);return journal.execute(rebased,send,applyResult);}):null,
   ['READY','REJECTED','REVISION_CONFLICT'].includes(row.state)?button('Cancel this request',()=>journal.cancel(row)):null)}]);
}
async function recoverRequests(){
 const rows=await journal.requests();for(const row of rows){
  if(!['READY','SENDING','UNCERTAIN'].includes(row.state))continue;
  try{await journal.execute(row,send,applyResult);}catch(error){problem(error);if(['WORKSPACE_IDENTITY_MISMATCH','WORKSPACE_IDENTITY_REQUIRED','UNAUTHORIZED'].includes(error.code))break;}
 }await renderRequests();
}
function bind(){
 for(const tab of $$('[data-tab]'))tab.addEventListener('click',()=>perform(async()=>{
  const name=tab.dataset.tab;showTab(name);if(['operations','participants','sources'].includes(name))await loadTable(name);
  if(name==='reports'){await loadTable('snapshots');await loadTable('reports');}if(name==='recovery')await renderRequests();
 }));
 $('#refresh').onclick=()=>perform(()=>refresh());
 $('#new-application').onclick=()=>{currentApplication=null;$('#application-form').reset();$('#application-editor-title').textContent='New application';
  $('#application-config').value=pretty({apiKey:'pub_testnet_REPLACE_WITH_ORIGINAL_KEY',applicationId:'REPLACE_WITH_ORIGINAL_APPLICATION_ID',stellarNetwork:'testnet',oauthRedirectUri:location.origin+'/portal'});};
 $('#application-form').onsubmit=event=>{event.preventDefault();perform(async()=>{
  const form=event.currentTarget,args={name:form.elements.name.value,configuration:parseObject(form.elements.configuration.value),runtimeId:form.elements.runtimeId.value};
  if(form.elements.applicationId.value)args.applicationId=form.elements.applicationId.value;await mutate('application.save',args);
 });};
 $('#use-portal-application').onclick=()=>perform(async()=>{if(!currentApplication)throw new Error('Save or load the original application first.');
  await mutate('profile.save',{profile:{portalApplicationId:currentApplication}});});
 $('#native-action').onchange=()=>renderNativeContract();$('#native-application').onchange=()=>renderNativeContract();
 $('#native-form').onsubmit=event=>{event.preventDefault();perform(async()=>{const form=event.currentTarget;
  const result=await mutate('operation.prepare',{mode:'native',applicationId:form.elements.applicationId.value,connection:form.elements.connection.value,
   action:form.elements.action.value,args:parseObject(form.elements.args.value)});renderOperation(result.operation);await loadTable('operations');
 });};
 $('#load-operations').onclick=()=>perform(()=>loadTable('operations'));
 for(const name of ['operations','participants','sources','snapshots','reports'])$('#more-'+name).onclick=()=>perform(()=>loadTable(name,{more:true}));
 for(const control of $$('[data-operation-action]'))control.onclick=()=>perform(async()=>{
  if(!currentOperation)throw new Error('Select an original operation.');const method=control.dataset.operationAction;
  const result=await mutate(method,{operationId:currentOperation});renderOperation(result.operation);await loadTable('operations');
 });
 $('#source-json').onclick=()=>perform(()=>download('/api/sources/'+currentSource.id+'/source','pollar-source-'+currentSource.id+'.json'));
 $('#source-response').onclick=()=>perform(()=>download('/api/sources/'+currentSource.id+'/response','pollar-response-'+currentSource.id+'.bin'));
 $('#snapshot-form').onsubmit=event=>{event.preventDefault();perform(async()=>{const form=event.currentTarget,args={applicationId:form.elements.applicationId.value,name:form.elements.name.value};
  if(form.elements.participantId.value)args.participantId=form.elements.participantId.value;
  if(form.elements.operationIds.value)args.operationIds=JSON.parse(form.elements.operationIds.value);
  await mutate('snapshot.create',args);await loadTable('snapshots');
 });};
 $('#export-form').onsubmit=event=>{event.preventDefault();perform(async()=>{const form=event.currentTarget;
  await mutate(form.elements.kind.value==='report'?'report.export':'workspace.export',{destination:form.elements.destination.value,...(form.elements.kind.value==='report'?{reportId:form.elements.reportId.value}:{})});
 });};
 $('#download-archive').onclick=()=>perform(()=>download('/api/packages/'+(currentExport.exportId??currentExport.id)+'/archive','pollar-partner-'+(currentExport.exportId??currentExport.id)+'.tar.gz'));
 $('#unpack-form').onsubmit=event=>{event.preventDefault();perform(async()=>{
  const form=event.currentTarget,file=form.elements.archive.files[0];if(!file)throw new Error('Select the full original archive.');
  const requestId=id(),manifest=form.elements.manifestSha256.value.trim(),record=await journal.enqueue({requestId,method:'package.unpack',args:{},file,
   route:'/api/packages/unpack?requestId='+requestId+(manifest?'&manifestSha256='+manifest:''),
   headers:manifest?{'X-Pollar-Manifest-SHA256':manifest}:{},metadata:{filename:file.name}});
  await journal.execute(record,send,applyResult);
 });};
 $('#inspect-package').onclick=()=>perform(async()=>{const form=$('#receive-form'),result=await read('package.inspect',{sourceDirectory:form.elements.sourceDirectory.value,expectedManifestSha256:form.elements.expectedManifestSha256.value});
  $('#receiving-detail').hidden=false;$('#receiving-detail').textContent=pretty(result);});
 $('#receive-form').onsubmit=event=>{event.preventDefault();perform(async()=>{const form=event.currentTarget;await mutate('package.receive',
  {sourceDirectory:form.elements.sourceDirectory.value,expectedManifestSha256:form.elements.expectedManifestSha256.value,destination:form.elements.destination.value});});};
 $('#profile-json').oninput=()=>{$('#profile-json').dataset.dirty='true';};
 $('#profile-form').onsubmit=event=>{event.preventDefault();perform(()=>mutate('profile.save',{profile:parseObject(event.currentTarget.elements.profile.value)}));};
 $('#method-select').onchange=()=>{const selected=methods.find(row=>row.name===$('#method-select').value);$('#method-args').value=pretty(Object.fromEntries((selected?.required??[]).filter(key=>!['requestId','expectedRevision'].includes(key)).map(key=>[key,key==='args'||key==='profile'||key==='configuration'?{}:''])));};
 $('#method-form').onsubmit=event=>{event.preventDefault();perform(async()=>{const form=event.currentTarget,result=await mutate(form.elements.method.value,parseObject(form.elements.args.value));
  const retained=copy(result);delete retained.ephemeral;$('#last-result').hidden=false;$('#last-result').textContent=pretty(retained);});};
 $('#recover-requests').onclick=()=>perform(recoverRequests);
 $('#save-one-time').onclick=()=>{if(oneTime)downloadJSON(oneTime,'private-pollar-provider-result.json');};
 $('#clear-one-time').onclick=()=>{oneTime=null;$('#one-time-body').textContent='';$('#one-time-result').hidden=true;};
}
async function main(){
 const fragment=new URLSearchParams(location.hash.slice(1)),fromURL=fragment.get('token');if(fromURL){sessionStorage.setItem('pollar-operator-token',fromURL);history.replaceState(null,'',location.pathname+location.search);}
 token=sessionStorage.getItem('pollar-operator-token');if(!token)throw new Error('Open the complete private operator link printed by serve.');
 bootstrap=await requestJSON('/api/bootstrap',{headers:{Authorization:'Bearer '+token}});state=bootstrap.state;methods=bootstrap.methods.methods;native=bootstrap.methods.native;
 journal=await openPollarJournal({workspaceId:state.workspaceId,scope:'operator'});
 $('#all-methods').textContent=pretty(bootstrap.methods);$('#configuration-schema').textContent=pretty(bootstrap.methods.publicConfiguration);
 fillOptions($('#method-select'),methods,{value:row=>row.name,label:row=>row.title+' · '+row.name});
 $('#runtime-command').textContent='stellar-pollar-partner runtime-build --installation-directory /private/pollar-sdk --runtime-directory /private/pollar-runtime --node-heap-mb 512';
 $('#portal-link').href=bootstrap.operator.portalUrl;
 $('#export-form').elements.destination.value=bootstrap.operator.workspaceDirectory+'.delivery-'+Date.now();
 $('#receive-form').elements.destination.value=bootstrap.operator.workspaceDirectory+'.received-'+Date.now();
 bind();renderApplications();renderOverview();renderConnections();$('#profile-json').value=pretty(state.profile);$('#new-application').click();
 const previousExport=await journal.view('currentExport');if(previousExport){currentExport=previousExport;$('#export-selected').hidden=false;$('#export-detail').textContent=pretty(previousExport);}
 const unpacked=await journal.view('unpacked');if(unpacked){$('#receive-form').elements.sourceDirectory.value=unpacked.sourceDirectory;$('#receive-form').elements.expectedManifestSha256.value=unpacked.manifestSha256;}
 const received=await journal.view('received');if(received)showReceiving(received);
 showTab(await journal.view('tab')??'overview');$('#workspace-label').textContent=state.workspaceId+' · revision '+state.revision;
 setStatus('Original partner workspace opened.');await recoverRequests();
}
main().catch(problem);
