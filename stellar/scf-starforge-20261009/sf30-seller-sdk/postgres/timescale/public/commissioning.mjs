// MIT. Industrial commissioning desk on the original Timescale listener.
import { timescaleHost } from '/timescale/app.mjs';
const root=document.createElement('section');root.id='timescale-commissioning';root.className='panel tc-desk';
const state={workspace:null,detail:null,context:null,edition:null,comparison:null,pending:null,pendingState:null,lastOperation:null,
  offset:0,contextOffset:0,comparisonOffset:0,reportOffset:0,busy:false,polling:false,db:null,key:null};
const el=(tag,text='',props={})=>{const value=document.createElement(tag);value.textContent=text;for(const[k,v]of Object.entries(props))value.setAttribute(k,v);return value;};
function group(title,parent=root,collapsible=false){const value=el(collapsible?'details':'section');value.append(el(collapsible?'summary':'h3',title));parent.append(value);return value;}
function field(parent,label,{tag='input',...attributes}={}){const wrap=el('label',label),input=el(tag,'',attributes);input.dataset.draftField=label;wrap.append(input);parent.append(wrap);return input;}
function button(parent,label,fn,attributes={}){const value=el('button',label,{type:'button',...attributes});value.onclick=()=>act(fn);parent.append(value);return value;}
function link(parent,label,path){const value=el('a',label,{href:path});parent.append(value);return value;}
function form(parent,title,fn){
  const box=group(title,parent),value=el('form');value.dataset.formTitle=title;box.append(value);
  value.onsubmit=event=>{event.preventDefault();act(async()=>{
    state.submitting=beginSubmission(value);
    try{await persistDrafts();await fn(event);}finally{state.submitting=null;}
  });};return value;
}
function submit(parent,label){parent.append(el('button',label,{type:'submit','data-mutation':'true'}));}
function options(control,rows,label,value,blank='Select…'){const old=control.value;control.replaceChildren(el('option',blank,{value:''}));for(const row of rows)control.append(el('option',label(row),{value:String(value(row))}));if([...control.options].some(x=>x.value===old))control.value=old;}
function table(columns,rows){const result=el('table'),head=el('tr'),body=el('tbody');for(const column of columns)head.append(el('th',column));const thead=el('thead');thead.append(head);result.append(thead,body);
  for(const row of rows){const tr=el('tr');for(const cell of row)tr.append(el('td',cell===null?'NULL':String(cell??'')));body.append(tr);}return result;}
function showError(error){notice.textContent=error?.message??String(error);}
async function api(path,input){
  const workspace=state.key,headers={...(workspace?{'x-timescale-workspace':workspace}:{}),...(input===undefined?{}:{'content-type':'application/json'})};
  const response=await fetch('/api/timescale/'+path,{cache:'no-store',headers,...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
  let value;try{value=await response.json();}catch{throw new Error('The original request did not return readable JSON. Inspect its saved identity.');}
  if(!response.ok)throw Object.assign(new Error(value.message??value.error??'The original operation did not return.'),{code:value.error,status:response.status});
  if(workspace&&value.workspaceId&&value.workspaceId!==workspace)throw new Error('The response belongs to another workspace. Keep the original request and reopen its workspace.');
  return value;
}
const desk=(path,input)=>api('commissioning/'+path,input);
const url=(path,args={})=>'/api/timescale/commissioning/'+path+'?'+new URLSearchParams({...args,workspace:state.key});
async function originalText(file){
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}
  catch{throw new Error('The complete original source must be valid UTF-8. Export the native JSON in UTF-8 without replacing characters.');}
}
async function localStore(value){
  if(!state.db||!state.key)throw new Error('This browser cannot retain the original request. Enable site storage or use the original command line.');
  return new Promise((resolve,reject)=>{const tx=state.db.transaction('requests','readwrite');tx.objectStore('requests').put(value,state.key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The original request was not retained.'));});
}
async function persist(overrides={}){
  await localStore({pending:state.pending,lastOperation:state.lastOperation,selectedId:state.detail?.item.id??null,actor:actor.value,note:note.value,...overrides});
}
async function clearOriginalPending(saved){
  const id=saved.input.requestId,workspace=state.key;
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction('requests','readwrite'),store=tx.objectStore('requests'),request=store.get(workspace);let cleared=false;
    request.onsuccess=()=>{
      const current=request.result;
      if(current?.pending?.input.requestId!==id)return;
      store.put({...current,pending:null,lastOperation:id},workspace);cleared=true;
    };
    tx.oncomplete=()=>resolve(cleared);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The completed original request pointer was not saved.'));
  });
}
async function openStorage(){
  state.db=await new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-timescale-commissioning',1);request.onupgradeneeded=()=>request.result.createObjectStore('requests');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return new Promise((resolve,reject)=>{const tx=state.db.transaction('requests'),request=tx.objectStore('requests').get(state.key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
function controls(){
  for(const control of root.querySelectorAll('input,select,textarea'))control.disabled=state.busy;
  const pending=Boolean(state.pending),active=Boolean(state.workspace?.active),closed=state.detail?.item.status==='HANDED_OVER';
  for(const button of root.querySelectorAll('[data-mutation]'))button.disabled=state.busy||pending||active||!state.db;
  for(const button of project.querySelectorAll('[data-edit]'))button.disabled=state.busy||pending||active||closed||!state.db;
  retry.disabled=state.busy||!pending||active;
  release.disabled=state.busy||!pending||!['FAILED','INTERRUPTED','NOT_FOUND'].includes(state.pendingState)||active;
  selectionSave.disabled=state.busy||pending||active||!state.detail?.item.source||timescaleHost.hasPending();
  reopen.disabled=state.busy||pending||active||!closed;
  reportPublish.disabled=state.busy||pending||active||!state.detail;
}
async function act(fn){if(state.busy)return;state.busy=true;controls();try{await fn();}catch(error){showError(error);}finally{state.busy=false;controls();}}
function changeFields(action,extra){
  const submitted=state.submitting,operator=submitted?.actor??actor.value,purpose=submitted?.note??note.value;
  if(!operator.trim()||!purpose.trim())throw new Error('Name the operator and purpose of this change.');
  const value={action,actor:operator,note:purpose,...extra};
  if(action!=='create'){
    const id=submitted?.projectId??state.detail?.item.id,revision=submitted?.revision??state.detail?.item.revision;
    if(!id)throw new Error('Open a commissioning project.');
    value.commissioningId=id;value.expectedRevision=revision;
  }
  return value;
}
async function send(path,input){
  if(state.pending)throw new Error('Continue or reconcile the saved original request first.');
  if(timescaleHost.hasPending())throw new Error('The original Timescale workspace has an active or saved request. Open its operator controls to finish it.');
  const selectedId=state.detail?.item.id??null,selection=state.selectionGeneration,workspaceId=state.key,submitted=state.submitting;
  const original=copy(input),snapshot=await readWorkspace();
  if(workspaceId!==state.key||selectedId!==(state.detail?.item.id??null)||selection!==state.selectionGeneration)
    throw new Error('The selected project changed while this command was being prepared. Its original form remains retained.');
  if(submitted&&(submitted.workspaceId!==state.key||submitted.selection!==selection||submitted.projectId!==selectedId))
    throw new Error('Reopen the original form context before sending this command.');
  state.workspace=snapshot;
  const saved={path,workspaceId,projectId:original.commissioningId??selectedId,selectedId,selection,
    ...(submitted?.scope?{draft:{scope:submitted.scope,id:submitted.draftId}}:{}),
    input:{requestId:crypto.randomUUID(),expectedVersion:snapshot.version,...original}};
  // The complete file body and original UUID are durable before the first POST.
  await retainRequest(saved);state.pending=saved;state.pendingState=null;await persist();await continueRequest();
}
async function command(action,input){return send('commissioning/command',changeFields(action,input));}
async function inspectPending(){
  const saved=state.pending;if(!saved)return null;
  const id=saved.input.requestId,workspace=state.key,selectedId=state.detail?.item.id??null,selection=state.selectionGeneration;
  const epoch=state.requestReads[id]=(state.requestReads[id]??0)+1;
  let row;
  try{row=await api('operation?id='+encodeURIComponent(id));}
  catch(error){
    if(state.key!==workspace||state.pending?.input.requestId!==id)return null;
    const retained=await browserRead(requestStorageKey(id));
    if(retained?.state==='COMPLETE'&&retained.record){
      row=retained.record;
      notice.textContent='The completed original result is retained. Its latest status read did not finish: '+error.message;
    }else{
      if(state.requestReads[id]!==epoch)return null;
      if(error.code==='TIMESCALE_OPERATION_NOT_FOUND'){
        const record=await retainRequest(saved,'NOT_FOUND');
        if(record.state==='COMPLETE'&&record.record)row=record.record;
        else{state.pendingState='NOT_FOUND';return null;}
      }else throw error;
    }
  }
  if(row.id!==id)throw new Error('The returned operation identity differs from the retained original request.');
  if(state.key!==workspace)return row;
  // Completion is monotonic even when an earlier status response arrives last.
  if(row.state!=='COMPLETE'&&(state.pending?.input.requestId!==id||state.requestReads[id]!==epoch))return row;
  const retained=await retainRequest(saved,row.state,row);
  if(retained.state==='COMPLETE'&&retained.record)row=retained.record;
  if(state.key!==workspace||state.pending?.input.requestId!==id)return row;
  if(row.state!=='COMPLETE'&&state.requestReads[id]!==epoch)return row;
  state.pendingState=row.state;state.lastOperation=id;operationView.textContent=JSON.stringify(row,null,2);
  if(row.state==='COMPLETE'){
    consumeSubmittedDraft(saved);await persistDrafts();
    // Keep the in-memory original pending until its completed pointer is durable.
    await clearOriginalPending(saved);
    if(state.pending?.input.requestId!==id)return row;
    state.pending=null;state.pendingState=null;
    const result=row.data?.result,target=result?.commissioningId??selectedId;
    notice.textContent='Original request complete. Its full input and outcome remain in the workspace and request history.';
    if(target&&selectedId===(saved.selectedId??null)&&currentProjectOrEmpty(selectedId,selection)){
      try{await openProject(target,false);await persist();}
      catch(error){notice.textContent='Original request complete. Reopening the selected project did not finish: '+error.message;}
    }
    if(result?.schema==='stellar-forge.timescale-commissioning-report-export.v1'&&result.commissioningId===state.detail?.item.id)
      renderReportLinks(id,result);
  }
  return row;
}
async function continueRequest(){
  const saved=state.pending;if(!saved)return;
  if(saved.workspaceId&&saved.workspaceId!==state.key)throw new Error('This original request belongs to another workspace.');
  const row=await inspectPending();
  if(state.pending?.input.requestId!==saved.input.requestId)return;
  if(row&&['RUNNING','DISPATCHING','OUTCOME_UNKNOWN'].includes(row.state)){
    notice.textContent='Original request '+row.state+'. Keep this identity and inspect its native outcome.';return;
  }
  const workspace=await readWorkspace();
  if(state.pending?.input.requestId!==saved.input.requestId)return;
  state.workspace=workspace;saved.input.expectedVersion=workspace.version;
  await retainRequest(saved,state.pendingState??'PREPARED');await persist();
  try{
    const response=await api(saved.path,saved.input);
    if(response.id!==saved.input.requestId)throw new Error('The original command returned a different request identity.');
    if(state.pending?.input.requestId===saved.input.requestId){state.lastOperation=response.id;await persist();}
  }catch(error){
    if(state.pending?.input.requestId!==saved.input.requestId)return;
    const recovered=await inspectPending().catch(()=>null);
    if(recovered?.state==='COMPLETE'||state.pending?.input.requestId!==saved.input.requestId)return;
    throw error;
  }
  await refresh();
}
const title=el('div','',{class:'tc-heading'});title.append(el('h2','Commissioning and handover'));root.append(title);
button(title,'Refresh',()=>refresh({project:true}));
const notice=el('p','',{role:'status','aria-live':'polite'});root.append(notice);
const metadata=el('div','',{class:'tc-grid'});root.append(metadata);
const actor=field(metadata,'Operator',{required:'',maxlength:'128'}),note=field(metadata,'Purpose of change',{required:'',maxlength:'2000'});
const listBox=group('Projects'),query=field(listBox,'Find a project',{type:'search'}),projectList=el('div','',{class:'tc-scroll'});listBox.append(projectList);
const listNav=el('nav');listBox.append(listNav);
const previous=button(listNav,'Previous',async()=>{state.offset=Math.max(0,state.offset-25);await refreshList();}),listCount=el('span');listNav.append(listCount);
const next=button(listNav,'Next',async()=>{state.offset+=25;await refreshList();});
const create=form(root,'Start from the complete intake',async()=>{
  const owner=newOwner.value,title=newTitle.value,file=await originalFileFor(create,intakeUpload);
  if(file.size>1048576)throw new Error('The original intake exceeds 1 MiB.');
  await command('create',{intake:{filename:file.name,content:await originalText(file)},owner,...(title?{title}:{})});
});
create.append(el('p','The intake defines every source-contract field and acceptance criterion. Actual deployment values can be completed in the project.'));
const intakeUpload=field(create,'Original intake JSON',{type:'file',accept:'.json,application/json',required:''}),
  newTitle=field(create,'Project title, optional',{maxlength:'128'}),newOwner=field(create,'Technical owner',{required:'',maxlength:'128'});submit(create,'Create commissioning project');
const project=group('Selected project');project.hidden=true;
const projectSummary=el('p'),projectLinks=el('nav');project.append(projectSummary,projectLinks);
const edit=form(project,'Source contract',async()=>{
  const contract=Object.create(null);
  for(const row of contractFields.querySelectorAll('[data-field]')){
    let value;try{value=JSON.parse(row.querySelector('[name=value]').value);}catch{throw new Error('Enter valid JSON for '+row.dataset.field+'. Strings use quotation marks.');}
    contract[row.dataset.field]={value,disposition:row.querySelector('[name=disposition]').value,reason:row.querySelector('[name=reason]').value};
  }
  await command('edit',{title:editTitle.value,owner:editOwner.value,contract});
});
const editTitle=field(edit,'Title',{required:'',maxlength:'128'}),editOwner=field(edit,'Technical owner',{required:'',maxlength:'128'}),contractFields=el('div');edit.append(contractFields);
edit.append(el('p','Values retain their JSON types. A source change starts a new contract revision and resets the current acceptance decisions; earlier decisions remain in history.'));
submit(edit,'Save complete source contract');
const native=group('Native source and publication',project,true),catalogNav=el('nav');native.append(catalogNav);
button(catalogNav,'Previous source choices',async()=>{state.contextOffset=Math.max(0,state.contextOffset-25);await loadContext();});
const catalogCount=el('span');catalogNav.append(catalogCount);
button(catalogNav,'Next source choices',async()=>{state.contextOffset+=25;await loadContext();});
const editionSelect=field(native,'Retained edition',{tag:'select'});button(native,'Open complete edition',()=>openEdition());
const editionSummary=el('p');native.append(editionSummary);
const selection=form(native,'Map the native aggregate',async()=>command('bind-source',{selection:selectionInput()}));
const aggregate=field(selection,'Continuous aggregate',{tag:'select',required:''}),timeColumn=field(selection,'Time column',{tag:'select',required:''}),
  timeType=field(selection,'Native time type',{tag:'select',required:''}),start=field(selection,'Window start',{required:''}),
  end=field(selection,'Window end, exclusive',{required:''}),timezone=field(selection,'Timezone',{required:'',value:'UTC'});
for(const name of ['timestamp with time zone','timestamp without time zone','date','smallint','integer','bigint'])timeType.append(el('option',name,{value:name}));
const columns=el('fieldset');columns.append(el('legend','Published native columns'));selection.append(columns);submit(selection,'Bind this source contract');
const boundSource=el('pre');native.append(boundSource);
const selectionSave=button(native,'Save bound aggregate for publisher',()=>send('select',{selection:structuredClone(state.detail.item.source.selection)}),{'data-mutation':'true'});
const uploads=form(project,'Retain a complete native table',async()=>{
  const table=tableName.value||null,role=sourceRole.value,title=sourceTitle.value,file=await originalFileFor(uploads,sourceUpload);
  if(file.size>6291456)throw new Error('The original source exceeds 6 MiB. Use the complete agreed window in the native export.');
  await command('import-table',{source:{filename:file.name,content:await originalText(file),tableName:table},role,title});
});
const sourceUpload=field(uploads,'Original native JSON',{type:'file',accept:'.json,application/json',required:''}),
  sourceRole=field(uploads,'Source role',{tag:'select',required:''}),sourceTitle=field(uploads,'Source title',{required:'',maxlength:'128'}),
  tableName=field(uploads,'Native table within tables, blank for one table',{maxlength:'256'});
sourceRole.append(el('option','Baseline',{value:'BASELINE'}),el('option','Observed',{value:'OBSERVED'}));
uploads.append(el('p','Use columns and rows from the native JSON export. Values remain exact strings or JSON null, including repeated rows and original timestamps. Select a named table when importing a complete Timescale edition.'));submit(uploads,'Retain original source file');
const sources=el('div','',{class:'tc-scroll'});project.append(sources);
const compare=form(project,'Compare complete source tables',async()=>command('compare',{expectedSourceId:expectedSource.value,observedSourceId:observedSource.value,title:compareTitle.value,mapping:mappingInput()}));
const expectedSource=field(compare,'Baseline',{tag:'select',required:''}),observedSource=field(compare,'Observed',{tag:'select',required:''}),
  compareTitle=field(compare,'Comparison title',{required:'',maxlength:'128'});
button(compare,'Build field mapping',()=>renderMapping());
const mapping=el('div'),ignoredObserved=el('div');compare.append(mapping,ignoredObserved);
compare.append(el('p','Map every column or give an explicit omission reason. Key fields group differences. All source rows and duplicate counts take part in the comparison.'));submit(compare,'Compare all retained rows');
const comparisons=group('Retained comparisons',project),comparisonList=el('div','',{class:'tc-scroll'}),comparisonView=el('div','',{class:'tc-scroll'});comparisons.append(comparisonList,comparisonView);
const comparisonNav=el('nav');comparisons.append(comparisonNav);button(comparisonNav,'Previous differences',async()=>{state.comparisonOffset=Math.max(0,state.comparisonOffset-25);await openComparison();});
const comparisonCount=el('span');comparisonNav.append(comparisonCount);
button(comparisonNav,'Next differences',async()=>{state.comparisonOffset+=25;await openComparison();});
const observe=form(project,'Record an original native outcome',async()=>{
  if(!state.observedOperation||state.observedOperation.operation.id!==operationSelect.value)throw new Error('Open the selected original native operation.');
  await command('observe',{operationId:state.observedOperation.operation.id,operationDigest:state.observedOperation.digest,relevance:relevance.value});
});
const operationKind=field(observe,'Native operation kind',{tag:'select'});operationKind.append(el('option','All',{value:''}));
for(const kind of ['capture','review','prepare-refresh','refresh','verification','prepare-job','job-change','select-aggregate','extraction','remediation'])operationKind.append(el('option',kind,{value:kind}));
const operationSelect=field(observe,'Original operation',{tag:'select',required:''});button(observe,'Open native outcome',async()=>{
  await openObservedById(operationSelect.value);
});
const relevance=field(observe,'What this outcome establishes',{tag:'textarea',required:'',rows:'3',maxlength:'8000'}),nativeOutcome=el('pre');observe.append(nativeOutcome);submit(observe,'Retain original outcome in project');
const observations=el('div','',{class:'tc-scroll'});project.append(observations);
const acceptance=group('Acceptance decisions',project),criteria=el('div');acceptance.append(criteria);
const decision=form(acceptance,'Record a criterion assessment',async()=>command('decide',{
  criterionId:criterion.value,decision:decisionValue.value,assessment:assessment.value,owner:decisionOwner.value,
  references:[...references.querySelectorAll('input:checked')].map(x=>JSON.parse(x.value))
}));
const criterion=field(decision,'Original criterion',{tag:'select',required:''}),condition=el('p');decision.append(condition);
const decisionValue=field(decision,'Decision',{tag:'select',required:''});for(const name of ['NOT_RUN','PASS','FAIL','DEFERRED','NOT_APPLICABLE'])decisionValue.append(el('option',name.replaceAll('_',' '),{value:name}));
const decisionOwner=field(decision,'Acceptance owner',{required:'',maxlength:'128'}),assessment=field(decision,'Actual result and assessment',{tag:'textarea',required:'',rows:'4',maxlength:'8000'}),
  references=el('fieldset');references.append(el('legend','Current contract sources and outcomes'));decision.append(references);submit(decision,'Save assessment');
const handover=form(project,'Technical handover',async()=>command('complete',{disposition:disposition.value,statement:statement.value,followUpOwner:followUp.value}));
const disposition=field(handover,'Handover disposition',{tag:'select',required:''});disposition.append(el('option','Accepted',{value:'ACCEPTED'}),el('option','With open items',{value:'WITH_OPEN_ITEMS'}));
const statement=field(handover,'Handover statement',{tag:'textarea',rows:'4',required:'',maxlength:'8000'}),followUp=field(handover,'Follow-up owner, required with open items',{maxlength:'128'});
submit(handover,'Record technical handover');
const handoverView=el('pre');project.append(handoverView);
const reopen=button(project,'Reopen retained project',()=>command('reopen',{}),{'data-mutation':'true'});
const reports=group('Reports and complete project export',project),reportLinks=el('nav');reports.append(reportLinks);
const reportPublish=button(reports,'Publish complete JSON and printable report',()=>send('commissioning/publish-report',{
  commissioningId:state.detail.item.id,expectedRevision:state.detail.item.revision,expectedDigest:state.detail.digest
}),{'data-mutation':'true'});
const publishedReports=el('div','',{class:'tc-scroll'});reports.append(publishedReports);
const reportsNav=el('nav');reports.append(reportsNav);
button(reportsNav,'Previous reports',async()=>{state.reportOffset=Math.max(0,state.reportOffset-25);await loadReports();});
const reportsCount=el('span');reportsNav.append(reportsCount);
button(reportsNav,'Next reports',async()=>{state.reportOffset+=25;await loadReports();});
const exportForm=form(reports,'Portable project',async()=>send('export',{outputDirectory:exportDirectory.value}));
const exportDirectory=field(exportForm,'New private package directory',{required:''});submit(exportForm,'Export complete original workspace');
reports.append(el('p','The complete portable project includes the original workspace, source files, decisions, reports and native outcomes. Reopen it with the existing Timescale receive command.'));
const history=group('Original revision history',project),historyView=el('div','',{class:'tc-scroll'});history.append(historyView);
const recovery=group('Original request and recovery'),recoveryText=el('p');recovery.append(recoveryText);
const retry=button(recovery,'Continue original saved request',()=>continueRequest()),release=button(recovery,'Close failed or unstarted request',async()=>{
  const row=await inspectPending();if(!state.pending)return;
  if(row&&!['FAILED','INTERRUPTED'].includes(row.state))throw new Error('The original operation still has a retained outcome to reconcile.');
  if(!row&&state.pendingState!=='NOT_FOUND')throw new Error('Inspect the original request first.');
  const saved=state.pending;await retainRequest(saved,row?.state??'NOT_FOUND',row);
  await clearOriginalPending(saved);if(state.pending?.input.requestId===saved.input.requestId){state.pending=null;state.pendingState=null;}
  notice.textContent='The complete prior request and source file remain in history. Edited work can now receive its own request identity.';await refresh();
});
const operationView=el('pre');recovery.append(operationView);
document.getElementById('timescale-workspace').after(root);


// Complete browser drafts use the original workspace and project identities.
// IndexedDB retains File objects with their complete original bytes.
const draftPanel=group('Retained forms and original files',root,true),draftView=el('div');draftPanel.append(draftView);
const archivedRequests=group('Retained original requests',recovery,true),archiveView=el('div');archivedRequests.append(archiveView);
const formScopes=new WeakMap(),formBaselines=new WeakMap();
const formActions={
  'Start from the complete intake':'create','Source contract':'edit','Map the native aggregate':'bind-source',
  'Retain a complete native table':'import-table','Compare complete source tables':'compare',
  'Record an original native outcome':'observe','Record a criterion assessment':'decide',
  'Technical handover':'complete','Portable project':'export'
};
Object.assign(state,{drafts:{},draftArchive:{},selections:{},requestArchive:[],restoring:false,submitting:null,
  reads:{project:0,list:0,context:0,edition:0,observation:0,comparison:0,reports:0},requestReads:{},requestWrites:{},selectionGeneration:0});
const copy=value=>structuredClone(value);
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function sameValue(a,b){return canonical(a)===canonical(b);}
function assertWorkspace(value){
  if(!value||typeof value.id!=='string'||state.key&&value.id!==state.key)
    throw Object.assign(new Error('This listener now serves another workspace. Reopen the original workspace to continue its retained source and requests.'),{code:'TIMESCALE_BROWSER_WORKSPACE_CHANGED'});
  return value;
}
async function readWorkspace(){return assertWorkspace(await api('status?limit=1&offset=0'));}
function token(kind){return {kind,epoch:++state.reads[kind],workspace:state.key,project:state.detail?.item.id??null,selection:state.selectionGeneration};}
function currentToken(value,{project=true}={}){return value.workspace===state.key&&value.epoch===state.reads[value.kind]&&(!project||value.project===(state.detail?.item.id??null)&&value.selection===state.selectionGeneration);}
function currentProject(id,selection){return state.detail?.item.id===id&&state.selectionGeneration===selection;}
function currentProjectOrEmpty(id,selection){return (state.detail?.item.id??null)===id&&state.selectionGeneration===selection;}
function formAction(form){return formActions[form.dataset.formTitle]??null;}
function controlKey(control){
  const parts=[],form=control.form;
  for(let parent=control.parentElement;parent&&parent!==form;parent=parent.parentElement)
    for(const key of ['field','expected','observed'])if(parent.dataset[key]!==undefined)parts.unshift([key,parent.dataset[key]]);
  parts.push(['control',control.name||control.dataset.draftField||control.id||String([...form.elements].indexOf(control))]);
  if(['checkbox','radio'].includes(control.type))parts.push(['value',control.value]);
  return JSON.stringify(parts);
}
function formFields(form){
  return Object.fromEntries([...form.elements].filter(control=>['INPUT','TEXTAREA','SELECT'].includes(control.tagName)&&control.type!=='file')
    .map(control=>[controlKey(control),['checkbox','radio'].includes(control.type)?control.checked:control.value]));
}
function selectedFiles(form,previous={}){
  const files={};
  for(const control of form.elements)if(control.type==='file'){
    const key=controlKey(control),file=control.files?.[0]||previous[key];
    if(file instanceof Blob)files[key]=file;
  }
  return files;
}
function sameFiles(a,b){
  const aa=Object.entries(a??{}),bb=Object.entries(b??{});
  return aa.length===bb.length&&aa.every(([key,file])=>b?.[key]===file);
}
function applyFields(form,values){
  for(const control of form.elements){
    if(!['INPUT','TEXTAREA','SELECT'].includes(control.tagName)||control.type==='file')continue;
    const key=controlKey(control);if(!Object.hasOwn(values,key))continue;
    if(['checkbox','radio'].includes(control.type))control.checked=Boolean(values[key]);
    else{
      if(control.tagName==='SELECT'&&values[key]!==''&&![...control.options].some(option=>option.value===String(values[key])))
        control.append(el('option','Retained choice · '+String(values[key]),{value:String(values[key])}));
      control.value=String(values[key]);
    }
  }
}
function scopeFor(form){
  const action=formAction(form);if(!action)return null;
  if(['create','export'].includes(action))return 'workspace/'+action;
  if(!state.detail||action==='decide'&&!criterion.value)return null;
  return state.detail.item.id+'/'+action+(action==='decide'?'/'+criterion.value:'');
}
function formContext(form){
  const action=formAction(form),item=state.detail?.item;
  if(['create','export'].includes(action))return {workspace:state.key};
  if(!item)return null;
  const value={projectId:item.id,status:item.status,contractRevision:item.contractRevision};
  if(action==='edit')return {...value,title:item.title,owner:item.owner,contract:item.contract};
  if(['bind-source','observe'].includes(action))return {...value,source:item.source};
  if(action==='decide')return {...value,criterion:item.acceptance.find(row=>row.id===criterion.value)??null};
  if(action==='complete')return {...value,contract:item.contract,acceptance:item.acceptance,handover:item.handover};
  return value;
}
function sourcePin(){return state.edition?{id:state.edition.value.id,digest:state.edition.record.digest}:null;}
function observationPin(){return state.observedOperation?{id:state.observedOperation.operation.id,digest:state.observedOperation.digest}:null;}
function activeDraft(form){const scope=formScopes.get(form)??scopeFor(form);return scope?state.drafts[scope]??null:null;}
function archiveDraft(value){
  if(value&&!state.draftArchive[value.id])state.draftArchive[value.id]=copy(value);
}
function captureForm(form,{force=false}={}){
  if(state.restoring)return activeDraft(form);
  const scope=formScopes.get(form)??scopeFor(form);if(!scope)return null;
  const prior=state.drafts[scope],fields=formFields(form),files=selectedFiles(form,prior?.files),baseline=formBaselines.get(form);
  if(!force&&!prior&&baseline&&sameValue(fields,baseline.fields)&&!Object.keys(files).length)return null;
  const changed=!prior||!sameValue(prior.fields,fields)||!sameFiles(prior.files,files);
  const value={...(prior??{}),id:changed?crypto.randomUUID():prior.id,scope,action:formAction(form),title:form.dataset.formTitle,
    projectId:['create','export'].includes(formAction(form))?null:prior?.projectId??baseline?.context?.projectId??state.detail?.item.id??null,
    revision:prior?.revision??state.detail?.item.revision??null,
    context:copy(prior?.context??baseline?.context??formContext(form)),fields,files,
    source:formAction(form)==='bind-source'?sourcePin():null,observation:formAction(form)==='observe'?observationPin():null,updatedAt:changed?new Date().toISOString():prior.updatedAt};
  state.drafts[scope]=value;return value;
}
function captureAll(){if(!state.restoring)for(const form of root.querySelectorAll('form[data-form-title]'))captureForm(form);}
function archiveForm(form){const value=activeDraft(form);if(value){archiveDraft(value);delete state.drafts[value.scope];}}
function fileNotices(form){
  const draft=activeDraft(form);
  for(const control of form.elements)if(control.type==='file'){
    const key=controlKey(control),file=control.files?.[0]||draft?.files?.[key];
    let label=control.parentElement.querySelector('[data-retained-file]');
    if(!label){label=el('small','',{'data-retained-file':'true'});control.after(label);}
    control.required=!file;
    label.textContent=file?'Retained original file: '+file.name+' · '+file.size+' bytes. Selecting another file replaces this form selection.':'Choose the complete original file.';
  }
}
function restoreForm(form){
  const scope=scopeFor(form);formScopes.set(form,scope);
  const context=copy(formContext(form));formBaselines.set(form,{context,fields:formFields(form)});
  const draft=scope?state.drafts[scope]:null;
  if(draft){
    if(sameValue(draft.context,context))draft.revision=draft.projectId?state.detail.item.revision:null;
    applyFields(form,draft.fields);
    if(form===selection&&state.edition){renderAggregate(false);applyFields(form,draft.fields);}
    if(form===compare&&currentSources('BASELINE').some(x=>x.id===expectedSource.value)&&currentSources('OBSERVED').some(x=>x.id===observedSource.value)){
      renderMapping(false);applyFields(form,draft.fields);
    }
  }
  fileNotices(form);
}
async function browserRead(key){
  if(!state.db)throw new Error('Open the original browser workspace store.');
  return new Promise((resolve,reject)=>{const request=state.db.transaction('requests').objectStore('requests').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function browserWrite(rows){
  if(!state.db||!state.key)throw new Error('The original browser recovery store is unavailable.');
  return new Promise((resolve,reject)=>{const tx=state.db.transaction('requests','readwrite'),store=tx.objectStore('requests');
    for(const [key,value]of rows)store.put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The complete browser recovery was not saved.'));});
}
async function persistDrafts(){
  if(!state.db||!state.key)return;
  await browserWrite([['drafts:'+state.key,{schema:'stellar-forge.timescale-browser-forms.v1',workspaceId:state.key,drafts:state.drafts,archive:state.draftArchive,selections:state.selections}]]);
}
function selectionSnapshot(){
  return {editionId:editionSelect.value,source:sourcePin(),operationId:operationSelect.value,observation:observationPin(),
    aggregate:aggregate.value,criterion:criterion.value,contextOffset:state.contextOffset,reportOffset:state.reportOffset,comparison:state.comparison};
}
function retainSelection(){
  if(state.detail)state.selections[state.detail.item.id]=selectionSnapshot();
}
async function originalFileFor(form,control){
  const saved=state.submitting,context=saved?.form===form?saved:null;
  const file=context?.files?.[controlKey(control)]||control.files?.[0]||activeDraft(form)?.files?.[controlKey(control)];
  if(!(file instanceof Blob))throw new Error('Choose or restore the complete original source file.');
  return file;
}
function beginSubmission(form){
  const draft=captureForm(form,{force:true});
  if(draft?.projectId&&draft.projectId!==state.detail?.item.id)throw new Error('Open the original project for this retained form.');
  if(form===selection&&draft?.source&&!sameValue(draft.source,sourcePin()))throw new Error('Reopen the original retained edition for this aggregate form.');
  if(form===observe&&draft?.observation&&!sameValue(draft.observation,observationPin()))throw new Error('Reopen the original native operation for this outcome form.');
  if(draft?.projectId&&draft.revision!==state.detail.item.revision){
    renderDrafts();draftPanel.open=true;throw new Error('Inspect the retained form against the current saved revision before applying its original fields.');
  }
  if(draft)archiveDraft(draft);
  return {workspaceId:state.key,projectId:state.detail?.item.id??null,revision:state.detail?.item.revision??null,
    selection:state.selectionGeneration,scope:draft?.scope??null,draftId:draft?.id??null,files:copy(draft?.files??{}),actor:actor.value,note:note.value,form};
}
function consumeSubmittedDraft(saved){
  const scope=saved?.draft?.scope,id=saved?.draft?.id;
  if(scope&&id&&state.drafts[scope]?.id===id){
    archiveDraft(state.drafts[scope]);delete state.drafts[scope];
    const form=[...root.querySelectorAll('form[data-form-title]')].find(value=>formScopes.get(value)===scope);
    if(form){
      for(const control of form.elements)if(control.type==='file')control.value='';
      formBaselines.set(form,{context:copy(formContext(form)),fields:formFields(form)});fileNotices(form);
    }
  }
}
function downloadValue(filename,value,type='application/json'){
  const data=value instanceof Blob?value:new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type});
  const href=URL.createObjectURL(data),a=el('a','',{href,download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function exportDraft(draft){
  const files={};
  for(const [key,file]of Object.entries(draft.files??{})){
    const bytes=new Uint8Array(await file.arrayBuffer()),chunks=[];
    for(let at=0;at<bytes.length;at+=8192)chunks.push(String.fromCharCode(...bytes.subarray(at,at+8192)));
    files[key]={name:file.name,type:file.type,lastModified:file.lastModified,bytes:bytes.length,base64:btoa(chunks.join(''))};
  }
  downloadValue('commissioning-draft-'+draft.id+'.json',{schema:'stellar-forge.timescale-browser-draft.v1',workspaceId:state.key,draft:{...draft,files}});
}
async function reopenDraft(draft){
  if(draft.projectId&&draft.projectId!==state.detail?.item.id)await openProject(draft.projectId);
  const form=[...root.querySelectorAll('form[data-form-title]')].find(value=>formAction(value)===draft.action);
  if(!form)throw new Error('The original form is not available in this operator.');
  const projectId=state.detail?.item.id??null,selectionGeneration=state.selectionGeneration;
  captureForm(form);archiveForm(form);
  if(draft.action==='decide'){
    const id=draft.context?.criterion?.id;
    if(!state.detail?.item.acceptance.some(value=>value.id===id))throw new Error('The original criterion is absent from this selected project.');
    criterion.value=id;renderCriterion(false);
  }
  for(const control of form.elements)if(control.type==='file')control.value='';
  state.drafts[draft.scope]=copy(draft);
  if(draft.action==='bind-source'&&draft.source)await openEditionById(draft.source.id,draft.source.digest);
  if(draft.action==='observe'&&draft.observation)await openObservedById(draft.observation.id,draft.observation.digest);
  if(!currentProjectOrEmpty(projectId,selectionGeneration))throw new Error('The selected project changed before its original form could reopen.');
  restoreForm(form);retainSelection();await persistDrafts();await persist();renderDrafts();
  notice.textContent='The complete original form and files are reopened with their retained source context.';
}
function renderDrafts(){
  draftView.replaceChildren();
  const current=state.detail?.item,rows=[...Object.values(state.drafts),...Object.values(state.draftArchive).filter(value=>!Object.values(state.drafts).some(active=>active.id===value.id))];
  for(const draft of rows.filter(value=>!value.projectId||value.projectId===current?.id)){
    const box=el('section'),stale=draft.projectId&&draft.revision!==current?.revision;
    box.append(el('h4',draft.title),el('p','Draft '+draft.id+' · '+(draft.projectId?'original revision '+draft.revision:'workspace form')+(stale?' · current revision '+current?.revision:'')));
    const detail=el('details');detail.append(el('summary','Original form and source context'),el('pre',JSON.stringify({fields:draft.fields,context:draft.context,source:draft.source,observation:draft.observation},null,2)));box.append(detail);
    button(box,'Reopen complete form',()=>reopenDraft(draft));
    if(stale&&state.drafts[draft.scope]?.id===draft.id)button(box,'Use reviewed form with current revision',async()=>{
      const form=[...root.querySelectorAll('form[data-form-title]')].find(value=>formScopes.get(value)===draft.scope);
      if(!form||state.drafts[draft.scope]?.id!==draft.id)throw new Error('Open this original form and inspect its current saved edition first.');
      archiveDraft(draft);state.drafts[draft.scope]={...draft,id:crypto.randomUUID(),revision:state.detail.item.revision,context:copy(formContext(form)),updatedAt:new Date().toISOString()};
      await persistDrafts();renderDrafts();notice.textContent='This complete form now uses the deliberately selected current project revision.';
    });
    button(box,'Download complete form and files',()=>exportDraft(draft));
    for(const file of Object.values(draft.files??{}))button(box,'Download original '+file.name,()=>downloadValue(file.name,file,file.type));
    draftView.append(box);
  }
  if(!draftView.childElementCount)draftView.append(el('p','Edited forms and their original files are retained by workspace, project and criterion.'));
}
function requestStorageKey(id){return 'original-request:'+state.key+':'+id;}
function requestIndexKey(id){return 'original-request-index:'+state.key+':'+id;}
function stableRequest(saved){const input={...saved.input};delete input.expectedVersion;return {path:saved.path,input};}
async function retainRequest(saved,recordState='PREPARED',record=null){
  const id=saved.input.requestId,workspace=state.key,snapshot=copy(saved),observed=record?copy(record):null;
  const previousWrite=state.requestWrites[id]??Promise.resolve();
  const pending=previousWrite.catch(()=>{}).then(async()=>{
    if(workspace!==state.key||snapshot.workspaceId&&snapshot.workspaceId!==workspace)throw new Error('The original request belongs to another browser workspace.');
    const key=requestStorageKey(id),previous=await browserRead(key);
    if(previous&&!sameValue(stableRequest(previous.saved),stableRequest(snapshot)))throw new Error('This request UUID already retains different complete original input.');
    // A later missing/failed status read cannot replace a completed original result.
    const complete=previous?.state==='COMPLETE',currentState=complete?'COMPLETE':recordState;
    if(complete&&observed?.state==='COMPLETE'&&!sameValue(previous.record,observed))throw new Error('The completed original operation returned a different retained result.');
    const value={schema:'stellar-forge.timescale-browser-request.v1',workspaceId:workspace,saved:snapshot,state:currentState,
      record:complete?previous.record:observed??previous?.record??null,createdAt:previous?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};
    const index={id,state:currentState,path:snapshot.path,action:snapshot.input.action??snapshot.path,
      hasSource:typeof(snapshot.input.source??snapshot.input.intake)?.content==='string',
      projectId:snapshot.projectId??snapshot.input.commissioningId??null,createdAt:value.createdAt,updatedAt:value.updatedAt};
    await browserWrite([[key,value],[requestIndexKey(id),index]]);
    state.requestArchive=state.requestArchive.filter(row=>row.id!==id).concat(index);renderRequestArchive();return value;
  });
  state.requestWrites[id]=pending;return pending;
}
async function readRequestIndex(){
  const prefix='original-request-index:'+state.key+':';
  return new Promise((resolve,reject)=>{const request=state.db.transaction('requests').objectStore('requests').getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
function renderRequestArchive(){
  archiveView.replaceChildren();
  for(const row of state.requestArchive.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
    const box=el('section');box.append(el('h4',row.action),el('p',row.id+' · '+row.state+' · '+row.createdAt));
    button(box,'Download full original request',async()=>{const entry=await browserRead(requestStorageKey(row.id));if(!entry)throw new Error('The complete original request is unavailable.');downloadValue('timescale-request-'+row.id+'.json',entry);});
    if(row.hasSource)button(box,'Download original source file',async()=>{const entry=await browserRead(requestStorageKey(row.id)),file=entry?.saved.input.source??entry?.saved.input.intake;if(!file||typeof file.content!=='string')throw new Error('This original command has no source-file body.');downloadValue(file.filename,file.content,'application/json');});
    button(box,'Reopen original request',async()=>{
      if(state.pending)throw new Error('Finish or close the currently retained request first.');
      const entry=await browserRead(requestStorageKey(row.id));if(!entry||entry.workspaceId!==state.key)throw new Error('Choose an original request from this workspace.');
      state.pending=copy(entry.saved);state.pendingState=null;await persist();await inspectPending();controls();
    });
    archiveView.append(box);
  }
  if(!archiveView.childElementCount)archiveView.append(el('p','Every submitted or closed original request remains downloadable with its complete file body and outcome.'));
}
function clearEdition(){
  state.edition=null;++state.reads.edition;editionSummary.textContent='Open the selected complete edition before binding it.';
  aggregate.replaceChildren();timeColumn.replaceChildren();columns.replaceChildren(el('legend','Published native columns'));
}
function clearObservedOperation(){
  state.observedOperation=null;++state.reads.observation;nativeOutcome.textContent='Open the selected original native operation before retaining its outcome.';
}
function resetProjectContext(){
  clearEdition();clearObservedOperation();state.context=null;state.comparison=null;state.contextOffset=0;state.reportOffset=0;state.comparisonOffset=0;
  editionSelect.replaceChildren();operationSelect.replaceChildren();comparisonView.replaceChildren();mapping.replaceChildren();delete mapping.dataset.expected;delete mapping.dataset.observed;ignoredObserved.replaceChildren();boundSource.textContent='';reportLinks.replaceChildren();
  for(const form of project.querySelectorAll('form')){form.reset();formScopes.delete(form);formBaselines.delete(form);}
}
root.addEventListener('input',event=>{
  if(state.restoring||[criterion,expectedSource,observedSource,aggregate,operationKind,operationSelect].includes(event.target))return;
  const form=event.target.form;if(!form?.dataset.formTitle)return;
  captureForm(form);persistDrafts().then(()=>{fileNotices(form);renderDrafts();}).catch(showError);
});
root.addEventListener('change',event=>{
  if(state.restoring||[criterion,expectedSource,observedSource,aggregate,operationKind,operationSelect].includes(event.target))return;
  const form=event.target.form;if(!form?.dataset.formTitle)return;
  captureForm(form);persistDrafts().then(()=>{fileNotices(form);renderDrafts();}).catch(showError);
});

async function refreshList(){
  const guard=token('list'),offset=state.offset,q=query.value;
  const result=await desk('list?'+new URLSearchParams({offset,limit:25,q}));
  if(!currentToken(guard,{project:false})||offset!==state.offset||q!==query.value)return;
  const value=table(['Project','Owner','State','Criteria','Sources','Open'],result.items.rows.map(x=>[x.title,x.owner,x.status,x.passed+'/'+x.criteria,x.sources,'']));
  [...value.tBodies[0].rows].forEach((row,index)=>button(row.cells[5],'Open',()=>openProject(result.items.rows[index].id)));
  projectList.replaceChildren(value);listCount.textContent=(result.items.total?offset+1:0)+'–'+Math.min(offset+25,result.items.total)+' of '+result.items.total;
  previous.disabled=offset===0;next.disabled=result.items.next===null;
}
function currentSources(role){return state.detail.item.sources.filter(x=>x.contractRevision===state.detail.item.contractRevision&&(!role||x.role===role));}
function renderProject(){
  const item=state.detail.item;project.hidden=false;
  projectSummary.textContent=item.title+' · '+item.status.replaceAll('_',' ')+' · revision '+item.revision+' · source contract '+item.contractRevision;
  editTitle.value=item.title;editOwner.value=item.owner;
  projectLinks.replaceChildren();link(projectLinks,'Original intake',url('intake',{id:item.id,format:'original'}));
  contractFields.replaceChildren();
  for(const[name,value]of Object.entries(item.contract)){
    const box=el('fieldset');box.dataset.field=name;box.append(el('legend',name),el('p',value.description));
    const disposition=field(box,'Field status',{tag:'select',name:'disposition'});for(const label of ['PENDING','PROVIDED','NOT_APPLICABLE'])disposition.append(el('option',label.replaceAll('_',' '),{value:label}));disposition.value=value.disposition;
    const input=field(box,'Actual value (JSON)',{tag:'textarea',name:'value',rows:'2'});input.value=JSON.stringify(value.value,null,2);
    const reason=field(box,'Explanation',{tag:'textarea',name:'reason',rows:'2',maxlength:'4000'});reason.value=value.reason;contractFields.append(box);
  }
  boundSource.textContent=item.source?JSON.stringify(item.source.projection,null,2):'No native source is bound to this contract revision.';
  const sourceTable=table(['Role','Title','Original file','Rows','Contract','Download'],item.sources.map(x=>[x.role,x.title,x.filename,x.rows,x.contractRevision,'']));
  [...sourceTable.tBodies[0].rows].forEach((row,index)=>link(row.cells[5],'Complete original',url('source',{id:item.id,source:item.sources[index].id,format:'original'})));sources.replaceChildren(sourceTable);
  options(expectedSource,currentSources('BASELINE'),x=>x.title+' · '+x.rows+' rows',x=>x.id);
  options(observedSource,currentSources('OBSERVED'),x=>x.title+' · '+x.rows+' rows',x=>x.id);
  const comparisonTable=table(['Comparison','Result','Missing baseline rows','Added observed rows','Contract','Open'],item.comparisons.map(x=>[x.title,x.matches?'Match':'Differences',x.counts.expectedOnlyRows,x.counts.observedOnlyRows,x.contractRevision,'']));
  [...comparisonTable.tBodies[0].rows].forEach((row,index)=>button(row.cells[5],'Open',async()=>{state.comparison=item.comparisons[index].id;state.comparisonOffset=0;await openComparison();}));comparisonList.replaceChildren(comparisonTable);
  const observedTable=table(['Original operation','Kind','Recorded state','Relevance','Open'],item.observations.map(x=>[x.operationId,x.kind,x.state,x.relevance,'']));
  [...observedTable.tBodies[0].rows].forEach((row,index)=>button(row.cells[4],'Original controls',()=>timescaleHost.openOperation(item.observations[index].operationId)));observations.replaceChildren(observedTable);
  criteria.replaceChildren(table(['Criterion','Condition','Decision','Owner','Assessment'],item.acceptance.map(x=>[x.id+' · '+x.title,x.condition,x.decision,x.owner,x.assessment])));
  options(criterion,item.acceptance,x=>x.id+' · '+x.title,x=>x.id);renderCriterion(false);
  handoverView.textContent=item.handover?JSON.stringify(item.handover,null,2):'No technical handover has been recorded for the current project.';
  historyView.replaceChildren(table(['Revision','Action','Operator','Purpose','Saved'],state.detail.history.map(x=>[x.revision,x.action,x.actor,x.note,x.at])));
  for(const button of project.querySelectorAll('form button[type=submit]'))if(![exportForm].includes(button.form))button.setAttribute('data-edit','true');
  const restoring=state.restoring;state.restoring=true;
  try{for(const form of root.querySelectorAll('form[data-form-title]'))restoreForm(form);}finally{state.restoring=restoring;}
  renderDrafts();controls();
}
async function openProject(id,persistSelection=true){
  if(!id)throw new Error('Choose an original commissioning project.');
  captureAll();retainSelection();await persistDrafts();
  const guard=token('project'),detail=await desk('item?id='+encodeURIComponent(id));
  if(!currentToken(guard,{project:false}))return;
  if(detail.item?.id!==id)throw new Error('The selected project response has another identity.');
  // Preserve changes made while this read was in flight before replacing any DOM.
  captureAll();retainSelection();await persistDrafts();
  if(!currentToken(guard,{project:false}))return;
  const changed=state.detail?.item.id!==id,saved=copy(state.selections[id]??{});
  if(changed){++state.selectionGeneration;resetProjectContext();}
  state.detail=detail;
  if(changed){
    state.contextOffset=saved.contextOffset??0;state.reportOffset=saved.reportOffset??0;
    state.comparison=saved.comparison??null;state.comparisonOffset=saved.comparisonOffset??0;
  }
  renderProject();
  if(changed&&saved.criterion&&detail.item.acceptance.some(value=>value.id===saved.criterion)){
    criterion.value=saved.criterion;renderCriterion(false);
  }
  await loadContext();
  if(!currentToken(guard,{project:false})||state.detail?.item.id!==id)return;
  if(changed){
    if(saved.editionId)setRetainedOption(editionSelect,saved.editionId);
    if(saved.operationId)setRetainedOption(operationSelect,saved.operationId);
    if(saved.source&&saved.source.id===saved.editionId)await openEditionById(saved.source.id,saved.source.digest);
    if(!currentToken(guard,{project:false})||state.detail?.item.id!==id)return;
    if(saved.observation&&saved.observation.id===saved.operationId)await openObservedById(saved.observation.id,saved.observation.digest);
    if(!currentToken(guard,{project:false})||state.detail?.item.id!==id)return;
    if(saved.aggregate&&state.edition?.catalog.some(value=>value.key===saved.aggregate)&&!activeDraft(selection)){
      aggregate.value=saved.aggregate;renderAggregate(false);restoreForm(selection);
    }
  }
  await loadReports();
  if(!currentToken(guard,{project:false})||state.detail?.item.id!==id)return;
  if(state.comparison)await openComparison();
  retainSelection();await persistDrafts();if(persistSelection)await persist();
}
function setRetainedOption(control,value){
  if(!value){control.value='';return;}
  if(![...control.options].some(option=>option.value===value))control.append(el('option','Retained choice · '+value,{value}));
  control.value=value;
}
async function loadContext(){
  if(!state.detail)return;
  const guard=token('context'),id=state.detail.item.id,offset=state.contextOffset,kind=operationKind.value;
  const result=await desk('context?'+new URLSearchParams({id,offset,limit:25,...(kind?{kind}:{})}));
  if(!currentToken(guard)||offset!==state.contextOffset||kind!==operationKind.value)return;
  if(result.commissioningId!==id)throw new Error('The source catalog belongs to another commissioning project.');
  state.context=result;const chosenEdition=editionSelect.value,chosenOperation=operationSelect.value;
  options(editionSelect,result.editions.rows,x=>x.title+' · '+x.created,x=>x.id);
  options(operationSelect,result.operations.rows.filter(x=>!x.kind.startsWith('commissioning')),x=>x.kind+' · '+x.state+' · '+x.id,x=>x.id);
  // Paging changes the visible catalog, not the original selected source.
  if(chosenEdition)setRetainedOption(editionSelect,chosenEdition);
  if(chosenOperation)setRetainedOption(operationSelect,chosenOperation);
  catalogCount.textContent='From '+offset+' · '+result.editions.total+' editions · '+result.operations.total+' operations';
}
async function openEdition(){
  if(!editionSelect.value)throw new Error('Choose a retained edition on this source page.');
  return openEditionById(editionSelect.value);
}
async function openEditionById(id,expectedDigest=null){
  if(!id||!state.detail)throw new Error('Choose a retained edition in the original commissioning project.');
  const guard=token('edition'),value=await api('edition?id='+encodeURIComponent(id));
  if(!currentToken(guard))return;
  if(value.value?.id!==id||expectedDigest&&value.record?.digest!==expectedDigest)
    throw new Error('The returned edition differs from the retained original source.');
  state.edition=value;setRetainedOption(editionSelect,id);
  editionSummary.textContent=value.record.title+' · '+value.catalog.length+' native continuous aggregates';
  options(aggregate,value.catalog,x=>x.schema+'.'+x.name,x=>x.key);
  renderAggregate(false);restoreForm(selection);retainSelection();await persistDrafts();renderDrafts();
}
async function openObservedById(id,expectedDigest=null){
  if(!id||!state.detail)throw new Error('Choose an original native operation in the selected project.');
  const guard=token('observation'),value=await desk('operation?id='+encodeURIComponent(id));
  if(!currentToken(guard))return;
  if(value.operation?.id!==id||expectedDigest&&value.digest!==expectedDigest)
    throw new Error('The native outcome differs from the retained original operation.');
  state.observedOperation=value;setRetainedOption(operationSelect,id);
  nativeOutcome.textContent=JSON.stringify(value.operation,null,2);
  restoreForm(observe);retainSelection();await persistDrafts();renderDrafts();
}
function renderAggregate(preserve=true){
  if(preserve){archiveForm(selection);start.value='';end.value='';timezone.value='UTC';}
  const value=state.edition?.catalog.find(x=>x.key===aggregate.value);
  options(timeColumn,value?.columns??[],x=>x.name+' · '+x.type,x=>x.name);
  columns.replaceChildren(el('legend','Published native columns'));
  for(const row of value?.columns??[]){
    const wrap=el('label'),input=el('input','',{type:'checkbox',value:row.name,'data-draft-field':'published-column'});
    input.checked=true;wrap.append(input,document.createTextNode(row.name));columns.append(wrap);
  }
  const first=value?.columns.find(x=>[20,21,23,1082,1114,1184].includes(Number(x.oid)));
  if(first){timeColumn.value=first.name;renderTimeType();}
  if(preserve){restoreForm(selection);captureForm(selection,{force:true});retainSelection();persistDrafts().then(renderDrafts).catch(showError);}
}
function renderTimeType(){const value=state.edition?.catalog.find(x=>x.key===aggregate.value)?.columns.find(x=>x.name===timeColumn.value),types={20:'bigint',21:'smallint',23:'integer',1082:'date',1114:'timestamp without time zone',1184:'timestamp with time zone'};if(types[value?.oid])timeType.value=types[value.oid];}
function selectionInput(){
  if(!state.edition||state.edition.value.id!==editionSelect.value||!state.edition.catalog.some(value=>value.key===aggregate.value))throw new Error('Open the exact selected retained edition and aggregate.');
  return {editionId:state.edition.value.id,editionDigest:state.edition.record.digest,aggregateKey:aggregate.value,
    timeColumn:timeColumn.value,timeType:timeType.value,start:start.value,end:end.value,timezone:timezone.value,
    title:state.detail.item.title,owner:state.detail.item.owner,note:state.submitting?.note??note.value,
    columns:[...columns.querySelectorAll('input:checked')].map(x=>x.value)};
}
function renderMapping(preserve=true){
  if(preserve){captureForm(compare);archiveForm(compare);}
  const a=currentSources('BASELINE').find(x=>x.id===expectedSource.value),b=currentSources('OBSERVED').find(x=>x.id===observedSource.value);
  if(!a||!b)throw new Error('Choose one complete baseline and observed source from the current contract.');
  mapping.dataset.expected=a.id;mapping.dataset.observed=b.id;mapping.replaceChildren();
  for(const name of a.columns){
    const row=el('fieldset');row.dataset.expected=name;row.append(el('legend',name));
    const target=field(row,'Observed column or omit',{tag:'select',name:'observed'});options(target,b.columns,x=>x,x=>x,'Omit baseline column');if(b.columns.includes(name))target.value=name;
    const mapped=field(row,'Comparison field name',{name:'name',maxlength:'256'});mapped.value=name;
    field(row,'Group differences by this field',{type:'checkbox',name:'key'});
    field(row,'Omission reason, required when omitted',{name:'reason',maxlength:'2000'});mapping.append(row);
  }
  ignoredObserved.replaceChildren(el('h4','Observed columns outside the mapping'));
  for(const name of b.columns){const row=el('label',name);row.dataset.observed=name;row.append(el('input','',{name:'reason',maxlength:'2000',placeholder:'Required only when this column is not mapped'}));ignoredObserved.append(row);}
  if(preserve){formBaselines.set(compare,{context:copy(formContext(compare)),fields:formFields(compare)});captureForm(compare,{force:true});persistDrafts().then(renderDrafts).catch(showError);}
}
function mappingInput(){
  if(mapping.dataset.expected!==expectedSource.value||mapping.dataset.observed!==observedSource.value)throw new Error('Build the field mapping for the selected source pair.');
  const columns=[],ignoredExpected=[],used=new Set();
  for(const row of mapping.querySelectorAll('[data-expected]')){
    const target=row.querySelector('[name=observed]').value;
    if(target){columns.push({name:row.querySelector('[name=name]').value,expected:row.dataset.expected,observed:target,key:row.querySelector('[name=key]').checked});used.add(target);}
    else ignoredExpected.push({column:row.dataset.expected,reason:row.querySelector('[name=reason]').value});
  }
  return {columns,ignoredExpected,ignoredObserved:[...ignoredObserved.querySelectorAll('[data-observed]')].filter(x=>!used.has(x.dataset.observed)).map(x=>({column:x.dataset.observed,reason:x.querySelector('input').value}))};
}
async function openComparison(){
  if(!state.comparison||!state.detail)return;
  const guard=token('comparison'),id=state.detail.item.id,comparison=state.comparison,offset=state.comparisonOffset;
  const result=await desk('comparison?'+new URLSearchParams({id,comparison,offset,limit:25}));
  if(!currentToken(guard)||state.comparison!==comparison||state.comparisonOffset!==offset)return;
  comparisonView.replaceChildren(el('p',(result.matches?'Exact match':'Differences')+' · '+result.counts.expectedRows+' baseline rows · '+result.counts.observedRows+' observed rows · '+result.counts.matchedRows+' matching rows'));
  comparisonView.append(el('pre',JSON.stringify(result.mapping,null,2)));
  for(const [key,label]of [['expectedOnly','Baseline-only rows'],['observedOnly','Observed-only rows']]){
    comparisonView.append(el('h4',label),table([...result.mapping.columns.map(x=>x.name),'Count'],result[key].rows.map(x=>[...x.values.map(v=>JSON.stringify(v)),x.count])));
  }
  link(comparisonView,'Download every difference',url('comparison-file',{id,comparison}));
  comparisonCount.textContent='Page offset '+offset+' · '+result.expectedOnly.total+' baseline-only groups · '+result.observedOnly.total+' observed-only groups';
}
function renderCriterion(preserve=true){
  const selected=state.detail?.item.acceptance.find(x=>x.id===criterion.value);
  condition.textContent=selected?[selected.condition,selected.expectedSource].filter(Boolean).join('\n'):'Choose the original acceptance criterion.';
  decisionValue.value=selected?.decision??'NOT_RUN';decisionOwner.value=selected?.owner||state.detail?.item.owner||'';assessment.value=selected?.assessment??'';
  references.replaceChildren(el('legend','Current contract sources and outcomes'));
  if(state.detail)for(const [kind,key]of [['source','sources'],['comparison','comparisons'],['observation','observations']]){
    for(const value of state.detail.item[key].filter(x=>x.contractRevision===state.detail.item.contractRevision)){
      const wrap=el('label'),input=el('input','',{type:'checkbox',value:JSON.stringify({kind,id:value.id}),'data-draft-field':'reference'});
      input.checked=Boolean(selected?.references.some(x=>x.kind===kind&&x.id===value.id));
      wrap.append(input,document.createTextNode(kind+' · '+(value.title??value.kind)+' · '+value.id));references.append(wrap);
    }
  }
  restoreForm(decision);
  if(preserve){retainSelection();persistDrafts().then(renderDrafts).catch(showError);}
}
function renderReportLinks(id,result){reportLinks.replaceChildren(el('span','Frozen report · revision '+result.revision));
  link(reportLinks,'Complete JSON',url('report-file',{id,format:'json'}));link(reportLinks,'Printable HTML',url('report-file',{id,format:'html'}));}
async function loadReports(){
  if(!state.detail)return;
  const guard=token('reports'),id=state.detail.item.id,offset=state.reportOffset;
  const result=await desk('reports?'+new URLSearchParams({id,offset,limit:25}));
  if(!currentToken(guard)||state.reportOffset!==offset)return;
  const value=table(['Revision','Published','Complete report files'],result.reports.rows.map(x=>[x.revision,x.createdAt,'']));
  [...value.tBodies[0].rows].forEach((row,index)=>{const item=result.reports.rows[index];link(row.cells[2],'JSON',url('report-file',{id:item.requestId,format:'json'}));link(row.cells[2],'Printable HTML',url('report-file',{id:item.requestId,format:'html'}));});
  publishedReports.replaceChildren(value);reportsCount.textContent=offset+'–'+Math.min(offset+25,result.reports.total)+' of '+result.reports.total;
}
async function refresh({project:reloadProject=false}={}){
  if(state.polling)return;state.polling=true;
  try{
    state.workspace=await readWorkspace();await refreshList();
    if(reloadProject&&state.detail)await openProject(state.detail.item.id,false);
    if(state.pending)await inspectPending();
    recoveryText.textContent=state.pending?'Saved request '+state.pending.input.requestId+' · '+(state.pendingState??'Awaiting original acknowledgement'):'No pending commissioning request.';
    if(state.lastOperation&&!state.pending){
      const id=state.lastOperation,selectedId=state.detail?.item.id??null,selection=state.selectionGeneration;
      try{
        const row=await api('operation?id='+encodeURIComponent(id));
        if(state.lastOperation!==id||state.pending||!currentProjectOrEmpty(selectedId,selection))return;
        if(row.id!==id)throw new Error('The original operation response has another identity.');
        operationView.textContent=JSON.stringify(row,null,2);
        if(row.kind==='commissioning-report'&&row.state==='COMPLETE'&&row.data.result.commissioningId===selectedId)renderReportLinks(id,row.data.result);
      }catch(error){notice.textContent='The retained request history is available. The latest original status could not refresh: '+error.message;}
    }
  }finally{state.polling=false;controls();}
}
query.onsearch=()=>act(async()=>{state.offset=0;await refreshList();});
query.onchange=query.onsearch;
aggregate.onchange=()=>{renderAggregate();};
timeColumn.onchange=()=>{renderTimeType();captureForm(selection);persistDrafts().then(renderDrafts).catch(showError);};
editionSelect.onchange=()=>{
  archiveForm(selection);clearEdition();selection.reset();start.value='';end.value='';timezone.value='UTC';
  restoreForm(selection);retainSelection();persistDrafts().then(renderDrafts).catch(showError);controls();
};
operationSelect.onchange=()=>{
  archiveForm(observe);clearObservedOperation();relevance.value='';restoreForm(observe);retainSelection();persistDrafts().then(renderDrafts).catch(showError);
};
operationKind.onchange=()=>act(async()=>{state.contextOffset=0;await loadContext();});
criterion.onchange=()=>renderCriterion();
function changedComparisonSource(){
  archiveForm(compare);mapping.replaceChildren();delete mapping.dataset.expected;delete mapping.dataset.observed;ignoredObserved.replaceChildren();compareTitle.value='';
  restoreForm(compare);captureForm(compare,{force:true});persistDrafts().then(renderDrafts).catch(showError);
}
expectedSource.onchange=observedSource.onchange=changedComparisonSource;
actor.onchange=note.onchange=()=>persist().catch(showError);
await act(async()=>{
  state.workspace=await readWorkspace();state.key=state.workspace.id;
  const saved=await openStorage(),forms=await browserRead('drafts:'+state.key);
  if(forms&&forms.workspaceId!==state.key)throw new Error('The retained browser forms belong to another workspace.');
  if(forms){state.drafts=forms.drafts??{};state.draftArchive=forms.archive??{};state.selections=forms.selections??{};}
  state.requestArchive=await readRequestIndex();
  restoreForm(create);restoreForm(exportForm);
  if(saved){
    state.pending=saved.pending??null;state.lastOperation=saved.lastOperation??null;actor.value=saved.actor??'';note.value=saved.note??'';
    if(state.pending){
      state.pending.workspaceId??=state.key;state.pending.projectId??=state.pending.input.commissioningId??saved.selectedId??null;
      state.pending.selectedId??=saved.selectedId??null;
      await retainRequest(state.pending,'PREPARED');
    }
    if(saved.selectedId)await openProject(saved.selectedId,false);
  }
  restoreForm(create);restoreForm(exportForm);renderDrafts();renderRequestArchive();await refresh();
});
setInterval(()=>{if(!state.busy)refresh().catch(showError);},5000);
