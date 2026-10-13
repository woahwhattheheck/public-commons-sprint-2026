// MIT. Escala operator interface. Provider credentials stay on the host.
import { canonical, verifyRequest, prepareRequest, initializeJournal, listRequests, getRequest, beginAttempt, finishAttempt, rebaseRequest, markApplied, saveView, fileHash, exportWorkingCopy, inspectWorkingCopy, restoreWorkingCopy, listWorkingCopyRestores } from './journal.mjs';
import {exactObservation,resourceSummary,amountLabel,REGISTER_KINDS,OBSERVATION_SECTIONS,sectionTitle,displayColumns} from './collective-display.mjs';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const text=value=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
const pretty=value=>JSON.stringify(value,null,2);
const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>typeof value==='string'&&value.length>25?value.slice(0,12)+'…'+value.slice(-8):text(value);
const titles={streams:'Settlement streams',books:'Programmes',plans:'Payout plans',links:'Review decisions',overview:'Overview',trade:'Prepare provider operation',operations:'Operations',resources:'Original registers',captures:'Source collections',sources:'Source files',reconciliations:'Reconciliation',reports:'Reports',transfer:'Export & receive',recovery:'Request recovery',settings:'Workspace settings'};
const descriptions={streams:'Original Horizon account events, retained source and durable replay positions.',books:'Complete community, fund, milestone and account selections.',plans:'Immutable milestone, release and recipient preparations with exact original SDP instructions.',links:'Explicit associations, allocations and correction history.',operations:'Every prepared request, provider attempt and original result.',resources:'Original community, contribution, governance, milestone and disbursement observations.',captures:'Complete original provider reads and paged collections.',sources:'Retained original exchanges and complete imported files.',reconciliations:'Complete programme and payout observations, findings and exact source coverage.',reports:'Complete original programme and payout reports.'};
const tables=new Set(Object.keys(descriptions));
let token=sessionStorage.getItem('amero.operator.token')??'',bootstrap=null,workspaceId=null,view={},page='overview',rows=[],cursor=null,listGeneration=0,detailGeneration=0,navigationGeneration=0,selected=null,requests=[],pendingCount=0,busyCount=0,refreshPromise=null,previewUrl=null,mutationTail=Promise.resolve(),pollTimer=null,exportCursor=null,exportRows=[];
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){token=fragment.get('token');sessionStorage.setItem('amero.operator.token',token);history.replaceState(null,'',location.pathname+location.search);}
function fail(code,message,details){return Object.assign(new Error(message),{code,details});}
function notice(message,kind='info'){$('#notice').hidden=!message;$('#notice').textContent=message;$('#notice').dataset.kind=kind;}
function busy(label){busyCount++;$('#busy').hidden=false;$('#busy').textContent=label??'Working…';return()=>{busyCount=Math.max(0,busyCount-1);$('#busy').hidden=busyCount===0;};}
function report(error){notice((error.code?error.code+': ':'')+(error.message??String(error)),'error');}
function handle(task){return Promise.resolve().then(task).catch(report);}
function button(label,callback,style='secondary'){const b=document.createElement('button');b.type='button';b.className=style;b.textContent=label;b.addEventListener('click',()=>handle(callback));return b;}
function badge(value){const span=document.createElement('span');span.className='badge';span.dataset.state=text(value);span.textContent=text(value);return span;}
function jsonDetails(label,value,open=false){const d=document.createElement('details');d.open=open;const s=document.createElement('summary');s.textContent=label;const p=document.createElement('pre');p.textContent=pretty(value);d.append(s,p);return d;}
function definitions(values){const dl=document.createElement('dl');for(const [label,value]of Object.entries(values)){if(value===undefined)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text(value);dl.append(dt,dd);}return dl;}
function parse(textValue,label='JSON'){try{const value=JSON.parse(textValue||'{}');canonical(value);return value;}catch(error){throw fail('INPUT_JSON_INVALID',label+': '+error.message);}}
function objectInput(value,label){const result=parse(value,label);if(!result||Array.isArray(result)||typeof result!=='object')throw fail('INPUT_OBJECT_REQUIRED',label+' must be a JSON object.');return result;}
function formObject(form){return Object.fromEntries(new FormData(form).entries());}
function nativeDate(value){return value?new Date(value+'Z').toISOString():undefined;}
function ids(value){return value.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean);}
function actionId(action){return action.id??action.action;}
function catalogue(){return bootstrap?.catalogue??[];}
function currentAction(){return catalogue().find(action=>actionId(action)===$('#action-select').value);}
function isMutation(action){return action?.mutation===true;}
function connection(alias){return bootstrap.connections.find(row=>row.alias===alias);}
async function api(path,{method='GET',body,headers={},raw=false}={}){
 if(!token)throw fail('OPERATOR_TOKEN_REQUIRED','Open the workspace with its operator token.');
 const options={method,headers:{Authorization:'Bearer '+token,...headers},cache:'no-store'};
 if(method!=='GET'){if(!workspaceId)throw fail('WORKSPACE_REQUIRED','Open the selected workspace first.');options.headers['X-Amero-Workspace-ID']=workspaceId;}
 if(body!==undefined){if(raw)options.body=body;else{options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}}
 let response;try{response=await fetch(path,options);}catch(error){throw Object.assign(fail('TRANSPORT_UNCERTAIN','The host response was not received. The exact request remains in this browser.'),{cause:error});}
 if(!response.ok){let payload;try{payload=await response.json();}catch{payload={};}const source=payload.error??payload;const error=fail(source.code??'HTTP_'+response.status,source.message??'The host could not complete this request.',source.details);error.status=response.status;if(response.status===401){$('#access-screen').hidden=false;$('#shell').inert=true;}throw error;}
 return response;
}
async function readJSON(path){return(await api(path)).json();}
async function fetchItem(table,id){return readJSON('/api/item?'+new URLSearchParams({table,id}));}
async function fetchList(table,options={}){const query=new URLSearchParams({table,limit:'100'});for(const[k,v]of Object.entries(options))if(v!==null&&v!==undefined&&v!=='')query.set(k,String(v));return readJSON('/api/list?'+query);}
async function refreshBootstrap(){
 if(refreshPromise)return refreshPromise;
 refreshPromise=(async()=>{const value=await readJSON('/api/bootstrap');if(workspaceId&&value.workspace.id!==workspaceId)throw fail('WORKSPACE_CHANGED','The host now serves a different workspace. Reload to select it; this workspace’s retained requests will not be sent there.');
 bootstrap=value;workspaceId=value.workspace.id;$('#workspace-name').textContent=value.workspace.name;$('#workspace-identity').textContent=workspaceId;$('#connection-status').textContent='Revision '+value.workspace.revision;
 $('#dispatch-indicator').textContent=value.workspace.dispatchEnabled?'Dispatch enabled':'Dispatch disabled';
 for(const node of $$('[data-count]'))node.textContent=String(value.summary[node.dataset.count]??0);
 if(document.activeElement!==$('#profile-form [name=name]')&&!$('#profile-form').dataset.dirty)$('#profile-form [name=name]').value=value.workspace.name;
 if(!$('#dispatch-form').dataset.dirty)$('#dispatch-form [name=enabled]').checked=value.workspace.dispatchEnabled;
 renderConnections();renderOverview();fillSelects();$('#book-contract').textContent=pretty(value.methods?.find(m=>m.name==='book.save')??{});$('#link-contract').textContent=pretty(value.methods?.find(m=>m.name==='link.save')??{});$('#plan-contract').textContent=pretty(value.methods?.find(m=>m.name==='plan.save')??{});return value;})().finally(()=>{refreshPromise=null;});return refreshPromise;
}
function fillSelect(select,items,first=null){
 const prior=select.value;select.replaceChildren();if(first){const option=document.createElement('option');option.value='';option.textContent=first;select.append(option);}
 for(const item of items){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;select.append(option);}
 if([...select.options].some(option=>option.value===prior))select.value=prior;
}
function filteredCatalogue(){
 const selected=connection($('#action-connection').value),all=catalogue();
 return selected?.provider?all.filter(action=>!action.provider||action.provider===selected.provider):all;
}
function refreshActionChoices(){
 fillSelect($('#action-select'),filteredCatalogue().map(action=>({value:actionId(action),label:(action.label??actionId(action))+' · '+actionId(action)})));
 renderAction();
}
function fillSelects(){
 const connections=bootstrap.connections.map(row=>({value:row.alias,label:row.alias+' · '+row.provider+' · '+row.environment+(row.tenantId?' · '+short(row.tenantId):'')}));
 for(const select of $$('.connection-select'))fillSelect(select,connections);
 for(const select of $$('.horizon-select'))fillSelect(select,bootstrap.connections.filter(x=>x.provider==='horizon').map(x=>({value:x.alias,label:x.alias+' · '+x.environment})));
 fillSelect($('#action-connection'),connections);fillSelect($('#filter-connection'),connections,'All connections');
 const actions=catalogue().map(action=>({value:actionId(action),label:(action.label??actionId(action))+' · '+actionId(action)}));
 fillSelect($('#action-select'),filteredCatalogue().map(action=>({value:actionId(action),label:(action.label??actionId(action))+' · '+actionId(action)})));for(const select of $$('.catalogue-select'))fillSelect(select,actions);
}
function renderConnections(){
 for(const target of [$('#overview-connections'),$('#settings-connections')]){
 target.replaceChildren();if(!bootstrap.connections.length){target.innerHTML='<p class="muted">No provider connection is configured. Full source, reports and receiving remain available.</p>';continue;}
 for(const row of bootstrap.connections){const box=document.createElement('div');box.append(definitions({Connection:row.alias,Environment:row.environment,Tenant:row.tenantId,Provider:row.provider,Compatibility:row.apiMode??row.compatibility??row.apiVersion,'Distribution account':row.distributionWalletId,Network:row.network,Endpoint:row.baseUrl}));target.append(box);}
 }
}
function renderOverview(){
 $('#overview-metrics').replaceChildren();for(const [label,key]of [['Programmes','books'],['Payout plans','plans'],['Original observations','resources'],['Reconciliation editions','reconciliations']]){const metric=document.createElement('div');metric.className='metric';metric.innerHTML='<span>'+esc(label)+'</span><strong>'+esc(bootstrap.summary[key]??0)+'</strong>';$('#overview-metrics').append(metric);}
 $('#received-notice').replaceChildren();if(bootstrap.workspace.receivedFrom)$('#received-notice').append(jsonDetails('Received workspace provenance',bootstrap.workspace.receivedFrom));
}
async function remember(){await saveView(workspaceId,view);}
async function navigate(next,{keepSelection=false}={}){
 const generation=++navigationGeneration;detailGeneration++;if(!titles[next])next='overview';page=next;view.page=next;$('#page-title').textContent=titles[next];
 for(const b of $$('#navigation [data-view]'))b.setAttribute('aria-current',b.dataset.view===next?'page':'false');
 for(const panel of $$('[data-panel]'))panel.hidden=true;
 if(tables.has(next)){
 const recordPanel=$('[data-panel=records]');recordPanel.hidden=false;
 if(next==='sources'){$('[data-panel=sources]').hidden=false;$('#sources-record-mount').append(recordPanel);}else{$('[data-panel=trade]').after(recordPanel);}
 if(next==='links')$('[data-panel=link-editor]').hidden=false;
 if(next==='reconciliations')$('[data-panel=reconciliation-editor]').hidden=false;
 if(next==='books')$('[data-panel=book-editor]').hidden=false;
 if(next==='plans')$('[data-panel=plan-editor]').hidden=false;if(next==='streams')$('[data-panel=stream-editor]').hidden=false;
 await loadRecords(false);if(generation!==navigationGeneration)return;if(!keepSelection)$('#record-detail').hidden=true;
 }else{$('[data-panel="'+next+'"]').hidden=false;if(next==='trade')renderAction();if(next==='recovery')await renderRecovery();if(next==='transfer'){renderTransfer();await loadExports(false);}}
 await remember();
}
async function loadRecords(more=false){
 const generation=++listGeneration,table=page;if(!tables.has(table))return;
 const filters=formObject($('#record-filter'));
  if(table==='operations'){filters.state=filters.status;delete filters.status;}
 if(table!=='resources'&&table!=='sources')delete filters.kind;
 const result=await fetchList(table,{...filters,cursor:more?cursor:null});
 if(generation!==listGeneration||table!==page)return;
 rows=more?[...rows,...result.rows]:result.rows;cursor=result.nextCursor;$('#records-title').textContent=titles[table];$('#records-description').textContent=descriptions[table];$('#records-more').hidden=!cursor;$('#record-page-label').textContent=rows.length+' retained rows loaded'+(cursor?' · more available':'');renderRows();updateOptions(table,rows);
}
function updateOptions(table,items){
 const mapping={resources:'resource-options',resourceVersions:'version-options',sources:'source-options',books:'book-options',links:'link-options'},id=mapping[table];if(!id)return;
 const target=$('#'+id),known=new Map([...target.options].map(o=>[o.value,o.textContent]));
 for(const row of items)known.set(row.id,(row.name??row.kind??row.action??'')+' '+(row.version??row.resourceId??row.id));
 target.replaceChildren(...[...known].map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
 if(table==='resources')updateOptions('resourceVersions',items.filter(x=>x.currentVersionId).map(x=>({id:x.currentVersionId,kind:x.kind,resourceId:x.resourceId})));
}
function renderRows(){
 const host=$('#record-table');host.replaceChildren();if(!rows.length){host.innerHTML='<p class="empty">No records match this selection.</p>';return;}
 const resource=page==='resources',table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
 head.innerHTML='<tr><th>Record</th><th>State / kind</th><th>Environment / connection</th><th>Observed / created</th><th>'+ (resource?'Amount and relationship':'Scope')+'</th></tr>';
 for(const row of rows){
 const s=resource?resourceSummary(row):null,tr=document.createElement('tr');if(selected?.id===row.id&&selected.table===page)tr.className='selected';
 const name=document.createElement('td');name.append(button(s?.title??row.name??row.definition?.name??row.action??row.eventType??row.kind??short(row.id),()=>selectRecord(page,row.id),'text-button'));
 const id=document.createElement('small');id.className='mono';id.textContent=resource?row.resourceId:row.id;name.append(id);
 const state=document.createElement('td');state.append(badge(row.conflict?'CONFLICT':page==='books'?'VERSION '+row.version:s?.status??row.state??row.status??row.kind??'RETAINED'));
 if(resource){const k=document.createElement('small');k.textContent=row.kind;state.append(k);}
 const c=document.createElement('td');c.textContent=[row.connectionAlias,row.environment??row.definition?.environment].filter(Boolean).join(' · ')||'Workspace';
 const time=document.createElement('td');time.textContent=row.observedAt??row.createdAt??row.updatedAt??'—';const scope=document.createElement('td');
 if(resource){for(const value of [s.primary,s.secondary,s.relation].filter(Boolean)){const line=document.createElement('div');line.textContent=value;scope.append(line);}}
 else scope.textContent=page==='streams'?('Cursor '+row.cursor+' · '+row.eventCount+' events · '+row.runtimeState):page==='books'?[row.definition?.period?.start,row.definition?.period?.end,row.definition?.fundId].filter(Boolean).join(' · '):
 page==='links'?[row.kind,row.subjectVersionId,row.targetVersionId,row.subjectAmount].filter(Boolean).join(' · '):
 row.resourceId??(row.pages?row.pages.length+' pages':row.sourceIds?row.sourceIds.length+' sources':row.files?row.files.length+' files':'');
 tr.append(name,state,c,time,scope);body.append(tr);
 }table.append(head,body);host.append(table);
}
function renderObservation(row){
 const section=document.createElement('section'),value=exactObservation(row);
 section.append(definitions({'Original provider':row.provider,'Source scope':row.scope??row.sourceScope,'Observed':row.observedAt,'Connection':row.connectionAlias,'Environment':row.environment}));
 section.append(renderData(value,'Complete original observation'));
 section.append(jsonDetails('Original numeric spellings',row.numberTokens??row.projectionNumberTokens??{}));return section;
}
function reconciliationTable(values,columns,{actions=null,empty='No records in this selection.'}={}){
 const section=document.createElement('section');if(!values.length){const p=document.createElement('p');p.className='empty';p.textContent=empty;section.append(p);return section;}
 const wrap=document.createElement('div');wrap.className='table-scroll';const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),header=document.createElement('tr');
 for(const column of columns){const th=document.createElement('th');th.scope='col';th.textContent=column.label;header.append(th);}const th=document.createElement('th');th.scope='col';th.textContent='Original record';header.append(th);head.append(header);table.append(head,body);wrap.append(table);section.append(wrap);
 let offset=0;const more=button('Show next 100 records',()=>add(),'secondary');section.append(more);
 function add(){for(const row of values.slice(offset,offset+100)){const tr=document.createElement('tr');for(const col of columns){const td=document.createElement('td'),value=col.get?col.get(row):row[col.key];td.textContent=value===null||value===undefined?'Not supplied':typeof value==='object'?pretty(value):String(value);tr.append(td);}
 const detail=document.createElement('td');detail.append(jsonDetails('Complete record',row));if(actions){const controls=document.createElement('div');controls.className='button-row';for(const action of actions(row))controls.append(button(action.label,action.run,'text-button'));detail.append(controls);}tr.append(detail);body.append(tr);}
 offset=Math.min(offset+100,values.length);more.hidden=offset>=values.length;more.textContent='Show next '+Math.min(100,values.length-offset)+' records · '+offset+' of '+values.length;}
 add();return section;
}
function reconciliationOriginalActions(row){
 const actions=[];
 if(row.versionId)actions.push({label:'Use original version',run:async()=>{const version=await fetchItem('resourceVersions',row.versionId);await selectEvidence(version);}});
 if(row.sourceId)actions.push({label:'Open original source',run:()=>openRecord('sources',row.sourceId)});
 if(row.captureId)actions.push({label:'Open source collection',run:()=>openRecord('captures',row.captureId)});
 return actions;
}
function renderReconciliation(data){
 const host=document.createElement('section');if(!data){host.append(jsonDetails('Complete result',data));return host;}
 const groups=Object.keys(data).filter(key=>Array.isArray(data[key])),edition=selected?.id??data.id??'current';
 const summary=document.createElement('div');summary.className='metrics';
 for(const key of ['proposals','milestones','disbursements','payments','findings'].filter(key=>groups.includes(key))){const box=document.createElement('div');box.className='metric';box.append(document.createTextNode(sectionTitle(key)));const n=document.createElement('strong');n.textContent=String(data[key].length);box.append(n);summary.append(box);}host.append(summary);
 const scope=Object.fromEntries(Object.entries(data).filter(([key])=>!groups.includes(key)));host.append(jsonDetails('Programme scope, coverage and basis',scope,true));
 const controls=document.createElement('form');controls.className='filter-row';controls.innerHTML='<label>Register<select name="group"></select></label><label>Find record<input name="query" placeholder="Exact ID, source or text"></label><label>Provider status<input name="providerStatus" placeholder="Original status"></label><label>Reconciliation state<input name="status" placeholder="Evidence or review state"></label><button type="submit" class="secondary">Apply review filters</button>';
 for(const group of groups){const option=document.createElement('option');option.value=group;option.textContent=sectionTitle(group)+' ('+data[group].length+')';controls.elements.group.append(option);}
 const saved=view.registerFilters?.[edition]??{};for(const key of ['group','query','providerStatus','status'])if(saved[key]!==undefined)controls.elements[key].value=saved[key];
 if(!controls.elements.group.value&&groups.length)controls.elements.group.value=groups.includes('findings')&&data.findings.length?'findings':groups[0];
 const results=document.createElement('section');host.append(controls,results);
 function render(){const choice=formObject(controls),values=data[choice.group]??[],query=choice.query.trim().toLowerCase(),status=choice.status.trim().toLowerCase(),providerStatus=choice.providerStatus.trim().toLowerCase();
 const filtered=values.filter(row=>(!query||pretty(row).toLowerCase().includes(query))&&(!status||String(row?.status??row?.state??row?.reconciliationState??'').toLowerCase()===status)&&(!providerStatus||String(row?.providerStatus??'').toLowerCase()===providerStatus));
 const title=document.createElement('h3');title.textContent=sectionTitle(choice.group)+' · '+filtered.length+' of '+values.length;results.replaceChildren(title);
 const fields=displayColumns(choice.group,filtered);results.append(reconciliationTable(filtered,fields.map(([key,label])=>({key,label})),{actions:reconciliationOriginalActions}));
 view.registerFilters={...(view.registerFilters??{}),[edition]:choice};}
 controls.addEventListener('submit',event=>{event.preventDefault();render();handle(remember);});
 controls.elements.group.addEventListener('change',()=>{render();handle(remember);});render();
 host.append(jsonDetails('Complete unchanged reconciliation edition',data));return host;
}
async function openRegister(kind){
 $('#record-filter [name=kind]').value=kind;$('#record-filter [name=status]').value='';await rememberDrafts();await navigate('resources');
}
async function selectRecord(table,id){
 const generation=++detailGeneration;const row=await fetchItem(table,id);if(generation!==detailGeneration||page!==table)return;selected={table,id,row};view.selected={table,id};$('#record-detail').hidden=false;$('#detail-type').textContent=table;$('#detail-title').textContent=row.name??row.definition?.name??row.action??row.eventType??row.kind??short(id);
 $('#detail-summary').replaceChildren(definitions({ID:row.id,State:row.state??row.status,Connection:row.connectionAlias,Environment:row.environment,Resource:row.resourceId,Created:row.createdAt,Updated:row.updatedAt}));
 $('#detail-actions').replaceChildren();$('#detail-content').replaceChildren();await renderDetail(table,row,generation);if(generation!==detailGeneration||page!==table||selected?.id!==row.id)return;renderRows();await remember();if(generation===detailGeneration&&page===table&&selected?.id===row.id)$('#record-detail').scrollIntoView({behavior:'smooth',block:'start'});
}


function addAction(label,callback,style){$('#detail-actions').append(button(label,callback,style));}
function appendContent(...nodes){$('#detail-content').append(...nodes);}
async function renderDetail(table,row,generation=detailGeneration){
 if(table==='streams'){
 appendContent(definitions({Account:row.accountId,'Starting cursor':row.startCursor,'Committed cursor':row.cursor,'Last event ID':row.lastEventId,'Retained events':row.eventCount,'Process state':row.runtimeState,'Retry at':row.retryAt}));
 appendContent(jsonDetails('Selected original connection',row.connection),jsonDetails('Latest worker observation',row.lastObservation??{},true));
 addAction(row.status==='ACTIVE'?'Pause selected stream':'Resume selected stream',()=>command('stream.pause',{streamId:row.id,paused:row.status==='ACTIVE'}));
 const p=document.createElement('p');p.textContent='Run the existing native settlement-stream.mjs worker for this workspace and stream ID. Resume selects the saved cursor; the worker continues when its original process is running or is started on the host.';appendContent(p);
 await linkedRows('sources',row.sourceIds??[],'Retained original events');appendContent(jsonDetails('Complete stream record',row));return;
 }
 if(table==='books'||table==='links'){await renderBookDetail(table,row);return;}
 if(table==='plans'){await renderPlanDetail(row);return;}
 if(table==='operations'){
 const action=catalogue().find(item=>actionId(item)===row.action);
 appendContent(jsonDetails('Prepared request · '+(isMutation(action)?'provider mutation':'read-only'),row.request,true));appendContent(jsonDetails('Selected evidence',row.evidence??{}));
 if(row.state==='PREPARED'){if(isMutation(action)&&!bootstrap.workspace.dispatchEnabled){const p=document.createElement('p');p.textContent='Economic dispatch is disabled for this workspace. Review the selected connection in Workspace settings before enabling it.';appendContent(p);addAction('Open dispatch settings',()=>navigate('settings'));}else addAction(isMutation(action)?'Dispatch reviewed operation':'Run prepared read',()=>command('operation.dispatch',{operationId:row.id}),isMutation(action)?'':'secondary');}
 if(row.state!=='PREPARED'&&row.state!=='CANCELED'&&row.readback)addAction('Read provider outcome',()=>command('operation.reconcile',{operationId:row.id}));
 
 if(row.state==='PREPARED')addAction('Cancel preparation',async()=>{const reason=prompt('Reason for canceling this prepared operation');if(reason?.trim())await command('operation.cancel',{operationId:row.id,reason:reason.trim()});});
 if(['DISPATCHING','UNCERTAIN'].includes(row.state)){const p=document.createElement('p');p.textContent='The provider outcome is unresolved. Read the existing resource and inspect retained attempts before preparing any new economic operation.';appendContent(p);}
 if(row.readback)appendContent(jsonDetails('Provider readback',row.readback,true));
 if(row.retry?.sameRequestSafe&&bootstrap.methods.some(method=>method.name==='operation.retry-original')){appendContent(definitions({'Retry permitted by provider':row.retry.reason,'Retry after':row.retryAfter,'Original first attempt':row.firstAttemptAt}));addAction('Retry the same original request',()=>command('operation.retry-original',{operationId:row.id}));const retryNote=document.createElement('p');retryNote.textContent='This explicit retry retains the original provider body and idempotency key. The host enforces the provider delay and selected provider retry policy.';appendContent(retryNote);}
 appendRelatedReads(row.relatedReads??row.readback?.relatedReads,row.connectionAlias);
 appendContent(jsonDetails('Full operation record',row));
 await linkedRows('attempts',row.attemptIds??[],'Provider attempts');await linkedRows('sources',row.sourceIds??[],'Retained source files');
 }else if(table==='resources'){
 const currentVersion=row.currentVersionId?await fetchItem('resourceVersions',row.currentVersionId):null;if(generation!==detailGeneration||page!=='resources'||selected?.table!=='resources'||selected.id!==row.id)return;
 appendContent(renderObservation(currentVersion??row));appendRelatedReads(row.relatedReads??row.projection?.relatedReads,row.connectionAlias);
 addAction('Read current provider resource',()=>prepareReadback(row,currentVersion));
 if(row.currentVersionId)addAction('Select version for reconciliation',()=>selectReconciliation('versionIds',row.currentVersionId));
 if(currentVersion){const allocation=allocationSelection(currentVersion);if(allocation)addAction(allocation.label,()=>editLink(allocation.fields));}
 await renderVersions(row,generation);
 }else if(table==='captures'){
 appendContent(definitions({Action:row.action,Pages:row.pages?.length??0,Status:row.status,Next:row.next,PendingOperation:row.pendingOperationId}));
 appendContent(jsonDetails('Frozen input and retained cursor',{input:row.input,next:row.next,pages:row.pages},true));
 if(row.status!=='COMPLETE')addAction('Continue collection',()=>command('capture.run',{captureId:row.id,maxPages:100}));
 if(!['PAUSED','COMPLETE'].includes(row.status))addAction('Pause collection',()=>command('capture.pause',{captureId:row.id}));
 if(row.pendingOperationId)addAction('Inspect pending operation',async()=>{await navigate('operations');await selectRecord('operations',row.pendingOperationId);});
 appendContent(jsonDetails('Full collection record',row));
 }else if(table==='sources'){
 appendContent(definitions({Kind:row.kind,Action:row.action,Bytes:row.bytes,'Body SHA-256':row.bodySha256,'Complete body':row.bodyComplete,'Private raw body':row.privateBody,'Projection error':row.projectionError}));
 if(row.downloadableFileId)addAction('Download complete statement',()=>download('/api/file/'+encodeURIComponent(row.downloadableFileId),row.downloadFileName??row.downloadFilename??row.filename??('statement-'+row.id+(String(row.kind).endsWith('.pdf')?'.pdf':'.csv'))));
 if(row.publicFileId)addAction('Download public source',()=>download('/api/file/'+encodeURIComponent(row.publicFileId),'source-'+row.id+'.json'));
 if(row.receiptFileId)addAction('Project retained response',()=>command('source.project',{sourceId:row.id}));
 addAction('Use as named source evidence',()=>selectNamedEvidence('sourceIds',row.id,row.connectionAlias));
 addAction('Add to decision evidence',()=>selectLinkSource(row.id));
 appendContent(jsonDetails('Source record',row,true));await linkedRows('resourceVersions',row.versionIds??[],'Projected versions');
 }else if(table==='reconciliations'){
 appendContent(renderReconciliation(row.data));appendContent(jsonDetails('Pinned source and version selection',{sourceIds:row.sourceIds,versionIds:row.versionIds,linkIds:row.linkIds,bookVersionId:row.bookVersionId}));
 const form=document.createElement('form');form.id='report-form';form.innerHTML='<h3>Create report from this edition</h3><label>Report name<input name="name" value="'+esc(row.name??'Programme and payout report')+'"></label><button type="submit">Create full JSON, CSV and HTML report</button>';
 form.addEventListener('submit',event=>{event.preventDefault();handle(()=>command('report.create',{reconciliationId:row.id,name:form.elements.name.value}));});appendContent(form);
 }else if(table==='reports'){
 appendContent(definitions({Edition:row.reconciliationId,Created:row.createdAt}));appendContent(fileList(row.files??[]));appendContent(jsonDetails('Report scope',row.scope));
 const form=document.createElement('form');form.id='report-export-form';form.innerHTML='<h3>Export this report</h3><label>Destination directory<input name="destination" required placeholder="/private/deliveries/amero-report"></label><button type="submit">Create complete report delivery</button>';
 form.addEventListener('submit',event=>{event.preventDefault();handle(()=>command('report.export',{reportId:row.id,destination:form.elements.destination.value}));});appendContent(form);
 }else appendContent(jsonDetails('Full record',row,true));
}
async function linkedRows(table,identities,title){
 if(!identities.length)return;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title+' · '+identities.length;details.append(summary);appendContent(details);
 for(const id of identities){const wrapper=document.createElement('div');wrapper.className='file-row';wrapper.append(button(short(id),async()=>{const value=await fetchItem(table,id);const display=jsonDetails('Full '+table+' record',value,true);wrapper.append(display);if(table==='sources'&&value.publicFileId)wrapper.append(button('Download source',()=>download('/api/file/'+encodeURIComponent(value.publicFileId),'source-'+id+'.json')));},'text-button'));details.append(wrapper);}
}
function allocationSelection(version){
 return {label:'Use original version in a review decision',fields:{subjectVersionId:version.id}};
}
async function renderVersions(resource,generation=detailGeneration){
 let next=null,loaded=0;const holder=document.createElement('div');holder.innerHTML='<h3>Retained versions</h3>';appendContent(holder);
 const list=document.createElement('div'),more=button('Load next versions',()=>loadMore());holder.append(list,more);
 async function loadMore(){const pageResult=await fetchList('resourceVersions',{resourceId:resource.resourceId,connectionAlias:resource.connectionAlias,environment:resource.environment,cursor:next});next=pageResult.nextCursor;if(generation!==detailGeneration||page!=='resources'||selected?.table!=='resources'||selected.id!==resource.id)return;
 for(const version of pageResult.rows){if(version.localResourceId!==resource.id)continue;loaded++;if(version.id===resource.currentVersionId)appendRelatedReads(version.relatedReads??version.value?.relatedReads,version.connectionAlias);const d=jsonDetails(version.id===resource.currentVersionId?'Current version · '+short(version.id):'Version · '+short(version.id),version);const actions=document.createElement('div');actions.className='button-row';
 actions.append(button('Use exact version',()=>selectEvidence(version)),button('Select for reconciliation',async()=>{const field=$('#reconciliation-form [name=versionIds]');field.value=[...new Set([...ids(field.value),version.id])].join('\n');await navigate('reconciliations');}));const allocation=allocationSelection(version);if(allocation)actions.append(button(allocation.label,()=>editLink(allocation.fields)));d.append(actions);list.append(d);updateOptions('resourceVersions',[version]);}
 more.hidden=!next;if(!loaded&&!next)list.innerHTML='<p class="empty">No versions in this selection.</p>';
 }
 await loadMore();
}
async function selectEvidence(version){
 await selectNamedEvidence('versionIds',version.id,version.connectionAlias,version.kind??'resource');
}
async function selectNamedEvidence(field,id,alias,suggested='source'){
 const name=prompt('Evidence name from the selected action contract',suggested);if(!name?.trim())return;
 const input=$('#operation-form [name='+field+']'),value=objectInput(input.value,field);value[name.trim()]=id;input.value=pretty(value);
 if(alias)$('#action-connection').value=alias;await rememberDrafts();await navigate('trade');notice('Selected exact retained evidence. Review its selected book, environment and complete request before preparation.');
}
function appendRelatedReads(reads,alias){
 if(!Array.isArray(reads)||!reads.length)return;
 const selected=reads.filter(read=>catalogue().some(action=>actionId(action)===(read.action??read.id)&&!action.mutation));
 if(!selected.length)return;const holder=document.createElement('section');holder.innerHTML='<h3>Read linked chain records</h3>';const actions=document.createElement('div');actions.className='button-row';
 for(const read of selected)actions.append(button(read.label??(read.field?read.action+' · '+read.field:read.action??read.id),()=>selectRelatedRead(read,alias)));holder.append(actions);appendContent(holder);
}

async function selectRelatedRead(read,originAlias){
 const id=read.action??read.id,entry=catalogue().find(item=>actionId(item)===id),origin=connection(originAlias),required=read.requiresConnectionProvider??entry?.provider;
 if(origin&&(!required||origin.provider===required))return selectNativeAction(id,read.input??{},originAlias);
 const options=bootstrap.connections.filter(item=>item.provider===required&&(!origin?.environment||item.environment===origin.environment)&&(!origin?.network||!item.network||item.network===origin.network));
 if(!options.length)throw fail('READ_CONNECTION_REQUIRED','Configure a '+required+' connection in the original '+(origin?.environment??'selected')+' environment and network to read this record.');
 const dialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h2'),description=document.createElement('p'),label=document.createElement('label'),select=document.createElement('select'),actions=document.createElement('div');
 heading.textContent='Select the original '+required+' connection';description.textContent='The linked read will use the selected environment and network. Review its complete input before preparing the request.';label.textContent='Connection';select.required=true;select.append(new Option('Select connection',''));
 for(const option of options)select.append(new Option(option.alias+' · '+option.environment+' · '+(option.network??'review configured network'),option.alias));label.append(select);actions.className='button-row';
 const open=document.createElement('button');open.type='submit';open.textContent='Open linked read';const cancel=button('Cancel',()=>dialog.close());actions.append(open,cancel);form.append(heading,description,label,actions);dialog.append(form);document.body.append(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});form.addEventListener('submit',event=>{event.preventDefault();handle(async()=>{await selectNativeAction(id,read.input??{},select.value);dialog.close();});});dialog.showModal();
}

function parameterInput(id,resourceId){
 const entry=catalogue().find(x=>actionId(x)===id),params={};for(const raw of entry?.inputSchema?.parameters??[]){const parameter=resolveSchema(raw,entry);if(parameter.in==='path')params[parameter.name]=resourceId;}return params;
}
async function prepareReadback(resource,currentVersion){
 const observed=resource.relatedReads??resource.projection?.relatedReads??currentVersion?.relatedReads??[];
 const selectedRead=observed.find(read=>catalogue().some(entry=>actionId(entry)===read.action&&!isMutation(entry)));
 if(selectedRead){await selectRelatedRead(selectedRead,resource.connectionAlias);return;}
 await navigate('trade');notice('Select the matching provider read action and retain its exact resource ID: '+resource.resourceId+'. No request has been dispatched.');
}
function renderData(value,title){
 const section=document.createElement('section');if(title){const heading=document.createElement('h3');heading.textContent=title;section.append(heading);}
 if(Array.isArray(value)){renderArray(section,value);return section;}
 if(value&&typeof value==='object'){const simple={},complex=[];for(const[k,v]of Object.entries(value)){if(v===null||typeof v!=='object')simple[k]=v;else complex.push([k,v]);}if(Object.keys(simple).length)section.append(definitions(simple));
 for(const[k,v]of complex){const d=document.createElement('details');d.open=Array.isArray(v)&&v.length>0&&v.length<12;const s=document.createElement('summary');s.textContent=k+(Array.isArray(v)?' · '+v.length:'');d.append(s,renderData(v));section.append(d);}return section;}
 section.textContent=text(value);return section;
}
function renderArray(holder,values){
 if(!values.length){holder.innerHTML='<p class="empty">No retained rows.</p>';return;}
 if(values.every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
 const keys=[...new Set(values.flatMap(v=>Object.keys(v)))];const wrap=document.createElement('div');wrap.className='table-scroll';const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');head.innerHTML='<tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr>';table.append(head,body);wrap.append(table);holder.append(wrap);let offset=0;
 const more=button('Show more retained rows',()=>add());holder.append(more);function add(){for(const row of values.slice(offset,offset+100)){const tr=document.createElement('tr');for(const key of keys){const td=document.createElement('td');td.textContent=text(row[key]);tr.append(td);}body.append(tr);}offset+=100;more.hidden=offset>=values.length;}add();
 }else{const pre=document.createElement('pre');pre.textContent=pretty(values);holder.append(pre);}
}
function fileList(files){
 const holder=document.createElement('div');holder.className='file-list';for(const file of files){const row=document.createElement('div');row.className='file-row';const detail=document.createElement('div');detail.textContent=file.filename??file.id;const small=document.createElement('small');small.textContent=(file.bytes??0)+' bytes · '+(file.sha256??'');detail.append(small);const actions=document.createElement('div');actions.className='button-row';const url=file.private===true?null:file.url??'/api/file/'+encodeURIComponent(file.id);if(url)actions.append(button('Download',()=>download(url,file.filename??file.id)));if(url&&(file.contentType?.includes('text/html')||file.filename?.endsWith('.html')))actions.append(button('Preview',()=>preview(url,file.filename)));row.append(detail,actions);holder.append(row);}return holder;
}
async function download(path,filename){
 const done=busy('Downloading complete file…');let response=null,output=null;
 try{
  if(globalThis.showSaveFilePicker){const handle=await showSaveFilePicker({suggestedName:filename});response=await api(path);if(!response.body)throw fail('DOWNLOAD_BODY_MISSING','The original file response has no body.');output=await handle.createWritable();await response.body.pipeTo(output);output=null;response=null;}
  else{response=await api(path);const body=await response.blob();response=null;saveBlob(body,filename);}
 }catch(error){try{await output?.abort();}catch{}try{await response?.body?.cancel();}catch{}if(error.name!=='AbortError')throw error;}finally{done();}
}
function saveBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function downloadText(value,filename){saveBlob(new Blob([value],{type:'text/plain'}),filename);}
async function preview(url,title){const response=await api(url);if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(await response.blob());$('#report-preview').src=previewUrl;$('#preview-title').textContent=title;$('#preview-dialog').showModal();}
function resolveSchema(value,entry,seen=new Set()){
 if(!value||typeof value!=='object')return value;
 if(value.$ref?.startsWith('#/')){if(seen.has(value.$ref))return {};seen.add(value.$ref);let target=entry.spec??{components:entry.inputSchema?.components};for(const key of value.$ref.slice(2).split('/'))target=target?.[key.replace(/~1/g,'/').replace(/~0/g,'~')];return resolveSchema(target??{},entry,seen);}
 if(value.allOf){const result={...value,properties:{...(value.properties??{})},required:[...(value.required??[])]};delete result.allOf;for(const part of value.allOf){const resolved=resolveSchema(part,entry,new Set(seen));Object.assign(result.properties,resolved.properties??{});result.required.push(...resolved.required??[]);if(!result.type&&resolved.type)result.type=resolved.type;}return result;}return value;
}
function inputSchemas(entry){
 const schemas={params:{type:'object',properties:{},required:[]},query:{type:'object',properties:{},required:[]},headers:{type:'object',properties:{},required:[]},body:{}};
 for(const raw of entry?.inputSchema?.parameters??[]){const parameter=resolveSchema(raw,entry);const section=parameter.in==='path'?'params':parameter.in==='query'?'query':parameter.in==='header'&&!/^(authorization|cookie|x-api-key|accept|content-type|host|content-length|connection|transfer-encoding)$/i.test(parameter.name)?'headers':null;if(section){schemas[section].properties[parameter.name]={...resolveSchema(parameter.schema??{},entry),description:parameter.description??parameter.schema?.description};if(parameter.required)schemas[section].required.push(parameter.name);}}
 const request=resolveSchema(entry?.inputSchema?.requestBody??{},entry);const media=request.content?.['application/json']??request.content?.['*/*'];schemas.body=resolveSchema(media?.schema??{},entry);return schemas;
}
function renderAction(){
 const entry=currentAction();$('#action-description').textContent=entry?.description??entry?.spec?.info?.description??entry?.label??'Select a native action.';
 if(entry?.fileUpload)$('#action-description').textContent+=' Select a complete retained CSV using the file field below.';
 $('#action-class').textContent=entry?(entry.dispatchable===false?'Documented source':(entry.mock?'Published mock · ':'')+(isMutation(entry)?'Provider mutation':'Read')):'No action';$('#action-contract').textContent=pretty(entry??{});$('#start-capture').disabled=!entry||isMutation(entry)||entry.dispatchable===false;$('#prepare-operation').disabled=!entry||entry.dispatchable===false;$('#start-capture').textContent=entry?.pagination?'Collect all pages':'Capture complete read';
 const holder=$('#action-guided-fields');holder.replaceChildren();if(!entry)return;const schemas=inputSchemas(entry);
 for(const section of ['params','query','headers','body']){
 const schema=resolveSchema(schemas[section],entry);if(!schema.properties)continue;const fieldset=document.createElement('fieldset');fieldset.innerHTML='<legend>'+esc(section)+' fields</legend>';const grid=document.createElement('div');grid.className='guided-grid';let value;try{value=objectInput($('#action-'+section).value,section);}catch{value={};}
 for(const[name,raw]of Object.entries(schema.properties)){const definition=resolveSchema(raw,entry);const label=document.createElement('label');label.textContent=name+(schema.required?.includes(name)?' *':'');let control;
 if(definition.enum){control=document.createElement('select');const blank=document.createElement('option');blank.value='';blank.textContent='Not supplied';control.append(blank);for(const item of definition.enum){const option=document.createElement('option');option.value=JSON.stringify(item);option.textContent=text(item);control.append(option);}if(value[name]!==undefined)control.value=JSON.stringify(value[name]);}
 else if(definition.type==='boolean'){control=document.createElement('select');control.innerHTML='<option value="">Not supplied</option><option value="true">true</option><option value="false">false</option>';control.value=value[name]===undefined?'':String(value[name]);}
 else if(definition.type==='object'||definition.type==='array'||definition.oneOf||definition.anyOf||definition.properties){control=document.createElement('textarea');control.rows=3;label.className='wide';control.value=value[name]===undefined?'':pretty(value[name]);}
 else{control=document.createElement('input');control.type='text';control.value=value[name]===undefined?'':String(value[name]);control.autocomplete='off';if(definition.format==='uuid')control.placeholder='UUID';if(definition.type==='integer'||definition.type==='number')control.inputMode='decimal';}
 control.dataset.section=section;control.dataset.field=name;control.title=definition.description??'';
 control.addEventListener('change',()=>handle(()=>{const all=objectInput($('#action-'+section).value,section);if(control.value==='')delete all[name];else if(definition.enum||definition.type==='boolean'||control.tagName==='TEXTAREA')all[name]=parse(control.value,name);else if(definition.type==='integer'||definition.type==='number'){const number=Number(control.value);if(!Number.isFinite(number)||definition.type==='integer'&&!Number.isSafeInteger(number)||JSON.stringify(number)!==control.value.trim())throw fail('EXACT_NUMBER_REQUIRED',name+' must use an exact canonical '+definition.type+' spelling. Use the complete request editor to retain another original numeric spelling; the host validates the issued schema.');all[name]=number;}else all[name]=control.value;$('#action-'+section).value=pretty(all);handle(()=>rememberDrafts());}));
 label.append(control);if(definition.description){const hint=document.createElement('small');hint.textContent=definition.description;label.append(hint);}
 if(definition.format==='uuid'&&definition['x-client-generated']===true)label.append(button('Assign new '+name,()=>{control.value=crypto.randomUUID();control.dispatchEvent(new Event('change'));},'text-button'));
 grid.append(label);
 }fieldset.append(grid);holder.append(fieldset);
 }
}
function nativeInputJSON(){
 const sections=[];for(const section of ['params','query','headers','body']){
 const raw=$('#action-'+section).value.trim()||'{}';let value;
 try{value=JSON.parse(raw);}catch(error){throw fail('INPUT_JSON_INVALID',section+': '+error.message);}
 if(!value||Array.isArray(value)||typeof value!=='object')throw fail('INPUT_OBJECT_REQUIRED',section+' must be a JSON object.');
 if(Object.keys(value).length)sections.push(JSON.stringify(section)+':'+raw);
 }return '{'+sections.join(',')+'}';
}
async function selectNativeAction(id,input={},alias){
 const entry=catalogue().find(entry=>actionId(entry)===id);if(!entry)throw fail('ACTION_NOT_AVAILABLE','This connection catalogue does not contain '+id+'.');
 const selectedConnection=connection(alias??$('#action-connection').value);if(!selectedConnection||entry.provider&&entry.provider!==selectedConnection.provider)throw fail('READ_CONNECTION_REQUIRED','Select the original '+entry.provider+' connection for '+id+'.');
 if(alias){$('#action-connection').value=alias;refreshActionChoices();}$('#action-select').value=id;for(const section of ['params','query','headers','body'])$('#action-'+section).value=pretty(input[section]??{});await navigate('trade');renderAction();await rememberDrafts();
}



function setBookScope(bookVersionId){
 view.scope={bookVersionId};for(const input of $$('[name="bookVersionId"]'))input.value=bookVersionId;
}
async function selectReconciliation(field,id){const input=$('#reconciliation-form [name='+field+']');input.value=[...new Set([...ids(input.value),id])].join('\n');await navigate('reconciliations');await rememberDrafts();}
async function openRecord(table,id){await navigate(table);await selectRecord(table,id);}
function bookDefinition(form){
 const v=formObject(form),definition={name:v.name.trim(),environment:v.environment,
 connections:{escala:ids(v.escalaAliases),sdp:ids(v.sdpAliases),horizon:ids(v.horizonAliases)},
 tenantId:v.tenantId.trim(),communityId:v.communityId.trim(),fundId:v.fundId.trim(),
 projectIds:ids(v.projectIds),proposalIds:ids(v.proposalIds),milestoneIds:ids(v.milestoneIds),distributionWalletIds:ids(v.distributionWalletIds),
 period:{start:v.periodStart.trim(),end:v.periodEnd.trim(),timeZone:v.timeZone.trim()},notes:v.notes};
 if(v.bookId.trim())definition.id=v.bookId.trim();return definition;
}
async function loadBook(row){
 const d=row.definition,f=$('#book-form');f.reset();
 const values={bookId:row.bookId,name:d.name,environment:d.environment,tenantId:d.tenantId,communityId:d.communityId,fundId:d.fundId,
 escalaAliases:(d.connections?.escala??[]).join('\n'),sdpAliases:(d.connections?.sdp??[]).join('\n'),horizonAliases:(d.connections?.horizon??[]).join('\n'),
 periodStart:d.period?.start,periodEnd:d.period?.end,timeZone:d.period?.timeZone,
 projectIds:(d.projectIds??[]).join('\n'),proposalIds:(d.proposalIds??[]).join('\n'),milestoneIds:(d.milestoneIds??[]).join('\n'),distributionWalletIds:(d.distributionWalletIds??[]).join('\n'),
 notes:d.notes,sourceIds:(row.sourceIds??[]).join('\n')};
 for(const[k,v]of Object.entries(values))f.elements[k].value=v??'';
 $('#book-editor-title').textContent='Edit from version '+row.version;await navigate('books');await rememberDrafts();f.scrollIntoView({behavior:'smooth'});
}
async function editLink(values={}){
 const form=$('#link-form');for(const [k,v]of Object.entries(values))if(form.elements[k])form.elements[k].value=v??'';
 if(!form.elements.bookVersionId.value&&view.scope?.bookVersionId)form.elements.bookVersionId.value=view.scope.bookVersionId;
 await navigate('links');await rememberDrafts();form.scrollIntoView({behavior:'smooth'});
}
async function selectLinkSource(id){const f=$('#link-form [name=sources]');f.value=[...new Set([...ids(f.value),id])].join('\n');await editLink();}
function linkDecision(form){
 const v=formObject(form),decision={subjectVersionId:v.subjectVersionId.trim(),kind:v.kind,status:v.status,
 targetVersionId:v.targetVersionId.trim()||null,relation:v.relation.trim()||null,
 subjectAmount:v.subjectAmount.trim()||null,targetAmount:v.targetAmount.trim()||null,
 unitBinding:parse(v.unitBinding,'Complete unit binding'),reason:v.reason.trim(),actor:v.actor.trim(),
 sources:ids(v.sources),supersedesDecisionId:v.supersedesDecisionId.trim()||null};
 if(v.recordedAt.trim())decision.recordedAt=v.recordedAt.trim();return decision;
}
function renderBinding(){
 const raw=$('#link-form [name=unitBinding]').value,value=parse(raw,'Complete unit binding')??{};
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('UNIT_BINDING_REQUIRED','Use the full original unit-binding object.');
 for(const field of $$('[data-binding]'))field.value=value[field.dataset.binding]??(field.dataset.binding==='memoType'?'none':'');
 $('#binding-fields').inert=false;
}
function bindingFromFields(){
 const original=parse($('#link-form [name=unitBinding]').value,'Complete unit binding')??{},value={...original};
 for(const field of $$('[data-binding]'))value[field.dataset.binding]=field.value===''&&['assetIssuer','memo'].includes(field.dataset.binding)?null:field.value;
 $('#link-form [name=unitBinding]').value=pretty(value);handle(()=>rememberDrafts());
}
async function copyLink(row){
 const f=$('#link-form');f.reset();const d=row.decision??row;
 for(const key of ['kind','actor','reason','subjectVersionId','targetVersionId','relation','subjectAmount','targetAmount'])f.elements[key].value=d[key]??'';
 f.elements.bookVersionId.value=row.bookVersionId;f.elements.supersedesDecisionId.value=row.id;f.elements.status.value='proposed';
 f.elements.unitBinding.value=pretty(d.unitBinding??null);renderBinding();f.elements.sources.value=(d.sources??[]).join('\n');await editLink();
}
async function renderBookDetail(table,row){
 if(table==='books'){
 appendContent(definitions({'Logical programme':row.bookId,Version:row.version,'Programme edition':row.id,'Definition SHA-256':row.sha256}));
 appendContent(renderData(row.definition,'Complete book selection'));appendContent(jsonDetails('Original supporting sources',row.sourceIds??[]));
 addAction('Use this edition',async()=>{setBookScope(row.id);await rememberDrafts();notice('Selected programme edition '+row.id+'.');});
 addAction('Edit as a new edition',()=>loadBook(row));
 addAction('Create reconciliation',async()=>{setBookScope(row.id);await navigate('reconciliations');await rememberDrafts();});
 addAction('Create review decision',async()=>{setBookScope(row.id);await editLink();});
 }else{
 appendContent(renderData(row,'Complete immutable decision'));
 addAction('Prepare a linked correction',()=>copyLink(row));
 if(row.subjectVersionId)addAction('Inspect original provider version',async()=>{const generation=detailGeneration;const original=await fetchItem('resourceVersions',row.subjectVersionId);if(generation!==detailGeneration||selected?.table!=='links'||selected.id!==row.id||page!=='links')return;appendContent(jsonDetails('Complete original provider version',original,true));});
 if(row.targetVersionId)addAction('Inspect original related version',async()=>{const generation=detailGeneration;const original=await fetchItem('resourceVersions',row.targetVersionId);if(generation!==detailGeneration||selected?.table!=='links'||selected.id!==row.id||page!=='links')return;appendContent(jsonDetails('Complete original settlement version',original,true));});
 }
}
function restoreRecipientEditor(){try{const restored=parse($('#plan-rows-json').value,'Complete recipient rows');if(!Array.isArray(restored)||restored.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw fail('RECIPIENT_ROWS_REQUIRED','Keep the complete recipient array.');recipientRows=restored;recipientOffset=0;renderRecipients();}catch{recipientRows=[];$('#recipient-rows').replaceChildren();$('#recipient-rows').inert=true;$('#recipient-rows').dataset.dirty='true';$('#recipient-count').textContent='Your unfinished recipient JSON is retained. Correct it and open it in the row editor to continue.';}}
let recipientRows=[],recipientOffset=0;
const recipientFields=['id','amount','paymentID','email','phone','walletAddress','walletAddressMemo','verification'];
function parseRecipientCSV(source){
 if(source.startsWith('\uFEFF'))source=source.slice(1);const records=[];let row=[],field='',quoted=false,closed=false,atStart=true,recordStarted=false;
 function endField(){row.push(field);field='';quoted=false;closed=false;atStart=true;}
 function endRow(){endField();if(recordStarted||row.length>1||row[0]!=='')records.push(row);row=[];recordStarted=false;}
 for(let i=0;i<source.length;i++){const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw fail('RECIPIENT_CSV_INVALID','Unexpected text after a closed quoted field.');
  if(c==='"'){if(!atStart)throw fail('RECIPIENT_CSV_INVALID','A quoted field must start immediately after its delimiter.');quoted=true;recordStarted=true;atStart=false;}
  else if(c===','){recordStarted=true;endField();}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;endRow();}
  else{field+=c;atStart=false;recordStarted=true;}
 }
 if(quoted)throw fail('RECIPIENT_CSV_INVALID','The complete CSV has an unclosed quoted field.');if(recordStarted||row.length||field||closed)endRow();
 if(!records.length)throw fail('RECIPIENT_CSV_EMPTY','The complete CSV has no header.');const headers=records.shift();
 if(headers.some(key=>!recipientFields.includes(key))||new Set(headers).size!==headers.length||!headers.includes('id')||!headers.includes('amount'))throw fail('RECIPIENT_CSV_HEADER','Use the original SDP columns phone, email, id, amount, verification, paymentID, walletAddress and walletAddressMemo, including id and amount.');
 if(records.length>10000)throw fail('RECIPIENT_ROWS_LIMIT','The original SDP upload permits at most 10,000 recipient rows.');
 return records.map((fields,index)=>{if(fields.length!==headers.length)throw fail('RECIPIENT_CSV_COLUMNS','Recipient row '+(index+1)+' has '+fields.length+' fields; its header has '+headers.length+'.');return Object.fromEntries(headers.map((key,i)=>[key,fields[i]]));});
}
$('#import-recipient-csv').addEventListener('click',()=>handle(async()=>{
 const file=$('#recipient-csv-file').files[0];if(!file)throw fail('RECIPIENT_CSV_REQUIRED','Select the complete original recipient CSV.');if(file.size>5000000||!file.name.toLowerCase().endsWith('.csv'))throw fail('RECIPIENT_CSV_FILE','Select an original .csv file no larger than 5,000,000 bytes.');
 const originalWorkspace=workspaceId,originalText=$('#plan-rows-json').value;let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw fail('RECIPIENT_CSV_ENCODING','The original CSV must contain valid UTF-8 text.');}const parsed=parseRecipientCSV(raw);
 await serialized(async()=>{if(workspaceId!==originalWorkspace)throw fail('WORKSPACE_CHANGED','Reopen the original recipient file in its intended workspace.');const record=await prepareRequest({workspaceId,revision:bootstrap.workspace.revision,kind:'file-upload',method:'file.retain',args:{filename:file.name},file,label:'Retain original recipient CSV '+file.name});const retained=await transmit(record),originalFile=retained?.result?.file;if(!originalFile?.id)throw fail('RETAINED_FILE_ID_REQUIRED','Read the original completed file-retention request to recover its retained file ID.');
 if(workspaceId!==originalWorkspace||$('#plan-rows-json').value!==originalText){notice('The complete original CSV is retained in Source files. Your newer recipient edits remain open; select Import again to replace them explicitly.');return;}
 const sourceFiles=$('#plan-form [name=originalFileIds]');sourceFiles.value=[...new Set([...ids(sourceFiles.value),originalFile.id])].join('\n');recipientRows=parsed;recipientOffset=0;commitRecipients();await navigate('plans');await rememberDrafts();notice('Retained original CSV and opened all '+parsed.length+' recipient rows for review.');
 });
}));

function renderRecipients(){
 const host=$('#recipient-rows');host.inert=false;delete host.dataset.dirty;host.replaceChildren();const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
 head.innerHTML='<tr>'+recipientFields.map(key=>'<th>'+esc(sectionTitle(key))+'</th>').join('')+'<th>Order</th></tr>';table.append(head,body);host.append(table);
 recipientOffset=Math.min(recipientOffset,Math.max(0,Math.floor((recipientRows.length-1)/100)*100));
 for(const[localIndex,row]of recipientRows.slice(recipientOffset,recipientOffset+100).entries()){
 const rowIndex=recipientOffset+localIndex;
 const tr=document.createElement('tr');for(const key of recipientFields){const td=document.createElement('td'),input=document.createElement('input');input.type='text';input.value=row[key]??'';input.setAttribute('aria-label','Recipient '+(rowIndex+1)+' '+key);if(key==='amount')input.inputMode='decimal';
 input.addEventListener('input',()=>{const value=input.value;if(value===''&&!['id','amount','paymentID'].includes(key))delete recipientRows[rowIndex][key];else recipientRows[rowIndex][key]=value;$('#plan-rows-json').value=pretty(recipientRows);handle(()=>rememberDrafts());});td.append(input);tr.append(td);}
 const action=document.createElement('td');for(const[label,offset]of [['Move up',-1],['Move down',1]]){const b=button(label,()=>{const other=rowIndex+offset;if(other<0||other>=recipientRows.length)return;[recipientRows[rowIndex],recipientRows[other]]=[recipientRows[other],recipientRows[rowIndex]];commitRecipients();},'text-button');b.disabled=rowIndex+offset<0||rowIndex+offset>=recipientRows.length;action.append(b);}
 action.append(button('Remove row',()=>{recipientRows.splice(rowIndex,1);commitRecipients();},'text-button'));tr.append(action);body.append(tr);}
 const pager=document.createElement('div');pager.className='button-row';const previous=button('Previous 100 recipients',()=>{recipientOffset=Math.max(0,recipientOffset-100);renderRecipients();},'secondary'),next=button('Next 100 recipients',()=>{recipientOffset+=100;renderRecipients();},'secondary');previous.disabled=recipientOffset===0;next.disabled=recipientOffset+100>=recipientRows.length;pager.append(previous,next);host.append(pager);
 $('#recipient-count').textContent=recipientRows.length+' complete recipient rows · showing '+(recipientRows.length?recipientOffset+1:0)+'–'+Math.min(recipientRows.length,recipientOffset+100);
}
function commitRecipients(){$('#plan-rows-json').value=pretty(recipientRows);renderRecipients();handle(()=>rememberDrafts());}
function readRecipients(){
 const values=parse($('#plan-rows-json').value,'Complete recipient rows');if(!Array.isArray(values)||values.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw fail('RECIPIENT_ROWS_REQUIRED','Retain the complete array of recipient objects.');
 for(const[index,row]of values.entries())for(const key of ['id','amount'])if(typeof row[key]!=='string'||!row[key].trim())throw fail('RECIPIENT_ROW_REQUIRED','Recipient '+(index+1)+' requires the original '+key+' as text.');
 for(const[index,row]of values.entries())if(row.paymentID!==undefined&&typeof row.paymentID!=='string')throw fail('PAYMENT_ID_TEXT_REQUIRED','Recipient '+(index+1)+' paymentID must be text when supplied.');
 return values;
}
function planDefinition(form){
 const v=formObject(form),definition={name:v.name.trim(),milestoneVersionId:v.milestoneVersionId.trim(),proposalVersionId:v.proposalVersionId.trim()||null,
 approvalVersionIds:ids(v.approvalVersionIds),evidenceVersionIds:ids(v.evidenceVersionIds),treasuryVersionIds:ids(v.treasuryVersionIds),
 distributionWalletVersionId:v.distributionWalletVersionId.trim(),assetVersionId:v.assetVersionId.trim(),recipientWalletVersionId:v.recipientWalletVersionId.trim()||null,
 registrationContactType:v.registrationContactType.trim(),verificationField:v.verificationField.trim()||null,rows:readRecipients(),note:v.note};
 return definition;
}
async function editPlan(row){
 const f=$('#plan-form'),d=row.definition??row;f.reset();f.elements.originalFileIds.value=(row.originalFileIds??[]).join('\n');if(row.bookVersionId)f.elements.bookVersionId.value=row.bookVersionId;
 for(const key of ['name','milestoneVersionId','proposalVersionId','distributionWalletVersionId','assetVersionId','recipientWalletVersionId','registrationContactType','verificationField','note'])f.elements[key].value=d[key]??'';
 for(const key of ['approvalVersionIds','evidenceVersionIds','treasuryVersionIds'])f.elements[key].value=(d[key]??[]).join('\n');
 recipientOffset=0;recipientRows=structuredClone(d.rows??[]);f.elements.rowsJSON.value=pretty(recipientRows);renderRecipients();$('#plan-editor-title').textContent='Prepare a new plan from this saved edition';await navigate('plans');await rememberDrafts();
}
async function renderPlanDetail(row){
 const d=row.definition??row.data?.definition??{},result=row.data??row;
 appendContent(definitions({Status:row.status??result.status,Programme:row.bookVersionId,Milestone:d.milestoneVersionId,Account:d.distributionWalletVersionId,Asset:d.assetVersionId,Recipients:d.rows?.length}));
 appendContent(renderData(result.findings??row.findings??[],'Preparation findings'),renderData(result.totals??row.totals??[],'Exact payout totals'),jsonDetails('Complete recipient plan',d,true),jsonDetails('Pinned source versions',row.versionPins??result.versionPins??{}));
 if(row.originalFiles?.length){const heading=document.createElement('h3');heading.textContent='Complete original recipient intake';appendContent(heading,fileList(row.originalFiles));}if(row.files?.length)appendContent(fileList(row.files));if(typeof result.csv==='string')addAction('Download original payout instructions',()=>downloadText(result.csv,'amero-payout-'+row.id+'.csv','text/csv'));
 addAction('Edit as a new payout plan',()=>editPlan({...row,definition:d}));
 const form=document.createElement('form');form.className='card';form.innerHTML='<h3>Prepare the next provider operation</h3><p>Each stage creates one operation for review. Open that operation to dispatch it to the selected SDP account.</p><label>Stage<select name="stage"><option value="create">Create SDP draft</option><option value="instructions">Attach original recipient instructions</option><option value="status">Change disbursement status</option></select></label><label>Original SDP disbursement version ID<input name="disbursementVersionId" list="version-options"></label><label>Requested status<select name="status"><option value="">Select for status stage</option><option value="STARTED">STARTED — begins payments</option><option value="PAUSED">PAUSED</option><option value="CANCELED">CANCELED</option></select></label><button type="submit">Prepare selected operation</button>';
 form.addEventListener('submit',event=>{event.preventDefault();handle(()=>{const v=formObject(form),args={planId:row.id,stage:v.stage};if(v.stage!=='create'){if(!v.disbursementVersionId.trim())throw fail('DISBURSEMENT_VERSION_REQUIRED','Choose the exact original SDP disbursement.');args.disbursementVersionId=v.disbursementVersionId.trim();}if(v.stage==='status'){if(!v.status)throw fail('DISBURSEMENT_STATUS_REQUIRED','Select the requested original SDP status.');args.status=v.status;}return command('plan.prepare',args);});});const saved=view.planPreparations?.[row.id]??{};for(const key of ['stage','disbursementVersionId','status'])if(saved[key]!==undefined)form.elements[key].value=saved[key];
 form.addEventListener('input',()=>{view.planPreparations={...(view.planPreparations??{}),[row.id]:formObject(form)};handle(remember);});
 if((row.status??result.status)!=='PREPARED'){for(const control of form.elements)control.disabled=true;const note=document.createElement('p');note.textContent='Review the saved findings and prepare a corrected plan before creating provider operations.';form.prepend(note);}
 appendContent(form,jsonDetails('Complete saved plan',row));
}

let draftTimer=null;
const draftForms=['stream-form','plan-form','book-form','link-form','operation-form','reconciliation-form','source-form','export-form','receive-form','profile-form','dispatch-form','record-filter'];
async function rememberDrafts(){
 if(!workspaceId)return;const drafts={};
 for(const id of draftForms){const form=$('#'+id),values={};for(const e of form.elements){if(!e.name||e.type==='file'||['submit','button'].includes(e.type))continue;values[e.name]=e.type==='checkbox'?e.checked:e.value;}drafts[id]=values;}
 for(const section of ['params','query','headers','body'])drafts['operation-form']['action-'+section]=$('#action-'+section).value;
 view.drafts=drafts;view.dirtyForms=['profile-form','dispatch-form','receive-form'].filter(id=>$('#'+id).dataset.dirty==='true');await remember();
}
function restoreDrafts(){
 for(const [id,values]of Object.entries(view.drafts??{})){if(!draftForms.includes(id))continue;const f=$('#'+id);for(const [name,value]of Object.entries(values)){if(name.startsWith('action-')){const e=$('#'+name);if(e)e.value=value;continue;}const e=f.elements[name];if(e&&e.type!=='file'){if(e.type==='checkbox')e.checked=value===true;else e.value=value;if(id==='operation-form'&&name==='connectionAlias')refreshActionChoices();}}}
 for(const id of view.dirtyForms??[])if(['profile-form','dispatch-form','receive-form'].includes(id))$('#'+id).dataset.dirty='true';
}
for(const id of draftForms)$('#'+id).addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;handle(()=>rememberDrafts());},350);});
$('#new-book').addEventListener('click',()=>{const f=$('#book-form');f.reset();$('#book-editor-title').textContent='Save a programme edition';handle(()=>rememberDrafts());});
$('#apply-binding-json').addEventListener('click',()=>handle(renderBinding));
$('#link-form [name=unitBinding]').addEventListener('input',()=>{$('#binding-fields').inert=true;});
for(const field of $$('[data-binding]'))field.addEventListener('input',()=>handle(bindingFromFields));
$('#new-link').addEventListener('click',()=>{const f=$('#link-form');f.reset();renderBinding();if(view.scope?.bookVersionId)f.elements.bookVersionId.value=view.scope.bookVersionId;handle(()=>rememberDrafts());});

$('#add-recipient').addEventListener('click',()=>handle(()=>{const next=parse($('#plan-rows-json').value,'Recipient rows');if(!Array.isArray(next)||next.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw fail('RECIPIENT_ROWS_REQUIRED','Correct and open the complete recipient array first.');recipientRows=next;recipientRows.push({id:'',amount:'',paymentID:''});recipientOffset=Math.floor((recipientRows.length-1)/100)*100;commitRecipients();}));
$('#plan-rows-json').addEventListener('input',()=>{$('#recipient-rows').inert=true;$('#recipient-rows').dataset.dirty='true';$('#recipient-count').textContent='Complete JSON has edits. Open it in the row editor before editing individual rows.';});
$('#apply-recipient-json').addEventListener('click',()=>handle(()=>{recipientRows=parse($('#plan-rows-json').value,'Recipient rows');if(!Array.isArray(recipientRows)||recipientRows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw fail('RECIPIENT_ROWS_REQUIRED','Enter the complete recipient array.');renderRecipients();}));
$('#new-plan').addEventListener('click',()=>{$('#plan-form').reset();recipientRows=[];recipientOffset=0;renderRecipients();if(view.scope?.bookVersionId)$('#plan-form [name=bookVersionId]').value=view.scope.bookVersionId;$('#plan-editor-title').textContent='Prepare complete disbursement instructions';handle(()=>rememberDrafts());});
bindForm('#stream-form',form=>{const v=formObject(form),args={connectionAlias:v.connectionAlias,accountId:v.accountId.trim(),cursor:v.cursor.trim(),name:v.name.trim()};if(v.bookVersionId.trim())args.bookVersionId=v.bookVersionId.trim();return command('stream.configure',args);});
bindForm('#plan-form',form=>command('plan.save',{bookVersionId:form.elements.bookVersionId.value.trim(),definition:planDefinition(form),originalFileIds:ids(form.elements.originalFileIds.value)}));
bindForm('#book-form',f=>{const v=formObject(f),args={definition:bookDefinition(f),sourceIds:ids(v.sourceIds)};if(v.bookId.trim())args.bookId=v.bookId.trim();return command('book.save',args);});
bindForm('#link-form',f=>command('link.save',{bookVersionId:f.elements.bookVersionId.value.trim(),decision:linkDecision(f)}));
bindForm('#file-form',form=>{
 const file=form.elements.file.files[0];if(!file)throw fail('SOURCE_FILE_REQUIRED','Select a complete file.');
 const args={filename:file.name},submittedWorkspace=workspaceId;
 return serialized(async()=>{if(workspaceId!==submittedWorkspace)throw fail('WORKSPACE_CHANGED','Reopen the submitted file in its original workspace.');
 const record=await prepareRequest({workspaceId,revision:bootstrap.workspace.revision,kind:'file-upload',method:'file.retain',args,file,label:'Retain '+file.name});return transmit(record);});
});

const activeIntents=new Map();
function serialized(task){
 const run=()=>navigator.locks?navigator.locks.request('amero-workspace-'+workspaceId,{mode:'exclusive'},task):task();
 const promise=mutationTail.then(run,run);mutationTail=promise.catch(()=>{});return promise;
}
function command(method,args){
 const key=canonical({method,args});if(activeIntents.has(key))return activeIntents.get(key);
 const promise=serialized(async()=>{const record=await prepareRequest({workspaceId,revision:bootstrap.workspace.revision,method,args});return transmit(record);});
 activeIntents.set(key,promise);promise.finally(()=>activeIntents.delete(key)).catch(()=>{});return promise;
}
async function originalHostRequest(record){
 if(record.kind==='unpack')return null;
 try{return await fetchItem('requests',record.id);}catch(error){if(error.status===404||error.code==='RECORD_NOT_FOUND')return null;throw error;}
}
function envelope(response,record){
 if(record.kind==='unpack')return response;
 if(response?.requestId!==record.id||response?.workspaceId!==workspaceId||!Number.isSafeInteger(response.revision))throw fail('HOST_RESPONSE_IDENTITY_MISMATCH','The returned host request does not match this workspace and retained request.');
 return response;
}
async function transmit(original,{recover=false,continueRunning=false}={}){
 let record=await getRequest(original.id)??original;const done=busy(recover?'Checking retained request…':'Retaining and sending request…');
 try{
 await verifyRequest(record,workspaceId);
 if(record.status==='COMPLETE'){if(!record.appliedAt)await applyResult(record);return record.response;}
 if(recover&&record.attempts.length&&record.kind!=='unpack'){
 const host=await originalHostRequest(record);
 if(host?.status==='COMPLETE'){record=await finishAttempt(record,{response:envelope(host.result,record),status:'COMPLETE'});await applyResult(record);return record.response;}
 if(host?.status==='FAILED'){const error=Object.assign(new Error(host.error?.message??'The original host request failed.'),host.error??{});record=await finishAttempt(record,{error,status:'REJECTED'});await renderRecovery();throw error;}
 if(host?.status==='RUNNING'&&!continueRunning){notice('Request '+short(record.id)+' is still running on the host. Its original operation remains selected.');scheduleRecovery();return null;}
 }
 if(record.status==='REJECTED')throw fail('REQUEST_REJECTED','This retained request has a definitive host rejection. Review its recorded error before preparing a changed request.');
 record=await beginAttempt(record,workspaceId);let response;
 if(record.kind==='file-upload'){
 const args={...record.args,requestId:record.id,expectedRevision:record.request.expectedRevision};response=await(await api('/api/files/upload?'+new URLSearchParams({args:JSON.stringify(args)}),{method:'POST',body:record.file,raw:true,headers:{'Content-Type':record.file.type||'application/octet-stream','X-Content-SHA256':record.source.sha256}})).json();
 }else if(record.kind==='upload'){
 const args={...record.args,requestId:record.id,expectedRevision:record.request.expectedRevision};
 response=await(await api('/api/source-import?'+new URLSearchParams({args:JSON.stringify(args)}),{method:'POST',body:record.file,raw:true,headers:{'Content-Type':record.file.type||'application/octet-stream','X-Content-SHA256':record.source.sha256}})).json();
 }else if(record.kind==='unpack'){
 const query=new URLSearchParams({requestId:record.id});if(record.manifestSha256)query.set('manifestSha256',record.manifestSha256);
 response=await(await api('/api/packages/unpack?'+query,{method:'POST',body:record.file,raw:true,headers:{'Content-Type':'application/gzip','X-Content-SHA256':record.source.sha256,...(record.manifestSha256?{'X-Amero-Manifest-SHA256':record.manifestSha256}:{})}})).json();
 }else response=await(await api('/api/command',{method:'POST',body:record.request})).json();
 envelope(response,record);record=await finishAttempt(record,{response,status:'COMPLETE'});await applyResult(record);return response;
 }catch(error){
 if(record.status!=='COMPLETE'&&record.status!=='REJECTED'&&record.attempts.length){
 const uncertain=error.code==='TRANSPORT_UNCERTAIN'||error.code==='OPERATION_BUSY'||error.status===401||!error.status||error.status>=500;
 record=await finishAttempt(record,{error,status:uncertain?'UNCERTAIN':'REJECTED'});if(uncertain&&error.status!==401)scheduleRecovery();
 }
 throw error;
 }finally{done();await renderRecovery();}
}
async function applyResult(record){
 const response=record.response,result=record.kind==='unpack'?response:response.result;
 if(record.kind==='unpack'){view.inspection=result;view.receiveSource=result.sourceDirectory??result.directory;view.receiveHash=result.manifestSha256;view.page='transfer';}
 else if(record.method==='file.retain'){view.lastFile=result.file;view.page='sources';}
 else if(['workspace.export','report.export'].includes(record.method)){view.lastExport=result;view.page='transfer';}
 else if(record.method==='package.inspect'){view.inspection=result;view.receiveSource=record.args.sourceDirectory;view.receiveHash=result.manifestSha256??record.args.expectedManifestSha256;view.page='transfer';}
 else if(record.method==='package.receive'){view.received=result;view.page='transfer';}
 else{
 const table=record.method.startsWith('stream.')?'streams':record.method==='plan.prepare'?'operations':record.method==='plan.save'?'plans':record.method==='book.save'?'books':record.method==='link.save'?'links':record.method.startsWith('operation.')?'operations':record.method.startsWith('capture.')?'captures':record.method.startsWith('source.')?'sources':record.method==='reconciliation.create'?'reconciliations':record.method==='report.create'?'reports':null;
 if(table&&result?.id){view.selected={table,id:result.id};view.page=table;}
 }
 await refreshBootstrap();if(record.method==='file.retain'&&result.file){$('#operation-file-id').value=result.file.id;$('#file-result').replaceChildren(definitions({'Retained file':result.file.id,'SHA-256':result.file.sha256,Bytes:result.file.bytes}),fileList([result.file]));}await markApplied(record,view);
 if(record.method==='profile.update')delete $('#profile-form').dataset.dirty;if(record.method==='delivery.configure')delete $('#dispatch-form').dataset.dirty;
 await navigate(view.page??page,{keepSelection:true});
 if(view.selected&&view.selected.table===page&&tables.has(page))await selectRecord(view.selected.table,view.selected.id);
 notice(record.kind==='unpack'?'Complete delivery inspected. Choose a new destination to receive it.':'Request completed and retained: '+record.method+'.');
}
let recoveryPasses=0;
function scheduleRecovery(){if(pollTimer||recoveryPasses>=8)return;pollTimer=setTimeout(()=>{pollTimer=null;recoveryPasses++;handle(()=>recoverRequests({quiet:true}));},6000);}
async function recoverRequests({quiet=false}={}){
 const all=await listRequests(workspaceId);const unfinished=all.filter(row=>(!quiet||!row.needsExplicitRecovery)&&(row.status==='COMPLETE'&&!row.appliedAt||['PENDING','RUNNING','UNCERTAIN'].includes(row.status)));
 for(const row of unfinished){try{await serialized(()=>transmit(row,{recover:true}));}catch(error){if(!quiet)report(error);}}
 await renderRecovery();
}
async function renderRecovery(){
 if(!workspaceId)return;requests=await listRequests(workspaceId);pendingCount=requests.filter(row=>['PENDING','RUNNING','UNCERTAIN'].includes(row.status)||row.status==='COMPLETE'&&!row.appliedAt||row.error?.code==='REVISION_CONFLICT').length;$('#recovery-count').textContent=pendingCount?String(pendingCount):'';
 const host=$('#recovery-list');host.replaceChildren();if(!requests.length){host.innerHTML='<p class="empty">No browser requests have been recorded in this workspace.</p>';return;}
 const table=document.createElement('table');table.innerHTML='<thead><tr><th>Request</th><th>State</th><th>Attempts</th><th>Outcome / recovery</th></tr></thead>';const body=document.createElement('tbody');
 for(const row of requests){const tr=document.createElement('tr'),name=document.createElement('td'),state=document.createElement('td'),attempt=document.createElement('td'),action=document.createElement('td');tr.dataset.requestId=row.id;tr.dataset.requestStatus=row.status;name.textContent=row.label;const id=document.createElement('small');id.className='mono';id.textContent=row.id;name.append(id);if(row.source){const detail=document.createElement('small');detail.textContent=row.source.name+' · '+row.source.size+' bytes · '+short(row.source.sha256);name.append(detail);}
 state.append(badge(row.status));if(row.needsExplicitRecovery){const note=document.createElement('small');note.textContent='Restored request · explicit recovery required';state.append(note);}attempt.textContent=String(row.attempts.length);
 if(row.error){const p=document.createElement('p');p.textContent=row.error.code+': '+row.error.message;action.append(p);}
 if(row.status==='REJECTED'&&row.error?.code==='REVISION_CONFLICT')action.append(button('Refresh revision and retry same request',()=>serialized(async()=>{await refreshBootstrap();const fresh=await getRequest(row.id);const rebased=await rebaseRequest(fresh,bootstrap.workspace.revision);await transmit(rebased);})));
 else if(row.status!=='REJECTED'&&(row.status!=='COMPLETE'||!row.appliedAt))action.append(button(row.status==='COMPLETE'?'Restore completed result':'Check original request',()=>serialized(()=>transmit(row,{recover:true}))));
 else if(row.appliedAt){const p=document.createElement('small');p.textContent='Result retained · '+row.appliedAt;action.append(p);}
 if(['RUNNING','UNCERTAIN'].includes(row.status)&&row.kind!=='unpack'){const continuation=button('Continue original host request',()=>serialized(()=>transmit(row,{recover:true,continueRunning:true})));continuation.dataset.requestAction='continue';action.append(continuation);}
 for(const control of action.querySelectorAll('button'))if(!control.dataset.requestAction)control.dataset.requestAction=row.error?.code==='REVISION_CONFLICT'?'rebase':'check';
 const details=jsonDetails('Request arguments and attempts',{request:row.request,intentSha256:row.intentSha256,source:row.source,attempts:row.attempts,revisionHistory:row.revisionHistory,response:row.response,error:row.error});action.append(details);tr.append(name,state,attempt,action);body.append(tr);}
 table.append(body);host.append(table);
}
let workingCopyPacket=null,workingCopyGeneration=0;
async function renderWorkingCopyHistory(){
 const records=await listWorkingCopyRestores(workspaceId);const host=$('#working-copy-history');host.replaceChildren();
 if(!records.length)return;host.append(jsonDetails('Complete retained restore history',records));
 for(const record of records)if(record.previousView)host.append(button('Download prior working view · '+record.id,()=>downloadText(pretty(record),'amero-prior-view-'+record.id+'.json')));
}
$('#export-working-copy').addEventListener('click',()=>handle(()=>serialized(async()=>{
 await rememberDrafts();const packet=await exportWorkingCopy(workspaceId);downloadText(pretty(packet)+'\n','amero-working-copy-'+workspaceId+'.json');notice('Downloaded complete browser working copy, original requests and retained files.');
})));
$('#working-copy-file').addEventListener('change',()=>{workingCopyGeneration++;workingCopyPacket=null;$('#restore-working-copy').disabled=true;$('#working-copy-inspection').replaceChildren();});
$('#inspect-working-copy').addEventListener('click',()=>handle(async()=>{
 const file=$('#working-copy-file').files[0];if(!file)throw fail('WORKING_COPY_FILE_REQUIRED','Select the complete browser working-copy file.');const generation=++workingCopyGeneration,originalWorkspace=workspaceId;
 let packet;try{packet=JSON.parse(await file.text());}catch(error){throw fail('WORKING_COPY_JSON_INVALID','Select the complete working-copy JSON: '+error.message);}const inspection=await inspectWorkingCopy(packet,originalWorkspace);
 if(generation!==workingCopyGeneration||workspaceId!==originalWorkspace)return;workingCopyPacket=packet;$('#working-copy-inspection').replaceChildren(renderData(inspection,'Complete working-copy inspection'));$('#restore-working-copy').disabled=false;
}));
$('#restore-working-copy').addEventListener('click',()=>handle(()=>serialized(async()=>{
 if(!workingCopyPacket)throw fail('WORKING_COPY_INSPECTION_REQUIRED','Inspect the complete working copy first.');const packet=workingCopyPacket;
 const shell=$('#shell'),previousInert=shell.inert;shell.inert=true;const done=busy('Restoring complete working copy…');try{
 clearTimeout(draftTimer);draftTimer=null;clearTimeout(pollTimer);pollTimer=null;await rememberDrafts();const result=await restoreWorkingCopy(packet,workspaceId);view=result.view;
 for(const id of draftForms){$('#'+id).reset();delete $('#'+id).dataset.dirty;}await refreshBootstrap();restoreDrafts();try{renderBinding();}catch{$('#binding-fields').inert=true;}restoreRecipientEditor();selected=null;const restoredPage=view.page??'overview',restoredSelection=view.selected;
 await navigate(restoredPage,{keepSelection:true});if(restoredSelection?.table===page&&tables.has(page))await selectRecord(restoredSelection.table,restoredSelection.id);renderAction();await renderRecovery();await renderWorkingCopyHistory();workingCopyPacket=null;$('#restore-working-copy').disabled=true;
 $('#working-copy-inspection').replaceChildren(renderData(result,'Restored complete working copy'));notice('Working copy restored. Imported original requests are available in Request recovery for explicit review.');
 }finally{done();shell.inert=previousInert||!$('#access-screen').hidden;}
})));

function renderTransfer(){
 handle(renderWorkingCopyHistory);
 const exported=view.lastExport,host=$('#export-result');host.hidden=!exported;host.replaceChildren();
 if(exported){const heading=document.createElement('h2');heading.textContent='Complete export';host.append(heading,definitions({ID:exported.id??exported.exportId,Directory:exported.directory??exported.sourceDirectory,'Manifest SHA-256':exported.manifestSha256}));const id=exported.id??exported.exportId;if(id)host.append(button('Download full archive',()=>download('/api/exports/'+encodeURIComponent(id)+'/archive','amero-'+id+'.tar.gz')));host.append(jsonDetails('Complete export result',exported));}
 const form=$('#receive-form');if(view.receiveSource&&!form.dataset.dirty)form.elements.sourceDirectory.value=view.receiveSource;if(view.receiveHash&&!form.dataset.dirty)form.elements.expectedManifestSha256.value=view.receiveHash;
 const received=$('#receive-result');received.hidden=!view.inspection&&!view.received;received.replaceChildren();
 if(view.inspection){const heading=document.createElement('h2');heading.textContent='Delivery inspection';received.append(heading,renderData(view.inspection));}
 if(view.received){const heading=document.createElement('h2');heading.textContent='Received workspace';received.append(heading,renderData(view.received));const p=document.createElement('p');p.textContent='The received workspace is independent. Use its returned application and workspace paths to start it, then review the selected connections before enabling dispatch.';received.append(p);}
}
async function loadExports(more=false){
 const result=await fetchList('exports',{cursor:more?exportCursor:null});exportRows=more?[...exportRows,...result.rows]:result.rows;exportCursor=result.nextCursor;$('#exports-more').hidden=!exportCursor;const target=$('#exports-list');target.replaceChildren();
 for(const row of exportRows){const line=document.createElement('div');line.className='file-row';const detail=document.createElement('div');detail.textContent=row.name??row.kind??'Workspace export';const small=document.createElement('small');small.textContent=row.id+' · '+(row.createdAt??'')+' · '+(row.manifestSha256??'');detail.append(small);line.append(detail,button('Open export',async()=>{view.lastExport=row;await remember();renderTransfer();}));target.append(line);}if(!exportRows.length)target.innerHTML='<p class="empty">No exports are recorded.</p>';
}
function bindForm(id,handler){
 const form=$(id);form.addEventListener('submit',event=>{event.preventDefault();if(form.dataset.running)return;form.dataset.running='true';const buttons=[...form.querySelectorAll('button[type=submit]')];for(const button of buttons)button.disabled=true;handle(()=>handler(form)).finally(()=>{delete form.dataset.running;for(const button of buttons)button.disabled=false;});});
}
bindForm('#operation-form',form=>{
 const entry=currentAction();if(!entry)throw fail('ACTION_REQUIRED','Select a native action.');const evidence={};
 for(const name of ['bookVersionId'])if(form.elements[name].value.trim())evidence[name]=form.elements[name].value.trim();
 for(const name of ['versionIds','sourceIds']){const value=objectInput(form.elements[name].value,name);if(Object.keys(value).length)evidence[name]=value;}
 const args={connectionAlias:form.elements.connectionAlias.value,action:actionId(entry),inputJSON:nativeInputJSON(),...(Object.keys(evidence).length?{evidence}:{})};
 if(form.elements.fileId.value.trim())args.fileId=form.elements.fileId.value.trim();return command('operation.prepare',args);
});
$('#start-capture').addEventListener('click',()=>handle(()=>{const action=currentAction();if(!action||action.mutation)throw fail('READ_ACTION_REQUIRED','Only a read action can collect pages.');return command('capture.start',{connectionAlias:$('#action-connection').value,action:actionId(action),inputJSON:nativeInputJSON()});}));
$('#action-connection').addEventListener('change',()=>{refreshActionChoices();handle(()=>rememberDrafts());});
$('#action-select').addEventListener('change',()=>{for(const section of ['params','query','headers','body'])$('#action-'+section).value='{}';renderAction();handle(()=>rememberDrafts());});
for(const field of ['params','query','headers','body'])$('#action-'+field).addEventListener('change',()=>handle(()=>{objectInput($('#action-'+field).value,field);renderAction();}));
$('#reset-operation').addEventListener('click',()=>{$('#operation-form').reset();for(const section of ['params','query','headers','body'])$('#action-'+section).value='{}';renderAction();});
$('#browse-evidence').addEventListener('click',()=>handle(()=>navigate('resources')));
$('#browse-files').addEventListener('click',()=>handle(async()=>{await navigate('sources');$('#file-form').scrollIntoView({behavior:'smooth'});}));
bindForm('#record-filter',()=>loadRecords(false));
$('#records-more').addEventListener('click',()=>handle(()=>loadRecords(true)));
$('#close-detail').addEventListener('click',()=>{$('#record-detail').hidden=true;});
bindForm('#source-form',form=>{
 const input=formObject(form),file=form.elements.file.files[0];if(!file)throw fail('SOURCE_FILE_REQUIRED','Select a complete file.');
 const args={connectionAlias:input.connectionAlias,action:input.action,input:objectInput(input.input,'Source request input'),bodyComplete:form.elements.bodyComplete.checked,filename:file.name};
 if(input.observedAt)args.observedAt=nativeDate(input.observedAt);if(input.status)args.status=Number(input.status);
 const submittedWorkspace=workspaceId;
 return serialized(async()=>{if(workspaceId!==submittedWorkspace)throw fail('WORKSPACE_CHANGED','Reopen the submitted source in its original workspace.');
 const record=await prepareRequest({workspaceId,revision:bootstrap.workspace.revision,kind:'upload',method:'source.import',args,file,label:'Import '+file.name});return transmit(record);});
});
bindForm('#reconciliation-form',form=>{
 const v=formObject(form),args={bookVersionId:v.bookVersionId.trim()};if(v.name.trim())args.name=v.name.trim();
 for(const key of ['versionIds','sourceIds','captureIds']){const selected=ids(v[key]);if(selected.length)args[key]=selected;}return command('reconciliation.create',args);
});
bindForm('#profile-form',form=>command('profile.update',{name:form.elements.name.value.trim()}));
bindForm('#dispatch-form',form=>command('delivery.configure',{enabled:form.elements.enabled.checked}));
for(const id of ['#profile-form','#dispatch-form','#receive-form'])$(id).addEventListener('input',()=>{$(id).dataset.dirty='true';});
bindForm('#export-form',form=>command('workspace.export',{destination:form.elements.destination.value.trim()}));
bindForm('#unpack-form',form=>{
 const file=form.elements.archive.files[0];if(!file)throw fail('ARCHIVE_REQUIRED','Select the full delivery archive.');
 const manifestSha256=form.elements.manifestSha256.value.trim().toLowerCase()||null;
 if(manifestSha256&&!/^[a-f0-9]{64}$/.test(manifestSha256))throw fail('MANIFEST_HASH_INVALID','Enter a complete SHA-256 hash.');
 const submittedWorkspace=workspaceId;delete $('#receive-form').dataset.dirty;
 return serialized(async()=>{if(workspaceId!==submittedWorkspace)throw fail('WORKSPACE_CHANGED','Reopen the submitted archive in its original workspace.');
 const record=await prepareRequest({workspaceId,revision:bootstrap.workspace.revision,kind:'unpack',method:'package.unpack',args:{},file,manifestSha256,label:'Unpack '+file.name});return transmit(record);});
});
function receiveArgs(){const form=$('#receive-form'),args={sourceDirectory:form.elements.sourceDirectory.value.trim()};if(!args.sourceDirectory)throw fail('DELIVERY_SOURCE_REQUIRED','Enter the complete source delivery directory.');if(form.elements.expectedManifestSha256.value.trim())args.expectedManifestSha256=form.elements.expectedManifestSha256.value.trim().toLowerCase();return args;}
$('#inspect-package').addEventListener('click',()=>handle(()=>command('package.inspect',receiveArgs())));
bindForm('#receive-form',form=>{const args=receiveArgs();args.destination=form.elements.destination.value.trim();if(!args.destination)throw fail('RECEIVE_DESTINATION_REQUIRED','Choose a new destination directory.');return command('package.receive',args);});
$('#exports-more').addEventListener('click',()=>handle(()=>loadExports(true)));
$('#recover-all').addEventListener('click',()=>{recoveryPasses=0;handle(()=>recoverRequests());});
$('#close-preview').addEventListener('click',()=>{$('#preview-dialog').close();$('#report-preview').removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;});
$('#forget-token').addEventListener('click',()=>{sessionStorage.removeItem('amero.operator.token');token='';$('#access-screen').hidden=false;$('#shell').inert=true;});
for(const [kind,title]of REGISTER_KINDS){const b=button(title,()=>openRegister(kind));$('#register-shortcuts').append(b);}
for(const node of $$('[data-view]'))node.addEventListener('click',()=>handle(()=>navigate(node.dataset.view)));
$('#refresh').addEventListener('click',()=>handle(async()=>{await refreshBootstrap();if(tables.has(page))await loadRecords(false);if(selected?.table===page)await selectRecord(selected.table,selected.id);if(page==='transfer')await loadExports(false);await renderRecovery();notice('Workspace refreshed.');}));
bindForm('#access-form',async form=>{token=form.elements['operator-token'].value.trim();try{await open();sessionStorage.setItem('amero.operator.token',token);form.reset();}catch(error){$('#access-error').textContent=error.message;throw error;}});
async function open(){
 const done=busy('Opening selected workspace…');try{
 await refreshBootstrap();const saved=await initializeJournal(workspaceId);view=saved.view??{};requests=saved.requests;restoreDrafts();try{renderBinding();}catch{$('#binding-fields').inert=true;}restoreRecipientEditor();if(view.lastFile){$('#file-result').replaceChildren(definitions({'Retained file':view.lastFile.id,'SHA-256':view.lastFile.sha256,Bytes:view.lastFile.bytes}),fileList([view.lastFile]));}$('#access-screen').hidden=true;$('#shell').inert=false;await navigate(view.page??'overview',{keepSelection:true});if(view.selected?.table===page&&tables.has(page))await selectRecord(view.selected.table,view.selected.id);renderAction();await renderRecovery();await recoverRequests({quiet:true});
 }finally{done();}
}
$('.brand').addEventListener('click',event=>{event.preventDefault();handle(()=>navigate('overview'));});
if(token)handle(open).catch(()=>{});else{$('#access-screen').hidden=false;$('#shell').inert=true;}
