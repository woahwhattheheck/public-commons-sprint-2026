// MIT. Original Flowable operator workspace; all native mutations use saved reviewed requests.
import {FLOWABLE_WORKSPACE_ACTIONS,FLOWABLE_RECORD_KINDS,FLOWABLE_OPERATION_KINDS,validateFlowableAction,
  flowableCaseInstanceId as nativeCaseId} from './actions.mjs';
import {installProgrammeBrowser} from './programme-browser.mjs';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const tokenKey='flowable-token:'+location.origin;
const fragment=location.hash.slice(1);
if(fragment){sessionStorage.setItem(tokenKey,fragment);history.replaceState(null,'',location.pathname);}
const token=sessionStorage.getItem(tokenKey);
const state={view:null,page:'overview',engine:null,portfolio:null,decisionPortfolio:null,casePortfolio:null,records:new Map(),busy:false,controller:null,pending:[],
  definition:null,detail:null,db:null,collections:new Map()};
function node(tag,text,attributes={}){
  const element=document.createElement(tag);
  if(text!==undefined&&text!==null)element.textContent=String(text);
  for(const[key,value]of Object.entries(attributes)){
    if(value===undefined||value===null)continue;
    if(key==='class')element.className=value;
    else element.setAttribute(key,String(value));
  }
  return element;
}
function notice(message='',level='info'){$('#notice').textContent=message;$('#notice').dataset.level=level;}
function human(value){return value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);}
function stamp(value){if(!value)return'—';const date=new Date(value);return Number.isNaN(date.valueOf())?String(value):date.toLocaleString();}
function badge(value){return node('span',String(value??'SAVED').replaceAll('_',' '),{class:'status','data-state':value});}
function button(label,fn,options={}){
  const element=node('button',label,{type:'button',...(options.primary?{class:'primary'}:{})});
  element.disabled=state.busy;
  element.addEventListener('click',()=>busy(label,fn));return element;
}
function pre(value){return node('pre',typeof value==='string'?value:JSON.stringify(value,null,2));}
function keyValues(values){
  const dl=node('dl',null,{class:'key-values'});
  for(const[label,value]of values){dl.append(node('dt',label),node('dd',human(value)));}return dl;
}
function originalLink(reference,label='Download original',filename){
  const url=new URL('/api/source',location.origin);
  url.searchParams.set('sha256',reference.sha256);url.searchParams.set('bytes',reference.bytes);
  return node('a',label,{class:'button',href:url.pathname+url.search,download:filename??''});
}
function jsonSection(parent,title,value,{open=false}={}){
  if(value==null)return;
  const details=node('details');if(open)details.open=true;details.append(node('summary',title),pre(value));parent.append(details);
}
function switchPage(name){
  state.page=name;$$('[data-panel]').forEach(element=>{element.hidden=element.dataset.panel!==name;});
  $$('[data-page]').forEach(element=>{
    if(element.dataset.page===name)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');
  });
}
async function busy(label,fn){
  if(state.busy)return;
  state.busy=true;state.controller=new AbortController();notice();
  $('#busy').hidden=false;$('#busy-text').textContent=label;
  $$('button,input,select,textarea').forEach(element=>{if(element.id!=='cancel')element.disabled=true;});
  try{return await fn();}
  catch(error){notice((error.code?error.code+': ':'')+(error.message??String(error)),'error');}
  finally{
    state.busy=false;state.controller=null;$('#busy').hidden=true;
    $$('button,input,select,textarea').forEach(element=>{element.disabled=element.dataset.pagerDisabled==='true';});renderPending();
  }
}
async function api(method,args={}){
  validateFlowableAction(method,args);
  const response=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json',
    'x-workspace-token':token,'x-workspace-id':state.view?.workspaceId??''},body:JSON.stringify({method,args}),
    credentials:'same-origin',signal:state.controller?.signal});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.message??'The original workspace request failed.'),{
    code:result.error??'FLOWABLE_HTTP_FAILED',status:response.status,recordId:result.recordId});
  return result;
}
async function openPendingDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('flowable-original-requests',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('requests',{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function dbAction(mode,action){
  const db=state.db??=await openPendingDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('requests',mode),request=action(transaction.objectStore('requests'));
    let result;request.onsuccess=()=>{result=request.result;};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error??new Error('The original request could not be retained.'));
  });
}
async function pendingAdd(method,args,upload){
  const value={key:state.view.workspaceId+':'+args.requestId,workspaceId:state.view.workspaceId,method,args,
    savedAt:new Date().toISOString(),...(upload?{upload}:{})};
  await dbAction('readwrite',store=>store.put(value));await pendingRefresh();return value;
}
async function pendingRefresh(){
  state.pending=(await dbAction('readonly',store=>store.getAll())).filter(item=>item.workspaceId===state.view.workspaceId)
    .sort((a,b)=>a.savedAt.localeCompare(b.savedAt));renderPending();
}
async function pendingRemove(value){await dbAction('readwrite',store=>store.delete(value.key));await pendingRefresh();}
function renderPending(){
  $('#pending').hidden=state.pending.length===0;
  const first=state.pending[0];
  $('#pending-text').textContent=first?state.pending.length+' retained request'+(state.pending.length===1?'':'s')+
    '. '+(FLOWABLE_WORKSPACE_ACTIONS[first.method]?.title??'Receive archive')+' · '+stamp(first.savedAt)+
    '. Reading its result uses the original request.':'';
  $('#resume').disabled=state.busy;$('#dismiss').disabled=state.busy;
}
async function write(method,args){
  args={requestId:crypto.randomUUID(),...args};validateFlowableAction(method,args);
  const pending=await pendingAdd(method,args);
  try{const result=await api(method,args);await pendingRemove(pending);return result;}
  catch(error){
    // A known input rejection leaves no native dispatch; uncertain responses retain their original input.
    if(error.status&&error.status<500&&error.status!==408&&error.status!==429)await pendingRemove(pending);
    throw error;
  }
}
async function uploadOriginal(file,args,{pending}={}){
  pending??=await pendingAdd('__inspect',args,file);
  const response=await fetch('/api/delivery/inspect',{method:'POST',headers:{
    'content-type':'application/octet-stream','x-workspace-token':token,'x-workspace-id':state.view.workspaceId,
    'x-request-id':args.requestId,'x-delivery-name':encodeURIComponent(args.label??file.name)},
    body:file,credentials:'same-origin',signal:state.controller?.signal});
  const result=await response.json();
  if(!response.ok){
    if(response.status<500&&![408,429].includes(response.status))await pendingRemove(pending);
    throw Object.assign(new Error(result.message??'The original archive upload failed.'),{code:result.error,status:response.status});
  }
  await pendingRemove(pending);return result;
}
async function allRecords(kind){
  const result=[];let offset=0,snapshot;
  do{
    const current=await api('listRecords',{kind,offset,limit:500,...(snapshot?{snapshot}:{})});
    result.push(...current.items);snapshot=current.snapshot??snapshot;offset=current.nextOffset;
  }while(offset!=null);
  state.records.set(kind,result);return result;
}
const records=kind=>state.records.get(kind)??[];
const forEngine=items=>state.engine?items.filter(record=>record.connectionId===state.engine):items;
function selectOptions(select,items,selected,empty){
  select.replaceChildren();
  if(!items.length){select.append(node('option',empty,{value:''}));return null;}
  for(const item of items)select.append(node('option',item.label,{value:item.value}));
  const value=items.some(item=>item.value===selected)?selected:items[0].value;
  select.value=value;return value;
}
async function reload(){
  state.view=await api('view');
  $('#workspace-label').textContent=state.view.directory;
  $('#workspace-id').textContent='Workspace '+state.view.workspaceId;
  state.engine=selectOptions($('#engine-select'),state.view.connections.map(record=>({
    value:record.id,label:(record.connection.label??record.connection.id)+(record.credentialAvailable?'':' · credentials unavailable')})),
    state.engine,'Add an engine');
  await Promise.all(FLOWABLE_RECORD_KINDS.filter(kind=>kind!=='connection').map(allRecords));
  const captures=forEngine(records('portfolio')).filter(record=>record.state==='CAPTURED')
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  state.portfolio=selectOptions($('#portfolio-select'),captures.map(record=>({value:record.id,
    label:record.label+' · '+stamp(record.updatedAt)})),state.portfolio,'Refresh the engine to capture a portfolio');
  $('#portfolio-status').textContent=state.portfolio?'Showing the selected saved engine capture. Refresh engine reads its current native state.':
    'Connect an engine and refresh it to capture definitions, active work and history.';
  const decisions=forEngine(records('decisionPortfolio')).filter(record=>record.state==='CAPTURED')
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  state.decisionPortfolio=selectOptions($('#decision-portfolio-select'),decisions.map(record=>({value:record.id,
    label:record.label+' · '+stamp(record.updatedAt)})),state.decisionPortfolio,'Refresh the DMN engine to capture decisions');
  $('#decision-portfolio-status').textContent=state.decisionPortfolio?
    'Showing the selected saved decision definitions and complete execution history.':
    'Select the original DMN REST connection and refresh decisions.';
  const cases=forEngine(records('casePortfolio')).filter(record=>record.state==='CAPTURED')
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  state.casePortfolio=selectOptions($('#case-portfolio-select'),cases.map(record=>({value:record.id,
    label:record.label+' · '+stamp(record.updatedAt)})),state.casePortfolio,'Refresh the CMMN engine to capture cases');
  $('#case-portfolio-status').textContent=state.casePortfolio?
    'Showing the selected saved case definitions, work and complete native history.':
    'Select the original CMMN REST connection and refresh cases.';
  await renderAll();
}
function table(container,columns,items,{pageSize=25,empty='No saved records.'}={}){
  container.replaceChildren();let offset=0;
  const draw=()=>{
    container.replaceChildren();
    if(!items.length){container.append(node('p',empty,{class:'empty'}));return;}
    const wrapper=node('div',null,{class:'table-wrap'}),tableNode=node('table'),head=node('thead'),row=node('tr'),body=node('tbody');
    columns.forEach(column=>row.append(node('th',column.label,{scope:'col'})));head.append(row);tableNode.append(head);
    for(const item of items.slice(offset,offset+pageSize)){
      const tr=node('tr');
      for(const column of columns){
        const td=node('td'),value=column.render?column.render(item):human(item[column.key]);
        td.append(value instanceof Node?value:document.createTextNode(String(value)));tr.append(td);
      }body.append(tr);
    }
    tableNode.append(body);wrapper.append(tableNode);container.append(wrapper);
    const pager=node('div',null,{class:'pager'}),controls=node('div',null,{class:'controls'});
    const previous=node('button','Previous',{type:'button'}),next=node('button','Next',{type:'button'});
    previous.disabled=offset===0;next.disabled=offset+pageSize>=items.length;
    previous.dataset.pagerDisabled=String(previous.disabled);next.dataset.pagerDisabled=String(next.disabled);
    previous.onclick=()=>{offset=Math.max(0,offset-pageSize);draw();};
    next.onclick=()=>{offset+=pageSize;draw();};
    controls.append(previous,next);pager.append(node('span',(offset+1)+'–'+Math.min(offset+pageSize,items.length)+' of '+items.length),controls);
    container.append(pager);
  };draw();
}
function recordColumns(kind){
  return[{label:'Name',key:'label'},{label:'State',render:item=>badge(item.state)},
    {label:'Updated',render:item=>stamp(item.updatedAt)},{label:'Revision',key:'revision'},
    {label:'Open',render:item=>button('Review',()=>openRecord(kind??item.kind,item.id))}];
}
function retainSelectedCollections(){
  for(const[key,entry]of state.collections){
    const record=records(entry.kind).find(item=>item.id===entry.id);
    if(state[entry.kind]!==entry.id||record?.state!=='CAPTURED'||record.revision!==entry.revision)
      state.collections.delete(key);
  }
}
async function capturedCollection(id,method,collection){
  if(!id)return[];
  const kind={readPortfolio:'portfolio',readDecisionPortfolio:'decisionPortfolio',readCasePortfolio:'casePortfolio'}[method],
    record=records(kind).find(item=>item.id===id),revision=record?.state==='CAPTURED'?record.revision:undefined,
    key=revision===undefined?null:JSON.stringify([method,id,revision,collection]);
  if(key&&state.collections.has(key))return state.collections.get(key).promise;
  const promise=(async()=>{
    let offset=0;const result=[];
    do{
      const current=await api(method,{id,...(revision===undefined?{}:{revision}),collection,offset,limit:500});
      result.push(...current.items);offset=current.nextOffset;
    }while(offset!=null);
    return result;
  })();
  if(key){
    const entry={kind,id,revision,promise};state.collections.set(key,entry);
    promise.catch(()=>{if(state.collections.get(key)===entry)state.collections.delete(key);});
  }
  return promise;
}
const captured=collection=>capturedCollection(state.portfolio,'readPortfolio',collection);
const capturedDecision=collection=>capturedCollection(state.decisionPortfolio,'readDecisionPortfolio',collection);
const capturedCase=collection=>capturedCollection(state.casePortfolio,'readCasePortfolio',collection);
const programmeBrowser=installProgrammeBrowser({api,write,busy,button,node,pre,keyValues,table,originalLink,notice,reload,openRecord,requireEngine,records,forEngine,detail,workspaceId:()=>state.view?.workspaceId});
async function renderAll(){
  await programmeBrowser.render();
  retainSelectedCollections();
  const metrics=$('#metrics');metrics.replaceChildren();
  const portfolioKind=state.casePortfolio?'casePortfolio':state.decisionPortfolio?'decisionPortfolio':'portfolio',
    selected=state[portfolioKind],latest=selected?records(portfolioKind).find(item=>item.id===selected):null,
    measurements=portfolioKind==='casePortfolio'?
      [['Case definitions',latest?.summary?.definitions??0],['Active cases',latest?.summary?.cases??0],['Plan items',latest?.summary?.planItems??0]]:
      portfolioKind==='decisionPortfolio'?
        [['Decision definitions',latest?.summary?.definitions??0],['Executions',latest?.summary?.historicExecutions??0],['Deployments',latest?.summary?.deployments??0]]:
        [['Definitions',latest?.summary?.definitions??0],['Active processes',latest?.summary?.processes??0],['Human tasks',latest?.summary?.tasks??0]];
  measurements.push(['Saved operations',FLOWABLE_OPERATION_KINDS.reduce((sum,kind)=>sum+forEngine(records(kind)).length,0)]);
  for(const[label,value]of measurements){
    const metric=node('div',null,{class:'metric'});metric.append(node('strong',value),node('span',label));metrics.append(metric);
  }
  const recent=['portfolio','decisionPortfolio','casePortfolio',...FLOWABLE_OPERATION_KINDS]
    .flatMap(kind=>forEngine(records(kind))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  table($('#recent-records'),[{label:'Type',key:'kind'},...recordColumns()],recent);
  for(const kind of FLOWABLE_OPERATION_KINDS)table($('#'+kind+'-records'),recordColumns(kind),forEngine(records(kind)));
  table($('#delivery-records'),recordColumns('delivery'),records('delivery'));
  table($('#receiving-records'),recordColumns('receiving'),records('receiving'));
  table($('#connections-table'),[
    {label:'Engine',render:item=>item.connection.label??item.connection.id},
    {label:'REST service',render:item=>item.connection.baseUrl},
    {label:'Credentials',render:item=>item.credentialAvailable?'Available':'Environment values required'},
    {label:'Edit',render:item=>button('Edit',()=>editConnection(item))},
  ],state.view.connections,{empty:'Add the original Flowable REST service.'});
  const[definitions,processes,tasks,historicProcesses,historicTasks]=await Promise.all(
    ['definitions','processes','tasks','historicProcesses','historicTasks'].map(captured));
  table($('#definitions-table'),[
    {label:'Definition',render:item=>item.name??item.key},{label:'Key',key:'key'},{label:'Version',key:'version'},
    {label:'Tenant',key:'tenantId'},{label:'Deployment',key:'deploymentId'},
    {label:'Open',render:item=>button('Source and start',()=>openDefinition(item))},
  ],definitions,{empty:'The selected portfolio has no process definitions.'});
  table($('#processes-table'),[
    {label:'Process',key:'id'},{label:'Name',key:'name'},{label:'Business key',key:'businessKey'},
    {label:'Definition',key:'processDefinitionId'},{label:'Suspended',key:'suspended'},
    {label:'Open',render:item=>button('Inspect / migrate',()=>openNative('Process',item,'process'))},
  ],processes,{empty:'The selected portfolio has no active processes.'});
  table($('#tasks-table'),[
    {label:'Task',key:'name'},{label:'Assignee',key:'assignee'},{label:'Process',key:'processInstanceId'},
    {label:'Due',render:item=>stamp(item.dueDate)},{label:'Priority',key:'priority'},
    {label:'Open',render:item=>button('Operate',()=>openNative('Human task',item,'task'))},
  ],tasks,{empty:'The selected portfolio has no active human tasks.'});
  table($('#historic-processes-table'),[
    {label:'Process',key:'id'},{label:'Business key',key:'businessKey'},{label:'Definition',key:'processDefinitionId'},
    {label:'Started',render:item=>stamp(item.startTime)},{label:'Ended',render:item=>stamp(item.endTime)},
    {label:'Open',render:item=>button('Original',()=>openNative('Historic process',item))},
  ],historicProcesses);
  table($('#historic-tasks-table'),[
    {label:'Task',key:'name'},{label:'Assignee',key:'assignee'},{label:'Process',key:'processInstanceId'},
    {label:'Created',render:item=>stamp(item.startTime??item.createTime)},{label:'Ended',render:item=>stamp(item.endTime)},
    {label:'Open',render:item=>button('Original',()=>openNative('Historic task',item))},
  ],historicTasks);
  const[decisions,historicExecutions]=await Promise.all(['definitions','historicExecutions'].map(capturedDecision));
  table($('#decisions-table'),[
    {label:'Decision',render:item=>item.name??item.key},{label:'Key',key:'key'},{label:'Version',key:'version'},
    {label:'Tenant',key:'tenantId'},{label:'Deployment',key:'deploymentId'},
    {label:'Open',render:item=>button('Source and evaluate',()=>openDecisionDefinition(item))},
  ],decisions,{empty:'The selected decision portfolio has no definitions.'});
  table($('#historic-decisions-table'),[
    {label:'Execution',key:'id'},{label:'Decision',render:item=>item.decisionKey??item.decisionDefinitionKey??item.decisionDefinitionId},
    {label:'Version',render:item=>item.decisionVersion??item.decisionDefinitionVersion},
    {label:'Started',render:item=>stamp(item.startTime)},{label:'Ended',render:item=>stamp(item.endTime)},
    {label:'Open',render:item=>button('Execution and audit',()=>openDecisionExecution(item))},
  ],historicExecutions,{empty:'The selected decision portfolio has no retained native executions.'});
  await renderCases();
}
function detail(title){
  $('#detail').hidden=false;$('#detail-title').textContent=title;
  const container=$('#detail-content');container.replaceChildren();return container;
}
function revealDetail(){$('#detail').scrollIntoView({behavior:'smooth',block:'start'});}
function editConnection(record){
  switchPage('engines');const form=$('#connection-form');form.reset();
  form.elements.recordId.value=record.id;form.elements.revision.value=record.revision;
  for(const key of ['id','label','baseUrl','usernameEnv','passwordEnv'])form.elements[key].value=record.connection[key]??'';
  form.elements.id.readOnly=true;$('#connection-form-title').textContent='Edit engine';
  form.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderOriginalResources(container,resources,{label='Native resource',sourceLabel='Original source'}={}){
  for(const resource of resources??[]){
    const section=node('section');section.append(node('h3',resource.filename??'Original deployment resource'));
    section.append(keyValues([['Bytes',resource.bytes],['Content type',resource.contentType],['SHA-256',resource.sha256]]));
    if(resource.originalResource)section.append(originalLink(resource.originalResource,'Download '+resource.filename,resource.filename));
    else if(resource.definitionRef)section.append(originalLink(resource.definitionRef,'Download complete resource record'));
    if(resource.contentBase64&&resource.bytes<=8*1024*1024&&resource.contentType==='image/png'&&resource.contentBase64.startsWith('iVBORw0KGgo')){
      section.append(node('img',null,{class:'native-diagram',src:'data:image/png;base64,'+resource.contentBase64,alt:'Original Flowable diagram for '+label}));
    }
    if(resource.contentBase64&&resource.bytes<=1024*1024&&/(?:xml|text|json)/i.test(resource.contentType??resource.filename??'')){
      const bytes=Uint8Array.from(atob(resource.contentBase64),char=>char.charCodeAt(0));
      jsonSection(section,sourceLabel,new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }
    container.append(section);
  }
}
async function openDefinition(definition){
  const result=await api('readDefinition',{portfolioId:state.portfolio,definitionId:definition.id});
  state.definition=definition;const container=detail(definition.name??definition.key??definition.id);
  container.append(keyValues([['Definition ID',definition.id],['Key',definition.key],['Version',definition.version],
    ['Deployment',definition.deploymentId],['Tenant',definition.tenantId]]));
  container.append(button('Start this definition',()=>{
    const form=$('#process-form');
    form.elements.label.value='Start '+(definition.name??definition.key);
    form.elements.bodyText.value=JSON.stringify({processDefinitionId:definition.id,businessKey:'case-'+crypto.randomUUID(),variables:[]},null,2);
    switchPage('processes');form.scrollIntoView({behavior:'smooth',block:'start'});$('#detail').hidden=true;
  },{primary:true}));
  renderOriginalResources(container,result.resources,{label:definition.name??definition.key??definition.id,sourceLabel:'Original process source'});
  jsonSection(container,'Original definition record',result.definition);revealDetail();
}
async function openDecisionDefinition(definition){
  const result=await api('readDecisionDefinition',{portfolioId:state.decisionPortfolio,definitionId:definition.id});
  const container=detail(definition.name??definition.key??definition.id);
  container.append(keyValues([['Definition ID',definition.id],['Decision key',definition.key],['Captured version',definition.version],
    ['Deployment',definition.deploymentId],['Parent deployment',result.deployment?.parentDeploymentId],['Tenant',definition.tenantId]]));
  container.append(button('Prepare evaluation for this key',()=>{
    const form=$('#decisionEvaluation-form'),body={decisionKey:definition.key,inputVariables:[],disableHistory:false};
    if(definition.tenantId)body.tenantId=definition.tenantId;
    if(result.deployment?.parentDeploymentId)body.parentDeploymentId=result.deployment.parentDeploymentId;
    form.elements.label.value='Evaluate '+(definition.name??definition.key);
    form.elements.mode.value='auto';form.elements.singleResult.checked=false;
    form.elements.bodyText.value=JSON.stringify(body,null,2);
    switchPage('decisions');form.scrollIntoView({behavior:'smooth',block:'start'});$('#detail').hidden=true;
  },{primary:true}));
  container.append(node('p','Evaluation resolves the current native definition for this key and scope. The saved review retains the actual selection before dispatch.'));
  renderOriginalResources(container,result.resources,{label:definition.name??definition.key??definition.id,sourceLabel:'Original decision source'});
  jsonSection(container,'Original decision definition',result.definition);
  if(result.deployment)jsonSection(container,'Original decision deployment',result.deployment);
  revealDetail();
}
async function openDecisionExecution(execution){
  const result=await api('readDecisionExecution',{portfolioId:state.decisionPortfolio,executionId:execution.id});
  const container=detail('Decision execution · '+execution.id);
  container.append(keyValues([['Execution ID',execution.id],['Decision key',execution.decisionKey??execution.decisionDefinitionKey],
    ['Decision version',execution.decisionVersion??execution.decisionDefinitionVersion],
    ['Started',stamp(execution.startTime)],['Ended',stamp(execution.endTime)],['Deployment',execution.deploymentId]]));
  jsonSection(container,'Original native execution',result.execution,{open:true});
  renderOriginalResources(container,result.resources,{label:'Decision execution '+execution.id,sourceLabel:'Original native audit data'});
  revealDetail();
}

const CASE_COLLECTION_LABELS={deployments:'Deployments',definitions:'Case definitions',cases:'Active cases',
  planItems:'Stages and plan items',tasks:'Case human tasks',variables:'Current variables',
  historicCases:'Case history',historicPlanItems:'Plan item history',historicTasks:'Task history',
  historicVariables:'Variable history',milestones:'Milestones'};
const CASE_PLAN_ACTIONS={startPlanItem:'start',triggerPlanItem:'trigger',enablePlanItem:'enable',disablePlanItem:'disable'};
const caseCollectionLabel=key=>CASE_COLLECTION_LABELS[key]??key;
function caseCollectionColumns(collection){
  return[{label:'Native ID',render:item=>item.id??item.name},
    {label:'Name',render:item=>item.name??item.key??item.planItemDefinitionId??item.variable?.name},
    {label:'Case',render:nativeCaseId},
    ...(['tasks','historicTasks'].includes(collection)?[{label:'Scope',key:'scopeType'}]:[]),
    {label:'State / type',render:item=>item.state??item.variable?.type??item.variableType??item.type},
    {label:'Started / created',render:item=>stamp(item.startTime??item.createTime??item.createdTime)},
    {label:'Ended',render:item=>stamp(item.endTime??item.endedTime)},
    {label:'Open',render:item=>button('Inspect',()=>openCaseCollectionItem(collection,item))}];
}
async function renderCaseCollection(){
  const collection=$('#case-collection-select').value;
  const items=collection?await capturedCase(collection):[];
  table($('#case-collection-table'),caseCollectionColumns(collection),items,
    {empty:'The selected case portfolio has no records in this collection.'});
}
async function renderCases(){
  const available=state.view.capabilities?.cases?.collections??[];
  const select=$('#case-collection-select');
  selectOptions(select,available.map(key=>({value:key,label:caseCollectionLabel(key)})),
    select.value||'historicCases','Capture a case portfolio');
  const[definitions,cases,planItems,tasks]=await Promise.all(['definitions','cases','planItems','tasks'].map(capturedCase));
  table($('#case-definitions-table'),[
    {label:'Definition',render:item=>item.name??item.key},{label:'Key',key:'key'},
    {label:'Version',key:'version'},{label:'Tenant',key:'tenantId'},{label:'Deployment',key:'deploymentId'},
    {label:'Open',render:item=>button('Source and start',()=>openCaseDefinition(item))},
  ],definitions,{empty:'The selected case portfolio has no definitions.'});
  table($('#cases-table'),[
    {label:'Case',key:'id'},{label:'Name',key:'name'},{label:'Business key',key:'businessKey'},
    {label:'Definition',key:'caseDefinitionId'},{label:'State',key:'state'},
    {label:'Open',render:item=>button('Work and history',()=>openCaseInstance(item.id))},
  ],cases,{empty:'The selected case portfolio has no active cases.'});
  table($('#case-plan-items-table'),[
    {label:'Plan item',render:item=>item.name??item.planItemDefinitionId},{label:'Case',render:nativeCaseId},
    {label:'State',key:'state'},{label:'Definition type',key:'planItemDefinitionType'},
    {label:'Stage',render:item=>item.stageInstanceId??item.stage},
    {label:'Open',render:item=>button('Inspect / operate',()=>openCaseCollectionItem('planItems',item))},
  ],planItems,{empty:'The selected case portfolio has no active plan items.'});
  table($('#case-tasks-table'),[
    {label:'Task',key:'name'},{label:'Assignee',key:'assignee'},{label:'Case',render:nativeCaseId},
    {label:'Due',render:item=>stamp(item.dueDate)},{label:'Priority',key:'priority'},
    {label:'Open',render:item=>button('Inspect / operate',()=>openCaseCollectionItem('tasks',item))},
  ],tasks.filter(item=>nativeCaseId(item)),{empty:'The selected case portfolio has no active case human tasks.'});
  await renderCaseCollection();
}
function showCaseForm(kind){
  switchPage('cases');$('#detail').hidden=true;
  $('#'+kind+'-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function updateCaseInstanceFields(){
  const form=$('#caseInstance-form'),action=form.elements.action.value,start=action==='startCase',terminate=action==='terminateCase';
  $('#case-instance-id-field').hidden=start;form.elements.caseInstanceId.required=!start;
  $('#case-instance-body-field').hidden=terminate;form.elements.bodyText.required=!terminate;
  $('#case-instance-help').textContent={
    startCase:'Select one caseDefinitionId or caseDefinitionKey and retain the original business identity and typed variables.',
    updateCase:'Update name or businessKey through the original case request. This engine applies nonempty values.',
    evaluateCaseCriteria:'The original action is evaluateCriteria. Flowable reevaluates the current case criteria.',
    terminateCase:'Flowable terminates the selected live case through its native DELETE operation. Its case and work history remains available.',
  }[action]??'';
}
function caseInstanceTemplate(){
  const action=$('#caseInstance-form').elements.action.value;
  return action==='startCase'?{caseDefinitionKey:'',businessKey:'case-'+crypto.randomUUID(),variables:[]}:
    action==='updateCase'?{name:'',businessKey:''}:action==='evaluateCaseCriteria'?{action:'evaluateCriteria'}:null;
}
function useCaseInstanceTemplate(){
  const value=caseInstanceTemplate();$('#caseInstance-form').elements.bodyText.value=value?JSON.stringify(value,null,2):'';
}
async function openCaseDefinition(definition){
  const result=await api('readCaseDefinition',{portfolioId:state.casePortfolio,definitionId:definition.id});
  const container=detail(definition.name??definition.key??definition.id);
  container.append(keyValues([['Case definition ID',definition.id],['Key',definition.key],['Version',definition.version],
    ['Deployment',definition.deploymentId],['Tenant',definition.tenantId]]));
  container.append(button('Start this case definition',()=>{
    const form=$('#caseInstance-form');
    form.elements.action.value='startCase';form.elements.caseInstanceId.value='';
    form.elements.label.value='Start '+(definition.name??definition.key);
    form.elements.bodyText.value=JSON.stringify({caseDefinitionId:definition.id,businessKey:'case-'+crypto.randomUUID(),variables:[]},null,2);
    updateCaseInstanceFields();showCaseForm('caseInstance');
  },{primary:true}));
  renderOriginalResources(container,result.resources,{label:definition.name??definition.key??definition.id,sourceLabel:'Original case source'});
  jsonSection(container,'Original case definition',result.definition);
  if(result.deployment)jsonSection(container,'Original case deployment',result.deployment);
  revealDetail();
}
async function openCaseInstance(caseInstanceId){
  const result=await api('readCaseInstance',{portfolioId:state.casePortfolio,caseInstanceId});
  const selected=result.caseInstance??result.historicCase,container=detail('Case · '+(selected.name??selected.businessKey??caseInstanceId));
  container.append(keyValues([['Case ID',caseInstanceId],['Business key',selected.businessKey],['Definition',selected.caseDefinitionId],
    ['State',selected.state],['Started',stamp(selected.startTime)],['Ended',stamp(result.historicCase?.endTime)]]));
  if(result.caseInstance)container.append(button('Prepare case action',()=>{
    const form=$('#caseInstance-form'),body={};
    for(const key of ['name','businessKey'])if(typeof selected[key]==='string')body[key]=selected[key];
    form.elements.action.value='updateCase';form.elements.caseInstanceId.value=caseInstanceId;
    form.elements.label.value='Update '+(selected.name??selected.businessKey??caseInstanceId);
    form.elements.bodyText.value=JSON.stringify(body,null,2);updateCaseInstanceFields();showCaseForm('caseInstance');
  },{primary:true}));
  jsonSection(container,'Original active case',result.caseInstance);
  jsonSection(container,'Original historic case',result.historicCase);
  for(const[collection,items]of Object.entries(result.related??{})){
    const section=node('section');section.append(node('h3',caseCollectionLabel(collection)+' · '+items.length));
    const rows=node('div');table(rows,caseCollectionColumns(collection),items);section.append(rows);container.append(section);
  }
  jsonSection(container,'Selected case definitions',result.definitions);
  renderOriginalResources(container,result.resources,{label:'Case '+caseInstanceId,sourceLabel:'Original case source'});
  revealDetail();
}
async function openCaseCollectionItem(collection,item){
  if(collection==='cases'||collection==='historicCases')return openCaseInstance(item.id);
  if(collection==='definitions')return openCaseDefinition(item);
  const container=detail(caseCollectionLabel(collection)+' · '+(item.name??item.id??'Original record'));
  container.append(pre(item));const caseId=nativeCaseId(item),toolbar=node('div',null,{class:'toolbar'});
  if(caseId)toolbar.append(button('Open related case',()=>openCaseInstance(caseId)));
  if(collection==='planItems')toolbar.append(button('Prepare plan item action',()=>{
    const form=$('#casePlanItem-form');form.elements.planItemInstanceId.value=item.id;
    form.elements.caseInstanceId.value=caseId??'';form.elements.action.value='startPlanItem';
    form.elements.label.value='Operate '+(item.name??item.id);
    form.elements.bodyText.value=JSON.stringify({action:'start'},null,2);showCaseForm('casePlanItem');
  },{primary:true}));
  if(collection==='tasks'&&caseId)toolbar.append(button('Prepare case task action',()=>{
    const form=$('#caseTask-form');form.elements.taskId.value=item.id;form.elements.caseInstanceId.value=caseId??'';
    form.elements.action.value='claim';form.elements.label.value=(item.name??item.id)+' action';
    form.elements.bodyText.value=JSON.stringify({action:'claim',assignee:item.assignee??''},null,2);showCaseForm('caseTask');
  },{primary:true}));
  container.append(toolbar);revealDetail();
}

function openNative(title,item,action){
  const container=detail(title+' · '+(item.name??item.id));container.append(pre(item));
  if(action==='task')container.append(button('Prepare task action',()=>{
    const form=$('#task-form');form.elements.taskId.value=item.id;form.elements.label.value=(item.name??'Task')+' action';
    form.elements.action.value='claim';form.elements.bodyText.value=JSON.stringify({action:'claim',assignee:item.assignee??''},null,2);
    switchPage('tasks');form.scrollIntoView({behavior:'smooth',block:'start'});$('#detail').hidden=true;
  },{primary:true}));
  if(action==='process')container.append(button('Prepare migration',()=>{
    const form=$('#migration-form');form.elements.processInstanceId.value=item.id;
    form.elements.label.value='Migrate '+(item.businessKey??item.name??item.id);
    switchPage('migrations');form.scrollIntoView({behavior:'smooth',block:'start'});$('#detail').hidden=true;
  },{primary:true}));
  revealDetail();
}
async function openRecord(kind,id){
  if(kind==='programme'){switchPage('programmes');return programmeBrowser.open(id);}
  const record=await api('getRecord',{kind,id}),operation=FLOWABLE_OPERATION_KINDS.includes(kind);
  state.detail={kind,id};
  const container=detail(record.value.label??kind+' '+id);
  container.append(keyValues([['State',record.value.state??record.value.phase],['Revision',record.revision],
    ['Created',stamp(record.createdAt)],['Updated',stamp(record.updatedAt)]]));
  if(operation){
    const review=await api('readReview',{kind,id,revision:record.revision});
    const toolbar=node('div',null,{class:'toolbar'});
    if(review.phase==='PREPARED'){
      const label={release:'Deploy release',process:'Start process',task:'Execute task action',migration:'Migrate process',decisionRelease:'Deploy decisions',decisionEvaluation:'Evaluate decisions',caseRelease:'Deploy case release',caseInstance:'Execute case action',casePlanItem:'Execute plan item action',caseTask:'Execute case task action'}[kind];
      toolbar.append(button(label,async()=>{
        const method='dispatch'+kind[0].toUpperCase()+kind.slice(1);
        const result=await write(method,{id,expectedRevision:record.revision,planSha256:review.request.planSha256});
        await reload();await openRecord(kind,id);notice('Saved '+kind+' outcome: '+result.value.state+'.');
      },{primary:true}));
    }
    if(!review.dispatchedAt&&['INTERRUPTED','PREPARE_FAILED'].includes(review.phase)&&record.value.preparationInput){
      toolbar.append(button('Resume original preparation',async()=>{
        const original=await api('readSource',{reference:record.value.preparationInput});
        const method='prepare'+kind[0].toUpperCase()+kind.slice(1);
        const result=await write(method,original.value);
        await reload();await openRecord(kind,id);notice('Original preparation: '+result.value.state+'.');
      },{primary:true}));
    }
    if(review.dispatchedAt)toolbar.append(button('Refresh native outcome',async()=>{
      await write('reconcileOperation',{kind,id,expectedRevision:record.revision});await reload();await openRecord(kind,id);
    }));
    toolbar.append(button('Prepare another review',()=>reuseSelection(kind,review)));
    container.append(toolbar);
    container.append(keyValues([['Engine',review.connection.label??review.connection.alias],['REST service',review.connection.baseUrl],
      ['Native action',review.request?.action],['Method',review.request?.method],['Path',review.request?.path],
      ['Request bytes',review.request?.bodyBytes],['Native response',review.response?.status]]));
    if(review.note)container.append(node('p',review.note));
    if(review.failure)container.append(node('p',review.failure.message));
    if(review.validation){
      container.append(node('h3','Native migration validation'));
      container.append(pre(review.validation.json??review.validation.bodyText??review.validation));
    }
    if(review.request?.bodyText!=null){container.append(node('h3','Original native request'));container.append(pre(review.request.bodyText));}
    if(review.request?.resource)container.append(keyValues([['Deployment resource',review.request.resource.filename],
      ['Deployment name',review.request.deploymentName],['Deployment key',review.request.deploymentKey],['Tenant',review.request.tenantId]]));
    if(review.reconciliation){container.append(node('h3','Native outcome'));container.append(pre(review.reconciliation));}
    const sources=node('div');sources.append(node('h3','Complete original sources'));
    for(const source of review.originals??[]){
      const row=node('p');row.append(originalLink(source.reference,source.role,source.filename));
      row.append(document.createTextNode(' '+source.reference.bytes+' bytes'));sources.append(row);
    }
    container.append(sources);
    jsonSection(container,'Native state before the request',review.before);
    jsonSection(container,'Native state after the request',review.after);
    jsonSection(container,'Original response',review.response);
  }else if(['portfolio','decisionPortfolio','casePortfolio'].includes(kind)){
    if(record.value.state==='CAPTURED')container.append(button('Open saved native portfolio',async()=>{
      state.engine=record.value.connectionId;
      if(kind==='portfolio')state.portfolio=id;else if(kind==='casePortfolio')state.casePortfolio=id;else state.decisionPortfolio=id;
      await reload();switchPage(kind==='portfolio'?'definitions':kind==='casePortfolio'?'cases':'decisions');$('#detail').hidden=true;
    },{primary:true}));
    if(record.value.phase==='INTERRUPTED'&&record.value.captureInput)container.append(button('Resume original capture',async()=>{
      const original=await api('readSource',{reference:record.value.captureInput});
      const result=await write(kind==='decisionPortfolio'?'captureDecisionPortfolio':kind==='casePortfolio'?'captureCasePortfolio':'capturePortfolio',original.value);
      if(result.value.state==='CAPTURED'){
        state.engine=record.value.connectionId;
        if(kind==='portfolio')state.portfolio=id;else if(kind==='casePortfolio')state.casePortfolio=id;else state.decisionPortfolio=id;
      }
      await reload();await openRecord(kind,id);notice('Original capture: '+result.value.state+'.');
    },{primary:true}));
    if(record.value.failure)container.append(node('p',record.value.failure.message));
    jsonSection(container,'Saved native portfolio',record.value,{open:true});
  }else if(kind==='delivery'){
    if(record.value.state==='EXPORTED')container.append(node('a','Download complete handover',
      {class:'button',href:'/api/delivery?id='+encodeURIComponent(id),download:''}));
    jsonSection(container,'Handover manifest and receiving identity',record.value,{open:true});
  }else if(kind==='receiving'){
    if(record.value.state==='INSPECTED')container.append(button('Adopt complete original history',async()=>{
      await write('adoptDelivery',{id,expectedRevision:record.revision,manifestSha256:record.value.manifestSha256});
      await reload();await openRecord(kind,id);notice('Complete original workspace history received.');
    },{primary:true}));
    jsonSection(container,'Original receiving inspection',record.value,{open:true});
  }else jsonSection(container,'Original saved record',record,{open:true});
  revealDetail();
}
function reuseSelection(kind,review){
  const form=$('#'+kind+'-form');switchPage({process:'processes',task:'tasks',release:'releases',migration:'migrations',
    decisionRelease:'decisions',decisionEvaluation:'decisions',caseRelease:'cases',caseInstance:'cases',casePlanItem:'cases',caseTask:'cases'}[kind]);
  if(form.elements.label)form.elements.label.value=review.label??'';
  if(form.elements.note)form.elements.note.value=review.note??'';
  if(form.elements.bodyText)form.elements.bodyText.value=review.request?.bodyText??'';
  if(form.elements.taskId)form.elements.taskId.value=review.request?.taskId??'';
  if(form.elements.processInstanceId)form.elements.processInstanceId.value=review.request?.processInstanceId??'';
  for(const key of ['caseInstanceId','planItemInstanceId'])if(form.elements[key])form.elements[key].value=review.request?.[key]??'';
  if(form.elements.action)form.elements.action.value=review.request?.action??'claim';
  if(['release','decisionRelease','caseRelease'].includes(kind)){
    for(const key of ['deploymentName','deploymentKey','tenantId'])if(form.elements[key])form.elements[key].value=review.request?.[key]??'';
  }
  if(form.elements.mode)form.elements.mode.value=review.request?.mode??'auto';
  if(form.elements.singleResult)form.elements.singleResult.checked=review.request?.singleResult===true;
  if(kind==='caseInstance')updateCaseInstanceFields();
  form.scrollIntoView({behavior:'smooth',block:'start'});$('#detail').hidden=true;
}
function requireEngine(){
  if(!state.engine)throw Object.assign(new Error('Add and select the original Flowable engine.'),{code:'FLOWABLE_ENGINE_REQUIRED'});
  return state.engine;
}
function values(form){return Object.fromEntries(new FormData(form));}
function formAction(id,label,fn){
  $(id).addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    if(state.busy||!form.reportValidity())return;
    const original=values(form);
    void busy(label,()=>fn(form,original));
  });
}
function originalJSON(text){
  try{const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}
  catch{throw Object.assign(new Error('Supply one complete original native JSON object.'),{code:'FLOWABLE_JSON_REQUIRED'});}
}
const optionalText=(value,key,target)=>{if(value[key])target[key]=value[key];};
function toBase64(bytes){
  let value='';for(let index=0;index<bytes.length;index+=24576)value+=btoa(String.fromCharCode(...bytes.subarray(index,index+24576)));
  return value;
}
formAction('#connection-form','Save engine',async(form,value)=>{
  const connection={id:value.id,label:value.label,baseUrl:value.baseUrl,usernameEnv:value.usernameEnv,passwordEnv:value.passwordEnv};
  const input={connection};
  if(value.recordId){input.id=value.recordId;input.expectedRevision=Number(value.revision);}
  const result=await write('saveConnection',input);state.engine=result.id;form.reset();form.elements.id.readOnly=false;
  $('#connection-form-title').textContent='Add engine';await reload();notice('Engine connection saved.');
});
formAction('#release-form','Prepare native deployment',async(form,value)=>{
  const file=value.resource;
  if(!(file instanceof File)||file.size===0)throw new Error('Select the complete original deployment file.');
  if(file.size>90*1024*1024)throw new Error('This browser action supports deployment resources up to 90 MiB. Use the installed client for larger original requests.');
  const resource={filename:file.name,contentType:file.type||(/\.(?:bar|zip)$/i.test(file.name)?'application/zip':'application/xml'),
    contentBase64:toBase64(new Uint8Array(await file.arrayBuffer()))};
  const selection={action:'deploy',resource};
  for(const key of ['deploymentName','deploymentKey','tenantId'])optionalText(value,key,selection);
  const result=await write('prepareRelease',{connectionId:requireEngine(),label:value.label||file.name,note:value.note,selection});
  await reload();await openRecord('release',result.id);
});
formAction('#process-form','Prepare process start',async(form,value)=>{
  originalJSON(value.bodyText);
  const result=await write('prepareProcess',{connectionId:requireEngine(),label:value.label||'Start process',note:value.note,
    selection:{action:'start',bodyText:value.bodyText}});
  await reload();await openRecord('process',result.id);
});
formAction('#task-form','Prepare task action',async(form,value)=>{
  const parsed=originalJSON(value.bodyText);
  if(parsed.action!==value.action)throw new Error('The native JSON action must match the selected action.');
  const result=await write('prepareTask',{connectionId:requireEngine(),label:value.label||value.action+' task',
    selection:{action:value.action,taskId:value.taskId,bodyText:value.bodyText}});
  await reload();await openRecord('task',result.id);
});
formAction('#migration-form','Validate native process migration',async(form,value)=>{
  originalJSON(value.bodyText);
  const result=await write('prepareMigration',{connectionId:requireEngine(),label:value.label||'Migrate process',note:value.note,
    selection:{action:'migrate',processInstanceId:value.processInstanceId,bodyText:value.bodyText}});
  await reload();await openRecord('migration',result.id);
});
formAction('#decisionRelease-form','Prepare native decision deployment',async(form,value)=>{
  const file=value.resource;
  if(!(file instanceof File)||file.size===0)throw new Error('Select the complete original DMN resource.');
  if(file.size>90*1024*1024)throw new Error('This browser action supports DMN resources up to 90 MiB. Use the installed client for larger original requests.');
  const selection={action:'deploy',resource:{filename:file.name,contentType:file.type||'application/xml',
    contentBase64:toBase64(new Uint8Array(await file.arrayBuffer()))}};
  optionalText(value,'tenantId',selection);
  const result=await write('prepareDecisionRelease',{connectionId:requireEngine(),label:value.label||file.name,note:value.note,selection});
  await reload();await openRecord('decisionRelease',result.id);
});
formAction('#decisionEvaluation-form','Prepare native decision evaluation',async(form,value)=>{
  originalJSON(value.bodyText);
  const result=await write('prepareDecisionEvaluation',{connectionId:requireEngine(),label:value.label||'Evaluate decisions',note:value.note,
    selection:{action:'evaluate',mode:value.mode,singleResult:value.singleResult==='on',bodyText:value.bodyText}});
  await reload();await openRecord('decisionEvaluation',result.id);
});
formAction('#caseRelease-form','Prepare native case deployment',async(form,value)=>{
  const file=value.resource;
  if(!(file instanceof File)||file.size===0)throw new Error('Select the complete original CMMN resource or deployment archive.');
  if(file.size>90*1024*1024)throw new Error('This browser action supports deployment resources up to 90 MiB. Use the installed client for larger original requests.');
  const selection={action:'deploy',resource:{filename:file.name,
    contentType:file.type||(/\.(?:bar|zip)$/i.test(file.name)?'application/zip':'application/xml'),
    contentBase64:toBase64(new Uint8Array(await file.arrayBuffer()))}};
  for(const key of ['deploymentName','deploymentKey','tenantId'])optionalText(value,key,selection);
  const result=await write('prepareCaseRelease',{connectionId:requireEngine(),label:value.label||file.name,note:value.note,selection});
  await reload();await openRecord('caseRelease',result.id);
});
formAction('#caseInstance-form','Prepare native case action',async(form,value)=>{
  const selection={action:value.action};
  if(value.action!=='startCase')selection.caseInstanceId=value.caseInstanceId;
  if(value.action!=='terminateCase'){
    const parsed=originalJSON(value.bodyText);selection.bodyText=value.bodyText;
    if(value.action==='evaluateCaseCriteria'&&parsed.action!=='evaluateCriteria')
      throw new Error('Use the original evaluateCriteria action for this case request.');
    if(value.action==='updateCase'&&parsed.action)
      throw new Error('A case update uses the original name and businessKey fields with no action.');
  }
  const result=await write('prepareCaseInstance',{connectionId:requireEngine(),label:value.label||value.action,note:value.note,selection});
  await reload();await openRecord('caseInstance',result.id);
});
formAction('#casePlanItem-form','Prepare native case plan item action',async(form,value)=>{
  const parsed=originalJSON(value.bodyText);
  if(parsed.action!==CASE_PLAN_ACTIONS[value.action])throw new Error('The original JSON action must match the selected plan item operation.');
  const selection={action:value.action,planItemInstanceId:value.planItemInstanceId,bodyText:value.bodyText};
  optionalText(value,'caseInstanceId',selection);
  const result=await write('prepareCasePlanItem',{connectionId:requireEngine(),label:value.label||value.action,note:value.note,selection});
  await reload();await openRecord('casePlanItem',result.id);
});
formAction('#caseTask-form','Prepare native case task action',async(form,value)=>{
  const parsed=originalJSON(value.bodyText),nativeAction=value.action==='unclaim'?'claim':value.action;
  if(parsed.action!==nativeAction||value.action==='unclaim'&&parsed.assignee!==null)
    throw new Error('The original JSON action must match the selected task action. Release claim uses claim with assignee:null.');
  const selection={action:value.action,taskId:value.taskId,bodyText:value.bodyText};optionalText(value,'caseInstanceId',selection);
  const result=await write('prepareCaseTask',{connectionId:requireEngine(),label:value.label||value.action+' case task',note:value.note,selection});
  await reload();await openRecord('caseTask',result.id);
});
formAction('#export-form','Export complete workspace',async(form,value)=>{
  const result=await write('exportWorkspace',{label:value.label||'Complete process operations handover'});
  await reload();await openRecord('delivery',result.id);
});
formAction('#import-form','Receive complete original workspace',async(form,value)=>{
  const file=value.archive;
  if(!(file instanceof File)||file.size===0)throw new Error('Select the complete original handover archive.');
  const result=await uploadOriginal(file,{requestId:crypto.randomUUID(),label:file.name});
  await reload();await openRecord('receiving',result.id);
});
$$('[data-page]').forEach(element=>element.addEventListener('click',()=>switchPage(element.dataset.page)));
$('#new-engine').addEventListener('click',()=>{
  const form=$('#connection-form');form.reset();form.elements.recordId.value='';form.elements.revision.value='';
  form.elements.id.readOnly=false;$('#connection-form-title').textContent='Add engine';
});
$('#engine-select').addEventListener('change',()=>busy('Read saved engine workspace',async()=>{
  state.engine=$('#engine-select').value;state.portfolio=null;state.decisionPortfolio=null;state.casePortfolio=null;await reload();
}));
$('#portfolio-select').addEventListener('change',()=>busy('Read saved portfolio',async()=>{
  state.portfolio=$('#portfolio-select').value;await renderAll();
}));
$('#capture').addEventListener('click',()=>busy('Capture complete native engine portfolio',async()=>{
  const result=await write('capturePortfolio',{connectionId:requireEngine(),label:'Engine portfolio '+new Date().toISOString()});
  if(result.value.state==='CAPTURED')state.portfolio=result.id;
  await reload();if(result.value.state!=='CAPTURED')await openRecord('portfolio',result.id);
  notice(result.value.state==='CAPTURED'?'Original definitions, active work and history captured.':
    result.value.failure?.message??'Capture state: '+result.value.state,result.value.state==='CAPTURED'?'info':'error');
}));
$('#decision-portfolio-select').addEventListener('change',()=>busy('Read saved decision portfolio',async()=>{
  state.decisionPortfolio=$('#decision-portfolio-select').value;await renderAll();
}));
$('#capture-decisions').addEventListener('click',()=>busy('Capture complete native decision portfolio',async()=>{
  const result=await write('captureDecisionPortfolio',{connectionId:requireEngine(),label:'Decision portfolio '+new Date().toISOString()});
  if(result.value.state==='CAPTURED')state.decisionPortfolio=result.id;
  await reload();if(result.value.state!=='CAPTURED')await openRecord('decisionPortfolio',result.id);
  notice(result.value.state==='CAPTURED'?'Original decision definitions, resources and execution history captured.':
    result.value.failure?.message??'Decision capture state: '+result.value.state,result.value.state==='CAPTURED'?'info':'error');
}));
$('#case-portfolio-select').addEventListener('change',()=>busy('Read saved case portfolio',async()=>{
  state.casePortfolio=$('#case-portfolio-select').value;await renderAll();
}));
$('#capture-cases').addEventListener('click',()=>busy('Capture complete native case portfolio',async()=>{
  const result=await write('captureCasePortfolio',{connectionId:requireEngine(),label:'Case portfolio '+new Date().toISOString()});
  if(result.value.state==='CAPTURED')state.casePortfolio=result.id;
  await reload();if(result.value.state!=='CAPTURED')await openRecord('casePortfolio',result.id);
  notice(result.value.state==='CAPTURED'?'Original case definitions, work, variables, milestones and history captured.':
    result.value.failure?.message??'Case capture state: '+result.value.state,result.value.state==='CAPTURED'?'info':'error');
}));
$('#case-collection-select').addEventListener('change',()=>busy('Read captured case collection',renderCaseCollection));
$('#caseInstance-form').elements.action.addEventListener('change',updateCaseInstanceFields);
$('#case-instance-template').addEventListener('click',useCaseInstanceTemplate);
$('#case-plan-item-template').addEventListener('click',()=>{
  const form=$('#casePlanItem-form');form.elements.bodyText.value=JSON.stringify({action:CASE_PLAN_ACTIONS[form.elements.action.value]},null,2);
});
$('#case-task-template').addEventListener('click',()=>{
  const form=$('#caseTask-form'),action=form.elements.action.value;
  const body=action==='unclaim'?{action:'claim',assignee:null}:
    ['claim','delegate'].includes(action)?{action,assignee:''}:{action,variables:[]};
  form.elements.bodyText.value=JSON.stringify(body,null,2);
});
$('#refresh').addEventListener('click',()=>busy('Reload saved workspace',reload));
$('#cancel').addEventListener('click',()=>state.controller?.abort(new Error('Connection cancelled. The original request remains saved for recovery.')));
$('#close-detail').addEventListener('click',()=>{$('#detail').hidden=true;});
$('#resume').addEventListener('click',()=>busy('Read original request outcome',async()=>{
  const item=state.pending[0];if(!item)return;
  const result=item.method==='__inspect'?await uploadOriginal(item.upload,item.args,{pending:item}):await api(item.method,item.args);
  if(item.method!=='__inspect')await pendingRemove(item);
  await reload();
  if(result?.kind&&result?.id)await openRecord(result.kind,result.id);
  notice('Original request result received.');
}));
$('#dismiss').addEventListener('click',()=>busy('Close local request notice',async()=>{
  const item=state.pending[0];if(item)await pendingRemove(item);
  notice('The saved operation remains in workspace history.');
}));
await busy('Open saved workspace',async()=>{
  if(!token)throw Object.assign(new Error('Open the original private workspace URL.'),{code:'FLOWABLE_WORKSPACE_TOKEN_REQUIRED'});
  await reload();await pendingRefresh();
  $('#process-form').elements.bodyText.value=JSON.stringify({processDefinitionKey:'',businessKey:'case-'+crypto.randomUUID(),variables:[]},null,2);
  $('#decisionEvaluation-form').elements.bodyText.value=JSON.stringify({decisionKey:'',inputVariables:[],disableHistory:false},null,2);
  updateCaseInstanceFields();useCaseInstanceTemplate();
});
