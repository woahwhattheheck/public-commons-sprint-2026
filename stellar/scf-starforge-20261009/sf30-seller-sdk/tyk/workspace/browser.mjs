import { createGatewayCommissioningBrowser } from './gateway-commissioning-browser.mjs';
import { createCommissioningBrowser } from './commissioning-browser.mjs';
import { readTykBrowserRequest, saveTykBrowserRequest } from './browser-request-store.mjs';
import { TYK_WORKSPACE_ACTIONS, TYK_MAX_JSON_BYTES } from './actions.mjs';
const $=id=>document.getElementById(id), el=(name,text,className)=>{
  const node=document.createElement(name);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;
};
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('tyk-workspace-token',token);history.replaceState(null,'',location.pathname);}
else token=sessionStorage.getItem('tyk-workspace-token')??'';
const state={workspace:null,targetEdit:null,capture:null,captureOffset:0,selected:new Set(),definition:null,
  cohort:null,review:null,reviewDraft:null,receiving:null,busy:false,controller:null,lists:{},cohorts:[],captures:[]};
const field=(form,name)=>form.elements.namedItem(name);
const formValue=(form,name)=>field(form,name).value;
const uuid=()=>crypto.randomUUID();
const fmt=value=>JSON.stringify(value,null,2);
const bytes=value=>Number(value).toLocaleString()+' bytes';
const stamp=value=>value?new Date(value).toLocaleString():'—';
const stateName=value=>({ACCEPTED:'Saved / awaiting native activation',CONFIRMED:'Confirmed',CAPTURED:'Captured',
  PREPARED:'Prepared',UNKNOWN:'Readback required',PREPARE_FAILED:'Preparation incomplete',STALE:'Target changed',
  DISPATCHED:'Dispatched',READBACK:'Reading back',PARTIAL:'Partial native result',ADOPTED:'Received'})[value]??value;
const badge=value=>el('span',stateName(value),'badge');
function notice(message){$('notice').textContent=message;}
function detail(label,value){const node=el('div',undefined,'detail-row');node.append(el('strong',label),el('span',value??'—'));return node;}
function button(label,fn,className){const node=el('button',label,className);node.type='button';node.addEventListener('click',fn);return node;}
function link(label,href){const node=el('a',label);node.href=href;node.download='';return node;}
function table(id,headings,rows){
  const container=$(id);container.replaceChildren();
  if(!rows.length){container.append(el('p','No saved records.','empty'));return;}
  const node=el('table'),head=el('thead'),headRow=el('tr'),body=el('tbody');
  for(const heading of headings)headRow.append(el('th',heading));head.append(headRow);
  for(const row of rows){const tr=el('tr');for(const value of row){const cell=el('td');cell.append(value instanceof Node?value:document.createTextNode(String(value??'—')));tr.append(cell);}body.append(tr);}
  node.append(head,body);container.append(node);
}
function facts(id,values){const container=$(id);container.replaceChildren();const row=el('div',undefined,'facts');
  for(const [label,value] of Object.entries(values)){const cell=el('div');cell.append(el('strong',value),el('span',label));row.append(cell);}container.append(row);}
function tab(name){for(const section of document.querySelectorAll('.section'))section.hidden=section.id!==name;
  for(const node of document.querySelectorAll('[data-tab]')){if(node.dataset.tab===name)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');}}
for(const node of document.querySelectorAll('[data-tab]'))node.addEventListener('click',()=>tab(node.dataset.tab));
function pendingKey(){return 'tyk-original-request-'+state.workspace.workspaceId;}
async function readPending(){
  let value=await readTykBrowserRequest(pendingKey());
  if(!value){const old=sessionStorage.getItem(pendingKey());if(old){
    value=JSON.parse(old);await saveTykBrowserRequest(pendingKey(),value);sessionStorage.removeItem(pendingKey());
  }}return value;
}
async function showPending(){if(!state.workspace)return;
  try{const saved=await readPending();$('pending').hidden=!saved;
    if(saved)$('pending-description').textContent=saved.label+' · '+saved.args.requestId+' · '+saved.method;
  }catch(error){notice('Original request journal: '+error.message);}
}
function setBusy(value){state.busy=value;for(const form of document.querySelectorAll('form'))form.inert=value;
  $('cancel-request').hidden=!value;document.querySelector('main').setAttribute('aria-busy',String(value));}
async function http(path,{method='GET',body,headers={},signal}={}){
  const response=await fetch(path,{method,headers:{'x-workspace-token':token,
    ...(state.workspace?{'x-workspace-id':state.workspace.workspaceId}:{}),
    ...(body!==undefined&&!(body instanceof File)?{'content-type':'application/json'}:{}),...headers},
    ...(body===undefined?{}:{body:body instanceof File?body:JSON.stringify(body)}),signal});
  const result=await response.json();
  if(!response.ok||result.error)throw Object.assign(new Error(result.message??result.error??('HTTP '+response.status)),{code:result.error,status:response.status});
  return result;
}
async function read(method,args={}){return http('/api/action',{method:'POST',body:{method,args}});}
async function run(label,task){
  if(state.busy){notice('The original request is still running. Its saved result will appear here.');return;}
  setBusy(true);state.controller=new AbortController();notice(label+'…');
  try{return await task(state.controller.signal);}catch(error){notice(error.name==='AbortError'?
    'The browser request stopped. Recover the original request to read its saved outcome.':error.message);
    showPending();}finally{state.controller=null;setBusy(false);}
}
async function action(method,args,label,{original=false,signal}={}){
  const contract=TYK_WORKSPACE_ACTIONS[method];
  const input=contract.write?{...args,requestId:args.requestId??uuid()}:args;
  if(contract.write){await readPending();await saveTykBrowserRequest(pendingKey(),{method,args:input,label,workspaceId:state.workspace.workspaceId});await showPending();}
  const result=await http('/api/action',{method:'POST',body:{method,args:input},signal});
  if(contract.write){await saveTykBrowserRequest(pendingKey(),null,input.requestId);await showPending();}
  return result;
}
const cancel=button('Stop current request',()=>state.controller?.abort());cancel.id='cancel-request';cancel.hidden=true;
document.querySelector('.top').append(cancel);
$('resume-request').addEventListener('click',()=>run('Recovering original request',async signal=>{
  const pending=await readPending();if(!pending)return;
  if(pending.workspaceId!==state.workspace.workspaceId)throw new Error('This saved request belongs to another workspace.');
  const result=await action(pending.method,pending.args,pending.label,{original:true,signal});
  await refresh();await showResult(result);notice('Original request recovered. '+stateName(result.value?.state??'Complete'));
}));
$('dismiss-request').addEventListener('click',()=>run('Clearing the local request notice',async()=>{
  await saveTykBrowserRequest(pendingKey(),null);sessionStorage.removeItem(pendingKey());await showPending();
  notice('The local notice was cleared. Saved server records remain in their original history.');
}));
async function allRecords(kind){
  const items=[];let offset=0,snapshot;
  for(;;){const result=await read('listRecords',{kind,offset,limit:500,...(snapshot?{snapshot}:{})});
    items.push(...result.items);snapshot=result.snapshot;if(result.nextOffset===null)return items;offset=result.nextOffset;}
}
function options(select,items,value,label){
  const previous=value??select.value;select.replaceChildren();
  for(const item of items){const option=el('option',label(item));option.value=item.id;select.append(option);}
  if(items.some(item=>item.id===previous))select.value=previous;
}
async function refresh(){
  const workspace=await http('/api/workspace');
  if(state.workspace&&workspace.workspaceId!==state.workspace.workspaceId)throw new Error('The original workspace identity changed. Reopen its private link.');
  state.workspace=workspace;
  const identity=$('workspace-identity');identity.replaceChildren();
  for(const [name,value] of [['Workspace',workspace.workspaceId],['Directory',workspace.directory]]){
    identity.append(el('dt',name),el('dd',value));}
  table('target-list',['Target','Service','Base URL','Credential',''],workspace.connections.map(item=>[
    item.connection.label,item.connection.kind,item.connection.baseUrl,item.credentialAvailable?'Available':item.connection.authEnv+' is not set',
    button('Edit',()=>editTarget(item))]));
  for(const select of document.querySelectorAll('.target-select'))options(select,workspace.connections,null,item=>item.connection.label+' · '+item.connection.kind);
  [state.captures,state.cohorts]=await Promise.all([allRecords('capture'),allRecords('cohort')]);
  options($('capture-select'),state.captures,state.capture?.id,item=>item.label+' · '+stateName(item.state)+' · '+stamp(item.createdAt));
  options($('rollout-cohort'),state.cohorts,state.cohort?.id,item=>item.label);
  await commissioning.updateCohorts(state.cohorts);
  await gatewayCommissioning.updateTargets(workspace.connections);
  await Promise.all(['cohort','commissioning','gatewayCommissioning','rollout','delivery','receiving'].map(kind=>loadList(kind,0)));
  if($('capture-select').value)await loadCapture($('capture-select').value,state.capture?.id===$('capture-select').value?state.captureOffset:0);
  showPending();
}
async function loadList(kind,offset=0,snapshot){
  const result=await read('listRecords',{kind,offset,limit:25,...(snapshot?{snapshot}:{})});
  state.lists[kind]=result;
  const choose=record=>run('Opening saved record',async()=>{
    const full=await read('getRecord',{kind,id:record.id});await showResult(full);notice('Opened '+record.label+'.');
  });
  const rows=result.items.map(record=>{
    const controls=el('div',undefined,'actions');controls.append(button('Open',()=>choose(record)));
    if(kind==='delivery'&&record.state==='EXPORTED')controls.append(link('Download','/api/delivery?id='+record.id));
    return [record.label,badge(record.state),stamp(record.updatedAt),controls];
  });
  table(kind+'-list',['Label','State','Updated',''],rows);
  const pager=$(kind+'-pages');pager.replaceChildren();
  if(offset>0)pager.append(button('Previous',()=>run('Reading previous page',()=>loadList(kind,Math.max(0,offset-25),result.snapshot))));
  pager.append(el('span',result.total?String(offset+1)+'–'+Math.min(offset+25,result.total)+' of '+result.total:'0 records'));
  if(result.nextOffset!==null)pager.append(button('Next',()=>run('Reading next page',()=>loadList(kind,result.nextOffset,result.snapshot))));
}
function editTarget(item){
  state.targetEdit=item;tab('targets');const form=$('target-form');
  for(const [name,key] of [['alias','id'],['label','label'],['kind','kind'],['baseUrl','baseUrl'],['authEnv','authEnv']])field(form,name).value=item.connection[key];
  field(form,'alias').readOnly=true;$('target-form-title').textContent='Edit '+item.connection.label;
}
$('new-target').addEventListener('click',()=>{state.targetEdit=null;$('target-form').reset();field($('target-form'),'alias').readOnly=false;$('target-form-title').textContent='New target';});
$('target-form').addEventListener('submit',event=>{event.preventDefault();run('Saving target',async signal=>{
  const form=event.currentTarget,connection={id:formValue(form,'alias'),label:formValue(form,'label'),kind:formValue(form,'kind'),
    baseUrl:formValue(form,'baseUrl'),authEnv:formValue(form,'authEnv')};
  await action('saveConnection',{connection,...(state.targetEdit?{id:state.targetEdit.id,expectedRevision:state.targetEdit.revision}:{})},'Save target',{signal});
  state.targetEdit=null;form.reset();field(form,'alias').readOnly=false;$('target-form-title').textContent='New target';
  await refresh();notice('Target saved.');
});});
$('capture-form').addEventListener('submit',event=>{event.preventDefault();run('Capturing complete native portfolio',async signal=>{
  const form=event.currentTarget,record=await action('capture',{connectionId:formValue(form,'connectionId'),label:formValue(form,'label')},'Capture portfolio',{signal});
  await refresh();await loadCapture(record.id);notice('Portfolio '+stateName(record.value.state)+'.');
});});
$('capture-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;run('Importing complete capture',async signal=>{
  if(file.size>TYK_MAX_JSON_BYTES)throw new Error('Use the complete NDJSON handover for capture packages larger than 128 MiB.');
  const capture=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
  const record=await action('importCapture',{connectionId:formValue($('capture-form'),'connectionId'),label:file.name,capture},'Import capture',{signal});
  await refresh();await loadCapture(record.id);event.target.value='';notice('Original capture imported.');
});});
async function loadCapture(id,offset=0){
  const previous=state.capture?.id,record=await read('getRecord',{kind:'capture',id,offset,limit:50});
  if(previous!==id){state.selected.clear();state.definition=null;$('definition-details').hidden=true;}
  state.capture=record;state.captureOffset=offset;$('capture-select').value=id;
  const summary=record.value.summary??{};facts('capture-summary',{APIs:summary.apis??0,Classic:summary.classic??0,OAS:summary.oas??0,
    Absent:summary.absent??0,Source:record.value.source==='native'?'Native capture':'Imported capture'});
  if(record.portfolio?.consistency)$('capture-summary').append(detail('Native inventory walk',fmt(record.portfolio.consistency)));
  if(record.value.failure)$('capture-summary').append(detail('Capture result',record.value.failure.message));
  if(!record.portfolio){table('api-table',[],[]);$('api-pages').replaceChildren();return;}
  const rows=record.portfolio.items.map(item=>{
    const checked=el('input');checked.type='checkbox';checked.setAttribute('aria-label','Select '+item.apiId);
    checked.disabled=item.found===false;checked.checked=state.selected.has(item.apiId);
    checked.addEventListener('change',()=>{if(checked.checked)state.selected.add(item.apiId);else state.selected.delete(item.apiId);selectionCount();});
    return [checked,item.summary?.name??'—',el('code',item.apiId),item.found===false?'Absent':item.kind,
      item.summary?.listenPath??'—',item.summary?.protocol??'—',item.found===false?'':button('Definition',()=>run('Reading original definition',()=>showDefinition(record,item)))];
  });
  table('api-table',['','API name','API ID','Format','Listen path','Protocol',''],rows);
  const pager=$('api-pages');pager.replaceChildren();
  if(offset>0)pager.append(button('Previous',()=>run('Reading portfolio page',()=>loadCapture(id,Math.max(0,offset-50)))));
  pager.append(el('span',record.portfolio.total?(offset+1)+'–'+Math.min(offset+50,record.portfolio.total)+' of '+record.portfolio.total:'0 APIs'));
  if(record.portfolio.nextOffset!==null)pager.append(button('Next',()=>run('Reading portfolio page',()=>loadCapture(id,record.portfolio.nextOffset))));
  selectionCount();
}
function selectionCount(){$('selection-count').textContent=state.selected.size+' selected';}
$('capture-select').addEventListener('change',event=>run('Reading saved portfolio',()=>loadCapture(event.target.value)));
$('select-all').addEventListener('click',()=>run('Selecting complete portfolio',async()=>{
  if(!state.capture)return;let offset=0;
  for(;;){const record=await read('getRecord',{kind:'capture',id:state.capture.id,revision:state.capture.revision,offset,limit:500});
    for(const item of record.portfolio?.items??[])if(item.found!==false)state.selected.add(item.apiId);
    if(record.portfolio?.nextOffset==null)break;offset=record.portfolio.nextOffset;}
  await loadCapture(state.capture.id,state.captureOffset);notice(state.selected.size+' APIs selected from the complete capture.');
}));
$('clear-selection').addEventListener('click',()=>{state.selected.clear();if(state.capture)run('Refreshing selection',()=>loadCapture(state.capture.id,state.captureOffset));});
$('cohort-form').addEventListener('submit',event=>{event.preventDefault();run('Saving API cohort',async signal=>{
  if(!state.capture||!state.selected.size)throw new Error('Select present APIs from one complete portfolio capture.');
  const form=event.currentTarget,record=await action('createCohort',{label:formValue(form,'label'),note:formValue(form,'note'),
    captureId:state.capture.id,captureRevision:state.capture.revision,apiIds:[...state.selected]},'Save cohort',{signal});
  state.cohort=record;await refresh();await showResult(record);notice('Saved '+record.value.apiIds.length+' APIs as '+record.value.label+'.');
});});
async function showDefinition(capture,item){
  const result=await read('readDefinition',{captureId:capture.id,revision:capture.revision,apiId:item.apiId});state.definition=result;
  $('definition-details').hidden=false;$('definition-details').open=true;
  $('definition-meta').replaceChildren(detail('API',item.apiId),detail('Source SHA-256',result.definition.sha256));
  $('definition-text').value=result.definition.definitionText;$('definition-target').value=capture.value.connectionId;
  const ref=item.definitionRef;$('download-definition').hidden=!ref;
  if(ref)$('download-definition').href='/api/source?sha256='+ref.sha256+'&bytes='+ref.bytes;
  notice('Original definition loaded.');
}
$('use-definition').addEventListener('click',()=>run('Preparing original definition for the selected target',async()=>{
  if(!state.definition)return;
  const original=state.definition,connectionId=$('definition-target').value;
  const adapted=await read('adaptDefinition',{captureId:original.capture.id,revision:original.capture.revision,
    apiId:original.definition.apiId,connectionId});
  const form=$('rollout-form');state.sourceDefinition=adapted.sourceDefinition;
  field(form,'operation').value='update';field(form,'kind').value=adapted.kind;field(form,'apiId').value=original.definition.apiId;
  field(form,'definitionText').value=adapted.definitionText;field(form,'contentType').value='application/json';
  field(form,'connectionId').value=connectionId;field(form,'query').value='';
  field(form,'label').value='Update '+(original.definition.summary?.name??original.definition.apiId);
  state.review=null;state.reviewDraft=null;$('rollout-review').hidden=true;updateOperation();tab('rollouts');
  notice('Loaded the complete native source for this target. '+adapted.transformation.replaceAll('_',' ').toLowerCase()+'.');
}));
$('definition-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;run('Loading complete definition',async()=>{
  if(file.size>64*1024*1024)throw new Error('One native definition may contain up to 64 MiB.');
  state.sourceDefinition=null;
  field($('rollout-form'),'definitionText').value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
  field($('rollout-form'),'contentType').value=/\.ya?ml$/i.test(file.name)?'application/x-yaml':'application/json';event.target.value='';
  notice('Complete native definition loaded. Prepare it to review the selected target and request.');
});});
function updateOperation(){
  const form=$('rollout-form'),operation=formValue(form,'operation');
  for(const node of form.querySelectorAll('[data-operation]'))node.hidden=node.dataset.operation!==operation &&
    !(node.dataset.operation==='definition'&&['create','import','update'].includes(operation));
  if(operation==='import')field(form,'kind').value='oas';
  const explanations={migrate:{dryRun:'Tyk returns the original conversion report for the selected Classic APIs.',
    stage:'Tyk creates staged OAS APIs using its native staging IDs, names and listen paths.',
    promote:'Tyk replaces the selected Classic APIs using their staged OAS versions.',
    direct:'Tyk converts and replaces the selected Classic definitions in this native request.'},
    import:'Import a plain OpenAPI document. Tyk builds its native OAS definition using the selected original query options.',
    create:'Create the complete native definition. Dashboard Classic uses its api_definition wrapper.',
    update:'Replace the full selected native definition using PUT. Review the complete document and original API ID.',
    hotReload:'Activate saved Gateway configuration. Node blocking reload waits for that node; group reload follows Tyk’s native group behavior.'};
  $('operation-explanation').textContent=operation==='migrate'?explanations.migrate[formValue(form,'mode')]:explanations[operation];
  if(formValue(form,'mode')!=='stage')field(form,'overrideStaged').checked=false;
  field(form,'overrideStaged').disabled=formValue(form,'mode')!=='stage';
  field(form,'block').disabled=formValue(form,'scope')==='group';
}
for(const name of ['operation','mode','scope'])field($('rollout-form'),name).addEventListener('change',updateOperation);
function draft(){return JSON.stringify([...new FormData($('rollout-form')).entries()]);}
async function rolloutInput(){
  const form=$('rollout-form'),operation=formValue(form,'operation');let selection={operation},cohort;
  if(operation==='migrate'){
    const id=formValue(form,'cohortId');if(!id)throw new Error('Save and select a Classic API cohort first.');
    cohort=await read('getRecord',{kind:'cohort',id});selection={...selection,mode:formValue(form,'mode'),apiIds:cohort.value.apiIds,
      abortOnFailure:field(form,'abortOnFailure').checked,overrideStaged:field(form,'overrideStaged').checked};
  }else if(operation==='hotReload'){selection.scope=formValue(form,'scope');if(selection.scope==='node')selection.block=field(form,'block').checked;}
  else{
    selection={...selection,kind:formValue(form,'kind'),definitionText:formValue(form,'definitionText'),contentType:formValue(form,'contentType')};
    if(formValue(form,'apiId').trim())selection.apiId=formValue(form,'apiId').trim();
    if(formValue(form,'query').trim())selection.query=JSON.parse(formValue(form,'query'));
  }
  return {connectionId:formValue(form,'connectionId'),label:formValue(form,'label'),note:formValue(form,'note'),selection,
    ...(cohort?{cohortId:cohort.id,cohortRevision:cohort.revision}:{}),
    ...(state.sourceDefinition && ['create','update'].includes(operation)?{sourceDefinition:state.sourceDefinition}:{})};
}
$('rollout-form').addEventListener('submit',event=>{event.preventDefault();run('Preparing native request and current target preimage',async signal=>{
  const input=await rolloutInput(),record=await action('prepareRollout',input,'Prepare native request',{signal});
  await refresh();await showRollout(record);notice('Native review '+stateName(record.value.state)+'.');
});});
async function showDefinitionReview(record,container,offset=0){
  const review=await read('readReview',{id:record.id,revision:record.revision,offset,limit:50});
  if(!container.isConnected||state.review?.id!==record.id||state.review?.revision!==record.revision)return;
  container.replaceChildren(el('h3',review.stage==='NATIVE_CONVERSION'?'Native conversion review':
    review.stage==='REQUEST_PREPARED'?'Prepared definition review':'Current native definition review'));
  const summary=review.summary;
  container.append(el('p',summary.apis+' APIs · '+summary.changedApis+' changed · '+summary.unchangedApis+
    ' unchanged · '+summary.pendingApis+' awaiting complete source · '+summary.changes+' field changes.'));
  const groups=el('div',undefined,'review-groups');
  for(const [group,count] of Object.entries(summary.byCategory))groups.append(el('span',group+': '+count));
  container.append(groups);
  const downloads=el('div',undefined,'actions');
  downloads.append(link('Download complete field review','/api/source?sha256='+review.report.sha256+'&bytes='+review.report.bytes));
  if(review.preparedReview&&review.preparedReview.sha256!==review.report.sha256)
    downloads.append(link('Download original prepared review','/api/source?sha256='+review.preparedReview.sha256+'&bytes='+review.preparedReview.bytes));
  container.append(downloads);
  if(review.sources.length){
    const label=el('label','Original documents'),select=el('select'),originals=el('div',undefined,'review-originals');
    for(const source of review.sources){const option=el('option',source.apiId+' · '+source.changes+' changes');option.value=source.apiId;select.append(option);}
    label.append(select);container.append(label,originals);
    const showOriginals=()=>{
      const source=review.sources.find(item=>item.apiId===select.value);originals.replaceChildren();
      if(!source)return;
      if(source.relationship==='CLASSIC_TO_NATIVE_STAGED_COPY')
        originals.append(el('p','Classic API '+source.beforeApiId+' → native staged copy '+source.afterApiId,'hint'));
      const row=el('div',undefined,'actions');
      for(const [name,item] of [['Before',source.before],['After',source.after]]){
        if(item.reference)row.append(link(name+' · complete original ('+bytes(item.reference.bytes)+')',
          '/api/source?sha256='+item.reference.sha256+'&bytes='+item.reference.bytes));
        else row.append(el('span',name+': '+(item.state==='ABSENT'?'absent at the captured API identity':'native document pending'),'muted'));
      }
      originals.append(row);
      for(const note of source.notes??[])originals.append(el('p',note,'hint'));
    };
    select.addEventListener('change',showOriginals);
    if(review.changes.items[0])select.value=review.changes.items[0].apiId;showOriginals();
  }
  if(review.changes.items.length){
    const wrap=el('div',undefined,'table-wrap'),table=el('table',undefined,'definition-changes'),head=el('thead'),hr=el('tr'),body=el('tbody');
    for(const label of ['API','Field','Group','Change','Before','After'])hr.append(el('th',label));head.append(hr);
    for(const change of review.changes.items){
      const row=el('tr');
      for(const text of [change.apiId,change.path||'(complete document)',change.category,change.change.toLowerCase()]){
        const cell=el('td');cell.append(el('code',text));row.append(cell);}
      for(const value of [change.before,change.after]){
        const cell=el('td');
        if(value){cell.append(el('pre',value.preview));
          if(value.truncated)cell.append(el('p','Preview · '+bytes(value.bytes)+' in the complete original','muted'));}
        else cell.append(el('span','Absent','muted'));row.append(cell);}
      body.append(row);
    }
    table.append(head,body);wrap.append(table);container.append(wrap);
  }else container.append(el('p',summary.pendingApis?'The complete native documents appear here as the original operation returns them.':
    'The captured documents have no field changes.','hint'));
  const pager=el('div',undefined,'pager'),page=review.changes;
  pager.append(el('span',page.total?String(page.offset+1)+'–'+(page.offset+page.items.length)+' of '+page.total+' field changes':'0 field changes'));
  const previous=button('Previous fields',()=>run('Reading saved field review',()=>showDefinitionReview(record,container,Math.max(0,offset-50))));
  previous.disabled=offset===0;
  const next=button('Next fields',()=>run('Reading saved field review',()=>showDefinitionReview(record,container,page.nextOffset)));
  next.disabled=page.nextOffset===null;pager.append(previous,next);container.append(pager);
}
async function showRollout(input){
  const record=await read('getRecord',{kind:'rollout',id:input.id});state.review=record;
  state.sourceDefinition=record.value.sourceDefinition?Object.fromEntries(['captureId','revision','apiId','sha256']
    .map(key=>[key,record.value.sourceDefinition[key]])):null;
  const saved=(await read('readSource',{reference:record.value.selection})).value,form=$('rollout-form');
  field(form,'label').value=record.value.label;field(form,'connectionId').value=record.value.connectionId;
  field(form,'note').value=record.value.note??'';field(form,'operation').value=saved.operation;
  if(record.value.cohort)field(form,'cohortId').value=record.value.cohort.id;
  for(const key of ['mode','kind','apiId','contentType','scope'])if(saved[key]!==undefined)field(form,key).value=saved[key];
  field(form,'definitionText').value=saved.definitionText??'';field(form,'query').value=saved.query?fmt(saved.query):'';
  for(const key of ['abortOnFailure','overrideStaged','block'])field(form,key).checked=Boolean(saved[key]);
  updateOperation();state.reviewDraft=draft();
  const panel=$('rollout-review');panel.hidden=false;panel.replaceChildren(el('h3',record.value.label),badge(record.value.state));
  panel.append(detail('Saved review',record.id+' · revision '+record.revision),detail('Native request SHA-256',record.value.planSha256));
  if(record.value.failure)panel.append(detail('Current result',record.value.failure.message));
  const plan=record.plan;
  if(plan){panel.append(detail('Request',plan.method+' '+plan.path),detail('Query',fmt(plan.query)));
    if(plan.bodyText!==null){const details=el('details');details.append(el('summary','Complete reviewed request body'),el('pre',plan.bodyText));panel.append(details);}}
  if(record.value.before){const before=(await read('readSource',{reference:record.value.before})).value;
    panel.append(detail('Reviewed native preimage',before.map(api=>api.apiId+' · '+(api.found?api.kind+' · '+api.sha256:'absent')).join('\n')||'No existing API identity was selected.'));}
  if(record.value.review){const comparison=el('section',undefined,'definition-review');panel.append(comparison);await showDefinitionReview(record,comparison);}
  const controls=el('div',undefined,'actions');
  const execute=button('Execute this saved request',()=>run('Executing original reviewed native request',async signal=>{
    if(draft()!==state.reviewDraft)throw new Error('The request form has unsaved changes. Prepare those changes before executing.');
    const result=await action('dispatchRollout',{id:record.id,expectedRevision:record.revision,planSha256:record.value.planSha256},'Execute saved native request',{signal});
    await refresh();await showRollout(result);notice('Native request '+stateName(result.value.state)+'.');
  }),'primary');
  execute.disabled=record.value.phase!=='PREPARED';controls.append(execute);
  if(record.value.dispatchedAt)controls.append(button('Refresh original readback',()=>run('Reading back original native request',async signal=>{
    const result=await action('reconcileRollout',{id:record.id,expectedRevision:record.revision},'Refresh original readback',{signal});
    await refresh();await showRollout(result);notice('Original request '+stateName(result.value.state)+'.');
  })));
  panel.append(controls);
  if(record.reconciliation){const details=el('details');details.open=true;details.append(el('summary','Native result and current API evidence'),el('pre',fmt(record.reconciliation)));panel.append(details);}
  if(record.response){panel.append(detail('Original HTTP response',String(record.response.status)+' · '+bytes(record.response.bodyBytes)));
    const ref=record.response.reference;panel.append(link('Download complete original response','/api/source?sha256='+ref.sha256+'&bytes='+ref.bytes));
    if(record.response.json!==undefined||record.response.bodyText){const details=el('details');details.append(el('summary','Response preview'),
      el('pre',record.response.json!==undefined?fmt(record.response.json):record.response.bodyText));panel.append(details);}}
  if(record.value.gatewayCommissioning)panel.append(button('Return to Gateway commissioning',
    ()=>run('Opening complete Gateway course',()=>gatewayCommissioning.open(record.value.gatewayCommissioning.id))));
  if(record.value.commissioning)panel.append(button('Return to cohort commissioning',
    ()=>run('Opening complete cohort commissioning',()=>commissioning.open(record.value.commissioning.id))));
  if(record.value.activationReviews)panel.append(detail('Saved writes checked after reload',fmt(record.value.activationReviews)));
  tab('rollouts');panel.scrollIntoView({block:'start'});
}
async function showReceiving(record){
  state.receiving=record;tab('handover');const panel=$('receiving-review');panel.replaceChildren(el('h3',record.value.label),badge(record.value.state));
  panel.append(detail('Original workspace',record.value.sourceWorkspace?.workspaceId),detail('Complete file',record.value.original?.sha256),
    detail('Inventory',fmt(record.value.summary)),detail('Inspected manifest',record.value.manifestSha256));
  if(record.value.state==='INSPECTED'||record.value.state==='ADOPTING')panel.append(button('Receive this inspected handover',()=>run('Receiving complete original workspace',async signal=>{
    const args={id:record.id,expectedRevision:record.value.adoptExpectedRevision??record.revision,manifestSha256:record.value.manifestSha256,
      ...(record.value.adoptRequestId?{requestId:record.value.adoptRequestId}:{})};
    const result=await action('adoptDelivery',args,'Receive inspected handover',{signal});await refresh();await showReceiving(result);notice('Complete original handover received.');
  }),'primary'));
}
async function showResult(record){
  if(record.kind==='gatewayCommissioning')return gatewayCommissioning.open(record.id);
  if(record.kind==='commissioning')return commissioning.open(record.id);
  if(record.kind==='rollout')return showRollout(record);
  if(record.kind==='capture'){tab('portfolio');return loadCapture(record.id);}
  if(record.kind==='receiving')return showReceiving(record);
  if(record.kind==='cohort'){state.cohort=record;tab('cohorts');
    const panel=$('cohort-details');panel.className='panel';panel.replaceChildren(el('h3',record.value.label),
      detail('Original capture',record.value.capture.id+' · revision '+record.value.capture.revision),
      detail('Review note',record.value.note),el('pre',record.value.apis.map(item=>item.apiId+' · '+item.kind+' · '+item.sha256).join('\n')));
    panel.append(button('Prepare migration',()=>{const form=$('rollout-form');field(form,'operation').value='migrate';field(form,'cohortId').value=record.id;
      field(form,'connectionId').value=record.value.connectionId;field(form,'label').value=record.value.label+' migration';updateOperation();tab('rollouts');}));
    const target=state.workspace.connections.find(item=>item.id===record.value.connectionId);
    if(target?.connection.kind==='dashboard'&&record.value.apis.every(item=>item.kind==='classic'))
      panel.append(button('Commission complete cohort',()=>{const form=$('commissioning-form');form.elements.cohortId.value=record.id;
        form.elements.label.value=record.value.label.slice(0,280)+' commissioning';tab('commissioning');form.scrollIntoView({block:'start'});}));
    return;}
  if(record.kind==='delivery'){tab('handover');notice(record.value.state==='EXPORTED'?
    'Complete delivery ready: '+bytes(record.value.file.bytes)+' · '+record.value.file.sha256:'Original export preparation is retained.');return;}
}
$('export-form').addEventListener('submit',event=>{event.preventDefault();run('Exporting complete saved history and original source',async signal=>{
  const record=await action('exportWorkspace',{label:formValue(event.currentTarget,'label')},'Export complete workspace',{signal});
  await refresh();await showResult(record);
});});
$('delivery-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;run('Inspecting complete original handover',async signal=>{
  const result=await http('/api/delivery/inspect',{method:'POST',body:file,signal,
    headers:{'content-type':'application/octet-stream','x-request-id':uuid(),'x-delivery-name':encodeURIComponent(file.name)}});
  await refresh();await showReceiving(result);event.target.value='';notice('Complete handover inspected. Review its inventory before receiving.');
});});
$('refresh').addEventListener('click',()=>run('Refreshing original workspace',async()=>{await refresh();notice('Workspace refreshed.');}));
const commissioning=createCommissioningBrowser({$,el,button,detail,table,read,action,run,refresh,notice,tab,showRollout,state});
const gatewayCommissioning=createGatewayCommissioningBrowser({$,el,button,detail,table,read,action,run,refresh,notice,tab,showRollout,state});
updateOperation();
await run('Opening original workspace',async()=>{await refresh();notice('Workspace ready.');});
